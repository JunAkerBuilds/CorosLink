# C-LINK Desktop: rules for working here

- `src/` is this app's own fork (it began as a copy of C-LINK Web) and is not mirrored anywhere: change it here
  only. Keep its ways (design tokens, shared pieces in `src/components/ui`, the data layer in `src/data`, full
  precision, little text). Desktop-only code lives in `desktop/`.
- The app is local: its data lives on this computer (`desktop/main/localStore.ts`) and the paired phone syncs
  straight to it. There is no C-LINK account and no C-LINK cloud, and no code here calls a C-LINK server (the public
  Community face catalog Studio reads is the one exception). AI is only the athlete's own pick in Coach settings.
- Nothing from CorosLink is copied in as it is. When a CorosLink feature comes over, rewrite it to these rules and
  carry its "Must not regress" notes from `CorosLink/docs/replacement-checklist.md` over as tests.
- The page stays sandboxed: no Node in the renderer, no `nodeIntegration`, no new IPC unless a screen can't be
  served through `clink://app/api`. Secrets live in the main process, encrypted with `safeStorage`.
- Performance: every screen and heavy library loads on demand; work over ~16 ms (file parsing, compiling,
  big sums) runs off the screen thread; long lists are virtualised.
- `npm run check` passes before a commit. Check screens with `CLINK_SMOKE` (see the README) and look at the shots.
