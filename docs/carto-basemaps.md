# Personal CARTO basemap keys

In Settings, open **CARTO basemaps**, paste a personal basemap API key, and select
**Save key**. Request a key at https://www.carto.com/basemaps/apikey/.
CARTO documents the `key` query parameter for raster tile requests.

The key is saved in local storage on this device. The password field masks it;
local storage is not encrypted. Use a basemap key, not a CARTO account token.
The key is attached only to HTTPS CARTO basemap tile URLs. Light and Dark layers
in Overview, route planning, and activity maps refresh when the key is saved or
removed, preserving the map view. Other providers and overlays do not receive it.
CARTO and OpenStreetMap attribution remains visible.

**Remove key** clears the saved value and refreshes mounted CARTO layers without
the key. Without a valid key, CARTO may display its API-key watermark. Saving a
key does not validate it with CARTO; a rejected or restricted key must be managed
through CARTO. Street, Outdoors, Topo, and Satellite remain available separately.

Run `npm run test:carto-settings` for the Electron UI and Leaflet integration
checks. It uses an isolated profile and fake keys, blocking external tile traffic.
A real-key end-to-end watermark check requires a user-provided valid key.
