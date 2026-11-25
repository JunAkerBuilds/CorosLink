# Watch Studio parity: CorosLink → C-LINK Desktop

Checked 2026-11-25 against clink-desktop `main` at `cb0ff9e` (plus the uncommitted Studio edits in the main
checkout at that time). Source of the CorosLink feature list: CorosLink `docs/watch-face-studio.md` and
`docs/replacement-checklist.md` §5. How each phase got here is in `docs/studio-port.md`.

Key: ✅ there · 🟡 partly there (gap noted) · ❌ missing · ➖ left out on purpose

Method: I read the C-LINK Studio screens (`desktop/renderer/pages/Studio*.tsx`, `parts/Studio*.tsx`,
`studio*.ts`) and `desktop/main/watchface/*`, and searched them for each CorosLink control. A ❌ means I found no
code for it, not that I clicked through the app. I didn't run the app or the tests for this report.

## Summary

| Area | Status |
| --- | --- |
| Engine, compiler, BIN, the "Must not regress" rules | ✅ moved over as modules with their tests |
| Hub: My faces, Templates, Official, Community, sign-in, import | ✅ (share-link import and private community faces missing) |
| Time, date, live data, selectable slot, charts, battery, weather, status | ✅ mostly; a few rough edges listed below |
| Typography, fonts (system, Google, PNG folder, official) | ✅; sprite-sheet PNG fonts missing |
| Canvas tools (groups, layer order, box select, rulers, grid, crop, rotate) | ❌ the biggest gap |
| Project tab (raw config, ID overrides) | 🟡 Face version and Strip blank keys only |
| Simulation | 🟡 time, battery, weather, presets; progress %, per-field values and chart history missing |
| Send: Watch (Bluetooth), COROS share link, iPhone, File, Convert | ✅ |
| Watchmaker AI and the automation MCP server | ❌ (phase 7, not started) |
| Activity screens editor (DEV-only in CorosLink) | ❌ |

## 1. Hub

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Watch picker for catalogs and new faces | ✅ | "On your watch" picks the watch |
| Create → From a template (Editable / Official / My faces) | ✅ | Templates tab; Official and My faces need sign-in |
| Template search, category, sort COROS order / Newest | ✅ | |
| Advanced filters (firmware type, language, max version, serial, model version) | ✅ | Serial replaced by an "Exclusive watch faces" picker (7e72d59) |
| Start blank | ✅ | |
| Import ZIP / DAT / BIN | ✅ | Recovered BINs open as editable copies |
| Import a COROS share link | ❌ | Listed in "Left in phase 5" |
| My projects: search, sort, Duplicate, Delete, Continue designing | 🟡 | Sort is Last edited / Name only (no Oldest first); no filter by watch model |
| Community: search, filters, sort, variants, Load more, Open anyway | ✅ | Endless scroll in place of Load more; Animated ribbon |
| Community private faces (website account token) | ❌ | C-LINK has no website account yet |
| `coroslink://watchfaces/…` deep links from the website | ❌ | "Save or discard first" prompt goes with it |
| COROS sign-in, region, saved account, disconnect | ✅ | Sealed with the keychain |
| Training Hub and Studio sharing one saved COROS login | ❌ | Phase 5 leftover |
| On watch tab: slots, firmware | 🟡 | Slots shown in Send once Local mode pairs the watch; no iPhone pairing QR or battery history here |

## 2. Editor shell

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Name, Saved state, Undo / Redo, Save, Download, Convert, Send | ✅ | Autosave on top of ⌘S |
| Hide the Layers / inspector panels | ❌ | |
| Full screen canvas (Esc exits) | ❌ | |
| Simple / Advanced mode | ➖ | Replaced by inspector sections with an Advanced fold |
| "Make this face yours" quick edits with nothing selected | 🟡 | The Face inspector has colour, accent, background colour and photo; no "Style the time / Add text / Add a shape" shortcuts |
| Missing-font notice (which families, where used) | ❌ | Font snapshots draw missing fonts, but nothing tells the user |
| Edit history list | ❌ | Undo / redo only |

### Shortcuts

