import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceEffectBinding,
  CorosWatchfaceShadowEffect
} from "../../electron/types";

export interface WatchfaceEffectPadding {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let shadowCounter = 0;

export function createWatchfaceShadowEffect(
  kind: CorosWatchfaceShadowEffect["kind"] = "outer-shadow"
): CorosWatchfaceShadowEffect {
  shadowCounter += 1;
  return {
    id: `shadow-${Date.now().toString(36)}-${shadowCounter}`,
    kind,
    enabled: true,
    color: "#000000",
    opacity: 0.35,
    blur: 12,
    spread: 0,
    distance: 8,
    angle: 45
  };
}

export function normalizeWatchfaceShadowEffect(
  effect: CorosWatchfaceShadowEffect
): CorosWatchfaceShadowEffect {
  const number = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    ...effect,
    id: effect.id || createWatchfaceShadowEffect(effect.kind).id,
    kind: effect.kind === "inner-shadow" ? "inner-shadow" : "outer-shadow",
    enabled: effect.enabled !== false,
    color: /^#[0-9a-f]{6}$/i.test(effect.color) ? effect.color : "#000000",
    opacity: number(effect.opacity, 0, 1, 0.35),
    blur: number(effect.blur, 0, 64, 12),
    spread: number(effect.spread, -32, 64, 0),
    distance: number(effect.distance, 0, 128, 8),
    angle: ((number(effect.angle, -3600, 3600, 45) % 360) + 360) % 360
  };
}

export function resolveWatchfaceLayerEffects(
  design: Pick<CorosWatchfaceDesignState, "effectStyles" | "layerEffects">,
  layerId: string,
  scope: "current" | "aod" = "current"
): CorosWatchfaceShadowEffect[] {
  const key = scope === "aod" ? `aod:${layerId}` : layerId;
  const binding = design.layerEffects?.[key];
  if (!binding) return [];
  const effects = binding.kind === "local"
    ? binding.effects
    : design.effectStyles?.find((style) => style.id === binding.styleId)?.effects ?? [];
  return effects.map(normalizeWatchfaceShadowEffect);
}

export function localWatchfaceEffectBinding(
  effects: CorosWatchfaceShadowEffect[]
): CorosWatchfaceEffectBinding {
  return { kind: "local", effects: effects.map(normalizeWatchfaceShadowEffect) };
}

export function watchfaceEffectPadding(
  effects: CorosWatchfaceShadowEffect[],
  scale = 1
): WatchfaceEffectPadding {
  const padding: WatchfaceEffectPadding = { left: 0, top: 0, right: 0, bottom: 0 };
  for (const raw of effects) {
    const effect = normalizeWatchfaceShadowEffect(raw);
    if (!effect.enabled || effect.kind === "inner-shadow" || effect.opacity <= 0) {
      continue;
    }
    const radians = (effect.angle * Math.PI) / 180;
    const dx = Math.cos(radians) * effect.distance * scale;
    const dy = Math.sin(radians) * effect.distance * scale;
    const radius = (effect.blur * 2 + Math.max(0, effect.spread)) * scale;
    padding.left = Math.max(padding.left, Math.ceil(radius - dx));
    padding.right = Math.max(padding.right, Math.ceil(radius + dx));
    padding.top = Math.max(padding.top, Math.ceil(radius - dy));
    padding.bottom = Math.max(padding.bottom, Math.ceil(radius + dy));
  }
  return padding;
}

/** Inner shadows dilate inward, so their inverse alpha mask uses opposite spread. */
export function watchfaceShadowMaskSpread(
  effect: CorosWatchfaceShadowEffect,
  scale = 1,
  inverse = false
): number {
  return (inverse ? -effect.spread : effect.spread) * scale;
}

function canvas(width: number, height: number): HTMLCanvasElement {
  const result = document.createElement("canvas");
  result.width = Math.max(1, Math.ceil(width));
  result.height = Math.max(1, Math.ceil(height));
  return result;
}

