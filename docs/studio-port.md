# Porting Watch Face Studio from CorosLink

Goal: everything CorosLink's Watch Face Studio does, in C-LINK Desktop, in the new Studio look (the canvas's
"Watch Studio, desktop app only" boards). Source of truth for what must come over: CorosLink
`docs/replacement-checklist.md` §5 "Watch faces" and `docs/watch-face-studio.md`.

## What the first Studio got wrong

The Studio merged on 2026-11-23 (`38fdc17`) is a free-form layer editor on a 454 px dial. CorosLink's Studio is not:
every face is a **COROS template project** (config files + sprite images per resolution, plus an **800 × 800 master**
that is the authoring space). That model is what gives separate **hour / minute / second** digits, template sprite
fonts with Weight / Spacing / Smooth–Hard edges, native data fields the firmware draws, battery and weather sprite
states, analog hands, an own always-on layout, and above all a file the watch accepts. PACE Pro is **416 × 416**, not
454. So the face model in `desktop/shared/studio.ts` is replaced, not extended. The new look (home, Layers | Add,
library tiles, drop spots, colour bar, folded inspector, simulation) stays and is rebuilt on the real model.

## Size

| CorosLink part | Lines |
| --- | ---: |
| Editor UI (`src/watchfaces/*.tsx`, editor half of `*.ts`) | ~35,000 |
| Face model and composition (`watchfaceStudio.ts`, `watchfaceCompose.ts`, sprites, dates, metrics, AOD…) | ~23,000 |
| Main process (`electron/corosWatchfaceService.ts`, conversion, official assets, community, AI, automation, BLE) | ~26,000 |
| Compiler (`electron/watchfaceCompiler/*`, TypeScript port of COROS 4.9.9) | 2,600 |

## Phases

Each phase ends usable, with `npm run check`, CLINK_SMOKE shots and its "Must not regress" items as tests.

1. **The real face.** Project model on COROS templates with the 800 master; the 13 watch models (ids, codes, sizes,
   AMOLED/MIP); open the bundled editable templates and "Start blank"; the compiler in a worker; Download "Editable
   project ZIP" and "Final watch ZIP" / Save BIN. Projects move to this model (the free-form faces made so far are
   test data and are dropped, after asking).
2. **Editor parity, time and type.** Separate hour / minute / second / AM-PM layers; template sprite fonts, system and
   Google fonts, Custom PNG font (sheet, folder, files), official COROS fonts; Weight, Style, Spacing, Font size,
   Rotation, Edges; colour, layer opacity; position, Align to face, Nudge; Stroke and Effects (shadows); gradients;
   Simple / Advanced; "Make this face yours" quick edits; Removed from this face; Template assets.
3. **Editor parity, canvas.** Multi-select, group / ungroup, lock, align and distribute, glyph baselines, guides,
   grid, rulers, snapping (Alt to skip, Shift axis lock), crop, flip, resize from centre, rotation snap, full screen,
   Edit history, every shortcut in the checklist.
4. **Data and screens.** Native data fields with their firmware rules, charts (experimental), weather sets and
   defaults, battery states, lunar date, sun and moon, analog hands, animation frames (≤44, MIP fit), Always-on own
   layout vs "Current face stays on", watch languages, pixel checks, the full simulation.
5. **Sources.** COROS sign-in (region, saved account); template catalog with advanced firmware filters; Official
   and My faces; Community (search, filters, variants, verified packages); Import ZIP / DAT / BIN / share link;
   recovering compiled official BINs; official asset library (R2, 24 h refresh).
6. **Getting it to the watch.** Send to COROS (share link + QR, 10,485,760 B cap); Convert to another watch from the
   800 master; Send to iPhone; Install over Bluetooth into a slot (needs the watch engine: read face list 0x96, file 8
   in 4 KB blocks, poll for the face ID).
7. **Watchmaker and automation.** The AI designer (using the app's own AI providers, not only Codex CLI), saved chats
   per face, and the watch-face MCP server for external AI.

## Decided (2026-11-23)

- The compiler and template engine move over as modules with their tests, tidied to this repo's rules; the UI and
  services around them are rewritten in the new Studio look.
- One phase per session, each in its own worktree, merged when its checks pass. Phase 1 starts in the session that
  wrote this plan.

## The decision that was asked

`AGENTS.md` says nothing from CorosLink comes over as it is. For the **compiler** and the **template composition**
(byte-exact behaviour the watch depends on: MIP bitmap optimisation, u16 offsets, BIN layout, config quirks), a
rewrite risks faces that look right in Studio and break on the watch. Recommended: bring those over as modules with
their tests, tidied to this repo's rules (no Node in the page, work in a worker), and rewrite only the UI and the
services around them.

## Known issues carried over

- `watchface-native-contracts`: an eight-frame recovered wind-direction table gets the 16-direction meanings
  (`weather_direction` with `stateCount: 8`). Fails in CorosLink `c2ff5110` too; the assertion is commented out in
  `desktop/watchface/tests/watchface-native-contracts.mjs` until it is fixed.
- `test-watchface-layer-search` wasn't moved: it checks German search terms, and C-LINK has no languages yet.

## Phase 1: done (2026-11-23)

- **Templates**: COROS's editable-template catalog is bundled (`desktop/watchface/assets/templateCatalog.json`,
  CorosLink's snapshot). Packages and pictures download from COROS without signing in, only from catalog URLs, and
  are cached in `studio/templates` (packages: 150 most recent). They are reads, so Local-Only Mode lets them through.
- **Projects** are CorosLink's format, one folder each in `studio/projects/<uuid>` (project.json, starter.dat,
  preview.png). A new project carries `startedFrom` until the editor sets its design up from the template on first open.
  Import takes a DAT/ZIP face or an Editable project ZIP; Download → Editable project ZIP writes CorosLink's portable
  form (coroslink-project.json, starter.dat, preview.png), so either app opens the other's projects.
- **Building**: the archive rewrite (config overrides, sprites, artwork per layout, AOD synthesis, pruning) moved from
  CorosLink's service to `desktop/watchface/archive` with its config tests, using the compiler's PNG codec instead of
  nativeImage; it runs in a worker (`dist/main/watchfaceArchive.cjs`). Final watch ZIP and Save BIN (through
  `compile.ts`) work; tested end to end with a synthetic template and checked by hand on COROS's SIMPLE.
- **Screens**: `studioFace.ts` glues the screens to the engine (initial design as CorosLink opens a face, layers,
  preview at the 800 master, edits, build input). Home: continue card, your faces, Start blank and templates per
  watch. Editor: Layers | Add (what the template has but the face hides, with drop spots), colour bar, folded
  inspector, Current / Always-on, simulation, Download menu. Hour and minute are separate layers; a template with one
  auto-aligned time block gets "Separate hours and minutes".
- The free-form model (`desktop/shared/studio.ts`, `desktop/main/studio.ts`) and the faces saved with it are gone.
- `CLINK_SMOKE_SCREENS="/studio/<id>"` now also colours the minutes, reopens the face and saves its BIN into the
  smoke folder.
