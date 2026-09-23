# Official COROS asset library

Watch Face Studio can reuse the artwork inside every official COROS face:
digit fonts, battery gauges, weather glyphs, status icons, backgrounds and so
on. The library is prebuilt from the official catalog and hosted on an
S3-compatible bucket that only the app reads; the app keeps a small on-disk
cache and falls back to building the library locally when the bucket is
unreachable.

## Hosting

```sh
npm run assets:harvest      # download every official face for all models → output/coros-official-faces/
npm run assets:library      # decode + dedupe + classify → output/coros-asset-library/
ASSET_BUCKET_ENDPOINT=https://<account>.r2.cloudflarestorage.com \
ASSET_BUCKET_NAME=coroslink-assets ASSET_BUCKET_ACCESS_KEY_ID=… ASSET_BUCKET_SECRET_ACCESS_KEY=… \
npm run assets:publish      # layout + upload (idempotent: content-hashed objects are skipped)
```

`npm run assets:publish -- --layout-only` writes `output/coros-asset-hosted/`
without uploading. The hosted tree (Sep 2026: 53k sets, ~940 MB, 106k objects):

```
<prefix>/v1/manifest.json                 models → index path and counts   (cache 1 h)
<prefix>/v1/models/<slug>/library.json    per-watch index, gzip-encoded   (1.8–4 MB raw, ≈170–500 KB wire)
<prefix>/v1/assets/<hash>/strip.png       preview strip                   (immutable)
<prefix>/v1/assets/<hash>/<hash>.zip      all frames + README             (immutable)
```

The app reads `COROSLINK_ASSET_LIBRARY_URL` (default
`https://coroslink-assets.akerrules.ca/official-faces`, a custom domain on the
Cloudflare R2 bucket `coroslink-assets`; the bucket's r2.dev URL is disabled
because r2.dev is rate-limited and not meant for production) and sends
`X-CorosLink-Client: coroslink/<version>` on every request. The domain is
unlisted; to make it strictly app-only, add a WAF custom rule on the
`akerrules.ca` zone (Security → WAF → Custom rules) that blocks:

```
(http.host eq "coroslink-assets.akerrules.ca" and not http.request.headers["x-coroslink-client"][0] contains "coroslink/")
```

This is not a secret (any desktop client can be inspected); it keeps the URL
from turning into a public download page, which is the goal.

## In the app

- **Add menu → Official** adds one frame of any set as an image layer.
- **Custom PNG font → Official COROS font** imports a digit set (10 frames) or
  weekday/month label set as a raster font through the same path as a PNG
  sprite folder.
- **Template image → Official** replaces a config image (`*_icon`) with a frame.
- **Battery states → Official sprites** imports a multi-frame set as the
  battery state folder (`config:battery_icon` / `config:control_battery_icon`).

All of these open `src/watchfaces/OfficialAssetBrowser.tsx`, which talks to
`electron/corosOfficialAssetService.ts` over four IPC calls:

| IPC | Purpose |
| --- | --- |
| `watchfaces:officialAssets:ensure` | Start a build for a firmware type if no library exists (`rebuild: true` forces a refresh); returns status immediately. |
| `watchfaces:officialAssets:status` | Poll `facesDone / facesTotal` while building. |
| `watchfaces:officialAssets:list` | Filter by category, font role, free text and single/multi frame; paginated with sprite-strip previews. |
| `watchfaces:officialAssets:frames` | Every frame of one set as PNG data URLs. |

### Cache layout

```
<userData>/official-asset-library/<firmware>/
  library.json               index (source: "hosted" | "local", refreshed daily when hosted)
  assets/<hash>/strip.png    fetched as pages are browsed
  assets/<hash>/<hash>.zip   fetched when a set is picked, expanded to NN.png
  faces/<themeId>.bin        only for local builds
```

Hosted: a PACE Pro index arrives in about a second and browsing a page costs
36 small strip downloads. Local fallback: PACE 4 (239 faces) builds in ~30 s,
PACE Pro in ~40 s, and needs a signed-in COROS mobile session.

## How sets are classified

`electron/corosOfficialAssetLibrary.ts` runs `decodeCorosLayout` on each
binary and records which layout elements reference each bitmap group. A group
referenced through a `*_font` config key is a **font** (with a role: time,
date, weather, complication, battery, data); otherwise the first matching
element-id prefix decides the category (`battery`, `weather.*`,
`sunriseset.*`/`control.sun*`, glyphs such as colon/percent/unit, `time.*`,
status icons, health, training/complications, `date.*`, `chart.*`,
backgrounds). Groups no element references land in **other**. Identical pixel
content across faces collapses into one set (16-hex content hash).

## Scripts

```sh
electron scripts/smoke-official-asset-library.cjs "COROS W336"   # exercise the in-app service end to end
COROSLINK_ASSET_LIBRARY_URL=http://127.0.0.1:8790 electron scripts/smoke-official-asset-library.cjs "COROS W332"   # against a locally served hosted layout
```

Scripts need `npm run build:electron` first; the Electron ones set
`app.setName("coroslink")` so `safeStorage` can decrypt the stored session.
Artwork remains © COROS; the browser says so.
