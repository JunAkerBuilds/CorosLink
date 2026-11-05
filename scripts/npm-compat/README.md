# npm compatibility shims

Build-tool dependencies (electron-builder, @electron/asar 3, electron-winstaller)
still pull in minimatch < 11, which has GHSA-g3hv-75wg-m249 and no patched
3.x/5.x/9.x/10.x release. `package.json` overrides send them here instead:

- `minimatch/` is every `minimatch` in the tree (`"minimatch": "$minimatch"`).
  Its named exports are minimatch 11 (root devDependency `minimatch-11`). It
  adds back the callable default export that @electron/asar 3 and dir-compare 4
  call, which keeps minimatch 3's Windows behaviour of reading `\` in patterns
  as a path separator. Named-export callers get minimatch 11 as is.
- `glob-callback/` is every glob 7 in the tree (`"glob@^7": "$glob"`), used by
  @electron/asar 3 and rimraf 2. glob 7 reads minimatch 3 internals and cannot
  run on minimatch 11. The adapter covers `glob(pattern, options, cb)`,
  `glob.sync` and `glob.hasMagic` on glob 14 (root devDependency `glob-14`),
  sorted and `/`-separated like glob 7. It has no `Glob`/`GlobSync` classes, so
  check `npm ls glob` when a new dependency brings in glob 7.

Because the root `glob` and `minimatch` are these shims, import `glob-14` or
`minimatch-11` in project code, not `glob` or `minimatch`.

Overrides that point at a `file:` package only resolve correctly when the
overridden name is a root dependency of the same name (`$minimatch`, `$glob`);
otherwise npm resolves the path relative to the dependent package.

Remove both shims, with their overrides and the `minimatch-11`/`glob-14`
aliases, once `npm ls minimatch` would show only minimatch 11 without them
(electron-builder on @electron/asar 4, and dir-compare, ejs and rimraf
updated).
