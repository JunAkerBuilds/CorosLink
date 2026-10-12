export interface CorosNotificationInput {
  appId?: string;
  title: string;
  body: string;
}

function textBytes(text: unknown, limit: number, label: string): Buffer {
  if (typeof text !== "string" || !text.length || text.includes("\0")) {
    throw new Error(`Enter a ${label} without embedded null characters.`);
  }
  const value = Buffer.from(text + "\0", "utf8");
  if (value.length > limit) throw new Error(`The notification ${label} exceeds ${limit - 1} UTF-8 bytes.`);
  return value;
}

function field(type: number, value: Buffer): Buffer {
  return Buffer.concat([Buffer.from([(type << 4) | (value.length >> 8), value.length & 255]), value]);
}

/** W332's dedicated notification fragments; no ordinary command SUM/ACK. */
export function encodeNotificationFrames(input: CorosNotificationInput, maximum = 20, sequence = 1): Buffer[] {
  if (!input || typeof input !== "object" || !Number.isInteger(maximum) || maximum < 4 || maximum > 255 ||
      !Number.isInteger(sequence) || sequence < 0 || sequence > 127) {
    throw new Error("Invalid notification request or Bluetooth frame size.");
  }
  const appId = input.appId ?? "org.coroslink.app";
  if (typeof appId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(appId)) {
    throw new Error("The notification app identifier must contain 1–128 ASCII characters.");
  }
  const payload = Buffer.concat([
    field(0, Buffer.from(appId, "ascii")), field(1, textBytes(input.title, 32, "title")),
    field(2, textBytes(input.body, 512, "message")), field(3, Buffer.from([0]))
  ]);
  const size = maximum - 3;
  const count = Math.ceil(payload.length / size);
  if (count > 256) throw new Error("The notification requires too many Bluetooth fragments.");
  return Array.from({ length: count }, (_, index) => Buffer.concat([
    Buffer.from([0x79, count - index - 1, sequence | (index === 0 ? 0x80 : 0)]),
    payload.subarray(index * size, (index + 1) * size)
  ]));
}
