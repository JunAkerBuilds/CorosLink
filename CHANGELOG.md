# Changelog

All notable changes to CorosLink are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Attach files to Coach.** Click the paperclip, drop files on the conversation, or paste a screenshot to send Coach a PDF, Word document (.docx), text, CSV or Markdown file, or an image, up to six at a time. Coach reads a document's text, tables included, and looks at scanned pages and images, so you can hand it a training plan you made elsewhere and ask it to put the plan on COROS. It drafts the workouts for you to review before anything is saved. Files go to the Coach provider you chose with each message; CorosLink keeps a copy with the conversation, so you can open it from the transcript, and deletes it with the conversation.
- **Coach keeps C-LINK's Lock Screen up to date.** While a linked computer runs a Coach answer, C-LINK's Live Activity now shows whether Coach is thinking, looking at your data or writing, and how the answer ended (replied, waiting for you, or failed), even with the iPhone locked. CorosLink sends the relay only the step and a word count, never what Coach writes or which data it reads.

### Fixed

- **Watches connect on Windows again without removing them first.** CorosLink 0.1.57 and 0.1.58 paired the watch with Windows on every connect. Once the watch forgot that pairing, for example after pairing with your phone again, every connect failed until you removed the watch under **Settings → Bluetooth & devices**. CorosLink now connects without pairing unless the watch asks for it. If an old pairing is what's failing, it removes that pairing and tries once more.
- **Workouts deleted in the COROS app leave the Training Library.** A workout you deleted in the COROS app, or in CorosLink, could come back in **Training Library → Workouts** whenever COROS didn't answer and the Library showed its saved copy. Now it disappears the next time the Library refreshes, along with any tags you gave it in CorosLink.
- **A stalled COROS request gives up after 30 seconds.** Training Hub and Library actions such as **Delete** no longer spin for minutes when COROS stops responding. They stop with a message to check your connection and try again.

## [0.1.58] - 2026-10-19

### Added

- **Hide features you don't use.** Right-click the sidebar to hide a feature or bring one back, or switch features on and off in **Settings → Sidebar**. Overview and Settings always stay. If you hide your startup view, CorosLink opens on Overview instead.
- **Group the lap table by distance.** In an activity's **Laps** table, switch between the watch's own laps, 1 km, 5 km or 10 km splits, and the whole activity, like Training Hub. Only the groupings COROS sends for that activity appear. The fastest lap or split in each view is marked **Fastest**.
- **See which plans are on your calendar.** In **Training Library → Plans**, plans with workouts on your COROS calendar show **On calendar** and the week you're in ("Week 3 of 14"). This includes COROS Plans the Coach put on your calendar. Filter by **On calendar** to see only those.
- **Make watch faces without signing in to COROS.** **Watch Faces → Create** lists the editable templates for every supported watch without a COROS sign-in, and **Start blank** and **Change watch** work signed out too. You still sign in for **Official faces**, **My faces**, sending a face to the COROS app, and getting your watch key the first time you install over Bluetooth.
- **Distance markers on the route map.** An activity's route shows numbered chips at every kilometre, or every mile in imperial units, at the points where the watch counted them. Long rides space them out (every 5 or 10 km) so the map stays readable.

### Changed

- **Maps add to what's already on the watch.** When the COROS app has already installed part of a region, **Transfer selected** copies only the tiles the watch is missing, and the free-space check counts only those. Before, the watch needed room for the whole package.
- **Choose Local Map Folder is gone.** Maps install from the COROS packages you download in **Maps → COROS Maps**.

### Fixed

- **The calendar dialog fits small windows.** Adding a plan to the calendar or removing it no longer cuts off the title or the confirm button. Workouts are grouped by week with their sport, the summary shows the date range, and the button says how many workouts it adds or removes.
- **Delete plans that are on your calendar.** In **Training Library → Plans**, a plan you added to the COROS calendar, such as a Coach plan saved to the calendar, had a greyed-out delete button until you removed its workouts yourself. Delete now removes its upcoming workouts from the calendar first, then the plan. Past days stay.
- **Delete plans you sent to COROS.** Coach plans saved as a COROS Plan now have a delete button in **Training Library → Plans**. It deletes the plan from your COROS account, not just from CorosLink. If the plan is on your COROS calendar, CorosLink ends it there first, which removes its upcoming workouts; past days stay. Before, only the COROS app could remove them.
- **Plans deleted in the COROS app leave the Training Library.** A COROS plan you deleted in the COROS app used to stay in **Training Library → Plans**, marked as synced. Now it disappears the next time the Library refreshes, along with any tags or notes you gave it in CorosLink.
- **Short laps show the right time.** Laps under 100 seconds, such as interval rests and 400 m repeats, showed a hundred times too long (a 60 s rest read 1:40:00). Their pace and the dialog's pacing note were wrong too.
- On macOS, the **Import GPX** file picker in Route Studio opens attached to the CorosLink window. It could open behind the window, making the app look frozen.

## [0.1.57] - 2026-10-18

### Added

- **CorosLink in Portuguese.** Pick **Português** in the language menu or the welcome tour.
- **Align the date in Watch Faces.** Weekday, month and day each get left, centre or right alignment, like the number readouts. The text moves inside the template's box, so a left-aligned weekday starts at the same spot every day.
- **Chart pages in Watch Faces.** The layer list now groups metrics into **Fixed metrics**, **Selectable** and **Chart pages**. The chart inspector lists the pages **Back** cycles through, with the readouts and weather fields on each page. **Make fixed** turns a chart readout into an always-shown field with the same artwork. This hasn't been checked on a watch yet.

### Changed

- **Coach names your conversations.** After the first answer, Coach gives the conversation a short title instead of using your first question. The new title also shows in C-LINK.
- **A smaller download.** The installed app is about 300 MB smaller.
- Chart dates, weekdays and distances follow the app language.
- In Watch Faces, wind speed and direction count as chart-page fields, because the watch hides them on its daily-data pages. The preview draws the curve pages' horizon line and "now" dot in white, as the watch does.

### Fixed

- **intervals.icu import works again.** COROS retired an endpoint and every upload failed with "COROS STS request failed: 404". If your Training Hub session has expired, CorosLink now asks you to sign in again.
- Route Studio's panels no longer cover the Support dialog and other app windows, and **Share to phone** opens on top.
- On Windows, picking the watch's own map folder as the source is caught even when its capitalisation differs.
- Labels that stayed in English are now translated, and some Chinese translations that had the wrong meaning are corrected.
- Strength no longer shows "session s", and the races chart caption is spaced properly.
- The daily-data divider in the Watch Faces preview no longer shrinks under the time.

## [0.1.56] - 2026-10-17

### Added

- **Help test C-LINK on iPhone, and join the CorosLink Discord.** I'm building C-LINK, the iPhone app for CorosLink. After this update, a one-time note invites iPhone owners to join the [TestFlight beta](https://testflight.apple.com/join/CHeNwjVn) and everyone to join the [CorosLink Discord](https://discord.gg/3x9rErHyjR) for updates, support and feedback. Close it with **Maybe later**. If the welcome tour is open, the note waits for the next launch.
- **Support in the toolbar.** A new **Support** button next to **Buy me a coffee** opens the Discord and the iPhone beta, plus a link to report an issue on GitHub. Both links are also in **Help & links (?)** under a new **Community** group.

### Fixed

- The workout and plan cards Coach prepares through COROS (stats, destination notes and buttons) are now in French and Chinese instead of English.

## [0.1.55] - 2026-10-17

### Added

