// Watchmaker's tools: the same editor methods the MCP server offers, through the same broker, with two differences.
// The session and revision are kept here (the model never copies them), and pictures (previews, inspected, cropped
// and drawn images) come back as pictures the model can look at, not only ids. Images Codex generates itself come in
// through codex.ts.
import type { ToolDef } from "@/lib/coach/tools";
import type { AssetStore } from "../automation/assets";
import { pngSize } from "../automation/assets";
import { EditorError, type EditorBroker } from "../automation/broker";
import { cropAsset } from "../automation/images";
import { schemaSection } from "../automation/tools";
import { msg } from "@/lib/i18n";

export interface Picture { assetId: string; why: string }

export interface ToolResult {
  text: string;
  isError?: boolean;
  /** Pictures for the model (when it can see them) and the chat. */
  pictures?: Picture[];
  /** The face changed: a new revision. */
  edited?: boolean;
  plan?: PlanItem[];
}

export interface PlanItem { text: string; status: "pending" | "doing" | "done" }

/** What the chat is told while an answer runs (one JSON line each on the wire). */
export type WatchmakerEvent =
  | { t: "text"; delta: string }
  | { t: "step"; id: string; tool: string; label: string }
  | { t: "step-done"; id: string; ok: boolean; message?: string }
  | { t: "picture"; assetId: string; why: string }
  | { t: "plan"; items: PlanItem[] }
  | { t: "edit" };

/** What each tool is shown as in the chat while it runs. */
export const STEP_WORDS: Record<string, string> = {
  get_document: msg("Reading the face"), get_schema: msg("Reading the schema"), apply_commands: msg("Editing the face"), undo: msg("Undoing a step"),
  render_preview: msg("Drawing a preview"), get_geometry: msg("Measuring"), check_contrast: msg("Checking contrast"), sample_color: msg("Sampling colours"),
  validate: msg("Validating"), inspect_asset: msg("Looking at an image"), crop_image: msg("Cropping an image"), render_svg: msg("Drawing artwork"),
  recolor_image: msg("Recolouring an image"), update_plan: msg("Planning"), get_generated_images: msg("Taking the generated images"),
  import_file: msg("Importing an image"),
};

