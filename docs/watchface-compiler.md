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
| Backgrounds on memory-in-pixel watches | Byte-identical to the COROS app's output (167/167 test images), when the PNG is already the screen size. |
| Sprites on memory-in-pixel watches | Identical rounding to 2 bits per channel and 4 alpha levels. Optional smooth edges re-encode soft edges only. |
| Thumbnails on memory-in-pixel watches | Identical: rounded like sprites (they were dithered before 2026-10-27). |
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

### Memory-in-pixel backgrounds match COROS exactly (2026-10-27)

`mipBackground` approximated `AggRender::OptimizeBitmap` and matched COROS on 53% of
pixels. It now ports it byte for byte. The reference was COROS 4.9.9's own code
(`libw4-watchface.so`, arm64) run in Unicorn: `ApplyRgbCurve`, `AddMidtones`,
`Rgba8Palette`, `Dither::DoDither`, `Bitmap::ReplaceColor`, AGG's
`DrawCircleOutline` and `To2222Buffer`, in `OptimizeBitmap`'s order (read from its
disassembly), with the 64-color palette. Harness: `tmp/mip-colour-check`
(`corosemu.py`, `mip_pipeline.py`), extended in `tmp/mip-exact-lab` (gitignored; `refgen.py`, sprite evaluator, README).

What the code does, which the old version got wrong:

- **Saturation comes first, on the source colors**, as an HSL adjustment of +25%
  (Photoshop's formula), not +25/255 in HSV after the curve. Its arithmetic is
  compiled to fused multiply-adds; without an FMA, 249,624 channel values out of
  16.7M colors differ. `fma()` in `bitmap.ts` emulates it. Checked on every RGB color.
- **The tone curve is a natural cubic spline** (tk::spline), not straight lines.
  Each step truncates.
- **"−5 green" is a gamma**: `g' = trunc(255·(g/255)^(2^0.05))`. Red and blue
  don't change.
- **Partly transparent pixels** are blended over `bg_color` (black without one) and
  made opaque before dithering. Transparent pixels are never touched.
- **Floyd–Steinberg** runs in raster order (not serpentine) on the 8-bit pixels. It
  spreads 80% of the error, truncates each share and clamps it into the pixel.
- **The palette** is luma-sorted (`Rgba8Palette::Distinct`). The first of equally
  near colors wins. The 11 `enhance_colors` swaps take the place of the colors they
  replace, and are written back afterwards.
- **A black 2 px ring** is drawn round the edge (`AggRender::ToBackground`, AGG
  `rasterizer_outline_aa`). That's about 3.4% of a 260 px face. Its coverage per
  pixel is recorded for 240, 260 and 280 px in `mipRing.ts` and applied with AGG's
  `lerp`. Two pixels at 260 px get covered twice.
- **Thumbnails** (`INSIDE_TYPE` 2) are only scaled and rounded, never processed.

COROS's output compared with CorosLink's before and after, per pixel:

| Inputs | Before | After |
| --- | --- | --- |
| 100 flat colors (64 rgb222 + 36 others) | 40.8% | 100%, 100/100 identical |
| 12 gradients, hue sweeps, noise | 48–56% | 100%, 12/12 |
| 15 alpha cases (AA discs on 3 `bg_color`s, alpha ramps, alpha noise) | 23–60% | 100%, 15/15 |
| 40 corpus backgrounds scaled to 240/260/280 | 83.2% | 100%, 40/40 |
| All 167 | 53.1% | 100%, 167/167 |

`scripts/test-coros-multi-watch.mjs` pins three of these, SHA-256 of COROS's
output, at 240, 260 and 280 px. Encoding takes about 30 ms per background.

What this rests on:

- The palette is assumed to be the 64 rgb222 colors. That set is exactly what the
  lib's own `WFConfigBuilder::NewDefaultPaletteColor` returns. The iOS app sets the
  palette through `changePaletteColor:`. The Android app's `nativeSetParseCfg` and
  palette are still unverified. Without a palette, `DoDither` returns before even
  blending, which is why the native host shows banding.
- Byte-identity covers COROS's processing, not its AGG scaler. A background PNG that
  isn't already the screen size is still resized by `scaleImage`.
- The AMOLED exporter draws the same black ring before quantizing. CorosLink doesn't
  draw it there yet.

### Smooth edges for memory-in-pixel sprites (2026-10-27, experimental)

The PACE Pro firmware's `bitmap_convert_argb2222` (0x4bcc80) RLE-decodes a block,
then turns COROS's inverted alpha back into standard ARGB2222 for the GPU
(`b = (b & 0x3f) | (3 − (b >> 6)) << 6`, at 0x5a48a0). The four levels therefore mean
0, ⅓, ⅔ and 1 (85·k). COROS encodes alpha with `a >> 6`, which drops 1–63 and makes
192–254 solid. The nearest third would cut at 43/128/213.

With `CompileOptions.smoothEdges` (the **Smooth edges (experimental)** checkbox,
shown instead of Full color for memory-in-pixel faces), each partly transparent
sprite pixel gets the alpha level and color levels that minimize the squared error
of the blend. The error is summed over the four levels a channel behind the pixel
can hold, and computed in integers so it ports exactly (`smoothEdge`). Opaque and
transparent pixels, backgrounds and thumbnails stay byte-identical to COROS. A
sprite without soft edges compiles to the same bytes.

Measured on the corpus's 4,537 distinct soft-edged sprites (4.76M partly transparent
pixels). The sprites were drawn over black, white, dark grey (85) and a dithered
corpus background, and compared with the source blended at full precision. PSNR is
taken over edge pixels (dilated by 1):

