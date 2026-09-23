import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import {
  createWatchfaceAutomationAssetStore,
  type WatchfaceAutomationAssetStore
} from "./watchfaceAutomationAssets";
import {
  WATCHFACE_AUTOMATION_METHODS,
  WATCHFACE_AUTOMATION_SCENE_SCHEMA,
  type WatchfaceAutomationStatus
} from "./watchfaceAutomationTypes";

const HOST = "127.0.0.1";
const ENDPOINT = "/mcp";
const DEFAULT_PORT = 38_471;
const TOKEN_BYTES = 32;
const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_TEXT_RESULT_BYTES = 4 * 1024 * 1024;
const TOOL_TIMEOUT_MS = 120_000;
const SESSION_IDLE_MS = 30 * 60_000;
const MAX_SESSIONS = 16;

const WATCHFACE_LEGIBILITY_GUIDANCE =
  "Required before saving or exporting a newly authored face: inspect text at the smallest supported device resolution, with render_preview resolution and size both set to that native width; an enlarged master-canvas preview is insufficient. Measure visible glyphs, not transparent sprite padding. For a 416px display, start small metric/date digits around 12x17 visible pixels with continuous 1-2px strokes and clear spacing; this is a design target, not a firmware minimum or a guarantee. Thin italic digits around 9x13px need enlargement or stroke simplification. Test all digits 0-9, maximum-width values, weekdays and battery states for clipping and legibility. Enable solidAlpha:true on small timeStyles, metricStyles or dateStyles components to make final exported glyph coverage binary; inspect the exported PNGs after resizing because thresholding can erase thin strokes. nativeData assets have no solidAlpha setting: inspect and normalize their final-size glyph alpha separately. Render Current and AOD, build and inspect every exported resolution, and distinguish preview/schema validation from actual on-watch verification.";


type Dispatch = (method: string, params: Record<string, unknown>) => Promise<unknown>;

interface Session {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastSeen: number;
}

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  method?: string;
  schema: z.ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;
  openWorld?: boolean;
  /** Internal adapters may return native MCP content (including several images). */
  mcpHandler?: (params: Record<string, unknown>) => Promise<CallToolResult>;
  handler?: (params: Record<string, unknown>) => Promise<unknown>;
}

const sessionFields = {
  sessionId: z.string().min(1).max(200).describe("Editor sessionId returned by get_document."),
  baseRevision: z.number().int().nonnegative().describe("Current revision returned by get_document.")
};

const assetRef = z.object({ assetId: z.string().min(1).max(200) }).strict()
  .describe("A stored image: {assetId} from generate_image, import_asset, get_document or another image tool.");
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/).describe("#RRGGBB");
const previewScenario = z.record(z.string(), z.unknown()).optional()
  .describe("Sample data to render with, as in render_preview. Omit for the editor's active simulation.");
const imageSide = z.number().int().min(1).max(2048);
const pixelBox = z.object({ x: z.number(), y: z.number(), width: z.number().positive(), height: z.number().positive() }).strict();

