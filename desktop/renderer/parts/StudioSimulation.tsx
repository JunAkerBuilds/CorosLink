// The simulation strip under the watch: the time and date, how fast they run, sample values for what the face shows
// (battery, progress, fixed metrics, every live-data field on it, the chart's history), weather, the selectable slot
// and the status spots. CorosLink's Simulation panel, on C-LINK's number fields. Nothing here is saved with the face.
import { useState } from "react";
import { Segmented, Select } from "@/components/ui";
import {
  advanceSimulationDateTime, createWatchfaceSimulation, parseSimulationDateTime, simulationDateTime, simulationPreset,
  type WatchfaceSimulation,
} from "../../watchface/engine/watchfaceSimulation";
import { nativeDataPreviewValue } from "../../watchface/engine/nativeData";
import { isLunarField } from "../../watchface/engine/lunarDate";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS } from "../../watchface/watchfaceNativeCatalog";
import { spotActive, type Design, type EditorLayer, type Spot, type SpotChoice } from "../studioFace";
import { nextSlotPreview, type SlotType } from "../studioSlot";
import { NumberField } from "../pages/StudioInspector";
import { Icon } from "./StudioIcon";
import "./studioParity.css";

export const SIM_SPEEDS = { real: 1, min: 60, hour: 3600, day: 86400 } as const;
export type SimSpeed = keyof typeof SIM_SPEEDS;

type SetSim = (s: WatchfaceSimulation | ((p: WatchfaceSimulation) => WatchfaceSimulation)) => void;

/** Fixed metrics' samples when the simulation has none (CorosLink's panel). Times are h:mm. */
const METRIC_SAMPLE: Record<string, string> = {
  steps: "8420", heartRate: "96", calories: "534", elevation: "1284", exercise: "1:24", floors: "12",
  temperature: "18", barometer: "1013.2", sunrise: "6:30", sunset: "19:45",
};

/** Chart history shapes: the plot's heights from 0 to 1, oldest first. */
const HISTORY: Record<string, number[] | undefined> = {
  sample: undefined, rising: [0.1, 0.25, 0.2, 0.5, 0.7, 0.9], falling: [0.9, 0.7, 0.5, 0.6, 0.25, 0.1], zero: [0, 0, 0, 0],
};
const historyOf = (h: number[] | undefined) => (!h ? "sample" : h.every((v) => v === 0) ? "zero" : h[0]! < h[h.length - 1]! ? "rising" : "falling");

