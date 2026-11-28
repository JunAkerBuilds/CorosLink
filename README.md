# C-LINK Desktop

The desktop app for C-LINK, built from the ground up to replace CorosLink. It is a local app: your data lives on
this computer, your phone syncs straight to it, and there is no C-LINK account and no C-LINK cloud.

## How it fits together

- **Screens** — `src/` holds the screens and their server-side code. It started as a copy of another C-LINK
  codebase and is now this app's own. The pages under `src/app/(app)` are found by `desktop/renderer/routes.tsx` and
  load when first opened.
- **Next.js stand-ins** — `desktop/shims/` gives the code in `src/` the few Next.js pieces it uses (`next/link`,
  `next/navigation`, `next/image`, `next/dynamic`, `next/server`, `next/headers`) so it runs without Next.
- **One private origin** — the window shows `clink://app`. The same origin answers `/api/*` from the main
  process (`desktop/main/api.ts`) by calling the route handlers in `src/app/api`. Their cookies stay
  in the main process, encrypted with the OS keychain (`desktop/main/cookieJar.ts`); the page never sees them.
- **Everything on this computer** — the main process keeps every synced item in SQLite (`clink.db` in the app's
  data folder, Node's built-in `node:sqlite`) and answers the sync API itself (`desktop/main/localStore.ts`,
  `src/server/local/http.ts`). The app is always signed in to it: there is no account to create. A phone paired in
  Settings → Computers (`desktop/main/phones`, `phones.db`) syncs straight to it.
- **Locked-down window** — sandboxed renderer, no Node in the page, a strict Content-Security-Policy, links to
  other sites open in the browser.
- **Fast by default** — the React Compiler builds every screen, each screen and heavy library (Mapbox) loads only
  when used, fonts are bundled (works offline), the window shows only once it has drawn.

Not in CorosLink and not copied from it: the watch engine (Bluetooth, faces, maps, music) is still to come, ported
item by item from `CorosLink/docs/replacement-checklist.md` without its bloat.

## Commands

| | |
|---|---|
| `npm run dev` | The app with hot reload of the screens. Development builds keep their own data folder, `C-LINK Dev`; set `CLINK_USER_DATA` to use another. |
| `npm run dev:sample` | The same, with the sample athlete loaded into an empty store to look around. |
| `npm run build` then `npm start` | The built app. The build first puts the pinned yt-dlp and ffmpeg in `bin/<platform>-<arch>` (see `bin/README.md`). |
| `npm run binaries:prepare` / `binaries:pin` | Fetch the SHA-256-checked yt-dlp and ffmpeg for Media's downloads / re-pin them from GitHub's release digests. |
| `npm run check` | Type check, lint and all tests. |
| `CLINK_SMOKE=<folder> CLINK_USER_DATA=<empty folder> npm start` | Opens every screen, saves a screenshot of each, any console errors and a test write to `<folder>`, then quits. Add `CLINK_SAMPLE=1` for the sample athlete, `CLINK_SMOKE_SCREENS=/studio,…` for just those screens (`/studio/blank` makes a blank face and builds it up), `CLINK_SMOKE_THEME=light` or `dark` for one look, `CLINK_SMOKE_LANG=es`, `de`, `pt-BR` or `zh-Hans` for one language. `CLINK_SMOKE_MCP=1` adds the fixture MCP server (`scripts/mcp-fixture.mjs`) with one tool on, and `CLINK_SMOKE_COACH="…"` asks Coach that and logs the tools it used. The intro is `/welcome?scene=1`…`5`; `/welcome/move/run` shows the move from CorosLink picking, copying and done. `/updates` opens Updates from the account menu, then previews the update prompt (found, downloading, ready); it turns developer mode on. |
| `CLINK_INTRO=1 npm run dev` | Shows the first-run intro again (also Developer → First-run intro). `CLINK_COROSLINK_DIR=<folder>` reads that CorosLink folder instead of finding one, `CLINK_MOVE_PACE_MS=<ms>` slows the copy down to watch it. |

Settings come from the environment: `MAPBOX_TOKEN`. For development only: `COACH_MODEL=mock` lets a scripted
stand-in answer Coach when no AI is picked, and `HEVY_API=mock` makes up Hevy workouts. AI is set up in the app (C-LINK → Coach Settings…, or ⌘, from inside Coach; elsewhere ⌘, opens Settings),
not in the environment.

## AI

