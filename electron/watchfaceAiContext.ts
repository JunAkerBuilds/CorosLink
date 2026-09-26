import { sanitizeAssetReviews } from "./watchfaceAiAssetReview";
import { sanitizeGenerationAttempts } from "./watchfaceAiGeneration";
import type { WatchfaceAiMemory } from "./watchfaceAutomationTypes";
import { sanitizeRequirements } from "./watchfaceAiRequirements";

type RecordValue = Record<string, any>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value : {};

/** Superseded snapshots need not crowd out the latest state in long edits. */
export function compactWatchfaceInputs(input: Record<string, unknown>[]): void {
  let snapshots = 0, previews = 0;
  for (let index = input.length - 1; index >= 0; index--) {
    const item = input[index]!;
    if (item.type === "function_call_output" && typeof item.output === "string") {
      let output: RecordValue;
      try { output = record(JSON.parse(item.output)); } catch { continue; }
      const document = output.document ?? (output.design ? output : null);
      if (document && ++snapshots > 2) {
        const replacement = { sessionId: document.sessionId, revision: document.revision, note: "Superseded document snapshot. Use the newest document or call get_document." };
        item.output = JSON.stringify(output.document ? { ...output, document: replacement, result: replacement } : replacement);
      }
    }
    const content = item.content as Array<RecordValue> | undefined;
    if (Array.isArray(content) && content.some((part) => typeof part.text === "string" && /^(Rendered preview returned|Editor preview from)/.test(part.text)) && ++previews > 2) {
      item.content = content.filter((part) => part.type !== "input_image");
    }
  }
}