- Fixed on the way: the moved `weatherAssets.ts` looked bundled weather sprites up under CorosLink's old folder name,
  so building any face with weather failed ("A studio image failed to load").

## Left for phase 2 (and noted for later phases)

- The engine draws and composes on the page's thread (single-flight, so it never queues up); AGENTS.md wants work over
  ~16 ms off it. Moving `renderFace` / `buildInput` to a worker with OffscreenCanvas is the first job of phase 2.
- The inspector follows the design's "Studio inspector by layer type" boards (2026-11-23): one panel per kind of
  layer (`desktop/renderer/pages/StudioInspector.tsx`), every control writing the field CorosLink's editor writes
  (`desktop/renderer/studioEdits.ts`, tested). Sections are open by default (the user asked for that); folding is by hand.
  - Type for time, fixed data, date, selectable data, AM/PM, separators and live data: font (template digits, a font on
    this computer, a folder of PNG digits for the layer or the whole face, recolour), colour, Font size (CorosLink's sums
    per kind), spacing, weight, style, align, Smooth / Hard edges, rotation; Back to the face's type.
  - Date: TUE / Tue / Tuesday, month as number or words, Translate for watch languages, per-language overrides.
  - Live data: preview sample, parts (value, icon, unit, signs, …) shown or hidden, colour, offset, digit width; Restore
    all appearance defaults. Selectable data: which choices the wearer gets, preview, barometer mode, value tint.
  - Calories and exercise: arc and bar on or off, one colour, angles, thickness, radius, centre, bar ends, fill
    direction, Draw remaining portion, preview fill. Weather icon: tint, scale, Show temperature. Battery icon:
    numbered PNG states, scale, quarter turns, restore. Template images (status icons, hands, colon, thumbnail):
    replace, restore, tint, zoom; a colon picture turns the drawn colon off.
  - Images and shapes carried by CorosLink faces: replace, scale, rotation, flip, skew, tint, opacity, remove crop;
    fill or two-stop gradient, corners, size; text content, size, weight, style, align; line length and thickness.
  - Animation: frames, one delay for all, replace frames from a folder (≤44, same size). Chart: Sun, Moon and Daily
    pages shown / hidden / removed; line and bar styling.
  - Every layer: Position (X, Y, align to the face) for every kind that has a place, not only layout groups; Lock;
    Stroke and Shadow stacks (`layerStrokes`, `layerEffects`); opacity; Shows on.
  - Shift-click picks several layers: align, distribute, one colour.
  - Face: face colour, accent, tint labels / icons, the face-wide font with weight, style and spacing, background
    colour and picture with zoom, the MIP watch theme, watch languages, watch-face version, Strip blank config keys.
  - Saving now attaches font snapshots (`attachWatchfaceFontSnapshots`), so a face set in a computer font draws the
    same elsewhere. Listing fonts uses Local Font Access (the `local-fonts` permission), with a short list if refused.
  - The font picker (`StudioFontPicker.tsx`, 2026-11-23) fits the 304 px inspector: one list, each row the layer's
    digits in that font (10:08, 23, 128 …, at the layer's weight and style), the template's own digits first, drawn
    from its PNGs and masked to the text colour so they show in light and dark. Search past eight fonts; arrows,
    Page Up / Down, Home / End, Enter and Escape from the search or the list (and they don't nudge the layer); the
    list is virtualised and the fonts are asked for once. Fonts / PNG set is the only switch, shown only where a layer
    can take a PNG set; the design's Google tab waits for Google Fonts (below). The face's font uses the same picker.
    The layer header's More actions menu drops down as a real popover again (`.st-menu-down` now follows `.st-menu`,
    whose `bottom` had squeezed it to nothing). Smoke shots: `studio-font*.png`, `studio-insp-menu.png`.
- Still not in the inspector: Google Fonts (blocked by the page's CSP and needs a fetch through the main process),
  official COROS fonts and sprites (phase 5), linked effect styles (Save as style / Detach), gradient strokes,
  per-asset text overrides of live-data parts, sprite-sheet PNG fonts (only folders), crop editing, weather day/night
  set replacement, groups, guides and the raw config editor. "Separate hours and minutes" is still one-way.
- Google Fonts the face names aren't loaded (saved font snapshots are); signed-in catalogs, firmware filters,
  Official / My faces are phase 5; recovered BINs (imports are refused with a message) phase 5; sending phase 6.
- Templates the catalog marks but COROS no longer serves fail with COROS's status; there's no offline list beyond the
  cache.

## Phase 4 pulled forward: native data fields (2026-11-23)

Add → Live data (`desktop/renderer/studioLibrary.ts`, rewritten from CorosLink's `WatchfaceAddMenu.tsx` and the editor's
`addNativeData`, `addChartPageFromAddMenu`, `addStatusIndicator`, `addDefaultBatteryIcon`, `restoreFirmwareLayer`) lists
every field the catalog (`watchfaceNativeCatalog.ts`) knows, in the design's groups: Time and date (year, lunar date),
Health, Activity, Weather (incl. sunrise / sunset and sun angle), Training, Charts (a page at a time: barometer and tide,
sun, moon, daily stats, daily activity), Status (Bluetooth, Do Not Disturb, airplane and sleep images with Studio's
artwork, a twelve-state battery icon on a template without one). The template's own data the face hides (heart rate,
steps, the selectable slot, date…) is listed with them; a metric the template implements but hides had no box and was
missing from both lists before. Search across all of it; click puts the field in the free spot nearest the middle of
the dial, dragging drops it where it lands, and a field already on the face is ticked and selects its layer. Tiles mark
CorosLink's caveats: Experimental (charts), Not confirmed (fields whose firmware meaning isn't checked on a watch, e.g.
stress art, lunar date, airplane and sleep images), Not available (AQI); the tooltip has the whole note.

- Rules kept from CorosLink: minimum and maximum temperature come together; Current weather takes the weather icon's
  temperature over; a new chart started from another page turns the bars off (bars bring barometer and tide); a daily
  page brings all three readouts the firmware needs; a page the face took off comes back; status images stay with an
  indicator already on the face, else go inside the dial.
- Hiding now goes through the engine's own visibility rules (`setWatchfaceAutomationVisibility`): before, hiding a
  native field or a template image wrote `layerVisibility`, which the engine ignores for them.
- Tests: `studioLibrary.test.ts` (catalog coverage, groups, caveats, search, each kind of add on a Start-blank face,
  chart pages, placement, hide/show) and the "Must not regress" items it relies on (stress at `stress_level_icon_pos`,
  lunar tables only as `chinese_lunar_*` / `chinese_tw_lunar_*`, never the static barometer branch).
  `watchface-device-layout.mjs` moved from CorosLink without Electron (12-frame month table only with a point rect, no
  PACE 3 date swap). The other Must-not-regress items were already covered by the moved engine tests (invisible chart
  number: `watchface-chart-readouts`; static barometer: `watchface-studio`, `watchface-archive-config`; native keys and
  min/max: `watchface-native-contracts`, `watchface-native-export`).
