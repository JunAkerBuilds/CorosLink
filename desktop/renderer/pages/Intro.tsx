// The first-run intro: five scenes before anything else on the first launch (main/settings.ts keeps the flag), then
// "Bring over my CorosLink data" when CorosLink's data is on this computer, or "Set up C-LINK" when it isn't.
// Full window, in the app's own grounds and buttons. `?scene=1…5` opens a scene (smoke screenshots).
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/shell/BrandMark";
import { Button } from "@/components/ui";
import { IntroWatch } from "../parts/IntroWatch";
import { navigate, useLocation } from "../router";
import { leaveIntro, readMove } from "../welcome";
import "./intro.css";

const SCENES = ["The new C-LINK", "One window", "Phone to Mac", "Coach", "Welcome"] as const;
const FEATURES = ["Activities", "Sleep", "Energy", "Strength", "Fuel", "Body", "Watch Studio", "Routes", "Coach", "Calendar", "Media", "Phone sync"];
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
};

/** The real dashboard, in the look the app is in. */
function Dashboard() {
  return (<>
    <img className="ix-shot ix-shot-dark" src="/img/intro-dashboard-dark.webp" alt="The C-LINK dashboard: readiness, sleep and load, today, latest activity, fitness and training load" width={1800} height={1037} />
    <img className="ix-shot ix-shot-light" src="/img/intro-dashboard-light.webp" alt="The C-LINK dashboard: readiness, sleep and load, today, latest activity, fitness and training load" width={1800} height={1037} />
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
      <p className="ix-tag1 ix-in" data-d="2"><span>New look,<br />who dis?</span></p>
      <h1 className="ix-giant ix-in" data-d="1">C-LINK</h1>
    </Stage>
    <div className="ix-band" aria-hidden="true"><div>{[...FEATURES, ...FEATURES].map((f, i) => <span key={i}>{f}</span>)}</div></div>
  </>);
}

function Scene2() {
  const chips: [string, string][] = [["Activities", ICON.activities], ["Sleep", ICON.sleep], ["Fuel", ICON.fuel], ["Strength", ICON.strength], ["Studio", ICON.studio], ["Coach", ICON.coach]];
  return (
    <Stage>
      <div className="ix-s2-copy ix-in">
        <h2 className="ix-h">All of it.<br /><span className="ix-mint">One window.</span></h2>
        <p className="ix-sub">Training, sleep, strength, food, faces and Coach. Side by side, on a screen big enough for them.</p>
        <div className="ix-chips">{chips.map(([label, d]) => <span key={label}><Icon d={d} size={15} />{label}</span>)}</div>
      </div>
      <div className="ix-stage3d ix-in" data-d="1"><div className="ix-win"><Dashboard /></div></div>
    </Stage>
  );
}

function Scene3() {
  return (
    <Stage>
      <div className="ix-p-copy">
        <h2 className="ix-h ix-in">Your phone<br /><span className="ix-mint">brings it home.</span></h2>
        <div className="ix-p-side ix-in" data-d="1">
          <p className="ix-sub">C-LINK on your phone syncs the watch like always, then hands everything to this Mac. Scan one code and it just keeps up.</p>
          <div className="ix-p-facts">
            <span><Icon d={ICON.wifi} />Same Wi-Fi, straight across</span>
            <span><Icon d={ICON.shield} />Away, over your own encrypted link</span>
            <span><Icon d={ICON.watch} />Plans, faces and routes go back</span>
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
        <picture className="ix-sprite" role="img" aria-label="Coach waving"><source srcSet="/img/coach-wave-still.webp" media="(prefers-reduced-motion: reduce)" /><img src="/img/coach-wave-hd.webp" alt="" width={720} height={720} /></picture>
      </span>
      <div className="ix-s4-copy">
        <h2 className="ix-h ix-in">Meet Coach.</h2>
        <div className="ix-bubbles">
          <div className="ix-bub ix-in" data-d="1">Morning! 7h 41m of sleep and your HRV is back up.<small>Coach · 07:42</small></div>
          <div className="ix-bub ix-in" data-d="2">Tempo&apos;s a go. I moved Thursday&apos;s intervals so your legs get a day.</div>
          <div className="ix-bub ix-in" data-me="" data-d="3">Perfect. Send it to my watch.</div>
        </div>
      </div>
    </Stage>
  );
}

