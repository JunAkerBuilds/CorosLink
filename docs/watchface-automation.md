# Watch Face Studio automation

CorosLink can expose an opt-in local MCP server so Codex and other MCP clients
can inspect and edit the watch face that is open in Watch Face Studio. The
server listens only on `127.0.0.1`, requires a private bearer token for every
request, and does not evaluate code or accept arbitrary network URLs.

Automation changes the same editable project used by the visual editor. One
`apply_commands` call becomes one undo step, and the human can watch the canvas,
selection, and inspector update while the agent works.

## Connect Codex

Open **Settings → External AI** in CorosLink and enable watch-face automation.
CorosLink shows the local server URL and a masked token. Use the explicit
**Copy Codex configuration** action to copy a complete entry, or add the
following to the Codex MCP configuration with the values shown by CorosLink:

```toml
[mcp_servers.coroslink_watchfaces]
url = "http://127.0.0.1:PORT/mcp"
http_headers = { Authorization = "Bearer TOKEN" }
tool_timeout_sec = 180
```

The token is a local capability credential. Keep it out of repositories, chat
messages, screenshots, and issue reports. CorosLink stores it in its user-data
directory with owner-only permissions. Ordinary application restarts preserve
it. Disabling automation revokes it, so the copied configuration stops working
until automation is enabled and copied again. Configuration fields follow the
[official Codex MCP documentation](https://developers.openai.com/codex/mcp/).

The server rejects unauthenticated requests before creating an MCP session,
checks the exact loopback Host and Origin, limits request bodies, and creates an
independent MCP transport for each client. It is never bound to the LAN.

## Recommended agent workflow

1. Call `get_context`, then `get_schema`. Open a project or template if needed,
   then call `get_document`. The document includes a `sessionId`,
   monotonic `revision`, resolved semantic layers, Current/AOD mode, template
   capabilities, target resolutions, and export diagnostics. Read
   `capabilities.placement` and each layer's `placement` before positioning
   anything.
2. Generate artwork when needed, save it as a local PNG/JPEG/WebP, and call
   `import_asset`. Use the returned `{assetId}` in edit commands. Raster-font
   folders use `kind = "raster_font_folder"` and may contain PNG files only.
3. Call `apply_commands` with the exact `sessionId` and `baseRevision`. Group a
   coherent visual change into one call so the human can undo it in one step.
4. Call `render_preview` for both `current` and `aod`. It returns a visible PNG,
   an asset reference, and the revision that was rendered.
5. Call `validate`, fix blocking diagnostics, and call `save`.
6. Build or export only after the editable project is saved. Publishing requires
   explicit user authorization for the exact archive and `confirmed = true`.

If a person edits the face between inspection and mutation, `apply_commands`
rejects the stale revision. Read the document again and reapply the intended
change to the new revision. `undo`, `redo`, `convert`, and other document
mutations also require the current editor session and revision. Selection and
view changes use the session but do not advance the document revision.

## Editing model

Paths in generic commands use RFC 6901 JSON Pointer syntax rooted at the live
document’s editable value. Design paths begin under `/design`; rename a draft
with `/projectName` (reported as `project.name` by `get_document`). The schema describes semantic
commands for common work such as adding artwork, moving layers, changing styles,
visibility and locks, grouping layers, guides, and mode overrides. Generic
`set`, `unset`, `merge`, and array commands make every current design property
editable without adding a new MCP tool whenever the editor model grows.

Placement commands use the master-pixel frame reported by
`capabilities.placement`:

```json
{
  "width": 800,
  "height": 800,
  "unit": "pixels"
}
```

The master is the largest native resolution in the open template. It is often
800 x 800, but that size is not guaranteed. Each semantic layer reports
`placement.bounds` as `{x0, y0, x1, y1}` (or `null` without usable bounds) in the same frame,
`placement.movable`, and a `placement.movementKey`. Layers with the same
movement key share one stored native position and move together. Editor groups
also move as rigid selections, including any physically linked companions.

Bounds are rotation-aware axis-aligned rendered bounds. Text bounds use the
browser's actual font metrics. Decorative effects such as shadows and strokes
do not enlarge placement bounds. Locked layers, unavailable firmware features,
and layers without reliable bounds report that they cannot move; placement
commands reject unsupported or out-of-bounds results instead of silently clamping.
An already off-canvas layer may stay unchanged on an axis or move toward the canvas.
Analog hands may clip at the edge while their shared pivot remains within the face.

`move_layer` applies `dx` and `dy` in this master-pixel frame to every supported
layer type. Firmware-backed layers store integer native offsets, so their final
positions are quantized when translated back to native coordinates. Authored
artwork and freeform elements preserve fractional coordinates when moved alone.
A rigid selection containing native layers uses one shared whole-pixel delta for
all its members, preserving their relative spacing. Background
element (`bgel:*`) raw `x` and `y` fields remain in their 800 x 800 artwork
space; the layer's reported placement bounds are still in the current master
frame. Other firmware-backed raw geometry may carry a
`referenceWidth`/`referenceHeight`; those raw fields stay in that declared
coordinate system and are scaled during export. Crops and transform origins are
normalized from 0 through 1. Angles are degrees clockwise from the positive X
axis; opacity is normalized from 0 through 1.

`place_layers` treats the requested layers and every group-linked companion as
one rigid union. At least one of `x` or `y` is required. It places the requested
axis of the union's rotation-aware bounds at that coordinate. `anchor` defaults
to `center` and accepts `top-left`, `top`, `top-right`, `left`, `center`,
`right`, `bottom-left`, `bottom`, or `bottom-right`.

`align_layers` aligns physical selection units by `left`, `center-x`, `right`,
`top`, `center-y`, or `bottom`. Its `reference` may be `canvas`, `selection`, or
`{"layerId":"..."}`. When omitted, it defaults to `canvas` for one physical
selection unit and `selection` for multiple units. A reference layer remains
stationary and is rejected if it belongs to the moved selection.

`distribute_layers` works on physical selection units and sorts them by their
current spatial order, independent of `layerIds` order. With an explicit
nonnegative `gap`, it requires at least two units, keeps the first spatial unit
fixed, and places every following unit at that edge gap. With no `gap`, it
requires at least three units, keeps both endpoints fixed, and makes the gaps
between adjacent edges equal.

For example, after reading an 800 x 800 placement frame and confirming the
native `hours` layer plus two authored text elements are movable, these are
valid commands:

```json
{
  "sessionId": "SESSION_FROM_GET_DOCUMENT",
  "baseRevision": 12,
  "label": "Arrange time and labels",
  "commands": [
    {
      "op": "place_layers",
      "layerIds": ["bgel:title"],
      "x": 400,
      "y": 160,
      "anchor": "center"
    },
    {
      "op": "align_layers",
      "layerIds": ["hours", "bgel:title"],
      "alignment": "center-x",
      "reference": "canvas"
    },
    {
      "op": "distribute_layers",
      "layerIds": ["hours", "bgel:title", "bgel:subtitle"],
      "direction": "vertical"
    }
  ]
}
```

For a fixed 24-pixel vertical gap between the native hours and title, use
`{"op":"distribute_layers","layerIds":["hours","bgel:title"],"direction":"vertical","gap":24}`.
The command sorts them by current position and keeps the upper unit fixed.
Always use the returned layer ids and dimensions rather than copying the sample
coordinates or assuming a template contains a particular metric, AOD tree, or
resolution.

Image bytes are not repeated in tool JSON. `get_document` replaces embedded
data-image URLs with opaque `{assetId}` objects, and the server restores them
only at the trusted editor dispatch boundary. Assets are content-addressed,
integrity-checked, private to CorosLink's user-data directory, and bounded by
count and size limits.

## Native data and component customization

`get_schema.nativeData` lists all 25 Weather, Astronomy, Health, Training and
chart field definitions, 12 chart sources, default styles, available components,
artwork roles and valid state indices. The live document includes the supported
IDs under `capabilities.nativeData`; each configured native layer also reports
its component edit paths, effective styles and whether its position is editable.
This includes labels/arrows, digits, units, symbols, state artwork, solar progress,
graph styling, decimal points, backgrounds, masks and missing-data artwork.

Create a field by setting `/design/nativeData/<id>` to the catalog's defaults,
then change the desired values. If `nativeData` is absent, first initialize it
to `{}`. Keep existing fields when adding another one. Generic pointer parents
must exist; `merge` merges only one level. For example, after initializing the
map, this adds a customized training-load layer (adjust coordinates to the
document's master canvas):

```json
{
  "op": "set",
  "path": "/design/nativeData/week_tl",
  "value": {
    "enabled": true, "x": 100, "y": 200, "scale": 1, "color": "#ffffff",
    "assetTexts": { "icon": { "0": "LOAD" } },
    "parts": {
      "icon": { "width": 80, "height": 48, "color": "#00ff00" },
      "value": { "x": 90, "width": 120, "height": 48 }
    }
  }
}
```

`native:<id>` is the semantic layer ID for positioning, visibility, grouping and
locks. Parts use offsets and dimensions in master pixels before the layer scale.
Native colors must be six-digit RGB hex. `parts.<part>.enabled` hides one part;
`set_visibility` hides the whole layer. Units, symbols and decimal points have
firmware-controlled positions. Native edits respect locks and form an undo step
with the rest of their command batch.

For images, import a **PNG** with `import_asset`, then put its `{assetId}` under
`assets.<role>.<stateIndex>`. State keys are unpadded, such as `"0"`; numbered
folder files such as `00.png` map to that key. The same references work under
`weatherIndicator.assets` for the original SIMPLE defaults. Unspecified images
keep their defaults. Imported images override `assetTexts` for that state.
Use `unset` on existing optional `assets`, `assetTexts`, `parts` or `chartStyle`
overrides to restore defaults; preserve the required layer fields.

For `nativeData.chart`, use `chartSource`, `parts.plot` and `chartStyle` for
geometry, bar colors, bar width/gap, line thickness and curve colors. There is
one chart slot per mode. `chartStyle.previewType` (`"bars"` or `"curve"`) only
selects the sample preview; both appearance sets are exported and firmware
chooses the live representation per chart group. Official faces draw the
sunrise, moonrise, barometer and tide groups as curves and the health/training
groups as bars. Readouts of other chart groups that a recovered official face
already declares are kept on export; the layer replaces only the shared graph
and its selected source. The preview follows the chart layer's group:
`chart_sun_angle` draws only in the sun group, and `weather_temp`,
`weather_temp_min`/`max`, `weather_wind` and `weather_direction` are hidden
only where they share a slot with that group's alternative, while staying
enabled and exported. The `decimal` component is a numeric decimal point.
Charts are experimental. Bar rendering has been reported on PACE Pro, while
history selection and live updates remain unverified. `chartSource` selects
the numeric/icon field written to the shared chart block, not a verified
selector for the watch's plotted history. Do not report live chart support
from a successful preview, validation or ZIP export. For bars, use bar width,
gap and selected/unselected colors; curve styling does not control bars.
PACE Pro testing reports that Back changes the chart while the number remains
absent. Cycling is not a verified fix for missing chart numbers. A separate
metric layer supplies an independent value and will not follow chart changes.
The catalog exposes `lineGraphAvailability` and the AQI field's `availability`
with status `unavailable` and label `Not available right now`, matching the UI.
`chartPreviewTypes` contains only `bars`; the editor has no selectable line option.
These report the current PACE Pro testing limitations; they do not remove
saved layers, block editing or establish permanent firmware incompatibility.
Minimum/maximum temperature share unit/minus artwork; minimum supplies it when
both are enabled. A configured `weather_temp` takes over the weather companion's
temperature slot; remove that field to return control to the companion.
**Current weather** (`nativeData.weather_temp`) displays weather temperature independently of the watch's
sensor temperature (`metricChanges.temperature`, `metricStyles.temperature`
and the `temperature` selectable control). The sensor reading can be affected
by body heat; do not treat it as weather or core body temperature. Simulation
uses separate `values.weather_temp` and `values.temperature` keys, with no
fallback or synchronization between them.

Pass `mode: "aod"` to `apply_commands` with the same `/design` paths to edit AOD
independently, when the template supports it. Render both modes, validate and
build after editing. Device support and live behavior still need on-watch tests.
After updating CorosLink, restart the app and reconnect the MCP client if needed,
then fetch `get_schema` again to refresh cached tool/schema information.

## Hide and show layers

Use `set_visibility` with a semantic layer id from `get_document` and a boolean
`visible`. Hiding keeps the layer, its artwork, styling, and position editable;
it removes it from the selected mode's preview and exported face. Set `visible`
back to `true` to show it again. Hidden layers remain in the document so agents
can discover and restore them.

```json
{"op":"set_visibility","id":"hours","visible":false}
```

The same command handles native components, text, shapes, imported images,
custom separators, AM/PM, weather, background artwork, and template assets.
`background` controls the background artwork; the face's base color remains.
Use `group:<group-id>` to hide/show a whole editor group, for example
`{"op":"set_visibility","id":"group:header","visible":false}`.
Targeting an individual member affects that member only. Locks block the edit;
a group operation fails atomically if any member is locked. Current and AOD
visibility are independent, and each command batch can be undone.

## Tools

Call `get_context` first to learn whether Watch Face Studio already has an open,
possibly dirty document. The live-editor tools are `get_document`,
`apply_commands`, `select`, `undo`, `redo`, `set_view`, `render_preview`,
`validate`, `save`, `close`, `open`, and `convert`.

`convert` accepts `watchModel` (for example, `pace-3`) with the live `sessionId`
and `baseRevision`. It selects device support automatically and preserves the
source layout, fonts, artwork, raw edits and separate AOD state through MIP
transitions. `targetArchive` remains an optional preselected device carrier;
it must match the destination. Conversion opens a new session only after the
archive is ready. Read `get_document` again before further edits. See
[watch conversion](watchface-conversion.md) for supported devices and validation.
Project and host tools include `list_projects`, `list_templates`, `load_template`, `list_fonts`,
`duplicate_project`, `delete_project`, `import_archive`, `import_asset`,
`export_project`, `build_archive`, `export_archive`, and `publish`.

`open` can select a saved project or a previously imported starter archive. A
dirty editor refuses to switch or close unless the request explicitly asks to
save or discard those changes. `close` requires the current `sessionId` and
`baseRevision`. Project deletion requires `confirmed = true`, and an open
project must be closed before it can be deleted.

Local import and export paths must be absolute and bounded. Imports accept only
the declared image, raster-folder, or watch-face archive formats. Exports use an
explicit destination and do not overwrite an existing file. Tool inputs never
cause CorosLink to fetch an arbitrary URL.

## Editable project, archive, and installation

An editable project preserves the starter template and full CorosLink design
state so it can be reopened and changed later. `export_project` creates this
portable editable package.

`build_archive` flattens the current scene where required, regenerates firmware
sprites and config values, and runs the existing model/resolution/archive
validation. `export_archive` writes that built `.zip` or `.dat` package locally.
Building or exporting does not install anything on a watch.

After placement, call `get_document` again and render the relevant Current and
AOD previews to observe any native-coordinate quantization. Then validate and
build the device archive so export-time scaling is checked at every required
resolution.

`publish` uses the signed-in COROS mobile session to create the official phone
handoff. The user still claims the result in the COROS mobile app and sends it to
the watch. Raw device installation is outside this MCP surface.

## Preview simulation

The editor's **Simulation** control previews battery charge (number and normal
icon states), clock time, the full calendar including year/month/day/weekday,
activity samples, weather artwork and temperature, native health/training data,
and chart samples. Playback supports real time, one minute, one hour, or one day
per real second. Rollover presets cover midnight, New Year, and leap day.

Simulation belongs to the editor view, not the design. It never adds undo history,
changes the project dirty flag, or changes the live-data bindings/assets in a saved
project or export. Opening another document resets it. Year drives the calendar;
only fields present in the template are drawn. This is a sample-data preview, not
firmware emulation; battery artwork uses approximate charge levels and excludes
extra charging/special-state frames. Native astronomy and chart values are manual
samples, not calculations based on location or recorded sensor history.

`get_document.view.simulation` returns the current state.
`get_schema.simulation` and `get_document.capabilities.simulation` describe its
supported values and limits. `set_view` patches simulation controls, without
requiring or incrementing a design revision:

```json
{
  "sessionId": "SESSION_ID",
  "simulation": {
    "enabled": true,
    "playing": false,
    "speed": 1,
    "dateTime": "2028-02-29T23:59:58",
    "values": {
      "battery": "5",
      "steps": "88888",
      "weather_temp": "-18",
      "week_tl": "420",
      "chart_stress": "28"
    },
    "weather": { "condition": 8, "night": true },
    "chartHistory": [0.2, 0.5, 0.4, 0.8],
    "chartProgress": 0.3
  }
}
```

`values` replaces the entire current sample map; use `{}` to restore design
samples. Omitted control properties retain their current settings. Disabling
simulation also pauses playback. `dateTime` accepts ISO date-times from 1900
through 9999; no offset means local time, and explicit offsets convert to local
time. State fields use integer asset indices. Chart history contains 2–120
normalized sample heights between 0 and 1; `chartProgress` (0–1) places the
marker along a line-graph preview. Battery and progress percentages are
0–100. Values on absent/hidden fields do not create layers.

`render_preview` uses the active simulation by default. An explicit `scenario`
object overrides it for that one image, with the same `dateTime`, `values`,
`weather`, `chartHistory` and `chartProgress` properties. Pass `scenario: {}` for ordinary sample
values. The response includes the scenario used. These overrides also apply to
native data and weather, including previews in AOD mode when those layers exist.
