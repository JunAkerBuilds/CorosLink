// Settings (C-LINK → Settings…, ⌘,): one page with the design's section rail. Shared look-and-feel choices are kept
// where the web code keeps them (src/lib/preferences.ts); the desktop's own (data mode, backups, storage, error logs)
// in the main process (desktop/main/settings.ts). Settings with nothing behind them yet say so.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button, Card, Field, LinkButton, Segmented, Switch } from "@/components/ui";
import { navItems } from "@/components/shell/AppShell";
import { useStore } from "@/data/local/store";
import { useSyncItems } from "@/data/sync";
import { ALWAYS_SHOWN, hiddenNavStore, isHex, SPORT_COLORS, sportColorsStore, type SportColorId } from "@/lib/preferences";
import { navigate, useLocation, useRouteParams } from "../router";
import {
  clearBlocked, clearLogs, exportBackup, openPlace, readLogs, readSettings, readStorage, restoreBackup, sendLogs, setCrashReports, setDataMode, setUsage,
  SettingsProblem, type Place, type SettingsState,
} from "../settings";
import { MEDIA_TABS } from "../media";
import { hiddenTabsStore } from "../mediaInput";
import { TurnOnFromSettings } from "../parts/LocalMode";
import { act, following, setAuto, statusLine, useUpdates } from "../updates";
import { language, languageFor, LANGUAGES, locale, msg, t, type Choice } from "@/lib/i18n";
import { chooseLanguage, languageStore } from "@/lib/i18n/load";
import { chooseUnits, units, type Units } from "@/lib/units";
import "./settings.css";

interface Item { id?: string; href?: string; label: string; keys: string }

const RAIL: { group?: string; items: Item[] }[] = [
  { group: msg("General"), items: [
    { id: "general", label: msg("Language & units"), keys: "language english metric imperial kilometres miles" },
    { id: "colors", label: msg("Activity colors"), keys: "sport colour running cycling swimming strength" },
    { id: "sidebar", label: msg("Sidebar"), keys: "navigation menu hide show items" },
  ] },
  { group: msg("Watch"), items: [
    { id: "profile", label: msg("Training profile"), keys: "heart rate zones threshold pace max resting" },
    { href: "/watch", label: msg("Watch settings"), keys: "alarms goals gps sleep schedule" },
    { id: "weather", label: msg("Weather location"), keys: "city town place automatic" },
  ] },
  { group: msg("Connections"), items: [
    { href: "/connect", label: msg("Accounts & API"), keys: "coros strava hevy intervals phone pairing sign in" },
    { id: "ai", label: msg("External AI"), keys: "mcp codex token watch faces workouts" },
  ] },
  { group: msg("Your data"), items: [
    { id: "privacy", label: msg("Privacy & local data"), keys: "local mode local-only connected watch pair bluetooth backup restore export passphrase blocked uploads usage counts analytics telemetry tracking anonymous" },
    { id: "storage", label: msg("Storage"), keys: "disk folder size space database cache" },
    { id: "logs", label: msg("Error logs"), keys: "errors report diagnostics copy clear send developer bug crash feedback support" },
  ] },
  { items: [{ id: "about", label: msg("About C-LINK"), keys: "version updates electron chromium node build" }] },
];
const ALL = RAIL.flatMap((g) => g.items);

const said = (e: unknown) => (e instanceof SettingsProblem || e instanceof Error ? e.message : t("That didn't work."));
const hrefOf = (i: Item) => i.href ?? (i.id === "general" ? "/settings" : `/settings/${i.id}`);