function context2d(value: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = value.getContext("2d", { colorSpace: "display-p3" });
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

type EffectCanvas = HTMLCanvasElement | OffscreenCanvas;
type EffectContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function effectCanvas(width: number, height: number): EffectCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(
      Math.max(1, Math.ceil(width)),
      Math.max(1, Math.ceil(height))
    );
  }
  return canvas(width, height);
}

function effectContext2d(value: EffectCanvas): EffectContext {
  if (value instanceof HTMLCanvasElement) return context2d(value);
  const context = value.getContext("2d", { colorSpace: "display-p3" });
  if (!context) throw new Error("Canvas rendering is unavailable.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  return context;
}

function drawSpreadMask(
  context: EffectContext,
  source: CanvasImageSource,
  x: number,
  y: number,
  width: number,
  height: number,
  spread: number
) {
  if (spread < 0) {
    const radius = Math.abs(spread);
    const samples = Math.max(8, Math.min(32, Math.ceil(radius * 1.5)));
    context.drawImage(source, x, y, width, height);
    // Alpha intersection erodes the mask without scaling or distorting the
    // underlying artwork, which is especially important for thin glyphs.
    context.globalCompositeOperation = "destination-in";
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      context.drawImage(
        source,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        width,
        height
      );
    }
    context.globalCompositeOperation = "source-over";
    return;
  }
  context.drawImage(source, x, y, width, height);
  if (spread <= 0) return;
  const samples = Math.max(12, Math.min(40, Math.ceil(spread * 1.5)));
  // A few concentric rings approximate a disk dilation without the holes and
  // scalloped edges produced by drawing only the outer circumference.
  for (const radius of [spread / 3, (spread * 2) / 3, spread]) {
    for (let index = 0; index < samples; index += 1) {
      const angle = (index / samples) * Math.PI * 2;
      context.drawImage(
        source,
        x + Math.cos(angle) * radius,
        y + Math.sin(angle) * radius,
        width,
        height
      );
    }
  }
}

function coloredShadowMask(
  source: HTMLCanvasElement,
  effect: CorosWatchfaceShadowEffect,
  offsetX: number,
  offsetY: number,
  scale: number,
  inverse = false
): EffectCanvas {
  const mask = effectCanvas(source.width, source.height);
  const maskContext = effectContext2d(mask);
  const spreadMask = effectCanvas(source.width, source.height);
  const spreadContext = effectContext2d(spreadMask);
  drawSpreadMask(
    spreadContext,
    source,
    0,
    0,
    source.width,
    source.height,
    watchfaceShadowMaskSpread(effect, scale, inverse)
  );
  if (inverse) {
    maskContext.fillStyle = "#ffffff";
    maskContext.fillRect(0, 0, mask.width, mask.height);
    maskContext.globalCompositeOperation = "destination-out";
    maskContext.drawImage(spreadMask, 0, 0);
    maskContext.globalCompositeOperation = "source-over";
  } else {
    maskContext.drawImage(spreadMask, 0, 0);
  }

  const blurred = effectCanvas(source.width, source.height);
  const blurredContext = effectContext2d(blurred);
  blurredContext.filter = effect.blur > 0
    ? `blur(${effect.blur * scale}px)`
    : "none";
  blurredContext.drawImage(mask, offsetX, offsetY);
  blurredContext.filter = "none";
  blurredContext.globalCompositeOperation = "source-in";
  blurredContext.globalAlpha = effect.opacity;
  blurredContext.fillStyle = effect.color;
  blurredContext.fillRect(0, 0, blurred.width, blurred.height);
  blurredContext.globalAlpha = 1;
  return blurred;
}

/**
 * Applies ordered outer and inner shadows to an already rasterized layer.
 * The returned canvas includes transparent padding needed by outer shadows.
 */
