// The Studio editor (desktop only), from the design's editor boards, on the real face model: a COROS template with
// CorosLink's design state over it (studioFace.ts). Layers and an Add library on the left (what the template has but
// the face doesn't show, with drop spots where they'd go, and artwork, time and date parts and an animation to build
// a blank face up), the watch in the middle drawn by the engine at the 800
// master (drag to move, snap to the centre, colour from the bar above it), the inspector on the right, and the
// simulation of time, battery and weather. Every change is saved on this computer a moment later and can be undone.
// Download makes the editable project ZIP, the final watch ZIP or the BIN; Send opens Watch | COROS app | File
// (parts/StudioSend.tsx).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { CorosWatchfaceNativeDataStyle, CorosWatchfaceTemplateDetails } from "../../watchface/types";
import { Button, Segmented } from "@/components/ui";
import { t, tx } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import { getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import {
  activeSimulationScenario, advanceSimulationDateTime, createWatchfaceSimulation,
  type WatchfaceSimulation,
} from "../../watchface/engine/watchfaceSimulation";
import {
  allLayersOf, buildInput, colour, colourOf, detailsOf, editMode, grouped, initialDesign, isChartPart, LAYER_GROUPS, layersOf, masterSize, moveTo,
  openFaceSource, renderFace, resolutionOf, rowOf, rowsOf, separateTime, setVisible, sourceDetailsOf, spotActive, spotKeyOf, spotsOf, supportsAlwaysOn,
  type Design, type EditorLayer, type FaceSource, type Mode, type SpotChoice,
} from "../studioFace";
import { currentGesture } from "../studioGesture";
import { canMove, canResize, isLocked, moveNativeIcon, setLocked, nativeIconBox, nudge, readFrames, readPicture, resizeBy } from "../studioEdits";
import { CHART_GRAPH_ICON, CHART_GRAPH_SHORT, canPreviewPage, chartPageChange, chartPageRows, chartReadoutName, chartReadoutToEdit, chartStartOptions, nextChartPage, showTemplateChartPage, type ChartPageRow, type ChartStartOption } from "../studioCharts";
import { chartReadoutBounds, chartSourceOf } from "../../watchface/engine/chartReadouts";
import {
  addAnalogHands, addAnimation, addBatteryField, addChartPageField, addDatePart, addImage, addNativeField, addNegativeSign, addSeconds, addShape,
  addSlotField, addStatusField, canRemove, deleteLayer, imageLayerId, libraryItems, negativeSignSize, newImage, newShape, restoreTemplateLayer, searchLibrary,
  shapeLayerId, type LibraryContext, type LibraryItem,
} from "../studioLibrary";
import { iconOffsetOf, nextSlotPreview, setIconOffset, setSlotPreview, SLOT_LAYER, slotIconGrip, slotOnFace, slotPreview, slotTypes } from "../studioSlot";
import { renderDefaultAnalogHands } from "../../watchface/engine/watchfaceAnalogHands";
import { importAnimationFrames } from "../../watchface/engine/watchfaceAnimation";
import { defaultStatusIndicatorPosition, renderDefaultBatteryStates, renderDefaultStatusIndicator } from "../../watchface/engine/watchfaceDefaultIndicators";
import { watchfaceStatusGroupOf } from "../../watchface/engine/watchfaceStatusPairs";
import { pickPreviewResolution, pickWatchPreviewResolution, type WatchfaceDatePartId } from "../../watchface/engine/watchfaceStudio";
import { attachWatchfaceFontSnapshots } from "../../watchface/engine/watchfaceFontSnapshots";
import { Dots, FaceInspector, LayerInspector, MultiInspector } from "./StudioInspector";
import { AnimationPlayer, type AnimationPlayback } from "../parts/StudioAnimation";
import { resolveWatchfaceModeDesign } from "../../watchface/engine/watchfaceDisplayModes";
import { FaceView } from "../parts/FaceView";
import { composeDragFrames, composePartFrames, dragKey, snapTargets, type DragFrames } from "../studioDrag";
import { moveBox, snapGaps, snapGuides, snapMove, snapPartners, type Box, type SnapGap, type SnapGuide, type SnapHold, type SnapTarget } from "../studioSnap";
import { Icon } from "../parts/StudioIcon";
import { ConvertDialog, SendDialog, type SendTab } from "../parts/StudioSend";
import { SimPanel, SIM_SPEEDS, type SimSpeed } from "../parts/StudioSimulation";
import { ProjectFolds } from "../parts/StudioProject";
import { arrange, artworkPlace, duplicate, isArtwork, type ArrangeStep } from "../studioArrange";
import { OfficialPicker } from "../parts/StudioOfficialPicker";
import { addOfficialImage, officialArtwork } from "../studioOfficial";
import { openGoogleFonts } from "../studioGoogleFonts";
import { watchfaceSpriteLayerId } from "../../watchface/engine/watchfaceArtworkLayers";
import { navigate, useRouteParams } from "../router";
import { backButtonTried, downloadBin, markBackButtonTried, downloadEditable, downloadFinal, openProject, said, saveProject, type OfficialFrames, type StoredProject } from "../studio";
import { useAutomationHost } from "../useAutomationHost";
import "./studio.css";

// Watchmaker, the AI tab, loads only when it's opened.
const Watchmaker = lazy(() => import("../parts/StudioWatchmaker"));

const FACE_PX = 460;
const LAYER_TYPE = "application/x-clink-face-layer";
const ICON: Partial<Record<EditorLayer["kind"], string>> = {
  background: "image", time: "clock", seconds: "clock", date: "cal", weekday: "cal", separators: "line", battery: "battery",
  batteryIcon: "battery", controlBatteryIcon: "battery", complication: "gauge", metric: "pulse", weather: "sun", animation: "spark",
  configAsset: "image", customSprite: "image", backgroundElement: "rect", arcCut: "arc",
};

/** The face being edited, its name and its undo steps (name and design together). */
interface Snapshot { name: string; design: Design }
interface Doc { now: Snapshot | null; past: Snapshot[]; future: Snapshot[] }

/** The inspector's width: dragged by its left edge, kept on this computer, 280–600 px. */
const INSPECTOR_WIDTH = { min: 280, max: 600, start: 304, key: "studio.inspectorWidth" };
const clampInspector = (w: number) => Math.round(Math.max(INSPECTOR_WIDTH.min, Math.min(INSPECTOR_WIDTH.max, w)));
function savedInspectorWidth(): number {
  try { const v = Number(localStorage.getItem(INSPECTOR_WIDTH.key)); return v ? clampInspector(v) : INSPECTOR_WIDTH.start; } catch { return INSPECTOR_WIDTH.start; }
}

export default function StudioEditor() {
  const { id } = useRouteParams();
  const [inspWidth, setInspWidth] = useState(savedInspectorWidth);
  const inspDrag = useRef<{ x: number; w: number } | null>(null);
  const keepInspWidth = (w: number) => { try { localStorage.setItem(INSPECTOR_WIDTH.key, String(w)); } catch { /* not kept */ } };
  const [doc, setDoc] = useState<Doc>({ now: null, past: [], future: [] });
  const [project, setProject] = useState<StoredProject | null>(null);
  const [source, setSource] = useState<FaceSource | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState<"saved" | "saving" | "failed">("saved");
  const [sel, setSelOne] = useState<string | null>(null);
  // Shift-click adds layers to the selection; the first stays the one the context bar acts on.
  const [extra, setExtra] = useState<string[]>([]);
  const setSel = useCallback((id: string | null) => { setSelOne(id); setExtra([]); }, []);
  // Which state of each shared spot (Bluetooth: on, off, airplane…) the watch draws and the inspector edits.
  const [choice, setChoice] = useState<SpotChoice>({});
  /** Selects a layer; one of a spot's images selects the spot with that state shown. */
  const showLayer = useCallback((id: string) => {
    const at = spotKeyOf(id);
    if (at) setChoice((c) => ({ ...c, [at.spot]: at.key }));
    setSel(id);
  }, [setSel]);
  const [left, setLeft] = useState<"layers" | "add">("layers");
  const [query, setQuery] = useState("");
  const [picking, setPicking] = useState(false); // Add → Chart: choosing the page a new chart starts with
  const [insp, setInsp] = useState<"layer" | "face" | "ai">("layer");
  const [mode, setMode] = useState<Mode>("current");
  const [zoom, setZoom] = useState(1);
  const [snap, setSnap] = useState(true);
  const [guides, setGuides] = useState(true);
  // While dragging: the lines the selection lines up with, the gaps to its neighbours, and the outlines of the layers
  // it's placed against.
  const [snapped, setSnapped] = useState<Snapped>(NO_SNAP);
  const [sim, setSim] = useState<WatchfaceSimulation>(() => createWatchfaceSimulation());
  const [speed, setSpeed] = useState<SimSpeed>("min");
  // The face as last drawn, with the design it was drawn from, and which drawing the page has on screen.
  const [shot, setShot] = useState<{ src: string; design: Design; parts?: { under: string; over: string } } | null>(null);
  // The animation on the canvas: playing, or held on one frame picked in the inspector.
  const [playback, setPlayback] = useState<AnimationPlayback>({ playing: true, still: 0 });
  const [onScreen, setOnScreen] = useState<string | null>(null);
  const frame = shot?.src ?? null;
  // A drag in progress: the layers moving and how far. `held` keeps the drag frames on screen after the drop until
  // the face drawn at the new place is.
  const [drag, setDrag] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [held, setHeld] = useState<{ dx: number; dy: number; from: Design; frames: DragFrames } | null>(null);
  const [frames, setFrames] = useState<DragFrames | null>(null);
  // The same for an icon dragged apart from its number: the face without the icon, and the icon on top.
  const [iconDrag, setIconDrag] = useState<{ dx: number; dy: number } | null>(null);
  const [iconFrames, setIconFrames] = useState<DragFrames | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [sendTab, setSendTab] = useState<SendTab | null>(null);
  const [converting, setConverting] = useState(false);
  // Add → Official: the official COROS library's browser (parts/StudioOfficial.tsx).
  const [official, setOfficial] = useState(false);
  const faceBox = useRef<HTMLDivElement>(null);
  // The pickers behind Add → Image and Add → Animation, and where on the watch the pick should land.
  const imageInput = useRef<HTMLInputElement>(null);
  const framesInput = useRef<HTMLInputElement>(null);
  const pickAt = useRef<{ x: number; y: number } | undefined>(undefined);
  const dirty = useRef(false);
  const design = doc.now?.design ?? null;
  const name = doc.now?.name ?? "";

  // Opens the project: its template from the main process, then the design set up the way CorosLink opens a face.
  useEffect(() => {
    let live = true;
    (async () => {
      const { project: stored } = await openProject(id);
      const faceSource = await openFaceSource(id, stored.firmwareType);
      const opened = await initialDesign(faceSource, stored.design, stored.startedFrom, stored.carried);
      // Google fonts the face names load before it is first drawn; ones that arrive later redraw it (studioGoogleFonts.ts).
      const fonts = await openGoogleFonts(opened, (message) => { if (!live) return; setSource((s) => (s ? { ...s } : s)); if (message) setToast(message); });
      if (!live) return;
      if (fonts.message) setToast(fonts.message);
      setProject(stored); setSource(faceSource);
      setDoc({ now: { name: stored.name, design: opened }, past: [], future: [] });
      // A face set up just now from its template is saved straight away, so it opens the same next time.
      dirty.current = !!stored.startedFrom;
      if (stored.startedFrom) setSaving("saving");
    })().catch((e) => { if (live) setProblem(said(e)); });
    return () => { live = false; };
  }, [id]);

  const say = (text: string) => setToast(text);
  useEffect(() => { if (!toast) return; const tm = setTimeout(() => setToast(null), 3200); return () => clearTimeout(tm); }, [toast]);

  /** A change that can be undone. Changes made during one gesture (studioGesture.ts) are one undo step. */
  const lastGesture = useRef<number | null>(null);
  const apply = useCallback((fn: (s: Snapshot) => Snapshot) => {
    const gesture = currentGesture(), same = gesture !== null && lastGesture.current === gesture;
    lastGesture.current = gesture;
    setDoc((d) => {
      if (!d.now) return d;
      const next = fn(d.now);
      if (next === d.now) return d;
      dirty.current = true;
      return same && d.past.length ? { ...d, now: next } : { now: next, past: [...d.past.slice(-99), d.now], future: [] };
    });
  }, []);
  /** An edit to the design of the screen being edited (Current or Always-on). */
  const edit = useCallback((fn: (design: Design) => Design) => apply((s) => {
    const next = editMode(s.design, mode, fn);
    return next === s.design ? s : { ...s, design: next };
  }), [apply, mode]);
  /**
   * A change to what the preview shows that isn't an edit (the watch's Back button stepping pages or Selectable data):
   * no save, no undo step. It rides along with the next real edit's save.
   */
  const look = useCallback((fn: (design: Design) => Design) => setDoc((d) => {
    if (!d.now) return d;
    const next = editMode(d.now.design, mode, fn);
    return next === d.now.design ? d : { ...d, now: { ...d.now, design: next } };
  }), [mode]);
  const undo = () => setDoc((d) => (d.now && d.past.length ? (dirty.current = true, { now: d.past[d.past.length - 1], past: d.past.slice(0, -1), future: [d.now, ...d.future] }) : d));
  const redo = () => setDoc((d) => (d.now && d.future.length ? (dirty.current = true, { now: d.future[0], past: [...d.past, d.now], future: d.future.slice(1) }) : d));

  // Saves a moment after the last change, with a fresh picture for the home page.
  const saveNow = useCallback(async (snapshot: Snapshot) => {
    if (!source) return;
    setSaving("saving");
    try {
      const previewDataUrl = await renderFace(source, snapshot.design, "current", 320).catch(() => undefined);
      // Snapshots of the fonts the face names, so it draws the same on a computer without them.
      const design = await attachWatchfaceFontSnapshots(snapshot.design).catch(() => snapshot.design);
      await saveProject(id, { name: snapshot.name.trim() || "Untitled face", design, previewDataUrl });
      setSaving("saved");
    } catch { setSaving("failed"); }
  }, [id, source]);
  useEffect(() => {
    if (!doc.now || !dirty.current) return;
    setSaving("saving");
    const snapshot = doc.now;
    const tm = setTimeout(() => { dirty.current = false; void saveNow(snapshot); }, 700);
    return () => clearTimeout(tm);
  }, [doc.now, saveNow]);

  // The MCP server and Watchmaker edit this face through the same history: one applied step is one undo step
  // (useAutomationHost.ts, studioAutomation.ts).
  useAutomationHost({
    projectId: id, source, doc, setDoc, dirty, busy: drag !== null || busy !== null, mode, setMode,
    selection: sel ? [...extra, sel] : [], select: (ids) => { setSelOne(ids.at(-1) ?? null); setExtra(ids.slice(0, -1)); },
    sim, setSim, save: saveNow,
  });

  // The simulation's clock: one tick a tenth of a second, at the chosen speed.
  useEffect(() => {
    if (!sim.playing) return;
    const tm = setInterval(() => setSim((s) => ({ ...s, dateTime: advanceSimulationDateTime(s.dateTime, SIM_SPEEDS[speed] / 10) })), 100);
    return () => clearInterval(tm);
  }, [sim.playing, speed]);
  const scenario = useMemo(() => activeSimulationScenario(sim), [sim]);

  // The watch, drawn by the engine. One drawing at a time; a newer request replaces one still waiting.
  const pixels = Math.min(800, Math.round(FACE_PX * zoom * (typeof devicePixelRatio === "number" ? devicePixelRatio : 1)));
  const queue = useRef<{ running: boolean; next: (() => Promise<{ src: string; design: Design; parts?: { under: string; over: string } }>) | null }>({ running: false, next: null });
  useEffect(() => {
    if (!source || !design) return;
    const q = queue.current;
    // With an animation, the face is also drawn in two parts the frames play between (the watch draws them over the
    // background and under the time and data).
    const animated = mode === "current" && !!resolveWatchfaceModeDesign(design, mode).animation?.enabled;
    q.next = async () => {
      const [src, under, over] = await Promise.all([renderFace(source, design, mode, pixels, scenario, true, choice),
        animated ? renderFace(source, design, mode, pixels, scenario, true, choice, "under") : undefined,
        animated ? renderFace(source, design, mode, pixels, scenario, true, choice, "over") : undefined]);
      return { src, design, parts: under && over ? { under, over } : undefined };
    };
    if (q.running) return;
    q.running = true;
    void (async () => {
      while (q.next) {
        const work = q.next;
        q.next = null;
        try { setShot(await work()); } catch (e) { console.warn("Studio couldn't draw the face.", e); }
      }
      q.running = false;
    })();
  }, [source, design, mode, pixels, scenario, choice]);

  // The layers as listed: images that share a place on the watch are one row (studioFace.ts, "Spots").
  const spots = useMemo(() => (source && design ? spotsOf(allLayersOf(source, design, mode)) : []), [source, design, mode]);
  const layers = useMemo(() => (source && design ? rowsOf(layersOf(source, design, mode), spots, choice) : []), [source, design, mode, spots, choice]);
  const active = useMemo(() => (design ? resolveWatchfaceModeDesign(design, mode) : null), [design, mode]);
  // The other display's layers, for a layer's "Shows on" (always-on is its own design).
  const otherLayers = useMemo(() => {
    if (!source || !design || !supportsAlwaysOn(source)) return [];
    const other = mode === "aod" ? "current" : "aod";
    return rowsOf(layersOf(source, design, other), spotsOf(allLayersOf(source, design, other)), choice);
  }, [source, design, mode, choice]);
  // The Add library: native data, chart pages, status images and the template's hidden parts.
  const library = useMemo<{ ctx: LibraryContext; items: LibraryItem[] } | null>(() => {
    if (!source || !design || !active) return null;
    const details = detailsOf(source, design, mode);
    const m = pickPreviewResolution(details);
    const ctx: LibraryContext = { details, layers: allLayersOf(source, design, mode), face: { width: m?.width ?? masterSize(source), height: m?.height ?? masterSize(source) },
      mode, watchWidth: pickWatchPreviewResolution(source.details, source.watch.model)?.width };
    return { ctx, items: libraryItems(active, ctx) };
  }, [source, design, active, mode]);
  // The selectable slot's types, for stepping through them in the simulation.
  const slotNow = useMemo(() => (library && active && slotOnFace(library.ctx.layers) ? slotTypes(library.ctx.details, active, mode, library.ctx.layers).filter((tm) => tm.on) : []), [library, active, mode]);
  const layer = rowOf(layers, sel) ?? null;
  const selected = useMemo(() => (layer ? [...new Set([layer, ...extra.map((i) => rowOf(layers, i)).filter((l): l is EditorLayer => !!l)])] : []), [layer, extra, layers]);
  const pick = (id: string, add: boolean) => {
    if (!add || !layer) { setSel(id); return; }
    if (id === layer.id) { setSelOne(extra[0] ?? null); setExtra(extra.slice(1)); return; }
    const same = (i: string) => rowOf(layers, i)?.id === id;
    setExtra((x) => (x.some(same) ? x.filter((i) => !same(i)) : [...x, id]));
  };
  const resolution = useMemo(() => (source && design ? resolutionOf(source, design, mode) : null), [source, design, mode]);
  const master = source ? masterSize(source) : 800;
  const scale = (FACE_PX * zoom) / master;
  const hasAutoTime = layers.some((l) => l.id === "autoTime");
  // With the selectable slot picked alone, the previewed type's icon has a grip of its own on the face.
  // An icon that can move apart from its number gets a grip of its own on the face, with one layer picked: the
  // selectable slot's previewed type, or a native field's (a chart page's readouts among them).
  const iconGrip = ((): { label: string; bounds: { x0: number; y0: number; x1: number; y1: number }; move: (x: Design, dx: number, dy: number) => Design } | null => {
    if (!layer || extra.length || !active) return null;
    if (layer.kind === SLOT_LAYER) {
      const g = library && slotNow.length ? slotIconGrip(library.ctx.details, active, slotNow) : null;
      return g ? { label: g.label, bounds: g.bounds, move: (x, dx, dy) => { const o = iconOffsetOf(x, g.id); return setIconOffset(x, g.id, o.dx + dx, o.dy + dy); } } : null;
    }
    const bounds = nativeIconBox(active, layer);
    return bounds ? { label: t("{label} icon", { label: t(layer.label) }), bounds, move: (x, dx, dy) => moveNativeIcon(x, layer, dx, dy) } : null;
  })();
  // Its corners resize it when one layer is picked and something sizes it.
  const resizable = !!layer && !extra.length && !!active && canResize(active, layer, resolution);

  // Drag frames (studioDrag.ts), composed ahead of a drag for the layers it would move: the one under the pointer when
  // it isn't selected, else the selection's movable layers. A drag keeps its own layers until it ends.
  const movable = useCallback((l: EditorLayer) => !!active && canMove(l) && !!l.bounds && !isLocked(active, l), [active]);
  const dragSet = useMemo(() => {
    if (drag) return layers.filter((l) => drag.ids.includes(l.id));
    const under = hover ? layers.find((l) => l.id === hover) : undefined;
    if (under && !selected.some((s) => s.id === under.id)) return movable(under) ? [under] : [];
    return selected.filter(movable);
  }, [drag, hover, layers, selected, movable]);
  const dragSetKey = dragSet.length ? dragKey(dragSet.map((l) => l.id), mode, pixels, choice) : "";
  const scenarioNow = useRef(scenario);
  const choiceNow = useRef(choice);
  const framesNow = useRef(frames);
  const latest = useRef({ design, shot });
  useEffect(() => { scenarioNow.current = scenario; choiceNow.current = choice; framesNow.current = frames; latest.current = { design, shot }; });
  // After a drop the drag frames stay until the face drawn from the moved design is on screen; the picture's own
  // "shown" event lets them go.
  // Only while the drop is the latest change: any later edit or undo ends it.
  const holding = held && doc.past[doc.past.length - 1]?.design === held.from && !redrawn(held, design, shot, onScreen) ? held : null;
  const shownNow = useCallback((src: string) => {
    setOnScreen(src);
    setHeld((h) => (h && redrawn(h, latest.current.design, latest.current.shot, src) ? null : h));
  }, []);
  const waiting = !!holding;
  useEffect(() => {
    // Not while a drop waits for its redraw: that drawing comes first.
    if (!source || !design || !dragSetKey || waiting) return;
    const have = framesNow.current;
    if (have && have.key === dragSetKey && have.design === design) return;
    let live = true;
    const tm = setTimeout(() => {
      composeDragFrames(source, design, mode, dragSet, pixels, scenarioNow.current, choiceNow.current)
        .then((f) => { if (live) setFrames(f); })
        .catch((e) => console.warn("Studio couldn't prepare the drag.", e));
    }, 40);
    return () => { live = false; clearTimeout(tm); };
    // dragSet is keyed by dragSetKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, design, mode, pixels, dragSetKey, waiting]);

  // The icon grip's frames, composed ahead of a drag like the layers' (the icon taken off by moving it past the face,
  // which leaves the number and everything else where they are).
  const iconKey = iconGrip && layer ? `icon:${iconGrip.label}:${dragKey([layer.id], mode, pixels, choice)}` : "";
  const iconMove = useRef(iconGrip?.move);
  const iconFramesNow = useRef(iconFrames);
  useEffect(() => { iconMove.current = iconGrip?.move; iconFramesNow.current = iconFrames; });
  useEffect(() => {
    if (!source || !design || !iconKey || waiting) return;
    const have = iconFramesNow.current;
    if (have && have.key === iconKey && have.design === design) return;
    const move = iconMove.current;
    if (!move) return;
    let live = true;
    const tm = setTimeout(() => {
      composePartFrames(source, design, mode, iconKey, (x) => move(x, master, master), pixels, scenarioNow.current, choiceNow.current)
        .then((f) => { if (live) setIconFrames(f); })
        .catch((e) => console.warn("Studio couldn't prepare the icon drag.", e));
    }, 40);
    return () => { live = false; clearTimeout(tm); };
  }, [source, design, mode, pixels, iconKey, waiting, master]);

  const hide = (l: EditorLayer) => { edit((x) => setVisible(x, l, false, source ?? undefined, mode)); if (layer?.id === l.id) setSel(null); say(t("Hid {name}. Bring it back from Add, or undo with ⌘Z.", { name: t(l.label) })); };

  // Delete: the row's trash, the context bar, the inspector and the Delete key. A locked layer, or several, ask first.
  const remove = (ls: EditorLayer[]) => {
    if (!library || !active) return;
    const { ctx } = library;
    const gone = ls.filter((l) => canRemove(active, l, ctx));
    if (!gone.length) return;
    const locked = gone.filter((l) => isLocked(active, l));
    if (gone.length > 1 && !confirm(!locked.length ? t("Delete {n} layers?", { n: gone.length }) : locked.length === 1 ? t("Delete {n} layers? 1 of them is locked.", { n: gone.length }) : t("Delete {n} layers? {locked} of them are locked.", { n: gone.length, locked: locked.length }))) return;
    if (gone.length === 1 && locked.length && !confirm(t("{name} is locked. Unlock and delete it?", { name: t(gone[0]!.label) }))) return;
    edit((x) => gone.reduce((acc, l) => deleteLayer(acc, l, ctx), x));
    if (layer && gone.some((l) => l.id === layer.id)) setSel(null);
    say(gone.length === 1 ? t("Deleted {name}. Undo with ⌘Z.", { name: t(gone[0]!.label) }) : t("Deleted {n} layers. Undo with ⌘Z.", { n: gone.length }));
  };

  // The face's own artwork: a copy just above it (⌘D), and its paint order (Alt+↑ / Alt+↓, Shift for the front or back).
  const copyArtwork = (l: EditorLayer) => {
    if (!isArtwork(l.id) || !design) return;
    try {
      const out = duplicate(resolveWatchfaceModeDesign(design, mode), l.id);
      if (!out) return;
      edit((x) => duplicate(x, l.id)?.design ?? x); setSel(out.layerId); say(t("Copied {name}.", { name: t(l.label) }));
    } catch (e) { say(e instanceof Error ? e.message : String(e)); }
  };
  const orderArtwork = (l: EditorLayer, step: ArrangeStep) => {
    edit((x) => arrange(x, l.id, step));
    say({ forward: t("Brought forward."), backward: t("Sent backward."), front: t("Brought to the front."), back: t("Sent to the back.") }[step]);
  };

  // Keys: save, undo/redo, hide, nudge, clear. Not while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tm = e.target as HTMLElement;
      if (tm.closest("input, textarea, select, [contenteditable]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); if (doc.now) { dirty.current = false; void saveNow(doc.now); } return; }
      if ((mod && e.key.toLowerCase() === "z") || (e.ctrlKey && e.key.toLowerCase() === "y")) { e.preventDefault(); if (e.shiftKey || e.key.toLowerCase() === "y") redo(); else undo(); return; }
      if (e.key === "Escape") { setSel(null); return; }
      if (!layer || !active) return;
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); copyArtwork(layer); return; }
      if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && isArtwork(layer.id)) {
        e.preventDefault(); orderArtwork(layer, e.key === "ArrowUp" ? (e.shiftKey ? "front" : "forward") : (e.shiftKey ? "back" : "backward")); return;
      }
      // Delete takes artwork and Studio's own seconds and date off the face; a template part it hides (Add brings it back).
      if ((e.key === "Delete" || e.key === "Backspace") && library && selected.some((l) => canRemove(active, l, library.ctx))) { e.preventDefault(); remove(selected); return; }
      if ((e.key === "Delete" || e.key === "Backspace") && layer.canHide) { e.preventDefault(); hide(layer); return; }
      const step = e.shiftKey ? 10 : 1;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d && canMove(layer)) { e.preventDefault(); edit((x) => selected.filter((l) => canMove(l) && !isLocked(x, l)).reduce((acc, l) => nudge(acc, l, d[0], d[1]), x)); }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });
  // Until the watch's Back button has been pressed once on this computer, it glows and its label asks to be
  // pressed. Kept above the early returns below so the hooks run in the same order on every render.
  const [backTried, setBackTried] = useState(backButtonTried);

  if (problem && !doc.now) return <main className="page"><div className="notice" role="alert">{problem} <a href="/studio" onClick={(e) => { e.preventDefault(); navigate("/studio"); }}>{t("Back to Studio")}</a></div></main>;
  if (!doc.now || !design || !active || !source || !project) return <main className="page"><div className="st-loading">{t("Opening the face…")}</div></main>;

  const watch = getWatchfaceTarget(project.firmwareType) ?? source.watch;
  const hasChart = layers.some((l) => l.nativeDataId === "chart");
  // The chart's template pictures are picked through the Chart layer, not one by one.
  const shown = layers.filter((l) => l.visible && l.bounds && l.kind !== "background" && !(hasChart && isChartPart(l)));
  const items = library ? searchLibrary(library.items, query) : [];
  /** The "From COROS faces" tile sits with the other artwork; search finds it by these words. */
  const officialShown = !query.trim() || ["coros", "official", "artwork", "image", "faces", "digits", "icons", "background"].some((w) => w.startsWith(query.trim().toLowerCase()) || query.trim().toLowerCase().includes(w));
  const select = (layerId: string) => { showLayer(layerId); setInsp("layer"); setLeft("layers"); };
  /** Puts a library row on the face (at a point of the watch when dropped there), or selects it when it's there already. */
  const add = async (item: LibraryItem, at?: { x: number; y: number }) => {
    if (!library) return;
    const { ctx } = library;
    if (item.added && !at) { select(item.layerId); return; }
    let change: ((x: Design) => Design) | null = null;
    let layerId = item.layerId;
    const [kind, ...rest] = item.key.split(":"), id = rest.join(":");
    try {
      if (kind === "native") change = (x) => addNativeField(x, id, ctx, at);
      else if (kind === "chart") change = (x) => addChartPageField(x, id, ctx, at);
      else if (kind === "layer") {
        const l = ctx.layers.find((y) => y.id === id);
        // A status indicator comes back whole: every state image the eye hid with it.
        const group = l && watchfaceStatusGroupOf(l.configAssetId?.replace(/^config:/, ""));
        const back = !l ? [] : group ? ctx.layers.filter((y) => y.present && !y.visible && group.states.some((st) => `config:${st.key}` === y.configAssetId)) : [l];
        if (l) change = (x) => [l, ...back.filter((y) => y !== l)].reduce((d, y) => restoreTemplateLayer(d, y, ctx.details, mode, y === l ? at : undefined), x);
      } else if (kind === "slot") {
        change = (x) => addSlotField(x, ctx, at);
        const types = slotTypes(ctx.details, addSlotField(active, ctx, at), mode, ctx.layers).filter((tm) => tm.on);
        edit(change); select(item.layerId);
        say(t("Added {name}: {types}.", { name: t(item.label), types: types.map((tm) => t(tm.label)).join(", ") }));
        return;
      } else if (kind === "status") {
        const art = await renderDefaultStatusIndicator(id, ctx.face.height, active.digitColor);
        if (art) change = (x) => addStatusField(x, id, art, ctx, at, defaultStatusIndicatorPosition);
      } else if (kind === "battery") {
        const states = renderDefaultBatteryStates(ctx.face.width, active.digitColor);
        change = (x) => addBatteryField(x, states);
      } else if (kind === "art" && id === "image") {
        // The picture is chosen first; it lands on the face once it's read (addPicture).
        pickAt.current = at; imageInput.current?.click();
        return;
      } else if (kind === "art") {
        // Made here, once: the undo step may run twice and the layer must keep its id.
        const shape = newShape(active, id as "text" | "rect" | "ellipse" | "line", ctx, at);
        change = (x) => addShape(x, shape);
        layerId = shapeLayerId(shape.id);
      } else if (kind === "time" && id === "seconds") change = (x) => addSeconds(x, ctx, at);
      else if (kind === "time" && id === "analog") {
        // Hands go on both displays at once, so this is one step on the whole face.
        apply((s) => ({ ...s, design: addAnalogHands(s.design, mode, sourceDetailsOf(source, s.design), (d) => renderDefaultAnalogHands(ctx.face.width, d.digitColor, d.accentColor)) }));
        select(item.layerId);
        say(mode === "current" && supportsAlwaysOn(source) ? t("Added Analog hands. Always-on gets the hour and minute hands.") : t("Added Analog hands."));
        return;
      } else if (kind === "date") change = (x) => addDatePart(x, id as WatchfaceDatePartId, ctx, at);
      else if (kind === "sign") {
        const size = negativeSignSize(ctx.face.width), canvas = document.createElement("canvas");
        canvas.width = size.width; canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) return;
        context.fillStyle = active.digitColor;
        context.fillRect(0, 0, size.width, size.height);
        const art = { dataUrl: canvas.toDataURL("image/png"), ...size };
        change = (x) => addNegativeSign(x, art);
      } else if (kind === "animation") {
        pickAt.current = at; framesInput.current?.click();
        return;
      }
    } catch (e) { say(said(e)); return; }
    if (!change) return;
    edit(change);
    select(layerId);
    say(t("Added {name}.", { name: t(item.label) }));
  };
  /** Add → Official: the picked frame becomes an image layer in the middle of the face. */
  const addOfficial = (set: OfficialFrames, frame: number) => {
    if (!library) return;
    const spriteId = crypto.randomUUID(), { face } = library.ctx;
    const place = (x: Design) => addOfficialImage(x, officialArtwork(set, frame), face, face.width / watch.previewSize, spriteId);
    place(active); // says why not (the face is full) before anything changes
    edit(place);
    select(watchfaceSpriteLayerId(spriteId));
    say(t("Added the official image. Drag it into place."));
  };
  /** A picture from this computer (Add → Image, or dropped on the watch) as a free image layer. */
  const addPicture = async (file: File, at?: { x: number; y: number }) => {
    if (!library) return;
    try {
      const sprite = newImage(active, await readPicture(file), crypto.randomUUID(), library.ctx, at);
      edit((x) => addImage(x, sprite));
      select(imageLayerId(sprite.id));
      say(t("Added Image. Drag it on the watch to place it."));
    } catch (e) { say(said(e)); }
  };
  /** A folder of PNG frames as the face's animation, sized in watch pixels. */
  const addFrames = async (files: FileList, at?: { x: number; y: number }) => {
    if (!library) return;
    const { ctx } = library;
    try {
      const imported = await importAnimationFrames(await readFrames(files), ctx.face.width / (ctx.watchWidth ?? ctx.face.width));
      edit((x) => addAnimation(x, imported, ctx, at));
      select("animation");
      say(imported.frames.length === 1 ? t("Added Animation: 1 frame.") : t("Added Animation: {n} frames.", { n: imported.frames.length }));
    } catch (e) { say(said(e)); }
  };
  /** Studio's own image for a state a spot lacks (the inspector's Add image), where the spot already is. */
  const addState = async (key: string) => {
    if (!library) return;
    const art = await renderDefaultStatusIndicator(key, library.ctx.face.height, active.digitColor).catch(() => null);
    if (!art) return;
    edit((x) => addStatusField(x, key, art, library.ctx, undefined, defaultStatusIndicatorPosition));
    showLayer(`configAsset:config:${key}`);
  };
  const stateLabel = (l: EditorLayer) => (l.spot ? ` · ${t(spotActive(l.spot, choice).label)}` : "");
  // Add → Chart: one entry for the whole chart. On a face with one it selects it; else it asks for the first page.
  const chartOn = !!active.nativeData?.chart?.enabled;
  const chartRows = library ? chartPageRows(active, library.ctx.details) : [];
  const chartPages = chartRows.filter((r) => r.on).length;
  // The watch shows one chart page at a time: the strip under it and the Back button on its bezel step through them.
  const pageStrip = chartOn && mode === "current" && !sim.enabled ? chartRows.filter((r) => r.on) : [];
  const nextPage = pageStrip.length ? nextChartPage(chartRows) : null;
  // With no chart page to step to, Back steps the Selectable data through the types it offers.
  const slotNext = !nextPage && mode === "current" && !sim.enabled && slotNow.length > 1 ? nextSlotPreview(slotNow, slotPreview(slotNow, active), 1) : "";
  const canBack = !!nextPage || !!slotNext;
  /**
   * Shows a chart page (Back: without making it an edit). A page only the template has (the chart layer holds one readout of
   * a template's face) borrows the template's own readout for it, which then rides along with the next save.
   */
  const lookAtPage = async (pageId: string, change = look) => {
    if (!source || !library) return;
    const next = await chartPageChange(active, pageId, library.ctx.details, source.loadAssets);
    if (next) change(next);
  };
  const stepBack = () => {
    if (nextPage) void lookAtPage(nextPage);
    else if (slotNext) look((x) => setSlotPreview(x, slotNext));
    else return;
    if (!backTried) { markBackButtonTried(); setBackTried(true); }
  };
  const openChart = () => { if (chartOn) { setSel("native:chart"); setInsp("layer"); setLeft("layers"); } else setPicking(true); };
  const startChart = (option: ChartStartOption) => {
    if (!library) return;
    const { ctx } = library;
    edit((x) => addChartPageField(x, option.key.slice("chart:".length), ctx));
    setPicking(false); setSel("native:chart"); setInsp("layer"); setLeft("layers");
    say(t("Added {name}.", { name: t(option.label) }));
  };
  const splitTime = () => { edit(separateTime); setSel("hours"); setInsp("layer"); say(t("Hours and minutes are separate layers now.")); };

  /** Master pixels for a point on the screen. */
  const toMaster = (clientX: number, clientY: number) => {
    const r = faceBox.current!.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * master, y: ((clientY - r.top) / r.height) * master };
  };

  const startDrag = (l: EditorLayer) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // No text selection and no native drag picture while dragging on the watch.
    e.preventDefault();
    if (e.shiftKey) { pick(l.id, true); setInsp("layer"); return; }
    const inSelection = selected.some((s) => s.id === l.id);
    if (!inSelection) setSel(l.id);
    setInsp("layer");
    if (!movable(l)) return;
    // Dragging one of the selected layers moves the selection's movable layers together.
    const moving = inSelection ? selected.filter(movable) : [l];
    const ids = moving.map((m) => m.id), key = dragKey(ids, mode, pixels, choice), from = design;
    const b = moving.reduce<{ x0: number; y0: number; x1: number; y1: number }>((u, m) => ({ x0: Math.min(u.x0, m.bounds!.x0), y0: Math.min(u.y0, m.bounds!.y0), x1: Math.max(u.x1, m.bounds!.x1), y1: Math.max(u.y1, m.bounds!.y1) }), { ...l.bounds! });
    const start = toMaster(e.clientX, e.clientY);
    // Snapping (studioSnap.ts) lines up what the layers draw once the drag frames have measured it, else their boxes.
    // Within 6 screen px, whatever the zoom.
    let lineUp: { frames: DragFrames | null; moving: typeof b; targets: SnapTarget[] } | null = null;
    const snapping = () => {
      const f = framesNow.current?.key === key && framesNow.current.design === from ? framesNow.current : null;
      if (lineUp && lineUp.frames === f) return lineUp;
      const targets = snapTargets(layers, new Set([...ids, ...(f?.lifted ?? [])]))
        .map((tm) => ({ ...tm, box: f?.ink.targets.get(tm.id) ?? tm.box }));
      return (lineUp = { frames: f, moving: f?.ink.moving ?? b, targets });
    };
    let moved = false, last = { dx: 0, dy: 0 }, snaps = NO_SNAP, hold: Partial<Record<"x" | "y", SnapHold>> = {}, raf = 0;
    // One state update a frame, however often the pointer reports.
    const paint = () => { raf = 0; setSnapped(snaps); setDrag({ ids, ...last }); };
    const move = (ev: PointerEvent) => {
      const p = toMaster(ev.clientX, ev.clientY);
      let dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / scale) return;
      moved = true;
      const lock = ev.shiftKey ? (Math.abs(dx) > Math.abs(dy) ? "x" : "y") : null;
      if (lock === "x") dy = 0; else if (lock === "y") dx = 0;
      snaps = NO_SNAP;
      if (snap && !ev.altKey) {
        const at = snapping();
        const r = snapMove({ moving: at.moving, dx, dy, targets: at.targets, face: master, threshold: 6 / scale, held: hold, lock });
        ({ dx, dy } = r); hold = r.held;
        last = { dx: Math.round(dx), dy: Math.round(dy) };
        const moved = moveBox(at.moving, last.dx, last.dy);
        const lines = snapGuides(moved, at.targets, master), gaps = snapGaps(moved, at.targets), against = snapPartners(lines, gaps);
        snaps = { lines, gaps, outlines: at.targets.filter((tm) => against.has(tm.id)).map((tm) => tm.box) };
      } else {
        hold = {};
        last = { dx: Math.round(dx), dy: Math.round(dy) };
      }
      if (!raf) raf = requestAnimationFrame(paint);
    };
    let done = false;
    const up = () => {
      if (done) return;
      done = true;
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
      setSnapped(NO_SNAP); setDrag(null);
      if (!moved || (!last.dx && !last.dy)) return;
      // The drag frames stay where they were dropped until the face is drawn there.
      const f = framesNow.current;
      if (f && f.key === key && f.design === from) setHeld({ ...last, from, frames: f });
      edit((x) => moving.filter((m) => !isLocked(x, m)).reduce((acc, m) => nudge(acc, m, last.dx, last.dy), x));
    };
    // On the window rather than captured by the box: selecting re-orders the boxes, which drops a pointer capture.
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };

  /**
   * A corner of the selection box dragged: the layer grows or shrinks evenly, the opposite corner staying put (Alt:
   * the middle). The face redraws as it goes; letting go leaves one undo step.
   */
  const startResize = (l: EditorLayer, corner: 0 | 1 | 2 | 3) => (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !source || !doc.now || !l.bounds) return;
    e.preventDefault(); e.stopPropagation();
    const before = doc.now, from = before.design, res = resolutionOf(source, from, mode), b = l.bounds;
    // Corners in the order they're drawn: top left, top right, bottom left, bottom right.
    const right = corner === 1 || corner === 3, bottom = corner >= 2;
    const grabbed = { x: right ? b.x1 : b.x0, y: bottom ? b.y1 : b.y0 };
    const boundsIn = (root: Design) => {
      const all = layersOf(source, root, mode);
      return rowOf(rowsOf(all, spotsOf(allLayersOf(source, root, mode)), choice), l.id)?.bounds ?? null;
    };
    let factor = 1, raf = 0, changed = false;
    const paint = (alt: boolean) => {
      raf = 0;
      const anchorOf = (r: NonNullable<EditorLayer["bounds"]>) => alt
        ? { x: (r.x0 + r.x1) / 2, y: (r.y0 + r.y1) / 2 }
        : { x: right ? r.x0 : r.x1, y: bottom ? r.y0 : r.y1 };
      const sized = editMode(from, mode, (x) => resizeBy(x, l, factor, res) ?? x);
      const now = boundsIn(sized), was = anchorOf(b), at = now ? anchorOf(now) : was;
      const next = now ? editMode(sized, mode, (x) => nudge(x, l, was.x - at.x, was.y - at.y)) : sized;
      changed = next !== from;
      setDoc((d) => (d.now ? { ...d, now: { ...d.now, design: next } } : d));
    };
    const move = (ev: PointerEvent) => {
      const p = toMaster(ev.clientX, ev.clientY);
      const a = ev.altKey ? { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 } : { x: right ? b.x0 : b.x1, y: bottom ? b.y0 : b.y1 };
      const ux = grabbed.x - a.x, uy = grabbed.y - a.y, len = Math.hypot(ux, uy);
      if (len < 1) return;
      // How far along the box's diagonal the pointer is, against where the corner started.
      factor = Math.max(0.1, Math.min(8, ((p.x - a.x) * ux + (p.y - a.y) * uy) / (len * len)));
      if (!raf) raf = requestAnimationFrame(() => paint(ev.altKey));
    };
    const up = () => {
      removeEventListener("pointermove", move); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      if (!changed) return;
      dirty.current = true;
      setDoc((d) => (d.now ? { now: d.now, past: [...d.past.slice(-99), before], future: [] } : d));
    };
    addEventListener("pointermove", move); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };

  /**
   * The slot's icon dragged on its own (the slot's Icon offset): the value stays, the face redraws as it goes, Shift
   * keeps it on one axis, and letting go leaves one undo step.
   */
  const startIconDrag = (move: (x: Design, dx: number, dy: number) => Design, e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || !doc.now) return;
    e.preventDefault(); e.stopPropagation();
    const before = doc.now, from = before.design, start = toMaster(e.clientX, e.clientY), key = iconKey;
    // With the frames ready, only the icon's picture follows the pointer and the face is drawn once, after the drop;
    // until they are, the face redraws as it goes.
    const ready = () => { const f = iconFramesNow.current; return f && f.key === key && f.design === from && f.sprite ? f : null; };
    let raf = 0, changed = false, moved = false, last = { dx: 0, dy: 0 };
    const paint = () => {
      raf = 0;
      if (ready()) { setIconDrag({ ...last }); return; }
      // Always from where the drag began, so the moves don't add up.
      const next = editMode(from, mode, (x) => move(x, last.dx, last.dy));
      changed = next !== from;
      setDoc((d) => (d.now ? { ...d, now: { ...d.now, design: next } } : d));
    };
    const onMove = (ev: PointerEvent) => {
      const p = toMaster(ev.clientX, ev.clientY);
      let dx = p.x - start.x, dy = p.y - start.y;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 3 / scale) return;
      moved = true;
      if (ev.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      last = { dx: Math.round(dx), dy: Math.round(dy) };
      if (!raf) raf = requestAnimationFrame(paint);
    };
    const up = () => {
      removeEventListener("pointermove", onMove); removeEventListener("pointerup", up); removeEventListener("pointercancel", up);
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      setIconDrag(null);
      const f = ready();
      if (f && !changed) {
        if (!last.dx && !last.dy) return;
        // The frames stay where they were dropped until the face is drawn there.
        setHeld({ ...last, from, frames: f });
        edit((x) => move(x, last.dx, last.dy));
        return;
      }
      if (!changed) return;
      dirty.current = true;
      setDoc((d) => (d.now ? { now: d.now, past: [...d.past.slice(-99), before], future: [] } : d));
    };
    addEventListener("pointermove", onMove); addEventListener("pointerup", up); addEventListener("pointercancel", up);
  };

  const onDrop = (e: DragEvent) => {
    const key = e.dataTransfer.getData(LAYER_TYPE);
    const item = library?.items.find((x) => x.key === key);
    // A picture dragged in from the computer becomes an image layer where it lands.
    const picture = item ? undefined : [...e.dataTransfer.files].find((f) => /^image\/(png|jpeg|webp)$/i.test(f.type));
    if (!item && !picture) return;
    e.preventDefault();
    const at = toMaster(e.clientX, e.clientY);
    if (item) void add(item, at); else if (picture) void addPicture(picture, at);
  };

  const run = async (label: string, work: () => Promise<string | void>) => {
    setMenu(false); setBusy(label); setProblem(null);
    try { const done = await work(); if (done) say(done); } catch (e) { setProblem(said(e)); } finally { setBusy(null); }
  };
  const makeEditable = async () => {
    const previewDataUrl = await renderFace(source, design, "current", 800);
    await downloadEditable(id, { name: name.trim() || "Untitled face", design: await attachWatchfaceFontSnapshots(design).catch(() => design), previewDataUrl });
  };
  const downloads = {
    editable: () => run(t("Making the editable project…"), async () => {
      await makeEditable();
      return t("Editable project ready. It opens in Studio here and in CorosLink.");
    }),
    final: () => run(t("Building the watch archive…"), async () => {
      await downloadFinal(id, await buildInput(source, design));
      return t("Final watch ZIP for {watch} ready.", { watch: watch.label });
    }),
    bin: () => run(t("Compiling for the watch…"), async () => {
      const { warnings } = await downloadBin(id, await buildInput(source, design));
      return warnings.length ? `${t("BIN ready.")} ${warnings[0]}` : t("BIN for {watch} ready and checked.", { watch: watch.label });
    }),
  };

  // A snap line: the face's centre runs past the dial; a line to other layers runs a little past them.
  const guide = (g: SnapGuide) => {
    const out = g.face ? 24 : 6, from = g.face ? -out : g.from * scale - out, length = g.face ? FACE_PX * zoom + 2 * out : (g.to - g.from) * scale + 2 * out;
    return g.axis === "x" ? { left: g.at * scale - 0.5, top: from, width: 1, height: length } : { top: g.at * scale - 0.5, left: from, height: 1, width: length };
  };
  // A gap to a neighbour: a bar along the gap with ticks at its ends, and its size in the middle.
  const gap = (g: SnapGap) => g.axis === "x"
    ? { left: g.from * scale, width: (g.to - g.from) * scale, top: g.at * scale - 5, height: 10 }
    : { top: g.from * scale, height: (g.to - g.from) * scale, left: g.at * scale - 5, width: 10 };
  const spot = (b: { x0: number; y0: number; x1: number; y1: number }) => ({ left: b.x0 * scale, top: b.y0 * scale, width: Math.max(6, (b.x1 - b.x0) * scale), height: Math.max(6, (b.y1 - b.y0) * scale) });
  const box = (l: EditorLayer) => {
    const b = l.bounds!, d = drag?.ids.includes(l.id) ? drag : { dx: 0, dy: 0 };
    return { left: (b.x0 + d.dx) * scale, top: (b.y0 + d.dy) * scale, width: Math.max(6, (b.x1 - b.x0) * scale), height: Math.max(6, (b.y1 - b.y0) * scale) };
  };
  // While dragging, and after a drop until the face is redrawn: the face without the moving layers, and them on top.
  const live = drag && frames && frames.design === design && frames.key === dragKey(drag.ids, mode, pixels, choice) ? { ...drag, frames } : null;
  const iconLive = iconDrag && iconFrames && iconFrames.design === design && iconFrames.key === iconKey ? { ...iconDrag, frames: iconFrames } : null;
  const lifted = live ?? iconLive ?? holding;
  const k = lifted ? (FACE_PX * zoom) / lifted.frames.size : 1;
  const sprite = lifted?.frames.sprite;
  const animation = mode === "current" && active?.animation?.enabled && active.animation.frames.length ? active.animation : null;
  const over = !lifted && animation && shot?.parts
    ? <AnimationPlayer animation={animation} parts={shot.parts} scale={scale} playback={playback} />
    : lifted ? <>
    <img className="st-face-img st-drag-base" src={lifted.frames.base} alt="" draggable={false} />
    {sprite ? <img className="st-drag-sprite" src={sprite.src} alt="" draggable={false}
      style={{ left: sprite.x * k, top: sprite.y * k, width: sprite.w * k, height: sprite.h * k, transform: `translate(${lifted.dx * scale}px, ${lifted.dy * scale}px)` }} /> : null}
  </> : null;
  const savedText = saving === "saving" ? t("Saving…") : saving === "failed" ? t("Not saved") : t("Saved");
  const canColour = !!layer?.capabilities.color;

  return (
    <main className="st-editor">
      <header className="st-top">
        <a className="st-back" href="/studio" onClick={(e) => { e.preventDefault(); navigate("/studio"); }}><Icon name="chevL" size={16} width={2.2} />{t("Studio")}</a>
        <span className="st-sep" aria-hidden="true" />
        <FaceView src={frame} size={30} />
        <input className="st-name" aria-label={t("Face name")} value={name} maxLength={80}
          onChange={(e) => { const value = e.target.value; dirty.current = true; setDoc((d) => (d.now ? { ...d, now: { ...d.now, name: value } } : d)); }}
          onBlur={(e) => { if (!e.target.value.trim()) setDoc((d) => (d.now ? { ...d, now: { ...d.now, name: "Untitled face" } } : d)); }} />
        <span className="st-saved" data-state={saving}><i aria-hidden="true" />{savedText}</span>
        <span className="st-watch-chip"><Icon name="watch" size={15} />{watch.label} <span className="muted">{watch.previewSize} × {watch.previewSize}</span></span>
        <span className="st-grow" />
        <button type="button" className="st-icon-btn" aria-label={t("Undo")} title={t("Undo ⌘Z")} disabled={!doc.past.length} onClick={undo}><Icon name="undo" /></button>
        <button type="button" className="st-icon-btn" aria-label={t("Redo")} title={t("Redo ⇧⌘Z")} disabled={!doc.future.length} onClick={redo}><Icon name="redo" /></button>
        <div className="st-menu-wrap">
          <Button disabled={!!busy} aria-expanded={menu} onClick={() => setMenu((m) => !m)}><Icon name="download" size={16} />{busy ?? t("Download")}</Button>
          {menu ? (
            <div className="st-menu st-menu-down" role="menu">
              <button type="button" role="menuitem" onClick={() => void downloads.bin()}><Icon name="watch" size={16} /><span><b>{t("Save BIN")}</b><small>{t("Compiled for {watch}, ready to install", { watch: watch.label })}</small></span></button>
              <button type="button" role="menuitem" onClick={() => void downloads.final()}><Icon name="download" size={16} /><span><b>{t("Final watch ZIP")}</b><small>{t("The face as the COROS app takes it")}</small></span></button>
              <button type="button" role="menuitem" onClick={() => void downloads.editable()}><Icon name="folder" size={16} /><span><b>{t("Editable project ZIP")}</b><small>{t("Opens in Studio and CorosLink")}</small></span></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setSendTab("file"); }}><Icon name="watch" size={16} /><span><b>{t("All watches")}</b><small>{t("Final ZIPs for every model, one folder")}</small></span></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setConverting(true); }}><Icon name="convert" size={16} /><span><b>{t("Convert for another watch…")}</b><small>{t("APEX 4, VERTIX 2S, NOMAD and more")}</small></span></button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setSendTab("file"); }}><Icon name="code" size={16} /><span><b>{t("Development export")}</b><small>{t("Config and images, unpacked")}</small></span></button>
            </div>
          ) : null}
        </div>
        <Button onClick={() => { setMenu(false); setConverting(true); }}><Icon name="convert" size={16} />{t("Convert")}</Button>
        <Button variant="primary" onClick={() => { setMenu(false); setSendTab("watch"); }}><Icon name="send" size={16} />{t("Send")}</Button>
      </header>
      {problem ? <div className="notice st-editor-notice" role="alert">{problem}</div> : null}

      <div className="st-work">
        {/* ───── Left: layers and what can be added ───── */}
        <aside className="st-left" aria-label={t("Layers and library")}>
          <Segmented label={t("Left panel")} value={left} onChange={setLeft} className="st-tabs"
            options={[{ value: "layers", label: <><Icon name="layers" size={15} />{t("Layers")}</> }, { value: "add", label: <><Icon name="plus" size={15} width={2.2} />{t("Add")}</> }]} />
          {left === "layers" ? (
            <div className="st-layers">
              {grouped(layers).map((g) => (
                <section key={g.id} className="st-layer-group" aria-label={t(g.label)}>
                  <h3>{t(g.label)}</h3>
                  {g.layers.map((l) => (
                    <div key={l.spot?.id ?? l.id} className="st-layer-row" data-on={l.id === layer?.id || undefined} data-hidden={!l.visible || undefined}>
                      <button type="button" className="st-layer-pick" data-picked={(l.id !== layer?.id && selected.includes(l)) || undefined} onClick={(e) => { pick(l.id, e.shiftKey); setInsp("layer"); }}>
                        <Icon name={l.spot ? SPOT_ICON[l.spot.id] ?? "image" : ICON[l.kind] ?? "rect"} size={16} /><span>{t(l.label)}</span>
                        {l.spot ? <span className="st-layer-state">{t(spotActive(l.spot, choice).label)}</span> : null}
                      </button>
                      {library && canRemove(active, l, library.ctx) ? (
                        <button type="button" className="st-icon-btn st-row-act" aria-label={t("Delete {name}", { name: t(l.label) })} title={isLocked(active, l) ? t("Unlock and delete") : t("Delete")} onClick={() => remove([l])}>
                          <Icon name="trash" size={15} />
                        </button>
                      ) : null}
                      {canMove(l) && l.bounds ? (
                        <button type="button" className="st-icon-btn st-row-act st-lock" data-locked={isLocked(active, l) || undefined} aria-pressed={isLocked(active, l)}
                          aria-label={isLocked(active, l) ? t("Unlock {name} position", { name: t(l.label) }) : t("Lock {name} position", { name: t(l.label) })} title={isLocked(active, l) ? t("Unlock position") : t("Lock position")}
                          onClick={() => edit((x) => setLocked(x, l, !isLocked(x, l)))}>
                          <Icon name={isLocked(active, l) ? "lock" : "unlock"} size={15} />
                        </button>
                      ) : null}
                      {l.canHide ? (
                        <button type="button" className="st-icon-btn st-eye" aria-label={l.visible ? t("Hide {name}", { name: t(l.label) }) : t("Show {name}", { name: t(l.label) })} onClick={() => edit((x) => setVisible(x, l, !l.visible, source, mode))}>
                          <Icon name={l.visible ? "eye" : "eyeOff"} size={16} />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </section>
              ))}
              <div className="st-grow" />
              {supportsAlwaysOn(source) ? (
                <div className="st-aod-card">
                  <span className="st-aod-icon"><Icon name="moon" size={16} /></span>
                  <span><b>{t("Always-on")}</b><small>{t("Its own layout, edited on its own.")}</small></span>
                  <Button className="st-wide" onClick={() => { setMode(mode === "aod" ? "current" : "aod"); setSel(null); }}>{mode === "aod" ? t("Back to the face") : t("Edit always-on")}</Button>
                </div>
              ) : (
                <div className="st-aod-card"><span className="st-aod-icon"><Icon name="moon" size={16} /></span><span><b>{t("Always-on")}</b><small>{t("On {watch} the face itself stays on.", { watch: watch.label })}</small></span></div>
              )}
            </div>
          ) : picking && !chartOn && library ? (
            <div className="st-ch-pick">
              <div className="st-ch-pick-head">
                <button type="button" className="st-icon-btn" aria-label={t("Back to Add")} onClick={() => setPicking(false)}><Icon name="chevL" size={18} width={2.2} /></button>
                <b>{t("Chart")}</b>
              </div>
              <p className="st-hint">{t("One page at a time; the watch's Back button goes to the next. Pick the first:")}</p>
              {chartStartOptions(active, library.ctx.details).map((o) => (
                <button key={o.key} type="button" className="st-ch-opt" aria-label={t("Add {name}", { name: t(o.label) })} onClick={() => startChart(o)}>
                  <span className="st-ch-opt-top">
                    <span className="st-ch-mini"><Icon name={CHART_GRAPH_ICON[o.graph]} size={20} /></span>
                    <span><b>{t(o.label)}</b><small>{t(o.sub)}</small></span>
                    <span className="st-ch-kind">{t(CHART_GRAPH_SHORT[o.graph])}</span>
                  </span>
                  {o.hides.length || o.note ? <span className="st-ch-fx">
                    {o.hides.length ? <span className="st-ch-wx"><span className="st-ch-fx-label">{t("Hides")}</span>{o.hides.map((f) => <span key={f.id} className="st-ch-tag" data-kind="minus">{t(f.label)}</span>)}</span> : null}
                    {o.note ? <span className="st-ch-tag" data-kind="note">{t(o.note)}</span> : null}
                  </span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="st-lib">
              <label className="st-search"><Icon name="search" size={15} />
                <input type="search" aria-label={t("Search what can be added")} placeholder={t("Text, seconds, heart rate, weather…")} value={query} onChange={(e) => setQuery(e.target.value)} />
              </label>
              {hasAutoTime ? (
                <div className="st-lib-section">
                  <h3>{tx("clock", "Time")}</h3>
                  <div className="st-tiles">
                    <button type="button" className="st-tile" onClick={splitTime}>
                      <span className="st-tile-prev"><span className="st-prev-time"><span>10</span><span style={{ color: "#53cba1" }}>08</span></span></span>
                      <span className="st-tile-name"><span>{t("Hours and minutes apart")}</span></span>
                    </button>
                  </div>
                </div>
              ) : null}
              {[{ id: "artwork", label: t("Artwork"), note: ` · ${t("part of the picture")}`, rows: items.filter((i) => i.repeat) },
                ...LIBRARY_ORDER.map((gid) => ({ id: gid as string, label: gid === "basic" ? t("Template images") : gid === "charts" && !query.trim() ? t("Chart") : t(LAYER_GROUPS.find((g) => g.id === gid)?.label ?? ""),
                  note: gid === "charts" && query.trim() ? ` · ${t("pages")}` : "", rows: items.filter((i) => i.group === gid && !i.repeat) }))].map((section) => section.rows.length || (section.id === "artwork" && officialShown) ? (
                <div key={section.id} className="st-lib-section">
                  <h3>{section.label}{section.note ? <span className="st-lib-note">{section.note}</span> : null}</h3>
                  <div className="st-tiles">
                    {section.id === "charts" && !query.trim() ? (
                      <button type="button" className="st-ch-card" aria-label={t("Chart")} onClick={openChart}>
                        <span className="st-ch-card-prev">
                          <span className="st-ch-mini"><Icon name="chart" size={20} /></span><Icon name="chevR" size={13} width={2.4} />
                          <span className="st-ch-mini"><Icon name="wave" size={20} /></span><Icon name="chevR" size={13} width={2.4} />
                          <span className="st-ch-mini"><Icon name="nums" size={20} /></span>
                        </span>
                        <span className="st-ch-card-name"><span>{t("Chart")}</span>{chartOn ? <Icon name="check" size={13} width={2.6} /> : null}
                          <small>{chartOn ? (chartPages === 1 ? t("1 page") : t("{n} pages", { n: chartPages })) : t("6 pages to pick from")}</small></span>
                      </button>
                    ) : section.rows.map((i) => (
                      // A row that opens a file picker can't be dropped: the picker needs a click.
                      <button key={i.key} type="button" className="st-tile" data-added={i.added || undefined} draggable={!i.added && !PICKS.has(i.key)}
                        aria-label={i.added ? t("Select {name}", { name: t(i.label) }) : t("Add {name}", { name: t(i.label) })} title={i.hint ? t(i.hint) : undefined}
                        onDragStart={(e) => { e.dataTransfer.setData(LAYER_TYPE, i.key); e.dataTransfer.effectAllowed = "copy"; }}
                        onClick={() => void add(i)}>
                        <span className="st-tile-prev">{i.icons ? i.icons.map((n) => <Icon key={n} name={n} size={18} />) : <Icon name={i.icon} size={18} />}{i.sample ? <span className="st-tile-sample">{i.sample}</span> : null}</span>
                        <span className="st-tile-name"><span>{t(i.label)}</span>{i.added ? <Icon name="check" size={13} width={2.6} /> : null}</span>
                      </button>
                    ))}
                    {section.id === "artwork" && officialShown ? (
                      // Digits, icons and backgrounds cut from COROS's own faces (parts/StudioOfficialPicker.tsx).
                      <button type="button" className="st-tile" aria-label={t("Add an image from COROS faces")} title={t("Digits, icons and backgrounds from COROS's own faces")} onClick={() => setOfficial(true)}>
                        <span className="st-tile-prev"><Icon name="image" size={18} /></span>
                        <span className="st-tile-name"><span>{t("From COROS faces")}</span></span>
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null)}
              <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label={t("Image file")}
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void addPicture(f, pickAt.current); }} />
              <input ref={framesInput} type="file" hidden multiple accept="image/png" aria-label={t("Animation frames folder")} {...{ webkitdirectory: "" }}
                onChange={(e) => { const files = e.target.files; if (files?.length) void addFrames(files, pickAt.current).finally(() => { e.target.value = ""; }); }} />
              {!items.length && !officialShown ? <p className="st-hint">{t("Nothing by that name.")}</p> : null}
            </div>
          )}
        </aside>

        {/* ───── The watch ───── */}
        <section className="st-canvas" aria-label={t("Watch")} data-pages={pageStrip.length ? true : undefined} onDragOver={(e) => { if (e.dataTransfer.types.includes(LAYER_TYPE) || e.dataTransfer.types.includes("Files")) e.preventDefault(); }} onDrop={onDrop}
          onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
          <div className="st-canvas-top">
            {layer ? (
              <div className="st-context" role="toolbar" aria-label={t("{name} tools", { name: t(layer.label) })}>
                {canColour ? <Dots value={colourOf(active, layer)} onPick={(c) => edit((x) => colour(x, layer, c))} /> : <span className="st-context-name">{t(layer.label)}</span>}
                {layer.id === "autoTime" ? <><span className="st-sep" aria-hidden="true" /><Button onClick={splitTime}>{t("Separate hours and minutes")}</Button></> : null}
                {layer.capabilities.position ? <>
                  <span className="st-sep" aria-hidden="true" />
                  <button type="button" className="st-icon-btn" aria-label={t("Back to the template's place")} title={t("Back to the template's place")} onClick={() => edit((x) => moveTo(x, layer, 0, 0))}><Icon name="refresh" /></button>
                </> : null}
                {layer.canHide ? <button type="button" className="st-icon-btn" aria-label={t("Hide")} title={library && canRemove(active, layer, library.ctx) ? t("Hide") : t("Hide (⌫)")} onClick={() => hide(layer)}><Icon name="eyeOff" /></button> : null}
                {canMove(layer) && layer.bounds ? (
                  <button type="button" className="st-icon-btn" aria-pressed={isLocked(active, layer)} aria-label={isLocked(active, layer) ? t("Unlock position") : t("Lock position")} title={isLocked(active, layer) ? t("Unlock position") : t("Lock position")}
                    onClick={() => edit((x) => setLocked(x, layer, !isLocked(x, layer)))}><Icon name={isLocked(active, layer) ? "lock" : "unlock"} /></button>
                ) : null}
                {library && canRemove(active, layer, library.ctx) ? <button type="button" className="st-icon-btn" aria-label={t("Delete")} title={t("Delete (⌫)")} onClick={() => remove(selected)}><Icon name="trash" /></button> : null}
              </div>
            ) : null}
          </div>

          <div className="st-canvas-face" onPointerDown={(e) => { if (e.target === e.currentTarget) setSel(null); }}>
            <div className="st-bezel" style={{ width: FACE_PX * zoom, height: FACE_PX * zoom }}>
              <div ref={faceBox} className="st-face-box" onDragStart={(e) => e.preventDefault()}>
                <FaceView src={frame} size={FACE_PX * zoom} label={t("{name} on {watch}", { name, watch: watch.label })} over={over} onShown={shownNow}>
                  {guides ? <div className="st-safe" aria-hidden="true" /> : null}
                  {snapped.outlines.map((b, i) => <div key={`o${i}`} className="st-snap-to" style={{ left: b.x0 * scale - 2, top: b.y0 * scale - 2, width: (b.x1 - b.x0) * scale + 4, height: (b.y1 - b.y0) * scale + 4 }} aria-hidden="true" />)}
                  {snapped.lines.map((g, i) => <div key={i} className="st-snap" style={guide(g)} aria-hidden="true" />)}
                  {snapped.gaps.filter((g) => (g.to - g.from) * scale >= 4).map((g, i) => (
                    <div key={`g${i}`} className="st-gap" data-axis={g.axis} data-equal={g.equal || undefined} style={gap(g)} aria-hidden="true"><span>{Math.round(g.to - g.from)}</span></div>
                  ))}
                  {left === "add" ? items.filter((i) => !i.added && i.bounds).map((i) => (
                    <button key={i.key} type="button" className="st-spot" aria-label={t("Add {name} here", { name: t(i.label) })} title={t(i.label)} style={spot(i.bounds!)} onClick={() => void add(i)}>
                      <Icon name="plus" size={14} width={2.6} />
                    </button>
                  )) : shown.map((l) => (
                    <button key={l.spot?.id ?? l.id} type="button" className="st-hit" data-fixed={!canMove(l) || isLocked(active, l) || undefined} aria-label={t("Select {name}", { name: t(l.label) })} style={box(l)}
                      draggable={false} onPointerEnter={(e) => { if (!e.buttons) setHover(l.id); }} onPointerDown={startDrag(l)} />
                  ))}
                  {left === "layers" && !drag && mode === "current" && library ? (
                    <ChartMates design={active} row={chartRows.find((r) => r.shown) ?? null} details={library.ctx.details} loadAssets={source.loadAssets} spot={spot}
                      onPick={(readout) => { edit((x) => showTemplateChartPage(x, readout)); setSel("native:chart"); setInsp("layer"); }} />
                  ) : null}
                  {left === "layers" ? selected.slice(1).filter((l) => l.bounds && l.visible).map((l) => <div key={l.id} className="st-sel st-sel-extra" style={box(l)} aria-hidden="true" />) : null}
                  {layer?.bounds && layer.visible && left === "layers" ? (
                    <div className="st-sel" style={box(layer)} aria-hidden="true">
                      {([0, 1, 2, 3] as const).map((c) => (
                        resizable ? <i key={c} data-resize={c} title={t("Drag to resize (Alt: from the middle)")} onPointerDown={startResize(layer, c)} /> : <i key={c} />
                      ))}
                      <span>{selected.length > 1 ? t("{n} layers", { n: selected.length }) : `${t(layer.label)}${stateLabel(layer)}`}</span>
                    </div>
                  ) : null}
                  {iconGrip && layer?.visible && left === "layers" && !drag ? (
                    <div className="st-icon-grip" data-dragging={iconLive ? true : undefined}
                      style={spot(iconLive ? { x0: iconGrip.bounds.x0 + iconLive.dx, y0: iconGrip.bounds.y0 + iconLive.dy, x1: iconGrip.bounds.x1 + iconLive.dx, y1: iconGrip.bounds.y1 + iconLive.dy } : iconGrip.bounds)} role="button" aria-label={t("Move the {name}", { name: iconGrip.label.toLowerCase() })}
                      title={t("Drag to move the icon (Shift: one direction)")} onPointerDown={(e) => startIconDrag(iconGrip.move, e)} />
                  ) : null}
                </FaceView>
              </div>
              {canBack ? <>
                {/* The slab is drawn behind the bezel; the button that takes the click sits above the face's own
                    click areas, shaped to the slab's stretch of the case outside the dial (studio.css). */}
                <span className="st-ch-backglow" data-hint={!backTried || undefined} aria-hidden="true"><i className="st-ch-backslab" /></span>
                <button type="button" className="st-ch-backbtn" aria-label={nextPage ? t("Back: next page") : t("Back: next selectable data")}
                  title={nextPage ? t("The watch's Back button: next page") : t("The watch's Back button: the next data in Selectable data")} onClick={stepBack} />
                <button type="button" className="st-ch-backlabel" data-hint={!backTried || undefined} tabIndex={-1} aria-hidden="true" onClick={stepBack}>{backTried ? t("Back") : t("Press me")}</button>
              </> : null}
            </div>
          </div>

          {pageStrip.length ? (
            <div className="st-ch-strip" role="toolbar" aria-label={t("Watch pages")}>
              <button type="button" className="st-ch-step" disabled={!canBack} title={nextPage || !slotNext ? t("Next page, as the watch's Back button does") : t("Next data in Selectable data, as the watch's Back button does")} onClick={stepBack}><Icon name="undo" size={16} />{t("Back")}</button>
              <span className="st-sep" aria-hidden="true" />
              {pageStrip.map((r) => (
                <button key={r.id} type="button" className="st-ch-chip" aria-pressed={r.shown} data-dim={!canPreviewPage(r) || undefined}
                  title={canPreviewPage(r) ? undefined : t("The preview shows this page once it has a readout")}
                  onClick={() => { if (canPreviewPage(r) && !r.shown) void lookAtPage(r.id, edit); }}><b>{r.number}</b>{t(r.label)}</button>
              ))}
              <span className="st-sep" aria-hidden="true" />
              <button type="button" className="st-icon-btn" aria-label={t("Pages")} title={t("Add or remove pages")} onClick={openChart}><Icon name="plus" /></button>
            </div>
          ) : null}

          {sim.enabled ? <SimPanel sim={sim} setSim={setSim} speed={speed} setSpeed={setSpeed} design={active} layers={library?.ctx.layers ?? []} spots={spots} choice={choice} setChoice={setChoice}
            slot={slotNow} slotShown={slotPreview(slotNow, active)} onSlot={(id) => edit((x) => setSlotPreview(x, id))} /> : null}
          {toast ? <div className="st-toast" role="status"><Icon name="check" size={15} width={2.6} />{toast}</div> : null}

          <div className="st-tools" role="toolbar" aria-label={t("Canvas tools")}>
            {supportsAlwaysOn(source) ? <>
              <Segmented small label={t("Display")} value={mode} onChange={(v) => { setMode(v); setSel(null); }} options={[{ value: "current", label: t("Current") }, { value: "aod", label: t("Always-on") }]} />
              <span className="st-sep" aria-hidden="true" />
            </> : null}
            <button type="button" className="st-icon-btn" aria-label={t("Zoom out")} onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(1)))}><Icon name="minus" /></button>
            <span className="st-zoom">{Math.round(zoom * 100)}%</span>
            <button type="button" className="st-icon-btn" aria-label={t("Zoom in")} onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(1)))}><Icon name="plus" /></button>
            <span className="st-sep" aria-hidden="true" />
            <button type="button" className="st-icon-btn" aria-label={t("Snap")} title={t("Snap to layers and the centre (hold Alt to skip)")} aria-pressed={snap} onClick={() => setSnap((s) => !s)}><Icon name="snap" /></button>
            <button type="button" className="st-icon-btn" aria-label={t("Safe-area guide")} title={t("Safe-area guide")} aria-pressed={guides} onClick={() => setGuides((g) => !g)}><Icon name="safe" /></button>
            <span className="st-sep" aria-hidden="true" />
            <button type="button" className="chip" aria-pressed={sim.enabled} onClick={() => setSim((s) => ({ ...s, enabled: !s.enabled, playing: false }))}><Icon name="play" size={14} width={2.2} />{t("Simulate")}</button>
          </div>
        </section>

        {/* ───── Right: the inspector, from the design's StudioEditor and StudioFace boards ───── */}
        <div className="st-resize" role="separator" aria-orientation="vertical" aria-label={t("Inspector width")} aria-valuemin={INSPECTOR_WIDTH.min} aria-valuemax={INSPECTOR_WIDTH.max} aria-valuenow={inspWidth}
          tabIndex={0} title={t("Drag to resize. Double-click for the usual width.")}
          onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); inspDrag.current = { x: e.clientX, w: inspWidth }; }}
          onPointerMove={(e) => { const d = inspDrag.current; if (d) setInspWidth(clampInspector(d.w + d.x - e.clientX)); }}
          onPointerUp={(e) => { if (!inspDrag.current) return; inspDrag.current = null; keepInspWidth(clampInspector(inspWidth)); e.currentTarget.releasePointerCapture(e.pointerId); }}
          onPointerCancel={() => { inspDrag.current = null; }}
          onDoubleClick={() => { setInspWidth(INSPECTOR_WIDTH.start); keepInspWidth(INSPECTOR_WIDTH.start); }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 40 : 10;
            const next = e.key === "ArrowLeft" ? inspWidth + step : e.key === "ArrowRight" ? inspWidth - step : null;
            if (next === null) return;
            e.preventDefault(); e.stopPropagation();
            const w = clampInspector(next); setInspWidth(w); keepInspWidth(w);
          }} />
        <aside className="st-right" aria-label={t("Inspector")} data-tab={insp} style={{ width: inspWidth }}>
          <Segmented label={t("Inspector")} value={insp} onChange={setInsp} className="st-tabs"
            options={[{ value: "layer", label: t("Layer") }, { value: "face", label: t("Face") }, { value: "ai", label: <><Icon name="spark" size={14} />AI</> }]} />
          {insp === "ai" ? (
            <Suspense fallback={null}><Watchmaker projectId={id} /></Suspense>
          ) : insp === "layer" ? (
            selected.length > 1 ? (
              <MultiInspector layers={selected} design={active} edit={edit} master={master} onClear={() => setSel(null)} />
            ) : layer ? (
              <LayerInspector key={`${mode}:${layer.spot?.id ?? layer.id}`} allLayers={library?.ctx.layers} choice={choice} onState={(spot, key) => setChoice((c) => ({ ...c, [spot]: key }))} onAddState={(key) => void addState(key)}
                onStateVisible={(l, v) => edit((x) => setVisible(x, l, v, source, mode))} layer={layer} design={active} edit={edit} details={detailsOf(source, design, mode)} resolution={resolution}
                master={master} icon={(layer.spot && SPOT_ICON[layer.spot.id]) || (ICON[layer.kind] ?? "rect")} aodNote={mode === "aod"} say={say} loadAssets={source.loadAssets} watch={watch.model}
                watchLabel={watch.label} playback={playback} onPlayback={setPlayback}
                onRemove={library && canRemove(active, layer, library.ctx) ? () => remove([layer]) : null}
                arrange={isArtwork(layer.id) ? { place: artworkPlace(active, layer.id), move: (step) => orderArtwork(layer, step), copy: () => copyArtwork(layer) } : undefined}
                onHide={() => hide(layer)} onShow={() => edit((x) => setVisible(x, layer, true, source, mode))} onSplitTime={splitTime}
                onHome={layer.capabilities.position && layer.layoutGroupId ? () => edit((x) => moveTo(x, layer, 0, 0)) : null}
                showsOn={layer.canHide && layer.kind !== "background" ? (supportsAlwaysOn(source) ? (["current", "aod"] as const) : (["current"] as const)).flatMap((m) => {
                  const there = m === mode ? layer : (otherLayers.find((l) => (layer.spot ? l.spot?.id === layer.spot.id : l.id === layer.id) && l.canHide) ?? null);
                  return there ? [{ label: m === "current" ? t("Current display") : t("Always-on"), on: there.visible,
                    toggle: () => apply((s) => ({ ...s, design: editMode(s.design, m, (x) => setVisible(x, there, !there.visible, source, m)) })) }] : [];
                }) : []} />
            ) : (
              <div className="st-empty">
                <Icon name="cursor" size={22} />
                <p>{tr("Click something on the watch to change it, or open {add} for artwork, time and live data.", { add: <button type="button" className="st-link" onClick={() => setLeft("add")}>{t("Add")}</button> })}</p>
              </div>
            )
          ) : (<>
            <FaceInspector design={active} edit={edit} details={detailsOf(source, design, mode)} resolution={resolution} loadAssets={source.loadAssets} fail={(e) => say(e instanceof Error ? e.message : String(e))}
              watchRow={<div className="st-watch-row"><FaceView src={frame} size={44} />
                <span><b>{watch.label}</b><small>{watch.previewSize} × {watch.previewSize} · {watch.display === "amoled" ? "AMOLED" : t("Memory-in-pixel")}{project.sourceTemplateId ? ` · ${t("template {id}", { id: project.sourceTemplateId })}` : ""}</small></span></div>} />
            <ProjectFolds design={design} editRoot={(fn) => apply((s) => { const next = fn(s.design); return next === s.design ? s : { ...s, design: next }; })}
              details={source.details} baselines={source.baselines} mode={mode} sourceTemplateId={project.sourceTemplateId} />
          </>)}
        </aside>
      </div>

      {official ? <OfficialPicker watch={watch.model} request={{ mode: "image", title: t("Images from COROS faces") }} onPick={addOfficial} onClose={() => setOfficial(false)} /> : null}
      {sendTab ? <SendDialog projectId={id} name={name} source={source} design={design} watch={watch} tab={sendTab} onTab={setSendTab}
        onRename={(value) => { dirty.current = true; setDoc((d) => (d.now ? { ...d, now: { ...d.now, name: value } } : d)); }}
        layerLabel={(lid) => { const row = rowOf(layers, lid); return row ? t(row.label) : lid.replace(/[_-]+/g, " ").replace(/^./, (c) => c.toUpperCase()); }}
        onShowLayer={(lid) => { setSendTab(null); setMode("current"); setLeft("layers"); setInsp("layer"); showLayer(lid); }}
        onLanguages={() => { setSendTab(null); setInsp("face"); }}
        onEditable={makeEditable}
        onOpenProject={(pid) => { setSendTab(null); navigate(`/studio/${pid}`); }}
        onClose={() => setSendTab(null)} /> : null}
      {converting ? <ConvertDialog projectId={id} name={name} source={source} design={design} watch={watch}
        onOpenProject={(pid) => { setConverting(false); navigate(`/studio/${pid}`); }} onClose={() => setConverting(false)} /> : null}
    </main>
  );
}

