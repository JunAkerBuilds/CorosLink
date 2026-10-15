/* First-run tour. App.tsx shows it once after a new install (the main process
   decides, see electron/onboardingState.ts) and again from Help → Take the
   tour. It opens on a language choice, then one chapter per area of the app,
   each with its own hue and picture, ending with appearance, units and the
   two connections worth making. */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  Barbell,
  Books,
  CalendarDots,
  ChartLineUp,
  ChatCircleDots,
  Check,
  HandWaving,
  MapTrifold,
  MusicNotes,
  ShieldCheck,
  Watch,
  type Icon
} from "@phosphor-icons/react";
import logoBase from "../../build/icon-base.svg";
import logoSync from "../../build/icon-sync.svg";
import { LANGUAGES, formatNumber, t, useLanguage } from "../i18n";
import { useTheme } from "../theme/ThemeProvider";
import type { Theme } from "../theme/theme";
import { useUnitSystem } from "../units/UnitSystemProvider";
import type { UnitSystem } from "../units/units";
import {
  ConnectedBadge,
  GREETINGS,
  HelloVignette,
  MapsVignette,
  MusicVignette,
  PlanVignette,
  StrengthVignette,
  TrainingVignette,
  VIGNETTE_HEIGHT,
  VIGNETTE_WIDTH,
  WatchfacesVignette,
  WelcomeVignette
} from "./OnboardingVignettes";
import "./onboarding.css";

export type OnboardingExit = "explore" | "skip" | "sign-in" | "connect-watch";

type ChapterId = "hello" | "welcome" | "training" | "plan" | "strength" | "watchfaces" | "maps" | "music" | "ready";

type Hue = "mint" | "cyan" | "violet" | "amber" | "pink" | "blue" | "rose";

interface Chapter {
  id: ChapterId;
  /** Short name for the progress steps. */
  label: string;
  hue: Hue;
  icon?: Icon;
  eyebrow: string;
  title: string;
  lede: string;
  points?: Array<{ title: string; body: string }>;
  /** Where the chapter lives in the sidebar. */
  places?: Array<{ label: string; icon: Icon }>;
}

