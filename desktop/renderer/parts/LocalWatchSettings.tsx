// Local mode: the watch's own settings, changed from this computer as the phone's Watch settings page changes them
// (CorosLinkFaces/Views/WatchDataViews.swift): quick switches, the settings by group, the sleep schedule, what stays
// on the watch, and the training profile. Every change is written to the watch and read back; what shows is what
// the watch kept. Names and groups are the phone's.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Field, Segmented, Select, Switch } from "@/components/ui";
import { navigate } from "../router";
import {
  findPlaces, readWatchFaces, readWatchSettings, sendWeatherNow, setSleepTimes, setWatchProfile, setWatchSwitch, setWeatherPlace, showWatchFace, whenSynced,
  type FoundPlace, type SleepTimes, type WatchFaces, type WatchOwnSettings, type WatchProfile, type WatchStatus, type WatchSwitch, type ZoneType,
} from "../watchLink";
import "./localWatchSettings.css";

const said = (e: unknown) => (e instanceof Error ? e.message : "That didn't work.");

const TITLES: Record<string, string> = {
  raiseToWake: "Raise to wake", raiseToWakeActivity: "Raise to wake in activities", brightness: "Brightness",
  alwaysOnDaily: "Always-on display", alwaysOnActivity: "Always-on in activities", dialRotation: "Dial direction",
  screenLock: "Auto lock", wrist: "Wrist", doNotDisturb: "Do Not Disturb", scheduledDoNotDisturb: "Scheduled Do Not Disturb",
  notificationsInActivity: "Notifications in activities", turnByTurnAlerts: "Turn-by-turn alerts", timeFormat: "Time format",
  units: "Units", pressureUnit: "Pressure unit", temperatureUnit: "Temperature unit", barometerRange: "Barometer range",
  stormAlert: "Storm alert", backlight: "Backlight", screenRotation: "Screen orientation", touchscreen: "Touchscreen",
  nightMode: "Night Mode", batterySaver: "Battery saver", dailyHeartRate: "All-day heart rate", wristHeartRateOff: "Wrist heart rate",
  sleepHrvOff: "Sleep HRV", hrvStressOff: "Stress", sedentaryReminderOff: "Move reminders", strydDistance: "Run distance from",
};
/** "wristGesture" is left out as on the phone: the watch stores it, but flipping it changes nothing. */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Display", keys: ["raiseToWake", "raiseToWakeActivity", "brightness", "alwaysOnDaily", "alwaysOnActivity", "screenLock", "dialRotation", "wrist"] },
  { title: "Notifications", keys: ["doNotDisturb", "scheduledDoNotDisturb", "notificationsInActivity", "turnByTurnAlerts"] },
  { title: "Units and formats", keys: ["timeFormat", "units", "pressureUnit", "temperatureUnit"] },
  { title: "Barometer", keys: ["barometerRange", "stormAlert"] },
];
/** Read-only on every watch: shown as values. */
const ON_WATCH = ["backlight", "screenRotation", "touchscreen", "nightMode", "batterySaver", "dailyHeartRate", "wristHeartRateOff",
  "sleepHrvOff", "hrvStressOff", "sedentaryReminderOff", "strydDistance"];
/** The switches flipped most, as tiles; they don't repeat in the groups. */
const QUICK = ["raiseToWakeActivity", "alwaysOnDaily", "alwaysOnActivity", "doNotDisturb", "stormAlert"];

const title = (key: string) => TITLES[key] ?? key;
/** The value meaning on, for a setting shown as a switch (two choices, On and Off). */
function onValue(s: WatchSwitch): number | null {
  const edit = s.edit;
  if (!edit || edit.length !== 2) return null;
  const names = edit.map((v) => s.values[String(v)]);
  if (!(names.includes("On") && names.includes("Off"))) return null;
  return edit.find((v) => s.values[String(v)] === "On") ?? null;
}
const valueName = (s: WatchSwitch, v = s.value) => s.values[String(v)] ?? String(v);

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const minutesOf = (text: string) => { const [h, m] = text.split(":").map(Number); return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null; };
const pace = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const paceMs = (text: string) => { const m = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim()); return m ? (Number(m[1]) * 60 + Number(m[2])) * 1000 : null; };

