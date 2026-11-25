// C-LINK's updates, as CorosLink had them: an "Updates" row in the account menu that opens a popover beside it
// (version, Check for updates, checking and downloading by themselves), a dot on the account button when an update
// is waiting for you, and the prompt with the release notes when an update is found or downloaded ("Later" holds for
// that version).
// The state comes from ../updates.ts, which Settings → About C-LINK shares.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Switch } from "@/components/ui";
import { BrandMark } from "@/components/shell/BrandMark";
import { act, laterVersion, needsYou, PREVIEW_EVENT, promptVersion, rememberLater, setAuto, statusLine, useUpdates, type UpdateState } from "../updates";
import "./updates.css";

const REFRESH = "M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4";
const DOWN = "M12 4v11M7 10.5l5 5l5-5M5 20h14";
/** "Show what's new" from the popover opens the prompt for the version on offer. */
const SHOW_EVENT = "clink:update-show";

function Icon({ d, spin }: { d: string; spin?: boolean }) {
  return <svg className={spin ? "upd-spin" : undefined} aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={d} /></svg>;
}

function Progress({ percent }: { percent: number | null }) {
  const p = percent ?? 0;
  return <div className="upd-bar" role="progressbar" aria-label="Download" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}><i style={{ width: `${p}%` }} /></div>;
}

/** The one thing to do next: restart, download, or check. Shared by the popover and the prompt's footer. */
function MainAction({ u, onDone, wide }: { u: UpdateState; onDone?: () => void; wide?: boolean }) {
  const next = u.available?.version;
  const cls = wide ? "upd-wide" : undefined;
  if (u.phase === "ready") return <Button variant="primary" className={cls} onClick={() => { void act("install"); onDone?.(); }}><Icon d={REFRESH} />Restart to update</Button>;
  if (u.phase === "available") return <Button variant="primary" className={cls} onClick={() => void act("download")}><Icon d={DOWN} />Download {next}</Button>;
  if (u.phase === "downloading") return <Button className={cls} disabled><Icon d={REFRESH} spin />Downloading {u.percent ?? 0}%</Button>;
  const checking = u.phase === "checking";
  return <Button className={cls} disabled={checking || u.phase === "unavailable"} onClick={() => void act("check")}><Icon d={REFRESH} spin={checking} />Check for updates</Button>;
}

function Popover({ u, problem, onClose }: { u: UpdateState | null; problem: string | null; onClose: () => void }) {
  if (!u) return <div className="upd-pop" role="dialog" aria-label="Updates"><p className="upd-line">{problem ?? "…"}</p></div>;
  const off = u.phase === "unavailable";
  const offered = u.phase === "available" || u.phase === "downloading" || u.phase === "ready";
  return (
    <div className="upd-pop" role="dialog" aria-label="Updates">
      <div className="upd-head"><h2>Updates</h2><span className="upd-version">v{u.version}</span></div>
      <MainAction u={u} wide onDone={onClose} />
      {u.phase === "downloading" ? <Progress percent={u.percent} /> : null}
      <p className="upd-line" data-tone={u.phase === "failed" ? "bad" : u.phase === "ready" || u.phase === "none" ? "good" : undefined} role="status">
        {problem ?? statusLine(u)}
      </p>
      {offered ? <button type="button" className="upd-link" onClick={() => { window.dispatchEvent(new Event(SHOW_EVENT)); onClose(); }}>What&apos;s new in {u.available?.version}</button> : null}
      <div className="upd-opt">
        <span><strong>Check automatically</strong><small>Look for updates on startup.</small></span>
        <Switch label="Check automatically" checked={u.auto.check} disabled={off} onChange={(check) => void setAuto({ check })} />
      </div>
      <div className="upd-opt">
        <span><strong>Download automatically</strong><small>Otherwise, download only when you ask.</small></span>
        <Switch label="Download automatically" checked={u.auto.download} disabled={off} onChange={(download) => void setAuto({ download })} />
      </div>
    </div>
  );
}

const CHEVRON = "M9 6l6 6l-6 6";

/** Where the flyout sits: beside the account menu's row, bottoms lined up (it grows upwards), inside the window. */
function place(row: DOMRect): { left: number; bottom: number } {
  const width = 300, gap = 12;
  const left = row.right + gap + width <= window.innerWidth - 8 ? row.right + gap : Math.max(8, row.left - gap - width);
  return { left, bottom: Math.max(8, window.innerHeight - row.bottom - 6) };
}

