// Settings (C-LINK → Settings…, ⌘,): one page with the design's section rail. Shared look-and-feel choices are kept
// where the web code keeps them (src/lib/preferences.ts); the desktop's own (data mode, backups, storage, error logs)
// in the main process (desktop/main/settings.ts). Settings with nothing behind them yet say so.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, Field, LinkButton, Segmented, Switch } from "@/components/ui";
import { navItems } from "@/components/shell/AppShell";
import { useStore } from "@/data/local/store";
import { useSyncItems } from "@/data/sync";
import { ALWAYS_SHOWN, hiddenNavStore, isHex, SPORT_COLORS, sportColorsStore, type SportColorId } from "@/lib/preferences";
import { navigate, useRouteParams } from "../router";
import {
  clearBlocked, clearLogs, exportBackup, openPlace, readLogs, readSettings, readStorage, restoreBackup, setDataMode,
  SettingsProblem, type Place, type SettingsState,
} from "../settings";
import { MEDIA_TABS } from "../media";
import { hiddenTabsStore } from "../mediaInput";
import { TurnOnFromSettings } from "../parts/LocalMode";
import { act, following, setAuto, statusLine, useUpdates } from "../updates";
import "./settings.css";

interface Item { id?: string; href?: string; label: string; keys: string }

const RAIL: { group?: string; items: Item[] }[] = [
  { group: "General", items: [
    { id: "general", label: "Language & units", keys: "language english metric imperial kilometres miles" },
    { id: "colors", label: "Activity colors", keys: "sport colour running cycling swimming strength" },
    { id: "sidebar", label: "Sidebar", keys: "navigation menu hide show items" },
  ] },
  { group: "Watch", items: [
    { id: "profile", label: "Training profile", keys: "heart rate zones threshold pace max resting" },
    { href: "/watch", label: "Watch settings", keys: "alarms goals gps sleep schedule" },
    { id: "weather", label: "Weather location", keys: "city town place automatic" },
  ] },
  { group: "Connections", items: [
    { href: "/connect", label: "Accounts & API", keys: "coros strava hevy intervals phone pairing sign in" },
    { id: "ai", label: "External AI", keys: "mcp codex token watch faces workouts" },
  ] },
  { group: "Your data", items: [
    { id: "privacy", label: "Privacy & local data", keys: "local mode local-only connected watch pair bluetooth backup restore export passphrase blocked uploads" },
    { id: "storage", label: "Storage", keys: "disk folder size space database cache" },
    { id: "logs", label: "Error logs", keys: "errors report diagnostics copy clear" },
  ] },
  { items: [{ id: "about", label: "About C-LINK", keys: "version updates electron chromium node build" }] },
];
const ALL = RAIL.flatMap((g) => g.items);

const said = (e: unknown) => (e instanceof SettingsProblem || e instanceof Error ? e.message : "That didn't work.");
const hrefOf = (i: Item) => i.href ?? (i.id === "general" ? "/settings" : `/settings/${i.id}`);

export default function Settings() {
  const { section } = useRouteParams();
  const shown = (section ? ALL.find((i) => i.id && i.id === section) : undefined) ?? ALL[0];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const matches = (i: Item) => !needle || `${i.label} ${i.keys}`.toLowerCase().includes(needle);
  const firstMatch = ALL.find(matches);

  return (
    <main className="page set-page">
      <div className="set-grid">
        <nav className="set-nav" aria-label="Settings">
          <span className="set-title">Settings</span>
          <Field type="search" aria-label="Search settings" placeholder="Search settings" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && firstMatch) { navigate(hrefOf(firstMatch)); setQuery(""); }
            }} />
          {RAIL.map((g, k) => {
            const items = g.items.filter(matches);
            if (!items.length) return null;
            return (
              <div key={g.group ?? k} className="set-nav-group">
                {g.group ? <span className="set-nav-head">{g.group}</span> : null}
                {items.map((i) => (
                  <Link key={i.label} href={hrefOf(i)} className="set-nav-item" aria-current={i === shown ? "page" : undefined}>{i.label}</Link>
                ))}
              </div>
            );
          })}
          {firstMatch ? null : <span className="muted set-nav-none">No setting by that name</span>}
        </nav>
        <div className="set-body" key={shown.id}>
          {shown.id === "general" ? <General />
            : shown.id === "colors" ? <Colors />
            : shown.id === "sidebar" ? <Sidebar />
            : shown.id === "profile" ? <Profile />
            : shown.id === "weather" ? <Weather />
            : shown.id === "ai" ? <ExternalAI />
            : shown.id === "privacy" ? <Privacy />
            : shown.id === "storage" ? <Storage />
            : shown.id === "logs" ? <Logs />
            : <About />}
        </div>
      </div>
    </main>
  );
}