Coach settings (`/coach/settings`, `desktop/renderer/pages/CoachSettings.tsx`) picks who answers Coach, workout notes, meal estimates and chat
titles. The main process (`desktop/main/ai/service.ts`) is `hostAI` (`src/server/ai/host.ts`), so every AI route in
`src/app/api` asks the picked provider; there is no other AI. Keys and sign-in tokens are kept encrypted with the OS keychain
(`ai-secrets.bin`); the page never sees them.

- **API key**: OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter, Qwen, Xiaomi MiMo (`ai/keyed.ts`, `ai/gemini.ts`).
  A key is checked by listing the models and getting one short answer.
- **On this computer**: Ollama, LM Studio or any OpenAI-compatible server; plain http only on this computer or the
  local network.
- **Sign in**: ChatGPT (the Codex sign-in, `ai/chatgpt.ts`), and programs the athlete installed and signed in to:
  Claude Code (`ai/claudeCode.ts`), Gemini CLI and OpenCode (`ai/geminiCli.ts`, `ai/opencode.ts`), and Antigravity,
  whose runtime is downloaded from Google on first sign-in (`ai/antigravity.ts`). These run their own tool loop;
  they reach only Coach's tools through a bearer-token MCP bridge on 127.0.0.1 (`ai/bridge.ts`), and each call is
  held open so Coach's loop runs it and draws its cards (`ai/agent.ts`).

## COROS account import

For a watch that stays paired to the COROS app: Connections → COROS account (one card with both ways in, COROS's MCP
and Training Hub), or "My COROS account" in first-run setup. Connect signs in to COROS's MCP (`https://mcp.coros.com/mcp`) in the browser, as one of Coach's MCP servers
(`desktop/main/account/corosMcp.ts`). Then, on a timer, `desktop/main/account/service.ts` refreshes the token and
runs the helper as `clink-watch --account` (`native/watch/Sources/clink-watch/Account.swift`). With the iPhone app's
CorosKit, the helper reads activities, daily health and sleep (`CorosTraining.load`) and each activity's FIT file,
and hands back the phone's own `activity`, `activity.detail`, `health.day` and `health.night` items for the store.
When the athlete is signed in to COROS Training Hub (Connections), recordings come from Training Hub's own download
first, which has no daily allowance (`desktop/main/account/hubFit.ts`, up to 150 a run). The MCP fills in the rest,
at most 40 a day, because COROS allows 50 FIT files a day.
Mac only, like the watch helper.

## One athlete, many sources

The phone's C-LINK, the COROS account import and Local mode's watch all write `activity`, `activity.detail`,
`health.day` and `health.night` into the store. For those four the store combines rather than replaces
(`desktop/main/combine.ts`): a field one source has and another lacks is kept, where both have one the fuller wins
(a longer stream, a route, a night with stages), else the newest. One workout under two ids (COROS's number, the
watch's own) is matched by start within 90 s and sport, kept once, and the second id remembered (`aliases`), so its
detail lands there too. Everything an athlete types keeps the plain sync rules.

## Studio

Studio (`/studio`, `desktop/renderer/pages/Studio.tsx` and `StudioEditor.tsx`) makes watch faces on this computer. A face
is a list of layers on a 454 × 454 dial (`desktop/shared/studio.ts`, shared by the page and the main process): the
time, the date, live data, status icons, a progress ring, text, shapes and pictures. The editor adds them from a
library (click for the next free spot inside the ring, or drag onto the watch), moves them by dragging with snapping to
the centre, colours them from the bar above the watch, simulates time, battery and weather, and undoes with ⌘Z. Faces
are saved a moment after each change as `studio/faces/<id>.json` in the data folder (`desktop/main/studio.ts`, at
`/api/desktop/studio`), and can be saved as and imported from a `.clinkface` file.

The home page browses COROS's templates, its official faces and the faces saved to your COROS account (sign in from
the COROS account chip; the session is sealed with the keychain in `studio/coros-account.bin`) and the reviewed
Community faces from watchfaces.coroslink.com; each opens as a project (`desktop/main/watchface/community.ts`,
`corosAccount.ts`). Watchmaker, the AI tab, runs the Codex CLI you installed and signed in to (`codex login`).
Not in Studio yet: sending to the watch (needs the watch engine). See `docs/studio-port.md`.

## Not done yet

- The watch over Bluetooth and USB, packaging, signing and updates. A package must carry `bin/<platform>-<arch>` as
  `<resources>/bin/<platform>-<arch>`, where Media looks for yt-dlp and ffmpeg.
