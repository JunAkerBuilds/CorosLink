import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { useId } from "react";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import type { CorosDirectWatchfaceStatus } from "../../electron/corosBleWatchfaceTypes";
import type { WatchfaceInstaller, WatchInstallStep } from "./watchLink";

/** What the compiler flagged: images it could not load (blank on the watch) and positions COROS misreads. */
export function CompileWarnings({ warnings }: { warnings?: string[] }) {
  useLanguage();
  if (!warnings?.length) return null;
  const more = warnings.length - 3;
  return <div className="watch-compile-warnings" role="status">
    <p className="watch-compile-warnings-title"><TriangleAlert size={14} aria-hidden="true" />{warnings.length === 1 ? t("1 element won't show as designed") : t("{{value1}} elements won't show as designed", { value1: warnings.length })}</p>
    <ul>
      {warnings.slice(0, 3).map(warning => <li key={warning}>{t(warning)}</li>)}
      {more > 0 ? <li className="is-more">{t("And")}{" "}{more}{" "}{t("more.")}</li> : null}
    </ul>
  </div>;
}

/** The watch's face slots as a compact radio strip. Empty slots read as dashed. */
export function WatchSlotPicker({ installer, disabled, compact = false }: {
  installer: WatchfaceInstaller; disabled?: boolean; compact?: boolean;
}) {
  useLanguage();
  const name = useId();
  const { inventory, selectedSlot } = installer;
  if (!inventory) return null;
  return <fieldset className={`watch-slots${compact ? " is-compact" : ""}`} disabled={disabled}>
    <legend className="sr-only">{t("Destination watch face slot")}</legend>
    {inventory.slots.map(item => {
      const empty = item.faceId === null;
      return <label key={item.slot}
        className={`watch-slot${empty ? " is-empty" : ""}${item.slot === selectedSlot ? " is-selected" : ""}`}
        title={empty ? t("Slot {{value1}} is empty", { value1: item.slot + 1 }) : t("Slot {{value1}} holds face ID {{value2}}", { value1: item.slot + 1, value2: item.faceId })}>
        <input type="radio" name={name} value={item.slot} checked={item.slot === selectedSlot}
          onChange={() => installer.select(item.slot)} />
        <span className="watch-slot-number">{item.slot + 1}</span>
        <span className="watch-slot-state">{empty ? t("Empty") : compact ? t("In use") : <><span className="sr-only">{t("Face ID")}{" "}</span>{item.faceId}</>}</span>
      </label>;
    })}
  </fieldset>;
}

type StepState = "pending" | "active" | "done" | "failed";

/** Compile → Send → Verify, with a byte progress bar while sending. */
export function WatchInstallProgress({ status, compile }: {
  status: CorosDirectWatchfaceStatus;
  /** Present when this install compiles first. */
  compile?: { state: StepState; detail?: string };
}) {
  useLanguage();
  const percent = status.totalBytes ? Math.min(100, Math.round(status.sentBytes / status.totalBytes * 100)) : 0;
  const sending = status.phase === "preparing" || status.phase === "transferring";
  const sent = status.phase === "verifying" || status.phase === "complete";
  const stopped = status.phase === "failed" || status.phase === "cancelled";
  const started = compile?.state !== "pending" && compile?.state !== "active" && compile?.state !== "failed";
  const steps: Array<{ id: WatchInstallStep; label: string; state: StepState; detail?: string }> = [
    ...(compile ? [{ id: "compile" as const, label: "Compile", ...compile }] : []),
    { id: "send", label: "Send", state: !started ? "pending" : sent ? "done" : stopped ? "failed" : sending ? "active" : "pending",
      detail: sending ? (status.phase === "preparing" ? "Preparing" : `${percent}%`) : status.phase === "cancelled" ? "Cancelled" : undefined },
    { id: "verify", label: "Verify", state: status.phase === "complete" ? "done" : status.phase === "verifying" ? "active" : "pending" }
  ];
  return <div className="watch-install-progress" role="status" aria-live="polite">
    <ol>
      {steps.map(step => <li key={step.id} className={`is-${step.state}`}>
        <span className="watch-install-dot" aria-hidden="true">
          {step.state === "done" ? <Check size={12} strokeWidth={3} /> : step.state === "active" ? <Loader2 className="spin" size={12} />
            : step.state === "failed" ? <X size={12} strokeWidth={3} /> : null}
        </span>
        <span>{t(step.label)}</span>
        {step.detail ? <small>{t(step.detail)}</small> : null}
      </li>)}
    </ol>
    <div className="watch-install-bar" aria-hidden="true">
      <span style={{ width: `${sent ? 100 : sending ? percent : 0}%` }} />
    </div>
    <span className="sr-only">{status.phase === "verifying" ? t("Verifying on watch…")
      : sending ? t("Sending… {{percent}}%", { percent: percent }) : status.phase === "complete" ? t("Installed.") : ""}</span>
  </div>;
}

/** One sentence describing how the last install ended. */
export function watchInstallResult(status: CorosDirectWatchfaceStatus): string | null {
  const slot = (status.watchSlot ?? 0) + 1;
  if (status.phase === "complete") return status.verification === "transfer-acknowledged"
    ? t("Sent to slot {{slot}}. Its face ID is unchanged, so check the new look on your watch.", { slot: slot })
    : t("Installed in slot {{slot}}. The watch confirmed the new face.", { slot: slot });
  if (status.phase === "cancelled") return t("Install cancelled.");
  return null;
}
