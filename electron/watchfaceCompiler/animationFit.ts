/**
 * What a watch does with a face's native sprite animation (header 0x312), as plain typed-array
 * code with no Node APIs: the compiler builds the BIN from it and Studio's preview plays the same
 * result, so the two cannot disagree.
 */

/**
 * Memory-in-pixel watches whose 3.2108.0 renderer reads the record (run in emulation with MIP-encoded
 * frames: PACE 3, NOMAD, APEX 4 in both sizes, APEX 2, APEX 2 Pro). VERTIX 2/2S, VERTIX and PACE 2
 * are unchecked, and APEX Pro's firmware has no animation branch.
 */
export const MIP_ANIMATION_MODELS: ReadonlySet<string> = new Set(["pace-3", "nomad", "apex-4", "apex-2", "apex-2-pro"]);

/** Whether a watch plays the animation at all: every AMOLED watch, and the MIP ones above. */
export function watchPlaysAnimation(target: { display: "amoled" | "mip"; model: string }): boolean {
  return target.display === "amoled" || MIP_ANIMATION_MODELS.has(target.model);
}

/** What one memory-in-pixel frame list can index: its frame ends are u16 offsets. */
export const MIP_FRAME_LIST_BYTES = 0xffff;

/** COROS `To2222Buffer` channel levels: <43, <128, <213, else full. */
export const mipLevel = (value: number): number => value < 43 ? 0 : value < 128 ? 1 : value < 213 ? 2 : 3;

/** One memory-in-pixel byte per pixel (`Bitmap::To2222Buffer`, rounded as COROS does); 0xff is transparent. */
export function mip2222(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(0xff);
  for (let index = 0; index < out.length; index++) {
    const at = index * 4, alpha = rgba[at + 3]!;
    if (alpha < 64) continue;
    out[index] = ((3 - (alpha >> 6)) << 6) | (mipLevel(rgba[at]!) << 4) | (mipLevel(rgba[at + 1]!) << 2) | mipLevel(rgba[at + 2]!);
  }
  return out;
}

/** The straight RGBA a watch shows for memory-in-pixel bytes: four levels a channel, four of alpha. */
export function mip2222ToRgba(frame: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(frame.length * 4);
  for (let index = 0; index < frame.length; index++) {
    const value = frame[index]!, at = index * 4, alpha = 3 - (value >> 6);
    if (alpha === 0) continue;
    out[at] = ((value >> 4) & 3) * 85; out[at + 1] = ((value >> 2) & 3) * 85; out[at + 2] = (value & 3) * 85; out[at + 3] = alpha * 85;
  }
  return out;
}

/** PCX-style RLE (`CBZ::Compress`): runs of up to 63, and any byte ≥ 0xc0, as a count byte then the value. */
export function cbzCompressBytes(input: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length * 2);
  let length = 0;
  for (let i = 0; i < input.length;) {
    const value = input[i]!;
    let run = 1;
    while (run < 63 && i + run < input.length && input[i + run] === value) run++;
    if (run > 1 || value >= 0xc0) { output[length++] = 0xc0 | run; output[length++] = value; }
    else output[length++] = value;
    i += run;
  }
  return output.subarray(0, length);
}

export interface MipAnimationPlan {
  /** How far the picture's top-left moved when its empty margin was cut off. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** The source frames that play, in order. */
  kept: number[];
  /** One delay per kept frame: its own plus those of the frames left out after it. */
  delays: number[];
  /** The kept frames' memory-in-pixel bytes, cut to `width` × `height`. */
  frames: Uint8Array[];
  /** Bytes the frames take in the block, of `MIP_FRAME_LIST_BYTES`. */
  bytes: number;
}

/**
 * An animation fitted to one memory-in-pixel frame list. The margin no frame draws in is cut off,
 * which changes nothing on screen. If that is not enough, evenly spaced frames are left out, the
 * most that fit being kept, and each kept frame stays up for the frames after it, so the loop takes
 * as long as before. Undefined when a single frame is already too large.
 * `encoded` holds each frame's memory-in-pixel bytes, all `width` × `height`.
 */
export function planMipAnimation(encoded: Uint8Array[], width: number, height: number, delays: readonly number[]): MipAnimationPlan | undefined {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (const frame of encoded) {
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (frame[y * width + x] === 0xff) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  // Nothing visible in any frame: one transparent pixel.
  if (x1 < 0) { x0 = 0; y0 = 0; x1 = 0; y1 = 0; }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const cropped = encoded.map(frame => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(frame.subarray((y0 + y) * width + x0, (y0 + y) * width + x0 + w), y * w);
    return out;
  });
  // RLE is chosen from the first frame and applied to all; frame 0 is always kept, so sizes hold for any choice.
  const useRle = cbzCompressBytes(cropped[0]!).length < cropped[0]!.length;
  const sizes = cropped.map(frame => useRle ? cbzCompressBytes(frame).length : frame.length);
  for (let keep = cropped.length; keep >= 1; keep--) {
    const kept = Array.from({ length: keep }, (_, i) => Math.floor(i * cropped.length / keep));
    const bytes = kept.reduce((sum, index) => sum + sizes[index]!, 0);
    if (bytes > MIP_FRAME_LIST_BYTES) continue;
    return {
      x: x0, y: y0, width: w, height: h, kept, bytes, frames: kept.map(index => cropped[index]!),
      delays: kept.map((start, i) => Math.min(0xffff, delays.slice(start, kept[i + 1] ?? delays.length).reduce((sum, delay) => sum + delay, 0)))
    };
  }
  return undefined;
}
