// Opt-in real editor regression. Inputs are copied from a conversation; never
// opens or mutates the user's project or profile. This is not a fidelity demo.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async function neonFixture({ tool, rawTool, document, temporaryRoot, nativeImage }) {
  const arg = name => process.argv[process.argv.indexOf(name) + 1];
  const reference = await tool('import_asset', { path: arg('--neon-reference') });
  const background = await tool('import_asset', { path: arg('--neon-background') });
  const rejected = await tool('import_asset', { path: arg('--rejected-font') });
  const { WatchfaceAssetReview } = require('../dist-electron/watchfaceAiAssetReview.js');
  const { WatchfaceAiChatStore } = require('../dist-electron/watchfaceAiChatStore.js');
  const { sanitizeWatchfaceAiMemory } = require('../dist-electron/watchfaceAiContext.js');
  const reviews = new WatchfaceAssetReview();
  reviews.register(rejected.assetId, 0, [reference.assetId]);
  reviews.review([{ assetId: rejected.assetId, status: 'rejected', referenceAssetIds: [reference.assetId], comparison: 'Clock atlas has touching glyphs and scratch-like artifacts across the counters and gaps. The reference has clean heavy forward-slanted sans-serif digits.' }], 1);
  const store = new WatchfaceAiChatStore(path.join(temporaryRoot, 'user-data'));
  const memory = { version: 1, entries: [], designReferenceIds: [reference.assetId], assetReviews: reviews.snapshot() };
  const chat = await store.save({ projectKey: "neon-isolated", title: 'Neon recovery regression', messages: [{ role: 'user', content: 'KM, steps, calories and BPM use static full circles; battery uses dynamic sprites. All fonts must match the reference.' }, { role: 'assistant', content: 'Rejected fused atlas; retry individual glyphs.', memory }] });
  const restored = sanitizeWatchfaceAiMemory((await store.load(chat.id)).messages[1].memory);
  const continued = new WatchfaceAssetReview(); continued.restore(restored.assetReviews);
  assert.throws(() => continued.checkCommands({ dataUrl: { assetId: rejected.assetId } }), /rejected/);
  assert.deepEqual(restored.designReferenceIds, [reference.assetId]);

  // Hide the conflicting baked battery circle with a geometric background
  // mask. Four user-requested static circles stay in the original artwork.
  const mask = await tool('render_svg', { width: 212, height: 212, svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 212 212"><circle cx="106" cy="106" r="106" fill="black"/></svg>' });
  const frames = [];
  for (const percent of [0, 50, 100]) {
    frames.push(await tool('render_svg', { width: 192, height: 192, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 192"><circle cx="96" cy="96" r="81" fill="none" stroke="#102311" stroke-width="13"/><circle cx="96" cy="96" r="81" fill="none" stroke="#86ff00" stroke-width="13" stroke-dasharray="${2*Math.PI*81*percent/100} ${2*Math.PI*81}" transform="rotate(-90 96 96)"/></svg>` }));
  }
  // Geometric AM/PM test glyphs distinguish the actual raster path from the
  // old template copies. These are fixtures, not generated-font fidelity claims.
  const labels = {};
  for (const label of ['AM', 'PM']) labels[label] = await tool('render_svg', { width: 72, height: 32, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 32"><path d="${label === 'AM' ? 'M3 29L15 3L27 29M8 20H22' : 'M4 29V3H24V16H4'} M38 29V3L51 19L65 3V29" fill="none" stroke="#ffffff" stroke-width="4"/></svg>` });
  const font = { label: 'AM PM path fixture', dataUrl: labels.AM.dataUrl, glyphs: 'AMP', columns: 1, tint: false, labels: Object.fromEntries(Object.entries(labels).map(([label, asset]) => [label, asset.dataUrl])) };
  const apply = async commands => {
    document = await tool('get_document');
    await tool('apply_commands', { sessionId: document.sessionId, baseRevision: document.revision, commands });
    document = await tool('get_document');
  };
  await apply([
    { op: 'set', path: '/design/artwork', value: { dataUrl: { assetId: background.assetId }, width: 1024, height: 1024 } },
    { op: 'set', path: '/design/artworkVisible', value: true },
    ...['hours', 'minutes', 'battery'].map(id => ({ op: 'set_visibility', id, visible: false })),
    { op: 'add_sprite', sprite: { id: 'battery-clearance', name: 'Remove baked battery ring', dataUrl: mask.dataUrl, sourceWidth: 212, sourceHeight: 212, width: 212, height: 212, x: 564, y: 205, scale: 1, rotation: 0 } },
    { op: 'set', path: '/design/configAssetOverrides/config:battery_icon', value: { enabled: true, scale: 9.6, stateReplacements: Object.fromEntries(frames.map((frame, index) => [String(index), { dataUrl: frame.dataUrl, width: 192, height: 192 }])) } },
    { op: 'set', path: '/design/ampmIndicator', value: { enabled: true, x: 570, y: 355, scale: 1, fontFamily: '', rasterFont: font } }
  ]);
  await apply([{ op: 'place_layers', layerIds: ['batteryIcon'], x: 564, y: 205, anchor: 'center' }]);
  const geometry = await tool('get_geometry', { sessionId: document.sessionId, ids: ['batteryIcon'] });
  assert.equal(Math.round(geometry.layers[0].box.width), 192);
  assert.equal(Math.round(geometry.layers[0].box.height), 192);
  const { compareWatchfaceRegions } = require('../dist-electron/watchfaceAiImage.js');
  const { assertDynamicTargetGeometry } = require('../dist-electron/watchfaceAiVisual.js');
  const ringTarget = { id: 'battery-ring', label: 'Upper right battery ring', appearance: 'ring', mode: 'current', region: { x: 468/800, y: 109/800, width: 192/800, height: 192/800 }, dynamic: { layerId: 'batteryIcon', designPath: '/design/configAssetOverrides/config:battery_icon/stateReplacements' } };
  assertDynamicTargetGeometry(ringTarget, document, geometry);
  const smallIconGeometry = structuredClone(geometry);
  Object.assign(smallIconGeometry.layers[0].box, { x: 548, y: 189, width: 32, height: 32 });
  assert.throws(() => assertDynamicTargetGeometry(ringTarget, document, smallIconGeometry), /does not cover the intended target/);
  const referencePixels = nativeImage.createFromBuffer(await fs.readFile(arg('--neon-reference'))).toDataURL();
  const comparisons = [];
  const results = [];
  for (const resolution of [416, 800]) {
    const images = [];
    for (const percent of [0, 50, 100]) {
      const response = await rawTool('render_preview', { sessionId: document.sessionId, mode: 'current', resolution, size: resolution, scenario: { dateTime: '2026-09-22T10:08:45', values: { battery: String(percent) } } });
      assert.ok(!response.isError);
      const bytes = Buffer.from(response.content.find(part => part.type === 'image').data, 'base64');
      images.push(nativeImage.createFromBuffer(bytes));
      const name = `neon-${resolution}-battery-${percent}.png`;
      await fs.writeFile(path.join(temporaryRoot, name), bytes); results.push(name);
    }
    const compared = compareWatchfaceRegions({ previews: images.map(image => image.toDataURL()), region: ringTarget.region,
      reference: { dataUrl: referencePixels, region: { x: .60, y: .14, width: .24, height: .24 } }, dynamic: true, ring: true });
    const board = `ring-comparison-${resolution}.png`;
    await fs.writeFile(path.join(temporaryRoot, board), nativeImage.createFromDataURL(compared.imageDataUrl).toPNG());
    comparisons.push({ resolution, changedFractions: compared.changedFractions, board });
    assert.ok(!images[0].toBitmap().equals(images[1].toBitmap()) && !images[1].toBitmap().equals(images[2].toBitmap()));
    // All pixels outside the battery box must remain identical across charge.
    const [low, high] = [images[0].toBitmap(), images[2].toBitmap()];
    for (let y = 0; y < resolution; y++) for (let x = 0; x < resolution; x++) {
      const mx = x * 800 / resolution, my = y * 800 / resolution;
      if (mx > 460 && mx < 665 && my > 102 && my < 308) continue;
      const index = (y * resolution + x) * 4;
      assert.ok(low.subarray(index, index + 4).equals(high.subarray(index, index + 4)), `Static artwork changed outside battery at ${x},${y}`);
    }
  }
  await tool('save', { sessionId: document.sessionId, baseRevision: document.revision });
  await tool('export_project', { sessionId: document.sessionId, destinationPath: path.join(temporaryRoot, 'neon-isolated-project.zip') });
  document = await tool('get_document');
  const built = await tool('build_archive', { sessionId: document.sessionId, baseRevision: document.revision });
  await tool('export_archive', { archiveId: (built.archive ?? built).archiveId, destinationPath: path.join(temporaryRoot, 'neon-watch.zip') });
  const unzipper = require('unzipper');
  const archive = await unzipper.Open.file(path.join(temporaryRoot, 'neon-watch.zip'));
  for (const resolution of [416, 800]) {
    const images = [];
    const config = (await archive.files.find(file => file.path === `watchface_${resolution}x${resolution}/config.txt`).buffer()).toString();
    for (const index of ['00', '01']) {
      const key = index === '00' ? 'am_icon' : 'pm_icon';
      const value = config.split(/\r?\n/).find(line => line.startsWith(`[${key}]=`)).split('=')[1].replace(/\\/g, '/');
      const file = archive.files.find(file => file.path === `watchface_${resolution}x${resolution}/${value}`);
      assert.ok(file, 'compiled export contains both raster AM/PM labels');
      const bytes = await file.buffer(); images.push(nativeImage.createFromBuffer(bytes));
      await fs.writeFile(path.join(temporaryRoot, `ampm-${resolution}-${index}.png`), bytes);
    }
    assert.ok(!images[0].toBitmap().equals(images[1].toBitmap()), 'exported AM/PM select distinct label artwork');
  }
  await fs.writeFile(path.join(temporaryRoot, 'neon-validation.json'), JSON.stringify({ referenceAssetId: reference.assetId, rejectedAssetId: rejected.assetId, geometry, previews: results, comparisons, limitation: 'Offline geometric state/AM-PM fixtures. No new model-generated full font, visual fidelity or on-watch verification is claimed.' }, null, 2));
  console.log(`Neon isolated project passed; previews, project and report: ${temporaryRoot}`);
};
