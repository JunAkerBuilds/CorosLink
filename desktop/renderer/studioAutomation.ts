// The open Studio editor as automation sees it: the methods the watch-face MCP server and Watchmaker call (CorosLink's
// `handleAutomationRequest` in WatchfaceEditor.tsx, rewritten on this editor's state). The editor hands in a host:
// its live face, its undo history, the view, and a way to draw. Every `apply_commands` is one undo step; a stale
// `baseRevision` or another face's `sessionId` is refused, so an agent never edits over a person's change unseen.
// Requests reach the page through the main process's broker (studioAutomationInbox.ts), not IPC.
import { resolveWatchfaceModeDesign } from "../watchface/engine/watchfaceDisplayModes";
import { applyWatchfaceAutomationCommands } from "../watchface/engine/watchfaceAutomationCommands";
import { WatchfaceAutomationError, requireAutomationNumber, requireAutomationString } from "../watchface/engine/watchfaceAutomation";
import { validateWatchfaceAutomationDocument, type WatchfaceAutomationDiagnostic } from "../watchface/engine/watchfaceAutomationSchema";
import { resolveWatchfacePlacementScene } from "../watchface/engine/watchfaceAutomationPlacement";
import { watchfaceAutomationAssetContracts } from "../watchface/engine/watchfaceAutomationAssetContracts";
import { analyzeLayerContrast } from "../watchface/engine/watchfaceAutomationPixels";
import {
  recolorAutomationImage, renderAutomationSvg, sampleAutomationImage, type WatchfaceDecodedImage,
} from "../watchface/engine/watchfaceAutomationImageTools";
import { describeNativeDataComponents } from "../watchface/engine/nativeDataAutomation";
import {
  activeSimulationScenario, parseWatchfacePreviewScenario, patchWatchfaceSimulation, WATCHFACE_SIMULATION_CAPABILITIES,
  type WatchfacePreviewScenario, type WatchfaceSimulation,
} from "../watchface/engine/watchfaceSimulation";
import { hasWatchfaceAod } from "../watchface/engine/watchfaceStudio";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS } from "../watchface/watchfaceNativeCatalog";
import { detailsOf, layersOf, resolutionOf, type Design, type FaceSource, type Mode } from "./studioFace";

export interface Snapshot { name: string; design: Design }

/** What the editor lends automation. Everything is read fresh on each call: the person may have edited in between. */
export interface AutomationHost {
  sessionId: string;
  projectId: string;
  source: FaceSource;
  snapshot(): Snapshot;
  revision(): number;
  dirty(): boolean;
  /** A drag or an import in progress: edits wait for it. */
  busy(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  /** One undo step. */
  commit(next: Snapshot): void;
  undo(): void;
  redo(): void;
  mode(): Mode;
  setMode(mode: Mode): void;
  selection(): string[];
  select(ids: string[]): void;
  simulation(): WatchfaceSimulation;
  setSimulation(next: WatchfaceSimulation): void;
  /** The face as a square PNG data URL at `size`, not cut round, so boxes in master pixels map onto it. */
  render(design: Design, mode: Mode, size: number, scenario?: WatchfacePreviewScenario): Promise<string>;
  decode(dataUrl: string): Promise<WatchfaceDecodedImage>;
  save(): Promise<void>;
}

type Params = Record<string, unknown>;

/** Text and data layers whose readability check_contrast measures by default. */
const CONTRAST_KINDS = new Set(["time", "seconds", "date", "weekday", "battery", "metric", "complication"]);

const box = (b: { x0: number; y0: number; x1: number; y1: number }) => {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r(b.x0), y: r(b.y0), width: r(b.x1 - b.x0), height: r(b.y1 - b.y0), centerX: r((b.x0 + b.x1) / 2), centerY: r((b.y0 + b.y1) / 2) };
};

function fail(code: string, message: string, details?: unknown): never {
  throw new WatchfaceAutomationError(code, message, details);
}

function modeOf(host: AutomationHost, params: Params): Mode {
  const mode: Mode = params.mode === undefined ? host.mode() : params.mode === "aod" ? "aod" : "current";
  if (mode === "aod" && !hasWatchfaceAod(host.source.details)) fail("UNSUPPORTED_MODE", "This template has no always-on display mode.");
  return mode;
}

