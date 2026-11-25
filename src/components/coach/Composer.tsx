"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, KeyboardEvent, ReactNode } from "react";
import { ACCEPT, MAX_FILES, MAX_TOTAL_BYTES, fileBytes, fileKind, fileProblem, type CoachFile } from "@/lib/coach/files";

/** A file picked for the next question, with a preview for photos. */
export interface Attached { id: string; file: CoachFile; bytes: number; preview: string | null }

const MAX_HEIGHT = 280;

function readAs(file: File, kind: CoachFile["kind"]): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("unreadable"));
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(kind === "text" ? result : result.slice(result.indexOf(",") + 1));
    };
    if (kind === "text") reader.readAsText(file); else reader.readAsDataURL(file);
  });
}

const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * The message box: grows with what you type (Enter sends, Shift+Enter starts a new line), and takes photos, PDFs and
 * text files from the button, by dropping them on it, or by pasting a picture.
 */
export function Composer({ value, onChange, onSend, files, onFiles, disabled, busy, onStop, tools, placeholder = "Ask Coach about your training" }: {
  value: string; onChange: (text: string) => void; onSend: () => void;
  files: Attached[]; onFiles: (files: Attached[]) => void;
  disabled?: boolean; busy?: boolean; onStop?: () => void; placeholder?: string;
  /** Shown in the bar after Attach: which AI answers. */
  tools?: ReactNode;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // The box is as tall as its text, up to a limit, then it scrolls.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(MAX_HEIGHT, el.scrollHeight)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);

  const add = async (picked: File[]) => {
    setProblem(null);
    const next = [...files];
    let total = files.reduce((p, f) => p + f.bytes, 0);
    for (const f of picked) {
      if (next.length >= MAX_FILES) { setProblem(`Up to ${MAX_FILES} files with one question.`); break; }
      const kind = fileKind(f.name, f.type);
      if (!kind) { setProblem(`${f.name} isn't a photo, PDF or text file, so Coach can't read it.`); continue; }
      const why = fileProblem({ name: f.name, kind }, f.size);
      if (why) { setProblem(why); continue; }
      if (total + f.size > MAX_TOTAL_BYTES) { setProblem("That's more than 16 MB together. Send fewer or smaller files."); break; }
      try {
        const data = await readAs(f, kind);
        const file: CoachFile = { name: f.name || "file", mime: kind === "pdf" ? "application/pdf" : f.type || "text/plain", kind, data };
        const bytes = fileBytes(file);
        total += bytes;
        next.push({ id: `${f.name}-${f.size}-${f.lastModified}-${next.length}`, file, bytes, preview: kind === "image" ? `data:${file.mime};base64,${data}` : null });
      } catch {
        setProblem(`${f.name} couldn't be read.`);
      }
    }
    onFiles(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (!disabled && !busy) onSend();
  };
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = [...e.clipboardData.files];
    if (pasted.length) { e.preventDefault(); void add(pasted); }
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void add([...e.dataTransfer.files]);
  };
  const canSend = !disabled && !busy && (value.trim().length > 0 || files.length > 0);

  return (
    <div className="co-compose-wrap">
      <div className={`co-compose${over ? " co-drop" : ""}`}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}>
        {files.length ? (
          <ul className="co-files" aria-label="Files to send">
            {files.map((a) => (
              <li key={a.id} className="co-file">
                {a.preview
                  // eslint-disable-next-line @next/next/no-img-element -- a local preview of a picked photo, never fetched
                  ? <img src={a.preview} alt="" className="co-file-thumb" />
                  : <span aria-hidden="true" className="co-file-icon">{a.file.kind === "pdf" ? "PDF" : (/\.([a-z0-9]{1,4})$/i.exec(a.file.name)?.[1] ?? "TXT").toUpperCase()}</span>}
                <span className="co-file-name"><span>{a.file.name}</span><span>{size(a.bytes)}</span></span>
                <button type="button" aria-label={`Remove ${a.file.name}`} className="co-file-x" onClick={() => onFiles(files.filter((x) => x.id !== a.id))}>
                  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.6, strokeLinecap: "round" }}><path d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <textarea
          ref={box} rows={1} aria-label="Message Coach" placeholder={placeholder} disabled={disabled}
          value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
        />
        <div className="co-compose-bar">
          <button type="button" className="co-attach" onClick={() => picker.current?.click()} disabled={disabled || files.length >= MAX_FILES}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" }}>
              <path d="M20.5 11.5l-8.1 8.1a5 5 0 0 1-7.1-7.1l8.5-8.5a3.4 3.4 0 0 1 4.8 4.8l-8.4 8.4a1.7 1.7 0 0 1-2.4-2.4l7.7-7.7" />
            </svg>
            Attach
          </button>
          <input ref={picker} type="file" multiple accept={ACCEPT} hidden aria-hidden="true" tabIndex={-1}
            onChange={(e) => { const list = [...(e.target.files ?? [])]; e.target.value = ""; void add(list); }} />
          {tools}
          <span className="co-hint">Enter to send · Shift+Enter for a new line</span>
          {busy && onStop ? (
            <button type="button" aria-label="Stop" className="co-send co-stop" onClick={onStop}>
              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
            </button>
          ) : (
            <button type="button" aria-label="Send" className="co-send" disabled={!canSend} onClick={onSend}>
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M12 19V5M6 11l6-6 6 6" /></svg>
            </button>
          )}
        </div>
      </div>
      {problem ? <p className="co-compose-note" role="status">{problem}</p> : null}
    </div>
  );
}
