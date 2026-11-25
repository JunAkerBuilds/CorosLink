"use client";
import { useState } from "react";
import { Button, Field } from "@/components/ui";
import type { Alarm } from "@/data/watch";
import { dayName, dayShort, validTime, WEEK_ORDER } from "@/lib/watch";

/** Edits one alarm in place: time, the days it repeats on and an optional name. */
export function AlarmEditor({ alarm, isNew, onSave, onCancel, onRemove, noLabel }: {
  alarm: Alarm; isNew: boolean; onSave: (next: Alarm) => void; onCancel: () => void; onRemove?: () => void;
  /** The watch keeps no name for an alarm: hide the field where a name could not be saved. */
  noLabel?: boolean;
}) {
  const [time, setTime] = useState(alarm.time);
  const [days, setDays] = useState<number[]>(alarm.days);
  const [label, setLabel] = useState(alarm.label);
  const toggle = (d: number) => setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b)));
  const ok = validTime(time);
  return (
    <form
      className="wa-edit" aria-label={isNew ? "New alarm" : `Edit the ${alarm.time} alarm`}
      onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ ...alarm, time, days, label: label.trim() }); }}
    >
      <div className="wa-edit-fields">
        <Field type="time" aria-label="Time" required value={time} onChange={(e) => setTime(e.target.value)} autoFocus />
        {noLabel ? null : <Field type="text" aria-label="Name" placeholder="Name, such as Long run" maxLength={24} value={label} onChange={(e) => setLabel(e.target.value)} />}
      </div>
      <div className="wa-days" role="group" aria-label="Repeat on">
        {WEEK_ORDER.map((d) => (
          <button key={d} type="button" aria-pressed={days.includes(d)} aria-label={dayName(d)} onClick={() => toggle(d)}>{dayShort(d)}</button>
        ))}
      </div>
      <div className="wa-edit-actions">
        <Button type="submit" variant="primary" disabled={!ok}>{isNew ? "Add alarm" : "Save"}</Button>
        <Button onClick={onCancel}>Cancel</Button>
        {onRemove ? <Button variant="plain" className="wa-remove" onClick={onRemove}>Remove alarm</Button> : null}
      </div>
    </form>
  );
}
