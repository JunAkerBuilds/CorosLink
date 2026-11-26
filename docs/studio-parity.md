# Watch Studio parity: CorosLink → C-LINK Desktop

Checked again 2026-11-25 on branch `claude/studio-parity-b442ea` (from `main` at `71e23a1`), element by element against
CorosLink's editor (`~/Developer/CorosLink/src/watchfaces/`, mainly `WatchfaceEditor.tsx`, `NativeDataInspector.tsx`,
`CustomPngFontPanel.tsx`, `LocalFontPicker.tsx`, `WatchfaceSimulationPanel.tsx`). How each phase got here is in
`docs/studio-port.md`. The full CorosLink control inventory this list was built from (every label, with its line) is
in the session notes as `corolink-studio-inventory.md`.

Key: ✅ there · 🟡 partly there (gap noted) · ❌ missing · ➖ left out on purpose · **new** = closed on this branch

Method: I read both editors' code and searched C-LINK for each CorosLink control. A ❌ means no code for it, not a
click-through. Not covered here: the main checkout's uncommitted inspector work (it already turns every inspector
slider into a number field and drops the "Experimental" tags; see "Left for the inspector session").

## Summary

| Area | Status |
| --- | --- |
| Engine, compiler, BIN, the "Must not regress" rules | ✅ same modules; C-LINK's copy is ahead (see "Engine") |
| Hub: My faces, Templates, Official, Community, sign-in, import | ✅ (share-link import and private community faces missing) |
| Time, date, live data, selectable slot, charts, battery, weather, status | ✅ mostly; per-element gaps below |
| Typography, fonts (system, Google, PNG folder, official) | ✅; sprite-sheet and single-file PNG fonts, glyph fit missing |
| Canvas tools | 🟡 paint order and ⌘D **new**; groups, box select, rotation handle, crop, grid, rulers, guides missing |
| Project settings (raw config, IDs) | ✅ **new** (Face tab › Config files, Archive identity) |
| Simulation | ✅ **new** (date, Now, steps, progress %, every field's value, chart history) |
| Send: Watch (Bluetooth), COROS share link, iPhone, File, Convert | ✅; Convert keeps the open chart group **new** |
| Watchmaker AI and the automation MCP server | ✅ ported (`parts/StudioWatchmaker.tsx`, `desktop/main/watchface/watchmaker`, `…/automation`) |
| Activity screens editor (DEV-only in CorosLink) | ✅ Developer page, PACE Pro, developer mode only |

## Closed on this branch

| Gap | What C-LINK does now | Where |
| --- | --- | --- |
| Project tab: raw config editor | Face tab › Config files: each screen size, Current / Always-on, edit, Reset file; edits undo and save | `parts/StudioProject.tsx`, `studioProject.ts` |
| Template ID, watch-face ID, manifest name overrides | Face tab › Archive identity; saved with the project (CorosLink kept them for the session only); checked as the archive builder checks them | same, `studioFace.ts` `buildInput`, `types.ts` `archiveOverrides` |
| Simulation: date field, Now, +1 s / +1 min / +1 day | Date and time fields and step chips; the time slider is gone | `parts/StudioSimulation.tsx` |
| Simulation: calorie / exercise progress %, a value for every field on the face, chart history | Values fold: goal %, every fixed metric and live-data field on the face (states as numbers), chart history Sample / Rising / Falling / Zero; battery is a number field | same |
| ⌘D duplicates an image | ⌘D and More › Duplicate for images, text and shapes (CorosLink: images only), 16 px off, just above | `studioArrange.ts`, `StudioEditor.tsx` keys |
| Move backward / forward (Alt+↑ / Alt+↓) | Same keys, plus ⇧ for front / back, and the More menu | same, `StudioInspector.tsx` `ArrangeItems` |
| Convert carries the open chart page | The rebuilt face opens on the chart group that was open, Current and Always-on | `main/watchface/studio.ts` `carriedOf`, `studioFace.ts` `initialDesign` |
| Strokes and shadows | Stroke gradient, opacity and order; shadow duplicate and order | `parts/StudioStacks.tsx` |
| Exercise separator | Show, colour, size, centre, weight, style, PNG or text colon | `parts/StudioExerciseSeparator.tsx` |
| Animation: per-watch outcome, dimmed frames | The note says what the face's watch plays (unsupported, too large, first frame only, N of M, all with memory used); frames it leaves out are dimmed | `studioAnimationOutcome.ts`, `AnimationFolds` |

## Side by side in both apps

Code reading missed gaps that a look at the screen shows (the states switch above had no official sprites behind it),
so both editors were run on the same saved face, a copy of the user's CorosLink project SLENDER (PACE Pro, 18
live-data fields), and every Layers row's inspector was captured with every section open:

