import { useEffect, useId, useRef, useState } from "react";
import { FlaskConical, Pause, Play, X } from "lucide-react";
import type { CorosWatchfaceDesignState } from "../../electron/types";
import { NATIVE_DATA_FIELDS, nativeDataPreviewValue } from "./nativeData";
import { advanceSimulationDateTime, createWatchfaceSimulation, parseSimulationDateTime, simulationDateTime, simulationPreset, SIMULATION_SPEEDS, type WatchfaceSimulation } from "./watchfaceSimulation";
import "./watchfaceSimulation.css";

function SimulationCalendar({ dateTime, onChange }: { dateTime: string; onChange: (value: string) => void }) {
  const [date, setDate] = useState(dateTime.slice(0, 10));
  const [time, setTime] = useState(dateTime.slice(11));
  useEffect(() => { setDate(dateTime.slice(0, 10)); setTime(dateTime.slice(11)); }, [dateTime]);
  const commit = (nextDate: string, nextTime: string) => {
    try { onChange(simulationDateTime(parseSimulationDateTime(`${nextDate}T${nextTime}`))); }
    catch { /* Keep incomplete keyboard input local until it becomes a valid date. */ }
  };
  return <div className="wf-simulation-grid">
    <label>Date (includes year)<input aria-label="Simulation date" type="date" min="1900-01-01" max="9999-12-31" value={date}
      onChange={event => { setDate(event.target.value); commit(event.target.value, time); }} onBlur={() => setDate(dateTime.slice(0, 10))} /></label>
    <label>Time<input aria-label="Simulation time" type="time" step="1" value={time}
      onChange={event => { setTime(event.target.value); commit(date, event.target.value); }} onBlur={() => setTime(dateTime.slice(11))} /></label>
  </div>;
}

