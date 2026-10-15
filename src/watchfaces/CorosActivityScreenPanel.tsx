import { localizedText, renderLocalizedText, type LocalizableText, t, useLanguage, getLocale } from "../i18n/watchfaces";
import { useEffect, useRef, useState } from "react";
import { Check, Download, Loader2, RefreshCw, RotateCcw, Save, Send } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import type { CorosActivityScreenBackup, CorosActivityScreenDocument, CorosActivityScreenPage,
  CorosActivityScreenPreview, CorosActivityScreenSport, CorosActivityScreenStatus } from "../../electron/corosActivityScreenTypes";
import { apiErrorMessage, connectedWatch, watchFaceSyncReady } from "./watchLink";
import "./activityScreens.css";

function PageDiagram({ page }: { page: CorosActivityScreenPage }) {
  useLanguage();
  let index = 0;
  const rows = page.columns.map((columns, row) => {
    const fields = page.fields.slice(index, index + columns); index += columns;
    return <div key={row} className="activity-dial-row" style={{ flexGrow: fields[0]?.height ?? 1 }}>
      {fields.map((field, col) => <span key={col}><strong>#{field.metricId}</strong><small>{t("Saved metric")}</small></span>)}
    </div>;
  });
  return <div className="activity-page-dial" aria-label={page.fieldCount ? t("{{p0}} fields in {{p1}} rows plus the bottom field", { p0: String(page.fieldCount), p1: String(page.rows) }) : t("Preserved special page")}>
    {page.kind === "grid" ? rows : <span className="activity-special-page">{page.kind === "special" ? t("Special page") : t("Unknown layout")}<small>{t("Preserved unchanged")}</small></span>}
    <div className="activity-dial-base"><strong>#{page.baseMetricId}</strong><small>{t("Bottom metric")}</small></div>
  </div>;
}

export function CorosActivityScreenPanel({ api, snapshot, disabled, onBusy }: {
  api: CorosLinkApi; snapshot: CorosNativeBleSnapshot | null; disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  useLanguage();
  const [sports, setSports] = useState<CorosActivityScreenSport[]>([]);
  const [sportId, setSportId] = useState(0);
  const [document, setDocument] = useState<CorosActivityScreenDocument | null>(null);
  const [backups, setBackups] = useState<CorosActivityScreenBackup[]>([]);
  const [status, setStatus] = useState<CorosActivityScreenStatus | null>(null);
  const [backupId, setBackupId] = useState("");
  const [baselineBackup, setBaselineBackup] = useState<CorosActivityScreenBackup | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [fieldCount, setFieldCount] = useState(4);
  const [preview, setPreview] = useState<CorosActivityScreenPreview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ error: boolean; text: LocalizableText } | null>(null);
  const working = useRef(false), mounted = useRef(true);
  const available = [api.readCorosActivityScreens, api.listCorosActivityScreenSports, api.syncCorosActivityScreenBaseline,
    api.getCorosActivityScreenStatus, api.getCorosActivityScreenBackups, api.backupCorosActivityScreens,
    api.confirmCorosActivityScreenBaseline, api.previewCorosActivityScreenLayout, api.applyCorosActivityScreenLayout,
    api.restoreCorosActivityScreens, api.exportCorosActivityScreenBackup].every(method => typeof method === "function");
  const ready = watchFaceSyncReady(snapshot) && connectedWatch(snapshot)?.model === "pace-pro";
  const locked = disabled || busy !== null;
  const hasPendingRestore = Boolean(status?.pendingRestore);
  const selected = document?.pages[pageIndex];
  const verified = document?.baseline !== "unverified" && Boolean(document);
  const confirmed = document?.baseline === "watch-confirmed";
  const hasExperimentalPages = document?.pages.some(page => page.kind === "grid" && ![2, 3, 4, 6, 8].includes(page.fieldCount!)) ?? false;
  // Legacy main processes supported five/seven but cannot hot-reload the new nine-field codec.
  const supportedCounts = status?.supportedFieldCounts ?? [2, 3, 4, 5, 6, 7, 8];
  const supportsSelectedLayout = supportedCounts.includes(fieldCount);
  const supportsNine = supportedCounts.includes(9);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setDocument(null); setPreview(null); setBaselineBackup(null); setPageIndex(0); setSports([]); setNote(null);
  }, [snapshot?.deviceId, snapshot?.authenticatedAt, snapshot?.connected]);
  useEffect(() => {
    if (!available) return;
    let disposed = false;
    void Promise.all([api.getCorosActivityScreenBackups!(), api.getCorosActivityScreenStatus!()]).then(([saved, next]) => {
      if (!disposed) { setBackups(saved); setStatus(next); }
    }).catch(error => { if (!disposed) setNote({ error: true, text: localizedText(() => apiErrorMessage(error, "Could not read saved activity-page backups.")) }); });
    return () => { disposed = true; };
  }, [api, available]);

  async function refreshSaved() {
    const [saved, next] = await Promise.all([api.getCorosActivityScreenBackups!(), api.getCorosActivityScreenStatus!()]);
    if (mounted.current) { setBackups(saved); setStatus(next); }
  }
  async function run(label: string, task: () => Promise<void>, invalidateOnError = false) {
    if (working.current || disabled || !available) return;
    working.current = true; setBusy(label); onBusy(true); setNote(null);
    try { await task(); }
    catch (error) {
      if (mounted.current) {
        if (invalidateOnError) { setDocument(null); setPreview(null); setPageIndex(0); }
        setNote({ error: true, text: localizedText(() => apiErrorMessage(error, "Could not complete the activity-page action.")) });
      }
    }
    finally {
      await refreshSaved().catch(error => { if (mounted.current) setNote(previous => previous?.error ? previous : { error: true, text: localizedText(() => apiErrorMessage(error, "Could not refresh activity-page recovery status.")) }); });
      working.current = false; onBusy(false); if (mounted.current) setBusy(null);
    }
  }
  function accept(next: CorosActivityScreenDocument) {
    if (!mounted.current) return;
    setDocument(next); setSportId(next.sport.id); setPreview(null);
    setPageIndex(index => Math.min(index, Math.max(0, next.pages.length - 1)));
  }
  const read = () => run("Reading pages…", async () => {
    if (!ready) return;
    const options = await api.listCorosActivityScreenSports!();
    if (!options.length) throw new Error("The watch returned no supported ordinary activities.");
    const chosen = options.some(sport => sport.id === sportId) ? sportId : options[0]!.id;
    const next = await api.readCorosActivityScreens!(chosen);
    if (mounted.current) { setSports(options); accept(next); setNote({ error: false, text: localizedText(() => next.pages.some(page => page.kind === "grid" && ![2, 3, 4, 6, 8].includes(page.fieldCount!)) ? t("{{p0}}: {{p1}} pages captured. Restore the original standard-page backup before verifying a new baseline.", { p0: String(next.sport.name), p1: String(next.pages.length) }) : t("{{p0}}: {{p1}} pages captured. Sync the unchanged pages to verify the baseline.", { p0: String(next.sport.name), p1: String(next.pages.length) })) }); }
  });
  const backup = () => run("Saving backup…", async () => {
    if (!document) return;
    const saved = await api.backupCorosActivityScreens!({ snapshotId: document.id });
    if (mounted.current) { setBackupId(saved.id); setNote({ error: false, text: localizedText(() => t("Exact page records saved locally. This backup survives restarting CorosLink.")) }); }
  });
  const baseline = () => run("Verifying baseline…", async () => {
    if (!document) return;
    const result = await api.syncCorosActivityScreenBaseline!({ snapshotId: document.id });
    if (mounted.current) { accept(result.document); setBackupId(result.backup.id); setBaselineBackup(result.backup); setNote({ error: false, text: localizedText(() => t("Unchanged pages synced. Read-back matches every byte. Check the standard activity pages on your watch before confirming below.")) }); }
  }, true);
  const confirm = () => run("Confirming baseline…", async () => {
    if (!document) return;
    accept(await api.confirmCorosActivityScreenBaseline!({ snapshotId: document.id }));
    if (mounted.current) setNote({ error: false, text: localizedText(() => t("Standard baseline confirmed on the watch. Experimental layout previews are now available.")) });
  });
  const prepare = () => run("Preparing preview…", async () => {
    if (!document) return;
    const next = await api.previewCorosActivityScreenLayout!({ snapshotId: document.id, pageIndex, fieldCount });
    if (mounted.current) setPreview(next);
  });
  const apply = () => run("Syncing layout…", async () => {
    if (!preview) return;
    const result = await api.applyCorosActivityScreenLayout!({ previewId: preview.id });
    if (mounted.current) { accept(result.document); setBackupId(result.backup.id); setNote({ error: false, text: localizedText(() => t("Layout synced and read-back verified. Check that all fields display and update on the watch; restore the backup to return to the previous layout.")) }); }
  }, true);
  const restore = (id: string) => run("Restoring pages…", async () => {
    const result = await api.restoreCorosActivityScreens!({ backupId: id });
    if (mounted.current) { accept(result.document); setNote({ error: false, text: localizedText(() => t("Backup restored and every byte verified. The settings present before restoration were also backed up.")) }); }
  }, true);
  const exportBackup = () => run("Exporting backup…", async () => {
    if ((await api.exportCorosActivityScreenBackup!({ backupId })).saved && mounted.current) setNote({ error: false, text: localizedText(() => t("Activity-page backup exported.")) });
  });

  return <section className="activity-screens" aria-labelledby="activity-screens-title" aria-busy={busy !== null}>
    <header className="activity-screens-head">
      <div><p className="watch-link-eyebrow">{t("Development · PACE Pro")}</p><h3 id="activity-screens-title">{t("Activity screens")}</h3>
        <p>{t("Capture the current COROS pages, verify an unchanged sync, then test layouts. Every write saves a restore backup.")}</p></div>
      <button type="button" className="secondary-button watch-link-button" disabled={!available || !ready || locked} onClick={() => void read()}>
        {busy === "Reading pages…" ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} {t("Read pages")}</button>
    </header>
    {!available ? <p role="status">{t("Restart the development app to load the activity-screen sync API.")}</p> : !ready ? <p>{t("Connect and authenticate your PACE Pro to read its activity pages.")}</p> : null}
    {available && status && !supportsNine ? <p className="activity-screen-caption" role="status">{t("Restart the development app to load nine-field sync support. The running sync code still supports the previous layouts.")}</p> : null}
    {sports.length ? <label className="activity-screen-select">{t("Activity")}<select aria-label={t("Activity to read")} value={sportId} disabled={locked} onChange={event => {
      setSportId(Number(event.target.value)); setDocument(null); setPreview(null); setBaselineBackup(null); setPageIndex(0); setNote(null);
    }}>{sports.map(sport => <option key={sport.id} value={sport.id}>{sport.name}</option>)}</select><small>{t("Select an activity, then read its pages.")}</small></label> : null}
    {status?.pendingRestore ? <div className="activity-screen-recovery" role="alert"><p>{t("An interrupted sync has a saved recovery backup for {{p0}}. Restore it before another write.", { p0: String(status.pendingRestore.sport.name) })}</p>
      <button type="button" className="secondary-button watch-link-button" disabled={!ready || locked} onClick={() => void restore(status.pendingRestore!.id)}><RotateCcw size={15} />{t("Restore interrupted sync")}</button></div> : null}
    {document ? <>
      <div className="activity-screen-summary"><strong>{t("{{p0}} · {{p1}} pages", { p0: String(document.sport.name), p1: String(document.pages.length) })}</strong><span>{document.device.name} · {document.device.firmware}</span>
        <span className="activity-baseline-state">{confirmed ? t("Baseline confirmed on watch") : verified ? t("Baseline read-back verified") : t("Baseline not verified")}</span></div>
      <div className="activity-screen-pages" aria-label={t("Captured activity pages")}>{document.pages.map(page => <button key={page.index} type="button"
        className={page.index === pageIndex ? "is-selected" : ""} aria-pressed={page.index === pageIndex} disabled={locked}
        onClick={() => { setPageIndex(page.index); setPreview(null); }}><PageDiagram page={page} /><span>{t("Page")}{page.index + 1} · {page.fieldCount ?? t("special")}{page.fieldCount ? t(" fields") : ""}</span></button>)}</div>
      <p className="activity-screen-caption">{t("The preview identifies saved metric IDs, not live readings. Exact native page bytes are kept in the backup.")}</p>
      <div className="activity-screen-actions">
        <button type="button" className="secondary-button watch-link-button" disabled={!ready || locked || !document.pages.length} onClick={() => void backup()}><Save size={15} />{t("Save backup")}</button>
        <button type="button" className="primary-button watch-link-button" disabled={!ready || locked || hasPendingRestore || hasExperimentalPages || !document.pages.length} onClick={() => void baseline()}><Send size={15} />{t("Sync unchanged pages")}</button>
        {baselineBackup && baselineBackup.digest !== document.digest ? <button type="button" className="secondary-button watch-link-button" disabled={!ready || locked || hasPendingRestore}
          onClick={() => void restore(baselineBackup.id)}><RotateCcw size={15} />{t("Restore baseline backup")}</button> : null}
        {verified && !confirmed && !hasExperimentalPages ? <button type="button" className="secondary-button watch-link-button" disabled={!ready || locked || hasPendingRestore} onClick={() => void confirm()}><Check size={15} />{t("I checked the watch — baseline matches")}</button> : null}
      </div>
      <div className="activity-layout-controls"><label>{t("Layout")}<select aria-label={t("Activity page field count")} value={fieldCount} disabled={locked || !verified || selected?.kind !== "grid"}
        onChange={event => { setFieldCount(Number(event.target.value)); setPreview(null); }}>
        {[2, 3, 4, 6, 8].map(count => <option key={count} value={count}>{t("{{p0}} fields · COROS preset", { p0: String(count) })}</option>)}
        {[5, 7, 9].map(count => <option key={count} value={count} disabled={!confirmed || !supportedCounts.includes(count)}>{t("{{p0}} fields · Experimental", { p0: String(count) })}</option>)}
      </select></label><button type="button" className="secondary-button watch-link-button" disabled={!ready || locked || !verified || hasPendingRestore || !supportsSelectedLayout || selected?.kind !== "grid" || ([5, 7, 9].includes(fieldCount) && !confirmed) || (fieldCount === 9 && hasExperimentalPages)}
        onClick={() => void prepare()}>{t("Preview layout")}</button></div>
      {!confirmed ? <p className="activity-screen-caption">{t("Confirm the standard pages on your watch before testing experimental layouts.")}</p> : null}
      {hasExperimentalPages ? <p className="activity-screen-caption">{t("Restore the original standard-page backup before verifying a new baseline or testing nine fields.")}</p> : null}
      {fieldCount === 7 ? <p className="activity-screen-caption">{t("This seven-field arrangement displayed only its first metric on the tested PACE Pro 3.2008.0, even though its settings were retained.")}</p> : null}
      {fieldCount === 9 ? <p className="activity-screen-caption">{t("This nine-field arrangement also displayed only one field in the reported PACE Pro 3.2008.0 test. Restore the original standard-page backup after testing.")}</p> : null}
      {preview ? <div className="activity-screen-preview"><PageDiagram page={preview.page} /><div><strong>{t("Page")}{preview.pageIndex + 1} · {preview.fieldCount} {t("fields")}{preview.experimental ? t(" · Experimental") : ""}</strong>
        <p>{t("Uses metrics already present in the captured pages. Other pages and the bottom metric stay as captured.")}</p>
        <button type="button" className="primary-button watch-link-button" disabled={!ready || locked || hasPendingRestore || !verified || preview.sourceId !== document.id} onClick={() => void apply()}><Send size={15} />{t("Sync preview")}</button></div></div> : null}
    </> : null}
    <div className="activity-screen-backups"><label>{t("Saved backups")}<select aria-label={t("Activity-page backup")} value={backupId} disabled={locked || !backups.length} onChange={event => setBackupId(event.target.value)}>
      <option value="">{t("Choose a backup")}</option>{backups.map(saved => <option key={saved.id} value={saved.id}>{t("{{p0}} · {{p1}} pages · {{p2}} · {{p3}} · {{p4}} · {{p5}}", { p0: String(saved.sport.name), p1: String(saved.pageCount), p2: String(new Date(saved.createdAt).toLocaleString(getLocale())), p3: String(saved.reason), p4: String(saved.id.slice(0, 8)), p5: String(saved.device.name) })}</option>)}
    </select></label><button type="button" className="secondary-button watch-link-button" disabled={!ready || locked || !backupId} onClick={() => void restore(backupId)}><RotateCcw size={15} />{t("Restore backup")}</button>
      <button type="button" className="secondary-button watch-link-button" disabled={locked || !backupId} onClick={() => void exportBackup()}><Download size={15} />{t("Export JSON")}</button></div>
    {busy ? <p className="watch-link-note" role="status"><Loader2 size={14} className="spin" /> {t(busy)}</p> : null}
    {note ? <p className={`watch-link-note${note.error ? " is-error" : " is-success"}`} role={note.error ? "alert" : "status"}>{renderLocalizedText(note.text)}</p> : null}
  </section>;
}
