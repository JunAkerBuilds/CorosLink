# CorosLink's watch face compiler

CorosLink turns a final watch face archive (`info.json` + `watchface_<size>/config.txt`
+ PNGs) into the BIN a COROS watch installs, with its own TypeScript compiler in
`electron/watchfaceCompiler/`. It reimplements COROS's 4.9.9 compiler
(`WFTemplateParser::Parse` + `WFBin8888Exporter` / `WFBin2222Exporter`), which is
what the COROS app runs on the phone when a face is installed from a share link.
C-LINK on iPhone runs a byte-identical Swift port.

This page records how our output differs from COROS's, what changed and why, and
what is still worth improving.

## How it compares with COROS

| Area | Status |
| --- | --- |
| Headers, element records, write order, CRC, AOD | Identical to COROS on the 41-face corpus (structural diff, 41/41). |
| Images with up to 256 colors | Identical: stored as an exact palette by both. |
| Images with more than 256 colors (AMOLED) | Quantized to 256 colors by both, with different quantizers. Ours is closer to the source (see below). Optional full color skips quantizing. |
| Backgrounds on memory-in-pixel watches | Same steps as COROS (tone curve, +25 saturation, −5 green, Floyd–Steinberg to 64 colors), not byte-identical. |
| Sprites on memory-in-pixel watches | Identical rounding to 2 bits per channel and 4 alpha levels. |
| Resizing backgrounds and thumbnails | Area averaging / bilinear; COROS uses AGG. Close, not byte-identical. |
| Chart colors | Deliberately full RGB. COROS packs them to rgb222, which PACE Pro draws as navy. |
| Picker thumbnail | Ours writes `m_preview`; the watch renders its own thumbnail and ignores both. |

## Changes

### Edge-aware dithering (2026-10-26)

A user compared the same ZIP installed two ways: through a COROS share link, the
edges were smooth; compiled by CorosLink and sent over Bluetooth, they were slightly
jagged. Our quantizer applied plain Floyd–Steinberg to every pixel, so the error
from a stroke's soft rim spilled into its neighbours as scattered dots. COROS
quantizes with libimagequant, which dithers edge-aware.

`remapDithered` in `bitmap.ts` now follows libimagequant:

- error diffusion in premultiplied, gamma-adjusted color (`f_pixel`), so a
  transparent pixel never receives a visible color's error;
- a dither map from local contrast (`contrast_maps`): low on edges and noise, high
  in smooth areas;
- raised where the undithered remap shows long runs of one entry, which is where
  banding appears (`update_dither_map`);
- serpentine scanning, with large errors damped so they can't pop up as stray dots.

Measured against the source PNGs on the 102 quantized images in the corpus
(40 of them backgrounds), as seen over black:

| | COROS app | Before | After |
| --- | --- | --- | --- |
| Edge pixels (PSNR) | 47.2 dB | 45.8 dB | 61.4 dB |
| Whole image (PSNR) | 57.6 dB | 60.3 dB | 73.0 dB |
| Speckled pixels | 0.24% | 2.95% | 0.02% |
| Compressed size | – | 1.50 MB | 1.49 MB |

None of the images got worse. Quantizing takes about twice as long (about 15 ms
per image).

### Full color (2026-10-27, experimental)

COROS's own catalog faces store backgrounds, thumbnails, fonts and weather icons
as full RGBA blocks (block format 3, encoding `0x2002`: RLE with the `0x20`
exporter flag). This is the same layout as our palette blocks, so the firmware
already draws them. COROS's DIY compiler never writes them, because its RGBA
fallback (`Bitmap::Add2Lut256`) is stubbed.

With `CompileOptions.fullColor` (the **Full color (experimental)** checkbox, off by default), every AMOLED image
that would be quantized is stored as RGBA instead:

- Images with up to 256 colors keep their exact palette, which is smaller.
- A frame list with any frame over 256 colors is all RGBA, since a block has one format.
- The thumbnail stays a palette, since the watch ignores it.
- Memory-in-pixel watches ignore the option.
- If the BIN would exceed `WATCHFACE_MAX_BYTES` (3.1 MB), it is compiled with
  palettes instead and a warning says why.

On the corpus, 25 of 41 faces change. The median BIN grows from 311 KB to 516 KB,
and the largest is 3.1 MB, just under the limit. The growth comes mostly from
fonts with more than 256 colors, not from backgrounds. Compiling is faster
because nothing is quantized. The backgrounds decode byte-for-byte equal to their
source.

Not yet confirmed on a watch. It is off by default until it is.

## What can still be improved

In rough order of value:

1. **Confirm full color on a watch.** Install a palette/full-color pair and check
   rendering, transfer time and memory on PACE Pro, then on PACE 4 and PACE 4 Pro.
   Then decide whether to turn it on by default, perhaps only for backgrounds.
2. **Full color for backgrounds only.** Most of the size comes from fonts. A
   background-only setting would give most of the visible gain (gradients) for
   about 0.5 MB.
3. **Match COROS's MIP background exactly.** `mipBackground` approximates
   `AggRender::OptimizeBitmap`. The emulator of COROS's real code in
   `tmp/mip-colour-check` can measure the gap. Measure the result with the 64-color
   palette the COROS app sets, and confirm it against the Android app.
4. **Match COROS's resizing.** Measure `scaleImage` against COROS's AGG scaler the
   same way the quantizer was measured. Only faces whose background or thumbnail
   isn't already the screen size are affected.
5. **Cleaner edges on MIP sprites.** Both compilers round MIP fonts and icons to
   4 levels and drop anything under 25% opacity, so soft edges step. Pre-dithering
   alpha could beat COROS here, but needs a watch to judge.
6. **Separate size warnings.** The full-color fallback warning appears under
   "won't show as designed", which fits missing images but not this.

### Confirmed on no watch yet

- full color (above)
- analog hands
- resized Bluetooth and Do Not Disturb icons
- memory-in-pixel elements over 64 KB, which CorosLink only warns about

## Checking a change

- `node scripts/test-coros-watchface-compiler.mjs` and
  `node scripts/test-coros-multi-watch.mjs` after `npm run build:electron`.
- Compare with COROS's compiler on the corpus in `tmp/coros-ts-lab` (gitignored;
  it needs COROS's libraries and the native host). Score images against the
  source PNGs over black and split edge pixels from flat ones: whole-image PSNR
  hides edge damage.
- Read native background blocks through the header pointer at `0x1a`. COROS
  leaves junk in a reserved byte, so the block scanner skips them.
