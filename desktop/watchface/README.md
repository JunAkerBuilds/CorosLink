# Watch-face engine

Moved from CorosLink at `c2ff5110` (see `docs/studio-port.md`): the parts the watch depends on byte for byte, kept as
they were apart from import paths, an English-only `engine/text.ts` in place of CorosLink's translations, and a few
unused names removed for lint.

- `types.ts`: the watch-face types from CorosLink's `electron/types.ts`, nothing else.
- `watchModels.ts`, `watchfaceTargets.ts`, `watchfaceNativeCatalog.ts`: the 13 watches and their native data fields.
- `recoverBin.ts`: recovering a compiled face (BIN) as an editable starter, from `corosCompiledWatchface.ts`.
- `compiler/`: the TypeScript port of COROS's 4.9.9 compiler (main process, worker thread).
- `engine/`: template composition, design state, fonts, sprites, AOD, data, simulation, conversion (the page).
- `assets/weather`: the bundled weather icon sets.
- `tests/`: CorosLink's tests for these files, run by `coroslink.test.ts`.

When fixing something here, fix it the same way in CorosLink while both apps ship.
