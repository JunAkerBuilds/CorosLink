import { useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { CalendarEventTiming, CalendarWorkoutEvent, CalendarWorkoutEventRef } from "../../electron/calendarSyncTypes";
import type { CorosLinkApi } from "../coroslink-api";
import "./calendarEventEditor.css";

function errorText(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "")
    : "Could not save the calendar event. Try again.";
}

export function CalendarEventEditor({ api, eventRef, disabled, onSaved }: {
  api: CorosLinkApi;
  eventRef: CalendarWorkoutEventRef;
  disabled: boolean;
  onSaved: (event: CalendarWorkoutEvent) => void;
}) {
  const [timing, setTiming] = useState<CalendarEventTiming | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    setError(null);
    void api.getCalendarWorkoutEvent(eventRef).then(value => {
      if (!cancelled) setTiming(value);
    }).catch(cause => {
      if (!cancelled) setError(errorText(cause));
    });
    return () => { cancelled = true; mounted.current = false; };
  }, [api, eventRef.userId, eventRef.planId, eventRef.idInPlan, eventRef.happenDay, retry]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!timing || saving || disabled) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateCalendarWorkoutEvent({ ref: eventRef, timing });
      if (!mounted.current) return;
      setTiming(result.event.timing);
      onSaved(result.event);
      setMessage(result.synced.length ? `Saved and updated ${result.synced.join(" and ")}.`
        : result.errors.length ? "Saved in CorosLink. Calendar sync needs another try."
        : "Saved in CorosLink. Connect a calendar in Settings to sync this event.");
      if (result.errors.length) setError(result.errors.join(" "));
    } catch (cause) {
      if (mounted.current) setError(errorText(cause));
    } finally {
      if (mounted.current) setSaving(false);
    }
  }

  return <form className="calendar-workout-event" onSubmit={save} aria-label="Calendar event">
    <h4>Calendar event</h4>
    <p>Set this workout’s time here. Saving updates your connected Google and Apple calendars.</p>
    {timing ? <fieldset disabled={saving || disabled}>
      <label className="field">Event type
        <select value={timing.mode} onChange={event => setTiming({ ...timing, mode: event.target.value as CalendarEventTiming["mode"] })}>
          <option value="all-day">All-day event</option>
          <option value="timed">Timed event</option>
        </select>
      </label>
      {timing.mode === "timed" ? <>
        <div className="calendar-workout-event-times">
          <label className="field">Start time
            <input name="startTime" type="time" required value={timing.startTime} onChange={event => setTiming({ ...timing, startTime: event.target.value })} />
          </label>
          <label className="field">End time
            <input name="endTime" type="time" required value={timing.endTime} onChange={event => setTiming({ ...timing, endTime: event.target.value })} />
          </label>
        </div>
        <label className="field">Time zone
          <input name="timeZone" type="text" required value={timing.timeZone} onChange={event => setTiming({ ...timing, timeZone: event.target.value })} />
        </label>
        {timing.endTime <= timing.startTime ? <p>End time is on the following day.</p> : null}
      </> : null}
      <button type="submit" className="primary-button">
        {saving ? <Loader2 size={15} className="spin" aria-hidden="true" /> : null}
        {saving ? "Saving and syncing…" : "Save event"}
      </button>
    </fieldset> : error ? <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Try again</button> : <p role="status">Loading event…</p>}
    {message ? <p role="status">{message}</p> : null}
    {error ? <p className="calendar-error" role="alert">{error}</p> : null}
  </form>;
}
