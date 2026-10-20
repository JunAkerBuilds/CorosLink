# Local-Only Mode

Local-Only Mode keeps the athlete's data away from COROS. Activities and daily health come from the watch over Bluetooth (or FIT files) and stay on this computer, and CorosLink never uploads anything to COROS. Turn it on in **Settings → Privacy & local data**; it stays on across restarts.

It is **not an offline mode**:

- **Reading from COROS keeps working:** Training Hub dashboards, COROS MCP queries, maps, watch-face themes and sign-in.
- **Every other service is untouched:** web fonts, Apple Music, Spotify, Strava, calendars, updates, Open-Meteo weather, AI providers and map tiles. Coach still sends what it reads, local activities included, to the AI provider the user picks.

What is refused is anything that sends data *to* COROS: activity uploads and imports, workouts, plans and schedules, gear, watch-face publishing and sharing, and COROS MCP write tools.

A one-time COROS sign-in is still needed to save the account-derived watch key that authenticates Bluetooth sessions.

**Watch key backup.** Connection details → Watch key → **Back up watch key** saves that key to a `.coroswatchkey` file encrypted with a passphrase. **Restore watch key…** reads it back on this or another computer, so no new COROS sign-in is needed. The file holds only what a watch sign-in needs: the account ID, the RSA key pair, units, data switches, the issue time and the email. It uses the local backup's scrypt and AES-256-GCM (`passphraseCrypto.ts`), with a header that is authenticated and fixed KDF parameters (`corosWatchKeyBackup.ts`). It is written owner-only (0600) and atomically. Restoring confirms before it replaces a different key. If you're signed in to COROS with another account, it signs that account out. The local backup never includes the key.

## Using it

- **Find it:** while the mode is on, a **Local-Only** button in the toolbar opens **Settings → Privacy & local data**. The watch menu's gear opens **Settings → Watch settings**, and the Overview weather card opens **Settings → Weather location** (`SettingsSection` in `src/settings/SettingsView.tsx`).
- **Sync:** **Sync watch now** in the toolbar's watch menu connects the watch if needed, then reads today's steps, the daily health history and new activities, then sends the training calendar and satellite data when needed. The same button is in **Settings → Privacy & local data**, where it needs the watch to be connected already. Before the first sync the Training Hub shows a **No watch data yet** banner with the same button, and the Overview's readiness card says "Sync your watch to see today's recovery." with it.
- **After a sync** the watch stays connected, so a second sync or any other watch feature works straight away. The result is one line ("Synced · 2 new activities") plus a short row for each part that didn't work: health data not read, a COROS-app plan on the watch (with **Replace it**), calendar not sent, satellite data not updated, or activities that can't be shown yet. The sync state lives outside the watch menu (`src/watch/watchSyncState.ts`), so closing the menu loses nothing, and the Training Hub and Overview reload when any sync ends, including a background one.
- **Where it shows:** in Local-Only Mode the Training Hub shows the activities and health data stored on this computer. In Connected Mode it shows the COROS account. Sync and FIT import are offered only in Local-Only Mode; a restored backup shows once the mode is on.
- **Training Hub dashboard:** Local-Only Mode keeps its own layout (`coroslink.training-dashboard.v1.local`), so the Connected Mode layout is never rewritten (`src/training/dashboardLayout.ts`).
  - The first time, it starts from the saved layout without the COROS-only cards. An unchanged default layout starts from the Local-Only default instead: sleep, health check, load, steps and active calories first, then weekly activity, VO₂ max, recovery, fitness and fatigue, the training load trend, calendar, stress, sleep HRV, sleep duration and distance zones.
  - COROS-only cards are resting heart rate, fitness scores, race predictions, threshold heart-rate zones, perceived effort, upcoming workouts and menstrual cycle. They stay in the widget library. If added, a card shows COROS account data when COROS is signed in and has some, and otherwise says it isn't available in Local-Only Mode.
  - The Training Hub header shows the **COROS connected** account chip only when a COROS account is signed in.
- **Recorded data stays on the watch.** Sync never deletes records or marks them as synced. If the COROS app is also used with the watch, it will still sync the same records to COROS. A sync does write the training calendar and satellite data, and every connection (in both modes) sets the clock and sends the weather (see What CorosLink writes to the watch).

## How uploads are recognised

COROS's APIs use POST for reads too, so the HTTP method alone can't tell a read from an upload. `electron/privacy/networkPolicy.ts` (`classifyCorosRequest`) decides per request:

