import { sizePresets } from "./widgetSizing.ts";
export const widgetCatalog = [
  { id: 'recovery', title: 'Recovery', description: 'Your recovery and readiness for training.', sizes: [3, 6], size: 3 },
  { id: 'fitness', title: 'Fitness trend', description: 'Your training load and fitness over time.', sizes: [6, 12], size: 6 },
  { id: 'sleep', title: 'Sleep', description: 'Sleep duration, stages and quality.', sizes: [6, 12], size: 6 },
  { id: 'vo2', title: 'VO₂ max', description: 'Aerobic fitness and recent progress.', sizes: [3, 6], size: 6 },
  { id: 'daily-load', title: 'Daily training load', description: 'Today’s training load.', sizes: [3, 6], size: 3 },
  { id: 'daily-heart', title: 'Resting heart rate', description: 'Your resting heart rate.', sizes: [3, 6], size: 3 },
  { id: 'daily-steps', title: 'Steps', description: 'Your daily step count.', sizes: [3, 6], size: 3 },
  { id: 'daily-calories', title: 'Calories', description: 'Your daily calorie total.', sizes: [3, 6], size: 3 },
  { id: 'heatmap', title: 'Training calendar', description: 'Daily training consistency and load.', sizes: [12], size: 12 },
  { id: 'stress', title: 'Stress', description: 'Stress throughout your day.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'sleepHrv', title: 'Sleep HRV', description: 'Your overnight heart rate variability.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'healthCheck', title: 'Health check', description: 'Measurements recorded on your watch.', sizes: [4, 6, 8, 12], size: 6 },
  { id: 'cycle', title: 'Menstrual cycle', description: 'Optional cycle information from COROS.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'trend-load', title: 'Training load trend', description: 'Your training load over time.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'trend-rpe', title: 'Perceived load trend', description: 'Your perceived effort load over time.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'trend-hrv', title: 'HRV trend', description: 'Overnight variability against your baseline.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'trend-sleep', title: 'Sleep duration', description: 'Your seven-day sleep duration comparison.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'coach', title: 'Coach charts', description: 'Charts pinned from your coach conversations.', sizes: [3, 4, 6, 8, 12], size: 12 },
  { id: 'zones-heart', title: 'Heart rate zones', description: 'Threshold heart rate zone distribution.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'zones-distance', title: 'Distance zones', description: 'Distribution of your running distances.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'scores', title: 'Fitness scores', description: 'Your current performance profile.', sizes: [3, 4, 6, 8, 12], size: 3 },
  { id: 'load-balance', title: 'Fitness and fatigue', description: 'Base Fitness, Load Impact and fatigue from your watch.', sizes: [3, 4, 6], size: 4 },
  { id: 'race', title: 'Race predictions', description: 'Estimated finish times across distances.', sizes: [3, 4, 6, 8, 12], size: 3 },
  { id: 'effort', title: 'Perceived effort', description: 'How demanding your training feels.', sizes: [3, 4, 6, 8, 12], size: 3 },
  { id: 'upcoming', title: 'Upcoming workouts', description: 'Your next scheduled training sessions.', sizes: [3, 4, 6, 8, 12], size: 12 }
] as const;
export type WidgetId = typeof widgetCatalog[number]['id'];
export type DashboardWidget = { id: WidgetId; size: number; preset: string; title: string; days: number; metrics: ('load' | 'heart' | 'steps' | 'calories')[]; startRow?: boolean; atBottom?: boolean };
export const dashboardStorageKey = 'coroslink.training-dashboard.v1';
export function defaultWidget(id: WidgetId): DashboardWidget {
  const definition = widgetCatalog.find(widget => widget.id === id)!;
  return { id, size: definition.size, preset: `${definition.size}-standard`, title: '', days: 0, metrics: ['load', 'heart', 'steps', 'calories'] };
}
/**
 * Adds a widget to the saved dashboard when it is not there yet, so a feature
 * that produces content for it (pinning a coach chart) is visible without a
 * trip through Edit dashboard. A saved Local-Only layout gets it too.
 * Returns true when a layout changed.
 */
export function ensureDashboardWidget(id: WidgetId, storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage): boolean {
  const savedRaw = storage.getItem(dashboardStorageKey);
  const localRaw = storage.getItem(localDashboardStorageKey);
  const layouts: [string, DashboardWidget[]][] = [[dashboardStorageKey, parseLayout(savedRaw)]];
  if (localRaw !== null) layouts.push([localDashboardStorageKey, parseLocalLayout(localRaw, savedRaw)]);
  let changed = false;
  for (const [key, layout] of layouts) {
    if (layout.some(widget => widget.id === id)) continue;
    storage.setItem(key, JSON.stringify({ version: 3, widgets: [...layout, { ...defaultWidget(id), startRow: true }] }));
    changed = true;
  }
  return changed;
}
const defaultPlacements: { id: WidgetId; preset: string; startRow?: boolean }[] = [
  { id: 'recovery', preset: '3-standard' },
  { id: 'fitness', preset: '6-standard' },
  { id: 'vo2', preset: '3-standard' },
  { id: 'daily-load', preset: 'compact-square' },
  { id: 'daily-heart', preset: 'compact-square' },
  { id: 'sleep', preset: '6-standard' },
  { id: 'healthCheck', preset: '3-mini' },
  { id: 'daily-steps', preset: 'compact-square' },
  { id: 'daily-calories', preset: 'compact-square' },
  { id: 'heatmap', preset: '12-standard', startRow: true },
  { id: 'stress', preset: '6-standard', startRow: true },
  { id: 'sleepHrv', preset: '6-standard' },
  { id: 'trend-load', preset: '3-short' },
  { id: 'trend-rpe', preset: '3-short' },
  { id: 'trend-hrv', preset: '3-short' },
  { id: 'trend-sleep', preset: '3-short' },
  { id: 'zones-heart', preset: '6-standard' },
  { id: 'zones-distance', preset: '6-standard' },
  { id: 'scores', preset: '3-standard' },
  { id: 'race', preset: '3-standard' },
  { id: 'effort', preset: '3-standard' },
  { id: 'upcoming', preset: '3-short' }
];
export function defaultLayout(): DashboardWidget[] {
  return placeWidgets(defaultPlacements);
}
/**
 * Widgets whose values only COROS calculates or stores (resting HR, scores,
 * race predictions, threshold zones, perceived effort, scheduled workouts,
 * cycle). The watch's sync files don't carry them, so Local-Only Mode leaves
 * them out of its dashboard; they stay in the widget library and show COROS
 * account data when there is some. VO₂ max and recovery aren't: the watch
 * stores its own VO₂ max and recovery time with each activity.
 */
const corosOnlyWidgets: readonly WidgetId[] = ['daily-heart', 'scores', 'race', 'effort', 'trend-rpe', 'zones-heart', 'upcoming', 'cycle'];
export function isCorosOnlyWidget(id: WidgetId): boolean {
  return corosOnlyWidgets.includes(id);
}
/** Local-Only Mode keeps its own layout, so switching modes never rewrites the saved one. */
export const localDashboardStorageKey = `${dashboardStorageKey}.local`;
const localDefaultPlacements: { id: WidgetId; preset: string; startRow?: boolean }[] = [
  { id: 'sleep', preset: '6-standard' },
  { id: 'healthCheck', preset: '3-mini' },
  { id: 'daily-load', preset: '3-standard' },
  { id: 'daily-steps', preset: 'compact-square' },
  { id: 'daily-calories', preset: 'compact-square' },
  { id: 'fitness', preset: '6-standard', startRow: true },
  { id: 'vo2', preset: '3-standard' },
  { id: 'recovery', preset: '3-standard' },
  { id: 'load-balance', preset: '4-standard', startRow: true },
  { id: 'trend-load', preset: '8-short' },
  { id: 'heatmap', preset: '12-standard', startRow: true },
  { id: 'stress', preset: '6-standard', startRow: true },
  { id: 'sleepHrv', preset: '6-standard' },
  // The HRV trend is left out: the Sleep HRV card shows the same nights, and there is no baseline locally.
  { id: 'trend-sleep', preset: '6-short', startRow: true },
  { id: 'zones-distance', preset: '6-short' }
];
function placeWidgets(placements: typeof defaultPlacements): DashboardWidget[] {
  return placements.map(placement => ({
    ...defaultWidget(placement.id),
    ...placement,
    size: widgetPresets(placement.id).find(preset => preset.id === placement.preset)!.columns
  }));
}
/** What Local-Only Mode starts with: the cards the watch's data fills, daily snapshot first. */
export function localDefaultLayout(): DashboardWidget[] {
  return placeWidgets(localDefaultPlacements);
}
/**
 * The Local-Only layout. Until one is saved, it starts from the saved layout
 * without the COROS-only widgets; an unchanged default starts from the
 * Local-Only default instead, keeping anything added to it (a pinned chart).
 */
export function parseLocalLayout(localRaw: string | null, savedRaw: string | null): DashboardWidget[] {
  if (localRaw !== null) return parseLayout(localRaw, localDefaultLayout);
  if (savedRaw === null) return localDefaultLayout();
  const kept = parseLayout(savedRaw).filter(widget => !isCorosOnlyWidget(widget.id));
  const standard = defaultLayout().filter(widget => !isCorosOnlyWidget(widget.id));
  const unchanged = standard.every((widget, index) => JSON.stringify(widget) === JSON.stringify(kept[index]));
  if (unchanged) {
    const local = localDefaultLayout();
    return [...local, ...kept.slice(standard.length).filter(widget => !local.some(item => item.id === widget.id))];
  }
  return kept.length ? kept : localDefaultLayout();
}
export function parseLayout(raw: string | null, fallback: () => DashboardWidget[] = defaultLayout): DashboardWidget[] {
  if (!raw) return fallback();
  try {
    const value = JSON.parse(raw);
    if (![1, 2, 3].includes(value.version) || !Array.isArray(value.widgets)) return fallback();
    if (value.version === 1) {
      value.widgets = value.widgets.flatMap((item: Record<string, unknown> | null) => {
        if (!item || typeof item !== 'object') return [];
        const groups: Record<string, string[]> = {
          health: ['stress', 'sleepHrv', 'healthCheck', 'cycle'],
          trends: ['trend-load', 'trend-rpe', 'trend-hrv', 'trend-sleep'],
          zones: ['zones-heart', 'zones-distance']
        };
        if (item.id === 'recovery') {
          const metrics = Array.isArray(item.metrics) ? item.metrics : ['load', 'heart', 'steps', 'calories'];
          return [item, ...['load', 'heart', 'steps', 'calories'].filter(metric => metrics.includes(metric)).map(metric => ({ id: `daily-${metric}` }))];
        }
        const children = groups[String(item.id)];
        return children ? children.map((id, index) => ({ id, days: item.days, title: index === 0 ? item.title : '' })) : [item];
      });
    }
    const seen = new Set<string>();
    return value.widgets.flatMap((item: Partial<DashboardWidget> | null) => {
      const definition = widgetCatalog.find(widget => widget.id === item?.id);
      if (!definition || !item || seen.has(definition.id)) return [];
      seen.add(definition.id);
      const base = defaultWidget(definition.id);
      const presets = widgetPresets(definition.id);
      const requestedWidth = typeof item.size === 'number' && Number.isFinite(item.size) && item.size > 0 ? item.size : base.size;
      const closestWidth = definition.sizes.reduce<number>((best, width) => Math.abs(width - requestedWidth) < Math.abs(best - requestedWidth) ? width : best, base.size);
      const preset = presets.find(preset => preset.id === item.preset) ?? presets.find(preset => preset.columns === closestWidth)!;
      return [{ ...base,
        size: preset.columns,
        preset: preset.id,
        ...(item.startRow === true ? { startRow: true } : {}),
        ...(item.atBottom === true ? { atBottom: true } : {}),
        title: typeof item.title === 'string' ? item.title.slice(0, 60) : '',
        days: [0, 7, 30, 90].includes(item.days!) ? item.days! : 0,
        metrics: Array.isArray(item.metrics) ? base.metrics.filter(metric => item.metrics!.includes(metric)) : base.metrics
      }];
    });
  } catch { return fallback(); }
}
export function moveWidget(layout: DashboardWidget[], id: WidgetId, target: number, startRow = false, atBottom = false): DashboardWidget[] {
  const from = layout.findIndex(widget => widget.id === id);
  if (from < 0 || target < 0 || target >= layout.length || (from === target && Boolean(layout[from].startRow) === startRow && Boolean(layout[from].atBottom) === atBottom)) return layout;
  const next = [...layout];
  const { startRow: _previousRow, atBottom: _previousBottom, ...moved } = next.splice(from, 1)[0];
  next.splice(target, 0, { ...moved, ...(startRow ? { startRow: true } : {}), ...(atBottom ? { atBottom: true } : {}) });
  return next;
}

export function widgetPresets(id: WidgetId) {
  return sizePresets(id, widgetCatalog.find(widget => widget.id === id)!.sizes);
}
export function widgetPreset(widget: DashboardWidget) {
  return widgetPresets(widget.id).find(preset => preset.id === widget.preset)!;
}