| Shortcut | C-LINK |
| --- | --- |
| ⌘S, ⌘Z, ⇧⌘Z, Ctrl+Y | ✅ |
| Delete / Backspace (hides, or removes Studio-added parts) | ✅ (no confirm dialog; a toast says how to undo) |
| Arrows nudge 1 px, Shift ×10 | ✅ |
| Esc clears the selection | ✅ |
| Shift-click adds to the selection | ✅ on the canvas; ⌘-click in the list not found |
| Alt while dragging skips snapping, Shift locks to one axis | ✅ |
| ⌘D duplicates an image | ❌ |
| ⌘G / ⇧⌘G group and ungroup | ❌ |
| Option while resizing resizes from the centre | ❌ |
| Shift while rotating snaps to 15° | ❌ (no rotation handle) |
| Enter / Esc apply or cancel a crop | ❌ (no crop editing) |
| Alt+↑ / Alt+↓ reorder | ❌ |
| Double-click deletes a guide | ❌ (no guides) |
| Number fields scrub when dragged | ✅ (43dc1f3) |

## 3. Layers panel

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Grouped list (Time, Components, Indicators, Metrics, Background) | ✅ | |
| Select, multi-select | ✅ | |
| Hide / show per row | ✅ | Whole groups at once: not found |
| Lock per row | ✅ | Group lock: not found |
| Reorder by dragging, Move backward / forward | ❌ | Artwork has a fixed paint order |
| Find a layer | 🟡 | Search is in Add; a search over the face's own layers not found |
| Link badge on linked components | ➖ | Shared spots are now one row (Bluetooth / DND / airplane / sleep) |

## 4. Add menu

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Image, Text, Rectangle, Ellipse, Line | ✅ | Image also by dropping a file from Finder |
| Official COROS artwork | ✅ | "From COROS faces" tile, library with filters and frame stepping |
| Time: hour / minute, Seconds, Analog hands, AM/PM | ✅ | |
| "Add time" in one step on a blank face (brings the colon, tints digits) | ❌ | Hours and minutes come back one row at a time |
| Calendar: weekday, month, day, year, lunar | ✅ | Lunar marked Not confirmed |
| Weather: icon, current, min/max, wind, rain, humidity, UV, AQI, barometer | ✅ | AQI marked Not available |
| Health, Training, Astronomy fields | ✅ | Every field the native catalog knows |
| Device: battery, Bluetooth, DND, airplane, sleep, touch lock | ✅ | |
| Animation, Negative sign | ✅ | |
| Charts (experimental) | ✅ | One Chart entry with a start picker |
| "On face" rows select instead of adding twice | ✅ | |
| Per-watch filtering of the list | ➖ | CorosLink lists every field for every watch too |

## 5. Canvas

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Click to select, Shift-click to add | ✅ | |
| Box-select by dragging on empty space | ❌ | |
| Drag to move | ✅ | Ghost-free drag frames (studioDrag.ts) |
| Resize handles | ✅ | Corners, one layer at a time (43dc1f3) |
| Rotation handle | ❌ | Rotation is typed in the inspector |
| Right-click "Component actions" menu | ❌ | The layer header's More actions menu covers some of it |
| Align left / centre / right / top / middle / bottom | ✅ | Inspector, with several layers picked |
| Align glyph baselines | ❌ | |
| Distribute horizontal / vertical | ✅ | |
| Group / Ungroup | ❌ | |
| Match height (status icons to text) | ❌ | |
| Zoom 60–140 % | 🟡 | The canvas has a zoom value internally; a −/+ control not found |
| Current / Always-on switch | ✅ | |
| Smart-guide snapping to layers and the face centre | ✅ | By ink, with equal-spacing snaps and gap readouts; better than CorosLink |
| Safe-area guide | 🟡 | On / off toggle; no adjustable inset |
| Grid (4 / 8 / 16 / 32 px) | ❌ | |
| Rulers and project guides saved with the face | ❌ | |
| Snap to face edge / safe area / guides / grid | ❌ | Follows from the three rows above |

