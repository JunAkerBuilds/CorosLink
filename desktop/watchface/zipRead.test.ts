import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createStoreZip } from "./zipStore";
import { readZip, unsafeZipPath, ZipError } from "./zipRead";

/** A one-entry ZIP with the entry deflated, the way COROS's packages are. */
function deflatedZip(name: string, data: Buffer): Buffer {
  const body = deflateRawSync(data), n = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(8, 8);
  local.writeUInt32LE(body.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(n.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(8, 10);
  central.writeUInt32LE(body.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(n.length, 28);
  const cdAt = 30 + n.length + body.length;
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(46 + n.length, 12); end.writeUInt32LE(cdAt, 16);
  return Buffer.concat([local, n, body, central, n, end]);
}

describe("reading ZIPs", () => {
  it("reads what the app's own writer stores", () => {
    const zip = createStoreZip([{ name: "info.json", data: Buffer.from("{}") }, { name: "watchface_416x416/config.txt", data: Buffer.from("[watchface_id]=0") }]);
    const entries = readZip(zip);
    expect(entries.map((e) => e.path)).toEqual(["info.json", "watchface_416x416/config.txt"]);
    expect(entries[1].read().toString()).toBe("[watchface_id]=0");
  });
  it("reads deflated entries", () => {
    const text = Buffer.from("x".repeat(5000));
    const [entry] = readZip(deflatedZip("big.txt", text));
    expect(entry.size).toBe(5000);
    expect(entry.compressedSize).toBeLessThan(100);
    expect(entry.read().equals(text)).toBe(true);
  });
  it("refuses what isn't a ZIP and a truncated one", () => {
    expect(() => readZip(Buffer.from("not a zip at all, just some text here"))).toThrow(ZipError);
    const zip = createStoreZip([{ name: "a.txt", data: Buffer.from("hello world") }]);
    const cut = Buffer.concat([zip.subarray(0, 40), zip.subarray(zip.length - 22 - 46 - 5)]);
    expect(() => readZip(cut).map((e) => e.read())).toThrow();
  });
  it("spots names that could escape their folder", () => {
    for (const bad of ["", "/etc/passwd", "a/../../b", "c:\\x", "a\\b", "C:/x", "a\u0001b"]) expect(unsafeZipPath(bad)).toBe(true);
    expect(unsafeZipPath("watchface_416x416/config.txt")).toBe(false);
  });
});
