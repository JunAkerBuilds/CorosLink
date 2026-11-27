// The first-run intro: the language, then six scenes before anything else on the first launch (main/settings.ts keeps the flag): four
// about the app, the privacy question (usage counts and crash reports, both opt-in, and how to send a problem straight to the developer),
// then "Bring over my CorosLink data" when CorosLink's data is on this computer, or "Set up C-LINK" when it isn't.
// An install from before the privacy question gets that scene alone, once, at /welcome/privacy.
// Full window, in the app's own grounds and buttons. `?scene=0…6` opens a scene (smoke screenshots).
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button } from "@/components/ui";
import { languageFor, LANGUAGES, msg, t, type Choice, type Lang } from "@/lib/i18n";
import { chooseLanguage, languageStore } from "@/lib/i18n/load";
import { useStore } from "@/data/local/store";
import { computerWord } from "../computer";
import { IntroWatch } from "../parts/IntroWatch";
import { navigate, useLocation } from "../router";
import { readSettings } from "../settings";
import { answerPrivacy, leaveIntro, PRIVACY_PATH, readMove, type PrivacyChoice } from "../welcome";
import "./intro.css";

// English, with {computer} for "Mac" / "PC" / "computer"; translated where shown.
const SCENES = [msg("Language"), msg("The new C-LINK"), msg("One window"), msg("Phone to {computer}"), msg("Coach"), msg("Your privacy"), msg("Welcome")] as const;
const PRIVACY = 5;
const LAST = SCENES.length - 1;
const FEATURES = [msg("Activities"), msg("Sleep"), msg("Energy"), msg("Strength"), msg("Fuel"), msg("Body"), msg("Watch Studio"), msg("Routes"), msg("Coach"), msg("Calendar"), msg("Media"), msg("Phone sync")];
const AUTO_MS = 4500;

