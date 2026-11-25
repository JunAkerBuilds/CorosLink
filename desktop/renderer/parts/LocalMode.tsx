// Local mode on the Watch page: the switch in the device card, the "are you sure?" and pairing dialogs, and the
// cards the page gains once the watch is paired to this computer (design: "Local mode" row on the C-LINK design canvas).
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Dropdown, Field, Select, Switch } from "@/components/ui";
import { hubSignOut, useHubSession } from "@/data/hub";
import { dataMode, readSettings, setDataMode } from "../settings";
import { navigate } from "../router";
import {
  AUTO_SYNC, autoSyncLabel, cancelWatch, disconnectWatch, forgetWatchKey, pairWatch, ringWatch, scanWatches, setAutoSync, stepLabel, syncWatch, unpairWatch,
  useMinute, useWatchLink, watchSignIn, whenSynced, type Region, type WatchStatus,
} from "../watchLink";
import { LocalWatchSettings, WatchFacesCard, WeatherRow } from "./LocalWatchSettings";
import "../pages/settings.css";
import "./localMode.css";

const said = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

function useMode() {
  const mode = useSyncExternalStore(dataMode.subscribe, dataMode.get);
  useEffect(() => { if (dataMode.get() === null) readSettings().catch(() => undefined); }, []);
  return mode;
}

const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={d} /></svg>
);
const I = {
  laptop: "M4 6h16v10H4zM2 19h20",
  bluetooth: "M7 7l10 10-5 4V3l5 4L7 17",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z",
  phoneOff: "M8 3h8v18H8zM3 3l18 18",
  alert: "M12 4l9 16H3zM12 10v4M12 17h.01",
  check: "M5 12l4 4 10-10",
  act: "M3 12h4l3-8 4 16 3-8h4",
  moon: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  heart: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5a4 4 0 0 1 7 2.5c0 5.5-7 10-7 10z",
  send: "M4 12l16-8-6 16-2-6z",
  clock: "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16zM12 8v4l3 2",
  key: "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4",
};

/* ───────────── In the device card ───────────── */

/** Off: the switch that asks first. On: how the watch is linked, Sync now and auto-sync. */
export function LocalModePanel() {
  const mode = useMode();
  const status = useWatchLink();
  const [asking, setAsking] = useState(false);
  // Settings sends here with ?pair=1 once Local mode is on.
  const [pairing, setPairing] = useState(() => new URLSearchParams(window.location.search).has("pair"));
  const local = mode === "localOnly";

  if (!local || !status?.paired) {
    return (
      <>
        <div className="lm-toggle">
          <span className="lm-toggle-icon"><Icon d={I.laptop} size={20} /></span>
          <span className="lm-toggle-text">
            <strong>Local mode</strong>
            <span>{local ? "On. Pair your watch to sync it with this computer." : "Pair the watch to this computer instead of your phone"}</span>
          </span>
          {local
            ? <Button variant="primary" onClick={() => setPairing(true)}>Pair watch</Button>
            : <Switch label="Local mode" checked={asking} onChange={(on) => setAsking(on)} />}
        </div>
        {asking ? <TurnOnDialog onCancel={() => setAsking(false)} onDone={() => { setAsking(false); setPairing(true); }} /> : null}
        {pairing ? <PairDialog onClose={() => setPairing(false)} /> : null}
      </>
    );
  }
  return <LinkedPanel status={status} />;
}

