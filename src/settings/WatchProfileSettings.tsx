import { AlertCircle, Check, HeartPulse, Loader2, Lock, Watch } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatDate, t, useLanguage } from "../i18n";
import type { CorosLinkApi } from "../coroslink-api";
import { ipcErrorText } from "../ipcErrorText";
import type { WatchProfileSummary } from "../../electron/watchProfileService";
import { useUnitSystem } from "../units/UnitSystemProvider";
import { HEART_RATE_ZONE_COLORS } from "../chat/charts/zoneChartConfig";
import { NOT_AVAILABLE_ON_WATCH, watchSupports } from "../../electron/localSync/watchSyncModels";
import { moveHeartRateZones } from "../../electron/watchProfileZones";
import { useWatchLink, useWatchRead } from "./useWatchLink";
import "./settingsPanel.css";
import "./watchSystemSettings.css";

const MILE_KM = 1.609344;
const ZONE_TYPES = [
  { value: 1, label: "% of max heart rate" },
  { value: 2, label: "Heart-rate reserve" },
  { value: 3, label: "Threshold heart rate" }
] as const;

// The ranges the watch accepts (electron/corosWatchProfile.ts editWatchProfile).
const LIMITS = { maxHr: [100, 240], restingHr: [25, 120], thresholdHr: [80, 230] } as const;
const PACE_LIMITS = [120, 900] as const;
type HrKey = keyof typeof LIMITS;

