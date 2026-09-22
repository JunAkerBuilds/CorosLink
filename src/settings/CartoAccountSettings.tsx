import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import { CARTO_SETTINGS_CHANGED } from "../maps/routes/useCartoApiKey";

export function CartoAccountSettings({ api }: { api: CorosLinkApi }) {
  const [key, setKey] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void api.getRouteBuilderConfig().then(config => {
      if (active) { setHasKey(Boolean(config.cartoApiKey)); setReady(true); }
    }).catch(() => { if (active) setError("Could not load CARTO settings. Reopen this page to try again."); });
    return () => { active = false; };
  }, [api]);
  async function save(remove = false) {
    setBusy(true); setError(""); setMessage("");
    try {
      const config = await api.getRouteBuilderConfig();
      if (config.cartoApiKey === undefined) {
        throw new Error("Restart CorosLink to finish updating API-key storage, then save your key again. Your key has not been saved.");
      }
      const requestedKey = remove ? "" : key.trim();
      await api.saveRouteBuilderConfig({ ...config, cartoApiKey: requestedKey });
      const saved = await api.getRouteBuilderConfig();
      setHasKey(Boolean(saved.cartoApiKey));
      if (saved.cartoApiKey !== requestedKey) {
        throw new Error(remove ? "The key could not be removed. Please try again." : "The key was not saved. Restart CorosLink and try again.");
      }
      setKey("");
      window.dispatchEvent(new Event(CARTO_SETTINGS_CHANGED));
      setMessage(remove ? "CARTO key removed. Maps will use OpenStreetMap." : "CARTO key saved. Light and Dark layers are now available in the expanded activity map.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save the CARTO key."); }
    finally { setBusy(false); }
  }
  return <div className="account-setup">
    <h2>CARTO Basemaps</h2>
    <p>Optional Light and Dark map styles. Standard OpenStreetMap works without an API key.</p>
    {error && <p role="alert">{error}</p>}
    {!ready && !error && <p role="status">Loading settings…</p>}
    {ready && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <div className={`account-key-state${hasKey ? " is-saved" : ""}`} role="status">
        {hasKey ? <CheckCircle2 size={22} aria-hidden="true" /> : <KeyRound size={22} aria-hidden="true" />}
        <div><strong>{hasKey ? "API key saved" : "No API key saved"}</strong>
          <span>{hasKey ? "Stored securely on this computer. CARTO map styles are enabled." : "Add a key to enable CARTO Light and Dark maps."}</span>
        </div>
        {hasKey && <span className="account-key-mask" aria-label="Saved key is hidden">••••••••</span>}
      </div>
      <label className="field">CARTO Basemaps API key
        <input name="cartoApiKey" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy}
          placeholder={hasKey ? "Paste a replacement key" : "Paste the key from your CARTO email"}
          onChange={event => { setKey(event.target.value); setMessage(""); }} />
      </label>
      <div className="account-api-actions">
        <button className="primary-button" type="submit" disabled={busy || !key.trim()}>{busy ? "Saving…" : hasKey ? (key.trim() ? "Replace saved key" : "Key saved") : "Save key"}</button>
        <button className="secondary-button" type="button" disabled={busy || !hasKey} onClick={() => void save(true)}>Remove key</button>
      </div>
      {message && <p className="account-key-confirmation" role="status"><CheckCircle2 size={16} aria-hidden="true" />{message}</p>}
    </form>}
    <h3>How to get your key</h3>
    <ol className="account-api-instructions">
      <li>Open <a href="https://carto.com/basemaps/apikey/" target="_blank" rel="noreferrer">CARTO’s API key request page</a>.</li>
      <li>Enter your email, who you are, and a short description of your project. CARTO emails the key to you; no existing CARTO account is needed.</li>
      <li>Copy the key from the email, paste it into the field above, and choose Save key.</li>
      <li>Open an expanded activity map and choose Light or Dark in the map-layer selector.</li>
    </ol>
    <p><a href="https://dashboard.basemaps.carto.com/signin" target="_blank" rel="noreferrer">Manage your CARTO keys</a> using the same email address. Sign-in is passwordless; you can change restrictions, rename, or revoke keys there.</p>
    <p>The key is encrypted on this computer and attached to CARTO tile requests. Use your own project’s key.</p>
    <h3>If the map still says “API key required”</h3>
    <p>Reopen the map or reload CorosLink to refresh cached tiles. Check your key and its restrictions in the CARTO dashboard if the watermark remains.</p>
    <p>CARTO currently includes 5 million tile requests per calendar month across your account’s raster and vector keys. Keep CARTO and OpenStreetMap attribution visible. See <a href="https://carto.com/legal/basemap-terms/" target="_blank" rel="noreferrer">CARTO’s terms</a> for usage and commercial conditions.</p>
  </div>;
}
