// What the Media page needs to know about an MP3: whether it is one, its title, artist and album (ID3v2, else
// ID3v1), and how long it plays (Xing/Info or VBRI header, else the first frame's bitrate). Reads only the parts of
// the file it needs, never the whole file.
import { open } from "node:fs/promises";

export interface Mp3Info { title: string | null; artist: string | null; album: string | null; secs: number | null }

/** Reads `length` bytes at `offset` (fewer at the end of the file). */
export type ReadAt = (offset: number, length: number) => Promise<Buffer>;

const MAX_TAG = 1024 * 1024; // text frames come first in practice; cover art past this is skipped
const SYNC_WINDOW = 64 * 1024;

const BITRATES = {
  v1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES = [44100, 48000, 32000];

interface Frame { v1: boolean; bitrate: number; rate: number; mono: boolean; length: number; samples: number }

/** An MPEG audio Layer III frame header at `at`, or null. */
function frameAt(b: Buffer, at: number): Frame | null {
  if (at + 4 > b.length || b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (b[at + 1] >> 3) & 3; // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
  const layer = (b[at + 1] >> 1) & 3; // 1 = Layer III
  const bitIndex = b[at + 2] >> 4, rateIndex = (b[at + 2] >> 2) & 3, pad = (b[at + 2] >> 1) & 1;
  if (version === 1 || layer !== 1 || bitIndex === 0 || bitIndex === 15 || rateIndex === 3) return null;
  const v1 = version === 3;
  const bitrate = (v1 ? BITRATES.v1 : BITRATES.v2)[bitIndex] * 1000;
  const rate = RATES[rateIndex] / (v1 ? 1 : version === 2 ? 2 : 4);
  const length = Math.floor(((v1 ? 144 : 72) * bitrate) / rate) + pad;
  return { v1, bitrate, rate, mono: b[at + 3] >> 6 === 3, length, samples: v1 ? 1152 : 576 };
}

/** The first frame in `b`, confirmed by the frame after it when that one is in the buffer too. */
function firstFrame(b: Buffer): { at: number; frame: Frame } | null {
  for (let at = 0; at + 4 <= b.length; at++) {
    const frame = frameAt(b, at);
    if (!frame) continue;
    const next = at + frame.length;
    if (next + 4 > b.length || frameAt(b, next)) return { at, frame };
  }
  return null;
}

const syncsafe = (b: Buffer, at: number) => ((b[at] & 0x7f) << 21) | ((b[at + 1] & 0x7f) << 14) | ((b[at + 2] & 0x7f) << 7) | (b[at + 3] & 0x7f);

/** An ID3 text frame's value: its encoding byte, then the text. */
function text(body: Buffer): string | null {
  if (!body.length) return null;
  const enc = body[0], raw = body.subarray(1);
  let value: string;
  if (enc === 1 || enc === 2) {
    let bytes = raw, bigEndian = enc === 2;
    if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff))) {
      bigEndian = bytes[0] === 0xfe;
      bytes = bytes.subarray(2);
    }
    const even = Buffer.from(bytes.subarray(0, bytes.length - (bytes.length % 2)));
    if (bigEndian) even.swap16();
    value = even.toString("utf16le");
  } else value = raw.toString(enc === 3 ? "utf8" : "latin1");
  value = value.split("\0")[0].trim();
  return value || null;
}

const WANT: Record<string, keyof Omit<Mp3Info, "secs">> = { TIT2: "title", TPE1: "artist", TALB: "album", TT2: "title", TP1: "artist", TAL: "album" };

/** Title, artist and album from an ID3v2 tag's frames (`tag` starts after the 10-byte header). */
function id3v2(tag: Buffer, major: number): Partial<Mp3Info> {
  const found: Partial<Mp3Info> = {};
  const short = major === 2, head = short ? 6 : 10;
  for (let at = 0; at + head <= tag.length;) {
    const id = tag.toString("latin1", at, at + (short ? 3 : 4));
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // padding
    const size = short ? tag.readUIntBE(at + 3, 3) : major === 4 ? syncsafe(tag, at + 4) : tag.readUInt32BE(at + 4);
    const key = WANT[id];
    if (key && !found[key]) found[key] = text(tag.subarray(at + head, at + head + size));
    at += head + size;
  }
  return found;
}

