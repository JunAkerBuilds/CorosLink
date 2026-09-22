import L from "leaflet";
import { isCartoTileUrl, readCartoApiKey, subscribeCartoApiKey, withCartoApiKey } from "./cartoApiKey";

/** Refresh mounted CARTO tiles on save/removal without resetting the map view. */
export function baseTileLayer(url: string, options: L.TileLayerOptions): L.TileLayer {
  const layer = L.tileLayer(withCartoApiKey(url, readCartoApiKey()), options);
  if (!isCartoTileUrl(url)) return layer;
  let unsubscribe: (() => void) | undefined;
  layer.on("add", () => {
    unsubscribe?.();
    const refresh = () => layer.setUrl(withCartoApiKey(url, readCartoApiKey()));
    refresh();
    unsubscribe = subscribeCartoApiKey(refresh);
  });
  layer.on("remove", () => {
    unsubscribe?.();
    unsubscribe = undefined;
  });
  return layer;
}
