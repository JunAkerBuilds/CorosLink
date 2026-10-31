import { Waves } from "lucide-react";
import { formatNumber, t, useLanguage } from "../../i18n/training";
import type { TrainingHubSwimStroke, TrainingHubSwimSummary, UnitSystem } from "../../../electron/types";
import { useUnitSystem } from "../../units/UnitSystemProvider";
import { METERS_PER_YARD } from "../../units/units";
import { Items, type Item } from "./ActivityTrainingEffect";

/** A stroke's name as the watch's display gives it. */
export function swimStrokeLabel(stroke: TrainingHubSwimStroke | undefined): string {
  switch (stroke) {
    case "freestyle": return t("Freestyle");
    case "backstroke": return t("Backstroke");
    case "breaststroke": return t("Breaststroke");
    case "butterfly": return t("Butterfly");
    case "drill": return t("Drill");
    case "mixed": return t("Mixed");
    case "medley": return t("Medley");
    default: return "-";
  }
}

/** m:ss per 100 m, or per 100 yd in imperial units. */
export function formatSwimPace(secondsPer100m: number | undefined, unitSystem: UnitSystem): string {
  if (secondsPer100m === undefined || !Number.isFinite(secondsPer100m) || secondsPer100m <= 0) return "-";
  const seconds = Math.round(unitSystem === "imperial" ? secondsPer100m * METERS_PER_YARD : secondsPer100m);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} ${unitSystem === "imperial" ? "/100yd" : "/100m"}`;
}

/** A swim's totals as the watch recorded them: lengths, strokes, SWOLF, stroke rate. */
export function ActivitySwimSummary({ swim }: { swim: TrainingHubSwimSummary }) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  // A pool's lengths read in its own unit; open water follows the app's units.
  const yards = swim.poolLengthUnit ? swim.poolLengthUnit === "yd" : unitSystem === "imperial";
  const items: Item[] = [];
  const whole = (value: number) => formatNumber(Math.round(value));
  const pace = (secondsPer100m: number) => {
    const [value, unit] = formatSwimPace(secondsPer100m, yards ? "imperial" : "metric").split(" ");
    return { value: value!, unit };
  };
  if (swim.poolLength !== undefined) {
    items.push({ label: t("Pool length"), value: formatNumber(yards ? swim.poolLength / METERS_PER_YARD : swim.poolLength, { maximumFractionDigits: 1 }), unit: yards ? "yd" : "m" });
  }
  if (swim.lengths !== undefined) items.push({ label: t("Lengths"), value: whole(swim.lengths) });
  if (swim.strokes !== undefined) items.push({ label: t("Strokes"), value: whole(swim.strokes) });
  if (swim.avgSwolf !== undefined) items.push({ label: t("Avg SWOLF"), value: whole(swim.avgSwolf) });
  if (swim.bestSwolf !== undefined) items.push({ label: t("Best SWOLF"), value: whole(swim.bestSwolf) });
  if (swim.bestPace !== undefined) items.push({ label: t("Best pace"), ...pace(swim.bestPace) });
  if (swim.avgStrokeRate !== undefined) items.push({ label: t("Avg stroke rate"), value: whole(swim.avgStrokeRate), unit: "spm" });
  if (swim.maxStrokeRate !== undefined) items.push({ label: t("Max stroke rate"), value: whole(swim.maxStrokeRate), unit: "spm" });
  if (swim.strokeDistance !== undefined) {
    items.push({
      label: t("Distance per stroke"),
      value: formatNumber(yards ? swim.strokeDistance / METERS_PER_YARD : swim.strokeDistance, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      unit: yards ? "yd" : "m"
    });
  }
  if (swim.waterTemperature !== undefined) {
    const fahrenheit = unitSystem === "imperial";
    items.push({ label: t("Water temperature"), value: whole(fahrenheit ? (swim.waterTemperature * 9) / 5 + 32 : swim.waterTemperature), unit: fahrenheit ? "°F" : "°C" });
  }
  if (!items.length) return null;
  return (
    <section className="activity-detail-visual-panel activity-effect">
      <div className="activity-detail-visual-heading">
        <h3>
          <Waves size={17} aria-hidden="true" />
          {t("Swim")}</h3>
      </div>
      <Items items={items} />
    </section>
  );
}