| Behind | COROS | Smooth edges | Smooth, screen rounds to 64 colors | Blurred 3×3 (as seen) |
| --- | --- | --- | --- | --- |
| black | 24.40 dB | 25.59 | 23.95 → 24.89 | 27.75 → 28.88 |
| white | 24.80 | 26.50 | 24.31 → 24.81 | 28.03 → 30.10 |
| grey 85 | 26.27 | 27.90 | 24.16 → 23.92 | 29.20 → 30.66 |
| photo | 24.62 | 25.97 | 24.05 → 24.80 | 27.98 → 29.36 |

It changes about 10% of edge pixels. Spreading coverage error along the rim
(Floyd–Steinberg on alpha only) scored best once blurred (+3 dB) but worse
pixel-for-pixel than COROS (grainy rims), and Bayer did worse still. Neither ships.

Not checked on a watch. Two assumptions need it:

- that MIP firmware draws 2222 blocks the way PACE Pro's loader does;
- how the 64-color panel rounds blends that fall between levels. Over the grey
  background, smooth edges are 0.2 dB worse if the screen rounds blends.

## What can still be improved

In rough order of value:

1. **Confirm full color on a watch.** Install a palette/full-color pair and check
   rendering, transfer time and memory on PACE Pro, then on PACE 4 and PACE 4 Pro.
   Then decide whether to turn it on by default, perhaps only for backgrounds.
2. **Full color for backgrounds only.** Most of the size comes from fonts. A
   background-only setting would give most of the visible gain (gradients) for
   about 0.5 MB.
3. **Confirm the MIP palette on Android.** Backgrounds now match COROS with the
   64-color palette. Check that the Android app sets the same palette through
   `nativeSetParseCfg`.
4. **Match COROS's resizing.** Measure `scaleImage` against COROS's AGG scaler the
   same way the quantizer was measured. Only faces whose background or thumbnail
   isn't already the screen size are affected.
5. **Confirm smooth edges on a MIP watch** (above). Compare it side by side with
   COROS's rounding over a light and a dark background, then decide on a default.
6. **Draw COROS's edge ring on AMOLED backgrounds.** It goes in before quantizing.
   This needs its coverage at 390, 416, 454 and 466 px (`mipRing.ts` has the MIP
   sizes).
7. **Separate size warnings.** The full-color fallback warning appears under
   "won't show as designed", which fits missing images but not this.

### Confirmed on no watch yet

- full color (above)
- analog hands
- resized Bluetooth and Do Not Disturb icons
- memory-in-pixel elements over 64 KB, which CorosLink only warns about
- smooth edges on memory-in-pixel watches (above)

## Checking a change

- `node scripts/test-coros-watchface-compiler.mjs` and
  `node scripts/test-coros-multi-watch.mjs` after `npm run build:electron`.
- Compare with COROS's compiler on the corpus in `tmp/coros-ts-lab` (gitignored;
  it needs COROS's libraries and the native host). Score images against the
  source PNGs over black and split edge pixels from flat ones: whole-image PSNR
  hides edge damage.
- Read native background blocks through the header pointer at `0x1a`. COROS
  leaves junk in a reserved byte, so the block scanner skips them.
