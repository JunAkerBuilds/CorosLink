export interface WatchfaceLayerOpacitySource {
  layerOpacities?: Record<string, number>;
}

/** Keeps persisted and rendered layer alpha in the supported 0..1 range. */
export function normalizeWatchfaceLayerOpacity(
  value: number | undefined
): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 1;
}

/** Missing entries preserve the legacy fully-opaque rendering behavior. */
export function resolveWatchfaceLayerOpacity(
  source: WatchfaceLayerOpacitySource,
  layerId: string | undefined
): number {
  return layerId
    ? normalizeWatchfaceLayerOpacity(source.layerOpacities?.[layerId])
    : 1;
}

export function hasWatchfaceLayerOpacity(
  source: WatchfaceLayerOpacitySource,
  layerId: string
): boolean {
  return resolveWatchfaceLayerOpacity(source, layerId) < 1;
}