export default function Settings() {
  const { section } = useRouteParams();
  const shown = (section ? ALL.find((i) => i.id && i.id === section) : undefined) ?? ALL[0];
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  // Matches the English and the shown words alike.
  const matches = (i: Item) => !needle || `${i.label} ${t(i.label)} ${i.keys}`.toLowerCase().includes(needle);
  const firstMatch = ALL.find(matches);

  return (
    <main className="page set-page">
      <div className="set-grid">
        <nav className="set-nav" aria-label={t("Settings")}>
          <span className="set-title">{t("Settings")}</span>
          <Field type="search" aria-label={t("Search settings")} placeholder={t("Search settings")} value={query}
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
                {g.group ? <span className="set-nav-head">{t(g.group)}</span> : null}
                {items.map((i) => (
                  <Link key={i.label} href={hrefOf(i)} className="set-nav-item" aria-current={i === shown ? "page" : undefined}>{t(i.label)}</Link>
                ))}
              </div>
            );
          })}
          {firstMatch ? null : <span className="muted set-nav-none">{t("No setting by that name")}</span>}
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

function General() {
  const choice = useStore(languageStore, "system");
  const shownUnits = units();
  return (<>
    <Head title={t("Language & units")} />
    <Section title={t("App language")}>
      <Choices label={t("App language")} value={choice} onChange={(next) => { if (next !== choice) chooseLanguage(next); }}
        options={[{ value: "system" as Choice, label: t("System"), detail: LANGUAGES.find((l) => l.id === languageFor("system", navigator.languages))?.label }, ...LANGUAGES.map((l) => ({ value: l.id as Choice, label: l.label }))]} />
    </Section>
    <Section title={t("Units")}>
      <Choices label={t("Units")} value={shownUnits} wide onChange={(next) => { if (next !== shownUnits) chooseUnits(next); }} options={[
        { value: "metric" as Units, label: t("Metric"), detail: t("Kilometres, metres, min/km, kilograms") },
        { value: "imperial" as Units, label: t("Imperial"), detail: t("Miles, feet, min/mi, pounds, yards") },
      ]} />
    </Section>
  </>);
}

