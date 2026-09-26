import { useCallback, useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type {
  TrainingHubDashboard,
  TrainingHubPersonalRecord,
  UnitSystem
} from "../../../electron/types";
import {
  formatPersonalRecordHero,
  formatPersonalRecordMeta,
  formatRecordDateShort,
  isPersonalRecordPopulated
} from "../formatters";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { formatDistanceValue } from "../../units/units";
import {
  defineSelectionPreference,
  readSelectionPreference,
  selectionIsArrayOf,
  writeSelectionPreference
} from "../../preferences/selectionPreferences";
import "../personalRecords.css";

export const PR_ASSET_BASE = "./assets/training-hub/PR";

/** Records the celebration has already played for, so each PR is celebrated once. */
const CELEBRATED_RECORDS_PREFERENCE = defineSelectionPreference<string[]>({
  key: "training.celebratedRecords",
  defaultValue: [],
  validate: selectionIsArrayOf((value): value is string => typeof value === "string")
});
const CELEBRATED_RECORDS_LIMIT = 200;
/** How long the on-card echo plays after the overlay is dismissed. */
const CARD_CELEBRATION_MS = 4200;
const OVERLAY_AUTO_DISMISS_MS = 7000;
const OVERLAY_EXIT_MS = 420;

export function recordSignature(record: TrainingHubPersonalRecord): string {
  return `${record.type}:${record.happenDay ?? ""}:${record.duration ?? record.distance ?? ""}`;
}

export function recordLabel(record: TrainingHubPersonalRecord, unitSystem: UnitSystem): string {
  const numericLabel = record.label.match(/^([\d.]+)\s*(km|m)$/i);

  if (numericLabel && Number.isFinite(Number(numericLabel[1]))) {
    return formatDistanceValue(
      Number(numericLabel[1]) * (numericLabel[2]?.toLowerCase() === "km" ? 1000 : 1),
      unitSystem
    );
  }

  return record.label;
}

/** Split "12.01km" / "84m" into a bold value and a muted unit. */
export function splitHero(hero: string): { value: string; unit: string | null } {
  const match = hero.match(/^([\d.:,]+)\s*(km|mi|m|ft)$/i);

  if (match) {
    return { value: match[1]!, unit: match[2]! };
  }

  return { value: hero, unit: null };
}

interface BurstParticle {
  x: number;
  y: number;
  rot: number;
  color: string;
  shape: "wide" | "round" | null;
  delay: number;
}

const CONFETTI_COLORS = ["#ffe3a3", "#f0c870", "#d39b3a", "#fff6dc", "#78dcaa"];

/** Confetti laid out deterministically around a circle. */
function burstParticles(count: number, minDistance: number, spread: number): BurstParticle[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.21;
    const distance = minDistance + ((index * 37) % spread);
    return {
      x: Math.cos(angle) * distance,
      y: Math.sin(angle) * distance * 0.75 - minDistance * 0.2,
      rot: ((index * 97) % 540) - 270,
      color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]!,
      shape: index % 4 === 1 ? "round" : index % 3 === 0 ? "wide" : null,
      delay: (index % 5) * 22
    };
  });
}

const CARD_BURST = burstParticles(26, 78, 70);
const OVERLAY_BURST = burstParticles(48, 150, 190);

/** Confetti rain across the whole window. */
const RAIN = Array.from({ length: 72 }, (_, index) => ({
  left: (index * 41 + (index % 7) * 3) % 100,
  delay: ((index * 53) % 1400) + 150,
  duration: 2600 + ((index * 71) % 1800),
  sway: ((index * 29) % 120) - 60,
  rot: 360 + ((index * 83) % 720),
  color: CONFETTI_COLORS[index % CONFETTI_COLORS.length]!,
  shape: index % 4 === 1 ? "round" : index % 3 === 0 ? "wide" : null
}));

