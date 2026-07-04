# Shelterluv → Slack Adoption Announcer

A free bot that posts a Slack message every time an animal is adopted, using data from your shelter's [Shelterluv](https://www.shelterluv.com/) account.

- **No hosting, no servers, no monthly fees.** It runs on Google Apps Script, which is free with any Google account.
- **No coding experience required.** You'll copy and paste some text into a couple of forms — that's it.
- **Only announces real adoptions.** It's built to correctly tell the difference between "this animal was adopted" and similar-looking situations like a lost pet being reclaimed by its owner (see [How it works](#how-it-works) if you're curious why that distinction matters).
- **All animals, by default.** Out of the box it announces all animal adoptions — see [Customizing it](#customizing-it) if you want only cats, dogs, rabbits, or every species included.

<img width="382" height="428" alt="image" src="https://github.com/user-attachments/assets/985108c0-776f-42c0-b893-c7dada3e0464" />

---

## What you'll need before starting

- **A Shelterluv account** with permission to generate an API key (usually a shelter admin).
- **A Slack workspace** where you're allowed to add apps/integrations.
- **A Google account.** Any Gmail or Google Workspace account works.

You do not need permission to install software on any computer — everything here runs in your web browser, on Google's and Slack's servers.

---

## Step 1: Get a Shelterluv API key

1. Log into Shelterluv.
2. Go to **Configuration → General → Integrations** tab.
3. Look for an existing API key, or a way to generate a new one for this integration.
4. If you don't see that option — or you specifically want a fresh key just for this bot — Shelterluv issues keys via a request form instead of a self-serve button. On the Integrations tab, look for a note like *"Need more API keys? Complete [this form](https://form.jotform.com/243268533362054) to request additional keys."* and open that link. (If that exact link doesn't work for you, check your own Integrations tab for the current version — Shelterluv may update this URL over time.)
5. Fill out the form:
   - **Customer Details:** your name, organization name, and email.
   - **Select the Animal Service Provider API Key(s) Needed:** check **Other** — this is a custom integration, not one of the listed platform partners.
   - **Name of the Integration:** e.g. `Slack Adoption Announcer`
   - **Description/Purpose of the Integration:** e.g. *"Automated Slack notification posted when an animal is adopted, using adoption event data from the Shelterluv API."*
   - **What type(s) of data does your API integration need access to?** check **Animals** and **Events** only — this bot never reads People, Partners, or Vaccines data, so there's no reason to request access to those.
6. Submit the form. Shelterluv will follow up (by email, typically) with your API key — this may take a bit, since a person on their end has to issue it.
7. Save the key somewhere temporary (a notes app, a draft email to yourself) — you'll paste it in later, in Step 4.

---

## Step 2: Create a Slack "Incoming Webhook"

This gives the bot a private address it can send messages to.

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and log into your Slack workspace if prompted.
2. Click **Create New App → From scratch**.
3. Give it a name (e.g. "Adoption Announcer") and select your workspace.
4. In the left sidebar, click **Incoming Webhooks**.
5. Toggle **Activate Incoming Webhooks** to On.
6. Click **Add New Webhook to Workspace**, then pick the channel where you want adoption announcements to appear.
7. Click **Allow**. You'll now see a **Webhook URL** — it looks like `https://hooks.slack.com/services/T00/B00/xxxxxxxx`.
8. Copy that URL and save it alongside your Shelterluv API key.

---

## Step 3: Create the Google Apps Script project

