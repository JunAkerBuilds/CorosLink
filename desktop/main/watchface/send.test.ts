import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStoreZip } from "../../watchface/zipStore";
import { getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import { MAX_PREPARED, PickedFolders, PREPARED_TTL_MS, PreparedFaces, safeFileName, saveUnpackedTo, saveZipTo } from "./send";

const watch = getWatchfaceTarget("pace-pro")!;
const archive = createStoreZip([
  { name: "info.json", data: Buffer.from("{}") },
  { name: "watchface_416x416/config.txt", data: Buffer.from("[background_icon]=background.png\r\n") },
]);
const temps: string[] = [];
const temp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "clink-send-")); temps.push(d); return d; };
afterEach(() => { for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("prepared faces", () => {
  it("keeps the 4 most recent for 15 minutes (CorosLink's prepared BINs)", () => {
    let now = 1_000;
    const faces = new PreparedFaces(() => now);
    const made = Array.from({ length: MAX_PREPARED + 1 }, (_, i) => faces.add({ projectId: "p", name: `F${i}`, watch, archive }));
    expect(() => faces.get(made[0].id)).toThrow(/Build the face again/);
    expect(faces.get(made[MAX_PREPARED].id).name).toBe(`F${MAX_PREPARED}`);
    now += PREPARED_TTL_MS + 1;
    expect(() => faces.get(made[MAX_PREPARED].id)).toThrow(/Build the face again/);
  });
});

describe("folders", () => {
  it("knows picked folders only by id", () => {
    const folders = new PickedFolders();
    const { id, label } = folders.add("/Users/someone/Faces");
    expect(label).toBe("Faces");
    expect(folders.path(id)).toBe("/Users/someone/Faces");
    expect(() => folders.path("/Users/someone/Faces")).toThrow(/Choose the folder again/);
  });

  it("saves final ZIPs without overwriting and unpacks a development export", async () => {
    const dir = temp();
    expect(await saveZipTo(dir, "Mint (PACE Pro)", archive)).toBe("Mint (PACE Pro).zip");
    expect(await saveZipTo(dir, "Mint (PACE Pro)", archive)).toBe("Mint (PACE Pro) 2.zip");
    const unpacked = await saveUnpackedTo(dir, "Mint", archive);
    expect(fs.readFileSync(path.join(dir, unpacked, "watchface_416x416", "config.txt"), "utf8")).toContain("background_icon");
  });

  it("refuses paths that leave the folder", async () => {
    const dir = temp();
    const evil = createStoreZip([{ name: "../escape.txt", data: Buffer.from("x") }]);
    await expect(saveUnpackedTo(dir, "Evil", evil)).rejects.toThrow(/unsafe/);
    expect(fs.existsSync(path.join(path.dirname(dir), "escape.txt"))).toBe(false);
  });

  it("cleans names for the file system", () => {
    expect(safeFileName('a/b:c*?"<>|.zip')).toBe("abc.zip");
    expect(safeFileName("...")).toBe("Watch face");
  });
});
