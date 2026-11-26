// A status image's height in px (Bluetooth, Do Not Disturb, in the face or the selectable slot): CorosLink's Height and
// Reset size, so the icon can be matched to the text beside it. Every state of the spot takes the same size.
import { t } from "@/lib/i18n";
import type { EditorLayer } from "../studioFace";
import { NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import { scaleForHeight } from "../studioSpotHeight";


export function SpotHeight({ layer, scale, set }: { layer: EditorLayer; scale: number; set: (scale: number) => void }) {
  const box = layer.bounds ? layer.bounds.y1 - layer.bounds.y0 : 0;
  if (!box) return null;
  return (
    <div className="st-nums">
      <NumberField label={t("Height")} unit="px" value={Math.round(box)} min={4} max={400} onChange={(v) => set(scaleForHeight(box, scale, v))} />
      {Math.abs(scale - 1) > 0.001 ? <button type="button" className="chip st-chip-btn" onClick={() => set(1)}><Icon name="refresh" size={15} />{t("Reset size")}</button> : null}
    </div>
  );
}
