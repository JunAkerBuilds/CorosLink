# Changelog

All notable changes to CorosLink are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
