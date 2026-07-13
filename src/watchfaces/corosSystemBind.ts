/**
 * COROS protocol-v2 SystemBind primitives.
 *
 * The PACE Pro requires an `A5` SystemBind exchange before it will accept an
 * SFT watch-face transfer.  This module models the deterministic first
 * request and the protocol-v2 framing used by the Android client.  It does
 * not open Bluetooth connections or send a packet; the still-unmapped
 * follow-up A5 configuration exchange must be verified before it is wired
 * into the direct installer.
 */

export const COROS_SYSTEM_BIND_OPCODE = 0xa5;
export const COROS_V2_DEFAULT_WRITE_BYTES = 20;
export const COROS_SYSTEM_BIND_PAYLOAD_BYTES = 17;
export const COROS_SYSTEM_BIND_AUTH_METADATA = Uint8Array.from([0x00, 0x01, 0x10, 0x01, 0x00, 0x11, 0x00, 0x0c]);
export const COROS_SYSTEM_BIND_AUTH_COMPRESSED_BYTES = 268;

const CRC32_MPEG2_POLYNOMIAL = 0x04c11db7;

export interface CorosSystemBindOptions {
  /** Decimal COROS account ID, retained as text to avoid JavaScript rounding. */
  accountUserId: string;
  /** Unix time in seconds, as sent by the Android SystemBind helper. */
  utcSeconds: number;
  /** UTC offset in quarter-hours; Toronto daylight time is -16. */
  timezoneQuarterHours: number;
  /** COROS language code (English is 1 in the Android client). */
  language: number;
  /** 0 for 12-hour and 1 for 24-hour display, as configured on the account. */
  timeFormat: 0 | 1;
  /** COROS length-unit enum; this is supplied by the persisted mobile profile. */
  metricInch: 0 | 1;
  activate: 0 | 1;
  defaultMap: 0 | 1;
  /**
   * The Android structure calls this `temp_reverse`. The captured PACE Pro
   * bind has a non-zero value, so it must be supplied by a verified session
   * profile rather than assumed to be reserved zero bits.
   */
  temperatureReserved: number;
  /** Opaque device-settings word from the verified mobile configuration. */
  customInfo: number;
  /** The first bind packet is explicitly a check command. */
  checkCommand?: boolean;
  /** POD devices append a bind count. PACE Pro must leave this unset. */
  bondCount?: number;
}

export interface CorosV2ControlFrameOptions {
  /** ATT payload limit used by the protocol, normally 20 until bind reports MTU. */
  maximumWriteBytes?: number;
  /** V2 enables this before SystemBind; checksums cover the unframed payload only. */
  includeChecksum?: boolean;
}

export interface CorosSystemBindAuth {
  /**
   * Per-account/device data produced by a live official-session provider.
   * This is not an archive asset and must never be captured, persisted, or
   * replayed by CorosLink.
   */
  compressedData: Uint8Array;
}

export interface CorosV2ControlMessage {
  opcode: number;
  /** Logical protocol payload, with the optional additive checksum removed. */
  payload: Uint8Array;
  checksumVerified: boolean;
}

