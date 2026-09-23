# COROS 4.9.9 watchface compiler inspection

Inspected the user-supplied `COROS_4.9.9_APKPure (1).xapk`, package `com.yf.smart.coros.dist`, version code `409090200`. The watchface compiler is `lib/arm64-v8a/libw4-watchface.so` in `config.arm64_v8a.apk`.

Compared it with `/Users/aker/Downloads/watchface-harness-libs/libw4-watchface.so`. The baseline's originating app version is unknown. Findings mean **added relative to our saved compiler**, not necessarily first released in 4.9.9.

## Evidence and scope

- New compiler SHA-256: `0ae044c6507cb37357799db49bfe71cc2bf6490d045ea825a8c42676041b925c`.
- Baseline SHA-256: `7273be2fd0e1985ad8c912677fd6a1add1eb57a9d1e0e3726913e4b7edba1cb2`.
- Recovered embedded `watchface.proto` descriptors: 37 → 49 top-level messages (12 additions), 9,302 → 15,350 descriptor bytes.
- Found 209 additional complete configuration-related key strings referenced from the new `WFTemplateParser::LoadConfig`. This is a key count, not 209 distinct data points. A suffix-string false positive was excluded.
- Disassembly confirms actual configuration-map lookups, not merely unused text in the binary. For example, `sleep_hrv_level_pos` is loaded at virtual address `0x1e8d84` and used in a map lookup at `0x1e8d98`.
- Static inspection only: the Android compiler was not executed, and device rendering/firmware support was not tested.
- Full field names, protobuf types, and parser reference addresses are in [the JSON inventory](coros-4.9.9-watchface-compiler.json).

## Added capabilities relative to the saved compiler

| Capability | Configuration examples | Schema evidence / qualification |
|---|---|---|
| Current weather, night icons, temperature | `weather_icon_dir`, `weather_dark_icon_dir`, `weather_temp_rect`, `weather_temp_font` | New `WFWeatherInfo`; matches the SIMPLE package already integrated. |
| Minimum/maximum temperature | `weather_temp_min_rect`, `weather_temp_max_rect`, corresponding fonts and separator/unit assets | Separate min/max numeric values. |
| Wind and direction | `weather_wind_rect`, `weather_wind_font`, `weather_direction_icon_dir` | Numeric wind plus a direction-state icon. Units and state ordering need template/device confirmation. |
| Chance of rain | `weather_rainfall_rect`, `weather_rainfall_percent_icon` | Runtime schema calls this `rainfall_probability`; do not label it accumulated rainfall. |
| Humidity | `weather_humidity_rect`, `weather_humidity_percent_icon` | Numeric value with percentage symbol. |
| UV index and level | `weather_uv_rect`, `weather_uv_level_icon`, `weather_uv_level_pos` | Numeric UV and categorical level icon. |
| Air quality and level | `weather_aqi_rect`, `weather_aqi_level_icon`, `weather_aqi_level_pos` | Numeric AQI and categorical level icon. |
| Weekly training load | `week_tl_rect`, `week_tl_font`, `week_tl_level_icon` | `WFExtendedStatusInfo.week_training_load`, with value and level. |
| Stamina | `stamina_rect`, `stamina_font`, `stamina_percent_icon`, `stamina_level_icon` | Value, percentage symbol, and level. Do not relabel it recovery/readiness without further evidence. |
| Stress | `stress_rect`, `stress_font`, `stress_level_icon` | Value and categorical level. |
| Sleep HRV level | `sleep_hrv_level_icon`, `sleep_hrv_level_pos` | A `WFPositionIcon` and runtime integer level. **No numeric HRV-in-ms field was established.** |
| Sleep score | `sleep_score_rect`, `sleep_score_font`, `sleep_score_level_*_icon` | Numeric score and localized qualitative labels. |
| Fixed barometer value | `baro_rect`, `baro_font`, `baro_icon` | `WFExtendedStatusInfo.barometer`, separate from older selectable barometer handling. |
| Today's activity totals | `today_run_*`, `today_swim_*`, `today_bike_*`, `today_elev_*` | Each has a value, icon, font, rectangle, and unit asset. Exact units and aggregation need runtime confirmation. |
| Weekly activity totals | `week_run_*`, `week_swim_*`, `week_bike_*`, `week_elev_*` | Same metric/unit structure as today's totals. |
| Sunrise/sunset progress | `sunriseset_hour_rect`, `sunriseset_minute_rect`, `sunriseset_progress_pos`, `sunrise_progress`, `sunset_progress` | Dedicated rise/set time and progress assets. |
| Charts and astronomy | `chart_tide`, `chart_baro`, `chart_sunrise`, `chart_sun_angle`, `chart_moonrise`, `chart_moon_percent`, `chart_stress`, `chart_stamina`, `chart_elevation`, `chart_kcal`, `chart_step` | New `WFChartInfo`, including bar/curve styling, masks, marker and symbol assets. Its schema also has a heart-rate member, but a dedicated heart-rate configuration key was not established in this pass. |
| Fishing display | `fish_time_mask`, `fish_arc_center_pos`, `fish_radius`, `fish_recommend_color`, `chart_fish_*` | New fishing arc/pointer and start/end-time structures. |
| Other status/date additions | `sedentary_icon_dir`, `sleep_mode_icon`, `airplane_icon`, `battery_level_percent_icon`, `control_number_date_year_rect`, `lunar_date_rect` | Status icons, year display, and lunar date placement. |

