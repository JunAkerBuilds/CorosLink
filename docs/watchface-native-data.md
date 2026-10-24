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

PACE Pro testing also reports that Back changes the graph while its number stays absent. This remains unresolved; the preview's sample number does not establish numeric-readout support. A separate metric layer can provide an independent value beside the chart, but it will not change with the chart.

**Which pages exist is the firmware's choice.** PACE Pro firmware 3.2008.0 builds a seven-entry page table and Back steps through the entries that exist: barometer and tide whenever the bar width is above 0 (with or without a readout), fishing with its font, sun with a sunrise readout, moon with a moonrise readout, daily page A only with stress, stamina and elevation, and daily page B only with calories, steps and heart rate. Studio's export adds the missing readouts of a page the face uses as invisible ones, and the inspector shows the pages in Back order. A face with stress, stamina and steps alone never paged; with the other three added invisibly it did (2026-10-20). Heart rate is a CorosLink-only key that COROS's own compiler drops, so faces compiled by the COROS app never get daily page B.

The inspector's **Watch pages** lists those pages with their fixed slots: **Add page** adds a page with its required readouts, a required readout can be hidden (export keeps it invisibly, so the page stays), optional ones (sun angle, moon phase and illumination, barometer and tide numbers) are added with their **+** chip, and removing the barometer or tide page turns the bars off for both.

**Weather also follows the page.** On the sun and moon pages the firmware skips its whole weather block: current, minimum and maximum temperature, rain, humidity, UV and AQI are not drawn there, wherever they sit, and only wind (and the weather icon, unless the chart has its own sun or moon icon) remains. Minimum and maximum temperature show only on the daily pages; wind shows only on the other pages. No face setting or compiler change affects this; to keep weather on screen with sunrise and sunset times, use the Sunrise / sunset field instead of the chart's sun page.

**Bars or a line is the watch's choice, per chart group.** Sun and moon groups draw a line (line thickness, upper/lower colors); daily data (stress, stamina, steps, calories, elevation), barometer and tide draw bars (bar width/gap, selected/other colors). Both styles are exported, and a width of 0 hides that style on every group that uses it. The inspector shows both, marks the one the selected chart data uses, and the preview follows it. Evidence: with both styles configured, a PACE Pro drew SATISFY 1's sunrise group as a line and its barometer group as bars (2026-10-12); official SATISFY 1/2 (sun, moon) set only a line width, and SATISFY 3 (barometer, tide) only a bar width. Tide bars are not yet confirmed on a watch. Barometer and tide pages need data synced from the phone; until the phone connected, the barometer page stayed empty, which is a sync state, not a graph-style result. The no-data artwork component is meant for that state. Older projects may carry `chartStyle.previewType`; it is ignored.

**A graph needs a chart number on the watch.** A face whose chart has every number hidden drew no graph on the watch until the number was turned on (2026-10-13), although the compiled graph is the same either way. So with the graph shown and its number hidden, the export writes an invisible number for the selected chart data inside the plot: ten transparent 1×1 digits (thirty frames for moon phase), plus a blank icon and colon. Reopening the face shows that number as hidden. Whether an invisible number is enough is not yet confirmed on a watch.

Defaults are generated at export resolution. The original SIMPLE daytime/nighttime weather artwork remains the weather icon default. Select a native layer and use **Customize component** to edit its individual parts:

- Labels and arrows: type replacement text (for example, change `TL` to `LOAD`), choose a font/color, or replace the image. Sunrise and sunset arrows have separate artwork states.
- Numbers, units, symbols and status artwork: edit dimensions, font/color and individual glyphs or import numbered PNGs. Missing files keep their defaults.
- Graphs: set the plot position/size, selected/other bar colors, bar width/gap, background, mask and missing-data artwork.
- Solar progress and decimal points: replace their artwork and change dimensions. The compiler's `chart_point_icon` represents a numeric decimal point, not a graph-point marker.

Each component can be shown or hidden. Position offsets are offered where the native format supports them; the watch places units, symbols and decimal points beside the value. Minimum/maximum temperature share the firmware's unit and minus assets; minimum-temperature settings supply them when both fields are enabled.

The watch draws minimum and maximum temperature as one reading: the minimum, a separator, the maximum and a single unit, each right after the previous glyphs, starting at the minimum's position. The maximum's own rectangle doesn't move it. [Issue #131](https://github.com/JunAkerBuilds/CorosLink/issues/131) showed `1327°C` at the minimum's spot for a face whose editor placed 12°C and 24°C on opposite sides. That export used an invisible separator. Studio now matches the watch. With both fields shown, the maximum follows the minimum in the preview and the export, and dragging either moves both. The minimum has a **Min/max separator** component: a digit-sized `/` by default, like official NOMAD, GLASS and NIGHT CLIMBER faces. It can be restyled, replaced or hidden. Only one unit is drawn, after the maximum. Recovered official faces keep their original separator artwork. Reopened exports that used the invisible separator keep it hidden until it's turned on. The run's layout for right- or center-aligned minimums, and for readings other than two digits, has not been verified on a watch.

