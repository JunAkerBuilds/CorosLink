# Watch Face Studio guide

Watch Face Studio is CorosLink's watch-face editor. It opens a COROS face as a
stack of editable layers (time, date, live data, artwork and text), lets you
restyle every part of it, previews the result with simulated data and both
display modes, and sends it to your watch.

This page covers everything Studio offers, in the order you meet it. The
topic pages go deeper on specific areas:

| Topic | Page |
| --- | --- |
| Live data fields, charts and their firmware behavior | [watchface-native-data.md](watchface-native-data.md) |
| Weather icon and temperature defaults | [watchface-weather.md](watchface-weather.md) |
| Moving a face to another watch model | [watchface-conversion.md](watchface-conversion.md) |
| Official COROS artwork library | [watchface-asset-library.md](watchface-asset-library.md) |
| Watchmaker, the built-in AI designer | [watchmaker-ai.md](watchmaker-ai.md) |
| Driving Studio from Codex or another MCP client | [watchface-automation.md](watchface-automation.md) |

Studio is **experimental**. Previews are drawn by CorosLink; the watch's
firmware draws the real face. Where on-watch behavior has not been confirmed,
the editor and the topic pages say so.

---

## 1. Supported watches

| Watch | Display | Preview size | Always-on |
| --- | --- | ---: | --- |
| PACE Pro | AMOLED | 416 × 416 | Separate AOD layout |
| PACE 4 Pro (W337) | AMOLED | 466 × 466 | Separate AOD layout |
| PACE 4 (W336) | AMOLED | 390 × 390 | Separate AOD layout |
| PACE 3 | MIP | 240 × 240 | The Current face stays on |
| NOMAD | MIP | 260 × 260 | The Current face stays on |
| VERTIX 2 / VERTIX 2S | MIP | 280 × 280 | The Current face stays on |
| APEX 4 (42 mm / 46 mm) | MIP | 240 / 260 | The Current face stays on |
| APEX 2 Pro (B20) | MIP | 260 × 260 | The Current face stays on |
| PACE 2 (B18) / APEX 2 (B21) / APEX Pro (B17) / VERTIX (B16) | MIP | 240 × 240 | The Current face stays on |

Every face also carries an 800 × 800 master layout, which Studio uses as its
authoring space (the canvas header shows **Master · 800×800**). Exports scale
the design to each resolution the watch needs.

---

## 2. The watch-face hub

Open **Watch Faces** from the sidebar. The hub has these tabs:

