// A recovered official face has only its native tree, so "Convert to another
// watch" bakes the scene by building the final archive for the destination.
// This checks the service accepts a destination watch for recovered starters
// and still refuses one for ordinary templates.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app } = require("electron");
const { PNG } = require("pngjs");

const temp = path.join(os.tmpdir(), `coroslink-recovered-conversion-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));

// Same synthetic 614A face as scripts/test-official-watchface-editor.cjs.
function compiledFixture() {
  const headers = Buffer.alloc(0x1164 * 2);
  for (const base of [0, 0x1164]) {
    headers.write("614A", base); headers.writeUInt16LE(0x1164, base + 0x138); headers[base + 0x13a] = 4;
    headers.writeUInt32LE(42, base + 4);
    for (const offset of [0x1b0, 0x1be, 0x1cc, 0x1da]) {
      headers.writeInt32LE(60 + (offset - 0x1b0) * 2, base + offset); headers.writeInt32LE(base ? 270 : 100, base + offset + 4);
      headers.writeUInt32LE(headers.length, base + offset + 8);
    }
  }
  headers.writeUInt32LE(0x1164, 0x322);
  const palette = Buffer.alloc(1024); palette.set([200, 40, 10, 255], 64); palette.set([3, 70, 110, 128], 4);
  const decoded = Buffer.concat([Buffer.from([1, 16]), palette]);
  const encoded = Buffer.from([...decoded].flatMap(n => n >= 0xc0 ? [0xc1, n] : [n]));
  const bitmap = Buffer.alloc(14 + 10 * 4);
  bitmap.writeUInt16LE(2); bitmap.writeUInt16LE(1, 2); bitmap.writeUInt16LE(0x2002, 4); bitmap[6] = 10; bitmap[7] = 1;
  for (let i = 0; i < 10; i++) bitmap.writeUInt32LE(encoded.length * (i + 1), 14 + i * 4);
  return Buffer.concat([headers, bitmap, ...Array(10).fill(encoded)]);
}

const png = (size) => PNG.sync.write({ width: size, height: size, data: Buffer.alloc(size * size * 4) });
const dataUrl = (size) => `data:image/png;base64,${png(size).toString("base64")}`;

function carrier(sizes, templateId) {
  const entries = [
    { name: "info.json", data: Buffer.from(`{"m_name":"STANDARD","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_default_language":"en","o_template_id":${templateId},"o_diy_version":1,"o_wf_ver":0}`) },
    { name: "watchface_customize.png", data: png(800) }
  ];
  for (const size of sizes) {
    entries.push({ name: `watchface_${size}x${size}/background.png`, data: png(size) },
      { name: `watchface_${size}x${size}/thmb.png`, data: png(160) },
      { name: `watchface_${size}x${size}/config.txt`, data: Buffer.from(`[watchface_id]=0x0000002${sizes.indexOf(size)}\n[background_icon]=background.png\n`) });
  }
  return entries;
}

async function main() {
  await app.whenReady();
  await fs.mkdir(temp, { recursive: true });
  const { initializeDatabase } = require("../dist-electron/database.js");
  initializeDatabase(app.getPath("userData"));
  const service = require("../dist-electron/corosWatchfaceService.js");
  const { createStoreZip } = require("../dist-electron/zipStore.js");
  const { recoverCompiledCorosWatchface } = require("../dist-electron/corosCompiledWatchface.js");
  const { WATCHFACE_TARGETS } = require("../dist-electron/watchfaceTargets.js");
  const unzipper = require("unzipper");

  // Offline carriers: the destination watches' official templates.
  const cache = path.join(app.getPath("userData"), "watchface-conversion-carriers");
  await fs.mkdir(cache, { recursive: true });
  for (const target of WATCHFACE_TARGETS) {
    await fs.writeFile(path.join(cache, `${target.model}.zip`), createStoreZip(carrier(target.sizes, `9007199254740${900 + WATCHFACE_TARGETS.indexOf(target)}`)));
  }

  // Saved projects reopen their starter tagged with the watch it was decoded
  // for, exactly as the editor sees it.
  const savedStarter = async (archivePath, firmwareType) => {
    const chosen = await service.selectCorosWatchfaceArchive(archivePath);
    const saved = await service.saveCorosWatchfaceProject({ name: path.basename(archivePath), sourceArchiveId: chosen.archiveId, firmwareType, design: { version: 1 } });
    return (await service.loadCorosWatchfaceProject(saved.projectId)).archive;
  };
  const recoveredPath = path.join(temp, "recovered.dat");
  await fs.writeFile(recoveredPath, recoverCompiledCorosWatchface(compiledFixture(), "Fixture", "90071992547409931").zip);
  const starter = await savedStarter(recoveredPath, "COROS W332");
  assert.equal(starter.recoveredFromCompiled, true);
  assert.equal(starter.firmwareType, "COROS W332");
  const sizesOf = async (archive) => (await service.describeCorosWatchfaceTemplate(archive.archiveId)).resolutions.map(r => r.width).sort((a, b) => a - b);
  assert.deepEqual(await sizesOf(starter), [416]);
  const nativeConfig = service.parseCorosWatchfaceConfig(
    (await (await unzipper.Open.file(recoveredPath)).files.find(f => f.path === "watchface_416x416/config.txt").buffer()).toString()
  );
  const [nativeX, nativeY] = nativeConfig.time_hour_high_pos.match(/-?\d+/g).map(Number);

  const build = (target) => service.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: dataUrl(416),
    previewDataUrl: dataUrl(416),
    firmwareType: target.firmwareType,
    watchModel: target.model
  });
  // Built archives are private to the service; find the output by size.
  const read = async (archive) => {
    const outputDirectory = path.join(app.getPath("userData"), "watchface-archives");
    const candidates = await Promise.all((await fs.readdir(outputDirectory)).map(async (name) => ({ name, stat: await fs.stat(path.join(outputDirectory, name)) })));
    const output = candidates.filter(({ stat }) => stat.size === archive.sizeBytes).sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
    assert(output, "The built archive exists on disk");
    const directory = await unzipper.Open.file(path.join(outputDirectory, output.name));
    const files = new Map(directory.files.filter(f => f.type === "File").map(f => [f.path, f]));
    return { files, text: async (name) => (await files.get(name).buffer()).toString("utf8") };
  };

  // PACE 4: the 390px tree is scaled straight from the native 416px layout.
  const pace4 = WATCHFACE_TARGETS.find(target => target.model === "pace-4");
  const converted = await build(pace4);
  assert.equal(converted.firmwareType, pace4.firmwareType, "The built archive belongs to the destination watch");
  assert.deepEqual(await sizesOf(converted), [390, 800]);
  assert.equal(converted.recoveredFromCompiled, undefined, "The destination archive is an ordinary editable starter");
  const pace4Archive = await read(converted);
  assert(![...pace4Archive.files.keys()].some(name => name.startsWith("recovery/") || /\.bin$/i.test(name)), "No compiled data travels to the destination");
  const scaled = service.parseCorosWatchfaceConfig(await pace4Archive.text("watchface_390x390/config.txt"));
  assert.equal(scaled.time_hour_high_pos, `{${Math.round(nativeX * 390 / 416)},${Math.round(nativeY * 390 / 416)}}`, "Native coordinates scale directly to the destination size");
  assert.equal(scaled.watchface_id, "0x00000020", "Watch-face identity comes from the destination carrier");
  assert.match(await pace4Archive.text("info.json"), new RegExp(`"o_template_id":9007199254740${900 + WATCHFACE_TARGETS.indexOf(pace4)}\\b`), "Template identity comes from the destination carrier");
  assert.match(await pace4Archive.text("info.json"), /"m_name":"Fixture"/, "The face keeps its name");
  assert.equal(PNG.sync.read(await pace4Archive.files.get("watchface_390x390/background.png").buffer()).width, 390);
  assert.equal(PNG.sync.read(await pace4Archive.files.get("watchface_390x390/thmb.png").buffer()).width, 160);

  // A MIP destination gets every physical size plus the 800px master.
  const nomad = WATCHFACE_TARGETS.find(target => target.model === "nomad");
  const mip = await build(nomad);
  assert.equal(mip.firmwareType, nomad.firmwareType);
  assert.deepEqual(await sizesOf(mip), [...nomad.sizes].sort((a, b) => a - b));

  // The watch model and firmware type must still agree.
  await assert.rejects(service.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId, backgroundDataUrl: dataUrl(416), previewDataUrl: dataUrl(416),
    firmwareType: pace4.firmwareType, watchModel: "nomad"
  }), /do not match/);

  // Ordinary starters are still tied to the watch they were chosen for.
  const diyPath = path.join(temp, "diy.dat");
  await fs.writeFile(diyPath, createStoreZip(carrier([416, 800], "90071992547409940")));
  const diy = await savedStarter(diyPath, "COROS W332");
  assert.equal(diy.recoveredFromCompiled, undefined);
  await assert.rejects(service.createCorosWatchfaceArchive({
    sourceArchiveId: diy.archiveId, backgroundDataUrl: dataUrl(416), previewDataUrl: dataUrl(416),
    firmwareType: pace4.firmwareType, watchModel: pace4.model
  }), /was selected for COROS W332, not COROS W336/);

  console.log("Recovered watch-face conversion tests passed");
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
