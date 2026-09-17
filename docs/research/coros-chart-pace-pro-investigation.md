# PACE Pro chart investigation — 2026-09-16

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
