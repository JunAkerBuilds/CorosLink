// Send, from the design's StudioSend / LightStudioSend boards: Watch | COROS app | File.
//
// - Watch: the face compiled for the watch and shown 1:1, its pixel checks (Show picks the layer), the name, the
//   watch, languages, and compile → send → verify (palette colours and soft edges, as the watch's own faces). With the watch paired in Local mode
//   the slots are read and Send to watch installs over Bluetooth; otherwise Save BIN and Send to iPhone.
// - COROS app: the face goes up to the signed-in COROS account and comes back as a share link and QR code.
// - File: Editable project ZIP, Final watch ZIP, All watches (a final ZIP per watch in one folder) and Development
//   export (the files unpacked).
// ConvertDialog, from the editor's Convert button: a new face for another watch from the 800 px master (a face
// without one is rebuilt from its own layout with the edits applied).
// Everything after the first build works from one prepared copy (desktop/main/watchface/send.ts).
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Segmented } from "@/components/ui";
import { t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { WATCHFACE_TARGETS, getWatchfaceTarget, type WatchfaceTarget } from "../../watchface/watchfaceTargets";
import { buildInput, initialDesign, openFaceSource, type Design, type FaceSource } from "../studioFace";
import { carriedWatchfacePreferences } from "../../watchface/engine/watchfaceCarriedPreferences";
import {
  convertProject, corosAccount, corosSignOut, deleteProject, downloadPreparedBin, downloadPreparedFinal, openProject, phoneStatus, pickFolder,
  installPrepared, prepareSend, said, savePreparedTo, sendToPhone, shareToCoros, stopPhone, watchConnection, watchSlots,
  type AccountStatus, type FaceSlots, type CorosShareLink, type PhoneSend, type PhoneSendStatus, type PreparedFace,
} from "../studio";
import { baseName, compiledLook, convertDetail, convertedNote, describeCheck, languagesLine, nativeLayout, type CompiledLook } from "../studioSend";
import { AccountDialog, regionName } from "./StudioAccount";
import { readWatchLink, showWatchFace } from "../watchLink";
import { Icon } from "./StudioIcon";
import { BrandMark } from "@/components/shell/BrandMark";

export type SendTab = "watch" | "app" | "file";

export interface SendDialogProps {
  projectId: string;
  name: string;
  onRename: (name: string) => void;
  source: FaceSource;
  design: Design;
  watch: WatchfaceTarget;
  /** An editor layer's name, for the pixel checks. */
  layerLabel: (id: string) => string;
  tab: SendTab;
  onTab: (tab: SendTab) => void;
  /** Show picks the layer in the editor; Change opens the Face inspector's languages. */
  onShowLayer: (id: string) => void;
  onLanguages: () => void;
  /** Editable project ZIP, made the same way as the Download menu's. */
  onEditable: () => Promise<void>;
  /** The design (with font snapshots) and preview for the Editable project Send to iPhone also offers. */
  projectBody: () => Promise<{ design: Design; previewDataUrl?: string }>;
  onOpenProject: (id: string) => void;
  onClose: () => void;
}

type Step = { at: "compile" | "send" | "verify"; progress: number } | { done: string } | null;

export function SendDialog(p: SendDialogProps) {
  const { onClose } = p;
  const [face, setFace] = useState<PreparedFace | null>(null);
  const [look, setLook] = useState<CompiledLook | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const building = useRef<Promise<PreparedFace> | null>(null);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose]);

  /** The face built once for this dialog; later steps reuse it. */
  const prepared = useCallback(() => (building.current ??= (async () => {
    const built = await prepareSend(p.projectId, await buildInput(p.source, p.design));
    setFace(built);
    return built;
  })()), [p.projectId, p.source, p.design]);

  useEffect(() => {
    let live = true;
    prepared().then((built) => compiledLook(built, p.watch)).then((l) => { if (live) setLook(l); }, (e) => { if (live) setProblem(said(e)); });
    return () => { live = false; };
  }, [prepared, p.watch]);

  return (
    <div className="st-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="st-dialog st-send" role="dialog" aria-modal="true" aria-label={t("Send {name}", { name: p.name })}>
        <div className="st-dialog-head">
          <h2>{t("Send {name}", { name: p.name })}</h2>
          <Segmented small label={t("Send to")} value={p.tab} onChange={p.onTab}
            options={[{ value: "watch", label: t("Watch") }, { value: "app", label: t("COROS app") }, { value: "file", label: t("File") }]} />
          <span className="st-grow" />
          <button type="button" className="st-icon-btn" aria-label={t("Close")} onClick={onClose}><Icon name="close" /></button>
        </div>
        {problem ? <div className="notice st-send-notice" role="alert">{problem}</div> : null}
        {note ? <div className="st-send-note" role="status"><Icon name="check" size={15} width={2.6} />{note}</div> : null}
        {p.tab === "watch" ? <WatchTab {...p} face={face} look={look} prepared={prepared} fail={setProblem} say={setNote} />
          : p.tab === "app" ? <AppTab {...p} prepared={prepared} fail={setProblem} />
            : <FileTab {...p} prepared={prepared} fail={setProblem} say={setNote} />}
      </div>
    </div>
  );
}