- **Create**: start a new face from a template or from blank.
- **My projects**: your saved, editable Studio projects.
- **Community**: free faces made by other people, from
  [watchfaces.coroslink.com](https://watchfaces.coroslink.com).
- **On watch**: the faces stored on your connected watch, with slot
  information (requires a connected, authenticated watch).

The watch-type picker at the top chooses which model the catalogs and
templates are for. If a watch is connected, it is preselected.

### Signing in

Most of Studio works without a COROS account: editable templates are bundled
with the app, and community faces and local projects never need one. Sign in
(region, email, password, or **Use saved account**) to:

- send faces to the COROS app through a share link or QR code,
- browse **Official faces** and **My faces** from your COROS account,
- load templates for a watch whose catalog isn't bundled,
- authenticate your watch over Bluetooth for direct installs.

**Save this COROS account** stores an encrypted password digest so Training
Hub and Studio can each open their own session. Without it, the sign-in is
removed when CorosLink closes. **Disconnect account** signs out; local
projects stay.

### Create

Choose **New watch face** and pick how to start:

- **From a template**: pick a COROS layout, then restyle its time, colors and
  data. The template catalog has three sources: **Editable templates**,
  **Official faces** and **My faces** (the last two need a sign-in).
  Search by template name, ID or category, filter by category, and sort by
  **COROS order** or **Newest format**. **Advanced filters** expose firmware
  type, language, maximum version, watch serial number (with presets or a
  custom serial) and model version, for finding templates a particular
  firmware accepts.
- **Start blank**: an empty face on that template's layout. Native entries
  are switched off rather than deleted, so you can bring any of them back
  from **Add**. Start by adding the time, then the date, data and artwork.

### Import

**Import** (in the hub header) opens a local DIY archive (`.zip` or `.dat`)
or an official COROS share link and opens it as a new Studio project.
Recovered official faces are rebuilt from their native layout.

### My projects

Projects are saved locally. Search by project name, watch or template; sort
by **Last edited**, **Name A–Z** or **Oldest first**; filter by watch model.
Each project card has **Open**, duplicate and delete actions (deleting is
permanent). The newest project is offered under **Continue designing**.

### Community

Search by face, creator or watch model, filter by watch model and style
(**Minimal**, **Data rich**, **Trail**, and others), and sort by **Trending**,
**Most downloaded** or **Newest first**. Grouped faces have variants per
watch; **View variants** lists them. **Open in Studio** downloads the
reviewed package, verifies it and opens it as an editable project. A face
that doesn't list your connected watch warns first; **Open anyway** still
opens it.

Faces you open from the website also land in Studio. If you have unsaved
edits, Studio asks you to save or discard them first.

---

## 3. The editor at a glance

```
┌──────────── toolbar: project name · Undo/Redo · Save · Download · Convert · Send ───────────┐
│ Layers panel         │            Canvas (watch preview)            │  Inspector          │
│  Add ▾               │  zoom · Current/Always-on · placement tools  │  Selection │ Project │
│  search · groups     │  rulers, guides, align bar                   │  AI (Watchmaker)    │
└──────────────────────┴──────────────────────────────────────────────┴─────────────────────┘
```

- **Toolbar**: the project name (up to 80 characters), save state
  (**Unsaved** / **Saved**), **Undo** and **Redo**, **Save**, **Download**,
  **Convert** and **Send to COROS**. The layers and properties panels can be
  hidden with their toggle buttons, and **Full screen** gives the canvas the
  whole window (Esc exits).
- **Layers panel** (left): everything on the face, with **Add**.
- **Canvas** (center): an interactive, pixel-accurate preview.
- **Inspector** (right): **Selection** edits what you selected; **Project**
  holds face-wide settings; **AI** opens Watchmaker.

When a face first opens with nothing selected, the inspector shows **Make
this face yours** with quick edits: **Background color**, **Background
photo**, **Style the time**, **Add text** and **Add a shape**.

### Keyboard and mouse

| Action | Shortcut |
| --- | --- |
| Save | ⌘S / Ctrl+S |
| Undo | ⌘Z / Ctrl+Z |
| Redo | ⇧⌘Z / Ctrl+Shift+Z, or Ctrl+Y |
| Duplicate the selected image | ⌘D / Ctrl+D |
| Group selection | ⌘G / Ctrl+G |
| Ungroup selection | ⇧⌘G / Ctrl+Shift+G |
| Delete selection | Delete or Backspace |
| Nudge 1 px (10 px with Shift) | Arrow keys |
| Clear selection | Esc |
| Add to selection | Shift-click (also ⌘/Ctrl-click in the layer list) |
| Move without snapping | Hold Alt / Option while dragging |
| Lock a drag to one axis | Hold Shift while dragging |
| Resize from center | Hold Option while resizing |
| Snap rotation to 15° | Hold Shift while rotating |
| Apply / cancel a crop | Enter / Esc |
| Reorder a layer from a control | Alt+↑ / Alt+↓ |
| Delete a guide | Double-click it |

Number fields are scrubbable: drag left or right to change the value, or
click to type. Every edit, including each Watchmaker step, is one undo step.

---

## 4. Layers

The Layers panel lists every part of the face, grouped (for example
**Time**, **Components**, **Indicators**, **Metrics**, **Background**).
Each row can be:

- **Selected**, Shift/⌘-clicked into a multi-selection.
- **Hidden** or shown (eye icon). Hidden layers are not exported, but stay
  in the project. Whole groups can be hidden at once.
- **Locked** (lock icon) so it can't be moved by accident. Groups can be
  locked too.
- **Reordered** by dragging (or Alt+↑/↓). **Layer order** in the inspector
  has **Move backward** and **Move forward**.
- **Found** with **Find a layer**, which searches names and kinds.

Linked components (for example the parts of a native field) show a link
badge and move together.

### The Add menu

**Add** opens a searchable picker with two parts.

**Artwork**

| Item | What it adds |
| --- | --- |
| **Image** | A PNG/JPEG/WebP from your computer, as a free image layer. |
| **Official** | An image from the official COROS asset library (icons, battery gauges, weather glyphs, backgrounds…). |
| **Text** | A fixed text label. |
| **Rectangle** | A rectangle (corner radius, fill, gradient). |
| **Ellipse** | An ellipse or circle. |
| **Line** | A straight line (length and thickness). |

Text and shapes are baked into the face's artwork: they don't change on the
watch. Use the time and data layers for anything that updates live.

**Live data** ("Updates on your watch"), in categories **Time**,
**Calendar**, **Weather**, **Health**, **Training**, **Device**,
**Astronomy** and **Charts** (experimental):

- **Time**: hour and minute digits, **Seconds** (Studio adds seconds using
  the minute digits when a template has none), **Analog hands** (hour,
  minute and second hands plus a center cap), AM/PM indicator.
- **Calendar**: weekday, month, day, **Year**, and **Lunar year / month /
  day** (drawn only while the watch language is Chinese).
- **Weather**: weather icon, **Current weather**, minimum and maximum
  temperature, wind speed and direction, rain probability, humidity, UV
  index, air quality index (marked **Not available right now**) and
  barometer.
- **Health**: sleep score, stress, stamina, sleep HRV status, sedentary
  reminder.
- **Training**: weekly training load; today's and weekly running, cycling,
  swimming and elevation totals.
- **Device**: battery icon, **Bluetooth indicator**, **Do Not Disturb
  indicator**, **Airplane mode indicator**, **Sleep mode indicator**, touch
  lock indicator.
- **Astronomy**: sunrise/sunset times and progress.
- **Charts**: stress, stamina, steps, calories, elevation, heart rate,
  sunrise/sunset, moonrise/moonset, moon phase, moon illumination, sun angle,
  barometer and tide.

Rows already on the face show **On face**; choosing one selects that layer
instead of adding a second copy. Template layers you deleted come back
through these rows.

Status indicators and the battery icon arrive with Studio's own artwork,
about 7% of the face tall and placed inside the dial; replace their images in
the inspector. A battery icon added to a template without one installs a
twelve-state set in COROS order (charging, empty, 10–100%).

The exact list depends on the watch and template. See
[watchface-native-data.md](watchface-native-data.md) for every field's
firmware keys, state artwork and limits.

---

## 5. The canvas

### Selecting and moving

Click a layer on the face to select it, Shift-click to add more, or drag
on empty space to box-select. Drag to move, drag the handles to resize,
and drag the rotation handle to rotate. Right-click opens **Component
actions**: group, ungroup, duplicate (images), lock/unlock position and
delete.

When several layers are selected, the align bar offers:

- **Align left / horizontal centers / right / top / vertical centers /
  bottom**
- **Align glyph baselines**: aligns the visible baselines of digits and
  text and centers colons beside the tallest glyphs.
- **Distribute horizontal / vertical spacing**
- **Group** / **Ungroup**: grouped components move together.
- **Match height**: with a Bluetooth or Do Not Disturb icon and some text
  selected, resizes the icons to the text's visible height.

### Zoom and display mode

- Zoom from 60% to 140% with **−** / **+**; click the percentage to reset to
  100%. The preview draws at your screen's real pixel density, so it stays
  sharp at any zoom.
- **Current** / **Always-on** switches which display mode you are editing
  (see [Always-on display](#11-always-on-display-aod)).

### Placement tools

**Placement** opens editor-only aids that never reach the watch:

- **Snap while dragging** to layer edges, centers and the face center
  (smart guides).
- **Show center and safe-area guides**, with an adjustable **Safe-area
  inset**. The safe area is a design aid for round screens, not a firmware
  limit.
- **Grid**: Off, 4, 8, 16 or 32 px.
- Drag from the rulers to create vertical and horizontal **project guides**;
  drag a guide to move it, double-click to delete it. Guides are saved with
  the project.

### Missing fonts

If a face uses a font that isn't installed on your computer, a notice lists
each missing family and where it's used. Fonts embedded in the face still
draw correctly from their saved glyphs; installing the font is needed only
to change text with it (new characters, a different weight). Unembedded
missing fonts fall back to a substitute; install the font or pick another
before exporting.

---

## 6. The inspector

Select something and the **Selection** tab shows the sections that apply to
it, typically **Layer**, **Transform**, **Typography**, **Stroke**,
**Effects** and **Advanced**, plus the layer-specific sections below.

### Layer

- **Layer name** (free layers).
- **Layer opacity**: transparency of the whole layer.
- **Always-on display only** / **Current display only** where a layer can
  belong to one mode.

### Transform

- **Position** (X/Y), **Width**/**Height** with a link toggle to keep
  proportions, **Scale %** and **Rotation**.
- **Align to face**: center horizontally, vertically, or both.
- **Nudge** buttons (1 px).
- For images: **Flip X**, **Flip Y**, **Skew X**, **Skew Y**, the transform
  **Origin** (nine anchor points), **Crop** (drag the crop box; Enter
  applies, Esc cancels; **Reset crop**), **Use imported size** and **Tint
  image**.

Coordinates use the selected watch display's pixels.

### Typography

Every layer that draws with a font, including time digits, the date, native
data and text, uses the same controls:

- **Font**: a picker of fonts installed on your computer (searchable), any
  family name you type, **Keep template font**, or an **Official COROS
  font** from the asset library.
- **Font size** in pixels. PNG digit sets use it as their height.
- **Weight** and **Style** (Normal/Italic). A weight the family doesn't have
  is synthesized by thinning or thickening the drawn glyphs; a font with
  only one weight is drawn as it is.
- **Color**, with hex input and opacity.
- **Glyph height**, **Baseline**, **Sprite spacing** and **Digit width**,
  with **Reset fit**. Spacing changes the transparent cells around digits;
  time spacing keeps the digits beside the colon anchored.
- **Alignment** for numbers (left, center, right) or **Auto** to keep the
  template's own alignment.
- **Rasterize preview**: shows the exact pixels that will be exported.

On export, font text is rasterized into PNG digit sprites at each
resolution.

#### Custom PNG fonts

Instead of a font you can supply your own digit artwork:

- **Folder…** (recommended): a folder with one PNG per glyph.
- **Sheet…**: one PNG grid; set **Columns** and the **Glyph order**.
- **Files…**: individual PNGs to add or replace single glyphs (they take
  priority over a sheet).
- **Official…**: a digit set from the official library.

File names: digits `00.png`–`09.png`; weekdays `MON.png`–`SUN.png` (or
`00.png`–`06.png`); months `JAN.png`–`DEC.png` (or `00.png`–`11.png`). A
0–9 set used for the month shows it as a number. Files can be up to 5 MB.

A set applies to **This layer only** or the **Whole face**; a layer's own set
beats the face-wide one. **Use layer color** recolors the PNGs with the
digit color; otherwise they keep their own colors unless the layer sets a
**Tint color**. The import panel shows missing digits as dashed cells.

### Stroke

Add any number of outlines (**Add stroke**), each with **Position**
(Inside, Center, Outside), width, **Paint** (Solid color or Linear gradient
with angle) and opacity. Rows can be hidden, removed and dragged to reorder.

### Effects

An ordered stack of **Drop shadow** and **Inner shadow** effects, each with
color, opacity, **Blur**, **Spread**, **Distance** and **Angle**. Shadows can
be duplicated, reordered and removed. **Save as style** turns the stack into
a reusable effect style; **Detach style** makes it local again.

Shadows stay inside each firmware sprite so digit sizes and spacing don't
change; large blur or distance values may be clipped. Native battery slots
keep their firmware dimensions, so their shadows are clipped to the slot.

### Text and shapes

- **Text**: content, font, size, weight, color, **Text align**.
- **Rectangle**: fill, **Gradient fill** with **Gradient angle**, **Corner
  radius**, stroke.
- **Ellipse**: fill, gradient, stroke.
- **Line**: **Length**, **Thickness**, color.

---

## 7. Time, date and indicators

### Time

- **Hours** and **Minutes** can be styled together or, with **Separate hours
  and minutes**, independently.
- **Time & date separators** (colon and date slash) are template
  separators you can restyle or replace.
- **Exercise separator**: on faces with an Exercise metric, a colon drawn
  into the face artwork that follows the metric when it moves. Replace it
  with a PNG or **Use text colon**.
- **Seconds**: Studio-added seconds reuse the minute digits. **Remove
  seconds** takes them off.
- **AM/PM indicator**: a sprite the watch swaps between AM and PM in 12-hour
  mode; restyle the lettering or keep the template's.

### Analog hands

**Add → Time → Analog hands** adds hour, minute and second hands and a
center cap. Each hand is an image whose **center is the pivot**: draw the
hand pointing up (12 o'clock) with the pivot in the middle of the canvas.
**Download** saves a template hand at its full canvas so you can recolor it
and **Replace image** without moving the pivot. On-watch rendering of
Studio-added hands is not yet confirmed.

### Date

- **Weekday**, **Date month** and **Date day** each have horizontal
  alignment.
- **Show as Number / Words**: the month can show JAN–DEC in your font; the
  weekday can show its name (TUE). The day is always a number (COROS
  watches can't spell out the date).
- **Translate for watch languages**: word dates follow the languages you
  pick when sending (see [Watch languages](#watch-languages)); the font
  needs that language's letters.
- On faces without a date, Studio synthesizes the weekday, month or day from
  the face's digits or your font.
- **Year** and the **Lunar** fields are separate calendar layers.

Some regions show the date day-first: the watch firmware swaps the month and
day slots, and no face setting prevents it. Design month-first.

### Status indicators

**Bluetooth**, **Do Not Disturb**, **Airplane mode** and **Sleep mode**
indicators have on/off images you can replace. Size them with the icon
height field (the width keeps the image's proportions), **Reset size**, or
**Match height** to text. The airplane and sleep images share their
position with the Bluetooth and Do Not Disturb indicators on the watch.

### Battery

The **Battery icon** and **Battery states** draw a charge-state sprite set.
**Edit battery states** imports a folder named `00.png`, `01.png`…, or uses
**Official sprites**. The battery choice inside the selectable slot
(**Control battery icon**) has its own source, scale and position.

### Arc cut overlay

On most faces this is the date slash. On faces such as PARTICLES and COLOR
PALETTE it is a black mask over the progress arc or bar.

---

## 8. Metrics: fixed, selectable and chart pages

The inspector sorts data into three kinds:

| Kind | Meaning |
| --- | --- |
| **Fixed** | Always shows this value in this spot. |
| **Selectable** | The wearer picks which value fills this slot in the watch's face settings. |
| **Chart pages** | The watch shows one chart page at a time; Back cycles the pages. |

### Selectable metric

The **Selectable metric** layer is the slot the wearer configures on the
watch. Under **Selectable components**, turn on the data types the slot can
show (for example heart rate, steps, calories, exercise, elevation, floors,
barometer, sunrise, sunset, battery, sensor temperature). Each has its own
icon (replace it, or import one the template lacks), and the slot shares its
value digits, colon, negative sign and **Selectable value tint**. Move the
Selectable metric layer to move icon and value together; **Icon offset**
moves only the icon. **Preview data** picks which type the canvas shows.

**Sensor temperature** is the watch's thermometer and is affected by body
heat. For weather, add **Current weather** instead.

### Native data fields

Fixed data layers (weather, health, training, astronomy) are drawn live by
the watch. Select one and choose a **Component** to edit its parts:

- **Label / icon**: type replacement text (for example `TL` → `LOAD`), set
  a font and color, or replace the image.
- **Number / time**: digits, glyphs, numbered PNG imports.
- **Units**, **Symbols** (minus, degree, percent, colon), **Decimal point**.
- **State artwork**: frames for levels (stress, stamina, UV, AQI, weekly
  load), off until you turn them on.
- **Sun / moon progress**, **Graph**, **Graph background**, **Graph mask**,
  **No-data artwork**, **Min/max separator**.

Each component can be shown or hidden. **Restore component defaults** resets
one part; **Restore all appearance defaults** resets the layer's look while
keeping its position and data source.

Notable behavior:

- **Minimum and maximum temperature** are drawn as one reading: minimum,
  separator, maximum, one unit. Move the minimum to place both.
- **Distance totals** round to whole kilometres or miles unless you turn on
  the **Decimal point** (on by default for swims).
- **Weather icon** uses SIMPLE's built-in day/night artwork by default;
  replace day icons (`00`–`40`), night icons, digits and symbols with your own
  numbered PNGs or an official set.

### Charts (experimental)

A chart layer has one shared graph and one or more readouts. Adding more
chart data joins the existing chart; the watch's Back button pages through
it. **Watch pages** lists the pages in Back order (barometer, tide, sun,
moon, **Daily data · A**: stress, stamina, elevation; **Daily data · B**:
calories, heart rate, steps):

- **Add page** adds a page with its required readouts.
- A required readout can be hidden; export keeps it invisibly so the page
  still exists.
- Optional readouts (sun angle, moon phase and illumination, barometer and
  tide numbers) are added with **+**.
- **Make fixed** moves a readout off its page into a field that shows on
  every page. **Put back on its page** reverses it.
- **Line style** (thickness, upper/lower curve colors) applies to sun and
  moon pages; **Bar style** (**Bar width**, **Bar gap**, **Selected bar**,
  **Other bars**) to barometer and tide. A width of 0 hides that style.

The firmware decides which pages exist and hides most weather fields on the
sun and moon pages. Chart colors sent through the COROS app are packed to 6
bits and PACE Pro draws them dark blue; **Install on watch** keeps them. See
[watchface-native-data.md](watchface-native-data.md) for details.

### Goal progress

**Progress arc** and **Progress bar** show the live exercise or calorie
goal percentage. Set the **Progress color**, **Arc geometry** (center,
radius, **Start °**, **End °**, **Thickness**, **Draw remaining portion**) or
**Bar geometry** (edges and **Fill direction**). **Preview fill** sets the
sample percentage.

---

## 9. Background and template artwork

- **Background color** (with opacity, or transparent): the fill behind
  everything.
- **Background photo**: **Choose photo**, **Replace photo**, **Remove
  photo**, and **Photo zoom** (1×–2.25×). The photo sits behind the time and
  data.
- **Template assets** (icons, hands, center caps, separators): **Replace
  image**, **Restore original**, **Download** (saves the template's largest
  copy to recolor and import), **Native PNG size** / **Native scale** or
  **Artwork zoom**, **Sprite rotation** and **Tint color**. Replacing an image
  updates every supported resolution; a template key the template doesn't
  supply is added to `config.txt` when you import one.
- **Official images** for any asset come from the official COROS library
  (**Add → Official**, or **Official library** in a section). The library
  has filters for watch, category, **Used as**, purpose and frame count, and
  a preview with frame stepping. The first visit for a watch downloads its
  official faces once.

On MIP watches the compiler tone-maps and dithers only the background image.
Other sprites are reduced to the display's palette directly, so pick colors
that survive that.

---

## 10. The Project tab

**Project** holds template-wide settings, in two sections.

**Config files**

- **Raw config**: edit the template's `config.txt` and `AODconfig.txt` per
  **Resolution**, with **Reset file**. Studio's layer edits still apply on
  top when you export.

**Archive**

- **Watch-face version**: **Auto** keeps the template version and raises it
  only when a feature needs a newer one.
- **Remove blank config fields on build**: drops empty `[key]=` lines, which
  the watch treats as enabled features (an empty `control_*` group adds a
  blank entry to the watch's data selector).
- **Template ID override** (`o_template_id` in `info.json`),
  **Watch-face ID override** (`[watchface_id]` in every config, decimal or
  `0x` hex), **Template manifest name override** (`m_name`). Leave these
  blank unless you know you need them.

---

## 11. Always-on display (AOD)

AMOLED watches (PACE Pro, PACE 4, PACE 4 Pro) have a separate Always-on
layout. Switch the canvas to **Always-on** to edit it:

- Its layers, colors and positions are independent of Current.
- It uses a black screen. Background images are omitted; use light colors
  for digits. Custom captions need a separate AOD overlay.
- Some settings (for example goal progress) mirror Current until you
  customize them for AOD.
- **No replaceable AOD assets** appears when a template has an AOD layout
  without a standalone PNG Studio can replace.

MIP watches keep the Current face on screen at all times (**Current is
already always on**).

---

## 12. Simulation

**Simulation** previews the face with sample data. It never changes your
saved design or watch data.

- **Date** and **Time**, with **Now**, **Play**/**Pause** and speeds from
  **Real time** to **1 day / second**, plus **+1 second**, **+1 minute**,
  **+1 day**.
- **Battery (%)**, **Calorie progress (%)**, **Exercise progress (%)**.
- **Weather artwork**: condition state and day/night set.
- Values and states for every native field on the face (health, training,
  astronomy), and **Chart history** (default, rising, falling, zero values).
- **Test presets**: low battery 5%, full battery 100%, midnight rollover,
  new-year rollover, leap-day rollover (2028), wide numbers.
- **Reset simulation**.

Only fields present on the face are drawn.

---

## 13. Watchmaker (AI)

The **AI** tab opens Watchmaker, which edits the canvas live through Codex
CLI using your local sign-in. Describe a change ("Make the time larger and
center it", "Restyle this face with a dark, sporty palette"), paste or drop
images as a **Design reference** or troubleshooting screenshots, and pick the
model and reasoning effort. Each applied step is one undo step; **Stop**
interrupts. Chats are saved per face. Watchmaker can generate and crop images,
render previews, check contrast and validate the face.

Watchmaker needs Codex CLI installed and signed in. See
[watchmaker-ai.md](watchmaker-ai.md). External agents can drive Studio too,
through the local MCP server described in
[watchface-automation.md](watchface-automation.md).

---

## 14. Saving, downloading and converting

- **Save** (⌘S) stores the editable project locally.
- **Download → Editable project ZIP** saves a portable backup you can
  **Import** later or on another computer.
- **Convert** adapts the design to another watch model: pick the
  destination, and a new, unsaved project opens with your layout, fonts,
  artwork and data fields. The original stays as it was. Converting between
  AMOLED and MIP keeps the separate AOD design for switching back. See
  [watchface-conversion.md](watchface-conversion.md).

---

## 15. Sending to the watch

**Send to COROS** builds the face and opens the export preview:

- **The compiled face, pixel for pixel**, at 1:1, with sample readings, for
  Current and Always-on. Chart lines and bars are drawn by the watch after
  this preview.
- **Pixel checks**: reports clipping and overlaps of live sprites and value
  boxes, or **No clipping or overlaps**. Artwork baked into the background
  and firmware-drawn controls still deserve a visual check.
- **Watch face name**, shown in the COROS app and on the watch.

### Watch languages

Choose which watch languages the face includes. Month and day numbers reach
every language automatically. For weekday words, **Every language shows**
your design, or tap a language to give it your weekday while the rest keep
the template's translations. Your choice is remembered.

### Ways to send

| Method | How it works |
| --- | --- |
| **Install on watch** | Compiles on this computer and sends over Bluetooth to a connected, authenticated watch. Pick an empty slot or a face to replace; **Verify** confirms the install. Experimental. |
| **COROS share link** | Uploads the face to COROS and shows a QR code. Scan it with the iPhone that has the COROS app, save the face and send it to the watch. The link expires. Needs a COROS sign-in. |
| **Send to iPhone** | Hands the face to the C-LINK iPhone app over shared Wi-Fi (scan the code) or AirDrop; install it from C-LINK's My Faces. |

The watch connection itself lives in the toolbar watch menu. **Compile** and
**Save BIN** also work offline, for installing later.

On AMOLED watches, **Full color (experimental)** stores images with more than
256 colors exactly instead of as a palette, at the cost of a larger file. How
CorosLink's compiler compares with COROS's is in
[CorosLink's watch face compiler](watchface-compiler.md).

COROS rejects uploads over 10 MiB. Larger faces are re-encoded without
changing any pixel before upload; a face that still doesn't fit stops with
its size and the limit.

### Before you trust the result

- A successful preview or build doesn't guarantee the watch draws the face
  the same way. Check new features on the watch.
- Always-on brightness and thin strokes may look different on the watch.
- Direct Bluetooth installs were tested on PACE Pro firmware 3.2008.0 over
  Mac Bluetooth; other watches, firmware and platforms are in beta.

---

## 16. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| "does not contain one of the requested images" when sending | A config line references a PNG that isn't in the archive. Check **Raw config** for keys you added by hand. |
| A data field is blank on the watch | The watch has no value (for example AQI outside the US, or barometer/tide before the phone syncs), or the firmware hides it on that chart page. |
| Month and day are swapped | The watch's region shows the date day-first; firmware swaps the slots. |
| Chart bars or lines are dark blue | Sent through the COROS app, which packs chart colors to 6 bits. Use **Install on watch**. |
| An empty entry appears in the watch's data selector | An empty `control_*` group in the config. Turn on **Remove blank config fields on build**. |
| Watchmaker reports "401 … Missing bearer or basic authentication" | Codex CLI is signed out. Run `codex` in a terminal and sign in. |
| A font looks wrong in the preview | It isn't installed and isn't embedded in the face. Install it or pick another. |