/* English source text, translated with tour() where it is read. */
const CHAPTERS: Chapter[] = [
  {
    id: "hello",
    label: "Language",
    hue: "mint",
    icon: HandWaving,
    eyebrow: "Hello",
    title: "Welcome to CorosLink.",
    lede: "First, select your language. You can change it any time in Settings."
  },
  {
    id: "welcome",
    label: "Welcome",
    hue: "mint",
    eyebrow: "What’s inside",
    title: "Your COROS watch, with a desktop to match.",
    lede: "Training, plans, watch faces, maps and music, together in one app. Here’s a one-minute look around.",
    points: [
      {
        title: "Local-first",
        body: "Your data stays on this computer. There’s no CorosLink account and no cloud of ours."
      },
      {
        title: "Only what you need",
        body: "Every sign-in is optional. Music and maps work over USB with nothing to set up."
      },
      {
        title: "Independent",
        body: "An unofficial companion app, not affiliated with or endorsed by COROS."
      }
    ]
  },
  {
    id: "training",
    label: "Training",
    hue: "cyan",
    icon: ChartLineUp,
    eyebrow: "Training Hub & Coach",
    title: "Read your training. Then ask about it.",
    lede: "Sign in with COROS to see recovery, training load, HRV, sleep and race predictions in one place.",
    points: [
      {
        title: "Every activity, in depth",
        body: "Splits, power curve, best efforts and a route map for each synced workout."
      },
      {
        title: "A coach that knows your data",
        body: "Ask questions, get charts and draft plans with ChatGPT, Claude or a local model."
      },
      {
        title: "You stay in control",
        body: "Nothing is written to COROS until you confirm it."
      }
    ],
    places: [
      { label: "Training Hub", icon: ChartLineUp },
      { label: "Coach", icon: ChatCircleDots }
    ]
  },
  {
    id: "plan",
    label: "Planning",
    hue: "violet",
    icon: CalendarDots,
    eyebrow: "Training Library & Calendar",
    title: "Plan the work. Watch it land.",
    lede: "Build structured workouts and multi-week plans, put them on the calendar, and see planned turn into done.",
    points: [
      {
        title: "Workout builder",
        body: "Sport-aware steps, tags and collections you can reuse."
      },
      {
        title: "Drag to reschedule",
        body: "A week and month calendar that syncs with Google or Apple Calendar."
      },
      {
        title: "Plan against reality",
        body: "Finished activities line up with the workouts you planned."
      }
    ],
    places: [
      { label: "Training Library", icon: Books },
      { label: "Calendar", icon: CalendarDots }
    ]
  },
  {
    id: "strength",
    label: "Strength",
    hue: "amber",
    icon: Barbell,
    eyebrow: "Strength",
    title: "See which muscles did the work.",
    lede: "A 3D muscle map shades every muscle by how hard you’ve trained it, so the gaps are easy to spot.",
    points: [
      {
        title: "Volume and balance",
        body: "Weekly volume trends and your push, pull and legs split."
      },
      {
        title: "Personal records",
        body: "Bests and estimated one-rep max for every exercise."
      },
      {
        title: "Bring your Hevy log",
        body: "Optionally merge Hevy workouts with your COROS strength history."
      }
    ],
    places: [{ label: "Strength", icon: Barbell }]
  },
  {
    id: "watchfaces",
    label: "Watch faces",
    hue: "pink",
    icon: Watch,
    eyebrow: "Watch Face Studio",
    title: "Design a face that’s yours.",
    lede: "A layer-based editor for COROS watch faces: fonts, colors, artwork, live metrics and an always\u2011on version.",
    points: [
      {
        title: "Start from anything",
        body: "A template, a community face or a blank canvas."
      },
      {
        title: "Edit by asking",
        body: "Describe a change and the built-in AI makes it."
      },
      {
        title: "Straight to your wrist",
        body: "Install over Bluetooth, or hand off to the COROS app with a QR code."
      }
    ],
    places: [{ label: "Watch Faces", icon: Watch }]
  },
  {
    id: "maps",
    label: "Maps",
    hue: "blue",
    icon: MapTrifold,
    eyebrow: "Maps & Routes",
    title: "Plan the route. Carry the map.",
    lede: "Download official COROS topo and landscape maps, and plan routes your watch can follow.",
    points: [
      {
        title: "Route Studio",
        body: "Generate loops or point-to-point routes, or import a GPX from Strava or Komoot."
      },
      {
        title: "Know the climb",
        body: "Elevation profile and pace estimates before you head out."
      },
      {
        title: "Onto the watch",
        body: "Send maps and routes over USB or Bluetooth, or share a route by QR code."
      }
    ],
    places: [{ label: "Maps", icon: MapTrifold }]
  },
  {
    id: "music",
    label: "Music",
    hue: "rose",
    icon: MusicNotes,
    eyebrow: "Music & Podcasts",
    title: "Bring your soundtrack.",
    lede: "Load music, podcasts and audiobooks onto your watch and leave your phone at home.",
    points: [
      {
        title: "From where you listen",
        body: "YouTube, YouTube Music, Spotify and Apple Music playlists, plus public podcasts."
      },
      {
        title: "Audiobooks, run-ready",
        body: "Long books split into short MP3 parts, in play order, with free LibriVox classics."
      },
      {
        title: "Watch storage at a glance",
        body: "Copy over USB and see what’s on the watch and what space is left."
      }
    ],
    places: [{ label: "Media", icon: MusicNotes }]
  },
  {
    id: "ready",
    label: "Set up",
    hue: "mint",
    eyebrow: "Last step",
    title: "Make it yours.",
    lede: "Pick a look and your units. You can change both any time."
  }
];

const LAST_INDEX = CHAPTERS.length - 1;

/** Chapter copy, with an "onboarding:" catalog key where a shared word needs other wording here. */
const tour = (source: string) => t(source, undefined, "onboarding");

/** Fit the fixed-size picture to whatever room the stage has. */
function useStageScale() {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const next = Math.min(1.12, (width - 32) / VIGNETTE_WIDTH, (height - 32) / VIGNETTE_HEIGHT);
      setScale(Math.max(0.5, Math.round(next * 1000) / 1000));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, scale };
}