/** Keep binary payloads out of the agent's durable evidence and retry keys. */
export function evidenceJson(value: unknown, limit = 1800): string {
  const text = JSON.stringify(value, (_key, child) =>
    typeof child === "string" && child.startsWith("data:image/") ? "[image data omitted]" : child
  ) ?? "null";
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

export function sanitizeWatchfaceAiMemory(value: unknown): WatchfaceAiMemory | undefined {
  const source = record(value);
  if (source.version !== 1 || !Array.isArray(source.entries)) return undefined;
  return {
    version: 1,
    ...(Array.isArray(source.assetReviews) ? { assetReviews: sanitizeAssetReviews(source.assetReviews) } : {}),
    ...(Array.isArray(source.generationAttempts) ? { generationAttempts: sanitizeGenerationAttempts(source.generationAttempts) } : {}),
    ...(Array.isArray(source.designReferenceIds) ? { designReferenceIds: source.designReferenceIds.filter((id: unknown) => typeof id === "string" && /^[a-f0-9]{64}$/.test(id)).slice(0, 5) } : {}),
    ...(Array.isArray(source.requirements) ? { requirements: sanitizeRequirements(source.requirements) } : {}),
    ...(Array.isArray(source.generatedAssets) ? { generatedAssets: source.generatedAssets.flatMap((value: unknown) => {
      const asset = record(value);
      return typeof asset.assetId === "string" && asset.assetId.length <= 200 && Number.isFinite(asset.width) && asset.width > 0 && Number.isFinite(asset.height) && asset.height > 0
        ? [{ assetId: asset.assetId, width: asset.width, height: asset.height }] : [];
    }) } : {}),
    ...(typeof source.projectId === "string" ? { projectId: source.projectId.slice(0, 200) } : {}),
    entries: source.entries.slice(-24).flatMap((entry: unknown) => {
      const item = record(entry);
      return typeof item.tool === "string" && typeof item.summary === "string" &&
        (item.status === "done" || item.status === "failed")
        ? [{ tool: item.tool.slice(0, 80), status: item.status, summary: item.summary.slice(0, 2200) }]
        : [];
    })
  };
}

/** The complete commands remain available; bulky catalogs are loaded on demand. */
export function focusWatchfaceSchema(value: unknown, section: string = "overview", ids?: string[]): unknown {
  const schema = record(value);
  if (!schema.commands || section === "full") return value;
  if (section !== "overview") {
    if (!["commands", "document", "nativeData", "simulation"].includes(section)) throw new Error("Unknown schema section. Use overview, commands, document, nativeData, simulation or full.");
    const selected = schema[section];
    if (section === "nativeData" && ids?.length && Array.isArray(selected?.fields)) {
      const fields = selected.fields.filter((field: RecordValue) => ids.includes(field.id));
      const missing = ids.filter((id) => !fields.some((field: RecordValue) => field.id === id));
      if (missing.length) throw new Error(`Unknown native field ids: ${missing.join(", ")}`);
      return { ...selected, fields };
    }
    return selected;
  }
  const native = record(schema.nativeData);
  const document = record(schema.document);
  const design = record(document.$defs?.design ?? document.properties?.design);
  return {
    commands: schema.commands,
    designProperties: Object.keys(record(design.properties)),
    nativeFields: Array.isArray(native.fields) ? native.fields.map((field: RecordValue) => ({
      id: field.id, label: field.label, category: field.category, creation: field.creation, minimumFormatVersion: field.minimumFormatVersion,
      ...(field.note ? { note: field.note } : {}),
      components: Array.isArray(field.components) ? field.components.map((component: RecordValue) => ({
        id: component.id, assetRole: component.assetRole, spriteCount: component.spriteCount,
        stateIndices: component.stateIndices, countSource: component.countSource
      })) : []
    })) : [],
    lookup: "get_schema accepts section: commands, document, nativeData, simulation or full. Use ids with nativeData to fetch role meanings, ordering, dimensions and installation paths before generating assets. Overview counts are defaults; capabilities.assetContracts contains the active template/configured counts. Get document before raw design patches; do not guess property names."
  };
}

/** Retain editable state while omitting duplicated raw baselines and dormant modes. */
export function focusWatchfaceDocument(value: unknown): unknown {
  const source = record(value);
  if (!source.design) return value;
  const { advanced: _advanced, ...rest } = source;
  const { configTextEdits, modeDesigns, ...design } = record(source.design);
  const capabilities = record(source.capabilities);
  const activeMode = source.view?.mode;
  return {
    ...rest,
    capabilities: {
      ...capabilities,
      nativeResolutions: Array.isArray(capabilities.nativeResolutions)
        ? capabilities.nativeResolutions.map((resolution: RecordValue) => ({ directory: resolution.directory, width: resolution.width, height: resolution.height }))
        : capabilities.nativeResolutions
    },
    design: { ...design, ...(activeMode === "aod" && modeDesigns?.aod ? { modeDesigns: { aod: modeDesigns.aod } } : {}) },
    deferred: {
      configPaths: Object.keys(record(configTextEdits)),
      modeDesigns: Object.keys(record(modeDesigns)),
      lookup: "get_document with full:true returns native configs/sprite catalogs, raw text, baselines and all mode designs. The live view and capabilities.layers describe the active mode."
    }
  };
}

/** Compare renderer-reported geometry, not just the command's success flag. */
export function watchfaceEditEvidence(before: unknown, after: unknown, commands: unknown): RecordValue {
  const previous = record(before), current = record(after);
  const beforeLayers: RecordValue[] = previous.capabilities?.layers ?? [];
  const afterLayers: RecordValue[] = current.capabilities?.layers ?? [];
  const oldLayers = new Map(beforeLayers.map((layer) => [layer.id, layer]));
  const bounds = (layer: RecordValue | undefined) => layer?.placement?.bounds ?? layer?.bounds;
  const changedLayers = afterLayers.flatMap((layer) => {
    const old = oldLayers.get(layer.id);
    return !old || JSON.stringify([bounds(old), old.visible, old.locked]) !== JSON.stringify([bounds(layer), layer.visible, layer.locked])
      ? [{ id: layer.id, before: bounds(old) ?? null, after: bounds(layer), visible: layer.visible, locked: layer.locked }]
      : [];
  });
  const movementWarnings: string[] = [];
  // Multiple movement commands can intentionally cancel one another. Check
  // only a single move for a layer; report actual geometry for every batch.
  if (Array.isArray(commands)) for (const command of commands) {
    if (command?.op !== "move_layer" || (!command.dx && !command.dy)) continue;
    if (commands.filter((candidate) => candidate.id === command.id && candidate.op === "move_layer").length !== 1) continue;
    const old = oldLayers.get(command.id), next = afterLayers.find((layer) => layer.id === command.id);
    const previousBox = bounds(old), nextBox = bounds(next);
    if (previousBox && nextBox && JSON.stringify(previousBox) === JSON.stringify(nextBox)) {
      movementWarnings.push(`${command.id}: requested movement but rendered bounds did not change. Inspect geometry, locks, movementKey and clamping before retrying.`);
    } else if (previousBox && nextBox &&
      (Math.abs(nextBox.x0 - previousBox.x0 - (command.dx ?? 0)) > 1 ||
       Math.abs(nextBox.y0 - previousBox.y0 - (command.dy ?? 0)) > 1)) {
      movementWarnings.push(`${command.id}: observed movement differs from the requested delta. Inspect the actual bounds and placement limits before claiming the target position was reached.`);
    }
  }
  return { revision: current.revision, changedLayers: changedLayers.slice(0, 60), movementWarnings };
}

/** How each asset-contract kind behaves on the watch and in the editor. */
export const WATCHFACE_COMPONENT_KIND_GUIDE: Record<string, string> = {
  "state-sprites": "Firmware picks one frame from an ordered state set as the live value changes (battery). Draw every frame as a distinct state with identical canvas size and alignment, install each under stateReplacementsPath/<index>, and preview each verification scenario. A single replacement image makes the indicator static.",
  "digit-font": "Live digits drawn from a font. Either set a fontFamily, or install a rasterFont (PNG atlas + glyphs order + columns) covering 0–9 and clear the fontFamily override so the atlas is used. Scale lives on the matching style object.",
  "weekday-labels": "Live weekday text in firmware order MON..SUN. A rasterFont must cover every glyph needed to compose all seven labels.",
  "month-labels": "Live month labels in firmware order DEC, JAN..NOV. A rasterFont must cover every glyph needed for all twelve labels.",
  "weather-assets": "Weather icon/temperature sets at weatherIndicator.assets.<set>[index] = {assetId}. Day and night condition sets share indices 0–40 in COROS order; inspect the original images instead of guessing meanings. Missing indices fall back to bundled defaults.",
  "native-component-assets": "A native data field component (health, training, calendar, weather...). Per-index PNGs at assets[role][index]; style, text and chart parameters at their paths. get_schema section:nativeData ids:[field] explains roles, counts and ordering.",
  "native-graph": "Firmware-drawn graph or value with no sprites; styled through its numeric/color parameters only.",
  "single-image": "One PNG for this config slot, installed at replacementPath as {dataUrl:{assetId},width,height}. Decorations do not supply live values.",
  "rotating-sprite": "An analog hand: one PNG the firmware rotates around its image center using live time. Draw it pointing at 12 with the pivot exactly at the canvas center; never make one frame per angle. Hands on a face without template hands are added by merging {enabled:true, replacement} at editOverridePath. All hands share one pivot; moving any hand layer moves it.",
  "template-sprite-set": "A physical template folder. Informational: install through the component-specific contract that references it, not the folder path.",
  "background-artwork": "The static background at /design/artwork. Never bake live time, date, metrics, battery or progress fills into it; those are separate live components drawn above it.",
  "drawn-separator": "Editor-drawn colon/date slash; set its properties at propertiesPath.",
  "paired-labels": "Live AM/PM label. Install ampmIndicator.rasterFont covering both labels and clear its fontFamily override.",
  "live-progress": "Firmware draws this arc/bar live from numeric parameters over the whole background. Read get_geometry for its box. Static artwork always sits beneath it; only the arc_cut_icon slot can overlay it (as a background-colored mask with transparent holes).",
  "decorative-image": "A static sprite in the background pass; edit with update_sprite. x/y are its center in master pixels.",
  "drawn-element": "Editor-drawn shape or static text in the background pass; edit with update_element. Not live data."
};

export const DESCRIBE_COMPONENTS_TOOL = {
  name: "describe_components",
  description: "Explain how face components work before designing them. Without ids returns an index of every component (contract id, layer, kind, enabled, sprite count). With ids (contract ids like typography:hours, native:heartRate:value, weather:day, layer ids like batteryIcon, or native field ids) returns each component's full asset contract, live layer state, native schema definition and a guide to how that kind of component behaves and is installed.",
  parameters: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, maxItems: 30 } }, additionalProperties: false }
};

