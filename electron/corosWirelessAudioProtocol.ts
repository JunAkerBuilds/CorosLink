import type { CorosWirelessAudioTrack } from "./corosBleMusicTypes";

/** GET_DEVICE_FILE, one podcast query (type 1, length 2), all subtypes. Read-only. */
export function encodeWirelessAudioInventoryQuery(): Buffer {
  return Buffer.from("0e0100000001000200ffff", "hex");
}

/** Delete one exact inventory record (B6/0D). */
export function encodeWirelessAudioDelete(track: CorosWirelessAudioTrack): Buffer {
  if (track.destination !== "podcasts" || !/^[a-zA-Z0-9_-]{8}$/.test(track.id) ||
      !Number.isInteger(track.sizeBytes) || track.sizeBytes < 0 || track.sizeBytes > 0xffffffff) {
    throw new Error("Invalid podcast record. Refresh the watch library and try again.");
  }
  const payload = Buffer.alloc(23);
  payload[0] = 0x0d;
  payload.writeUInt32LE(1, 1);
  payload.writeUInt16LE(1, 5);
  payload.writeUInt16LE(14, 7);
  payload.write(track.id, 11, 8, "ascii");
  payload.writeUInt32LE(track.sizeBytes, 19);
  return payload;
}

/** B6/0E returns a count and records with a 4-byte header and 14-byte podcast body. */
export function decodeWirelessAudioInventory(payload: Buffer): CorosWirelessAudioTrack[] {
  const invalid = (): never => { throw new Error("The watch returned an invalid podcast inventory."); };
  if (payload.length < 5 || payload[0] !== 1) invalid();
  const count = payload.readUInt32LE(1);
  if (count > 500 || payload.length !== 5 + count * 18) invalid();
  const seen = new Set<string>();
  return Array.from({ length: count }, (_, index) => {
    const row = payload.subarray(5 + index * 18, 5 + (index + 1) * 18);
    const subtype = row.readUInt16LE(4), idBytes = row.subarray(6, 14), id = idBytes.toString("ascii");
    if (row.readUInt16LE(0) !== 1 || row.readUInt16LE(2) !== 14 || subtype > 1 || idBytes.some(byte => byte > 127) || !/^[a-zA-Z0-9_-]{8}$/.test(id)) invalid();
    const key = `${subtype}:${id}`;
    if (seen.has(key)) invalid();
    seen.add(key);
    return { id, destination: subtype === 0 ? "podcasts" : "netease", sizeBytes: row.readUInt32LE(14) };
  });
}