function Vignette({ chapter, unitSystem }: { chapter: ChapterId; unitSystem: UnitSystem }) {
  const { language } = useLanguage();
  switch (chapter) {
    case "hello":
      return <HelloVignette language={language} />;
    case "welcome":
      return <WelcomeVignette />;
    case "training":
      return <TrainingVignette unitSystem={unitSystem} />;
    case "plan":
      return <PlanVignette unitSystem={unitSystem} />;
    case "strength":
      return <StrengthVignette unitSystem={unitSystem} />;
    case "watchfaces":
      return <WatchfacesVignette />;
    case "maps":
      return <MapsVignette unitSystem={unitSystem} />;
    case "music":
      return <MusicVignette />;
    default:
      return null;
  }
}

function ChoiceTile({
  selected,
  onSelect,
  children,
  label,
  lang,
  row = false
}: {
  selected: boolean;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  label: string;
  /** The label's own language, so a screen reader says it in that voice. */
  lang?: string;
  /** Picture, label and check side by side instead of stacked. */
  row?: boolean;
}) {
  useLanguage();
  return (
    <button
      type="button"
      className={["onb-choice", row && "is-row", selected && "is-selected"].filter(Boolean).join(" ")}
      aria-pressed={selected}
      lang={lang}
      onClick={onSelect}
    >
      {children}
      <span className="onb-choice-label">{label}</span>
      <span className="onb-choice-check" aria-hidden="true">
        <Check size={11} weight="bold" />
      </span>
    </button>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  useLanguage();
  return (
    <span className={`onb-theme-preview is-${theme}`} aria-hidden="true">
      <i className="is-sidebar" />
      <i className="is-card" />
      <i className="is-card is-wide" />
      <i className="is-accent" />
    </span>
  );
}

/** The app's languages, each greeting you in its own words. Picking one
    switches the whole tour at once, so the choice shows itself. */
function LanguagePicker() {
  const { language, setLanguage } = useLanguage();
  return (
    <div className="onb-languages" role="group" aria-label={t("App language")}>
      {LANGUAGES.map((option) => (
        <ChoiceTile
          key={option.value}
          row
          lang={option.value}
          label={option.label}
          selected={language === option.value}
          onSelect={() => setLanguage(option.value)}
        >
          <span className="onb-greeting" aria-hidden="true">
            {GREETINGS[option.value]}
          </span>
        </ChoiceTile>
      ))}
    </div>
  );
}

function Preferences() {
  useLanguage();
  const { theme, setTheme } = useTheme();
  const { unitSystem, setUnitSystem } = useUnitSystem();
  const pickTheme = (next: Theme) => (event: ReactMouseEvent<HTMLButtonElement>) => {
    if (next === theme) return;
    setTheme(next, { x: event.clientX, y: event.clientY });
  };
  return (
    <div className="onb-preferences">
      <div className="onb-preference">
        <span className="onb-preference-label">{t("Appearance")}</span>
        <div className="onb-choices">
          <ChoiceTile label={t("Dark")} selected={theme === "dark"} onSelect={pickTheme("dark")}>
            <ThemePreview theme="dark" />
          </ChoiceTile>
          <ChoiceTile label={t("Paper")} selected={theme === "paper"} onSelect={pickTheme("paper")}>
            <ThemePreview theme="paper" />
          </ChoiceTile>
        </div>
      </div>
      <div className="onb-preference">
        <span className="onb-preference-label">{t("Units")}</span>
        <div className="onb-choices">
          <ChoiceTile
            label={t("Metric")}
            selected={unitSystem === "metric"}
            onSelect={() => setUnitSystem("metric")}
          >
            <span className="onb-units" aria-hidden="true">
              {t("km")}<small>{t("kg · m")}</small>
            </span>
          </ChoiceTile>
          <ChoiceTile
            label={t("Imperial")}
            selected={unitSystem === "imperial"}
            onSelect={() => setUnitSystem("imperial")}
          >
            <span className="onb-units" aria-hidden="true">
              {t("mi")}<small>{t("lb · ft")}</small>
            </span>
          </ChoiceTile>
        </div>
      </div>
    </div>
  );
}

function ConnectStage({
  trainingConnected,
  watchConnected,
  onExit
}: {
  trainingConnected: boolean;
  watchConnected: boolean;
  onExit: (exit: OnboardingExit) => void;
}) {
  useLanguage();
  return (
    <div className="onb-connect">
      <p className="onb-connect-heading">{t("Connect when you’re ready")}</p>
      <div className="onb-connect-card" style={{ "--glyph": "var(--onb-cyan)", "--i": 0 } as CSSProperties}>
        <span className="onb-connect-glyph">
          <ChartLineUp size={22} weight="duotone" aria-hidden="true" />
        </span>
        <div className="onb-connect-copy">
          <strong>{t("COROS account")}</strong>
          <span>{t("Unlocks Training Hub, Coach, Calendar and Strength.")}</span>
        </div>
        {trainingConnected ? (
          <ConnectedBadge />
        ) : (
          <button type="button" className="onb-button is-raised" onClick={() => onExit("sign-in")}>
            {t("Sign in")}
          </button>
        )}
      </div>
      <div className="onb-connect-card" style={{ "--glyph": "var(--onb-pink)", "--i": 1 } as CSSProperties}>
        <span className="onb-connect-glyph">
          <Watch size={22} weight="duotone" aria-hidden="true" />
        </span>
        <div className="onb-connect-copy">
          <strong>{t("Your watch")}</strong>
          <span>{t("Bluetooth or USB, for faces, maps, routes and music.")}</span>
        </div>
        {watchConnected ? (
          <ConnectedBadge />
        ) : (
          <button type="button" className="onb-button is-raised" onClick={() => onExit("connect-watch")}>
            {t("Connect")}
          </button>
        )}
      </div>
      <p className="onb-connect-note" style={{ "--i": 2 } as CSSProperties}>
        <ShieldCheck size={16} weight="duotone" aria-hidden="true" />
        {t("Sign-ins stay on this computer, and sensitive ones are encrypted with your system keychain.")}
      </p>
    </div>
  );
}

const FOCUSABLE = 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

export interface OnboardingTourProps {
  trainingConnected: boolean;
  watchConnected: boolean;
  onClose: (exit: OnboardingExit) => void;
}

export function OnboardingTour({ trainingConnected, watchConnected, onClose }: OnboardingTourProps) {
  useLanguage();
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [leaving, setLeaving] = useState(false);
  const { unitSystem } = useUnitSystem();
  const dialogRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const { ref: stageRef, scale } = useStageScale();
  const chapter = CHAPTERS[index];
  const isFirst = index === 0;
  const isLast = index === LAST_INDEX;

  const goTo = useCallback((next: number) => {
    setIndex((current) => {
      const clamped = Math.max(0, Math.min(LAST_INDEX, next));
      if (clamped !== current) setDirection(clamped > current ? 1 : -1);
      return clamped;
    });
  }, []);

  const close = useCallback(
    (exit: OnboardingExit) => {
      if (leaving) return;
      setLeaving(true);
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.setTimeout(() => onClose(exit), reduced ? 0 : 260);
    },
    [leaving, onClose]
  );

  // The dialog itself takes focus, so no button wears a focus ring before the
  // person has used the keyboard; Enter and the arrows still work from here.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  // A step change can remove the focused button (Back on the first step).
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) {
      dialogRef.current?.focus({ preventScroll: true });
    }
  }, [index]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close("skip");
      } else if (event.key === "Enter" && document.activeElement === dialogRef.current) {
        event.preventDefault();
        primaryRef.current?.click();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "Tab" && dialogRef.current) {
        const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (active === last || !dialogRef.current.contains(active))) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [close, goTo, index]);

  const nextChapter = CHAPTERS[index + 1];

  return (
    <div className={["onboarding-backdrop", leaving && "is-leaving"].filter(Boolean).join(" ")} role="presentation">
      <section
        ref={dialogRef}
        className="onboarding"
        data-hue={chapter.hue}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby="onboarding-title"
        aria-describedby="onboarding-lede"
      >
        <div className="onb-story">
          <header className="onb-topbar">
            <span className="onb-brand">
              <span className="brand-mark onb-brand-mark">
                <img src={logoBase} alt="" aria-hidden="true" />
                <img className="brand-mark-sync" src={logoSync} alt="" aria-hidden="true" />
              </span>
              CorosLink
            </span>
            {!isLast ? (
              <button type="button" className="onb-skip" onClick={() => close("skip")}>
                {t("Skip tour")}
              </button>
            ) : null}
          </header>

          <div
            key={chapter.id}
            className="onb-chapter"
            style={{ "--dir": direction } as CSSProperties}
          >
            <p className="onb-eyebrow">
              {chapter.icon ? (
                <span className="onb-eyebrow-glyph">
                  <chapter.icon size={16} weight="duotone" aria-hidden="true" />
                </span>
              ) : null}
              {tour(chapter.eyebrow)}
            </p>
            <h2 id="onboarding-title" className="onb-title">
              {tour(chapter.title)}
            </h2>
            <p id="onboarding-lede" className="onb-lede">
              {tour(chapter.lede)}
            </p>

            {chapter.points ? (
              <ul className="onb-points">
                {chapter.points.map((point) => (
                  <li key={point.title}>
                    <span className="onb-point-dot" aria-hidden="true" />
                    <span>
                      <strong>{tour(point.title)}</strong>
                      {tour(point.body)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            {chapter.id === "hello" ? <LanguagePicker /> : null}
            {chapter.id === "ready" ? <Preferences /> : null}

            {chapter.places ? (
              <p className="onb-places">
                <span>{t("In the sidebar")}</span>
                {chapter.places.map(({ label, icon: Glyph }) => (
                  <span key={label} className="onb-place">
                    <Glyph size={14} weight="regular" aria-hidden="true" />
                    {t(label)}
                  </span>
                ))}
              </p>
            ) : null}
          </div>

          <footer className="onb-footer">
            <nav className="onb-progress-steps" aria-label={t("Tour chapters")}>
              {CHAPTERS.map((item, itemIndex) => (
                <button
                  key={item.id}
                  type="button"
                  className={[
                    "onb-step",
                    itemIndex < index && "is-done",
                    itemIndex === index && "is-current"
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  aria-label={t("{{chapter}}, step {{step}} of {{total}}", {
                    chapter: tour(item.label),
                    step: formatNumber(itemIndex + 1),
                    total: formatNumber(CHAPTERS.length)
                  })}
                  aria-current={itemIndex === index ? "step" : undefined}
                  title={tour(item.label)}
                  tabIndex={-1}
                  onClick={() => goTo(itemIndex)}
                >
                  <i />
                </button>
              ))}
            </nav>
            <div className="onb-actions">
              <span className="onb-counter" aria-live="polite">
                {t("{{step}} of {{total}}", { step: formatNumber(index + 1), total: formatNumber(CHAPTERS.length) })}
              </span>
              {!isFirst ? (
                <button type="button" className="onb-button is-ghost" onClick={() => goTo(index - 1)}>
                  <ArrowLeft size={15} weight="bold" aria-hidden="true" />
                  {t("Back")}
                </button>
              ) : null}
              <button
                ref={primaryRef}
                type="button"
                className="onb-button is-primary"
                onClick={() => (isLast ? close("explore") : goTo(index + 1))}
              >
                {chapter.id === "hello"
                  ? t("Let’s get started")
                  : chapter.id === "welcome"
                    ? t("Show me around")
                    : isLast
                      ? t("Start exploring")
                      : t("Next: {{chapter}}", { chapter: tour(nextChapter.label) })}
                <ArrowRight size={15} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </footer>
        </div>

        <div className="onb-stage" ref={stageRef}>
          <div className="onb-stage-dots" aria-hidden="true" />
          {isLast ? (
            <ConnectStage
              trainingConnected={trainingConnected}
              watchConnected={watchConnected}
              onExit={close}
            />
          ) : (
            <div
              key={chapter.id}
              className="onb-canvas"
              style={{ "--onb-scale": scale } as CSSProperties}
              aria-hidden="true"
            >
              <Vignette chapter={chapter.id} unitSystem={unitSystem} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
