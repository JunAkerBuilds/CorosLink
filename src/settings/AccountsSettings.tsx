import { useEffect, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Dumbbell,
  Map,
  Music,
  Sparkles,
  UserRound,
  Watch,
  Check,
  ArrowUpRight,
  LayoutGrid,
  Route,
} from "lucide-react";
import {
  YoutubeLogo,
  SpotifyLogo,
  AppleLogo,
  GoogleLogo,
} from "@phosphor-icons/react";
import type { CorosLinkApi } from "../coroslink-api";
import { CalendarConnections } from "../calendar/CalendarConnections";
import "./accountsSettings.css";

export type AccountDestination =
  | "training"
  | "youtube"
  | "youtube-music"
  | "spotify"
  | "apple-music"
  | "strength"
  | "coach";
type Connection = { connected: boolean; detail?: string };

const groups = [
  { id: "all", label: "All connections", icon: LayoutGrid },
  { id: "coros", label: "COROS Account", icon: UserRound },
  { id: "media", label: "Media", icon: Music },
  { id: "maps", label: "Maps", icon: Map },
  { id: "strength", label: "Strength", icon: Dumbbell },
  { id: "coach", label: "Coach / AI", icon: Sparkles },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
] as const;
type AccountCategory = (typeof groups)[number]["id"];
const services = [
  {
    id: "training",
    name: "COROS",
    description: "Activities, training & health",
    group: "coros",
    icon: Watch,
  },
  {
    id: "youtube",
    name: "YouTube",
    description: "Videos for your watch",
    group: "media",
    icon: YoutubeLogo,
  },
  {
    id: "youtube-music",
    name: "YouTube Music",
    description: "Your music library",
    group: "media",
    icon: YoutubeLogo,
  },
  {
    id: "spotify",
    name: "Spotify",
    description: "Playlists & saved music",
    group: "media",
    icon: SpotifyLogo,
  },
  {
    id: "apple-music",
    name: "Apple Music",
    description: "Your Apple Music library",
    group: "media",
    icon: AppleLogo,
  },
  {
    id: "maps",
    name: "OpenRouteService",
    description: "Optional route planning service",
    group: "maps",
    icon: Route,
  },
  {
    id: "strength",
    name: "Hevy",
    description: "Strength workouts · Hevy Pro",
    group: "strength",
    icon: Dumbbell,
  },
  {
    id: "coach",
    name: "AI providers & tools",
    description: "ChatGPT, OpenRouter, Claude & MCP",
    group: "coach",
    icon: Sparkles,
  },
  {
    id: "google",
    name: "Google Calendar",
    description: "Planned workouts in Google",
    group: "calendar",
    icon: GoogleLogo,
  },
  {
    id: "apple",
    name: "Apple Calendar",
    description: "Planned workouts in iCloud",
    group: "calendar",
    icon: AppleLogo,
  },
] as const;

