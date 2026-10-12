import { useEffect, useRef, useState } from "react";
import { Download, FileCode2, FolderOpen, Loader2, RefreshCw, Send, Watch } from "lucide-react";
import type { CorosDirectWatchfacePreview } from "../../electron/corosBleWatchfaceTypes";
import type { CorosWatchfaceCompilerStatus } from "../../electron/corosWatchfaceCompilerTypes";
import type { CorosLinkApi } from "../coroslink-api";
import { apiErrorMessage, compileSummary, formatBytes, useWatchfaceInstaller } from "./watchLink";
import { getWatchfaceTarget, type WatchfaceTarget } from "../../electron/watchfaceTargets";
import { CompileWarnings, WatchInstallProgress, WatchSlotPicker, watchInstallResult } from "./WatchInstallParts";

/** The On watch tab: pick a slot, bring a face, install it over Bluetooth. */
export function CorosDirectWatchfacePanel({ api, ready, connected, watch, betaNote, disabled, onBusy }: {
  api: CorosLinkApi; ready: boolean; connected: boolean;
  /** The connected watch, when CorosLink supports it. */
  watch?: WatchfaceTarget;
  /** Set while the watch or its firmware is beta (see `watchBetaNote`). */
  betaNote?: string | null;
  disabled: boolean; onBusy: (busy: boolean) => void;
}) {
  const installer = useWatchfaceInstaller(api, ready, { disabled, onBusy });
  const [preview, setPreview] = useState<CorosDirectWatchfacePreview | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compiler, setCompiler] = useState<CorosWatchfaceCompilerStatus | null>(null);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const [showResult, setShowResult] = useState(false);
  const working = useRef(false);
  const canChoose = typeof api.chooseCorosDirectWatchface === "function";
  const canCompile = typeof api.getCorosWatchfaceCompilerStatus === "function" && typeof api.compileCorosDirectWatchface === "function";
  const { inventory, target, status, transferring } = installer;

  useEffect(() => {
    if (!canCompile) return;
    let disposed = false;
    const read = () => { void api.getCorosWatchfaceCompilerStatus().then(next => { if (!disposed) setCompiler(next); }).catch(() => {}); };
    read();
    const timer = compiling ? setInterval(read, 400) : undefined;
    return () => { disposed = true; clearInterval(timer); };
  }, [api, canCompile, compiling]);

  useEffect(() => { if (inventory?.prepared && !preview) setPreview(inventory.prepared); }, [inventory, preview]);

  async function run(task: () => Promise<void>) {
    if (working.current || installer.busy() || disabled) return;
    working.current = true; installer.begin(); setNote(null);
    try { await task(); } finally { working.current = false; installer.end(); }
  }

  const choose = () => run(async () => {
    try {
      const next = await api.chooseCorosDirectWatchface();
      if (next) { setPreview(next); setShowResult(false); installer.resetStatus(); }
    } catch (caught) { setNote({ error: true, text: apiErrorMessage(caught, "Could not open the watch face.") }); }
  });

  const compile = () => run(async () => {
    if (!compiler?.available) return;
    setCompiling(true);
    try {
      const next = await api.compileCorosDirectWatchface();
      if (next) { setPreview(next); setShowResult(false); installer.resetStatus(); }
    } catch (caught) { setNote({ error: true, text: apiErrorMessage(caught, "Could not compile the watch face.") }); }
    finally { setCompiling(false); }
  });

  const save = () => run(async () => {
    if (!preview || preview.source !== "compiled") return;
    try { if ((await api.saveCorosCompiledWatchface(preview.id)).saved) setNote({ error: false, text: "BIN saved." }); }
    catch (caught) { setNote({ error: true, text: apiErrorMessage(caught, "Could not save the BIN.") }); }
  });

  async function install() {
    if (!preview || working.current || disabled || mismatch) return;
    setNote(null); setShowResult(true);
    await installer.install(preview);
  }

  const locked = disabled || compiling || transferring;
  // A BIN only fits watches with its screen; the watch would refuse another.
  const builtFor = preview?.models?.map(model => getWatchfaceTarget(model)?.label).filter(Boolean).join(" or ");
  const mismatch = watch && preview?.models && !preview.models.includes(watch.model)
    ? `${preview.name} is built for ${builtFor || "another watch"}. Compile it again with your ${watch.label} connected.` : null;
  const occupied = inventory?.slots.filter(item => item.faceId !== null).length ?? 0;
  const summary = preview ? compileSummary(preview) : null;
  const result = showResult && !transferring ? watchInstallResult(status) : null;
  const installLabel = !target ? "Install on watch" : target.faceId === null ? `Install in slot ${target.slot + 1}` : `Replace slot ${target.slot + 1}`;
  const slotsHint = !connected ? "Connect your watch to see its face slots."
    : !ready ? "Installing faces needs an authenticated COROS watch that CorosLink supports."
      : installer.reading ? "Reading watch face slots…" : "Refresh to read the faces stored on your watch.";

  return <div className="watch-faces">
    <div className="watch-faces-head">
      <div>
        <h3>Watch face slots</h3>
        <p>{inventory ? `${occupied} of ${inventory.slots.length} in use · Bluetooth reports face IDs, not names` : slotsHint}</p>
      </div>
      <button type="button" className="watch-link-icon-button" aria-label="Refresh slots" title="Refresh slots"
        disabled={!installer.available || !ready || locked || installer.reading} onClick={() => void installer.readSlots()}>
        <RefreshCw size={15} className={installer.reading ? "spin" : undefined} aria-hidden="true" />
      </button>
    </div>
    {inventory ? <WatchSlotPicker installer={installer} disabled={!ready || locked || installer.reading} />
      : <div className="watch-slots-placeholder" aria-hidden="true">{Array.from({ length: 10 }, (_, slot) => <span key={slot} />)}</div>}

    <div className={`watch-source${preview ? "" : " is-empty"}`}>
      <span className="watch-source-glyph" aria-hidden="true">{compiling ? <Loader2 className="spin" size={18} /> : <Watch size={18} />}</span>
      <div className="watch-source-text">
        <strong>{compiling ? "Compiling…" : preview?.name ?? "No watch face chosen"}</strong>
        <span>{compiling ? compiler?.detail ?? "Compiling watch face…"
          : preview ? [formatBytes(preview.bytes), summary ?? "Compiled BIN"].join(" · ")
          : `Compile a final DAT/ZIP${watch ? ` for ${watch.label}` : ""}, or choose a compiled BIN.`}</span>
      </div>
      <div className="watch-source-actions">
        {canCompile ? <button type="button" className="secondary-button watch-link-button" title={compiler && !compiler.available ? compiler.detail : undefined}
          disabled={!compiler?.available || compiler.busy || locked} onClick={() => void compile()}>
          <FileCode2 size={15} aria-hidden="true" /> Compile DAT/ZIP
        </button> : null}
        {canChoose ? <button type="button" className="secondary-button watch-link-button" disabled={locked} onClick={() => void choose()}>
          <FolderOpen size={15} aria-hidden="true" /> Choose BIN
        </button> : null}
        {preview?.source === "compiled" ? <button type="button" className="watch-link-icon-button" aria-label="Save BIN" title="Save BIN"
          disabled={locked} onClick={() => void save()}>
          <Download size={15} aria-hidden="true" />
        </button> : null}
      </div>
    </div>

    <CompileWarnings warnings={preview?.compile?.warnings} />

    <div className="watch-install">
      {transferring || result ? <WatchInstallProgress status={status} />
        : <p className="watch-install-destination">{!ready ? "Connect an authenticated COROS watch to install. Compiling and saving BINs work offline."
          : !preview ? "Choose a face, then a slot." : !target
          ? inventory ? "Every slot is in use. Select the face to replace." : "Read the watch's slots to choose a destination."
          : target.faceId === null ? <>Installs <strong>{preview.name}</strong> into empty slot {target.slot + 1}.</>
            : <>Replaces face ID {target.faceId} in slot {target.slot + 1} with <strong>{preview.name}</strong>.</>}</p>}
      <div className="watch-install-actions">
        {transferring ? <button type="button" className="secondary-button watch-link-button" onClick={installer.cancel}>Cancel</button> : null}
        <button type="button" className={`primary-button watch-link-button${transferring ? " is-busy" : ""}`} disabled={!ready || !preview || !target || locked || Boolean(mismatch)} onClick={() => void install()}>
          {transferring ? <Loader2 className="spin" size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />} {transferring ? "Installing…" : installLabel}
        </button>
      </div>
    </div>

    {mismatch ? <p className="watch-link-note is-error" role="alert">{mismatch}</p> : null}
    {betaNote && ready && !mismatch ? <p className="watch-link-note" role="note">{betaNote}</p> : null}
    {result ? <p className="watch-link-note is-success" role="status">{result}</p> : null}
    {note ? <p className={`watch-link-note${note.error ? " is-error" : ""}`} role={note.error ? "alert" : "status"}>{note.text}</p> : null}
    {installer.error ? <p className="watch-link-note is-error" role="alert">{installer.error}</p> : null}
    {installer.inventoryError ? <p className="watch-link-note is-error" role="alert">{installer.inventoryError}</p> : null}
    {canCompile && compiler && !compiler.available ? <p className="watch-link-note">{compiler.detail}</p> : null}
  </div>;
}