function assertUnsignedInteger(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label} must be an unsigned integer from 0 to ${maximum}.`);
  }
}

function assertBit(value: number, label: string): void {
  if (value !== 0 && value !== 1) {
    throw new Error(`${label} must be either 0 or 1.`);
  }
}

function writeUint32Le(bytes: Uint8Array, offset: number, value: number): void {
  assertUnsignedInteger(value, 0xffffffff, "The COROS 32-bit field");
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = Math.floor(value / 0x1000000) & 0xff;
}

/**
 * CRC-32/MPEG-2: init FFFFFFFF, polynomial 04C11DB7, no reflection and no
 * final XOR.  The Android client applies it to the eight-byte little-endian
 * representation of the decimal account ID.
 */
export function crc32Mpeg2(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc ^ (byte << 24)) >>> 0;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x80000000) !== 0 ? ((crc << 1) ^ CRC32_MPEG2_POLYNOMIAL) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

/**
 * Produces the normal four-byte, little-endian SystemBind account token.
 * It is an account-derived identifier, not an authentication secret.  The
 * caller must still keep the account ID within the main process.
 */
export function deriveCorosSystemBondId(accountUserId: string): Uint8Array {
  if (!/^\d+$/.test(accountUserId)) {
    throw new Error("The COROS account ID must be a non-empty decimal integer.");
  }
  const userId = BigInt(accountUserId);
  if (userId > 0xffffffffffffffffn) {
    throw new Error("The COROS account ID exceeds the 64-bit SystemBind field.");
  }

  const accountBytes = new Uint8Array(8);
  let remainder = userId;
  for (let index = 0; index < accountBytes.length; index += 1) {
    accountBytes[index] = Number(remainder & 0xffn);
    remainder >>= 8n;
  }

  const crc = crc32Mpeg2(accountBytes);
  const bondId = new Uint8Array(4);
  writeUint32Le(bondId, 0, crc);
  return bondId;
}

/**
 * Serializes the 17-byte PACE Pro SystemBind request payload.  The four
 * one-bit display fields and the `temp_reverse` nibble share byte 11;
 * the check flag is bit seven of byte 16.
 */
export function createCorosSystemBindPayload(options: CorosSystemBindOptions): Uint8Array {
  assertUnsignedInteger(options.utcSeconds, 0xffffffff, "utcSeconds");
  if (!Number.isSafeInteger(options.timezoneQuarterHours) || options.timezoneQuarterHours < -128 || options.timezoneQuarterHours > 127) {
    throw new Error("timezoneQuarterHours must fit in a signed 8-bit field.");
  }
  assertUnsignedInteger(options.language, 0xff, "language");
  assertBit(options.timeFormat, "timeFormat");
  assertBit(options.metricInch, "metricInch");
  assertBit(options.activate, "activate");
  assertBit(options.defaultMap, "defaultMap");
  assertUnsignedInteger(options.temperatureReserved, 0x0f, "temperatureReserved");
  assertUnsignedInteger(options.customInfo, 0xffffffff, "customInfo");
  if (options.bondCount !== undefined) assertUnsignedInteger(options.bondCount, 0xff, "bondCount");

  const payload = new Uint8Array(COROS_SYSTEM_BIND_PAYLOAD_BYTES + (options.bondCount === undefined ? 0 : 1));
  payload[0] = 0x01; // Android; the legacy client uses 0 for iOS.
  payload.set(deriveCorosSystemBondId(options.accountUserId), 1);
  writeUint32Le(payload, 5, options.utcSeconds);
  payload[9] = options.timezoneQuarterHours & 0xff;
  payload[10] = options.language;
  payload[11] =
    options.timeFormat |
    (options.metricInch << 1) |
    (options.activate << 2) |
    (options.defaultMap << 3) |
    (options.temperatureReserved << 4);
  writeUint32Le(payload, 12, options.customInfo);
  payload[16] = options.checkCommand === false ? 0x00 : 0x80;
  if (options.bondCount !== undefined) payload[17] = options.bondCount;
  return payload;
}

/**
 * Builds the second, authenticated PACE Pro SystemBind payload. The official
 * client sends this only after the initial 17-byte bind has been accepted:
 *
 *   base bind (17) | protocol metadata (8) | live auth data (268)
 *
 * The resulting 293-byte payload becomes the observed `A5 01` 240-byte plus
 * `A5 00` 58-byte wire pair when framed with the normal checksum and a
 * negotiated 240-byte protocol write size.
 */
export function createCorosAuthenticatedSystemBindPayload(
  options: CorosSystemBindOptions,
  auth: CorosSystemBindAuth
): Uint8Array {
  if (options.bondCount !== undefined) {
    throw new Error("Authenticated SystemBind is currently defined for non-POD PACE Pro payloads only.");
  }
  if (auth.compressedData.length !== COROS_SYSTEM_BIND_AUTH_COMPRESSED_BYTES) {
    throw new Error(
      `COROS authenticated SystemBind requires ${COROS_SYSTEM_BIND_AUTH_COMPRESSED_BYTES} bytes of live auth data.`
    );
  }

  const base = createCorosSystemBindPayload(options);
  const payload = new Uint8Array(
    base.length + COROS_SYSTEM_BIND_AUTH_METADATA.length + auth.compressedData.length
  );
  payload.set(base, 0);
  payload.set(COROS_SYSTEM_BIND_AUTH_METADATA, base.length);
  payload.set(auth.compressedData, base.length + COROS_SYSTEM_BIND_AUTH_METADATA.length);
  return payload;
}

/** Additive checksum used by protocol-v2 once the bind response enables it. */
export function corosV2Checksum(bytes: Uint8Array): number {
  let checksum = 0;
  for (const byte of bytes) checksum = (checksum + byte) & 0xff;
  return checksum;
}

/**
 * Frames one protocol-v2 control payload exactly like Android's GattCallbackV2:
 * `[opcode, remaining-frame-count, fragment...]`.  The additive checksum, if
 * enabled, is appended to the logical payload's final frame only.
 */
export function createCorosV2ControlFrames(
  opcode: number,
  payload: Uint8Array,
  options: CorosV2ControlFrameOptions = {}
): Uint8Array[] {
  assertUnsignedInteger(opcode, 0xff, "opcode");
  const maximumWriteBytes = options.maximumWriteBytes ?? COROS_V2_DEFAULT_WRITE_BYTES;
  if (!Number.isSafeInteger(maximumWriteBytes) || maximumWriteBytes < 3 || maximumWriteBytes > 0xff) {
    throw new Error("maximumWriteBytes must be an integer from 3 to 255.");
  }

  const includeChecksum = options.includeChecksum ?? true;
  const logicalPayload = new Uint8Array(payload.length + (includeChecksum ? 1 : 0));
  logicalPayload.set(payload);
  if (includeChecksum) logicalPayload[logicalPayload.length - 1] = corosV2Checksum(payload);

  const dataPerFrame = maximumWriteBytes - 2;
  const frameCount = Math.max(1, Math.ceil(logicalPayload.length / dataPerFrame));
  if (frameCount > 0x100) {
    throw new Error("The protocol-v2 message exceeds the 8-bit frame-count field.");
  }

  const frames: Uint8Array[] = [];
  for (let frameIndex = 0, offset = 0; frameIndex < frameCount; frameIndex += 1) {
    const remaining = frameCount - frameIndex - 1;
    const chunk = logicalPayload.subarray(offset, Math.min(offset + dataPerFrame, logicalPayload.length));
    const frame = new Uint8Array(2 + chunk.length);
    frame[0] = opcode;
    frame[1] = remaining;
    frame.set(chunk, 2);
    frames.push(frame);
    offset += chunk.length;
  }
  return frames;
}

/**
 * Validates and reassembles a complete protocol-v2 control message. This is
 * deliberately strict about the descending continuation count so a stale or
 * interleaved notification can never be mistaken for a valid bind response.
 */
export function decodeCorosV2ControlFrames(
  frames: readonly Uint8Array[],
  options: Pick<CorosV2ControlFrameOptions, "includeChecksum"> = {}
): CorosV2ControlMessage {
  if (frames.length === 0) {
    throw new Error("Cannot decode an empty COROS protocol-v2 frame sequence.");
  }

  const opcode = frames[0]![0];
  if (opcode === undefined) {
    throw new Error("A COROS protocol-v2 frame is missing its opcode.");
  }

  let byteLength = 0;
  for (const [index, frame] of frames.entries()) {
    if (frame.length < 2) {
      throw new Error("A COROS protocol-v2 frame must include an opcode and continuation count.");
    }
    if (frame[0] !== opcode) {
      throw new Error("COROS protocol-v2 frames with different opcodes cannot be reassembled together.");
    }
    const expectedRemaining = frames.length - index - 1;
    if (frame[1] !== expectedRemaining) {
      throw new Error(
        `COROS protocol-v2 frame ${index + 1} has continuation count ${frame[1]}, expected ${expectedRemaining}.`
      );
    }
    byteLength += frame.length - 2;
  }

  const logicalPayload = new Uint8Array(byteLength);
  let offset = 0;
  for (const frame of frames) {
    logicalPayload.set(frame.subarray(2), offset);
    offset += frame.length - 2;
  }

  const includeChecksum = options.includeChecksum ?? true;
  if (!includeChecksum) {
    return { opcode, payload: logicalPayload, checksumVerified: false };
  }
  if (logicalPayload.length === 0) {
    throw new Error("A checksummed COROS protocol-v2 message is missing its checksum byte.");
  }

  const payload = logicalPayload.subarray(0, logicalPayload.length - 1);
  const actualChecksum = logicalPayload[logicalPayload.length - 1]!;
  const expectedChecksum = corosV2Checksum(payload);
  if (actualChecksum !== expectedChecksum) {
    throw new Error(
      `COROS protocol-v2 checksum mismatch (received ${actualChecksum}, expected ${expectedChecksum}).`
    );
  }
  return { opcode, payload: payload.slice(), checksumVerified: true };
}
