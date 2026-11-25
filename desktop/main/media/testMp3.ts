// MP3s made byte by byte for the media tests: ID3 tags and silent MPEG-1 Layer III frames.

/** An ID3v2.3 text frame. */
export const frame = (id: string, value: string) => {
  const body = Buffer.concat([Buffer.from([3]), Buffer.from(value, "utf8")]);
  const head = Buffer.alloc(10);
  head.write(id, 0, "latin1");
  head.writeUInt32BE(body.length, 4);
  return Buffer.concat([head, body]);
};
export const id3 = (frames: Buffer[]) => {
  const body = Buffer.concat(frames);
  const size = body.length;
  const head = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, (size >> 21) & 0x7f, (size >> 14) & 0x7f, (size >> 7) & 0x7f, size & 0x7f]);
  return Buffer.concat([head, body]);
};
/** `count` MPEG-1 Layer III frames at 128 kbps, 44.1 kHz (417 bytes each, 1152 samples). */
export const frames = (count: number, xingFrames?: number) => {
  const one = Buffer.alloc(417);
  one.set([0xff, 0xfb, 0x90, 0x00]);
  const all = Buffer.concat(Array.from({ length: count }, () => one));
  if (xingFrames != null) {
    all.write("Xing", 4 + 32, "latin1");
    all.writeUInt32BE(1, 4 + 36);
    all.writeUInt32BE(xingFrames, 4 + 40);
  }
  return all;
};
export const mp3 = (seconds = 10, tags: Buffer[] = [frame("TIT2", "Glass Meridian"), frame("TPE1", "Northline"), frame("TALB", "Afterlight")]) =>
  Buffer.concat([id3(tags), frames(Math.round((seconds * 44100) / 1152))]);