function editorToolDefinitions(assetStore: WatchfaceAutomationAssetStore): ToolDefinition[] {
  return [
    {
      name: "get_schema", title: "Get watch-face scene schema", readOnly: true,
      description: "Read the complete editable scene and command schema before authoring a face, including the nativeData catalog of Weather, Astronomy, Health and Training fields, chart sources, component defaults and artwork state indices.",
      method: "get_schema", schema: {}
    },
    {
      name: "get_context", title: "Get watch-face studio context", readOnly: true,
      description: "Inspect whether an editor is open and, when it is, read its session, revision, dirty state and project identity. This is safe to call before opening a face.",
      method: WATCHFACE_AUTOMATION_METHODS.getContext, schema: {}
    },
    {
      name: "get_document", title: "Inspect watch-face document", readOnly: true,
      description: "Read the live editable watch-face, revision, semantic layers, selection, target resolutions and capabilities. Placement capabilities define the master-pixel frame; each layer reports rendered bounds, movability and its physical movement key. Native data layers include editable component paths and effective styles. Image data is returned as reusable assetId references.",
      method: WATCHFACE_AUTOMATION_METHODS.getDocument,
      schema: { includeDiagnostics: z.boolean().optional() }
    },
    {
      name: "apply_commands", title: "Edit watch face",
      description: "Atomically apply semantic or JSON-pointer scene commands as one undo step. Use the placement frame and layer placement metadata from get_document for move_layer, place_layers, align_layers and distribute_layers. Add/edit native fields through /design/nativeData using the get_schema catalog: parts, text labels, artwork and graph styles. Pass the exact sessionId and revision from get_document. Asset fields accept {assetId} from import_asset or get_document; native/weather artwork requires PNG.",
      method: WATCHFACE_AUTOMATION_METHODS.applyCommands,
      schema: {
        ...sessionFields,
        commands: z.array(z.unknown()).min(1).max(200),
        label: z.string().min(1).max(120).optional(),
        mode: z.enum(["current", "aod"]).optional()
      }
    },
    {
      name: "select", title: "Select watch-face layers",
      description: "Select semantic layer ids in the open editor so the human can inspect the agent's work.",
      method: WATCHFACE_AUTOMATION_METHODS.select,
      schema: {
        sessionId: sessionFields.sessionId,
        id: z.string().min(1).max(200).optional(),
        ids: z.array(z.string().min(1).max(200)).min(1).max(200).optional()
      }
    },
    {
      name: "undo", title: "Undo watch-face edit",
      description: "Undo one editor history entry.", method: WATCHFACE_AUTOMATION_METHODS.undo,
      schema: sessionFields
    },
    {
      name: "redo", title: "Redo watch-face edit",
      description: "Redo one editor history entry.", method: WATCHFACE_AUTOMATION_METHODS.redo,
      schema: sessionFields
    },
    {
      name: "set_view", title: "Set watch-face editor view",
      description: "Switch Current/AOD mode, resolution, selected complication or simulation without changing the design revision. Simulation is editor-only; values replace the current sample value map. See get_schema.simulation.",
      method: WATCHFACE_AUTOMATION_METHODS.setView,
      schema: {
        sessionId: sessionFields.sessionId,
        mode: z.enum(["current", "aod"]).optional(),
        resolution: z.union([z.string().min(1).max(80), z.number().int().min(100).max(2000)]).optional().describe("Resolution directory id or width returned by get_document."),
        previewComplication: z.string().max(100).optional(),
        simulation: z.object({
          enabled: z.boolean().optional(),
          playing: z.boolean().optional(),
          speed: z.union([z.literal(1), z.literal(60), z.literal(3600), z.literal(86400)]).optional(),
          dateTime: z.string().max(64).optional(),
          values: z.record(z.string(), z.string().max(160)).optional(),
          weather: z.object({ condition: z.number().int().min(0).max(40), night: z.boolean() }).optional(),
          chartHistory: z.array(z.number().min(0).max(1)).min(2).max(120).optional()
        }).optional()
      }
    },
    {
      name: "render_preview", title: "Render watch-face preview", readOnly: true,
      description: "Render the Current or AOD scene at a supported resolution. Uses active editor simulation unless scenario is provided; scenario:{} uses normal sample data. Scenario supports dateTime, values, weather and chartHistory (see get_schema.simulation). Returns PNG and an assetId. Simulation does not affect saved projects or exports.",
      method: WATCHFACE_AUTOMATION_METHODS.renderPreview,
      schema: {
        sessionId: sessionFields.sessionId,
        mode: z.enum(["current", "aod"]).optional(),
        resolution: z.union([z.string().min(1).max(80), z.number().int().min(100).max(2000)]).optional(),
        size: z.number().int().min(64).max(1600).optional(),
        scenario: z.record(z.string(), z.unknown()).optional()
      }
    },
    {
      name: "get_geometry", title: "Measure watch-face geometry", readOnly: true,
      description: "Exact boxes in master pixels (the capabilities.placement frame) for every layer, the round display circle, and each enabled calorie/exercise progress arc and bar: its swept box plus its arc or rect parameters. Use it to size and position artwork, overlays and masks instead of estimating from renders. Progress arcs and bars are edited through /design/kcalProgress and /design/exerciseProgress, not move_layer.",
      method: WATCHFACE_AUTOMATION_METHODS.getGeometry,
      schema: {
        sessionId: sessionFields.sessionId,
        mode: z.enum(["current", "aod"]).optional(),
        ids: z.array(z.string().min(1).max(200)).max(100).optional().describe("Only these layer or progress ids; omit for all.")
      }
    },
    {
      name: "check_contrast", title: "Check watch-face contrast", readOnly: true,
      description: "Measures how readable text and data layers are against the pixels actually behind them, by rendering the face in master pixels with and without each layer. Reports the text color, the background color, the WCAG contrast ratio against the average background and against its least favorable tenth, the required ratio (3:1 for large glyphs, 4.5:1 otherwise) and a verdict. Defaults to every visible time, date and metric layer.",
      method: WATCHFACE_AUTOMATION_METHODS.checkContrast,
      schema: {
        sessionId: sessionFields.sessionId,
        mode: z.enum(["current", "aod"]).optional(),
        ids: z.array(z.string().min(1).max(200)).max(24).optional().describe("Layer ids to measure; omit for all visible text and data layers."),
        scenario: previewScenario
      }
    },
    {
      name: "sample_color", title: "Sample colors", readOnly: true,
      description: "Reads exact colors from a stored image, or without image from the rendered face in master pixels. points return single pixels; regions return the alpha-weighted average, visible coverage and dominant colors. With neither, samples the whole image. Use it to match a mask to the background, take an accent from artwork, or check a color before recoloring.",
      method: WATCHFACE_AUTOMATION_METHODS.sampleColor,
      schema: {
        sessionId: sessionFields.sessionId.optional(),
        image: assetRef.optional(),
        mode: z.enum(["current", "aod"]).optional(),
        scenario: previewScenario,
        points: z.array(z.object({ x: z.number(), y: z.number() }).strict()).max(64).optional(),
        regions: z.array(pixelBox).max(16).optional(),
        palette: z.number().int().min(0).max(12).optional().describe("Dominant colors per region. Default 5.")
      }
    },
    {
      name: "recolor_image", title: "Recolor image",
      description: "Makes a new PNG from a stored image with its visible pixels painted one exact color, keeping alpha so edges stay smooth. With from, only pixels within tolerance (largest per-channel difference, default 48) of that color change. Use it to make a mask exactly match the background or to tint an icon. Returns the new image as an assetId.",
      method: WATCHFACE_AUTOMATION_METHODS.recolorImage,
      schema: {
        image: assetRef,
        color: hexColor,
        from: hexColor.optional(),
        tolerance: z.number().min(0).max(255).optional()
      }
    },
    {
      name: "render_svg", title: "Render SVG",
      description: "Rasterizes a self-contained SVG to a transparent PNG of exactly width x height pixels and returns it as an assetId. Use it for precise geometric artwork where exact pixels matter: frames, rounded caps, masks with holes, ticks, rings, segment gaps and simple icons. Give the SVG a viewBox; it is stretched to width x height. Scripts, foreignObject and external references are removed, and only common system fonts are available.",
      method: WATCHFACE_AUTOMATION_METHODS.renderSvg,
      schema: {
        svg: z.string().min(1).max(200_000),
        width: imageSide,
        height: imageSide
      }
    },
    {
      name: "validate", title: "Validate watch face", readOnly: true,
      description: "Validate the live document against editor, template and target-device constraints before saving or building.",
      method: WATCHFACE_AUTOMATION_METHODS.validate,
      schema: { sessionId: sessionFields.sessionId }
    },
    {
      name: "save", title: "Save watch-face project",
      description: "Save the live editable project. The response includes the resulting revision and project identity.",
      method: WATCHFACE_AUTOMATION_METHODS.save,
      schema: { ...sessionFields, name: z.string().min(1).max(80).optional() }
    },
    {
      name: "close", title: "Close watch-face editor",
      description: "Close the current editor and return to the project hub. A dirty editor requires saveChanges or discardChanges explicitly.",
      method: WATCHFACE_AUTOMATION_METHODS.close,
      schema: {
        ...sessionFields,
        saveChanges: z.boolean().optional(),
        discardChanges: z.boolean().optional()
      }
    },
    {
      name: "open", title: "Open watch-face project",
      description: "Open a saved project or selected starter archive in Watch Face Studio. A dirty editor rejects the request unless saveChanges or discardChanges is explicit.",
      method: WATCHFACE_AUTOMATION_METHODS.open,
      schema: {
        project: z.string().max(200).optional(),
        archive: z.string().max(200).optional(),
        name: z.string().max(80).optional(),
        firmwareType: z.string().max(120).optional(),
        watchModel: z.string().max(80).optional(),
        saveChanges: z.boolean().optional(),
        discardChanges: z.boolean().optional()
      }
    },
    {
      name: "convert", title: "Convert watch-face template",
      description: "Convert the open design by watchModel, preserving its layout, fonts, assets, raw edits and AOD. The destination carrier is selected automatically. Opens a new editor session after success.",
      method: WATCHFACE_AUTOMATION_METHODS.convert,
      schema: {
        ...sessionFields,
        targetArchive: z.string().min(1).max(200).optional(),
        name: z.string().max(80).optional(),
        firmwareType: z.string().max(120).optional(),
        watchModel: z.string().max(80).optional()
      }
    },
    {
      name: "list_projects", title: "List watch-face projects", readOnly: true,
      description: "List saved editable CorosLink watch-face projects.",
      method: WATCHFACE_AUTOMATION_METHODS.listProjects,
      schema: {}
    },
    {
      name: "list_templates", title: "List watch-face templates", readOnly: true, openWorld: true,
      description: "List templates already available to CorosLink for the requested watch target. This tool does not fetch an arbitrary URL.",
      method: WATCHFACE_AUTOMATION_METHODS.listTemplates,
      schema: {
        firmwareType: z.string().min(1).max(120),
        query: z.string().max(200).optional(),
        language: z.string().max(20).optional()
      }
    },
    {
      name: "load_template", title: "Load watch-face template", openWorld: true,
      description: "Download and validate one editable template returned by list_templates. Arbitrary URLs are rejected by CorosLink's session allowlist.",
      method: "load_template",
      schema: {
        packageUrl: z.string().url().max(4096),
        name: z.string().max(80).optional(),
        firmwareType: z.string().max(120).optional()
      }
    },
    {
      name: "list_fonts", title: "List local fonts", readOnly: true,
      description: "List host-local font families available for watch-face rasterization.",
      method: WATCHFACE_AUTOMATION_METHODS.listFonts,
      schema: {}
    },
    {
      name: "duplicate_project", title: "Duplicate watch-face project",
      description: "Duplicate a saved editable project.",
      method: WATCHFACE_AUTOMATION_METHODS.duplicateProject,
      schema: { projectId: z.string().uuid() }
    },
    {
      name: "delete_project", title: "Delete watch-face project", destructive: true,
      description: "Permanently delete one saved watch-face project. Requires confirmed=true from an explicit user request.",
      method: WATCHFACE_AUTOMATION_METHODS.deleteProject,
      schema: { projectId: z.string().uuid(), confirmed: z.literal(true) }
    },
    {
      name: "import_archive", title: "Import watch-face archive",
      description: "Import and validate a local .zip or .dat starter archive. Paths must be absolute local files; existing files are never modified.",
      method: WATCHFACE_AUTOMATION_METHODS.importArchive,
      schema: { path: z.string().min(1).max(4096) }
    },
    {
      name: "import_asset", title: "Import watch-face asset",
      description: "Copy a local PNG/JPEG/WebP image or PNG raster-font folder into the private automation asset store and return opaque assetId references.",
      schema: { path: z.string().min(1).max(4096), kind: z.enum(["image", "raster_font_folder"]).default("image") },
      handler: async ({ path: assetPath, kind }) => {
        if (typeof assetPath !== "string") throw new Error("Provide an absolute local asset path.");
        return kind === "raster_font_folder"
          ? assetStore.importRasterFontFolder(assetPath)
          : assetStore.importImage(assetPath);
      }
    },
    {
      name: "export_project", title: "Export editable watch-face project",
      description: "Export the editable CorosLink project package to a new explicit local .zip path. Existing files are not overwritten.",
      method: WATCHFACE_AUTOMATION_METHODS.exportProject,
      schema: {
        sessionId: sessionFields.sessionId,
        destinationPath: z.string().min(1).max(4096),
        overwrite: z.literal(false).optional()
      }
    },
    {
      name: "build_archive", title: "Build watch-face archive",
      description: "Build and validate an installable archive from the live scene without publishing it.",
      method: WATCHFACE_AUTOMATION_METHODS.buildArchive,
      schema: { ...sessionFields, name: z.string().min(1).max(80).optional() }
    },
    {
      name: "export_archive", title: "Export built watch-face archive",
      description: "Write an already-built archive to a new explicit local .zip or .dat path. Existing files are not overwritten.",
      method: WATCHFACE_AUTOMATION_METHODS.exportArchive,
      schema: {
        archiveId: z.string().min(1).max(200),
        destinationPath: z.string().min(1).max(4096),
        overwrite: z.literal(false).optional()
      }
    },
    {
      name: "publish", title: "Publish watch face", destructive: true, openWorld: true,
      description: "Publish a validated archive through the user's authenticated COROS account. Call only after the user explicitly authorizes this exact publish and pass confirmed=true.",
      method: WATCHFACE_AUTOMATION_METHODS.publish,
      schema: {
        archiveId: z.string().min(1).max(200), name: z.string().min(1).max(80),
        firmwareType: z.string().min(1).max(120), backgroundImageId: z.number().int().nonnegative(),
        language: z.string().max(20).optional(), confirmed: z.literal(true)
      }
    }
  ];
}

