import type { CorosWifiMapTile } from "./corosWifiMapTypes";
export const COROS_MAP_GRID_ZOOM = 7;
const CELLS = 1 << COROS_MAP_GRID_ZOOM;
export function corosMapQuadkey(tile: CorosWifiMapTile): string {
  let result = "";
  for (let bit = COROS_MAP_GRID_ZOOM - 1; bit >= 0; bit--) result += ((tile.x >> bit) & 1) + 2 * ((tile.y >> bit) & 1);
  return result;
}
export function corosMapTileAt(lat: number, lon: number): CorosWifiMapTile {
  const latitude = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  const x = Math.floor((lon + 180) / 360 * CELLS);
  const y = Math.floor((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * CELLS);
  return { x: Math.max(0, Math.min(CELLS - 1, x)), y: Math.max(0, Math.min(CELLS - 1, y)) };
}
export function corosMapTileBounds(tile: CorosWifiMapTile) {
  const latitude = (y: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / CELLS))) * 180 / Math.PI;
  return { west: tile.x / CELLS * 360 - 180, east: (tile.x + 1) / CELLS * 360 - 180,
    north: latitude(tile.y), south: latitude(tile.y + 1) };
}
