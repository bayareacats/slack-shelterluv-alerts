/**
 * Shelterluv -> Slack "cat adopted" bot (events-based)
 * -----------------------------------------------------
 * Uses the Shelterluv EVENTS API (not the animal's Status field) to
 * determine true adoptions. Status fields like "Healthy in Home" are
 * ambiguous (adoption, return-to-owner, return-to-finder, etc. can all
 * land on the same status), but each event's `Type` is unambiguous:
 * Outcome.Adoption means an adoption happened.
 *
 * This posts once for EVERY Outcome.Adoption event,
 * deduped only by (animalId, event time). It deliberately does NOT
 * check whether that adoption is still the animal's "current" status.
 * That means if a cat is adopted, later returned, and adopted again,
 * you'll get a Slack post both times, and each is a real adoption event
 * worth announcing.
 *
 * SETUP
 * 1. Go to script.google.com, create a new project, paste this entire file in.
 * 2. Project Settings > Script Properties > add:
 *      SHELTERLUV_API_KEY   = your Shelterluv API key
 *      SLACK_WEBHOOK_URL    = your Slack Incoming Webhook URL
 * 3. Run `checkForAdoptions` once manually. On this first run it just
 *    establishes the "now" cursor. Then run
 *    `installTrigger` once to schedule checking for adoptions every 15 minutes.
 *
 * Live-only, no backfill: only events going forward are ever considered.
 */

/** ================= CONFIGURATION =================
 * Change these two values to fit your shelter. No coding knowledge
 * needed beyond editing the text between the quotes below.
 */
const TARGET_SPECIES = '';   // e.g. 'Cat', 'Dog', 'Rabbit'. Leave as '' (empty) to announce every species.
const POLL_INTERVAL_MINUTES = 15; // How often the bot checks Shelterluv for new adoptions, in minutes.
                                   // Google Apps Script only allows 1, 5, 10, 15, or 30 here.
/** =================================================== */

const SHELTERLUV_BASE = 'https://www.shelterluv.com/api/v1';
const MAX_EVENT_PAGES_PER_RUN = 20; // safety cap: 20 pages x 100 = 2,000 events/run

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
