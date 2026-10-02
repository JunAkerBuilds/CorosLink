import type { WatchfaceCropQuality } from "./watchfaceAiImage";

export type AssetReview = { round: number; references: string[]; status: "pending" | "accepted" | "rejected"; comparison?: string; quality?: WatchfaceCropQuality; glyphChecks?: { identity: boolean; unclipped: boolean; baselineAndSpacing: boolean } };

/** Forces a separate visual decision after pixels are returned, before reuse.
 * The model judges similarity; this gate does not measure visual fidelity.
 */
export class WatchfaceAssetReview {
  private assets = new Map<string, AssetReview>();

  snapshot(): Array<AssetReview & { assetId: string }> {
    return structuredClone([...this.assets].map(([assetId, review]) => ({ assetId, ...review })));
  }

  restore(value: unknown): void {
    for (const { assetId, ...review } of sanitizeAssetReviews(value)) {
      // Rounds belong to one run. Restored pending pixels still need a new
      // inspect_asset call; accepted/rejected decisions remain durable.
      this.assets.set(assetId, { ...review, round: review.status === "pending" ? Number.MAX_SAFE_INTEGER : -1 });
    }
  }

  inspected(assetId: string, round: number): void {
    const asset = this.assets.get(assetId);
    if (asset?.status === "pending") asset.round = round;
  }

  get(assetId: string): AssetReview | undefined { return this.assets.get(assetId); }


  register(assetId: string, round: number, references: string[], recolorSourceId?: string): void {
    const source = recolorSourceId ? this.assets.get(recolorSourceId) : undefined;
    if (!this.assets.has(assetId)) this.assets.set(assetId, { round, references: [...(source?.references ?? references)], status: "pending", ...(source?.quality ? { quality: source.quality } : {}) });
  }

  review(value: unknown, round: number) {
    if (!Array.isArray(value) || !value.length || value.length > 20) throw new Error("Provide 1–20 asset reviews.");
    const next = new Map(this.assets);
    const reviewed = value.map(item => {
      const asset = next.get(item?.assetId);
      if (!asset) throw new Error("Review a tracked image using its exact assetId.");
      if (asset.status === "rejected" && item.status === "accepted") throw new Error("Rejected pixels remain blocked. Create a corrected asset and review that instead.");
      if (asset.round === Number.MAX_SAFE_INTEGER) throw new Error("Inspect this restored pending asset with inspect_asset before reviewing its pixels in the next round.");
      if (round <= asset.round) throw new Error("Wait for the generated pixels in the next round before reviewing them.");
      if (!["accepted", "rejected"].includes(item.status) || typeof item.comparison !== "string" || item.comparison.trim().length < 20) {
        throw new Error("Give accepted/rejected and a concrete visual comparison, including mismatches. File format and glyph coverage are not visual similarity.");
      }
      if (asset.references.length && (!Array.isArray(item.referenceAssetIds) || !asset.references.some(id => item.referenceAssetIds.includes(id)))) {
        throw new Error(`Compare with an actual generation reference: ${asset.references.join(", ")}.`);
      }
      if (item.status === "accepted" && asset.quality?.errors.length) throw new Error(`Crop cannot be accepted: ${asset.quality.errors.join(" ")} Re-crop the original source.`);
      if (item.status === "accepted" && asset.quality?.glyph && (!item.glyphChecks || !["identity", "unclipped", "baselineAndSpacing"].every(key => item.glyphChecks[key] === true))) {
        throw new Error("A glyph crop needs its own identity, unclipped, and baselineAndSpacing checks after viewing the cropped pixels and sibling metrics. Parent atlas acceptance is insufficient.");
      }
      const updated: AssetReview = { ...asset, status: item.status, comparison: item.comparison.slice(0, 1600), ...(item.glyphChecks ? { glyphChecks: { ...item.glyphChecks } } : {}) };
      next.set(item.assetId, updated);
      return { assetId: item.assetId, ...updated };
    });
    this.assets = next;
    return reviewed;
  }

