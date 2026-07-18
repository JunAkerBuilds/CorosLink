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
  "[watchface_id]=0",
  "[background_icon]=background.png",
  "[time_hour_high_pos]={524,234}",
  "[time_hour_high_font]=01",
  "[time_hour_low_pos]={621,234}",
  "[time_hour_low_font]=01",
  "[english_date_week_rect]={520,120,667,187,hcenter|vcenter}",
  "[english_date_week_font]=english_week",
  "[battery_icon_pos]={94,80}",
  "[battery_icon_dir]=battery",
  "[control_battery_icon_dir]=battery",
  "[control_step_icon]=icon\\step.png",
  "[control_step_icon_pos]={526,536}",
  "[empty_value]="
].join("\r\n");

const FIXTURE_AOD_CONFIG = [
  "[watchface_id]=0x00000026",
  "[background_icon]=background.png",
  "[weather_icon_pos]=",
  "[weather_icon_dir]=",
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
    { name: "watchface_800x800/AODconfig.txt", data: Buffer.from(FIXTURE_AOD_CONFIG) },
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
    fixtureEntries.push({
      name: `watchface_800x800/battery/0${digit}.png`,
      data: sourceIcon
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
    designSprites: [{
      id: "sprite-1",
      dataUrl: pngDataUrl(icon),
      sourceWidth: 4,
      sourceHeight: 4,
      width: 40,
      height: 40,
      x: 200,
      y: 220,
      scale: 1,
      rotation: 12,
      opacity: 0.8,
      flipX: true,
      flipY: false,
      skewX: 8,
      skewY: -4,
      aspectLocked: false,
      crop: { x: 0.1, y: 0.2, width: 0.7, height: 0.6 },
      origin: { x: 0.25, y: 0.75 }
    }],
    backgroundElements: [{
      id: "shape-1",
      kind: "ellipse",
      x: 400,
      y: 400,
      rotation: 0,
      visible: false,
      opacity: 0.35,
      width: 120,
      height: 80,
      fill: "#51e0b5"
    }],
    editorGroups: [{ id: "group-1", name: "Time artwork", layerIds: ["hours", "sprite:sprite-1"] }],
    linkedLayerGroups: [["hours", "sprite:sprite-1"]],
    editorGuides: [{ id: "guide-1", axis: "x", position: 400 }],
    lockedLayerIds: ["sprite:sprite-1"],
    effectStyles: [{
      id: "effect-style-1",
      name: "Soft lift",
      effects: [{ id: "shadow-1", kind: "outer-shadow", enabled: true, color: "#000000", opacity: 0.45, blur: 12, spread: 2, distance: 8, angle: 45 }]
    }],
    layerEffects: { hours: { kind: "style", styleId: "effect-style-1" } }
  };
  const portableProjectPath = path.join(tempRoot, "editable-website-face.zip");
  await watchfaces.exportCorosWatchfaceProject(
    {
      sourceArchiveId: starter.archiveId,
      name: "Editable website face",
      firmwareType: "COROS W332",
      design: projectDesign,
      previewDataUrl: pngDataUrl(icon)
    },
    portableProjectPath
  );
  const importedPortableProject =
    await watchfaces.selectCorosWatchfaceArchive(portableProjectPath);
  assert.equal(importedPortableProject.sourceTemplateId, "250601");
  assert.equal(importedPortableProject.firmwareType, "COROS W332");
  assert.equal(
    importedPortableProject.editableProject.name,
    "Editable website face"
  );
  assert.deepEqual(
    importedPortableProject.editableProject.design,
    projectDesign,
    "website ZIP imports should restore the complete editable design state"
  );
  assert.equal(
    (await watchfaces.describeCorosWatchfaceTemplate(
      importedPortableProject.archiveId
    )).resolutions.length,
    1,
    "an imported editable project should retain its original starter template"
  );
  const savedProject = await watchfaces.saveCorosWatchfaceProject({
    name: "Saved creator fixture",
    sourceArchiveId: starter.archiveId,
    design: projectDesign
  });
  assert.equal(savedProject.name, "Saved creator fixture");
  assert.equal(savedProject.archive.sourceTemplateId, "250601");
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
  const nestedProjectStarter = path.join(
    app.getPath("userData"),
    "watchface-projects",
    savedProject.projectId,
    "starter.dat"
  );
  await fs.writeFile(
    nestedProjectStarter,
    createStoreZip([
      ...fixtureEntries.map((entry) => ({
        name: `starter/${entry.name}`,
        data: entry.data
      })),
      { name: "__MACOSX/starter/._info.json", data: Buffer.from("metadata") },
      { name: "starter/.DS_Store", data: Buffer.from("metadata") }
    ])
  );
  const loadedProject = await watchfaces.loadCorosWatchfaceProject(
    savedProject.projectId
  );
  assert.equal(loadedProject.archive.sourceTemplateId, "250601");
  assert.equal(loadedProject.design.backgroundColor, "#123456");
  const repairedProjectZip = await unzipper.Open.file(nestedProjectStarter);
  assert.ok(
    repairedProjectZip.files.some((entry) => entry.path === "info.json"),
    "a Finder-wrapped project starter should be flattened automatically"
  );
  assert.equal(
    repairedProjectZip.files.some((entry) => entry.path.startsWith("starter/")),
    false
  );
  await fs.access(`${nestedProjectStarter}.nested-backup`);
  const legacyProjectStarter = path.join(
    path.dirname(nestedProjectStarter),
    "starter.zip"
  );
  await fs.rename(nestedProjectStarter, legacyProjectStarter);
  const legacyLoadedProject = await watchfaces.loadCorosWatchfaceProject(
    savedProject.projectId
  );
  assert.equal(legacyLoadedProject.archive.fileName, "starter.zip");
  assert.equal(
    legacyLoadedProject.archive.sourceTemplateId,
    "250601",
    "projects saved with the legacy starter.zip filename should remain readable"
  );
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
  assert.equal(resolution.aodConfig.weather_icon_pos, "");
  assert.equal(resolution.aodConfig.weather_icon_dir, "");

  const digitFolder = resolution.spriteFolders.find((folder) => folder.folder === "01");
  assert.ok(digitFolder, "digit sprite folder should be discovered");
  assert.equal(digitFolder.kind, "digits");
  assert.equal(digitFolder.aod, false);
  assert.equal(digitFolder.files.length, 10);
  assert.deepEqual(
    { width: digitFolder.files[0].width, height: digitFolder.files[0].height },
    { width: 12, height: 20 }
  );

  const batteryFolder = resolution.spriteFolders.find(
    (folder) => folder.folder === "battery"
  );
  assert.ok(batteryFolder, "battery state folder should be discovered");
  assert.equal(batteryFolder.kind, "state");
  assert.equal(batteryFolder.files.length, 10);

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
  const configuredBackground = resolution.icons.find(
    (entry) => entry.path === "watchface_800x800/background.png"
  );
  assert.ok(
    configuredBackground,
    "PNG files referenced directly by config or AODconfig should be discoverable"
  );
  assert.equal(
    resolution.icons.filter(
      (entry) => entry.path === "watchface_800x800/background.png"
    ).length,
    1,
    "A PNG shared by config and AODconfig should only be described once"
  );

  // --- Template asset export ---------------------------------------------
  const [stepAsset] = await watchfaces.loadCorosWatchfaceTemplateAssets(
    starter.archiveId,
    ["watchface_800x800/icon/step.png"]
  );
  assert.ok(stepAsset.dataUrl.startsWith("data:image/png;base64,"));
  assert.equal(stepAsset.width, 16);
  const [backgroundAsset] = await watchfaces.loadCorosWatchfaceTemplateAssets(
    starter.archiveId,
    ["watchface_800x800/background.png"]
  );
  assert.ok(
    backgroundAsset.dataUrl.startsWith("data:image/png;base64,"),
    "Studio should be able to load the starter template background as artwork"
  );
  assert.ok(backgroundAsset.width > 0 && backgroundAsset.height > 0);
  await assert.rejects(
    watchfaces.loadCorosWatchfaceTemplateAssets(starter.archiveId, ["missing.png"]),
    /does not contain/
  );

  // --- Background-only creation (legacy behavior) -------------------------
  const created = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon)
  });

  assert.equal(created.sourceTemplateId, "250601");
  assert.equal(created.diyVersion, 1);
  assert.equal(created.watchFaceVersion, 0);
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

  // --- Watch-face ID override rewrites current + AOD configs --------------
  const withWatchfaceId = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    watchfaceIdOverride: "0x3B9ACE60"
  });
  const withWatchfaceIdOutput = await findCreatorOutput(withWatchfaceId);
  assert.ok(withWatchfaceIdOutput, "watch-face ID override output should exist");
  const withWatchfaceIdZip = await unzipper.Open.file(withWatchfaceIdOutput.path);
  for (const configPath of [
    "watchface_800x800/config.txt",
    "watchface_800x800/AODconfig.txt"
  ]) {
    const entry = withWatchfaceIdZip.files.find(
      (file) => file.type === "File" && file.path === configPath
    );
    assert.ok(entry, `${configPath} should remain after watch-face ID override`);
    const text = (await entry.buffer()).toString("utf8");
    assert.match(
      text,
      /^\[watchface_id\]=0x3B9ACE60\r?$/m,
      `${configPath} must receive the watch-face ID override`
    );
  }

  // --- Full-file config text replacements (Studio raw editor) -------------
  const editedAodText = [
    "[watchface_id]=0x11111111",
    "[background_icon]=background.png",
    "// studio edited aod",
    "[empty_value]="
  ].join("\r\n");
  const withConfigText = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    configTextReplacements: [
      {
        path: "watchface_800x800/AODconfig.txt",
        text: editedAodText
      }
    ],
    configOverrides: [
      {
        path: "watchface_800x800/AODconfig.txt",
        values: { watchface_id: "0x22222222" }
      }
    ]
  });
  const withConfigTextOutput = await findCreatorOutput(withConfigText);
  assert.ok(withConfigTextOutput, "config text replacement output should exist");
  const withConfigTextZip = await unzipper.Open.file(withConfigTextOutput.path);
  const editedAodEntry = withConfigTextZip.files.find(
    (file) =>
      file.type === "File" && file.path === "watchface_800x800/AODconfig.txt"
  );
  assert.ok(editedAodEntry, "AODconfig.txt should remain after text replacement");
  const exportedAodText = (await editedAodEntry.buffer()).toString("utf8");
  assert.match(
    exportedAodText,
    /studio edited aod/,
    "full-file AODconfig replacement must preserve comments from the edited text"
  );
  assert.match(
    exportedAodText,
    /^\[watchface_id\]=0x22222222\r?$/m,
    "structured overrides must still apply on top of replaced AODconfig text"
  );

  // --- APEX 4 / W541 multi-resolution export -----------------------------
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      firmwareType: "COROS W999",
      watchModel: "apex-4"
    }),
    /requires 240×240 and 260×260 exports/,
    "APEX exports must reject AMOLED/800-only starter archives regardless of firmware ID"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      minWatchFaceVersion: 4,
      watchFaceVersion: 3
    }),
    /version 3 is too low.*version 4 or newer/,
    "an explicit archive version must satisfy feature-required minimums"
  );

  const apexEntries = [
    {
      name: "info.json",
      data: Buffer.from(
        JSON.stringify({
          o_template_id: 120061,
          o_diy_version: 1,
          o_wf_ver: 0
        })
      )
    },
    { name: "watchface_customize.png", data: solidPng(800, 800, 0x11) }
  ];
  for (const size of [240, 260, 800]) {
    const thumbnailSize = size === 240 ? 182 : size === 260 ? 197 : 800;
    apexEntries.push(
      {
        name: `watchface_${size}x${size}/config.txt`,
        data: Buffer.from(FIXTURE_CONFIG)
      },
      {
        name: `watchface_${size}x${size}/background.png`,
        data: solidPng(size, size, 0x22)
      },
      {
        name: `watchface_${size}x${size}/thmb.png`,
        data: solidPng(thumbnailSize, thumbnailSize, 0x33)
      },
      {
        name: `watchface_${size}x${size}/watchface_customize.png`,
        data: solidPng(800, 800, 0x44)
      }
    );
  }
  const apexSourcePath = path.join(tempRoot, "apex-4-starter.dat");
  await fs.writeFile(apexSourcePath, createStoreZip(apexEntries));
  const apexStarter = await watchfaces.selectCorosWatchfaceArchive(apexSourcePath);
  const apexCreated = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: apexStarter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    previewDataUrl: pngDataUrl(solidPng(800, 800, 0xff)),
    firmwareType: "COROS W999",
    watchModel: "apex-4",
    watchFaceVersion: 2,
    assetReplacements: [
      {
        path: "watchface_240x240/cl_hh/00.png",
        dataUrl: pngDataUrl(solidPng(8, 12, 0x55)),
        create: true
      }
    ]
  });
  assert.equal(apexCreated.firmwareType, "COROS W999");
  assert.equal(apexCreated.resolutionProfile, "mip-240-260-800");
  assert.equal(apexCreated.watchFaceVersion, 2);
  const apexOutput = await findCreatorOutput(apexCreated);
  assert.ok(apexOutput, "APEX 4 output should be available for verification");
  const apexZip = await unzipper.Open.file(apexOutput.path);
  const apexInfo = apexZip.files.find(
    (entry) => entry.type === "File" && entry.path === "info.json"
  );
  assert.ok(apexInfo, "APEX 4 export should retain info.json");
  assert.equal(JSON.parse((await apexInfo.buffer()).toString("utf8")).o_wf_ver, 2);
  const apexRootPreview = apexZip.files.find(
    (entry) => entry.type === "File" && entry.path === "watchface_customize.png"
  );
  const apexMasterBackground = apexZip.files.find(
    (entry) =>
      entry.type === "File" && entry.path === "watchface_800x800/background.png"
  );
  assert.ok(apexRootPreview && apexMasterBackground);
  assert.deepEqual(
    nativeImage.createFromBuffer(await apexRootPreview.buffer()).getSize(),
    { width: 800, height: 800 }
  );
  assert.notDeepEqual(
    await apexRootPreview.buffer(),
    await apexMasterBackground.buffer(),
    "the archive root preview should use the rendered face, not the background-only canvas"
  );
  for (const [entryPath, width, height] of [
    ["watchface_240x240/background.png", 240, 240],
    ["watchface_240x240/thmb.png", 182, 182],
    ["watchface_260x260/background.png", 260, 260],
    ["watchface_260x260/thmb.png", 197, 197],
    ["watchface_800x800/background.png", 800, 800]
  ]) {
    const entry = apexZip.files.find(
      (candidate) => candidate.type === "File" && candidate.path === entryPath
    );
    assert.ok(entry, `${entryPath} should exist in the APEX 4 export`);
    const image = nativeImage.createFromBuffer(await entry.buffer());
    assert.deepEqual(image.getSize(), { width, height });
  }
  assert.ok(
    apexZip.files.some(
      (entry) =>
        entry.type === "File" &&
        entry.path === "watchface_240x240/cl_hh/00.png"
    ),
    "generated Studio sprites should support APEX 4 resolution trees"
  );

  // --- PACE 4 class AMOLED bundles (390px + 800px master) -----------------
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      watchModel: "pace-4"
    }),
    /PACE 4.*requires 390×390 and 800×800 exports.*missing 390x390/,
    "PACE 4 exports must reject templates without the 390px device tree"
  );
  await assert.rejects(
    watchfaces.createCorosWatchfaceArchive({
      sourceArchiveId: starter.archiveId,
      backgroundDataUrl: pngDataUrl(icon),
      firmwareType: "COROS W335"
    }),
    /PACE 4.*requires 390×390 and 800×800 exports.*missing 390x390/,
    "W335 exports must reject templates without the PACE 4 resolution tree"
  );
  const pace4Entries = [
    {
      name: "info.json",
      data: Buffer.from(
        JSON.stringify({
          o_template_id: 130061,
          o_diy_version: 1,
          o_wf_ver: 0
        })
      )
    },
    { name: "watchface_customize.png", data: solidPng(800, 800, 0x11) }
  ];
  for (const size of [390, 800]) {
    const thumbnailSize = size === 390 ? 300 : 800;
    pace4Entries.push(
      {
        name: `watchface_${size}x${size}/config.txt`,
        data: Buffer.from(
          `${FIXTURE_CONFIG}\r\n[time_center_polygon_icon1]=1.png\r\n`
        )
      },
      {
        name: `watchface_${size}x${size}/AODconfig.txt`,
        data: Buffer.from(
          `${FIXTURE_AOD_CONFIG}\r\n[time_center_polygon_icon1]=1.png\r\n`
        )
      },
      {
        name: `watchface_${size}x${size}/background.png`,
        data: solidPng(size, size, 0x22)
      },
      {
        name: `watchface_${size}x${size}/thmb.png`,
        data: solidPng(thumbnailSize, thumbnailSize, 0x33)
      },
      {
        name: `watchface_${size}x${size}/watchface_customize.png`,
        data: solidPng(800, 800, 0x44)
      }
    );
  }
  const pace4SourcePath = path.join(tempRoot, "pace-4-starter.dat");
  await fs.writeFile(pace4SourcePath, createStoreZip(pace4Entries));
  const pace4Starter = await watchfaces.selectCorosWatchfaceArchive(pace4SourcePath);
  const pace4Created = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: pace4Starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    previewDataUrl: pngDataUrl(solidPng(800, 800, 0xff)),
    firmwareType: "COROS W998",
    watchModel: "pace-4",
    assetReplacements: [
      {
        path: "watchface_390x390/cl_hh/00.png",
        dataUrl: pngDataUrl(solidPng(8, 12, 0x55)),
        create: true
      }
    ],
    configOverrides: [390, 800].flatMap((size) =>
      ["config.txt", "AODconfig.txt"].map((fileName) => ({
        path: `watchface_${size}x${size}/${fileName}`,
        values: {
          time_center_polygon_icon1: "__COROSLINK_DELETE_CONFIG_KEY__"
        }
      }))
    )
  });
  assert.equal(pace4Created.resolutionProfile, "amoled-390-800");
  const pace4Output = await findCreatorOutput(pace4Created);
  assert.ok(pace4Output, "PACE 4 output should be available for verification");
  const pace4Zip = await unzipper.Open.file(pace4Output.path);
  for (const [entryPath, width, height] of [
    ["watchface_390x390/background.png", 390, 390],
    ["watchface_390x390/thmb.png", 300, 300],
    ["watchface_800x800/background.png", 800, 800]
  ]) {
    const entry = pace4Zip.files.find(
      (candidate) => candidate.type === "File" && candidate.path === entryPath
    );
    assert.ok(entry, `${entryPath} should exist in the PACE 4 export`);
    const image = nativeImage.createFromBuffer(await entry.buffer());
    assert.deepEqual(image.getSize(), { width, height });
  }
  assert.ok(
    pace4Zip.files.some(
      (entry) =>
        entry.type === "File" &&
        entry.path === "watchface_390x390/cl_hh/00.png"
    ),
    "generated Studio sprites should support the 390px AMOLED tree"
  );
  for (const size of [390, 800]) {
    for (const fileName of ["config.txt", "AODconfig.txt"]) {
      const configEntry = pace4Zip.files.find(
        (entry) =>
          entry.type === "File" &&
          entry.path === `watchface_${size}x${size}/${fileName}`
      );
      assert.ok(
        configEntry,
        `PACE 4 ${size}px ${fileName} should remain in the export`
      );
      assert.doesNotMatch(
        (await configEntry.buffer()).toString("utf8"),
        /^\[time_center_polygon_icon1\]=/m,
        `hidden analog center overlay must be deleted from the PACE 4 ${size}px ${fileName}`
      );
    }
  }

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
  assert.ok(
    generatedSpriteZip.files.findIndex(
      (entry) => entry.path === "watchface_800x800/cl_hh/00.png"
    ) < generatedSpriteZip.files.findIndex(
      (entry) => entry.path === "watchface_800x800/config.txt"
    ),
    "new resource folders must precede their config for COROS's compiler"
  );

  const regeneratedMetricDigit = solidPng(20, 32, 0x71);
  const withRegeneratedSprite = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: withGeneratedSprite.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    assetReplacements: [
      {
        path: "watchface_800x800/cl_hh/00.png",
        dataUrl: pngDataUrl(regeneratedMetricDigit),
        create: true
      }
    ]
  });
  const regeneratedSpriteOutput = await findCreatorOutput(withRegeneratedSprite);
  assert.ok(regeneratedSpriteOutput, "regenerated-sprite output should be available");
  const regeneratedSpriteZip = await unzipper.Open.file(regeneratedSpriteOutput.path);
  const regeneratedSpriteEntries = regeneratedSpriteZip.files.filter(
    (entry) =>
      entry.type === "File" && entry.path === "watchface_800x800/cl_hh/00.png"
  );
  assert.equal(
    regeneratedSpriteEntries.length,
    1,
    "regenerated studio sprites should overwrite instead of creating duplicate ZIP entries"
  );
  assert.deepEqual(
    await regeneratedSpriteEntries[0].buffer(),
    regeneratedMetricDigit,
    "regenerated studio sprites should replace the previous bytes even when dimensions change"
  );

  // --- Weather must be wired into normal and always-on configs ----------
  const withAodWeather = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    configOverrides: [
      {
        path: "watchface_800x800/config.txt",
        values: { weather_icon_pos: "{187,57}", weather_icon_dir: "weather" }
      },
      {
        path: "watchface_800x800/AODconfig.txt",
        values: { weather_icon_pos: "{187,57}", weather_icon_dir: "weather" }
      }
    ]
  });
  const aodWeatherOutput = await findCreatorOutput(withAodWeather);
  assert.ok(aodWeatherOutput, "weather AOD output should be available");
  const aodWeatherZip = await unzipper.Open.file(aodWeatherOutput.path);
  for (const configPath of [
    "watchface_800x800/config.txt",
    "watchface_800x800/AODconfig.txt"
  ]) {
    const configEntry = aodWeatherZip.files.find(
      (entry) => entry.type === "File" && entry.path === configPath
    );
    assert.ok(configEntry, `${configPath} should remain in the archive`);
    const config = (await configEntry.buffer()).toString("utf8");
    assert.ok(config.includes("[weather_icon_pos]={187,57}"));
    assert.ok(config.includes("[weather_icon_dir]=weather"));
  }

  // --- Selectable-control temperature digits and optional config keys ----
  const withTemperature = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    assetReplacements: [
      {
        path: "watchface_800x800/cl_ctemp/00.png",
        dataUrl: pngDataUrl(generatedMetricDigit),
        create: true
      }
    ],
    configOverrides: [
      {
        path: "watchface_800x800/config.txt",
        values: {
          control_temperature_rect: "{67,0,279,67,hcenter|vcenter}",
          control_temperature_font: "cl_ctemp",
          control_temperature_font_color: "0xFFFFFF",
          control_negative_sign_icon: "icon\\negative.png"
        }
      }
    ]
  });
  const temperatureOutput = await findCreatorOutput(withTemperature);
  assert.ok(temperatureOutput, "control-temperature output should be available");
  const temperatureZip = await unzipper.Open.file(temperatureOutput.path);
  const temperatureDigit = temperatureZip.files.find(
    (entry) => entry.type === "File" && entry.path === "watchface_800x800/cl_ctemp/00.png"
  );
  assert.ok(temperatureDigit, "the control-temperature digit folder should be created");
  const temperatureConfigEntry = temperatureZip.files.find(
    (entry) => entry.type === "File" && entry.path === "watchface_800x800/config.txt"
  );
  assert.ok(temperatureConfigEntry, "control-temperature config should remain present");
  const temperatureConfig = (await temperatureConfigEntry.buffer()).toString("utf8");
  assert.ok(temperatureConfig.includes("[control_temperature_font]=cl_ctemp"));
  assert.ok(temperatureConfig.includes("[control_temperature_font_color]=0xFFFFFF"));
  assert.ok(temperatureConfig.includes("[control_negative_sign_icon]=icon\\negative.png"));

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

  // Removing Battery from the selectable control must not delete a state
  // folder still referenced by the fixed battery icon.
  const withoutSelectableBattery = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: pngDataUrl(icon),
    configOverrides: [{
      path: "watchface_800x800/config.txt",
      values: {
        control_battery_icon_dir: "__COROSLINK_DELETE_CONFIG_KEY__"
      }
    }]
  });
  const withoutSelectableBatteryOutput = await findCreatorOutput(
    withoutSelectableBattery
  );
  const withoutSelectableBatteryZip = await unzipper.Open.file(
    withoutSelectableBatteryOutput.path
  );
  const withoutSelectableBatteryConfigEntry =
    withoutSelectableBatteryZip.files.find(
      (entry) => entry.path === "watchface_800x800/config.txt"
    );
  assert.ok(
    withoutSelectableBatteryConfigEntry,
    "the shared-battery output should retain config.txt"
  );
  const withoutSelectableBatteryConfig = (
    await withoutSelectableBatteryConfigEntry.buffer()
  ).toString("utf8");
  assert.doesNotMatch(
    withoutSelectableBatteryConfig,
    /\[control_battery_icon_dir\]/,
    "the selectable Battery config should be removed"
  );
  assert.match(
    withoutSelectableBatteryConfig,
    /\[battery_icon_dir\]=battery/,
    "the fixed battery icon should keep its folder reference"
  );
  assert.ok(
    withoutSelectableBatteryZip.files.some(
      (entry) => entry.path === "watchface_800x800/battery/00.png"
    ),
    "a state folder shared by the fixed battery icon must remain in the archive"
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