export function describeWatchfaceComponents(documentValue: unknown, schemaValue: unknown, ids?: string[]): unknown {
  const capabilities = record(record(documentValue).capabilities);
  const contracts: RecordValue[] = Array.isArray(capabilities.assetContracts) ? capabilities.assetContracts : [];
  const layers: RecordValue[] = Array.isArray(capabilities.layers) ? capabilities.layers : [];
  const nativeFields: RecordValue[] = Array.isArray(record(record(schemaValue).nativeData).fields) ? record(schemaValue).nativeData.fields : [];
  if (!ids?.length) {
    return {
      components: contracts.map((contract) => ({ id: contract.id, layerId: contract.layerId, label: contract.label, kind: contract.kind,
        ...(contract.enabled !== undefined ? { enabled: contract.enabled } : {}), spriteCount: contract.spriteCount })),
      addableNativeFields: nativeFields.map((field) => ({ id: field.id, label: field.label, category: field.category })),
      lookup: "Call describe_components with ids for full contracts, or get_schema section:nativeData ids:[...] for a field not on the face yet (add it with add_native_field)."
    };
  }
  return {
    components: ids.map((id) => {
      const native = /^native:([^:]+)/.exec(id)?.[1] ?? id;
      const matched = contracts.filter((contract) => contract.id === id || contract.layerId === id || contract.layerId === `native:${id}`);
      const field = nativeFields.find((candidate) => candidate.id === native);
      const layerIds = new Set([id, ...matched.map((contract) => contract.layerId).filter(Boolean)]);
      if (!matched.length && !field && !layers.some((layer) => layerIds.has(layer.id))) return { id, error: "Unknown component. Call describe_components without ids for the index." };
      return {
        id,
        layers: layers.filter((layer) => layerIds.has(layer.id)),
        contracts: matched.map((contract) => ({ ...contract, howItWorks: WATCHFACE_COMPONENT_KIND_GUIDE[contract.kind] })),
        ...(field ? { nativeSchema: field } : {})
      };
    })
  };
}
