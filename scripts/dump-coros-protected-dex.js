/*
 * Spawn-time helper for analyzing the COROS Android package protected by
 * NetEase YiDun. It only keeps DEX pages readable long enough for a local
 * code dump; it neither reads app preferences nor intercepts BLE payloads.
 *
 * Invoke with:
 *   frida -U -f com.yf.smart.coros.dist -l scripts/dump-coros-protected-dex.js --runtime=qjs
 */

"use strict";

const pageSize = Process.pageSize;
let preventedProtectionChanges = 0;

function protectionName(value) {
  const names = [];
  if (value & 1) names.push("r");
  if (value & 2) names.push("w");
  if (value & 4) names.push("x");
  return names.join("") || "none";
}

const mprotect = Module.getGlobalExportByName("mprotect");
Interceptor.attach(mprotect, {
  onEnter(args) {
    const requested = args[2].toInt32();
    // YiDun hides the decrypted application DEX by changing its pages to
    // PROT_NONE. Preserve read access only; all other requested bits are
    // unchanged, and no application data is inspected here.
    if (requested === 0) {
      args[2] = ptr(1);
      preventedProtectionChanges += 1;
    }
  }
});

function scanDexHeaders() {
  const findings = [];
  for (const range of Process.enumerateRangesSync({ protection: "r--", coalesce: true })) {
    if (range.size < 0x70) continue;
    try {
      const magic = range.base.readByteArray(8);
      const bytes = new Uint8Array(magic);
      const isDex = bytes[0] === 0x64 && bytes[1] === 0x65 && bytes[2] === 0x78 && bytes[3] === 0x0a;
      if (!isDex) continue;
      const size = range.base.add(0x20).readU32();
      if (size < 0x70 || size > range.size) continue;
      findings.push({ base: range.base, size });
    } catch (_) {
      // Some pages become unreadable between range enumeration and the read.
    }
  }
  return findings;
}

setTimeout(() => {
  const dexFiles = scanDexHeaders();
  console.log(JSON.stringify({
    event: "dex-scan",
    protectedPagesKeptReadable: preventedProtectionChanges,
    dexFiles: dexFiles.map((entry) => ({ base: entry.base.toString(), size: entry.size }))
  }));
}, 2500);