export interface EditorSession { sessionId: string; revision: number }

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolDef["input_schema"] => ({ type: "object", properties, required });
const MODE = { mode: { type: "string", enum: ["current", "aod"] } };
const SCENARIO = { scenario: { type: "object", description: "Sample data: dateTime, values (e.g. {\"battery\":\"50\"}), weather. Omit for the editor's simulation." } };
const ASSET = { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"] };

/** The live document cut down to what a model needs each turn. */
export function compactDocument(doc: Record<string, unknown>): Record<string, unknown> {
  const caps = (doc.capabilities ?? {}) as Record<string, unknown>;
  const layers = (caps.layers ?? []) as Record<string, unknown>[];
  const diagnostics = ((doc.diagnostics ?? []) as { severity: string }[]);
  return {
    sessionId: doc.sessionId, revision: doc.revision, project: doc.project,
    view: { mode: (doc.view as { mode?: unknown })?.mode, selectedIds: (doc.view as { selectedIds?: unknown })?.selectedIds },
    capabilities: {
      aod: caps.aod, placement: caps.placement,
      resolutions: ((caps.resolutions ?? []) as { width: number }[]).map((r) => r.width),
      layers: layers.map((l) => {
        const p = l.placement as { bounds?: unknown; movable?: boolean } | null;
        return { id: l.id, kind: l.kind, label: l.label, visible: l.visible, box: p?.bounds ?? null, movable: !!p?.movable, ...(l.locked ? { locked: true } : {}), ...(l.nativeData ? { nativeDataPath: (l.nativeData as { path: string }).path } : {}) };
      }),
      assetContracts: `${((caps.assetContracts ?? []) as unknown[]).length} contracts; get_document with full true lists them.`,
    },
    diagnostics: [...diagnostics.filter((d) => d.severity === "error"), ...diagnostics.filter((d) => d.severity !== "error")].slice(0, 20),
    canUndo: doc.canUndo,
  };
}

const said = (error: unknown): ToolResult => {
  if (error instanceof EditorError) {
    const tip = error.code === "REVISION_CONFLICT" ? " The person changed the face since you last read it: call get_document, then redo your change on the fresh face."
      : error.code === "NO_OPEN_PROJECT" || error.code === "EDITOR_UNAVAILABLE" ? " The face was closed; stop and say so." : "";
    return { text: JSON.stringify({ error: { code: error.code, message: error.message + tip, ...(error.details === undefined ? {} : { details: error.details }) } }), isError: true };
  }
  return { text: JSON.stringify({ error: { code: "FAILED", message: error instanceof Error ? error.message : "That didn't work." } }), isError: true };
};

export interface WatchmakerTools {
  defs: ToolDef[];
  run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult>;
  /** Re-reads the face (each turn starts with it). */
  read(signal?: AbortSignal): Promise<Record<string, unknown>>;
  session(): EditorSession | null;
}

export function watchmakerTools(deps: { broker: EditorBroker; assets: AssetStore; projectId: string }): WatchmakerTools {
  const { broker, assets } = deps;
  let session: EditorSession | null = null;

  const ask = async (method: string, params: Record<string, unknown>, signal?: AbortSignal) =>
    assets.toRefs(await broker.request(method, await assets.fromRefs(params), signal)) as Promise<Record<string, unknown>>;
  const needSession = () => {
    if (!session) throw new EditorError("NO_DOCUMENT", "Call get_document first.");
    return session;
  };
  const read = async (signal?: AbortSignal) => {
    const doc = await ask("get_document", {}, signal);
    if ((doc.project as { projectId?: unknown })?.projectId !== deps.projectId) throw new EditorError("NO_OPEN_PROJECT", "A different face is open now.");
    session = { sessionId: String(doc.sessionId), revision: Number(doc.revision) };
    return doc;
  };
  /** An editor method that changes the face, at the revision last read. */
  const mutate = async (method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> => {
    const s = needSession();
    const answer = await ask(method, { ...params, sessionId: s.sessionId, baseRevision: s.revision }, signal);
    session = { ...s, revision: Number(answer.revision) };
    return { text: JSON.stringify(answer), edited: true };
  };
  const look = async (method: string, params: Record<string, unknown>, signal?: AbortSignal) => ask(method, { ...params, sessionId: needSession().sessionId }, signal);

  const defs: ToolDef[] = [
    { name: "get_document", description: "Read the open face again: revision, layers with boxes in master pixels, diagnostics. full: true adds the whole design and asset contracts.", input_schema: obj({ full: { type: "boolean" } }) },
    { name: "get_schema", description: "One section of the scene schema: commands (every edit command), document (design properties), nativeData (data fields catalog), simulation, scalar.", input_schema: obj({ section: { type: "string", enum: ["commands", "document", "nativeData", "simulation", "scalar"] } }, ["section"]) },
    { name: "apply_commands", description: "Apply scene commands to the face as one undo step (see get_schema commands). Images go in as {assetId}.", input_schema: obj({ commands: { type: "array", items: { type: "object" }, minItems: 1, maxItems: 100 }, ...MODE, label: { type: "string" } }, ["commands"]) },
    { name: "undo", description: "Undo the last step on the face.", input_schema: obj({}) },
    { name: "render_preview", description: "Draw the face and look at it. resolution is a width from the document's resolutions (the smallest checks small text).", input_schema: obj({ ...MODE, ...SCENARIO, resolution: { type: "integer" } }) },
    { name: "get_geometry", description: "Exact boxes in master pixels for layers and the round screen.", input_schema: obj({ ...MODE, ids: { type: "array", items: { type: "string" } } }) },
    { name: "check_contrast", description: "How readable text and data layers are against what's behind them, with a pass / uneven / fail verdict each.", input_schema: obj({ ...MODE, ids: { type: "array", items: { type: "string" } } }) },
    { name: "sample_color", description: "Exact colours from the drawn face (or a stored image): points or regions in its pixels.", input_schema: obj({ ...MODE, image: ASSET, points: { type: "array", items: { type: "object" } }, regions: { type: "array", items: { type: "object" } } }) },
    { name: "validate", description: "Check the face against the editor, template and watch rules.", input_schema: obj({ ...MODE }) },
    { name: "inspect_asset", description: "Look at a stored image (an attachment, a generated or cropped image) by its {assetId}.", input_schema: obj({ image: ASSET }, ["image"]) },
    { name: "crop_image", description: "A new PNG from a stored one: crop (region in its pixels), trim (transparent margins, on unless false), then width and / or height. Returns the new {assetId}.", input_schema: obj({ image: ASSET, crop: { type: "object" }, trim: { type: "boolean" }, width: { type: "integer" }, height: { type: "integer" } }, ["image"]) },
    { name: "render_svg", description: "Draw a self-contained SVG (with a viewBox) to a transparent PNG of exactly width × height. Returns its {assetId}.", input_schema: obj({ svg: { type: "string" }, width: { type: "integer" }, height: { type: "integer" } }, ["svg", "width", "height"]) },
    { name: "recolor_image", description: "Paint a stored image's visible pixels one #RRGGBB colour (only near from, when given). Returns the new {assetId}.", input_schema: obj({ image: ASSET, color: { type: "string" }, from: { type: "string" }, tolerance: { type: "integer" } }, ["image", "color"]) },
    { name: "update_plan", description: "Your short plan for this request, shown to the person. Send the whole list each time.", input_schema: obj({ items: { type: "array", items: { type: "object", properties: { text: { type: "string" }, status: { type: "string", enum: ["pending", "doing", "done"] } }, required: ["text", "status"] } } }, ["items"]) },
  ];

  async function run(name: string, input: unknown, signal?: AbortSignal): Promise<ToolResult> {
    const args = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
    const pick = (...keys: string[]) => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
    try {
      switch (name) {
        case "get_document": {
          const doc = await read(signal);
          return { text: JSON.stringify(args.full === true ? doc : compactDocument(doc)) };
        }
        case "get_schema": return { text: JSON.stringify(schemaSection(args.section)) };
        case "apply_commands": return await mutate("apply_commands", pick("commands", "mode", "label"), signal);
        case "undo": return await mutate("undo", {}, signal);
        case "render_preview": {
          const shot = await ask("render_preview", { ...pick("mode", "scenario", "resolution"), sessionId: needSession().sessionId }, signal);
          const { dataUrl, ...rest } = shot as { dataUrl: { assetId: string } } & Record<string, unknown>;
          return { text: JSON.stringify({ ...rest, assetId: dataUrl.assetId }), pictures: [{ assetId: dataUrl.assetId, why: `Preview, ${String(rest.mode)} at ${String(rest.width)} px` }] };
        }
        case "get_geometry": return { text: JSON.stringify(await look("get_geometry", pick("mode", "ids"), signal)) };
        case "check_contrast": return { text: JSON.stringify(await look("check_contrast", pick("mode", "ids"), signal)) };
        case "sample_color": return { text: JSON.stringify(await look("sample_color", pick("mode", "image", "points", "regions"), signal)) };
        case "validate": return { text: JSON.stringify(await look("validate", pick("mode"), signal)) };
        case "inspect_asset": {
          const id = (args.image as { assetId?: unknown })?.assetId;
          if (typeof id !== "string") throw new EditorError("INVALID_PARAMS", "image must be {assetId}.");
          const stored = await assets.get(id);
          return { text: JSON.stringify({ assetId: id, ...(pngSize(stored.bytes) ?? {}) }), pictures: [{ assetId: id, why: `Image ${id}` }] };
        }
        case "crop_image": {
          const id = (args.image as { assetId?: unknown })?.assetId;
          if (typeof id !== "string") throw new EditorError("INVALID_PARAMS", "image must be {assetId}.");
          const out = await cropAsset(assets, id, args as never);
          return { text: JSON.stringify(out), pictures: [{ assetId: out.assetId, why: `Cropped ${out.width}×${out.height}` }] };
        }
        case "render_svg": case "recolor_image": {
          const out = await ask(name, pick("svg", "width", "height", "image", "color", "from", "tolerance"), signal) as { dataUrl: { assetId: string } } & Record<string, unknown>;
          const { dataUrl, ...rest } = out;
          return { text: JSON.stringify({ ...rest, assetId: dataUrl.assetId }), pictures: [{ assetId: dataUrl.assetId, why: `${name === "render_svg" ? "Drawn" : "Recoloured"} ${String(rest.width)}×${String(rest.height)}` }] };
        }
        case "update_plan": {
          const items = (Array.isArray(args.items) ? args.items : []).slice(0, 12).map((i) => {
            const x = i as { text?: unknown; status?: unknown };
            return { text: String(x.text ?? "").slice(0, 160), status: (["pending", "doing", "done"].includes(String(x.status)) ? x.status : "pending") as PlanItem["status"] };
          }).filter((i) => i.text);
          return { text: "Plan shown.", plan: items };
        }
        default: return { text: JSON.stringify({ error: { code: "UNKNOWN_TOOL", message: `There is no tool called ${name}.` } }), isError: true };
      }
    } catch (error) {
      return said(error);
    }
  }

  return { defs, run, read, session: () => session };
}
