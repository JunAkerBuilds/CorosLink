const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { app, nativeImage } = require("electron");
const unzipper = require("unzipper");

const repoRoot = path.resolve(__dirname, "..");
const tempRoot = path.join(os.tmpdir(), `coroslink-watchface-creator-test-${process.pid}`);

async function main() {
  app.setPath("userData", path.join(tempRoot, "user-data"));
  await app.whenReady();

  const { initializeDatabase } = require(path.join(repoRoot, "dist-electron/database.js"));
  const { createStoreZip } = require(path.join(repoRoot, "dist-electron/zipStore.js"));
  const watchfaces = require(path.join(repoRoot, "dist-electron/corosWatchfaceService.js"));
  initializeDatabase(app.getPath("userData"));

  const icon = await fs.readFile(path.join(repoRoot, "build/icon.png"));
  const customBackgroundPixels = Buffer.alloc(8 * 8 * 4);
  for (let index = 0; index < customBackgroundPixels.length; index += 4) {
    customBackgroundPixels[index] = 0;
    customBackgroundPixels[index + 1] = 0;
    customBackgroundPixels[index + 2] = 255;
    customBackgroundPixels[index + 3] = 255;
  }
  const sourceCustomBackground = nativeImage
    .createFromBitmap(customBackgroundPixels, { width: 8, height: 8, scaleFactor: 1 })
    .toPNG();
  const sourcePath = path.join(tempRoot, "starter.dat");
  await fs.mkdir(tempRoot, { recursive: true });
  await fs.writeFile(
    sourcePath,
    createStoreZip([
      {
        name: "info.json",
        data: Buffer.from(JSON.stringify({ o_template_id: 250601, o_diy_version: 1 }))
      },
      { name: "watchface_customize.png", data: icon },
      { name: "watchface_800x800/background.png", data: icon },
      { name: "watchface_800x800/thmb.png", data: icon },
      { name: "custom/custom_bg.png", data: sourceCustomBackground },
      { name: "custom/custom.pb", data: Buffer.from("custom_bg.png") }
    ])
  );

  const starter = await watchfaces.selectCorosWatchfaceArchive(sourcePath);
  const created = await watchfaces.createCorosWatchfaceArchive({
    sourceArchiveId: starter.archiveId,
    backgroundDataUrl: `data:image/png;base64,${icon.toString("base64")}`
  });

  assert.equal(created.sourceTemplateId, 250601);
  assert.equal(created.diyVersion, 1);
  assert.ok(created.sizeBytes > 0);
  assert.notEqual(created.archiveId, starter.archiveId);

  const outputDirectory = path.join(os.tmpdir(), "coroslink-watchface-creator");
  const outputCandidates = await Promise.all(
    (await fs.readdir(outputDirectory)).map(async (name) => {
      const candidatePath = path.join(outputDirectory, name);
      const stat = await fs.stat(candidatePath);
      return { path: candidatePath, stat };
    })
  );
  const output = outputCandidates
    .filter(({ stat }) => stat.isFile() && stat.size === created.sizeBytes)
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)[0];
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
