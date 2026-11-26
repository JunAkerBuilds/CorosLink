// A layer's stroke and shadow stacks, front to back. CorosLink's Stroke and Effects sections on C-LINK's fields: each
// stroke's colour or two-stop gradient with its angle, opacity, weight, position, show / hide, move up / down and
// remove; each shadow's kind, colour, opacity, blur, spread, distance and angle, with duplicate and move up / down.
import { Segmented } from "@/components/ui";
import type { CorosWatchfaceShadowEffect, CorosWatchfaceStroke } from "../../watchface/types";
import { ColorField, NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import { duplicateShadow, moveInStack, strokePaint } from "../studioStacks";




function StackMoves({ index, count, label, move }: { index: number; count: number; label: string; move: (step: -1 | 1) => void }) {
  if (count < 2) return null;
  return <>
    <button type="button" className="st-icon-btn" aria-label={`Move ${label} up`} title="Move up" disabled={index === 0} onClick={() => move(-1)}><Icon name="chevU" size={16} /></button>
    <button type="button" className="st-icon-btn" aria-label={`Move ${label} down`} title="Move down" disabled={index === count - 1} onClick={() => move(1)}><Icon name="chevD" size={16} /></button>
  </>;
}

export function Strokes({ list, add, set }: { list: CorosWatchfaceStroke[]; add: () => void; set: (list: CorosWatchfaceStroke[]) => void }) {
  const put = (i: number, patch: Partial<CorosWatchfaceStroke>) => set(list.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="st-stack">
      <div className="st-row"><span>Stroke</span><button type="button" className="st-icon-btn" aria-label="Add stroke" title="Add stroke" onClick={add}><Icon name="plus" /></button></div>
      {list.map((s, i) => {
        const p = s.paint;
        return (
          <div key={s.id} className="st-stack-item">
            <div className="st-stack-line">
              <Segmented small label="Stroke paint" value={p.kind} onChange={(v) => put(i, { paint: strokePaint(p, v) })}
                options={[{ value: "solid", label: "Solid" }, { value: "linear-gradient", label: "Gradient" }]} />
              <StackMoves index={i} count={list.length} label="stroke" move={(step) => set(moveInStack(list, i, step))} />
              <button type="button" className="st-icon-btn" aria-label={s.enabled ? "Hide stroke" : "Show stroke"} onClick={() => put(i, { enabled: !s.enabled })}><Icon name={s.enabled ? "eye" : "eyeOff"} size={16} /></button>
              <button type="button" className="st-icon-btn" aria-label="Remove stroke" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
            </div>
            <div className="st-nums">
              {p.kind === "solid" ? <ColorField label="Stroke color" value={p.color} onPick={(c) => put(i, { paint: { kind: "solid", color: c } })} /> : <>
                <ColorField label="From" value={p.from} onPick={(c) => put(i, { paint: { ...p, from: c } })} />
                <ColorField label="To" value={p.to} onPick={(c) => put(i, { paint: { ...p, to: c } })} />
                <NumberField label="Angle" unit="°" value={Math.round(p.angle)} min={0} max={359} onChange={(v) => put(i, { paint: { ...p, angle: ((v % 360) + 360) % 360 } })} />
              </>}
              <NumberField label="Opacity" unit="%" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={(v) => put(i, { opacity: v / 100 })} />
              <NumberField label="W" unit="px" value={s.weight} min={1} max={64} onChange={(v) => put(i, { weight: v })} />
            </div>
            <Segmented small label="Stroke position" value={s.position} onChange={(v) => put(i, { position: v })} options={[{ value: "outside", label: "Outside" }, { value: "center", label: "Center" }, { value: "inside", label: "Inside" }]} />
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
      <div className="st-row"><span>Shadow</span><button type="button" className="st-icon-btn" aria-label="Add shadow" title="Add shadow" onClick={add}><Icon name="plus" /></button></div>
      {list.map((s, i) => (
        <div key={s.id} className="st-stack-item">
          <div className="st-stack-line">
            <Segmented small label="Shadow kind" value={s.kind} onChange={(v) => put(i, { kind: v })} options={[{ value: "outer-shadow", label: "Drop" }, { value: "inner-shadow", label: "Inner" }]} />
            <StackMoves index={i} count={list.length} label="shadow" move={(step) => set(moveInStack(list, i, step))} />
            <button type="button" className="st-icon-btn" aria-label="Duplicate shadow" title="Duplicate" onClick={() => set(duplicateShadow(list, i))}><Icon name="plus" size={16} /></button>
            <button type="button" className="st-icon-btn" aria-label={s.enabled ? "Hide shadow" : "Show shadow"} onClick={() => put(i, { enabled: !s.enabled })}><Icon name={s.enabled ? "eye" : "eyeOff"} size={16} /></button>
            <button type="button" className="st-icon-btn" aria-label="Remove shadow" onClick={() => set(list.filter((_, j) => j !== i))}><Icon name="close" size={16} /></button>
          </div>
          <div className="st-nums">
            <ColorField label="Shadow color" value={s.color} onPick={(c) => put(i, { color: c })} />
            <NumberField label="Opacity" unit="%" value={Math.round(s.opacity * 100)} min={0} max={100} onChange={(v) => put(i, { opacity: v / 100 })} />
            <NumberField label="Blur" value={s.blur} min={0} max={64} onChange={(v) => put(i, { blur: v })} />
            <NumberField label="Spread" value={s.spread} min={-32} max={64} onChange={(v) => put(i, { spread: v })} />
            <NumberField label="Distance" value={s.distance} min={0} max={128} onChange={(v) => put(i, { distance: v })} />
            <NumberField label="Angle" unit="°" value={s.angle} min={0} max={360} onChange={(v) => put(i, { angle: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}
