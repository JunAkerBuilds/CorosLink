const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, nativeImage } = require("electron");
const unzipper = require("unzipper");

const temp = path.join(os.tmpdir(), `coroslink-device-layout-${process.pid}`);
app.setPath("userData", path.join(temp, "user-data"));
const month = "{91,51,120,68,hcenter|vcenter}";
const day = "{45,28,89,74,hcenter|vcenter}";
const config = [
  "// Date positions from the reported PACE 3 face",
  "[watchface_id]=41", "[background_icon]=background.png",
  `[english_date_month_rect]=${month}`, "[english_date_month_font]=cl_date_month",
  `[english_date_day_rect]=${day}`, "[english_date_day_font]=cl_date_day",
  "[english_date_week_rect]={89,35,120,52,hcenter|vcenter}",
  "[french_date_month_rect]={96,52,114,66,hcenter|vcenter}",
  "[french_date_day_rect]={58,44,76,58,hcenter|vcenter}",
  "[time_hour_high_pos]={24,86}"
].join("\r\n") + "\r\n";
const parse = text => Object.fromEntries([...text.matchAll(/^\[([^\]]+)\]=([^\r\n]*)/gm)].map(m => [m[1], m[2]]));
function png(width, height) {
  return nativeImage.createFromBitmap(Buffer.alloc(width * height * 4, 255), { width, height }).toPNG();
}

