import { t, useLanguage } from "../i18n/watchfaces";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { useWatchfaceStudioSimple } from "./watchfaceStudioMode";
import {
  placeWatchfaceTourCard,
  watchfaceTourSpot,
  type WatchfaceTourBox,
  type WatchfaceTourCardPosition,
  type WatchfaceTourPlacement
} from "./watchfaceStudioTourLayout";
import "./watchfaceStudioTour.css";

export type WatchfaceTourStepId = "welcome" | "face" | "layers" | "add" | "properties" | "preview" | "mode" | "send";

interface TourStep {
  id: WatchfaceTourStepId;
  /** Selector inside the editor; without one the card sits in the middle. */
  target?: string;
  round?: boolean;
  order: WatchfaceTourPlacement[];
  title: string;
  body: string;
}

const STORAGE_KEY = "coroslink.watchface.studioTour.v1";

/** Whether this install has finished or skipped the Studio walkthrough. */
export function watchfaceStudioTourSeen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "done";
  } catch {
    // Without storage, don't show it on every open.
    return true;
  }
}

function markWatchfaceStudioTourSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "done");
  } catch {
    // Best effort.
  }
}

const undoKeys = () => /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Z" : "Ctrl+Z";

/**
 * A spotlight walkthrough of the editor for someone who has never used it:
 * the face, Layers, Add, Properties, the preview controls, Simple and
 * Advanced, then Send. `onStep` lets the editor show what a step talks
 * about (open a pane, select the time).
 */
