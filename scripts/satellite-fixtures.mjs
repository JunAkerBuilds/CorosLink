// Synthetic COROS satellite files and watch reports for the tests (no COROS data is kept in the repository).
// The layout is the one of the files cep/query lists (electron/corosWatchCep.ts): sections of
// {u32 start (s since 2014), u32 duration (s), u32 length, u8 type, u8 subtype, u16 0} + payload.

export const WATCH_EPOCH = 1_388_534_400;
const GPS_TO_WATCH_EPOCH = WATCH_EPOCH - 315_964_800;

/** Hours since 2014-01-01 UTC. */
export const watchHourAt = (unixMs) => Math.floor((unixMs / 1000 - WATCH_EPOCH) / 3600);

export function section(startSeconds, hours, type, subtype, payload) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(startSeconds, 0); header.writeUInt32LE(hours * 3600, 4); header.writeUInt32LE(payload.length, 8);
  header[12] = type; header[13] = subtype;
  return Buffer.concat([header, payload]);
}

/** ELPO section 5: 56 records of 72 bytes per 6-hour segment, each stamped with its segment's GPS hour. */
export function elpoRecords(startSeconds, hours) {
  const segments = hours / 6;
  const bytes = Buffer.alloc(segments * 56 * 72, 0x5a);
  const firstGpsHour = (startSeconds + GPS_TO_WATCH_EPOCH) / 3600;
  for (let record = 0; record < segments * 56; record++) {
    bytes.writeUIntLE(firstGpsHour + Math.floor(record / 56) * 6, record * 72, 3);
    bytes[record * 72 + 3] = (record % 56) + 1;
  }
  return bytes;
}

/** An ELPO file as COROS serves it (type 62 by default: 144 hours from `startHour`). */
export function elpoFile(startHour, hours = 144) {
  const start = startHour * 3600;
  return Buffer.concat([section(start, hours, 5, 1, elpoRecords(start, hours)), section(start, 72, 4, 1, Buffer.alloc(300, 1)), section(start, 72, 3, 1, Buffer.alloc(200, 2))]);
}

/** A Synaptics LTO (subtype 2, 168 h) or RTO (subtype 3, 4 h) file. RTO starts are not on the hour. */
export function synapticsFile(startSeconds, hours = 168, subtype = 2, size = 9000) {
  return section(startSeconds, hours, 6, subtype, Buffer.alloc(size, subtype));
}

/** Settings type 13 as the firmware writes it (the bytes after type and length). */
export function fwInfo({ blocks, epoType = 1, fileType, blocks2 = 0, start = 0, start2 = 0, eph, extra = 0 }) {
  const bytes = Buffer.alloc((eph ? 23 : 15) + extra);
  bytes[0] = 1; bytes[1] = 6; bytes[2] = 1;
  bytes[3] = blocks; bytes[4] = epoType; bytes[5] = fileType; bytes[6] = blocks2;
  bytes.writeUInt32LE(start, 7); bytes.writeUInt32LE(start2, 11);
  if (eph) { bytes[15] = eph.type; bytes[16] = eph.fileType; bytes.writeUInt32LE(eph.start, 17); bytes[21] = eph.hours; }
  return bytes;
}

/** A successful 17-byte bind reply, bytes 11–14 = the satellite-data word. */
export function bindReply(version, word) {
  const bytes = Buffer.alloc(17);
  bytes[0] = (version << 4) | 1;
  bytes.writeUInt32LE(word >>> 0, 11);
  return bytes;
}

/** What the five models' 3.2008.0 firmware reports, by receiver. */
export const REPORTS = {
  /** PACE 4 (hardware variant 1) and PACE 4 Pro: 24 blocks, ELPO, an ELPO ephemeris (file type 0) the app has no file for. */
  elpo: (start) => ({ bind: bindReply(3, start | (24 << 24) | (1 << 30)), settings: fwInfo({ blocks: 24, fileType: 2, start, eph: { type: 1, fileType: 0, start, hours: 4 }, extra: 9 }) }),
  /** PACE 3: 72 hours in file 13 and 96 more in file 68, no ephemeris. */
  elpoTwoFiles: (start, start2) => ({ bind: bindReply(3, start | (12 << 24) | (1 << 30)), settings: fwInfo({ blocks: 12, fileType: 2, blocks2: 16, start, start2 }) }),
  /** PACE Pro, APEX 4, PACE 4 (variant 2): LTO for 168 hours and RTO for 4. */
  lto: (start, ephStart) => ({ bind: bindReply(3, start | (28 << 24) | (1 << 30)), settings: fwInfo({ blocks: 28, fileType: 3, start, eph: { type: 1, fileType: 1, start: ephStart, hours: 4 } }) }),
  /** PACE 4 (variant 0): no figures; the bind says all systems, chip 0, and nothing loaded. */
  epo: () => ({ bind: bindReply(3, 1 << 30), settings: fwInfo({ blocks: 0, fileType: 0 }) })
};
