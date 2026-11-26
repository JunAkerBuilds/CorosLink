// The fixed Exercise metric's colon (1:24): the watch draws hours and minutes as two numbers, and the colon between
// them is baked into the face's background. Show it or not, its colour, centre, size and weight, or a PNG of its own.
// CorosLink's Exercise separator section.
import { useRef } from "react";
import { Segmented, Select, Switch } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { CorosWatchfaceExerciseSeparatorStyle, CorosWatchfaceTemplateDetails } from "../../watchface/types";
import { inferExerciseSeparatorStyle } from "../../watchface/engine/watchfaceStudio";
import type { Design } from "../studioFace";
import { readArtwork } from "../studioEdits";
import { ColorField, Fold, NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import { setExerciseSeparator } from "../studioExerciseSeparator";

type Edit = (fn: (d: Design) => Design) => void;


const WEIGHTS = [400, 500, 600, 700, 800, 900];

export function ExerciseSeparatorFold({ design, edit, details, fail }: { design: Design; edit: Edit; details: CorosWatchfaceTemplateDetails; fail: (e: unknown) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const s = design.exerciseSeparator ?? inferExerciseSeparatorStyle(details, design.metricStyles?.exercise?.color ?? design.digitColor);
  const set = (patch: Partial<CorosWatchfaceExerciseSeparatorStyle>) => edit((x) => setExerciseSeparator(x, details, patch));
  return (
    <Fold title={t("Separator")} note={s.enabled ? (s.artwork ? "PNG" : ":") : t("Off")}>
      <div className="st-row"><span>{t("Show the colon")}</span><Switch label={t("Show the exercise colon")} checked={s.enabled} onChange={(v) => set({ enabled: v })} /></div>
        {s.enabled ? <>
          <div className="st-nums">
            {s.artwork ? null : <ColorField label={t("Colon color")} value={s.color} onPick={(c) => set({ color: c })} />}
            <NumberField label={t("Size")} unit="px" value={Math.round(s.size * s.scale)} min={4} max={200} onChange={(v) => set({ size: v, scale: 1 })} />
            <NumberField label="X" value={Math.round(s.x)} onChange={(v) => set({ x: v })} />
            <NumberField label="Y" value={Math.round(s.y)} onChange={(v) => set({ y: v })} />
          </div>
          {s.artwork ? (
            <div className="st-img-row">
              <span className="st-img-prev"><img src={s.artwork.dataUrl} alt="" /></span>
              <span className="st-img-actions">
                <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{t("Replace PNG")}</button>
                <button type="button" className="chip st-chip-btn" onClick={() => set({ artwork: null })}><Icon name="refresh" size={15} />{t("Use a text colon")}</button>
              </span>
            </div>
          ) : <>
            <div className="st-nums">
              <label className="st-select"><span className="sr-only">{t("Colon weight")}</span>
                <Select aria-label={t("Colon weight")} value={s.fontWeight ?? 700} onChange={(e) => set({ fontWeight: Number(e.target.value) })}>
                  {WEIGHTS.map((w) => <option key={w} value={w}>{w}</option>)}
                </Select><Icon name="chevD" size={14} /></label>
              <Segmented small label={t("Colon style")} value={s.fontStyle ?? "normal"} onChange={(v) => set({ fontStyle: v })} options={[{ value: "normal", label: t("Normal") }, { value: "italic", label: t("Italic") }]} />
            </div>
            <button type="button" className="chip st-chip-btn" onClick={() => input.current?.click()}><Icon name="upload" size={15} />{t("Use a PNG")}</button>
          </>}
        </> : null}
        <input ref={input} type="file" hidden accept="image/png" onChange={(e) => {
          const f = e.target.files?.[0]; e.target.value = "";
          if (f) void readArtwork(f).then((artwork) => set({ enabled: true, artwork })).catch(fail);
        }} />
    </Fold>
  );
}