function id3v1(tail: Buffer): Partial<Mp3Info> {
  if (tail.length < 128 || tail.toString("latin1", 0, 3) !== "TAG") return {};
  const field = (from: number) => tail.toString("latin1", from, from + 30).split("\0")[0].trim() || null;
  return { title: field(3), artist: field(33), album: field(63) };
}

/** Where the audio starts (after any ID3v2 tag), and the tag's fields. */
async function readTag(read: ReadAt): Promise<{ audioAt: number; tags: Partial<Mp3Info> }> {
  const head = await read(0, 10);
  if (head.length < 10 || head.toString("latin1", 0, 3) !== "ID3") return { audioAt: 0, tags: {} };
  const size = syncsafe(head, 6), footer = head[5] & 0x10 ? 10 : 0;
  const unsynced = (head[5] & 0x80) !== 0;
  const tags = unsynced ? {} : id3v2(await read(10, Math.min(size, MAX_TAG)), head[3]);
  return { audioAt: 10 + size + footer, tags };
}

/** Whether the file is an MP3: an ID3 tag, then MPEG Layer III frames. */
export async function isMp3(read: ReadAt): Promise<boolean> {
  const { audioAt } = await readTag(read);
  return firstFrame(await read(audioAt, SYNC_WINDOW)) !== null;
}

export async function readMp3(read: ReadAt, size: number): Promise<Mp3Info> {
  const { audioAt, tags } = await readTag(read);
  const tail = size >= 128 ? await read(size - 128, 128) : Buffer.alloc(0);
  const v1 = id3v1(tail);
  const info: Mp3Info = { title: tags.title ?? v1.title ?? null, artist: tags.artist ?? v1.artist ?? null, album: tags.album ?? v1.album ?? null, secs: null };

  const window = await read(audioAt, SYNC_WINDOW);
  const first = firstFrame(window);
  if (!first) return info;
  const { at, frame } = first;
  // Xing / Info (LAME) header: the frame count, for VBR files.
  const side = frame.v1 ? (frame.mono ? 17 : 32) : frame.mono ? 9 : 17;
  const xing = at + 4 + side;
  const tagName = window.toString("latin1", xing, xing + 4);
  if ((tagName === "Xing" || tagName === "Info") && window.length >= xing + 12 && window.readUInt32BE(xing + 4) & 1) {
    info.secs = Math.round((window.readUInt32BE(xing + 8) * frame.samples) / frame.rate);
    return info;
  }
  const vbri = at + 4 + 32;
  if (window.toString("latin1", vbri, vbri + 4) === "VBRI" && window.length >= vbri + 18) {
    info.secs = Math.round((window.readUInt32BE(vbri + 14) * frame.samples) / frame.rate);
    return info;
  }
  const audioBytes = size - audioAt - at - ("title" in v1 ? 128 : 0);
  info.secs = audioBytes > 0 ? Math.round((audioBytes * 8) / frame.bitrate) : null;
  return info;
}

/** A reader over a file on disk, open only while `work` runs. */
export async function withFile<T>(file: string, work: (read: ReadAt, size: number) => Promise<T>): Promise<T> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const read: ReadAt = async (offset, length) => {
      const buffer = Buffer.alloc(Math.max(0, Math.min(length, size - offset)));
      if (!buffer.length) return buffer;
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      return buffer.subarray(0, bytesRead);
    };
    return await work(read, size);
  } finally {
    await handle.close();
  }
}

/** A reader over bytes in memory (an upload, a test). */
export const bufferReader = (b: Buffer): ReadAt => async (offset, length) => b.subarray(offset, offset + length);

/** "Talk.MP3" → "Talk.mp3"; any other name comes back as it is. The watch never plays a capital .MP3 (PACE 4). */
export const lowercaseMp3 = (name: string): string => (/\.mp3$/i.test(name) ? `${name.slice(0, -4)}.mp3` : name);

/** A name that's safe on the watch's FAT drive and on this computer. */
export const safeName = (name: string): string => name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").replace(/^\.+/, "").trim() || "Track.mp3";

