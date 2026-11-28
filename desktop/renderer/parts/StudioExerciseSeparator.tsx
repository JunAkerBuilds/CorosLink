// The fixed Exercise metric's colon (1:24): the watch draws hours and minutes as two numbers, and the colon between
// them is baked into the face's background. Show it or not, its colour and centre, or a PNG of its own; its size,
// weight and style are always the digits' (exerciseColonSize, exerciseColonFace).
// CorosLink's Exercise separator section.
import { useRef } from "react";
import { Switch } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { CorosWatchfaceExerciseSeparatorStyle, CorosWatchfaceTemplateDetails } from "../../watchface/types";
import { inferExerciseSeparatorStyle } from "../../watchface/engine/watchfaceStudio";
import type { Design } from "../studioFace";
import { readArtwork } from "../studioEdits";
import { ColorField, Fold, NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import { setExerciseSeparator } from "../studioExerciseSeparator";

type Edit = (fn: (d: Design) => Design) => void;


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