export function renderWatchfaceCanvasEffects(
  source: HTMLCanvasElement,
  effects: CorosWatchfaceShadowEffect[],
  scale = 1,
  includePadding = false
): { canvas: HTMLCanvasElement; padding: WatchfaceEffectPadding } {
  const active = effects
    .map(normalizeWatchfaceShadowEffect)
    .filter((effect) => effect.enabled && effect.opacity > 0);
  const padding = includePadding
    ? watchfaceEffectPadding(active, scale)
    : { left: 0, top: 0, right: 0, bottom: 0 };
  if (active.length === 0) return { canvas: source, padding };

  const base = canvas(
    source.width + padding.left + padding.right,
    source.height + padding.top + padding.bottom
  );
  const baseContext = context2d(base);
  baseContext.drawImage(source, padding.left, padding.top);
  const result = canvas(base.width, base.height);
  const resultContext = context2d(result);

  for (const effect of active.filter((candidate) => candidate.kind === "outer-shadow")) {
    const radians = (effect.angle * Math.PI) / 180;
    const shadow = coloredShadowMask(
      base,
      effect,
      Math.cos(radians) * effect.distance * scale,
      Math.sin(radians) * effect.distance * scale,
      scale
    );
    resultContext.drawImage(shadow, 0, 0);
  }

  resultContext.drawImage(base, 0, 0);

  for (const effect of active.filter((candidate) => candidate.kind === "inner-shadow")) {
    const radians = (effect.angle * Math.PI) / 180;
    const shadow = coloredShadowMask(
      base,
      effect,
      Math.cos(radians) * effect.distance * scale,
      Math.sin(radians) * effect.distance * scale,
      scale,
      true
    );
    const clipped = effectCanvas(base.width, base.height);
    const clippedContext = effectContext2d(clipped);
    clippedContext.drawImage(shadow, 0, 0);
    clippedContext.globalCompositeOperation = "destination-in";
    clippedContext.drawImage(base, 0, 0);
    resultContext.drawImage(clipped, 0, 0);
  }
  return { canvas: result, padding };
}

type DataUrlEffectResult = {
  dataUrl: string;
  padding: WatchfaceEffectPadding;
  width: number;
  height: number;
};

const effectVariantCache = new Map<string, Promise<DataUrlEffectResult>>();

function compactHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += Math.max(1, Math.floor(value.length / 2048))) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

async function renderWatchfaceDataUrlEffectsUncached(
  dataUrl: string,
  effects: CorosWatchfaceShadowEffect[],
  scale = 1
): Promise<DataUrlEffectResult> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image();
    value.onload = () => resolve(value);
    value.onerror = () => reject(new Error("The effect source image could not be decoded."));
    value.src = dataUrl;
  });
  const source = canvas(image.naturalWidth, image.naturalHeight);
  context2d(source).drawImage(image, 0, 0);
  const rendered = renderWatchfaceCanvasEffects(source, effects, scale, true);
  return {
    dataUrl: rendered.canvas.toDataURL("image/png"),
    padding: rendered.padding,
    width: rendered.canvas.width,
    height: rendered.canvas.height
  };
}

/** Cached by source asset and normalized effect hash for preview/export parity. */
export function renderWatchfaceDataUrlEffects(
  dataUrl: string,
  effects: CorosWatchfaceShadowEffect[],
  scale = 1
): Promise<DataUrlEffectResult> {
  const key = `${compactHash(dataUrl)}:${dataUrl.length}:${scale}:${compactHash(JSON.stringify(effects.map(normalizeWatchfaceShadowEffect)))}`;
  const cached = effectVariantCache.get(key);
  if (cached) {
    effectVariantCache.delete(key);
    effectVariantCache.set(key, cached);
    return cached;
  }
  const rendered = renderWatchfaceDataUrlEffectsUncached(dataUrl, effects, scale)
    .catch((error) => {
      effectVariantCache.delete(key);
      throw error;
    });
  effectVariantCache.set(key, rendered);
  while (effectVariantCache.size > 48) {
    const oldest = effectVariantCache.keys().next().value as string | undefined;
    if (!oldest) break;
    effectVariantCache.delete(oldest);
  }
  return rendered;
}