**Restore component defaults** resets the selected part, and **Restore all appearance defaults** resets the layer's appearance while keeping its position and data source. Both support undo. Replacement images and text stay in the editable project. Font/color changes affect generated defaults; imported artwork keeps its colors. Replacing artwork accepts PNG/JPEG/WebP and stores PNG.

Preview values and graph history are examples. **Graph type** is locked to **Bar graph**. Older curve samples also render as bars without changing their saved settings. Legacy curve export parameters are preserved for compatibility, and firmware chooses the live representation. For a watch displaying bars, adjust **Bar width**, **Bar gap**, **Selected bar** and **Other bars**. Line appearance controls are unavailable for now. Samples are never flattened into the exported background: the configuration binds the sprites to the watch's native data. Current and AOD settings are independent when the source template supports AOD. SIMPLE itself has no AOD configuration.

## Evidence and testing boundary

Keys come from the supplied COROS 4.9.9 library; see [the inspection](research/coros-4.9.9-watchface-compiler.md). The numeric chart helper at `0x1f6bd8` expands prefixes with `_icon_pos`, `_icon`, `_rect`, `_font`. The rise/set helper at `0x1f7238` expands `_icon_pos`, `_hour_rect`, `_minute_rect`, `_font`, with separate rise/set icon keys. These are parser-supported keys, not new selectable-control IDs.

Automatic format floors are 3 for extended status/training, 5 for sun progress, 6 for sleep score, and 2 for the chart block. Existing higher template versions are preserved. These floors follow the recovered format enum; final compiler/firmware behavior still needs a device test.

The Android compiler has not been executed in this environment. A built/exported ZIP and a successful preview do not establish device support. Test first on the target watch with the updated COROS app. In particular:

- Wind defaults assume 16 clockwise directions, HRV defaults label indices 0–7, and moon defaults have 30 phase frames. Their exact counts/order need device/template confirmation. HRV is a status, not milliseconds.
- Training unit artwork is km/mi for running and cycling, km/yd for swimming, and m/ft for elevation. PACE Pro firmware 3.2008.0 receives distances in centimetres and shows hundredths of a kilometre or mile (of a yard for imperial swims). Without a decimal point it rounds to a whole number, so a metric 750 m swim shows `1` and 300 m shows `0` ([issue #153](https://github.com/JunAkerBuilds/CorosLink/issues/153)). Each distance total has a **Decimal point** component, a CorosLink-only `*_point_icon` key the firmware reads at header `0x1202 + 4 × index`, just past the 0x1202-byte header COROS writes. With it the watch shows two decimals (`0.75`). It is on by default for swims, off for runs and rides. Faces that use it get 0x1222-byte headers, as some official faces have. COROS's compiler ignores the key, and the decimal point is not yet confirmed on a watch.
- Graph selection, live updates, missing-data behavior and solar progress require on-watch checks. No dedicated heart-rate chart is exposed because its configuration prefix was not established.
- Categorical UV/AQI/training/stress/stamina level artwork, localized sleep-score labels and fishing displays are not added by this implementation.

## Local checks

`npm run build`, the editor/studio/automation suites and `npm run test:watchface-automation-e2e` verify the UI and archive pipeline, including typed labels, component reset/undo, graph visibility, bars-only selection and bar width. After building Electron, run `npx electron scripts/test-watchface-native-data.cjs [path/to/SIMPLE.zip]` for all 25 field definitions, all 12 chart choices, resolution scaling, Current/AOD asset separation, version floors, customized labels/glyphs/graph styling, independent component visibility, exported artwork dimensions and project round trips. `scripts/test-watchface-weather.cjs` retains the SIMPLE weather/default-artwork regression check.

## Calendar year and fields absent from a template

Year (`date_year`) is an addable Calendar field, using the COROS 4.9.9 compiler's
`control_number_date_year_rect` / `control_number_date_year_font` binding
(`WFControl.number_date_year`, `WFRectNumberValue`; see the compiler research).
It has a value component with ten digit PNGs, no icon or static year artwork.
Export creates the configuration and assets at every resolution, and reopening
hydrates the original digit artwork. The COROS parser promotes this binding to format version 3;
on-watch behavior remains unverified. Preview follows the simulation date.

Year is independently positioned and visible in Studio; it does not require a
visible selectable metric. Unlike month/day, its native binding shares the
selectable metric's control container. Export keeps a valid container origin
when that metric is hidden and converts the year's editor coordinates relative
to the final origin. Recovery adds the origin back. AI context includes this
behavior so agents do not enable the metric or manually offset the year.

AI can use `add_native_field` for any supported catalog field absent from the
starting template. The command supplies defaults and initializes the design map;
the exporter creates missing bindings/assets. The catalog remains the source of
supported firmware fields, rather than the list of layers in the original face.
