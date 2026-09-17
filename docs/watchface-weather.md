# Native weather defaults

Watch Face Studio's **Weather icon → Weather assets** section uses the weather assets from the user-supplied SIMPLE template (260902). Enable the Weather icon layer to export day/night conditions and current temperature. The temperature checkbox can hide the temperature independently. Position and size apply to the attached weather display; the temperature sits above the icon.

The original source PNGs are bundled in `src/assets/watchfaces/weather/simple`. Exports resize them per target resolution without changing the bundled originals. Weather uses `weather_icon_pos`, `weather_icon_dir`, and `weather_dark_icon_dir`; temperature uses `weather_temp_rect`, `weather_temp_font`, `weather_negasign_icon`, `weather_dgree_icon`, and `weather_temp_max_min_dgree_icon`. Adding weather alone preserves the template's watch-face version (SIMPLE is version 0).

Users can import numbered PNG folders for day icons (00–40), night icons (00–40), digits (00–09), minus/degree (00/01), and Celsius/Fahrenheit (00/01). Partial sets replace only matching states. Other states retain SIMPLE defaults. Restore defaults clears that set's overrides. Custom assets are saved inside the editable project. Optional tint affects both day and night sets and temperature assets.

The preview uses sunny weather and 18°. Device firmware supplies actual conditions and temperature; on-watch behavior still needs hardware verification.

**Current weather** (`weather_temp_*`) displays weather temperature separately from **Sensor temperature** (`temperature_*` / `control_temperature_*`). The sensor is the watch's thermometer, affected by body heat when worn; it is not a duplicate of weather temperature. Keep the two simulation inputs and export bindings independent. COROS documents the distinction in its [Temperature Widget](https://support.coros.com/hc/en-us/articles/43904010291348) and [Weather Widget](https://support.coros.com/hc/en-us/articles/20991888248596-Weather-Widget) guides.

Run `npm run build:electron` and `npx electron scripts/test-watchface-weather.cjs` to verify raster generation, complete archive creation, native keys, duplicate-key repair, default/custom previews, and project persistence across 240/260/280/800 resolutions. Pass a local project ZIP as the final argument to test its real starter archive (for example SIMPLE.zip). Tests use isolated temporary app data and never publish.