interface TabProps extends SendDialogProps { prepared: () => Promise<PreparedFace>; fail: (text: string | null) => void }

/* ───────────── Watch ───────────── */

function WatchTab(p: TabProps & { face: PreparedFace | null; look: CompiledLook | null; say: (text: string | null) => void }) {
  const { look, watch } = p;
  const [connection, setConnection] = useState<{ connected: boolean; reason?: string } | null>(null);
  const [step, setStep] = useState<Step>(null);
  // The watch paired in Local mode: its slots, read once it's known to be there, and the one chosen.
  const [slots, setSlots] = useState<FaceSlots | null>(null);
  const [slotProblem, setSlotProblem] = useState<string | null>(null);
  const [pick, setPick] = useState<number | null>(null);
  const [installed, setInstalled] = useState<{ slot: number; faceId: number } | null>(null);
  const readSlots = useCallback(() => {
    setSlotProblem(null);
    return watchSlots().then((s) => { setSlots(s); setPick(s.slots.find((x) => x.faceId == null)?.slot ?? null); }, (e: unknown) => setSlotProblem(said(e)));
  }, []);
  useEffect(() => {
    watchConnection().then((c) => { setConnection(c); if (c.connected) void readSlots(); }, () => setConnection({ connected: false }));
  }, [readSlots]);
  const checks = look?.checks.map((c) => describeCheck(c, p.layerLabel)) ?? [];

  const saveBin = async () => {
    p.fail(null); p.say(null);
    setStep({ at: "compile", progress: 30 });
    try {
      const built = await p.prepared();
      setStep({ at: "compile", progress: 70 });
      const { warnings } = await downloadPreparedBin(built.id, { name: p.name, fullColor: false, smoothEdges: false });
      setStep({ done: warnings[0] ? `${t("BIN saved.")} ${warnings[0]}` : t("BIN for {watch} saved and checked.", { watch: watch.label }) });
    } catch (e) { setStep(null); p.fail(said(e)); }
  };

  const chosen = pick == null ? null : slots?.slots.find((x) => x.slot === pick) ?? null;
  const send = async () => {
    if (!slots || !chosen) return;
    p.fail(null); p.say(null); setInstalled(null);
    setStep({ at: "compile", progress: 15 });
    // The install's own progress, from the watch link, while the request runs.
    const timer = setInterval(() => {
      readWatchLink().then((w) => {
        if (w.step?.step === "face" && w.step.percent != null) setStep({ at: w.step.percent >= 100 ? "verify" : "send", progress: 35 + Math.round(w.step.percent * 0.55) });
      }, () => undefined);
    }, 700);
    try {
      const built = await p.prepared();
      setStep({ at: "send", progress: 30 });
      const done = await installPrepared(built.id, {
        name: p.name, fullColor: false, smoothEdges: false, slot: chosen.slot, expectedFaceId: chosen.faceId ?? null, replace: chosen.faceId != null,
      });
      setSlots(done);
      const slot = done.installed ?? chosen.slot;
      const faceId = done.slots.find((x) => x.slot === slot)?.faceId;
      if (faceId != null) setInstalled({ slot, faceId });
      setStep({ done: `${t("Installed in slot {n} and checked on the watch.", { n: slot + 1 })}${done.warnings[0] ? ` ${done.warnings[0]}` : ""}` });
    } catch (e) { setStep(null); p.fail(said(e)); void readSlots(); }
    finally { clearInterval(timer); }
  };
  const showNow = () => {
    if (!installed) return;
    showWatchFace(installed.slot, installed.faceId).then((s) => { setSlots({ ...s }); setInstalled(null); p.say(t("It's on the watch's screen now.")); }, (e: unknown) => p.fail(said(e)));
  };

  return (
    <>
      <div className="st-send-body st-send-watch">
        <div className="st-send-left">
          <div className="st-send-well">
            {look ? <img src={look.dataUrl} width={look.width} height={look.height} alt={t("{name} compiled for {watch}", { name: p.name, watch: watch.label })} />
              : <div className="st-send-wait" style={{ width: watch.previewSize, height: watch.previewSize }}><span>{t("Compiling…")}</span></div>}
            <span>{t("Compiled at {size} × {size}, shown 1:1", { size: watch.previewSize })}</span>
          </div>
          <div className="st-check-head"><h3>{t("Pixel check")}</h3>
            {look ? <span data-ok={checks.length ? undefined : ""}>{checks.length ? t("{n} to review", { n: checks.length }) : t("All clear")}</span> : <span data-ok="">{t("Checking…")}</span>}
          </div>
          {checks.slice(0, 6).map((c, i) => (
            <div key={i} className="st-problem">
              <Icon name="warn" size={16} />
              <span><b>{c.title}</b><small>{c.detail}</small></span>
              {c.layer ? <button type="button" className="st-link" onClick={() => p.onShowLayer(c.layer!)}>{t("Show")}</button> : null}
            </div>
          ))}
          {checks.length > 6 ? <p className="st-note">{t("And {n} more.", { n: checks.length - 6 })}</p> : null}
        </div>
        <div className="st-send-main">
          <label className="st-form-row">{t("Name")}
            <input className="field" value={p.name} maxLength={80} aria-label={t("Watch face name")} onChange={(e) => p.onRename(e.target.value)} />
            <span className="st-hint-line">{t("Shown in the COROS app and on your watch.")}</span>
          </label>
          <div className="st-send-row">
            <i className="st-dot-state" data-on={connection?.connected ? "" : undefined} aria-hidden="true" />
            <span className="st-grow"><b>{watch.label}</b> <span className="muted">· {connection?.connected ? t("connected over Bluetooth") : t("not connected over Bluetooth")}</span></span>
          </div>
          {connection && !connection.connected ? <PhoneHandoff {...p} /> : null}
          {connection?.connected ? (
            <div className="st-slots" role="group" aria-label={t("Watch face slots")}>
              <div className="st-slots-head"><b>{t("Slot on the watch")}</b>
                {slots ? <button type="button" className="st-link" onClick={() => void readSlots()}>{t("Refresh")}</button> : null}</div>
              {slots ? (
                <div className="st-slot-row">
                  {slots.slots.map((x) => (
                    <button key={x.slot} type="button" className="st-slot" aria-pressed={pick === x.slot} data-empty={x.faceId == null || undefined}
                      disabled={!!step && !("done" in step)} onClick={() => setPick(x.slot)}>
                      <b>{x.slot + 1}</b><small>{x.faceId == null ? t("Empty") : slots.shown === x.slot ? t("On screen") : t("Face")}</small>
                    </button>
                  ))}
                </div>
              ) : slotProblem ? <span className="st-hint-line">{slotProblem} <button type="button" className="st-link" onClick={() => void readSlots()}>{t("Try again")}</button></span>
                : <span className="st-hint-line">{t("Reading the watch…")}</span>}
              {chosen?.faceId != null ? <span className="st-hint-line">{slots?.shown === chosen.slot ? t("Replaces the face in slot {n}, the one on screen.", { n: chosen.slot + 1 }) : t("Replaces the face in slot {n}.", { n: chosen.slot + 1 })}</span>
                : slots && pick == null ? <span className="st-hint-line">{t("Every slot holds a face: pick one to replace.")}</span> : null}
            </div>
          ) : null}
          <div className="st-send-inline">
            <span className="muted">{t("Languages:")} <b>{languagesLine(p.design)}</b></span>
            <button type="button" className="st-link" onClick={p.onLanguages}>{t("Change")}</button>
          </div>
        </div>
      </div>
      <div className="st-send-foot">
        {step && "done" in step ? <span className="st-send-done"><Icon name="check" size={16} width={2.6} />{step.done}</span>
          : step ? (
            <div className="st-send-steps">
              <div><span data-on="">{t("Compile")}</span><span>{t("Send")}</span><span>{tx("check", "Verify")}</span></div>
              <div className="st-bar"><i style={{ width: `${step.progress}%` }} /></div>
            </div>
          ) : <span className="st-grow muted">{connection?.connected ? t("Compiles on this computer, then sends over Bluetooth.") : t("Compiles on this computer. Installing needs the watch connected over Bluetooth.")}</span>}
        <Button onClick={p.onClose}>{t("Cancel")}</Button>
        <Button disabled={!!step && !("done" in step)} onClick={() => void saveBin()}><Icon name="download" size={16} />{t("Save BIN")}</Button>
        {installed ? <Button onClick={showNow}><Icon name="watch" size={16} />{t("Show it now")}</Button> : null}
        <Button variant="primary" disabled={!connection?.connected || !chosen || (!!step && !("done" in step))} title={connection?.connected ? undefined : connection?.reason}
          onClick={() => void send()}><Icon name="send" size={16} />{t("Send to watch")}</Button>
      </div>
    </>
  );
}

