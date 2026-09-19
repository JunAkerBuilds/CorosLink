# Partial compiled layout recovery

Implemented by `scripts/decompile-coros-watchface-layout.mjs`, with the field
schema in `electron/corosBinLayout.ts` (also used by the CLI) and a reference renderer in
`scripts/render-coros-layout.mjs`.

```sh
node scripts/decompile-coros-watchface-layout.mjs '/path/to/official.bin' '/path/to/new-output'
node scripts/render-coros-layout.mjs '/path/to/new-output/layout.json'
node scripts/test-coros-bin-layout.mjs
node scripts/test-coros-watchface-bin-extraction.mjs
```

The output directory must be new. Recovery produces an editable `layout.json`,
numbered PNG assets, partial `config.txt` / `AODconfig.txt` drafts, previews with
logged sample values, raw headers, and an exact `source.bin` copy. There is no
binary patching, compiler invocation, device installation, or live editor change.
JSON edits affect the reference preview; they do not update the config drafts.

## Open official faces in the app

Official catalog cards offer **Download** and **Open in editor**. Download keeps
the original package in Downloads/COROS watchfaces. Open in editor recovers a
local editable starter through `electron/corosCompiledWatchface.ts`, retains the
original source and layout report inside that starter, and opens the existing
editor. The starter lives under the app's `watchface-official-editor` directory;
saving creates an ordinary project. No Python or external compiler is required.

The same format limits below apply. Unsupported packages report an error and
remain downloadable. Recovered faces show a partial-recovery notice. Fonts,
indexed colors, transparency, normal/AOD geometry and known weather/numeric
assets are retained. PLANET's combined date is translated into editable month
and day fields, and its eleven stamina frames and battery percent image are
rendered. Other unsupported state/chart behavior still needs further recovery.
Native numeric layers currently use the recovered
rectangle, glyph size and horizontal alignment. Their previews support up to
six characters, including five-digit weekly totals. NOMAD's chart block, wind
direction table and solar angle are recovered as described below.

The offline Electron test exercises the actual catalog buttons, service,
preload, editor, Current/AOD preview, validation and project saving:

```sh
npm run build:electron
electron scripts/test-official-watchface-editor.cjs '/path/to/PLANET.bin'
```

Omit the binary path to use the synthetic fixture. The test isolates app data
and downloads and stubs the network and keychain.

## Evidence and scope

The layout map comes from static disassembly of the Android ARM64
`libw4-watchface.so` shipped in COROS 4.9.9, SHA-256
`0ae044c6507cb37357799db49bfe71cc2bf6490d045ea825a8c42676041b925c`.
It was compared with the official PLANET `614A` v4 binary, SHA-256
`3dbef479746f6c4e10c72670ff5cb26efe2b1bb65cdb7ca081b777f1eb74595b`.
The library was inspected as data, not executed.

The magic is the screen size reversed plus a variant letter: `614A` = A416
(AMOLED PACE Pro / APEX 4 catalogs at 416px) and `062R` = R260 (the 260px
faces served for MIP watches such as APEX 4 46 mm and NOMAD). Every
generation shares one record table that simply ends earlier in older or
smaller headers: `0xbaa` (260px v0, after the date tables), `0xfd8` (416px v2
DAWN / JOY HOL, after the chart block), `0x1164` (v4), `0x11a0` (NOMAD v2)
and `0x1202` (4.9.9 exporter). A version-0 header leaves `0x138` empty, so
the background pointer at `0x1a` (always the first bitmap) marks its end.
Records that would sit beyond a header's end are skipped, never guessed.
This is deliberately a partial format decoder. Unknown bytes are preserved, not
silently converted into guessed source keys.

## MIP bitmaps (`0x0802`)

AMOLED blocks are `w u16, h u16, 0x2002, n u8, ver u8, six reserved bytes,
n × u32 frame ends` with palette (version 1) or RGBA (version 3) frames. MIP
blocks are `w, h, 0x0802, n, 0, four reserved bytes, n × u16 frame ends`
and the same `0xC0|count` RLE stream, but each decoded byte is one pixel:
`aa rr gg bb`, alpha 0 opaque … 3 transparent, channels × 85. Values ≥ 0xC0
(transparent white is 0xff) are encoded as one-byte runs. SIMPLE BLACK 02
(`062R`, 35 KB) decodes to its 260×260 dial, 197×197 thumbnail, 37×53 clock
font, 45×28 weekday set and 12-frame battery table, all matching the
embedded thumbnail; the app opens it as a `watchface_260x260` starter.

## Header structure

