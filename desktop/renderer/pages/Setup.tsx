// First-run setup: Coach walks you through where your data comes from, pairing the phone, your sports, Coach's AI
// and this computer. The step lives in the address (setupFlow.ts). Everything here uses the app's own calls: the phone
// pairing of Connections, the sample store of Developer, the backup restore of Settings and the AI of Coach settings.
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Field, Select, Switch } from "@/components/ui";
import { AIProblem, connectAI, detectLocalAI, pickAI, readAI, signInAndWait, type AIStatus } from "../ai";
import { readDeveloper } from "../developer";
import { language, locale, msg, t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { computerWord } from "../computer";
import { navigate, useLocation } from "../router";
import { changeSetup, readSetup, type SetupState, type SportTile } from "../setup";
import { backStep, coachSays, countdown, LIST, listIndex, listLabel, nextStep, placeHref, readPlace, stepNote, type Place, type Source } from "../setupFlow";
import { restoreBackup, SettingsProblem } from "../settings";
import { FirewallNote, type FirewallState } from "../parts/FirewallNote";
import "../parts/localMode.css";
import "./setup.css";

const said = (e: unknown) => (e instanceof AIProblem || e instanceof SettingsProblem || e instanceof Error ? e.message : t("That didn't work."));

/** Sample data on or off; the window then starts over on the store it now reads (main.ts). */
async function setSample(on: boolean): Promise<void> {
  await fetch("/api/desktop/developer", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sample: on }) });
}

export default function Setup() {
  const { search } = useLocation();
  const place = readPlace(search);
  const { step, source } = place;
  const go = (to: Partial<Place>) => navigate(placeHref({ ...place, ...to }));
  const [setup, setSetup] = useState<SetupState | null>(null);
  const [ai, setAI] = useState<AIStatus | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => {
    void readSetup().then(setSetup);
    readAI().then(setAI, () => setAI(null));
    // The phone paired here, for the note beside Connect (the phone step keeps it current while open).
    ask<PhoneStatus>("/api/desktop/phones").then((s) => setPhone(s.phones.slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0]?.label ?? null), () => {});
  }, [step]);

  const hasData = !!setup && Object.keys(setup.found).length > 0;
  const coach = coachSays(step, { paired: !!phone, hasData });
  const coachName = ai?.providers.find((p) => p.id === ai.picked && p.ready)?.name ?? null;
  const at = listIndex(step);
  const notes = { phone, sports: setup?.sports?.length ?? 0, coach: coachName };

  return (
    <div className="ob">
      <header className="ob-bar">
        <span className="ob-brand"><img className="ob-mark" src="/img/clink-mark.png" alt="" />C-LINK</span>
        {step !== "done" ? <button type="button" className="ob-link ob-skip" onClick={() => go({ step: "done" })}>{t("Skip setup")}</button> : null}
      </header>
      <div className="ob-main">
        <aside className="ob-side">
          <div className="ob-coach">
            <img src={`/img/coach-${coach.pose}.webp`} alt="" />
            <div className="ob-bubble" role="status">{coach.line}</div>
          </div>
          <ol className="ob-steps" aria-label={t("Setup steps")}>
            {LIST.map((item, i) => (
              <li key={item.id} data-now={i === at ? "" : undefined} data-done={i < at ? "" : undefined} aria-current={i === at ? "step" : undefined}>
                <span className="ob-num">{i < at ? <Check size={13} /> : i + 1}</span>
                {listLabel(item)}
                <small>{i < at ? stepNote(item.id, source, notes) : ""}</small>
              </li>
            ))}
          </ol>
        </aside>
        <section className="card ob-panel" aria-labelledby="ob-title">
          {step === "source" ? <SourceStep source={source} onNext={(s) => go({ step: nextStep("source", s), source: s })} /> : null}
          {step === "phone" ? <PhoneStep onPaired={setPhone} onBack={() => go({ step: "source" })} onNext={() => go({ step: "sports" })} /> : null}
          {step === "sports" ? <SportsStep setup={setup} hasData={hasData} onSaved={setSetup} onBack={() => go({ step: backStep("sports", source) })} onNext={() => go({ step: "coach" })} /> : null}
          {step === "coach" ? <CoachStep ai={ai} onChange={setAI} onBack={() => go({ step: "sports" })} onNext={() => go({ step: "mac" })} /> : null}
          {step === "mac" ? <MacStep setup={setup} onSaved={setSetup} onBack={() => go({ step: "coach" })} onNext={() => go({ step: "done" })} /> : null}
          {step === "done" ? <DoneStep setup={setup} source={source} coach={coachName} onStartOver={() => go({ step: "source" })} /> : null}
        </section>
      </div>
    </div>
  );
}

