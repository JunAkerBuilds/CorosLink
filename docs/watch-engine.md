# The watch on every desktop: TypeScript engine + Rust Bluetooth helper

Decided 2026-11-25: C-LINK desktop ships on macOS, Windows and Linux at once, with the same watch features on all
three. CorosLink's users on every platform move to it through their normal update.

## The shape

```
 renderer (screens)            unchanged: /watch, Local mode, Studio → Watch, Maps → Watch
        │ clink://app/api
 main process
   watch engine (TypeScript)    the COROS protocol: sign-in with the watch key, sync (activities, health,
        │                       sleep), faces, routes, music, notifications, satellite data, settings
        │ JSON lines (stdin/stdout)
   clink-ble (Rust, btleplug)   GATT only: scan, connect, frames, CRC-checked blocks, file blocks
        │
 CoreBluetooth · WinRT · BlueZ
```

- **One protocol, one helper.** The engine is TypeScript, so it is the same code on every platform. Only
  `clink-ble` touches the operating system, and btleplug covers all three.
- **The helper speaks CorosLink's helper protocol exactly** (`native/corebluetooth/main.swift` on macOS,
  `scripts/coros-system-ble.py` elsewhere): same operations, same answers, same error texts, same identities
  (CoreBluetooth UUID on macOS, Bluetooth address elsewhere). CorosLink's TypeScript drives it unchanged, which is
  how it gets tested on real watches before the engine moves.
- **Keys never reach the helper.** The engine signs the watch's sign-in challenge and sends the answer through
  `exchange`, as CorosLink does.
- **No private code in the build.** The CorosKit-based helper (`native/watch`) leaves the desktop once the engine
  covers what it does, and with it the release workflow's `COROSKIT_TOKEN` step. Everything builds from the public
  repo.

## clink-ble (`native/ble`)

| Operation | What it does |
|---|---|
| `scan` | 8 s scan, COROS watches only (`discoveredDevices`) |
| `connect` | already-connected watch, then the remembered identity, then a scan; a same-named watch with another identity only with a matching serial number; Device Information + battery; notifications on all three channels. Linux: BlueZ pairs first (Device1.Pair, the desktop's agent). Windows: pairs (WinRT, Just Works) only when a subscribe is refused unpaired, and removes a Windows pairing the watch no longer honours, then retries once (`{"event":"stale bond cleared"}`, `detail.staleBondCleared`); a failed connect names its `detail.step` |
| `status`, `refresh` | signal strength; battery |
| `exchange` | one control request and its reply (SUM-checked, ≤ 4 KB) |
| `exchangeFrames` | control frames written exactly as given (≤ 32, each ≤ the write size) and the SUM-checked reply for `opcode`; `timeoutMs` 60 s by default, at most 120 s (find-my-watch rings until a button is pressed) |
| `syncFileBlock` | one read-only SyncData block (files 5, 14, 54), CRC-checked, never acknowledged. A short refusal header fails with `detail.refusedCode` (0x16 busy, 0x14 nothing); 0 when another client's sync got in the way (CorosKit's SyncBlockReceiver). An empty file at offset 0 is 4 zero bytes |
| `musicInventoryPage` | music metadata pages (local music, NetEase) |
| `sendNotification` | phone notification frames |
| `routeBlock`, `watchfaceBlock`, `dataFileBlock`, `musicDelete` | one SFT file block, header checked before anything is sent; `dataFileBlock` takes files 41, 80, 42, 13, 68, 70, and the engine's 54 (settings) and 84 (gear list) |
| `officialOtaBlock`, `lightMapOtaBlock` | development-only firmware rehearsal, pinned sizes |
| `disconnect` | |

Unasked lines: `{"ready":true}`, `{"event":"disconnected"}`, `{"event":"usb-access-request" | "usb-access-closed"}`,
`{"event":"interactive","subtype":n,"payload":base64}` for each record of the watch's own control 0x0D messages (live
workout data; CorosKit's InteractiveReceiver); watch media keys and rejected calls land in `watchEvents`.

