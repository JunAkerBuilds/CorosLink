import type { WatchfaceAssetReview } from "./watchfaceAiAssetReview";

export interface GenerationAttempt {
  purpose: "background" | "component" | "font-sample" | "font-set";
  role: string;
  strategy?: "atlas" | "group" | "individual";
  characters?: string;
  assetId?: string;
  failed?: boolean;
}
export const GENERATION_BRIEF_SCHEMA = {
  type: "object", properties: {
    purpose: { enum: ["background", "component", "font-sample", "font-set"] },
    role: { type: "string", description: "Stable component/font role, e.g. clock or metrics; reuse across recovery attempts." },
    strategy: { enum: ["atlas", "group", "individual"] }, characters: { type: "string" },
    sampleAssetId: { type: "string", description: "Accepted font-sample for this exact role before producing a font-set." },
    staticElements: { type: "array", items: { type: "string" } },
    liveElements: { type: "array", items: { type: "string" }, description: "Exclude these from background pixels; keep requested static rings in staticElements." }
  }, required: ["purpose", "role"], additionalProperties: false
};
export function sanitizeGenerationAttempts(value: unknown): GenerationAttempt[] {
  return Array.isArray(value) ? value.filter(item => item && ["background", "component", "font-sample", "font-set"].includes(item.purpose) && typeof item.role === "string").map(item => ({
    purpose: item.purpose, role: item.role.slice(0, 100),
    ...(["atlas", "group", "individual"].includes(item.strategy) ? { strategy: item.strategy } : {}),
    ...(typeof item.characters === "string" ? { characters: item.characters.slice(0, 200) } : {}),
    ...(typeof item.assetId === "string" ? { assetId: item.assetId.slice(0, 200) } : {}),
    ...(item.failed === true ? { failed: true } : {})
  })) : [];
}

/** Enforce sample-first typography and a smaller recovery unit after rejection. */
export function prepareGeneration(brief: any, attempts: GenerationAttempt[], reviews: WatchfaceAssetReview) {
  if (!brief || !sanitizeGenerationAttempts([brief]).length || !brief.role.trim()) throw new Error("Supply a generation brief with purpose and stable role before generating. Separate static artwork from live components.");
  const attempt = sanitizeGenerationAttempts([brief])[0];
  let constraints = "";
  if (brief.purpose === "background") {
    if (![brief.staticElements, brief.liveElements].every(value => Array.isArray(value) && value.every(item => typeof item === "string")) || !brief.liveElements.length) throw new Error("Background brief needs staticElements and liveElements. Preserve the latest user choice of static rings; exclude dynamic battery artwork and live readings.");
    constraints = `\nStatic artwork only: ${brief.staticElements.join(", ")}.\nExclude completely (separate live components): ${brief.liveElements.join(", ")}. No baked-in live text, numbers or dynamic ring fills.`;
  }
  if (brief.purpose.startsWith("font-")) {
    const count = [...new Set(brief.characters ?? "")].length;
    if (!count || !["atlas", "group", "individual"].includes(brief.strategy)) throw new Error("Font brief requires characters and strategy (atlas, group or individual).");
    if (brief.purpose === "font-sample" && count > 4) throw new Error("Establish matching sample glyphs (at most four) before generating a full font.");
    if (brief.strategy === "group" && count > 4 || brief.strategy === "individual" && count !== 1) throw new Error("Recovery groups contain at most four characters; individual jobs contain one.");
    if (brief.purpose === "font-set") {
      const sample = attempts.find(item => item.assetId === brief.sampleAssetId && item.purpose === "font-sample" && item.role === brief.role);
      if (!sample?.assetId || reviews.get(sample.assetId)?.status !== "accepted") throw new Error("Generate and visually accept a matching font-sample for this role first. An atlas from another role cannot establish its typeface.");
    }
    const failed = attempts.filter(item => item.role === brief.role && (item.failed || item.assetId && reviews.isRejected(item.assetId)));
    if (failed.some(item => item.strategy === "group") && brief.strategy !== "individual") throw new Error("A glyph group failed for this role. Recover with individual glyphs.");
    if (failed.some(item => item.strategy === "atlas") && brief.strategy === "atlas") throw new Error("An atlas failed for this role. Change to smaller groups or individual glyphs instead of repeating the atlas.");
    constraints = `\nTypography role: ${brief.role}. Generate only these characters: ${brief.characters}. Strategy: ${brief.strategy}. Preserve the accepted sample's slant, weight, proportions and baseline.`;
  }
  return { attempt, constraints };
}