function Colors() {
  const picked = useStore(sportColorsStore, {});
  const [draft, setDraft] = useState<Partial<Record<SportColorId, string>>>({});
  const set = (id: SportColorId, hex: string) => sportColorsStore.set((p) => ({ ...p, [id]: hex.toLowerCase() }));
  const themeHex = (token: string) => getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return (<>
    <Head title={t("Activity colors")}>
      <Button disabled={!Object.keys(picked).length} onClick={() => { sportColorsStore.clear(); setDraft({}); }}>{t("Reset to defaults")}</Button>
    </Head>
    <Section>
      {SPORT_COLORS.map((s) => {
        const current = picked[s.id] ?? themeHex(s.base);
        const text = draft[s.id] ?? current.toUpperCase();
        return (
          <Row key={s.id} label={t(s.label)}>
            <input type="color" className="set-swatch" aria-label={t("{sport} colour picker", { sport: t(s.label) })} value={isHex(current) ? current : "#888888"}
              onChange={(e) => { set(s.id, e.target.value); setDraft((d) => ({ ...d, [s.id]: undefined })); }} />
            <Field className="set-hex" aria-label={t("{sport} colour", { sport: t(s.label) })} value={text} maxLength={7} spellCheck={false}
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
    <Head title={t("Sidebar")} />
    <Section title={t("Sidebar items")} side={<Button disabled={!hidden.length} onClick={() => hiddenNavStore.clear()}>{t("Show all")}</Button>}>
      {navItems().map((n) => (
        <Row key={n.href} label={t(n.label)}>
          {ALWAYS_SHOWN.includes(n.href) ? <span className="muted">{t("Always shown")}</span>
            : <Switch label={t("Show {item}", { item: t(n.label) })} checked={!hidden.includes(n.href)} onChange={(on) => toggle(n.href, on)} />}
        </Row>
      ))}
    </Section>
    <Section title={t("Media services")} side={<LinkButton href="/media">{t("Open Media")}</LinkButton>}>
      {MEDIA_TABS.map((tab) => (
        <Row key={tab.id} label={t(tab.label)}>
          {tab.id === "library" ? <span className="muted">{t("Always shown")}</span>
            : tab.built ? <Switch label={t("Show {item}", { item: t(tab.label) })} checked={!hiddenMediaTabs.includes(tab.id)} onChange={(on) => hiddenTabsStore.set((h) => (on ? h.filter((x) => x !== tab.id) : [...h, tab.id]))} />
            : <span className="muted">{t("Not in this app yet")}</span>}
        </Row>
      ))}
    </Section>
  </>);
}

/* ───────────── Watch ───────────── */

const ZONE_NAMES = [msg("Recovery"), msg("Aerobic endurance"), msg("Aerobic power"), msg("Threshold"), msg("Anaerobic")];
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
    { label: t("Max heart rate"), value: training?.maxHr, unit: "bpm" },
    { label: t("Resting heart rate"), value: resting, unit: "bpm" },
    { label: t("Threshold heart rate"), value: training?.thresholdHr, unit: "bpm" },
    { label: t("Threshold pace"), value: training?.thresholdPaceSecPerKm ? pace(training.thresholdPaceSecPerKm) : undefined, unit: "min/km" },
  ];
  const any = values.some((v) => v.value != null) || zones.length > 0;
  return (<>
    <Head title={t("Training profile")} />
    {!any ? (
      <Section>
        <NotYet>{t("Nothing from your watch yet. Your phone sends these once it's paired.")}</NotYet>
        <div><LinkButton href="/connect">{t("Pair a phone")}</LinkButton></div>
      </Section>
    ) : (<>
      <Section title={t("Thresholds")}>
        <div className="set-figures">
          {values.map((v) => (
            <div key={v.label} className="set-figure"><span>{v.label}</span><strong>{v.value ?? "—"}{v.value != null ? <small>{v.unit}</small> : null}</strong></div>
          ))}
        </div>
      </Section>
      {zones.length ? (
        <Section title={t("Heart-rate zones")}>
          {zones.map((z) => (
            <div key={z.zone} className="set-zone" data-zone={z.zone}>
              <span className="set-zone-n">{t("Zone {n}", { n: z.zone })}</span>
              <span>{ZONE_NAMES[z.zone - 1] ? t(ZONE_NAMES[z.zone - 1]) : ""}</span>
              <span aria-hidden="true" className="set-zone-bar"><span style={{ width: `${Math.round(((z.toBpm ?? top) / top) * 100)}%` }} /></span>
              <span className="set-zone-range">{z.fromBpm == null ? t("Up to {bpm} bpm", { bpm: z.toBpm ?? "" }) : z.toBpm == null ? t("{bpm} bpm and up", { bpm: z.fromBpm }) : t("{from} to {to} bpm", { from: z.fromBpm, to: z.toBpm })}</span>
            </div>
          ))}
        </Section>
      ) : null}
    </>)}
    <NotYet>{t("Changing these and saving them to the watch isn't in this app yet.")}</NotYet>
  </>);
}

function Weather() {
  return (<>
    <Head title={t("Weather location")} />
    <Section>
      <NotYet>{t("Choosing a weather location isn't in this app yet. Each activity's weather comes from where it was recorded.")}</NotYet>
    </Section>
  </>);
}

/* ───────────── Connections ───────────── */

function ExternalAI() {
  return (<>
    <Head title={t("External AI")}>
      <LinkButton href="/coach/settings?section=mcp">{t("Coach settings")}</LinkButton>
    </Head>
    <WatchFaceAutomation />
    <Section title={t("Strength workouts")}>
      <NotYet>{t("Letting other AI apps reach your strength workouts over MCP isn't in this app yet.")}</NotYet>
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
    if (!r.ok) throw new Error(json.message ?? t("That didn't work."));
    return json;
  };
  useEffect(() => { call("").then(setState, (e: unknown) => setProblem(said(e))); }, []);
  const turn = (on: boolean) => { setProblem(null); setCopied(false); call("", { enabled: on }).then(setState, (e: unknown) => setProblem(said(e))); };
  const copy = () => { setProblem(null); call("/copy", {}).then(() => setCopied(true), (e: unknown) => setProblem(said(e))); };
  return (
    <Section title={t("Watch faces")} side={<Switch label={t("Watch-face MCP server")} checked={!!state?.enabled} disabled={!state} onChange={turn} />}>
      <Problem text={problem ?? state?.problem ?? null} />
      <Row label={t("MCP server")} detail={state?.enabled ? t("AI apps on this computer can edit the face open in Studio. Turning it off revokes the token.") : t("Lets AI apps on this computer edit the face open in Studio.")} />
      {state?.enabled && state.url ? (<>
        <Row label={t("Address")} detail={<code>{state.url}</code>} />
        <Row label={t("Token")} detail={`…${state.tokenHint ?? ""}`}>
          <Button onClick={copy}>{copied ? t("Copied") : t("Copy Codex configuration")}</Button>
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

const when = (ms: number) => new Date(ms).toLocaleString(language() === "en" ? undefined : locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

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
    <Head title={t("Privacy & local data")} />
    <Problem text={problem} />
    <Section title={t("Data mode")}>
      <Choices label={t("Data mode")} wide value={turningOn ? "localOnly" : state?.dataMode ?? "connected"}
        onChange={(m) => {
          if (m === state?.dataMode) { setTurningOn(false); return; }
          // Turning on asks first (the same dialog as on Watch); leaving asks in a native dialog (main/settings.ts).
          if (m === "localOnly") { setTurningOn(true); return; }
          void run(async () => setState(await setDataMode(m)));
        }}
        options={[
          { value: "connected", label: t("Connected"), detail: t("The watch syncs with your phone. Workouts and plans can be saved to COROS.") },
          { value: "localOnly", label: t("Local mode"), detail: t("The watch is paired to this computer. Nothing is uploaded to COROS.") },
        ]} />
      {state?.dataMode === "localOnly" ? (
        <Row label={t("Your watch")} detail={t("Pair, sync and the watch key are on the Watch page.")}>
          <LinkButton href="/watch">{t("Open Watch")}</LinkButton>
        </Row>
      ) : null}
      {turningOn ? <TurnOnFromSettings onCancel={() => { setTurningOn(false); void readSettings().then(setState, () => undefined); }} /> : null}
    </Section>
    {state?.local ? (
      <Section title={t("On this computer")}>
        <div className="set-figures">
          {[
            { label: t("Activities"), value: state.local.activities.toLocaleString(locale("en-GB")) },
            { label: t("Days of health data"), value: state.local.healthDays.toLocaleString(locale("en-GB")) },
            { label: t("Last phone sync"), value: state.local.lastPhoneSync ? when(Date.parse(state.local.lastPhoneSync)) : t("Never") },
            { label: t("Size"), value: bytes(state.local.bytes) },
          ].map((f) => <div key={f.label} className="set-figure"><span>{f.label}</span><strong>{f.value}</strong></div>)}
        </div>
      </Section>
    ) : null}
    <Section title={t("Backup")}>
      <div className="set-backup">
        <label className="set-label">{t("Passphrase (optional)")}
          <Field type="password" value={passphrase} placeholder={t("At least 8 characters")} autoComplete="new-password" onChange={(e) => setPassphrase(e.target.value)} />
        </label>
        <Button disabled={busy || short} onClick={() => void run(async () => {
          const r = await exportBackup(passphrase);
          if (r.saved) setDone(r.sealed ? t("Saved “{file}”: {n} items, with a passphrase.", { file: r.saved, n: r.items ?? 0 }) : t("Saved “{file}”: {n} items.", { file: r.saved, n: r.items ?? 0 }));
        })}>{t("Export backup")}</Button>
        {confirming ? (
          <Button variant="primary" disabled={busy} onClick={() => { setConfirming(false); void run(async () => {
            const r = await restoreBackup(passphrase);
            if (r.restored != null) setDone(t("Restored {n} items.", { n: r.restored }));
          }); }}>{t("Replace my data")}</Button>
        ) : <Button disabled={busy || short} onClick={() => setConfirming(true)}>{t("Restore backup")}</Button>}
      </div>
      {confirming ? <p className="set-note">{t("Restoring replaces the data on this computer with the backup's. Paired phones read it again.")} <button type="button" className="set-link" onClick={() => setConfirming(false)}>{t("Cancel")}</button></p> : null}
      {done ? <p className="set-note" role="status">{done}</p> : null}
      <p className="set-note">{t("Sign-ins, AI keys and phone pairings are never included.")}</p>
    </Section>
    <Section title={t("Usage counts")} side={<Switch label={t("Send usage counts")} checked={!!state?.usage} disabled={!state || busy} onChange={(on) => void run(async () => setState(await setUsage(on)))} />}>
      <p className="set-note">{t("Just so I get an idea of how many people use C-LINK: a random ID, the app version and your OS. Never your data, and nothing in Local mode.")}</p>
    </Section>
    <Section title={t("Crash reports")} side={<Switch label={t("Send crash reports")} checked={!!state?.crashReports} disabled={!state || busy} onChange={(on) => void run(async () => setState(await setCrashReports(on)))} />}>
      <p className="set-note">{t("When C-LINK crashes, the last hour of its error log goes to the developer, with home folders and keys taken out. Nothing is sent in Local mode.")}</p>
    </Section>
    <Section title={t("Blocked uploads to COROS")} side={<>
      <Button disabled={busy} onClick={() => void run(async () => setState(await readSettings()))}>{t("Refresh")}</Button>
      <Button disabled={busy || !state?.blocked.length} onClick={() => void run(async () => setState(await clearBlocked()))}>{t("Clear")}</Button>
    </>}>
      {state?.blocked.length ? (
        <ul className="set-list">
          {state.blocked.map((b, k) => <li key={k}><code>{b.method} {b.target}</code><span className="muted">{when(b.at)}</span></li>)}
        </ul>
      ) : <p className="set-empty">{t("Nothing has been blocked.")}</p>}
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
    <Head title={t("Storage")}><Button onClick={load}>{t("Refresh")}</Button></Head>
    <Problem text={problem} />
    <Section>
      {(places ?? []).map((p) => (
        <Row key={p.id} label={p.label} detail={<code>{p.path}</code>}>
          <span className="set-size">{p.bytes == null ? t("Not created yet") : bytes(p.bytes)}</span>
          <Button disabled={p.bytes == null} onClick={() => void openPlace(p.id).catch((e: unknown) => setProblem(said(e)))}>{t("Open in Folder")}</Button>
        </Row>
      ))}
      {places ? null : <p className="set-empty">{t("Adding up…")}</p>}
    </Section>
  </>);
}

const RANGES = [{ value: "1", label: msg("1 hour") }, { value: "12", label: msg("12 hours") }, { value: "24", label: msg("1 day") }, { value: "168", label: msg("7 days") }] as const;

function Logs() {
  const [hours, setHours] = useState<(typeof RANGES)[number]["value"]>("24");
  const [log, setLog] = useState<{ count: number; report: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = (h = hours) => { readLogs(Number(h)).then((l) => { setProblem(null); setLog(l); }, (e: unknown) => setProblem(said(e))); };
  useEffect(() => { readLogs(Number(hours)).then(setLog, (e: unknown) => setProblem(said(e))); }, [hours]);
  const copy = () => { if (log) void navigator.clipboard.writeText(log.report).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }, (e: unknown) => setProblem(said(e))); };
  return (<>
    <Head title={t("Error logs")}><Button disabled={!log} onClick={copy}>{copied ? t("Copied") : t("Copy error report")}</Button></Head>
    <Problem text={problem} />
    <Section>
      <div className="set-card-head">
        <Segmented small label={t("Time range")} value={hours} onChange={setHours} options={RANGES.map((r) => ({ value: r.value, label: t(r.label) }))} />
        <span className="set-actions">
          <Button onClick={() => load()}>{t("Refresh")}</Button>
          <Button disabled={!log?.count} onClick={() => void clearLogs().then(() => load(), (e: unknown) => setProblem(said(e)))}>{t("Clear logs")}</Button>
        </span>
      </div>
      {log && !log.count ? <p className="set-empty">{t("No errors in this time.")}</p> : null}
      <details open className="set-report"><summary>{t("Preview report")}</summary><pre>{log?.report ?? ""}</pre></details>
    </Section>
    <SendLogs hours={Number(hours)} />
  </>);
}

/** C-LINK's updates: the same state as the account menu's Updates popover (../updates.ts). */
function Updates() {
  const { u, problem } = useUpdates();
  // "Check for Updates…" in the app menu opens this page with ?check=1.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("check") === "1") void act("check");
  }, []);
  if (!u) return <Section title={t("Updates")}><Problem text={problem} /><Row label={t("Version")} /></Section>;
  const next = u.available?.version;
  const off = u.phase === "unavailable";
  const busy = following(u);
  return (
    <Section title={t("Updates")} side={
      u.phase === "ready" ? <Button variant="primary" onClick={() => void act("install")}>{t("Restart to update")}</Button>
      : u.phase === "available" ? <Button variant="primary" onClick={() => void act("download")}>{t("Download")}</Button>
      : <Button disabled={off || busy} onClick={() => void act("check")}>{t("Check for updates")}</Button>
    }>
      <Problem text={problem} />
      <Row label={t("Version {version}", { version: u.version })} detail={statusLine(u, when)} />
      {u.available?.notes && (u.phase === "available" || u.phase === "downloading" || u.phase === "ready")
        ? <details className="set-report"><summary>{t("What's new in {version}", { version: next ?? "" })}</summary><pre>{u.available.notes}</pre></details> : null}
      <Row label={t("Check automatically")} detail={t("At launch and every six hours.")}>
        <Switch label={t("Check for updates automatically")} checked={u.auto.check} disabled={off} onChange={(check) => void setAuto({ check })} />
      </Row>
      <Row label={t("Download automatically")} detail={t("Installs when C-LINK quits.")}>
        <Switch label={t("Download updates automatically")} checked={u.auto.download} disabled={off} onChange={(download) => void setAuto({ download })} />
      </Row>
    </Section>
  );
}

/**
 * Sends the report above to the developer, with what happened and an email for a reply (main/reports.ts). Help →
 * Report a Problem… opens it with `?send`, scrolled to and ready to type in.
 */
function SendLogs({ hours }: { hours: number }) {
  const asked = new URLSearchParams(useLocation().search).has("send");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (asked) { box.current?.scrollIntoView({ block: "center" }); box.current?.focus(); } }, [asked]);
  const [note, setNote] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const send = async () => {
    setBusy(true); setProblem(null);
    try { setReference((await sendLogs({ note, contact, hours })).reference); setNote(""); } catch (e) { setProblem(said(e)); } finally { setBusy(false); }
  };
  return (
    <Section title={t("Send to the developer")}>
      <Problem text={problem} />
      <label className="set-label">{t("What happened? (optional)")}
        <textarea ref={box} className="field set-textarea" rows={3} maxLength={2000} value={note} onChange={(e) => { setNote(e.target.value); setReference(null); }} />
      </label>
      <label className="set-label">{t("Email for a reply (optional)")}
        <Field type="email" value={contact} maxLength={200} autoComplete="email" onChange={(e) => setContact(e.target.value)} />
      </label>
      <div className="set-actions">
        <Button variant="primary" disabled={busy} onClick={() => void send()}>{busy ? t("Sending…") : t("Send report")}</Button>
      </div>
      {reference ? <p className="set-note" role="status">{t("Sent. Your reference is {reference}.", { reference })}</p> : null}
      <p className="set-note">{t("Sends the report above with your version and system. Nothing else from this computer.")}</p>
    </Section>
  );
}

function About() {
  const [state, , problem] = useSettings();
  const a = state?.about;
  return (<>
    <Head title={t("About C-LINK")} />
    <Problem text={problem} />
    <Updates />
    <Section title={t("This build")}>
      {[[t("App version"), a?.version], [t("Platform"), a?.platform], ["Electron", a?.electron], ["Chromium", a?.chromium], ["Node.js", a?.node]].map(([k, v]) => (
        <div key={k} className="set-fact"><span className="muted">{k}</span><span>{v ?? "…"}</span></div>
      ))}
    </Section>
  </>);
}