`src/protocol.rs` (framing, SFT header checks, receivers) has no Bluetooth in it and is unit-tested, including
against headers and files made by CorosLink's own encoders (`src/coroslink-vectors.json`). `src/worker.rs` is the
btleplug side. Build: `cargo build --release` in `native/ble` (about 750 KB on macOS; Info.plist with the Bluetooth
purpose string is embedded by `build.rs`).

macOS charges Bluetooth to the app that started the helper. Started from a terminal it is killed (SIGABRT); started
by Electron it works. For a quick check without the app:
`open -W -n --env ELECTRON_RUN_AS_NODE=1 -a node_modules/electron/dist/Electron.app --args <script.cjs>` where the
script spawns the helper. `CLINK_BLE_DEBUG=1` prints how many advertisers a scan saw.

## Phases

1. **clink-ble on macOS** — done 2026-11-25: every operation ported, protocol tests pass. Real PACE Pro (W332,
   V3.2206.0) driven by CorosLink 0.1.83 with clink-ble in place of `bin/darwin-arm64/coros-corebluetooth`, zero
   errors: connect + watch-key sign-in, weather (file 80), a watch face (113 blocks, ~450 KB in ~31 s), Sync watch
   now (169 SyncData blocks, files 5 and 14, ~700 KB), satellite data (files 13 and 70). The first real try found
   the blocking connect bug fixed in 5f32137. Not yet tried: routes, music list/delete, phone notifications.
2. **clink-ble on Windows and Linux** — written 2026-11-25, **never run**: Windows pairs (WinRT `DeviceInformation.Pairing`,
   `windows` crate) only when a subscribe is refused unpaired, and removes a Windows pairing the watch no longer
   honours, then retries once (as `scripts/coros-system-ble.py`); Linux pairs through BlueZ (Device1.Pair) before
   connecting, with the desktop's own pairing agent. Clippy is clean for both targets (Linux checked against a
   stub dbus, so linking is untried). btleplug only says "protocol error"/"access denied", not the ATT code, so
   Windows' "needs pairing" test is broader than the Python's. Next: the same real-watch run on each; CI builds the
   helper on each platform.