/** Reads the settings once the card shows (connecting to the watch if needed), and again on Try again. */
function useWatchSettings() {
  const [settings, setSettings] = useState<WatchOwnSettings | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => readWatchSettings().then(setSettings, (e: unknown) => setProblem(said(e))).finally(() => setLoading(false)), []);
  const read = () => { setLoading(true); setProblem(null); void load(); };
  useEffect(() => { void load(); }, [load]);
  return { settings, setSettings, problem, loading, read };
}

export function LocalWatchSettings() {
  const { settings, setSettings, problem, loading, read } = useWatchSettings();
  return (
    <>
      <SwitchesCard settings={settings} loading={loading} problem={problem} onRetry={read}
        onSwitches={(switches) => setSettings((s) => ({ ...s, switches }))} onSleep={(sleep) => setSettings((s) => ({ ...s, sleep }))} />
      {settings?.profile ? <ProfileCard profile={settings.profile} onProfile={(profile) => setSettings((s) => ({ ...s, profile }))} /> : null}
    </>
  );
}

function SwitchesCard({ settings, loading, problem, onRetry, onSwitches, onSleep }: {
  settings: WatchOwnSettings | null; loading: boolean; problem: string | null; onRetry: () => void;
  onSwitches: (s: WatchSwitch[]) => void; onSleep: (s: SleepTimes | null) => void;
}) {
  const [saving, setSaving] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const switches = settings?.switches ?? [];
  const byKey = new Map(switches.map((s) => [s.key, s]));
  const change = (key: string, value: number) => {
    setSaving(key); setFailed(null);
    setWatchSwitch(key, value).then((r) => onSwitches(r.switches), (e: unknown) => setFailed(said(e))).finally(() => setSaving(null));
  };
  const quick = QUICK.map((k) => byKey.get(k)).filter((s): s is WatchSwitch => !!s && onValue(s) !== null);
  const onWatch = ON_WATCH.map((k) => byKey.get(k)).filter((s): s is WatchSwitch => !!s);
  const unread = settings?.problems?.filter((p) => !p.startsWith("profile")) ?? [];

  return (
    <Card className="wa-card lm-w12 ws-card" aria-label="Watch settings">
      <div className="wa-alarms-head">
        <h2>Watch settings</h2>
        {saving ? <span className="lm-quiet">Saving to the watch…</span>
          : loading ? <span className="lm-quiet">Reading the watch…</span>
          : settings && !problem ? <span className="lm-done">In sync with the watch</span>
          : problem && settings ? <button type="button" className="set-link" onClick={onRetry}>Read again</button> : null}
      </div>
      {problem && !settings ? (
        <div className="lm-ask"><p>{problem}</p><Button onClick={onRetry}>Try again</Button></div>
      ) : null}
      {settings && !switches.length && settings.sleep === undefined ? <p className="lm-quiet">This watch&apos;s settings are changed on the watch.</p> : null}

      {quick.length ? (
        <div className="ws-quick" role="group" aria-label="Quick settings">
          {quick.map((s) => {
            const on = s.value === onValue(s);
            const other = s.edit!.find((v) => v !== s.value)!;
            return (
              <button key={s.key} type="button" className="ws-tile" aria-pressed={on} disabled={!!saving} onClick={() => change(s.key, other)}>
                <span className="ws-tile-name">{title(s.key)}</span>
                <span className="ws-tile-state">{saving === s.key ? "Saving…" : on ? "On" : "Off"}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="ws-groups">
        {GROUPS.map((g) => {
          const rows = g.keys.map((k) => byKey.get(k)).filter((s): s is WatchSwitch => !!s && !quick.includes(s));
          if (!rows.length) return null;
          return (
            <section key={g.title} className="ws-group" aria-label={g.title}>
              <h3>{g.title}</h3>
              {rows.map((s) => <SettingRow key={s.key} s={s} saving={saving} onChange={change} />)}
            </section>
          );
        })}
        {settings?.sleep !== undefined ? <SleepGroup sleep={settings.sleep ?? null} onSleep={onSleep} /> : null}
      </div>

      {onWatch.length ? (
        <section className="ws-group ws-group-ro" aria-label="Set on the watch">
          <h3>Set on the watch <span className="ws-h3-note">· change these on the watch</span></h3>
          <div className="ws-readonly">
            {onWatch.map((s) => <div key={s.key} className="ws-ro"><span>{title(s.key)}</span><b>{valueName(s)}</b></div>)}
          </div>
        </section>
      ) : null}
      {failed ? <p className="lm-problem" role="alert">{failed}</p> : null}
      {unread.length ? <p className="lm-quiet">Not read this time: {unread.map((p) => p.split(":")[0]).join(", ")}.</p> : null}
    </Card>
  );
}

function SettingRow({ s, saving, onChange }: { s: WatchSwitch; saving: string | null; onChange: (key: string, value: number) => void }) {
  const on = onValue(s);
  const edit = s.edit ?? [];
  return (
    <div className="ws-row">
      <span className="ws-row-name">{title(s.key)}</span>
      <span className="ws-row-end">
        {saving === s.key ? <span className="lm-quiet">Saving…</span> : null}
        {!edit.length ? <b className="ws-value">{valueName(s)}</b>
          : on !== null ? <Switch label={title(s.key)} checked={s.value === on} disabled={!!saving} onChange={(next) => onChange(s.key, next ? on : edit.find((v) => v !== on)!)} />
          : edit.length <= 3 ? (
            <Segmented small label={title(s.key)} value={String(s.value)} onChange={(v) => { if (!saving && Number(v) !== s.value) onChange(s.key, Number(v)); }}
              options={edit.map((v) => ({ value: String(v), label: valueName(s, v) }))} />
          ) : (
            <Select field className="ws-select" aria-label={title(s.key)} value={s.value} disabled={!!saving} onChange={(e) => onChange(s.key, Number(e.target.value))}>
              {edit.map((v) => <option key={v} value={v}>{valueName(s, v)}</option>)}
            </Select>
          )}
      </span>
    </div>
  );
}

/** Sleep Time and Wake Time, which switch the watch's Sleep Mode. */
function SleepGroup({ sleep, onSleep }: { sleep: SleepTimes | null; onSleep: (s: SleepTimes | null) => void }) {
  const [bed, setBed] = useState(sleep ? hhmm(sleep.bedtime) : "23:00");
  const [wake, setWake] = useState(sleep ? hhmm(sleep.wake) : "07:00");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const bedtime = minutesOf(bed), wakeAt = minutesOf(wake);
  const changed = bedtime !== null && wakeAt !== null && (!sleep || bedtime !== sleep.bedtime || wakeAt !== sleep.wake);
  const save = () => {
    if (bedtime === null || wakeAt === null) return;
    setSaving(true); setProblem(null);
    setSleepTimes({ bedtime, wake: wakeAt }).then((r) => onSleep(r.sleep), (e: unknown) => setProblem(said(e))).finally(() => setSaving(false));
  };
  return (
    <section className="ws-group" aria-label="Sleep schedule">
      <h3>Sleep schedule</h3>
      <div className="ws-row">
        <span className="ws-row-name">Sleep Mode from<small>The watch quiets down between these times</small></span>
        <span className="ws-row-end ws-times">
          <Field type="time" aria-label="Bedtime" value={bed} onChange={(e) => setBed(e.target.value)} />
          <span className="lm-quiet">to</span>
          <Field type="time" aria-label="Wake time" value={wake} onChange={(e) => setWake(e.target.value)} />
          {changed ? <Button variant="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</Button> : null}
        </span>
      </div>
      {problem ? <p className="lm-problem" role="alert">{problem}</p> : null}
    </section>
  );
}

const ZONES: { value: ZoneType; label: string }[] = [{ value: "maxHR", label: "Max HR" }, { value: "reserve", label: "HR reserve" }, { value: "threshold", label: "Threshold" }];

/** Heart-rate and pace thresholds; each zone set moves with its reference, as on the phone. */
function ProfileCard({ profile, onProfile }: { profile: WatchProfile; onProfile: (p: WatchProfile) => void }) {
  const fromProfile = (p: WatchProfile) => ({ maxHR: String(p.maxHR || ""), restingHR: String(p.restingHR || ""), thresholdHR: String(p.thresholdHR || ""), pace: p.thresholdPace ? pace(p.thresholdPace) : "", zoneType: p.zoneType });
  const [draft, setDraft] = useState(() => fromProfile(profile));
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const was = fromProfile(profile);
  const changed = (Object.keys(draft) as (keyof typeof draft)[]).some((k) => draft[k] !== was[k]);

  const save = () => {
    const edits: Parameters<typeof setWatchProfile>[0] = {};
    for (const k of ["maxHR", "restingHR", "thresholdHR"] as const) {
      if (draft[k] === was[k]) continue;
      const n = Number(draft[k]);
      if (!Number.isInteger(n)) { setProblem("Type heart rates as whole numbers."); return; }
      edits[k] = n;
    }
    if (draft.pace !== was.pace) {
      const ms = paceMs(draft.pace);
      if (ms === null) { setProblem("Type threshold pace as minutes:seconds per km, like 4:30."); return; }
      edits.thresholdPace = ms;
    }
    if (draft.zoneType !== was.zoneType) edits.zoneType = draft.zoneType;
    setSaving(true); setProblem(null);
    setWatchProfile(edits).then((r) => { onProfile(r.profile); setDraft(fromProfile(r.profile)); }, (e: unknown) => setProblem(said(e))).finally(() => setSaving(false));
  };
  const field = (k: "maxHR" | "restingHR" | "thresholdHR", label: string) => (
    <label className="ws-num"><span>{label}</span>
      <span className="ws-num-box"><Field inputMode="numeric" value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value.replace(/\D/g, "").slice(0, 3) })} /><small>bpm</small></span>
    </label>
  );
  return (
    <Card className="wa-card lm-w12 ws-card" aria-label="Training profile">
      <div className="wa-alarms-head"><h2>Training profile</h2><span className="lm-quiet">Zones and thresholds the watch uses in workouts</span></div>
      <div className="ws-profile">
        {field("maxHR", "Max heart rate")}
        {field("restingHR", "Resting heart rate")}
        {field("thresholdHR", "Threshold heart rate")}
        <label className="ws-num"><span>Threshold pace</span>
          <span className="ws-num-box"><Field inputMode="numeric" placeholder="4:30" value={draft.pace} onChange={(e) => setDraft({ ...draft, pace: e.target.value.slice(0, 5) })} /><small>/km</small></span>
        </label>
      </div>
      <div className="ws-row">
        <span className="ws-row-name">Heart-rate zones from</span>
        <span className="ws-row-end"><Segmented small label="Heart-rate zones from" value={draft.zoneType} onChange={(zoneType) => setDraft({ ...draft, zoneType })} options={ZONES} /></span>
      </div>
      {profile.zones.length ? (
        <div className="ws-zones" aria-label="Heart-rate zones">
          {[0, ...profile.zones].map((low, i, all) => (
            <span key={i} className="ws-zone" data-zone={i + 1}><b>Z{i + 1}</b>{i === 0 ? `< ${all[1]}` : i === all.length - 1 ? `${low}+` : `${low}–${all[i + 1] - 1}`}</span>
          ))}
        </div>
      ) : null}
      {profile.ftp > 0 ? <p className="lm-quiet">FTP {profile.ftp} W{profile.criticalPower > 0 ? ` · critical power ${profile.criticalPower} W` : ""}, set on the watch.</p> : null}
      {changed ? (
        <div className="lm-actions">
          <Button variant="primary" disabled={saving} onClick={save}>{saving ? "Saving to the watch…" : "Save to watch"}</Button>
          <Button variant="plain" disabled={saving} onClick={() => { setDraft(was); setProblem(null); }}>Cancel</Button>
        </div>
      ) : null}
      {problem ? <p className="lm-problem" role="alert">{problem}</p> : null}
    </Card>
  );
}

/* ───────────── Faces on the watch ───────────── */

/** The watch's face slots, and which is on screen; any other face can be put on screen from here. */
export function WatchFacesCard() {
  const [faces, setFaces] = useState<WatchFaces | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [switching, setSwitching] = useState<number | null>(null);
  const load = useCallback(() => readWatchFaces().then(setFaces, (e: unknown) => setProblem(said(e))), []);
  useEffect(() => { void load(); }, [load]);
  const show = (slot: number, faceId: number) => {
    setSwitching(slot); setProblem(null);
    showWatchFace(slot, faceId).then(setFaces, (e: unknown) => setProblem(said(e))).finally(() => setSwitching(null));
  };
  return (
    <Card className="wa-card lm-w12 ws-card" aria-label="Faces on the watch">
      <div className="wa-alarms-head">
        <h2>Faces on the watch</h2>
        <span className="lm-actions">
          {faces ? <button type="button" className="set-link" onClick={() => { setProblem(null); void load(); }}>Refresh</button> : null}
          <Button onClick={() => navigate("/studio")}>Make one in Studio</Button>
        </span>
      </div>
      {faces ? (
        <div className="ws-slots">
          {faces.slots.map((x) => (
            <div key={x.slot} className="ws-slot" data-empty={x.faceId == null || undefined} data-on={faces.shown === x.slot || undefined}>
              <span className="ws-slot-num">{x.slot + 1}</span>
              <span className="ws-slot-state">{x.faceId == null ? "Empty" : faces.shown === x.slot ? "On screen" : "Face"}</span>
              {x.faceId != null && faces.shown !== x.slot ? (
                <button type="button" className="set-link" disabled={switching !== null} onClick={() => show(x.slot, x.faceId!)}>{switching === x.slot ? "Switching…" : "Show"}</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : !problem ? <p className="lm-quiet">Reading the watch…</p> : null}
      {problem ? <div className="lm-ask"><p>{problem}</p><Button onClick={() => { setProblem(null); void load(); }}>Try again</Button></div> : null}
      <p className="lm-quiet">Studio&apos;s Send → Watch installs a face into any of these slots over Bluetooth.</p>
    </Card>
  );
}

/* ───────────── Weather ───────────── */

/** Where the watch's weather is for: found by name, sent with each sync (and now, when the watch is connected). */
export function WeatherRow({ status }: { status: WatchStatus }) {
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<FoundPlace[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const place = status.weather;
  const run = (work: () => Promise<unknown>) => { setBusy(true); setProblem(null); work().catch((e: unknown) => setProblem(said(e))).finally(() => setBusy(false)); };
  const search = () => run(() => findPlaces(query).then(setFound));
  const pick = (p: FoundPlace) => run(() => setWeatherPlace({ latitude: p.latitude, longitude: p.longitude, city: p.city }).then(() => { setEditing(false); setFound(null); setQuery(""); }));
  return (
    <div className="lm-row ws-weather">
      <span className="lm-ico" data-hue="blue"><svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z" /></svg></span>
      <span className="lm-row-text">
        <strong>Weather</strong>
        <span>{place ? `${place.city || "Your place"} · ${status.weatherSentAt ? `sent ${whenSynced(status.weatherSentAt)}` : "sent with the next sync"}` : "Pick a place: the forecast goes to the watch with each sync"}</span>
        {editing ? (
          <form className="ws-place" onSubmit={(e) => { e.preventDefault(); search(); }}>
            <Field autoFocus placeholder="Town or city" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Town or city" />
            <Button type="submit" disabled={busy || query.trim().length < 2}>Search</Button>
            <Button variant="plain" onClick={() => { setEditing(false); setFound(null); }}>Cancel</Button>
          </form>
        ) : null}
        {editing && found ? (
          found.length ? (
            <span className="ws-found">
              {found.map((p) => <button key={`${p.latitude},${p.longitude}`} type="button" className="ws-found-row" disabled={busy} onClick={() => pick(p)}><b>{p.city}</b><small>{p.region}</small></button>)}
            </span>
          ) : <span>No place by that name.</span>
        ) : null}
        {problem ? <span className="lm-problem" role="alert">{problem}</span> : null}
      </span>
      {!editing ? (
        <span className="lm-row-end">
          {place ? <Button disabled={busy} onClick={() => run(sendWeatherNow)}>{busy ? "Sending…" : "Send now"}</Button> : null}
          <Button onClick={() => setEditing(true)}>{place ? "Change" : "Pick a place"}</Button>
        </span>
      ) : null}
    </div>
  );
}