1. In this repository, click on the file **`shelterluv_slack_bot.gs`**.
2. Click the **"Raw"** button (or use the copy icon in the top-right of the file view), then select all the text and copy it (Ctrl/Cmd+A, then Ctrl/Cmd+C).
3. Go to **[script.google.com](https://script.google.com)** and log in with your Google account.
4. Click **New project**.
5. You'll see a blank code editor with a file called `Code.gs`. Click inside it, select all the placeholder text (Ctrl/Cmd+A), and delete it.
6. Paste in the code you copied in step 2 (Ctrl/Cmd+V).
7. Click the project name at the top (something like "Untitled project") and rename it to something recognizable, like "Shelterluv Adoption Bot."
8. Press **Ctrl+S** (or **Cmd+S** on Mac) to save.

---

## Step 4: Add your API key and webhook URL

Your key and URL are kept separate from the code itself, so they never get accidentally shared if you show someone the code.

1. In the Apps Script editor, click the **gear icon (⚙ Project Settings)** in the left sidebar.
2. Scroll down to **Script Properties** and click **Add script property**.
3. Add two properties:
   | Property | Value |
   |---|---|
   | `SHELTERLUV_API_KEY` | *(paste your Shelterluv API key)* |
   | `SLACK_WEBHOOK_URL` | *(paste your Slack webhook URL)* |
4. Click **Save script properties**.

---

## Step 5: Run it once manually (to grant permissions)

1. Go back to the **Editor** (the `<>` icon in the left sidebar).
2. At the top, next to the "Run" button, use the dropdown to select the function **`checkForAdoptions`**.
3. Click **Run** (▶).
4. The first time you do this, Google will ask you to **authorize** the script. Click through the prompts:
   - "Review permissions" → choose your Google account
   - You may see a screen warning "Google hasn't verified this app" — this is normal for a script you wrote/pasted yourself. Click **Advanced**, then **Go to [project name] (unsafe)**, then **Allow**.
5. Once it finishes, click **Executions** (clock icon) in the left sidebar to see the log. It should say something like "Fetched 0 events... Posted 0 adoption(s)." That's expected — this first run just starts the clock; it doesn't look at anything that happened before now.

---

## Step 6: Turn on automatic checking

1. In the function dropdown at the top, select **`installTrigger`**.
2. Click **Run** (▶).
3. Check the **Triggers** (alarm clock icon) in the left sidebar — you should now see `checkForAdoptions` listed, set to run automatically every 15 minutes.

That's it. From now on, whenever an adoption happens in Shelterluv, it'll show up in your Slack channel within about 15 minutes — automatically, with no one needing to open anything.

---

## Customizing it

All of the following are edited directly in the code, near the top of the file, under `CONFIGURATION`:

- **Change which animals get announced:** edit `TARGET_SPECIES`. Set it to `'Dog'`, `'Cat'`, `'Rabbit'`, etc., or set it to `''` (empty) to announce adoptions for every species.
- **Change how often it checks:** edit `POLL_INTERVAL_MINUTES`. Google only allows the values 1, 5, 10, 15, or 30.
- **Change the message wording:** find the `postAdoptionToSlack` function and edit the text inside the `text:` line.

After making a change, save the file (Ctrl/Cmd+S). You do **not** need to re-run `installTrigger` unless you changed `POLL_INTERVAL_MINUTES` — any other edit takes effect automatically the next time the trigger fires.

---

## Where things are stored

- **Your API key and webhook URL** live only in Script Properties (Step 4) — never in the code itself.

---

## Troubleshooting

- **"Missing Script Property" error** — you skipped or mistyped Step 4. Double check the property names match exactly: `SHELTERLUV_API_KEY` and `SLACK_WEBHOOK_URL`.
- **"Shelterluv API error 401" or similar** — your API key is likely incorrect or has been revoked. Generate a new one in Shelterluv and update the Script Property.
- **Nothing posts to Slack, ever** — check the **Executions** log (clock icon) for errors. Also confirm you selected the right channel when creating the webhook in Step 2.
- **A cat with no real photo shows a generic logo/paw-print image instead of no image at all** — Shelterluv returns a placeholder image (like `default_cat.png`) rather than leaving the photo field empty when there's no real photo. The bot already filters this out automatically. If you still see one, Shelterluv may have changed their placeholder filename pattern — please open an issue with the URL you're seeing.

---

## How it works

This bot reads Shelterluv's **event history** for each animal, which records exactly what happened and when (`Outcome.Adoption`, `Outcome.ReturnToOwner`, etc.). Only genuine `Outcome.Adoption` events trigger a Slack post. If that same animal is adopted again later (after being returned in between), it'll correctly post again — each real adoption gets its own announcement.

---

## License

MIT — see [LICENSE](./LICENSE). Free to use, modify, and share.

## Disclaimer

This is an independent, community-built project. It is not affiliated with, endorsed by, or supported by Shelterluv, Slack, or Google — it simply uses their public APIs. Use it at your own discretion, and direct any bugs or questions to this repository's issues, not to Shelterluv or Slack support.

## Contributing

Issues and pull requests are welcome. This was built for a specific shelter's workflow and generalized for wider use, so if your shelter's Shelterluv setup behaves differently in some edge case, please open an issue with details (sanitized of any private API keys, of course).