export function AccountsSettings({
  api,
  onOpenAccount,
  onBack,
}: {
  api: CorosLinkApi;
  onBack: () => void;
  onOpenAccount: (destination: AccountDestination) => void;
}) {
  const [connections, setConnections] = useState<
    Record<string, Connection | "unavailable">
  >({});
  const [detail, setDetail] = useState<"google" | "apple" | "maps" | null>(
    null,
  );
  const [revision, setRevision] = useState(0);
  const [category, setCategory] = useState<AccountCategory>("all");
  useEffect(() => {
    let active = true;
    const reads: Record<string, () => Promise<Connection>> = {
      training: async () => {
        const s = await api.getTrainingHubStatus();
        return { connected: s.authenticated, detail: s.email };
      },
      "youtube-music": async () => ({
        connected: (await api.getYouTubeMusicStatus()).authenticated,
      }),
      spotify: async () => {
        const s = await api.getSpotifyStatus();
        return { connected: s.authenticated, detail: s.displayName };
      },
      "apple-music": async () => ({
        connected: (await api.getAppleMusicStatus()).authenticated,
      }),
      strength: async () => ({
        connected: (await api.getHevyStatus()).connected,
      }),
      google: async () => {
        const s = await api.getGoogleCalendarStatus();
        return { connected: s.connected, detail: s.accountEmail };
      },
      apple: async () => {
        const s = await api.getAppleCalendarStatus();
        return { connected: s.connected, detail: s.accountEmail };
      },
      maps: async () => {
        const s = await api.getRouteBuilderConfig();
        return {
          connected: s.backend === "ors" && Boolean(s.openRouteServiceApiKey),
          detail:
            s.backend === "ors"
              ? undefined
              : "No account needed for default routing",
        };
      },
    };
    for (const [id, read] of Object.entries(reads)) {
      void read().then(
        (value) => {
          if (active)
            setConnections((current) => ({ ...current, [id]: value }));
        },
        () => {
          if (active)
            setConnections((current) => ({ ...current, [id]: "unavailable" }));
        },
      );
    }
    return () => {
      active = false;
    };
  }, [api, revision]);

  const coros = connections.training;
  const corosEmail =
    coros && coros !== "unavailable" ? coros.detail : undefined;
  const selectedGroup = groups.find((group) => group.id === category)!;
  const visibleServices = services.filter(
    (service) => category === "all" || service.group === category,
  );
  const connectedCount = Object.values(connections).filter(
    (state) => state !== "unavailable" && state.connected,
  ).length;
  return (
    <section className="accounts-screen" aria-labelledby="accounts-heading">
      <button className="settings-subpage-back" type="button" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" />
        Settings
      </button>
      <header className="accounts-heading">
        <div className="accounts-heading-icon">
          <UserRound size={25} aria-hidden="true" />
        </div>
        <div>
          <h2 id="accounts-heading">Account settings</h2>
          <p>Your services. One place to manage them.</p>
        </div>
        <span className="accounts-summary">
          <Check size={14} aria-hidden="true" />
          {connectedCount} connected
        </span>
      </header>
      <div className="accounts-workspace">
        <nav className="accounts-navigation" aria-label="Account categories">
          {groups.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              aria-pressed={category === id}
              onClick={() => {
                setCategory(id);
                if (detail) {
                  setDetail(null);
                  setRevision((value) => value + 1);
                }
              }}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </button>
          ))}
          <p>
            Connect only what you use.
            <br />
            You can add more anytime.
          </p>
        </nav>
        <div className="accounts-content">
          {detail ? (
            <div className="account-detail-panel">
              <button
                className="settings-subpage-back"
                type="button"
                onClick={() => {
                  setDetail(null);
                  setRevision((value) => value + 1);
                }}
              >
                <ArrowLeft size={15} aria-hidden="true" />
                All accounts
              </button>
              {detail === "maps" ? (
                <RoutingAccount api={api} />
              ) : (
                <CalendarConnections
                  api={api}
                  initialProvider={detail}
                  suggestedEmail={corosEmail}
                />
              )}
            </div>
          ) : (
            <>
              <div className="accounts-content-heading">
                <h3>{selectedGroup.label}</h3>
                <span>{visibleServices.length} services</span>
              </div>
              <div className="account-card-grid">
                {visibleServices.map(
                  ({ id, name, description, group, icon: Icon }) => {
                    const state = connections[id];
                    const hasStatus = id !== "youtube" && id !== "coach";
                    const connected =
                      state && state !== "unavailable" && state.connected;
                    const status = !hasStatus
                      ? "Optional"
                      : !state
                        ? "Checking…"
                        : state === "unavailable"
                          ? "Status unavailable"
                          : connected
                            ? id === "maps"
                              ? "Configured"
                              : "Connected"
                            : "Not connected";
                    return (
                      <button
                        className={`account-card account-card-${id}`}
                        type="button"
                        key={id}
                        onClick={() => {
                          if (
                            id === "google" ||
                            id === "apple" ||
                            id === "maps"
                          )
                            setDetail(id);
                          else onOpenAccount(id);
                        }}
                      >
                        <span className="account-service-icon">
                          <Icon size={25} aria-hidden="true" />
                        </span>
                        <span className="account-card-copy">
                          <strong>{name}</strong>
                          <span>
                            {state &&
                            state !== "unavailable" &&
                            state.detail &&
                            id !== "maps"
                              ? state.detail
                              : description}
                          </span>
                        </span>
                        <span className="account-card-category">
                          {groups.find((item) => item.id === group)?.label}
                        </span>
                        <span
                          className={`account-card-status${connected ? " is-connected" : ""}`}
                        >
                          {connected ? (
                            <Check size={12} aria-hidden="true" />
                          ) : null}
                          {status}
                        </span>
                        <span className="account-card-action">
                          {connected ? "Manage" : "Set up"}
                          <ArrowUpRight size={13} aria-hidden="true" />
                        </span>
                      </button>
                    );
                  },
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function RoutingAccount({ api }: { api: CorosLinkApi }) {
  const [config, setConfig] = useState<Awaited<
    ReturnType<CorosLinkApi["getRouteBuilderConfig"]>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    let active = true;
    void api.getRouteBuilderConfig().then(
      (value) => {
        if (active) setConfig(value);
      },
      () => {
        if (active)
          setError("Could not load routing settings. Go back and try again.");
      },
    );
    return () => {
      active = false;
    };
  }, [api]);
  return (
    <div className="account-setup">
      <h2>OpenRouteService</h2>
      <p>
        Default routing works without an account. Add an OpenRouteService API
        key if you prefer to use that service.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {config ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            setSaved(false);
            try {
              const next = {
                ...config,
                openRouteServiceApiKey: config.openRouteServiceApiKey.trim(),
              };
              if (next.backend === "ors") {
                const validation = await api.validateRouteApiKey(
                  next.openRouteServiceApiKey,
                );
                if (validation.status !== "valid")
                  throw new Error(validation.message);
              }
              setConfig(await api.saveRouteBuilderConfig(next));
              setSaved(true);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Could not save routing settings.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Routing service
            <select
              disabled={busy}
              value={config.backend ?? "keyless"}
              onChange={(event) => {
                setConfig({
                  ...config,
                  backend: event.target.value as "keyless" | "ors",
                });
                setSaved(false);
              }}
            >
              <option value="keyless">Default — no account needed</option>
              <option value="ors">OpenRouteService</option>
            </select>
          </label>
          {config.backend === "ors" ? (
            <>
              <label className="field">
                API key
                <input
                  type="password"
                  autoComplete="off"
                  required
                  disabled={busy}
                  value={config.openRouteServiceApiKey}
                  onChange={(event) => {
                    setConfig({
                      ...config,
                      openRouteServiceApiKey: event.target.value,
                    });
                    setSaved(false);
                  }}
                />
              </label>
              <a
                href="https://openrouteservice.org/"
                target="_blank"
                rel="noreferrer"
              >
                Get an OpenRouteService API key
              </a>
            </>
          ) : null}
          <button
            className="primary-button"
            type="submit"
            disabled={
              busy ||
              (config.backend === "ors" &&
                !config.openRouteServiceApiKey.trim())
            }
          >
            {busy ? "Saving…" : "Save settings"}
          </button>
          {saved ? <p role="status">Routing settings saved.</p> : null}
        </form>
      ) : !error ? (
        <p role="status">Loading settings…</p>
      ) : null}
    </div>
  );
}