function checkSession(host: AutomationHost, params: Params, needRevision = false): void {
  const asked = requireAutomationString(params.sessionId, "sessionId");
  if (asked !== host.sessionId) fail("STALE_SESSION", `The editor session changed. Current sessionId is ${host.sessionId}.`, { sessionId: host.sessionId, revision: host.revision() });
  if (!needRevision) return;
  const base = requireAutomationNumber(params.baseRevision, "baseRevision");
  if (base !== host.revision()) fail("REVISION_CONFLICT", `Document revision ${base} is stale; current revision is ${host.revision()}.`, { sessionId: host.sessionId, revision: host.revision() });
}

function notBusy(host: AutomationHost, what: string): void {
  if (host.busy()) fail("EDITOR_BUSY", `Finish the edit in progress before ${what}.`);
}

function scenarioOf(host: AutomationHost, params: Params): WatchfacePreviewScenario | undefined {
  if (params.scenario === undefined) return activeSimulationScenario(host.simulation());
  try { return parseWatchfacePreviewScenario(params.scenario); } catch (e) { return fail("INVALID_PARAMS", e instanceof Error ? e.message : "Invalid preview scenario."); }
}

const valueOf = (s: Snapshot) => ({ projectName: s.name, design: s.design });

export function diagnosticsOf(host: AutomationHost, mode = host.mode()): WatchfaceAutomationDiagnostic[] {
  return validateWatchfaceAutomationDocument(valueOf(host.snapshot()), { details: host.source.details, mode });
}

/** The master frame: the template's largest resolution, where placement, geometry and contrast measure. */
function masterOf(host: AutomationHost, mode: Mode) {
  const master = resolutionOf(host.source, host.snapshot().design, mode);
  if (!master) fail("UNKNOWN_RESOLUTION", "No preview resolution is available.");
  return master;
}

const frameOf = (m: { width: number; height: number }) => ({
  width: m.width, height: m.height, unit: "master pixels",
  circle: { centerX: m.width / 2, centerY: m.height / 2, radius: Math.min(m.width, m.height) / 2 },
});

/** The face's layers in the mode, each with its placement (box in master pixels, movable, movement key) and lock. */
export function automationLayers(host: AutomationHost, mode = host.mode()) {
  const { design } = host.snapshot();
  const active = resolveWatchfaceModeDesign(design, mode);
  const placements = new Map(resolveWatchfacePlacementScene(host.source.details, active, mode).layers.map((l) => [l.id, l]));
  const locked = new Set(active.lockedLayerIds ?? []);
  return layersOf(host.source, design, mode).map((layer) => {
    const placed = placements.get(layer.id);
    const readOnly = !layer.canHide && !Object.values(layer.capabilities).some((c) => c === true);
    return {
      id: layer.id, kind: layer.kind, label: layer.label, visible: layer.visible, canHide: layer.canHide, capabilities: layer.capabilities,
      ...(layer.nativeDataId ? { nativeDataId: layer.nativeDataId } : {}),
      placement: placed ? { bounds: placed.bounds ? box(placed.bounds) : null, movable: placed.movable, movementKey: placed.movementKey } : null,
      locked: locked.has(layer.id) || readOnly, readOnly,
      ...(layer.nativeDataId && active.nativeData?.[layer.nativeDataId]
        ? { nativeData: { path: `/design/nativeData/${layer.nativeDataId}`, components: describeNativeDataComponents(layer.nativeDataId, active.nativeData[layer.nativeDataId]) } }
        : {}),
    };
  });
}

function view(host: AutomationHost, mode = host.mode()) {
  const sim = host.simulation();
  const ids = host.selection();
  return { mode, simulation: { ...sim, values: { ...sim.values } }, selectedId: ids.at(-1) ?? "", selectedIds: [...ids] };
}