export function WatchfaceStudioTour({ root, hasTimeLayer, onStep, onClose }: {
  root: HTMLElement | null;
  /** The properties step selects the time to show its controls. */
  hasTimeLayer: boolean;
  onStep: (step: WatchfaceTourStepId) => void;
  onClose: () => void;
}) {
  useLanguage();
  const simple = useWatchfaceStudioSimple();
  const steps: TourStep[] = [
    {
      id: "welcome",
      order: [],
      title: t("Welcome to Watch Face Studio"),
      body: t("This short tour shows where everything is: changing what's on the face, checking it, and sending it to your watch. It takes about a minute.")
    },
    {
      id: "face",
      target: ".watchface-editor-device",
      round: true,
      order: ["right", "left", "bottom"],
      title: t("This is your watch face"),
      body: t("Click anything on it, like the time or a number, to change it. Drag to move it, and undo any change with {{undo}}.", { undo: undoKeys() })
    },
    {
      id: "layers",
      target: ".wf-layers-pane",
      order: ["right", "bottom"],
      title: t("Everything on the face"),
      body: simple
        ? t("Each part of the face has a row here. Click one to select it. Parts the face isn't showing wait under Not on the face, ready to switch back on.")
        : t("Each part of the face has a row here. Click one to select it, or click its eye to hide or show it.")
    },
    {
      id: "add",
      target: ".watchface-add-sprite",
      order: ["right", "bottom"],
      title: t("Add more to the face"),
      body: t("Add the date, weather, heart rate, steps, your own photo, text or shapes.")
    },
    {
      id: "properties",
      target: ".wf-properties-pane",
      order: ["left", "bottom"],
      title: t("Style what you selected"),
      body: hasTimeLayer
        ? t("Change the color, font and size of the selected part here. We selected the hour digits to show you. Press Esc to clear the selection and see Quick edits.")
        : t("Select something on the face and its color, font and size appear here. With nothing selected, Quick edits suggest a first change.")
    },
    {
      id: "preview",
      target: ".wf-stage-toolbar",
      order: ["top", "bottom"],
      title: t("Check every look"),
      body: t("Current is the face you normally see. Always-on is the dim version shown while your wrist is down. Now tries other times, battery levels and weather.")
    },
    {
      id: "mode",
      target: ".wf-studio-mode-switch",
      order: ["bottom", "left"],
      title: t("Simple or Advanced"),
      body: t("Simple shows what most faces need. Advanced adds template images, PNG digit sets, config files and other watch sizes. Switch any time.")
    },
    {
      id: "send",
      target: ".wf-send-button",
      order: ["bottom", "left"],
      title: t("Put it on your watch"),
      body: t("Save keeps your project for later. When you like the face, Send to COROS shows it exactly as the watch will draw it, then installs it.")
    }
  ];
  const [index, setIndex] = useState(0);
  const step = steps[index]!;
  const last = index === steps.length - 1;
  const [spot, setSpot] = useState<WatchfaceTourBox | null>(null);
  const [card, setCard] = useState<WatchfaceTourCardPosition | null>(null);
  const [tick, setTick] = useState(0);
  const cardRef = useRef<HTMLElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();

  const finish = useCallback(() => {
    markWatchfaceStudioTourSeen();
    onClose();
  }, [onClose]);
  const go = useCallback((next: number) => {
    if (next < 0) return;
    if (next >= steps.length) finish();
    else setIndex(next);
  }, [finish, steps.length]);

  const stepId = step.id;
  useEffect(() => {
    onStep(stepId);
    // The editor re-renders panes and selection after onStep; measure again
    // once that and any pane slide have settled.
    const frame = requestAnimationFrame(() => setTick((value) => value + 1));
    const settle = window.setTimeout(() => setTick((value) => value + 1), 340);
    return () => { cancelAnimationFrame(frame); window.clearTimeout(settle); };
  }, [stepId, onStep]);

  useEffect(() => {
    const remeasure = () => setTick((value) => value + 1);
    window.addEventListener("resize", remeasure);
    window.addEventListener("scroll", remeasure, true);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(remeasure);
    const target = step.target ? root?.querySelector(step.target) : null;
    if (target) observer?.observe(target);
    return () => {
      window.removeEventListener("resize", remeasure);
      window.removeEventListener("scroll", remeasure, true);
      observer?.disconnect();
    };
  }, [root, step.target]);

  useLayoutEffect(() => {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const element = step.target ? root?.querySelector(step.target) : null;
    const rect = element?.getBoundingClientRect();
    const target = rect && rect.width > 0 && rect.height > 0
      ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      : null;
    const nextSpot = target ? watchfaceTourSpot(target, viewport, step.round ? 10 : 6) : null;
    const size = cardRef.current?.getBoundingClientRect() ?? { width: 340, height: 220 };
    const next = placeWatchfaceTourCard(nextSpot, { width: size.width, height: size.height }, viewport, step.order);
    setSpot((current) => sameBox(current, nextSpot) ? current : nextSpot);
    setCard((current) => current && current.x === next.x && current.y === next.y && current.placement === next.placement ? current : next);
  }, [root, step.target, step.round, step.order, tick, index]);

  // The primary button takes focus on every step, so Enter walks the tour.
  useEffect(() => { primaryRef.current?.focus({ preventScroll: true }); }, [index]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    return () => previous?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    // Capture phase on window, so no key reaches the editor's shortcuts
    // (nudge, delete, undo) while the tour is open. App menu shortcuts and
    // the focused card button keep their default action.
    const keydown = (event: KeyboardEvent) => {
      event.stopPropagation();
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight") go(index + 1);
      else if (event.key === "ArrowLeft") go(index - 1);
      else if (event.key === "Tab") {
        const buttons = [...(cardRef.current?.querySelectorAll<HTMLElement>("button") ?? [])];
        const at = buttons.indexOf(document.activeElement as HTMLElement);
        buttons[(at + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      } else if (
        event.metaKey || event.ctrlKey ||
        ((event.key === "Enter" || event.key === " ") && cardRef.current?.contains(document.activeElement))
      ) return;
      event.preventDefault();
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [finish, go, index]);

  return createPortal(
    <div className="wf-tour" data-step={step.id}>
      <div
        className={`wf-tour-spot${spot ? "" : " is-empty"}${step.round ? " is-round" : ""}`}
        style={spot
          ? { top: spot.y, left: spot.x, width: spot.width, height: spot.height }
          : { top: "50%", left: "50%", width: 0, height: 0 }}
        aria-hidden="true"
      />
      <section
        ref={cardRef}
        className={`wf-tour-card${step.target ? "" : " is-intro"}`}
        data-placement={card?.placement ?? "center"}
        style={card ? { top: card.y, left: card.x } : { visibility: "hidden" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
      >
        <div className="wf-tour-meta">
          <span className="wf-tour-count">{t("{{step}} of {{total}}", { step: index + 1, total: steps.length })}</span>
          <span className="wf-tour-dots" aria-hidden="true">
            {steps.map((item, at) => <span key={item.id} className={at === index ? "is-current" : at < index ? "is-done" : ""} />)}
          </span>
        </div>
        <h2 id={titleId}>{step.title}</h2>
        <p id={bodyId}>{step.body}</p>
        <footer>
          {last ? <span /> : <button type="button" className="wf-tour-skip" onClick={finish}>{t("Skip tour")}</button>}
          <span className="wf-tour-nav">
            {index > 0 ? (
              <button type="button" className="wf-tour-back" onClick={() => go(index - 1)}>
                <ArrowLeft size={14} aria-hidden="true" />{t("Back")}
              </button>
            ) : null}
            <button ref={primaryRef} type="button" className="wf-tour-next" onClick={() => go(index + 1)}>
              {index === 0 ? t("Show me around") : last ? t("Start designing") : t("Next")}
              {last ? null : <ArrowRight size={14} aria-hidden="true" />}
            </button>
          </span>
        </footer>
      </section>
    </div>,
    document.body
  );
}

function sameBox(left: WatchfaceTourBox | null, right: WatchfaceTourBox | null): boolean {
  if (!left || !right) return left === right;
  return left.x === right.x && left.y === right.y && left.width === right.width && left.height === right.height;
}