const SPOT_ICON: Record<string, string> = { bluetoothStatus: "bt", bluetoothOff: "bt", doNotDisturbStatus: "moon", doNotDisturbOn: "moon" };

/** The library's sections after Artwork, data first; template images the face hides last. */
const LIBRARY_ORDER = ["time", "health", "activity", "weather", "training", "charts", "device", "basic"] as const;
/** Rows that open a file picker. */
const PICKS = new Set(["art:image", "animation"]);

/** Whether the face on screen is the one drawn after a drop (or the drop changed nothing). */
const redrawn = (held: { from: Design }, design: Design | null, shot: { src: string; design: Design } | null, onScreen: string | null) =>
  design === held.from || (!!shot && shot.design === design && onScreen === shot.src);

interface Snapped { lines: SnapGuide[]; gaps: SnapGap[]; outlines: Box[] }
const NO_SNAP: Snapped = { lines: [], gaps: [], outlines: [] };

/* ───────────── Pieces ───────────── */








/**
 * Click targets on the shown chart page's other readouts (stamina and elevation beside stress). The chart layer edits
 * one readout at a time; clicking another switches it to that one, which can then be dragged. A readout the template
 * draws is taken from the template.
 */
function ChartMates({ design, row, details, loadAssets, spot, onPick }: {
  design: Design; row: ChartPageRow | null; details: CorosWatchfaceTemplateDetails; loadAssets: FaceSource["loadAssets"];
  spot: (b: { x0: number; y0: number; x1: number; y1: number }) => CSSProperties; onPick: (readout: CorosWatchfaceNativeDataStyle) => void;
}) {
  const chart = design.nativeData?.chart?.enabled ? design.nativeData.chart : undefined;
  const editing = chart ? chartSourceOf(chart) : "";
  const sources = row ? row.readouts.filter((r) => r.source !== editing && (r.state === "shown" || r.state === "template")).map((r) => r.source) : [];
  const key = sources.join(",");
  const [mates, setMates] = useState<{ source: string; readout: CorosWatchfaceNativeDataStyle; bounds: { x0: number; y0: number; x1: number; y1: number } }[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all(key ? key.split(",").map(async (source) => {
      const readout = await chartReadoutToEdit(design, source, details, loadAssets);
      const bounds = readout ? chartReadoutBounds(readout) : null;
      return readout && bounds ? [{ source, readout, bounds }] : [];
    }) : []).then((list) => { if (live) setMates(list.flat()); });
    return () => { live = false; };
    // The design changes on every edit; the readouts to offer change only with the page and the edited readout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, editing, chart?.readouts, details, loadAssets]);
  return <>{mates.map((m) => (
    <button key={`mate:${m.source}`} type="button" className="st-hit" aria-label={t("Edit {name}", { name: t(chartReadoutName(m.source)) })} title={t("{name}: click to move it", { name: t(chartReadoutName(m.source)) })}
      style={spot(m.bounds)} onPointerDown={(e) => { e.stopPropagation(); onPick(m.readout); }} />
  ))}</>;
}