All offsets below are relative to a mode's header. Bitmap pointers are absolute
offsets from the start of the file. Integers are little-endian. Icon positions
are two signed 32-bit values; rectangles are four signed 16-bit values followed
by alignment flags. `(0,0)` is a valid position and does not disable an icon.

| Offset | Meaning | Compiler evidence |
| --- | --- | --- |
| `0x000` | `614A` magic | `SetHead` at `0x17bb60` |
| `0x004` | watchface ID | `SetHead` |
| `0x00e` | layout value | `SetHead` |
| `0x010` | theme-off, point layer, time format, default theme flags | `SetHead` |
| `0x012` / `0x01a` | background position / bitmap | `SetBackground` at `0x17bc4c` |
| `0x01e` | embedded catalog thumbnail | `SetBackground` |
| `0x138` / `0x13a` | header size / version | `SetStatus` at `0x17be68` |
| `0x1b0` … `0x1f6` | six time digit records, 14 bytes each | `SetTime` at `0x183850` |
| `0x036` / `0x03e` | sedentary state position / frames (`WFStatusInfo.sedentary`) | `SetStatus` at `0x17d8fc`; formerly misread as touch lock |
| `0x052` / `0x056` | sleep-mode / airplane icons | `SetStatus` at `0x17da9c` / `0x17dae0` |
| `0x2f0` … `0x308` | centre polygon icons, hour/minute/second hand images; centre at `0x2f8` | `SetPoint` at `0x184c94`–`0x184be8` |
| `0x316` | pointer to auxiliary heart-rate record | `SetStatus`, store at `0x17dbfc` |
| `0xd02` … `0xd4a` | UV value/icon, UV level, AQI value/icon, AQI level | `SetWeather` at `0x18ecc8`–`0x18f188` |
| `0x31e` | auto-align record pointer, not decoded | `SetAutoAlign` at `0x184d78` |
| `0x322` | AOD header pointer | `Finish` at `0x17b784` |
| `0x33a` | selectable control origin | `SetControl` at `0x185120` |
| `0x35a` … `0x4c0` | selectable battery (level table + value), temperature, barometer (integer + decimal rects), HR, floor, elevation, sunrise, sunset, step, kcal, exercise, keyed by `WF_DATA_TYPE` | `SetControl`, `Map<int, WFIconValue>::at` |
| `0x4c6` / `0x4ca` | selectable colon / percent glyphs | `SetControl` |
| `0x4ce` … `0x51e` | selectable English/Chinese month, day, week | `SetControl` |
| `0xc4a` / `0xc52` | weather position / daytime images | `SetWeather` at `0x18d3d4` |
| `0xc56` / `0xc60` | temperature rectangle / digit images | `SetWeather` |
| `0xc92` | nighttime weather images | `SetWeather`, `WFWeatherInfo.dark_icon_offset` |
| `0x100a` / `0x1014` | stamina value rectangle / font | `SetExtendedStatus` at `0x1909d4` |
| `0x101c` / `0x1024` | stamina state position / images | `SetExtendedStatus` |
| `0xff2`, `0x1042`, `0x104e` | training-load, stress and sleep-HRV level icons | `SetExtendedStatus` |
| `0x105a` … `0x1070` | barometer icon / value (RUBY HORIZON's fourth weather column) | `SetExtendedStatus`, store at `0x1070` |
| `0x1074` … `0x1146` | today's and weekly run / swim / bike / elevation (`WFMetricValue`, 30 bytes each) | `SetExtendedStatus` |
| `0x1164` … `0x119c` | sunrise/sunset progress: position, rise/set icons, hour/minute rects, font, colon, progress | `SetExtendedStatus`; ends exactly at NOMAD's `0x11a0` |
| `0x11a0` … | sleep score icon / value (only in `0x1202` headers) | `SetExtendedStatus` |

Alignment bits: left=1, horizontal center=2, right=4, top=8, vertical center=16,
bottom=32. The decoder preserves the raw flag as well as interpreted alignment.

**Correction to the old extraction manifest:** `0xc92` is the dark weather set
within the normal header. It is not AOD. AOD weather must be read from the header
located by `0x322`, using that header's own `0xc52` slot. PLANET has both day and
night weather in normal mode, and no AOD weather.

The auxiliary heart-rate record is 34 bytes. Its first 10 bytes contain a
rectangle/alignment, followed by a font pointer. PLANET points to `0x1f2348`,
giving rectangle `{280,240,335,269,left|vcenter}` and the same digit table used by
exercise time. Looking only at the older inline HR slot misses this field.

## PLANET result

- Two headers, at `0x0` and `0x1164`, precede bitmap data at `0x22c8`.
- 31 bitmap groups / 217 frames are preserved with corrected palette lookup.
- 34 normal positioned records and 5 AOD positioned records are recovered. This
  count includes alternatives such as languages, day/night weather and selectable
  controls; they are not all drawn simultaneously.
- All bitmap pointers in both header tables have assigned roles. This is not a
  claim that every non-bitmap field or rendering behavior has been decoded.
- Main visible positions, fonts and alignment were checked against the embedded
  thumbnail. The reconstructed preview draws extracted layers, not that thumbnail.
- AOD keeps some icons with empty associated value rectangles. These links are
  retained as inferred dormant resources; they are not rendered or activated in
  the draft configuration. Live controls with icons at `(0,0)` remain supported.

The record at `0x6aa` contains a rectangle, two digit-table pointers at `0x6b4`
and `0x6b8`, and a separator pointer at `0x6bc`. The assets and thumbnail support
a combined month/day interpretation. No corresponding writer or config binding
was found in 4.9.9. It is therefore explicitly marked **inferred**, rendered with
a sample `4/17`, and omitted from native config drafts. Locale order, zero padding
and variable-width behavior remain unverified. The application importer now
translates that record into standard `english_date_month_*` and
`english_date_day_*` fields using the recovered fonts and centered geometry.
This editable equivalent uses two-digit month/day formatting (e.g. `04/17`);
PLANET's slash remains in its original background. A separate separator is
restored for empty background gaps, as in MULTIDATA ELEV and NOMAD. The original combined
record is retained, and this is not a verified native-format round trip.

PLANET's `stamina_level_icon` is an eleven-frame state folder, not a digit font.
The editor preserves all frames, uses percentage / 10 for preview selection,
and exports `stamina_level_pos` / `stamina_level_icon`. The percentage-to-frame
mapping remains a preview approximation until verified on a watch.

MULTIDATA ELEV exercises additional compiler-backed records: rainfall icon,
value and percent at `0xcc6/0xcd2/0xce0`; humidity at `0xce4/0xcf0/0xcfe`;
today's elevation at `0x10ce/0x10da/0x10e8`; weekly elevation at
`0x1146/0x1152/0x1160`; and selectable exercise at `0x49c/0x4a8/0x4b2`.
These offsets were checked against `SetWeather`, `SetExtendedStatus` and
`SetControl` in the 4.9.9 library. Two-image unit folders are preserved.
Duplicate daily/weekly icons at the same position render once. Dim training
value placeholders are cleared from the editable backdrop only when the
surrounding pixels are uniform; the original background asset remains in the
archive. The graph drawn into MULTIDATA ELEV's background remains static.

GO FISHING was also used as a bounds/link smoke test: 31 groups / 230 frames
extracted, both headers decoded, and every recognized bitmap link resolved.
It still has 34 normal and 21 AOD bitmap references outside the mapped schema;
its layout recovery is less complete than PLANET's.

## Validation and remaining work

Synthetic regression tests cover signed 32-bit positions, signed rectangles,
alignment, non-adjacent AOD headers, separate day/night/AOD assets, indirect HR,
dormant resources versus valid origin coordinates, unknown bitmap references,
raw-byte retention and invalid/truncated pointers and headers. The extraction
regression also checks exact indexed RGBA/alpha and direct RGBA pixels.

PLANET's preserved source hash was verified against its input. Every recognized
asset link resolves, both headers contain no remaining unclassified bitmap
pointers, and the exported AOD draft excludes dormant control icons.

There is no compile/install round-trip validation yet. The reference renderer
uses explicit samples and makes documented assumptions for suffix/colon placement,
state indices, clipping, draw order and the sample sun path. The current export
does not fully recover theme recoloring, combined date, analog hand rotation,
plotted chart history, lunar/fishing arcs, auto-alignment, additional language
tables or other unknown records. A complete
editable importer must decode those features and verify reconstruction through
the compiler before claiming faithful binary round trips.

## NOMAD header variant

The official NOMAD package, SHA-256
`c26b22999bd15d994e5047e8f9bd59f55ca36ccfbf6fdb633ce913f7950b9e0e`, uses
4,512-byte (`0x11a0`) headers at `0` and `0x11a0`, with versions 2 and 0.
The old header allowlist rejected it before reading any images. Its mapped
clock, background, battery, weekday and weather record offsets agree with the
existing decoder and embedded thumbnail. The first bitmap starts at `0x2340`;
45 bitmap groups are retained. All recognized bitmap pointers resolve.

NOMAD stores wind and min/max temperatures in overlapping rectangles. The
importer starts with wind and keeps the min/max alternatives as disabled
editable layers; this is an editor default, not a recovered runtime selection.
Native group origins include icons left of their numbers, keeping all part
offsets valid while preserving the original absolute positions. The wind
direction table is imported as a state layer with its original eight compass
frames (`stateCount: 8`), not padded to the catalog's sixteen-frame default.

## DASHBOARD result

The official DASHBOARD `614A` v4 package (0x1164 headers) decodes with no
unclassified bitmap reference. Beyond the mapped clock/date/weather/control
records it uses `WFStatusInfo.sedentary` (seven 120×120 frames at (148,287):
a seated figure with a filling ring, a "move" frame and a dimmed frame),
`weather_uv_level_icon` (six 386×145 frames at (15,10): unknown, then low →
extreme, including the sun glyph and the "UV" label) with no numeric UV
readout, and a sleep-mode bed icon. Its weekday sets embed a gauge whose
needle marks the day. The selectable control block carries per-language date
records at `0x542…0x5c2` (German/Spanish/French; week fonts verified in the
data) and `0x6ca…0x83a` (Japanese, Thai, Polish, Traditional Chinese,
Portuguese, Italian, Korean, Russian; `Map::at` keys in `SetControl`).

The application imports the sedentary table as a `sedentary` state layer
(seven frames retained) and the UV arc as `weather_uv` level artwork without a
value rectangle. Level tables (`*_level_icon`) and the moon-phase set are
recognised as state folders of arbitrary length when a recovered starter is
described.

## Chart block (`WFChartInfo`)

`WFBinExporter::SetChart` at `0x18f984` writes `WFChartInfo` at `0xdc4`, in
protobuf field order, with `WFPositionIcon` = int32 x/y + pointer, `WFRect` =
four int16 + alignment byte, and `WFIconValue` = icon + rect + font (26 bytes).
`SetFish` at `0x18f5b8` writes `WFFishInfo` at `0xd92` (its pointer icon at
`0xdb4`), and `SetPoint` writes the clock pointer icons at `0x300/0x304/0x308`.
These were 32 of the 41 "unclassified" NOMAD references. The other nine are
`SetDate` language tables: it looks up `Map<WF_LANGUAGE, WFDateValue>` per
language and writes month/day/week records (rect + font, 16 bytes each) at
`0x61a/0x63a/0x65a` (German), `0x62a/0x64a/0x66a` (Spanish), `0x67a…0x69a`
(French), `0x93a…0x95a` (Japanese), `0x96a…0x98a` (Thai), `0x99a…0x9ba`
(Polish), `0x9ca…0x9ea` (Traditional Chinese), `0x9fa…0xa1a` (Portuguese),
`0xa2a…0xa4a` (Italian), `0xa5a…0xa7a` (Korean) and `0xa8a…0xaaa` (Russian),
with the Chinese month icon at `0x19c`. The language keys were read from the
`Map::at` immediates in the disassembly and match NOMAD's glyph sets. NOMAD
now decodes with no unclassified bitmap reference, and its eleven weekday
tables export as `<language>_date_week_font` folders.

| Offset | Field | NOMAD |
| --- | --- | --- |
| `0xdc4` / `0xdcc` | background position / image (`chart_pos`, `chart_bg`) | 416×416 graph backdrop |
| `0xdd0` | `chart_rect` | `{89,273,323,325}` |
| `0xdda` / `0xddc` | bar width / interval (u16) | 7 / 3 |
| `0xdde` / `0xde2` | selected / unselected bar color | `0xaaaaaa` / `0x555555` |
| `0xde6` / `0xdee` | bar mask position / image | ▼ marker at (147,267) |
| `0xdf2`, `0xe0c` | tide, barometer `WFIconValue` | bottom row alternatives |
| `0xe26` … `0xe5a` | fish time background, four rects, font | empty |
| `0xe5e` / `0xe62` / `0xe66` | curve upper / lower color, width (u8) | `0x555555` ×2, 4 |
| `0xe68` | sunrise/sunset: position, rise icon, set icon, hour rect, minute rect, font | (129,346), `{172..218}`, `{231..276}` |
| `0xe90` | sun icon | empty |
| `0xe9c` | sun angle `WFIconValue` (`chart_sun_angle_*`) | icon (200,47), `{236,47,290,77,left}` |
| `0xeb6`, `0xede`, `0xeea` | moonrise/set, moon icon, moon percent | empty |
| `0xf04` … `0xf9c` | stress, stamina, elevation, kcal, step, heart-rate readouts | three shared slots |
| `0xfa0` … `0xfac`, `0xfd4` | point, colon, degree, negative, percent icons | shared glyphs |
| `0xfb0`, `0xfbc`, `0xfc8` | item3 background, item3 mask, no-data mask | line, empty, sync artwork |

The 4.9.9 exporter passes chart colors through `rgb888_to_rgb222` before
storing them; official NOMAD stores full `0xRRGGBB` words. The decoder expands
values ≤ `0xff` as rgb222 and keeps larger values, retaining the raw words in
`chart.rawColors`. No 4.9.9 config key was found for `WFChartInfo.heart_rate`,
so it is decoded without a config binding.

COROS documents the runtime behaviour: the watch cycles five chart groups
with Back (general daily data; sun with sunrise/sunset time and solar angle;
moon; barometer; tide). Every readout above is therefore an alternative that
shares the graph area. The application importer starts the editor's single
chart layer on the sunrise/sunset group shown by the catalog thumbnail, with
the original backdrop, no-data artwork, icons, fonts, colors and a line-graph
preview; the solar angle becomes a `chart_sun_angle` number layer. Readouts of
other groups are not editable layers, but they stay in the recovered config
and survive export: the chart layer replaces only the shared graph keys and
its selected source. Slot-sharing alternatives (temperature vs. solar angle,
wind vs. min/max) all stay enabled and exported; the preview draws the ones
the chart layer's group would show. Without a chart layer the importer falls
back to disabling the overlapping alternatives.
## Coverage

With the control, extended-status and MIP additions, every local official
binary decodes without unclassified bitmap references: PLANET, MULTIDATA ELEV,
NOMAD, DASHBOARD, RUBY HORIZON, DAWN, JOY HOL, FEARLESS, PLUMP, AQUA BLOCK,
STREAMLINE2, GO FISHING (416px) and SIMPLE BLACK 02 (260px MIP). RUBY HORIZON
also declares an icon-less AQI value over its UV column; the importer starts
that alternative disabled because live AQI is unavailable on PACE Pro.

## Seconds hand

NOMAD's 54×416 chevron strip (group 16) is `WFClockPointerGroup.second` with
`time_center_pos` (207,207): the firmware rotates it once a minute so the
chevron sweeps the bezel. The same strip is also referenced from the fishing
record's `pointer_icon`, but that record has no time mask, centre or radius,
so the recovery keeps `fish_pointer_icon` dormant; exporting it alone made the
firmware spin a stray pointer. The starter now declares `time_second_icon`
and `time_center_pos`, which Studio renders as its analog second hand. Hand
tint bytes (`0x30c`–`0x30e`, rgb222) and hand polygons are not reconstructed.

## Asset path separators on the watch

The first on-watch install of a recovered NOMAD (2026-09-18, PACE Pro) drew
only the weather icon, wind icon, direction and wind digits: every element the
editor regenerates under `studio\…`. Every element referenced as
`recovered/group-NN` (time and date fonts, battery frames, chart readouts,
status icons) was blank, although the PNGs are ordinary 8-bit RGBA and the
archive validated. COROS's own templates and Studio's output only ever use
backslashes (`icon\colon.png`, `studio\current_…\00.png`), so the recovery
starter now writes `recovered\group-NN` / `recovered\group-NN\00.png`, the
CLI drafts write `assets\group-NN`, and `prepareRecoveredWatchfaceExport`
rewrites forward-slash references left in older saved projects. Consumers in
the app already normalised both separators. The next install confirmed it:
every recovered element rendered.

# Exporting recovered faces

Recovered editor archives are not DIY upload packages: their catalog face ID
does not identify an editable COROS template, and their source layout may only
exist at the native 416px resolution. Final archive creation now composes editor
changes first, then uses the selected watch's cached official editable template
for its DIY manifest, template ID, device ID and preview/thumbnail dimensions.
First use downloads that template through the existing signed-in catalog flow.

PACE Pro exports contain 416px and generated 800px Current/AOD layouts. Native
sprites and coordinates are kept directly; they do not round-trip through the
upscaled master. Other supported watch targets use their own resolution sets.
The generated larger images do not contain additional detail from the original
face. Export strips the original compiled binary and recovery report; those stay
in the editable project. The normal download and COROS upload use the same final
archive. Older recovery archives are rejected before upload with a message to
rebuild them in the editor.

Offline integration tests cover actual recovered MULTIDATA ELEV, PLANET and
NOMAD files, all asset references, Current/AOD, complete resolution trees,
lossless DIY IDs in both requests, and equality of downloaded/uploaded bytes.
This verifies package construction and request serialization; COROS acceptance
and physical watch installation still require a live user-authorized attempt.
