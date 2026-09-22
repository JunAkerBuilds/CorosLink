const STORAGE_KEY = "coroslink.cartoBasemapKey.v1";
const CHANGE_EVENT = "coroslink:carto-basemap-key";

export function readCartoApiKey(): string {
  try { return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? ""; }
  catch { return ""; }
}

export function saveCartoApiKey(value: string): void {
  const key = value.trim();
  // Let storage failures reach the settings UI instead of reporting a false save.
  if (key) window.localStorage.setItem(STORAGE_KEY, key);
  else window.localStorage.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeCartoApiKey(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) listener();
  };
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function isCartoTileUrl(url: string): boolean {
  return /^https:\/\/(?:\{s\}\.|[abcd]\.)?basemaps\.cartocdn\.com\//.test(url);
}

/** Preserve Leaflet placeholders and never send the key to another provider. */
export function withCartoApiKey(url: string, key: string): string {
  if (!isCartoTileUrl(url) || !key.trim()) return url;
  return `${url}${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(key.trim())}`;
}