/* ───────────── Your data ───────────── */

function SourceStep({ source, onNext }: { source: Source; onNext: (s: Source) => void }) {
  const [picked, setPicked] = useState<"phone" | "look">(source === "look" ? source : "phone");
  const [sample, setSampleOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  useEffect(() => { void readDeveloper().then((d) => setSampleOn(d ? d.sample : null)); }, []);

  // Turning sample data on or off starts the window over on the other store, so the next step is loaded fresh.
  const next = async () => {
    setBusy(true);
    const wantSample = picked === "look";
    if (sample !== null && sample !== wantSample) {
      await setSample(wantSample);
      window.location.assign(placeHref({ step: nextStep("source", picked), source: picked }));
      return;
    }
    onNext(picked);
  };

  // Settings' restore: a file picked in a native dialog, into the data on this computer. The window starts over
  // after it, so the address is moved on to the next step first.
  const restore = async () => {
    setBusy(true);
    setProblem(null);
    const here = location.pathname + location.search;
    try {
      if (sample) await setSample(false);
      history.replaceState(history.state, "", placeHref({ step: "sports", source: "backup" }));
      const done = await restoreBackup(passphrase);
      if (done.cancelled) { history.replaceState(history.state, "", here); setBusy(false); if (sample) window.location.reload(); }
    } catch (e) {
      history.replaceState(history.state, "", here);
      if (e instanceof SettingsProblem && e.code === "passphrase") setNeedsPassphrase(true);
      setProblem(said(e));
      setBusy(false);
    }
  };

  return (
    <>
      <h1 id="ob-title">{t("Where should your data come from?")}</h1>
      <div className="ob-sources" role="radiogroup" aria-label={t("Where your data comes from")}>
        <button type="button" role="radio" className="ob-source" aria-checked={picked === "phone"} onClick={() => setPicked("phone")}>
          <span className="ob-art" aria-hidden="true"><Glyph d={WATCH} size={22} /><Dots /><Glyph d={PHONE} size={22} /><Dots /><Glyph d={MAC} size={22} /></span>
          <span className="ob-src-text"><strong>{t("C-LINK on my phone")} <span className="ob-tag">{t("Recommended")}</span></strong><span>{t("Your phone keeps syncing the watch and copies everything here. Works with the COROS app too.")}</span></span>
          <span className="ob-radio" aria-hidden="true" />
        </button>
        <button type="button" role="radio" className="ob-source" aria-checked={picked === "look"} disabled={sample === null} onClick={() => setPicked("look")}>
          <span className="ob-art" aria-hidden="true"><Glyph d={EYE} size={22} /></span>
          <span className="ob-src-text"><strong>{t("Just look around")}</strong><span>{t("A sample athlete's year. Pair your phone later on Connections.")}</span></span>
          <span className="ob-radio" aria-hidden="true" />
        </button>
      </div>
      <div className="ob-restore">
        <Glyph d={FOLDER} size={15} />
        <span>{t("Moving from another computer?")}</span>
        {needsPassphrase ? <Field type="password" className="ob-pass" aria-label={t("Backup passphrase")} placeholder={t("Passphrase")} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} /> : null}
        <button type="button" className="ob-text-link" disabled={busy || (needsPassphrase && !passphrase)} onClick={() => void restore()}>{t("Restore a backup")}</button>
      </div>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      <Foot><Button variant="primary" disabled={busy} onClick={() => void next()}>{t("Continue")}</Button></Foot>
    </>
  );
}