- **Coach from your iPhone.** **Remote access** in Coach settings pairs C-LINK, the iPhone app, with a QR code so you can chat with your Coach from the phone, pick up any conversation, delete conversations and choose the model. Pairing works on your home network out of the box. Turn on **Away from home** and sign in with your CorosLink website account to reach Coach from anywhere: CorosLink then sets up a private Cloudflare Tunnel for this computer (it asks before downloading Cloudflare's `cloudflared`). Your conversations travel through the tunnel to your computer, not through CorosLink's servers, and phone alerts carry no message text.
- **Bluetooth error reports that show where a connection failed.** When connecting, syncing a face or route, or any other watch transfer fails, **Copy error report** in **Settings → Error logs** now includes where it failed in the Bluetooth helper (with the Mac's Bluetooth error code), what the app was doing, and the last 40 Bluetooth events with their timings. Watch disconnects and helper crashes are recorded too, even when nothing was in progress. Like the rest of the report, it never includes keys, watch data or device identifiers.

### Changed

- **Activity duration and pace use moving time**, like the COROS app: pauses no longer slow your average pace or speed. The activity list, details, overview and Coach all use it. Activities synced before this update show elapsed time until they sync again.
- **The Coach workspace got a refresh.** A new conversation starts from a centred box that moves to the bottom when you send, switching conversations or opening a creation slides between views instead of cutting, and messages no longer show avatars. The conversation list and the creations panel run the full height of the window.
- Workouts and plans the Coach prepares through COROS's own tools show as full workout cards, with the structure bar, each step's target and intensity, and repeat groups, like a scheduled workout in the calendar. The creations list names them after the workout.
- The Coach knows today's date and time, so "tomorrow" and "next Monday" land on the right day.
- The Coach can read run power and cadence from your activities, and the model pickers show each model's version.
- In Watch Faces, the daily-data chart area (stress, stamina, steps, calories, elevation) previews as the readout pages the watch shows instead of a bar graph, and NOMAD keeps its chart heart rate when you export it.

### Fixed

- **Weather on faces that already have weather icons.** Exporting a face built on a template with its own weather icons, such as NOMAD, failed with "The replacement for watchface_240x240/weather/01.png must be a 41×41 PNG like the template's." It exports again, with Studio's weather icons.
- When the watch refuses to authenticate, the error report now says what the watch replied, along with its model and firmware.

## [0.1.54] - 2026-10-15

### Added

- **A brief and a debrief on every calendar workout.** Open a workout in the calendar to write a **brief** before it: a one-line goal, the things to watch for, and a fuel plan. Coach can write one too: tap **Ask Coach** on an empty brief, or ask in chat, and it lands on the workout with a Coach badge. After the session, the **debrief** asks how it felt on a five-step scale, lets you tick off each focus point as hit, partly or missed, and logs what you ate or drank, whether it was something new, and how it sat. A journal box takes the rest. Everything saves as you go, and stays on the workout when you drag it to another day. Workouts with notes get a small mark in the calendar. Coach reads your journal before advising on fueling or pacing, sees your recent debriefs and upcoming briefs, and can log a debrief from what you tell it in chat. Notes stay on this computer; nothing is sent to COROS.
- **Pinned coach charts that keep themselves current.** Charts Coach draws can now bind more than daily training metrics: hourly **stress, heart rate, blood oxygen and respiratory rate** from the watch over 1–7 days, plus daily **steps, calories and VO₂ max**, and the stat tiles above a chart can bind to a metric too (latest, average, min, max or sum, including current recovery). Every card shows whether it is **Live**, **Partly live** or a **Snapshot**, so you know before pinning whether it will update. Pinned charts refresh on the Training Hub on their own: when the page opens, after a hub refresh, when you come back to the app, and every 15 minutes while it stays open, with a "refreshed 5 min ago" stamp. Snapshot charts get a **Make live** button that opens Coach with a one-line request and the chart attached as a small **Pinned chart** chip, so Coach can rebuild it from your data. Remove the chip before sending if you change your mind.
- Pinning a chart adds the **Coach charts** section to your Training Hub dashboard if it isn't there yet, and the card says where the chart went. The section was opt-in before, so a first pin landed somewhere you couldn't see.

### Changed

- Pinning a chart with the same title as one already on the Training Hub updates that pin in place instead of adding a second copy. In Coach the button reads **Update pin** when that is what it will do, and Coach is told to reuse titles for charts you've pinned.
- The **Coach charts** widget can be resized like the other chart widgets, from Small to Full width and from mini to tall, so a pinned chart can sit beside another widget instead of always taking a full row. Shorter sizes shrink the plot and tiles and drop the notes.
- Pinned charts on the Training Hub lead with their own title. The "1 pinned chart" heading is gone, a lone chart is the widget itself rather than a card inside a card, and freshness and age share one small line ("Coach · Live · 5 min ago"). Refresh and Unpin are quiet icons; Make live keeps its label. The plot grows to fill the widget instead of leaving an empty band.

### Fixed

- **Bluetooth works on Windows.** Finding or connecting a watch with **Windows Bluetooth** failed every time with "System Bluetooth failed (ModuleNotFoundError)" since 0.1.52, because the Bluetooth parts bundled with the app didn't match the app's own Python. They do now, and a build that mixes them up again stops before it can ship.
- The Coach's **Coach creations** panel (wide windows) now also lists the workouts and plans the coach prepares through COROS's own tools, so it no longer stays hidden when the only thing to review is a **Review workout** card. Open an item for its details and **Save to COROS** from the panel, as with local drafts.
- In the paper theme, the training globe on Overview is a softly shaded off-white sphere instead of a flat grey ball.

## [0.1.53] - 2026-10-15

### Added

- **CorosLink in French and Simplified Chinese.** Pick **English**, **Français** or **简体中文** in **Settings → App language**. The whole app switches at once, menus and file dialogs included, without losing what you had open. The first launch follows your system language when it's one of these. Text you typed on your own watch faces stays as you wrote it.
- **A welcome tour.** The first time CorosLink opens, including the first launch after updating, a short tour says hello and asks for your language (English, French or Simplified Chinese, switching the whole tour as you pick), then walks through each part of the app, from Training Hub and Coach to planning, Strength, Watch Faces, Maps and Music, with a picture of each and where to find it in the sidebar. The last step picks dark or paper and your units, and offers to sign in to COROS or connect your watch. Leave with **Skip tour** or Esc at any point, and open it again from **Help & links → Take the tour**. Once you finish or skip it, it doesn't come back on its own.
- **Start a watch face from scratch.** Editable templates in Watch Faces have a **Start blank** button next to **Use this template**. It opens the template with nothing on the face and a black background, on the current and always-on displays alike. **Add the time** puts the template's hours and minutes back on both (in white when the template's own digits would vanish on black), or its analog hands on faces without digits. **Add** in the Layers panel offers every other part the template supports, from the date to weather and health data. **New watch face** now asks how to begin: **From a template** opens the editable templates, and **Start from scratch** goes straight to an empty face built on your watch's first digital template. The template still decides which watch data a face can show.
- **Send faces to your iPhone.** Studio's **Send to COROS** dialog adds **Send to iPhone**: **Show code** displays a QR code that C-LINK, the iPhone app, scans to fetch the face over your Wi-Fi network (Mac, Windows and Linux), and **AirDrop** hands it over without shared Wi-Fi (Mac). The face lands in C-LINK's My Faces, ready to install on your watch from the phone. Codes expire after ten minutes. With no shared Wi-Fi on Windows or Linux, join your iPhone's Personal Hotspot from the computer.
- **Strava gym sessions in Strength.** Connect Strava from Strength or **Settings → Accounts & API** with your own Strava API application's Client ID and Client Secret, then approve CorosLink in your browser. Weight Training, CrossFit, HIIT and Workout activities join the Strength history as a new **Strava** source and in **Combined**: copies of COROS or Hevy sessions gain your Strava notes, and sessions recorded only on Strava count toward sessions and time with their heart rate, calories and Relative Effort. Strava's API does not share the Exercises tab, so sets and reps still come from COROS or Hevy. Strava now requires a subscription for personal API applications.
- **Races in Training Hub.** A new **Races** tab keeps your official race results. Mark a run as a race from its details in Activities, confirm the runs CorosLink suggests (named like a race, or far quicker than your usual pace), or add races from before you had your watch. Enter chip times, placings and notes; results count over the official distance, not what the watch measured. Each distance charts your times with personal bests, **All** compares every race as a 5K equivalent using Riegel's formula, and **Compare** puts two races side by side with your training in the eight weeks before each. With Strava connected, **Import from Strava** brings in runs marked Race there, including races from before your COROS history.
- **Channels and time in zones in activity details.** Activities now chart every second the watch recorded: pace or speed, grade-adjusted pace, heart rate, cadence, power, stride length, ground contact, vertical oscillation and ratio, elevation and grade. Overlay a few channels on one chart or stack them in lanes, against time or distance, with adjustable smoothing. Hover to read every channel at once and see the spot on the route map; drag across the chart to get averages, distance and climb for that stretch and highlight it on the map; click a lap number to select the lap. Zoom with the handles under the chart or by pinching. Workouts shade their warm-up, work, recovery and cool-down steps, and stacked heart rate shows your zones. **Time in zones** breaks down heart rate (and pace, for runs) using COROS's own zone totals.
- **Route makeup in Route Studio.** Generated, drawn and sketched routes show how much of the distance is away from traffic and how much is paved (or unpaved, for trail routes) beside the elevation chart. Click it for the full breakdown by way type (sidewalk, path and trail, cycleway, quiet street, service road, parking and driveways, busy road) and by surface. Chips flag anything worth knowing before you head out: stretches through parking lots, busy roads without a sidewalk, long out-and-back sections, or a route built without CorosLink's athlete routing. Saved routes keep their breakdown.
- **Choose the surface.** Generate and Draw have a **Surface** choice: **Road**, **Mixed** or **Trail** for runs, walks and hikes, **Paved**, **Mixed** or **Gravel** for road rides, and **Mixed** or **Singletrack** for mountain biking. The **Elevation** choice (**Flatter** or **Hilly**) now changes the route too; before, the free routing engine ignored both.
- **Pick your loop.** Generated loops come with up to two alternatives on different streets, shown under **Generate route** as cards with each loop's outline, distance, climb, and how much is car-free and paved. Each alternative says what it does better than the best match, such as more car-free, flatter or more paved. Hover a card to see that loop on the map; click it to make it the saved route. The other loops stay faintly on the map for comparison.
- The Calendar's week summary breaks the week down by sport, with each sport's training load, time and distance next to what was planned.
- **Delete all** in Route Studio's saved routes clears every saved route at once, after asking.

### Changed

- **Overview is a morning brief.** The first page now opens on your training rather than your watch. Recovery and overnight vitals (resting heart rate, sleep HRV, VO₂max and last night's sleep) are each read against your own baseline, with their trend and a pill saying whether you're above, steady or below it; readings that haven't synced yet share one row with a way to connect them. Below that sit today's plan and your week from the COROS calendar, your latest activity with its route, race predictions for if you raced today, and shortcuts to the rest of the app. The watch, its connection and music share one panel that shows while a watch is connected. The training globe card, **Where you've been**, lists the places you've trained with totals for the period you pick.
- **Route Studio builds routes for training, not driving.** Runs, walks, hikes and rides now use CorosLink's own routing profiles on the free routing service. Parking lots, driveways and drive-throughs are a last resort, runners stay on sidewalks rather than the edge of busy roads, and quiet, green streets and paths win ties. Generated loops pass through the start instead of running out and back from it. CorosLink tries several loops, avoids ones that run up one side of a road and back down the other, and keeps the one closest to your distance; when the roads near you don't allow a clean loop of that length, it tells you how far off the closest one is. When the athlete profile can't be used, routes fall back to the standard profile and say so.
- **Records & PRs is a board in an arena.** The page is one graphite board instead of a grid of cards. Your running distances run along a single rail, from 1K to the marathon, lit gold up to the farthest distance you have raced and dotted beyond it, with the time, pace and date set under each marker and COROS's predicted time waiting at the distances you haven't run yet. Longest run, most elevation gain and every cycling, swimming and walking best are figures on the same grid, each saying how it compares: shorter periods against your all-time best, all-time bests against COROS's prediction, and how long a record has stood. **New PR** only marks records that are all-time bests. Behind the wreath, the header is a stage: floodlight rays, a fire line along its edge with embers and bursts of sparks, and the rail ignites marker by marker when you change the period. **The work behind them** and the milestones keep their place underneath. Motion follows your reduced-motion setting and pauses while the window is in the background.
- **Sleep HRV reads at a glance.** The card in Training Hub now leads with the night's HRV average and COROS's assessment, with a small gauge that places it against your normal range and baseline. Below that it shows the night's low and high (or the week's average, low and high), then the chart. When last night hasn't synced yet, **Today** shows your latest synced night and says so. When there's no data, the card shows a short note instead of COROS's full text report.

### Fixed

- Route Studio's descent on point-to-point routes no longer copies the ascent; it now reflects where the route ends.
- Route Studio no longer fails with a raw "403" when the free routing service asks apps to slow down. CorosLink paces its requests to stay under the limit, and says how long to wait if it's reached.
- Records & PRs showed the 12-week records under **Half year** and the half-year records under **12 weeks**. COROS race predictions also never reached the page, so unset distances had nothing to aim for.
- Deleting a native data layer, such as weekly running distance, on a recovered or converted face now removes it from the watch too; it used to disappear only in Studio. Layers added back from **Add** stay in the Layers list when hidden again.
- Official faces opened in Studio now keep their year, such as the "2026" beside the date on MULTIDATA RUN. **Year** appears in the Date group of the Layers panel. Reopen the face from the catalog to get it back.
- The sidebar logo's spinning sync arrows take far less work to draw while CorosLink syncs.

## [0.1.52] - 2026-10-12

### Added

- **Connect your watch over Bluetooth.** The watch button in the toolbar is now a menu that finds and connects your COROS watch with this computer's own Bluetooth, no cable or adapter needed. CorosLink authenticates with the watch using the account key from your COROS sign-in in **Watch Faces**; if you were already signed in, sign in once more to save it. Signing out keeps the key, and **Connection details** in the watch menu has a button to remove it. Tested on PACE Pro firmware 3.2008.0; other watches are in beta.
- **Install watch faces over Bluetooth** (Mac). Studio's **Send to COROS** dialog adds **Send to watch** and **Save BIN**, and Watch Faces has a new **On watch** tab that shows the watch's face slots. Install into an empty slot or replace a face, from a final DAT/ZIP that CorosLink compiles itself or from a compiled BIN.
- **Sync saved routes to the watch** over Bluetooth from Maps → Routes. CorosLink checks that the watch stored the route.
- **Wireless maps** in Maps: pick map areas on a grid, check their size, and the watch downloads them over its own Wi-Fi.
- **Send a message** to the watch from the watch menu; it appears as a notification (Mac).
- **Unlock followed playlists** in Spotify reads playlists you follow but don't own. It signs in once more as the Spotify desktop app, which Spotify doesn't officially support for other apps and may block.

### Changed

- Spotify now needs only your Spotify app's Client ID, no Client secret. Sign in to Spotify once more after updating.
- Watchmaker in Codex CLI mode makes images with Codex's own image generation and your CLI sign-in, so it no longer needs CorosLink's ChatGPT sign-in.
- Faces can be converted for another watch while signed out of COROS, to install over Bluetooth. Publishing or sharing a face still needs one converted while signed in.
- The ChatGPT and Spotify sign-in windows can be closed if the sign-in page shows an error, and a Spotify redirect URI error now says which URI to add to your Spotify app.

### Fixed

- The Local / OpenAI-compatible API settings now save hosted https endpoints, including ones with their own path prefix, and trim pasted `/chat/completions` or `/models` suffixes. Coach also picks up settings saved while it was in the background instead of writing the old ones back.
- Faces converted to a larger watch keep crisp digits and artwork instead of looking faded.

### Security

- Updated dependencies with known vulnerabilities, including the MCP SDK that Watchmaker and Coach use.

## [0.1.51] - 2026-10-03

### Fixed

- Recovered official faces with month names (JAN, FEB, …) no longer show two overlapping months from October on, such as "JAN DEC". Exports now keep the official month-label position, and month images run January to December the way the watch reads them. This also applies to month-name sets made or imported in Studio. Open an already-recovered face again from the catalog to pick up the fix.

## [0.1.50] - 2026-10-02

### Added

- **Native COROS Plan destinations** — Coach's plan confirmation card can now bundle a generated plan into one grouped native COROS Plan Library entry, optionally activated straight onto the Calendar, instead of only writing individual library/calendar entries. All six native plan write endpoints (`add`, `update`, `copy`, `delete`, `executeSubPlan`, `quitSubPlan`) are live-verified; see [`docs/coros-plan-write-api.md`](docs/coros-plan-write-api.md). If putting the plan on the Calendar fails partway, CorosLink only removes the new Plan once it has confirmed nothing was left on your Calendar.
- **Audiobooks** tab. Import a book and CorosLink converts it into MP3 parts the watch can play, split every 1–180 minutes or at the book's chapters, and copies them to the watch in order. Preview a book's length and chapters before converting, and browse public-domain LibriVox recordings in the **Free classics** shelf.
- Copy and paste workouts on the Calendar: hold Option (Ctrl on Windows and Linux) while dragging, use the copy and paste buttons in a day's header or the right-click menu, or press ⌘C / ⌘V. Copy a single workout, a whole day or a multi-selection, from past or future days.
- **Activity backup** filters by sport, date range, distance and duration, with a live count of what will download.

### Changed

- COROS MCP servers now connect with the COROS account CorosLink already knows. Your email is filled in on COROS's sign-in page, and European and Chinese accounts use their regional server without adding it by hand ([#128](https://github.com/JunAkerBuilds/CorosLink/issues/128)).
- The local activity index panel shows indexed count, cache size and last sync at a glance, with the index controls on one row.
- Account region pickers in **Gear** and **Watch Faces** use the app's own dropdown, with keyboard navigation and typeahead.

### Fixed

- Turning off **Download automatically** for app updates now stops downloads, including one already in progress.
- Watch faces with current temperature or wind but no visible weather icon now export the weather condition images the watch expects. Recovered charts keep their original alignment and background.
- Training Library adherence rows no longer show a stray "—" when a completed activity has no duration.

## [0.1.49] - 2026-09-27

### Changed

- **Minimum** and **Maximum temperature** now show as one reading in Studio, the way the watch draws them: the minimum, a "/", the maximum and one unit. The maximum follows the minimum, and moving either moves both. Restyle, replace or hide the "/" with the new **Min/max separator** component on Minimum temperature.

### Fixed

- Min/max temperature no longer shows on the watch as one run-together number such as "1327°C". The export now draws a visible separator between them.
- **Send to COROS** no longer fails with "does not contain one of the requested images" for templates that reference images they don't include, such as AROUND-based faces. The send preview lists those images instead.

## [0.1.48] - 2026-09-27

### Added

- Add **Weekday**, **Date month** and **Date day** to any watch face from Studio's **Add** menu, including faces whose template has no date, such as converted official faces. Month and day reuse the face's own digits. The weekday is drawn with a font you can change. Studio places them next to the face's existing date or below the time, and **Remove** takes them off again.
- Pick the PACE 4 Jakob Ingebrigtsen Edition from the template watch presets to browse its face catalog.

### Changed

- The **Add** menu lists face components in the same order on every face.

### Fixed

- Seconds and other layers that Studio added now stay off the watch when you hide them. The exported face previously still showed them.

## [0.1.47] - 2026-09-26

### Added

- Add **analog hands** to any watch face from Studio's **Add** menu, including DIY templates without hands. Watchmaker AI can add them too.
- Restore template layers you deleted, such as the time, date, fixed metrics and indicators, from **Add**, which now has **Time** and **Device** categories.
- Add a GitHub Sponsors link.

### Changed

- Restyle the Watch Faces hub to match the Faces website. Community shows each design once, with its variants on their own page, and theme listings load from cache before refreshing.
- Refresh the Training Hub personal records and race predictor.
- The send preview for a converted official face now draws its live data.

### Fixed

- Replaced analog hands now rotate around their pivot instead of spinning in place.
- Min/max temperature, humidity and UV now show on the watch when their icon is hidden. The export adds the invisible icon and separator that official faces include.
- Converted official faces with an auto-aligned clock, such as SATISFY, keep their time and their light background.
- Chart styles switched off in an official face (bar or line width 0) stay off after export.

## [0.1.46] - 2026-09-25

### Added

- Add **Seconds** to a watch face whose template has none, from **Add → Live data**. Studio reuses the template's minute digits, starts them at half size below the time, and lets you restyle, move, or remove them like any Seconds layer.

### Fixed

- Export a custom font or sprite sheet chosen for Seconds on templates that only have a single seconds digit, such as animated faces. The exported face previously kept the template's original seconds frames.

## [0.1.45] - 2026-09-24

### Added

- Choose which watch system languages show your designed weekday from the new **Watch languages** option in Studio's Export panel.
- Connect the local-model chat provider to OpenAI-compatible servers elsewhere on your network (private IPs, `.local`/`.lan` names, Tailscale), not just localhost. Pick **Other server URL…** in Local model settings when detection has found a localhost server. ([#126](https://github.com/JunAkerBuilds/CorosLink/issues/126))

### Changed

- Redesign Coach settings as a wider, smoked-glass dialog with a section rail, grouped provider cards, toggle switches, and side-by-side fields.
- Refresh the Overview weather card icons and the dashboard widget resize preview.
- Refresh the README with new light and dark screenshots.

### Fixed

- Remove the automatic PACE 3 month/day position swap added in v0.1.41, which could counteract COROS date preferences. Rebuilding marked older exports restores their authored positions.

## [0.1.44] - 2026-09-24

### Fixed

- Restore community watch-face downloads in Studio by accepting signed release links hosted by the community catalog, fixing the “redirected to an untrusted host” error.

## [0.1.43] - 2026-09-23

### Added

- Let Watchmaker AI create supported native fields even when absent from the starting watch face, including a calendar year with native digit export and date-driven preview.
- Edit workout calendar events in CorosLink and sync their all-day or timed schedules to linked Google and Apple calendars.
- Add a collapsible calendar event editor with duration presets, a time-zone selector, and unsaved-change controls.

### Fixed

- Keep the native calendar year visible when the selectable metric is hidden and preserve its editor position during export and reopening.
- Correct standard COROS battery previews and artwork labels to use charging at index 0 and 0–100% at indices 1–11.
- Allow failed calendar syncs to be retried without changing the event's saved times.
- Recover month labels when official faces such as LIMA HALF MARATHON store their position without rectangle dimensions, and map their images to the correct calendar months in the editor.
- Recover uncompressed backgrounds and thumbnails from official watch faces such as FOCUS and ENTHUSIASM.

### Changed

- Update website links to coroslink.com and remove website analytics.

## [0.1.42] - 2026-09-23

### Fixed

- Structured workouts now use kilometers for land-distance targets above 1,000 m, preventing the reported COROS iOS truncation to 1,000 m. The same correction applies when editing workouts and calculating repeat-group targets. Addresses [#124](https://github.com/JunAkerBuilds/CorosLink/issues/124).
- Calendar workout details keep their full button hit areas clickable when overlapping the window title bar, fixing unresponsive spots in Ask Coach, Edit, Remove, and Close.

## [0.1.41] - 2026-09-23

### Added

- Watchmaker AI in Watch Face Studio, using the local Codex CLI with saved conversations, image tools, and checks against design requirements.
- Portable font snapshots and improved editor placement guides, previews, and component artwork controls.
- PACE 4 Pro (COROS W337) device recognition and watch-face support, with native 466×466 AMOLED previews, conversion, and Current/Always-on exports.

### Changed

- The community watch-face gallery loads more faces automatically as you scroll, preserves loaded cards and watch selections, and lets you retry failed requests.
- Missing-font messages show the font name in quotes so it is easier to identify.

### Fixed

- PACE 3 watch-face exports compensate for the observed English month/day position reversal so the installed date layout matches the editor. Reopening newly exported faces preserves the intended editor positions.
- Watchmaker AI conversation saving and cancellation handle overlapping requests without stale updates or duplicate conversations.

## [0.1.40] - 2026-09-22

### Added

- Configure a personal CARTO basemap API key in Settings, with setup documentation.

### Changed

- Improved responsive dashboard sizing and training activity layouts.
- Centralized account and map API settings for easier configuration.

### Fixed

- Watch Face Studio can export added Bluetooth and Do Not Disturb indicators when the original template does not define their icon or position settings.

## [0.1.39] - 2026-09-21

### Added

- Customize the Training Hub with draggable, resizable widgets, a searchable widget library, saved layouts, undo, and reset. Health metrics, trend charts, and zone distributions can be arranged individually.
- Coach can prepare COROS workout actions for review in chat, with saved action history, stale-data checks, and protection against duplicate writes.
- Review strength workout edits before saving changes to sets, reps, targets, weights, and rest in library workouts and future calendar copies. External local AI clients can prepare the same reviews through the new Strength workouts MCP connection in Settings.

### Changed

- Refreshed training activity browsing, activity details, health insights, and chart layouts to adapt to dashboard card sizes.

### Fixed

- Weather can use a city-level location fallback when device location is unavailable or times out, while respecting location permission denial.
- Improved MCP authorization handling, tool discovery, and cleanup when disconnecting a server.
- Watch Face Studio now fits the dial preview to the available space when preview controls wrap.
- Update announcements now use the version’s full changelog notes instead of GitHub’s autogenerated comparison link. Release publication requires a nonempty changelog entry.

## [0.1.38] - 2026-09-21

### Fixed

- Community watch-face cards and details now let you select a watch type and open the matching package in Studio. Changing the top Watch model filter resets card selections to that model, with individual overrides still available.

## [0.1.37] - 2026-09-20

### Added

- Coach can now draw charts on request with a new `render_chart` tool: up to six series bound to daily metrics (training load, HRV vs baseline, resting HR, sleep score and duration, RPE load, load ratio, stamina) over a 7–90 day window, or inline values for derived series, with shaded training blocks, summary tiles, dual axes, and a footnote. Charts render inline in the chat and persist in history.
- Pin any coach chart to the Training Hub. Metric-bound charts refresh with live data on open and on every hub refresh; a Refresh/Unpin control lives on each card.
- `get_fitness_trends` accepts a `days` window (7–90, default 7), includes sleep score and duration, and appends weekly averages for windows longer than two weeks.
- Local FIT analysis for the Coach: a dependency-free FIT decoder and a local activity index (SQLite + cached `.fit` files under the app data folder) back six new tools — `get_activity_splits`, `get_power_curve`, `get_best_efforts`, `find_similar_routes`, `compare_activities`, and `sync_activity_index`. Splits, aerobic decoupling, normalized power, power curves with an FTP estimate, best efforts inside any activity, GPS route fingerprints, and checkpoint-by-checkpoint comparisons are computed on this computer with no daily file limits; only derived numbers reach the model.
- Data page: a Local activity index panel to index the last 90 days, the last year, or the full history in the background, with progress, cancel, cache size, and last-sync time. The cache also appears under Settings storage locations.
- The Claude Code "Full activity files" permission is now live and gates the local FIT tools.
- Watch Face Studio can browse the artwork inside every official COROS face: an **Official** entry in the Add menu, an **Official COROS font** source in the Custom PNG font panel, and **Official** buttons next to template images and battery sprite folders open a library of digit fonts, battery states, weather glyphs, icons and backgrounds unpacked from the official catalog. The library is prebuilt and hosted: the app downloads a small per-model index and fetches previews and frames only as you browse and pick, caching them under the app data folder. When the hosted library is unreachable the app builds it locally from the catalog with your signed-in COROS account instead. Identical sets are deduplicated and every set is grouped by what the source face used it for.

### Changed

- Coach-requested charts are shown even when the "show charts and activity visuals" setting is off; that toggle now only hides automatic visuals.
- The Fitness trends chat card shows the actual window length instead of a fixed "Last 7 days".

### Fixed

- Opening the official DIGITAL face in Studio now recovers its hour, minute and seconds digits. The face stores its normal-mode clock fonts with bitmap encoding `0x3002` (same frames as `0x2002` plus a flag bit), which the decoder had skipped, leaving only the colon.
- Official-face recovery no longer drops an element just because its image block carries a header the scanner has not met: any block a layout pointer references is admitted once every frame decodes to its declared size, and elements that still cannot be decoded are counted in the "Opened an editable copy" message instead of vanishing. This also recovers TWILIGHT's Exercise icon (uncompressed RGB888) and the seconds hand on the MIP NOMAD faces.
- Automatic watch detection now recognizes APEX 4 volumes labeled `APEX 4 42MM` or `APEX 4 46MM`, accepts recognized new watches before their media folders exist, and preserves the watch's `Map` folder casing for installs.

## [0.1.36] - 2026-09-19

### Added

- Recover official COROS compiled watch faces into Watch Face Studio and export edited designs back to the watch. The decoder now handles 260px MIP and 416px AMOLED layouts, indexed, RGBA, and MIP bitmap frames, and more native fields including barometer, sunrise/sunset, sleep, and today's and this week's run, swim, and bike metrics.
- Added live sprite previews for template PNG sets, state folders, and raster-font glyphs, plus number alignment controls and a selectable-metric asset inspector.

### Changed

- Recovered official faces convert by baking the final scene for the destination watch, so they open cleanly as a fresh starter instead of carrying a non-native scene into an 800px master.
- Distributable watch-face packages are standardized to match the website validator, stripping recovery blobs and non-standard entries while preserving the editable asset tree.

### Fixed

- Preserved a starter archive's own weather and native-data sprites during recovery and conversion instead of replacing them with generated defaults.
- Kept template previews stable while editing a design, and hid selectable control-slot icons from the layer list where they are edited in the metric panel.

## [0.1.35] - 2026-09-16

### Added

- Customizable timed workout events for Google and Apple Calendar.
- Native watch-face weather, astronomy, health, and training fields with default assets, simulation controls, and MCP editing support.

### Changed

- Improved account setup navigation and the watch-face layer picker.

### Fixed

- Automatic watch-drive detection now requires a recognized volume label.
- Saved Routes now pages through 20 lightweight summaries at a time and loads geometry only for the selected preview, keeping large route libraries accessible without loading every track on each refresh.

## [0.1.34] - 2026-09-15

### Added

- **Copyable error reports** — Settings → Error logs now provides local error history, report previews, copy, refresh, and clear controls. Reports include app/system versions, timestamps, and underlying network errors to help diagnose failures such as COROS mobile sign-in. Common credentials and personal details are redacted before saving; logs are bounded to 200 errors, seven days, and 512 KB ([usage guide](docs/error-logs.md)).
- **Multi-select GPX import** — Route Studio's Import GPX dialog accepts multiple files in one selection; a bad file is reported without blocking the rest ([#116](https://github.com/JunAkerBuilds/CorosLink/pull/116)).

### Changed

- Refreshed Training Hub summary cards, activity tables, chart styling, and sleep presentation. Sleep-duration summaries preserve missing nights and compare complete seven-day periods.
- Consolidated Google and Apple Calendar connection controls in Settings and added clearer Sync now, Syncing, and Synced states in Calendar.

### Fixed

- Fixed iCloud calendar reads rejected with HTTP 412, skipped collection metadata safely, and retried concurrent event updates against the latest ETag while preserving unrelated events.
- Calendar sync status now tracks pending CorosLink schedule changes across views and app restarts.
- Watch-face AOD previews now use the watch's black background and apply export-compatible edge cleanup. Disabling AM/PM also clears stale references across resolutions.
- Improved watch-face click/drag handling and protected unsaved designs when opening community faces from website links. Same-document and subframe navigation no longer interrupts the handoff.
- Saved Routes now includes the full library after large GPX imports. Imports preserve long titles, remove incomplete saves, and show each failed file's reason alongside successful imports.

## [0.1.33] - 2026-09-13

### Added

- **Watch-face automation for external AI clients** — enable the local MCP connection in Settings → External AI to create and edit watch faces in the live Studio, import artwork and raster fonts, arrange layers, preview Current/AOD modes, validate, save, and export. Command batches support undo/redo and reject stale edits ([#117](https://github.com/JunAkerBuilds/CorosLink/pull/117)).
- **Compiled watch-face export preview** — inspect the generated archive at native resolution with Current/AOD and sample-value controls, plus clipping and overlap diagnostics before export or COROS transfer.

### Changed

- Refreshed the desktop interface, navigation, toolbars, activity globe, and Coach composer and suggestions, with updated CorosLink branding and app icons ([#115](https://github.com/JunAkerBuilds/CorosLink/pull/115), [#117](https://github.com/JunAkerBuilds/CorosLink/pull/117)).
- Improved training-plan library cards, sport badges, weekly load previews, filters, result counts, and comparison guidance.
- Refined Watch Face Studio editing, layout and alignment controls, raster-font height and baseline controls, and quick-start guidance.

### Fixed

- Preserved raster-glyph pixels when changing spacing, corrected exported text bounds, and included directly referenced numbered PNG icons in compiled previews.
- Removed Markdown formatting from Coach history snippets and corrected the update-control alignment in the collapsed sidebar.
- Clarified that activity backups cover activities synced to COROS Training Hub, and added COROS sync troubleshooting guidance on the Data page, including before sign-in. Recovering recordings stored only on the watch still requires the COROS phone app or support ([#107](https://github.com/JunAkerBuilds/CorosLink/issues/107)).

## [0.1.32] - 2026-09-05

### Fixed

- Fixed Watch Face Studio exports failing with “The watch-face archive contains too many files.” Increased the file allowance and removed unused generated sprites while preserving current and always-on display assets ([#112](https://github.com/JunAkerBuilds/CorosLink/issues/112)).
- Fixed ordinary watch-face DAT/ZIP imports incorrectly hitting the smaller editable-project package limit.
- Cleared stale Studio error messages on retry and successful exports, and prevented rejected builds from leaving invalid archive files behind.

## [0.1.31] - 2026-09-04

### Added

- **Custom Coach instructions** — save goals, training preferences, equipment, and tone across AI providers, and view the built-in Coach instructions in settings. Default tool, confirmation, and data-accuracy rules remain in effect.
- **Google and Apple Calendar sync** — sync scheduled COROS workouts to a selected Google or iCloud calendar, with automatic updates and connection controls in Calendar and Settings. Google requires OAuth app setup; iCloud requires an app-specific password.

### Fixed

- Improved COROS sign-in compatibility and account integration handling.
- Removing the built-in COROS MCP connection now clears its saved credentials, including legacy credentials.

## [0.1.29] - 2026-08-24

### Added

- **OpenRouter Coach provider** — use an encrypted, locally stored OpenRouter API key with model selection, tool-capable model discovery, connection testing, streaming responses, and COROS-aware Coach tools.

### Fixed

- Updated the bundled `yt-dlp` release to 2026.08.19, restoring YouTube and YouTube Music audio downloads affected by YouTube's `android_vr` HTTP 403 change.

## [0.1.28] - 2026-08-06

### Fixed

- Multi-workout Coach drafts now save as grouped, editable CorosLink training plans by default; saving their workouts individually to COROS or adding them directly to Calendar remains explicit ([#104](https://github.com/JunAkerBuilds/CorosLink/pull/104)).

## [0.1.27] - 2026-08-01

### Added

- **Standalone Coach workout drafts** — draft, review, edit, and save a single workout (not only multi-workout plans), with COROS exercise catalog search, token-aware matching, and stricter Strength/HYROX validation; draft sources persist and restore across chat history ([#103](https://github.com/JunAkerBuilds/CorosLink/pull/103))
- **Chat model selection** — pick provider/model for supported backends, with settings persisted across sessions ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102))
- **Remembered view preferences** — analytics ranges/metrics, tabs, filters, sorting, layouts, map layers, calendar mode, library views, and watch-face catalog filters survive navigation and restart ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102))

### Changed

- **Training dashboard insights** — richer trend charts, sleep summaries, chart colors/tooltips, empty states, and responsive layout; smoother activity-globe zoom ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102))
- **Coach and calendar navigation** — clearer plan/workout review, sidebar/history flow, draft cards, response controls, and editor layouts; broader workout upload destinations and strength/recovery editing ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102), [#103](https://github.com/JunAkerBuilds/CorosLink/pull/103))
- Select menus, map recents, and related chrome polish ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102))

### Fixed

- Generated-plan calendar installs now respect the selected metric/imperial unit system; existing linked workouts keep their saved units ([#102](https://github.com/JunAkerBuilds/CorosLink/pull/102))

## [0.1.26] - 2026-07-30

### Added

- **Media library storage and sync feedback** — the watch panel shows a capacity meter with how much of the watch's storage is in use, the connector between the two panels reports its own state (disconnected, syncing, pending, all synced) and animates while a transfer batch runs, and local tracks carry a compact synced/pending dot instead of a status badge
- **Workout tiles show their shape** — every workout in the Training Library draws its step structure as a comb sized by step duration, alongside a training-load meter relative to the heaviest workout in the library and how long ago the workout was last scheduled. Step structure is fetched only as tiles scroll into view, a few at a time, so browsing the library costs a handful of requests rather than one per workout
- **Gear management** (developer builds only) — read and add COROS activity gear (shoes and bikes) from the account, behind the Dev view toggle while the undocumented mobile endpoints are verified

### Changed

- **One sport identity across the Training Library** — all nine COROS sports get their own colour and icon, so swim, XC ski, the two climbing sports, and HYROX no longer share the generic "other" teal; plan cards and rows take an accent from their dominant sport and show their sport mix as dots. Sports covered by Settings → Activity colors still follow the customized colours
- **Consistent dropdowns throughout the app** — native `<select>` controls in the workout builder, plan editor, and strength step editor are replaced with the app's own dropdown, which renders in a portal so long menus are no longer clipped by the dialog around them, flips above the trigger when there is no room below, and supports type-ahead
- **Media library layout** — transfer actions moved next to the filters, bulk actions float over the track list as a dismissable bar rather than pushing the rows down, and the redundant "selected only" filter on the watch panel is gone
- **Strength attribution is honest about Full Body sets** — COROS records unstructured strength segments only as "Full Body", which names no specific muscle. Those sets are no longer spread across chest, lats, quads, and glutes as if they were measured; they are counted separately and explained on the page, and the muscle map stays neutral when nothing in the window can be attributed
- The ChatGPT account email is no longer displayed in the Coach header or settings panel

### Fixed

- The media library's sync indicator now reports "Syncing…" while a transfer is in flight instead of continuing to show the pending count

## [0.1.25] - 2026-07-30

### Added

- **Training Library** — a dedicated tab for reusable training: search, filter, sort, preview, create, edit, duplicate, tag, collect, export, schedule, and delete COROS Workout Library workouts; build grouped multi-week plans by dragging workouts across days and a holding area, with rest days, phases, recovery weeks, start-date shifting, and undo/redo; keep local templates and collections; and compare two or three plans by duration, distance, training load, strength sets, sport/intensity mix, weekly progression, peak week, taper, shared workouts, and scheduling conflicts. Native COROS plan discovery and detail reads are live and cached; native grouped-plan writes stay visibly gated until the undocumented contract can be verified (see [architecture notes](docs/training-library-architecture.md))
- **AI training plans** — describe a goal, length, weekly availability, sports, and constraints, and Coach drafts a complete plan straight into the library, ready to review, edit workout by workout, and schedule
- **Plan adherence** — scheduled workouts are paired with completed activities by confidence score, with manual correction, skipped/missed/partial states, rescheduling, and planned-versus-completed metrics
- **Hevy strength sync** — connect a Hevy API key from the Strength tab to merge Hevy workouts into your strength history; sessions logged in both apps are de-duplicated, warmup sets are optional, and disconnecting erases the cached Hevy data from this device
- **Exercise Explorer** — open any lift for its full history: every set, per-session PRs, best sets by rep range, estimated one-rep-max progression, and volume over time ([#91](https://github.com/JunAkerBuilds/CorosLink/pull/91))
- **Coach follow-up questions** — instead of guessing, Coach can ask one clarifying question with two to five tappable answers; a typed reply still works, and the question card survives a restart

### Changed

- **Multi-sport Coach plans** — Coach now uses the athlete's recent activity mix and complete schedule to create adaptive plans across all nine supported COROS workout sports instead of defaulting to running ([#90](https://github.com/JunAkerBuilds/CorosLink/pull/90))
- **Destination-aware plan confirmation** — before anything is uploaded, Coach's confirmation card shows the destination (Workout Library, Calendar, local template, COROS Plan Library, or plan plus calendar) along with the weeks, workouts, sports, start date, conflicts, and every remote write it will make; Coach's own tools can draft a plan but can never upload one
- **Strength view redesign** — reworked layout and charts, a refined muscle mannequin on roughly 30% smaller anatomy assets, and a weekly chart that plots sets alongside weight lifted ([#91](https://github.com/JunAkerBuilds/CorosLink/pull/91))
- **Workout builder and activity logging redesign** — restructured movement, prescription, load, and rest editing, exercise demonstration clips showing which muscles each movement trains, and a clearer manual activity form
- Strength volume reads in full words ("1.2 tonnes" rather than "1.2t")
- Activity queries above the COROS 100-per-page limit are now split across multiple requests and stitched back together
- A Donate button in the header, for anyone who wants to support the project

### Fixed

- Coach plan uploads now preserve each workout's sport and sport options instead of treating non-running workouts as Run
- Strength and HYROX plan drafts now resolve harmless exercise-name variants automatically and feed genuine COROS catalog ambiguities back to Coach for same-response correction before preview or upload
- The workout editor opened from a training plan is no longer cropped by the dialog around it

## [0.1.24] - 2026-07-28

### Added

- **Strength tab** — a dedicated view for resistance training, built around a rotatable 3D muscle mannequin that shades each muscle by how hard you have worked it, with per-muscle set/volume/time breakdowns, weekly volume trends, push/pull/legs/core balance, estimated one-rep-max progression, and recent session history ([#84](https://github.com/JunAkerBuilds/CorosLink/pull/84))
- **Imperial units** — a Metric/Imperial switch in Settings that converts distance, elevation, pace, and weight throughout the app ([#88](https://github.com/JunAkerBuilds/CorosLink/pull/88))
- **Full-sport workout intensity** — the workout builder now covers all nine COROS sports (Run, Trail Run, Bike, Pool Swim, Strength, Indoor Climb, Bouldering, XC Ski, and HYROX), each with its own step kinds, targets, and intensity presets ([#86](https://github.com/JunAkerBuilds/CorosLink/pull/86), [#87](https://github.com/JunAkerBuilds/CorosLink/pull/87))
- Scheduled workout detail view on the calendar, showing a workout's full step structure before it is sent to the watch
- Searchable exercise picker when building strength workouts
- Dev view can preview the Strength tab against a generated sample history, so the page can be worked on without a populated COROS account

### Changed

- **Watch Face Studio panels redesigned** — reworked Layers and Properties panels ([#82](https://github.com/JunAkerBuilds/CorosLink/pull/82))
- Workout builder polish — step previews and reordering, a faster quick-workout flow, and COROS exercise media in the exercise list

### Fixed

- Combined playlist retry and watch sync ([#81](https://github.com/JunAkerBuilds/CorosLink/pull/81))
- Sparse watch face templates could not add fixed metrics ([#83](https://github.com/JunAkerBuilds/CorosLink/pull/83))
- Watch face image imports no longer lose their native size
- Auto-update no longer leaves the downloaded installer in the updater cache after installing it, which duplicated roughly 100MB per release on Windows ([#33](https://github.com/JunAkerBuilds/CorosLink/issues/33))

## [0.1.23] - 2026-07-22

### Changed

- **Watch Face Studio creation flow** — clearer create/import UX and Studio UI polish ([#79](https://github.com/JunAkerBuilds/CorosLink/pull/79))
- **Watch Studio metrics and controls** — improved metric editing controls and related Studio UI ([#80](https://github.com/JunAkerBuilds/CorosLink/pull/80))

## [0.1.22] - 2026-07-22

### Added

- **Calendar workout drag and drop** — drag scheduled workouts between days on the Training Hub calendar
- **Cross-watch face conversion** — convert watch faces between supported COROS models in Watch Face Studio ([#77](https://github.com/JunAkerBuilds/CorosLink/pull/77))

### Fixed

- Combined playlist downloads now detect completed temporary MP3s reliably, preserve actionable download errors, and resume retries from cached tracks instead of downloading the whole playlist again ([#76](https://github.com/JunAkerBuilds/CorosLink/pull/76))
- Sleep window display parsing and formatting in Training Hub ([#78](https://github.com/JunAkerBuilds/CorosLink/pull/78))

## [0.1.21] - 2026-07-21

### Added

- **End-to-end COROS workout editing** — edit scheduled/library workouts in Training Hub ([#75](https://github.com/JunAkerBuilds/CorosLink/pull/75))
- **COROS two-factor login** — 2FA support for COROS sign-in
- **Native calorie/exercise progress arcs** — parse, edit, preview, and export kcal & exercise progress arcs/bars in Watch Face Studio ([#74](https://github.com/JunAkerBuilds/CorosLink/pull/74))
- **Coach load & open workout targets** — targetType load (6) and open/manual-end (1) ([#73](https://github.com/JunAkerBuilds/CorosLink/pull/73))
- **Combined downloads** — unified download flow plus Watch Studio improvements

### Changed

- Smoother Training Hub animations (heatmap / recovery / VO2 widgets)
- Progress-arc editing uses overlay rendering (no full recomposite on every edit)

### Fixed

- Coach-created run distance showing as Volume `--` on calendar ([#73](https://github.com/JunAkerBuilds/CorosLink/pull/73))
- Watchface progress-arc preview orientation (canvas vs COROS clock convention) ([#74](https://github.com/JunAkerBuilds/CorosLink/pull/74))

## [0.1.20] - 2026-07-20

### Added

- **Community watch face browsing** — Browse tab backed by the CorosLink Watchfaces catalog API, secure download/verify/import of reviewed packages, and `coroslink://watchfaces/<slug>` deep links ([#66](https://github.com/JunAkerBuilds/CorosLink/pull/66))
- **Proportional dimension resizing** — resize watchface layers while preserving aspect ratio in the Watch Face editor

### Changed

- Watchface Studio and app loading polish
- Standalone Bluetooth and Do Not Disturb status assets available even when a template omits them
- Release notes render supported HTML safely

### Fixed

- Watchface exports no longer leave blank Battery selector control declarations
- COROS sport-type mappings and mixed-unit activity timestamps

## [0.1.19] - 2026-07-19

### Added

- **Configurable MCP server registry** — add, edit, and connect multiple MCP servers for in-app Coach chat, with a Settings panel, per-server secret keys, built-in COROS seed, Freddy/Strava presets, and chat tools aggregated/routed across all connected servers ([#56](https://github.com/JunAkerBuilds/CorosLink/pull/56))
- **RPE Load Profile** — RPE (Foster session-RPE) load distribution shown in a dedicated Load Profile section of Training Hub ([#58](https://github.com/JunAkerBuilds/CorosLink/pull/58))
- **Watch Face editor groups, effects & transform tools** — group layers, apply effects, and use transform tools in the watchface editor ([#60](https://github.com/JunAkerBuilds/CorosLink/pull/60))
- **Watch Face stroke & inspector controls** — per-layer strokes, an inspector panel, and layer opacity ([#65](https://github.com/JunAkerBuilds/CorosLink/pull/65))
- **PACE 4 watchface exports & always-on editing** — full always-on (AOD) watchface editing, PACE 4 export support, month-label sprites, native-size date sprites, and template overrides ([#64](https://github.com/JunAkerBuilds/CorosLink/pull/64))
- **Retraced route sections** — highlight and label retraced sections in Route Studio ([#38](https://github.com/JunAkerBuilds/CorosLink/pull/38), [#63](https://github.com/JunAkerBuilds/CorosLink/pull/63))
- **Remember COROS credentials across services** — persist sign-in across connected services

### Changed

- Watch Face editor polish — redesigned panel headers and editor chrome, reorganized artwork layers (background first), authored layer controls, and removal of the watchface scale limit ([#61](https://github.com/JunAkerBuilds/CorosLink/pull/61))
- Route Studio interface refinements
- README updated with the new domain and documentation link ([#54](https://github.com/JunAkerBuilds/CorosLink/pull/54))

### Fixed

- Always-on (AOD) outlines are now watch-safe
- Watchface font spacing, text bounds, font resets, and sprite bounds/imports/scaling
- Background no longer shifts during layer drag; selector drag layering
- Watchface panels render correctly in light mode
- PACE 4 firmware profile and export finalization
- Route waypoint layering ([#37](https://github.com/JunAkerBuilds/CorosLink/pull/37))
- MCP registry lifecycle/settings hardening; reconnect all authorized MCP servers (not just COROS) on startup
- A bad dock icon no longer aborts app startup

## [0.1.18] - 2026-07-15

### Added

- **RPE (Foster session-RPE) load** — Training Hub heatmap TL/RPE toggle, RPE trend chart, and rate-limited backfill with live progress ([#55](https://github.com/JunAkerBuilds/CorosLink/pull/55))
- **Per-sport activity colors** — color the load heatmap and calendar by sport (multi-sport pie days); customizable sport colors in settings ([#48](https://github.com/JunAkerBuilds/CorosLink/pull/48))
- **Training map globe** — overhauled activity globe with refined visualization, geography worker, and persisted geo cache ([#47](https://github.com/JunAkerBuilds/CorosLink/pull/47))
- **Watch Face Studio** — export/import editable projects; sprite resize/rotate; battery scaling and seconds time customization; auto-aligned watchface time; scoped asset editing ([#51](https://github.com/JunAkerBuilds/CorosLink/pull/51), [#52](https://github.com/JunAkerBuilds/CorosLink/pull/52))
- **Update changelog prompt** — one-time update window with release notes, explicit update confirmation, and per-version dismissal when choosing **Not now**; covers every newer release when updating across versions ([#50](https://github.com/JunAkerBuilds/CorosLink/pull/50))
- **Animated supporter plaques** on the marketing website hero ([#53](https://github.com/JunAkerBuilds/CorosLink/pull/53))
- Development-only **Test update** control for previewing the update prompt without downloading or restarting

### Changed

- Watch Face Studio editing polish (AM/PM preview, device-targeted exports, MIP always-on guidance)
- Supporter plaque styling (gold glow and name fitting) on the website

### Fixed

- Watch Face Studio firmware type is taken from the connected watch instead of a hardcoded value, so template browse and exports target the correct device ([#51](https://github.com/JunAkerBuilds/CorosLink/pull/51))
- Load-heatmap streak no longer resets to 0 on an untrained today ([#49](https://github.com/JunAkerBuilds/CorosLink/pull/49))
- Choosing **Not now** no longer allows a downloaded update to install silently when CorosLink quits

## [0.1.17] - 2026-07-13

### Added

- **Watch Faces hub** — create and publish custom COROS watchfaces from desktop (theme browser, digit/theme studio, persistent projects, official template catalog) ([#46](https://github.com/JunAkerBuilds/CorosLink/pull/46))
- **Watchface editor (beta)** — Figma-style 3-pane layer editor with background canvas, local fonts, sprite tinting, weather/temperature controls, and AM/PM customization
- **Battery history & device info** — Bluetooth battery history and device details in the Watch Faces area
- **Legacy 614A carrier editor** and **raw watchface installer** for advanced/legacy workflows
- **Strength activity detail** — summary and exercise table with resolved exercise names in Training Hub ([#44](https://github.com/JunAkerBuilds/CorosLink/pull/44))
- **Claude Code chat provider** — use Claude Code for Coach, with model selection and extended thinking ([#43](https://github.com/JunAkerBuilds/CorosLink/pull/43))
- **Apple Podcasts** — search the public catalogue or paste a show link; progressive RSS episode loading and MP3 downloads ([#42](https://github.com/JunAkerBuilds/CorosLink/pull/42))
- **Visit heatmap globe** — activity visit density on the Overview globe with street-level heatmap drill-down

### Changed

- Watch face hub and studio UI redesign; improved color management and mobile sign-in flow for watchface publish
- OAuth connection hardening (single-flight guard) used by media provider logins

### Fixed

- Watchface mobile login for EU/CN accounts via region selector ([#45](https://github.com/JunAkerBuilds/CorosLink/pull/45))
- Personal record type mappings and display order
- Selector icon export origin rebase for non-negative coordinates

## [0.1.16] - 2026-07-10

### Added

- **Push activities to COROS** — import from intervals.icu and add manual activities from Training Hub ([#36](https://github.com/JunAkerBuilds/CorosLink/pull/36))
- **Settings view** — app version, runtime info, update controls, and quick links to docs, issues, and support
- **Data page** — dedicated page for data/import tools (moved out of Training Hub)
- **Apex and Pace 2** watch model support on the dashboard
- **Personal records** — 15K, 10K, 3 Mile, and 5 Mile distance types
- **COROS sport type resolution** — richer activity type labels from COROS data
- **Spotify OAuth setup** — redesigned connection UI with step-by-step guide
- **Route Studio** — use device geolocation as the route start point
- **Download deduplication** — skip items already present in the media library
- **macOS code signing and notarization** — signed, notarized DMG builds in CI (enables reliable in-app auto-update on macOS)

### Changed

- Website SEO and download page improvements
- Training Hub layout polish after moving data tools to the Data page

### Fixed

- High idle CPU usage from repaint-heavy animations and background polling
- YouTube webview polling while the tab is hidden
- COROS MCP OAuth token binding URL (`mcp.coros.com` → `mcpus.coros.com`)
- Personal record display — only show supported distance types; legacy payload compatibility
- COROS activity upload reliability — STS credential handling, duration matching, TCX extensions, duplicate re-import prevention

## [0.1.15] - 2026-07-07

### Added

- **Training Calendar** — new Calendar tab with month/week views; scheduled workouts and completed activities on the same grid; drag-and-drop to reschedule future workouts; add/delete workouts; week stats; **Ask Coach** handoff from a day or week
- **Sleep summary in Training Hub** — nightly sleep score, duration, and stage breakdown (deep/light/REM/awake) from COROS MCP data
- **Daily health metrics** — steps and calories tiles in Training Hub summary, sourced from COROS daily health data
- **Startup default view** — choose which tab opens on launch (Overview, Media, Maps, Training Hub, Calendar, or Coach) from the header settings menu

### Changed

- Tighter app layout spacing across primary views
- Updated Training Hub screenshot in docs

### Fixed

- COROS sleep data parsing — correct stage percentages and durations from MCP responses ([#28](https://github.com/JunAkerBuilds/CorosLink/pull/28))
- Sleep stage bar contrast in light (Paper) theme
- Route Studio location search — geocoding/search reliability in the route builder

## [0.1.14] - 2026-07-06

### Added

- **Paper light theme** — switch between dark and light UI from the header; window chrome and fullscreen layout follow the active theme
- **Floating glass sidebar** — replaces header tabs with a collapsible sidebar for primary navigation
- **Route Studio overhaul** — keyless routing, custom draw tool, Explore map layer, route sketch mode, and GPX import
- **Bulk activity backup** — export multiple Training Hub activities at once
- **Media library avatars** — playlist and source artwork in the media library
- **Coach chat UI** — history sidebar, settings modal, and rich response cards
- **Updates menu** — labeled **Updates** button in the header with check, download, and install actions plus auto-check/auto-download preferences (visible in dev builds too)
- Hero artwork for **Vertix 2** and **Vertix 2S** on the dashboard when connected
- Live GitHub stars and an expanded Buy Me a Coffee section on the marketing website

### Changed

- Route line styling so routes stand out on every base map
- Provider switcher with animated indicator and icons
- Apple Music playlist list now shows track counts

### Fixed

- Vertix 2, Vertix 2S, and Apex 2 Pro no longer misidentified as Pace Pro when connected over USB
- COROS Training Hub re-auth race; added a **Reconnect** action when the session expires

## [0.1.13] - 2026-07-03

### Added

- **Training coach chatbot** — ask training questions in a new Coach tab with streaming answers grounded in your COROS data (recent activities, dashboard metrics, upcoming workouts)
- **ChatGPT sign-in** — connect with your OpenAI account for cloud coaching; supports tool use against COROS Training Hub data via MCP
- **Local LLM support** — run coaching offline with Ollama or LM Studio (auto-detect, connection test, optional tool use)
- **Workout plan tools** — the coach can draft multi-day training plans, preview them in chat, upload to COROS, list scheduled workouts, and delete workouts with confirmation cards
- **Chat history** — per-provider conversation persistence across app restarts
- **In-app Apple Music sign-in** — automatic amp-api header capture replaces manual DevTools paste
- **In-app YouTube Music sign-in** — automatic header capture for playlist and liked-song sync
- **Resources menu** — quick links to docs, community, and support from the header
- Improved **Training Hub activity exports** — FIT download from the activity table and latest-activity export from chat

### Changed

- Redesigned marketing website with Tailwind v4 and refactored components

### Removed

- GitHub Pages website build and deployment (site is hosted on Vercel; removed `.nojekyll` and disabled the Pages site on the repository)

### Fixed

- macOS DMG installer window restores the drag-to-Applications layout on recent macOS releases by shipping a custom PNG background instead of the default electron-builder TIFF

## [0.1.12] - 2026-07-02

### Added

- **Remember COROS credentials** — an opt-in "Remember me" toggle on the Training Hub login stores your credentials with OS-native encryption (Keychain / DPAPI / libsecret) so CorosLink signs back in automatically when the COROS session token expires, instead of prompting for email and password again (#4)
- **Update preferences** — a settings menu next to the version chip to toggle automatic update checks and automatic downloads. With auto-download off, CorosLink surfaces a **Download** button so you choose when to fetch an available update (#2)

### Fixed

- Training Hub load heatmap tooltip no longer truncated by the scroll container; it now renders fully above the top-row cells (#1)

## [0.1.11] - 2026-06-30

### Added

- **YouTube Playlists** — connect with Google OAuth credentials, browse your playlists, and queue tracks for download
- **YouTube Music** — sync playlists and liked songs by pasting DevTools headers (requires Python 3 + ytmusicapi)
- **Apple Music** — browse library playlists via pasted amp-api headers; tracks resolve to YouTube for download
- **Connect helper images** — visual DevTools guides for YouTube Music and Apple Music header setup
- Shared **SelectDropdown** component for consistent media UI pickers

### Fixed

- Windows auto-update artifacts aligned with release verification in CI

## [0.1.10] - 2026-06-29

### Added

- **Maps (BETA)** — browse official COROS v5 map regions, download/cache packages locally, and install to the watch over USB with live copy progress
- **Route builder** — generate loop or point-to-point GPX routes via OpenRouteService with interactive map preview, route stats, GPX export, and **Share to phone** (QR + local HTTP hand-off)
- **Batch map transfer** — select multiple cached maps and install them in one job with a single continuous progress bar
- **Cancel map transfer** — stop an in-progress watch map install; files already copied remain on the watch
- **Activity pace baselines** from stored Training Hub activities for route time estimates
- Local persistence of Training Hub activities in SQLite for offline analytics
- Weekly activity aggregation and expanded daily metrics parsing for Training Hub charts

### Changed

- README and overview copy now describe CorosLink as a COROS watch companion (not Pace Pro–only) with Maps and Route builder screenshots
- Training Hub fitness trend, heatmap, and scores panel polish

## [0.1.9] - 2026-06-28

### Changed

- Personal Records panel always shows elevation gain, half marathon, and marathon slots (with "Not recorded" when empty)
- Removed Best Pace, 1 Mile, and 2 Mile from Personal Records

### Fixed

- 5K personal record time now matches COROS Training Hub by preferring API type 5 and the validated `duration` field instead of partial type 10 segments

## [0.1.8] - 2026-06-28

### Added

- In-app auto-updates via `electron-updater` (GitHub Releases)
- `scripts/verify-release-artifacts.mjs` to fail CI when update metadata is missing
- Training Hub **activity detail** split layout with inline route map, elevation chart, and GPS track fallback from GPX
- Training **heatmap** panel for activity frequency
- Richer parsing for personal records, race predictor, and upcoming workouts

### Changed

- Training Hub activity list and detail panels share a split view for faster browsing
- yt-dlp sync reuses already-downloaded files instead of re-downloading

### Fixed

- macOS CI now builds **DMG + ZIP** so `latest-mac.yml` is generated for auto-update

## [0.1.7] - 2026-06-27

### Added

- Linux x64 **AppImage** builds in CI and GitHub Releases
- Website download button for Linux

## [0.1.6] - 2026-06-27

### Added

- Split **Local library** and **Watch library** panels with a sync layout showing pending transfers at a glance
- Bulk select, transfer, and delete for local downloads and watch tracks
- Training Hub **zone distribution charts** for heart-rate and pace zones (training load, distance, and time)
- **VO₂ max widget** with banded gauge and recent trend readings
- Watch **connection smoke options** for development and testing without a physical watch (Pace Pro, Pace 4, Pace 3, Nomad, and other fixtures)
- GitHub Sponsors metadata and Buy Me a Coffee buttons on the README and website

### Changed

- Refreshed Training Hub layout and styling across fitness scores, trends, recovery ring, and summary tiles
- Updated Nomad hero artwork and training hub screenshot

## [0.1.5] - 2026-06-27

### Added

- Training Hub dashboard panels (fitness scores, race predictor, personal records, upcoming workouts)
- Expanded watch model support (Pace 4, Pace 3, Nomad) with model-specific presentation
- Download progress tracking for YouTube and Spotify sync jobs

### Changed

- Media library overhaul with unified local and watch track management
- Website updates and Vercel/Next.js build fixes

## [0.1.4] - 2026-06-27

### Fixed

- Training Hub activity file downloads

### Changed

- Unified media library with watch track listing
- Disabled YouTube hover previews in the embedded browser
- Migrated project website to Vercel/Next.js

## [0.1.3] - 2026-06-26

### Changed

- Aligned release version in `package.json` with git tags

## [0.1.1] - 2026-06-26

### Added

- GitHub Actions release workflow and installer build documentation

[0.1.28]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.26...v0.1.27
[0.1.23]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/JunAkerBuilds/CorosLink/compare/v0.1.1...v0.1.3
[0.1.1]: https://github.com/JunAkerBuilds/CorosLink/releases/tag/v0.1.1
