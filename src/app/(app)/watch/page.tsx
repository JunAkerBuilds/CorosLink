"use client";
import { useEffect, useState } from "react";
import { Button, Card, OriginBadge, Switch, CountUp } from "@/components/ui";
import { AlarmEditor } from "@/components/watch/AlarmEditor";
import { BatteryChart } from "@/components/watch/BatteryChart";
import { NumberField } from "@/components/watch/NumberField";
import { useLoaded, type Origin } from "@/data/core";
import { newAlarmId, WATCH_PENDING_INITIAL, watchPendingStore } from "@/data/local/watch";
import { useStore } from "@/data/local/store";
import { changeWatchSetting, discardWatchChanges, loadWatch, sendPendingToPhone, undoWatchSetting, WATCH_NOT_CONNECTED, type Alarm, type GpsMode, type Watch } from "@/data/watch";
import { useSyncStatus } from "@/data/sync";
import { parseDay } from "@/lib/format";
import { type Json, alarmJson, alarmKey, alarmLine, alarmRows, dayShort, goalShare, lastChargeIndex, pendingCount, pendingFor, repeatLabel, stepGoal, valueOf, WEEK_ORDER } from "@/lib/watch";
import { platformSlots } from "@/lib/platform";
import "./watch.css";

const RING = 2 * Math.PI * 44;
const GOAL_HUE: Record<string, string> = { calories: "orange", exercise: "mint", steps: "blue" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const WatchLink = platformSlots.watchLink;
const WatchPanel = platformSlots.watchPanel;
const WatchCards = platformSlots.watchCards;
const WatchTools = platformSlots.watchTools;

export default function WatchPage() {
  const loaded = useLoaded(loadWatch);
  if (loaded.status === "loading") return <main className="page"><div className="skeleton" style={{ minHeight: 480 }} /></main>;
  if (loaded.status === "error") return <main className="page"><p className="notice" role="alert">{loaded.error.message}</p></main>;
  return <WatchScreen watch={loaded.data} origin={loaded.origin} />;
}

function Waiting({ label, onUndo }: { label: string; onUndo: () => void }) {
  return (
    <span className="wa-wait">
      <span className="wa-chip">Waiting for sync</span>
      <button type="button" className="wa-undo" aria-label={`Undo the change to ${label}`} onClick={onUndo}>Undo</button>
    </span>
  );
}

function WatchScreen({ watch, origin }: { watch: Watch; origin: Origin }) {
  // Signed in, the waiting changes are the account's `watch.change` items; signed out, this browser's.
  const local = useStore(watchPendingStore, WATCH_PENDING_INITIAL);
  const synced = origin === "synced";
  const queue = watch.pending ?? local;
  const sync = useSyncStatus();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Alarm | null>(null);
  const [syncNote, setSyncNote] = useState("");
  const count = pendingCount(queue);

  // Offer the waiting changes to the phone. There is no sync server yet, so the data layer refuses and says why.
  useEffect(() => {
    if (!count || synced) return;
    let live = true;
    sendPendingToPhone(count).catch((e: unknown) => { if (live) setSyncNote(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [count, synced]);
  const saved = (p: Promise<void>) => { p.catch((e: unknown) => setSyncNote(e instanceof Error ? e.message : String(e))); };
  const setPending = (key: string, original: Json, next: Json) => saved(changeWatchSetting(key, original, next));
  const undoPending = (key: string) => saved(undoWatchSetting(key));
  const discardPending = () => saved(discardWatchChanges());
  // What can honestly be said about the waiting changes: on this page only, in the account, or not there yet.
  const queueNote = !synced
    ? (count ? syncNote || `${WATCH_NOT_CONNECTED}.` : `${WATCH_NOT_CONNECTED}: changes made here are saved in this browser until it is.`)
    : sync.error ? `Not saved to your account yet. ${sync.error}`
      : sync.unsent ? "Not saved to your account yet"
        : count ? (watch.viaComputer ? "Going to the watch" : "Waiting for the phone app") : syncNote;

  const gps = valueOf<GpsMode | null>(queue, "gps.mode", watch.gpsMode);
  const percent = watch.battery.percent;
  const rows = alarmRows(watch.alarms, queue);
  const original = (id: string) => {
    const a = watch.alarms.find((x) => x.id === id);
    return a ? alarmJson(a) : null;
  };
  const saveAlarm = (next: Alarm) => {
    setPending(alarmKey(next.id), original(next.id), alarmJson(next));
    setEditing(null);
    setDraft(null);
  };
  const removeAlarm = (id: string) => {
    const was = original(id);
    if (was === null) undoPending(alarmKey(id));
    else setPending(alarmKey(id), was, null);
    setEditing(null);
  };
  const addAlarm = () => {
    const id = newAlarmId();
    setDraft({ id, time: "07:00", days: [], label: "", on: true });
    setEditing(id);
  };
  const charged = lastChargeIndex(watch.batteryHistory.levels);
  const chargedDay = parseDay(watch.batteryHistory.firstDay || "2000-01-01");
  chargedDay.setDate(chargedDay.getDate() + (charged ?? 0));

  return (
    <main className="page wa-page">
      {watch.empty ? <p className="notice" role="status">Nothing from your phone yet</p> : null}
      {watch.refused ? <p className="notice" role="status">{watch.refused}</p> : null}
      <section aria-label="Device" className="wa-hero">
        <div aria-hidden="true" className="wa-watch">
          <i className="wa-strap" /><i className="wa-strap" data-low="" /><i className="wa-crown" /><i className="wa-case" /><i className="wa-dial" />
          <svg width="128" height="128" viewBox="0 0 128 128">
            <circle cx="64" cy="64" r="54" fill="none" style={{ stroke: "rgba(255, 255, 255, 0.12)", strokeWidth: 7 }} />
            <circle className="cl-ring" cx="64" cy="64" r="54" fill="none" strokeDasharray={`${((percent ?? 0) / 100) * 339.3} 340`} style={{ stroke: "#53cba1", strokeWidth: 7, strokeLinecap: "round" }} />
          </svg>
          <span className="wa-dial-text"><CountUp className="num" text={percent === null ? "—" : `${percent}%`} /><span>Battery</span></span>
        </div>
        <div className="wa-id">
          <h1>{watch.name}</h1>
          <span className="wa-synced"><i aria-hidden="true" />{watch.synced}</span>
          {WatchLink ? <WatchLink /> : null}
          {WatchPanel ? <WatchPanel /> : null}
          <span className="wa-badges"><OriginBadge origin={origin} />{count && !synced ? <OriginBadge origin="browser" /> : null}</span>
          <div className="wa-queue" role="status">
            {count ? (
              <>
                <span className="wa-count">{count} {count === 1 ? "change" : "changes"} waiting for sync</span>
                <Button onClick={discardPending}>Discard {count === 1 ? "change" : `all ${count}`}</Button>
              </>
            ) : <span className="muted">No changes waiting</span>}
            {queueNote ? <p>{queueNote}</p> : null}
          </div>
        </div>
        <div className="wa-tiles">
          <div className="tile"><span className="wa-k">Battery life</span><span className="wa-v">{watch.battery.left || "—"}</span><span className="wa-s">{watch.batteryHistory.perDay ? `At ${watch.batteryHistory.perDay}` : ""}</span></div>
          <div className="tile">
            <span className="wa-k">Storage</span><CountUp className="wa-v" text={watch.storage ? `${watch.storage.usedGb} GB` : "—"} />
            <div aria-hidden="true" className="wa-meter"><i className="cl-bar" style={{ width: `${watch.storage ? (watch.storage.usedGb / watch.storage.totalGb) * 100 : 0}%`, background: "var(--h-blue)" }} /></div>
            <span className="wa-s">{watch.storage ? `of ${watch.storage.totalGb} GB used` : ""}</span>
          </div>
          <div className="tile"><span className="wa-k">Firmware</span><span className="wa-v">{watch.firmware.version || "—"}</span><span className="wa-s">{watch.firmware.state}</span></div>
        </div>
      </section>

      <div className="wa-board">
        {WatchCards ? <WatchCards /> : null}
        <Card aria-label="Daily goal" className="wa-card wa-w7">
          <h2>Daily goal</h2>
          <div className="wa-goals">
            {watch.goals.map((g) => {
              const key = `goal.${g.key}`;
              const goal = valueOf(queue, key, g.goal);
              const share = goalShare(g.done, goal);
              return (
                <div key={g.key} className="tile wa-goal">
                  <div className="wa-goal-head">
                    <label htmlFor={`g-${g.key}`}>{g.name}</label>
                    {pendingFor(queue, key) ? <Waiting label={g.name} onUndo={() => undoPending(key)} /> : null}
                  </div>
                  <div className="wa-ring">
                    <svg aria-hidden="true" width="108" height="108" viewBox="0 0 108 108">
                      <circle cx="54" cy="54" r="44" fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.08)", strokeWidth: 10 }} />
                      <circle cx="54" cy="54" r="44" fill="none" strokeDasharray={`${share * RING} ${RING + 1}`} style={{ stroke: `var(--h-${GOAL_HUE[g.key]})`, strokeWidth: 10, strokeLinecap: "round", transition: "stroke-dasharray 0.35s" }} />
                    </svg>
                    <span className="num">{Math.round(share * 100)}%</span>
                  </div>
                  <span className="wa-s">{g.soFar}</span>
                  <div className="wa-stepper">
                    <button type="button" className="btn btn-glass" aria-label={`Lower the ${g.name.toLowerCase()} goal`} disabled={goal <= g.step} onClick={() => setPending(key, g.goal, stepGoal(goal, g.step, -1, g.max))}>
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.5, strokeLinecap: "round" }}><path d="M5 12h14" /></svg>
                    </button>
                    <NumberField id={`g-${g.key}`} value={goal} max={g.max} onCommit={(n) => setPending(key, g.goal, n)} />
                    <button type="button" className="btn btn-glass" aria-label={`Raise the ${g.name.toLowerCase()} goal`} disabled={goal >= g.max} onClick={() => setPending(key, g.goal, stepGoal(goal, g.step, 1, g.max))}>
                      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.5, strokeLinecap: "round" }}><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                  </div>
                  <span className="wa-s">{g.unit}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card aria-label="Satellite systems" className="wa-card wa-w5">
          <h2>Satellite systems</h2>
          <div role="radiogroup" aria-label="Satellite systems" className="wa-picks">
            {watch.gpsOptions.map((o) => (
              <div key={o.mode} className="wa-pick" data-on={gps === o.mode ? "true" : undefined}>
                <label>
                  <input type="radio" name="gps" checked={gps === o.mode} disabled={watch.gpsReadOnly} onChange={() => setPending("gps.mode", watch.gpsMode, o.mode)} />
                  <span className="wa-pick-name">{o.name}</span>
                  <span className="wa-pick-detail">{o.detail}</span>
                  <span className="wa-meters">
                    <Meter label="Accuracy" value={o.accuracy} hue="blue" />
                    <Meter label="Battery" value={o.battery} hue="mint" />
                  </span>
                </label>
                {gps === o.mode && pendingFor(queue, "gps.mode") ? <Waiting label="satellite systems" onUndo={() => undoPending("gps.mode")} /> : null}
              </div>
            ))}
          </div>
        </Card>

        <Card aria-label="Alarms" className="wa-card wa-w5">
          <div className="wa-alarms-head">
            <h2>Alarms</h2>
            <Button onClick={addAlarm} disabled={draft !== null || watch.empty}>Add alarm</Button>
          </div>
          <div className="wa-alarm-list">
          {rows.map(({ alarm, pending }) => {
            const key = alarmKey(alarm.id);
            if (editing === alarm.id) {
              return <AlarmEditor key={alarm.id} alarm={alarm} isNew={false} onSave={saveAlarm} onCancel={() => setEditing(null)} onRemove={() => removeAlarm(alarm.id)} noLabel={synced} />;
            }
            const removed = pending === "removed";
            return (
              <div key={alarm.id} className="tile wa-alarm" data-off={alarm.on ? undefined : ""} data-removed={removed ? "" : undefined}>
                <span className="wa-when">
                  <span className="wa-time num">{alarm.time}</span>
                  <span>{removed ? "Removed" : alarm.label || repeatLabel(alarm.days)}</span>
                  {pending ? <Waiting label={`the ${alarm.time} alarm`} onUndo={() => undoPending(key)} /> : null}
                </span>
                <span className="wa-daydots" role="img" aria-label={alarmLine(alarm)}>
                  {WEEK_ORDER.map((d) => <i key={d} data-on={alarm.days.includes(d) ? "true" : undefined}>{dayShort(d).slice(0, 1)}</i>)}
                </span>
                {removed ? <span /> : <button type="button" className="wa-edit-btn" aria-label={`Edit the ${alarm.time} alarm`} onClick={() => { setDraft(null); setEditing(alarm.id); }}>Edit</button>}
                <Switch
                  checked={alarm.on && !removed} disabled={removed} label={`${alarm.time} alarm`}
                  onChange={(on) => setPending(key, original(alarm.id), alarmJson({ ...alarm, on }))}
                />
              </div>
            );
          })}
          {draft ? <AlarmEditor key={draft.id} alarm={draft} isNew onSave={saveAlarm} onCancel={() => { setDraft(null); setEditing(null); }} noLabel={synced} /> : null}
          {!rows.length && !draft && !watch.empty ? <p className="wa-none">No alarms on the watch.</p> : null}
          </div>
        </Card>

        <Card aria-label="Battery" className="wa-card wa-w7">
          <h2>Battery</h2>
          <div className="wa-batt-stats">
            <div><span className="wa-k">Average use</span><span>{watch.batteryHistory.perDay || "—"}</span></div>
            <div><span className="wa-k">Last charged</span><span>{charged === null ? "—" : `${chargedDay.getDate()} ${MONTHS[chargedDay.getMonth()]}`}</span></div>
            <div><span className="wa-k">Left</span><span>{watch.battery.left || "—"}</span></div>
          </div>
          {watch.batteryHistory.levels.length < 2 ? null : <BatteryChart levels={watch.batteryHistory.levels} firstDay={watch.batteryHistory.firstDay} alt={watch.batteryHistory.alt} />}
        </Card>
        {WatchTools ? <WatchTools /> : null}
      </div>
    </main>
  );
}

function Meter({ label, value, hue }: { label: string; value: number; hue: string }) {
  return (
    <span className="wa-meter3" role="img" aria-label={`${label} ${value} of 3`}>
      {label}
      <span aria-hidden="true">{[1, 2, 3].map((k) => <i key={k} style={k <= value ? { background: `var(--h-${hue})` } : undefined} />)}</span>
    </span>
  );
}