/* ───────────── Pair with your phone ───────────── */

interface Phone { id: string; label: string; createdAt: string; lastUsedAt: string }
interface PhoneStatus { listening: boolean; items: number; phones: Phone[]; firewall?: FirewallState }
interface Pairing { link: string; qr: string; expiresAt: string }

async function ask<T>(path: string, init?: RequestInit): Promise<T> {
  const answer = await fetch(path, { cache: "no-store", ...init });
  const body = (await answer.json()) as T & { error?: { message: string } };
  if (!answer.ok) throw new Error(body.error?.message ?? t("That didn't work."));
  return body;
}

const ago = (iso: string, now: number): string => {
  const minutes = Math.round((now - Date.parse(iso)) / 60_000);
  if (minutes < 1) return t("just now");
  if (minutes < 60) return t("{n} min ago", { n: minutes });
  const hours = Math.round(minutes / 60);
  return hours < 24 ? t("{n} h ago", { n: hours }) : new Date(iso).toLocaleDateString(language() === "en" ? undefined : locale(), { day: "numeric", month: "short" });
};

function PhoneStep({ onPaired, onBack, onNext }: { onPaired: (label: string | null) => void; onBack: () => void; onNext: () => void }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null);
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [data, setData] = useState<SetupState["data"]>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  // When the counts last grew, to tell copying from copied.
  const last = useRef(-1);
  const [grewAt, setGrewAt] = useState(0);

  const newest = status?.phones.slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0] ?? null;
  // The code on show: asked for while no phone is paired and none is up, again when it runs out. Not again after a
  // problem until "Try again".
  const code = useRef<{ expiresAt: number; asking: boolean; stopped: boolean }>({ expiresAt: 0, asking: false, stopped: false });
  const pair = useCallback(() => {
    code.current = { ...code.current, asking: true, stopped: false };
    setProblem(null);
    ask<Pairing>("/api/desktop/phones/pair", { method: "POST" }).then(
      (p) => { code.current = { expiresAt: Date.parse(p.expiresAt), asking: false, stopped: false }; setNow(Date.now()); setPairing(p); },
      (e: unknown) => { code.current = { expiresAt: 0, asking: false, stopped: true }; setProblem(said(e)); },
    );
  }, []);

  // Every two seconds: a phone pairing, the code counting down, and what has come in.
  useEffect(() => {
    let live = true;
    const read = () => {
      setNow(Date.now());
      ask<PhoneStatus>("/api/desktop/phones").then((s) => {
        if (!live) return;
        setStatus(s);
        const c = code.current;
        if (s.phones.length === 0 && !c.asking && !c.stopped && Date.now() >= c.expiresAt) pair();
      }, (e: unknown) => { if (live) setProblem(said(e)); });
      void readSetup().then((s) => {
        if (!live || !s?.data) return;
        const total = s.data.activities + s.data.healthDays + s.data.other;
        if (last.current >= 0 && total !== last.current) setGrewAt(Date.now());
        last.current = total;
        setData(s.data);
      });
    };
    read();
    const timer = setInterval(read, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [pair]);

  const label = newest?.label ?? null;
  useEffect(() => { onPaired(label); }, [label, onPaired]);
  const left = pairing ? Math.max(0, Math.round((Date.parse(pairing.expiresAt) - now) / 1000)) : 0;

  const copying = !data || data.activities + data.healthDays + data.other === 0 || now - grewAt < 8000;

  return (
    <>
      <h1 id="ob-title">{newest ? t("Paired with your phone") : t("Pair with C-LINK on your phone")}</h1>
      {newest ? (
        <>
          <div className="ob-got">
            <span className="ob-phone" aria-hidden="true" />
            <span className="lm-row-text"><strong>{newest.label}</strong><span>{t("Paired {when} · syncs on the same Wi-Fi", { when: ago(newest.createdAt, now) })}</span></span>
            <span className="lm-done ob-end"><Check size={15} />{t("Paired")}</span>
          </div>
          {status && !status.listening ? <p className="notice" role="alert">{t("Phones can't reach this computer right now.")}</p> : null}
          <div className="ob-sync" role="status">
            <div className="ob-sync-head"><span>{copying ? t("Copying from your phone") : t("Up to date")}</span><span className="muted">{copying ? "" : t("Synced {when}", { when: ago(newest.lastUsedAt, now) })}</span></div>
            <span className="lm-step-bar" aria-hidden="true"><i className={copying ? "lm-indeterminate" : undefined} style={copying ? undefined : { width: "100%" }} /></span>
          </div>
          <div className="lm-rows">
            <Row icon={PULSE} hue="mint" title={t("Activities")} detail={t("Every workout with its FIT file")} end={data ? data.activities.toLocaleString(locale("en-GB")) : "…"} />
            <Row icon={MOON} hue="violet" title={t("Sleep and health")} detail={t("Sleep, HRV, resting HR, Energy, steps")} end={data ? (data.healthDays === 1 ? t("1 day") : t("{n} days", { n: data.healthDays.toLocaleString(locale("en-GB")) })) : "…"} />
            <Row icon={CALENDAR} hue="gold" title={t("Gym log, plans and Fuel")} detail={t("Workouts, routines, meals")} end={data ? data.other.toLocaleString(locale("en-GB")) : "…"} />
          </div>
        </>
      ) : (
        <div className="ob-pair">
          <div className="ob-qr">
            <div className="ob-qr-box">{pairing ? <span role="img" aria-label={t("Pairing code for your phone")} dangerouslySetInnerHTML={{ __html: pairing.qr }} /> : <span className="ob-qr-empty" />}</div>
            <span className="ob-qr-time">{pairing ? t("Code works for {time}", { time: countdown(left) }) : problem ? t("No code") : t("Making a code…")}</span>
          </div>
          <div className="ob-pair-side">
            <ol className="ob-howto">
              <li><span>{tr("Open {app} on your phone", { app: <b>C-LINK</b> })}</span></li>
              <li><span>{tr("Go to {place}", { place: <b>{t("Settings → Computers")}</b> })}</span></li>
              <li><span>{tr("Tap {button} and scan this code", { button: <b>{t("Add a computer")}</b> })}</span></li>
            </ol>
            {problem ? <div className="notice ob-problem" role="alert">{problem}<Button onClick={pair}>{t("Try again")}</Button></div>
              : <div className="ob-wait" role="status"><Dots />{t("Waiting for your phone")}</div>}
            <FirewallNote state={status?.firewall} />
            <Note icon={WIFI} hue="blue">{t("On the same Wi-Fi it syncs straight to this {computer}.", { computer: computerWord() })}</Note>
            {pairing ? (
              <Note icon={KEY}>
                {t("Can't scan? Copy the code and paste it into C-LINK on your phone.")}
                <button type="button" className="ob-text-link" onClick={() => void navigator.clipboard.writeText(pairing.link).then(() => setCopied(true))}>{copied ? t("Copied") : t("Copy code")}</button>
              </Note>
            ) : null}
          </div>
        </div>
      )}
      <Foot onBack={onBack}>
        {!newest ? <button type="button" className="ob-link" onClick={onNext}>{t("Do this later")}</button> : null}
        <Button variant="primary" disabled={!newest} onClick={onNext}>{t("Continue")}</Button>
      </Foot>
    </>
  );
}

/* ───────────── Your sports ───────────── */

const SPORTS: { id: SportTile; name: string; d: string }[] = [
  { id: "run", name: msg("Running"), d: "M13 4a2 2 0 1 0 0 .01M9 20l3-6 3 3v4M6 12l3-4 4 1 3 4 3-1" },
  { id: "trail", name: msg("Trail running"), d: "M3 20l6-10 4 6 3-4 5 8zM13 4a2 2 0 1 0 0 .01" },
  { id: "ride", name: msg("Riding"), d: "M6 18a3 3 0 1 0 0-.01M18 18a3 3 0 1 0 0-.01M6 18l4-8h5l3 8M10 10l-1-3h3M15 10l-2 8" },
  { id: "swim", name: msg("Swimming"), d: "M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M7 13l4-5 4 3 3-3M17 6a2 2 0 1 0 0 .01" },
  { id: "lift", name: msg("Strength"), d: "M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9" },
  { id: "hike", name: msg("Hiking"), d: "M12 4a2 2 0 1 0 0 .01M9 21l2-7 3 3v4M7 11l3-3 3 1 2 3M18 9v12" },
  { id: "tri", name: msg("Triathlon"), d: "M12 3l9 16H3zM12 9v5" },
  { id: "ski", name: msg("Skiing"), d: "M4 20l16-6M9 5a2 2 0 1 0 0 .01M8 9l4 2-2 4 4 2" },
  { id: "row", name: msg("Rowing"), d: "M3 16h18M6 16l4-6h4l4 6M12 4a2 2 0 1 0 0 .01" },
  { id: "climb", name: msg("Climbing"), d: "M6 21l3-9 4-2 2-6M14 4a2 2 0 1 0 0 .01M9 12l-3-2M13 10l4 3" },
  { id: "yoga", name: msg("Yoga"), d: "M12 4a2 2 0 1 0 0 .01M4 12h16M12 8v6l-4 6M12 14l4 6" },
  { id: "hybrid", name: msg("Hybrid fitness"), d: "M4 12h3l2-5 3 10 2-5h6M18 7l2 2-2 2" },
];
const sportNames = (ids: readonly SportTile[]) => SPORTS.filter((s) => ids.includes(s.id)).map((s) => tx("sport", s.name));

function SportsStep({ setup, hasData, onSaved, onBack, onNext }: { setup: SetupState | null; hasData: boolean; onSaved: (s: SetupState) => void; onBack: () => void; onNext: () => void }) {
  const [picks, setPicks] = useState<SportTile[] | null>(null);
  const shown = picks ?? setup?.sports ?? setup?.picked ?? [];
  const [busy, setBusy] = useState(false);
  const flip = (id: SportTile) => setPicks(shown.includes(id) ? shown.filter((s) => s !== id) : [...shown, id]);
  const save = () => { setBusy(true); changeSetup({ sports: shown }).then((s) => { onSaved(s); onNext(); }, () => setBusy(false)); };
  return (
    <>
      <h1 id="ob-title">{t("Which sports do you do?")}</h1>
      <p>{t("Coach follows what you pick.")}</p>
      {hasData ? <div className="ob-found"><span className="lm-done"><Glyph d={SPARK} size={15} />{t("Worked out from your workouts")}</span>{t("Counts are from the last 6 months.")}</div> : null}
      <div className="ob-sports">
        {SPORTS.map((s) => (
          <button key={s.id} type="button" className="ob-sport" aria-pressed={shown.includes(s.id)} disabled={!setup} onClick={() => flip(s.id)}>
            <Glyph d={s.d} size={20} />{tx("sport", s.name)}<small className="num">{setup?.found[s.id] ?? ""}</small>
          </button>
        ))}
      </div>
      <Foot onBack={onBack}><Button variant="primary" disabled={!setup || busy} onClick={save}>{t("Continue")}</Button></Foot>
    </>
  );
}

/* ───────────── Coach ───────────── */

/** Names and lines are English with {computer} for "Mac" / "PC" / "computer"; `say` gives them on screen. */
type Choice = "chatgpt" | "claude-code" | "gemini-cli" | "key" | "local";
const CHOICES: { id: Choice; mono: string; tone: string; name: string; line: string }[] = [
  { id: "chatgpt", mono: "C", tone: "mint", name: "ChatGPT", line: msg("Sign in with your ChatGPT plan") },
  { id: "claude-code", mono: "C", tone: "orange", name: "Claude Code", line: msg("Uses Claude Code on this {computer}") },
  { id: "gemini-cli", mono: "G", tone: "cyan", name: "Gemini", line: msg("Sign in with Google") },
  { id: "key", mono: "", tone: "violet", name: msg("Your own API key"), line: "OpenAI, Anthropic, Gemini, DeepSeek, OpenRouter" },
  { id: "local", mono: "PC", tone: "honey", name: msg("A model on this {computer}"), line: msg("Ollama or LM Studio. Nothing leaves the {computer}") },
];
const say = (text: string) => t(text, { computer: computerWord() });

function CoachStep({ ai, onChange, onBack, onNext }: { ai: AIStatus | null; onChange: (s: AIStatus) => void; onBack: () => void; onNext: () => void }) {
  const pickedNow = ai?.providers.find((p) => p.id === ai.picked);
  const keyed = ai?.providers.filter((p) => p.group === "key") ?? [];
  const [choice, setChoice] = useState<Choice | null>(null);
  const shown: Choice = choice ?? (pickedNow ? (pickedNow.group === "key" ? "key" : pickedNow.group === "computer" ? "local" : (pickedNow.id as Choice)) : "chatgpt");
  const [keyProvider, setKeyProvider] = useState<string | null>(null);
  const provider = keyProvider ?? (pickedNow?.group === "key" ? pickedNow.id : "openai");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const id = shown === "key" ? provider : shown;
  const p = ai?.providers.find((x) => x.id === id);
  const choiceName = CHOICES.find((c) => c.id === shown)?.name;
  const cta = p?.ready ? t("Use {name}", { name: shown === "key" ? p.name : choiceName ? say(choiceName) : "" })
    : { chatgpt: t("Sign in with ChatGPT"), "claude-code": t("Use Claude Code"), "gemini-cli": t("Sign in with Google"), key: t("Save key"), local: t("Find models") }[shown];

  // The calls Coach settings makes: sign in, a key checked by asking the provider, or the local server found.
  const go = async () => {
    if (!p) return;
    setBusy(true);
    setProblem(null);
    try {
      let status: AIStatus;
      if (shown === "key" && !p.ready) status = await connectAI(p.id, { key });
      else if (shown === "local" && !p.ready) status = await connectAI("local", { url: (await detectLocalAI()).url });
      // Claude Code's sign-in finishes in the browser: this waits for it, since the athlete picked it here.
      else if (!p.ready) status = await signInAndWait(p.id);
      else status = ai ?? (await readAI());
      if (status.picked !== p.id) status = await pickAI(p.id);
      onChange(status);
      onNext();
    } catch (e) {
      setProblem(said(e));
      setBusy(false);
    }
  };

  return (
    <>
      <h1 id="ob-title">{t("Who answers as Coach?")}</h1>
      <p>{t("Coach reads your workouts, sleep and plan. Only what you ask about goes to the AI you pick.")}</p>
      <div className="ob-ais" role="radiogroup" aria-label={t("Coach's AI")}>
        {CHOICES.map((c) => {
          const ready = c.id === "key" ? keyed.some((k) => k.ready) : ai?.providers.find((x) => x.id === c.id)?.ready;
          return (
            <button key={c.id} type="button" role="radio" className="ob-ai" aria-checked={shown === c.id} disabled={busy} onClick={() => { setChoice(c.id); setProblem(null); }}>
              <span className="ob-tile" data-tone={c.tone} aria-hidden="true">{c.mono || <Glyph d={KEY} size={15} />}</span>
              <span className="lm-row-text"><strong>{say(c.name)}</strong><span>{ready ? (c.id === "key" ? t("{names} saved", { names: keyed.filter((k) => k.ready).map((k) => k.name).join(", ") }) : t("Ready on this {computer}", { computer: computerWord() })) : say(c.line)}</span></span>
            </button>
          );
        })}
      </div>
      {shown === "key" ? (
        <div className="ob-keyrow">
          <Select aria-label={t("Provider")} value={provider} onChange={(e) => { setKeyProvider(e.target.value); setProblem(null); }}>
            {keyed.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </Select>
          {p?.ready ? <Field readOnly aria-label={t("API key")} value={t("Saved on this computer")} />
            : <Field type="password" aria-label={t("API key")} autoComplete="off" spellCheck={false} placeholder={p?.keyHint ? t("Paste your API key ({hint})", { hint: p.keyHint }) : t("Paste your API key")} value={key} onChange={(e) => setKey(e.target.value)} />}
        </div>
      ) : null}
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      <Foot onBack={onBack}>
        <button type="button" className="ob-link" onClick={onNext}>{t("Not now")}</button>
        <Button variant="primary" disabled={!p || busy || (shown === "key" && !p.ready && !key.trim())} onClick={() => void go()}>
          {busy ? (p?.group === "account" ? t("Waiting for sign-in…") : t("Checking…")) : cta}
        </Button>
      </Foot>
    </>
  );
}

/* ───────────── This computer ───────────── */

function MacStep({ setup, onSaved, onBack, onNext }: { setup: SetupState | null; onSaved: (s: SetupState) => void; onBack: () => void; onNext: () => void }) {
  const flip = (change: Parameters<typeof changeSetup>[0]) => void changeSetup(change).then(onSaved);
  return (
    <>
      <h1 id="ob-title">{t("How C-LINK runs on this {computer}", { computer: computerWord() })}</h1>
      <div className="ob-switches">
        <div className="lm-option">
          <span className="lm-ico" data-hue="mint" aria-hidden="true"><Glyph d={POWER} size={18} /></span>
          <span className="lm-row-text"><strong>{t("Open at login")}</strong>{setup?.openAtLogin !== null && <span>{t("Starts with your {computer} so phone syncs keep coming in", { computer: computerWord() })}</span>}</span>
          <Switch label={t("Open at login")} checked={!!setup?.openAtLogin} disabled={!setup || setup.openAtLogin === null} onChange={(on) => flip({ openAtLogin: on })} />
        </div>
        <div className="lm-option">
          <span className="lm-ico" data-hue="violet" aria-hidden="true"><Glyph d={FOLDER} size={18} /></span>
          <span className="lm-row-text"><strong>{t("Weekly backup")}</strong><span>{setup ? t("Once a week to {folder}, the last four kept", { folder: setup.backupFolder }) : ""}</span></span>
          <Switch label={t("Weekly backup")} checked={!!setup?.weeklyBackup} disabled={!setup} onChange={(on) => flip({ weeklyBackup: on })} />
        </div>
      </div>
      <Note icon={SHIELD}>{t("Everything stays in this {computer}'s C-LINK folder. Settings → Privacy & local data shows what's kept.", { computer: computerWord() })}</Note>
      <Foot onBack={onBack}><Button variant="primary" onClick={onNext}>{t("Finish")}</Button></Foot>
    </>
  );
}

/* ───────────── All set ───────────── */

function DoneStep({ setup, source, coach, onStartOver }: { setup: SetupState | null; source: Source; coach: string | null; onStartOver: () => void }) {
  const [busy, setBusy] = useState(false);
  const [phones, setPhones] = useState<Phone[] | null>(null);
  useEffect(() => { ask<PhoneStatus>("/api/desktop/phones").then((s) => setPhones(s.phones), () => setPhones([])); }, []);
  const phone = phones?.slice().sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt))[0];
  const counts = setup?.data ? t("{activities} activities, {days} days of health", { activities: setup.data.activities.toLocaleString(locale("en-GB")), days: setup.data.healthDays.toLocaleString(locale("en-GB")) }) : "";
  const data = source === "look" ? { title: t("Sample data"), detail: t("Pair your phone on Connections when you're ready") }
    : source === "backup" ? { title: t("Restored from a backup"), detail: counts }
    : phone ? { title: t("Syncing with {phone}", { phone: phone.label }), detail: counts }
    : { title: t("No phone paired yet"), detail: t("Pair it any time on Connections") };
  const sports = setup?.sports ?? [];
  const open = () => { setBusy(true); void changeSetup({ setupDone: true }).then(() => navigate("/", { replace: true }), () => setBusy(false)); };
  return (
    <>
      <h1 id="ob-title">{t("You're all set!")}</h1>
      <div className="ob-done">
        <Row icon={CHECK} hue="mint" title={data.title} detail={data.detail} />
        <Row icon={PULSE} hue="blue" title={sports.length ? sportNames(sports).join(tx("list", ", ")) : t("None picked")} detail={t("Your sports")} />
        <Row icon={CHAT} hue="violet" title={coach ?? t("Set up later in Coach settings")} detail={t("Coach")} />
      </div>
      <div className="ob-foot">
        <button type="button" className="ob-link" onClick={onStartOver}>{t("Start over")}</button>
        <span className="ob-grow" />
        <Button variant="primary" disabled={busy} onClick={open}>{t("Open Dashboard")}</Button>
      </div>
    </>
  );
}

