# npm compatibility shims

Build-tool dependencies (electron-builder, @electron/asar 3) still pull in
minimatch < 11, which has GHSA-g3hv-75wg-m249 and no patched 3.x/5.x/9.x/10.x
release. `package.json` overrides send every `minimatch` here instead:

- `minimatch/` re-exports minimatch 11 (root devDependency `minimatch-11`) and
  adds back the callable default export that @electron/asar 3 and dir-compare 4
  call.
- `glob-callback/` gives @electron/asar 3 the glob 7 callback API on top of
  glob 14 (root devDependency `glob-14`). glob 7 reads minimatch 3 internals
  and cannot run on minimatch 11.

Remove both, with their overrides and the `minimatch-11`/`glob-14` aliases,
once electron-builder ships @electron/asar 4 and drops dir-compare/ejs on old
minimatch (`npm ls minimatch` shows only 11).