function SampleValue({ label, value, onCommit, min, max, time = false }: { label: string; value: string; onCommit: (value: string) => void; min?: number; max?: number; time?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return <label>{label}<input aria-label={`Simulated ${label.toLowerCase()}`} type={time ? "text" : "number"} step="any" min={min} max={max} value={draft}
    onChange={event => setDraft(event.target.value)}
    onBlur={event => {
      if (draft.trim() && (time ? /^\d{1,2}:\d{2}$/.test(draft) : event.target.validity.valid && Number.isFinite(Number(draft)))) onCommit(draft);
      else setDraft(value);
    }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></label>;
}

export function WatchfaceSimulationPanel({ simulation, onChange, design }: { simulation: WatchfaceSimulation; onChange: (value: WatchfaceSimulation) => void; design: CorosWatchfaceDesignState }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        // Commit a typed sample before removing the input from the DOM.
        if (root.current?.contains(document.activeElement)) (document.activeElement as HTMLElement)?.blur();
        setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const patch = (change: Partial<WatchfaceSimulation>) => onChange({ ...simulation, ...change });
  const setValue = (key: string, value: string) => patch({ values: { ...simulation.values, [key]: value } });
  const common = [
    ["steps", "Steps", "8420"], ["heartRate", "Heart rate", "96"], ["calories", "Calories", "534"], ["elevation", "Elevation", "1284"],
    ["exercise", "Exercise (h:mm)", "1:24"], ["floors", "Floors", "12"], ["barometer", "Barometer", "1013.2"],
    ["weather_temp", "Current weather", design.nativeData?.weather_temp?.previewValue ?? "18"], ["temperature", "Sensor temperature", "18"],
    ["sunrise", "Sunrise (h:mm)", "6:30"], ["sunset", "Sunset (h:mm)", "19:45"]
  ];
  return <div className="wf-simulation" ref={root}>
    <button ref={trigger} type="button" className="wf-simulation-trigger" aria-expanded={open} aria-controls={id} aria-haspopup="dialog" data-enabled={simulation.enabled} onClick={() => setOpen(!open)}>
      <FlaskConical size={15} aria-hidden="true" /> <span className="wf-simulation-trigger-label">Preview data:</span> <strong>{simulation.playing ? "Playing" : simulation.enabled ? "Sample" : "Now"}</strong>
    </button>
    {open && <section id={id} className="wf-simulation-panel" role="dialog" aria-label="Watch face simulation">
      <div className="wf-simulation-heading"><strong>Simulation</strong><button type="button" aria-label="Close simulation" onClick={() => { setOpen(false); trigger.current?.focus(); }}><X size={16} /></button></div>
      <p>Try sample data on this face. Your saved design and watch data stay unchanged.</p>
      <label className="wf-simulation-enable"><input type="checkbox" checked={simulation.enabled} onChange={event => patch({ enabled: event.target.checked, playing: false })} /> Enable simulation</label>
      <fieldset disabled={!simulation.enabled}>
        <SimulationCalendar dateTime={simulation.dateTime} onChange={dateTime => patch({ dateTime, playing: false })} />
        <p>{parseSimulationDateTime(simulation.dateTime).toLocaleDateString(undefined, { weekday: "long" })} · Local time · Weekday follows the date</p>
        <div className="wf-simulation-actions">
          <button type="button" onClick={() => patch({ playing: !simulation.playing })}>{simulation.playing ? <Pause size={14} /> : <Play size={14} />}{simulation.playing ? "Pause" : "Play"}</button>
          <select aria-label="Simulation speed" value={simulation.speed} onChange={event => patch({ speed: Number(event.target.value) })}>{SIMULATION_SPEEDS.map(speed => <option key={speed} value={speed}>{speed === 1 ? "Real time" : speed === 60 ? "1 minute / second" : speed === 3600 ? "1 hour / second" : "1 day / second"}</option>)}</select>
          <button type="button" onClick={() => patch({ dateTime: simulationDateTime(new Date()), playing: false })}>Now</button>
        </div>
        <div className="wf-simulation-actions">{[[1, "+1 second"], [60, "+1 minute"], [86400, "+1 day"]].map(([seconds, label]) => <button key={seconds} type="button" onClick={() => patch({ dateTime: advanceSimulationDateTime(simulation.dateTime, Number(seconds)), playing: false })}>{label}</button>)}</div>
        <div className="wf-simulation-grid">
          <SampleValue label="Battery (%)" value={simulation.values.battery ?? "82"} min={0} max={100} onCommit={value => setValue("battery", value)} />
          <label>Test preset<select aria-label="Simulation preset" value="" onChange={event => onChange(simulationPreset(event.target.value, simulation))}><option value="" disabled>Choose a scenario…</option><option value="normal">Normal / reset values</option><option value="lowBattery">Low battery · 5%</option><option value="fullBattery">Full battery · 100%</option><option value="midnight">Midnight rollover</option><option value="yearEnd">New year rollover</option><option value="leapDay">Leap day rollover · 2028</option><option value="wide">Wide numbers</option></select></label>
        </div>
        <details><summary>Activity & weather</summary><p>Only fields present on the face are drawn. Press Enter or leave a value to apply.</p><div className="wf-simulation-grid">
          {common.map(([key, label, fallback]) => <SampleValue key={key} label={label} value={simulation.values[key] ?? fallback} time={key === "exercise" || key === "sunrise" || key === "sunset"} onCommit={value => setValue(key, value)} />)}
          <SampleValue label="Calorie progress (%)" value={simulation.values.kcalProgress ?? String(design.kcalProgress?.previewPercent ?? 63)} min={0} max={100} onCommit={value => setValue("kcalProgress", value)} />
          <SampleValue label="Exercise progress (%)" value={simulation.values.exerciseProgress ?? String(design.exerciseProgress?.previewPercent ?? 63)} min={0} max={100} onCommit={value => setValue("exerciseProgress", value)} />
          {design.weatherIndicator?.enabled && <><label>Weather artwork<select aria-label="Simulated weather condition" value={simulation.weather?.condition ?? 0} onChange={event => patch({ weather: { night: simulation.weather?.night ?? false, condition: Number(event.target.value) } })}>{Array.from({ length: 41 }, (_, index) => <option key={index} value={index}>State {String(index).padStart(2, "0")}</option>)}</select></label><label>Weather set<select aria-label="Simulated weather day or night" value={simulation.weather?.night ? "night" : "day"} onChange={event => patch({ weather: { condition: simulation.weather?.condition ?? 0, night: event.target.value === "night" } })}><option value="day">Day</option><option value="night">Night</option></select></label></>}
        </div></details>
        {Object.entries(design.nativeData ?? {}).some(([id, style]) => id !== "weather_temp" && style.enabled) && <details><summary>Health, training & astronomy</summary><p>Sample values and asset states for the native fields on this face.</p><div className="wf-simulation-grid">
          {NATIVE_DATA_FIELDS.filter(field => field.id !== "weather_temp" && design.nativeData?.[field.id]?.enabled).map(field => {
            const style = design.nativeData![field.id];
            const key = field.id === "chart" ? style.chartSource ?? "chart_stress" : field.id;
            const fallback = nativeDataPreviewValue(field.id, style);
            // Only pure state fields take an index; numeric fields with level artwork keep their value.
            const stateCount = field.kind === "state" ? style.stateCount ?? field.stateCount : key === "chart_moon" ? 30 : undefined;
            return <SampleValue key={key} label={field.label + (stateCount ? " state" : "")} value={simulation.values[key] ?? fallback} min={stateCount ? 0 : undefined} max={stateCount ? stateCount - 1 : undefined} time={fallback.includes(":")} onCommit={value => setValue(key, value)} />;
          })}
          {design.nativeData?.chart?.enabled && <label>Chart history<select aria-label="Simulated chart history" value={!simulation.chartHistory ? "sample" : simulation.chartHistory.every(value => value === 0) ? "empty" : simulation.chartHistory[0] < simulation.chartHistory.at(-1)! ? "rising" : "falling"} onChange={event => patch({ chartHistory: event.target.value === "sample" ? undefined : event.target.value === "empty" ? [0, 0, 0, 0] : event.target.value === "rising" ? [0.1, 0.25, 0.2, 0.5, 0.7, 0.9] : [0.9, 0.7, 0.5, 0.6, 0.25, 0.1] })}><option value="sample">Default sample</option><option value="rising">Rising</option><option value="falling">Falling</option><option value="empty">Zero values</option></select></label>}
        </div></details>}
      </fieldset>
      <button type="button" onClick={() => onChange(createWatchfaceSimulation())}>Reset simulation</button>
    </section>}
  </div>;
}
