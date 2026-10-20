import { AlertCircle, Check, ChevronRight, History, Loader2, Lock, SlidersHorizontal, Watch } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { formatDate, t, useLanguage } from "../i18n";
import type { CorosLinkApi } from "../coroslink-api";
import { ipcErrorText } from "../ipcErrorText";
import type { WatchSettingsSummary } from "../../electron/watchSettingsService";
import { extSwitchFieldsFor, switchFieldsFor, type ExtSwitchKey, type SwitchKey } from "../../electron/corosWatchSettings";
import type { WatchModelId } from "../../electron/watchModels";
import { NOT_AVAILABLE_ON_WATCH, watchSupports } from "../../electron/localSync/watchSyncModels";
import { useWatchLink, useWatchRead } from "./useWatchLink";
import "./settingsPanel.css";
import "./watchSystemSettings.css";

type Key = SwitchKey | ExtSwitchKey;
type Field = { key: Key; status: string; values?: Readonly<Record<number, string>>; edit?: readonly number[] };
type Fields = Map<Key, Field>;

/** The fields the watch's model uses; one that doesn't apply to it (e.g. brightness on a memory-in-pixel screen) isn't there. */
function modelFields(model?: WatchModelId): { fields: Fields; extended: Set<Key> } {
  const main = switchFieldsFor(model) as readonly Field[];
  const ext = extSwitchFieldsFor(model) as readonly Field[];
  return { fields: new Map<Key, Field>([...main, ...ext].map(field => [field.key, field])), extended: new Set<Key>(ext.map(field => field.key)) };
}

/** Each switch's name as the watch's own menus call it. Meanings come from the firmware, per model (electron/corosWatchSettings.ts). */
const LABELS: Record<Key, string> = {
  backlight: "Backlight",
  wristGesture: "Wrist gestures",
  lossAlert: "Phone loss alert",
  trackApp: "Track app",
  weather: "Weather",
  scheduledDoNotDisturb: "Scheduled do not disturb",
  notificationPreview: "Notification preview",
  highLight: "High brightness",
  sedentaryOld: "Inactivity reminder (older watches)",
  wrist: "Wrist side",
  autoHeartRateOld: "Automatic heart rate (older watches)",
  autoSync: "Automatic sync",
  timeFormat: "Time format",
  units: "Units",
  gpsModeOld: "Satellite mode (older watches)",
  doNotDisturb: "Do not disturb",
  autoAltitudeCalibration: "Calibrate elevation automatically",
  timeFromPhone: "Time from phone",
  dialRotation: "Dial rotation",
  raiseToWake: "Raise to wake",
  screenRotation: "Dial location",
  seaLevelPressure: "Barometer reading",
  barometerRange: "Barometer display range",
  stormAlert: "Storm alert",
  batterySaver: "Battery saver",
  notificationsInActivity: "Notifications during activities",
  cycleReminderDays: "Period reminder",
  largeFont: "Large font",
  cycleSecondReminder: "Second cycle reminder",
  navigationAlerts: "Navigation alerts",
  dailyHeartRate: "Daily heart rate",
  wristHeartRateOff: "Wrist heart rate",
  pressureUnit: "Pressure units",
  metronomeCue: "Metronome cue",
  timerAlert: "Timer alert",
  mapOrientation: "Map orientation",
  screenLock: "Screen lock",
  nightMode: "Night mode",
  touchscreen: "Touchscreen",
  backgroundColor: "Background color",
  turnByTurnAlerts: "Turn-by-turn alerts",
  sleepHrvOff: "Sleep HRV",
  strydDistance: "Distance source",
  hrvStressOff: "All-day HRV and stress",
  brightness: "Brightness",
  alwaysOnDaily: "Always-on display",
  alwaysOnActivity: "Always-on display in activities",
  temperatureUnit: "Temperature unit",
  sedentaryReminderOff: "Inactivity reminder",
  raiseToWakeActivity: "Raise to wake during activities",
  cycleReminderEnabled: "Cycle reminders"
};

/** Short explanations for settings whose effect isn't obvious from the name. */
const HINTS: Partial<Record<Key, string>> = {
  raiseToWake: "Auto keeps the screen dark during your sleep hours.",
  wristGesture: "Needed for raise to wake.",
  scheduledDoNotDisturb: "Uses the quiet hours set on the watch.",
  notificationsInActivity: "Messages and calls while recording an activity.",
  batterySaver: "Also turns off phone notifications.",
  backlight: "Night use: the light can stay on until you turn it off.",
  turnByTurnAlerts: "Turn alerts while following a route.",
  barometerRange: "How far the barometer chart zooms in."
};