## 6. Inspector

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Layer name for free layers | not checked | |
| Layer opacity | ✅ | |
| Shows on (Current / Always-on) | ✅ | |
| Position X / Y, Align to face, Nudge | ✅ | |
| Width / Height with proportion lock, Scale % | 🟡 | Size for shapes, Zoom for images; no proportion link found |
| Rotation | ✅ | |
| Flip X / Y, Skew X / Y | ✅ | |
| Transform origin (nine anchors) | ❌ | |
| Crop editing (drag the box) | 🟡 | Only "Remove the crop" on an image that has one |
| Use imported size | ❌ | |
| Tint image | ✅ | |
| Font: system, typed family, Keep template font, Official COROS font | ✅ | Plus Google Fonts through the main process |
| Font size, Weight (synthesised), Style | ✅ | |
| Colour with hex and opacity | ✅ | |
| Glyph height, Baseline, Sprite spacing, Digit width, Reset fit | 🟡 | Spacing and digit width (live data) are there; glyph height / baseline / Reset fit not found |
| Number alignment incl. Auto | ✅ | |
| Rasterize preview | ❌ | Send's 1:1 compiled preview stands in |
| PNG font: Folder | ✅ | Per layer or whole face, Use layer colour |
| PNG font: Sheet (columns, glyph order) | ❌ | |
| PNG font: single Files that override a set | ❌ | |
| PNG font: Official | ✅ | |
| Missing digits shown as dashed cells | not checked | |
| Strokes: stack, Inside / Center / Outside, width, opacity, hide, reorder | ✅ | |
| Stroke paint: linear gradient with angle | ❌ | Solid colour only |
| Effects: drop and inner shadow stack | ✅ | |
| Save as style / Detach style | ❌ | |
| Text: content, font, size, weight, colour, align | ✅ | |
| Rectangle / ellipse: fill, gradient, corner radius | ✅ | Two-stop gradient |
| Line: length, thickness, colour | ✅ | |

## 7. Time, date and indicators

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Separate hours and minutes | 🟡 | One-way: can't join them back |
| Colon and date-slash separators: restyle, replace | ✅ | A colon picture turns the drawn colon off |
| Exercise separator (text colon or PNG that follows the metric) | ❌ | Not found |
| Seconds added from the minute digits, Remove seconds | ✅ | |
| AM/PM | ✅ | |
| Analog hands: add, replace image | ✅ | |
| Analog hands: Download a template hand at full canvas | ❌ | |
| Animation: per-frame delays, Set all, play / pause, Replace frames | ✅ | Plays on the canvas (b7485b6) |
| Animation: per-watch outcome ("plays 12 of 44 on PACE 3"), dimmed frames, preview of what that watch shows | ❌ | The build still trims and drops frames; the editor doesn't say so |
| Date: TUE / Tue / Tuesday, month as number or words, alignment | ✅ | |
| Translate for watch languages, per-language overrides | ✅ | |
| Date synthesised on faces without one | ✅ | |
| Status indicators: on / off images, replace, size | ✅ | As one spot per position |
| Match height to text | ❌ | See Canvas |
| Battery states: folder of numbered PNGs, Official sprites | ✅ | Battery % has its own colour, size, gap and height (8ef8842) |
| Control battery icon in the selectable slot | ✅ | |
| Arc cut overlay | not checked | Treated as a template image |

## 8. Metrics

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Selectable metric: types, icons, import an icon, value tint, Icon offset, Preview data | ✅ | Plus warnings for blank `control_*` keys |
| Drag a slot icon on the watch | ❌ | Icon offset is typed |
| Slot icon: Download, Native PNG size, zoom | ❌ | |
| `control_percent_icon` | ❌ | |
| Native field parts: label text overrides (`TL` → `LOAD`) | ❌ | "Per-asset text overrides" listed as not done |
| Native field parts: show / hide, colour, offset, digit width, Restore all | ✅ | |
| Restore one component's defaults | not checked | |
| State artwork (stress, stamina, UV, weekly load) | ✅ | |
| Weather icon: replace day / night sets and digits from numbered PNGs | 🟡 | Official sets and restore work; importing a set from a folder and the Minus & degree / °C-°F sets don't |
| Charts: Watch pages, Add page, hide required readout, add optional readout | ✅ | |
| Charts: Make fixed / Put back | ✅ | Current face only, as CorosLink |
| Charts: line style, bar style | ✅ | |
| Charts: preview a bar page with no reading, an off page | ❌ | |
| Goal progress arc and bar: colour, geometry, remaining, fill direction, preview | ✅ | |

## 9. Background and template artwork

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Background colour, transparency | ✅ | |
| Background photo: choose, replace, remove, zoom | ✅ | |
| Template assets: replace, restore, tint, zoom | ✅ | |
| Template assets: Download largest copy | ❌ | |
| Template assets: Native PNG size / Native scale, Sprite rotation | 🟡 | Quarter turns on battery icons; elsewhere not found |
| Official images for any asset | ✅ | |

## 10. Project tab

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Raw config editor (config.txt / AODconfig.txt per resolution, Reset file) | ❌ | Raw edits from CorosLink projects are kept and carried through Convert, but can't be edited |
| Watch-face version (Auto) | ✅ | Face inspector › Advanced |
| Remove blank config fields | ✅ | "Strip blank config keys" |
| Template ID override (`o_template_id`) | ❌ | The engine still patches it as raw text when set |
| Watch-face ID override (`[watchface_id]`) | ❌ | |
| Template manifest name override (`m_name`) | ❌ | |
| MIP watch theme, watch languages | ✅ | |

