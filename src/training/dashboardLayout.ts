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
  { id: 'coach', title: 'Coach charts', description: 'Charts pinned from your coach conversations.', sizes: [12], size: 12 },
  { id: 'zones-heart', title: 'Heart rate zones', description: 'Threshold heart rate zone distribution.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'zones-distance', title: 'Distance zones', description: 'Distribution of your running distances.', sizes: [3, 4, 6, 8, 12], size: 6 },
  { id: 'scores', title: 'Fitness scores', description: 'Your current performance profile.', sizes: [3, 4, 6, 8, 12], size: 3 },
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
  return defaultPlacements.map(placement => ({
    ...defaultWidget(placement.id),
    ...placement,
    size: widgetPresets(placement.id).find(preset => preset.id === placement.preset)!.columns
  }));
}
export function parseLayout(raw: string | null): DashboardWidget[] {
  if (!raw) return defaultLayout();
  try {
    const value = JSON.parse(raw);
    if (![1, 2, 3].includes(value.version) || !Array.isArray(value.widgets)) return defaultLayout();
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
  } catch { return defaultLayout(); }
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
