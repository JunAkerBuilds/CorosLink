import { useState } from "react";
import { readCartoApiKey, saveCartoApiKey } from "../maps/cartoApiKey";
import "./mapSettings.css";

export function MapSettings() {
  const [key, setKey] = useState(readCartoApiKey);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  function save(value: string) {
    setMessage("");
    setError("");
    try {
      saveCartoApiKey(value);
      setKey(value.trim());
      setMessage(value.trim() ? "Key saved. CARTO maps have refreshed." : "Key removed. CARTO maps have refreshed.");
    } catch {
      setError("Could not save map settings on this device. Please try again.");
    }
  }

  return (
    <section className="panel settings-map-panel" aria-labelledby="settings-map-title">
      <div>
        <p className="eyebrow">Maps</p>
        <h2 id="settings-map-title">CARTO basemaps</h2>
        <p>Add your personal basemap key for the Light and Dark maps, including the Overview training map. A valid key removes CARTO’s API-key watermark.</p>
        <a href="https://www.carto.com/basemaps/apikey/" target="_blank" rel="noreferrer">Get a CARTO basemap key</a>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); save(key); }}>
        <label className="field">CARTO basemap API key
          <input type="password" autoComplete="off" spellCheck={false} value={key}
            aria-describedby="settings-map-key-help"
            onChange={(event) => { setKey(event.target.value); setMessage(""); setError(""); }} />
        </label>
        <p id="settings-map-key-help">Stored locally on this device and sent only with CARTO map tile requests. Use a basemap key, not a CARTO account token.</p>
        <div className="settings-map-actions">
          <button type="submit" className="primary-button" disabled={!key.trim()}>Save key</button>
          <button type="button" className="secondary-button" onClick={() => save("")}>Remove key</button>
        </div>
      </form>
      {message ? <p role="status">{message}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
