// The watch-face tools an outside AI agent gets over MCP (CorosLink's watchfaceAutomationServer.ts tool list, the
// part that drives the open editor). Editor tools go through the broker to the page; images go in and out as
// `{ assetId }` (assets.ts). Each tool answers JSON, and render_preview also the picture itself.
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { getWatchfaceAutomationSchema } from "../../../watchface/engine/watchfaceAutomationSchema";
import type { AssetStore } from "./assets";
import { pngSize, sniffImage } from "./assets";
import { EditorError, type EditorBroker } from "./broker";
import { cropAsset } from "./images";

export interface ToolOutput { json: unknown; images?: { data: string; mime: string }[] }

export interface AutomationTool {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties?: boolean };
  readOnly?: boolean;
  run(args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutput>;
}

export interface ToolHost {
  broker: EditorBroker;
  assets: AssetStore;
  /** The saved faces, newest first. */
  projects(): Promise<{ id: string; name: string; watch?: unknown; updatedAt?: string }[]>;
}

/** Read before saving or delivering a face (CorosLink's legibility guidance, kept short). */
export const LEGIBILITY =
  "Before calling a face done, render it at the smallest resolution the template has (render_preview with resolution set to that width) and check small text there: measure visible glyphs, not sprite padding. On a 416 px screen, small digits start around 12x17 visible pixels with 1-2 px strokes. Check every digit, the widest values, weekdays and battery states for clipping, and Current and Always-on both. A preview or validation that passes is not a check on the watch.";

const SESSION = { sessionId: { type: "string", description: "sessionId from get_document." } };
const REVISION = { baseRevision: { type: "integer", minimum: 0, description: "revision from get_document." } };
const MODE = { mode: { type: "string", enum: ["current", "aod"], description: "Current (lit) or always-on. Defaults to the editor's." } };
const SCENARIO = { scenario: { type: "object", description: "Sample data to draw with (dateTime, values, weather, chartHistory, chartProgress; see get_schema simulation). Omit for the editor's simulation; {} for plain samples." } };
const IDS = { ids: { type: "array", items: { type: "string" }, maxItems: 200, description: "Layer ids from get_document. Omit for all." } };

const ASSET = { type: "object", properties: { assetId: { type: "string" } }, required: ["assetId"], description: "{assetId} of a stored image." };
const assetIdOf = (v: unknown): string => {
  const id = (v as { assetId?: unknown } | null)?.assetId;
  if (typeof id !== "string") throw new EditorError("INVALID_PARAMS", "image must be {assetId}.");
  return id;
};
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties, required, additionalProperties: false });

const SCHEMA_SECTIONS = ["commands", "document", "nativeData", "simulation", "scalar"] as const;

/** get_schema, whole or one section (Watchmaker reads it a section at a time). */
export function schemaSection(section?: unknown): unknown {
  const all = getWatchfaceAutomationSchema() as unknown as Record<string, unknown>;
  if (section === undefined) return all;
  if (typeof section !== "string" || !(SCHEMA_SECTIONS as readonly string[]).includes(section)) throw new EditorError("INVALID_PARAMS", `section is one of ${SCHEMA_SECTIONS.join(", ")}.`);
  return { [section]: all[section] };
}

const MAX_IMPORT_BYTES = 16 * 1024 * 1024;

