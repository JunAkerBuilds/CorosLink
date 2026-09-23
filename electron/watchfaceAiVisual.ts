/** Regions are fractions of the full face, never screenshots of the editor. */
export interface VisualRegion { x: number; y: number; width: number; height: number }
export interface VisualTarget {
  id: string;
  label: string;
  mode: "current" | "aod";
  appearance: "typography" | "ring" | "artwork";
  region: VisualRegion;
  referenceAssetId?: string;
  referenceRegion?: VisualRegion;
  /** Locks the requested live component, not merely its data source. */
  dynamic?: { layerId: string; designPath: string };
}
export interface VisualComparison {
  requirementId: string; targetId: string; round: number;
  referenceAssetId?: string;
  previewCallIds: string[];
  width: number; height: number;
  dynamic?: { layerId: string; designPath: string; changedFractions: number[] };
}
export interface VisualFinding {
  targetId: string; verdict: "matched" | "approximation" | "mismatch";
  comparisonCallIds: string[];
  observations: { proportions: string; weight: string; slant: string; spacing: string; placement: string };
  remainingDifferences: string[];
}
const record = (v: any) => v && typeof v === "object" && !Array.isArray(v);
export function validVisualRegion(v: any): v is VisualRegion {
  return record(v) && [v.x, v.y, v.width, v.height].every(n => typeof n === "number" && Number.isFinite(n)) &&
    v.x >= 0 && v.y >= 0 && v.width > 0 && v.height > 0 && v.x + v.width <= 1.000001 && v.y + v.height <= 1.000001;
}
export function sanitizeVisualTargets(value: unknown): VisualTarget[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 20) return undefined;
  const seen = new Set<string>();
  const targets: VisualTarget[] = [];
  for (const t of value) {
    if (!record(t) || typeof t.id !== "string" || !/^[\w-]{1,64}$/.test(t.id) || seen.has(t.id) ||
        typeof t.label !== "string" || !t.label.trim() || t.label.length > 200 ||
        !["current", "aod"].includes(t.mode) || !["typography", "ring", "artwork"].includes(t.appearance) || !validVisualRegion(t.region) ||
        (t.referenceAssetId !== undefined && (typeof t.referenceAssetId !== "string" || !t.referenceAssetId || !validVisualRegion(t.referenceRegion))) ||
        (t.dynamic !== undefined && (!record(t.dynamic) || typeof t.dynamic.layerId !== "string" || !t.dynamic.layerId || typeof t.dynamic.designPath !== "string" || !t.dynamic.designPath.startsWith("/design/")))) return undefined;
    seen.add(t.id);
    targets.push({ id: t.id, label: t.label, mode: t.mode, appearance: t.appearance, region: { x: t.region.x, y: t.region.y, width: t.region.width, height: t.region.height },
      ...(t.referenceAssetId ? { referenceAssetId: t.referenceAssetId, referenceRegion: { x: t.referenceRegion.x, y: t.referenceRegion.y, width: t.referenceRegion.width, height: t.referenceRegion.height } } : {}),
      ...(t.dynamic ? { dynamic: { layerId: t.dynamic.layerId, designPath: t.dynamic.designPath } } : {}) });
  }
  return targets;
}
export function dynamicTargetContract(target: VisualTarget, document: any): any {
  const binding = target.dynamic;
  const contract = document?.capabilities?.assetContracts?.find((entry: any) => entry.layerId === binding?.layerId &&
    (entry.mode ?? "current") === target.mode &&
    ((entry.kind === "state-sprites" && entry.stateReplacementsPath === binding?.designPath) ||
      ((entry.kind === "weather-assets" || entry.kind === "native-component-assets" && entry.assetRole === "states") && entry.assetsPath === binding?.designPath)));
  if (!binding || !contract || contract.enabled === false) throw new Error("The requested dynamic target needs its exact layer and state-set designPath in the current component contracts.");
  return contract;
}
/** A nearby small icon must not stand in for the requested ring. */
export function assertDynamicTargetGeometry(target: VisualTarget, document: any, geometry: any): void {
  const layer = geometry?.layers?.find((layer: any) => layer.id === target.dynamic?.layerId);
  const box = layer?.box;
  const canvas = document?.capabilities?.placement;
  if (geometry?.revision !== document.revision || geometry?.mode !== target.mode || !box || layer.visible === false || !canvas?.width || !canvas?.height) throw new Error("Fresh geometry in the target display mode is required.");
  const expected = { x: target.region.x * canvas.width, y: target.region.y * canvas.height, width: target.region.width * canvas.width, height: target.region.height * canvas.height };
  if (![box.x, box.y, box.width, box.height].every(Number.isFinite) || box.width < expected.width * .7 || box.height < expected.height * .7 || box.width > expected.width * 1.4 || box.height > expected.height * 1.4 ||
      Math.abs(box.x + box.width / 2 - expected.x - expected.width / 2) > expected.width * .2 ||
      Math.abs(box.y + box.height / 2 - expected.y - expected.height / 2) > expected.height * .2) {
    throw new Error("The live component does not cover the intended target. Size and position the complete state set at the requested ring/artwork, not a small icon inside it.");
  }
}