/** get_document: the live face, its revision, layers with placement, capabilities and diagnostics. */
export function automationDocument(host: AutomationHost) {
  const now = host.snapshot(), mode = host.mode();
  const master = resolutionOf(host.source, now.design, mode);
  const details = host.source.details;
  return {
    sessionId: host.sessionId, revision: host.revision(), dirty: host.dirty(), busy: host.busy(),
    project: { projectId: host.projectId, name: now.name },
    view: view(host, mode),
    capabilities: {
      aod: hasWatchfaceAod(details),
      placement: {
        width: master?.width ?? 800, height: master?.height ?? 800, unit: "pixels", origin: "top-left", nativeOffsetRounding: "nearest-integer",
        bounds: "rotation-aware axis-aligned bounds; text uses rendered font metrics; decorative effects excluded",
      },
      resolutions: details.resolutions.map((r) => ({ directory: r.directory, width: r.width, height: r.height, hasCurrentConfig: Object.keys(r.config).length > 0, hasAodConfig: Object.keys(r.aodConfig).length > 0 })),
      simulation: WATCHFACE_SIMULATION_CAPABILITIES,
      assetContracts: watchfaceAutomationAssetContracts(master ?? null, resolveWatchfaceModeDesign(now.design, mode), mode),
      nativeData: {
        schemaPath: "nativeData", creationOperation: "add_native_field", requiresTemplateField: false,
        fieldIds: NATIVE_DATA_FIELDS.map((f) => f.id), chartSources: NATIVE_CHART_SOURCES.map((s) => s.id), slotsPerField: 1, chartSlots: 1,
      },
      layers: automationLayers(host, mode),
      schemaVersion: 1,
    },
    design: structuredClone(now.design),
    diagnostics: diagnosticsOf(host, mode),
    canUndo: host.canUndo(), canRedo: host.canRedo(),
  };
}

function applyCommands(host: AutomationHost, params: Params) {
  checkSession(host, params, true);
  notBusy(host, "applying commands");
  if (!Array.isArray(params.commands)) fail("INVALID_PARAMS", "commands must be an array.");
  const mode = modeOf(host, params);
  const now = host.snapshot();
  const result = applyWatchfaceAutomationCommands(valueOf(now), params.commands, { details: host.source.details, mode });
  host.commit({ name: result.value.projectName, design: result.value.design });
  // The layers it changed are selected, so the person sees what the agent did.
  const known = new Set(layersOf(host.source, result.value.design, mode).map((l) => l.id));
  const changed = result.changedLayerIds.filter((id) => known.has(id));
  if (changed.length) host.select(changed);
  return { sessionId: host.sessionId, revision: host.revision(), dirty: host.dirty(), changedLayerIds: result.changedLayerIds, diagnostics: result.diagnostics };
}

async function renderPreview(host: AutomationHost, params: Params) {
  checkSession(host, params);
  notBusy(host, "rendering");
  const mode = modeOf(host, params);
  const details = host.source.details;
  let size = masterOf(host, mode).width;
  let resolution: string | null = null;
  if (params.resolution !== undefined) {
    const asked = typeof params.resolution === "string" ? params.resolution : requireAutomationNumber(params.resolution, "resolution");
    const match = details.resolutions.find((r) => (typeof asked === "string" ? r.directory === asked : r.width === asked));
    if (!match) fail("UNKNOWN_RESOLUTION", `Unknown resolution ${asked}.`);
    resolution = match.directory;
    size = match.width;
  }
  if (params.size !== undefined) size = Math.max(64, Math.min(1600, Math.round(requireAutomationNumber(params.size, "size"))));
  const revision = host.revision();
  const scenario = scenarioOf(host, params);
  const dataUrl = await host.render(host.snapshot().design, mode, size, scenario);
  return { sessionId: host.sessionId, revision, mode, resolution, width: size, height: size, scenario: scenario ?? null, mimeType: "image/png", dataUrl };
}

function geometry(host: AutomationHost, params: Params) {
  checkSession(host, params);
  const mode = modeOf(host, params);
  const wanted = Array.isArray(params.ids) ? new Set(params.ids.filter((id): id is string => typeof id === "string")) : null;
  return {
    sessionId: host.sessionId, revision: host.revision(), mode, frame: frameOf(masterOf(host, mode)),
    layers: automationLayers(host, mode).filter((l) => !wanted || wanted.has(l.id))
      .map((l) => ({ id: l.id, label: l.label, kind: l.kind, visible: l.visible, movable: l.placement?.movable ?? false, box: l.placement?.bounds ?? null })),
  };
}

/**
 * How readable each text and data layer is against what is really behind it: the face is drawn with and without the
 * layer, and on black and white backdrops to find where it draws (CorosLink's check_contrast).
 */