export function automationTools(host: ToolHost): AutomationTool[] {
  const { broker, assets } = host;
  /** An editor method: `{ assetId }` in, data URLs out as `{ assetId }`. */
  const editor = (method: string) => async (args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolOutput> =>
    ({ json: await assets.toRefs(await broker.request(method, await assets.fromRefs(args), signal)) });

  return [
    {
      name: "get_context", readOnly: true,
      description: "Whether a face is open in Studio, and its session, revision, unsaved state and project. Safe before anything is open.",
      input_schema: obj({}),
      run: async (_args, signal) => ({ json: broker.connected ? await broker.request("get_context", {}, signal) : { editor: null, window: "closed" } }),
    },
    {
      name: "get_schema", readOnly: true,
      description: "The editable scene and command schema: document shape, every command, the nativeData catalog (weather, astronomy, health, training, charts), simulation fields. Pass section to read one part.",
      input_schema: obj({ section: { type: "string", enum: [...SCHEMA_SECTIONS] } }),
      run: async (args) => ({ json: schemaSection(args.section) }),
    },
    {
      name: "get_document", readOnly: true,
      description: "The open face: sessionId, revision, design, layers with placement (box in master pixels, movable, movement key), locks, capabilities (placement frame, resolutions, asset contracts, nativeData), diagnostics and undo state. Images come as {assetId}.",
      input_schema: obj({}),
      run: editor("get_document"),
    },
    {
      name: "apply_commands",
      description: `Apply scene commands to the open face as one undo step. Semantic commands (move_layer, place_layers, align_layers, distribute_layers, set_visibility, add_native_field…) or JSON-pointer set / unset / merge / array_* on /design. Pass the sessionId and revision from get_document; a stale revision is refused, read again and reapply. Images go in as {assetId}. ${LEGIBILITY}`,
      input_schema: obj({ ...SESSION, ...REVISION, ...MODE, commands: { type: "array", minItems: 1, maxItems: 100, items: { type: "object" } }, label: { type: "string", maxLength: 120 } }, ["sessionId", "baseRevision", "commands"]),
      run: editor("apply_commands"),
    },
    { name: "undo", description: "Undo one editor step.", input_schema: obj({ ...SESSION, ...REVISION }, ["sessionId", "baseRevision"]), run: editor("undo") },
    { name: "redo", description: "Redo one editor step.", input_schema: obj({ ...SESSION, ...REVISION }, ["sessionId", "baseRevision"]), run: editor("redo") },
    {
      name: "select", description: "Select layers in the editor so the person can see what you're working on.",
      input_schema: obj({ ...SESSION, layerIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 200 } }, ["sessionId", "layerIds"]),
      run: editor("select"),
    },
    {
      name: "set_view", description: "Switch Current / Always-on or change the simulation (time, battery, weather, data samples). Changes the view only, not the face or its revision.",
      input_schema: obj({ ...SESSION, ...MODE, simulation: { type: "object", description: "See get_schema simulation. values replaces the whole sample map." } }, ["sessionId"]),
      run: editor("set_view"),
    },
    {
      name: "render_preview", readOnly: true,
      description: `Draw the face as a PNG. resolution (a width from capabilities.resolutions) draws at that size; size overrides it. Returns the picture and its assetId. ${LEGIBILITY}`,
      input_schema: obj({ ...SESSION, ...MODE, ...SCENARIO, resolution: { type: ["integer", "string"] }, size: { type: "integer", minimum: 64, maximum: 1600 } }, ["sessionId"]),
      run: async (args, signal) => {
        const result = await broker.request("render_preview", args, signal) as { dataUrl: string } & Record<string, unknown>;
        const { dataUrl, ...rest } = result;
        const assetId = await assets.putDataUrl(dataUrl);
        return { json: { ...rest, assetId }, images: [{ data: dataUrl.slice(dataUrl.indexOf(",") + 1), mime: "image/png" }] };
      },
    },
    {
      name: "get_geometry", readOnly: true,
      description: "Exact boxes in master pixels for layers, and the round screen. Use it to size and place artwork instead of guessing from pictures.",
      input_schema: obj({ ...SESSION, ...MODE, ...IDS }, ["sessionId"]),
      run: editor("get_geometry"),
    },
    {
      name: "check_contrast", readOnly: true,
      description: "How readable text and data layers are against the pixels really behind them: text and background colour, WCAG ratio on average and at the least favourable tenth, the ratio needed (3:1 large, 4.5:1 otherwise) and a verdict.",
      input_schema: obj({ ...SESSION, ...MODE, ...SCENARIO, ...IDS }, ["sessionId"]),
      run: editor("check_contrast"),
    },
    {
      name: "sample_color", readOnly: true,
      description: "Exact colours from a stored image ({assetId} as image) or, without one, from the face drawn in master pixels. points give single pixels; regions give the average, coverage and main colours.",
      input_schema: obj({ ...SESSION, ...MODE, ...SCENARIO, image: { type: "object", properties: { assetId: { type: "string" } } }, points: { type: "array", items: { type: "object" }, maxItems: 64 }, regions: { type: "array", items: { type: "object" }, maxItems: 32 }, palette: { type: "integer", minimum: 0, maximum: 12 } }),
      run: editor("sample_color"),
    },
    {
      name: "crop_image",
      description: "A new PNG from a stored one: crop (a region in its own pixels), then trim (drops transparent margins, on unless false), then width and / or height (one keeps the aspect). Use it to size art to its slot exactly. Returns the new {assetId}.",
      input_schema: obj({ image: ASSET, crop: { type: "object", properties: { x: { type: "integer" }, y: { type: "integer" }, width: { type: "integer" }, height: { type: "integer" } } }, trim: { type: "boolean" }, width: { type: "integer", minimum: 1, maximum: 2048 }, height: { type: "integer", minimum: 1, maximum: 2048 } }, ["image"]),
      run: async (args) => ({ json: await cropAsset(assets, assetIdOf(args.image), args as never) }),
    },
    {
      name: "render_svg",
      description: "A self-contained SVG drawn to a transparent PNG of exactly width × height (give it a viewBox). For exact geometry: rings, ticks, frames, masks with holes, simple icons. Scripts and outside references are removed. Returns its {assetId}.",
      input_schema: obj({ svg: { type: "string", maxLength: 200000 }, width: { type: "integer", minimum: 1, maximum: 2048 }, height: { type: "integer", minimum: 1, maximum: 2048 } }, ["svg", "width", "height"]),
      run: editor("render_svg"),
    },
    {
      name: "recolor_image",
      description: "A stored image with its visible pixels painted one colour, alpha kept. With from, only pixels within tolerance (default 48) of that colour change. Returns the new {assetId}.",
      input_schema: obj({ image: ASSET, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, from: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" }, tolerance: { type: "integer", minimum: 0, maximum: 255 } }, ["image", "color"]),
      run: editor("recolor_image"),
    },
    {
      name: "validate", readOnly: true,
      description: `Check the open face against the editor, template and watch rules. Fix errors before saving. ${LEGIBILITY}`,
      input_schema: obj({ ...SESSION, ...MODE }, ["sessionId"]),
      run: editor("validate"),
    },
    {
      name: "save", description: "Save the open face now (Studio also saves on its own a moment after each change). name renames it.",
      input_schema: obj({ ...SESSION, ...REVISION, name: { type: "string", maxLength: 80 } }, ["sessionId", "baseRevision"]),
      run: editor("save"),
    },
    {
      name: "list_projects", readOnly: true, description: "The faces saved in Studio, with their ids.",
      input_schema: obj({}),
      run: async () => ({ json: { projects: await host.projects() } }),
    },
    {
      name: "open", description: "Open a saved face in Studio's editor. Refused while the open face has unsaved changes, unless saveChanges or discardChanges is true.",
      input_schema: obj({ projectId: { type: "string" }, saveChanges: { type: "boolean" }, discardChanges: { type: "boolean" } }, ["projectId"]),
      run: editor("open"),
    },
    {
      name: "import_asset",
      description: "Take a PNG, JPEG or WebP from this computer (an absolute path) for use in commands. Returns its {assetId} and size.",
      input_schema: obj({ path: { type: "string", maxLength: 4096 } }, ["path"]),
      run: async (args) => {
        const file = typeof args.path === "string" ? args.path : "";
        if (!path.isAbsolute(file)) throw new EditorError("INVALID_PARAMS", "path must be absolute.");
        const info = await stat(file).catch(() => null);
        if (!info?.isFile()) throw new EditorError("INVALID_PARAMS", "There is no file there.");
        if (info.size > MAX_IMPORT_BYTES) throw new EditorError("INVALID_PARAMS", "That file is over 16 MB.");
        const bytes = await readFile(file);
        if (!sniffImage(bytes)) throw new EditorError("INVALID_PARAMS", "Only PNG, JPEG and WebP images are taken.");
        return { json: { assetId: await assets.put(bytes), ...(pngSize(bytes) ?? {}) } };
      },
    },
  ];
}
