import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { text } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { buildZip } from "./testZip";
import { ZipReader, type ZipEntry } from "./zip";

const temp = () => mkdtempSync(path.join(os.tmpdir(), "clink-zip-"));

async function readAll(file: string) {
  const zip = await ZipReader.open(file);
  try {
    const out: Record<string, string> = {};
    const entries: ZipEntry[] = [];
    for await (const e of zip.entries()) {
      entries.push(e);
      if (!e.directory) out[e.name] = await text(await zip.stream(e, { verify: true }));
    }
    return { out, entries, count: zip.count };
  } finally {
    await zip.close();
  }
}

describe("zip reader (central directory)", () => {
  const files = [
    { name: "map/" },
    { name: "map/VSM/023/S0233300V00.t", data: "tile-a".repeat(50) },
    { name: "map/VSM/023/S0233302V00.t", data: "tile-b".repeat(500), deflate: true },
    { name: "map/empty.t", data: "" },
  ];

  it("reads entries written with data descriptors (no sizes in local headers), stored and deflated", async () => {
    const file = path.join(temp(), "a.zip");
    writeFileSync(file, buildZip(files));
    const { out, entries, count } = await readAll(file);
    expect(count).toBe(4);
    expect(entries[0].directory).toBe(true);
    expect(out["map/VSM/023/S0233300V00.t"]).toBe("tile-a".repeat(50));
    expect(out["map/VSM/023/S0233302V00.t"]).toBe("tile-b".repeat(500));
    expect(out["map/empty.t"]).toBe("");
  });

  it("reads Zip64 directories and Zip64 extra fields", async () => {
    const file = path.join(temp(), "b.zip");
    writeFileSync(file, buildZip(files, { zip64: true }));
    const { out, entries, count } = await readAll(file);
    expect(count).toBe(4);
    expect(entries[1].size).toBe(300);
    expect(entries[2].offset).toBeGreaterThan(0);
    expect(out["map/VSM/023/S0233302V00.t"]).toBe("tile-b".repeat(500));
  });

  it("isn't fooled by an end-of-directory signature inside the comment", async () => {
    const file = path.join(temp(), "c.zip");
    writeFileSync(file, buildZip(files, { comment: "PK\u0005\u0006 not the end" }));
    expect((await readAll(file)).count).toBe(4);
  });

  it("refuses a cut-short file and catches damaged bytes by CRC", async () => {
    const dir = temp();
    const whole = buildZip(files);
    writeFileSync(path.join(dir, "short.zip"), whole.subarray(0, whole.length - 30));
    await expect(ZipReader.open(path.join(dir, "short.zip"))).rejects.toThrow(/complete zip/);

    const broken = Buffer.from(whole);
    const at = broken.indexOf("tile-a");
    broken[at] = "X".charCodeAt(0);
    writeFileSync(path.join(dir, "bad.zip"), broken);
    await expect(readAll(path.join(dir, "bad.zip"))).rejects.toThrow(/damaged/);
  });
});