const regionSchema = { type: "object", properties: { x: { type: "number", minimum: 0, maximum: 1 }, y: { type: "number", minimum: 0, maximum: 1 }, width: { type: "number", exclusiveMinimum: 0, maximum: 1 }, height: { type: "number", exclusiveMinimum: 0, maximum: 1 } }, required: ["x", "y", "width", "height"], additionalProperties: false };
export const VISUAL_TARGETS_SCHEMA = { type: "array", minItems: 1, maxItems: 20, description: "Persistent intended regions in full-face normalized coordinates. Declare separate clock typography, metric typography and requested rings. A live ring has appearance ring AND dynamic with the actual state-set path/layer. Static rings omit dynamic. These targets cannot be silently rewritten.", items: { type: "object", properties: {
  id: { type: "string" }, label: { type: "string" }, mode: { enum: ["current", "aod"] }, appearance: { enum: ["typography", "ring", "artwork"] }, region: regionSchema,
  referenceAssetId: { type: "string", description: "The persistent design reference, not a diagnostic attachment." }, referenceRegion: regionSchema,
  dynamic: { type: "object", properties: { layerId: { type: "string" }, designPath: { type: "string" } }, required: ["layerId", "designPath"], additionalProperties: false }
}, required: ["id", "label", "mode", "appearance", "region"], additionalProperties: false } };
export const VISUAL_FINDINGS_SCHEMA = { type: "array", maxItems: 20, items: { type: "object", properties: {
  targetId: { type: "string" }, verdict: { enum: ["matched", "approximation", "mismatch"] }, comparisonCallIds: { type: "array", items: { type: "string" }, minItems: 1 },
  observations: { type: "object", properties: Object.fromEntries(["proportions", "weight", "slant", "spacing", "placement"].map(key => [key, { type: "string", minLength: 12 }])), required: ["proportions", "weight", "slant", "spacing", "placement"], additionalProperties: false },
  remainingDifferences: { type: "array", items: { type: "string" }, description: "Concrete visible differences. Any unresolved difference prevents completion; approximation is not a match." }
}, required: ["targetId", "verdict", "comparisonCallIds", "observations", "remainingDifferences"], additionalProperties: false } };
export const COMPARE_REFERENCE_TOOL = { name: "compare_design_reference", description: "Returns real side-by-side crops: design reference first, then current preview(s), with original proportions retained. For a dynamic target cite all contract state samples with identical dateTime and other data; tests changed pixels in the exact region (ring annulus excludes the center icon/text). For typography, reproduce the reference time and metric readings so matching glyphs can be compared. Inspect the returned board in a later round before review. Run at native and master resolutions for reference fidelity.", parameters: { type: "object", properties: {
  requirementId: { type: "string" }, targetId: { type: "string" }, previewCallIds: { type: "array", minItems: 1, maxItems: 8, items: { type: "string" } }
}, required: ["requirementId", "targetId", "previewCallIds"], additionalProperties: false } };
