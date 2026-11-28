"use client";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button, Card, Field, LinkButton, Switch } from "@/components/ui";
import { CoachError, loadCoachAccess, type CoachAccessInfo } from "@/data/coach";
import { NotWiredError } from "@/data/core";
import { connectHevy, disconnectHevy, openHevy, setHevyWarmups, syncHevyNow, useHevy, useHevyWarmups, type HevyView } from "@/data/hevy";
import { HubError, hubResendCode, hubSession, hubSignIn, hubSignOut, hubVerifyCode, useHubSession, type HubSessionInfo } from "@/data/hub";
import { disconnectIntervals, intervalsStatus, type IntervalsStatus } from "@/data/intervals";
import { SyncError, useSyncItems, useSyncStatus } from "@/data/sync";
import {
  COACH_KEY_WORDS, coachKeyConnected, connectedCount, hevyCachedLabel, hevyPill, hevyProgress, managedOnPhone,
  type ElsewhereRow, type MonoHue, type Tone,
} from "@/lib/connections";
import { lastSyncedText } from "@/lib/hevy";
import { t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { platformSlots } from "@/lib/platform";
import "./connect.css";

const said = (error: unknown): string =>
  error instanceof HubError || error instanceof SyncError || error instanceof CoachError || error instanceof NotWiredError
    ? error.message : t("C-LINK couldn't finish that. Try again.");

/** Runs one step, keeping `busy` and the failure message. */
function useStep() {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const run = (work: () => Promise<unknown>, done?: () => void) => {
    setBusy(true);
    setProblem(null);
    work().then(
      () => { setBusy(false); done?.(); },
      (error: unknown) => { setBusy(false); setProblem(said(error)); },
    );
  };
  return { busy, problem, run, clear: () => setProblem(null) };
}

function Problem({ text }: { text: string | null }) {
  return text ? <p role="alert" className="cn-problem">{text}</p> : null;
}

function Pill({ tone = "quiet", children }: { tone?: Tone; children: ReactNode }) {
  return <span className="cn-pill" data-tone={tone}>{children}</span>;
}

function Mono({ hue, children }: { hue: MonoHue; children: string }) {
  return <span aria-hidden="true" className="cn-mono" data-hue={hue}>{children}</span>;
}

/** One connection: monogram, name, one line, status pill, then its rows, forms and actions. */
function ConnectionCard({ mono, hue, name, line, pill, busy, children }: {
  mono: string; hue: MonoHue; name: string; line: string; pill: ReactNode; busy?: boolean; children?: ReactNode;
}) {
  return (
    <Card className="cn-card" aria-label={name} aria-busy={busy}>
      <div className="cn-card-head">
        <Mono hue={hue}>{mono}</Mono>
        <div className="cn-card-name"><h4>{name}</h4><span>{line}</span></div>
        {pill}
      </div>
      {children}
    </Card>
  );
}

// MARK: COROS Training Hub

function SignInForm({ session }: { session: HubSessionInfo }) {
  const [email, setEmail] = useState(session.email ?? "");
  const [password, setPassword] = useState("");
  const step = useStep();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    step.run(() => hubSignIn(email, password), () => setPassword(""));
  };
  return (
    <form onSubmit={submit} className="cn-form">
      {session.state === "ended" ? <div className="notice" role="status">{t("COROS signed you out. Sign in again.")}</div> : null}
      <label>
        {t("COROS email")}
        <Field type="email" name="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        {t("Password")}
        <Field type="password" name="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <Problem text={step.problem} />
      <div className="cn-card-actions">
        <Button type="submit" variant="primary" disabled={step.busy}>{step.busy ? t("Signing in…") : t("Sign in")}</Button>
      </div>
      <p className="cn-small">{t("Your password is hashed in this browser, sent to COROS through this app’s server, and not stored.")}</p>
    </form>
  );
}

