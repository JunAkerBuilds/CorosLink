import { t, useLanguage, getLocale } from "../../i18n/tools";
import { Check } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import type {
  RouteActivityType,
  RouteGeometry,
  RouteSurfacePreference
} from "../../../electron/types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import {
  buildLoopOptionCards,
  LOOP_SHAPE_HEIGHT,
  LOOP_SHAPE_WIDTH
} from "./loopOptionsModel";
import { formatShare } from "./routeMakeupModel";
import { formatMeters, formatShortDistance } from "./utils";
import "./loopOptions.css";

/**
 * Generate's loop choices, shown under the Generate button: the best match
 * plus up to two distinct runner-ups. Hovering a card highlights that loop
 * on the map; picking one makes it the saved route.
 */
export function LoopOptions({
  options,
  selected,
  activityType,
  surfacePreference,
  disabled,
  onPick,
  onHover
}: {
  options: RouteGeometry[];
  selected: number;
  activityType: RouteActivityType;
  surfacePreference?: RouteSurfacePreference;
  disabled: boolean;
  onPick: (index: number) => void;
  onHover: (index: number | null) => void;
}) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const rootRef = useRef<HTMLElement>(null);
  const { cards, surfaceLabel } = useMemo(
    () => buildLoopOptionCards(options, activityType, surfacePreference),
    [options, activityType, surfacePreference, getLocale()]
  );
  // A fresh set lands under the fold of the scrolling panel; bring it up.
  // Wait two frames: the stats bar grows in the same render, and the studio
  // only shrinks the panel to clear it once its ResizeObserver has run.
  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() =>
        rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [options]);

  return (
    <section
      className="route-loop-options"
      aria-labelledby="route-loop-options-title"
      ref={rootRef}
    >
      <h3 className="route-step-title" id="route-loop-options-title">{t("Pick your loop")}</h3>
      <div
        className="route-loop-option-grid"
        role="group"
        aria-labelledby="route-loop-options-title"
        style={{ gridTemplateColumns: `repeat(${cards.length}, minmax(0, 1fr))` }}
        onMouseLeave={() => onHover(null)}
      >
        {cards.map((card, index) => {
          const isSelected = index === selected;
          return (
            <button
              key={index}
              type="button"
              className={`route-loop-option${isSelected ? " is-selected" : ""}`}
              aria-pressed={isSelected}
              disabled={disabled}
              onClick={() => onPick(index)}
              onMouseEnter={() => onHover(index)}
              onFocus={() => onHover(index)}
              onBlur={() => onHover(null)}
            >
              {isSelected ? (
                <span className="route-loop-option-badge" aria-hidden="true">
                  <Check size={10} strokeWidth={3.5} />
                </span>
              ) : null}
              <span className="route-loop-option-label" title={card.label}>
                {card.label}
              </span>
              <svg
                className="route-loop-option-shape"
                viewBox={`0 0 ${LOOP_SHAPE_WIDTH} ${LOOP_SHAPE_HEIGHT}`}
                aria-hidden="true"
              >
                <path d={card.shapePath} />
                {card.start ? <circle cx={card.start.x} cy={card.start.y} r={2.6} /> : null}
              </svg>
              <span className="route-loop-option-distance">
                {formatShortDistance(card.distanceMeters, unitSystem)}
              </span>
              <span className="route-loop-option-climb">
                ↑ {formatMeters(card.ascentMeters, unitSystem)}
              </span>
              <span className="route-loop-option-stats">
                <span>
                  <em>{t("Car-free")}</em>
                  {card.carFreeShare === undefined ? "—" : formatShare(card.carFreeShare)}
                </span>
                <span>
                  <em>{surfaceLabel === "unpaved" ? t("Unpaved") : t("Paved")}</em>
                  {card.surfaceShare === undefined ? "—" : formatShare(card.surfaceShare)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
