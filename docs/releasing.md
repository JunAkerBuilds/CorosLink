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

3. Nothing is published until the **dependency scan** and all three platform builds pass. The dependency scan ([dependency-scan.yml](.github/workflows/dependency-scan.yml)) runs [OSV-Scanner](https://google.github.io/osv-scanner/) over `package-lock.json` (dev dependencies included, since Electron and `ffmpeg-static` ship inside the app), the vendored Python packages, and the bundled yt-dlp. Any known vulnerability fails it. It also runs on pushes, pull requests and weekly, so new advisories show up between releases. Run it locally with `npm run security:deps` (needs `brew install osv-scanner`).

   CI no longer malware-scans the installers because it added half an hour to every release. To scan by hand, download the installers into a folder and run [scripts/scan-release-artifacts.sh](scripts/scan-release-artifacts.sh) on it (needs ClamAV, 7-Zip and squashfs-tools). It unpacks each app (and its `app.asar`) and fails on any detection other than the known ClamAV false positive it lists.

4. The publish job is the only job with write access. It adds `SHA256SUMS.txt` to the release and records [build provenance attestations](https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations) for every file, which anyone can check with `gh attestation verify <file> --repo JunAkerBuilds/CorosLink`.

You can also run the workflow manually from **Actions → Release installers**. Run from a branch, it builds, signs and scans dependencies but skips publishing, which makes it a dry run of the release. Run from a tag, it publishes that tag.

Actions are pinned to commit SHAs. `prepare-binaries` checks yt-dlp, ffmpeg, CPython and the ytmusicapi wheels against SHA-256 pins before bundling them (see [bin/README.md](bin/README.md)).

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