/** No watch here: C-LINK on the iPhone fetches the face over this network and installs it. */
function PhoneHandoff(p: TabProps) {
  const [send, setSend] = useState<(PhoneSend & { minutes: number }) | null>(null);
  const [status, setStatus] = useState<PhoneSendStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!send) return;
    const timer = setInterval(() => { phoneStatus().then(setStatus, () => {}); }, 1500);
    return () => clearInterval(timer);
  }, [send]);
  useEffect(() => () => { void stopPhone().catch(() => {}); }, []);
  const start = async () => {
    setBusy(true); p.fail(null);
    try { const built = await p.prepared(); const project = await p.projectBody().catch(() => undefined); const made = await sendToPhone(built.id, p.name, project); setSend({ ...made, minutes: Math.round((made.expiresAt - Date.now()) / 60000) }); setStatus(null); } catch (e) { p.fail(said(e)); } finally { setBusy(false); }
  };
  const over = status && !status.active;
  if (!send || over) {
    return (
      <div className="st-send-nowatch">
        <Icon name="watch" size={20} />
        <p><b>{t("Installing needs the watch connected over Bluetooth.")}</b> {t("Studio can't send faces that way yet. Send the face to C-LINK on your iPhone and it installs it.")}</p>
        <Button disabled={busy} onClick={() => void start()}><Icon name="phone" size={16} />{over ? t("New code") : busy ? t("Preparing…") : t("Send to iPhone")}</Button>
      </div>
    );
  }
  return (
    <div className="st-send-phone">
      <span className="st-qr">
        <img src={send.qrDataUrl} width={132} height={132} alt={t("C-LINK code")} />
        <span className="st-qr-brand"><BrandMark /><b>C-LINK</b><span>coroslink.com</span></span>
      </span>
      <div>
        <b>{t("Scan with C-LINK on your iPhone")}</b>
        <p className="st-note">{t("Same Wi-Fi as this computer.")} {status?.received ? (status.received === 1 ? t("Received once.") : t("Received {n} times.", { n: status.received })) : status?.sending ? t("Sending…") : t("Works for {n} min.", { n: send.minutes })}</p>
        <button type="button" className="st-link" onClick={() => { void stopPhone().then(setStatus); }}>{t("Stop")}</button>
      </div>
    </div>
  );
}

