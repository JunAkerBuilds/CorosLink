# PACE Pro chart investigation — 2026-09-16

## Official NOMAD thumbnail versus compiled chart — 2026-09-29

The gallery thumbnail and compiled watch-face BIN are separate image/data
sources. In the downloaded 260px `COROS NOMAD` (template
`470133195753504768`), `watchface_customize.png` paints the chart orange, but
the BIN's chart record stores `0xff0000` for both the selected bars and upper
curve. The recovered editor correctly shows that source BIN in red. The
downloaded 416px `NOMAD` (template `473240729416744960`) is a different
official face whose BIN stores `0xffaa00` for those fields. No channel swap is
needed to explain the red 260px preview or the orange 416px preview.

The Android 4.9.9 custom compiler's `rgb888_to_rgb222` would pack
`0xffaa00` to `0x3c` and `0xff0000` to `0x30`. If those small values are then
read as full RGB words by PACE Pro firmware, both appear as dark blue
(`0x00003c` or `0x000030`). This matches the reported hue but remains a
hypothesis for the installed custom face: its compiled BIN has not been
captured. The working white CorosLink face also prevents treating this as an
universal custom-chart failure. A direct official 416px install is the useful
control, because its downloaded BIN already contains full `0xffaa00`.

### Color-edit report and controlled carrier test

The user reports that a previously gray chart looked correct on PACE Pro, but
changing chart colors, including white, makes the chart blue. In the editor's
latest white NOMAD document, the bar colors are `#fa0000` and `#ffdd80`, while
the curves remain `#555555`. Its 22:42 local export
`2a2bcccd-e414-4251-bf14-6a940148d4fd.dat` uses SIMPLE carrier `2607304`
and `watchface_id=0`. The earlier working white export used BOLD carrier
`140001` and `watchface_id=0x00000029`; the carrier and palette both differed.

Prepared `output/nomad-yellow-red-bold-carrier-test.dat` from the 22:42
export. Only `info.json` and the four Current/AOD config files changed to
the BOLD carrier identifiers. The other 795 ZIP entries, including every
sprite and the chart colors, are byte-identical. CorosLink imported the test
archive successfully as `65c8bbf3-0917-462e-b837-22266c34428e`. It has
not been published or tested on watch. A correct-color result would implicate
carrier identity; a blue result would keep color handling or another
shared export path in play.

## NOMAD color mismatch photographed on PACE Pro — 2026-09-29

Two user photos of an awake PACE Pro show the converted NOMAD chart curves and
bars in deep blue/purple. The surrounding face colors remain as expected. The
source NOMAD 416px archive and the freshly built custom archive both request
orange `0xffaa00` for selected bars and upper curves, gray `0xaaaaaa` for
unselected bars, and white `0xffffff` for lower curves. Both chart-backdrop
PNGs have opaque `#1f1c1b` center pixels. The exported archive also retains
the original `hcenter|vcenter` chart rectangle after the local alignment fix.

The COROS 4.9.9 chart exporter documented below applies `rgb888_to_rgb222`
to those four graph colors. Standard two-bit channel packing would reduce
`0xffaa00` to `0x3c`, `0xaaaaaa` to `0x2a`, and `0xffffff` to `0x3f`. Official
NOMAD stores full RGB words in the same chart record. If PACE Pro firmware
interprets the packed custom values as full RGB, all three become dark blue
values, matching the photos. The later working-white comparison below means
this interpretation is only a hypothesis. The installed custom BIN has not
been captured to confirm its exact stored words. The chart panel also looks lighter in the photos;
camera exposure and its compiled sprite need separate verification. The
source ZIP's correct RGB values and PNG pixels do not establish on-watch color.

The Send to COROS preview now warns when a firmware-drawn chart is present.
The current source archive format has no chart-color setting that bypasses
`SetChart`'s conversion. Preserve the distinction between this possible
compiler/firmware mismatch and the already verified source-archive pixels.

### Working white custom NOMAD comparison