// Tools whose PNG the in-app agent should also see, not just reference.
const AGENT_IMAGE_METHODS = new Set<string>([
  WATCHFACE_AUTOMATION_METHODS.renderPreview,
  WATCHFACE_AUTOMATION_METHODS.recolorImage,
  WATCHFACE_AUTOMATION_METHODS.renderSvg
]);

export class WatchfaceAutomationServer {
  private readonly dispatch: Dispatch;
  private readonly userDataPath: string;
  private readonly assets: WatchfaceAutomationAssetStore;
  private server: http.Server | null = null;
  private sessions = new Map<string, Session>();
  private token: string | null = null;
  private port: number | null = null;
  private error?: string;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private startPromise: Promise<WatchfaceAutomationStatus> | null = null;
  private initializingSessions = 0;

  constructor(private readonly options: { dispatch: Dispatch; userDataPath: string; tools?: ToolDefinition[]; name?: string; instructions?: string; defaultPort?: number }) {
    this.dispatch = options.dispatch;
    this.userDataPath = path.resolve(options.userDataPath);
    this.assets = createWatchfaceAutomationAssetStore(this.userDataPath);
  }

  getStatus(): WatchfaceAutomationStatus {
    return {
      enabled: this.server !== null && this.port !== null,
      url: this.port === null ? null : `http://${HOST}:${this.port}${ENDPOINT}`,
      token: this.server ? this.token : null,
      port: this.port,
      ...(this.error ? { error: this.error } : {})
    };
  }