const formatPace = (secondsPerKm: number, imperial: boolean) => {
  const seconds = Math.round(imperial ? secondsPerKm * MILE_KM : secondsPerKm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};
const parsePace = (text: string, imperial: boolean): number | undefined => {
  const match = /^(\d{1,2}):([0-5]\d)$/.exec(text.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return Math.round(imperial ? seconds / MILE_KM : seconds);
};

/**
 * The training profile the watch keeps (thresholds and zones), read from the
 * watch on each connection and written back on request. Workouts built on this
 * computer use the same zones.
 */
export function WatchProfileSettings({ api }: { api: CorosLinkApi }) {
  useLanguage();
  const { unitSystem } = useUnitSystem();
  const imperial = unitSystem === "imperial";
  const [profile, setProfile] = useState<WatchProfileSummary | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [draft, setDraft] = useState({ maxHr: "", restingHr: "", thresholdHr: "", hrZoneType: 3, pace: "" });
  const [busy, setBusy] = useState(false);
  const link = useWatchLink(api);
  const connected = link.ready;
  // Unsaved edits survive a re-read; only an untouched form follows the watch.
  const dirtyRef = useRef(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; field?: HrKey | "pace" } | null>(null);

  const fromProfile = useCallback((value: WatchProfileSummary) => ({ maxHr: String(value.maxHr), restingHr: String(value.restingHr), thresholdHr: String(value.thresholdHr),
    hrZoneType: value.hrZoneType || 3, pace: formatPace(value.thresholdPaceSecondsPerKm, imperial) }), [imperial]);

  // Read again when the watch connects: the profile is read from it just after connecting.
  const load = useCallback(() => {
    void api.getWatchProfile().catch(() => null).then(value => {
      if (value) {
        setProfile(value);
        if (!dirtyRef.current) setDraft(fromProfile(value));
      }
      setLoaded(true);
    });
  }, [api, fromProfile]);
  useWatchRead(link, profile?.readAt, load);

  // "Saved" shows for a moment, as in Watch settings; an error stays until the next edit.
  useEffect(() => {
    if (!message || message.error) return;
    const timer = setTimeout(() => setMessage(null), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const saved = profile ? fromProfile(profile) : null;
  const dirty = Boolean(saved && (Object.keys(saved) as Array<keyof typeof saved>).some(key => String(saved[key]) !== String(draft[key]).trim()));
  dirtyRef.current = dirty;

  const edit = (next: Partial<typeof draft>) => { setDraft({ ...draft, ...next }); setMessage(null); };

  const hr = (key: HrKey) => {
    const value = Number(draft[key]);
    return draft[key].trim() !== "" && Number.isInteger(value) && value >= LIMITS[key][0] && value <= LIMITS[key][1] ? value : undefined;
  };

  const save = async () => {
    for (const [key, label] of [["maxHr", t("Max heart rate")], ["restingHr", t("Resting heart rate")], ["thresholdHr", t("Threshold heart rate")]] as const) {
      if (hr(key) === undefined) {
        setMessage({ text: t("{{value0}}: enter a whole number from {{value1}} to {{value2}} bpm.", { value0: label, value1: LIMITS[key][0], value2: LIMITS[key][1] }), error: true, field: key });
        return;
      }
    }
    if (!(hr("restingHr")! < hr("thresholdHr")! && hr("thresholdHr")! < hr("maxHr")!)) {
      setMessage({ text: t("Resting, threshold and max heart rate must increase in that order."), error: true, field: "thresholdHr" });
      return;
    }
    const pace = parsePace(draft.pace, imperial);
    if (pace === undefined) { setMessage({ text: t("Enter the threshold pace as minutes:seconds, for example 4:45."), error: true, field: "pace" }); return; }
    if (pace < PACE_LIMITS[0] || pace > PACE_LIMITS[1]) {
      setMessage({ text: t("Enter a threshold pace from {{value0}} to {{value1}}.", { value0: formatPace(PACE_LIMITS[0], imperial), value1: formatPace(PACE_LIMITS[1], imperial) }), error: true, field: "pace" });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const next = await api.updateWatchProfile({
        maxHr: hr("maxHr"), restingHr: hr("restingHr"), thresholdHr: hr("thresholdHr"), hrZoneType: draft.hrZoneType, thresholdPaceSecondsPerKm: pace
      });
      setProfile(next);
      setDraft(fromProfile(next));
      setMessage({ text: t("Saved to your watch. Zones were updated to match.") });
    } catch (error) {
      setMessage({ text: t(ipcErrorText(error)), error: true });
    } finally {
      setBusy(false);
    }
  };

  // The zones for the chosen basis; while the thresholds are being edited, where the watch will move them.
  const zoneSet = draft.hrZoneType === 1 ? "maxHrZones" : draft.hrZoneType === 2 ? "reserveHrZones" : "thresholdHrZones";
  const zones = profile ? moveHeartRateZones(profile, {
    maxHr: hr("maxHr") ?? profile.maxHr, restingHr: hr("restingHr") ?? profile.restingHr, thresholdHr: hr("thresholdHr") ?? profile.thresholdHr
  })[zoneSet] : [];
  const savedZones = profile ? profile[zoneSet] : [];
  const preview = zones.some((value, index) => value !== savedZones[index]);

  const field = (key: HrKey, label: string) => (
    <label className="settings-field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min={LIMITS[key][0]} max={LIMITS[key][1]} step={1} value={draft[key]} disabled={busy}
        aria-invalid={message?.field === key || undefined} onChange={event => edit({ [key]: event.target.value })} />
    </label>
  );

  return (
    <div className="panel settings-units-panel settings-panel">
      <div className="settings-units-heading">
        <span className="settings-units-icon" aria-hidden="true"><HeartPulse size={22} /></span>
        <div>
          <p className="eyebrow">{t("Watch")}</p>
          <h2>{t("Training profile")}</h2>
          <p>{t("Heart-rate and pace thresholds and zones your watch uses for workouts and training load.")}</p>
        </div>
      </div>
      {!profile ? !loaded ? null : connected ? (
        <p className="watch-panel-empty" role="status"><Loader2 size={16} className="spin" aria-hidden="true" /> {t("Reading your watch…")}</p>
      ) : (
        <p className="watch-panel-empty"><Watch size={16} aria-hidden="true" /> {t("Connect your watch from the watch menu to read its profile.")}</p>
      ) : profile.model && !watchSupports("profile", profile.model) ? (
        <p className="watch-panel-empty"><Lock size={16} aria-hidden="true" /> {t(NOT_AVAILABLE_ON_WATCH)}</p>
      ) : (
        <>
          <p className="watch-panel-meta">{t("Read from your watch on {{value0}}", { value0: formatDate(new Date(profile.readAt), { dateStyle: "medium", timeStyle: "short" }) })}</p>
          <div className="settings-fields">
            {field("maxHr", t("Max heart rate (bpm)"))}
            {field("restingHr", t("Resting heart rate (bpm)"))}
            {field("thresholdHr", t("Threshold heart rate (bpm)"))}
            <label className="settings-field">
              <span>{imperial ? t("Threshold pace (min/mi)") : t("Threshold pace (min/km)")}</span>
              <input type="text" inputMode="numeric" value={draft.pace} disabled={busy} placeholder="4:45" aria-invalid={message?.field === "pace" || undefined}
                onChange={event => edit({ pace: event.target.value })} />
            </label>
          </div>
          <div className="watch-zones-head">
            <h3>{t("Heart-rate zones")}{preview ? <small>{t("Preview until saved")}</small> : null}</h3>
            <label className="settings-field">
              <span>{t("Based on")}</span>
              <select value={draft.hrZoneType} disabled={busy} onChange={event => edit({ hrZoneType: Number(event.target.value) })}>
                {ZONE_TYPES.map(option => <option key={option.value} value={option.value}>{t(option.label)}</option>)}
              </select>
            </label>
          </div>
          <dl className="watch-zones">
            {zones.map((low, index) => (
              <div key={index} style={{ "--zone": HEART_RATE_ZONE_COLORS[index] } as React.CSSProperties}>
                <dt>{t("Zone {{value0}}", { value0: index + 1 })}</dt>
                <dd>{index + 1 < zones.length ? t("{{value0}}–{{value1}} bpm", { value0: low, value1: zones[index + 1]! - 1 }) : t("{{value0}}+ bpm", { value0: low })}</dd>
              </div>
            ))}
          </dl>
          {/* The same save bar as Watch settings: there while something is unsaved, and for a moment after saving. */}
          {dirty || message ? (
            <div className={`watch-settings-savebar${dirty ? " is-dirty" : ""}`}>
              <div className="watch-settings-status" role={message?.error ? "alert" : "status"}>
                {message ? <span className={message.error ? "settings-error" : "watch-settings-saved"}>
                  {message.error ? <AlertCircle size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}{message.text}</span> : null}
                {dirty && !connected && !message ? <span>{t("Connect the watch to save these changes.")}</span> : null}
              </div>
              {dirty ? <div className="watch-settings-actions">
                <button type="button" className="secondary-button" disabled={busy} onClick={() => { if (profile) setDraft(fromProfile(profile)); setMessage(null); }}>{t("Discard")}</button>
                <button type="button" className="primary-button" disabled={busy || !connected} onClick={() => void save()}>
                  {busy ? <Loader2 size={15} className="spin" aria-hidden="true" /> : <Watch size={15} aria-hidden="true" />}
                  {busy ? t("Saving to watch…") : t("Save to watch")}
                </button>
              </div> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
