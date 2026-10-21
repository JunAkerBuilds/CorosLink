import { CloudSun, Loader2, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { getLocale, t, useLanguage } from "../i18n";
import type { CorosLinkApi } from "../coroslink-api";
import { ipcErrorText } from "../ipcErrorText";
import type { WeatherLocation, WeatherPlace } from "../../electron/watchWeatherService";
import { useWatchLink } from "./useWatchLink";
import "./settingsPanel.css";
import "./watchSystemSettings.css";

/**
 * Where the weather on the watch and the Overview is for: a place the user
 * picks, or the automatic location (system, else the internet connection's IP,
 * which a VPN moves).
 */
export function WeatherLocationSettings({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const [location, setLocation] = useState<WeatherLocation | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<WeatherPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Read again when the watch connects, as the other watch panels do: the Overview may have found the automatic location since.
  const { authenticatedAt } = useWatchLink(api);
  useEffect(() => { void api.getWeatherLocation().then(setLocation).catch(() => undefined); }, [api, authenticatedAt]);

  // Search as the user types, after a short pause.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setResults(null); return; }
    let live = true;
    const timer = setTimeout(() => {
      setSearching(true);
      api.searchWeatherPlaces(text, getLocale().slice(0, 2))
        .then(found => { if (live) { setResults(found); setError(null); } })
        .catch(caught => { if (live) setError(t(ipcErrorText(caught))); })
        .finally(() => { if (live) setSearching(false); });
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [api, query]);

  const choose = async (place: WeatherPlace | null) => {
    setError(null);
    try {
      setLocation(await api.chooseWeatherLocation(place && { latitude: place.latitude, longitude: place.longitude, place: place.name }));
      setQuery("");
      setResults(null);
    } catch (caught) {
      setError(t(ipcErrorText(caught)));
    }
  };

  const place = location ? location.place ?? `${location.latitude}, ${location.longitude}` : null;

  return (
    <div className="panel settings-units-panel settings-panel">
      <div className="settings-units-heading">
        <span className="settings-units-icon" aria-hidden="true"><CloudSun size={22} /></span>
        <div>
          <p className="eyebrow">{t("Weather")}</p>
          <h2>{t("Weather location")}</h2>
          <p>{t("Used for the weather on the Overview and on your watch.")}</p>
        </div>
      </div>
      <div className="weather-location-row">
        <div className="weather-location-current">
          <span>{location?.source === "chosen" ? t("Chosen place") : t("Automatic location")}</span>
          <div>
            <MapPin size={15} aria-hidden="true" />
            {place ? <strong>{place}</strong> : <strong className="is-unknown">{t("Not known yet. Open the Overview once, or choose a place.")}</strong>}
            {location?.source === "chosen" ? (
              <button type="button" className="secondary-button" onClick={() => void choose(null)}>{t("Use automatic location")}</button>
            ) : null}
          </div>
        </div>
        <div className="weather-location-search">
          <label className="settings-field">
            <span>{t("Choose a place")}</span>
            <input type="search" value={query} placeholder={t("City or town")} autoComplete="off" aria-controls="weather-place-results"
              onChange={event => setQuery(event.target.value)} />
          </label>
          {searching ? <p className="settings-hint" role="status"><Loader2 size={14} className="spin" aria-hidden="true" /> {t("Searching…")}</p> : null}
          {results && !searching ? (
            results.length ? (
              <ul className="weather-place-results" id="weather-place-results" aria-label={t("Places")}>
                {results.map(place => (
                  <li key={`${place.latitude},${place.longitude}`}>
                    <button type="button" onClick={() => void choose(place)}>
                      <MapPin size={13} aria-hidden="true" />
                      <span><strong>{place.name}</strong>{place.detail ? <small>{place.detail}</small> : null}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="settings-hint" role="status">{t("No places found.")}</p>
          ) : null}
          {error ? <p className="settings-error" role="alert">{error}</p> : null}
        </div>
      </div>
    </div>
  );
}