/* ───────────── COROS app ───────────── */

function AppTab(p: TabProps) {
  const [account, setAccount] = useState<AccountStatus | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [faceName, setFaceName] = useState(p.name);
  const [background, setBackground] = useState("");
  const [link, setLink] = useState<(CorosShareLink & { days: number }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { corosAccount().then(setAccount, () => setAccount(null)); }, []);

  const create = async () => {
    setBusy(true); p.fail(null);
    try {
      const built = await p.prepared();
      const made = await shareToCoros(built.id, { name: faceName.trim() || p.name, backgroundImageId: background.trim() ? Number(background) : 13 });
      setLink({ ...made, days: Math.max(1, Math.round((Date.parse(made.expiresAt) - Date.now()) / 86_400_000)) });
    } catch (e) { p.fail(said(e)); } finally { setBusy(false); }
  };
  const badId = background.trim() !== "" && !/^\d{1,9}$/.test(background.trim());

  return (
    <div className="st-send-body st-send-app">
      {/* The code people screenshot and pass around: it carries where the face was made. */}
      <div className="st-qr-box">
        <span className="st-qr-code">{link ? <img src={link.qrDataUrl} width={200} height={200} alt={t("COROS share link")} /> : <Icon name="qr" size={56} />}</span>
        <span className="st-qr-brand"><BrandMark /><b>C-LINK</b><span>coroslink.com</span></span>
      </div>
      <div className="st-send-main">
        <h3>{t("Scan with the phone that has the COROS app")}</h3>
        <p className="st-lead">{t("The face uploads to your COROS account. Open the link on your phone and the COROS app installs it on your watch.")}</p>
        {link ? <>
          <div className="st-send-inline st-link-row">
            <input className="field" readOnly value={link.url} aria-label={t("COROS share link")} onFocus={(e) => e.target.select()} />
            <Button onClick={() => { void navigator.clipboard.writeText(link.url).then(() => setCopied(true)); }}><Icon name={copied ? "check" : "link"} size={16} />{copied ? t("Copied") : t("Copy link")}</Button>
            <a className="st-link" href={link.url} target="_blank" rel="noreferrer">{t("Open")}</a>
          </div>
          <span className="muted st-small">{link.days === 1 ? t("Link expires in 1 day.") : t("Link expires in {n} days.", { n: link.days })}</span>
        </> : null}
        <div className="st-send-grid">
          <label className="st-form-row">{t("Face name")}<input className="field" value={faceName} maxLength={64} onChange={(e) => { setFaceName(e.target.value); setLink(null); }} /></label>
          <label className="st-form-row">{t("Background ID")}<input className="field" value={background} placeholder={t("Auto")} inputMode="numeric" aria-invalid={badId || undefined} onChange={(e) => { setBackground(e.target.value); setLink(null); }} /></label>
        </div>
        {account?.signedIn ? <>
          {!link ? <div><Button variant="primary" disabled={busy || badId} onClick={() => void create()}><Icon name="link" size={16} />{busy ? t("Uploading…") : t("Create link")}</Button></div> : null}
          <div className="st-send-row">
            <span className="st-account-icon"><Icon name="user" size={15} /></span>
            <span className="st-grow">{t("COROS account")} <span className="muted">· {regionName(account.region)}</span></span>
            <button type="button" className="st-link st-quiet-link" onClick={() => { void corosSignOut().then(setAccount); setLink(null); }}>{t("Disconnect")}</button>
          </div>
        </> : (
          <div className="st-send-row">
            <span className="st-account-icon"><Icon name="user" size={15} /></span>
            <span className="st-grow">{t("Sign in to COROS to make a link.")}</span>
            <Button variant="primary" disabled={!account} onClick={() => setSignIn(true)}>{t("Sign in")}</Button>
          </div>
        )}
      </div>
      {signIn && account ? <AccountDialog account={account} onClose={() => setSignIn(false)} onChange={(a) => { setAccount(a); if (a.signedIn) setSignIn(false); }} /> : null}
    </div>
  );
}