async function contrast(host: AutomationHost, params: Params) {
  checkSession(host, params);
  notBusy(host, "measuring contrast");
  const mode = modeOf(host, params);
  const revision = host.revision();
  const value = valueOf(host.snapshot());
  const master = masterOf(host, mode);
  const scenario = scenarioOf(host, params);
  const layers = automationLayers(host, mode);
  const skipped: { id: string; reason: string }[] = [];
  const wanted = Array.isArray(params.ids) ? params.ids.filter((id): id is string => typeof id === "string") : null;
  const candidates = wanted
    ? wanted.flatMap((id) => {
      const layer = layers.find((l) => l.id === id);
      if (!layer) skipped.push({ id, reason: "No such layer in this mode." });
      else if (!layer.visible) skipped.push({ id, reason: "The layer is hidden." });
      return layer?.visible ? [layer] : [];
    })
    : layers.filter((l) => l.visible && CONTRAST_KINDS.has(l.kind));
  const render = async (design: Design) => host.decode(await host.render(design, mode, master.width, scenario));
  // Always-on already draws on black and can't show a white backdrop.
  const probes = mode === "current";
  const backdrop = (design: Design, color: string): Design => ({ ...design, backgroundColor: color, artworkVisible: false, designSprites: [], backgroundElements: [], artworkLayerOrder: [] });
  const onBlack = await render(probes ? backdrop(value.design, "#000000") : value.design);
  const onWhite = probes ? await render(backdrop(value.design, "#FFFFFF")) : undefined;
  const results: Record<string, unknown>[] = [];
  for (const layer of candidates) {
    const bounds = layer.placement?.bounds;
    if (!bounds) { skipped.push({ id: layer.id, reason: "The layer has no rendered bounds." }); continue; }
    let hidden: Design;
    try {
      hidden = applyWatchfaceAutomationCommands(value, [{ op: "set_visibility", id: layer.id, visible: false }], { details: host.source.details, mode }).value.design;
    } catch (e) {
      skipped.push({ id: layer.id, reason: e instanceof Error ? e.message : "The layer cannot be hidden." });
      continue;
    }
    const behind = await render(hidden);
    const measured = analyzeLayerContrast({
      width: behind.width, height: behind.height, behind: behind.data,
      onBlack: { withLayer: onBlack.data, withoutLayer: probes ? (await render(backdrop(hidden, "#000000"))).data : behind.data },
      ...(onWhite ? { onWhite: { withLayer: onWhite.data, withoutLayer: (await render(backdrop(hidden, "#FFFFFF"))).data } } : {}),
    }, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
    if (!measured) { skipped.push({ id: layer.id, reason: "Nothing visible is drawn in its box." }); continue; }
    // WCAG large text; on a watch that means glyphs about 6% of the face tall.
    const requiredRatio = bounds.height >= master.height * 0.06 ? 3 : 4.5;
    results.push({
      id: layer.id, label: layer.label, kind: layer.kind, box: bounds, ...measured, requiredRatio,
      verdict: measured.worstRatio >= requiredRatio ? "pass" : measured.ratio >= requiredRatio ? "uneven" : "fail",
    });
  }
  return {
    sessionId: host.sessionId, revision, mode, frame: frameOf(master),
    verdicts: { pass: "Readable against the whole background behind it.", uneven: "Readable on average, but part of the background behind it is too close in brightness.", fail: "Too little contrast." },
    results, skipped,
  };
}

async function sampleColor(host: AutomationHost, params: Params) {
  let image: WatchfaceDecodedImage;
  let face: Record<string, unknown> = {};
  if (typeof params.image === "string") image = await host.decode(params.image);
  else {
    checkSession(host, params);
    notBusy(host, "sampling");
    const mode = modeOf(host, params), master = masterOf(host, mode);
    face = { sessionId: host.sessionId, revision: host.revision(), mode, frame: frameOf(master) };
    image = await host.decode(await host.render(host.snapshot().design, mode, master.width, scenarioOf(host, params)));
  }
  return {
    source: typeof params.image === "string" ? "image" : "face", ...face,
    ...sampleAutomationImage(image, {
      points: Array.isArray(params.points) ? (params.points as { x: number; y: number }[]) : undefined,
      regions: Array.isArray(params.regions) ? (params.regions as { x: number; y: number; width: number; height: number }[]) : undefined,
      palette: typeof params.palette === "number" ? params.palette : undefined,
    }),
  };
}

function setView(host: AutomationHost, params: Params) {
  checkSession(host, params);
  notBusy(host, "changing the view");
  let sim = host.simulation();
  if (params.simulation !== undefined) {
    try { sim = patchWatchfaceSimulation(sim, params.simulation); } catch (e) { fail("INVALID_PARAMS", e instanceof Error ? e.message : "Invalid simulation."); }
  }
  const mode = modeOf(host, params);
  if (params.simulation !== undefined) host.setSimulation(sim);
  if (mode !== host.mode()) host.setMode(mode);
  return { sessionId: host.sessionId, revision: host.revision(), view: { ...view(host, mode), simulation: sim } };
}

function select(host: AutomationHost, params: Params) {
  checkSession(host, params);
  notBusy(host, "changing the selection");
  const asked = params.layerIds ?? params.ids;
  const ids = Array.isArray(asked) ? asked.map((id, i) => requireAutomationString(id, `layerIds[${i}]`)) : [requireAutomationString(params.id, "id")];
  if (!ids.length) fail("INVALID_PARAMS", "Select at least one layer.");
  const known = new Set(["background", ...automationLayers(host).map((l) => l.id)]);
  const unknown = ids.filter((id) => !known.has(id));
  if (unknown.length) fail("UNKNOWN_LAYER", `Unknown layer${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`);
  host.select(ids);
  return { sessionId: host.sessionId, revision: host.revision(), view: view(host) };
}

function history(host: AutomationHost, params: Params, step: "undo" | "redo") {
  checkSession(host, params, true);
  notBusy(host, "changing history");
  if (step === "undo" ? host.canUndo() : host.canRedo()) {
    if (step === "undo") host.undo(); else host.redo();
  }
  return { sessionId: host.sessionId, revision: host.revision(), dirty: host.dirty(), canUndo: host.canUndo(), canRedo: host.canRedo() };
}

async function imageTool(run: () => Promise<Record<string, unknown>>) {
  try { return { mimeType: "image/png", ...(await run()) }; } catch (e) {
    if (e instanceof WatchfaceAutomationError) throw e;
    return fail("INVALID_PARAMS", e instanceof Error ? e.message : "The image couldn't be processed.");
  }
}

/** Status for get_context and the broker: which face is open, at which revision. */
export function automationStatus(host: AutomationHost) {
  return { sessionId: host.sessionId, revision: host.revision(), dirty: host.dirty(), busy: host.busy(), project: { projectId: host.projectId, name: host.snapshot().name } };
}

/** One request from the broker. Throws WatchfaceAutomationError (or the engine's command error) on refusal. */
export async function answerAutomation(host: AutomationHost, method: string, params: Params): Promise<unknown> {
  switch (method) {
    case "get_context": return { editor: automationStatus(host) };
    case "get_document": return automationDocument(host);
    case "apply_commands": return applyCommands(host, params);
    case "undo": case "redo": return history(host, params, method);
    case "select": return select(host, params);
    case "set_view": return setView(host, params);
    case "render_preview": return renderPreview(host, params);
    case "get_geometry": return geometry(host, params);
    case "check_contrast": return contrast(host, params);
    case "sample_color": return sampleColor(host, params);
    case "render_svg": return imageTool(() => renderAutomationSvg(requireAutomationString(params.svg, "svg"), requireAutomationNumber(params.width, "width"), requireAutomationNumber(params.height, "height")));
    case "recolor_image": return imageTool(() => recolorAutomationImage(requireAutomationString(params.image, "image"), {
      color: requireAutomationString(params.color, "color"),
      ...(typeof params.from === "string" ? { from: params.from } : {}), ...(typeof params.tolerance === "number" ? { tolerance: params.tolerance } : {}),
    }));
    case "validate": {
      checkSession(host, params);
      const diagnostics = diagnosticsOf(host, modeOf(host, params));
      return { sessionId: host.sessionId, revision: host.revision(), valid: !diagnostics.some((d) => d.severity === "error"), diagnostics };
    }
    case "save": {
      checkSession(host, params, true);
      notBusy(host, "saving");
      if (params.name !== undefined) {
        const name = requireAutomationString(params.name, "name").trim();
        if (!name || name.length > 80) fail("INVALID_PARAMS", "name takes 1 to 80 characters.");
        if (name !== host.snapshot().name) host.commit({ ...host.snapshot(), name });
      }
      await host.save();
      return { sessionId: host.sessionId, revision: host.revision(), dirty: host.dirty(), project: { projectId: host.projectId, name: host.snapshot().name } };
    }
    default: return fail("METHOD_NOT_FOUND", `Unknown editor method ${method}.`);
  }
}

/** The template for the mode, for callers that need details (Watchmaker's compact document). */
export const automationDetails = (host: AutomationHost, mode = host.mode()) => detailsOf(host.source, host.snapshot().design, mode);