## The `_icon_pos` gate on icon+value blocks

`WFTemplateParser::LoadConfig` reads each inline `WFIconValue` block only when
its `*_icon_pos` key is present. With `stamina_icon_pos` absent, `0x1e7e38`
branches straight to `stamina_percent_icon` (`0x1e8318`), never reading
`stamina_rect`/`stamina_font`; `weather_uv_icon_pos` (`0x1e42a8` → `0x1e470c`)
behaves the same, as do wind, rainfall, humidity, AQI, `week_tl`, stress,
`baro`, `today_*`/`week_*` totals and `sunriseset` (`0x1ec700` skips the
hour/minute rectangles). A missing `*_icon` key on its own is harmless: the
parser skips `GetIcon` and continues to the rectangle. `sleep_score` and the
chart helpers look each key up independently. The level icons
(`*_level_pos`) are separate gates. RUBY HORIZON demonstrated it on the watch:
its stamina and UV have no icons, so Studio's hidden icon component dropped
`_icon_pos` and the values vanished while the stamina level artwork survived.
Studio now writes the position key whenever the value is enabled.

## Format/version implications

The recovered `WF_VERSION` enum contains:

| Value | Compiler name |
|---|---|
| 0 | `WF_VERSION_0` |
| 1 | `WF_VERSION_LUNAR` |
| 2 | `WF_VERSION_FISH` |
| 3 | `WF_VERSION_EXT_STATUS` |
| 4 | `WF_VERSION_EXT_DATE` |
| 5 | `WF_VERSION_SUN_PROGRESS` |
| 6 | `WF_VERSION_SLEEP_SCORE` |

Values 2–6 are absent from the saved baseline descriptor. `WFHead` includes `o_wf_ver`; the parser contains version-promotion code. These enum names are strong evidence for feature-specific format handling, but do not by themselves establish every required `info.json` version or which watches support a feature. Avoid assigning one blanket version to all new fields. SIMPLE's source manifest version 0 does not prove all these additions work on every version-0 device.

## Implications for CorosLink at inspection time

The recovered `WF_CONTROL` enum is unchanged (the same ten existing control-item enum members). These additions primarily occupy native `weather`, `extended_status`, `fish`, and `chart` blocks, so they should not be implemented by inventing selectable-complication IDs.

CorosLink's current weather implementation covers the core SIMPLE icon and temperature fields. The additional weather values, extended health/training metrics, activity totals, and chart/fishing sections are not exposed as dedicated editor controls in the inspected source. A generic raw-config editor is not equivalent to complete support: new fields need native export handling, default assets, preview values, editing controls, persistence, and device compatibility checks.

A practical next implementation group is min/max temperature, rain probability, humidity, UV and AQI; their number/icon structures closely resemble the working SIMPLE weather path. Sleep score, stress, training load and stamina are a second group with explicit level-asset and version requirements. Treat HRV as a level icon until a numeric source is demonstrated.

No app behavior was changed during the inspection itself. Subsequent editor/export support is described in [Native watchface data](../watchface-native-data.md), including the remaining device-testing boundary.