The user then confirmed that the white NOMAD variant was **sent from CorosLink**
and its chart colors look correct on the same PACE Pro. This rules out the
claim that all CorosLink charts necessarily turn blue on that watch. The
working white custom archive `e3088f51-ade1-41d1-a9b0-4b56cad61bd1.dat`
(2026-09-18) has a light gray `#d4d4d4` panel and only achromatic chart colors
(`0xaaaaaa` and `0x555555`). Its `info.json` uses DIY carrier ID `140001`
(BOLD) and its 416px config has `watchface_id=0x00000029`. The failing dark
custom archive `732669e2-5449-4dad-9631-303da9c7e475.dat` uses orange and
white chart colors, a `#1f1c1b` panel, carrier `2607304` (SIMPLE), and
`watchface_id=0`. These differences are correlated with the observed outcome;
there is no on-watch test isolating carrier from chart palette yet. The
simple RGB222-as-full-RGB interpretation above is therefore unproven and
should not be presented as the established cause.

For the requested dark test, copied the failing dark archive to
`/tmp/nomad-dark-pace-pro-working-carrier-test.dat`, changing only
`info.json`'s `o_template_id` from `2607304` to `140001` and the four Current/
AOD `watchface_id` values from `0` to `0x00000029`. All 775 other ZIP entries,
including chart PNGs and color settings, are byte-identical to the failing
archive. ZIP CRC and CorosLink archive import validation pass. It is registered
as archive `7904c65b-0b34-46e3-a13d-0f71a42bb9ac`, but has not been
published or tested on a watch. A successful on-watch result would implicate
carrier identity; another blue result would leave the chart palette or other
differences as possibilities.

The user first described an editor-added chart on PACE Pro as a faint blue
line, then clarified that it is showing bar charts. This is user-reported
evidence of on-device chart rendering, not a completely missing chart. The
current implementation has no verified way to independently select live
history or force a curve versus bars. Its preview and archive tests establish
sample rendering and configuration/asset output; correct history and live
updates have not yet been verified on the device. The user subsequently reports
that the chart's numeric readout is absent even though the editor shows it.
The Back-button test returned: "The chart changes, but no number." Cycling
therefore does not resolve this case; the missing readout remains a separate,
unresolved compatibility/export issue. This is not evidence that all PACE Pro
chart faces lack numeric support.

The live SLENDER document was checked through MCP: its chart is enabled with
`chartSource: chart_step`, white default color, origin `(281,315)` in the 800px
authoring frame, no disabled value component and no digit replacements. The
icon text was intentionally cleared, which affects only the icon, not digits.

## Checked export

The most recent local archive at inspection time was
`913f728e-af71-41ef-8d2a-92ac8790c150.dat` (SLENDER). It contains 416px and
800px configurations, `o_wf_ver: 6`, and `[watchface_id]=0`. Its 416px chart
rectangle is `{146,194,271,256,left|vcenter}`, inside the display. It contains
the `chart_step` value/icon keys, curve/bar geometry and colors, ten digit
PNGs and all referenced chart symbol/icon PNGs. No missing PNG or insufficient
manifest version was found. The user has not yet confirmed that this is the
exact archive installed on the watch. The saved SLENDER project does not
contain that chart, so it cannot establish the installed settings.

A later export, `f59922d7-736f-4a9f-b4d5-c076e41b5ce8.dat`, has the same chart
configuration. Its steps font has all ten PNGs at 12×25 pixels for the 416px
target and 24×48 for 800px. The current document now contains the chart described
above. There is still no captured compiled binary from the watch for comparison.

The inspected 416px configuration requests white (`0xffffff`) selected bars
and upper curves, gray (`0x555555`) other bars and lower curves, 4px bars with
2px gaps, and a 1px curve. A thin curve could explain faintness if a curve were
being rendered, but the user's later bar-chart observation means curve width
must not be treated as the cause or fix. The requested colors do not explain
the initial blue-color report. No recent compiled version of the failing face
was found locally.

## Compiler evidence

Inspected the same COROS 4.9.9 ARM64 library identified by SHA-256 in
`coros-4.9.9-watchface-compiler.md`:

