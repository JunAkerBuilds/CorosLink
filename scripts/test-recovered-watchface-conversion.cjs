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
    // Marked as already scanned, so the service converts on these instead of fetching COROS's catalog.
    await fs.writeFile(path.join(cache, `${target.model}.carrier.json`), JSON.stringify({ scanned: true, keys: ["watchface_id", "background_icon"] }));
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
  assert.equal(PNG.sync.read(await pace4Archive.files.get("watchface_390x390/thmb.png").buffer()).width, 160, "The thumbnail comes from the destination carrier");

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

  // The flag never moves a starter that has its 800px master.
  await assert.rejects(service.createCorosWatchfaceArchive({
    sourceArchiveId: diy.archiveId, backgroundDataUrl: dataUrl(416), previewDataUrl: dataUrl(416),
    firmwareType: pace4.firmwareType, watchModel: pace4.model, convertNativeLayout: true
  }), /was selected for COROS W332, not COROS W336/);

  // A COROS-app DIY face carries only its own watch's layout (no 800px
  // master). Asked to convert, it is built and scaled from that layout like a
  // recovered face; unasked, or for its own watch, nothing changes.
  const nativeOnly = [
    { name: "info.json", data: Buffer.from('{"m_app":"watchface_390x390","m_name":"Native","m_preview":"watchface_customize.png","o_author":"someone","o_default_language":"en","o_diy_version":1,"o_template_id":0,"o_wf_ver":0}') },
    { name: "watchface_customize.png", data: png(390) },
    { name: "watchface_390x390/background.png", data: png(390) },
    { name: "watchface_390x390/config.txt", data: Buffer.from("[watchface_id]=0x00000020\r\n[background_icon]=background.png\r\n[time_hour_high_pos]={100,120}\r\n") }
  ];
  const nativePath = path.join(temp, "native-only.dat");
  await fs.writeFile(nativePath, createStoreZip(nativeOnly));
  const native = await savedStarter(nativePath, "COROS W336");
  assert.equal(native.recoveredFromCompiled, undefined);
  assert.deepEqual(await sizesOf(native), [390]);
  const pace4Pro = WATCHFACE_TARGETS.find(target => target.model === "pace-4-pro");
  // The editor's 800px background render, patterned so a resampled copy can't pass for it.
  const render = PNG.sync.write({ width: 800, height: 800, data: Buffer.from(Array.from({ length: 800 * 800 * 4 }, (_, i) => i % 4 === 3 ? 255 : (i * 37) % 251)) });
  const nativeBuild = (target, extra = {}) => service.createCorosWatchfaceArchive({
    sourceArchiveId: native.archiveId, backgroundDataUrl: `data:image/png;base64,${render.toString("base64")}`, previewDataUrl: dataUrl(390),
    firmwareType: target.firmwareType, watchModel: target.model, ...extra
  });
  await assert.rejects(nativeBuild(pace4Pro), /was selected for COROS W336, not COROS W337/, "Without the flag a 390-only face still refuses another watch");
  const ownWatch = async (extra) => nativeBuild(pace4, extra).then(() => "built", (error) => error.message);
  // On its own watch the plain export refuses a 390-only face (PACE 4 exports need 390 and 800); asked,
  // it is built from its own layout, which also gives it the 800px master.
  assert.match(await ownWatch({}), /requires 390×390 and 800×800/, "Unasked, the own-watch export is unchanged");
  const ownBuilt = await nativeBuild(pace4, { convertNativeLayout: true });
  assert.deepEqual(await sizesOf(ownBuilt), [390, 800]);
  const ownScaled = service.parseCorosWatchfaceConfig(await (await read(ownBuilt)).text("watchface_390x390/config.txt"));
  assert.equal(ownScaled.time_hour_high_pos, "{100,120}", "Its own layout keeps its coordinates");
  const nativeConverted = await nativeBuild(pace4Pro, { convertNativeLayout: true });
  assert.equal(nativeConverted.firmwareType, pace4Pro.firmwareType);
  assert.deepEqual(await sizesOf(nativeConverted), [466, 800]);
  const nativeArchive = await read(nativeConverted);
  const nativeScaled = service.parseCorosWatchfaceConfig(await nativeArchive.text("watchface_466x466/config.txt"));
  assert.equal(nativeScaled.time_hour_high_pos, `{${Math.round(100 * 466 / 390)},${Math.round(120 * 466 / 390)}}`, "390 coordinates scale to the destination size");
  assert.equal(service.parseCorosWatchfaceConfig(await nativeArchive.text("watchface_800x800/config.txt")).time_hour_high_pos,
    `{${Math.round(100 * 800 / 390)},${Math.round(120 * 800 / 390)}}`, "The new starter gets an 800px master");
  assert.equal(PNG.sync.read(await nativeArchive.files.get("watchface_466x466/background.png").buffer()).width, 466);
  assert.match(await nativeArchive.text("info.json"), /"m_name":"Native"/, "The face keeps its name");
  assert.match(await nativeArchive.text("info.json"), /"o_author":"someone"/, "A DIY face keeps its own manifest");
  const pixels = (bytes) => { const image = PNG.sync.read(bytes); return [image.width, image.data]; };
  const [masterWidth, masterPixels] = pixels(await nativeArchive.files.get("watchface_800x800/background.png").buffer());
  assert.equal(masterWidth, 800);
  assert(Buffer.compare(masterPixels, pixels(render)[1]) === 0, "The 800px background is the editor's render, not the 390px tree enlarged");

  // A raw 260px MIP face with no watch named: folder sizes can't tell MIP watches apart, so the
  // editor's Convert (which never offers the face's own watch) decides.
  const mipOnly = [
    { name: "info.json", data: Buffer.from('{"m_app":"watchface_260x260","m_name":"Mip","m_preview":"watchface_customize.png","o_default_language":"en","o_diy_version":1,"o_template_id":0,"o_wf_ver":0}') },
    { name: "watchface_customize.png", data: png(260) },
    { name: "watchface_260x260/background.png", data: png(260) },
    { name: "watchface_260x260/config.txt", data: Buffer.from("[watchface_id]=0x00000020\r\n[background_icon]=background.png\r\n[time_hour_high_pos]={60,80}\r\n") }
  ];
  const mipPath = path.join(temp, "mip-only.dat");
  await fs.writeFile(mipPath, createStoreZip(mipOnly));
  const mip260 = await service.selectCorosWatchfaceArchive(mipPath);
  assert.equal(mip260.firmwareType, undefined);
  const apex4 = WATCHFACE_TARGETS.find(target => target.model === "apex-4");
  const mipConverted = await service.createCorosWatchfaceArchive({ sourceArchiveId: mip260.archiveId, backgroundDataUrl: dataUrl(800),
    previewDataUrl: dataUrl(260), firmwareType: apex4.firmwareType, watchModel: apex4.model, convertNativeLayout: true });
  assert.equal(mipConverted.firmwareType, apex4.firmwareType);
  assert.deepEqual(await sizesOf(mipConverted), [...apex4.sizes].sort((a, b) => a - b));
  assert.match(await (await read(mipConverted)).text("info.json"), new RegExp(`"o_template_id":9007199254740${900 + WATCHFACE_TARGETS.indexOf(apex4)}\\b`),
    "Template identity comes from the destination carrier");

  // convertWatchfaceEntries: an AOD only the watch tree carries (with a thinned 800 copy Studio
  // synthesized), AM/PM declared only in the watch tree, and no invented AOD when not wanted.
  {
    const { convertWatchfaceEntries } = require("../dist-electron/watchfaceArchiveConversion.js");
    const pace4Target = WATCHFACE_TARGETS.find(target => target.model === "pace-4");
    const cfg = (text) => Buffer.from(text.replace(/\n/g, "\r\n"));
    const source = [
      { name: "info.json", data: Buffer.from('{"m_name":"Twin","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_template_id":1,"o_diy_version":1,"o_wf_ver":0}') },
      { name: "watchface_customize.png", data: png(800) },
      { name: "watchface_800x800/background.png", data: png(800) },
      { name: "watchface_800x800/config.txt", data: cfg("[watchface_id]=0x00000020\n[background_icon]=background.png\n[time_hour_high_pos]={200,300}\n") },
      // The thinned AOD Studio wrote for 800: positions only.
      { name: "watchface_800x800/AODconfig.txt", data: cfg("[watchface_id]=0x00000020\n[time_hour_high_pos]={200,300}\n") },
      { name: "watchface_416x416/background.png", data: png(416) },
      { name: "watchface_416x416/aod_bg.png", data: png(416) },
      { name: "watchface_416x416/config.txt", data: cfg("[watchface_id]=0x00000021\n[background_icon]=background.png\n[time_hour_high_pos]={104,156}\n[am_pm_icon_pos]=\n[am_icon]=\n[pm_icon]=\n") },
      { name: "watchface_416x416/AODconfig.txt", data: cfg("[watchface_id]=0x00000021\n[background_icon]=aod_bg.png\n[time_hour_high_pos]={104,156}\n") }
    ];
    const carrierEntries = carrier(pace4Target.sizes, "90071992547409950");
    const twin = convertWatchfaceEntries(source, carrierEntries, pace4Target);
    const at = (name) => service.parseCorosWatchfaceConfig(twin.entries.find(entry => entry.name === name).data.toString("utf8"));
    assert.equal(at("watchface_390x390/AODconfig.txt").background_icon, "cl_aod_source/aod_bg.png", "The complete 416 AOD wins over the thinned 800 copy");
    assert.equal(twin.aodDesignScale, 800 / 416, "The AOD design grows by the master's size over the AOD tree's");
    assert.equal(at("watchface_390x390/config.txt").am_icon, "", "AM/PM declared only in the watch tree stays declared");
    const noAod = convertWatchfaceEntries(source.filter(entry => !/AODconfig/.test(entry.name)), carrierEntries, pace4Target, {}, false);
    assert(!noAod.entries.some(entry => /AODconfig\.txt$/.test(entry.name)), "No AOD is invented when not wanted");
    assert.equal(noAod.generatedAod, false);
    const generated = convertWatchfaceEntries(source.filter(entry => !/AODconfig/.test(entry.name)), carrierEntries, pace4Target);
    assert.equal(generated.generatedAod, true, "Studio still creates an editable AOD by default");

    // The largest watch tree declares the colon blank and a smaller one draws it: the value wins over
    // the blank, scaled from the tree that has it, and the image it names travels with it.
    const tiers = [
      ...source.filter(entry => !/AODconfig|416x416\/config/.test(entry.name)),
      { name: "watchface_416x416/config.txt", data: cfg("[watchface_id]=0x00000021\n[background_icon]=background.png\n[colon_icon]=\n") },
      { name: "watchface_260x260/background.png", data: png(260) },
      { name: "watchface_260x260/colon.png", data: png(13) },
      { name: "watchface_260x260/config.txt", data: cfg("[watchface_id]=0x00000022\n[background_icon]=background.png\n[colon_icon]=colon.png\n[colon_icon_pos]={130,65}\n") }
    ];
    const tiered = convertWatchfaceEntries(tiers, carrierEntries, pace4Target);
    const tieredAt = (name) => service.parseCorosWatchfaceConfig(tiered.entries.find(entry => entry.name === name).data.toString("utf8"));
    assert.equal(tieredAt("watchface_390x390/config.txt").colon_icon, "colon.png", "A blank in a larger tree does not hide a smaller tree's value");
    assert.equal(tieredAt("watchface_390x390/config.txt").colon_icon_pos, `{${Math.round(130 * 390 / 260)},${Math.round(65 * 390 / 260)}}`);
    assert(tiered.entries.some(entry => entry.name === "watchface_390x390/colon.png"), "The colon image travels with its key");
  }

  console.log("Recovered watch-face conversion tests passed");
}

main().then(() => app.exit(0), (error) => { console.error(error); app.exit(1); });
