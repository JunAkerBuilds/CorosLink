const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, nativeImage } = require("electron");
const unzipper = require("unzipper");

const repoRoot = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `coroslink-watchface-creator-test-${process.pid}`);

function solidPng(width, height, value) {
  const pixels = Buffer.alloc(width * height * 4, value);
  return nativeImage
    .createFromBitmap(pixels, { width, height, scaleFactor: 1 })
    .toPNG();
}

function pngDataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function findCreatorOutput(created) {
  const outputDirectory = path.join(app.getPath("userData"), "watchface-archives");
  const candidates = await Promise.all(
    (await fs.readdir(outputDirectory)).map(async (name) => {
      const candidatePath = path.join(outputDirectory, name);
      const stat = await fs.stat(candidatePath);
      return { path: candidatePath, stat };
    })
  );
  return candidates
    .filter(({ stat }) => stat.isFile() && stat.size === created.sizeBytes)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
}

const FIXTURE_CONFIG = [
  "//表盘背景：",
  "[background_icon]=background.png",
  "[time_hour_high_pos]={524,234}",
  "[time_hour_high_font]=01",
  "[time_hour_low_pos]={621,234}",
  "[time_hour_low_font]=01",
  "[english_date_week_rect]={520,120,667,187,hcenter|vcenter}",
  "[english_date_week_font]=english_week",
  "[control_step_icon]=icon\\step.png",
  "[control_step_icon_pos]={526,536}",
  "[empty_value]="
].join("\r\n");

