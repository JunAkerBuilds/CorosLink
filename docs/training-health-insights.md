# Training Hub health insights

The Health & recovery section reads four capabilities from the connected COROS MCP catalog:

| Panel | Tool |
| --- | --- |
| Stress | `queryStressTimeSeries` |
| Sleep HRV | `querySleepHrv` |
| Health check | `queryHealthCheckTimeSeries` |
| Menstrual cycle | `queryMenstruationCycles` |

Each panel loads independently on mount, hub refresh, period change, or its own refresh button. Cycle data is requested only while its details are expanded. Sample mode uses local fixtures and makes no health-data requests. There is no persistent health-insight cache.

Queries support today and the last seven local calendar days. Arguments are built from advertised tool properties; unsupported required parameters produce an error rather than guessed requests. Background loads do not open OAuth. The user can reconnect using the panel's connection button. Missing tools, empty results, connection failures, and request errors have distinct states.

The live COROS server answers with an indented text report rather than JSON: section titles over `====` rules, `YYYY-MM-DD:` headers, `key=value, key=value` records (epoch-second `timestamp`, quarter-hour `timezone`), and `Label: value` summaries such as `HRV Avg: 83 ms — Normal`, `Normal Range: 75 - 105 ms`, `Baseline: 90 ms`, or `General: usual period 7 days, usual cycle 28 days`. `parseHealthTextReport` turns those into records for the structured walker; `Note:` lines and closing sentences stay as prose. Stress records carry a `score` of 1–4, shown with the COROS level names (Relaxed, Low, Medium, High); `stressHrv=0` / `stressHr=0` and other 0 ms / 0 bpm values mean "not measured" and are dropped. A prose-only answer that says no data was found becomes the `empty` state with the server's sentence as the message.

Structured values and dated series are normalized for display. Missing values are not converted to zero; undated values do not become chart points. COROS prose is retained as a report. Health-check HRV and overnight HRV remain separate, and no local health assessment is generated. Tool discovery follows all catalog pages so newly added capabilities remain accessible to the existing Coach tool pipeline too.

Health Check also returns separate metric lists such as `Heart Rate List: [1789948800=62 bpm]`, `HRV List`, `Stress List`, `Respiration Rate List` (values in `/min`), and `SpO2 List`. Each entry supplies its own timestamp. Stress level and resting heart rate are summary-only values. This populated response format was verified against a live response on 2026-09-21; regression tests use synthetic measurements.

Each card shows the latest value with COROS' own label as a badge, period average/low/high, summary-only values as chips (normal range, baseline), and an area chart that breaks across gaps longer than three hours (one overnight segment per night) with the normal range drawn as a band and the baseline as a dashed line.

Validation: `npm run test:health-insights` covers representative (synthetic) response shapes including the text report format, query windows, missing data, catalog pagination, and service failures. Live payloads for all four tools were checked against the parser on 2026-09-21 (health check and cycle returned "no data" notices for that account).