const GROUPS: Array<{ title: string; keys: Key[] }> = [
  { title: "Display", keys: ["brightness", "alwaysOnDaily", "alwaysOnActivity", "backlight", "nightMode", "touchscreen", "screenRotation"] },
  { title: "Raise to wake & controls", keys: ["raiseToWake", "wristGesture", "raiseToWakeActivity", "wrist", "dialRotation"] },
  { title: "Notifications & quiet time", keys: ["doNotDisturb", "scheduledDoNotDisturb", "notificationsInActivity", "batterySaver"] },
  { title: "Health", keys: ["dailyHeartRate", "wristHeartRateOff", "hrvStressOff", "sleepHrvOff", "sedentaryReminderOff", "cycleReminderDays", "cycleSecondReminder"] },
  { title: "Units & formats", keys: ["timeFormat", "units", "temperatureUnit", "pressureUnit"] },
  { title: "Barometer & navigation", keys: ["stormAlert", "barometerRange", "turnByTurnAlerts", "strydDistance"] }
];

function valueText(field: Field | undefined, value: number): string {
  const name = field?.values?.[value];
  if (name) return t(name);
  if (field?.key === "cycleReminderDays") return t("{{value0}} days before", { value0: value });
  return String(value);
}

/** A save error without Electron's IPC prefix; "didn't keep" names the settings by their labels. */
function saveError(error: unknown, fields: Fields): string {
  const text = ipcErrorText(error);
  const missed = /^The watch didn't keep (.+)\. Reconnect and try again\.$/.exec(text);
  if (!missed) return t(text);
  const names = missed[1]!.split(", ").map(key => fields.has(key as Key) ? t(LABELS[key as Key]) : key);
  return t("The watch didn't keep {{value0}}. Reconnect and try again.", { value0: names.join(", ") });
}

/** Arrow keys, Home and End move the choice in a segmented control, like native radio buttons. */
function segmentKey(event: KeyboardEvent<HTMLDivElement>, choices: readonly number[], value: number, pick: (choice: number) => void) {
  const index = choices.indexOf(value);
  const next = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: choices.length - 1 }[event.key];
  if (next === undefined) return;
  event.preventDefault();
  const target = (next + choices.length) % choices.length;
  pick(choices[target]!);
  (event.currentTarget.children[target] as HTMLElement | undefined)?.focus();
}

/** Whether the firmware names this value; an unnamed one isn't shown as if its meaning were known. */
function named(field: Field, value: number): boolean {
  return !field.values || value in field.values;
}

/** The value a switch writes for "on", for settings whose choices are On and Off. */
function onValue(field: Field): number | undefined {
  if (!field.edit || field.edit.length !== 2) return undefined;
  const labels = field.edit.map(value => field.values?.[value]);
  return labels.includes("On") && labels.includes("Off") ? field.edit[labels.indexOf("On")] : undefined;
}