/** The account menu's Updates row; it opens the popover beside the menu. */
export function UpdatesMenuItem() {
  const { u, problem } = useUpdates();
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const row = useRef<HTMLButtonElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  // Clicks in the flyout stay out of the shell's "click outside closes the menu" (it's on <body>, not in the menu).
  useEffect(() => {
    const el = fly.current;
    if (!el) return;
    const keep = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", keep);
    return () => el.removeEventListener("mousedown", keep);
  }, [at]);
  useEffect(() => {
    if (!at) return;
    const away = (e: MouseEvent) => { if (!row.current?.contains(e.target as Node)) setAt(null); };
    const moved = () => setAt(null);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", moved);
    return () => { document.removeEventListener("mousedown", away); window.removeEventListener("resize", moved); };
  }, [at]);
  const dot = needsYou(u);
  const label = u?.phase === "ready" ? "Update ready" : u?.phase === "downloading" ? `Updating ${u.percent ?? 0}%` : "Updates";
  return (
    <>
      <button ref={row} type="button" className="upd-row" aria-haspopup="dialog" aria-expanded={!!at} data-open={at ? "true" : undefined}
        onClick={() => setAt((now) => (now || !row.current ? null : place(row.current.getBoundingClientRect())))}>
        <span className="upd-icon" data-dot={dot || undefined}><Icon d={REFRESH} spin={u?.phase === "checking" || u?.phase === "downloading"} /></span>
        <span>{label}</span>
        {u ? <small className="upd-row-version">v{u.version}</small> : null}
        <svg className="acct-chev" aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={CHEVRON} /></svg>
      </button>
      {at ? createPortal(<div ref={fly} className="upd-fly" style={at}><Popover u={u} problem={problem} onClose={() => setAt(null)} /></div>, document.body) : null}
    </>
  );
}

/** A dot on the account button while an update waits for you. */
export function UpdatesBadge() {
  const { u } = useUpdates();
  return needsYou(u) ? <i className="upd-avatar-dot" aria-label="An update is waiting" /> : null;
}

/** "C-LINK x is available": opens once per version when one is found or downloaded, unless "Later" was picked for it. */
export function UpdatePrompt() {
  const { u } = useUpdates();
  const shown = useRef(new Set<string>());
  const [version, setVersion] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useEffect(() => {
    const want = promptVersion(u, laterVersion(), shown.current);
    if (want) { shown.current.add(want); setVersion(want); }
  }, [u]);
  useEffect(() => {
    const preview = () => { setPreviewing(true); shown.current.clear(); };
    const show = () => { const v = u?.available?.version; if (v) { shown.current.add(v); setVersion(v); } };
    window.addEventListener(PREVIEW_EVENT, preview);
    window.addEventListener(SHOW_EVENT, show);
    return () => { window.removeEventListener(PREVIEW_EVENT, preview); window.removeEventListener(SHOW_EVENT, show); };
  }, [u]);

  const offered = u?.available && (u.phase === "available" || u.phase === "downloading" || u.phase === "ready");
  const close = (later: boolean) => {
    // A preview is never remembered; it stays in the sidebar until "Restart to update" (or a reload) ends it.
    if (later && version && !previewing) rememberLater(version);
    setPreviewing(false);
    setVersion(null);
  };
  useEffect(() => {
    if (!version) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") close(true); };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  });
  if (!version || !u || !offered) return null;
  const ready = u.phase === "ready";
  const notes = u.available?.notes.trim();
  return createPortal(
    <div className="upd-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) close(true); }}>
      <section className="upd-prompt" role="dialog" aria-modal="true" aria-labelledby="upd-prompt-title" aria-describedby="upd-prompt-what">
        <header>
          <span className="upd-badge" aria-hidden="true"><BrandMark /></span>
          <div>
            <p className="upd-eyebrow">{ready ? "Update ready" : "Update available"}</p>
            <h2 id="upd-prompt-title">C-LINK {u.available?.version}</h2>
            <p id="upd-prompt-what">Everything new since C-LINK {u.version}.</p>
          </div>
        </header>
        <div className="upd-notes" tabIndex={0}>{notes ? notes : "This release has the latest improvements and fixes."}</div>
        {u.phase === "downloading" ? <Progress percent={u.percent} /> : null}
        <footer>
          <p>{ready ? "Restart C-LINK to finish. It also installs the next time C-LINK quits."
            : u.phase === "downloading" ? `Downloading ${u.percent ?? 0}%. You can keep using C-LINK.`
            : "C-LINK downloads the update, then restarts to install it."}</p>
          <div className="upd-actions">
            <Button onClick={() => close(true)}>Later</Button>
            <MainAction u={u} onDone={() => close(false)} />
          </div>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
