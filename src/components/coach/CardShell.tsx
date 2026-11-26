"use client";
import type { ReactNode } from "react";
import type { CardStat, CoachHue } from "@/data/coach";
import { CARDS_EMPTY, cardStore, setFolded } from "@/data/local/coach";
import { useStore } from "@/data/local/store";
import { t } from "@/lib/i18n";

export const hueVar = (h: CoachHue) => `var(--h-${h})`;
export const inkVar = (h: CoachHue) => `var(--h-${h}-ink)`;
/** A hue as the soft wash behind an icon or a chosen row. */
export const tint = (h: CoachHue, percent = 16) => `color-mix(in srgb, var(--h-${h}) ${percent}%, transparent)`;

/** The icon each kind of card carries in its header tile. */
export const ICONS = {
  run: "M3 12h4l3-8 4 16 3-8h4",
  compare: "M7 20V4M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4",
  fuel: "M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 1-9z",
  trend: "M4 18l5-6 4 3 7-9M15 6h5v5",
  today: "M5 17a8 8 0 1 1 14 0M12 13l4-5",
  check: "M4 7l2 2 3-4M4 15l2 2 3-4M13 7h7M13 16h7",
  page: "M6 3h9l4 4v14H6zM14 3v5h5M9 13h7M9 17h5",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  question: "M9.5 9a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1 1-1.1 1.8M12 17h.01M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18z",
  warn: "M12 9v4M12 17h.01M10.3 4.2L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0z",
  bookmark: "M7 4h10v16l-5-4-5 4z",
} as const;

export function Icon({ d, size = 17, width = 2.1 }: { d: string; size?: number; width?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      style={{ flex: "none", strokeWidth: width, strokeLinecap: "round", strokeLinejoin: "round" }}>
      <path d={d} />
    </svg>
  );
}

export const TICK = "M5 12l5 5 9-10";
export const CROSS = "M6 6l12 12M18 6L6 18";
export const ARROW = "M5 12h14M13 6l6 6-6 6";
export const OUT = "M8 16L16 8M9 8h7v7";

/** Label over a rounded figure, the way every card writes a number. */
export function Stat({ stat, size = 19 }: { stat: CardStat; size?: number }) {
  return (
    <div className="cc-stat">
      <span>{stat.label}</span>
      <span>
        <span className="num" style={{ fontSize: size, color: stat.hue ? inkVar(stat.hue) : undefined }}>{stat.value}</span>
        {stat.unit ? <small>{stat.unit}</small> : null}
      </span>
    </div>
  );
}

/** The one-line read at the foot of a card, behind a dot in the card's colour. */
export function Read({ hue, children }: { hue: CoachHue; children: ReactNode }) {
  return <p className="cc-read"><i aria-hidden="true" style={{ background: hueVar(hue) }} /><span>{children}</span></p>;
}

/** What happened to something a card asked for: a round mark, a bold word, the detail, then buttons. */
export function Outcome({ kind, title, detail, children }: { kind: "done" | "none" | "failed"; title: string; detail?: string; children?: ReactNode }) {
  return (
    <div className="cc-outcome" data-kind={kind} role="status">
      <i aria-hidden="true"><Icon d={kind === "done" ? TICK : kind === "failed" ? CROSS : "M6 12h12"} size={13} width={2.8} /></i>
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {children ? <span className="cc-outcome-actions">{children}</span> : null}
    </div>
  );
}

/**
 * One Coach card: an icon tile in the card's colour, a small coloured line and a title, the body, and a footer
 * with the read and the card's buttons. A foldable card shuts down to its title and read; the choice is kept
 * in this browser.
 */
export function CardShell({ id, hue, icon, eyebrow, title, subtitle, label, foldable = true, startsFolded = false, head, read, actions, footer, note, busy, children }: {
  id: string; hue: CoachHue; icon: string; eyebrow: string; title: string;
  /** One quiet line under the title. */
  subtitle?: string;
  /** The card's accessible name when the title alone is not enough. */
  label?: string;
  foldable?: boolean; startsFolded?: boolean;
  /** Extra controls in the header, before the fold button. */
  head?: ReactNode;
  read?: string;
  /** Buttons at the right of the footer, shown while the card is open. */
  actions?: ReactNode;
  /** A footer of the card's own instead of read and actions. */
  footer?: ReactNode;
  /** What the data layer said when a button could not do its job. */
  note?: string;
  busy?: boolean;
  children?: ReactNode;
}) {
  const choices = useStore(cardStore, CARDS_EMPTY);
  const folded = foldable && (choices.folded?.[id] ?? startsFolded);
  return (
    <article className="cc-card" aria-label={label ?? title} aria-busy={busy || undefined}>
      <header className="cc-head">
        <span aria-hidden="true" className="cc-tile" style={{ background: tint(hue), color: inkVar(hue) }}><Icon d={icon} /></span>
        <div>
          <span style={{ color: inkVar(hue) }}>{eyebrow}</span>
          <h3>{title}</h3>
          {subtitle ? <span className="cc-sub">{subtitle}</span> : null}
        </div>
        {folded ? null : head}
        {foldable ? (
          <button type="button" className="cc-icon" aria-expanded={!folded} aria-label={folded ? t("Show {title}", { title }) : t("Fold {title}", { title })} onClick={() => setFolded(id, !folded)}>
            <span style={{ transform: folded ? "rotate(-90deg)" : undefined }}><Icon d="M6 9l6 6 6-6" size={18} width={2.2} /></span>
          </button>
        ) : null}
      </header>
      {folded ? null : children}
      {footer ?? (read || actions ? (
        <footer className="cc-foot">
          {read ? <Read hue={hue}>{read}</Read> : null}
          {actions && !folded ? <div className="cc-actions">{actions}</div> : null}
        </footer>
      ) : null)}
      {note ? <p className="cc-note" role="status">{note}</p> : null}
    </article>
  );
}
