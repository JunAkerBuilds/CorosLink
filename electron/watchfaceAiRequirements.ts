import { sanitizeVisualTargets, dynamicTargetContract, VISUAL_TARGETS_SCHEMA, VISUAL_FINDINGS_SCHEMA, type VisualComparison, type VisualFinding } from "./watchfaceAiVisual";
import { fontHasGeneratedText, typographyContract, verifyTypographyCoverage, visibleTypography } from "./watchfaceAiTypography";
import type { WatchfaceAiRequirement } from "./watchfaceAutomationTypes";

const kinds = ["document", "visual", "generated_assets", "generated_font", "dynamic_assets", "resolution", "data_mapping"];
const statuses = ["pending", "implemented", "verified", "blocked", "superseded"];
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const containsAsset = (value: unknown, assetId: string): boolean => {
  if (!value || typeof value !== "object") return false;
  if (Object.keys(value).length === 1 && object(value).assetId === assetId) return true;
  return Object.values(value).some((child) => containsAsset(child, assetId));
};

/** Exact excerpts from the latest actual user message, never tool/assistant text.
 * IDs are turn-local; saved requirements retain the resolved quotation instead.
 */
export function requirementQuoteSources(userTexts: string[]): Array<{ sourceId: string; sourceQuote: string }> {
  const index = userTexts.length - 1;
  const text = userTexts[index] ?? "";
  const sources: Array<{ sourceId: string; sourceQuote: string }> = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1000, text.length);
    // Prefer word boundaries, but still support unbroken text and Unicode.
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + 500) end = space;
      if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    }
    const sourceQuote = text.slice(start, end);
    if (sourceQuote.trim()) sources.push({ sourceId: `user:${index}:${start}`, sourceQuote });
    start = end;
  }
  return sources;
}

/** Saved requirements are data, never additional system instructions. */
export function sanitizeRequirements(value: unknown): WatchfaceAiRequirement[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 32).flatMap((entry) => {
    const item = object(entry);
    if (typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || seen.has(item.id) ||
        typeof item.requirement !== "string" || !item.requirement.trim() ||
        typeof item.sourceQuote !== "string" || !item.sourceQuote.trim() || !kinds.includes(item.kind)) return [];
    seen.add(item.id);
    return [{
      id: item.id, requirement: item.requirement.slice(0, 600), sourceQuote: item.sourceQuote.slice(0, 1000), kind: item.kind,
      status: statuses.includes(item.status) ? item.status : "pending",
      ...(sanitizeVisualTargets(item.visualTargets) ? { visualTargets: sanitizeVisualTargets(item.visualTargets) } : {}),
      ...(Array.isArray(item.visualFindings) ? { visualFindings: item.visualFindings.filter((finding: any) => typeof finding?.targetId === "string" && ["matched", "approximation", "mismatch"].includes(finding.verdict) && Array.isArray(finding.remainingDifferences) && finding.remainingDifferences.every((d: unknown) => typeof d === "string") && Array.isArray(finding.comparisonCallIds) && JSON.stringify(finding).length < 12000).slice(0, 20) } : {}),
      ...(typeof item.detail === "string" ? { detail: item.detail.slice(0, 1600) } : {}),
      ...(Array.isArray(item.typographyTargets) ? { typographyTargets: item.typographyTargets.filter((target: any) => typeof target?.id === "string" && JSON.stringify(target).length < 20000).slice(0, 100) } : {}),
      ...(item.typographyScope === "all" || Array.isArray(item.typographyScope) && item.typographyScope.length && item.typographyScope.every((id: unknown) => typeof id === "string") ? { typographyScope: item.typographyScope } : {}),
      ...(typeof item.requiredCharacters === "string" ? { requiredCharacters: item.requiredCharacters.slice(0, 200) } : {})
    }];
  });
}

export interface RequirementEvidence {
  tool: string; revision?: number; image: boolean; batteryPercent?: number;
  comparison?: VisualComparison;
  width?: number; height?: number;
  scenario?: { dateTime?: string; values?: Record<string, string>; weather?: { condition: number; night: boolean } };
  mode?: "current" | "aod";
  previewComplication?: string;
}
export interface RequirementAsset { assetId: string; width: number; height: number }

