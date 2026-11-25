// The open editor lent to automation (studioAutomation.ts): its face, history, view and drawing, read through refs so
// a request answered between renders sees the latest. The host is registered with the page's inbox while the face is
// open; a new face (or a reopen) is a new session.
import { useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { decodeImageDataUrl } from "../watchface/engine/watchfaceAutomationImageTools";
import type { WatchfaceSimulation } from "../watchface/engine/watchfaceSimulation";
import type { AutomationHost, Snapshot } from "./studioAutomation";
import { registerAutomationHost } from "./studioAutomationInbox";
import { renderFace, type FaceSource, type Mode } from "./studioFace";

export interface EditorDoc { now: Snapshot | null; past: Snapshot[]; future: Snapshot[] }

export interface EditorView {
  projectId: string;
  source: FaceSource | null;
  doc: EditorDoc;
  setDoc: Dispatch<SetStateAction<EditorDoc>>;
  /** Set when the face has changes to save; the editor saves a moment later. */
  dirty: MutableRefObject<boolean>;
  busy: boolean;
  mode: Mode;
  setMode(mode: Mode): void;
  selection: string[];
  select(ids: string[]): void;
  sim: WatchfaceSimulation;
  setSim(sim: WatchfaceSimulation): void;
  save(snapshot: Snapshot): Promise<void>;
}

/** Registers the editor as the automation host and returns it (Watchmaker reads the revision from it). */
export function useAutomationHost(view: EditorView): AutomationHost | null {
  const live = useRef(view);
  const revision = useRef(0);
  const seen = useRef<Snapshot | null>(null);
  useEffect(() => {
    live.current = view;
    // Any change to the face, by hand or by an agent, is a new revision.
    if (view.doc.now !== seen.current) { seen.current = view.doc.now; revision.current++; }
  });
  const { source, projectId } = view;
  const ready = !!source && !!view.doc.now;

  const host = useMemo<AutomationHost | null>(() => {
    if (!source || !ready) return null;
    const v = () => live.current;
    /** Sets the history now, so the answer already carries the new revision. */
    const put = (next: EditorDoc) => {
      live.current = { ...live.current, doc: next };
      seen.current = next.now;
      revision.current++;
      v().dirty.current = true;
      v().setDoc(next);
    };
    return {
      sessionId: crypto.randomUUID(),
      projectId,
      source,
      snapshot: () => v().doc.now!,
      revision: () => revision.current,
      dirty: () => v().dirty.current,
      busy: () => v().busy,
      canUndo: () => v().doc.past.length > 0,
      canRedo: () => v().doc.future.length > 0,
      commit: (next) => { const d = v().doc; put({ now: next, past: [...d.past.slice(-99), d.now!], future: [] }); },
      undo: () => { const d = v().doc; if (d.past.length) put({ now: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [d.now!, ...d.future] }); },
      redo: () => { const d = v().doc; if (d.future.length) put({ now: d.future[0], past: [...d.past, d.now!], future: d.future.slice(1) }); },
      mode: () => v().mode,
      setMode: (mode) => { live.current = { ...live.current, mode }; v().setMode(mode); },
      selection: () => v().selection,
      select: (ids) => { live.current = { ...live.current, selection: ids }; v().select(ids); },
      simulation: () => v().sim,
      setSimulation: (sim) => { live.current = { ...live.current, sim }; v().setSim(sim); },
      render: (design, mode, size, scenario) => renderFace(source, design, mode, size, scenario),
      decode: decodeImageDataUrl,
      save: async () => { v().dirty.current = false; await v().save(v().doc.now!); },
    };
    // A new session per face opened; edits within it don't make a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, projectId, ready]);

  useEffect(() => (host ? registerAutomationHost(host) : undefined), [host]);
  return host;
}