function CodeForm({ session }: { session: HubSessionInfo }) {
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const step = useStep();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    step.run(() => hubVerifyCode(code));
  };
  return (
    <form onSubmit={submit} className="cn-form">
      <p>{tr("COROS emailed a 6-digit code to {email}.", { email: <strong style={{ overflowWrap: "anywhere" }}>{session.codeSentTo ?? session.email}</strong> })}</p>
      <label>
        {t("Code")}
        <Field
          name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
          className="num" style={{ maxWidth: 160, letterSpacing: "0.2em" }}
          value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
        />
      </label>
      <Problem text={step.problem} />
      {resent && !step.problem ? <p role="status" className="muted">{t("Sent again.")}</p> : null}
      <div className="cn-card-actions">
        <Button type="submit" variant="primary" disabled={step.busy || code.length !== 6}>{t("Verify")}</Button>
        <Button disabled={step.busy} onClick={() => { setResent(false); step.run(hubResendCode, () => setResent(true)); }}>{t("Send again")}</Button>
        <Button variant="plain" disabled={step.busy} onClick={() => step.run(hubSignOut)}>{t("Cancel")}</Button>
      </div>
    </form>
  );
}

function HubSignedIn({ session }: { session: HubSessionInfo }) {
  const step = useStep();
  return (
    <>
      <dl className="cn-rows">
        <div><dt>{t("Signed in as")}</dt><dd>{session.email}</dd></div>
        <div><dt>{t("Region")}</dt><dd>{session.region}</dd></div>
      </dl>
      <Problem text={step.problem} />
      <div className="cn-card-actions">
        <Button disabled={step.busy} onClick={() => step.run(hubSignOut)}>{t("Sign out")}</Button>
      </div>
    </>
  );
}

/** The athlete's COROS account through Training Hub: calendar, workouts, uploads and recordings. */
function HubCard({ session }: { session: HubSessionInfo | undefined }) {
  return (
    <ConnectionCard mono="CO" hue="coral" name={t("COROS account")} line={t("Calendar, workouts and uploads")}
      busy={session === undefined}
      pill={session === undefined ? null : session.state === "signedIn" ? <Pill tone="ok">{t("Connected")}</Pill> : <Pill>{t("Not connected")}</Pill>}>
      {session === undefined ? <p className="cn-note" role="status">{t("Checking…")}</p>
        : session.state === "signedIn" ? <HubSignedIn session={session} />
        : session.state === "needsCode" ? <CodeForm session={session} />
        : <SignInForm key={session.state} session={session} />}
    </ConnectionCard>
  );
}

// MARK: Hevy

const HEVY_DEVELOPER_SETTINGS = "https://hevy.com/settings?developer";

function HevyConnectForm() {
  const [apiKey, setApiKey] = useState("");
  const step = useStep();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    step.run(() => connectHevy(apiKey), () => setApiKey(""));
  };
  return (
    <form onSubmit={submit} className="cn-form">
      <label>
        {t("Hevy API key")}
        <Field type="password" name="hevy-api-key" autoComplete="off" spellCheck={false} placeholder={t("Paste API key")} required
          value={apiKey} disabled={step.busy} onChange={(event) => setApiKey(event.target.value)} />
      </label>
      <Problem text={step.problem} />
      <div className="cn-card-actions">
        <Button type="submit" variant="primary" disabled={step.busy || !apiKey.trim()}>{step.busy ? t("Connecting…") : t("Connect")}</Button>
        <a className="cn-link" href={HEVY_DEVELOPER_SETTINGS} target="_blank" rel="noreferrer">{t("Open Hevy developer settings")}</a>
      </div>
      <p className="cn-small">{t("Hevy’s API needs Hevy Pro. The key is checked with Hevy and kept sealed on this computer, and your paired phone gets it when it syncs; nothing is written to Hevy.")}</p>
    </form>
  );
}

