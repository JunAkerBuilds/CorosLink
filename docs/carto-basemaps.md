# Personal CARTO basemap keys

Open **Settings → Accounts & API → Maps → CARTO Basemaps**. Request a personal
key at [CARTO's key request page](https://carto.com/basemaps/apikey/), complete the
form, and copy the key from the email. Paste it into the settings field and
select **Save key**. If CorosLink asks you to restart after an update, restart
and save again.

The app encrypts the key on this computer using Electron's operating-system
credential storage. The field stays blank after saving; a persistent green
**API key saved** indicator confirms storage. Success is shown only after the
key has been read back from storage. Never put personal keys in source code.

CARTO Light and Dark styles become available in the expanded activity map.
Overview and route-planning maps also use the saved key when requesting CARTO
styles. The key is appended only to CARTO raster tile URLs using the documented
`key` parameter. Other providers and overlays receive no key. CARTO and
OpenStreetMap attribution stays visible.

**Remove key** clears the credential. Maps fall back to OpenStreetMap without
requesting unauthenticated CARTO tiles. Saving does not validate the key with
CARTO. If a watermark remains, reopen the map or reload the app to refresh cached
tiles, and check the key's restrictions in the
[CARTO dashboard](https://dashboard.basemaps.carto.com/signin). Sign in with the
email used to request the key to manage restrictions or revoke it.

See [CARTO's terms](https://carto.com/legal/basemap-terms/) for usage limits and
commercial conditions. The settings page includes the setup steps and usage notes.

Run `npm run test:carto-settings` for encrypted storage, Accounts & API UI, and
activity-map integration checks. Tests use isolated profiles and fake keys;
CARTO requests with fake keys are blocked. Live watermark removal with a real
personal key is not covered by these tests.
