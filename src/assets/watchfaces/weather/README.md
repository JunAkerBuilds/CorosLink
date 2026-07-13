# COROS weather sprite set

This directory contains a normalized 41-state weather sprite set for COROS
watchface packages. Every sprite is an RGBA PNG on an identical transparent
square canvas and is named in firmware order from `00.png` through `40.png`.

## Package variants

- `416/`: 64×64 sprites for `watchface_416x416/weather/`
- `800/`: 123×123 sprites for `watchface_800x800/weather/`
- `master/`: 128×128 reusable source sprites
- `manifest.json`: state labels, source-grid indices, and dimensions
- `weather-contact-sheet.png`: visual alignment/transparency QA
- `extras/`: the final atlas row, which is not part of the 41-state set

The compiled weather-frame size is template-specific: two decoded official
416px faces use 76×76 (PLANET) and 42×42 (GO FISHING) frames. CorosLink keeps
the existing `weather/` folder's dimensions when present; when adding weather
to a template without that folder it uses the bundled 64×64 source artwork.
When an `AODconfig.txt` is present, it points at the same source folder; the
COROS compiler creates the separate dimmed AOD weather table.

Use the matching resolution directory as `weather` in the watchface archive:

```ini
[weather_icon_pos]={187,57}
[weather_icon_dir]=weather
```

The supplied image is a 7×7 grid. Firmware states use rows 0–4 plus columns
0–5 of row 5 (41 icons). Row 5 column 6 is blank. Row 6 is retained under
`extras/` rather than being mixed into the firmware ordering.
