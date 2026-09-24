# Packaging and releasing

Maintainer notes for building installers and shipping releases.

```sh
npm run dist
```

Before packaging, run `npm run binaries:prepare`. The packaged app checks bundled binaries first, then falls back to `PATH`.

Convenience target scripts:

```sh
npm run dist:mac
npm run dist:win
npm run dist:linux
```

For a quick local packaging layout check without code signing:

```sh
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist -- --dir
```

Because `better-sqlite3` is native, build Windows installers on Windows or in CI where Electron native dependencies can be rebuilt for the Windows target. The same applies to Linux AppImages on Linux.

**Publishing a release (maintainers):**

1. Prepare the version in `package.json` and `package-lock.json` so they match the tag you are about to create:

```sh
npm run release:prepare -- v0.1.18
git commit -am "chore: release v0.1.18"
git tag v0.1.18
git push origin main v0.1.18
```

2. That triggers the [Release installers](.github/workflows/release.yml) workflow. CI syncs the tag into `package.json` before building, then verifies the versions match, so installer names like `CorosLink-0.1.18-arm64.dmg` and `CorosLink-0.1.18-x64.dmg` always follow the git tag. The workflow also uploads `latest-mac.yml`, `latest-linux.yml`, and `latest.yml` plus macOS/Windows blockmaps so packaged apps can auto-update via `electron-updater` (Linux AppImage embeds its blockmap in the file). Each platform build runs `scripts/verify-release-artifacts.mjs` and fails if update metadata is missing.

You can also run the workflow manually from **Actions → Release installers** (it uses the current `package.json` version when no tag is pushed).

Pushes to `main` run [Build desktop installers](.github/workflows/build.yml) and upload CI artifacts for testing before tagging.

**Verify release artifacts locally:**

```sh
npm run dist:mac    # or dist:win / dist:linux on the matching OS
npm run release:verify-artifacts -- macos
```

After building, confirm `release/latest-mac.yml` (or `latest.yml` / `latest-linux.yml`) exists and that the packaged app contains `app-update.yml` with the GitHub publish config.

**Test auto-update end-to-end (maintainers):**

1. Tag and ship a baseline release that includes the updater (e.g. v0.1.8).
2. Install that build from GitHub Releases on a test machine.
3. Confirm the header shows a clickable version badge (not dev-only text).
4. Tag and ship a newer release (e.g. v0.1.9).
5. In the older app, wait ~5 seconds or click the version badge.
6. Expect: checking → update available → downloading → **Restart to update**.
7. Click restart; the app should relaunch on the new version.

**Windows** and **signed macOS** builds should complete this flow. Locally built unsigned macOS apps may still need a manual download from GitHub Releases.