function Scene5({ fromCorosLink }: { fromCorosLink: boolean | null }) {
  return (<>
    <span className="ix-ring" aria-hidden="true" /><span className="ix-ring" data-b="" aria-hidden="true" />
    <Stage>
      <div className="ix-s5-copy">
        <span className="ix-mark5 ix-in" aria-hidden="true"><img src="/img/clink-mark.png?v=2" alt="" width={88} height={96} /></span>
        {fromCorosLink === null ? null : fromCorosLink ? (<>
          <h2 className="ix-h ix-in" data-d="1">Welcome<br /><span className="ix-mint">home.</span></h2>
          <div className="ix-ctas ix-in" data-d="2">
            <Button variant="primary" className="ix-cta" onClick={() => navigate("/welcome/move")}>Bring over my CorosLink data<Icon d={ICON.arrow} size={22} width={2.6} /></Button>
            <Button className="ix-cta" onClick={() => void leaveIntro("/setup")}>Start fresh</Button>
          </div>
          <span className="ix-fine ix-in" data-d="3">Activities, health, faces and Coach chats come along. CorosLink&apos;s folder isn&apos;t touched.</span>
        </>) : (<>
          <h2 className="ix-h ix-in" data-d="1">Let&apos;s<br /><span className="ix-mint">go.</span></h2>
          <div className="ix-ctas ix-in" data-d="2">
            <Button variant="primary" className="ix-cta" onClick={() => void leaveIntro("/setup")}>Set up C-LINK<Icon d={ICON.arrow} size={22} width={2.6} /></Button>
          </div>
        </>)}
      </div>
    </Stage>
  </>);
}

/** The scene's own art, drawn at 1440 × 900 and scaled (--ix-k, set by Intro). */
function Stage({ children }: { children: ReactNode }) {
  return <div className="ix-stage">{children}</div>;
}

export default function Intro() {
  const { search } = useLocation();
  const asked = Number(new URLSearchParams(search).get("scene"));
  const [scene, setScene] = useState(asked >= 1 && asked <= 5 ? asked : 1);
  const [playing, setPlaying] = useState(false);
  const [fromCorosLink, setFromCorosLink] = useState<boolean | null>(null);
  const [frame, scale] = useStageScale();

  useEffect(() => { void readMove().then((m) => setFromCorosLink(!!m?.found)); }, []);
  useEffect(() => { document.title = "Welcome · C-LINK"; }, []);

  const go = useCallback((n: number) => { setPlaying(false); setScene(Math.min(5, Math.max(1, n))); }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setScene((n) => {
      if (n >= 4) { setPlaying(false); return 5; }
      return n + 1;
    }), AUTO_MS);
    return () => clearInterval(timer);
  }, [playing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select")) return;
      if (e.key === "ArrowRight") go(scene + 1);
      else if (e.key === "ArrowLeft") go(scene - 1);
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [go, scene]);

  // A click anywhere on the intro moves on a scene, unless it lands on a button or link.
  const onTap = (e: React.MouseEvent) => {
    if (scene >= 5 || (e.target instanceof Element && e.target.closest("button, a, input, textarea, select, label, .ix-nav"))) return;
    go(scene + 1);
  };

  const play = () => {
    if (playing) { setPlaying(false); return; }
    if (scene >= 5) setScene(1);
    setPlaying(true);
  };

  return (
    <div className="ix" data-scene={scene} onClick={onTap}>
      <section className="ix-scene" aria-label={SCENES[scene - 1]} ref={frame} style={{ "--ix-k": scale } as React.CSSProperties}>
        {/* Keyed, so each scene's entrance plays again when it comes back. */}
        <Fragment key={scene}>
          {scene === 1 ? <Scene1 /> : scene === 2 ? <Scene2 /> : scene === 3 ? <Scene3 /> : scene === 4 ? <Scene4 /> : <Scene5 fromCorosLink={fromCorosLink} />}
        </Fragment>
      </section>
      <header className="ix-top">
        <span className="ix-word"><BrandMark />C-LINK</span>
        <span className="ix-count">{String(scene).padStart(2, "0")} / 05</span>
        {scene < 5 ? <Button className="ix-btn" onClick={() => go(5)}>Skip intro</Button> : null}
      </header>
      <footer className="ix-bottom">
        <div className="ix-nav">
          <Button className="ix-btn" onClick={play}>{playing ? "Pause" : "Play"}</Button>
          <Button className="ix-btn ix-icon" aria-label="Back" disabled={scene === 1} onClick={() => go(scene - 1)}><Icon d={ICON.back} /></Button>
          <Button variant="primary" className="ix-btn ix-icon" aria-label="Next" disabled={scene === 5} onClick={() => go(scene + 1)}><Icon d={ICON.next} /></Button>
        </div>
      </footer>
    </div>
  );
}