function LinkedPanel({ status }: { status: WatchStatus }) {
  const now = useMinute();
  const [problem, setProblem] = useState<string | null>(null);
  const syncing = status.busy === "syncing" || status.busy === "connecting";
  const percent = status.step?.percent;
  const run = (work: () => Promise<unknown>) => { setProblem(null); work().catch((e: unknown) => setProblem(said(e))); };
  const busy = !!status.busy;
  const synced = status.lastSync ? `Synced ${whenSynced(status.lastSync.at, now)}` : "Not synced yet";
  return (
    <div className="lm-linked">
      <div className="lm-status" role="status">
        <Bars on={status.connected ? 3 : 0} />
        <b>{status.connected ? "Connected" : "Not connected"}</b>
        <span className="lm-dot" aria-hidden="true">·</span>
        <span>{synced}</span>
        <span className="lm-mode" title="Paired to this computer. Changes go to the watch as you make them."><Icon d={I.laptop} size={13} />Local mode</span>
      </div>
      <div className="lm-actions">
        <Button variant="primary" className="lm-sync" disabled={busy} onClick={() => run(syncWatch)}>
          {syncing ? `${stepLabel(status.step)}…${percent != null ? ` ${percent}%` : ""}` : status.connected ? "Sync now" : "Connect and sync"}
          {syncing && percent != null ? <span className="lm-sync-meter" style={{ width: `${percent}%` }} /> : null}
        </Button>
        {syncing
          ? <Button onClick={() => run(cancelWatch)}>Cancel</Button>
          : status.connected ? <Button disabled={busy} onClick={() => run(disconnectWatch)}>Disconnect</Button> : null}
        <span className="lm-auto">Auto-sync
          <Dropdown small label="Auto-sync" value={status.autoSyncMinutes} options={AUTO_SYNC.map((m) => ({ value: m as number, label: autoSyncLabel(m) }))}
            onChange={(m) => run(() => setAutoSync(m))} />
        </span>
      </div>
      {problem || status.problem ? <p className="lm-problem" role="alert">{problem ?? status.problem}</p> : null}
    </div>
  );
}

const Bars = ({ on }: { on: number }) => (
  <span className="lm-bars" aria-hidden="true">{[1, 2, 3, 4].map((k) => <i key={k} data-off={k > on ? "" : undefined} />)}</span>
);

/* ───────────── Dialogs ───────────── */

function Dialog({ label, children }: { label: string; children: ReactNode }) {
  // On <body>: inside the Watch hero the card's animation made a stacking context, so later cards painted over the dialog.
  return createPortal(
    <div className="lm-scrim">
      <div className="lm-dialog" role="dialog" aria-modal="true" aria-label={label}>{children}</div>
    </div>,
    document.body,
  );
}

