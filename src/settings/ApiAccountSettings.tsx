import { useEffect, useState } from "react";
import type { CorosLinkApi } from "../coroslink-api";

export type ApiAccount = "spotify" | "strength" | "intervals" | "openRouter" | "local";
const definitions = {
  spotify: { title: "Spotify", description: "Save your Spotify app credentials, then sign in to connect your playlists.", link: "https://developer.spotify.com/dashboard" },
  strength: { title: "Hevy", description: "Connect strength workouts with a Hevy Pro API key.", link: "https://hevy.com/settings?developer" },
  intervals: { title: "intervals.icu", description: "Connect your API key and athlete ID to import activities.", link: "https://intervals.icu/settings" },
  openRouter: { title: "OpenRouter", description: "Configure the API key and model used by Coach. Leave the key blank to keep the saved key.", link: "https://openrouter.ai/settings/keys" },
  local: { title: "Local / OpenAI-compatible API", description: "Connect Coach to Ollama, LM Studio, or another OpenAI-compatible endpoint. Leave the optional key blank to keep the saved key.", link: null },
} as const;

/** Uses the same credential stores as the feature screens; no secrets are saved in browser storage. */
export function ApiAccountSettings({ api, service }: { api: CorosLinkApi; service: ApiAccount }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const definition = definitions[service];
  useEffect(() => {
    let active = true;
    async function load() {
      let values: Record<string, string> = {};
      let linked = false, storedKey = false;
      if (service === "spotify") {
        const [config, status] = await Promise.all([api.getSpotifyConfig(), api.getSpotifyStatus()]);
        values = { ...config }; linked = status.authenticated;
      } else if (service === "strength") {
        linked = (await api.getHevyStatus()).connected;
      } else if (service === "intervals") {
        const status = await api.getIntervalsStatus();
        linked = status.connected; values.athleteId = status.athleteId ?? "";
      } else {
        const config = (await api.getChatSettings())[service];
        values.model = config.model;
        if ("baseUrl" in config) values.baseUrl = config.baseUrl;
        storedKey = config.hasApiKey;
      }
      if (active) { setDraft(values); setConnected(linked); setHasKey(storedKey); setReady(true); }
    }
    void load().catch(caught => { if (active) setError(caught instanceof Error ? caught.message : "Could not load settings."); });
    return () => { active = false; };
  }, [api, service]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update connection."); }
    finally { setBusy(false); }
  }
  async function aiConfig(clear = false) {
    // Merge against current settings so another provider's preferences are preserved.
    const current = await api.getChatSettings();
    if (service !== "local" && service !== "openRouter") throw new Error("Unknown AI provider.");
    return { ...current, [service]: { ...current[service],
      ...(!clear ? { model: draft.model?.trim(), ...(service === "local" ? { baseUrl: draft.baseUrl?.trim() } : {}) } : {}),
      apiKey: clear ? undefined : draft.apiKey?.trim() || undefined, clearApiKey: clear } };
  }
  async function save() {
    if (service === "spotify") {
      const status = await api.saveSpotifyConfig({ clientId: draft.clientId.trim(), clientSecret: draft.clientSecret.trim(), redirectUri: draft.redirectUri.trim() });
      setConnected(status.authenticated);
    } else if (service === "strength") {
      const status = await api.connectHevy(draft.apiKey.trim()); setConnected(status.connected);
    } else if (service === "intervals") {
      const status = await api.connectIntervals(draft.apiKey.trim(), draft.athleteId.trim()); setConnected(status.connected);
    } else {
      const saved = await api.saveChatSettings(await aiConfig()); setHasKey(saved[service].hasApiKey);
    }
    setDraft(current => ({ ...current, apiKey: "" }));
    setMessage("Settings saved.");
  }
  function field(name: string, label: string, secret = false, required = true) {
    return <label className="field" key={name}>{label}<input name={name} type={secret ? "password" : "text"} autoComplete="off" spellCheck={false}
      value={draft[name] ?? ""} required={required} disabled={busy} onChange={event => { setDraft(current => ({ ...current, [name]: event.target.value })); setMessage(""); }} /></label>;
  }
  return <div className="account-setup">
    <h2>{definition.title}</h2><p>{definition.description}</p>
    {error && <p role="alert">{error}</p>}
    {!ready && !error && <p role="status">Loading settings…</p>}
    {ready && <form onSubmit={event => { event.preventDefault(); void run(save); }}>
      <p>{service === "local" || service === "openRouter" ? (hasKey ? "API key saved" : "No API key saved") : connected ? "Connected" : "Not connected"}</p>
      {service === "spotify" ? <>{field("clientId", "Client ID")}{field("clientSecret", "Client secret", true)}{field("redirectUri", "Redirect URI")}</>
        : <>{field("apiKey", service === "local" ? "API key (optional)" : "API key", true, service === "strength" || service === "intervals")}
          {service === "intervals" && field("athleteId", "Athlete ID")}
          {service === "local" && field("baseUrl", "API base URL")}
          {(service === "local" || service === "openRouter") && field("model", "Model ID")}</>}
      {definition.link && <a href={definition.link} target="_blank" rel="noreferrer">Open {definition.title} developer settings</a>}
      <div className="account-api-actions">
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Working…" : "Save settings"}</button>
        {service === "spotify" && <button className="secondary-button" type="button" disabled={busy} onClick={() => void run(async () => {
          const status = connected ? await api.logoutSpotify() : await api.loginSpotify(); setConnected(status.authenticated);
          setMessage(status.authenticated ? "Spotify connected." : "Spotify signed out.");
        })}>{connected ? "Sign out" : "Sign in to Spotify"}</button>}
        {(service === "local" || service === "openRouter") && <>
          <button className="secondary-button" type="button" disabled={busy || !draft.model?.trim() || (service === "local" && !draft.baseUrl?.trim())} onClick={() => void run(async () => {
            const config = await aiConfig();
            const result = service === "local" ? await api.testLocalChatConnection(config.local) : await api.testOpenRouterConnection(config.openRouter);
            if (!result.ok) throw new Error(result.message); setMessage(result.message);
          })}>Test connection</button>
          <button className="secondary-button" type="button" disabled={busy || !hasKey} onClick={() => void run(async () => {
            const saved = await api.saveChatSettings(await aiConfig(true)); setHasKey(saved[service].hasApiKey);
            setDraft(current => ({ ...current, apiKey: "" })); setMessage("API key removed.");
          })}>Remove API key</button>
        </>}
      </div>
      {message && <p role="status">{message}</p>}
    </form>}
  </div>;
}