function Icon({ d, size = 18, width = 2 }: { d: string; size?: number; width?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

const ICON = {
  activities: "M3 12h4l3-8 4 16 3-8h4",
  sleep: "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
  fuel: "M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
  strength: "M4 9v6M7.5 6.5v11M16.5 6.5v11M20 9v6M7.5 12h9",
  studio: "M12 3a9 9 0 1 0 0 18c1.2 0 1.7-1 1.2-2-.5-1 .2-2.3 1.4-2.3H17a4 4 0 0 0 4-4C21 7 17 3 12 3zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01",
  coach: "M5 5h14v10.5h-8.5L5 20z",
  wifi: "M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z",
  watch: "M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.4 7.7l.8-4.2h3.6l.8 4.2M9.4 16.3l.8 4.2h3.6l.8-4.2",
  next: "M9 6l6 6-6 6",
  back: "M15 6l-6 6 6 6",
  arrow: "M5 12h14M13 6l6 6-6 6",
  tick: "M5 12.5l4.5 4.5L19 7.5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bug: "M8 8a4 4 0 0 1 8 0v1H8zM6 10h12v4a6 6 0 0 1-12 0zM12 10v10M3 13h3M18 13h3M4 7l2.5 2M20 7l-2.5 2M4 20l2.5-2.5M20 20l-2.5-2.5",
  mail: "M4 5h16v14H4zM4 6l8 7 8-7",
};

/** The real dashboard, in the look the app is in. */
function Dashboard() {
  return (<>
    <img className="ix-shot ix-shot-dark" src="/img/intro-dashboard-dark.webp" alt={t("The C-LINK dashboard: readiness, sleep and load, today, latest activity, fitness and training load")} width={1800} height={1037} />
    <img className="ix-shot ix-shot-light" src="/img/intro-dashboard-light.webp" alt={t("The C-LINK dashboard: readiness, sleep and load, today, latest activity, fitness and training load")} width={1800} height={1037} />
  </>);
}

/** The scenes are drawn for a 1440 × 900 window and scaled to fit this one; the chrome stays full size. */
function useStageScale(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setScale(Math.min(el.clientWidth / 1440, el.clientHeight / 900));
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return [ref, scale];
}

function Scene1() {
  return (<>
    <span className="ix-glow" aria-hidden="true" /><span className="ix-ring" aria-hidden="true" /><span className="ix-ring" data-b="" aria-hidden="true" />
    <Stage>
      <span className="ix-mark1 ix-in" aria-hidden="true"><img src="/img/clink-mark.png?v=2" alt="" width={276} height={300} /></span>
      <p className="ix-tag1 ix-in" data-d="2"><span>{t("New look,")}<br />{t("who dis?")}</span></p>
      <h1 className="ix-giant ix-in" data-d="1">C-LINK</h1>
    </Stage>
    <div className="ix-band" aria-hidden="true"><div>{[...FEATURES, ...FEATURES].map((f, i) => <span key={i}>{t(f)}</span>)}</div></div>
  </>);
}

function Scene2() {
  const chips: [string, string][] = [[t("Activities"), ICON.activities], [t("Sleep"), ICON.sleep], [t("Fuel"), ICON.fuel], [t("Strength"), ICON.strength], [t("Studio"), ICON.studio], [t("Coach"), ICON.coach]];
  return (
    <Stage>
      <div className="ix-s2-copy ix-in" data-fit="">
        <h2 className="ix-h" data-lines="3">{t("All of it.")}<br /><span className="ix-mint">{t("One window.")}</span></h2>
        <p className="ix-sub">{t("Training, sleep, strength, food, faces and Coach. Side by side, on a screen big enough for them.")}</p>
        <div className="ix-chips">{chips.map(([label, d]) => <span key={label}><Icon d={d} size={15} />{label}</span>)}</div>
      </div>
      <div className="ix-stage3d ix-in" data-d="1"><div className="ix-win"><Dashboard /></div></div>
    </Stage>
  );
}

function Scene3() {
  return (
    <Stage>
      {/* Clear of the watch, phone and Mac below (.ix-chain starts at 400). */}
      <div className="ix-p-copy" data-fit="392">
        <h2 className="ix-h ix-in" data-lines="2">{t("Your phone")}<br /><span className="ix-mint">{t("brings it home.")}</span></h2>
        <div className="ix-p-side ix-in" data-d="1">
          <p className="ix-sub">{t("C-LINK on your phone syncs the watch like always, then hands everything to this {computer}. Scan one code and it just keeps up.", { computer: computerWord() })}</p>
          <div className="ix-p-facts">
            <span><Icon d={ICON.wifi} />{t("Same Wi-Fi, straight across")}</span>
            <span><Icon d={ICON.shield} />{t("Away, over your own encrypted link")}</span>
            <span><Icon d={ICON.watch} />{t("Plans, faces and routes go back")}</span>
          </div>
        </div>
      </div>
      <div className="ix-chain ix-in" data-d="2" aria-hidden="true">
        <IntroWatch />
        <div className="ix-flow"><i /><i /><i /><em>Bluetooth</em></div>
        <div className="ix-phone"><div className="ix-phone-in"><img src="/img/intro-phone-today.webp" alt="" /></div></div>
        <div className="ix-flow"><i /><i /><i /><em>Wi-Fi</em></div>
        <div className="ix-mac"><div className="ix-mac-screen"><Dashboard /></div><div className="ix-mac-base" /></div>
      </div>
    </Stage>
  );
}

function Scene4() {
  return (
    <Stage>
      <span className="ix-coachbig">
        <picture className="ix-sprite" role="img" aria-label={t("Coach waving")}><source srcSet="/img/coach-wave-still.webp" media="(prefers-reduced-motion: reduce)" /><img src="/img/coach-wave-hd.webp" alt="" width={720} height={720} /></picture>
      </span>
      <div className="ix-s4-copy" data-fit="">
        <h2 className="ix-h ix-in" data-lines="2">{t("Meet Coach.")}</h2>
        <div className="ix-bubbles">
          <div className="ix-bub ix-in" data-d="1">{t("Morning! 7h 41m of sleep and your HRV is back up.")}<small>{t("Coach")} · 07:42</small></div>
          <div className="ix-bub ix-in" data-d="2">{t("Tempo's a go. I moved Thursday's intervals so your legs get a day.")}</div>
          <div className="ix-bub ix-in" data-me="" data-d="3">{t("Perfect. Send it to my watch.")}</div>
        </div>
      </div>
    </Stage>
  );
}

function SceneWelcome({ fromCorosLink }: { fromCorosLink: boolean | null }) {
  return (<>
    <span className="ix-ring" aria-hidden="true" /><span className="ix-ring" data-b="" aria-hidden="true" />
    <Stage>
      <div className="ix-s5-copy" data-fit="">
        <span className="ix-mark5 ix-in" aria-hidden="true"><img src="/img/clink-mark.png?v=2" alt="" width={88} height={96} /></span>
        {fromCorosLink === null ? null : fromCorosLink ? (<>
          <h2 className="ix-h ix-in" data-d="1" data-lines="2">{t("Welcome")}<br /><span className="ix-mint">{t("home.")}</span></h2>
          <div className="ix-ctas ix-in" data-d="2">
            <Button variant="primary" className="ix-cta" onClick={() => navigate("/welcome/move")}>{t("Bring over my CorosLink data")}<Icon d={ICON.arrow} size={22} width={2.6} /></Button>
            <Button className="ix-cta" onClick={() => void leaveIntro("/setup")}>{t("Start fresh")}</Button>
          </div>
          <span className="ix-fine ix-in" data-d="3">{t("Activities, health, faces and Coach chats come along. CorosLink's folder isn't touched.")}</span>
        </>) : (<>
          <h2 className="ix-h ix-in" data-d="1" data-lines="2">{t("Let's")}<br /><span className="ix-mint">{t("go.")}</span></h2>
          <div className="ix-ctas ix-in" data-d="2">
            <Button variant="primary" className="ix-cta" onClick={() => void leaveIntro("/setup")}>{t("Set up C-LINK")}<Icon d={ICON.arrow} size={22} width={2.6} /></Button>
          </div>
        </>)}
      </div>
    </Stage>
  </>);
}

/** One opt-in, as a card the whole of which is the switch. */
function OptIn({ on, onChange, icon, title, detail }: { on: boolean; onChange: (on: boolean) => void; icon: string; title: string; detail: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="ix-opt" data-on={on ? "" : undefined} onClick={() => onChange(!on)}>
      <span className="ix-opt-head"><span className="ix-opt-icon" aria-hidden="true"><Icon d={icon} size={22} /></span><span className="ix-opt-pill" aria-hidden="true" /></span>
      <b>{title}</b><small>{detail}</small>
    </button>
  );
}

/**
 * The privacy question: usage counts and crash reports, each off until chosen (main/settings.ts), and where to send a
 * problem with a message straight to the developer. `update`: shown alone to an install from before it was asked.
 */
function ScenePrivacy({ choice, onChoice, onGo, update }: { choice: PrivacyChoice | null; onChoice: (c: PrivacyChoice) => void; onGo: () => void; update?: boolean }) {
  return (<>
    <span className="ix-ring" aria-hidden="true" /><span className="ix-ring" data-b="" aria-hidden="true" />
    <Stage>
      <div className="ix-pv-copy" data-fit="">
        <div className="ix-pv-head ix-in">
          {update ? <span className="ix-eyebrow">{t("New in this update")}</span> : null}
          <h2 className="ix-h" data-lines="1">{t("Your data,")} <span className="ix-mint">{t("your call.")}</span></h2>
          <p className="ix-sub">{t("Your training stays on this {computer}. Usage counts help me see how many people use C-LINK; crash reports only go out if you turn them on.", { computer: computerWord() })}</p>
        </div>
        <div className="ix-opts ix-in" data-d="1">
          <OptIn on={!!choice?.usage} onChange={(usage) => choice && onChoice({ ...choice, usage })} icon={ICON.chart} title={t("Usage counts")}
            detail={t("Just so I get an idea of how many people use C-LINK: a random ID, the app version and your OS. Nothing more.")} />
          <OptIn on={!!choice?.crashReports} onChange={(crashReports) => choice && onChoice({ ...choice, crashReports })} icon={ICON.bug} title={t("Crash reports")}
            detail={t("When C-LINK crashes, the last hour of its error log, with home folders and keys taken out.")} />
          <div className="ix-opt" data-info="">
            <span className="ix-opt-head"><span className="ix-opt-icon" aria-hidden="true"><Icon d={ICON.mail} size={22} /></span></span>
            <b>{t("Something wrong?")}</b>
            <small>{t("From {place}, send the error log and a message straight to the developer. You get a reference back.", { place: t("Help → Report a Problem…") })}</small>
          </div>
        </div>
        <div className="ix-ctas ix-in" data-d="2">
          <Button variant="primary" className="ix-cta" disabled={!choice} onClick={onGo}>{t("Continue")}<Icon d={ICON.arrow} size={22} width={2.6} /></Button>
        </div>
        <span className="ix-fine ix-in" data-d="3">{t("Never your activities, health or account. Nothing is sent in Local mode. Change it any time in Settings → Privacy.")}</span>
      </div>
    </Stage>
  </>);
}

// Scene 0 speaks the language being picked before it's in place, so its few lines are kept here in each language.
const OWN: Record<Lang, { hello: string; sub: string; go: string; fine: string; system: string; names: Record<Lang, string> }> = {
  en: { hello: "Hello.", sub: "Pick the language C-LINK speaks.", go: "Continue", fine: "You can change it any time in Settings.", system: "System",
    names: { en: "English", es: "Spanish", de: "German", "pt-BR": "Portuguese (Brazil)", "zh-Hans": "Chinese, Simplified" } },
  es: { hello: "Hola.", sub: "Elige el idioma de C-LINK.", go: "Continuar", fine: "Puedes cambiarlo cuando quieras en Ajustes.", system: "Sistema",
    names: { en: "Inglés", es: "Español", de: "Alemán", "pt-BR": "Portugués (Brasil)", "zh-Hans": "Chino simplificado" } },
  de: { hello: "Hallo.", sub: "Wähle die Sprache von C-LINK.", go: "Weiter", fine: "Du kannst sie jederzeit in den Einstellungen ändern.", system: "System",
    names: { en: "Englisch", es: "Spanisch", de: "Deutsch", "pt-BR": "Portugiesisch (Brasilien)", "zh-Hans": "Chinesisch (vereinfacht)" } },
  "pt-BR": { hello: "Olá.", sub: "Escolha o idioma do C-LINK.", go: "Continuar", fine: "Você pode mudar quando quiser em Ajustes.", system: "Sistema",
    names: { en: "Inglês", es: "Espanhol", de: "Alemão", "pt-BR": "Português (Brasil)", "zh-Hans": "Chinês simplificado" } },
  "zh-Hans": { hello: "你好。", sub: "选择 C-LINK 使用的语言。", go: "继续", fine: "随时可以在设置中更改。", system: "跟随系统",
    names: { en: "英语", es: "西班牙语", de: "德语", "pt-BR": "葡萄牙语（巴西）", "zh-Hans": "简体中文" } },
};

function Scene0({ pick, onPick, onGo }: { pick: Choice; onPick: (c: Choice) => void; onGo: () => void }) {
  const system = languageFor("system", navigator.languages);
  const own = OWN[languageFor(pick, navigator.languages)];
  const options: { id: Choice; label: string; detail: string }[] = [
    { id: "system", label: own.system, detail: LANGUAGES.find((l) => l.id === system)?.label ?? "" },
    ...LANGUAGES.map((l) => ({ id: l.id as Choice, label: l.label, detail: own.names[l.id] })),
  ];
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const move = (e: React.KeyboardEvent) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = (options.findIndex((o) => o.id === pick) + step + options.length) % options.length;
    onPick(options[at].id);
    refs.current[at]?.focus();
  };
  return (<>
    <span className="ix-ring" aria-hidden="true" /><span className="ix-ring" data-b="" aria-hidden="true" />
    <Stage>
      <div className="ix-s0-copy" data-fit="">
        <div className="ix-s0-head ix-in">
          <h2 className="ix-h" data-lines="1">{own.hello}</h2>
          <p className="ix-sub">{own.sub}</p>
        </div>
        <div className="ix-langs ix-in" data-d="1" role="radiogroup" aria-label={own.sub} onKeyDown={move}>
          {options.map((o, i) => {
            const on = o.id === pick;
            return (
              <button key={o.id} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1}
                className="ix-lang" data-on={on ? "" : undefined} onClick={() => onPick(o.id)}>
                {on ? <span className="ix-lang-tick" aria-hidden="true"><Icon d={ICON.tick} size={14} width={3.4} /></span> : null}
                <b>{o.label}</b>{o.detail && o.detail !== o.label ? <small>{o.detail}</small> : null}
              </button>
            );
          })}
        </div>
        <div className="ix-ctas ix-in" data-d="2"><Button variant="primary" className="ix-cta" onClick={onGo}>{own.go}<Icon d={ICON.arrow} size={22} width={2.6} /></Button></div>
        <span className="ix-fine ix-in" data-d="3">{own.fine}</span>
      </div>
    </Stage>
  </>);
}

