import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, Languages, Loader2, Send, TriangleAlert, X } from "lucide-react";
import type { CorosWatchfaceArchive, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { renderCompiledWatchfacePreview, type CompiledWatchfacePreview } from "./compiledWatchfacePixels";
import { pickWatchPreviewResolution, type WatchfaceComplicationId, type WatchfacePreviewMode } from "./watchfaceStudio";
import { WATCH_LANGUAGE_NAMES, type WatchfaceWatchLanguages } from "./watchfaceLanguages";

/**
 * The Send to COROS panel: the compiled archive at 100% and the watch-language
 * choice baked into it, sent as-is. Changing languages asks the editor to
 * rebuild, which swaps in a new archive.
 */
export function WatchfaceExportPreview({ api, archive, details, name, complication, languages, customWeekday, rebuilding,
  onLanguagesChange, onClose, onPublish }: {
  api: CorosLinkApi;
  archive: CorosWatchfaceArchive;
  details: CorosWatchfaceTemplateDetails;
  name: string;
  complication?: WatchfaceComplicationId;
  languages: WatchfaceWatchLanguages;
  /** Whether the design replaces the weekday labels; otherwise every language keeps its own. */
  customWeekday: boolean;
  rebuilding: boolean;
  onLanguagesChange: (languages: WatchfaceWatchLanguages) => void;
  onClose: () => void;
  onPublish: (archive: CorosWatchfaceArchive, name: string) => void;
}) {
  const availableLanguages = useMemo(() => [...new Set(details.resolutions.flatMap((item) =>
    Object.keys(item.config)
      .filter((key) => key.endsWith("_date_week_font") && !key.startsWith("control_"))
      .map((key) => key.replace(/_date_week_font$/, ""))))]
    .filter((language) => language !== "english")
    .sort((left, right) => languageName(left).localeCompare(languageName(right))), [details]);
  const languageMode = Array.isArray(languages) ? "selected" : languages;
  const selectedLanguages = Array.isArray(languages) ? languages : [];
  const customLabelLanguages = (language: string) => language === "english" || languageMode === "all" ||
    selectedLanguages.includes(language);
  const [directory, setDirectory] = useState(() =>
    pickWatchPreviewResolution(details, archive.firmwareType)?.directory ?? details.resolutions[0]!.directory);
  const [mode, setMode] = useState<WatchfacePreviewMode>("current");
  const [sample, setSample] = useState("normal");
  const [result, setResult] = useState<CompiledWatchfacePreview | null>(null);
  const [error, setError] = useState("");
  const cache = useMemo(() => new Map<string, CorosWatchfaceTemplateAsset>(), [archive.archiveId]);
  const resolution = details.resolutions.find((item) => item.directory === directory)!;
  const supportsAod = Object.keys(resolution.aodConfig ?? {}).length > 0;

  useEffect(() => {
    let cancelled = false;
    setResult(null); setError("");
    void renderCompiledWatchfacePreview(details, resolution, mode, async (paths) => {
      const missing = [...new Set(paths)].filter((path) => !cache.has(path));
      for (let offset = 0; offset < missing.length; offset += 100) {
        const assets = await api.loadCorosWatchfaceTemplateAssets(archive.archiveId, missing.slice(offset, offset + 100));
        for (const asset of assets) cache.set(asset.path, asset);
      }
      return paths.map((path) => cache.get(path)!).filter(Boolean);
    }, {
      complication,
      date: sample === "wide" ? new Date(2026, 7, 28, 20, 58, 58) : new Date(2026, 8, 13, 10, 8, 36),
      ...(sample === "wide" ? { values: { steps: "88888", calories: "88888", elevation: "88888", battery: "100", exercise: "88:58" } } : {})
    }).then((preview) => { if (!cancelled) setResult(preview); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not read the compiled preview."); });
    return () => { cancelled = true; };
  }, [api, archive.archiveId, cache, complication, details, mode, resolution, sample]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.getElementById("wf-compiled-preview");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previousFocus?.focus(); };
  }, [onClose]);

  const checks = result?.checks ?? [];
  const [sendName, setSendName] = useState(name);
  const trimmedName = sendName.trim();
  const designed = customWeekday ? "your weekday labels" : "the weekday as designed";
  const languageNote = languageMode === "all"
    ? `Every language shows ${designed}.`
    : languageMode === "english"
      ? "Other languages keep the template's translated weekday."
      : `Tap a language to give it ${designed}; the rest keep their translations.`;

  return <div className="wf-modal-backdrop" role="presentation">
    <section id="wf-compiled-preview" className="wf-modal wf-send-panel" role="dialog" aria-modal="true" aria-labelledby="wf-send-title" aria-busy={rebuilding}>
      <header className="wf-send-header">
        <div>
          <h2 id="wf-send-title">Send to COROS</h2>
          <p>The exact build your watch receives.</p>
        </div>
        <button type="button" className="wf-send-dismiss" aria-label="Close" title="Close" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="wf-send-body">
        <div className="wf-send-stage">
          <div className="wf-send-toolbar">
            <select aria-label="Resolution" value={directory} onChange={(event) => {
              setDirectory(event.target.value);
              if (!Object.keys(details.resolutions.find((item) => item.directory === event.target.value)?.aodConfig ?? {}).length) setMode("current");
            }}>
              {details.resolutions.map((item) => <option key={item.directory} value={item.directory}>{item.width} × {item.height}</option>)}
            </select>
            <Segmented label="Display" value={mode} onChange={(value) => setMode(value as WatchfacePreviewMode)} options={[
              ["current", "Current"], ["aod", "Always-on", !supportsAod]]} />
            <Segmented label="Sample values" value={sample} onChange={setSample} options={[
              ["normal", "10:08"], ["wide", "20:58 · wide"]]} />
          </div>
          <div className="wf-send-canvas">
            {error ? <p className="wf-send-status is-error" role="alert">{error}</p>
              : !result || rebuilding ? <p className="wf-send-status" role="status"><Loader2 className="spin" size={16} />{rebuilding ? "Rebuilding with the new languages…" : "Reading compiled pixels…"}</p>
                : <div className="wf-export-pixel-scroll"><img src={result.dataUrl} width={result.width} height={result.height} alt={`Compiled ${mode === "aod" ? "always-on" : "Current"} watch face at ${result.width} × ${result.height} pixels`} /></div>}
          </div>
          <p className="wf-send-caption">{resolution.width} × {resolution.height} · shown at 1:1, one image pixel per screen pixel</p>
        </div>

        <aside className="wf-send-side" aria-label="Send settings">
          <label className="wf-send-card wf-send-name">
            <span>Watch face name</span>
            <input value={sendName} maxLength={80} spellCheck={false} placeholder={name}
              onChange={(event) => setSendName(event.target.value)} />
            <small>Shown in the COROS app and on your watch.</small>
          </label>
          <fieldset className="wf-send-card wf-send-languages" disabled={rebuilding}>
            <legend><Languages size={15} aria-hidden="true" />Watch languages</legend>
            <div className="wf-send-segmented is-full" role="radiogroup" aria-label="Weekday languages">
              {([["all", "All"], ["english", "English"], ["selected", "Choose"]] as const).map(([value, label]) =>
                <button key={value} type="button" role="radio" aria-checked={languageMode === value}
                  onClick={() => onLanguagesChange(value === "selected" ? selectedLanguages : value)}>{label}</button>)}
            </div>
            <p>{languageNote}</p>
            <ul className="wf-send-language-chips" aria-label="Languages in this watch face">
              {["english", ...availableLanguages].map((language) => {
                const custom = customLabelLanguages(language);
                const toggleable = languageMode === "selected" && language !== "english";
                return <li key={language}>{toggleable
                  ? <button type="button" aria-pressed={custom} className={custom ? "is-on" : ""} onClick={() => onLanguagesChange(custom
                    ? selectedLanguages.filter((value) => value !== language)
                    : [...selectedLanguages, language])}>{custom ? <Check size={12} aria-hidden="true" /> : null}{languageName(language)}</button>
                  : <span className={custom ? "is-on" : ""}>{custom ? <Check size={12} aria-hidden="true" /> : null}{languageName(language)}</span>}</li>;
              })}
            </ul>
            <small>Month and day numbers reach every language automatically.{customWeekday ? " Your choice is remembered for future sends." : ""}</small>
          </fieldset>

          <section className={`wf-send-card wf-export-pixel-checks${checks.length || error ? " has-checks" : ""}`} aria-live="polite">
            <h3>{error ? <TriangleAlert size={15} aria-hidden="true" />
              : !result || rebuilding ? <Loader2 className="spin" size={15} aria-hidden="true" />
                : checks.length ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
              {error ? "Pixel checks unavailable" : !result || rebuilding ? "Checking pixels"
                : checks.length ? `${checks.length} ${checks.length === 1 ? "check" : "checks"} to review` : "No clipping or overlaps"}</h3>
            {checks.length > 0 ? <ul>{checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}
            <small>Covers live sprites and value boxes. Artwork baked into the background, and firmware-drawn controls, are worth a visual check.
              {mode === "aod" && supportsAod ? " Always-on brightness and thin strokes may look different on the watch." : ""}</small>
          </section>
        </aside>
      </div>

      <div className="wf-modal-actions wf-send-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        <button type="button" className="primary-button" disabled={!result || rebuilding || !trimmedName} onClick={() => { onClose(); onPublish(archive, trimmedName); }}>
          <Send size={15} aria-hidden="true" />Send to COROS
        </button>
      </div>
    </section>
  </div>;
}

function languageName(language: string): string {
  return language === "english" ? "English" : WATCH_LANGUAGE_NAMES[language] ?? language;
}

/** A compact radio group styled as a segmented control. */
function Segmented({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<readonly [value: string, label: string, disabled?: boolean]>;
  onChange: (value: string) => void;
}) {
  return <div className="wf-send-segmented" role="radiogroup" aria-label={label}>
    {options.map(([option, text, disabled]) => <button key={option} type="button" role="radio" aria-checked={value === option}
      disabled={disabled} title={disabled ? `${text} isn't available for this resolution` : undefined}
      onClick={() => onChange(option)}>{text}</button>)}
  </div>;
}