/* ───────────── File ───────────── */

function FileTab(p: TabProps & { say: (text: string | null) => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (label: string, work: () => Promise<string | void>) => {
    setBusy(label); p.fail(null); p.say(null);
    try { const done = await work(); if (done) p.say(done); } catch (e) { p.fail(said(e)); } finally { setBusy(null); }
  };
  const rows: { key: string; icon: string; title: string; text: string; act: () => Promise<string | void> }[] = [
    { key: "editable", icon: "folder", title: t("Editable project ZIP"), text: t("Everything Studio needs to keep editing. Good as a backup."), act: async () => { await p.onEditable(); } },
    { key: "final", icon: "download", title: t("Final watch ZIP"), text: t("The compiled face for {watch}.", { watch: p.watch.label }), act: async () => { await downloadPreparedFinal((await p.prepared()).id, p.name); return t("Final watch ZIP for {watch} saved.", { watch: p.watch.label }); } },
    { key: "all", icon: "watch", title: t("All watches"), text: t("Final ZIPs for every model, in one folder."), act: () => allWatches(p, setBusy) },
    { key: "dev", icon: "code", title: t("Development export"), text: t("Config files and images, unpacked."), act: async () => {
      const folder = await pickFolder();
      if (!folder) return;
      const saved = await savePreparedTo((await p.prepared()).id, { folderId: folder.id, name: p.name, unpacked: true });
      return t("Unpacked into “{path}”.", { path: `${folder.label}/${saved}` });
    } },
  ];

  return (
    <div className="st-send-body st-send-file">
      <div className="st-file-rows">
        {rows.map((r) => (
          <div key={r.key} className="st-file-row">
            <span className="st-file-icon" aria-hidden="true"><Icon name={r.icon} size={18} /></span>
            <span className="st-grow"><b>{r.title}</b><small>{r.text}</small></span>
            <Button disabled={!!busy} onClick={() => void run(r.title, r.act)}>{busy === r.title ? t("Saving…") : t("Save")}</Button>
          </div>
        ))}
        {busy && !rows.some((r) => r.title === busy) ? <p className="st-note" role="status">{busy}</p> : null}
      </div>
    </div>
  );
}

/* ───────────── Convert ───────────── */

export interface ConvertDialogProps {
  projectId: string;
  name: string;
  source: FaceSource;
  design: Design;
  watch: WatchfaceTarget;
  onOpenProject: (id: string) => void;
  onClose: () => void;
}

/** Convert for another watch: the watch, what it keeps, then the new face to open. This face stays as it is. */
export function ConvertDialog(p: ConvertDialogProps) {
  const { onClose } = p;
  const others = WATCHFACE_TARGETS.filter((w) => w.model !== p.watch.model);
  const [target, setTarget] = useState<string>(others[0].model);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; name: string; note: string | null } | null>(null);
  const rebuilt = nativeLayout(p.source.details);
  const goal = getWatchfaceTarget(target)!;
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [onClose, busy]);

  const convert = async () => {
    setBusy(true); setProblem(null);
    try {
      const { project, result } = await convertProject(p.projectId, {
        watch: goal.model, design: p.design, name: `${baseName(p.name, WATCHFACE_TARGETS)} (${goal.label})`,
        ...(rebuilt ? { build: await buildInput(p.source, p.design), carried: carriedWatchfacePreferences(p.design) } : {}),
      });
      setMade({ id: project.projectId, name: project.name, note: convertedNote(goal, result) });
    } catch (e) { setProblem(said(e)); } finally { setBusy(false); }
  };

  return (
    <div className="st-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className="st-dialog st-convert-dialog pop" role="dialog" aria-modal="true" aria-labelledby="st-convert-title" aria-busy={busy}>
        <div className="st-dialog-head">
          <h2 id="st-convert-title">{t("Convert {name}", { name: p.name })}</h2>
          <span className="st-grow" />
          <button type="button" className="st-icon-btn" aria-label={t("Close")} disabled={busy} onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="st-convert">
          <div className="st-chips" role="group" aria-label={t("Watch")}>
            {others.map((w) => <button key={w.model} type="button" className="chip" aria-pressed={w.model === target} disabled={busy} onClick={() => { setTarget(w.model); setMade(null); }}>{w.label}</button>)}
          </div>
          <span className="muted st-small">{convertDetail(goal, rebuilt)}</span>
          {problem ? <div className="notice" role="alert">{problem}</div> : null}
          {made ? (<>
            <div className="st-send-row"><Icon name="check" size={16} width={2.6} /><span className="st-grow">{tr("Made {name}", { name: <b>{made.name}</b> })}</span><Button variant="primary" onClick={() => p.onOpenProject(made.id)}>{t("Open")}</Button></div>
            {made.note ? <p className="st-note" role="status">{made.note}</p> : null}
          </>) : (
            <div><Button variant="primary" disabled={busy} onClick={() => void convert()}><Icon name="convert" size={16} />{busy ? t("Converting to {watch}…", { watch: goal.label }) : t("Convert to {watch}", { watch: goal.label })}</Button></div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A final ZIP per watch, into one folder: this face for its own watch, converted scratch copies for the rest. A face
 * built from its own layout is built for each watch directly from the one composition.
 */
async function allWatches(p: TabProps, progress: (label: string) => void): Promise<string> {
  const folder = await pickFolder();
  if (!folder) return "";
  const base = baseName(p.name, WATCHFACE_TARGETS);
  const composed = nativeLayout(p.source.details) ? await buildInput(p.source, p.design) : null;
  const failed: string[] = [];
  let saved = 0;
  for (const [i, w] of WATCHFACE_TARGETS.entries()) {
    progress(`${w.label} · ${i + 1}/${WATCHFACE_TARGETS.length}`);
    const name = `${base} (${w.label})`;
    let scratch: string | null = null;
    try {
      let face: PreparedFace;
      if (w.model === p.watch.model) face = await p.prepared();
      else if (composed) face = await prepareSend(p.projectId, composed, w.model);
      else {
        scratch = (await convertProject(p.projectId, { watch: w.model, design: p.design, name, scratch: true })).project.projectId;
        const { project } = await openProject(scratch);
        const source = await openFaceSource(scratch, project.firmwareType);
        face = await prepareSend(scratch, await buildInput(source, await initialDesign(source, project.design, project.startedFrom, project.carried)));
      }
      await savePreparedTo(face.id, { folderId: folder.id, name });
      saved++;
    } catch (e) {
      failed.push(`${w.label} (${said(e)})`);
    } finally {
      if (scratch) await deleteProject(scratch).catch(() => {});
    }
  }
  if (failed.length) throw new Error(t("Saved {saved} of {total} to “{folder}”. Not saved: {failed}", { saved, total: WATCHFACE_TARGETS.length, folder: folder.label, failed: failed.join("; ") }));
  return t("Final ZIPs for all {n} watches saved to “{folder}”.", { n: saved, folder: folder.label });
}