  start(options: { port?: number } = {}): Promise<WatchfaceAutomationStatus> {
    if (this.server) return Promise.resolve(this.getStatus());
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal(options).finally(() => { this.startPromise = null; });
    return this.startPromise;
  }

  private async startInternal(options: { port?: number }): Promise<WatchfaceAutomationStatus> {
    const requestedPort = options.port ?? this.options.defaultPort ?? DEFAULT_PORT;
    if (!Number.isSafeInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
      this.error = "Automation port must be a whole number from 0 through 65535.";
      return this.getStatus();
    }
    try {
      this.token = await this.loadOrCreateToken();
      const server = http.createServer((request, response) => {
        void this.handleHttpRequest(request, response).catch(() => {
          if (!response.headersSent) this.sendJsonError(response, 500, -32603, "Internal server error.");
          else response.destroy();
        });
      });
      server.maxHeadersCount = 64;
      server.headersTimeout = 10_000;
      server.requestTimeout = TOOL_TIMEOUT_MS + 10_000;
      await new Promise<void>((resolve, reject) => {
        const onError = (caught: Error) => { server.off("listening", onListen); reject(caught); };
        const onListen = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListen);
        server.listen(requestedPort, HOST);
      });
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Automation server did not bind a TCP port.");
      this.server = server;
      this.port = address.port;
      this.error = undefined;
      this.cleanupTimer = setInterval(() => { void this.closeIdleSessions(); }, 60_000);
      this.cleanupTimer.unref();
    } catch (caught) {
      this.error = boundedError(caught);
      this.server = null;
      this.port = null;
      this.token = null;
    }
    return this.getStatus();
  }

  async stop(options: { revokeToken?: boolean } = {}): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.server.close()));
    const server = this.server;
    this.server = null;
    this.port = null;
    this.token = null;
    this.error = undefined;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    if (options.revokeToken) {
      await fs.promises.rm(this.tokenPath(), { force: true }).catch(() => undefined);
    }
  }

  async callTool(name: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const definition = (this.options.tools ?? editorToolDefinitions(this.assets)).find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`Unknown watch-face automation tool "${name}".`);
    const parsed = z.object(definition.schema).strict().parse(params) as Record<string, unknown>;
    return this.executeDefinition(definition, parsed);
  }

  /** Function-tool specs for the in-app Watchmaker panel, limited to `names`. */
  listAgentTools(names: readonly string[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
    return editorToolDefinitions(this.assets)
      .filter((definition) => names.includes(definition.name))
      .map((definition) => {
        const { $schema: _ignored, ...parameters } = z.toJSONSchema(z.object(definition.schema).strict()) as Record<string, unknown>;
        return {
          name: definition.name,
          description: ["apply_commands", "render_preview", "validate"].includes(definition.name)
            ? `${definition.description} ${WATCHFACE_LEGIBILITY_GUIDANCE}`
            : definition.description,
          parameters
        };
      });
  }

  /** Stores an image the user attached in the Studio AI panel. */
  importAgentImage(dataUrl: string) {
    return this.assets.importImageDataUrl(dataUrl);
  }

  /** Reads a stored asset back as a data URL, e.g. to hand it to image editing. */
  readAgentImage(assetId: string): Promise<string> {
    return this.assets.hydrateAssetRefs<unknown>({ assetId }) as Promise<string>;
  }

  /** Runs one tool for the in-app agent, keeping a rendered PNG for vision input. */
  async callAgentTool(name: string, params: Record<string, unknown>): Promise<{ result: unknown; imageDataUrl?: string }> {
    const definition = editorToolDefinitions(this.assets).find((candidate) => candidate.name === name);
    if (!definition) throw new Error(`Unknown watch-face tool "${name}".`);
    // Non-strict function calling often sends null for omitted optional
    // arguments; treat those as absent instead of failing validation.
    const cleaned = Object.fromEntries(
      Object.entries(params).filter(([, value]) => value !== null)
    );
    const parsed = z.object(definition.schema).strict().parse(cleaned) as Record<string, unknown>;
    const hydrated = await this.assets.hydrateAssetRefs(parsed);
    const raw = definition.handler
      ? await withTimeout(definition.handler(hydrated), TOOL_TIMEOUT_MS)
      : await withTimeout(this.dispatch(definition.method!, hydrated), TOOL_TIMEOUT_MS);
    let imageDataUrl: string | undefined;
    if (AGENT_IMAGE_METHODS.has(definition.method ?? "") && raw && typeof raw === "object") {
      const withImage = await this.assets.hydrateAssetRefs(raw) as Record<string, unknown>;
      if (typeof withImage.dataUrl === "string" && withImage.dataUrl.startsWith("data:image/png;base64,")) {
        imageDataUrl = withImage.dataUrl;
      }
    }
    return { result: await this.assets.externalizeDataImages(raw), ...(imageDataUrl ? { imageDataUrl } : {}) };
  }

  private async executeDefinition(definition: ToolDefinition, params: Record<string, unknown>): Promise<unknown> {
    const hydrated = this.options.tools ? params : await this.assets.hydrateAssetRefs(params);
    const result = definition.handler
      ? await withTimeout(definition.handler(hydrated), TOOL_TIMEOUT_MS)
      : await withTimeout(this.dispatch(definition.method!, hydrated), TOOL_TIMEOUT_MS);
    return this.options.tools ? result : this.assets.externalizeDataImages(result);
  }

  private createMcpServer(): McpServer {
    const server = new McpServer(
      { name: this.options.name ?? "coroslink-watchface-studio", version: "1.0.0" },
      { capabilities: this.options.tools ? {} : { resources: {} }, instructions: this.options.instructions ?? (
        "Inspect the scene schema and live document before editing. Use capabilities.placement and each layer's placement metadata for movement; do not assume an 800 x 800 canvas. Use sessionId and baseRevision for mutations. Apply coherent edits atomically, read the resulting document, render both Current and AOD, validate, then save. Build the archive to verify all device resolutions. Publishing requires the user's explicit authorization. " + WATCHFACE_LEGIBILITY_GUIDANCE) }
    );
    for (const definition of this.options.tools ?? editorToolDefinitions(this.assets)) {
      server.registerTool(definition.name, {
        title: definition.title,
        description: !this.options.tools && ["get_schema", "apply_commands", "import_asset", "render_preview", "validate", "build_archive", "save"].includes(definition.name)
          ? `${definition.description} ${WATCHFACE_LEGIBILITY_GUIDANCE}`
          : definition.description,
        inputSchema: z.object(definition.schema).strict(),
        annotations: {
          readOnlyHint: definition.readOnly === true,
          destructiveHint: definition.destructive === true,
          idempotentHint: definition.readOnly === true,
          openWorldHint: definition.openWorld === true
        }
      }, async (params) => {
        try {
          if (definition.mcpHandler) return await definition.mcpHandler(params as Record<string, unknown>);
          const original = AGENT_IMAGE_METHODS.has(definition.method ?? "")
            ? await this.assets.hydrateAssetRefs(await this.executeDefinition(definition, params as Record<string, unknown>))
            : undefined;
          const result = original === undefined
            ? await this.executeDefinition(definition, params as Record<string, unknown>)
            : await this.assets.externalizeDataImages(original);
          const content: Array<
            { type: "image"; mimeType: string; data: string } |
            { type: "text"; text: string }
          > = [];
          if (original && typeof original === "object") {
            const dataUrl = (original as Record<string, unknown>).dataUrl;
            const match = typeof dataUrl === "string" ? dataUrl.match(/^data:image\/png;base64,(.+)$/) : null;
            if (match) content.push({ type: "image", mimeType: "image/png", data: match[1]! });
          }
          content.push({ type: "text", text: stringifyBounded(result) });
          return { content, structuredContent: asStructuredContent(result) };
        } catch (caught) {
          const error = boundedErrorPayload(caught);
          return {
            isError: true,
            content: [{ type: "text", text: stringifyBounded({ error }) }],
            structuredContent: { error }
          };
        }
      });
    }
    if (!this.options.tools) server.registerResource(
      "watchface-scene-schema",
      "coroslink://watchface/scene-schema",
      { title: "CorosLink watch-face scene schema", mimeType: "application/json" },
      async () => {
        let schema: unknown = WATCHFACE_AUTOMATION_SCENE_SCHEMA;
        try { schema = await withTimeout(this.dispatch("get_schema", {}), TOOL_TIMEOUT_MS); } catch { /* static bootstrap schema */ }
        return { contents: [{ uri: "coroslink://watchface/scene-schema", mimeType: "application/json", text: stringifyBounded(schema) }] };
      }
    );
    return server;
  }

  private async handleHttpRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    if (request.url !== ENDPOINT) return this.sendJsonError(response, 404, -32004, "Not found.");
    if (!this.validHost(request.headers.host)) return this.sendJsonError(response, 403, -32003, "Invalid Host header.");
    if (!this.validOrigin(request.headers.origin)) return this.sendJsonError(response, 403, -32003, "Cross-origin requests are not allowed.");
    if (!this.authorized(request.headers.authorization)) {
      response.setHeader("WWW-Authenticate", 'Bearer realm="CorosLink Watch Face Studio"');
      return this.sendJsonError(response, 401, -32001, "Authentication required.");
    }
    if (!request.method || !["GET", "POST", "DELETE"].includes(request.method)) {
      response.setHeader("Allow", "GET, POST, DELETE");
      return this.sendJsonError(response, 405, -32600, "Method not allowed.");
    }
    const sessionHeader = request.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? undefined : sessionHeader;
    let body: unknown;
    if (request.method === "POST") {
      try { body = await readJsonBody(request); }
      catch (caught) { return this.sendJsonError(response, 400, -32700, boundedError(caught)); }
    }
    let session = sessionId ? this.sessions.get(sessionId) : undefined;
    if (sessionId && !session) return this.sendJsonError(response, 404, -32002, "Unknown or expired MCP session.");
    if (!session) {
      if (request.method !== "POST" || !isInitializeRequest(body)) {
        return this.sendJsonError(response, 400, -32000, "A valid MCP session or initialize request is required.");
      }
      if (this.sessions.size + this.initializingSessions >= MAX_SESSIONS) {
        return this.sendJsonError(response, 429, -32005, "Too many MCP sessions are open. Close an existing client and retry.");
      }
      this.initializingSessions += 1;
      const mcpServer = this.createMcpServer();
      let transport!: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
        onsessioninitialized: (id) => {
          this.sessions.set(id, { server: mcpServer, transport, lastSeen: Date.now() });
        },
        onsessionclosed: (id) => { this.sessions.delete(id); }
      });
      transport.onclose = () => {
        if (transport.sessionId) this.sessions.delete(transport.sessionId);
      };
      try {
        await mcpServer.connect(transport);
        await transport.handleRequest(request, response, body);
      } finally {
        this.initializingSessions -= 1;
        if (!transport.sessionId) await mcpServer.close().catch(() => undefined);
      }
      return;
    }
    session.lastSeen = Date.now();
    await session.transport.handleRequest(request, response, body);
  }

  private validHost(host: string | undefined): boolean {
    if (!host || this.port === null) return false;
    try {
      const parsed = new URL(`http://${host}`);
      return (parsed.hostname === HOST || parsed.hostname === "localhost") &&
        Number(parsed.port || 80) === this.port;
    } catch { return false; }
  }

  private validOrigin(origin: string | undefined): boolean {
    if (!origin) return true;
    if (this.port === null) return false;
    try {
      const parsed = new URL(origin);
      return parsed.protocol === "http:" &&
        (parsed.hostname === HOST || parsed.hostname === "localhost") &&
        Number(parsed.port || 80) === this.port;
    } catch { return false; }
  }

  private authorized(authorization: string | undefined): boolean {
    const supplied = authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
    if (!supplied || !this.token) return false;
    const left = Buffer.from(supplied);
    const right = Buffer.from(this.token);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  }

  private async closeIdleSessions(): Promise<void> {
    const cutoff = Date.now() - SESSION_IDLE_MS;
    const expired = [...this.sessions.entries()].filter(([, session]) => session.lastSeen < cutoff);
    for (const [id, session] of expired) {
      this.sessions.delete(id);
      await session.server.close().catch(() => undefined);
    }
  }

  private sendJsonError(response: ServerResponse, status: number, code: number, message: string): void {
    if (response.headersSent) return;
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
  }

  private tokenPath(): string {
    return path.join(this.userDataPath, "watchface-automation", "bearer-token");
  }

  private async loadOrCreateToken(): Promise<string> {
    const tokenPath = this.tokenPath();
    await fs.promises.mkdir(path.dirname(tokenPath), { recursive: true, mode: 0o700 });
    await fs.promises.chmod(path.dirname(tokenPath), 0o700);
    try {
      const existing = (await fs.promises.readFile(tokenPath, "utf8")).trim();
      if (/^[A-Za-z0-9_-]{43}$/.test(existing)) {
        await fs.promises.chmod(tokenPath, 0o600);
        return existing;
      }
    } catch (caught) {
      if ((caught as NodeJS.ErrnoException).code !== "ENOENT") throw caught;
    }
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    const temporary = `${tokenPath}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.promises.writeFile(temporary, `${token}\n`, { mode: 0o600, flag: "wx" });
      await fs.promises.rename(temporary, tokenPath);
      await fs.promises.chmod(tokenPath, 0o600);
    } finally {
      await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    }
    return token;
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers["content-length"];
  if (declared && Number(declared) > MAX_REQUEST_BYTES) throw new Error("Request body is too large.");
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.length;
    if (total > MAX_REQUEST_BYTES) {
      request.destroy();
      throw new Error("Request body is too large.");
    }
    chunks.push(bytes);
  }
  if (total === 0) throw new Error("Request body is empty.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("The watch-face editor did not respond within 120 seconds.")), timeoutMs);
      })
    ]);
  } finally { if (timeout) clearTimeout(timeout); }
}

function stringifyBounded(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? "null";
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_RESULT_BYTES) {
    throw new Error("The watch-face tool result is too large. Request a narrower result.");
  }
  return text;
}

function asStructuredContent(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return { result: value };
}

function boundedError(caught: unknown): string {
  const message = caught instanceof Error ? caught.message : String(caught);
  return message.replace(/[\u0000-\u001f\u007f]+/g, " ").slice(0, 1000) || "Watch-face automation failed.";
}

function boundedErrorPayload(caught: unknown): Record<string, unknown> {
  const record = caught && typeof caught === "object"
    ? caught as Record<string, unknown>
    : undefined;
  const code = typeof record?.code === "string"
    ? record.code.replace(/[^A-Z0-9_-]/gi, "").slice(0, 80) || "AUTOMATION_ERROR"
    : "AUTOMATION_ERROR";
  const error: Record<string, unknown> = { code, message: boundedError(caught) };
  if (record?.details !== undefined) {
    try {
      const encoded = JSON.stringify(record.details);
      if (encoded && Buffer.byteLength(encoded, "utf8") <= 256 * 1024) {
        error.details = JSON.parse(encoded);
      }
    } catch { /* omit non-serializable details */ }
  }
  return error;
}
