import { useEffect, useMemo, useState } from "react";
import type { CorosWatchfaceArchive, CorosWatchfaceTemplateAsset, CorosWatchfaceTemplateDetails } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { renderCompiledWatchfacePreview, type CompiledWatchfacePreview } from "./compiledWatchfacePixels";
import { type WatchfaceComplicationId, type WatchfacePreviewMode } from "./watchfaceStudio";

export function WatchfaceExportPreview({ api, archive, details, name, complication, onClose, onPublish, onError }: {
  api: CorosLinkApi;
  archive: CorosWatchfaceArchive;
  details: CorosWatchfaceTemplateDetails;
  name: string;
  complication?: WatchfaceComplicationId;
  onClose: () => void;
  onPublish: (archive: CorosWatchfaceArchive, name: string) => void;
  onError: (message: string) => void;
}) {
  const [directory, setDirectory] = useState(() =>
    details.resolutions.find((item) => item.width === 416)?.directory ?? details.resolutions[0]!.directory);
  const [mode, setMode] = useState<WatchfacePreviewMode>("current");
  const [sample, setSample] = useState("normal");
  const [result, setResult] = useState<CompiledWatchfacePreview | null>(null);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
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
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>("button:not(:disabled), select:not(:disabled)") ?? []);
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

  return <div className="wf-modal-backdrop" role="presentation">
    <section id="wf-compiled-preview" className="wf-modal wf-export-preview-modal" role="dialog" aria-modal="true" aria-labelledby="wf-export-preview-title">
      <header className="wf-export-preview-header">
        <div><h2 id="wf-export-preview-title">Compiled export preview</h2><p>PNG assets and coordinates read from the generated archive.</p></div>
        <span>100% · 1 image pixel per CSS pixel</span>
      </header>
      <div className="wf-export-preview-controls">
        <label>Resolution<select value={directory} onChange={(event) => {
          setDirectory(event.target.value);
          if (!Object.keys(details.resolutions.find((item) => item.directory === event.target.value)?.aodConfig ?? {}).length) setMode("current");
        }}>
          {details.resolutions.map((item) => <option key={item.directory} value={item.directory}>{item.width} × {item.height}</option>)}
        </select></label>
        <label>Display<select value={mode} onChange={(event) => setMode(event.target.value as WatchfacePreviewMode)}>
          <option value="current">Current</option><option value="aod" disabled={!supportsAod}>Always-on{supportsAod ? "" : " unavailable"}</option>
        </select></label>
        <label>Sample values<select value={sample} onChange={(event) => setSample(event.target.value)}>
          <option value="normal">10:08 · Typical values</option><option value="wide">20:58 · Wide values</option>
        </select></label>
      </div>
      {error ? <p role="alert">{error}</p> : !result ? <p role="status">Reading compiled pixels…</p> : <>
        <div className="wf-export-pixel-scroll"><img src={result.dataUrl} width={result.width} height={result.height} alt={`Compiled ${mode === "aod" ? "always-on" : "Current"} watch face at ${result.width} × ${result.height} pixels`} /></div>
        <div className="wf-export-pixel-checks" aria-live="polite">
          <strong>{result.checks.length ? `${result.checks.length} checks to review` : "No clipping or pixel overlaps found in the sampled live sprites."}</strong>
          {result.checks.length > 0 ? <ul>{result.checks.map((check) => <li key={check}>{check}</li>)}</ul> : null}
          <p>Checks cover sampled live sprites and value rectangles. Review artwork baked into the background visually; the watch may render firmware controls differently.</p>
        </div>
      </>}
      <div className="wf-modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Close</button>
        <button type="button" className="secondary-button" disabled={exporting || !result} onClick={() => {
          setExporting(true);
          void api.exportCorosWatchfaceArchive({ archiveId: archive.archiveId, name })
            .catch((caught) => onError(caught instanceof Error ? caught.message : "Could not export the archive."))
            .finally(() => setExporting(false));
        }}>{exporting ? "Exporting…" : "Export this ZIP"}</button>
        <button type="button" className="primary-button" disabled={!result} onClick={() => { onClose(); onPublish(archive, name); }}>Send to COROS</button>
      </div>
    </section>
  </div>;
}