export function RecordBurst({ variant = "card" }: { variant?: "card" | "overlay" }) {
  const particles = variant === "overlay" ? OVERLAY_BURST : CARD_BURST;

  return (
    <span className={`pr-burst is-${variant}`} aria-hidden="true">
      <span className="pr-burst-ring" />
      <span className="pr-burst-ring is-late" />
      {particles.map((particle, index) => (
        <i
          key={index}
          className={particle.shape ? `is-${particle.shape}` : undefined}
          style={
            {
              "--x": `${particle.x.toFixed(1)}px`,
              "--y": `${particle.y.toFixed(1)}px`,
              "--rot": `${particle.rot}deg`,
              "--c": particle.color,
              "--d": `${particle.delay}ms`
            } as CSSProperties
          }
        />
      ))}
    </span>
  );
}

/** Text split per character so the digits can roll in. */
export function RollingText({ text, rolling, delay = 200 }: { text: string; rolling: boolean; delay?: number }) {
  if (!rolling) {
    return <>{text}</>;
  }

  return (
    <span className="pr-roll" aria-label={text} style={{ "--roll-delay": `${delay}ms` } as CSSProperties}>
      {[...text].map((char, index) => (
        <span key={index} aria-hidden="true" style={{ "--i": index } as CSSProperties}>
          {char}
        </span>
      ))}
    </span>
  );
}

export interface RecordCelebration {
  signature: string;
  nonce: number;
}

interface CelebrationState extends RecordCelebration {
  phase: "overlay" | "card";
  /** Explicit record for replays/dev tests that may not be in the dashboard. */
  record?: TrainingHubPersonalRecord;
}

/**
 * Watches the dashboard's personal records and celebrates any that appeared
 * since the last visit. The very first load only seeds the list, so existing
 * history doesn't all go off at once.
 */