- CorosLink's Electron-only tests (`test-watchface-native-data.cjs`, `-status`, `-battery`, `-weather`) draw on a real
  canvas; their pure parts are in the tests above and the drawing is checked with `CLINK_SMOKE` (the face run now adds
  heart rate, steps, current weather, weekly load, the daily-activity chart page and Bluetooth, reopens and saves a BIN).
- Not done: the chart's Watch pages strip (Add page / Make fixed) beyond the inspector's Show / Hide / Remove; per-watch filtering
  (CorosLink lists every catalog field for every watch too).

## Phase 5 pulled forward: the home page and its sources (2026-11-23)

The home page follows the design's StudioHome / LightStudioHome boards: title row with the COROS account chip, Import
and New face; "On your watch"; tabs My faces (count) / Templates / Community with search and sort; the "Continue
where you left off" hero; the project grid with a New face tile.

- **Community** (`desktop/main/watchface/community.ts`, `desktop/renderer/parts/StudioCommunity.tsx`,
  `studioCommunity.ts`): rewritten from CorosLink's `communityWatchfaceService.ts` and `useCommunityWatchfaceCatalog`.
  Popular / New / Most downloaded, "Fits my <watch>", the catalog's style facets, search, variants of one design
  together, Load more, Reviewed badges and downloads. Open downloads the reviewed package through the signed redirect,
  checks its SHA-256 and opens it as a project; a face that doesn't list the chosen watch asks first ("Open anyway").
  Must-not-regress items as tests (`sources.test.ts`): catalog answers ≤2 MB, packages ≤100 MB, URLs only on the
  catalog, redirects only to signed storage or Vercel Blob, temp imports removed and cleaned after 7 days, bigint
  `packageBytes` strings.