async function main() {
  app.setPath("userData", path.join(tempRoot, "user-data"));
  await app.whenReady();

  const { initializeDatabase } = require(path.join(repoRoot, "dist-electron/database.js"));
  const { createStoreZip } = require(path.join(repoRoot, "dist-electron/zipStore.js"));
  const watchfaces = require(path.join(repoRoot, "dist-electron/corosWatchfaceService.js"));
  initializeDatabase(app.getPath("userData"));

  const icon = await fs.readFile(path.join(repoRoot, "build/icon.png"));
  const sourceCustomBackground = solidPng(8, 8, 0x40);
  const sourceDigit = solidPng(12, 20, 0x80);
  const sourceWeek = solidPng(30, 14, 0x90);
  const sourceIcon = solidPng(16, 16, 0xa0);

  const fixtureEntries = [
    {
      name: "info.json",
      data: Buffer.from(JSON.stringify({ o_template_id: 250601, o_diy_version: 1 }))
    },
    { name: "watchface_customize.png", data: icon },
    { name: "watchface_800x800/config.txt", data: Buffer.from(FIXTURE_CONFIG) },
    { name: "watchface_800x800/background.png", data: icon },
    { name: "watchface_800x800/thmb.png", data: icon },
    { name: "custom/custom_bg.png", data: sourceCustomBackground },
    { name: "custom/custom.pb", data: Buffer.from("custom_bg.png") },
    { name: "watchface_800x800/icon/step.png", data: sourceIcon }
  ];
  for (let digit = 0; digit < 10; digit += 1) {
    fixtureEntries.push({
      name: `watchface_800x800/01/0${digit}.png`,
      data: sourceDigit
    });
  }
  for (let day = 0; day < 7; day += 1) {
    fixtureEntries.push({
      name: `watchface_800x800/english_week/0${day}.png`,
      data: sourceWeek
    });
  }

  const sourcePath = path.join(tempRoot, "starter.dat");
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.writeFile(sourcePath, createStoreZip(fixtureEntries));

  const starter = await watchfaces.selectCorosWatchfaceArchive(sourcePath);

  // --- Persistent editable projects --------------------------------------
  const projectDesign = {
    version: 1,
    backgroundColor: "#081116",
    accentColor: "#51e0b5",
    artwork: null,
    zoom: 1,
    fontFamily: "",
    digitColor: "#ffffff",
    tintLabels: false,
    tintIcons: false,
    previewComplication: "heartRate",
    metricChanges: {},
    metricStyles: {},
    timeStyles: {},
    staticSeparators: {
      colon: { enabled: false, x: 400, y: 300, size: 64, color: "#ffffff" },
      dateSlash: { enabled: false, x: 400, y: 240, size: 48, color: "#ffffff" }
    },
    layoutOffsets: { hours: { dx: 10, dy: 20 } },
    designSprites: []
  };
  const savedProject = await watchfaces.saveCorosWatchfaceProject({
    name: "Saved creator fixture",
    sourceArchiveId: starter.archiveId,
    design: projectDesign
  });
  assert.equal(savedProject.name, "Saved creator fixture");
  assert.equal(savedProject.archive.sourceTemplateId, 250601);
  assert.deepEqual(savedProject.design.layoutOffsets.hours, { dx: 10, dy: 20 });
  const updatedProject = await watchfaces.saveCorosWatchfaceProject({
    projectId: savedProject.projectId,
    name: "Updated creator fixture",
    sourceArchiveId: starter.archiveId,
    design: { ...projectDesign, backgroundColor: "#123456" }
  });
  assert.equal(updatedProject.projectId, savedProject.projectId);
  assert.equal(updatedProject.name, "Updated creator fixture");
  const projectList = await watchfaces.listCorosWatchfaceProjects();
  assert.equal(projectList.some((project) => project.projectId === savedProject.projectId), true);
  const loadedProject = await watchfaces.loadCorosWatchfaceProject(
    savedProject.projectId
  );
  assert.equal(loadedProject.archive.sourceTemplateId, 250601);
  assert.equal(loadedProject.design.backgroundColor, "#123456");
  await watchfaces.deleteCorosWatchfaceProject(savedProject.projectId);
  assert.equal(
    (await watchfaces.listCorosWatchfaceProjects()).some(
      (project) => project.projectId === savedProject.projectId
    ),
    false
  );

  // --- Template introspection -------------------------------------------
  const details = await watchfaces.describeCorosWatchfaceTemplate(starter.archiveId);
  assert.equal(details.archiveId, starter.archiveId);
  assert.equal(details.resolutions.length, 1);
  const resolution = details.resolutions[0];
  assert.equal(resolution.directory, "watchface_800x800");
  assert.equal(resolution.width, 800);
  assert.equal(resolution.config.time_hour_high_font, "01");
  assert.equal(resolution.config.time_hour_high_pos, "{524,234}");
  assert.equal(resolution.config.empty_value, "");
  assert.deepEqual(resolution.aodConfig, {});

  const digitFolder = resolution.spriteFolders.find((folder) => folder.folder === "01");
  assert.ok(digitFolder, "digit sprite folder should be discovered");
  assert.equal(digitFolder.kind, "digits");
  assert.equal(digitFolder.aod, false);
  assert.equal(digitFolder.files.length, 10);
  assert.deepEqual(
    { width: digitFolder.files[0].width, height: digitFolder.files[0].height },
    { width: 12, height: 20 }
  );

  const weekFolder = resolution.spriteFolders.find(
    (folder) => folder.folder === "english_week"
  );
  assert.ok(weekFolder, "week sprite folder should be discovered");
  assert.equal(weekFolder.kind, "week");
  assert.equal(weekFolder.files.length, 7);

  const stepIcon = resolution.icons.find(
    (entry) => entry.path === "watchface_800x800/icon/step.png"
  );
  assert.ok(stepIcon, "step icon should be discovered");
  assert.equal(stepIcon.width, 16);

  // --- Template asset export ---------------------------------------------
  const [stepAsset] = await watchfaces.loadCorosWatchfaceTemplateAssets(
    starter.archiveId,
    ["watchface_800x800/icon/step.png"]
  );
  assert.ok(stepAsset.dataUrl.startsWith("data:image/png;base64,"));
  assert.equal(stepAsset.width, 16);
  await assert.rejects(
    watchfaces.loadCorosWatchfaceTemplateAssets(starter.archiveId, ["missing.png"]),
    /does not contain/
  );

  // --- Background-only creation (legacy behavior) -------------------------
  const created = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon)
  });

  assert.equal(created.sourceTemplateId, 250601);
  assert.equal(created.diyVersion, 1);
  assert.ok(created.sizeBytes > 0);
  assert.notEqual(created.archiveId, starter.archiveId);

  const output = await findCreatorOutput(created);
  assert.ok(output, "creator output should be available for archive verification");
  const generatedZip = await unzipper.Open.file(output.path);
  const generatedCustomBackground = generatedZip.files.find(
    (entry) => entry.type === "File" && entry.path === "custom/custom_bg.png"
  );
  assert.ok(generatedCustomBackground, "custom background should remain in generated archive");
  assert.notDeepEqual(
    await generatedCustomBackground.buffer(),
    sourceCustomBackground,
    "the active custom background should be replaced"
  );

  // --- Full studio creation with sprite replacements ----------------------
  const replacementDigit = solidPng(12, 20, 0xff);
  const replacementIcon = solidPng(16, 16, 0x20);
  const styled = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    assetReplacements: [
      { path: "watchface_800x800/01/03.png", dataUrl: pngDataUrl(replacementDigit) },
      { path: "watchface_800x800/icon/step.png", dataUrl: pngDataUrl(replacementIcon) }
    ]
  });
  const styledOutput = await findCreatorOutput(styled);
  assert.ok(styledOutput, "styled output should be available for verification");
  const styledZip = await unzipper.Open.file(styledOutput.path);
  const styledEntry = async (entryPath) => {
    const entry = styledZip.files.find(
      (candidate) => candidate.type === "File" && candidate.path === entryPath
    );
    assert.ok(entry, `${entryPath} should exist in the styled archive`);
    return entry.buffer();
  };
  assert.deepEqual(
    await styledEntry("watchface_800x800/01/03.png"),
    replacementDigit,
    "the replaced digit sprite should be stored byte-for-byte"
  );
  assert.deepEqual(
    await styledEntry("watchface_800x800/icon/step.png"),
    replacementIcon,
    "the replaced icon sprite should be stored byte-for-byte"
  );
  assert.deepEqual(
    await styledEntry("watchface_800x800/01/04.png"),
    sourceDigit,
    "untouched sprites must remain identical"
  );

  // --- Isolated generated metric sprite folders --------------------------
  const generatedMetricDigit = solidPng(18, 30, 0x70);
  const withGeneratedSprite = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    assetReplacements: [
      {
        path: "watchface_800x800/cl_hh/00.png",
        dataUrl: pngDataUrl(generatedMetricDigit),
        create: true
      }
    ],
    configOverrides: [
      {
        path: "watchface_800x800/config.txt",
        values: { time_hour_high_font: "cl_hh" }
      }
    ]
  });
  const generatedSpriteOutput = await findCreatorOutput(withGeneratedSprite);
  assert.ok(generatedSpriteOutput, "generated-sprite output should be available");
  const generatedSpriteZip = await unzipper.Open.file(generatedSpriteOutput.path);
  const generatedSpriteEntry = generatedSpriteZip.files.find(
    (entry) =>
      entry.type === "File" && entry.path === "watchface_800x800/cl_hh/00.png"
  );
  assert.ok(generatedSpriteEntry, "a generated studio sprite should be added to the archive");
  assert.deepEqual(await generatedSpriteEntry.buffer(), generatedMetricDigit);

  // --- Replacement validation ---------------------------------------------
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      assetReplacements: [
        { path: "watchface_800x800/01/03.png", dataUrl: pngDataUrl(solidPng(10, 10, 0xff)) }
      ]
    }),
    /must be a 12×20 PNG/,
    "dimension mismatches must be rejected"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      assetReplacements: [
        { path: "watchface_800x800/01/99.png", dataUrl: pngDataUrl(replacementDigit) }
      ]
    }),
    /does not exist in the starter template/,
    "unknown template paths must be rejected"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      assetReplacements: [
        {
          path: "watchface_800x800/../escape/00.png",
          dataUrl: pngDataUrl(replacementDigit),
          create: true
        }
      ]
    }),
    /must use a watchface resolution studio folder/,
    "new sprite paths must stay inside a controlled studio folder"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      assetReplacements: [
        { path: "watchface_800x800/background.png", dataUrl: pngDataUrl(replacementDigit) }
      ]
    }),
    /may not target the background/,
    "background paths are reserved for the canvas pipeline"
  );

  // --- Layout overrides (config.txt patching) ------------------------------
  const moved = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    configOverrides: [
      {
        path: "watchface_800x800/config.txt",
        values: {
          time_hour_high_pos: "{554,264}",
          english_date_week_rect: "{550,150,697,217,hcenter|vcenter}"
        }
      }
    ]
  });
  const movedOutput = await findCreatorOutput(moved);
  assert.ok(movedOutput, "moved-layout output should be available for verification");
  const movedZip = await unzipper.Open.file(movedOutput.path);
  const movedConfigEntry = movedZip.files.find(
    (entry) => entry.type === "File" && entry.path === "watchface_800x800/config.txt"
  );
  assert.ok(movedConfigEntry, "config.txt should remain in the moved archive");
  const movedConfig = (await movedConfigEntry.buffer()).toString("utf8");
  assert.ok(
    movedConfig.includes("[time_hour_high_pos]={554,264}"),
    "hour position should be rewritten"
  );
  assert.ok(
    movedConfig.includes("[english_date_week_rect]={550,150,697,217,hcenter|vcenter}"),
    "week rect should be rewritten with its alignment preserved"
  );
  assert.ok(
    movedConfig.includes("[time_hour_low_pos]={621,234}"),
    "untouched keys must keep their original values"
  );
  assert.ok(
    movedConfig.includes("//表盘背景："),
    "comments must be preserved byte-for-byte"
  );
  assert.ok(movedConfig.includes("\r\n"), "the file's CRLF line endings must survive");

  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      configOverrides: [
        {
          path: "watchface_800x800/config.txt",
          values: { not_a_real_key: "{0,0}" }
        }
      ]
    }),
    /does not define: not_a_real_key/,
    "keys missing from the template config must be rejected"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      configOverrides: [
        {
          path: "watchface_800x800/background.png",
          values: { time_hour_high_pos: "{0,0}" }
        }
      ]
    }),
    /must target a template config file/,
    "non-config paths must be rejected"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      configOverrides: [
        {
          path: "watchface_416x416/config.txt",
          values: { time_hour_high_pos: "{0,0}" }
        }
      ]
    }),
    /config file the template does not have/,
    "config paths absent from the archive must be rejected"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      configOverrides: [
        {
          path: "watchface_800x800/config.txt",
          values: { time_hour_high_pos: "{0,0}\n[injected]=1" }
        }
      ]
    }),
    /not valid config syntax/,
    "multi-line values must be rejected"
  );

  console.log("COROS watchface creator archive test passed");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
    app.quit();
  });
