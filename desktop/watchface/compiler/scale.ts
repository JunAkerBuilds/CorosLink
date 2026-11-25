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

/** The Lanczos kernel with three lobes. */
function lanczos3(x: number): number {
  if (x === 0) return 1;
  if (x <= -3 || x >= 3) return 0;
  const px = Math.PI * x;
  return (3 * Math.sin(px) * Math.sin(px / 3)) / (px * px);
}

/** For each output pixel along one axis: the first source pixel and the normalised weights from there. */
function lanczosTaps(source: number, target: number): { first: Int32Array; count: Int32Array; weights: Float32Array; stride: number } {
  const scale = source / target, support = 3 * Math.max(1, scale), stride = Math.ceil(support) * 2 + 1;
  const first = new Int32Array(target), count = new Int32Array(target), weights = new Float32Array(target * stride);
  for (let i = 0; i < target; i++) {
    const centre = (i + 0.5) * scale;
    const lo = Math.max(0, Math.floor(centre - support)), hi = Math.min(source - 1, Math.ceil(centre + support) - 1);
    let sum = 0;
    for (let j = lo; j <= hi; j++) {
      const w = lanczos3((j + 0.5 - centre) / Math.max(1, scale));
      weights[i * stride + j - lo] = w; sum += w;
    }
    if (sum !== 0) for (let j = 0; j <= hi - lo; j++) weights[i * stride + j] /= sum;
    first[i] = lo; count[i] = hi - lo + 1;
  }
  return { first, count, weights, stride };
}

/**
 * Shrinks the way Chromium's "best" resize did for CorosLink (Electron's nativeImage): a separable Lanczos-3 filter on
 * premultiplied colour, so edges stay sharp and transparent pixels don't bleed colour. Enlarging is scaleImage's
 * bilinear, as CorosLink switched to after Chromium's smeared small sprites. scaleImage itself stays as it is: the
 * compiler uses it to match COROS's own scaling.
 */
export function shrinkImage(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width === width && image.height === height) return image;
  if (width > image.width || height > image.height) return scaleImage(image, width, height);
  const sw = image.width, sh = image.height, src = image.data;
  // Premultiplied, as floats.
  const pre = new Float32Array(sw * sh * 4);
  for (let p = 0; p < sw * sh * 4; p += 4) {
    const a = src[p + 3]! / 255;
    pre[p] = src[p]! * a; pre[p + 1] = src[p + 1]! * a; pre[p + 2] = src[p + 2]! * a; pre[p + 3] = src[p + 3]!;
  }
  // Across, then down.
  const across = lanczosTaps(sw, width), down = lanczosTaps(sh, height);
  const mid = new Float32Array(width * sh * 4);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const base = x * across.stride, from = across.first[x]!;
      for (let k = 0; k < across.count[x]!; k++) {
        const w = across.weights[base + k]!, p = (y * sw + from + k) * 4;
        r += pre[p]! * w; g += pre[p + 1]! * w; b += pre[p + 2]! * w; a += pre[p + 3]! * w;
      }
      const q = (y * width + x) * 4;
      mid[q] = r; mid[q + 1] = g; mid[q + 2] = b; mid[q + 3] = a;
    }
  }
  const out = new Uint8Array(width * height * 4);
  const clamp = (v: number) => (v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v));
  for (let y = 0; y < height; y++) {
    const base = y * down.stride, from = down.first[y]!;
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < down.count[y]!; k++) {
        const w = down.weights[base + k]!, p = ((from + k) * width + x) * 4;
        r += mid[p]! * w; g += mid[p + 1]! * w; b += mid[p + 2]! * w; a += mid[p + 3]! * w;
      }
      const at = (y * width + x) * 4, alpha = clamp(a);
      out[at + 3] = alpha;
      // Back from premultiplied; colour can't exceed what its alpha allows.
      if (alpha > 0) {
        const k = 255 / Math.max(a, 1e-6);
        out[at] = clamp(Math.min(r, a) * k); out[at + 1] = clamp(Math.min(g, a) * k); out[at + 2] = clamp(Math.min(b, a) * k);
      }
    }
  }
  return { width, height, data: out };
}
