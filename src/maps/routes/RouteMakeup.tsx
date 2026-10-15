import { t, useLanguage, getLocale } from "../../i18n/tools";
import { AlertTriangle, ChevronUp, Info, ShieldCheck, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  RouteActivityType,
  RouteInsights,
  RouteSurfacePreference,
  UnitSystem
} from "../../../electron/types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  formatShare,
  summarizeRouteMakeup,
  type MakeupCallout,
  type MakeupRow
} from "./routeMakeupModel";
import { formatShortDistance } from "./utils";
import "./routeMakeup.css";

/**
 * Stats-bar readout of what a route is made of: the share kept away from
 * traffic, the surface split, and chips for anything an athlete would want
 * to know before heading out (parking lots, busy roads, out-and-backs).
 * Clicking opens the full way-type and surface breakdown.
 */
export function RouteMakeup({
  insights,
  activityType,
  surfacePreference
}: {
  insights: RouteInsights;
  activityType: RouteActivityType;
  surfacePreference?: RouteSurfacePreference;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const makeup = useMemo(
    () =>
      summarizeRouteMakeup(insights, activityType, (meters) =>
        formatShortDistance(meters, unitSystem)
      ),
    [insights, activityType, unitSystem, getLocale()]
  );

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  if (makeup.wayRows.length === 0 && makeup.surfaceRows.length === 0) {
    return null;
  }

  const showUnpaved = surfacePreference === "trail" || makeup.unpavedShare > makeup.pavedShare;

  return (
    <div className="route-makeup" ref={rootRef}>
      <button
        type="button"
        className="route-makeup-toggle"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        title={t("Show way types and surfaces")}
      >
        <span className="route-makeup-figure">
          <strong>{formatShare(makeup.carFreeShare)}</strong>
          <em>{t("car-free")}</em>
        </span>
        <span className="route-makeup-figure">
          <strong>{formatShare(showUnpaved ? makeup.unpavedShare : makeup.pavedShare)}</strong>
          <em>{showUnpaved ? t("unpaved") : t("paved")}</em>
        </span>
        <ChevronUp size={13} aria-hidden="true" className="route-makeup-caret" />
      </button>

      {makeup.callouts.length > 0 ? (
        <div className="route-makeup-callouts">
          {makeup.callouts.map((callout) => (
            <CalloutChip key={callout.text} callout={callout} />
          ))}
        </div>
      ) : null}

      {open ? (
        <div className="route-makeup-popover" role="dialog" aria-label={t("Route makeup")}>
          <header>
            <strong>{t("Route makeup")}</strong>
            <button
              type="button"
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label={t("Close route makeup")}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </header>
          <div className="route-makeup-columns">
            <BarList title={t("Way types")} rows={makeup.wayRows} unitSystem={unitSystem} />
            <BarList title={t("Surfaces")} rows={makeup.surfaceRows} unitSystem={unitSystem} />
          </div>
          {makeup.callouts.length > 0 ? (
            <ul className="route-makeup-notes">
              {makeup.callouts.map((callout) => (
                <li key={callout.text} className={`is-${callout.tone}`}>
                  <CalloutIcon tone={callout.tone} />
                  <span>{t(callout.detail)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CalloutIcon({ tone }: { tone: MakeupCallout["tone"] }) {
  useLanguage();
  if (tone === "warning") return <AlertTriangle size={13} aria-hidden="true" />;
  if (tone === "good") return <ShieldCheck size={13} aria-hidden="true" />;
  return <Info size={13} aria-hidden="true" />;
}

function CalloutChip({ callout }: { callout: MakeupCallout }) {
  useLanguage();
  return (
    <span className={`route-makeup-chip is-${callout.tone}`} title={t(callout.detail)}>
      <CalloutIcon tone={callout.tone} />
      {t(callout.text)}
    </span>
  );
}

function BarList({
  title,
  rows,
  unitSystem
}: {
  title: string;
  rows: MakeupRow[];
  unitSystem: UnitSystem;
}) {
  useLanguage();
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((row) => row.share));
  return (
    <section className="route-makeup-list">
      <h4>{title}</h4>
      <ul>
        {rows.map((row) => (
          <li key={row.id}>
            <span className="route-makeup-label">{t(row.label)}</span>
            <span className="route-makeup-track" aria-hidden="true">
              <span
                className="route-makeup-fill"
                style={{ width: `${max > 0 ? Math.max(2, (row.share / max) * 100) : 0}%` }}
              />
            </span>
            <span className="route-makeup-value">
              {formatShortDistance(row.meters, unitSystem)}
              <em>{formatShare(row.share)}</em>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
