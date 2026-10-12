import type { RgbaImage } from "./png";

/**
 * Resizes for backgrounds (to the screen) and thumbnails (to 315 px), which
 * COROS scales with AGG before quantizing. Downscaling averages each source
 * area with alpha weighting; upscaling interpolates bilinearly. Results are
 * close to, not byte-identical with, COROS's.
 */
export function scaleImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  const out = new Uint8Array(width * height * 4), src = image.data, sw = image.width, sh = image.height;
  const sx = sw / width, sy = sh / height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      if (sx > 1 || sy > 1) {
        const x0 = x * sx, x1 = Math.min(sw, (x + 1) * sx), y0 = y * sy, y1 = Math.min(sh, (y + 1) * sy);
        for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++) {
          const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
          for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
            const w = wy * (Math.min(xx + 1, x1) - Math.max(xx, x0)), p = (yy * sw + xx) * 4, alpha = src[p + 3]! * w;
            r += src[p]! * alpha; g += src[p + 1]! * alpha; b += src[p + 2]! * alpha; a += alpha; weight += w;
          }
        }
      } else {
        const fx = Math.max(0, (x + 0.5) * sx - 0.5), fy = Math.max(0, (y + 0.5) * sy - 0.5);
        const x0 = Math.min(sw - 1, Math.floor(fx)), y0 = Math.min(sh - 1, Math.floor(fy));
        const x1 = Math.min(sw - 1, x0 + 1), y1 = Math.min(sh - 1, y0 + 1), tx = fx - x0, ty = fy - y0;
        for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x1, y0, tx * (1 - ty)], [x0, y1, (1 - tx) * ty], [x1, y1, tx * ty]] as const) {
          const p = (yy * sw + xx) * 4, alpha = src[p + 3]! * w;
          r += src[p]! * alpha; g += src[p + 1]! * alpha; b += src[p + 2]! * alpha; a += alpha; weight += w;
        }
      }
      if (a > 0) { out[at] = Math.round(r / a); out[at + 1] = Math.round(g / a); out[at + 2] = Math.round(b / a); }
      out[at + 3] = weight > 0 ? Math.round(a / weight) : 0;
    }
  }
  return { width, height, data: out };
}
