import { t, useLanguage } from "../i18n/tools";
import { memo, useEffect, useState } from "react";
import type { ChatProvider, ChatTurnStage } from "../../electron/types";

// Waiting this long with nothing written earns a word of reassurance.
const SLOW_AFTER_SECONDS = 20;
// Short waits read better without a running clock.
const CLOCK_AFTER_SECONDS = 3;

function providerName(provider: ChatProvider): string {
  if (provider === "claude-code") return "Claude";
  if (provider === "gemini-cli") return "Gemini";
  if (provider === "openrouter") return "OpenRouter";
  if (provider === "local") return t("Local model");
  return "ChatGPT";
}

/**
 * What Coach is doing right now, in words: the step before the model writes
 * (sign-in, tools, training data), then thinking, then any tool it calls.
 */
export function coachTurnStatusLabel({
  provider,
  stage,
  thinking,
  writing,
  tool,
  resuming
}: {
  provider: ChatProvider;
  stage?: ChatTurnStage;
  thinking: boolean;
  /** The answer has started. */
  writing: boolean;
  tool?: string | null;
  resuming: boolean;
}): string {
  if (tool) return t("Using {{p0}}…", { p0: tool.replace(/_/g, " ") });
  if (writing) return t("{{p0}} is replying…", { p0: providerName(provider) });
  if (thinking || stage === "model") return t("{{p0}} is thinking…", { p0: providerName(provider) });
  if (stage === "provider") return t("Connecting to {{p0}}…", { p0: providerName(provider) });
  if (stage === "tools") return t("Connecting tools…");
  if (stage === "context") return t("Reading your training data…");
  return resuming ? t("Resuming plan…") : t("Working on it…");
}

// One turn shows at a time; its start survives remounts (view switches, morphs).
let turnClock: { requestId: string; startedAt: number } | null = null;

function turnStartedAt(requestId: string): number {
  if (turnClock?.requestId !== requestId) {
    turnClock = { requestId, startedAt: Date.now() };
  }
  return turnClock.startedAt;
}

function useTurnSeconds(requestId: string): number {
  const startedAt = turnStartedAt(requestId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [requestId]);
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The pulsing dots shared by the transcript status and the conversations rail. */
export function CoachActivityDots() {
  return (
    <span className="coach-activity-dots" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

/**
 * The live line under the athlete's message until the answer starts: what is
 * happening, how long it has taken, and a reassurance when it runs long.
 */
export const CoachTurnStatus = memo(function CoachTurnStatus({
  requestId,
  label,
  waiting
}: {
  requestId: string;
  label: string;
  /** Nothing written yet, so a long wait gets the reassurance. */
  waiting: boolean;
}) {
  useLanguage();
  const seconds = useTurnSeconds(requestId);
  return (
    <div className="chat-turn-status-wrap">
      <div className="chat-turn-status" role="status">
        <CoachActivityDots />
        <span key={label} className="chat-turn-status-label">
          {label}
        </span>
        {seconds >= CLOCK_AFTER_SECONDS ? (
          <span className="chat-turn-status-clock" aria-hidden="true">
            {formatClock(seconds)}
          </span>
        ) : null}
      </div>
      {waiting && seconds >= SLOW_AFTER_SECONDS ? (
        <p className="chat-turn-status-hint">
          {t("Still working. Some replies take a minute, especially the first one.")}
        </p>
      ) : null}
    </div>
  );
});
