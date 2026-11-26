// A layer's stroke and shadow stacks, front to back. CorosLink's Stroke and Effects sections on C-LINK's fields: each
// stroke's colour or two-stop gradient with its angle, opacity, weight, position, show / hide, move up / down and
// remove; each shadow's kind, colour, opacity, blur, spread, distance and angle, with duplicate and move up / down.
import { Segmented } from "@/components/ui";
import { t } from "@/lib/i18n";
import type { CorosWatchfaceShadowEffect, CorosWatchfaceStroke } from "../../watchface/types";
import { ColorField, NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import { duplicateShadow, moveInStack, strokePaint } from "../studioStacks";




function StackMoves({ index, count, kind, move }: { index: number; count: number; kind: "stroke" | "shadow"; move: (step: -1 | 1) => void }) {
  if (count < 2) return null;
  return <>
    <button type="button" className="st-icon-btn" aria-label={kind === "stroke" ? t("Move stroke up") : t("Move shadow up")} title={t("Move up")} disabled={index === 0} onClick={() => move(-1)}><Icon name="chevU" size={16} /></button>
    <button type="button" className="st-icon-btn" aria-label={kind === "stroke" ? t("Move stroke down") : t("Move shadow down")} title={t("Move down")} disabled={index === count - 1} onClick={() => move(1)}><Icon name="chevD" size={16} /></button>
  </>;
}

export function Strokes({ list, add, set }: { list: CorosWatchfaceStroke[]; add: () => void; set: (list: CorosWatchfaceStroke[]) => void }) {
  const put = (i: number, patch: Partial<CorosWatchfaceStroke>) => set(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="st-stack">
      <div className="st-row"><span>{t("Stroke")}</span><button type="button" className="st-icon-btn" aria-label={t("Add stroke")} title={t("Add stroke")} onClick={add}><Icon name="plus" /></button></div>
      {list.map((s, i) => {
        const p = s.paint;
        return (
          <div key={s.id} className="st-stack-item">
            <div className="st-stack-line">
              <Segmented small label={t("Stroke paint")} value={p.kind} onChange={(v) => put(i, { paint: strokePaint(p, v) })}
                options={[{ value: "solid", label: t("Solid") }, { value: "linear-gradient", label: t("Gradient") }]} />
              <StackMoves index={i} count={list.length} kind="stroke" move={(step) => set(moveInStack(list, i, step))} />
              <button type="button" className="st-icon-btn" aria-label={s.enabled ? t("Hide stroke") : t("Show stroke")} onClick={() => put(i, { enabled: !s.enabled })}><Icon name={s.enabled ? "eye" : "eyeOff"} size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label={t("Remove stroke")} onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
            <div className="st-nums">
              {p.kind === "solid" ? <ColorField label={t("Stroke color")} value={p.color} onPick={(c) => put(i, { paint: { kind: "solid", color: c } })} /> : <>
                <ColorField label={t("From")} value={p.from} onPick={(c) => put(i, { paint: { ...p, from: c } })} />
                <ColorField label={t("To")} value={p.to} onPick={(c) => put(i, { paint: { ...p, to: c } })} />
                <NumberField label={t("Angle")} unit="°" value={Math.round(p.angle)} min={0} max={359} onChange={(v) => put(i, { paint: { ...p, angle: ((v % 360) + 360) % 360 } })} />
              </>}
              <NumberField label={t("Opacity")} unit="%" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={(v) => put(i, { opacity: v / 100 })} />
              <NumberField label={t("W")} unit="px" value={s.weight} min={1} max={64} onChange={(v) => put(i, { weight: v })} />
            </div>
            <Segmented small label={t("Stroke position")} value={s.position} onChange={(v) => put(i, { position: v })} options={[{ value: "outside", label: t("Outside") }, { value: "center", label: t("Center") }, { value: "inside", label: t("Inside") }]} />
          </div>
        );
      })}
    </div>
  );
}

export function Shadows({ list, add, set }: { list: CorosWatchfaceShadowEffect[]; add: () => void; set: (list: CorosWatchfaceShadowEffect[]) => void }) {
  const put = (i: number, patch: Partial<CorosWatchfaceShadowEffect>) => set(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="st-stack">
      <div className="st-row"><span>{t("Shadow")}</span><button type="button" className="st-icon-btn" aria-label={t("Add shadow")} title={t("Add shadow")} onClick={add}><Icon name="plus" /></button></div>
      {list.map((s, i) => (
        <div key={s.id} className="st-stack-item">
          <div className="st-stack-line">
            <Segmented small label={t("Shadow kind")} value={s.kind} onChange={(v) => put(i, { kind: v })} options={[{ value: "outer-shadow", label: t("Drop") }, { value: "inner-shadow", label: t("Inner") }]} />
            <StackMoves index={i} count={list.length} kind="shadow" move={(step) => set(moveInStack(list, i, step))} />
            <button type="button" className="st-icon-btn" aria-label={t("Duplicate shadow")} title={t("Duplicate")} onClick={() => set(duplicateShadow(list, i))}><Icon name="plus" size={16} /></button>
            <button type="button" className="st-icon-btn" aria-label={s.enabled ? t("Hide shadow") : t("Show shadow")} onClick={() => put(i, { enabled: !s.enabled })}><Icon name={s.enabled ? "eye" : "eyeOff"} size={16} /></button>
            <button type="button" className="st-icon-btn" aria-label={t("Remove shadow")} onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
          </div>
          <div className="st-nums">
            <ColorField label={t("Shadow color")} value={s.color} onPick={(c) => put(i, { color: c })} />
            <NumberField label={t("Opacity")} unit="%" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={(v) => put(i, { opacity: v / 100 })} />
            <NumberField label={t("Blur")} value={s.blur} min={0} max={64} onChange={(v) => put(i, { blur: v })} />
            <NumberField label={t("Spread")} value={s.spread} min={-32} max={64} onChange={(v) => put(i, { spread: v })} />
            <NumberField label={t("Distance")} value={s.distance} min={0} max={128} onChange={(v) => put(i, { distance: v })} />
            <NumberField label={t("Angle")} unit="°" value={s.angle} min={0} max={360} onChange={(v) => put(i, { angle: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}