- CorosLink: `corolink-studio-shots.cjs` in the session notes, run from `~/Developer/CorosLink` with
  `npx electron <script> <project folder> <out folder>` (it needs CorosLink's `dist-electron`).
- C-LINK: `CLINK_SMOKE_STUDIO_COMPARE=<project id>` with `CLINK_SMOKE` (`desktop/main/smokeStudioCompare.ts`), after
  copying the project folder to `<CLINK_USER_DATA>/studio/projects/<id>`.

The pair-by-pair notes are `ui-compare-A.md` (time, date, template images, slot, weather, chart, background, text) and
`ui-compare-B.md` (live-data fields) in the session notes. CorosLink also lists template parts the face hides (heart
rate, steps, calories, exercise, elevation, battery); C-LINK keeps those in Add, so they weren't paired.

| Found on screen | Status |
| --- | --- |
| Live-data fields: per-part width / height, font size, own font, one picture at a time, picture text, Official per part, Reset part | ✅ on `claude/magical-meninsky-4a6b8c` (not merged here) |
| Live-data fields: Look for all parts has no Weight / Style / Spacing while the field uses the template font | ❌ (they show once a font is picked) |
| Live-data fields: no reading preview tile (click a piece to open its part); Digits part can't be hidden | ❌ |
| Live-data fields: state-band and caveat notes (stress bands, weekly load, AQI, distance decimals) | ❌ |
| Min / max temperature: one paired field with one separator in CorosLink, two layers in C-LINK | 🟡 both draw; the pairing (shared look, Add the other) isn't in the inspector |
| Humidity's default icon draws "%" like its unit; Weather data's two unit pictures are both "°" | ➖ both are CorosLink's own defaults (same `nativeAssetText`); the plain ° for both units is deliberate. CorosLink's hint ("00 in Celsius, 01 in Fahrenheit; leave 01 to show 00 in both") isn't in C-LINK yet |
| Template images (AM, PM, colons, minus signs, thumbnail, slot icons): the inspector shows a placeholder, not the picture; no Download, no size / path / config key | ✅ **new** picture (yours or the template's largest), Download, size, file, key and what the watch does with it (`parts/StudioTemplateImage.tsx`) |
| AM/PM: separate AM and PM pictures with their own Replace | ✅ **new** AM and PM tiles, Use the template's (`parts/StudioAmPmPictures.tsx`) |
| Bluetooth / Do Not Disturb in the selectable slot: no X / Y, align, nudge or Height | ✅ **new** the engine keeps a hidden status image's box (placed from the template's config); Height and Reset size replace Zoom |
| Arc cut overlay: CorosLink's one layer is two in C-LINK (image without position, position and colour without image); default colour #FFFFFF where CorosLink uses #000000 | ❌ |
| Weekday and date (template digits): W / H with link, Use imported size; Align has no Auto | ❌ |
| Colon, date slash, AM/PM: no Align to face buttons | ✅ **new** they had them while shown; a hidden one now keeps its box too |
| Weather icon: Show reading (temperature with the icon) | ➖ the reading is the Weather data layer |
| Chart: Weather here chips, graph background / mask / no-data artwork, Preview sample, Restore defaults | ❌ (readout look is in the inspector session's work) |
| Background: colour Clear, colour opacity, Reset photo zoom | ❌ |
| Everywhere: Use default colour (C-LINK has Original only where a colour changed), Nudge buttons and position Reset, effect styles | 🟡 arrow keys nudge; Back to the template's place resets template layers |
| Text layer font reads "Template" where it is the system font | ✅ **new** text, colon and date slash say System font and preview in it |

C-LINK has, CorosLink hasn't: Shows on (Current / Always-on) per layer, per-language weekday settings, the chart's page
list in Back order, text case, Canvas sample, colour swatches and hex everywhere, the Face tab's colours and tints.

## Element by element

"Better" says which implementation C-LINK should keep where both have the element. Speed notes are about the page
thread; both apps draw the face with the same engine (`renderFace` / `composeWatchfaceReplacements`), on the page
thread in both, so drawing speed is the same unless noted.

### Face (nothing selected)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Quick start: Background, Photo, Add / Style the time, Add text, Add a shape, Tour | 🟡 Face tab has background colour and photo; Add has text and shapes; no "Style the time" shortcut or tour | — |
| Face colors: one swatch per colour in use, recolours every part | 🟡 Face colour, Accent, Tint labels / icons; no "every colour in use" recolour (the engine's `recolorWatchfaceFace` exists, used only by automation) | — |
| Watch theme colour (MIP, 14) | ✅ | Same |
| Watch languages | ✅ All / English / Pick | Same |
| Watch-face version, Remove blank config fields | ✅ Face › Advanced | Same |

### Background

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Colour with hex, **Clear** (transparent), colour opacity | 🟡 colour with hex; no transparent or opacity | CorosLink (alpha); C-LINK's hex field is better than CorosLink's bare picker |
| Photo: choose, replace, remove, zoom 1–2.25 ×, reset zoom | ✅ (zoom as a number field) | Same |
| Stroke and effects on the photo | ❌ | — |
| Reset background (black, no photo) | ❌ as one action | — |

### Text, rectangle, ellipse, line

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| X, Y, Rotation, Width / Height with link, Length, Thickness | 🟡 all but the width / height link | — |
| Fill, gradient (from / to with alpha, angle), corner radius | 🟡 two-stop gradient and corners; no alpha on fill or stops | CorosLink for alpha |
| Text: content (40 chars), font, size 12–200, align | ✅ plus multi-line, line height, letter spacing, case, italic | **C-LINK** (engine renders lines, case and spacing; CorosLink's snapping measured one line) |
| Opacity, stroke, effects | ✅ | Same |
| Move backward / forward, Remove | ✅ **new** order; Remove via Delete | C-LINK (also front / back) |

### Time (hours, minutes, seconds, joined time)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| X / Y, Align to face, Nudge, Reset | ✅ (Back to the template's place) | Same |
| Colour, Use default colour | ✅ (Original) | Same |
| Separate hours and minutes | 🟡 one-way, as in CorosLink | Same |
| Font (system, typed, Google, Keep template), weight, style, spacing, size, rotation, edges | ✅ | **C-LINK** picker: one sheet with digit samples per font and Google Fonts through the main process; CorosLink lists 100 rows at most |
| PNG font: folder, official | ✅ Layer / Face scope, recolour | Same |
| PNG font: sprite sheet (columns, glyph order), individual files | ❌ | — |
| PNG font: Glyph height, Baseline, Reset fit | ❌ (engine supports `glyphLayout`) | — |
| Seconds: add from the minute digits, Remove seconds | ✅ | Same |
| Add time in one step on a blank face (colon, tinted digits) | ❌ | — |

### Separators, AM/PM, analog hands

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Static colon / date slash: X, Y, colour, font, weight, style, size | ✅ | Same |
| Template colon image: Use Colon instead | ✅ a colon picture turns the drawn colon off | Same |
| Exercise separator: show, colour, centre, size, weight, style, PNG or text colon | ✅ **new** Separator section on the Exercise metric | Same |
| AM/PM: X, Y, colour, font, size | ✅ | Same |
| AM/PM pictures: replace AM / PM, Use template pictures | ❌ | — |
| Analog hands: add, replace image | ✅ | Same |
| Analog hands: Download a template hand | ❌ | — |

### Date (weekday, month, day, year, lunar)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Show as Number / Words, Letters TUE / Tue / Tuesday | ✅ | Same |
| Translate for watch languages, per-language overrides | ✅ | Same |
| Alignment incl. Auto | ✅ | Same |
| Weekday ↔ day slot swap | ❌ | — |
| Font, PNG font with MON / JAN glyphs | ✅ folder and official | Same |
| Template digits: W / H with link, Use imported size | ❌ (Size and Scale only) | — |
| Remove an added part | ✅ | Same |
| Year, lunar year / month / day | ✅ (lunar no longer tagged) | Same |

### Fixed metrics (battery, heart rate, steps, calories, exercise, elevation, temperature)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Colour, alignment, font, PNG font, size or scale, rotation, edges | ✅ | Same |
| Battery % sign | ✅ own colour, size, gap, height | **C-LINK** (CorosLink scaled the % with the digits only) |
| Goal progress arc / bar: colours, geometry, remaining, direction, preview fill | ✅ | Same |
| Exercise separator | ✅ **new** (see above) | Same |

### Selectable slot (`control_*`)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Types on / off, status per type | ✅ with icons and warnings for blank `control_*` keys | **C-LINK** |
| Preview data, alignment, font, tint, size, rotation, edges | ✅ plus preview stepping with the watch's Back button | **C-LINK** |
| Type icon: show, replace, official, restore, Icon offset | ✅ (offset typed) | Same |
| Icon: Download, Native PNG size | ❌ | — |
| Shared colon and minus sign | ✅ | Same |
| Selectable battery: states, folder, official, scale | ✅ | Same |
| Drag a slot icon on the canvas | ❌ | — |

### Live-data fields (every catalog id)

All 31 catalog fields (`date_year`, `weather_temp`, `weather_temp_min` / `_max`, `weather_wind`, `weather_direction`,
`weather_rainfall`, `weather_humidity`, `weather_uv`, `weather_aqi`, `week_tl`, `stamina`, `stress`, `sleep_score`,
`lunar_year` / `_month` / `_day`, `sleep_hrv_level`, `sedentary`, `baro`, `today_run` / `_bike` / `_swim` / `_elev`,
`week_run` / `_bike` / `_swim` / `_elev`, `sunriseset`, `chart_sun_angle`, `chart`) are in C-LINK's Add list from the
same catalog file. ✅

| CorosLink (per field) | C-LINK | Better |
| --- | --- | --- |
| Colour, font, weight, style, spacing, font size | ✅ | Same |
| Parts: show / hide, colour, offset X / Y, digit width | ✅ | Same |
| Parts: width / height, alignment, font size per part | ✅ number fields, 4–800 px | Same |
| Parts: own font per part ("Its own color and font") | ✅ colour, plus an Own font switch (font, weight, style) | Same |
| Pictures: numbered-PNG folder, restore | ✅ | Same |
| Pictures: one picture at a time, Remove image, Official per part | ✅ pick a picture, Use / Replace image (≤1024 px), Remove image; Official opens on the part's config key | Same |
| Text overrides per picture (`TL` → `LOAD`, `assetTexts`) | ✅ Text field for the picked drawn picture, up to 32 characters | Same |
| Reset one part | ✅ Reset this part | Same |
| Preview sample | ✅ Canvas sample | Same |
| Min / max as one reading, Add the other | ✅ | Same |
| State artwork (stress, stamina, UV, AQI, weekly load) | 🟡 a states switch and a numbered-PNG folder only: no official stamina / stress / UV / AQI sprites, no label text (closed on `claude/magical-meninsky-4a6b8c`) | — |

### Weather icon

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| X / Y, colour, size | ✅ | Same |
| Day / night icons: folder, official, restore | ✅ | Same |
| Temperature digits, Minus & degree, °C / °F, Show reading | ➖ moved: the reading is the Weather data layer, whose Digits / Minus / Unit parts take the same PNGs | **C-LINK**: one temperature, not two writers of the same `weather_temp_*` keys |

### Battery icon, status indicators

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Battery states strip, folder, official, restore, scale, quarter turns | ✅ with "?" for missing states | **C-LINK** (shows the template's own pictures) |
| Bluetooth / DND groups with states, Add icon, show on watch | ✅ one row per spot | Same |
| Status icon Height, Reset size | 🟡 Zoom % | — |
| Match height (status icons to text) | ❌ | — |
| Touch-lock indicator | ➖ neither app has one (no config key) | — |

### Template images (`*_icon` assets)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Replace, official, restore, tint, zoom | ✅ | Same |
| Download (largest copy) | ❌ | — |
| Native PNG size, Native scale | ❌ in the inspector (`nativeSize` is set by Add) | — |
| Arc cut overlay | ✅ as a template image | Same |

### Your images

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Scale, rotation, flip, skew, tint, opacity, align | ✅ | Same |
| Layer name | ❌ | — |
| Width / Height with link, Use imported size | ❌ (Scale only) | — |
| Transform origin (nine anchors) | ❌ | — |
| Crop: X / Y / W / H %, Apply / Cancel, double-click | 🟡 Remove the crop only | — |
| Duplicate, Move backward / forward | ✅ **new** | C-LINK (also for text and shapes) |
| Corner resize handles | ✅ | Same; CorosLink also had edge handles and a rotation handle |

### Animation

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| X / Y, play / pause, delay, Set all, per-frame time, delete frame, Replace frames | ✅ plays on the canvas | Same |
| Per-watch outcome, frames left out dimmed | ✅ **new** | Same code (`watchfaceAnimationOutcome.ts`) |
| Preview of what a MIP watch draws (64 colours) | ❌ (outcome text only) | — |

### Charts

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Pages in Back order, add / remove page, readouts add / hide / remove / make fixed / put back | ✅ | **C-LINK**: page strip under the watch and the watch's Back button |
| Line and bar style | ✅ | Same |
| Readout look (font, colour, size, parts) | ✅ in the inspector session's uncommitted work | — |
| Preview a bar page with no reading, an off page | ❌ | — |

### Strokes and effects (every layer that takes them)

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Stroke: colour, weight, Inside / Center / Outside, hide, remove | ✅ | Same |
| Stroke opacity, reorder | ✅ **new** move up / down (no drag) | Same |
| Stroke paint: linear gradient with angle | ✅ **new** (picking a colour no longer turns a gradient solid) | Same |
| Shadows: drop / inner, colour, opacity, blur, spread, distance, angle, hide, remove | ✅ | Same |
| Shadow duplicate, move up / down | ✅ **new** | Same |
| Save as style / Detach style (`effectStyles`) | ❌ | — |

### Always-on

| CorosLink | C-LINK | Better |
| --- | --- | --- |
| Own layout on AMOLED, black screen, mirrors Current until changed | ✅ | Same |
| "No replaceable AOD assets" / "Current is already always on" notes | ❌ not checked in the UI | — |

## Editor shell and canvas

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Undo / redo, Save, Download, Convert, Send | ✅ | Autosave on top of ⌘S |
| Hide the Layers / inspector panels | ❌ | The inspector session adds a resizable inspector |
| Full screen canvas (Esc exits) | ❌ | |
| Tour | ❌ | |
| Missing-font notice with Google swap and dafont link | 🟡 | Google families load by themselves with a toast; no notice for a local font that isn't installed |
| Find a layer (search over the face's layers) | ❌ | Add has search |
| Groups (⌘G / ⇧⌘G), group lock / hide | ❌ | `editorGroups` / `linkedLayerGroups` are in the design type |
| Drag rows to reorder artwork | ❌ | Keys and menu do it **new** |
| Box select | ❌ | |
| Right-click "Component actions" | ❌ | The layer's More menu covers it |
| Rotation handle, Shift snaps 15° | ❌ | Rotation is typed |
| Edge resize handles | ❌ | Corner handles, Alt from the middle ✅ |
| Align, distribute | ✅ | |
| Align glyph baselines, Match height | ❌ | |
| Zoom 60–140 %, Fit | ✅ −/+ (60–150 %) | |
| Snap to layers and centre | ✅ | **C-LINK** better: by ink, equal spacing, gap readouts |
| Safe-area guide | 🟡 | On / off; no inset |
| Grid 4 / 8 / 16 / 32, rulers, project guides (`editorGuides`) | ❌ | |
| Edit history list | ❌ | CorosLink has none either; undo / redo only |
| Watch preview size picker (per resolution) | ❌ | Send's compiled preview stands in |

Shortcuts: ⌘S, ⌘Z, ⇧⌘Z, Ctrl+Y, Delete, arrows (Shift ×10), Esc, Shift-click, Alt / Shift while dragging ✅;
⌘D, Alt+↑ / ↓ ✅ **new**; ⌘G / ⇧⌘G, Shift-rotate 15°, Enter / Esc for crop, double-click to crop or delete a guide ❌.

## Hub and sources

| CorosLink | C-LINK | Notes |
| --- | --- | --- |
| Watch picker, templates (search, category, sort, advanced filters), blank, import ZIP / DAT / BIN | ✅ | |
| Import a COROS share link | ❌ | |
| My projects: sort Oldest first, filter by watch | 🟡 | Last edited / Name |
| Community: search, filters, sort, variants, Open anyway | ✅ | |
| Community private faces, `coroslink://` deep links | ❌ | C-LINK has no website account yet |
| Training Hub and Studio sharing one COROS login | ❌ | |

## Send and convert

All ✅ (Watch over Bluetooth, COROS share link + QR, iPhone over Wi-Fi, File, Convert, All watches, compiled 1:1
preview, pixel checks, languages, Full color, Smooth edges, kept BINs), plus Convert's carried chart group **new**.
AirDrop not found.

## Engine

The engine files are the same modules in both apps (`desktop/watchface/engine` against CorosLink's
`src/watchfaces`); 50 of them differ only in import paths. Where they differ, C-LINK's copy is the better one and
CorosLink has nothing C-LINK lacks:

| File | C-LINK's change |
| --- | --- |
| `watchfaceStudio.ts` | Battery "%" with its own colour, size, gap and height; barometer trend picked for the slot preview |
| `watchfaceGlyphLayout.ts` | `percentGlyphLayout` / `placePercentGlyph` for that "%" |
| `watchfaceBackgroundElements.ts`, `watchfaceEditorSnapping.ts` | Multi-line text, case, letter spacing, line height; snapping measures every line, italic and spacing |
| `watchfaceBitmapCache.ts` | Decodes data URLs itself instead of `fetch` (the page's CSP blocks `data:` fetches) |

Not ported from CorosLink because C-LINK does it another way: `watchLink.ts` (C-LINK has its own), the
`studioEditorPresence`, `watchfaceStudioMode` (Simple / Advanced, replaced by Advanced folds) and the two React hooks.

The "Must not regress" rules all moved with their tests: BIN cap 0x320000 and magic per screen; face ID 0xFFFFFFFF
empty slot and 10 slots padded only on PACE Pro; COROS upload cap; 25 MB official archive; MIP u16 offsets; animation
≤44 frames and MIP fit; full-RGB chart colours; byte-exact MIP `OptimizeBitmap`; Full color fallback; `m_preview`;
12-frame month table only with a point rect; no PACE 3 date swap; no static barometer branch; raw-text
`o_template_id`; convert from the 800 master and keep the dormant AOD; invisible chart number;
`stress_level_icon_pos`. Known open issues carried over: the eight-frame wind-direction assertion (fails in CorosLink
too) and the German layer-search test, not moved.

Performance, both apps: `renderFace` / `buildInput` and drag-frame composition run on the page thread; moving them to
a worker is still open (phase 2 in `docs/studio-port.md`). Dragging works the same way in both: the face without the
dragged layers and those layers alone are composed once before the drag (`studioDrag.ts`, rewritten from CorosLink's
drag isolation), so a drag costs no redraws.

## Left for the inspector session

The main checkout's uncommitted Studio work (StudioInspector, StudioEditor, studio.css, StudioFontPicker, studioEdits)
already does these, so this branch leaves them: sliders → number fields (Opacity, Zoom, Preview fill, Corners, %
size and gap), the "Experimental" tag on the chart and its Add tile, chart readout look. After it lands,
`studioLibrary.ts` still carries unused `tag` values ("Experimental", "Not available") that can go.

## Still missing, suggested order

1. **Canvas tools**: groups (⌘G), box select, rotation and edge handles, crop editing, right-click menu, grid,
   rulers and guides, baselines, Match height, full screen, panel toggles, layer search, drag rows to reorder.
2. **Fonts**: sprite-sheet and single-file PNG fonts, Glyph height / Baseline / Reset fit, missing-font notice.
3. **Elements**: AM/PM pictures, image name / size link / origin / crop, background alpha, fill alpha, effect styles, Download for template
   images and hands, status icon Height, template image Native size.
4. **Sources**: share-link import, deep links, private community faces, shared COROS login.

## Checks on this branch

`npm run typecheck` and `npm run test` (164 files, 1,777 tests) pass. `npm run lint` fails on one error that was
already on `main`: `react-hooks/set-state-in-effect` in `desktop/renderer/pages/MediaSources.tsx:507`, a file this
branch doesn't touch. `CLINK_SMOKE` with `/studio/blank` ran with no console errors; the simulation shot shows the
new date, step and values row.