/** The watch's system settings: the ones CorosLink can change, the ones only the watch changes (locked), and recent changes made on the watch. */
export function WatchSystemSettings({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const [settings, setSettings] = useState<WatchSettingsSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [edits, setEdits] = useState<Partial<Record<Key, number>>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const { fields, extended } = useMemo(() => modelFields(settings?.model), [settings?.model]);

  // Read again when the watch connects: the settings are read from it just after connecting.
  const link = useWatchLink(api);
  const connected = link.ready;
  const load = useCallback(() => {
    void api.getWatchSettings().then(value => { if (value) setSettings(value); }).catch(() => undefined).finally(() => setLoaded(true));
  }, [api]);
  useWatchRead(link, settings?.readAt, load);
  // The saved confirmation fades after a moment; errors stay until the next change.
  useEffect(() => {
    if (!message || message.error) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const pending = Object.keys(edits).length;

  const current = useCallback((key: Key): number | undefined => {
    if (!settings) return undefined;
    return extended.has(key) ? settings.ext?.[key as ExtSwitchKey] : settings.values[key as SwitchKey];
  }, [settings, extended]);
  const shown = (key: Key) => edits[key] ?? current(key);

  const change = (key: Key, value: number) => {
    setMessage(null);
    setEdits(previous => {
      const next = { ...previous };
      if (value === current(key)) delete next[key]; else next[key] = value;
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      setSettings(await api.updateWatchSettings(edits as Record<string, number>));
      setEdits({});
      setMessage({ text: t("Saved to your watch.") });
    } catch (error) {
      setMessage({ text: saveError(error, fields), error: true });
    } finally {
      setSaving(false);
    }
  };

  const control = (field: Field) => {
    const value = shown(field.key);
    if (value === undefined) return <span className="watch-setting-value">—</span>;
    if (!field.edit) {
      return <span className="watch-setting-value is-readonly" title={t("Change this on the watch")}>
        <Lock size={12} aria-hidden="true" />{valueText(field, value)}<span className="sr-only"> ({t("Change this on the watch")})</span></span>;
    }
    const on = onValue(field);
    if (on !== undefined) {
      const off = field.edit.find(choice => choice !== on)!;
      const checked = field.values?.[value] === "On";
      return <input type="checkbox" role="switch" className="watch-setting-switch" checked={checked} disabled={saving}
        aria-label={t(LABELS[field.key])} onChange={event => change(field.key, event.target.checked ? on : off)} />;
    }
    if (field.edit.length <= 3) {
      const edit = field.edit;
      const focusable = edit.includes(value) ? value : edit[0];
      return <div className="watch-setting-segments" role="radiogroup" aria-label={t(LABELS[field.key])}
        onKeyDown={event => { if (!saving) segmentKey(event, edit, value, choice => change(field.key, choice)); }}>
        {edit.map(choice => (
          <button key={choice} type="button" role="radio" aria-checked={value === choice} disabled={saving} tabIndex={choice === focusable ? 0 : -1}
            className={value === choice ? "is-selected" : undefined} onClick={() => change(field.key, choice)}>
            {valueText(field, choice)}
          </button>
        ))}
      </div>;
    }
    return <select className="watch-setting-select" value={value} disabled={saving} aria-label={t(LABELS[field.key])}
      onChange={event => change(field.key, Number(event.target.value))}>
      {field.edit.map(choice => <option key={choice} value={choice}>{valueText(field, choice)}</option>)}
    </select>;
  };

  const knownChanges = useMemo(() => (settings?.changes ?? []).filter(change => {
    const field = fields.get(change.field as Key);
    return field?.status === "confirmed" && named(field, change.from) && named(field, change.to);
  }), [settings, fields]);

  return (
    <div className="panel settings-units-panel settings-panel watch-settings">
      <div className="settings-units-heading">
        <span className="settings-units-icon" aria-hidden="true"><SlidersHorizontal size={22} /></span>
        <div>
          <p className="eyebrow">{t("Watch")}</p>
          <h2>{t("Watch settings")}</h2>
          <p>{t("Settings with a lock can only be changed on the watch.")}</p>
        </div>
      </div>

      {!settings ? !loaded ? null : connected ? (
        <p className="watch-panel-empty" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> {t("Reading your watch…")}</p>
      ) : (
        <p className="watch-panel-empty"><Watch size={16} aria-hidden="true" /> {t("Connect your watch from the watch menu to read its settings.")}</p>
      ) : settings.model && !watchSupports("settings", settings.model) ? (
        // The switch layout and meanings were checked only on some models' firmware; nothing is shown or written for others.
        <p className="watch-panel-empty"><Lock size={16} aria-hidden="true" /> {t(NOT_AVAILABLE_ON_WATCH)}</p>
      ) : (
        <>
          <p className="watch-panel-meta">
            {t("Read from your watch on {{value0}}", { value0: formatDate(new Date(settings.readAt), { dateStyle: "medium", timeStyle: "short" }) })}
            {!settings.ext ? <> · {t("connect once more to read display, health and reminder settings")}</> : null}
          </p>

          <div className="watch-settings-groups">
            {GROUPS.map(group => {
              // A field the model doesn't use isn't in its table, so it isn't shown at all.
              const rows = group.keys.flatMap(key => fields.get(key) ?? []).filter(field => shown(field.key) !== undefined && (field.edit || named(field, shown(field.key)!)));
              if (!rows.length) return null;
              return (
                <section key={group.title} className="watch-settings-group" aria-label={t(group.title)}>
                  <h3>{t(group.title)}</h3>
                  {rows.map(field => (
                    <div key={field.key} className={`watch-setting-row${edits[field.key] !== undefined ? " is-changed" : ""}`}>
                      <div className="watch-setting-label">
                        <span>{t(LABELS[field.key])}</span>
                        {HINTS[field.key] ? <small>{t(HINTS[field.key]!)}</small> : null}
                      </div>
                      {control(field)}
                    </div>
                  ))}
                </section>
              );
            })}
          </div>

          {knownChanges.length ? (
            <details className="watch-settings-more">
              <summary><ChevronRight size={14} className="watch-settings-chevron" aria-hidden="true" /><History size={14} aria-hidden="true" /> {t("Recent changes ({{value0}})", { value0: knownChanges.length })}</summary>
              <ul className="watch-settings-changes">
                {knownChanges.slice(0, 15).map(change => {
                  const field = fields.get(change.field as Key)!;
                  return <li key={`${change.at}-${change.field}`}>
                    <span>{t(LABELS[field.key])}</span>
                    <span>{valueText(field, change.from)} → {valueText(field, change.to)}</span>
                    <time>{formatDate(new Date(change.at), { dateStyle: "short", timeStyle: "short" })}</time>
                  </li>;
                })}
              </ul>
            </details>
          ) : null}

          {pending || message ? (
            <div className={`watch-settings-savebar${pending ? " is-dirty" : ""}`}>
              <div className="watch-settings-status" role="status">
                {message ? <span className={message.error ? "settings-error" : "watch-settings-saved"}>
                  {message.error ? <AlertCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{message.text}</span> : null}
                {pending ? <span>{pending === 1 ? t("1 change not saved yet") : t("{{value0}} changes not saved yet", { value0: pending })}
                  {!connected ? <> · {t("connect the watch to save")}</> : null}</span> : null}
              </div>
              {pending ? <div className="watch-settings-actions">
                <button type="button" className="secondary-button" disabled={saving} onClick={() => { setEdits({}); setMessage(null); }}>{t("Discard")}</button>
                <button type="button" className="primary-button" disabled={saving || !connected} onClick={() => void save()}>
                  {saving ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Watch size={15} aria-hidden="true" />}
                  {saving ? t("Saving to watch…") : t("Save to watch")}
                </button>
              </div> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