## 11. Always-on

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Separate always-on layout on AMOLED | ✅ | |
| Black screen, no background image | ✅ | Engine rules |
| Settings that mirror Current until customised | ✅ | Engine rules |
| "No replaceable AOD assets" notice | not checked | |
| MIP: "Current is already always on" | not checked | |

## 12. Simulation

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Time, Play / Pause, Real time … 1 day/s | ✅ | Time slider; a date field not found |
| Now, +1 s / +1 min / +1 day | ❌ | Not found |
| Battery % | ✅ | |
| Calorie and exercise progress % | ❌ | Not found in the panel (the inspector has Preview fill) |
| Weather state and day / night | ✅ | |
| Values and states for every native field | ❌ | |
| Chart history (default, rising, falling, zero) | ❌ | |
| Presets: low / full battery, midnight, new year, leap day, wide numbers, reset | ✅ | |
| Status spots and selectable slot stepping | ✅ | New in C-LINK |

## 13. Watchmaker and automation

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Watchmaker AI chat (live edits, images, model / effort, Stop, saved chats per face) | ❌ | Phase 7; plan is to use the app's own AI providers |
| Watch-face automation MCP server for external AI | ❌ | The engine's automation schema files came over; no server |

## 14–15. Save, convert, send

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Save, Editable project ZIP (opens in either app) | ✅ | |
| Final watch ZIP, Development export, Save BIN | ✅ | Plus "All watches" |
| Convert from the 800 master with an official carrier | ✅ | Also faces without a master |
| Convert carries the open chart page across | ❌ | `carriedWatchfacePreferences` not ported |
| Compiled 1:1 preview, Current and Always-on | ✅ | |
| Pixel checks with Show | ✅ | |
| Watch languages, weekday per language | ✅ | |
| Full color (AMOLED), Smooth edges (MIP) | ✅ | |
| Install on watch over Bluetooth into a slot, replace, verify | ✅ | Through Local mode; tried only as far as `docs/studio-port.md` and Local mode notes say |
| COROS share link + QR, 10,485,760 B cap, lossless shrink | ✅ | |
| Send to iPhone over Wi-Fi | ✅ | AirDrop not found |
| Prepared BINs kept (4, 15 min) | ✅ | |

## Engine rules ("Must not regress")

All moved with their tests in phase 1 and the later phases: BIN cap 0x320000 and magic per screen; face ID
0xFFFFFFFF empty slot and 10 slots padded only on PACE Pro; COROS upload cap; 25 MB official archive; MIP u16
offsets; animation ≤44 frames and MIP fit; full-RGB chart colours; byte-exact MIP `OptimizeBitmap`; Full color
fallback; `m_preview`; 12-frame month table only with a point rect; no PACE 3 date swap; no static barometer
branch; raw-text `o_template_id`; convert from the 800 master and keep the dormant AOD; invisible chart number;
`stress_level_icon_pos`.

Known open issues carried over: the eight-frame wind-direction assertion (fails in CorosLink too), and the
German layer-search test not moved.

Not checked here: the hash-pinned `614A` legacy patch and `watchfaceDistribution.ts` clean packages — I didn't
search for them.

## Also not done (from docs/studio-port.md)

- `renderFace` / `buildInput` and the drag-frame composition still run on the page's thread; phase 2 was to move
  them to a worker.
- Google Fonts fetch Latin faces only; CorosLink's offer to swap a missing "RobotoBold" for the Google family.
- Official library browser: card sizes, Crisp pixels, 1×–4× zoom.
- Artwork order (bring forward / send back).

## Suggested order for what's left

1. **Canvas tools** (phase 3, still open): box select, groups with ⌘G, layer order with Alt+↑/↓ and dragging rows,
   rotation handle with Shift snap, crop with Enter / Esc, ⌘D, right-click menu, zoom control, grid, rulers and
   guides, glyph baselines, Match height, full screen, panel toggles.
2. **Project tab**: raw config editor and the three ID / name overrides.
3. **Fonts and parts**: sprite-sheet and single-file PNG fonts, gradient strokes, effect styles, glyph height /
   baseline / Reset fit, label text overrides, weather sets from a folder, Download for template images and hands.
4. **Simulation**: date, Now and step buttons, progress %, per-field values, chart history.
5. **Sources**: share-link import, deep links, private community faces, shared COROS login.
6. **Watchmaker and the automation MCP server** (phase 7).
