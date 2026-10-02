import type { CSSProperties } from "react";

/**
 * Watchmaker's mark in Watch Face Studio: a tiny watch dial whose lume seconds hand
 * sweeps once a minute at rest and races while Watchmaker is working.
 */
export function WatchmakerDial({
  size = 16,
  working = false,
  hands = false,
  className
}: {
  size?: number;
  working?: boolean;
  /** Adds hour and minute hands at 10:10, for the larger hero dial. */
  hands?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`wf-watchmaker-dial${working ? " is-working" : ""}${hands ? " has-hands" : ""}${size >= 40 ? " is-large" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--dial-size": `${size}px` } as CSSProperties}
      aria-hidden="true"
    >
      <span className="wf-watchmaker-dial-bezel" />
      <span className="wf-watchmaker-dial-ticks" />
      <span className="wf-watchmaker-dial-sweep" />
      {hands ? <span className="wf-watchmaker-dial-hands" /> : null}
      <span className="wf-watchmaker-dial-cap" />
    </span>
  );
}
