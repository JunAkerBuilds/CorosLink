import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { useEffect, useMemo, useRef, useState } from "react";
import { Bluetooth, Check, CircleCheck, Download, Languages, Loader2, Send, TriangleAlert, Watch, X } from "lucide-react";
import type { CorosWatchfaceArchive, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { renderCompiledWatchfacePreview, type CompiledWatchfacePreview } from "./compiledWatchfacePixels";
import { pickWatchPreviewResolution, type WatchfaceComplicationId, type WatchfacePreviewMode } from "./watchfaceStudio";
import { WATCH_LANGUAGE_NAMES, type WatchfaceWatchLanguages } from "./watchfaceLanguages";
import type { CorosDirectWatchfacePreview } from "../../electron/corosBleWatchfaceTypes";
import type { CorosWatchfaceCompilerStatus } from "../../electron/corosWatchfaceCompilerTypes";
import { apiErrorMessage, compileSummary, connectedWatch, useCorosWatchLink, useWatchfaceInstaller, watchBetaNote, watchFaceSyncReady, watchLinkSupported } from "./watchLink";
import { getWatchfaceTarget, watchfaceBinTarget } from "../../electron/watchfaceTargets";
import { CompileWarnings, WatchInstallProgress, WatchSlotPicker, watchInstallResult } from "./WatchInstallParts";
import "./watchLink.css";

/** How long a compiled BIN is reused. Main keeps a prepared BIN for 15 minutes; reusing it after that fails the install. */
const BIN_REUSE_MS = 10 * 60_000;

/**
 * The Send to COROS panel renders archive sprites at 100%. Firmware-drawn
 * controls use samples and can differ on the watch. Changing languages asks
 * the editor to rebuild, which swaps in a new archive.
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
  useLanguage();
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
  const [compiler, setCompiler] = useState<CorosWatchfaceCompilerStatus | null>(null);
  const [compiling, setCompiling] = useState(false);
  /** The last BIN compiled from this dialog, keyed to the archive and name it came from, and reusable until `reusableUntil`. */
  const [bin, setBin] = useState<{ preview: CorosDirectWatchfacePreview; archiveId: string; name: string; reusableUntil: number } | null>(null);
  const [binMessage, setBinMessage] = useState("");
  const [installCompile, setInstallCompile] = useState<{ state: "active" | "done" | "failed"; detail?: string } | null>(null);
  const [installNote, setInstallNote] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const compileActive = useRef(false);
  const currentArchive = useRef(archive.archiveId);
  currentArchive.current = archive.archiveId;
  const { snapshot: link, setSnapshot: setLink, error: linkError } = useCorosWatchLink(api);
  const installReady = watchFaceSyncReady(link);
  const installer = useWatchfaceInstaller(api, installReady);
  const cache = useMemo(() => new Map<string, CorosWatchfaceTemplateAsset>(), [archive.archiveId]);
  const resolution = details.resolutions.find((item) => item.directory === directory) ?? details.resolutions[0]!;
  const supportsAod = Object.keys(resolution.aodConfig ?? {}).length > 0;
  const hasFirmwareChart = mode === "current" && Boolean(resolution.config.chart_rect);

  useEffect(() => {
    let disposed = false;
    if (typeof api.getCorosWatchfaceCompilerStatus === "function") {
      void api.getCorosWatchfaceCompilerStatus().then(status => { if (!disposed) setCompiler(status); }).catch(() => {});
    }
    setBinMessage("");
    return () => { disposed = true; };
  }, [api, archive.archiveId]);

  useEffect(() => {
    let cancelled = false;
    setResult(null); setError("");
    void renderCompiledWatchfacePreview(details, resolution, mode, async (paths) => {
      const missing = [...new Set(paths)].filter((path) => !cache.has(path));
      for (let offset = 0; offset < missing.length; offset += 100) {
        // Absent PNGs come back omitted; the compiled preview lists them.
        const assets = await api.loadCorosWatchfaceTemplateAssets(archive.archiveId, missing.slice(offset, offset + 100), { skipMissing: true });
        for (const asset of assets) cache.set(asset.path, asset);
      }
      return paths.map((path) => cache.get(path)!).filter(Boolean);
    }, {
      complication,
      date: sample === "wide" ? new Date(2026, 7, 28, 20, 58, 58) : new Date(2026, 8, 13, 10, 8, 36),
      ...(sample === "wide" ? { values: { steps: "88888", calories: "88888", elevation: "88888", battery: "100", exercise: "88:58" } } : {})
    }).then((preview) => { if (!cancelled) setResult(preview); })
      .catch((caught) => { if (!cancelled) setError(caught instanceof Error ? caught.message : t("Could not read the compiled preview.")); });
    return () => { cancelled = true; };
  }, [api, archive.archiveId, cache, complication, details, mode, resolution, sample]);

  const busyRef = useRef(false);
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.getElementById("wf-compiled-preview");
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled), input:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); if (!busyRef.current) onClose(); }
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
  // The compiler builds the layout of the watch Studio made this archive for (PACE Pro when unknown).
  const faceTarget = getWatchfaceTarget(archive.firmwareType) ?? getWatchfaceTarget("pace-pro")!;
  const faceBin = watchfaceBinTarget(faceTarget);
  const hasTargetLayout = details.resolutions.some((item) => item.width === faceBin.screen && item.height === faceBin.screen);
  const canCompile = Boolean(result) && !rebuilding && Boolean(trimmedName) && hasTargetLayout &&
    Boolean(compiler?.available) && typeof api.compileCorosWatchfaceArchive === "function";
  const compileBlocker = !hasTargetLayout ? t("This face has no {{value1}} × {{value2}} {{value3}} layout to compile.", { value1: faceBin.screen, value2: faceBin.screen, value3: t(faceTarget.label) })
    : compiler && !compiler.available ? compiler.detail : null;
  // A BIN only fits watches with the same screen; the watch would refuse another.
  const watch = connectedWatch(link);
  const watchMismatch = watch && watchfaceBinTarget(watch).magic !== faceBin.magic
    ? t("This face is built for {{value1}}, but {{value2}} is connected. Convert it for {{value3}} to install it.", { value1: t(faceTarget.label), value2: t(watch.label), value3: t(watch.label) }) : null;
  const betaNote = watchBetaNote(link);

  /** Compiles once per archive and name; Save BIN and Install reuse a recent result. */
  async function compiled(): Promise<CorosDirectWatchfacePreview | null> {
    if (bin && bin.archiveId === archive.archiveId && bin.name === trimmedName && Date.now() < bin.reusableUntil) return bin.preview;
    const archiveId = archive.archiveId, name = trimmedName;
    setCompiling(true);
    try {
      const next = await api.compileCorosWatchfaceArchive({ archiveId, name, firmwareType: faceTarget.firmwareType });
      if (currentArchive.current !== archiveId) throw new Error(t("The face changed while compiling. Compile the updated archive."));
      setBin({ preview: next, archiveId, name, reusableUntil: Date.now() + BIN_REUSE_MS });
      return next;
    } finally { setCompiling(false); }
  }

  async function saveBin() {
    if (compileActive.current || !canCompile) return;
    compileActive.current = true; busyRef.current = true; setBinMessage("");
    try {
      const preview = await compiled();
      if (preview && (await api.saveCorosCompiledWatchface(preview.id)).saved) setBinMessage(t("{{value1}} BIN saved.", { value1: preview.name }));
    } catch (caught) { setBinMessage(apiErrorMessage(caught, t("Could not compile the watch face."))); }
    finally { compileActive.current = false; busyRef.current = false; }
  }

  async function installOnWatch() {
    if (compileActive.current || installer.busy() || !canCompile || !installReady || !installer.target || watchMismatch) return;
    compileActive.current = true; busyRef.current = true; installer.begin();
    setInstallNote(null); setBinMessage(""); installer.resetStatus(); installer.setError(null);
    setInstallCompile({ state: "active" });
    try {
      const preview = await compiled();
      if (!preview) return;
      setInstallCompile({ state: "done" });
      // After a failed install, the next attempt compiles afresh rather than retrying a BIN main may have dropped.
      if (!(await installer.install(preview, true))) setBin(current => current && { ...current, reusableUntil: 0 });
    } catch (caught) {
      setInstallCompile({ state: "failed" });
      setInstallNote(apiErrorMessage(caught, t("Could not compile the watch face.")));
    } finally { compileActive.current = false; busyRef.current = false; installer.end(); }
  }

  async function connectWatch() {
    if (connecting) return;
    setConnecting(true); setInstallNote(null);
    try { setLink(await api.connectCorosNativeBle({ backend: "system" })); }
    catch (caught) { setInstallNote(apiErrorMessage(caught, t("Could not connect the watch."))); }
    finally { setConnecting(false); }
  }

  const installing = Boolean(installCompile?.state === "active") || installer.transferring;
  const busy = compiling || installing;
  const installResult = !installing && installCompile?.state === "done" ? watchInstallResult(installer.status) : null;
  const target = installer.target;
  // With a watch link the footer sends to the watch and Save BIN moves into the install card.
  const watchInstall = watchLinkSupported(link) && typeof api.compileCorosWatchfaceArchive === "function";
  // Hold the footer on Send to watch while the first link status loads, so it doesn't flip from Save BIN.
  const watchFooter = watchInstall || (link === null && !linkError && typeof api.getCorosNativeBleStatus === "function" &&
    typeof api.compileCorosWatchfaceArchive === "function");
  const installHint = compileBlocker ?? (!link?.connected ? t("Connect your watch to send this face")
    : !installReady ? t("Installing needs an authenticated COROS watch that CorosLink supports")
    : watchMismatch ? watchMismatch
    : installer.reading ? t("Reading watch face slots…")
    : !target ? t("Choose a slot on the watch")
    : target.faceId === null ? t("Install in empty slot {{value1}}", { value1: target.slot + 1 }) : t("Replace face ID {{value1}} in slot {{value2}}", { value1: target.faceId, value2: target.slot + 1 }));
  const saveBinTitle = compileBlocker ?? t("Compile this face to a {{value1}} BIN and save it", { value1: t(faceTarget.label) });
  const linkLabel = !link ? "" : link.phase === "connecting" || connecting ? "Connecting…"
    : link.phase === "scanning" ? t("Finding watch…")
    : link.connected ? `${link.deviceName ?? "COROS watch"}${installReady ? (betaNote ? " · beta" : "") : link.systemBind === "authenticated" ? " · unsupported watch" : " · not authenticated"}`
    : t("Watch not connected");
  const linkTone = !link?.connected ? (connecting || link?.phase === "connecting" ? "busy" : "off") : installReady && !watchMismatch ? "ok" : "warn";
  const designed = customWeekday ? t("your weekday labels") : t("the weekday as designed");
  const languageNote = languageMode === "all"
    ? t("Every language shows {{designed}}.", { designed: designed })
    : languageMode === "english"
      ? t("Other languages keep the template's translated weekday.")
      : t("Tap a language to give it {{designed}}; the rest keep their translations.", { designed: designed });

  return <div className="wf-modal-backdrop" role="presentation">
    <section id="wf-compiled-preview" className="wf-modal wf-send-panel" role="dialog" aria-modal="true" aria-labelledby="wf-send-title" aria-busy={rebuilding || busy}>
      <header className="wf-send-header">
        <div>
          <h2 id="wf-send-title">{t("Send to COROS")}</h2>
          <p>{t("Archive artwork with sample live readings. Firmware-drawn charts may differ on your watch.")}</p>
        </div>
        <button type="button" className="wf-send-dismiss" aria-label={t("Close")} title={t("Close")} disabled={busy} onClick={onClose}><X size={16} /></button>
      </header>

      <div className="wf-send-body">
        <div className="wf-send-stage">
          <div className="wf-send-toolbar">
            <select aria-label={t("Resolution")} value={directory} onChange={(event) => {
              setDirectory(event.target.value);
              if (!Object.keys(details.resolutions.find((item) => item.directory === event.target.value)?.aodConfig ?? {}).length) setMode("current");
            }}>
              {details.resolutions.map((item) => <option key={item.directory} value={item.directory}>{item.width} × {item.height}</option>)}
            </select>
            <Segmented label={t("Display")} value={mode} onChange={(value) => setMode(value as WatchfacePreviewMode)} options={[
              ["current", "Current"], ["aod", "Always-on", !supportsAod]]} />
            <Segmented label={t("Sample values")} value={sample} onChange={setSample} options={[
              ["normal", "10:08"], ["wide", "20:58 · wide"]]} />
          </div>
          <div className="wf-send-canvas">
            {error ? <p className="wf-send-status is-error" role="alert">{t(error)}</p>
              : !result || rebuilding ? <p className="wf-send-status" role="status"><Loader2 className="spin" size={16} />{rebuilding ? t("Rebuilding with the new languages…") : t("Reading compiled pixels…")}</p>
                : <div className="wf-export-pixel-scroll"><img src={result.dataUrl} width={result.width} height={result.height} alt={t("Compiled {{value1}} watch face at {{value2}} × {{value3}} pixels", { value1: mode === "aod" ? "always-on" : "Current", value2: result.width, value3: result.height })} /></div>}
          </div>
          <p className="wf-send-caption">{resolution.width} × {resolution.height}{" "}{t("· shown at 1:1, one image pixel per screen pixel")}</p>
          {hasFirmwareChart ? <p className="wf-send-caption" role="note">{t("Chart lines and bars are drawn by the watch after this preview. Install on watch keeps their colors. Sent through the COROS app, they are packed to 6 bits and PACE Pro draws them dark blue.")}</p> : null}
        </div>

        <aside className="wf-send-side" aria-label={t("Send settings")}>
          <label className="wf-send-card wf-send-name">
            <span>{t("Watch face name")}</span>
            <input value={sendName} maxLength={80} spellCheck={false} placeholder={name}
              onChange={(event) => setSendName(event.target.value)} />
            <small>{t("Shown in the COROS app and on your watch.")}</small>
          </label>
          {watchInstall ? <section className="wf-send-card wf-send-install" aria-labelledby="wf-send-install-title" aria-busy={installing || undefined}>
            <div className="wf-send-install-head">
              <h3 id="wf-send-install-title"><Watch size={15} aria-hidden="true" />{t("Install on watch")}</h3>
              <button type="button" className="watch-link-icon-button" aria-label={t("Save BIN")} title={saveBinTitle}
                disabled={!canCompile || busy} onClick={() => void saveBin()}>
                {compiling && !installing ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
              </button>
            </div>
            <div className="wf-send-install-link">
              <span className={`watch-link-state is-${linkTone}`} role="status" title={t(linkLabel)}>{t(linkLabel)}</span>
              {!link?.connected ? <button type="button" className="secondary-button watch-link-button" disabled={connecting || link?.phase === "connecting" || busy}
                onClick={() => void connectWatch()}>
                {connecting ? <Loader2 className="spin" size={14} aria-hidden="true" /> : <Bluetooth size={14} aria-hidden="true" />}{" "}{t("Connect")}</button> : null}
            </div>
            {installer.inventory ? <WatchSlotPicker installer={installer} compact disabled={busy || installer.reading} />
              : <p>{!link?.connected ? t("Connect your {{value1}} to choose a slot. To pair a new watch, use the watch menu in the toolbar.", { value1: t(faceTarget.label) })
                : !installReady ? t("Installing needs an authenticated COROS watch that CorosLink supports.")
                : installer.reading ? t("Reading watch face slots…") : t("Couldn't read the watch face slots.")}</p>}
            {installing || installResult || installCompile?.state === "failed"
              ? <WatchInstallProgress status={installer.status} compile={installCompile ?? undefined} />
              : installer.inventory ? <p>{!target ? t("Every slot is in use. Select the face to replace.")
                : target.faceId === null ? t("Installs into empty slot {{value1}}.", { value1: target.slot + 1 })
                : t("Replaces face ID {{value1}} in slot {{value2}}.", { value1: target.faceId, value2: target.slot + 1 })}</p> : null}
            {installer.transferring ? <div className="wf-send-install-actions">
              <button type="button" className="secondary-button watch-link-button" onClick={installer.cancel}>{t("Cancel install")}</button>
            </div> : null}
            {watchMismatch ? <p className="watch-link-note is-error" role="alert">{watchMismatch}</p> : null}
            {betaNote && !watchMismatch ? <p className="watch-link-note" role="note">{betaNote}</p> : null}
            {bin?.archiveId === archive.archiveId ? <CompileWarnings warnings={bin.preview.compile?.warnings} /> : null}
            {installResult ? <p className="watch-link-note is-success" role="status">{installResult}</p> : null}
            {installNote || installer.error ? <p className="watch-link-note is-error" role="alert">{installNote ?? installer.error}</p> : null}
            {compileBlocker ? <small>{compileBlocker}</small> : <small>{bin?.archiveId === archive.archiveId && bin.preview.compile ? t("{{value1}}. ", { value1: compileSummary(bin.preview) })
              : t("Compiles on this computer. ")}{t("Sends over Bluetooth. Experimental.")}</small>}
          </section> : null}
          <fieldset className="wf-send-card wf-send-languages" disabled={rebuilding}>
            <legend><Languages size={15} aria-hidden="true" />{t("Watch languages")}</legend>
            <div className="wf-send-segmented is-full" role="radiogroup" aria-label={t("Weekday languages")}>
              {([["all", "All"], ["english", "English"], ["selected", "Choose"]] as const).map(([value, label]) =>
                <button key={value} type="button" role="radio" aria-checked={languageMode === value}
                  onClick={() => onLanguagesChange(value === "selected" ? selectedLanguages : value)}>{t(label)}</button>)}
            </div>
            <p>{languageNote}</p>
            <ul className="wf-send-language-chips" aria-label={t("Languages in this watch face")}>
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
            <small>{t("Month and day numbers reach every language automatically.")}{customWeekday ? t(" Your choice is remembered for future sends.") : ""}</small>
          </fieldset>

          <section className={`wf-send-card wf-export-pixel-checks${checks.length || error ? " has-checks" : ""}`} aria-live="polite">
            <h3>{error ? <TriangleAlert size={15} aria-hidden="true" />
              : !result || rebuilding ? <Loader2 className="spin" size={15} aria-hidden="true" />
                : checks.length ? <TriangleAlert size={15} aria-hidden="true" /> : <CircleCheck size={15} aria-hidden="true" />}
              {error ? t("Pixel checks unavailable") : !result || rebuilding ? t("Checking pixels")
                : checks.length ? t("{{value1}} {{value2}} to review", { value1: checks.length, value2: checks.length === 1 ? "check" : "checks" }) : t("No clipping or overlaps")}</h3>
            {checks.length > 0 ? <ul>{checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}
            <small>{t("Covers live sprites and value boxes. Artwork baked into the background, and firmware-drawn controls, are worth a visual check.")}{mode === "aod" && supportsAod ? t(" Always-on brightness and thin strokes may look different on the watch.") : ""}</small>
          </section>
        </aside>
      </div>

      {binMessage ? <p className="wf-send-caption" role="status">{binMessage}</p> : null}
      <div className="wf-modal-actions wf-send-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={onClose}>{t("Close")}</button>
        {watchFooter ? <button type="button" className={`secondary-button wf-send-watch${installing ? " is-busy" : ""}`}
          disabled={!canCompile || !installReady || !target || busy || installer.reading || Boolean(watchMismatch)} title={installHint}
          onClick={() => void installOnWatch()}>
          {installing ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Watch size={15} aria-hidden="true" />}
          {installing ? (installCompile?.state === "active" ? t("Compiling…") : t("Installing…")) : t("Send to watch")}
        </button>
          : typeof api.compileCorosWatchfaceArchive === "function" ? <button type="button" className="secondary-button" disabled={!canCompile || busy}
            title={saveBinTitle} onClick={() => void saveBin()}>
            {compiling && !installing ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}{" "}{t("Save BIN")}</button> : null}
        <button type="button" className="primary-button" disabled={!result || rebuilding || busy || !trimmedName} onClick={() => { onClose(); onPublish(archive, trimmedName); }}>
          <Send size={15} aria-hidden="true" />{t("Send to COROS")}</button>
      </div>
    </section>
  </div>;
}

function languageName(language: string): string {
  return t(language === "english" ? "English" : WATCH_LANGUAGE_NAMES[language] ?? language);
}

/** A compact radio group styled as a segmented control. */
function Segmented({ label, value, options, onChange }: {
  label: string;
  value: string;
  options: Array<readonly [value: string, label: string, disabled?: boolean]>;
  onChange: (value: string) => void;
}) {
  useLanguage();
  return <div className="wf-send-segmented" role="radiogroup" aria-label={t(label)}>
    {options.map(([option, text, disabled]) => <button key={option} type="button" role="radio" aria-checked={value === option}
      disabled={disabled} title={disabled ? t("{{text}} isn't available for this resolution", { text: t(text) }) : undefined}
      onClick={() => onChange(option)}>{t(text)}</button>)}
  </div>;
}
