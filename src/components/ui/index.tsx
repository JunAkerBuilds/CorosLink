"use client";
import Link from "next/link";
import { msg, t } from "@/lib/i18n";
import { platformSlots } from "@/lib/platform";
import type { ComponentProps, ReactNode } from "react";
import type { Origin } from "@/data/core";

export { CountUp } from "./CountUp";
export { Dropdown, Select, type DropdownOption } from "./Dropdown";

type Variant = "glass" | "primary" | "ink" | "plain";
const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Pill button. `glass` is the raised white/glass pill, `primary` the mint call to action, `ink` the strong dark/white one. */
export function Button({ variant = "glass", className, type = "button", ...rest }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} className={cx("btn", `btn-${variant}`, className)} {...rest} />;
}

/** The same pill as a link, for navigation. */
export function LinkButton({ variant = "glass", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx("btn", `btn-${variant}`, className)} {...rest} />;
}

export interface SegOption<T extends string> { value: T; label: ReactNode }

/** Segmented control: a pressed-in track with a raised thumb on the chosen option. */
export function Segmented<T extends string>({ label, options, value, onChange, small, className }: {
  label: string; options: readonly SegOption<T>[]; value: T; onChange: (value: T) => void; small?: boolean; className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cx("seg", small && "seg-sm", className)}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

/** Rounded surface. `clip` hides overflowing rows (tables), `pad` adds the standard 20px padding. */
export function Card({ clip, pad, className, ...rest }: ComponentProps<"section"> & { clip?: boolean; pad?: boolean }) {
  return <section className={cx("card", clip && "card-clip", pad && "card-pad", className)} {...rest} />;
}

export function Field({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx("field", className)} {...rest} />;
}

/** Dropdown with the app's own chevron (never the browser's arrow). `field` gives it the pressed-in look of a form field. */

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange(!checked)} />;
}

const ORIGIN_TEXT: Record<Origin, string> = {
  sample: msg("Sample data"),
  browser: msg("On this computer"),
  coros: msg("From COROS"),
  synced: msg("From your phone"),
};

/** Says where a screen's numbers come from. Every screen on sample data must show this. */
export function OriginBadge({ origin, className }: { origin: Origin; className?: string }) {
  if (origin !== "sample" && platformSlots.originShown && !platformSlots.originShown(origin)) return null;
  return <span className={cx("origin", className)} data-origin={origin}>{t(ORIGIN_TEXT[origin])}</span>;
}

/** Page title row: h1 on the left, compact controls on the right. */
export function PageHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children ? <div className="actions">{children}</div> : null}
    </div>
  );
}

/** Inline 80×24 trend line. `color` is a CSS colour, normally a hue token such as var(--h-mint). */
export function Sparkline({ d, color, width = 80, height = 24 }: { d: string; color: string; width?: number; height?: number }) {
  return (
    <svg aria-hidden="true" className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <path d={d} fill="none" style={{ stroke: color, strokeWidth: 1.5 }} />
    </svg>
  );
}
