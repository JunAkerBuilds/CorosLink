# Bundled binaries

yt-dlp (saves a song from YouTube as an MP3) and ffmpeg (converts audio and joins tracks into one MP3) go in
`bin/<platform>-<arch>/`. They aren't committed; put them here with:

```sh
npm run binaries:prepare                                   # this computer's platform (npm run build does this too)
node scripts/prepare-binaries.mjs --platform=darwin --arch=x64
node scripts/prepare-binaries.mjs --from=<folder>          # copy from a folder instead of downloading
```

Every file is checked against its SHA-256 in `scripts/binaries.lock.json` before it's kept, and the script stops if
anything differs. A file already here that matches isn't fetched again.

To move to another release, re-pin instead of editing hashes by hand (the digests come from GitHub's release data):

```sh
npm run binaries:pin -- --yt-dlp=latest        # or --yt-dlp=2026.09.01
npm run binaries:pin -- --ffmpeg=b6.1.1        # an eugeneware/ffmpeg-static release
npm run binaries:pin                           # re-read the digests for the pinned versions
```

Review the diff: a pin only proves the file is the one that was on the release when you ran it.

Layout: `bin/darwin-arm64/yt-dlp`, `bin/darwin-arm64/ffmpeg`, `bin/darwin-x64/…`, `bin/win32-x64/yt-dlp.exe`,
`bin/win32-x64/ffmpeg.exe`, `bin/linux-x64/…`. A packaged app carries the folder for its platform as
`<resources>/bin/<platform>-<arch>`. The app looks in `CLINK_BIN_DIR` (when set), then there, then in Homebrew and
the PATH (`desktop/main/media/tools.ts`).

ffmpeg is ffmpeg-static's build, which is GPL: the app runs it as a separate program and never links it.
