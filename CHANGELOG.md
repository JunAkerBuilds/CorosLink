# Changelog

C-LINK desktop betas (`vX.Y.Z-clink.N`). They go to CorosLink installs on a Mac that opted in to C-LINK, to earlier
C-LINK betas, and to anyone who downloads them from the release page. Each section here is also that release's notes on GitHub.

## [0.2.0-clink.5] - 2026-11-28

### Coach on your phone, anywhere
- Your paired phone talks to Coach on this computer, in the same conversations: pick one up on whichever screen is
  closer.
- Reach from anywhere, on Connections, keeps Coach working away from home through relay.coroslink.com and a
  Cloudflare tunnel. It's off until you turn it on, and needs a coroslink.com account.
- Phone sync still needs the phone and this computer on the same Wi-Fi. Sync from anywhere comes with the next
  C-LINK Mobile build.
- No phone? The Dashboard, Calendar and Coach work out fitness, load and readiness from your watch's activities.

### A page for every sport you do
- Walking, Hiking, Skiing and Climbing join the others, shown only when you do them: your week, the last four weeks,
  the climb, recent sessions and records.
- Drag the sport tabs into your own order. The hub and Go to follow it.

### Watch Studio, closer to the watch
- The canvas plays a face's animation as the watch will.
- Send to iPhone brings the editable project too.
- Watchmaker runs your own Codex CLI, with all its tools.
- Values, colons and icons in a slot scale as one, and the slot's icons are built at the size the editor shows.
- Studio no longer adds a barometer to a face's selectable slot; a template that has its own keeps it.

### Phones
- A phone you remove on Connections stays removed: it can't come back through Reach from anywhere until you scan a
  new code on this computer.
- Wrong sign-ins from one address no longer lock out your own phone.
- The pairing code closes as soon as the phone pairs, also when the same phone pairs again.
- After restoring a backup, a paired phone reads everything again instead of keeping what the backup replaced.
- On Windows, the pairing code puts Wi-Fi first, and Allow lets phones through Windows Firewall.

### Fixes
- Watch Studio: dragging stays smooth on busy faces.
- Watch Studio: always-on selection boxes sit in the right place on PACE Pro.
- Watch Studio: the barometer's icon can be dragged.
- Always-on digits have clean, solid edges.
- Calendar: the unsaved-changes bar stays at the bottom of the window.
- Checking for updates no longer fails while a new release is still being published.
- Back and forward arrows at the top of the sidebar.
- The old COROS account import is gone from Setup and Connections; it relied on a helper that was removed.

## [0.2.0-clink.4] - 2026-11-27

### What's new
- After an update, a What's new sheet shows the release's new features, each with Try it to open it, then the
  fixes. It shows once per release; Help → What's New… opens it again.

### Your privacy, your call
- A new step in the first-run intro asks about usage counts and crash reports before anything is sent. If you
  already use C-LINK, it shows once on its own after this update.
- Usage counts: one anonymous check-in a day so the developer gets an idea of how many people use C-LINK: a random
  ID, the app version and your OS. Nothing more. It starts on; switch it off right there or in Settings → Privacy.
- Crash reports: when C-LINK crashes, the last hour of its error log, with home folders and keys taken out. Off
  until you turn it on.
- Nothing is sent in Local mode.

### Report a problem
- Help → Report a Problem… opens Settings → Error logs ready to type: send the log and a message straight to the
  developer, with an email if you'd like a reply. You get a reference back.

### Miles, feet and pounds
- Settings has a units choice: metric or imperial. In imperial, every screen shows and takes miles, feet, min/mi,
  mph, yards and pounds: activities and splits, the dashboard, calendar, workout builder, plans, body, strength,
  Coach's cards and Route Studio. Your data stays as it was.
- Swim workouts in imperial start on a 25 yd pool, and the watch shows it in yards.
- A pace typed with "/km" or "/mi" is read in that unit.

### Watch Studio
- Download offers the project ZIP to upload to Community.
- The Download menu opens above the panels instead of under them.
- Text and shapes sit just above the background in Layers, as the watch draws them, and a click on the canvas picks
  the layer in front.
- An "i" on each layer says how that kind of layer works.
- Thin pictures no longer show as a checkered strip.

### Menus
- Popovers are as solid as the drop-down menus, so busy pages don't show through.

## [0.2.0-clink.3] - 2026-11-26

### Languages
- C-LINK now speaks Spanish, German, Brazilian Portuguese and Simplified Chinese, as well as English: every screen,
  menu and message. The first-run intro opens on a language page, and you can change it any time in Settings.
- The intro's headlines fit every language, so nothing runs under the buttons.

### Coach with Claude Code, Gemini CLI or OpenCode on Windows
- Claude Code installed with its own installer (`claude.exe`) is found, and one installed with npm (`claude.cmd`) now
  starts. Before, Check said "Not signed in" and Sign in said "Sign-in took too long" even when you were signed in.
- A folder added to PATH after C-LINK started is found without restarting it. With more than one install, the newest
  is used.
- If C-LINK still can't find the program, type its path under Program and press Check.
- A program that can't start now says so, and Settings → Error logs says why.
- The same fixes apply to Gemini CLI and OpenCode.

### Claude Code sign-in
- Sign in opens Claude Code's sign-in in your browser and no longer times out. Coach switches to Claude Code once
  you're signed in.

### COROS Maps
- Check files (on a map that's on your watch) reads the watch's map files back, compares them with the download and
  replaces any that don't match.
- A copy cut short by unplugging the watch no longer leaves unfinished files on it.

## [0.2.0-clink.2] - 2026-11-26

### Windows and Linux
- C-LINK betas now come for Windows (installer) and Linux (AppImage and deb), not just the Mac. CorosLink 0.1.85
  offers the switch on Windows and Linux too, or download it from this release. After that, the beta updates itself.

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
- The macOS keychain password prompt no longer comes back on every launch. C-LINK asks for CorosLink's saved
  keychain item at most once, even if you say no.

## [0.2.0-clink.1] - 2026-11-25

- First C-LINK beta: the new CorosLink, rebuilt from scratch. It is a local app: your data stays on this computer
  and the C-LINK phone app syncs straight to it. There is no account and no cloud.
- Reaches the watch over Bluetooth through a new engine (clink-ble).
- On first launch it offers to bring over your CorosLink data. It only copies, so CorosLink's data stays where it
  was.
- Updates itself from this beta track. Mac only for now. Windows and Linux stay on CorosLink 0.1.x.