function HevyConnected({ hevy }: { hevy: HevyView }) {
  const step = useStep();
  const warmups = useHevyWarmups();
  const [confirming, setConfirming] = useState(false);
  const busy = step.busy || hevy.syncing;
  const progress = hevy.syncing ? hevyProgress(hevy.progress) : null;
  const cached = hevyCachedLabel(hevy.workouts);
  return (
    <>
      <dl className="cn-rows">
        {hevy.status?.name ? <div><dt>{t("Account")}</dt><dd>{hevy.status.name}</dd></div> : null}
        <div><dt>{t("Last synced")}</dt><dd role="status">{hevy.syncing ? progress ?? t("Syncing…") : lastSyncedText(hevy.lastSyncedAt, new Date())}</dd></div>
        {cached ? <div><dt>{t("Kept in this browser")}</dt><dd>{cached}</dd></div> : null}
        <div className="cn-row-switch">
          <dt>{t("Include warm-up sets")}</dt>
          <dd><Switch label={t("Include warm-up sets")} checked={warmups} onChange={setHevyWarmups} /></dd>
        </div>
      </dl>
      {/* A failed sync is shown until the next one works; a failed button press until the next press. */}
      <Problem text={step.problem ?? hevy.syncProblem} />
      {confirming ? (
        <div className="notice" role="alertdialog" aria-label={t("Disconnect and erase cache")}>
          <span>{t("Disconnect Hevy here and on your phone, and erase its workouts from this browser? Your Hevy account keeps everything.")}</span>
          <span className="actions">
            <Button variant="ink" disabled={step.busy} onClick={() => step.run(disconnectHevy)}>{step.busy ? t("Erasing…") : t("Disconnect")}</Button>
            <Button variant="plain" disabled={step.busy} onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
          </span>
        </div>
      ) : (
        <div className="cn-card-actions">
          <Button disabled={busy} onClick={() => step.run(syncHevyNow)}>{hevy.syncing ? t("Syncing…") : t("Sync now")}</Button>
          <Button disabled={step.busy} onClick={() => { step.clear(); setConfirming(true); }}>{t("Disconnect and erase cache")}</Button>
        </div>
      )}
    </>
  );
}

function HevyCard({ hevy }: { hevy: HevyView }) {
  const connected = hevy.status?.connected === true;
  const pill = hevyPill({ connected, syncing: hevy.syncing, syncProblem: hevy.syncProblem });
  return (
    <ConnectionCard mono="HV" hue="blue" name="Hevy" line={t("Finished gym workouts, read only")} busy={hevy.read === "checking" || hevy.syncing}
      pill={hevy.read === "checking" ? null : hevy.read === "failed" ? <Pill>{t("Couldn’t check")}</Pill> : (
        <span className="cn-pills" role="status">{hevy.status?.mock ? <Pill>{t("Dev mock")}</Pill> : null}<Pill tone={pill.tone}>{t(pill.text)}</Pill></span>
      )}>
      {hevy.read === "checking" ? <p className="cn-note" role="status">{t("Checking…")}</p> : null}
      {hevy.read === "failed" ? (
        <>
          <Problem text={hevy.problem} />
          <div className="cn-card-actions"><Button onClick={() => { void openHevy(); }}>{t("Try again")}</Button></div>
        </>
      ) : null}
      {hevy.read === "known" ? (connected ? <HevyConnected hevy={hevy} /> : <HevyConnectForm />) : null}
    </ConnectionCard>
  );
}

// MARK: intervals.icu and Coach's AI

/** What a status read came to: not back yet, the status, or why it couldn't be read. */
type Read<T> = { state: "checking" } | { state: "known"; value: T } | { state: "failed"; problem: string };

function IntervalsCard({ read, onChange }: { read: Read<IntervalsStatus>; onChange: (next: IntervalsStatus) => void }) {
  const step = useStep();
  const status = read.state === "known" ? read.value : null;
  return (
    <ConnectionCard mono="IC" hue="pink" name="intervals.icu" line={t("Imports activities COROS is missing")} busy={read.state === "checking"}
      pill={read.state === "checking" ? null : status?.connected ? <Pill tone="ok">{t("Connected")}</Pill> : status ? <Pill>{t("Not connected")}</Pill> : <Pill>{t("Couldn’t check")}</Pill>}>
      {read.state === "checking" ? <p className="cn-note" role="status">{t("Checking…")}</p> : null}
      {read.state === "failed" ? <Problem text={read.problem} /> : null}
      {status?.connected && status.athleteId ? (
        <dl className="cn-rows"><div><dt>{t("Athlete")}</dt><dd>{status.athleteId}</dd></div></dl>
      ) : null}
      <Problem text={step.problem} />
      {read.state === "checking" ? null : (
        <div className="cn-card-actions">
          {status?.connected ? (
            <>
              <LinkButton href="/activities/import">{t("Open import")}</LinkButton>
              <Button disabled={step.busy} onClick={() => step.run(() => disconnectIntervals().then(onChange))}>{t("Disconnect")}</Button>
            </>
          ) : <LinkButton href="/activities/import">{status ? t("Set up") : t("Open import")}</LinkButton>}
        </div>
      )}
    </ConnectionCard>
  );
}