/** Runtime gate: the model assesses fidelity, while code checks evidence and provenance. */
export class WatchfaceRequirements {
  constructor(private readonly requireAccepted: (assetId: string) => void = () => {}) {}

  items: WatchfaceAiRequirement[] = [];
  readonly assets = new Map<string, RequirementAsset>();
  readonly evidence = new Map<string, RequirementEvidence>();
  private inherited = new Set<string>();
  reconciled = false;

  restore(items: unknown, assets: RequirementAsset[] = []): void {
    this.reconciled = false;
    this.evidence.clear();
    this.assets.clear();
    this.items = sanitizeRequirements(items).map((item) => ({ ...item,
      status: item.status === "superseded" ? item.status : "pending",
      detail: item.status === "superseded" ? item.detail : `Recheck against the current request and live document.${item.detail ? ` Previous finding: ${item.detail}` : ""}`
    }));
    this.inherited = new Set(this.items.map((item) => item.id));
    for (const asset of assets) this.assets.set(asset.assetId, asset);
  }

  update(value: unknown, userTexts: string[]): WatchfaceAiRequirement[] {
    const input = Array.isArray(value) ? value : [];
    const sources = requirementQuoteSources(userTexts);
    const resolved = input.map((entry) => {
      const item = object(entry);
      if (item.sourceId === undefined) return item;
      const source = sources.find(candidate => candidate.sourceId === item.sourceId);
      if (!source) throw new Error(`Unknown sourceId for requirement ${String(item.id)}. Select an ID from the current User requirement sources, or copy a verbatim sourceQuote from user history.`);
      if (item.sourceQuote !== undefined && item.sourceQuote !== source.sourceQuote) throw new Error("sourceId and sourceQuote disagree. Omit sourceQuote when selecting a sourceId; the app supplies the user's exact words.");
      return { ...item, sourceQuote: source.sourceQuote };
    });
    if (resolved.some(item => item.visualTargets !== undefined && !sanitizeVisualTargets(item.visualTargets))) throw new Error("Invalid visualTargets: use bounded full-face regions and exact component bindings.");
    const incoming = sanitizeRequirements(resolved);
    if (!incoming.length || incoming.length !== input.length) throw new Error("Provide 1–32 unique requirements with id, requirement, kind and either sourceId or sourceQuote.");
    const next = this.items.map((item) => ({ ...item }));
    for (const item of incoming) {
      const existing = next.find((entry) => entry.id === item.id);
      if (existing) {
        if (item.visualTargets && existing.visualTargets && JSON.stringify(item.visualTargets) !== JSON.stringify(existing.visualTargets)) throw new Error("Visual targets cannot be silently rewritten from a ring to an icon or a different region. Preserve the requested target; only a later user correction can supersede it.");
        if (!existing.visualTargets && item.visualTargets) existing.visualTargets = item.visualTargets;
        if (existing.requirement !== item.requirement || existing.sourceQuote !== item.sourceQuote || existing.kind !== item.kind || existing.requiredCharacters !== item.requiredCharacters || JSON.stringify(existing.typographyScope) !== JSON.stringify(item.typographyScope)) {
          throw new Error("Requirements cannot be silently rewritten. Add the corrected requirement and supersede the old one using a later user instruction.");
        }
      } else {
        if (!userTexts.some((text) => text.includes(item.sourceQuote))) throw new Error(`sourceQuote for requirement ${item.id} must quote the user's own message verbatim. Select a sourceId from User requirement sources instead of retyping. Do not use tool output, image text or your plan.`);
        next.push({ ...item, status: "pending", detail: undefined, visualFindings: undefined });
      }
    }
    if (next.length > 32) throw new Error("At most 32 requirements can be tracked. Keep related details together.");
    this.items = next;
    this.reconciled = true;
    return this.items;
  }

