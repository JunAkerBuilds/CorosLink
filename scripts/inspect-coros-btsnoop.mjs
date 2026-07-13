#!/usr/bin/env node
/*
 * Privacy-preserving BTSnoop inspector for a user-owned COROS session.
 *
 * It parses ATT service discovery plus packet metadata, but deliberately
 * never prints, saves, hashes, or otherwise exposes ATT payload bytes. HCI
 * captures can contain per-session authentication data, so pass only local
 * files and share this script's redacted output—not the BTSnoop log itself.
 */
import fs from "node:fs";
import path from "node:path";

const ATT_CID = 0x0004;

const ATT_NAMES = new Map([
  [0x02, "exchange MTU request"],
  [0x03, "exchange MTU response"],
  [0x04, "find information request"],
  [0x05, "find information response"],
  [0x08, "read by type request"],
  [0x09, "read by type response"],
  [0x0a, "read request"],
  [0x0b, "read response"],
  [0x0c, "read blob request"],
  [0x0d, "read blob response"],
  [0x10, "read by group type request"],
  [0x11, "read by group type response"],
  [0x12, "write request"],
  [0x13, "write response"],
  [0x16, "prepare write request"],
  [0x17, "prepare write response"],
  [0x18, "execute write request"],
  [0x19, "execute write response"],
  [0x1b, "notification"],
  [0x1d, "indication"],
  [0x1e, "indication confirmation"],
  [0x52, "write command"]
]);

const CHARACTERISTIC_PROPERTIES = [
  [0x02, "read"],
  [0x04, "write without response"],
  [0x08, "write"],
  [0x10, "notify"],
  [0x20, "indicate"]
];

function usage() {
  console.error(
    "Usage: node scripts/inspect-coros-btsnoop.mjs <btsnoop_hci.log | snapshot-directory> [...]"
  );
}

function expandInputs(inputPaths) {
  const files = [];
  for (const inputPath of inputPaths) {
    const stat = fs.statSync(inputPath);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(inputPath).sort()) {
        const candidate = path.join(inputPath, entry);
        // Snapshot directories also contain a human-readable session.txt.
        // Only their BTSnoop snapshot files have the .log suffix.
        if (entry.endsWith(".log") && fs.statSync(candidate).isFile()) files.push(candidate);
      }
    } else {
      files.push(inputPath);
    }
  }
  return files;
}

function parseBtsnoop(filePath) {
  const bytes = fs.readFileSync(filePath);
  if (bytes.subarray(0, 8).toString("ascii") !== "btsnoop\0") {
    throw new Error(`${filePath} is not a BTSnoop HCI log.`);
  }
  const records = [];
  let offset = 16;
  while (offset + 24 <= bytes.length) {
    const originalLength = bytes.readUInt32BE(offset);
    const includedLength = bytes.readUInt32BE(offset + 4);
    const flags = bytes.readUInt32BE(offset + 8);
    const timestampUs = bytes.readBigUInt64BE(offset + 16);
    const end = offset + 24 + includedLength;
    if (end > bytes.length) break;
    records.push({
      packet: bytes.subarray(offset + 24, end),
      // Android BTSnoop flag bit 0 set means controller → host.
      direction: flags & 1 ? "watch → app" : "app → watch",
      timeUs: timestampUs,
      originalLength,
      source: filePath
    });
    offset = end;
  }
  return records;
}