/** "Turn on Local mode?" Asked before anything changes; Cancel leaves everything as it was. */
export function TurnOnDialog({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const status = useWatchLink();
  const hub = useHubSession();
  const [signOut, setSignOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const turnOn = async () => {
    setBusy(true); setProblem(null);
    try {
      await setDataMode("localOnly");
      if (signOut) await hubSignOut();
      onDone();
    } catch (e) { setProblem(said(e)); setBusy(false); }
  };
  return (
    <Dialog label="Turn on Local mode?">
      <div className="lm-pair-art" aria-hidden="true"><span className="lm-mini-watch" /><span className="lm-dots"><i /><i /><i /></span><span className="lm-mini-mac" /></div>
      <h2>Turn on Local mode?</h2>
      <p>This pairs your watch to this computer. Choose it only if you&apos;ll use C-LINK Desktop on its own, without the COROS app or C-LINK on your phone.</p>
      <ul className="lm-list">
        <li><span className="lm-ico" data-hue="mint"><Icon d={I.bluetooth} size={16} /></span><span>The watch syncs activities, sleep and health with this computer over Bluetooth.</span></li>
        <li><span className="lm-ico" data-hue="mint"><Icon d={I.shield} size={16} /></span><span>Nothing is uploaded to COROS, except watch faces you send.</span></li>
        <li><span className="lm-ico" data-hue="gold"><Icon d={I.phoneOff} size={16} /></span><span>The COROS app and C-LINK on your phone stop syncing with this watch. Turn off the watch&apos;s Wi-Fi too.</span></li>
        <li><span className="lm-ico" data-hue="gold"><Icon d={I.alert} size={16} /></span><span>Strava and TrainingPeaks stop getting activities through COROS, and firmware updates stop.</span></li>
      </ul>
      {hub?.state === "signedIn" ? (
        <div className="lm-option">
          <span className="lm-row-text"><strong>Sign out of COROS on this computer</strong><span>The watch key stays, so the watch still connects.</span></span>
          <Switch label="Sign out of COROS on this computer" checked={signOut} onChange={setSignOut} />
        </div>
      ) : null}
      <span className="lm-key">
        {status?.keySaved
          ? <><span className="lm-done"><Icon d={I.check} size={14} />Watch key saved</span>{status.account ? `from ${status.account}` : null}</>
          : "Next, you sign in to COROS once to get your watch key."}
      </span>
      {status && !status.available ? <p className="lm-problem" role="alert">Pairing a watch needs C-LINK's Bluetooth helper, which this copy doesn't have.</p> : null}
      {problem ? <p className="lm-problem" role="alert">{problem}</p> : null}
      <div className="lm-dialog-actions">
        <Button onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button variant="primary" onClick={() => void turnOn()} disabled={busy}>Turn on and pair</Button>
      </div>
    </Dialog>
  );
}

const REGIONS: { value: Region; label: string }[] = [
  { value: "us", label: "Global" }, { value: "eu", label: "Europe" }, { value: "sg", label: "Singapore" }, { value: "cn", label: "China" },
];
const guessRegion = (): Region => {
  const country = (navigator.language.split("-")[1] ?? "").toUpperCase();
  if (["CN", "HK", "MO", "TW"].includes(country)) return "cn";
  if (country && !["US", "CA", "MX"].includes(country)) return "eu";
  return "us";
};

/** Watch key, then find the watch, then connect. Closing it leaves Local mode on, to pair later. */
export function PairDialog({ onClose }: { onClose: () => void }) {
  const status = useWatchLink();
  const [problem, setProblem] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [region, setRegion] = useState<Region>(guessRegion);
  const [conflict, setConflict] = useState(false);
  const [paired, setPaired] = useState(false);
  const keySaved = !!status?.keySaved;
  const busy = status?.busy ?? null;
  const step = !keySaved ? "key" : paired ? "done" : busy === "connecting" ? "connect" : "find";

  const run = (work: () => Promise<unknown>) => { setProblem(null); return work().catch((e: unknown) => { setProblem(said(e)); throw e; }); };
  // Each time the find step opens: look for watches.
  useEffect(() => { if (step === "find") scanWatches().catch((e: unknown) => setProblem(said(e))); }, [step]);

  const signIn = () => void run(() => watchSignIn(email.trim(), password, region, conflict)).then(() => setPassword(""), (e: unknown) => {
    if (said(e).includes("signed in somewhere else")) setConflict(true);
  });
  const pair = (name: string) => void run(() => pairWatch(name)).then(() => setPaired(true), () => undefined);
  const yours = status?.found.find((f) => f.name === status.paired?.name);

  return (
    <Dialog label="Pair your watch">
      <div className="lm-steps" aria-label="Steps">
        <span data-on="">Watch key</span><span data-on={step !== "key" ? "" : undefined}>Find the watch</span><span data-on={step === "connect" || step === "done" ? "" : undefined}>Connect</span>
      </div>
      {step === "key" ? (<>
        <h2>Get your watch key</h2>
        <p>The watch only answers to your COROS account&apos;s key. Sign in to COROS once and C-LINK keeps just the key, sealed on this computer.</p>
        <form className="lm-form" onSubmit={(e) => { e.preventDefault(); signIn(); }}>
          <label className="set-label">COROS email<Field type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label className="set-label">Password<Field type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="set-label">Region<Select field value={region} onChange={(e) => setRegion(e.target.value as Region)}>{REGIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</Select></label>
          {conflict ? <p className="lm-ask-note">Your COROS account is signed in somewhere else, maybe the COROS app. Continuing may sign it out there.</p> : null}
          <div className="lm-dialog-actions">
            <Button onClick={onClose}>Later</Button>
            <Button variant="primary" type="submit" disabled={busy === "signingIn" || !email || !password}>{busy === "signingIn" ? "Signing in…" : conflict ? "Continue anyway" : "Sign in"}</Button>
          </div>
        </form>
      </>) : null}
      {step === "find" ? (<>
        <h2>Pair your watch</h2>
        <p>Keep the watch next to this computer and close the COROS app on your phone.</p>
        <div className="lm-near">
          {(status?.found ?? []).map((w) => (
            <div key={w.name} className="lm-near-row" data-best={w === (yours ?? status?.found[0]) ? "" : undefined}>
              <span className="lm-near-face" aria-hidden="true" />
              <span className="lm-row-text"><strong>{w.display}</strong><span>{w.connected ? "Connected to this computer" : signal(w.rssi)}</span></span>
              <Bars on={bars(w.rssi)} />
              <Button variant={w === (yours ?? status?.found[0]) ? "primary" : "glass"} disabled={!!busy} onClick={() => pair(w.name)}>Pair</Button>
            </div>
          ))}
          {!busy && status && !status.found.length ? <p className="lm-quiet">No watch found. Wake the watch, keep it close, and search again.</p> : null}
        </div>
        <div className="lm-search">
          <span className="lm-quiet">{busy === "scanning" ? <><span className="lm-dots" aria-hidden="true"><i /><i /><i /></span> Looking for watches nearby</> : null}</span>
          <span className="lm-actions"><button type="button" className="set-link" disabled={!!busy} onClick={() => void run(scanWatches).catch(() => undefined)}>Search again</button><Button onClick={onClose}>Later</Button></span>
        </div>
      </>) : null}
      {step === "connect" ? (<>
        <h2>Connecting to your watch</h2>
        <p>Signing in to the watch with your watch key. Keep it close.</p>
        <div className="lm-progress" role="status"><div className="lm-progress-head"><span>{stepLabel(status?.step ?? null)}</span></div><span className="lm-step-bar" aria-hidden="true"><i className="lm-indeterminate" /></span></div>
      </>) : null}
      {step === "done" ? (<>
        <h2>Paired</h2>
        <p>The watch is paired to this computer. The first sync is under way: activities, sleep and health come in as it reads them.</p>
        <div className="lm-dialog-actions"><Button variant="primary" onClick={onClose}>Done</Button></div>
      </>) : null}
      {problem ? <p className="lm-problem" role="alert">{problem}</p> : null}
    </Dialog>
  );
}

const bars = (rssi?: number) => (rssi == null ? 2 : rssi > -60 ? 4 : rssi > -72 ? 3 : rssi > -84 ? 2 : 1);
const signal = (rssi?: number) => ["", "Weak signal", "Fair signal", "Good signal", "Strong signal"][bars(rssi)];

/* ───────────── Cards ───────────── */

/** Last sync and what's on this computer, above the watch's settings. Only in Local mode with a watch paired. */
export function LocalModeCards() {
  const mode = useMode();
  const status = useWatchLink();
  const now = useMinute();
  if (mode !== "localOnly" || !status?.paired) return null;
  const last = status.lastSync;
  const syncing = status.busy === "syncing";
  const rows = syncing
    ? [{ icon: I.act, hue: "mint", name: stepLabel(status.step), detail: status.step?.percent != null ? `${status.step.percent}%` : "", value: "" }]
    : last ? [
      { icon: I.act, hue: "mint", name: "Activities", detail: `${last.workouts} on the watch`, value: last.newActivities ? `${last.newActivities} new` : "None new" },
      { icon: I.moon, hue: "violet", name: "Sleep", detail: "From the watch's daily history", value: `${last.nights} ${last.nights === 1 ? "night" : "nights"}` },
      { icon: I.heart, hue: "blue", name: "Health", detail: "Steps, resting HR, HRV, stress", value: `${last.healthDays} ${last.healthDays === 1 ? "day" : "days"}` },
      ...(last.applied || last.refused ? [{ icon: I.send, hue: "gold", name: "To the watch", detail: last.refused ? `${last.refused} the watch didn't take` : "Goals, alarms and satellite systems", value: `${last.applied} sent` }] : []),
    ] : [];
  return (
    <>
      <Card className="wa-card wa-w7" aria-label="Last sync">
        <div className="wa-alarms-head"><h2>{syncing ? "Syncing" : "Last sync"}</h2>{last && !syncing ? <span className="lm-quiet">{whenSynced(last.at, now)}</span> : null}</div>
        {rows.length ? (
          <div className="lm-rows">
            {rows.map((r) => (
              <div key={r.name} className="lm-row">
                <span className="lm-ico" data-hue={r.hue}><Icon d={r.icon} /></span>
                <span className="lm-row-text"><strong>{r.name}</strong>{r.detail ? <span>{r.detail}</span> : null}</span>
                {r.value ? <span className="lm-row-end"><b>{r.value}</b></span> : null}
              </div>
            ))}
          </div>
        ) : <p className="lm-quiet">Not synced yet.</p>}
        {last?.problems.length && !syncing ? <p className="lm-quiet">Not read this time: {last.problems.map((p) => p.split(":")[0]).join(", ")}. The next sync tries again.</p> : null}
      </Card>
      <Card className="wa-card wa-w5" aria-label="On this computer">
        <h2>On this computer</h2>
        <div className="set-figures">
          <div className="set-figure"><span>Activities</span><strong className="num">{status.onComputer?.activities.toLocaleString() ?? "—"}</strong></div>
          <div className="set-figure"><span>Days of health</span><strong className="num">{status.onComputer?.healthDays.toLocaleString() ?? "—"}</strong></div>
          <div className="set-figure"><span>Nights of sleep</span><strong className="num">{status.onComputer?.nights.toLocaleString() ?? "—"}</strong></div>
        </div>
        <p className="lm-quiet">Each workout&apos;s FIT file is kept as the watch recorded it.</p>
      </Card>
    </>
  );
}

/** Under the page's own cards: the watch's settings and training profile, then the watch tools (find the watch, the
 * clock, the watch key and Local mode itself). */
export function LocalModeTools() {
  const mode = useMode();
  const status = useWatchLink();
  const [problem, setProblem] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [ringing, setRinging] = useState<"sending" | "sent" | null>(null);
  if (mode !== "localOnly" || !status?.paired) return null;
  const run = (work: () => Promise<unknown>) => { setProblem(null); work().catch((e: unknown) => setProblem(said(e))); };
  const ring = () => {
    setProblem(null); setRinging("sending");
    ringWatch().then(() => setRinging("sent"), (e: unknown) => { setRinging(null); setProblem(said(e)); });
  };
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <>
    <LocalWatchSettings />
    <WatchFacesCard />
    <Card className="wa-card lm-w12" aria-label="Watch tools">
      <h2>Watch tools</h2>
      <div className="lm-rows">
        <WeatherRow status={status} />
        <div className="lm-row">
          <span className="lm-ico" data-hue="gold"><Icon d={I.bell} /></span>
          <span className="lm-row-text"><strong>Find my watch</strong><span>{ringing === "sent" ? "Ringing. Press Back on the watch to stop it." : "Rings until you press Back on the watch"}</span></span>
          <span className="lm-row-end"><Button disabled={ringing === "sending"} onClick={ring}>{ringing === "sending" ? "Reaching the watch…" : ringing === "sent" ? "Ring again" : "Play sound"}</Button></span>
        </div>
        <div className="lm-row">
          <span className="lm-ico"><Icon d={I.clock} /></span>
          <span className="lm-row-text"><strong>Time and time zone</strong><span>Set from this computer each time the watch connects</span></span>
          <span className="lm-row-end"><span className="lm-done"><Icon d={I.check} size={14} />{zone}</span></span>
        </div>
        <div className="lm-row">
          <span className="lm-ico" data-hue="violet"><Icon d={I.key} /></span>
          <span className="lm-row-text"><strong>Watch key</strong><span>{status.account ? `From ${status.account}. ` : ""}Sealed on this computer; the watch only answers to it.</span></span>
          <span className="lm-row-end">
            {forgetting
              ? <><Button onClick={() => setForgetting(false)}>Keep it</Button><Button className="lm-danger" onClick={() => run(forgetWatchKey)}>Forget key and unpair</Button></>
              : <Button onClick={() => setForgetting(true)}>Forget</Button>}
          </span>
        </div>
        <div className="lm-row">
          <span className="lm-ico" data-hue="rose"><Icon d={I.laptop} /></span>
          <span className="lm-row-text"><strong>Local mode</strong><span>Leave to pair the watch with your phone again</span></span>
          <span className="lm-row-end">
            <Button onClick={() => run(unpairWatch)}>Unpair</Button>
            <Button className="lm-danger" onClick={() => run(() => setDataMode("connected"))}>Leave Local mode</Button>
          </span>
        </div>
      </div>
      {problem ? <p className="lm-problem" role="alert">{problem}</p> : null}
    </Card>
    </>
  );
}

/** Settings → Privacy: turning Local mode on asks the same way, then goes to Watch to pair. */
export function TurnOnFromSettings({ onCancel }: { onCancel: () => void }) {
  return <TurnOnDialog onCancel={onCancel} onDone={() => { onCancel(); navigate("/watch?pair=1"); }} />;
}