  requireAccepted(assetId: string): void {
    const asset = this.assets.get(assetId);
    if (asset && asset.status !== "accepted") throw new Error(`Asset ${assetId} is ${asset.status}. Use review_generated_assets after comparing its pixels with the reference before cropping or installing it. Reject and regenerate mismatched artwork.`);
  }

  checkCommands(value: unknown): void {
    if (typeof value === "string" && this.assets.has(value)) this.requireAccepted(value);
    else if (Array.isArray(value)) value.forEach(child => this.checkCommands(child));
    else if (value && typeof value === "object") Object.values(value).forEach(child => this.checkCommands(child));
  }

  registerCrop(sourceId: string, assetId: string, round: number, quality?: WatchfaceCropQuality) {
    const source = this.assets.get(sourceId);
    // Retain the style reference, never the parent's acceptance. A valid atlas
    // can produce a clipped, misidentified or badly spaced individual glyph.
    if (this.assets.has(assetId)) return this.cropSet(assetId);
    this.assets.set(assetId, { round, references: source?.references.length ? [...source.references] : [sourceId], status: "pending", quality });
    return this.cropSet(assetId);
  }

  cropSet(assetId: string) {
    const setId = this.assets.get(assetId)?.quality?.glyph?.setId;
    return setId ? [...this.assets].filter(([, asset]) => asset.quality?.glyph?.setId === setId).slice(-40).map(([id, asset]) => ({ assetId: id, status: asset.status, ...asset.quality })) : [];
  }

  isRejected(assetId: string): boolean { return this.assets.get(assetId)?.status === "rejected"; }
}

export const ASSET_REVIEW_TOOL = {
  name: "review_generated_assets",
  description: "After viewing new image pixels, accept or reject them against the user's reference BEFORE cropping or installation. Crops require their own review; glyphs also need identity, unclipped and baselineAndSpacing checks using returned pixel metrics and sibling crops. Fix blocking crop errors. For typography compare serif/sans, slant, stroke weight, proportions, spacing and glyph shapes. This is model visual judgment, not automatic similarity scoring.",
  parameters: { type: "object", properties: { reviews: { type: "array", minItems: 1, maxItems: 20, items: {
    type: "object", properties: { assetId: { type: "string" }, status: { enum: ["accepted", "rejected"] }, comparison: { type: "string", minLength: 20, maxLength: 1600 }, backgroundChecks: { type: "object", properties: { liveElementsExcluded: { type: "boolean" } }, required: ["liveElementsExcluded"], additionalProperties: false }, referenceAssetIds: { type: "array", items: { type: "string" }, maxItems: 5 }, glyphChecks: { type: "object", properties: { identity: { type: "boolean" }, unclipped: { type: "boolean" }, baselineAndSpacing: { type: "boolean" } }, required: ["identity", "unclipped", "baselineAndSpacing"], additionalProperties: false } },
    required: ["assetId", "status", "comparison"], additionalProperties: false
  } } }, required: ["reviews"], additionalProperties: false }
};

/** Bound persisted data without losing decisions to the short event journal. */
export function sanitizeAssetReviews(value: unknown): Array<AssetReview & { assetId: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item.assetId !== "string" || item.assetId.length > 200 ||
        !["pending", "accepted", "rejected"].includes(item.status) || !Array.isArray(item.references)) return [];
    const quality = item.quality;
    const validQuality = quality && Array.isArray(quality.errors) && Array.isArray(quality.warnings) &&
      Array.isArray(quality.cutInkEdges) && Number.isFinite(quality.width) && Number.isFinite(quality.height) &&
      JSON.stringify(quality).length < 10000;
    return [{ assetId: item.assetId, round: -1, status: item.status,
      references: item.references.filter((id: unknown) => typeof id === "string").slice(0, 5),
      ...(typeof item.comparison === "string" ? { comparison: item.comparison.slice(0, 1600) } : {}),
      ...(item.glyphChecks && ["identity", "unclipped", "baselineAndSpacing"].every(key => item.glyphChecks[key] === true) ? { glyphChecks: { identity: true, unclipped: true, baselineAndSpacing: true } } : {}),
      ...(validQuality ? { quality: structuredClone(quality) } : {}) }];
  });
}