/**
 * Translations run longer than English: each headline shrinks (--fit) just enough to keep the lines it has in English
 * (data-lines), break no word, and keep its scene's copy (data-fit, or above that line on the stage) clear of the top
 * bar and the buttons. English, at its designed size, is left as it is. Measured in stage pixels, so the entrance
 * animation and the window's scale don't change the answer.
 */
function fitHeadlines(frame: HTMLElement): void {
  const stage = frame.querySelector<HTMLElement>(".ix-stage");
  if (!stage) return;
  const k = stage.getBoundingClientRect().height / 900 || 1;
  const stageTop = (frame.clientHeight - 900 * k) / 2;
  const topLimit = (64 - stageTop) / k + 8;
  const bottomLimit = (frame.clientHeight - 88 - stageTop) / k - 8;
  for (const h of stage.querySelectorAll<HTMLElement>(".ix-h")) {
    const box = h.closest<HTMLElement>("[data-fit]");
    const lines = Number(h.dataset.lines || 0);
    const floor = box?.dataset.fit ? Math.min(Number(box.dataset.fit), bottomLimit) : bottomLimit;
    const fits = () => {
      if (lines && Math.round(h.offsetHeight / parseFloat(getComputedStyle(h).lineHeight)) > lines) return false;
      if (h.scrollWidth > h.clientWidth + 1) return false;
      const kids = box ? ([...box.children] as HTMLElement[]) : [];
      if (!kids.length) return true;
      const top = box!.offsetTop + Math.min(...kids.map((c) => c.offsetTop));
      const bottom = box!.offsetTop + Math.max(...kids.map((c) => c.offsetTop + c.offsetHeight));
      return top >= topLimit && bottom <= floor;
    };
    h.style.removeProperty("--fit");
    if (fits()) continue;
    let lo = 0.5, hi = 1;
    for (let i = 0; i < 7; i++) {
      const mid = (lo + hi) / 2;
      h.style.setProperty("--fit", mid.toFixed(3));
      if (fits()) lo = mid; else hi = mid;
    }
    h.style.setProperty("--fit", lo.toFixed(3));
  }
}

