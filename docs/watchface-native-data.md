# Native watchface data

In the watchface editor, choose **Add → Live data**. Data layers can be moved, scaled, recolored, hidden and saved with the project. **Current weather** displays weather temperature independently of the weather icon; adding it takes over the weather companion's temperature slot. To attach temperature to the weather icon again, use its **Show current weather** checkbox.

Use **Current weather** under Weather for weather data. **Sensor temperature** is a separate fixed/selectable metric for the watch's thermometer; it remains available independently of weather temperature. It is affected by body heat when worn, so it should not be described as core body temperature. See COROS's [Temperature Widget](https://support.coros.com/hc/en-us/articles/43904010291348) and [Weather Widget](https://support.coros.com/hc/en-us/articles/20991888248596-Weather-Widget) documentation. Simulation has independent **Current weather** and **Sensor temperature** inputs.

**AQI requires available weather data.** COROS's [Weather Widget documentation](https://support.coros.com/hc/en-us/articles/20991888248596-Weather-Widget) lists air quality as United States only; its newer [Daily Features documentation](https://support.coros.com/hc/en-us/articles/38146113607060-Daily-Features) describes AQI as region-dependent. If AQI is missing from the watch's built-in Weather widget, the watchface may also have no value to display. If the widget has a reading but the face is blank, investigate the watchface export/firmware path separately. Editor preview and simulation values do not supply live AQI to the watch.

The Add menu and AQI inspector mark it **Not available right now** following PACE Pro testing in the US, where AQI was also missing from the built-in Weather widget. This is a current compatibility status, not a claim that AQI is permanently unsupported. Existing layers and their appearance remain editable.

| Category | Available additions |
| --- | --- |
| Weather | Current/minimum/maximum temperature, wind speed/direction, rain probability, humidity, UV, AQI and barometer |
| Astronomy | Sunrise/sunset time and progress; chart sources for sunrise/sunset, moonrise/moonset, moon phase, moon illumination, sun angle and tide |
| Health | Sleep score, stress, stamina and sleep HRV status; stress/stamina charts |
| Training | Weekly training load; today's/weekly running, cycling, swimming and elevation totals; steps/calories/elevation charts |

**Charts are experimental.** A user has reported bar-chart rendering on PACE Pro; history selection and live updates still need verification. The native chart block has one shared plot rectangle. The editor's chart data-field selector chooses which numeric/icon keys to export; it does not provide a verified way to select the history plotted by the watch. The editor graph uses sample data, so its appearance is not evidence of the graph type or history displayed on the watch. Adding another chart field changes that layer. Each fixed native metric also has one firmware slot per display mode.

PACE Pro testing also reports that Back changes the graph while its number stays absent. This remains unresolved; the preview's sample number does not establish numeric-readout support. A separate metric layer can provide an independent value beside the chart, but it will not change with the chart. Curve configuration exists in the inspected compiler, but forcing a line graph on PACE Pro is not verified.

The chart picker and inspector mark **Line graphs — Not available right now**. Line selection and line appearance controls are disabled. All chart previews use bars, including older projects saved with curve samples. Bar chart options remain available; their history selection and numeric readout still need verification.

Defaults are generated at export resolution. The original SIMPLE daytime/nighttime weather artwork remains the weather icon default. Select a native layer and use **Customize component** to edit its individual parts:

- Labels and arrows: type replacement text (for example, change `TL` to `LOAD`), choose a font/color, or replace the image. Sunrise and sunset arrows have separate artwork states.
- Numbers, units, symbols and status artwork: edit dimensions, font/color and individual glyphs or import numbered PNGs. Missing files keep their defaults.
- Graphs: set the plot position/size, selected/other bar colors, bar width/gap, background, mask and missing-data artwork.
- Solar progress and decimal points: replace their artwork and change dimensions. The compiler's `chart_point_icon` represents a numeric decimal point, not a graph-point marker.

Each component can be shown or hidden. Position offsets are offered where the native format supports them; the watch places units, symbols and decimal points beside the value. Minimum/maximum temperature share the firmware's unit and minus assets; minimum-temperature settings supply them when both fields are enabled.

**Restore component defaults** resets the selected part, and **Restore all appearance defaults** resets the layer's appearance while keeping its position and data source. Both support undo. Replacement images and text stay in the editable project. Font/color changes affect generated defaults; imported artwork keeps its colors. Replacing artwork accepts PNG/JPEG/WebP and stores PNG.

Preview values and graph history are examples. **Graph type** is locked to **Bar graph**. Older curve samples also render as bars without changing their saved settings. Legacy curve export parameters are preserved for compatibility, and firmware chooses the live representation. For a watch displaying bars, adjust **Bar width**, **Bar gap**, **Selected bar** and **Other bars**. Line appearance controls are unavailable for now. Samples are never flattened into the exported background: the configuration binds the sprites to the watch's native data. Current and AOD settings are independent when the source template supports AOD. SIMPLE itself has no AOD configuration.

## Evidence and testing boundary

Keys come from the supplied COROS 4.9.9 library; see [the inspection](research/coros-4.9.9-watchface-compiler.md). The numeric chart helper at `0x1f6bd8` expands prefixes with `_icon_pos`, `_icon`, `_rect`, `_font`. The rise/set helper at `0x1f7238` expands `_icon_pos`, `_hour_rect`, `_minute_rect`, `_font`, with separate rise/set icon keys. These are parser-supported keys, not new selectable-control IDs.

Automatic format floors are 3 for extended status/training, 5 for sun progress, 6 for sleep score, and 2 for the chart block. Existing higher template versions are preserved. These floors follow the recovered format enum; final compiler/firmware behavior still needs a device test.

The Android compiler has not been executed in this environment. A built/exported ZIP and a successful preview do not establish device support. Test first on the target watch with the updated COROS app. In particular:

- Wind defaults assume 16 clockwise directions, HRV defaults label indices 0–7, and moon defaults have 30 phase frames. Their exact counts/order need device/template confirmation. HRV is a status, not milliseconds.
- Training unit artwork assumes km/mi for running/cycling, m/yd for swimming, and m/ft for elevation. Verify the runtime units/precision and replace artwork if needed.
- Graph selection, live updates, missing-data behavior and solar progress require on-watch checks. No dedicated heart-rate chart is exposed because its configuration prefix was not established.
- Categorical UV/AQI/training/stress/stamina level artwork, localized sleep-score labels and fishing displays are not added by this implementation.

## Local checks

`npm run build`, the editor/studio/automation suites and `npm run test:watchface-automation-e2e` verify the UI and archive pipeline, including typed labels, component reset/undo, graph visibility, bars-only selection and bar width. After building Electron, run `npx electron scripts/test-watchface-native-data.cjs [path/to/SIMPLE.zip]` for all 25 field definitions, all 12 chart choices, resolution scaling, Current/AOD asset separation, version floors, customized labels/glyphs/graph styling, independent component visibility, exported artwork dimensions and project round trips. `scripts/test-watchface-weather.cjs` retains the SIMPLE weather/default-artwork regression check.
