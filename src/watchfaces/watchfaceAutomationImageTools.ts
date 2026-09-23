import {
  parseWatchfaceHexColor,
  recolorPixels,
  samplePoint,
  sampleRegion,
  type WatchfacePixelBox
} from "./watchfaceAutomationPixels";

/** Browser-side image work behind Watchmaker's render_svg, recolor_image and sample_color. */

export const MAX_AUTOMATION_IMAGE_SIDE = 2048;
export const MAX_AUTOMATION_SVG_LENGTH = 200_000;

export interface WatchfaceDecodedImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = src;
  });
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Image processing is unavailable in this window.");
  return { canvas, context };
}

export async function decodeImageDataUrl(dataUrl: string): Promise<WatchfaceDecodedImage> {
  const image = await loadImage(dataUrl);
  const { context } = canvasOf(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, 0, 0);
  return {
    data: context.getImageData(0, 0, image.naturalWidth, image.naturalHeight).data,
    width: image.naturalWidth,
    height: image.naturalHeight
  };
}

export function encodePngDataUrl(image: WatchfaceDecodedImage): string {
  const { canvas, context } = canvasOf(image.width, image.height);
  context.putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
  return canvas.toDataURL("image/png");
}

function outputSide(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 1 || value > MAX_AUTOMATION_IMAGE_SIDE) {
    throw new Error(`${name} must be between 1 and ${MAX_AUTOMATION_IMAGE_SIDE} pixels.`);
  }
  return Math.round(value);
}

/**
 * Parses untrusted SVG, drops anything scriptable, and pins the output size.
 * Rendering then goes through an <img>, which never runs scripts or fetches
 * external resources.
 */
export function prepareAutomationSvg(svg: string, width: number, height: number): string {
  if (svg.length > MAX_AUTOMATION_SVG_LENGTH) {
    throw new Error(`svg must be at most ${MAX_AUTOMATION_SVG_LENGTH} characters.`);
  }
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  const error = parsed.querySelector("parsererror");
  if (error) {
    const text = error.textContent ?? "";
    const detail = /error on line[^\n]*/i.exec(text)?.[0] ?? text.trim();
    throw new Error(`The SVG is not valid XML: ${detail.slice(0, 300)}`);
  }
  const root = parsed.documentElement;
  if (root.localName !== "svg") throw new Error("The root element must be <svg>.");
  for (const element of [...root.querySelectorAll("script, foreignObject")]) element.remove();
  for (const element of [root, ...root.querySelectorAll("*")]) {
    for (const attribute of [...element.attributes]) {
      const value = attribute.value.trim().toLowerCase();
      if (
        attribute.name.toLowerCase().startsWith("on") ||
        ((attribute.localName === "href") && !value.startsWith("#") && !value.startsWith("data:image/"))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  if (!root.getAttribute("viewBox")) {
    const declaredWidth = Number.parseFloat(root.getAttribute("width") ?? "");
    const declaredHeight = Number.parseFloat(root.getAttribute("height") ?? "");
    root.setAttribute(
      "viewBox",
      `0 0 ${Number.isFinite(declaredWidth) && declaredWidth > 0 ? declaredWidth : width} ${Number.isFinite(declaredHeight) && declaredHeight > 0 ? declaredHeight : height}`
    );
  }
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  if (!root.getAttribute("xmlns")) root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return new XMLSerializer().serializeToString(root);
}

/** Rasterizes SVG to an exact-size PNG with a transparent background. */
export async function renderAutomationSvg(
  svg: string,
  requestedWidth: number,
  requestedHeight: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  const width = outputSide(requestedWidth, "width");
  const height = outputSide(requestedHeight, "height");
  const prepared = prepareAutomationSvg(svg, width, height);
  const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(prepared)}`)
    .catch(() => {
      throw new Error("The SVG could not be rendered. Check that it is complete and self-contained.");
    });
  const { canvas, context } = canvasOf(width, height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

export async function recolorAutomationImage(
  dataUrl: string,
  options: { color: string; from?: string; tolerance?: number }
): Promise<{ dataUrl: string; width: number; height: number; changedPixels: number }> {
  const color = parseWatchfaceHexColor(options.color);
  if (!color) throw new Error("color must be #RRGGBB.");
  const from = options.from === undefined ? undefined : parseWatchfaceHexColor(options.from);
  if (from === null) throw new Error("from must be #RRGGBB.");
  const tolerance = options.tolerance ?? 48;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) {
    throw new Error("tolerance must be between 0 and 255.");
  }
  const image = await decodeImageDataUrl(dataUrl);
  const changedPixels = recolorPixels(image.data, color, from, tolerance);
  return { dataUrl: encodePngDataUrl(image), width: image.width, height: image.height, changedPixels };
}

export function sampleAutomationImage(
  image: WatchfaceDecodedImage,
  options: {
    points?: Array<{ x: number; y: number }>;
    regions?: WatchfacePixelBox[];
    palette?: number;
  }
) {
  const paletteSize = Math.max(0, Math.min(12, Math.round(options.palette ?? 5)));
  const regions = options.regions?.length
    ? options.regions
    : options.points?.length
      ? []
      : [{ x: 0, y: 0, width: image.width, height: image.height }];
  return {
    width: image.width,
    height: image.height,
    points: (options.points ?? []).map((point) =>
      samplePoint(image.data, image.width, image.height, point) ?? { ...point, color: null, alpha: 0 }
    ),
    regions: regions.map((region) =>
      sampleRegion(image.data, image.width, image.height, region, paletteSize)
    )
  };
}