async function main() {
  await app.whenReady();
  await fs.mkdir(temp, { recursive: true });
  const { createStoreZip } = require("../dist-electron/zipStore.js");
  const { WATCHFACE_TARGETS, getWatchfaceTarget } = require("../dist-electron/watchfaceTargets.js");
  const { finalizeWatchfaceDeviceLayout: finalize, restoreWatchfaceDateLayout: restore } = require("../dist-electron/watchfaceDeviceLayout.js");
  const { initializeDatabase } = require("../dist-electron/database.js");
  initializeDatabase(app.getPath("userData"));
  const service = require("../dist-electron/corosWatchfaceService.js");
  const pace3 = getWatchfaceTarget("pace-3");

  // Preserve CRLF/LF/BOM, per-field alignment, disabled fields, and all assets.
  for (const text of [config, config.replaceAll("\r\n", "\n"), "\uFEFF" + config,
    config.replace(month, "{91,51,120,68,left|top}")]) {
    const entries = [{ name: "watchface_240x240/config.txt", data: Buffer.from(text) },
      { name: "watchface_240x240/AODconfig.txt", data: Buffer.from(text) },
      { name: "watchface_800x800/CorosLinkAODconfig.txt", data: Buffer.from(text) },
      { name: "watchface_customize.png", data: png(20, 20) }];
    const result = finalize(entries, pace3);
    assert.equal(restore(result[0].data.toString()), text);
    assert.equal(restore(text), text, "unmarked starters are already authoring layouts");
    assert.deepEqual(finalize(result, pace3), result, "finalization must be idempotent");
    assert.deepEqual(entries.slice(1), result.slice(1), "AOD and previews stay untouched");
    assert.equal(entries[0].data.toString(), text, "source is immutable");
  }
  for (const text of [config.replace(`[english_date_day_rect]=${day}\r\n`, ""),
    config.replace(`[english_date_month_rect]=${month}`, "[english_date_month_rect]="),
    config + `[english_date_day_rect]=${day}\r\n`]) {
    const entries = [{ name: "watchface_240x240/config.txt", data: Buffer.from(text) }];
    assert.deepEqual(finalize(entries, pace3), entries, "incomplete or ambiguous pairs stay untouched");
  }

  // Real archive builds, including full-file edits followed by structured edits.
  const entries = [
    { name: "info.json", data: Buffer.from('{"o_template_id":260526,"o_diy_version":1,"o_wf_ver":3}') },
    { name: "watchface_customize.png", data: png(80, 80) }
  ];
  for (const size of [240, 260, 280, 390, 416, 466, 800]) {
    const root = `watchface_${size}x${size}`;
    entries.push({ name: `${root}/config.txt`, data: Buffer.from(config) },
      { name: `${root}/background.png`, data: png(size, size) },
      { name: `${root}/thmb.png`, data: png(80, 80) },
      { name: `${root}/AODconfig.txt`, data: Buffer.from(config) });
    for (let i = 0; i < 12; i++) {
      const index = String(i).padStart(2, "0");
      entries.push({ name: `${root}/cl_date_month/${index}.png`, data: png(29, 17) });
      if (i < 10) entries.push({ name: `${root}/cl_date_day/${index}.png`, data: png(22, 46) });
    }
  }
  const sourcePath = path.join(temp, "source.zip");
  const originalBytes = createStoreZip(entries);
  await fs.writeFile(sourcePath, originalBytes);
  const source = await service.selectCorosWatchfaceArchive(sourcePath);
  const backgroundDataUrl = nativeImage.createFromBuffer(png(80, 80)).toDataURL();
  let counter = 0;
  async function readArchive(archive) {
    const destination = path.join(temp, `export-${counter++}.zip`);
    await service.exportCorosWatchfaceArchive(archive.archiveId, destination);
    const zip = await unzipper.Open.file(destination);
    return new Map(await Promise.all(zip.files.filter(f => f.type === "File").map(async f => [f.path, await f.buffer()])));
  }
  const build = input => service.createCorosWatchfaceArchive({ sourceArchiveId: source.archiveId, backgroundDataUrl, ...input });
  let builtPace3, pace3Files, regularPreview;
  for (const target of [...WATCHFACE_TARGETS, undefined]) {
    const built = await build(target ? { firmwareType: target.firmwareType, watchModel: target.model } : {});
    const files = await readArchive(built);
    regularPreview ??= files.get("watchface_customize.png");
    assert.deepEqual(files.get("watchface_customize.png"), regularPreview, "the COROS preview must not show the compensation");
    for (const size of [240, 260, 280, 390, 416, 466, 800]) {
      const root = `watchface_${size}x${size}`;
      const actual = parse(files.get(`${root}/config.txt`).toString());
      assert.equal(actual.english_date_month_rect, target?.model === "pace-3" ? day : month);
      assert.equal(actual.english_date_day_rect, target?.model === "pace-3" ? month : day);
      for (const key of ["english_date_month_font", "english_date_day_font", "english_date_week_rect", "french_date_day_rect", "french_date_month_rect"]) {
        assert.equal(actual[key], parse(config)[key]);
      }
      assert.equal(files.get(`${root}/AODconfig.txt`).toString(), config);
      assert.deepEqual(files.get(`${root}/cl_date_day/02.png`), entries.find(e => e.name === `${root}/cl_date_day/02.png`).data);
    }
    if (target?.model === "pace-3") { builtPace3 = built; pace3Files = files; }
  }
  for (const identity of [{ firmwareType: " coros w331 " }, { watchModel: "pace-3" }]) {
    const files = await readArchive(await build(identity));
    assert.equal(files.get("watchface_240x240/config.txt").toString(), pace3Files.get("watchface_240x240/config.txt").toString());
  }
  await assert.rejects(build({ watchModel: "pace-3", firmwareType: "COROS W332" }), /do not match/);

  const details = await service.describeCorosWatchfaceTemplate(builtPace3.archiveId);
  for (const resolution of details.resolutions) {
    assert.equal(resolution.config.english_date_month_rect, month, "export preview restores editor positions");
    assert.equal(resolution.config.english_date_day_rect, day);
  }
  const rawEditor = await service.loadCorosWatchfaceTemplateConfigTexts(builtPace3.archiveId);
  assert(rawEditor.every(file => file.text === config), "raw editing also uses authoring coordinates");
  const repeated = await readArchive(await build({ sourceArchiveId: builtPace3.archiveId }));
  assert.equal(repeated.get("watchface_240x240/config.txt").toString(), pace3Files.get("watchface_240x240/config.txt").toString(), "rebuilding a generated face swaps exactly once");

  const changed = await readArchive(await build({
    sourceArchiveId: builtPace3.archiveId,
    configTextReplacements: [{ path: "watchface_240x240/config.txt", text: config.replace(day, "{10,20,54,66,hcenter|vcenter}") }],
    configOverrides: [{ path: "watchface_240x240/config.txt", values: { english_date_day_rect: "{30,20,54,40,hcenter|vcenter}" } }]
  }));
  const changedConfig = parse(changed.get("watchface_240x240/config.txt").toString());
  assert.equal(changedConfig.english_date_month_rect, "{20,7,64,53,hcenter|vcenter}", "fit the 44x46 day font before exchanging rectangles");
  assert.equal(changedConfig.english_date_day_rect, month, "never resize the swapped month slot to fit the day font");

  // Newly exported PACE 3 files can become another model's editable source.
  const converted = await service.convertCorosWatchfaceArchive({ sourceArchiveId: builtPace3.archiveId, watchModel: "pace-pro", targetArchiveId: source.archiveId });
  const convertedFiles = await readArchive(converted.archive);
  assert.equal(parse(convertedFiles.get("watchface_800x800/config.txt").toString()).english_date_day_rect, day);
  const proFiles = await readArchive(await build({ sourceArchiveId: converted.archive.archiveId, firmwareType: "COROS W332" }));
  assert.equal(parse(proFiles.get("watchface_800x800/config.txt").toString()).english_date_month_rect, month);

  // Recovered faces get the correction after their final destination resize.
  const cache = path.join(app.getPath("userData"), "watchface-conversion-carriers");
  await fs.mkdir(cache, { recursive: true });
  await fs.writeFile(path.join(cache, "pace-3.zip"), originalBytes);
  const recoveredEntries = entries.filter(e => e.name === "info.json" || e.name === "watchface_customize.png" || e.name.startsWith("watchface_240x240/")).map(e =>
    e.name === "info.json" ? { ...e, data: Buffer.from('{"o_template_id":260526,"o_diy_version":1,"o_wf_ver":3,"coroslinkRecovery":{"partial":true}}') } : e);
  const recoveredPath = path.join(temp, "recovered.zip");
  await fs.writeFile(recoveredPath, createStoreZip(recoveredEntries));
  const recoveredSource = await service.selectCorosWatchfaceArchive(recoveredPath);
  const recoveredFiles = await readArchive(await build({ sourceArchiveId: recoveredSource.archiveId, firmwareType: "COROS W331" }));
  assert.equal(parse(recoveredFiles.get("watchface_240x240/config.txt").toString()).english_date_month_rect, day);
  assert.equal(parse(recoveredFiles.get("watchface_240x240/config.txt").toString()).english_date_day_rect, month);
  assert.deepEqual(await fs.readFile(sourcePath), originalBytes, "builds never rewrite the editor's source archive");
  console.log("PACE 3 date layout: production exports, font sizing, previews, repeat builds, conversion, recovered faces and other models passed.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await fs.rm(temp, { recursive: true, force: true });
  app.exit(process.exitCode ?? 0);
});