/** The scene's own art, drawn at 1440 × 900 and scaled (--ix-k, set by Intro). */
function Stage({ children }: { children: ReactNode }) {
  return <div className="ix-stage">{children}</div>;
}

export default function Intro() {
  const { pathname, search } = useLocation();
  const askedText = new URLSearchParams(search).get("scene");
  const asked = askedText === null ? 0 : Number(askedText);
  const alone = pathname === PRIVACY_PATH;
  const [scene, setScene] = useState(alone ? PRIVACY : asked >= 0 && asked <= LAST ? asked : 0);
  // Not yet answered: usage counts start on (an anonymous count, switched off right here if not wanted) and crash
  // reports off. Answered before, as when the intro is shown again: as chosen. Nothing is sent until Continue.
  const [choice, setChoice] = useState<PrivacyChoice | null>(null);
  useEffect(() => {
    void readSettings()
      .then((s) => setChoice(s.privacy === "pending" ? { usage: true, crashReports: false } : { usage: s.usage, crashReports: s.crashReports }))
      .catch(() => setChoice({ usage: true, crashReports: false }));
  }, []);
  const saved = useStore(languageStore, "system");
  const [pick, setPick] = useState<Choice>(saved);
  const [playing, setPlaying] = useState(false);
  const [fromCorosLink, setFromCorosLink] = useState<boolean | null>(null);
  const [frame, scale] = useStageScale();

  useEffect(() => { void readMove().then((m) => setFromCorosLink(!!m?.found)); }, []);

  // Each scene's headlines fitted to the language, again once the fonts are in.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    fitHeadlines(el);
    let live = true;
    void document.fonts.ready.then(() => { if (live) fitHeadlines(el); });
    return () => { live = false; };
  }, [frame, scene, scale, fromCorosLink]);
  useEffect(() => { document.title = `${t(alone ? "Your privacy" : "Welcome")} · C-LINK`; }, [alone]);

  // Leaving the language scene puts the pick in place. A new language starts the page over, on the scene asked for.
  // Going on from the privacy scene saves its answer.
  const go = useCallback((n: number) => {
    setPlaying(false);
    const next = Math.min(LAST, Math.max(0, n));
    // The privacy step is left forward only with its answer (the switches load first).
    if (scene === PRIVACY && next > PRIVACY) { if (!choice) return; void answerPrivacy(choice); }
    if (scene === 0 && next > 0 && pick !== saved) {
      navigate(`${location.pathname}?scene=${next}`, { replace: true });
      chooseLanguage(pick);
      return;
    }
    setScene(next);
  }, [scene, pick, saved, choice]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setScene((n) => {
      if (n >= PRIVACY - 1) { setPlaying(false); return PRIVACY; }
      return n + 1;
    }), AUTO_MS);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (alone || (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [role=radiogroup]"))) return;
      if (e.key === "ArrowRight") go(scene + 1);
      else if (e.key === "ArrowLeft") go(scene - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [go, scene, alone]);

  // A click anywhere on the intro moves on a scene, unless it lands on a button or link.
  const onTap = (e: React.MouseEvent) => {
    if (scene === 0 || scene >= PRIVACY || (e.target instanceof Element && e.target.closest("button, a, input, textarea, select, label, .ix-nav"))) return;
    go(scene + 1);
  };

  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (scene === 0) { go(1); if (pick !== saved) return; }
    else if (scene >= PRIVACY) setScene(1);
    setPlaying(true);
  };

  // An install from before the privacy question: that scene alone, then the app.
  if (alone) {
    const done = async () => { if (choice) await answerPrivacy(choice); navigate("/", { replace: true }); };
    return (
      <div className="ix" data-scene={PRIVACY}>
        <section className="ix-scene" aria-label={t("Your privacy")} ref={frame} style={{ "--ix-k": scale } as React.CSSProperties}>
          <ScenePrivacy choice={choice} onChoice={setChoice} onGo={() => void done()} update />
        </section>
        <header className="ix-top"><span className="ix-word"><BrandMark />C-LINK</span></header>
      </div>
    );
  }

  return (
    <div className="ix" data-scene={scene} onClick={onTap}>
      <section className="ix-scene" aria-label={t(SCENES[scene], { computer: computerWord() })} ref={frame} style={{ "--ix-k": scale } as React.CSSProperties}>
        {/* Keyed, so each scene's entrance plays again when it comes back. */}
        <Fragment key={scene}>
          {scene === 0 ? <Scene0 pick={pick} onPick={setPick} onGo={() => go(1)} /> : scene === 1 ? <Scene1 /> : scene === 2 ? <Scene2 /> : scene === 3 ? <Scene3 /> : scene === 4 ? <Scene4 />
            : scene === PRIVACY ? <ScenePrivacy choice={choice} onChoice={setChoice} onGo={() => go(PRIVACY + 1)} /> : <SceneWelcome fromCorosLink={fromCorosLink} />}
        </Fragment>
      </section>
      <header className="ix-top">
        <span className="ix-word"><BrandMark />C-LINK</span>
        <span className="ix-count">{String(scene).padStart(2, "0")} / {String(LAST).padStart(2, "0")}</span>
        {scene < PRIVACY ? <Button className="ix-btn" onClick={() => go(PRIVACY)}>{t("Skip intro")}</Button> : null}
      </header>
      <footer className="ix-bottom">
        <div className="ix-nav">
          <Button className="ix-btn" onClick={play}>{playing ? t("Pause") : t("Play")}</Button>
          <Button className="ix-btn ix-icon" aria-label={t("Back")} disabled={scene === 0} onClick={() => go(scene - 1)}><Icon d={ICON.back} /></Button>
          <Button variant="primary" className="ix-btn ix-icon" aria-label={t("Next")} disabled={scene === LAST || (scene === PRIVACY && !choice)} onClick={() => go(scene + 1)}><Icon d={ICON.next} /></Button>
        </div>
      </footer>
    </div>
  );
}