/* ───────────── Pieces ───────────── */

function Foot({ onBack, children }: { onBack?: () => void; children: ReactNode }) {
  return <div className="ob-foot">{onBack ? <Button onClick={onBack}>{t("Back")}</Button> : null}<span className="ob-grow" />{children}</div>;
}

function Row({ icon, hue, title, detail, end }: { icon: string; hue: string; title: string; detail: string; end?: string }) {
  return (
    <div className="lm-row">
      <span className="lm-ico" data-hue={hue} aria-hidden="true"><Glyph d={icon} size={18} /></span>
      <span className="lm-row-text"><strong>{title}</strong>{detail ? <span>{detail}</span> : null}</span>
      {end !== undefined ? <span className="lm-row-end"><b className="num">{end}</b></span> : null}
    </div>
  );
}

function Note({ icon, hue, children }: { icon: string; hue?: string; children: ReactNode }) {
  return <div className="ob-note"><span className="lm-ico" data-hue={hue} aria-hidden="true"><Glyph d={icon} size={15} /></span><span>{children}</span></div>;
}

const Dots = () => <span className="lm-dots" aria-hidden="true"><i /><i /><i /></span>;
const Check = ({ size }: { size: number }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 3, strokeLinecap: "round", strokeLinejoin: "round" }}><path d={CHECK} /></svg>;
function Glyph({ d, size }: { d: string; size: number }) {
  return <svg aria-hidden="true" className="ob-glyph" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={d} /></svg>;
}

const CHECK = "M5 12l4 4 10-10";
const WATCH = "M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.4 7.7l.8-4.2h3.6l.8 4.2M9.4 16.3l.8 4.2h3.6l.8-4.2";
const PHONE = "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM11 18h2";
const MAC = "M3 5h18v11H3zM8 20h8M12 16v4";
const EYE = "M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6z";
const FOLDER = "M3 6h6l2 2h10v11H3z";
const WIFI = "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01";
const KEY = "M15 7a4 4 0 1 1-3.9 4.9L4 19v-3h3v-3h3l1.1-1.1A4 4 0 0 1 15 7z";
const PULSE = "M3 12h4l3-8 4 16 3-8h4";
const MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z";
const CALENDAR = "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4";
const SPARK = "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z";
const POWER = "M12 3v8M6.3 6.3a8 8 0 1 0 11.4 0";
const SHIELD = "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z";
const CHAT = "M5 5h14v10.5h-8.5L5 20z";