function deduplicateRecords(records) {
  const seen = new Set();
  const unique = [];
  for (const record of records) {
    // Snapshot files overlap. This key leaves payload bytes in-memory only and
    // never reports them; it simply removes byte-identical repeated records.
    const key = `${record.timeUs}:${record.direction}:${record.packet.toString("base64")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }
  return unique.sort((left, right) => (left.timeUs < right.timeUs ? -1 : left.timeUs > right.timeUs ? 1 : 0));
}

function readU16(bytes, offset) {
  return offset + 2 <= bytes.length ? bytes.readUInt16LE(offset) : undefined;
}

function attUuid(bytes) {
  if (bytes.length === 2) {
    return `0x${bytes.readUInt16LE(0).toString(16).padStart(4, "0")}`;
  }
  if (bytes.length === 16) {
    const hex = Buffer.from(bytes).reverse().toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `unknown UUID (${bytes.length} bytes)`;
}

function characteristicProperties(flags) {
  return CHARACTERISTIC_PROPERTIES
    .filter(([bit]) => flags & bit)
    .map(([, label]) => label);
}

function connectionState(states, handle) {
  let state = states.get(handle);
  if (!state) {
    state = {
      services: [],
      serviceKeys: new Set(),
      attributes: new Map(),
      characteristics: new Map(),
      pendingRequest: undefined,
      activity: new Map(),
      attOpcodeCounts: new Map(),
      l2capCids: new Map()
    };
    states.set(handle, state);
  }
  return state;
}

function addActivity(state, { direction, kind, attributeHandle, payloadBytes }) {
  const key = `${direction}|${kind}|${attributeHandle ?? "none"}`;
  let entry = state.activity.get(key);
  if (!entry) {
    entry = { direction, kind, attributeHandle, count: 0, lengths: new Map() };
    state.activity.set(key, entry);
  }
  entry.count += 1;
  entry.lengths.set(payloadBytes, (entry.lengths.get(payloadBytes) ?? 0) + 1);
}

function recordPendingRequest(state, opcode, pdu) {
  if (opcode === 0x04 || opcode === 0x08 || opcode === 0x10) {
    const startHandle = readU16(pdu, 1);
    const endHandle = readU16(pdu, 3);
    if (startHandle === undefined || endHandle === undefined) return;
    state.pendingRequest = {
      opcode,
      startHandle,
      endHandle,
      type: pdu.length > 5 ? attUuid(pdu.subarray(5)) : undefined
    };
  } else if (opcode === 0x0a || opcode === 0x0c) {
    const attributeHandle = readU16(pdu, 1);
    if (attributeHandle === undefined) return;
    state.pendingRequest = { opcode, attributeHandle };
    addActivity(state, { direction: "app → watch", kind: ATT_NAMES.get(opcode), attributeHandle, payloadBytes: 0 });
  }
}

function parseFindInformation(state, pdu) {
  if (pdu.length < 3) return;
  const format = pdu[1];
  const entryLength = format === 0x01 ? 4 : format === 0x02 ? 18 : 0;
  if (!entryLength) return;
  for (let offset = 2; offset + entryLength <= pdu.length; offset += entryLength) {
    const handle = readU16(pdu, offset);
    if (handle === undefined) continue;
    state.attributes.set(handle, attUuid(pdu.subarray(offset + 2, offset + entryLength)));
  }
}

function parseReadByType(state, pdu, pendingRequest) {
  if (pdu.length < 3 || pendingRequest?.type !== "0x2803") return;
  const entryLength = pdu[1];
  if (entryLength < 7) return;
  for (let offset = 2; offset + entryLength <= pdu.length; offset += entryLength) {
    const declarationHandle = readU16(pdu, offset);
    const valueHandle = readU16(pdu, offset + 3);
    if (declarationHandle === undefined || valueHandle === undefined) continue;
    state.characteristics.set(valueHandle, {
      declarationHandle,
      valueHandle,
      uuid: attUuid(pdu.subarray(offset + 5, offset + entryLength)),
      properties: characteristicProperties(pdu[offset + 2])
    });
  }
}

function parseReadByGroupType(state, pdu, pendingRequest) {
  if (pdu.length < 3 || pendingRequest?.type !== "0x2800") return;
  const entryLength = pdu[1];
  if (entryLength < 6) return;
  for (let offset = 2; offset + entryLength <= pdu.length; offset += entryLength) {
    const startHandle = readU16(pdu, offset);
    const endHandle = readU16(pdu, offset + 2);
    if (startHandle === undefined || endHandle === undefined) continue;
    const service = {
      startHandle,
      endHandle,
      uuid: attUuid(pdu.subarray(offset + 4, offset + entryLength))
    };
    const key = `${service.startHandle}:${service.endHandle}:${service.uuid}`;
    if (!state.serviceKeys.has(key)) {
      state.serviceKeys.add(key);
      state.services.push(service);
    }
  }
}

function inspectAtt(states, connectionHandle, direction, pdu) {
  if (!pdu.length) return;
  const state = connectionState(states, connectionHandle);
  const opcode = pdu[0];
  state.attOpcodeCounts.set(opcode, (state.attOpcodeCounts.get(opcode) ?? 0) + 1);

  if (direction === "app → watch") {
    if (opcode === 0x12 || opcode === 0x52 || opcode === 0x16) {
      const attributeHandle = readU16(pdu, 1);
      addActivity(state, {
        direction,
        kind: ATT_NAMES.get(opcode) ?? `ATT 0x${opcode.toString(16)}`,
        attributeHandle,
        payloadBytes: Math.max(0, pdu.length - 3)
      });
    } else if (opcode === 0x18) {
      addActivity(state, {
        direction,
        kind: ATT_NAMES.get(opcode),
        payloadBytes: Math.max(0, pdu.length - 1)
      });
    }
    recordPendingRequest(state, opcode, pdu);
    return;
  }

  const pendingRequest = state.pendingRequest;
  if (opcode === 0x05) parseFindInformation(state, pdu);
  if (opcode === 0x09) parseReadByType(state, pdu, pendingRequest);
  if (opcode === 0x11) parseReadByGroupType(state, pdu, pendingRequest);
  if (opcode === 0x0b || opcode === 0x0d) {
    addActivity(state, {
      direction,
      kind: ATT_NAMES.get(opcode) ?? `ATT 0x${opcode.toString(16)}`,
      attributeHandle: pendingRequest?.attributeHandle,
      payloadBytes: Math.max(0, pdu.length - 1)
    });
  }
  if (opcode === 0x1b || opcode === 0x1d) {
    const attributeHandle = readU16(pdu, 1);
    addActivity(state, {
      direction,
      kind: ATT_NAMES.get(opcode) ?? `ATT 0x${opcode.toString(16)}`,
      attributeHandle,
      payloadBytes: Math.max(0, pdu.length - 3)
    });
  }
  if ([0x03, 0x05, 0x09, 0x0b, 0x0d, 0x11, 0x13, 0x17, 0x19].includes(opcode)) {
    state.pendingRequest = undefined;
  }
}

function inspectL2cap(states, connectionHandle, direction, channelId, pdu) {
  const state = connectionState(states, connectionHandle);
  state.l2capCids.set(channelId, (state.l2capCids.get(channelId) ?? 0) + 1);
  if (channelId === ATT_CID) inspectAtt(states, connectionHandle, direction, pdu);
}

function processAclRecords(records) {
  const states = new Map();
  const partialL2cap = new Map();
  for (const record of records) {
    const packet = record.packet;
    if (packet.length < 5 || packet[0] !== 0x02) continue;
    const handleAndFlags = packet.readUInt16LE(1);
    const connectionHandle = handleAndFlags & 0x0fff;
    const packetBoundary = (handleAndFlags >> 12) & 0x03;
    const partialKey = `${record.direction}:${connectionHandle}`;
    // HCI ACL packet-boundary values 0x00 (first, non-flushable), 0x02
    // (first, automatically flushable), and 0x03 (complete L2CAP PDU) all
    // begin a new L2CAP payload. Android uses more than one of these forms
    // during GATT discovery; treating only 0x02 as a start silently drops
    // valid service and characteristic declarations.
    if (packetBoundary !== 0x01) {
      partialL2cap.set(partialKey, {
        direction: record.direction,
        connectionHandle,
        buffer: Buffer.from(packet.subarray(5))
      });
    } else if (packetBoundary === 0x01) {
      const partial = partialL2cap.get(partialKey);
      if (!partial) continue;
      partial.buffer = Buffer.concat([partial.buffer, packet.subarray(5)]);
    } else {
      continue;
    }

    const partial = partialL2cap.get(partialKey);
    if (!partial) continue;
    while (partial.buffer.length >= 4) {
      const length = partial.buffer.readUInt16LE(0);
      const totalLength = 4 + length;
      if (partial.buffer.length < totalLength) break;
      const channelId = partial.buffer.readUInt16LE(2);
      inspectL2cap(
        states,
        partial.connectionHandle,
        partial.direction,
        channelId,
        partial.buffer.subarray(4, totalLength)
      );
      partial.buffer = partial.buffer.subarray(totalLength);
    }
    if (partial.buffer.length === 0) partialL2cap.delete(partialKey);
  }
  return states;
}

function describeHandle(state, handle) {
  if (handle === undefined) return "no attribute handle";
  const characteristic = state.characteristics.get(handle);
  const attributeUuid = state.attributes.get(handle);
  const service = [...state.services]
    .sort((left, right) => left.startHandle - right.startHandle)
    .find((candidate) => handle >= candidate.startHandle && handle <= candidate.endHandle);
  const parts = [`handle 0x${handle.toString(16).padStart(4, "0")}`];
  if (characteristic) {
    parts.push(`characteristic ${characteristic.uuid}`);
    if (characteristic.properties.length) parts.push(characteristic.properties.join(", "));
  } else if (attributeUuid) {
    parts.push(`attribute ${attributeUuid}`);
  }
  if (service) parts.push(`service ${service.uuid}`);
  return parts.join(" · ");
}

function formatLengths(lengths) {
  return [...lengths.entries()]
    .sort(([left], [right]) => left - right)
    .map(([length, count]) => `${length} bytes ×${count}`)
    .join(", ");
}

function printState(states) {
  if (!states.size) {
    console.log("No Bluetooth ACL packets were found.");
    return;
  }
  for (const [connectionHandle, state] of states) {
    console.log(`\nConnection h0x${connectionHandle.toString(16).padStart(4, "0")}`);
    console.log("Discovered GATT services:");
    if (!state.services.length) {
      console.log("  No service-discovery response in this capture window.");
    } else {
      for (const service of [...state.services].sort((left, right) => left.startHandle - right.startHandle)) {
        console.log(
          `  ${service.uuid} · handles 0x${service.startHandle.toString(16).padStart(4, "0")}–0x${service.endHandle.toString(16).padStart(4, "0")}`
        );
      }
    }

    console.log("Characteristics discovered in this window:");
    if (!state.characteristics.size) {
      console.log("  No characteristic declarations in this capture window.");
    } else {
      for (const characteristic of [...state.characteristics.values()].sort((left, right) => left.valueHandle - right.valueHandle)) {
        console.log(
          `  ${describeHandle(state, characteristic.valueHandle)}`
        );
      }
    }

    console.log("Observed ATT activity (payload contents redacted):");
    if (!state.activity.size) {
      console.log("  No ATT reads, writes, notifications, or indications were observed.");
    } else {
      for (const entry of [...state.activity.values()].sort((left, right) => right.count - left.count)) {
        console.log(
          `  ${entry.direction} · ${entry.kind} · ${describeHandle(state, entry.attributeHandle)} · events=${entry.count} · payload lengths: ${formatLengths(entry.lengths)}`
        );
      }
    }

    const opcodeSummary = [...state.attOpcodeCounts.entries()]
      .sort(([left], [right]) => left - right)
      .map(([opcode, count]) => `${ATT_NAMES.get(opcode) ?? `ATT 0x${opcode.toString(16)}`} ×${count}`)
      .join(", ");
    console.log(`ATT opcode summary: ${opcodeSummary || "none"}`);
  }
}

const inputPaths = process.argv.slice(2);
if (!inputPaths.length || inputPaths.includes("--help") || inputPaths.includes("-h")) {
  usage();
  process.exit(inputPaths.length ? 0 : 1);
}

const files = expandInputs(inputPaths);
const records = deduplicateRecords(files.flatMap(parseBtsnoop));
console.log(`Inspected ${files.length} local BTSnoop file(s), ${records.length} de-duplicated record(s).`);
console.log("Payload contents are redacted by design.");
printState(processAclRecords(records));