/** A sample value typed in: kept on Enter or when left, put back when it isn't a number (or h:mm for a time). */
function SampleValue({ label, value, time, onCommit }: { label: string; value: string; time: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const typed = draft?.trim() ?? "";
    const ok = typed && (time ? /^\d{1,2}:\d{2}$/.test(typed) : Number.isFinite(Number(typed)));
    if (ok && typed !== value) onCommit(typed);
    setDraft(null);
  };
  return (
    <label className="st-sim-field"><span>{label}</span>
      <input className="field st-sim-value" type="text" inputMode={time ? "text" : "decimal"} aria-label={`${label} sample`} maxLength={12} value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

/** The date and time to show, typed; a half-typed value waits until it is a real date. */
function SimDateTime({ dateTime, onChange }: { dateTime: string; onChange: (v: string) => void }) {
  const [date, setDate] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const d = date ?? dateTime.slice(0, 10), t = time ?? dateTime.slice(11, 19);
  const commit = (nd: string, nt: string) => { try { onChange(simulationDateTime(parseSimulationDateTime(`${nd}T${nt.length === 5 ? `${nt}:00` : nt}`))); } catch { /* not a date yet */ } };
  return <>
    <input className="field st-sim-date" type="date" min="1900-01-01" max="9999-12-31" aria-label="Date" value={d}
      onChange={(e) => { setDate(e.target.value); commit(e.target.value, t); }} onBlur={() => setDate(null)} />
    <input className="field st-sim-time" type="time" step={1} aria-label="Time" value={t}
      onChange={(e) => { setTime(e.target.value); commit(d, e.target.value); }} onBlur={() => setTime(null)} />
  </>;
}

export interface SimPanelProps {
  sim: WatchfaceSimulation;
  setSim: SetSim;
  speed: SimSpeed;
  setSpeed: (s: SimSpeed) => void;
  /** The face as the display shown sees it, for which values it has. */
  design: Design;
  /** The display's layers, for the fixed metrics on it. */
  layers: EditorLayer[];
  spots: Spot[];
  choice: SpotChoice;
  setChoice: (c: SpotChoice | ((p: SpotChoice) => SpotChoice)) => void;
  /** The selectable slot's types that are on, the one the preview draws, and showing another. */
  slot: SlotType[];
  slotShown: string;
  onSlot: (id: string) => void;
}

export function SimPanel({ sim, setSim, speed, setSpeed, design, layers, spots, choice, setChoice, slot, slotShown, onSlot }: SimPanelProps) {
  const [more, setMore] = useState(false);
  const slotType = slot.find((t) => t.id === slotShown);
  // A spot's states the face has an image for; one state alone has nothing to switch.
  const switches = spots.map((spot) => ({ spot, states: spot.states.filter((s) => s.layer.present) })).filter((x) => x.states.length > 1);
  const at = parseSimulationDateTime(sim.dateTime);
  const battery = Math.round(Number(sim.values.battery ?? 82));
  const preset = (key: string) => setSim((s) => ({ ...simulationPreset(key, s), playing: key === "midnight" || key === "yearEnd" || key === "leapDay" }));
  const step = (seconds: number) => setSim((s) => ({ ...s, dateTime: advanceSimulationDateTime(s.dateTime, seconds), playing: false }));
  const setValue = (key: string, value: string) => setSim((s) => ({ ...s, values: { ...s.values, [key]: value } }));

  // What the face has: its fixed metrics, its live-data fields (the year and lunar date follow the date), the chart's readout.
  const metrics = [...new Map(layers.filter((l) => l.metricId && l.metricId !== "battery" && l.present).map((l) => [l.metricId!, l.label])).entries()];
  const natives = NATIVE_DATA_FIELDS.filter((f) => f.id !== "date_year" && !isLunarField(f.id) && design.nativeData?.[f.id]?.enabled);
  const chart = design.nativeData?.chart?.enabled ? design.nativeData.chart : undefined;
  const kcal = design.kcalProgress && (design.kcalProgress.arcEnabled || design.kcalProgress.rectEnabled);
  const exercise = design.exerciseProgress !== undefined;
  const valueCount = metrics.length + natives.length + (kcal ? 1 : 0) + (exercise ? 1 : 0);

  return (
    <section className="st-sim" aria-label="Simulation">
      <div className="st-sim-row">
        <button type="button" className="st-play" aria-label={sim.playing ? "Pause" : "Play"} onClick={() => setSim((s) => ({ ...s, playing: !s.playing }))}><Icon name={sim.playing ? "pause" : "play"} size={18} width={2.3} /></button>
        <div className="st-sim-clock"><b>{sim.dateTime.slice(11, 19)}</b><small>{at.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</small></div>
        <SimDateTime dateTime={sim.dateTime} onChange={(dateTime) => setSim((s) => ({ ...s, dateTime, playing: false }))} />
        <span className="st-chips st-sim-steps">
          <button type="button" className="chip" onClick={() => setSim((s) => ({ ...s, dateTime: simulationDateTime(new Date()), playing: false }))}>Now</button>
          <button type="button" className="chip" onClick={() => step(1)}>+1 s</button>
          <button type="button" className="chip" onClick={() => step(60)}>+1 min</button>
          <button type="button" className="chip" onClick={() => step(86400)}>+1 day</button>
        </span>
        <Segmented small label="Speed" value={speed} onChange={setSpeed} options={[{ value: "real", label: "Real time" }, { value: "min", label: "1 min/s" }, { value: "hour", label: "1 h/s" }, { value: "day", label: "1 day/s" }]} />
        <button type="button" className="st-icon-btn" aria-label="Close the simulation" onClick={() => setSim((s) => ({ ...s, enabled: false, playing: false }))}><Icon name="close" /></button>
      </div>
      <div className="st-chips">
        <button type="button" className="chip" onClick={() => preset("lowBattery")}>Low battery</button>
        <button type="button" className="chip" onClick={() => preset("fullBattery")}>Full battery</button>
        <button type="button" className="chip" onClick={() => preset("midnight")}>Midnight</button>
        <button type="button" className="chip" onClick={() => preset("yearEnd")}>New year</button>
        <button type="button" className="chip" onClick={() => preset("leapDay")}>Leap day 2028</button>
        <button type="button" className="chip" onClick={() => preset("wide")}>Widest values</button>
        <button type="button" className="chip" onClick={() => setSim(() => ({ ...createWatchfaceSimulation(), enabled: true }))}>Reset</button>
      </div>
      <div className="st-sim-row st-sim-more">
        <span className="st-sim-num"><NumberField label="Battery" unit="%" value={battery} min={0} max={100} onChange={(v) => setValue("battery", String(v))} /></span>
        <label className="st-range"><span>Weather</span>
          <Select field aria-label="Weather state" value={sim.weather?.condition ?? 0} onChange={(e) => setSim((s) => ({ ...s, weather: { condition: Number(e.target.value), night: s.weather?.night ?? false } }))}>
            {Array.from({ length: 41 }, (_, i) => <option key={i} value={i}>State {String(i).padStart(2, "0")}</option>)}
          </Select></label>
        <Segmented small label="Day or night" value={sim.weather?.night ? "night" : "day"} onChange={(v) => setSim((s) => ({ ...s, weather: { condition: s.weather?.condition ?? 0, night: v === "night" } }))}
          options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} />
        {chart ? (
          <label className="st-range"><span>Chart</span>
            <Select field aria-label="Chart history" value={historyOf(sim.chartHistory)} onChange={(e) => setSim((s) => ({ ...s, chartHistory: HISTORY[e.target.value] }))}>
              <option value="sample">Sample</option><option value="rising">Rising</option><option value="falling">Falling</option><option value="zero">Zero</option>
            </Select></label>
        ) : null}
        {valueCount ? (
          <button type="button" className="st-link st-sim-toggle" aria-expanded={more} onClick={() => setMore((m) => !m)}>
            Values<Icon name="chevD" size={13} />
          </button>
        ) : null}
      </div>
      {more && valueCount ? (
        <div className="st-sim-values">
          {kcal ? <span className="st-sim-num"><NumberField label="Calorie goal" unit="%" value={Math.round(Number(sim.values.kcalProgress ?? design.kcalProgress?.previewPercent ?? 63))} min={0} max={100} onChange={(v) => setValue("kcalProgress", String(v))} /></span> : null}
          {exercise ? <span className="st-sim-num"><NumberField label="Exercise goal" unit="%" value={Math.round(Number(sim.values.exerciseProgress ?? design.exerciseProgress?.previewPercent ?? 63))} min={0} max={100} onChange={(v) => setValue("exerciseProgress", String(v))} /></span> : null}
          {metrics.map(([id, label]) => {
            const fallback = METRIC_SAMPLE[id] ?? "0";
            return <SampleValue key={`m:${id}`} label={label} time={fallback.includes(":")} value={sim.values[id] ?? fallback} onCommit={(v) => setValue(id, v)} />;
          })}
          {natives.map((field) => {
            const style = design.nativeData![field.id]!;
            const key = field.id === "chart" ? style.chartSource ?? "chart_stress" : field.id;
            const fallback = nativeDataPreviewValue(field.id, style);
            const states = field.kind === "state" ? style.stateCount ?? field.stateCount : key === "chart_moon" ? 30 : undefined;
            const label = field.id === "chart" ? NATIVE_CHART_SOURCES.find((s) => s.id === key)?.label ?? field.label : field.label;
            return states ? (
              <span key={`n:${key}`} className="st-sim-num"><NumberField label={`${label} state`} value={Math.round(Number(sim.values[key] ?? fallback) || 0)} min={0} max={states - 1} onChange={(v) => setValue(key, String(v))} /></span>
            ) : <SampleValue key={`n:${key}`} label={label} time={fallback.includes(":")} value={sim.values[key] ?? fallback} onCommit={(v) => setValue(key, v)} />;
          })}
        </div>
      ) : null}
      {slotType ? (
        <div className="st-sim-row st-sim-more">
          <label className="st-range"><span>Wearer picks</span>
            <button type="button" className="st-icon-btn" aria-label="The type before" disabled={slot.length < 2} onClick={() => onSlot(nextSlotPreview(slot, slotShown, -1))}><Icon name="chevL" size={16} width={2.2} /></button>
            <Select field aria-label="Type the slot shows" value={slotShown} onChange={(e) => onSlot(e.target.value)}>
              {slot.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </Select>
            <button type="button" className="st-icon-btn" aria-label="The next type" disabled={slot.length < 2} onClick={() => onSlot(nextSlotPreview(slot, slotShown, 1))}><Icon name="chevR" size={16} width={2.2} /></button></label>
          {slotType.id !== "battery" && slotType.id !== "date" ? (
            <label className="st-range"><span>Value</span>
              <input className="field st-sim-value" type="text" aria-label={`${slotType.label} sample value`} maxLength={12} placeholder={slotType.sample} value={sim.values[slotType.id] ?? ""}
                onChange={(e) => { const value = e.target.value; setSim((s) => { const values = { ...s.values }; if (value.trim()) values[slotType.id] = value; else delete values[slotType.id]; return { ...s, values }; }); }} /></label>
          ) : null}
        </div>
      ) : null}
      {switches.length ? (
        <div className="st-sim-row st-sim-more">
          {switches.map(({ spot, states }) => (
            <label key={spot.id} className="st-range"><span>{spot.label}</span>
              <Segmented small label={`${spot.label} state`} value={spotActive(spot, choice).key} onChange={(key) => setChoice((c) => ({ ...c, [spot.id]: key }))}
                options={states.map((s) => ({ value: s.key, label: s.label }))} /></label>
          ))}
        </div>
      ) : null}
    </section>
  );
}
