/**
 * Shelterluv -> Slack "cat adopted" bot
 */

/** ================= CONFIGURATION =================
 * Change these two values to fit your shelter. No coding knowledge
 * needed beyond editing the text between the quotes below.
 */
const TARGET_SPECIES = 'Cat';   // e.g. 'Cat', 'Dog', 'Rabbit'. Leave as '' (empty) to announce every species.
const POLL_INTERVAL_MINUTES = 15; // How often the bot checks Shelterluv for new adoptions, in minutes.
                                   // Google Apps Script only allows 1, 5, 10, 15, or 30 here.
/** =================================================== */

const SHELTERLUV_BASE = 'https://www.shelterluv.com/api/v1';
const MAX_EVENT_PAGES_PER_RUN = 20; // safety cap: 20 pages x 100 = 2,000 events/run

// Intake event types that indicate a previously-adopted animal has come
// back to the shelter. Logged internally only -- never posted to Slack.
const RETURN_INTAKE_TYPES = new Set([
  'Intake.AdoptionReturn',
  'Intake.OwnerSurrender',
  'Intake.FosterReturn'
]);

function getProp_(key) {
  const v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('Missing Script Property: ' + key);
  return v;
}

function shelterluvGet_(path, apiKey) {
  const resp = UrlFetchApp.fetch(`${SHELTERLUV_BASE}${path}`, {
    method: 'get',
    headers: { 'X-Api-Key': apiKey },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error(`Shelterluv API error ${resp.getResponseCode()} for ${path}: ${resp.getContentText()}`);
  }
  return JSON.parse(resp.getContentText());
}

function getAnimalIdFromEvent_(event) {
  const rec = (event.AssociatedRecords || []).find(r => r.Type === 'Animal');
  return rec ? String(rec.Id) : null;
}

/** Pull events newer than `sinceUnix`, paginating with a safety cap. */
function fetchEventsSince_(apiKey, sinceUnix) {
  const collected = [];
  let offset = 0;
  const limit = 100;

  for (let page = 0; page < MAX_EVENT_PAGES_PER_RUN; page++) {
    const data = shelterluvGet_(`/events?limit=${limit}&offset=${offset}&since=${sinceUnix}`, apiKey);
    const events = data.events || data.Events || [];
    if (!events.length) break;

    collected.push(...events);
    if (events.length < limit) break; // last page
    offset += limit;
  }

  // Client-side filter as a safety net in case `since` isn't honored
  // or the API doesn't return events in a guaranteed order.
  return collected.filter(e => Number(e.Time) > sinceUnix);
}

function fetchAnimal_(apiKey, animalId) {
  const data = shelterluvGet_(`/animals/${animalId}`, apiKey);
  return data.animal || data.Animal || data;
}

function matchesTargetSpecies_(animal) {
  if (!TARGET_SPECIES) return true; // empty = announce every species
  const species = String(animal.Type || animal.Species || '').toLowerCase();
  return species === TARGET_SPECIES.toLowerCase();
}

/** Shelterluv returns a generic placeholder image (e.g. default_cat.png)
 *  instead of an empty value when an animal has no real photo. */
function isPlaceholderPhoto_(url) {
  return /\/default_[a-z0-9_-]+\.(png|jpe?g|gif)$/i.test(String(url));
}

/** Finds (or creates, on first run) the internal "returns" log sheet. */
function getReturnLogSheet_() {
  const props = PropertiesService.getScriptProperties();
  const existingId = props.getProperty('RETURN_LOG_SHEET_ID');

  if (existingId) {
    try {
      return SpreadsheetApp.openById(existingId).getSheets()[0];
    } catch (e) {
      // fall through and recreate if it was deleted/moved
    }
  }

  const ss = SpreadsheetApp.create('Shelterluv Adoption Return Log');
  const sheet = ss.getSheets()[0];
  sheet.appendRow(['Logged At', 'Animal ID', 'Animal Name', 'Event Type', 'Subtype', 'Event Time']);
  props.setProperty('RETURN_LOG_SHEET_ID', ss.getId());
  Logger.log('Created return log sheet: ' + ss.getUrl());
  return sheet;
}

function logReturnEvent_(sheet, animal, event) {
  sheet.appendRow([
    new Date(),
    animal.ID ?? animal.Id ?? animal.internal_id ?? '',
    animal.Name || '',
    event.Type,
    event.Subtype || '',
    new Date(Number(event.Time) * 1000)
  ]);
}

/** ---- Main entry point, called on a schedule ---- */
function checkForAdoptions() {
  const props = PropertiesService.getScriptProperties();
  const apiKey = getProp_('SHELTERLUV_API_KEY');
  const webhookUrl = getProp_('SLACK_WEBHOOK_URL');

  const lastChecked = Number(props.getProperty('LAST_CHECKED_UNIX') || 0) ||
    Math.floor(Date.now() / 1000); // live-only: first run starts the cursor at "now",
                                    // no historical backfill of anything before install

  const postedEventKeys = new Set(JSON.parse(props.getProperty('POSTED_EVENT_KEYS') || '[]'));

  const recentEvents = fetchEventsSince_(apiKey, lastChecked);
  Logger.log(`Fetched ${recentEvents.length} event(s) since ${lastChecked}.`);

  let maxSeenTime = lastChecked;
  for (const e of recentEvents) {
    if (Number(e.Time) > maxSeenTime) maxSeenTime = Number(e.Time);
  }

  const adoptionCandidates = recentEvents.filter(e => e.Type === 'Outcome.Adoption');
  let postedCount = 0;

  for (const event of adoptionCandidates) {
    const animalId = getAnimalIdFromEvent_(event);
    if (!animalId) continue;

    const eventKey = `${animalId}:${event.Time}`;
    if (postedEventKeys.has(eventKey)) continue; // already handled this exact event

    // Note: no "is this still the animal's current status" check here on
    // purpose -- every genuine Outcome.Adoption event gets announced,
    // even if the cat is later returned and re-adopted down the line.
    const animal = fetchAnimal_(apiKey, animalId);
    if (!matchesTargetSpecies_(animal)) {
      postedEventKeys.add(eventKey);
      continue;
    }

    postAdoptionToSlack(animal, event, webhookUrl);
    postedEventKeys.add(eventKey);
    postedCount++;
  }

  props.setProperty('LAST_CHECKED_UNIX', String(maxSeenTime));
  const trimmed = [...postedEventKeys].slice(-2000);
  props.setProperty('POSTED_EVENT_KEYS', JSON.stringify(trimmed));

  Logger.log(`Posted ${postedCount} confirmed adoption(s) this run.`);

  // ---- Internal-only: log returns of previously-announced adoptions ----
  // (Built from postedEventKeys, which now includes both prior runs' and
  // this run's adoption keys, so it catches returns weeks/months later.)
  const adoptedAnimalIds = new Set(
    [...postedEventKeys].map(k => k.split(':')[0])
  );

  const returnEvents = recentEvents.filter(
    e => RETURN_INTAKE_TYPES.has(e.Type) && adoptedAnimalIds.has(getAnimalIdFromEvent_(e))
  );

  if (returnEvents.length) {
    const sheet = getReturnLogSheet_();
    for (const event of returnEvents) {
      const animalId = getAnimalIdFromEvent_(event);
      const animal = fetchAnimal_(apiKey, animalId);
      logReturnEvent_(sheet, animal, event);
    }
    Logger.log(`Logged ${returnEvents.length} return(s) to internal sheet (no Slack post).`);
  }
}

function postAdoptionToSlack(animal, event, webhookUrl) {
  const rawName = animal.Name || 'A cat';
  const name = rawName.replace(/\s*\([^)]*\)/g, '').trim() || rawName;
  const rawPhoto = (animal.Photos && animal.Photos[0]) || animal.CoverPhoto || null;
  const photo = (rawPhoto && !isPlaceholderPhoto_(rawPhoto)) ? rawPhoto : null;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: `:tada: *${name}* has been adopted!` }
    }
  ];
  if (photo) {
    blocks.push({ type: 'image', image_url: photo, alt_text: name });
  }

  UrlFetchApp.fetch(webhookUrl, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ blocks }),
    muteHttpExceptions: true
  });
}

function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'checkForAdoptions') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkForAdoptions').timeBased().everyMinutes(POLL_INTERVAL_MINUTES).create();
  Logger.log(`Trigger installed: checkForAdoptions runs every ${POLL_INTERVAL_MINUTES} minutes.`);
}
