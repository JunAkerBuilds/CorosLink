# Customizable Training Hub

Choose **Edit dashboard** in the Overview tab to arrange the dashboard. Drag a widget by its handle or use its move buttons, drag its bottom-right corner to preview a supported width and height, or open its settings to choose a size or label, and remove it with the trash button. **Add widget** opens a searchable library. Each widget can appear once. A highlighted destination shows where a dragged card will land, including when dropping into gaps. Use a card’s upper or lower edge to insert before or below it, or its side to insert beside it. Holding a drag near the top or bottom of the scroll area scrolls the dashboard. The drop area beneath the last card moves a widget to the bottom. Ordinary row starts stack in the left column without reserving space under taller neighbors. Only the explicit bottom drop clears every column; dragging the widget beside another card releases that bottom placement. Existing saved row starts follow the same local stacking rule. **Done** hides the editing controls.

Recovery, daily load, resting heart rate, steps, calories, stress, sleep HRV, health check, menstrual cycle, individual trend charts and each zone distribution have their own widgets. Menstrual cycle is opt-in for new and reset layouts; removing it keeps the other health cards. Load, perceived load and HRV trends each offer a date window; the sleep comparison remains a seven-day view. Existing widget controls continue to work, including weekly activity metrics and training calendar filters. Widths are constrained to keep each chart usable, and widgets stack on narrow windows. Cards pack upward independently, filling available space beneath shorter cards even when a neighboring card is taller. Packing recalculates as content loads, settings expand, or widths change.

Corner resizing works with mouse and touch. Daily metric cards offer **Compact square**, a small square card reached by dragging the corner inward horizontally. On desktop, two compact squares plus their gap align exactly with a small dashboard card. In narrower desktop windows each square occupies one small-card column to stay readable; on mobile it uses 152 × 152 px. Recovery and Weekly activity share a bottom edge when using matching height presets. The compact square retains the regular icon, label, value and unit, omits the chart, and still opens recent readings when clicked. Larger square presets remain available. Compact cards pack beside each other with the same 16 px spacing as other widgets. Sizes snap to quarter-, half- and full-width presets where each widget supports them, with larger chart areas and a stacked metric layout in tall cards. Preview changes only save on release; Escape, pointer cancellation, loss of focus or a window resize cancel the gesture. Focus a corner handle and use Left/Right for width or Up/Down for height. Each completed resize creates one undo step. Narrow windows keep the saved desktop width; metrics can still switch between compact squares and stacked cards.

Changes save locally on this device, including an empty dashboard. Sample mode uses a separate layout. Undo retains the last 30 changes during the current visit; reset restores the initial widget selection, order, widths and settings and can itself be undone. Removing a widget does not delete training data or pinned coach charts.

Version 3 adds size presets and migrates older widths to the closest supported shape. The earlier version 2 migration automatically expands previously saved recovery, health, trends and zone groups into individual widgets, preserving removed groups and selected daily metrics. Existing health groups retain their cycle card until the user removes it.

The versioned layout is stored under `coroslink.training-dashboard.v1` in localStorage, with `.sample` appended for preview data. Unknown widgets, duplicate entries and unsupported widths are sanitized when loading. Malformed storage falls back to the default layout. Storage write failures are shown in the toolbar.

Validation:

- `node --experimental-strip-types scripts/test-dashboard-layout.mjs`
- `node --experimental-strip-types scripts/test-dashboard-packing.mjs`
- `node --experimental-strip-types scripts/test-dashboard-drag.mjs`
- `npx electron scripts/test-training-dashboard-ui.cjs`
- `node --experimental-strip-types scripts/test-widget-sizing.mjs`
- `npx electron scripts/test-widget-resize-ui.cjs`
- `npm run build:renderer`

## Chart sizes

Stress, Sleep HRV, Training Load, RPE Load, HRV vs Baseline, and Sleep Duration share five widths (3, 4, 6, 8, or 12 columns) and four height tiers: mini 224 px, short 320 px, standard 448 px, and tall 592 px. Drag the corner, or focus it and use Left/Right for width and Up/Down for height. Existing standard/tall preset IDs remain valid.

`TrainingTrendCharts` and `HealthInsightsPanel` expose an optional `size="mini" | "short" | "standard" | "tall"` prop for reuse outside the dashboard. Omitting it retains their existing standalone layout. Compact charts reduce spacing and adapt their axes; Stress and Sleep HRV keep their period and series controls and move secondary statistics and notes into an accessible details disclosure. Chart areas fill spare height. Empty charts use the same minimum heights, while expanded details and larger accessibility text can grow naturally and trigger dashboard repacking.

Chart sizing validation: `npx electron scripts/test-chart-sizing-ui.cjs`.

Zone distributions, Fitness Scores, Race Predictor, and Perceived Effort also support the same five widths and four height tiers. Their layouts respond to the card width instead of the application window. Mini zone cards retain the donut and main result with an expandable full breakdown; mini Fitness Scores exposes threshold measurements in a disclosure. Empty RPE content is centered across the full card. Validate with `npx electron scripts/test-profile-sizing-ui.cjs`.
