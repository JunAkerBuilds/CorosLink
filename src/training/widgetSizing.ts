export type ChartCardSize = "mini" | "short" | "standard" | "tall";

/** Shared dashboard height tiers; compact charts align with health and gauge cards. */
export const chartCardHeights = { mini: 224, short: 320, standard: 448, tall: 592 } as const;

// Below this width, quarter-width panels cannot comfortably fit their readings and controls.
export const dashboardDesktopWidth = 1150;

export interface WidgetSizePreset {
  chartSize?: ChartCardSize;
  id: string;
  label: string;
  columns: number;
  minHeight: number;
  expanded: boolean;
  aspectRatio?: number;
  /** Compact metrics keep the standard card height by reducing their width. */
  contentWidth?: number;
  /** Standard metric widths share the compact square's responsive height. */
  matchCompactHeight?: boolean;
}

/** Heights are minimums: loading, long labels and accessibility text never get clipped. */
export function sizePresets(id: string, widths: readonly number[]): WidgetSizePreset[] {
  if (['stress', 'sleepHrv', 'trend-load', 'trend-rpe', 'trend-hrv', 'trend-sleep', 'zones-heart', 'zones-distance', 'scores', 'race', 'effort', 'upcoming', 'cycle'].includes(id)) {
    return widths.flatMap(columns => (['standard', 'tall', 'mini', 'short'] as const).map(chartSize => ({
      id: `${columns}-${chartSize}`,
      label: `${columns === 3 ? 'Small' : columns === 4 ? 'Compact' : columns === 6 ? 'Medium' : columns === 8 ? 'Wide' : 'Full width'} · ${chartSize}`,
      columns, minHeight: chartCardHeights[chartSize], expanded: chartSize === 'tall', chartSize
    })));
  }
  const daily = id.startsWith('daily-');
  const gauge = id === 'recovery' || id === 'vo2';
  const health = ['stress', 'sleepHrv', 'healthCheck', 'cycle'].includes(id);
  const baseHeight = daily ? 152 : gauge ? 320 : health ? 448 : id.startsWith('zones-') ? 416 : 336;
  const extraHeight = daily ? 96 : 144;
  const compact: WidgetSizePreset[] = daily ? [{ id: 'compact-square', label: 'Compact square', columns: 1, minHeight: baseHeight, expanded: true, aspectRatio: 1, contentWidth: baseHeight }] : id === 'healthCheck' ? [{ id: '3-mini', label: 'Small · mini', columns: 3, minHeight: 224, expanded: false }] : [];
  return [...compact, ...widths.flatMap(columns => {
    const widthLabel = columns <= 3 ? 'Small' : columns === 4 ? 'Compact' : columns === 6 ? 'Medium' : columns === 8 ? 'Wide' : 'Full width';
    return [
      { id: `${columns}-standard`, label: widthLabel, columns, minHeight: baseHeight, expanded: false, ...(daily ? { matchCompactHeight: true } : {}) },
      { id: `${columns}-tall`, label: `${widthLabel} · tall`, columns, minHeight: baseHeight + extraHeight, expanded: true, ...(daily ? { matchCompactHeight: true } : {}) },
      ...(id === 'healthCheck' ? [
        { id: `${columns}-mini`, label: `${widthLabel} · mini`, columns, minHeight: 224, expanded: false },
        { id: `${columns}-short`, label: `${widthLabel} · short`, columns, minHeight: 320, expanded: false },
        { id: `${columns}-square`, label: `${widthLabel} · square`, columns, minHeight: 320, expanded: false, aspectRatio: 1 },
        { id: `${columns}-portrait`, label: `${widthLabel} · portrait`, columns, minHeight: 320, expanded: true, aspectRatio: 3 / 4 }
      ] : []),
      ...(daily ? [{ id: `${columns}-square`, label: `${widthLabel} · square`, columns, minHeight: baseHeight, expanded: true, aspectRatio: 1 }] : [])
    ];
  })];
}

/** Compact squares share the dashboard grid: two fit exactly across a small card. */
export function sizePresetWidth(preset: WidgetSizePreset, gridWidth: number, chromeWidth = 0): number {
  const unit = (gridWidth + 16) / 12;
  if (preset.contentWidth) {
    if (gridWidth <= 850) return Math.min(gridWidth, preset.contentWidth + chromeWidth);
    if (gridWidth <= dashboardDesktopWidth) return 3 * unit - 16;
    const half = 1.5 * unit - 16;
    return half >= 128 ? half : 3 * unit - 16;
  }
  if (gridWidth <= 850) return gridWidth;
  const columns = gridWidth <= dashboardDesktopWidth
    ? (preset.columns <= 6 ? 6 : 12)
    : preset.columns;
  return columns * unit - 16;
}

/** Compare real preview dimensions, with a small dead band to avoid flickering near a snap edge. */
export function nearestSizePreset(
  choices: { preset: WidgetSizePreset; width: number; height: number }[],
  width: number,
  height: number,
  currentId: string
): WidgetSizePreset {
  const distance = (choice: typeof choices[number]) => Math.hypot(choice.width - width, choice.height - height);
  const nearest = choices.reduce((best, choice) => distance(choice) < distance(best) ? choice : best);
  const current = choices.find(choice => choice.preset.id === currentId);
  return current && distance(current) <= distance(nearest) + 16 ? current.preset : nearest.preset;
}

/** Square presets track the actual card width, including after a window resize. */
export function sizePresetHeight(preset: WidgetSizePreset, contentWidth: number, gridWidth?: number): number {
  if (preset.matchCompactHeight && gridWidth !== undefined) {
    const compactWidth = sizePresetWidth({ ...preset, contentWidth: 152 }, gridWidth);
    return compactWidth + preset.minHeight - 152;
  }
  return preset.aspectRatio ? (preset.contentWidth ? contentWidth : Math.max(preset.minHeight, contentWidth / preset.aspectRatio)) : preset.minHeight;
}