/* ───────────── Parts ───────────── */

function Head({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="set-head"><h1>{title}</h1>{children ? <div className="set-actions">{children}</div> : null}</div>;
}

function Section({ title, side, children }: { title?: string; side?: ReactNode; children: ReactNode }) {
  return (
    <Card pad className="set-card" aria-label={title}>
      {title || side ? <div className="set-card-head">{title ? <h2>{title}</h2> : <span />}{side ? <span className="set-actions">{side}</span> : null}</div> : null}
      {children}
    </Card>
  );
}

function Row({ label, detail, children }: { label: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <div className="set-row">
      <span className="set-row-text"><span className="set-row-label">{label}</span>{detail ? <span className="set-row-detail">{detail}</span> : null}</span>
      {children ? <span className="set-row-end">{children}</span> : null}
    </div>
  );
}

function Choices<T extends string>({ label, value, options, onChange, wide }: {
  label: string; value: T; wide?: boolean; onChange?: (v: T) => void;
  options: { value: T; label: string; detail?: string; disabled?: boolean }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} className="set-choices" data-wide={wide || undefined}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} disabled={o.disabled} className="set-choice"
          onClick={() => onChange?.(o.value)}>
          {o.label}{o.detail ? <span>{o.detail}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** A line saying what isn't in this app yet. */
const NotYet = ({ children }: { children: ReactNode }) => <p className="set-empty">{children}</p>;
const Problem = ({ text }: { text: string | null }) => (text ? <p className="notice" role="alert">{text}</p> : null);

/* ───────────── General ───────────── */

const LANGUAGES = ["English", "Deutsch", "Español", "Français", "Português", "简体中文"];

function General() {
  return (<>
    <Head title="Language & units" />
    <Section title="App language">
      <Choices label="App language" value="English" options={LANGUAGES.map((l) => ({ value: l, label: l, disabled: l !== "English" }))} />
      <NotYet>Other languages aren&apos;t in this app yet.</NotYet>
    </Section>
    <Section title="Units">
      <Choices label="Units" value="metric" wide options={[
        { value: "metric", label: "Metric", detail: "Kilometres, metres, min/km, kilograms" },
        { value: "imperial", label: "Imperial", detail: "Miles, feet, min/mi, pounds, yards", disabled: true },
      ]} />
      <NotYet>Imperial units aren&apos;t in this app yet.</NotYet>
    </Section>
  </>);
}

function Colors() {
  const picked = useStore(sportColorsStore, {});
  const [draft, setDraft] = useState<Partial<Record<SportColorId, string>>>({});
  const set = (id: SportColorId, hex: string) => sportColorsStore.set((p) => ({ ...p, [id]: hex.toLowerCase() }));
  const themeHex = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return (<>
    <Head title="Activity colors">
      <Button disabled={!Object.keys(picked).length} onClick={() => { sportColorsStore.clear(); setDraft({}); }}>Reset to defaults</Button>
    </Head>
    <Section>
      {SPORT_COLORS.map((s) => {
        const current = picked[s.id] ?? themeHex(s.base);
        const text = draft[s.id] ?? current.toUpperCase();
        return (
          <Row key={s.id} label={s.label}>
            <input type="color" className="set-swatch" aria-label={`${s.label} colour picker`} value={isHex(current) ? current : "#888888"}
              onChange={(e) => { set(s.id, e.target.value); setDraft((d) => ({ ...d, [s.id]: undefined })); }} />
            <Field className="set-hex" aria-label={`${s.label} colour`} value={text} maxLength={7} spellCheck={false}
              onChange={(e) => {
                const v = e.target.value.startsWith("#") ? e.target.value : `#${e.target.value}`;
                setDraft((d) => ({ ...d, [s.id]: v.toUpperCase() }));
                if (isHex(v)) set(s.id, v);
              }}
              onBlur={() => setDraft((d) => ({ ...d, [s.id]: undefined }))} />
          </Row>
        );
      })}
    </Section>
  </>);
}

function Sidebar() {
  const hidden = useStore(hiddenNavStore, []);
  const hiddenMediaTabs = useStore(hiddenTabsStore, []);
  const toggle = (href: string, on: boolean) => hiddenNavStore.set((h) => (on ? h.filter((x) => x !== href) : [...h, href]));
  return (<>
    <Head title="Sidebar" />
    <Section title="Sidebar items" side={<Button disabled={!hidden.length} onClick={() => hiddenNavStore.clear()}>Show all</Button>}>
      {navItems().map((n) => (
        <Row key={n.href} label={n.label}>
          {ALWAYS_SHOWN.includes(n.href) ? <span className="muted">Always shown</span>
            : <Switch label={`Show ${n.label}`} checked={!hidden.includes(n.href)} onChange={(on) => toggle(n.href, on)} />}
        </Row>
      ))}
    </Section>
    <Section title="Media services" side={<LinkButton href="/media">Open Media</LinkButton>}>
      {MEDIA_TABS.map((t) => (
        <Row key={t.id} label={t.label}>
          {t.id === "library" ? <span className="muted">Always shown</span>
            : t.built ? <Switch label={`Show ${t.label}`} checked={!hiddenMediaTabs.includes(t.id)} onChange={(on) => hiddenTabsStore.set((h) => (on ? h.filter((x) => x !== t.id) : [...h, t.id]))} />
            : <span className="muted">Not in this app yet</span>}
        </Row>
      ))}
    </Section>
  </>);
}

/* ───────────── Watch ───────────── */

const ZONE_NAMES = ["Recovery", "Aerobic endurance", "Aerobic power", "Threshold", "Anaerobic"];
const pace = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function Profile() {
  const training = useSyncItems("view.training")[0]?.body;
  const days = useSyncItems("health.day");
  const resting = useMemo(() => days
    .filter((d) => d.body.restingHR)
    .sort((a, b) => (b.body.day.year - a.body.day.year) || (b.body.day.month - a.body.day.month) || (b.body.day.day - a.body.day.day))[0]?.body.restingHR, [days]);
  const zones = training?.hrZones?.zones ?? [];
  const top = Math.max(1, ...zones.map((z) => z.toBpm ?? z.fromBpm ?? 0), training?.maxHr ?? 0);
  const values = [
    { label: "Max heart rate", value: training?.maxHr, unit: "bpm" },
    { label: "Resting heart rate", value: resting, unit: "bpm" },
    { label: "Threshold heart rate", value: training?.thresholdHr, unit: "bpm" },
    { label: "Threshold pace", value: training?.thresholdPaceSecPerKm ? pace(training.thresholdPaceSecPerKm) : undefined, unit: "min/km" },
  ];
  const any = values.some((v) => v.value != null) || zones.length > 0;
  return (<>
    <Head title="Training profile" />
    {!any ? (
      <Section>
        <NotYet>Nothing from your watch yet. Your phone sends these once it&apos;s paired.</NotYet>
        <div><LinkButton href="/connect">Pair a phone</LinkButton></div>
      </Section>
    ) : (<>
      <Section title="Thresholds">
        <div className="set-figures">
          {values.map((v) => (
            <div key={v.label} className="set-figure"><span>{v.label}</span><strong>{v.value ?? "—"}{v.value != null ? <small>{v.unit}</small> : null}</strong></div>
          ))}
        </div>
      </Section>
      {zones.length ? (
        <Section title="Heart-rate zones">
          {zones.map((z) => (
            <div key={z.zone} className="set-zone" data-zone={z.zone}>
              <span className="set-zone-n">Zone {z.zone}</span>
              <span>{ZONE_NAMES[z.zone - 1] ?? ""}</span>
              <span aria-hidden="true" className="set-zone-bar"><span style={{ width: `${Math.round(((z.toBpm ?? top) / top) * 100)}%` }} /></span>
              <span className="set-zone-range">{z.fromBpm == null ? `Up to ${z.toBpm} bpm` : z.toBpm == null ? `${z.fromBpm} bpm and up` : `${z.fromBpm} to ${z.toBpm} bpm`}</span>
            </div>
          ))}
        </Section>
      ) : null}
    </>)}
    <NotYet>Changing these and saving them to the watch isn&apos;t in this app yet.</NotYet>
  </>);
}

function Weather() {
  return (<>
    <Head title="Weather location" />
    <Section>
      <NotYet>Choosing a weather location isn&apos;t in this app yet. Each activity&apos;s weather comes from where it was recorded.</NotYet>
    </Section>
  </>);
}

/* ───────────── Connections ───────────── */

function ExternalAI() {
  return (<>
    <Head title="External AI">
      <LinkButton href="/coach/settings?section=mcp">Coach settings</LinkButton>
    </Head>
    <WatchFaceAutomation />
    <Section title="Strength workouts">
      <NotYet>Letting other AI apps reach your strength workouts over MCP isn&apos;t in this app yet.</NotYet>
    </Section>
  </>);
}

interface AutomationState { enabled: boolean; url: string | null; tokenHint: string | null; editor: boolean; problem?: string }

/** The watch-face MCP server (main: watchface/automation): on / off, its address, and the Codex configuration. */
function WatchFaceAutomation() {
  const [state, setState] = useState<AutomationState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(`/api/desktop/studio/automation${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json", "x-clink-hub": "1" }, body: JSON.stringify(body) });
    const json = (await r.json()) as AutomationState & { message?: string };
    if (!r.ok) throw new Error(json.message ?? "That didn't work.");
    return json;
  };
  useEffect(() => { call("").then(setState, (e: unknown) => setProblem(said(e))); }, []);
  const turn = (on: boolean) => { setProblem(null); setCopied(false); call("", { enabled: on }).then(setState, (e: unknown) => setProblem(said(e))); };
  const copy = () => { setProblem(null); call("/copy", {}).then(() => setCopied(true), (e: unknown) => setProblem(said(e))); };
  return (
    <Section title="Watch faces" side={<Switch label="Watch-face MCP server" checked={!!state?.enabled} disabled={!state} onChange={turn} />}>
      <Problem text={problem ?? state?.problem ?? null} />
      <Row label="MCP server" detail={state?.enabled ? "AI apps on this computer can edit the face open in Studio. Turning it off revokes the token." : "Lets AI apps on this computer edit the face open in Studio."} />
      {state?.enabled && state.url ? (<>
        <Row label="Address" detail={<code>{state.url}</code>} />
        <Row label="Token" detail={`…${state.tokenHint ?? ""}`}>
          <Button onClick={copy}>{copied ? "Copied" : "Copy Codex configuration"}</Button>
        </Row>
      </>) : null}
    </Section>
  );
}

/* ───────────── Your data ───────────── */

function useSettings(): [SettingsState | null, (s: SettingsState) => void, string | null, (p: string | null) => void] {
  const [state, setState] = useState<SettingsState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { readSettings().then(setState, (e: unknown) => setProblem(said(e))); }, []);
  return [state, setState, problem, setProblem];
}

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Privacy() {
  const [state, setState, problem, setProblem] = useSettings();
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true); setProblem(null); setDone(null);
    try { await work(); } catch (e) { setProblem(said(e)); } finally { setBusy(false); }
  };
  const short = passphrase.length > 0 && passphrase.length < 8;
  return (<>
    <Head title="Privacy & local data" />
    <Problem text={problem} />
    <Section title="Data mode">
      <Choices label="Data mode" wide value={turningOn ? "localOnly" : state?.dataMode ?? "connected"}
        onChange={(m) => {
          if (m === state?.dataMode) { setTurningOn(false); return; }
          // Turning on asks first (the same dialog as on Watch); leaving asks in a native dialog (main/settings.ts).
          if (m === "localOnly") { setTurningOn(true); return; }
          void run(async () => setState(await setDataMode(m)));
        }}
        options={[
          { value: "connected", label: "Connected", detail: "The watch syncs with your phone. Workouts and plans can be saved to COROS." },
          { value: "localOnly", label: "Local mode", detail: "The watch is paired to this computer. Nothing is uploaded to COROS." },
        ]} />
      {state?.dataMode === "localOnly" ? (
        <Row label="Your watch" detail="Pair, sync and the watch key are on the Watch page.">
          <LinkButton href="/watch">Open Watch</LinkButton>
        </Row>
      ) : null}
      {turningOn ? <TurnOnFromSettings onCancel={() => { setTurningOn(false); void readSettings().then(setState, () => undefined); }} /> : null}
    </Section>
    {state?.local ? (
      <Section title="On this computer">
        <div className="set-figures">
          {[
            { label: "Activities", value: state.local.activities.toLocaleString() },
            { label: "Days of health data", value: state.local.healthDays.toLocaleString() },
            { label: "Last phone sync", value: state.local.lastPhoneSync ? when(Date.parse(state.local.lastPhoneSync)) : "Never" },
            { label: "Size", value: bytes(state.local.bytes) },
          ].map((f) => <div key={f.label} className="set-figure"><span>{f.label}</span><strong>{f.value}</strong></div>)}
        </div>
      </Section>
    ) : null}
    <Section title="Backup">
      <div className="set-backup">
        <label className="set-label">Passphrase (optional)
          <Field type="password" value={passphrase} placeholder="At least 8 characters" autoComplete="new-password" onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        <Button disabled={busy || short} onClick={() => void run(async () => {
          const r = await exportBackup(passphrase);
          if (r.saved) setDone(`Saved “${r.saved}”: ${r.items} items${r.sealed ? ", with a passphrase" : ""}.`);
        })}>Export backup</Button>
        {confirming ? (
          <Button variant="primary" disabled={busy} onClick={() => { setConfirming(false); void run(async () => {
            const r = await restoreBackup(passphrase);
            if (r.restored != null) setDone(`Restored ${r.restored} items.`);
          }); }}>Replace my data</Button>
        ) : <Button disabled={busy || short} onClick={() => setConfirming(true)}>Restore backup</Button>}
      </div>
      {confirming ? <p className="set-note">Restoring replaces the data on this computer with the backup&apos;s. Paired phones read it again. <button type="button" className="set-link" onClick={() => setConfirming(false)}>Cancel</button></p> : null}
      {done ? <p className="set-note" role="status">{done}</p> : null}
      <p className="set-note">Sign-ins, AI keys and phone pairings are never included.</p>
    </Section>
    <Section title="Blocked uploads to COROS" side={<>
      <Button disabled={busy} onClick={() => void run(async () => setState(await readSettings()))}>Refresh</Button>
      <Button disabled={busy || !state?.blocked.length} onClick={() => void run(async () => setState(await clearBlocked()))}>Clear</Button>
    </>}>
      {state?.blocked.length ? (
        <ul className="set-list">
          {state.blocked.map((b, k) => <li key={k}><code>{b.method} {b.target}</code><span className="muted">{when(b.at)}</span></li>)}
        </ul>
      ) : <p className="set-empty">Nothing has been blocked.</p>}
    </Section>
  </>);
}

const bytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
};

function Storage() {
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const load = () => { readStorage().then((s) => { setProblem(null); setPlaces(s.places); }, (e: unknown) => setProblem(said(e))); };
  useEffect(load, []);
  return (<>
    <Head title="Storage"><Button onClick={load}>Refresh</Button></Head>
    <Problem text={problem} />
    <Section>
      {(places ?? []).map((p) => (
        <Row key={p.id} label={p.label} detail={<code>{p.path}</code>}>
          <span className="set-size">{p.bytes == null ? "Not created yet" : bytes(p.bytes)}</span>
          <Button disabled={p.bytes == null} onClick={() => void openPlace(p.id).catch((e: unknown) => setProblem(said(e)))}>Open in Folder</Button>
        </Row>
      ))}
      {places ? null : <p className="set-empty">Adding up…</p>}
    </Section>
  </>);
}

const RANGES = [{ value: "1", label: "1 hour" }, { value: "12", label: "12 hours" }, { value: "24", label: "1 day" }, { value: "168", label: "7 days" }] as const;

function Logs() {
  const [hours, setHours] = useState<(typeof RANGES)[number]["value"]>("24");
  const [log, setLog] = useState<{ count: number; report: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = (h = hours) => { readLogs(Number(h)).then((l) => { setProblem(null); setLog(l); }, (e: unknown) => setProblem(said(e))); };
  useEffect(() => { readLogs(Number(hours)).then(setLog, (e: unknown) => setProblem(said(e))); }, [hours]);
  const copy = () => { if (log) void navigator.clipboard.writeText(log.report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, (e: unknown) => setProblem(said(e))); };
  return (<>
    <Head title="Error logs"><Button disabled={!log} onClick={copy}>{copied ? "Copied" : "Copy error report"}</Button></Head>
    <Problem text={problem} />
    <Section>
      <div className="set-card-head">
        <Segmented small label="Time range" value={hours} onChange={setHours} options={RANGES} />
        <span className="set-actions">
          <Button onClick={() => load()}>Refresh</Button>
          <Button disabled={!log?.count} onClick={() => void clearLogs().then(() => load(), (e: unknown) => setProblem(said(e)))}>Clear logs</Button>
        </span>
      </div>
      {log && !log.count ? <p className="set-empty">No errors in this time.</p> : null}
      <details open className="set-report"><summary>Preview report</summary><pre>{log?.report ?? ""}</pre></details>
    </Section>
  </>);
}

/** C-LINK's updates: the same state as the account menu's Updates popover (../updates.ts). */
function Updates() {
  const { u, problem } = useUpdates();
  // "Check for Updates…" in the app menu opens this page with ?check=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("check") === "1") void act("check");
  }, []);
  if (!u) return <Section title="Updates"><Problem text={problem} /><Row label="Version" /></Section>;
  const next = u.available?.version;
  const off = u.phase === "unavailable";
  const busy = following(u);
  return (
    <Section title="Updates" side={
      u.phase === "ready" ? <Button variant="primary" onClick={() => void act("install")}>Restart to update</Button>
      : u.phase === "available" ? <Button variant="primary" onClick={() => void act("download")}>Download</Button>
      : <Button disabled={off || busy} onClick={() => void act("check")}>Check for updates</Button>
    }>
      <Problem text={problem} />
      <Row label={`Version ${u.version}`} detail={statusLine(u, when)} />
      {u.available?.notes && (u.phase === "available" || u.phase === "downloading" || u.phase === "ready")
        ? <details className="set-report"><summary>What&apos;s new in {next}</summary><pre>{u.available.notes}</pre></details> : null}
      <Row label="Check automatically" detail="At launch and every six hours.">
        <Switch label="Check for updates automatically" checked={u.auto.check} disabled={off} onChange={(check) => void setAuto({ check })} />
      </Row>
      <Row label="Download automatically" detail="Installs when C-LINK quits.">
        <Switch label="Download updates automatically" checked={u.auto.download} disabled={off} onChange={(download) => void setAuto({ download })} />
      </Row>
    </Section>
  );
}

function About() {
  const [state, , problem] = useSettings();
  const a = state?.about;
  return (<>
    <Head title="About C-LINK" />
    <Problem text={problem} />
    <Updates />
    <Section title="This build">
      {[["App version", a?.version], ["Platform", a?.platform], ["Electron", a?.electron], ["Chromium", a?.chromium], ["Node.js", a?.node]].map(([k, v]) => (
        <div key={k} className="set-fact"><span className="muted">{k}</span><span>{v ?? "…"}</span></div>
      ))}
    </Section>
  </>);
}