| Request | Result |
|---|---|
| Not a COROS host (`*.coros.com`, `*.coros.com.cn`, `*.coros.cn`) or COROS S3 bucket (`coros-s3`, `eu-coros`) | untouched |
| S3 bucket: GET/HEAD | read |
| S3 bucket: any other method | upload |
| `…/oss/sts` (upload credentials) | upload |
| Sign-in / OAuth / discovery (`token`, `authorize`, `register`, `.well-known`, `oauth`), known read endpoints (`/user/profile`; two-step sign-in, `/account/captcha` and `/account/2fa/login/verify`; the satellite-data server's `cep/query`, sent only a random number) | read |
| Last path segment starts with a read verb (`query`, `get…`, `list`, `detail`, `download`, `estimate`, `calculate`, `login`, …) | read |
| Last path segment contains a write verb (`add`, `save`, `update`, `delete`, `import`, `upload`, `create`, `share`, `execute`, …) | upload |
| COROS MCP (`…/mcp`, non-GET): JSON-RPC `tools/call` whose tool is not `query/get/list/search…` | upload |
| COROS MCP: `initialize`, `tools/list`, query tools | read |
| COROS MCP: a body that can't be read | upload |
| Anything else | GET/HEAD/OPTIONS read; other methods upload |

So an unknown COROS endpoint that could carry data is refused by default. `estimate`/`calculate` send a draft workout for COROS to compute load without storing it, and count as reads.

## Enforcement

| Layer | File | Covers |
|---|---|---|
| Persisted mode | `privacy/dataModeStore.ts` | `userData/privacy/data-mode.json`, read synchronously at startup. A corrupt or unreadable file fails closed to Local-Only. Writes are atomic. |
| Bootstrap | `privacy/bootstrap.ts` | First import of `main.ts`, so the guards exist before any other module loads. |
| Node guards | `privacy/networkGuards.ts` | `globalThis.fetch`: every COROS client in CorosLink, including the MCP SDK. Uploads in flight abort when the mode starts. While enforcing, the guard follows redirects itself, one hop at a time, and checks each hop, so a redirect can't carry a body to a COROS upload endpoint. `http.request` / `https.request` / `get`: judged by the host they connect to and every name they present (the `Host` header, also when set later, and the TLS server name), so a raw IP address with a COROS `Host` is refused, as is a proxy tunnel to COROS. Refused requests are destroyed before connecting, so no byte is sent. Raw sockets (`net`, `tls`) aren't guarded; no COROS client uses them. |
| Electron guards | `privacy/electronNetworkGuards.ts` | `webRequest.onBeforeRequest` on every session (renderer, webviews, OAuth windows, `net.fetch`), using the method, URL and upload body. It runs again for every redirect hop. |
| IPC registry | `privacy/remoteFeatures.ts` | Classifies every IPC channel as `local`, `upload` or `routed`. Upload features are refused with a `Local-Only Mode:` message before their handler runs. A test fails if a new channel prefix is unclassified. |
| Sender check | `mainWindowGuard.ts` | IPC that changes something (the data mode, local data, sync, writes to the watch) is accepted only from the main window's top frame, never a subframe, webview or other window. |

The blocked-uploads list in Settings records `METHOD host/path` only, never queries, headers or bodies.

### The watch's Bluetooth identity (`watchIdentity.ts`)

COROS authentication only proves CorosLink to the watch; the watch never proves itself. A device that copies the watch's advertised name would otherwise get the weather for the chosen place, the training calendar and satellite data, could feed forged activities and health data into the local database, and could have CorosLink sign a sign-in challenge it chose. So CorosLink remembers the watch's Bluetooth identity and checks it before anything is signed for or sent:

| Backend | Identity | Checked |
|---|---|---|
| Mac Bluetooth (`native/corebluetooth/main.swift`) | CoreBluetooth's peripheral identifier, a UUID per Mac | The helper is given the identity (`pinnedId`) and connects to that peripheral only. A same-named peripheral with another identity is never connected to; if the remembered one hasn't advertised 10 s after the other was seen, the connect fails and reports the other identity outside `detail`. |
| Windows and Linux Bluetooth (`scripts/coros-system-ble.py`) | The device address the OS reports (bonded by the OS pairing) | The same, in the Python worker. |
| USB adapter (`scripts/coros-native-ble.py`) | The watch address in the saved bond; the bond's key encrypts the link | Before the worker starts. A new pairing (`pair`) replaces the bond and counts as the user's choice. |

Electron checks the connected identity again after every connect and before the SystemBind challenge is answered (`corosNativeBleService.ts`, `connectOnce`), so a helper that connected by name still gets nothing: no challenge, clock, weather, calendar, satellite data or sync. The order is connect (GATT discovery, standard reads and notifications only) → identity check → SystemBind → settings and profile read → clock → weather; a sync runs only on an authenticated link.

- **Remembered** (`coros.ble.watchIdentity`, per backend, with the name, serial, model number and model) on the first connection made from the watch menu that the watch accepts. An existing remembered watch without one gets it the same way on its next manual connection. Connections CorosLink makes for a task (sending a workout or a route) and background syncs never remember an identity.
- **Another identity** on a manual connection: the link is closed before SystemBind and the watch menu asks "This doesn’t look like the watch you connected before." **Connect anyway** connects to that device only, and once the watch accepts it, remembers the new identity (a reset or replaced watch). **Cancel** disconnects. A device chosen from **Choose a watch** that isn't the remembered one is asked about before connecting; with several devices of the same name the remembered one is preselected and none other is chosen automatically. Connections CorosLink makes for a task fail with the same message instead.
- **Background sync** connects only to the remembered identity (`connectForBackgroundSync`). With none remembered, or when another device answers, it doesn't connect or authenticate: it pauses and records why (`paused: "unpinned" | "mismatch"`), and the watch menu says so under Auto-sync. The next connection from the watch menu to the remembered watch (or one the user confirmed) clears the pause.
- **Diagnostics.** Each new or changed identity, and each refused device, is an `info` or `warning` entry from `corosBle:identity` with a short hash (`id#` and 8 hex digits), never the identifier. Redaction also removes UUIDs and Bluetooth addresses from every entry.

Limits: the identity is the address-derived identifier, not a key, on Mac Bluetooth unless macOS has bonded with the watch. A device that also copies the watch's Bluetooth address (special hardware, in range) can pass, and if the watch changes its address, the identifier changes too: CorosLink then asks once and background sync pauses until the user confirms.

## Lifecycle (`privacy/dataModeService.ts`)

Turning it on runs these steps in order:

1. Enforce at once and abort uploads in flight.
2. Persist `local_only`, so a crash from here on restarts in Local-Only Mode.
3. Stop registered background upload jobs and verify they are inactive. There are none today; user-started uploads are refused at the IPC gate.
4. Report the mode as active.

A save or stop failure is reported as `degraded`, and the guards stay on either way.

Options at activation:

- **Keep the watch key** (default).
- **Remove the COROS sign-in** from this computer.

Turning it off needs a native confirmation. Connected Mode is persisted and CorosLink relaunches; the guards are never relaxed in-process.

## Local data (`electron/localSync/`)

| Module | Role |
|---|---|
| `localArchive.ts` | Content-addressed files under `userData/local-archive/`. Writes go temp, fsync, rename, then directory fsync. |
| `localDataSchema.ts` | `local_devices`, `local_activity_files`, `local_activity_training`, `local_sync_payloads`, `local_sync_runs`, `local_sync_checkpoints`, `local_health_samples`, `local_health_summaries`, `local_health_checks`, `local_sleep_sessions`, `local_workout_recovery`, and the local workout library and calendar (`local_training_programs`, `local_training_schedule`). Interrupted runs are marked at launch. |
| `localTrainingBackend.ts` | In Local-Only Mode the Training Library's workouts and the calendar are kept here instead of COROS, and the calendar the watch gets comes from here. |
| `activityRepository.ts`, `healthRepository.ts` | SQLite access. Deduplicated by SHA-256 and by (device, watch record). Provenance (`watch`, `file`, `cloud-export`) is kept on every row. |
| `activitySource.ts`, `cloudSources.ts` | `ActivitySource` / `HealthDataSource`. In Local-Only Mode the Training Hub's activity list, detail, export, daily health and per-day training totals come from this computer, because that is where new watch data lives. When COROS is still signed in, COROS-computed metrics (recovery, VO₂ max, fitness scores, race predictions, threshold zones, perceived effort) and scheduled workouts are still read from COROS and only reflect data already there. Per-activity training load and training effect come from the watch's own analysis (see below). |
| `fitImportService.ts` | Imports FIT files or folders. Each file is validated by decoding it. Files named by the cloud backup feature are recorded as `cloud-export`. |
| `localActivityDetail.ts`, `localGpx.ts` | Training Hub detail from FIT, and offline GPX export. |
| `localBackupService.ts` | One-file backup: a stored ZIP with a SHA-256 manifest, optionally wrapped in AES-256-GCM with a scrypt key. Restore verifies every hash, skips rows whose hash doesn't match their file, and never overwrites. Keys, tokens and settings are never included. |

## Watch sync over Bluetooth (experimental)

`localSync/activityProtocol.ts` generalises the validated music-inventory reader. That reader uses Protocol V2 SyncData (0x7C/0x7D) on file 93; this one reads the sport-record file 14.

- **Read-only.** The watch serves any offset on request, so the sync state on the watch never changes. No transport (Swift, Python or TypeScript) has an operation that would change it.
- **No disconnect.** Each block is a request of its own. A finished or cancelled read leaves nothing to close, so the watch stays connected. On a PACE 4 (firmware V3.2008.0) an open transfer blocks no other command, is replaced by the next request for the same file and clears itself after a few seconds without marking anything synced. The COROS app also just sends a new request after a cancel. Only a block request that failed partway disconnects, to stop a block the watch may still be sending, as for every other interrupted transfer.
- **Durable before the next request.** Each block is CRC-checked, written and fsynced, then checkpointed. A disconnect resumes at the last durable offset; if the watch's file changed meanwhile, the read restarts from zero once.
- **Incremental** (`localSync/payloadRetention.ts`). Since nothing marks records synced, the watch keeps serving the activity file (14) and the daily-history file (5) from the same start and appends new records (on a PACE 4, every stored copy was a byte-for-byte prefix of the next). A sync starts from the copy stored last time and reads only the bytes after it, once the watch's first block and the stored copy's last 4 KB page match. A file that shrank or was rewritten (for example after the COROS app synced) is read in full.
- **One stored copy.** An older copy that is a prefix of a newer, decoded copy is removed, so the archive holds about one copy of each file however often it syncs. Copies still referenced by an activity, or not yet decoded by the current decoder, are kept.
- **Archived before decoding.** The raw payload is stored content-addressed first, so it can be decoded again later (see Decoder versions). A payload that fails to decode keeps its error and is retried only by another decoder version, not on every launch.
- **Decoding** (`localSync/corosSportRecord.ts`). Each finished activity becomes a FIT file (`localSync/fitWriter.ts`), so detail, GPX and export work as for imported files. Activities still being recorded are left for a later sync.
- **Damaged records.** A damaged sample-series record is skipped and counted; the rest of its activity is kept. A session whose times are implausible (a stop before its start, longer than 7 days, or timer windows far beyond the watch's own timer) is set aside rather than built, and its payload stays archived for a later decoder. One bad record or session never hides the others.
- **Day totals.** `GetPedometer` (0x90) reads today's steps, distance, active calories and active time.
- **Scope.** Offered for PACE 4, PACE 4 Pro, PACE Pro, PACE 3 and APEX 4 on the system Bluetooth backend (`EXPERIMENTAL_SYNC_MODELS`).

### The sport-record format

| Layer | Layout |
|---|---|
| Pages | 4 KB. Each starts with a block marker: record kind 0x1f whose body begins `a5 5a`; body byte 4 is the length unit for the page. |
| Record header | Bit 0 clear: 1 byte, kind = bits 1–3, length = bits 4–7. Bit 0 set: u16, kind = bits 1–3 \| bits 8–9 << 3, length = bits 4–7 \| bits 10–15 << 4. Lengths are multiplied by the unit, except kinds 0x1e (padding) and 0x1f. |
| Kind 4, sport info | First byte selects: 0 start (time, ms, device sport type), 1 pause or stop (time, ms), 2 resume, 4 lap, 5 session summary, 6 lap power. |
| Kind 8, series | checksum (sum of the other bytes), channel, interval (s), u32 start time, then a delta-pack: u16 flags, u8 count, LSB-first bitstream (zigzag deltas, constant-step, offset and absolute modes, optional variable width). |
| Channels | 0x02 heart rate · 0x28 GPS (group 0 longitude, 1 latitude, 1e-7°) · 0x07 distance (m) · 0x06 speed (÷ 360 = m/s) · 0x00 step cadence (÷ 2 per leg, runs) · 0x08 power (W) · 0x05 altitude (+ the session's offset). Other channels are ignored. |

Times are seconds since 2014-01-01 UTC. Summary and lap fields (distance, timer, calories, heart rate, ascent, descent, cadence, best pace, power) are documented in `corosSportRecord.ts`.

**Also decoded from the activity file, and written into its FIT:**

| What | Source | In the FIT |
|---|---|---|
| Running dynamics: ground contact time, vertical oscillation, vertical ratio, step length | Channels 0x26 (groups 1, 3, 4) and 0x01; lap averages from sport info 6; session averages are the floored mean of the measured samples, step length from the summary | Record fields 41, 39, 83, 85; lap 79, 77, 118, 120; session 91, 89, 132, 134 |
| Effort (grade-adjusted) pace | Channel 0x11 ÷ 360 (m/s) | Record developer field "Effort Pace", as the COROS app exports it |
| Minimum heart rate, temperature, total strides | Lap and summary records | Lap 63, 50; session 64, 57, 10 |
| Half-step cadence | The watch records steps per minute | FIT fractional cadence (session 92/93, lap 80); Local-Only detail shows runs in steps per minute, like COROS |
| The watch's training analysis: training load (and its aerobic/anaerobic split), aerobic and anaerobic training effect, training focus, 7-day load and the recommended range | Sport info 15, part 2 | Session 24 and 137 (training effect), and developer fields "Training Load", "Aerobic Training Load", "Anaerobic Training Load", "Training Focus", "7-Day Training Load", "Recommended Load Min/Max" |
| The watch's current VO₂ max (ml/kg/min) after this activity (the watch copies it from its VO₂ max log right after updating it; a ride carries the separate cycling figure); 0 while the watch has none | Sport info 15, part 2, byte 0x27 (`vo2max_input` in COROS's naming) | Developer field "VO2 Max" |
| Recovery time: seconds from the end of the activity until the watch counts you as fully recovered (stored as whole hours × 3600; the watch's countdown runs from the activity's finish time and caps what is left at 120 h) | Sport info 15, part 2, u32 @0x13 (`full_recovery_time` in COROS's naming) | Developer field "Recovery Time" (s) |
| Base Fitness and Load Impact: rounded training-load points as of the activity's day, the values the watch's Base Fitness / Load Impact screen prints; fatigue = round(Load Impact × 100 ÷ Base Fitness), %. All three are left out while Base Fitness is 0 (the watch hasn't built one yet). Byte 0x1d, which COROS reads as fatigue, is never written | Sport info 15, part 2, u16 @0x19, u16 @0x1b, s16 @0x2d | Developer fields "Base Fitness", "Load Impact", "Fatigue" (%) |

These are computed or measured by the watch, not estimated by CorosLink.
- The **VO₂ max** card shows the watch's running figure from the latest non-cycling activity that carries one (`localTrainingMetrics.ts`, per day). CorosLink computes nothing. The watch has no read command for it, so the card updates only when an activity syncs. If the COROS app has sent the watch its fitness file (SendFile 38), the watch's figure may start from COROS's.
- The **activity detail** shows training load, training effect with COROS's labels (Recovering, Maintaining, …), training focus, running dynamics and heart-rate recovery.
- **Charts:** local detail also includes COROS-format per-second samples, so the Training Hub's channel charts work for local activities, including watch activities and imported FIT files.
- The **Recovery** card counts the watch's recovery time down from now ("Recovered in 14 h", then "Recovered"; whole hours, at least 1 h while any is left). The Overview's readiness card uses the same figure ("Recovering · 14 h left", then "Recovered"). COROS's recovery % is a live model of the watch's that isn't in the files, so it is shown only from a COROS account.
- The **Fitness and fatigue** card shows Base Fitness, Load Impact and fatigue from the latest activity that has them.
- Each of these comes from the day's last watch activity that carries it (`localTrainingMetrics.ts`); imported FIT files are never read for them.
- **Not shown:** the watch's "performance" value is stored in the file but not shown.

**Decoder versions.** Each stored payload records the decoder that read it: `COROS_SPORT_RECORD_DECODER` (`coros-sport-record/v1`) for the activity file and `DAILY_DECODER` (`coros-daily/v1`) for the daily history. When a release changes either, CorosLink decodes the stored payloads again at startup (`redecodeArchivedPayloads`), each checked against its recorded hash first. A re-decoded activity's new FIT replaces its file under the same activity ID, and the old file is removed; re-importing a daily payload adds what the decoder reads and updates sleep segments in place.

**Validation (same run as above):**
- Dynamics, minimum HR, temperature and strides match the COROS export on every sample and summary. COROS writes 0 where the watch measured nothing; CorosLink leaves those fields out.
- Effort pace matches within 0.0025 m/s, because COROS truncates it to 0.001.
- The training analysis matches COROS's decoded fitness-index item field for field; each offset was confirmed by writing marker values into the raw file.

**How it was validated.** CorosLink's decoding was compared with COROS's own decoding of the same recording, a 10-minute outdoor run with a pause:
- Session, lap, timer windows and record count match exactly.
- Every heart-rate, distance, cadence, power and altitude sample matches exactly.
- Speed matches at recorded seconds; interpolated seconds are within 0.002 m/s.
- Coordinates are the watch's own values (1e-7°), stored in FIT to within 0.5 cm. COROS's export differs by up to about 0.5 m because it converts with `floor(degrees × 11930465)`, a rounded constant (the exact factor is 2³¹/180). Applying that formula to CorosLink's values reproduces every COROS coordinate exactly.

Each summary and lap field was confirmed by changing it in the raw file and watching which value COROS's decoding changed. The real recording is not committed because it holds a GPS track; `COROSLINK_SPORT_RECORD_ORACLE=<dir> node scripts/test-coros-sport-record.mjs` checks against one locally.

**Still open:** sports other than running (pool swim lengths, bike cadence, multisport).

### Daily health history (file 5)

**Sync watch now** also reads the watch's daily history, SyncData file 5, by offset, read-only and incrementally like the activity file. Two reads seven seconds apart on a PACE 4 returned the same bytes plus a newly flushed tail: the watch appends while it records, so CorosLink reads up to the length first reported. An unchanged file isn't stored again.

`localSync/corosDailyRecord.ts` decodes the file, which uses the same pages and record headers as the sport-record file:

| Record | Layout |
|---|---|
| kind 0 | u32 time, i8 time zone (15-min units), applying to later records |
| kind 1 | u24 minute, u8 heart rate, u8 flags: one reading per minute |
| kind 2 | u24 start minute, u24 end minute, u8 active seconds, u32 = calories × 4 (bits 0–19, small calories) and steps (bits 20–31) |
| kind 4 | u32 time, u8 sleep status: 0xfa start, 1 awake, 3 light, 4 deep, 5 REM, 0xfb end |
| kind 8 / 4 | stress: u32 time, i8 zone, stress at 6, score at 9 |
| kind 8 / 1 | HRV: u32 time, i8 zone, then a bit field (status, RMSSD, LF, HF, heart rate, breathing rate, SDNN, SD1, SD2, confidence) |
| kind 8 / 3 | Health Check: u32 time, i8 zone, heart rate at 6, HRV at 7, the resting-HR setting at 8, u16 at 9 (breathing rate in bits 0–5, SpO2 in bits 6–12), stress at 11, stress level at 12 (low 3 bits) |
| kind 10 | A one-off heart-rate reading: u32 time, u8 heart rate (taken on request, for example right after a Health Check) |
| kind 13 | After each workout: protobuf with heart rate once a second for the 2 minutes after it ends (heart-rate recovery) |

Sleep is built from the status events the way the COROS app builds it:
- Stages run from one event to the next. Ranges are measured from the minute-rounded start, and each change is rounded to the nearest minute.
- An event at the end instant is dropped.
- Awake time is the rounded window minus the sleep stages.
- Heart rate is the per-minute readings inside the window; the average is floored (64.51 → 64).
- Sleep HRV is the floored average RMSSD of the readings taken during the night's sleep. COROS gives the same value on the night's last segment; earlier segments carry running values that CorosLink doesn't show.

The watch splits a night into segments where you briefly wake up. The Training Hub shows the night as one main record, from the first segment's start to the last one's end, with time between segments counted as awake. Daytime segments of up to 2.5 hours are naps.

Storage:
- Heart rate, stress, HRV and breathing rate go into `local_health_samples` (keyed by time, so re-syncs add nothing twice).
- Day steps and active calories go into `local_health_summaries`.
- Sleep segments go into `local_sleep_sessions`.
- Backups include all three.

In Local-Only Mode the Training Hub's sleep, sleep-HRV and stress views, and daily steps and calories, come from this data (`localSync/localHealthViews.ts`). The Sleep HRV card uses the same nightly-average layout as the COROS reading. The Health check card shows each Health Check taken on the watch (heart rate, HRV, stress and level, breathing rate, SpO2), stored in `local_health_checks` and included in backups; the watch's resting-HR setting it records alongside is left out. COROS-computed values (sleep score, HRV baseline, normal range and status, recovery) stay unavailable, and so does the Menstrual cycle card: cycle information comes from the COROS account.

The per-day training list behind the Weekly activity, Training calendar, Load and load-trend cards also comes from local data (`localSync/localTrainingMetrics.ts`). Each day sums its activities' training load (the watch's own figure, read once from each FIT file and cached in `local_activity_training` by file hash), distance and moving time, and carries the night's sleep HRV.
- A day the watch's daily history covers without any activity is a rest day: zero load, distance and time, as COROS reports it. So the Load card's "today" and its 7-day total count calendar days.
- Days with no data at all (not synced yet, watch not worn) are left out rather than shown as rest days.
- The Calories card is labelled **Active calories** in Local-Only Mode, because that is the total the watch keeps.

### Where the remaining metrics live

On a PACE 4 (firmware V3.2008.0), from the watch's own files:
- **Computed and kept only on the watch.** The watch keeps its own results in internal storage. Examples: the sleep score it displays (which also uses 7 days of sleep, 30 days of bedtimes and the day's stress), the HRV baseline and status, and the resting-HR trend. No sync file carries them. Over Wi-Fi the watch uploads only the raw activity (`deviceData.dat`) and daily (`dailyData.dat`) files. COROS's servers recompute their own values from those and push fitness results back (`SEND_PHYSICAL_FITNESS`). So the sleep score in the COROS app can differ from the one the watch shows for the same night.
- **In each activity record (training analysis, part 2).** The watch writes its state at the end of a workout:
  - u16 @0xf / @0x11: 7-day and 42-day scores
  - @0x1d: fatigue
  - @0x25: resting HR it used
  - @0x26: max HR
  - @0x27: VO₂ max (0 until established)
  - parts 4–5: pace-zone boundaries

  Only the fields confirmed against COROS's decoding are shown (training load, effect, focus, 7-day load, recommended range).
- **In the daily file.** 8/6 records (every 5 minutes) carry, at byte 8, the resting HR the watch's algorithms use (the same value as the activity record's @0x25). It is the user-info value the COROS app sends from the COROS account (0x8B, `rest_hr` with an "is default" flag), not the training profile's resting HR, which can differ. 55 is the default when none has been sent, so it isn't shown; VO₂ max (@0x27) stays 0 until the watch has one.
- **Resting heart rate.** The watch's heart-rate widget records one during sleep ("No RHR data. Wear watch during sleep to record it.", a normal range after 7 recordings) and keeps it on the watch; no sync file carries it. The COROS app's resting-HR card comes from COROS's server: the daily-file upload returns `testRhr`, `avgRhr` and `rhrRange` per day.

**How it was validated.** CorosLink's decoding was compared with COROS's own decoding of the same two-day file. Every value matches:
- every heart-rate reading and five-minute activity slot
- day totals (also equal to the watch's live step counter)
- every stress and HRV reading
- every sleep segment: times, stage minutes and seconds, awake count, heart rate, every stage range, and the night's HRV

`COROSLINK_DAILY_ORACLE=<dir> node scripts/test-coros-daily-record.mjs` checks against such a file locally; real data is never committed.

A second recording, with a Health Check, was checked the same way: heart rate including the one-off readings, every sleep segment, the nights' HRV, the recovery curve and the Health Check match COROS's decoding.

**Records CorosLink does not import.** COROS's decoding reads the heart-rate, activity, stress and HRV records, and the Health Check records when the file holds one. The rest of the file:

| Record | What it is | Why it isn't imported |
|---|---|---|
| kind 8 / 6 (every 5 min) | Snapshot of heart rate (byte 7) and stress (byte 18), a state byte, and the watch's resting-HR setting (byte 8; 55 is the default) | Duplicates the per-minute heart rate and stress readings |
| kind 8 / 2 | A marker about 5 minutes before each sleep segment ends | Sleep is already built from the stage events |
| kind 11 / 3 (every 10 min) | Device telemetry | Not health data |
| kind 11 / 4 | The watch's running summary of the night, updated per segment: cumulative asleep minutes and a score-like value | The COROS app keeps it only as an event track; its final values differ from the app's, so they can't be validated |
| kind 11 / 7 (hourly) | Battery level and power counters | Not health data |
| kind 13 (other fields) | A second series of 120 values and hourly follow-ups next to the recovery curve | Not identified |

A measured resting heart rate doesn't appear in this file (only the value the watch's algorithms use), so it isn't shown; SpO2 appears only in Health Checks. Active minutes are left out because one day's total also counts minutes from another record type.

## What CorosLink writes to the watch

CorosLink does these jobs in place of the phone app. Each is encoded as the phone app encodes it and checked against how a PACE 4 (W336, firmware 3.2008.0) handles it.

| What | When | How |
|---|---|---|
| Clock and time zone | Every authenticated connection, both modes | SYNC_TIME 0x8C (`corosWatchCommands.ts`). The message carries a 12/24-hour flag, so the watch's own setting is read first on the same connection (else the last read is used, and only a watch never read gets the computer's format): setting the clock never changes it. Within the first 10 seconds after midnight it waits, as the app does. Best effort; a refusal is logged and never fails the connection |
| Watch settings: wrist gestures, wrist, time format, units, temperature and pressure units, do not disturb (and scheduled), dial rotation, raise to wake (daily and during activities), brightness, always-on display (daily and during activities), barometer range, storm alert, notifications during activities, turn-by-turn alerts | Read on every connection; written from Settings → Watch settings | Settings 0xA7 / 0xA6, setting 0 (switch word) and 31 (extended switches) (`corosWatchSettings.ts`, `watchSettingsService.ts`). Read, changed and written back, then read again to confirm the watch kept each change. Other confirmed settings are shown with a lock (change them on the watch); fields whose meaning isn't confirmed aren't shown |
| Training profile: max, resting and threshold heart rate, threshold pace, zones | Read on every connection; written from Settings → Training profile | Settings 0xA7 / 0xA6, setting 10 `LitePb.UserInfo` (`corosWatchProfile.ts`); zones move with their reference value |
| One workout | "Send to watch" in the Training Library | SendFile 41 (`ProgramLite`) into a slot from CONFIG_TRAINING 0xAF; zone or percent targets are refused for now |
| Training calendar (next 35 days, from Monday) | Every sync in Local-Only Mode that isn't cancelled | SendFile 42, the app's training-plan file: `PlanSummaryLite`, one `VersionObject` per workout, then each workout as file 41; workouts with zone or percent targets are left off. The watch holds one plan, listed first with CONFIG_TRAINING. CorosLink replaces only its own plan (id 1). A plan from elsewhere (the COROS app) is left alone and the sync reports `foreignPlan`; the result row asks once ("Replace the plan on the watch with CorosLink's calendar?"), and **Replace** stores the answer (`localData:allowWatchPlanReplacement`), so later syncs replace it. Nothing is sent when the content hash matches the calendar last confirmed on this watch, or when the calendar is empty and the watch holds no CorosLink plan. Afterwards the watch must list the plan. A transfer that fails partway disconnects (`localDataService.ts`, `localOnlyMain.ts`) |
| GPS assistance (ELPO, LTO and RTO) | A sync in Local-Only Mode, when COROS has a file that starts later than the data the watch holds (the app's rule for these receivers) | Inside the sync CorosLink reads settings type 13 (FW_INFO, read-only), as the app does after binding: the watch's file type, data type, durations and the start of what it holds (hours since 2014). It picks the file the app would pick for that report and sends only formats checked in that model's firmware (`SATELLITE_FORMAT_MODELS`): ELPO to the PACE 4 (when it reports ELPO), PACE 4 Pro and PACE 3 (plus the PACE 3's second file, 68); LTO (file 13) and RTO (file 70) to the PACE 4 (when it reports LTO), PACE Pro and APEX 4. The list comes from `epo.coros.com/cep/query` (a GET with a random number; no sign-in), the file from an HTTPS `coros.com` link, read up to 256 KB, checked against the list's MD5 and its date, and checked as a run of COROS sections of the right type and subtype (ELPO: every satellite record stamped with its 6-hour segment's GPS hour). It is cached in `satellite-data/cep-<type>.bin/.json` (written atomically, checked again on load, refreshed after 6 hours, 1 hour for RTO) and sent whole in an HF header (file time = its start) in 4 KB SendFile blocks, the start hour in every block header. Expired data is never sent. A file sent on this connection is not sent again on it, and a transfer that fails partway disconnects (`corosWatchCep.ts`, `watchCepService.ts`, `localSync/satelliteSync.ts`; the Mac helper and the Python worker accept files 13, 68 and 70 up to 256 KB, with the 3-byte hour). |
| Weather | Every authenticated connection, both modes, once a place is known | Open-Meteo forecast for the place chosen in Settings → Weather location (searched with Open-Meteo geocoding), else the Overview's automatic location: current conditions, temperature, feels-like, humidity, precipitation chance, wind speed and direction and UV index, plus the US AQI from Open-Meteo's air-quality service when it answers (without it the watch shows no AQI). A `WeatherForecastUI` with up to 96 hourly and 14 daily entries (as many as the firmware keeps) in an HF file 80, header extra byte 0, as the app's non-sliced `SEND_WEATHER_24H`. The forecast is reused for 30 minutes; the connection waits up to 20 s for it. A failed send isn't retried until the next connection (`corosWatchWeather.ts`, `watchWeatherService.ts`) |
| Background sync | Every 1, 3, 6 or 12 hours while CorosLink runs in Local-Only Mode; off until turned on in the watch menu | `watchAutoSyncService.ts`; only when no Bluetooth operation is running. A watch the user connected is synced over that connection and stays connected; otherwise CorosLink connects to the remembered watch's Bluetooth identity only for the sync and disconnects afterwards. Retries after 30 minutes if the watch is out of range; pauses when no identity is remembered or another device answers (see Enforcement) |

The firmware answers every SendFile header. A refusal is the 4-byte frame `[0x78, 0, code, code]`. A file id the firmware has no slot for gets a reply that looks like "already received", so the calendar and workouts are checked in the CONFIG_TRAINING list afterwards. File 83 ("today's advice") has no slot on the PACE 4.

Not done yet: the sliced weather format (`WeatherPbT`, used when the watch reports SUPPORT_SLICED_WEATHER and COROS's server supplies it), GPS assistance for Sony receivers and Airoha EPO (EPO_GR, the PACE 4's hardware variant 0, which reports no data and for which no file the watch loads is known), firmware updates, alarms and other settings.

Developer checks (`COROSLINK_SYNC_CAPTURE=1` only): **Connection details → Satellite data** also shows the raw bind-reply bytes 11–14 and, after a sync, settings type 13 in hex, and a **Send satellite data now** button (`localData:sendSatelliteDataNow`) that sends the newest file the watch takes without the "newer" and "already sent" checks; the main process refuses it without the flag or outside Local-Only Mode, and still refuses formats not checked for the model and expired data. Each sync also logs both raw values to the diagnostics log (`corosBle:satelliteData`).

## Testing watch sync on a real watch

Start CorosLink from source with developer capture on:

```sh
git checkout feat/local-only-mode
npm ci && npm run rebuild
COROSLINK_SYNC_CAPTURE=1 npm run dev
```

With capture on, every frame of the activity sync and the step-summary read is written to `~/Library/Application Support/coroslink/local-archive/captures/sync-capture-<time>.jsonl` (one file per app session, private to your user).

- **Never captured:** authentication exchanges and the watch serial number.
- **May contain:** activity data, including GPS.

Settings → Privacy & local data then shows a **Probe watch records** button.

1. **Prepare the watch.** Turn off the phone's Bluetooth (the watch serves one connection at a time) and the watch's Wi-Fi.
2. **Connect.** Connect the watch in CorosLink and confirm it authenticates. If no watch key is saved, sign in to COROS once.
3. **Offline connection (G0).**
   - Turn on Local-Only Mode, keeping the watch key.
   - Turn off the computer's network, restart CorosLink and reconnect.
   - Click **Read today's steps** and compare with the watch.
4. **Record** an activity. Runs are validated; other sports are the open question, so a pool swim or a ride with laps is the most useful next test. Don't sync it to the phone.
5. **Probe (changes nothing).** Click **Probe watch records**.
   - It reads the start of the file, read-only. The watch stays connected.
   - The result shows the total size and a copy of the bytes in the captures folder.
   - If the probe fails, stop here: the capture file has what is needed to fix the request.
6. **Sync.** Click **Sync watch now** in the toolbar's watch menu (it connects the watch first if needed), or use the button in Settings. The watch stays connected afterwards.
   - Nothing is deleted or marked synced on the watch; the phone app still sees the activity as unsynced.
   - The activity appears in the Training Hub's list with its track, laps and charts. A sport the decoder doesn't handle yet is kept as a raw payload and decoded by a later version.
   - A first sync of a long history can take a while; it can be cancelled and resumes later.
   - Today's steps, the daily history (heart rate, stress, HRV, sleep) and the activity file are read in that order; then the training calendar and satellite data are sent if needed. A later sync reads only what the watch added.
7. **Compare (optional).** Sync the same activity with the COROS app, export its FIT file, and compare it with CorosLink's export.
8. **Hand off.** Keep the capture file, `local-archive/watch-sync/`, any exported FIT file, and notes on what differed.

## Limits

- The watch firmware is not controlled by CorosLink: a watch with Wi-Fi enabled can upload on its own.
- Data already in COROS stays under COROS's retention.
- Child processes are not inspected; no CorosLink child process talks to COROS.

## Tests

```sh
npm run test:local-only          # privacy core (Node), sport-record and daily-history decoders, FIT writer, local data (Electron's Node), Electron session guards, Overview briefing, and the watch-figures, watch-menu, watch-settings and privacy-settings screens
npm run test:coros-ble-activity  # Swift receivers (macOS) and the Python worker against shared vectors and a fake watch
npm run smoke:local-only         # the real app in Local-Only Mode: every section opened, no upload attempted
npm run test:watch-commands      # clock, weather, satellite data, training plan, watch settings and profile encoding, in several time zones
npm run test:privacy-settings-ui # Settings → Privacy & local data in both modes
npm run test:watch-menu-ui       # the toolbar watch menu: connection states, sync progress and results
npm run test:watch-settings-ui   # the Watch settings, Training profile and Weather location panels
```

The local-data test loads `better-sqlite3`, so like the other SQLite tests it runs under Electron's Node (`npm run rebuild` first on a fresh install).
