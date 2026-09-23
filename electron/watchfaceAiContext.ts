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