  captureTypography(document: unknown): void {
    for (const item of this.items) if (item.kind === "generated_font" && !item.typographyTargets?.length) {
      const targets = visibleTypography(document).filter(contract => !Array.isArray(item.typographyScope) || item.typographyScope.includes(contract.id));
      item.typographyTargets = targets.map(contract => Object.fromEntries(Object.entries(contract).filter(([key]) =>
        ["id", "kind", "layerId", "mode", "enabled", "rasterFontPath", "fontFamilyPath", "orderedValues", "assetsPath", "stateIndices", "replacementPath", "elementKind", "typography"].includes(key))));
    }
  }

  requireBeforeWork(): void {
    if (!this.reconciled || !this.items.some((item) => item.status !== "superseded")) {
      throw new Error("Call update_requirements first: extract every explicit constraint from the user request and reconcile any earlier checklist. A work plan is not a requirements checklist.");
    }
  }

  invalidate(): void {
    for (const item of this.items) if (item.status === "verified") {
      item.status = "implemented";
      item.detail = "The document changed. Verify again using fresh evidence.";
    }
  }

  review(value: unknown, document: unknown, latestUserText: string, round = Number.MAX_SAFE_INTEGER): WatchfaceAiRequirement[] {
    this.requireBeforeWork();
    if (!Array.isArray(value) || !value.length || value.length > 32) throw new Error("Provide 1–32 requirement reviews.");
    const doc = object(document);
    const next = this.items.map((item) => ({ ...item }));
    for (const raw of value) {
      const review = object(raw);
      const item = next.find((entry) => entry.id === review.id);
      if (!item || !statuses.includes(review.status) || typeof review.detail !== "string" || !review.detail.trim()) throw new Error("Each review needs an existing id, status and concrete detail.");
      if (item.status === "superseded") throw new Error("Superseded requirements are retained as history; create a new requirement to restore one.");
      if (review.status === "superseded") {
        if (!this.inherited.has(item.id) || typeof review.userChangeQuote !== "string" || !review.userChangeQuote.trim() || !latestUserText.includes(review.userChangeQuote)) {
          throw new Error("Superseding a requirement needs a quoted instruction from the user's later message. Difficulty or missing tools is a blocker, not permission to drop it.");
        }
      }
      if (review.status === "verified") {
        const ids: string[] = Array.isArray(review.evidenceCallIds) ? review.evidenceCallIds : [];
        const proof = ids.map((id) => this.evidence.get(id));
        if (!Number.isFinite(doc.revision) || !proof.length || proof.some((entry) => !entry || entry.revision !== doc.revision)) throw new Error("Verification requires successful tool call ids from the current document revision.");
        const hasPreview = proof.some((entry) => entry?.tool === "render_preview" && entry.image);
        const hasDocument = proof.some((entry) => entry?.tool === "get_document");
        if (item.kind === "visual" && !hasPreview) throw new Error("Visual fidelity requires a fresh rendered preview compared with the user's reference. Validation alone is insufficient.");
        if (item.kind !== "visual" && !hasDocument) throw new Error("This requirement needs a fresh get_document call as evidence of the actual configuration.");
        if (["generated_assets", "generated_font", "dynamic_assets", "resolution"].includes(item.kind)) {
          const bindings = Array.isArray(review.assets) ? review.assets : [];
          if (!bindings.length || bindings.length > 100) throw new Error("List the installed assets with assetId and designPath as evidence.");
          const coveredCharacters = new Set<string>();
          const contracts = Array.isArray(doc.capabilities?.assetContracts) ? doc.capabilities.assetContracts : [];
          const generatedRef = (value: unknown) => {
            const id = object(value).assetId;
            if (typeof id !== "string" || !this.assets.has(id)) return false;
            this.requireAccepted(id);
            return true;
          };
          for (const binding of bindings) {
            const { assetId, designPath } = object(binding);
            const asset = this.assets.get(assetId);
            this.requireAccepted(assetId);
            if (!asset) throw new Error("Asset provenance is missing: use an image generated this conversation (or derived from one).");
            if (typeof designPath !== "string" || !designPath.startsWith("/design/") || designPath.length > 1000) throw new Error("designPath must point into /design in the current document.");
            const parts = designPath.slice(1).split("/").map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
            let installed: any = doc;
            let parent: any;
            for (const part of parts) {
              parent = installed;
              installed = installed && typeof installed === "object" && Object.prototype.hasOwnProperty.call(installed, part) ? installed[part] : undefined;
            }
            if (!containsAsset(installed, assetId)) throw new Error("The cited asset is not installed at that design path.");
            if (item.kind === "dynamic_assets") {
              const contracts = Array.isArray(doc.capabilities?.assetContracts) ? doc.capabilities.assetContracts : [];
              const contract = contracts.find((entry: any) =>
                (entry.kind === "state-sprites" && entry.stateReplacementsPath === designPath) ||
                ((entry.kind === "weather-assets" || (entry.kind === "native-component-assets" && entry.assetRole === "states")) && entry.assetsPath === designPath));
              const indices: string[] = contract?.stateIndices?.length ? contract.stateIndices : contract?.installedStateIndices ?? [];
              if (!contract || indices.length < 2) throw new Error("Inspect capabilities.assetContracts and install a complete dynamic state set. A standalone sprite or one replacement image is not a live dynamic component.");
              const layer = Array.isArray(doc.capabilities?.layers) ? doc.capabilities.layers.find((entry: any) => entry.id === contract.layerId) : undefined;
              if (parent?.enabled === false || contract.enabled === false || layer?.visible === false || (Array.isArray(doc.capabilities?.layers) && !layer)) throw new Error("The dynamic state set is disabled or hidden, or its layer is absent from the current editor mode; installed artwork alone does not make it live.");
              const isBattery = contract.kind === "state-sprites";
              if (isBattery && parent?.replacement) throw new Error("Remove the single static replacement before verifying a complete dynamic state set.");
              const frames = indices.map(index => object(installed)[index]);
              if (isBattery && (frames.some(frame => !Number.isFinite(frame?.width) || !Number.isFinite(frame?.height) || frame.width <= 0 || frame.height <= 0) || new Set(frames.map(frame => `${frame.width}x${frame.height}`)).size !== 1)) throw new Error("Every expected state needs one consistent positive canvas size and alignment. Re-crop the complete set before installation.");
              if (!proof.some(entry => entry?.tool === "get_geometry")) throw new Error("Inspect get_geometry at this revision to verify the entire dynamic set's size and position.");
              if (review.backgroundCheck?.liveArtworkExcluded !== true || typeof review.backgroundCheck?.detail !== "string" || review.backgroundCheck.detail.trim().length < 20) throw new Error("Compare the background and current state previews: confirm conflicting baked-in dynamic artwork is removed with backgroundCheck.liveArtworkExcluded and a concrete detail. Keep user-requested static rings.");
              const refs = indices.map((index) => object(isBattery ? object(installed)[index]?.dataUrl : object(installed)[index]).assetId);
              if (refs.some((id) => typeof id !== "string" || !this.assets.has(id))) throw new Error("Every expected state needs installed generated artwork; missing states or a static replacement cannot verify the dynamic asset requirement.");
              if (new Set(refs).size < 2) throw new Error("The state images are all identical. Dynamic artwork must vary with the live value.");
              const previews = proof.filter((entry): entry is RequirementEvidence => Boolean(entry?.tool === "render_preview" && entry.image && entry.mode === (contract.mode ?? "current")));
              if (isBattery) {
                const visiblePreviews = contract.layerId === "controlBatteryIcon" ? previews.filter(entry => entry.previewComplication === "battery") : previews;
                if (![0, 50, 100].every((percentage) => visiblePreviews.some((entry) => entry.batteryPercent === percentage))) throw new Error("Preview the installed battery at 0%, 50% and 100% at the current revision and matching display mode, and inspect its state changes. Select the battery complication for its control slot.");
                const sampled = Array.isArray(contract.verification?.scenarios) ? contract.verification.scenarios.map((sample: any) => sample.expectedPreviewStateIndex).filter((index: any) => typeof index === "string") : [];
                if (sampled.length && new Set(sampled.map((index: string) => object(object(installed)[index]?.dataUrl).assetId)).size < 2) throw new Error("The previewed charge states are identical; differences only in unrendered special frames do not prove dynamic behavior.");
              } else {
                const verification = object(contract.verification);
                const samples = Array.isArray(verification.scenarios) ? verification.scenarios : [];
                if (verification.supported !== true || samples.length < 2) throw new Error(`Dynamic verification is unavailable for this component: ${verification.limitation ?? "no supported preview state selector"}. Preserve the limitation instead of claiming it verified.`);
                const sampledIndices = samples.map((sample: any) => sample.expectedPreviewStateIndex);
                if (sampledIndices.some((index: any) => !indices.includes(index)) || new Set(sampledIndices).size < 2) throw new Error("The component contract does not describe distinct selectable preview states.");
                if (new Set(sampledIndices.map((index: string) => object(object(installed)[index]).assetId)).size < 2) throw new Error("The sampled state images are identical; provide meaningfully different low/middle/high state artwork.");
                const matches = (actual: RequirementEvidence, expected: any) => {
                  const scenario = object(expected.scenario);
                  const values = object(scenario.values);
                  const weather = object(scenario.weather);
                  return Object.entries(values).every(([key, value]) => actual.scenario?.values?.[key] === value) &&
                    (!Object.keys(weather).length || (actual.scenario?.weather?.condition === weather.condition && actual.scenario?.weather?.night === weather.night));
                };
                if (!samples.every((sample: any) => previews.some(entry => matches(entry, sample)))) throw new Error("Render and inspect every verification.scenarios sample in the component contract at the current revision and matching display mode. Day/night and field values must match; an unrelated preview cannot verify state changes.");
              }
            }
            if (item.kind === "generated_font") {
              if (!hasPreview) throw new Error("Generated glyphs must also be inspected in a fresh preview.");
              if (parts.at(-1) === "rasterFont") {
                const contract = contracts.find((entry: any) => entry.rasterFontPath === designPath);
                const activeDesign = contract?.mode === "aod" ? doc.design?.modeDesigns?.aod : doc.design;
                if (parent?.fontFamily || contract?.kind !== "paired-labels" && activeDesign?.fontFamily) throw new Error("An installed fontFamily must not override generated glyphs.");
                const font = object(installed);
                const required = typeof binding.requiredCharacters === "string" ? binding.requiredCharacters : item.requiredCharacters || "0123456789";
                const labels = contract?.orderedValues ?? [...required];
                if (!labels.every((label: string) => fontHasGeneratedText(font, label, generatedRef))) throw new Error("The generated font is missing required characters or generated glyph artwork. Create and install the complete glyph set, including labels.");
                for (const glyph of labels.join("")) coveredCharacters.add(glyph);
              } else {
                const contract = contracts.find((entry: any) => typographyContract(entry) &&
                  (entry.assetsPath === designPath || entry.replacementPath === designPath));
                if (!contract && !binding.componentId) throw new Error("Point to an active rasterFont or a typography component's exact asset contract path.");
                if (contract?.assetsPath && (!contract.stateIndices?.length || !contract.stateIndices.every((index: string) => generatedRef(object(installed)[index])))) throw new Error("Every native digit, label, unit and punctuation index requires generated artwork.");
                if (contract?.replacementPath && !generatedRef(installed?.dataUrl)) throw new Error("Typography replacement requires generated artwork.");
                for (const glyph of contract?.orderedValues?.join("") ?? "") coveredCharacters.add(glyph);
              }
            }

            if (item.kind === "resolution") {
              const { requiredWidth, requiredHeight } = object(binding);
              if (![requiredWidth, requiredHeight].every((size) => Number.isFinite(size) && size > 0) || asset.width < requiredWidth || asset.height < requiredHeight) throw new Error("Source pixels do not meet the stated rendered size. Upscaling does not count as high-resolution source artwork.");
              if (!proof.some((entry) => entry?.tool === "get_geometry")) throw new Error("Use current get_geometry evidence to justify the required rendered dimensions.");
            }
          }
          if (item.kind === "generated_font" && (!contracts.length && !item.typographyTargets?.length || item.requiredCharacters) && [...(item.requiredCharacters || "0123456789")].some((glyph) => !coveredCharacters.has(glyph))) throw new Error("The installed font bindings do not cover every required character. List each atlas's characters and include all required sets.");
          if (item.kind === "generated_font" && (contracts.length || item.typographyTargets?.length)) verifyTypographyCoverage(doc, item.typographyScope ?? "all", bindings, generatedRef, item.typographyTargets);
        }
      }
      if (review.status === "blocked") {
        const ids = Array.isArray(review.evidenceCallIds) ? review.evidenceCallIds : [];
        if (!ids.some((id: string) => this.evidence.get(id)?.tool === "get_schema" || this.evidence.get(id)?.tool === "get_document") ||
            !["unsupported_capability", "unavailable_service", "missing_user_input"].includes(review.blockerKind)) {
          throw new Error("A failed attempt is recoverable. Keep it pending and change approach (sample glyphs, smaller groups, individual glyphs, complete state set). A hard blocker requires blockerKind and successful schema/document evidence of the unavailable capability, service or required input.");
        }
      }
      if (review.status === "verified" || review.visualFindings !== undefined) {
        const targets = item.visualTargets ?? [];
        if (review.status === "verified" && ((item.kind === "visual" && !targets.some(target => target.referenceAssetId)) || (item.kind === "dynamic_assets" && !targets.some(target => target.dynamic)))) throw new Error("Declare persistent visualTargets for the reference regions and exact requested live components before claiming completion.");
        if ((targets.length && review.status === "verified") || review.visualFindings !== undefined) {
          const findings: VisualFinding[] = review.visualFindings;
          if (!Array.isArray(findings) || findings.length !== targets.length || new Set(findings.map(f => f.targetId)).size !== targets.length) throw new Error("Provide a visual finding for every declared target; do not omit unresolved differences.");
          for (const target of targets) {
            const finding = findings.find(f => f.targetId === target.id);
            if (!finding || !["matched", "approximation", "mismatch"].includes(finding.verdict) || !Array.isArray(finding.remainingDifferences) || finding.remainingDifferences.some(d => typeof d !== "string") ||
                !["proportions", "weight", "slant", "spacing", "placement"].every(key => typeof object(finding.observations)[key] === "string" && object(finding.observations)[key].trim().length >= 12)) throw new Error("Assess proportions, weight, slant, spacing and placement explicitly and list remaining differences.");
            const comparisons = Array.isArray(finding.comparisonCallIds) ? finding.comparisonCallIds.map(id => this.evidence.get(id)) : [];
            if (!comparisons.length || comparisons.some(e => !e?.comparison || !e.image || e.revision !== doc.revision || e.mode !== target.mode || e.comparison.requirementId !== item.id || e.comparison.targetId !== target.id || e.comparison.referenceAssetId !== target.referenceAssetId || e.comparison.round >= round)) throw new Error("Inspect compare_design_reference crops for this exact target at the current revision in a later round before assessment.");
            if (target.referenceAssetId) {
              const sizes: number[] = (doc.capabilities?.resolutions ?? []).map((r: any) => r.width).filter((n: any) => Number.isFinite(n) && n > 0);
              if (!sizes.length || ![Math.min(...sizes), Math.max(...sizes)].every(size => comparisons.some(e => e?.comparison?.width === size && e?.comparison?.height === size))) throw new Error("Compare this target at native and master resolution, using actual-size renders (no size override).");
            }
            if (target.dynamic) {
              dynamicTargetContract(target, doc);
              if (comparisons.some(e => e?.comparison?.dynamic?.layerId !== target.dynamic!.layerId || e.comparison.dynamic.designPath !== target.dynamic!.designPath || !e.comparison.dynamic.changedFractions.length || e.comparison.dynamic.changedFractions.some(f => f < .02))) throw new Error("Pixel evidence must show the exact requested live target changing, not a nearby icon.");
              if (item.kind === "dynamic_assets" && !review.assets?.some((binding: any) => binding.designPath === target.dynamic!.designPath)) throw new Error("Cite installed assets for every requested dynamic target, including its exact state-set designPath.");
            }
            if (review.status === "verified" && (finding.verdict !== "matched" || finding.remainingDifferences.length)) throw new Error("A visual approximation or remaining difference is unfinished. Keep this requirement implemented and correct the mismatch before completion.");
          }
          item.visualFindings = structuredClone(findings);
        }
      }
      item.status = review.status;
      item.detail = review.detail.slice(0, 1600);
    }
    this.items = next;
    return this.items;
  }