- `WFTemplateParser::LoadConfig`, around `0x1e589c–0x1e76ac`, creates one
  `WFChartInfo`. It reads graph geometry/style and separate numeric/icon
  fields. `chart_rect` is parsed independently of `chart_bg`; a missing
  background alone is not evidence that the parser drops the chart.
- `WFBinExporter::SetChart` (`0x18f984`) writes shared graph geometry and
  independent field records. `chart_step_rect/font/icon` configure the steps
  readout in that structure. They do not establish a history-source command.
- `WFChartInfo` has no source-selection field. `SystemStatus.chart_index`
  (field 58) is runtime state, not a watchface configuration setting.
- `chartStyle.previewType` is only used by the editor's sample renderer. The
  exporter writes both bar and curve styling and no curve/bar selector. The
  inspector now explicitly labels the control **Sample graph (preview only)**
  and explains which appearance controls apply to bars.
- `GetColor` accepts the exported `0xRRGGBB` strings and supplies full alpha.
  `SetChart` converts curve/bar colors through `rgb888_to_rgb222` before
  writing them. This does not establish the final server-compiled bytes or
  PACE Pro's interpretation; do not infer a color fix without that evidence.
- `WFPreviewBuilder::DrawChart` (`0x1a0698`) draws hardcoded graph samples.
  Around `0x1a0c9c`, it dispatches different readout groups using runtime
  `chart_index % 5`. This is evidence against treating every chart readout
  prefix as an independently selected history graph; it does not establish
  what PACE Pro firmware renders.
- More specifically, the compiler preview reaches the steps readout at
  `0x1a0fcc–0x1a0fec` in group 4, while group 0 draws stress/stamina/elevation.
  CorosLink draws the selected readout unconditionally. A group mismatch was
  initially a hypothesis, but the user's subsequent Back-button test changed
  the graph without showing a number. Do not present group cycling as a fix.
- The numeric configuration helper at `0x1f6bd8–0x1f7238` reads `_rect`,
  then the optional alias `_integer_rect`, into the same rectangle and reads
  `_font` independently of the icon. `chart_step_rect` is an accepted key;
  neither the alias nor nonblank label artwork is proven necessary.
- The numeric export helper at `0x1904bc–0x1906f8` writes the value rectangle
  and font separately from the icon. The steps call at `0x18ffa4` targets
  number rectangle offset `0xf78` and font offset `0xf82` in the export header.
  `GetFont` at `0x1f486c` loads the referenced font directory's PNGs. Static
  inspection did not establish a missing asset or a corrected configuration.
  Actual server output is still needed to check whether those records survive
  compilation; these offsets are evidence for inspection, not a binary patch.
- Curve drawing code exists at `0x1a0a10` and checks positive plot dimensions
  and `curves_width >= 1`; curve styling is also written by `SetChart`.
  This establishes compiler support for curve geometry, not a way for a
  custom face to select line rendering on PACE Pro. The compiler preview draws
  bars and curves from samples without a plot-type selector.

COROS documents Back-button cycling between chart/icon groups on its NOMAD
watch face: <https://support.coros.com/hc/en-us/articles/40211772414100-COROS-NOMAD-Watch-Face-Icons>.
That documentation is not a PACE Pro compatibility guarantee.

## Remaining verification

Compare a known working official PACE Pro chart face and the compiled output
of the custom face if its colors or history are still incorrect. Check whether
the chart structure survives the actual COROS compilation path and whether
history selection or appearance depends on the face's
identity, template, device firmware or active chart group. Those dependencies
are hypotheses; do not automatically rewrite face IDs, add dummy backgrounds,
or claim a firmware fix without evidence. No Android device/emulator was
available over ADB during this investigation, so the Android library and
PACE Pro firmware were not executed.

The editor and MCP now explicitly describe charts as experimental and the
selector as a chart data field. Existing design data and exports are retained.
They also describe the observed missing-number behavior. A separate fixed
metric can be positioned beside the graph as an independent readout, but must
not be represented as following the active chart group. No on-watch numeric
fix or selectable line mode is claimed.
