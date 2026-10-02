# Bundled binaries

Run the binary preparation script before running `npm run dist`:

```sh
npm run binaries:prepare
```

It downloads the pinned yt-dlp release asset, copies the `ffmpeg-static` binary,
vendors a self-contained CPython runtime (from `astral-sh/python-build-standalone`)
so users don't need Python installed, and vendors the pinned `ytmusicapi` Python
package plus dependencies into this folder.

Every download is checked against a SHA-256 pin before it is bundled, and the
build stops if anything differs:

- `scripts/bundled-binaries.lock.json` pins the yt-dlp, ffmpeg and CPython
  versions and the hash of each platform's file.
- `scripts/bundled-python-requirements.txt` pins `ytmusicapi` and each of its
  dependencies to a wheel hash; pip installs it with `--require-hashes`.

To change versions, re-pin instead of editing hashes by hand. The script reads
the SHA-256 digests GitHub records for each release asset:

```sh
npm run binaries:pin -- --yt-dlp=latest          # or --yt-dlp=2026.09.01
npm run binaries:pin -- --python-release=20260101 --python-version=3.11.14
npm run binaries:pin -- --ytmusicapi=1.12.1      # re-resolves the Python lock
npm run binaries:pin                              # after upgrading ffmpeg-static
```

Review the diff before committing: a pin only proves the file is the one that
was on the release when you ran the script.

Recommended layout:

- `bin/darwin-arm64/yt-dlp`
- `bin/darwin-arm64/ffmpeg`
- `bin/darwin-arm64/python-runtime/bin/python3`
- `bin/darwin-arm64/python/ytmusicapi`
- `bin/darwin-x64/yt-dlp`
- `bin/darwin-x64/ffmpeg`
- `bin/darwin-x64/python-runtime/bin/python3`
- `bin/darwin-x64/python/ytmusicapi`
- `bin/win32-x64/yt-dlp.exe`
- `bin/win32-x64/ffmpeg.exe`
- `bin/win32-x64/python-runtime/python.exe`
- `bin/win32-x64/python/ytmusicapi`

During development, the app also falls back to `yt-dlp` and `ffmpeg` on `PATH`.
For YouTube Music, the app runs the bundled `python-runtime` interpreter (falling
back to a system `python3`/`python` ≥ 3.10 only if the runtime is absent) and
prepends the bundled `python` directory to `PYTHONPATH` so `ytmusicapi` resolves
without any user setup.
