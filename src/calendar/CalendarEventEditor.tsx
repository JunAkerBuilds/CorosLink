import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, CalendarClock, ChevronDown, Loader2 } from "lucide-react";
import type { CalendarEventTiming, CalendarWorkoutEvent, CalendarWorkoutEventRef } from "../../electron/calendarSyncTypes";
import type { CorosLinkApi } from "../coroslink-api";
import "./calendarEventEditor.css";

const DURATION_PRESETS = [30, 45, 60, 90, 120];
const DAY_MINUTES = 24 * 60;
const OPEN_KEY = "coroslink.calendarEventEditor.open";

function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function writeOpen(open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY, open ? "1" : "0");
  } catch {
    // Remembering the panel state is only a convenience.
  }
}

function formatClock(time: string): string {
  const minutes = toMinutes(time);
  return new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60)
    .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function timingSummary(timing: CalendarEventTiming): string {
  return timing.mode === "all-day" ? "All day" : `${formatClock(timing.startTime)} – ${formatClock(timing.endTime)}`;
}

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    : "Could not save the calendar event. Try again.";
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function fromMinutes(total: number): string {
  const wrapped = ((total % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
}

/** Minutes from start to end; an end at or before the start rolls into the next day. */
function durationMinutes(timing: CalendarEventTiming): number {
  const span = toMinutes(timing.endTime) - toMinutes(timing.startTime);
  return span > 0 ? span : span + DAY_MINUTES;
}

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function timeZoneOptions(current: string): string[] {
  let zones: string[] = [];
  try {
    zones = Intl.supportedValuesOf("timeZone");
  } catch {
    zones = [];
  }
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set([current, local, ...zones].filter(Boolean))].sort();
}

function sameTiming(a: CalendarEventTiming | null, b: CalendarEventTiming | null): boolean {
  if (!a || !b) return a === b;
  if (a.mode !== b.mode) return false;
  if (a.mode === "all-day") return true;
  return a.startTime === b.startTime && a.endTime === b.endTime && a.timeZone === b.timeZone;
}

export function CalendarEventEditor({ api, eventRef, disabled, onSaved }: {
  api: CorosLinkApi;
  eventRef: CalendarWorkoutEventRef;
  disabled: boolean;
  onSaved: (event: CalendarWorkoutEvent) => void;
}) {
  const [timing, setTiming] = useState<CalendarEventTiming | null>(null);
  const [saved, setSaved] = useState<CalendarEventTiming | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [open, setOpen] = useState(readOpen);
  const reduceMotion = useReducedMotion();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setError(null);
    void api.getCalendarWorkoutEvent(eventRef).then(value => {
      if (cancelled) return;
      setTiming(value);
      setSaved(value);
    }).catch(cause => {
      if (!cancelled) setError(errorText(cause));
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [api, eventRef.userId, eventRef.planId, eventRef.idInPlan, eventRef.happenDay, retry]);

  const zones = useMemo(() => timeZoneOptions(timing?.timeZone ?? ""), [timing?.timeZone]);
  const dirty = !sameTiming(timing, saved);
  const duration = timing?.mode === "timed" ? durationMinutes(timing) : 0;
  const overnight = timing?.mode === "timed" && timing.endTime <= timing.startTime;

  function toggle() {
    setOpen(value => {
      writeOpen(!value);
      return !value;
    });
  }

  function edit(next: CalendarEventTiming) {
    setTiming(next);
    setMessage(null);
  }

  function setStart(startTime: string) {
    if (!timing || !startTime) return;
    // Moving the start keeps the event's length, like most calendar apps.
    edit({ ...timing, startTime, endTime: fromMinutes(toMinutes(startTime) + durationMinutes(timing)) });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!timing || saving || disabled || (!dirty && !error)) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateCalendarWorkoutEvent({ ref: eventRef, timing });
      if (!mounted.current) return;
      setTiming(result.event.timing);
      setSaved(result.event.timing);
      onSaved(result.event);
      setMessage(result.synced.length ? `Saved and updated ${result.synced.join(" and ")}.`
        : result.errors.length ? "Saved in CorosLink. Calendar sync needs another try."
        : "Saved in CorosLink. Connect a calendar in Settings to sync it.");
      if (result.errors.length) setError(result.errors.join(" "));
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return <form className="calendar-workout-event" onSubmit={save} aria-label="Calendar event">
    <button
      type="button"
      className="calendar-workout-event-head"
      aria-expanded={open}
      aria-controls="calendar-workout-event-body"
      onClick={toggle}
    >
      <span className="calendar-workout-event-title"><CalendarClock size={15} aria-hidden="true" />Calendar event</span>
      <span className="calendar-workout-event-summary">
        {open ? "Syncs to Google & Apple"
          : timing ? <>{timingSummary(timing)}{dirty ? <em>Unsaved</em> : null}</>
          : error ? "Unavailable" : "Loading…"}
      </span>
      <ChevronDown size={15} aria-hidden="true" className="calendar-workout-event-chevron" />
    </button>

    <AnimatePresence initial={false}>
    {open ? <motion.div
      key="body"
      id="calendar-workout-event-body"
      className="calendar-workout-event-body"
      initial={reduceMotion ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
    ><div className="calendar-workout-event-inner">
    {timing ? <fieldset disabled={saving || disabled}>
      <div className="calendar-workout-event-mode" role="radiogroup" aria-label="Event type">
        {([["all-day", "All day"], ["timed", "Timed"]] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={timing.mode === mode}
            className={timing.mode === mode ? "is-active" : undefined}
            onClick={() => edit({ ...timing, mode })}
          >{label}</button>
        ))}
      </div>

      {timing.mode === "timed" ? <>
        <div className="calendar-workout-event-times">
          <label>
            <span>Starts</span>
            <input name="startTime" type="time" required value={timing.startTime} onChange={event => setStart(event.target.value)} />
          </label>
          <ArrowRight size={15} aria-hidden="true" className="calendar-workout-event-arrow" />
          <label>
            <span>Ends</span>
            <input name="endTime" type="time" required value={timing.endTime} onChange={event => edit({ ...timing, endTime: event.target.value })} />
          </label>
        </div>

        <div className="calendar-workout-event-durations" role="group" aria-label="Duration">
          <span className="calendar-workout-event-duration" aria-live="polite">
            {formatDuration(duration)}{overnight ? " · ends next day" : ""}
          </span>
          {DURATION_PRESETS.map(minutes => (
            <button
              key={minutes}
              type="button"
              aria-pressed={duration === minutes}
              className={duration === minutes ? "is-active" : undefined}
              onClick={() => edit({ ...timing, endTime: fromMinutes(toMinutes(timing.startTime) + minutes) })}
            >{minutes < 60 ? `${minutes}m` : formatDuration(minutes).replace(" min", "").replace(/ /g, "")}</button>
          ))}
        </div>

        <label className="calendar-workout-event-zone">
          <span>Time zone</span>
          <select name="timeZone" required value={timing.timeZone} onChange={event => edit({ ...timing, timeZone: event.target.value })}>
            {zones.map(zone => <option key={zone} value={zone}>{zone.replace(/_/g, " ")}</option>)}
          </select>
        </label>
      </> : <p className="calendar-workout-event-hint">Shows as an all-day event on this date.</p>}

      <div className="calendar-workout-event-foot">
        <p role="status">
          {message ?? (dirty ? "Unsaved changes" : "Up to date")}
        </p>
        {dirty && !saving ? <button type="button" className="calendar-workout-event-reset" onClick={() => { setTiming(saved); setError(null); }}>
          Reset
        </button> : null}
        <button type="submit" className="primary-button" disabled={(!dirty && !error) || saving}>
          {saving ? <Loader2 size={14} className="spin" aria-hidden="true" /> : null}
          {saving ? "Syncing…" : "Save & sync"}
        </button>
      </div>
    </fieldset> : error ? <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button>
      : <p role="status" className="calendar-workout-event-hint">Loading event…</p>}
    </div></motion.div> : null}
    </AnimatePresence>

    {error ? <p className="calendar-error" role="alert">{error}</p> : null}
  </form>;
}
