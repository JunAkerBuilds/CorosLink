# Changelog

C-LINK desktop betas (`vX.Y.Z-clink.N`). They go only to CorosLink installs that opted in to C-LINK, and to earlier
C-LINK betas. Each section here is also that release's notes on GitHub.

## [0.2.0-clink.2] - 2026-11-26

### Watch Studio
- Studio now matches CorosLink's editor: config files, the full simulation panel, Duplicate (⌘D), and moving layers
  forward or back (⌥↑ / ⌥↓, add ⇧ to go all the way to the front or back).
- Strokes can use a gradient, opacity and order. Shadows can be duplicated and reordered.
- The Exercise metric's colon has its own settings: show it, colour, size, centring, weight and PNG.
- AM and PM each take their own picture. Template images show their picture, size, file and key, and have a
  Download button.
- Hidden status images, colons, date slashes and AM/PM keep their place and alignment, and stay in the layers list
  with their eye.
- Each live-data part is edited one picture at a time, with its own box, alignment, font size and font.
- The Animation inspector says what the watch will play and dims the frames it skips.
- A face rebuilt for another watch opens on the chart group it had open.
- Delete and lock layers from their rows in the layers list. Live data added from Add can be deleted.
- A field's icon can be dragged separately from its number.
- New side panels: softer filled fields, number fields instead of sliders, a colour chip with a hex value, and an
  inspector you can resize. No more "Experimental" tags.
- The projects list opens faster: it reads short summaries, not every design.

### Fixes
- A workout recorded by the watch and also synced from the phone now shows up once, with the details from its FIT
  file.
- Dropdowns are no longer see-through.

## [0.2.0-clink.1] - 2026-11-25

- First C-LINK beta: the new CorosLink, rebuilt from scratch. It is a local app: your data stays on this computer
  and the C-LINK phone app syncs straight to it. There is no account and no cloud.
- Reaches the watch over Bluetooth through a new engine (clink-ble).
- On first launch it offers to bring over your CorosLink data. It only copies, so CorosLink's data stays where it
  was.
- Updates itself from this beta track. Mac only for now. Windows and Linux stay on CorosLink 0.1.x.