export function usePersonalRecordCelebration(
  dashboard: TrainingHubDashboard | null,
  enabled: boolean
) {
  const [state, setState] = useState<CelebrationState | null>(null);
  const records = useMemo(
    () => (dashboard?.personalRecords ?? []).flatMap((group) => group.records),
    [dashboard]
  );
  const signaturesKey = useMemo(
    () =>
      [...new Set(records.filter(isPersonalRecordPopulated).map(recordSignature))]
        .sort()
        .join("|"),
    [records]
  );

  useEffect(() => {
    if (!enabled || !signaturesKey) {
      return;
    }

    const current = signaturesKey.split("|");
    const stored = readSelectionPreference(CELEBRATED_RECORDS_PREFERENCE);
    const seen = new Set(stored.value);
    const fresh = current.filter((signature) => !seen.has(signature));

    if (fresh.length === 0) {
      return;
    }

    writeSelectionPreference(
      CELEBRATED_RECORDS_PREFERENCE,
      [...stored.value, ...fresh].slice(-CELEBRATED_RECORDS_LIMIT)
    );

    if (!stored.restored) {
      return;
    }

    const newestFresh = fresh.reduce((best, signature) =>
      (signature.split(":")[1] ?? "") > (best.split(":")[1] ?? "") ? signature : best
    );
    setState({ signature: newestFresh, nonce: Date.now(), phase: "overlay" });
  }, [enabled, signaturesKey]);

  useEffect(() => {
    if (state?.phase !== "card") {
      return;
    }

    const timer = window.setTimeout(() => setState(null), CARD_CELEBRATION_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  const record = state
    ? state.record ??
      records.find((candidate) => recordSignature(candidate) === state.signature) ??
      null
    : null;

  const replay = useCallback((target: TrainingHubPersonalRecord) => {
    setState({ signature: recordSignature(target), nonce: Date.now(), phase: "overlay", record: target });
  }, []);

  /** Dev only: play the celebration for the newest record, or a stand-in 5K. */
  const test = useCallback(() => {
    const newest = records
      .filter(isPersonalRecordPopulated)
      .reduce<TrainingHubPersonalRecord | null>(
        (best, candidate) =>
          !best || (candidate.happenDay ?? "") > (best.happenDay ?? "") ? candidate : best,
        null
      );
    const today = new Date();
    replay(
      newest ?? {
        type: 5,
        label: "5K",
        distance: 5000,
        duration: 1292,
        avgPace: 258,
        happenDay: `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
          today.getDate()
        ).padStart(2, "0")}`
      }
    );
  }, [records, replay]);

  const dismiss = useCallback(() => {
    setState((current) => (current ? { ...current, nonce: Date.now(), phase: "card" } : null));
  }, []);

  return {
    overlayRecord: state?.phase === "overlay" ? record : null,
    overlayNonce: state?.phase === "overlay" ? state.nonce : null,
    cardCelebration:
      state?.phase === "card" && record ? { signature: state.signature, nonce: state.nonce } : null,
    replay,
    test,
    dismiss
  };
}

interface PersonalRecordCelebrationOverlayProps {
  record: TrainingHubPersonalRecord;
  onDismiss: () => void;
}

/** Full-window, centred "New personal record" moment. */
export function PersonalRecordCelebrationOverlay({
  record,
  onDismiss
}: PersonalRecordCelebrationOverlayProps) {
  const { unitSystem } = useUnitSystem();
  const titleId = useId();
  const [leaving, setLeaving] = useState(false);
  const label = recordLabel(record, unitSystem);
  const { value, unit } = splitHero(formatPersonalRecordHero(record, unitSystem));
  const pace = formatPersonalRecordMeta(record, unitSystem);
  const date = formatRecordDateShort(record.happenDay);

  const leave = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    if (!leaving) {
      const timer = window.setTimeout(leave, OVERLAY_AUTO_DISMISS_MS);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setTimeout(onDismiss, OVERLAY_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [leave, leaving, onDismiss]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        leave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  return createPortal(
    <div
      className={leaving ? "pr-celebration is-leaving" : "pr-celebration"}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={leave}
    >
      <div className="pr-celebration-backdrop" aria-hidden="true" />

      <div className="pr-celebration-rain" aria-hidden="true">
        {RAIN.map((piece, index) => (
          <i
            key={index}
            className={piece.shape ? `is-${piece.shape}` : undefined}
            style={
              {
                left: `${piece.left}%`,
                "--c": piece.color,
                "--d": `${piece.delay}ms`,
                "--t": `${piece.duration}ms`,
                "--sway": `${piece.sway}px`,
                "--rot": `${piece.rot}deg`
              } as CSSProperties
            }
          />
        ))}
      </div>

      <div className="pr-celebration-stage">
        <div className="pr-celebration-rays" aria-hidden="true" />
        <div className="pr-celebration-glow" aria-hidden="true" />

        <div className="pr-celebration-emblem" aria-hidden="true">
          <img
            className="pr-celebration-wheat is-left"
            src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
            alt=""
          />
          <span className="pr-celebration-medal">PR</span>
          <img
            className="pr-celebration-wheat is-right"
            src={`${PR_ASSET_BASE}/left-wheat_no_bg.png`}
            alt=""
          />
          <RecordBurst variant="overlay" />
        </div>

        <p className="pr-celebration-eyebrow">New personal record</p>
        <h2 className="pr-celebration-title" id={titleId}>
          {label}
        </h2>
        <p className="pr-celebration-hero">
          <RollingText text={value} rolling delay={900} />
          {unit ? <span className="pr-celebration-unit">{unit}</span> : null}
        </p>
        <p className="pr-celebration-meta">
          {pace ? <span>{pace}</span> : null}
          {pace ? <span className="pr-summary-sep" aria-hidden="true" /> : null}
          <span>{date}</span>
        </p>

        <button type="button" className="pr-celebration-continue" autoFocus onClick={leave}>
          Continue
        </button>
      </div>
    </div>,
    document.body
  );
}