3. **The engine in TypeScript** — every phase written 2026-11-25 (branch `claude/watch-engine`), **not yet run on a
   real watch**. A clean TypeScript port of **CorosKit** (Swift, the iPhone app's watch library), not CorosLink: the
   desktop hands back the same sync items as the iPhone (the phone's sync contract). Code:
   `desktop/main/watch/engine/`. `WatchEngine` answers every command of the CorosKit helper
   (`native/watch/Sources/clink-watch/main.swift`) with the same answers, error texts and events (found, step,
   progress, disconnected), one command at a time with `cancel` answered at once, so `watch/service.ts` drives
   either (`WatchDriver`). `BleLink` (transport.ts) is CorosKit's `WatchTransport` over clink-ble.
   - **A** — bytes/checksums, models + features, SystemBind, settings switches, clock; hello, scan, connect,
     status, disconnect, cancel.
   - **B** — `sync` (sync.ts) as the helper's `Syncer.sync`: changes first, pedometer, daily history (file 5) →
     `WatchHealth` → `health.day`/`health.night`, settings file 54 → sleep profile + satellite mode, profile,
     goals, alarms, storage, sport records (file 14) → `activity` + FIT + `activity.detail` once, battery history,
     `watch.state` with `via: "computer"`; kept in the helper's `Kept` layout (kept.ts), so either driver reads what
     the other left. `signIn` (accountLogin.ts, CorosAccountLogin).
   - **C** — `apply`, `settings`, `setSwitch`, `setProfile` (zone type maxHR/reserve/threshold), `setSleep`,
     `weather` (weather.ts: Open-Meteo + air quality + tides → file 80), `ring`.
   - **D** — `faces`, `showFace`, `install`, `routes`, `syncRoute`, `storage`, `mapTasks`, `mapReady`,
     `mapStart`, `mapRemove`, `activityScreens`.
   - **clink-ble gaps** — closed (table above): file 54 reads, refusal codes, files 54/84 sent, `exchangeFrames`,
     `interactive` events. The engine doesn't use `interactive` yet (no live-workout screen).
   - **E** — the engine is Local mode's driver on every platform (main.ts); clink-ble is packaged
     (`extraResources`) and built universal in `release.yml`.
   - **Tests** (`npm run check`): CorosKit's own tests ported per piece, and goldens made by running CorosKit
     itself where its tests state no value: SystemBind vectors; FIT files byte for byte from CorosKit's sport-record
     fixtures, and their items; health.json and health items step by step against CorosKit (four daily-history
     files, a file restart, naps); weather files for recorded Open-Meteo answers; route and face files; sign-in
     requests and key. sync.test.ts runs a whole sync over a stand-in watch.
   - **Real-watch run 2026-11-25 (PACE Pro W332, V3.2206.0, macOS, the engine as Local mode's driver)**: connect +
     SystemBind (bound) + clock; full syncs with no problems (44 workouts, 3 health days, 2 nights, no duplicate
     activities against what the CorosKit helper had stored); settings read (31 switches, profile, sleep schedule);
     writes read back and restored: a switch (stormAlert), sleep schedule, zone type (zones identical after);
     faces listed, shown slot changed and back; ring accepted (status 1); a step goal through the Watch page's
     waiting changes applied by sync. Quirk (service.ts, same with the CorosKit helper): watch.state shows a new
     step goal only from the second sync, because the saved stepGoal passed into the sync updates after it.
     Not yet tried on the watch: install a face, routes, maps, weather, alarms through the engine, COROS sign-in.
   - **Unverified / different from CorosKit**:
     - Nothing above has run against a real watch; the sign-in hasn't run against COROS's servers.
     - Face install: clink-ble's `watchfaceBlock` answers only "done", not whether the watch asked for the data or
       already had the block, so CorosKit's check of a block claimed after data was needed is left out, and the
       refill pass resends every block rather than only missing ones. A stuck block's disconnect waits behind
       clink-ble's own 15–20 s timeout.
     - The watch key's JSON keys are written sorted (Swift's JSONEncoder order isn't fixed); readers ignore order.
     - Values over 2^53 (raw 64-bit sport-record samples, storage sizes) lose precision; gear ids stay exact.
     - Not ported (the helper never used them): `WatchHealth.filling`, `DailyHistory.restoring`, strength
       sets / swim lengths in recordings, the lap table.
     - Two copies of small things to fold later: storage decoding (storage.ts, maps.ts) and the record walker
       (dailyHistory.ts, sportRecord.ts); two watch stand-ins (watchData.fake.ts, simulatedWatch.ts).
   - **Old helper removed 2026-11-25** after the real-watch run: `native/watch`, the CorosKit checkout and
     `COROSKIT_TOKEN` in `release.yml`, `clink-watch` in `extraResources`, `CLINK_WATCH_ENGINE=swift`. Tests drive
     Local mode through `watch/lineDriver.ts`.
   - **Real-watch test** (Local mode, in `npm run dev` on a Mac, or a packaged build; `CLINK_BLE_DEBUG=1` for
     clink-ble's debug lines). Pair with the COROS account the watch uses, then check, in order:
     1. Settings → Local mode: COROS sign-in (region), scan finds the watch, pair connects ("signing in" step).
     2. /watch: Sync now. Progress steps show; the page then has battery, storage, goals, today, alarms, GPS mode,
        sleep schedule and "with this computer"; Activities and Health get the watch's workouts, days and nights
        (compare a workout and last night with the phone's C-LINK). Sync again: quicker, no repeats.
     3. /watch writes, each read back by a sync: a goal, an alarm, GPS mode, sleep schedule, a switch, the
        training profile (zone type), weather place (the watch's weather shows it), Find my watch (rings until the
        back button).
     4. Studio → Watch: read the slots, show a face, install a face; Maps → Watch: send a route (and cancel one
        midway), storage, the watch's map downloads list.
     5. Unplug/turn off Bluetooth mid-sync: the page says the watch disconnected; the next sync carries on.
     Anything wrong: Settings → Error logs (Copy error report) has the engine's and clink-ble's lines.
4. **Ship all three.** electron-builder for Windows (NSIS) and Linux (AppImage, deb) with CorosLink's artifact
   names; `release.yml` builds all three and drafts one release with `latest.yml`, `latest-linux.yml` and
   `latest-mac.yml`, so CorosLink on every platform updates to C-LINK. `native/watch` and `COROSKIT_TOKEN` go.