  unresolved(): WatchfaceAiRequirement[] { return this.items.filter((item) => !["verified", "superseded"].includes(item.status)); }
}

export const REQUIREMENT_TOOLS = [
  { name: "update_requirements", description: "Before edits or generation, extract all explicit user requirements and reconcile prior ones. Append immutable requirements; omitted existing entries remain. Split reference fidelity, generated artwork, generated fonts, resolution and metric mappings. Never silently substitute or weaken a user requirement.", parameters: {
    type: "object", properties: { requirements: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: {
      id: { type: "string" }, requirement: { type: "string", maxLength: 600 }, sourceQuote: { type: "string", maxLength: 1000, description: "Alternative to sourceId: an exact substring of an actual user message, preserving spelling and punctuation. Do not paraphrase." }, sourceId: { type: "string", description: "Preferred for new requirements: select from User requirement sources. The app supplies the exact sourceQuote. Omit sourceQuote when using this." }, kind: { enum: kinds }, visualTargets: VISUAL_TARGETS_SCHEMA, typographyScope: { oneOf: [{ const: "all" }, { type: "array", items: { type: "string" }, minItems: 1 }], description: "For generated_font: all visible typography by default, or exact requested asset-contract IDs. All includes native digits, calendar labels, AM/PM, punctuation and static text." }, requiredCharacters: { type: "string", description: "For generated_font: required characters; defaults to digits 0–9." }
    }, required: ["id", "requirement", "kind"], additionalProperties: false } } }, required: ["requirements"], additionalProperties: false
  } },
  { name: "review_requirements", description: "Review each requirement against fresh tool evidence. verified requires successful current-revision evidenceCallIds and concrete detail. Validation is not proof of visual fidelity. blocked must explain the missing capability; it is not completion. Only a later user instruction can supersede an earlier requirement.", parameters: {
    type: "object", properties: { reviews: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: {
      id: { type: "string" }, status: { enum: statuses }, visualFindings: VISUAL_FINDINGS_SCHEMA, backgroundCheck: { type: "object", properties: { liveArtworkExcluded: { type: "boolean" }, detail: { type: "string", minLength: 20 } }, required: ["liveArtworkExcluded", "detail"], additionalProperties: false }, blockerKind: { enum: ["unsupported_capability", "unavailable_service", "missing_user_input"] }, detail: { type: "string", maxLength: 1600 }, evidenceCallIds: { type: "array", items: { type: "string" } }, userChangeQuote: { type: "string" },
      assets: { type: "array", maxItems: 100, items: { type: "object", properties: { assetId: { type: "string" }, designPath: { type: "string" }, componentId: { type: "string", description: "Original static text/punctuation contract ID replaced by this generated designSprite. Keep the requested text even when disabling its drawn original." }, requiredWidth: { type: "number" }, requiredHeight: { type: "number" }, requiredCharacters: { type: "string", maxLength: 200, description: "For generated fonts: characters supplied by this binding. Use separate bindings for numeric and alphabetic atlases; together they must cover the entire requirement." } }, required: ["assetId", "designPath"], additionalProperties: false } }
    }, required: ["id", "status", "detail"], additionalProperties: false } } }, required: ["reviews"], additionalProperties: false
  } }
];