- **COROS account** (`corosAccount.ts`, `corosMobile.ts`, `parts/StudioAccount.tsx`): the mobile sign-in with region,
  "Save this COROS account" (email and the password's MD5 digest, as CorosLink), saved-account sign-in, sign out,
  forget. Session and saved account live in `studio/coros-account.bin`, sealed with the keychain; without a real
  keychain nothing is written. The page sees only email, region and whether one is saved. COROS's 1019 signs out.
- **Templates tab** (`parts/StudioTemplates.tsx`): Templates (bundled list signed out, COROS's live list signed in),
  Official and Your COROS faces, Digital / Analog (and COROS's categories when it sends them), Advanced filters
  (firmware type, language, maximum version, watch serial presets, model version) when signed in.
- **Compiled faces**: official faces arrive as BINs. CorosLink's `corosCompiledWatchface.ts` moved as
  `desktop/watchface/recoverBin.ts` (byte for byte, like the compiler), so official faces, BIN community packages and
  BIN imports open as editable copies. Import now takes ZIP, DAT or BIN.
- **Local-Only Mode**: the mobile sign-in (`/coros/user/login`) and the face lists are reads COROS takes as POSTs, so
  `dataMode.ts` lets them through; anything that sends a face to COROS stays blocked (tests in `settings.test.ts`).
- "On your watch" shows the chosen watch (it also picks the watch for new faces and Community) as not connected yet;
  no slots until the watch engine exists.
- Fixed on the way: the engine fetched `data:` URLs for background bitmaps, which the app's CSP blocks (recovered faces
  failed to draw parts and to build); downloads of faces with non-Latin names lost their name (now `filename*`).
- Checked: `npm run check`; CLINK_SMOKE shots of the three tabs, Official signed out and the sign-in dialog in light
  and dark (`CLINK_SMOKE_THEME`); a live Community face opened, edited and saved as a BIN in the app. Official faces
  are tested against a fake COROS with a real compiled BIN; not yet tried with a real COROS account.

### Left in phase 5

- Import from a COROS share link (the design's Import dialog has it; not shown until it works).
- Community private faces (CorosLink sends the watchfaces.coroslink.com account token after a 404; C-LINK has no
  website account yet) and `coroslink://watchfaces/…` deep links.
- Saving the watch key COROS returns at sign-in (needed by the watch engine, phase 6), the account's watch-key check,
  and reusing the Training Hub login for the mobile sign-in.
- The official asset library (R2, 24 h refresh) and recovered BINs as editor-side "recovery" hints.
- Download progress is polled by the page (`/community/progress`), not pushed.

## Phase 6: Send (2026-11-23)

The Send dialog follows the design's StudioSend / LightStudioSend boards (`desktop/renderer/parts/StudioSend.tsx`):
Watch | COROS app | File. The face is built once when the dialog opens and every step after works from that prepared
final archive, kept in the main process for 15 minutes, the 4 most recent (`desktop/main/watchface/send.ts`, as
CorosLink's prepared BINs).

- **Watch**: the face compiled for the watch and shown 1:1 from the prepared archive's own files
  (`renderCompiledWatchfacePreview`), its pixel checks for Current and Always-on (edge, overlap, missing, unloaded)
  with Show picking the layer, the name, the watch, the languages line (Change opens the Face inspector), Full color
  (AMOLED) and Smooth edges (MIP), Save BIN with those options, and compile → send → verify in the footer.
- **No watch connection yet**: C-LINK Desktop has no Bluetooth to the watch, so `/watch` says not connected, no slots
  are drawn and Send to watch stays off with that reason; `/prepared/<id>/install` refuses. In its place the tab offers
  **Send to iPhone** (`phoneSend.ts`, CorosLink's `watchfacePhoneSend.ts`): C-LINK on the phone fetches the face over
  this network and installs it. The slot rules the install will follow (0x96 face list, `0xFFFFFFFF` empty, 10 slots
  padded only on PACE Pro, replacing needs the expected face ID, file 8 in 4 KB blocks, poll 8 × 500 ms for the face
  ID) are ported and tested in `desktop/watchface/watchSlots.ts`; the transport is the watch engine's job.
- **COROS app**: the prepared archive goes up to the signed-in COROS account and comes back as a share link and QR
  (`corosShare.ts`, CorosLink's `publishCorosWatchface` / `createCorosWatchfaceShareLink`): face name, Background ID
  (Auto is CorosLink's 13), copy, open, expiry, Disconnect. Upload cap exactly 10,485,760 B; bigger faces are
  recompressed losslessly toward 8 MB first (`compiler/archiveFit.ts`). Local-Only Mode blocks both writes.
- **File**: Editable project ZIP, Final watch ZIP, All watches (a final ZIP per watch into one folder: this face for
  its own watch, converted scratch copies for the rest), Development export (the files unpacked into a folder);
  Convert for another watch is its own dialog. Folders are picked with the app's dialog and reach the page only as an id and a name.
- **Convert** (`desktop/watchface/archive/conversion.ts`, `desktop/main/watchface/convert.ts`, CorosLink's
  `watchfaceArchiveConversion.ts`): a new project from the stored 800 px master with the destination's official
  carrier template (from the bundled catalog, cached per watch in `studio/conversion/carriers`, a local carrier when
  COROS can't be reached); raw config edits move into the new baseline, the design comes along
  (`prepareWatchfaceConversion`). The source project stays as it is.
- **Faces with no 800 px master** (recovered from a BIN, or made in the COROS app with only their watch's layout) are
  built from their own layout: `buildWatchfaceArchive` builds them as they are and scales the result to the watch's
  sizes with that watch's carrier (`buildFromNativeLayout`, CorosLink's `prepareRecoveredExportZip`), in the archive
  worker. Send, Final watch ZIP and Save BIN work for them on their own watch; All watches builds each watch straight
  from the one composition; Convert rebuilds the face for the other watch with the edits applied and opens the result
  as a new face on a starter that has an 800 px master, so later conversions are ordinary ones. Convert has its own
  button next to Download (and the Download menu's item opens the same dialog); it says what the destination keeps before (rebuilt or from the master, size, APEX 4's 42/46 mm, MIP vs AMOLED
  always-on) and what needs a look after (a generated always-on, the AOD kept for AMOLED, no COROS template when COROS
  couldn't be reached). `CLINK_SMOKE_STUDIO_CONVERT=1` walks both in the built app.
- The Download menu has the design's items (All watches, Convert, Development export open Send on File).

### Left in phase 6

- Installing over Bluetooth: needs the watch engine (connection, auth, the transfer). Everything up to it is here.
- Images are shrunk with `shrinkImage` (compiler/scale.ts): Lanczos-3 on premultiplied colour, standing in for the
  Chromium resize CorosLink used through nativeImage. Measured against nativeImage "best" on 1,023 sprite resizes
  from 17 COROS templates: 0.57/255 average difference (area averaging was 1.56) and 0.25 % of colour values off by
  more than 8 (was 2.28 %). Enlarging stays bilinear, as in CorosLink; `scaleImage` stays the compiler's stand-in
  for COROS's own scaling.
- A rebuilt conversion doesn't carry the open chart page across (CorosLink's `carriedWatchfacePreferences`); the
  new face opens on the template's first.
- Importing a COROS share link (phase 5).

## Dragging without ghosts (2026-11-23)

Dragging a layer on the watch used to move only the selection box: the artwork stayed where it was until the face was
recomposed, so there was an empty box in one place and the old artwork in another. Now (`desktop/renderer/studioDrag.ts`,
rewritten from CorosLink's `isolateDragDesigns` and precomposed drag frames):

- Before a drag, for the layers it would move (the one under the pointer if it isn't selected, else the selection's
  movable layers), the editor composes two frames: the face without those layers (the base), and those layers alone as a
  cropped transparent sprite. The sprite is the difference between two foreground-only drawings (no background colour or
  picture), with and without the layers, so edges keep their real transparency. Layers that share a place on the watch
  (Bluetooth on / off / airplane are one position key) are found by moving the layers a pixel and seeing whose box
  follows, and are lifted with them.
- While dragging, the base stands in for the face and the sprite follows the pointer by a CSS transform (one state
  update a frame). After the drop both stay until the face drawn from the moved design is decoded and on screen
  (`FaceView`'s `onShown`), then the overlay goes in the same paint. Composing ahead pauses while a drop waits for its
  redraw.
- Dragging one of several selected layers moves them all. The drag listens on the window, not by pointer capture
  on the box (selecting re-orders the boxes, which dropped the capture and sometimes the drop). The hit boxes are never HTML-draggable, and the face box can't start a native drag.
- If the frames aren't ready when the pointer moves (a very quick grab of a layer never hovered), the drag falls back to
  the old behaviour for those few frames.
- `CLINK_SMOKE_SCREENS="/studio/<id>"` now drags a weekday, the minutes, a live-data field, a status icon and two
  layers together by real mouse input, with shots mid-drag, right after the drop and once redrawn.
- Known: the sprite is a pixel compare, so where a moving layer's pixels match what the other layers draw at the same
  spot they drop out of the sprite; a small status icon over another white layer can look a touch thinner mid-drag
  than once redrawn. Never a second copy.
- Left: composing the drag frames runs on the page's thread like `renderFace` (three drawings and an 800² pixel
  compare, after a 40 ms pause and not during a drag); it moves to the worker with the rest in phase 2.

## Snapping to other layers (2026-11-23)

Dragging used to snap only the selection's centre to the face's centre. Now it lines up with the other layers too
(`desktop/renderer/studioSnap.ts`, rewritten from CorosLink's `snapWatchfaceBounds`, `pickCandidate`,
`watchfaceAlignmentGuides` and the editor's `dragInk`):

- Each axis on its own snaps the moving start, centre or end to another layer's start, centre or end, or the moving
  centre to the face's centre, whichever is nearest within 6 screen px (whatever the zoom); at the same distance the
  face's centre wins. A snap holds until the pointer pulls 1.5 × that away, so it doesn't flicker on the edge.
- What lines up is what the layers draw (their ink), not their boxes. The drag frames already have it: the moving
  layers' ink is the sprite's box, and the others' comes from the foreground drawing without the moving layers,
  scanned inside each layer's box. A layer whose box overlaps another's can't be told apart in that drawing and snaps
  by its box; so does everything until the frames are ready.
- A pink line marks every place the dropped selection would line up, not only the one it snapped to, running across
  the selection and each layer on it; the face's centre runs past the dial. Alt skips snapping, Shift keeps the drag on
  one axis and the other axis never snaps, and the Snap button turns it all off.
- Equal spacing (from CorosLink's `addSpacingCandidates` and `watchfaceNeighborMeasurements`): on each axis the
  selection also snaps to the middle between the layers before and after it, or to the same gap from its nearest
  neighbour as that neighbour has from the next one. Only layers in line with it count (overlapping it across the
  axis), and at the same distance a layer's edge or the face's centre wins.
- While dragging, the gap to the nearest layer in line on each side shows as a pink bar with ticks and its size in
  master px (the inspector's X / Y units). Equal gaps, and the neighbour's matching gap beyond, get a soft pink band.
- The layers the selection is placed against are outlined in thin pink while dragging: every layer a line runs past,
  and the neighbours of an equal gap. The outline is what the snap measures (the layer's ink once measured, else its
  box), so it shows exactly which edges line up. A plain gap only measures, so its neighbour isn't outlined.
- Not carried over: CorosLink's face-edge, safe-area, ruler-guide and grid snaps (Studio has no rulers or grid yet).
- The ink scan is part of composing the drag frames (sum of the other layers' box areas, on the page's thread with
  the rest of that step until it moves to the worker in phase 2); snapping while dragging is a few dozen comparisons a
  move.
- `CLINK_SMOKE_SCREENS="/studio/<id>"` also drops the minutes, a weekday, a live-data field, a status icon and two
  layers together 3 px off another layer's left edge, and the weekday in line after the minutes and the hour, 3 px off
  the same gap; it logs the lines and gaps drawn (`studio-snap-*` shots).

## Charts: the pages list (2026-11-23)

From the design's "Studio charts" boards. `desktop/renderer/studioCharts.ts` reads the engine's page rules for the
panel: all six pages in Back order, on or off, the readouts each needs or can take, and the fields the watch hides
while a page shows (`nativePageRule`). The chart's inspector (`ChartTop` in `StudioInspector.tsx`) is now that list
with a switch a page (Barometer and Tide share one), the picked page's readouts (hide, add, remove), what an off page
would add and hide before it's added, a Back link that steps the preview, and the graph with only the line or bar
style the face's pages draw. Bar width can't be typed to 0 any more: the switch takes the two bar pages off.

- Rules kept: the last page stays; a page turned off while the layer edits it hands over to another page; with only
  the bar pages left the chart keeps a hidden number (the watch draws no graph without one); a page only the template
  declares goes off through `chartPageModes`.
- Tests: `studioCharts.test.ts`. Smoke: the face run takes `studio-chart-pages.png`, `-try`, `-added`, `-back`.
- Not ported from Make fixed: a readout only the template declares (CorosLink recovers it from the template first).
- Not done: a bar page with no
  reading can't be shown in the preview; an off page isn't previewed on the watch; "Shows on" for weather fields; the COROS-app checks in Send; always-on.
- Add now has one Chart entry in place of the five page tiles (`StudioEditor.tsx`). On a face with a chart it selects
  it and says how many pages it has; else it opens a picker of the five ways to start (`chartStartOptions`), each with
  the fields the watch will hide on that page and its caveat. Searching still lists the pages as tiles. Smoke:
  `studio-chart-pick.png`. The picker doesn't preview the page on the watch.
- Show on every page (CorosLink's Make fixed; `fixChartReadout` / `unfixChartReadout`): the pin on a readout moves it
  off its page into the field that always shows. Stress, stamina and barometer become the native field with the
  readout's own parts and artwork. Steps, calories, elevation and heart rate become Studio's fixed metric: scale,
  centre alignment, colour and, where the readout has digit art, a sprite font of those digits with the measured ink
  height and baseline (`studioChartArt.ts`), the icon as an image layer, then centred on the readout. All of it is
  CorosLink's `makeChartReadoutFixed` (ef45e6e9) line for line, with the page measuring the images first. As there,
  it is offered on the Current face only, and "Put back" returns the readout to its page and leaves the field it
  became on the face. A blocked pin says why: no twin (sun, moon, tide), already on the face,
  or the chart's last readout. Smoke: `studio-chart-pinned.png`, `studio-chart-pinned-number.png`.
- On the canvas (`StudioEditor.tsx`): a strip under the watch with the face's pages in Back order and a Back button on
  the bezel, both stepping the preview without changing what is selected, so a weather field can be watched page by
  page. Hidden in always-on and while simulating. Smoke: `studio-chart-strip.png`.

## Shared spots: images at one place are one layer (2026-11-23)

The watch keeps one position for a set of images and shows one of them at a time. Studio listed each image as its own
layer with its own box, stacked on the watch. Now each set is one **spot** (`desktop/renderer/studioFace.ts`, "Spots";
CorosLink's status groups, `watchfaceStatusPairs.ts`, and its one-row-per-indicator Layers list):

| Spot | Position key | States |
| --- | --- | --- |
| Bluetooth | `bluetooth_icon_pos` | On, Off, Airplane mode |
| Do Not Disturb | `no_disturb_icon_pos` | On, Off, Sleep mode |
| Bluetooth (data slot) | `control_bluetooth_icon_pos` | On, Off |
| Do Not Disturb (data slot) | `control_no_disturb_icon_pos` | On, Off |

- **Layers**: one row per spot with the state on the watch beside its name. The eye hides or shows every image the
  face has for it; Lock covers them all.
- **Watch**: one box, the shown state's. Drag, nudge, align and snap move the spot (one offset, one undo step); other
  layers snap to it as one target. The preview draws one state per spot, as the watch does (it drew them all on top of
  each other), in the editor, the saved picture and the archive's preview.
- **Inspector**: the states as a switch that also sets what the watch shows; Replace image / Restore original and
  Show on the watch for the picked state; Add image for a state the face lacks (Studio's artwork, where the spot is);
  X, Y, align and Zoom once for the spot; strokes and shadows under the spot's layout group, the id the engine draws
  the standalone states with.
- **Add**: a Bluetooth, Do Not Disturb, airplane or sleep image joins its spot where the spot is, and a ticked row
  selects the spot with that state shown. **Simulate** has a switch per spot with more than one image.
- Nothing about a spot is saved. The design keeps what it kept (`configAssetOverrides` per image, one
  `layoutOffsets` entry per layout group, `lockedLayerIds`), so older faces open the same and the build is untouched:
  `finalizeWatchfaceStatusIcons` still runs after visibility (the 1 × 1 companion when only airplane or sleep is
  there, no negative positions).
- Tests: `studioSpots.test.ts` (the spots of a template with PACE Pro 2609181's and Cube's status keys, a Start-blank
  face with images added, one move for all, hide / show / lock, one state off, adding into a moved spot, the built
  config's one position key per spot in every resolution, a design saved before). The smoke run picks the Bluetooth
  spot, shows each state, switches it from Simulate, hides and shows it and drags it (`studio-spot-*.png`).

Looked at and left as they are, because they are already one layer: AM / PM (`am_icon`, `pm_icon` at
`am_pm_icon_pos`), the battery icon's twelve states, the weather icon's day and night sets, sedentary frames, the
touch lock (one image at its own key).

### Left

- The selectable slot's barometer trend (`control_barometer_down_icon` / `flat` / `up` at
  `control_barometer_icon_pos`) is still three image rows; they have no box on the watch and the preview only draws
  flat.
- Analog hands and centre caps share `time_center_pos` and already move together, but all show at once, so they
  stay separate rows with overlapping boxes.
- A state has no tint of its own: the engine tints status images only face-wide (Tint icons).
- Showing a hidden spot from its row shows every image it has, also one switched off on its own before.
- The Add library still lists a spot's images one row each (`studioLibrary.ts` was left alone for the sessions
  editing it).

## Building a face up from Start blank (2026-11-23)

The Add library could only add live data, so a "Start blank" face stayed empty. It now has the rest of CorosLink's Add
menu (`desktop/renderer/studioLibrary.ts`, rewritten from the editor's `addElement`, `chooseSprite`, `addSeconds`,
`addDatePart`, `addAnalogHands`, `addNegativeSign`, `chooseAnimationFrames` and their removals):

- **Artwork**, the library's first section: Image (PNG, JPEG or WebP from this computer, or dropped on the watch from
  Finder), Text, Rectangle, Ellipse, Line. They are baked into the face's picture, so each click adds another one and
  the tiles are never ticked. An image comes in at one pixel per watch pixel, shrunk to fit when larger than the face,
  12 at most; pictures over 1600 px a side are scaled down to that and JPEG / WebP are kept as PNG.
- **Time and date**: Seconds on a template without them (the minute digits at half size, under the minutes), Analog
  hands (hour, minute, second and a centre cap with Studio's artwork, or the template's own switched back on; added
  on Current, always-on gets hour, minute and cap), Weekday / Month / Day where the template lacks them (the weekday
  from the face's font, Arial when it names none). AM/PM, and seconds or date parts the template has itself, were
  already listed as template layers the face hides.
- **Status**: Negative sign on a template without one, and Animation on a face without one (a folder of up to 44 PNG
  frames of one size, sized in watch pixels, centred; Current only).
- Kept from the live-data rows: one undo step, the new layer selected with the inspector on Layer, a toast, the row
  ticked and selecting its layer once it's on the face. A new part goes where the engine puts it when that is clear,
  else to the free spot nearest the middle, or where it is dropped. Image and Animation open a file picker, which a
  drop can't, so those two tiles are click-only.
- **Shapes were never listed.** The engine's `deriveEditorLayers` lists imported images but not text and shapes
  (CorosLink's editor adds those rows itself), so a CorosLink face's shapes had no layer here. `faceLayers`
  (`studioFace.ts`) adds them, with the box they draw in, and puts all artwork in paint order, front first.
- **Remove**: artwork, and seconds or a date part Studio added, can be taken off for good from the layer's More
  actions ("Remove seconds" / "Remove from the face") or with Delete. Everything else still hides.
- `CLINK_SMOKE_SCREENS="/studio/blank"` makes a Start-blank face on the PACE Pro's first digital template, adds text, a
  rectangle, an image, seconds, hands and a weekday, reopens it and saves its BIN (`studio-built-*` shots).
- Tests: `studioLibrary.test.ts` (each new add on a Start-blank face: listed, selectable, its inspector, hide / show,
  remove, drop point, the config the build reads, the design it started from untouched).

### Left

- Official COROS images in Add → Artwork (the asset library, phase 5).
- "Add time" in one step (CorosLink's blank-face quick start, `restoreWatchfaceTemplateTime`, which also brings the
  colon and tints digits the black background would hide): hours and minutes come back one row at a time.
- Reordering artwork (bring forward / send back), resize handles and crop on the watch.
- The animation's per-watch outcome ("plays 12 of 44 frames on PACE 3") and per-frame timing; the inspector's Replace
  frames still takes frames at master size, not watch pixels as Add does.
- Reading a picture and the frames runs on the page's thread, like the rest of the engine until it moves to a worker.

## Official COROS artwork and Google Fonts (2026-11-23)

The two things the parity audit found missing.

- **Official asset library** (`desktop/main/watchface/officialAssets.ts`, rewritten from CorosLink's
  `corosOfficialAssetService.ts`; classification in `desktop/watchface/officialAssetSets.ts`, reading a compiled face in
  `officialFaceSets.ts`). The hosted library at `coroslink-assets.akerrules.ca/official-faces` is the only host asked,
  with no redirects and every answer capped (an archive ≤25 MB). A watch's index downloads once on the first visit
  (progress in bytes), strips as pages are browsed, a set's frame ZIP when it is opened, all under
  `studio/official-assets/<firmware>`; 4 downloads at once; an index older than 24 h is fetched again in the background.
  When the library can't be reached, or has no index for the watch (it has 8 of the 12), it is built here from the
  signed-in COROS account's official faces (4 at a time, ≤25 MB each). Reads only, so Local-Only Mode lets it through.
  Routes: `/official`, `/official/assets`, `/official/strips/<id>`, `/official/sets/<id>`, `/official/refresh`.
- **The browser** (`desktop/renderer/parts/StudioOfficial.tsx`, loaded on first use): watch, category, "Used as",
  purpose and frames (single / sets / a frame count) on the left, 36 sets a page with search, and the picked set on the
  right with its frames to step through (buttons, ← →, or the frame strip). Entry points, as in CorosLink
  (`desktop/renderer/studioOfficial.ts`, tested): Add → Official (one frame becomes an image layer in the middle of the
  face, 1:1 on the watch), a template image's "Official library", the PNG set's "Official COROS font" (digits, or
  weekday / month labels, for the layer or the face), the battery icon's "Official sprites", and the weather icon's Day
  icons / Night icons / Temperature digits (with Restore for each).
- **Google Fonts** (`desktop/main/watchface/googleFonts.ts`, `desktop/renderer/studioGoogleFonts.ts`). The page's CSP is
  unchanged: the main process fetches Google's family list (`fonts.google.com/metadata/fonts`, kept 7 days), a family's
  stylesheet (`fonts.googleapis.com/css2`) and its `.woff2` files (`fonts.gstatic.com` only), keeps them in
  `studio/google-fonts` (a family 30 days, then refreshed; the saved copy is used offline) and serves them from the
  app's origin; the page registers them with the FontFace API. The font picker has the design's Google tab (search, each
  row drawn in its font once its preview face has loaded, the weights the family has) for a layer and for the face font;
  the Weight menu then offers that family's weights, and a pick snaps a weight the family lacks to the nearest.
  A face that names a Google font loads it before it is first drawn; saving still attaches font snapshots. Offline with
  nothing saved, the picker and the open face say so and the face draws from its snapshot.
- Tests: `officialAssets.test.ts` and `googleFonts.test.ts` (host allow-lists, size caps, 4 at once, the 24 h / 7 day /
  30 day refreshes, offline fallbacks, the local build, Local-Only, the routes), `studioOfficial.test.ts` and
  `studioGoogleFonts.test.ts` (the edits each pick writes). `CLINK_SMOKE_STUDIO_ASSETS=1` with `CLINK_SMOKE` walks all
  of it on a new SIMPLE face against the real library and Google, reopens the face and saves its BIN
  (`studio-assets-*.png`).

### Left

- Only a family's Latin faces are fetched (other scripts only where it has no Latin subset), so a text layer in
  Cyrillic or CJK set in a Google font falls back for those letters.
- CorosLink's offer to switch a missing font such as "RobotoBold" to the Google family and weight
  (`parseWatchfaceGoogleFontName`), and its category chips in the Google list (search matches the kind instead).
- The browser's card sizes, "Crisp pixels" switch and 1×–4× zoom (the preview picks a whole-number zoom itself); the
  weather icon's Minus & degree and °C / °F sets, and importing weather sets from a folder.
- The local build wasn't run against a real COROS account (tested with a compiled face and a fake catalog); its faces
  stay cached under `official-assets/<firmware>/faces` with no pruning.
- Sprite-sheet PNG fonts, and Add → Official beside the other session's Image row (two places to add artwork until
  the branches meet).

## The selectable data slot (2026-11-24)

CorosLink's "Selectable metric": the one place on a face whose data the wearer picks in the watch's face settings
(`rect_control1_pos` and the `control_*` keys under it). Studio calls it **Selectable data** in Layers, Add and the
inspector. Logic in `desktop/renderer/studioSlot.ts` (rewritten from the editor's `renderComplicationPicker`,
`setControlComplicationEnabled`, `renderSelectableSlotIcon`, `renderSelectableSlotSharedAssets` and
`renderControlBatteryInspector`), the panel in `parts/StudioSlot.tsx`.

- **Add → Selectable data** (`addSlotField`): on a template whose slot the face hides it comes back where the template
  keeps it, with the types the face had. On a template without a slot (PACE Pro's first digital template has none) the
  engine writes one: it starts with heart rate, steps and calories, under the middle of the dial, or where it is
  dropped. Ticked and selecting the layer once it is on the face. In always-on only where the template has it there.
- **The list the wearer picks from**: every type (heart rate, steps, calories, floors, elevation, barometer, exercise,
  sunrise, sunset, battery, sensor temperature, and the date where the template declares it), each a switch with its
  icon and the sample the preview draws. Under a name, only what matters: "Added by Studio" (not in the template, its
  keys are written on build), "No icon", or why the switch is off ("Not on this template's always-on screen").
  Turning one on previews it; turning the previewed one off moves the preview on. The arrows step the preview.
- **Warnings**, read from the config the build writes (`slotSelector`): a type's `control_*` key left declared but
  empty in any watch size ("the watch may list a blank entry", with a Strip blank keys button), types with no icon,
  nothing on. Empty keys a template ships outside the types (`control_percent_icon`, the year's) are left alone.
- **The previewed type**: its icon (replace, import one the template lacks, Official library, restore, show / hide)
  and Icon offset, which moves the icon alone; the layer's own position moves icon and value together. Battery: its
  own level pictures (numbered PNGs, Official sprites, restore, scale) and offset. Barometer: the three trend images
  and the decimal point as one set, each replaceable (Studio draws arrows and a dot otherwise), and Trend shown, which
  draws falling / steady / rising on the preview (`previewBarometerTrend`, the one option added to the engine).
- **Every type**: colon, minus sign, Value tint (`selectableMetricStyle.color`, clearable), then the digits' font,
  size, spacing, weight, align, rotation and edges that were already there. The colour bar and "Values and icons"
  write `layerColors.complication` (the `control_*_font_color` keys and the icons' tint), as before.
- **Layers**: the slot's icons, colon, minus, trend images, decimal point and battery pictures are no longer rows of
  their own; their ids lead to the slot (`isSlotPart`, `rowOf`). The slot stays listed with every type off, so its
  panel can turn one back on. The slot's Bluetooth and Do Not Disturb pairs stay their own spots.
- **Simulate**: a "Wearer picks" row steps through the types that are on and takes a sample value for the one shown.
- Rules kept: a type that is off has every key of its group deleted, so no empty `control_*` group is written; battery
  off also drops the slot's Bluetooth / Do Not Disturb keys and `battery_icon_lowpower`; only the barometer's
  direction branch is written (COROS's compiler aborts on the static one); sensor temperature gets its own minus sign
  and never touches weather temperature; always-on only switches what its own config carries. The old "Barometer:
  Static / Direction" switch is gone: the engine ignores it and converts a static template.
- Fixed on the way: the build refused a face whose battery choice Studio added to a template without a slot ("The
  template's config does not define: control_battery_icon_pos"); the key is now one the archive may append
  (`archive/config.ts`). CorosLink's `corosWatchfaceService.ts` has the same gap.
- Tests: `studioSlot.test.ts` (Add on both kinds of template and in always-on, each type on / off with the built
  config in every size, icon replace / import / restore / hide, offset, tint, colon and minus, battery pictures,
  barometer trend set, preview and stepping, no blank groups, the blank-key warning, every type's keys appended into a
  template without them, layer rows, an older saved face).
  `CLINK_SMOKE_STUDIO_SLOT=1` walks it on a Start-blank PACE Pro face and saves the BIN (`studio-slot-*.png`).

### Left

- The watch orders its own list; Studio shows the types in the editor's order and doesn't claim the watch's.
- A slot Studio makes puts each icon at the value box's left edge (the engine's fallback), where a long value can
  overlap it until Icon offset moves it. Studio has no artwork of its own for type icons (only the barometer's).
- A slot Studio makes has no colon between sunrise's, sunset's or exercise's two values (the engine adds none; the
  template's `control_colon_icon` is used where there is one).
- No drag of an icon on the watch (CorosLink drags it there; here Icon offset is typed), no "Download" of a slot
  image, no "Native PNG size" switch or zoom for a replaced icon, and `control_percent_icon` isn't offered.
- The preview draws the template's or Studio's barometer trend; a hidden trend image still shows in the preview.
- In always-on the slot's panel switches and previews types; icon editing there was not tried on a real template.
- Hiding the slot with the eye blanks `rect_control1_pos` and leaves its types' keys, as CorosLink does.

## Phase 7 plan: Watchmaker, automation and Activity screens (2026-11-25)

What CorosLink does, and how it maps here. One feature at a time, each its own commit.

**The shared piece: an editor broker.** In CorosLink the open editor registers an automation controller
(`registerWatchfaceAutomationEditor`), and the main process reaches it over IPC (`watchfaceAutomationBroker.ts`:
one queue, one request at a time, a ready wait, a timeout). Here there is no new IPC: the open editor holds a stream
open on `clink://app/api/desktop/studio/automation/inbox` (one JSON line per request) and answers each with
`POST …/automation/reply`. The broker (`desktop/main/watchface/automation/broker.ts`) queues requests, waits for an
editor, times out, and fails what's pending when the stream drops. The controller in the page
(`desktop/renderer/studioAutomation.ts`) answers the methods on the live document: `get_document`,
`apply_commands` (through the engine's `applyWatchfaceAutomationCommands`; one call is one undo step; a revision
number and a session id per open face, and a stale `baseRevision` is refused), `undo`, `redo`, `select`, `set_view`,
`render_preview`, `validate`, `check_contrast`, `sample_color`, `crop_image`, `save`. Images never travel in tool
JSON: data URLs in a document become `{assetId}` in main (a content-addressed store per face), and go back to data
URLs only at the editor boundary, as in CorosLink.

1. **Automation MCP server** (CorosLink `electron/watchfaceAutomation*.ts`, `docs/watchface-automation.md`). Off
   until turned on in Settings → AI. Listens on 127.0.0.1 only, a private bearer token (sealed with the keychain;
   turning it off revokes it), exact loopback Host and no foreign Origin, a body limit, JSON-RPC over HTTP like
   `ai/bridge.ts`. Tools: the editor methods above plus `get_context`, `get_schema`, `list_projects`, `open` and
   `import_asset` (a local PNG / JPEG / WebP by absolute path). Settings shows the address and a Copy Codex
   configuration button. Left for later: `convert`, `build_archive` / `export_*`, `publish`, `load_template`,
   `duplicate` / `delete`, `list_fonts`, `render_svg`, `recolor_image` (the page has its own buttons for these).
2. **Watchmaker AI** (CorosLink `WatchfaceAiPanel.tsx`, `electron/watchfaceAi*.ts`, `docs/watchmaker-ai.md`). An
   **AI** tab beside Layer and Face. CorosLink ran only Codex CLI; here it asks the provider picked on the AI page
   (any of them: keys, ChatGPT, the CLIs), or one picked in the panel, with its power level. Its loop
   (`desktop/main/watchface/watchmaker/`) runs in main and drives the face through the same broker, so every applied
   step is one undo step and the canvas updates live; Stop aborts the request. Pictures pasted or dropped in go with
   the message, marked as a design reference or a screenshot. Tools: `get_document` (compact), `get_schema` by
   section, `apply_commands`, `undo`, `render_preview` (the picture goes back to the model), `check_contrast`,
   `validate`, `inspect_asset`, `crop_image`, `generate_image` (OpenAI key or ChatGPT sign-in only), `update_plan`.
   Chats are saved per face (`studio/projects/<id>/watchmaker.json`). Left: CorosLink's requirement checklist and
   evidence gates, reference comparison, parallel image workers and the Codex CLI app-server engine.
3. **Activity screens** (CorosLink `CorosActivityScreenPanel.tsx`, `electron/corosActivityScreen*.ts`). DEV-only and
   Experimental, for PACE Pro: read an activity's data pages over Bluetooth (V3 0x9e), back them up, sync them back
   unchanged and read back every byte, confirm on the watch, then try other field counts (0x9f). Here: behind
   developer mode, on the Developer page, through the Local mode watch link; the helper gets one narrow command that
   only sends 0x9e / 0x9f. The protocol and service move over with their rules as tests (backup and journal before
   every write, read-back must match, a pending restore blocks writes, experimental layouts need a confirmed
   baseline).

## Phase 7: done (2026-11-25)

**Automation MCP server** (`desktop/main/watchface/automation/`, page side `desktop/renderer/studioAutomation*.ts`,
`useAutomationHost.ts`).
- The open editor answers through the broker as planned: `get_document`, `apply_commands`, `undo`, `redo`, `select`,
  `set_view`, `render_preview`, `get_geometry`, `check_contrast`, `sample_color`, `validate`, `save`, `render_svg`,
  `recolor_image`; `open` navigates to a face and waits for its editor. `crop_image` runs in the main process with the
  compiler's PNG codec, so it never holds up the screen. Any change to the face, by hand or by an agent, is a new
  revision; `apply_commands` with a stale revision or another session's id is refused untouched.
- Settings → External AI → Watch faces turns the server on. Port 38471 (CorosLink's; 38472 is the strength-workouts
  server's), a new token each time it's turned on, sealed with the keychain, revoked when it's turned off, kept
  across restarts. Copy Codex configuration writes the TOML to the clipboard from the main process; the page only
  sees the token's last four characters.
- Tests: `automation.test.ts` (broker order, refusals, waits, disconnects, timeouts, cancel; asset store ids, refs,
  limits; server admission by token / Host / Origin, tool list and calls, HTTP; import paths; crop; settings on /
  copy / restart / off), `studioAutomation.test.ts` (document and placement, one undo step per batch, stale revision
  and session, always-on, previews, contrast probes, select, validate, save). `CLINK_SMOKE_STUDIO_AUTOMATION=1` turns
  it on in Settings, takes the configuration off the clipboard and drives SIMPLE over HTTP as Codex would
  (`studio-automation-*.png`).

**Watchmaker** (`desktop/main/watchface/watchmaker/`, panel `desktop/renderer/parts/StudioWatchmaker.tsx`).
- An **AI** tab beside Layer and Face, loaded on demand. It asks the AI picked on the AI page, through the same
  pills as Coach's message box (provider and model, power level), so changing it there changes Coach's too. Agents
  that run as their own program (Claude Code, Gemini CLI, OpenCode, Antigravity) get tool text only; the others also
  see the pictures (the face at the start of each message, previews, attachments, crops, generated images), sent back
  as a message of their own after the tool results and trimmed to the newest two.
- Pictures paste, drop or attach (PNG, JPEG, WebP, up to four, 8 MB each); the first in a chat is the design
  reference, later ones screenshots, switched on the chip. The latest reference goes with every later message.
- Each `apply_commands` and `undo` is one undo step; the loop keeps the session and revision itself and tells the
  model to re-read on a conflict. Stop aborts the run; what was done stays and the answer is saved as stopped.
  Plan and steps show as sections that start open. Up to 40 model rounds per message.
- `generate_image` is offered only while an OpenAI key is saved on the AI page (`gpt-image-1`).
- Chats are saved with the face (`studio/projects/<id>/watchmaker/<chat>.json`, pictures in the automation asset
  store) and the newest opens with the face.
- Tests: `watchmaker.test.ts` (rounds, edits, pictures to seeing models only, compaction, stop; tools keep the
  revision, conflicts, the wrong face; history and the remembered reference; the service end to end over a fake
  editor, saved chats, no AI, foreign requests, busy, stop). `CLINK_SMOKE_STUDIO_WATCHMAKER=1` runs the real panel
  with a scripted model (an empty profile has no AI; dev builds only) and checks the one-step undo and the reopened
  chat (`studio-watchmaker-*.png`).

**Activity screens** (`desktop/main/watch/activityScreens*.ts`, `desktop/renderer/parts/ActivityScreens.tsx`).
- On the Developer page, development builds in developer mode only (refused in packaged builds, as in CorosLink),
  through the Local mode link. The helper's new `activityScreens` command sends only 0x9E / 0x9F.
- CorosLink's rules are tests (`activityScreens.test.ts`): the codec against golden bytes from CorosLink's own codec
  (every field count, only the chosen page changes, 0xAE for seven, 0xBF for nine), backup and journal on disk before
  the first write, journal kept after a failed read-back and only its restore allowed, experimental counts and nine
  fields gated, connection / watch / firmware / freshness checks, damaged backups never offered, developer gate.
  `CLINK_SMOKE_ACTIVITY_SCREENS=1` walks it with a simulated PACE Pro (`activity-screens-*.png`).

### Left

- Watchmaker on a real model: only the scripted smoke and the tests ran here; no live provider was tried. Its
  instructions (`rules.ts`) are a condensed rewrite of CorosLink's skill.
- Watchmaker: CorosLink's requirement checklist and evidence gates, `compare_design_reference`, asset review
  decisions, parallel image workers, the Codex CLI app-server engine, image generation through ChatGPT or Gemini
  sign-ins, and reference images for generation.
- MCP: `convert`, `build_archive` / `export_*`, `publish`, `load_template`, `list_templates`, `duplicate` / `delete`,
  `list_fonts`, `close`. `render_preview` at a resolution draws the master scaled down, not that resolution's own
  sprites (CorosLink drew the export at that size).
- Editor work for automation runs on the page (validation, drawing, contrast's extra renders), like the editor's own.
- Activity screens never ran against a real watch here. The helper binary must be rebuilt
  (`swift build -c release` in `native/watch`) for the main checkout's app to have the new command.