function CoachKeyCard({ read }: { read: Read<CoachAccessInfo> }) {
  const access = read.state === "known" ? read.value : null;
  return (
    <ConnectionCard mono="AI" hue="amber" name="AI" line={access?.model || (access?.key === "mock" ? t("Dev mock") : tx("model", "None yet"))} busy={read.state === "checking"}
      pill={read.state === "checking" ? null : access ? <Pill tone={coachKeyConnected(access.key) ? "ok" : "quiet"}>{t(COACH_KEY_WORDS[access.key])}</Pill> : <Pill>{t("Couldn’t check")}</Pill>}>
      {read.state === "checking" ? <p className="cn-note" role="status">{t("Checking…")}</p> : null}
      {read.state === "failed" ? <Problem text={read.problem} /> : null}
      {access && platformSlots.aiSettingsHref ? (
        <div className="cn-card-actions"><LinkButton href={platformSlots.aiSettingsHref}>{access.key === "own" ? t("Change") : t("Set up")}</LinkButton></div>
      ) : null}
    </ConnectionCard>
  );
}

// MARK: Quiet lists

function ElsewhereList({ title, rows }: { title: string; rows: readonly ElsewhereRow[] }) {
  return (
    <Card className="cn-list" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {rows.map((row) => (
          <li key={row.mono}>
            <span className="cn-list-what">
              <Mono hue={row.hue}>{row.mono}</Mono>
              <span><b>{row.name}</b><small>{t(row.line)}</small></span>
            </span>
            <Pill>{t(row.where)}</Pill>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function ConnectPage() {
  const sync = useSyncStatus();
  const session = useHubSession();
  const watchState = useSyncItems("watch.state")[0]?.body;
  const [intervals, setIntervals] = useState<Read<IntervalsStatus>>({ state: "checking" });
  const [coachKey, setCoachKey] = useState<Read<CoachAccessInfo>>({ state: "checking" });
  const hevy = useHevy();

  // Once per visit, ask COROS whether the session still stands, so an ended one shows here and not mid-task.
  useEffect(() => { hubSession(true).catch(() => {}); }, []);
  // Hevy: whether a key is saved, what this browser has cached, and Hevy's changes when that is over 15 minutes old.
  useEffect(() => { void openHevy(); }, []);
  // The other two connections only say what this browser's sealed cookies hold; neither read leaves this app's server.
  useEffect(() => {
    let live = true;
    const readIntervals = () => intervalsStatus().then(
      (value) => { if (live) setIntervals({ state: "known", value }); },
      (error: unknown) => { if (live) setIntervals({ state: "failed", problem: said(error) }); },
    );
    void readIntervals();
    // Connected or disconnected in another browser: the sync pull that brought it says so.
    const changed = (event: Event) => { if ((event as CustomEvent<string[]>).detail?.includes("intervals")) void readIntervals(); };
    window.addEventListener("clink:connections", changed);
    loadCoachAccess().then(
      (value) => { if (live) setCoachKey({ state: "known", value }); },
      (error: unknown) => { if (live) setCoachKey({ state: "failed", problem: said(error) }); },
    );
    return () => { live = false; window.removeEventListener("clink:connections", changed); };
  }, []);

  const checking = session === undefined || intervals.state === "checking" || coachKey.state === "checking" || hevy.read === "checking";
  const connected = connectedCount([
    session?.state === "signedIn",
    hevy.read === "known" && hevy.status?.connected,
    intervals.state === "known" && intervals.value.connected,
    coachKey.state === "known" && coachKeyConnected(coachKey.value.key),
  ]);

  return (
    <main className="page cn-page">
      {platformSlots.connectProfile ? <platformSlots.connectProfile /> : null}

      <div className="cn-heading">
        <h2>{t("Connections")}</h2>
        {checking ? null : <Pill tone={connected > 0 ? "ok" : "quiet"}>{t("{n} connected", { n: connected })}</Pill>}
      </div>

      <section className="cn-group" aria-label={t("Training")}>
        <h3>{t("Training")}</h3>
        <div className="cn-grid">
          <HubCard session={session} />
          <HevyCard hevy={hevy} />
          <IntervalsCard read={intervals} onChange={(value) => setIntervals({ state: "known", value })} />
        </div>
      </section>

      <section className="cn-group" aria-label={t("Coach")}>
        <h3>{t("Coach")}</h3>
        <div className="cn-grid">
          <CoachKeyCard read={coachKey} />
        </div>
      </section>

      <ElsewhereList title={t("Managed on your phone")} rows={managedOnPhone(sync.viewer ? watchState?.model ?? watchState?.name : null)} />
    </main>
  );
}
