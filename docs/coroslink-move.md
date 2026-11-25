# Moving in from CorosLink

What the old CorosLink desktop app keeps on a person's computer, and what C-LINK desktop does with each piece on
first launch (the Move screen, `desktop/main/coroslink/move.ts`).

The rule: **what COROS (or Hevy, Strava, Google…) gives back once C-LINK is signed in is not copied**; C-LINK
fetches it again. Everything that exists only on this computer comes over, so nobody pairs the watch again, signs
in again or loses their own work. CorosLink's folder is only read (its database through a private copy,
`snapshot.ts`), never changed.

Where C-LINK has no place for something yet, it is **kept**: copied as CorosLink had it into `<C-LINK data>/coroslink/`
(`kept.json` and copies of CorosLink's folders), so it survives CorosLink being removed and a later C-LINK feature can
read it. Secrets are never kept there.

## Where CorosLink keeps things

- `<userData>` = `~/Library/Application Support/CorosLink` (Windows `%APPDATA%\CorosLink`, Linux `~/.config/CorosLink`;
  `coroslink` in development). Detection: `detect.ts`.
- One SQLite database, `coroslink.sqlite` (WAL; once `coros-desktop.sqlite`), 41 tables: 21 in
  `electron/database.ts`, 2 remote-access tables, 13 `local_*` tables (`electron/localSync/localDataSchema.ts`),
  6 made on first use (`raceStore.ts`, `workoutJournalStore.ts`, `athleteMemoryStore.ts`).
- Settings: the `app_settings` table, about 150 keys. Secrets are `base64(safeStorage.encryptStringAsync(…))`
  (no prefix; MCP `clientInfo` adds `encrypted:`; intervals.icu falls back to plain text without a keychain).
  Some secrets are plain text: `trainingHub.accessToken`, Spotify tokens, YouTube Music client secret,
  Apple Music credentials, the OpenRouteService key.
- The page's `localStorage` (Chromium LevelDB in `<userData>/Local Storage`): language, units, theme, hidden nav,
  startup view, dashboard layout, about 50 remembered selections.
- Folders in `<userData>` (below).

## Locked secrets

CorosLink sealed with Electron `safeStorage` under its own name. C-LINK ships as the CorosLink update (same app id
`app.coroslink`, same signing team), so it can open them (`oldKeychain.ts`) and seal them again with its own keychain
(`secrets.ts`):

| System | CorosLink's key | Value format |
|---|---|---|
| macOS | keychain item "CorosLink Safe Storage" / account "CorosLink Key" | `v10` + AES-128-CBC, IV 16 spaces, key PBKDF2-SHA1(password, `saltysalt`, 1003, 16) |
| Windows | `<userData>/Local State` `os_crypt.encrypted_key`: `DPAPI` + the key sealed with the user's DPAPI | `v10` + nonce(12) + AES-256-GCM + tag(16) |
| Linux | `v10`: the fixed password `peanuts`; `v11`: libsecret's password for `corosLink` | as macOS, 1 round |

### No prompt in the shipped app

A shipped Mac build of C-LINK **seals with CorosLink's own keychain item** (`secrets.ts keychainName`). Electron
names its item "<app name> Safe Storage" from the app's name before `ready`, so `main.ts` sets the name to
"CorosLink" then, after pinning `userData` (C-LINK's data folder doesn't move), and shows "C-LINK" again once ready.
(Checked on Electron 45: the item is fixed before `ready`; renaming after it doesn't change it; both the async and
sync APIs use it.) The move then opens CorosLink's values with C-LINK's own `safeStorage`, in this process: macOS
lets the same signed app (same app id and team, like any update) read its item without asking. The shipped app never
runs `security` on a Mac and never asks for the development item below.

C-LINK's own sealed files (`watch/key.bin`, `ai-secrets.bin`, `cookies.bin`, `secret.bin`, `studio/coros-account.bin`,
`media/services.bin`, `maps/routes/ors-key.bin`, Studio's automation token) carry over: when a value doesn't open
with the current item, the keychain sealer opens it with the other one ("C-LINK" in a shipped build, "CorosLink" in a
development one) and reports it stale, so it is sealed again under the current item. Only a computer that ran a
shipped C-LINK from before this change (or a development build sharing the folder) has such values; nobody else has a
"C-LINK Safe Storage" item, and an item that isn't there is never prompted for.

Windows (DPAPI, per user) and Linux (the session's keyring) don't prompt.

**Still to check with a signed build** (same bundle id `app.coroslink`, same team as CorosLink): that the move opens
CorosLink's values with no prompt, and that a signed C-LINK reading "CorosLink Safe Storage" made by CorosLink isn't
asked to confirm. A development build is not signed as CorosLink, so it can't show this.

### Development builds

A development C-LINK keeps "C-LINK Safe Storage" and asks the system (`security`) for CorosLink's password; that
shows the allow prompt, which is fine there. A CorosLink run in development goes by "coroslink" ("coroslink Safe
Storage" / "coroslink Key") and, on a case-insensitive disk, shares the packaged app's data folder, so values may be
sealed under either name: development builds try both, the packaged one first, each asked for only when the ones
before it don't open a value. A result counts only when it is valid UTF-8 (a wrong CBC key now and then passes the
padding check).

The keychain is asked once per name, the first time a sealed value needs it (when the copy runs, not when the screen
shows). An opened value goes straight into C-LINK's sealed store; nothing opened is logged or written elsewhere. If
the keychain says no, the tile asks the athlete to pair or sign in again.

## Every item and its decision

**Ported** = written the way C-LINK keeps it. **Kept** = copied into `<C-LINK data>/coroslink/` (no place in C-LINK
yet). **COROS** / **Service** = fetched again, not copied. **Later** = has no place and isn't kept (a secret, or
something to set up again).

### Watch

| What | Where in CorosLink | Gives back? | Decision → C-LINK |
|---|---|---|---|
| Watch key (the COROS account's RSA key the watch trusts) | `coros.ble.loginAuth` (sealed `CorosBleLoginKey`); older `coros.ble.accountAuth` | Only by a COROS mobile sign-in | **Ported** → `watch/key.bin` sealed with C-LINK's keychain, as `WatchAccountKey` text (`map.ts watchKeyText`, account ID kept exact past 2^53), via `LocalWatch.adopt` |
| Remembered watch | `coros.ble.watchIdentity` (pinned identity per backend), `coros.ble.systemDevice`, `local_devices` | No | **Ported** → `watch/pairing.json` `paired` by advertised name (C-LINK connects by name; no device ID or serial is stored) |
| Account the key came from | `CorosBleLoginKey.accountEmail` | — | **Ported** masked (`ru•••@example.com`) → `pairing.json` `account` |
| Weather place | `watch.weatherLocation` | No | **Ported** → `pairing.json` `weather` |
| Auto-sync | `watch.autoSync` | No | **Ported** → `autoSyncHours` (when it's one C-LINK offers) |
| Local-Only Mode | `privacy/data-mode.json` | No | **Ported** → C-LINK's Local mode on (`settings.ts enterLocalMode`) |
| Key check log | `coros.ble.watchKeyCheck` | — | Not needed (no key material; C-LINK keeps its own) |
| USB adapter bond | `coros.ble.bond` (sealed), `coros.ble.stateDirectory`, `coros.ble.backend` | No | **Later**: C-LINK has no USB adapter link |
| Wi-Fi music profile and restore journal | `coros.ble.wifiMusic.*` (sealed) | No | **Later**: no Wi-Fi music in C-LINK. A pending restore should be finished in CorosLink first |
| Watch settings read / training profile | `watch.systemSwitches`, `watch.trainingProfile` | From the watch | Not copied: read from the watch again |
| Calendar sent to the watch | `watch.sentCalendar`, `watch.planReplacement` | — | Not copied (C-LINK keeps its own) |
| Activity-screen backups | `activity-screen-backups/` (developer) | — | Not copied |
| `.coroswatchkey` backups | wherever the athlete saved them | — | Not needed: the key comes over itself |

### Activities and health

| What | Where | Gives back? | Decision |
|---|---|---|---|
| COROS activity list | `training_activities` | COROS | **Ported** anyway as `activity` items (it's what the screens show before the first sync; the same ids COROS uses, so nothing doubles) |
| Workouts read from the watch, FIT imports | `local_activity_files` + `local-archive/fit/…` | **No** | **Ported** → `activity` items (watch id `coros-<start>-<type>`, as Local mode writes it), FIT files → `watch/fit/<id>.fit`. TODO: laps and streams (`activity.detail`) need a FIT reader here; until then they arrive with the next watch sync |
| Original watch reads and imports | `local-archive/` (content-addressed), `local_sync_payloads` | **No** | **Kept**: the whole folder (not `partial/`), and the file list in `kept.json` `activityFiles` |
| Sync bookkeeping | `local_sync_runs`, `local_sync_checkpoints`, `local_activity_training` | — | Not needed (derived) |
| Daily health | `local_health_summaries`, `local_sleep_sessions` | **No** | **Ported** → `health.day`, `health.night` |
| Readings through the day, checks, recovery, sleep stages | `local_health_samples`, `local_health_checks`, `local_workout_recovery`, `local_sleep_sessions.ranges` | **No** | **Kept** (`healthSamples`, `healthChecks`, `workoutRecovery`, `sleepRanges`): C-LINK keeps daily figures only |
| COROS FIT files | `fit-cache/`, `fit_index`, `fitIndex.lastSyncAt` | COROS | COROS |
| Activity notes and feel | `training_activities.note`, `feel_type` | COROS | COROS |
| Strength breakdowns | `strength_sessions` | COROS | COROS |
| Race routes | `race_routes` | COROS | COROS |
| Strava activities | `strava_activities`, `strava_race_activities` | Strava | Service |
| Hevy workouts and templates | `hevy_workouts`, `hevy_exercise_templates`, `hevy.*` cursors | Hevy | Service (the Hevy key comes over, below) |
| Gear | not stored: COROS mobile API | COROS | COROS |

### Plans, workouts, races

| What | Where | Gives back? | Decision |
|---|---|---|---|
| The athlete's own plans (`local`, `template`, Coach-made) | `training_plans` where `source != 'coros'` | **No** | **Ported** → `training.plan` items (`plans.ts planDocs`). Workouts carrying a COROS program are built into the builder's document; one that points at a COROS library workout keeps its `programId`. Calendar installs keep their COROS entries (`ref` = idInPlan) so "Remove from calendar" still works |
| COROS's plans | `training_plans` `source = 'coros'`, `raw_remote_json` | COROS | COROS (their local tags and notes aren't carried) |
| Local-Only library and calendar | `local_training_programs`, `local_training_schedule` (COROS program JSON) | **No** | **Ported** → `training.library` and `training.workout` items, ids `coroslink-<id>` / `coroslink-day-<idInPlan>` (the library keeps one workout per name) |
| Library workouts (connected) | on COROS; `training_workout_metadata.cached_payload_json` | COROS | COROS |
| Favourites, tags, folders | `training_workout_metadata` (favourite, tags, collection), `training_collections` | No | **Kept** (`workoutTags`, `collections`): C-LINK's library has neither yet |
| Matches the athlete set | `training_activity_matches` where `manual = 1` | No | **Kept** (`manualMatches`); the rest is derived |
| Coach plan drafts, pending approvals | `chat_plan_drafts`, `chat.deleteRequests`, `chat.coachReviews`, `chat.corosActions`, `workouts.reviewedEdits.v1` | — | Not copied: transient (24 h) |
| Race goals | `race_targets` (with `details_json`) | **No** | **Kept** (`raceTargets`): C-LINK's goal races are the phone's (`view.training`) |
| Race results | `race_entries` | **No** | **Kept** (`raceEntries`) |

### Coach

| What | Where | Gives back? | Decision |
|---|---|---|---|
| Conversations | `chat_sessions` (`messages_json`) | No | **Ported** → `coach.conversation`, `coach.message` (text; CorosLink's cards are its own screens' and aren't carried) |
| Replay events | `chat_session_events` | — | Not needed |
| What Coach remembers | `athlete_memory` | No | **Ported** → `coach.memory` |
| Workout journal: briefs | `workout_journal.brief_json` | No | **Ported** → `coach.brief` (goal, cues, fuel, day) |
| Workout journal: debriefs | `workout_journal.debrief_json` | No | **Kept** (`workoutJournal`, all of it). Not `feel.check`: that's the morning check, not a workout's feel |
| Custom instructions | `chat.customInstructions` | No | **Kept** (`coachInstructions`): C-LINK has no such setting yet |
| Pinned charts | `coach.pinnedCharts` | No | **Kept** (`pinnedCharts`) |
| Attachments | `coach-attachments/` | No | **Kept** (folder) |
| CLI workspaces | `claude-coach/`, `gemini-coach/`, `opencode-coach/`, `antigravity/` | — | Not copied (working folders; C-LINK makes its own) |

### Coach's AI, MCP, settings

| What | Where | Gives back? | Decision |
|---|---|---|---|
| AI pick, each provider's model and effort, local server URL | `chat.provider`, `chat.<provider>.model`/`.effort`, `chat.local.baseUrl` | No | **Ported** → `ai.json` (only providers C-LINK has; only what isn't set here) |
| OpenRouter key, local server key | `chat.openRouter.apiKey`, `chat.local.apiKey` (sealed) | No | **Ported** → the AI vault (`ai-secrets.bin`) |
| ChatGPT sign-in | `chat.oauthToken` (sealed) | By signing in | **Ported** → the vault's `chatgpt`, in C-LINK's token shape |
| Claude Code / Gemini / OpenCode / Antigravity | their own CLI sign-ins, outside CorosLink | — | Nothing to copy (paths in `chat.*.executablePath` are found again) |
| Claude Code's data permissions | `chat.claudeCode.permissions.*` | No | **Kept** (`settings`) |
| MCP servers | `mcp_servers` | No | **Ported** → `mcp.json` (`McpStore.add`), with tokens: OAuth (`corosMcp.*` / `mcp.<id>.tokens`, `.clientInfo`) → `setOAuth`, bearer (`mcp.<id>.bearer`) → the vault |
| OpenRouteService key | `maps.openRouteServiceApiKey` (plain) | No | **Ported** → `maps/routes/ors-key.bin` (`adoptOrsKey`); the routing engine stays as picked |
| CARTO key | `maps.cartoApiKeyEncrypted` | No | **Later**: C-LINK doesn't use CARTO |
| Language, units | `app.language`, `coach.unitSystem`; the page's `coroslink.language`, `coroslink.unitSystem` | No | **Kept** (`settings`): C-LINK has no language or units setting yet |
| Theme, hidden nav, startup view, sidebar, dashboard layout, sport colours, remembered selections | the page's `localStorage` | No | **Later**: different pages and names in C-LINK; reading Chromium's LevelDB isn't worth it for these |
| Updates | `updater.*`, `coroslink.updatePrompt.dismissedVersion` | — | Not copied (C-LINK's own updater) |
| Onboarding | `onboarding.status` | — | Not copied (the Move screen is C-LINK's onboarding) |
| Automation endpoints | `watchfaces.externalAi`, `workouts.externalAi`, `watchface-automation/`, `workout-automation/` | — | Not copied (C-LINK's Studio has its own) |
| Diagnostics | `diagnostics/`, `coros-weather-probe*.json` | — | Not copied |

### Accounts

| What | Where | Gives back? | Decision |
|---|---|---|---|
| COROS Training Hub session | `trainingHub.accessToken`, `.userId`, `.regionId`, `.baseUrl` (plain) | By signing in | **Ported** → the shared session item `hub.session`/`me` (`src/server/hub/shared.ts`). An expired one asks for a sign-in, as CorosLink would |
| COROS remembered login | `coros.credentials` (sealed: email + password MD5) | — | **Ported** → Studio's COROS account `saved` (it signs in again with it), and its email to the Hub session |
| COROS mobile session (faces) | `watchfaces.mobileSession` (sealed) | By signing in | **Ported** → Studio's COROS account `session` (`CorosAccount.adopt`) |
| Hevy | `hevy.apiKey` (sealed), `hevy.identity` | — | **Ported** → `connection`/`hevy`; identity is asked again |
| intervals.icu | `intervals.apiKey` (sealed or plain), `intervals.athleteId` | — | **Ported** → `connection`/`intervals` |
| Strava | `strava.clientId`, `strava.secureState` (sealed) | — | **Later**: no Strava in C-LINK yet. Connect again then |
| Google Calendar, iCloud | `googleCalendar.secureState`, `appleCalendar.secureState` (sealed) | — | **Later**: no calendar sync in C-LINK yet |
| Spotify | `spotify.clientId` | — | **Ported** → Media's services settings. Tokens (plain, a different grant): sign in again |
| YouTube / YouTube Music / Apple Music | `youtubeData.*`, `youtubeMusic.*`, `ytmusicapi-browser.json`, `appleMusic.credentialsJson`, webview partitions | — | **Later**: sign in again in Media |
| Paired phones, remote access | `remote_sessions`, `remote_pairing_grants`, `remote.*` | — | Pair again: C-LINK's phone sync is a different link (scan its code once) |

### Calendar sync

Not in C-LINK yet (tile off, "later"). CorosLink keeps **no** workout→event map: event IDs are worked out from the
workout, so a later C-LINK calendar sync finds the same events instead of adding them again if it builds them the
same way:

- `userId` = the COROS user ID, or `"local-only"` in Local-Only Mode. Local-Only `planId` is `"0"`, `idInPlan` is
  `local_training_schedule.id_in_plan`.
- `key = sha256hex(JSON.stringify([userId, planId, idInPlan]))`, `source = sha256hex(userId)`.
- Google: event id `cl<key>`, private properties `corosLinkSource`, `corosLinkKey`, `corosLinkDay`,
  `corosLinkTiming`.
- CalDAV: UID `coroslink-<source>-<key>@coroslink`, href `coroslink-<key>.ics`.
- The athlete's moved times: `calendar.workoutEvents.<sha256(userId)>` — **kept** (`calendarState`), with
  `calendar.scheduleRevision.*`.

Local-Only calendar entries come over with ids `coroslink-day-<idInPlan>`, so the `idInPlan` is still there.

### Faces, routes, maps, media

| What | Where | Gives back? | Decision |
|---|---|---|---|
| Studio projects | `watchface-projects/<id>/` | No | **Ported** → `studio/projects/<id>/` (manifest, `starter.dat`, preview) |
| Face AI chats | `watchface-ai-chats/` | No | **Kept** (folder) |
| Exported archives | `watchface-archives/` | — | Not copied: the athlete's exports, made again from the projects |
| Face catalog, packages, official editor copies, asset library, conversion carriers, compiler output | `watchface-*-cache/`, `watchface-official-editor/`, `official-asset-library/`, `watchface-conversion-carriers/`, `watchface-compiler/` | COROS | COROS |
| Community and shared imports | `community-watchface-imports/`, `watchface-share-imports/` | The community catalog | Service |
| Studio preferences | the page's `coroslink.watchface.*` | No | **Later** |
| Generated routes | `generated_routes` (+ `routes/<id>.gpx`) | No | **Ported** → Route Studio (`RouteStore.save`), once each (`coroslink-routes.json`) |
| Map packages and areas | `map-cache/`, `cached_coros_maps` | COROS | COROS |
| Wi-Fi map task names | the page's `coroslink.wifiMaps.taskNames.v1` | — | Not copied |
| GPS assist | `satellite-data/` | COROS | COROS |
| Downloaded music | `downloads/*.mp3`, `downloads` table | The source | **Ported** → Media's library (a copy; `origin` `coroslink:<name>`, so not twice) |
| Audiobooks | `audiobooks/<book>/` | archive.org / the athlete's files | **Later**: C-LINK's audiobooks come in through its converter |
| Spotify playlist matching, YouTube history | `spotify_sync_tracks`, `youtube_history` | — | Not copied |
| Cloudflare tunnel binary | `cloudflared/` | — | Not copied (no cloud) |

## The Move screen's tiles

| Tile | Brings |
|---|---|
| Activities | activities, watch FIT files; keeps `local-archive/` |
| Sleep and health | daily health and nights; keeps readings, checks, recovery, stages |
| Plans and races | own plans, Local-Only workouts and calendar (to the page); keeps races, tags, folders, matches, calendar state |
| Strength and gear | off: "From COROS" (COROS and Hevy send them again) |
| Coach chats | chats, memory, briefs; keeps the journal, instructions, pinned charts, attachments |
| Watch key | key, pairing, weather, auto-sync, Local mode |
| Paired phones | off: pair again |
| Faces and Studio | projects; keeps face AI chats |
| Routes | generated routes |
| Accounts | COROS (Training Hub, Studio), Hevy, intervals.icu; says Strava is for later |
| Calendars | off: later |
| Media library | downloaded MP3s, Spotify Client ID |
| Settings | Coach's AI, its keys, MCP servers, routing key; keeps language, units, permissions |

## Plans and workouts live in the store

C-LINK's own plans, calendar workouts and kept workouts used to be in the page's storage (`clink.plans.v1`,
`clink.workouts.v1`, `clink.workout-library.v1`), a leftover from C-LINK Web: not backed up, not synced, gone if that
storage was cleared. They are now items in this computer's store (`src/data/local/synced.ts` behind the same
`planStore` / `workoutStore` / `libraryStore`), so they're in backups and in what the phone pulls:

| Collection | id | Body |
|---|---|---|
| `training.plan` | plan id | `TrainingPlanDocument` (`src/lib/plan.ts`) |
| `training.workout` | workout id | `SavedWorkout` (`src/data/workouts.ts`): a workout on a day |
| `training.library` | workout id | `Workout`: kept for reuse, one per name |

The sync contract (C-LINK's `docs/sync-contract.md` section 4) has no collection for these: the phone keeps COROS's
calendar (`TrainingSchedule`) itself and syncs only `workout.link` and `gym.planned` (strength routines on a day). So
phones receive these items and ignore them for now; showing them on the phone needs the contract and the phone to
take them. What the page still has in the old keys moves into the store once, at start (`fromBrowser.ts`), and the
old key is removed. An item over 256 KB is refused before it's sent (a plan of about 250 workouts), so it can't hold
up the rest.

## Left for later

- Strava (no place in C-LINK), Google Calendar and iCloud sync (rebuild ids as above), YouTube / YouTube Music /
  Apple Music sign-ins, audiobooks, CARTO, USB adapter, Wi-Fi music.
- Page preferences in CorosLink's `localStorage` (theme, hidden nav, startup view, dashboard, sport colours).
- The sync contract already has `race.goal`, `journal.entry` and `gear.item` (phone-written; a pull restores one the
  phone doesn't hold): CorosLink's race goals and journal could go there instead of being kept, once the shapes are
  mapped to the phone's `GoalRace` and `WorkoutJournal.Entry`.
- Showing what's kept: race goals and results, journal debriefs, Coach instructions, pinned charts, workout tags and
  folders, the watch's readings through the day.
- Activity detail (laps, streams, route) from the watch's FIT files, which needs a FIT reader on the desktop.
