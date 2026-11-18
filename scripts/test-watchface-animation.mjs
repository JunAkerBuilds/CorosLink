// Native sprite animation (compiled header 0x312): CorosLink's compiler writes
// the 0x94-byte record from the Studio-owned cl_animation_* keys, the BIN
// decoder reads it back, and recovery turns it into the same keys again.
// Set NANJING_MARATHON_BIN to the official NANJING MARATHON face to also run
// the acceptance checks against it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { compileWatchface, WatchfaceCompileError, MAX_ANIMATION_FRAMES } = require('../dist-electron/watchfaceCompiler/compiler.js');
const { encodePng, decodePng } = require('../dist-electron/watchfaceCompiler/png.js');
const { mipBlockOverflows } = require('../dist-electron/watchfaceCompiler/bitmap.js');
const { findCorosBitmapBlocks, decodeCorosBitmapFrame, decodeCorosLayout, readLayoutHeaders } = require('../dist-electron/corosBinLayout.js');
const { recoverCompiledCorosWatchface } = require('../dist-electron/corosCompiledWatchface.js');
const { getWatchfaceTarget, watchfaceBinTarget } = require('../dist-electron/watchfaceTargets.js');

const DELAYS = '70,125,260,100,100,100,100,100,100,40';
const PACE_4 = watchfaceBinTarget(getWatchfaceTarget('pace-4'));
const PACE_PRO = watchfaceBinTarget(getWatchfaceTarget('pace-pro'));

/** An RGBA frame whose pixels encode its index, so order survives the round trip. */
const frame = (index, width = 24, height = 18) => {
  const data = new Uint8Array(width * height * 4);
  for (let p = 0; p < width * height; p++) data.set([(index * 37) % 256, (index * 91 + p) % 256, 200, p % 7 ? 255 : 0], p * 4);
  return encodePng({ width, height, data });
};

function archive(target, { frames = 10, delays, pos = '{0,31}', folder = 'cl_animation_10', aod = false, sizes } = {}) {
  const dir = target.layout;
  const files = new Map([
    ['info.json', Buffer.from('{"m_app":"x","o_wf_ver":4}')],
    [`${dir}/background.png`, encodePng({ width: 8, height: 8, data: new Uint8Array(256).fill(90) })]
  ]);
  const config = ['[watchface_id]=1', '[background_icon]=background.png', '[background_icon_pos]={0,0}'];
  if (frames) {
    for (let i = 0; i < frames; i++) {
      const [w, h] = sizes?.[i] ?? [24, 18];
      files.set(`${dir}/${folder}/${String(i).padStart(2, '0')}.png`, frame(i, w, h));
    }
    config.push(`[cl_animation_pos]=${pos}`, `[cl_animation_dir]=${folder}`);
    if (delays !== null) config.push(`[cl_animation_delays_ms]=${delays ?? Array(frames).fill(100).join(',')}`);
  }
  files.set(`${dir}/config.txt`, Buffer.from(config.join('\r\n')));
  // A hand-written AOD that copies Current's animation keys; the compiler must ignore them there.
  if (aod) files.set(`${dir}/AODconfig.txt`, Buffer.from(config.join('\r\n')));
  return files;
}

function decode(bin) {
  const headers = readLayoutHeaders(bin);
  const blocks = findCorosBitmapBlocks(bin, Math.max(...headers.map(h => h.offset + h.length)));
  return { blocks, layout: decodeCorosLayout(bin, blocks) };
}

function crc16(bytes) { let crc = 0xffff; for (const byte of bytes) { crc ^= byte << 8; for (let bit = 0; bit < 8; bit++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff; } return crc; }
function assertIntegrity(bin, label) {
  assert.equal(bin.readUInt32LE(8), bin.length - 18, `${label}: length field`);
  assert.equal(bin.readUInt16LE(12), crc16(bin.subarray(18)), `${label}: CRC`);
}

/** The frames a slot's group decodes to, as raw RGBA, in order. */
function slotFrames(bin, blocks, slot) {
  const block = blocks[slot.asset.group];
  return Array.from({ length: block.frameCount }, (_, i) => Buffer.from(decodeCorosBitmapFrame(bin, block, i)));
}

// --- Compile + decode on both verified watches -------------------------------
for (const target of [PACE_4, PACE_PRO]) {
  const { bin, warnings } = compileWatchface(archive(target, { aod: true, delays: '70,125,260,100,100,100,100,100,100,40' }), { faceId: 7, target });
  assert.deepEqual(warnings, [], `${target.label}: no warnings`);
  assert.equal(bin.toString('latin1', 0, 4), target.magic);
  assertIntegrity(bin, target.label);
  const record = bin.readUInt32LE(0x312);
  assert.ok(record >= 0x1202 * 2 && record + 0x94 <= bin.length, `${target.label}: 0x312 points at a complete record`);
  assert.deepEqual([bin.readInt32LE(record), bin.readInt32LE(record + 4)], [0, 31]);
  for (let slot = 1; slot < 5; slot++) {
    assert.equal(bin.readUInt32LE(record + 0x28 + slot * 4), 0, 'unused slots stay zero');
    assert.deepEqual([bin.readInt32LE(record + slot * 8), bin.readInt32LE(record + slot * 8 + 4)], [0, 0]);
  }
  const delays = Array.from({ length: 44 }, (_, i) => bin.readUInt16LE(record + 0x3c + i * 2));
  assert.deepEqual(delays.slice(0, 10), [70, 125, 260, 100, 100, 100, 100, 100, 100, 40], 'nonuniform delays');
  assert.ok(delays.slice(10).every(d => d === 0), 'delays past the frame count stay zero');
  const aod = bin.readUInt32LE(0x322);
  assert.equal(bin.readUInt32LE(aod + 0x312), 0, `${target.label}: AOD never animates`);
  const { blocks, layout } = decode(bin);
  assert.deepEqual(layout.warnings, []);
  const animation = layout.modes[0].animation;
  assert.ok(animation, 'decoder reads the record');
  assert.equal(animation.slots.length, 1);
  assert.deepEqual(animation.slots[0].position, { x: 0, y: 31 });
  assert.deepEqual([animation.slots[0].frameCount, animation.slots[0].width, animation.slots[0].height], [10, 24, 18]);
  assert.deepEqual(animation.delays, [70, 125, 260, 100, 100, 100, 100, 100, 100, 40]);
  assert.equal(layout.modes[1].animation, undefined, 'AOD decodes with no animation');
  // Frames keep their order: frame i carries red = 37·i.
  slotFrames(bin, blocks, animation.slots[0]).forEach((rgba, i) => {
    const opaque = [...Array(rgba.length / 4).keys()].find(p => rgba[p * 4 + 3] === 255);
    assert.equal(rgba[opaque * 4], (i * 37) % 256, `frame ${i} in order`);
  });

  // Recovery writes the Studio keys back, and a recompile reproduces the record.
  const recovered = recoverCompiledCorosWatchface(bin, 'Animated');
  const config = unzipText(recovered.zip, `${target.layout}/config.txt`);
  assert.match(config, /^\[cl_animation_pos\]=\{0,31\}$/m);
  assert.match(config, /^\[cl_animation_delays_ms\]=70,125,260,100,100,100,100,100,100,40$/m);
  const dir = config.match(/^\[cl_animation_dir\]=(.+)$/m)[1].trim();
  assert.equal(unzipText(recovered.zip, `${target.layout}/AODconfig.txt`).includes('cl_animation'), false);
  const recompiled = compileWatchface(unzipAll(recovered.zip), { faceId: 7, target });
  assertIntegrity(recompiled.bin, `${target.label} recompile`);
  const again = decode(recompiled.bin);
  assert.deepEqual(again.layout.modes[0].animation.delays, animation.delays);
  assert.deepEqual(again.layout.modes[0].animation.slots[0].position, { x: 0, y: 31 });
  assert.deepEqual(slotFrames(recompiled.bin, again.blocks, again.layout.modes[0].animation.slots[0]), slotFrames(bin, blocks, animation.slots[0]),
    `${target.label}: ${dir} frames survive recovery and recompile pixel for pixel`);
}
console.log('Animation record compiles, decodes and recovers on PACE 4 (093A) and PACE Pro (614A); AOD stays static.');

// --- Limits and validation ---------------------------------------------------
const compile = (options, target = PACE_4) => compileWatchface(archive(target, options), { faceId: 1, target });
for (const count of [1, 30, MAX_ANIMATION_FRAMES]) {
  const { bin } = compile({ frames: count, folder: 'cl_animation_x', delays: Array.from({ length: count }, (_, i) => 10 + i).join(',') });
  const record = bin.readUInt32LE(0x312);
  assert.deepEqual(Array.from({ length: count }, (_, i) => bin.readUInt16LE(record + 0x3c + i * 2)), Array.from({ length: count }, (_, i) => 10 + i), `${count} frames`);
  assert.equal(decode(bin).layout.modes[0].animation.slots[0].frameCount, count);
}
assert.equal(MAX_ANIMATION_FRAMES, 44);
assert.throws(() => compile({ frames: 45, delays: '100' }), e => e instanceof WatchfaceCompileError && /at most 44/.test(e.message));
const single = compile({ delays: '120' }).bin;
assert.ok(Array.from({ length: 10 }, (_, i) => single.readUInt16LE(single.readUInt32LE(0x312) + 0x3c + i * 2)).every(d => d === 120), 'one delay applies to every frame');
const fallback = compile({ delays: null }).bin;
assert.equal(fallback.readUInt16LE(fallback.readUInt32LE(0x312) + 0x3c), 100, 'no delay list defaults to 100 ms');
assert.throws(() => compile({ delays: '100,100' }), e => e instanceof WatchfaceCompileError && /10 frames but 2 delays/.test(e.message));
assert.throws(() => compile({ delays: Array(10).fill(0).join(',') }), e => e instanceof WatchfaceCompileError && /between 1 and 65535/.test(e.message));
assert.throws(() => compile({ delays: '100,abc' }), e => e instanceof WatchfaceCompileError && /whole milliseconds/.test(e.message));
assert.throws(() => compile({ delays: Array(10).fill(70000).join(',') }), e => e instanceof WatchfaceCompileError);
assert.throws(() => compile({ sizes: [[24, 18], [24, 18], [20, 18]] }), e => e instanceof WatchfaceCompileError && /must be 24 × 18/.test(e.message));
assert.throws(() => compileWatchface(new Map([...archive(PACE_4, { frames: 0 })].map(([k, v]) => [k, k.endsWith('config.txt') ? Buffer.from(`${v}\r\n[cl_animation_dir]=missing`) : v])), { faceId: 1, target: PACE_4 }),
  e => e instanceof WatchfaceCompileError && /has no PNG frames/.test(e.message));
const signed = compile({ pos: '{-12,-5}' }).bin;
assert.deepEqual([signed.readInt32LE(signed.readUInt32LE(0x312)), signed.readInt32LE(signed.readUInt32LE(0x312) + 4)], [-12, -5], 'Studio positions keep their sign');
const plain = compile({ frames: 0 }).bin;
assert.equal(plain.readUInt32LE(0x312), 0, 'a static face keeps 0x312 zero');
assert.equal(decode(plain).layout.modes[0].animation, undefined);
// Memory-in-pixel: the six models whose firmware reads the record get it with MIP-encoded frames.
for (const id of ['pace-3', 'nomad', 'apex-4', 'apex-2', 'apex-2-pro']) {
  const target = watchfaceBinTarget(getWatchfaceTarget(id));
  const { bin, warnings } = compileWatchface(archive(target, { aod: true }), { faceId: 1, target });
  assert.deepEqual(warnings, [], `${target.label}: no warnings`);
  assertIntegrity(bin, target.label);
  const record = bin.readUInt32LE(0x312), list = bin.readUInt32LE(record + 0x28);
  assert.deepEqual([bin.readInt32LE(record), bin.readInt32LE(record + 4), bin.readUInt16LE(record + 0x3c)], [0, 31, 100]);
  assert.equal(list, record + 0x94, `${target.label}: the frame list follows its record`);
  assert.deepEqual([bin.readUInt16LE(list), bin.readUInt16LE(list + 2), bin[list + 5], bin[list + 6]], [24, 18, 0x08, 10], `${target.label}: ten memory-in-pixel frames`);
  assert.equal(bin.readUInt32LE(bin.readUInt32LE(0x322) + 0x312), 0, `${target.label}: AOD never animates`);
}
for (const id of ['vertix-2', 'pace-2', 'apex-pro', 'vertix']) {
  const target = watchfaceBinTarget(getWatchfaceTarget(id));
  const mip = compileWatchface(archive(target), { faceId: 1, target });
  assert.equal(mip.bin.readUInt32LE(0x312), 0, `${target.label}: no record`);
  assert.ok(mip.warnings.some(w => /not supported on/.test(w)), `${target.label}: says the animation was left out`);
}
{
  // Memory-in-pixel fitting: the margin no frame draws in is cut off and the position follows...
  const target = watchfaceBinTarget(getWatchfaceTarget('apex-4'));
  const padded = archive(target, { pos: '{10,20}', sizes: Array(10).fill([40, 30]) });
  for (const [name, data] of padded) {
    if (!/cl_animation_10\/\d+\.png$/.test(name)) continue;
    const image = decodePng(data);
    for (let p = 0; p < 40 * 30; p++) { const x = p % 40, y = (p - x) / 40; if (x < 5 || y < 5 || x >= 35 || y >= 25) image.data[p * 4 + 3] = 0; }
    padded.set(name, encodePng(image));
  }
  const trimmed = compileWatchface(padded, { faceId: 1, target });
  assert.deepEqual(trimmed.warnings, []);
  let record = trimmed.bin.readUInt32LE(0x312), list = trimmed.bin.readUInt32LE(record + 0x28);
  assert.deepEqual([trimmed.bin.readInt32LE(record), trimmed.bin.readInt32LE(record + 4)], [15, 25], 'the position moves with the trimmed margin');
  assert.deepEqual([trimmed.bin.readUInt16LE(list), trimmed.bin.readUInt16LE(list + 2), trimmed.bin[list + 6]], [30, 20, 10]);
  const amoled = compileWatchface(new Map([...padded].map(([k, v]) => [k.replace(target.layout, PACE_PRO.layout), v])), { faceId: 1, target: PACE_PRO }).bin;
  record = amoled.readUInt32LE(0x312);
  assert.deepEqual([amoled.readInt32LE(record), amoled.readInt32LE(record + 4), amoled.readUInt16LE(amoled.readUInt32LE(record + 0x28))], [10, 20, 40], 'AMOLED frames are stored as they are');
  // ...and frames past 64 KB together are thinned evenly, each kept frame staying up for the ones after it.
  const big = compileWatchface(archive(target, { sizes: Array(10).fill([200, 200]), delays: '10,11,12,13,14,15,16,17,18,19' }), { faceId: 1, target });
  assert.deepEqual(big.warnings, ['The animation is too large for APEX 4 with all 10 frames, so it plays 2 of them.']);
  record = big.bin.readUInt32LE(0x312); list = big.bin.readUInt32LE(record + 0x28);
  assert.equal(big.bin[list + 6], 2);
  assert.deepEqual([0, 1, 2].map(i => big.bin.readUInt16LE(record + 0x3c + i * 2)), [60, 85, 0], 'the loop takes as long as before');
  assert.ok(!mipBlockOverflows(big.bin.subarray(list, list + 10 + 3 * 2 + big.bin.readUInt16LE(list + 10 + 2 * 2))));
  // One frame kept of several is a still: the longest delay there is, so the watch redraws it least often.
  const pace3 = watchfaceBinTarget(getWatchfaceTarget('pace-3'));
  const still = compileWatchface(archive(pace3, { sizes: Array(10).fill([240, 240]), aod: true, delays: DELAYS, pos: '{0,0}' }), { faceId: 7, target: pace3 });
  assert.deepEqual(still.warnings, ['The animation is too large for PACE 3, so it shows only its first frame. Use smaller frames.']);
  assert.equal(still.bin.readUInt16LE(still.bin.readUInt32LE(0x312) + 0x3c), 65535);
  // A kept frame cannot stay up past 65,535 ms: the loop is shorter, and the warning says so.
  const slow = compileWatchface(archive(target, { sizes: Array(10).fill([200, 200]), aod: true, delays: Array(10).fill(60000).join(','), pos: '{0,0}' }), { faceId: 7, target });
  assert.deepEqual(slow.warnings, ['The animation is too large for APEX 4 with all 10 frames, so it plays 2 of them. Its loop is shorter too: a frame stays up 65.5 s at most.']);
  record = slow.bin.readUInt32LE(0x312);
  assert.deepEqual([0, 1, 2].map(i => slow.bin.readUInt16LE(record + 0x3c + i * 2)), [65535, 65535, 0]);
  // A position past 32 bits wraps like every other field (and like the phone compilers), not a RangeError.
  const wrapped = compileWatchface(archive(PACE_4, { aod: true, delays: DELAYS, pos: '{3000000000,5}' }), { faceId: 7, target: PACE_4 }).bin;
  assert.deepEqual([wrapped.readInt32LE(wrapped.readUInt32LE(0x312)), wrapped.readInt32LE(wrapped.readUInt32LE(0x312) + 4)], [-1294967296, 5]);
  // The bytes C-LINK's iOS and Android tests pin for the same archives: a change here must be made there too.
  const sha = bin => crypto.createHash('sha256').update(bin).digest('hex');
  const pinned = (id, options) => { const t = watchfaceBinTarget(getWatchfaceTarget(id)); return sha(compileWatchface(archive(t, { aod: true, delays: DELAYS, pos: '{-12,31}', ...options }), { faceId: 7, target: t }).bin); };
  assert.equal(pinned('pace-pro'), 'f3f0583bab155397064b9e625f0ac22aea83d46e999f33c1b41edcfecaa4df8a');
  assert.equal(pinned('pace-4'), 'c7bcaa7b7eda1a786a6f3e8dc8885dfd981597b09aec7d53fc412af74a74f17a');
  assert.equal(pinned('pace-3'), '43ab61be297bd49898b68ebb44e077e1d2169306a70dfecf097711a948cf5902');
  assert.equal(pinned('apex-4'), 'a768804754652f7372d92a027b5297e128eb77a4dc7ebfb82b376bf8f4bb54f4');
  assert.equal(pinned('vertix-2'), 'cd85d604aa9265dff308788c14f5abc5ebebfbc5ca47c6e11f7bef1671dd3f5e');
  assert.equal(sha(still.bin), 'e439540e853f3f3ffb12dc2bd1467b4b66aa78aa4e2262f401b3dc6fbf3d861f');
  assert.equal(sha(slow.bin), '32215f2ae6bd9bf05fcd461891d4cf5aa1fbe984bf70804d37fceb7216c6d3fd');
  assert.equal(sha(wrapped), '49e8d77cf028584ef90d557a5dac2b763715964d639e7d7a80768b018245fa84');
}
{
  // The shared plan Studio's preview plays from: same frames and delays as the build, and the
  // watch's colors round-trip (four levels a channel, 0xff transparent).
  const { planMipAnimation, mip2222, mip2222ToRgba, watchPlaysAnimation, cbzCompressBytes } = require('../dist-electron/watchfaceCompiler/animationFit.js');
  const { cbzCompress } = require('../dist-electron/watchfaceCompiler/bitmap.js');
  assert.deepEqual([['amoled', 'pace-4'], ['mip', 'apex-4'], ['mip', 'vertix-2'], ['mip', 'apex-pro']].map(([display, model]) => watchPlaysAnimation({ display, model })), [true, true, false, false]);
  const rgba = new Uint8Array([255, 0, 130, 255, 10, 200, 50, 100, 9, 9, 9, 20, 255, 255, 255, 255]);
  const bytes = mip2222(rgba, 2, 2);
  assert.deepEqual([...bytes], [0x32, 0x89, 0xff, 0x3f]);
  assert.deepEqual([...mip2222ToRgba(bytes)], [255, 0, 170, 255, 0, 170, 85, 85, 0, 0, 0, 0, 255, 255, 255, 255]);
  const noisy = Uint8Array.from({ length: 5000 }, (_, i) => (i * 131) % 251);
  assert.deepEqual([...cbzCompressBytes(noisy)], [...cbzCompress(noisy)]);
  const frames = Array.from({ length: 6 }, (_, f) => { const frame = new Uint8Array(40 * 30).fill(0xff); for (let y = 10; y < 20; y++) for (let x = 5; x < 25; x++) frame[y * 40 + x] = (f + x * y) & 0x3f; return frame; });
  const plan = planMipAnimation(frames, 40, 30, [10, 20, 30, 40, 50, 60]);
  assert.deepEqual([plan.x, plan.y, plan.width, plan.height, plan.kept, plan.delays], [5, 10, 20, 10, [0, 1, 2, 3, 4, 5], [10, 20, 30, 40, 50, 60]]);
  const heavy = Array.from({ length: 6 }, (_, f) => Uint8Array.from({ length: 160 * 160 }, (_, i) => (i * 7 + f * 13 + ((i * i) >> 3)) & 0x3f));
  const thinned = planMipAnimation(heavy, 160, 160, [10, 20, 30, 40, 50, 60]);
  assert.ok(thinned.kept.length < 6 && thinned.kept[0] === 0 && thinned.bytes <= 0xffff);
  assert.equal(thinned.delays.reduce((a, b) => a + b, 0), 210, 'the loop takes as long');
  assert.equal(planMipAnimation([Uint8Array.from({ length: 300 * 300 }, (_, i) => (i * 7 + ((i * i) >> 3)) & 0x3f)], 300, 300, [100]), undefined, 'one frame past 64 KB cannot play');
}
console.log('Animation limits: 1/30/44 frames, >44 rejected, delays per frame, mixed sizes, missing frames, signed positions, MIP on six models (margin trimmed, frames thinned past 64 KB), skipped elsewhere.');

// --- Malformed records never break the rest of the face -----------------------
{
  const { bin } = compile({});
  const record = bin.readUInt32LE(0x312);
  const outOfRange = Buffer.from(bin); outOfRange.writeUInt32LE(bin.length - 8, 0x312);
  let decoded = decode(outOfRange).layout;
  assert.equal(decoded.modes[0].animation, undefined);
  assert.ok(decoded.warnings.some(w => /invalid animation record/.test(w)));
  assert.ok(decoded.modes[0].elements.some(e => e.id === 'background' && e.active), 'the background still recovers');
  const badSlot = Buffer.from(bin); badSlot.writeUInt32LE(record + 1, record + 0x28);
  decoded = decode(badSlot).layout;
  assert.equal(decoded.modes[0].animation, undefined);
  assert.ok(decoded.warnings.some(w => /animation slot 0 points at/.test(w)));
  const disabled = Buffer.from(bin); disabled.writeUInt16LE(0, record + 0x3c);
  assert.equal(decode(disabled).layout.modes[0].animation, undefined, 'a zero first delay is no animation, as on the watch');
}
console.log('Malformed animation records are reported and skipped.');

// --- Optional acceptance fixture --------------------------------------------
const nanjing = process.env.NANJING_MARATHON_BIN;
if (nanjing && fs.existsSync(nanjing)) {
  const bin = fs.readFileSync(nanjing);
  assert.equal(crypto.createHash('sha256').update(bin).digest('hex'), '8c9a981b585c2c0e40f67b441e2badcc5a752df60ea3c2a49b96295733f875e9');
  const { blocks, layout } = decode(bin);
  const animation = layout.modes[0].animation;
  assert.equal(animation.recordOffsetHex, '0xb4cf9');
  assert.deepEqual(animation.slots.map(s => [s.slot, s.position, s.frameCount, s.width, s.height, s.asset.pointerHex]), [[0, { x: 0, y: 31 }, 10, 376, 340, '0xb4d8d']]);
  assert.deepEqual(animation.delays, Array(10).fill(100));
  assert.equal(layout.modes[1].animation, undefined, 'the empty AOD record makes no layer');
  assert.deepEqual(layout.modes.map(m => m.record0x31a?.pointerHex), ['0xed329', '0x193e93'], '0x31a bytes are kept');
  const weather = layout.modes[0].elements.filter(e => /^weather\.(day|night)$/.test(e.id) || e.config?.asset === 'weather_icon_dir' || e.config?.asset === 'weather_dark_icon_dir');
  assert.ok(weather.length >= 2 && weather.every(e => blocks[e.asset.group].frameCount === 41), 'the 41-frame weather sets keep their roles');
  const recovered = recoverCompiledCorosWatchface(bin, 'NANJING MARATHON');
  const config = unzipText(recovered.zip, 'watchface_390x390/config.txt');
  assert.match(config, /^\[cl_animation_pos\]=\{0,31\}$/m);
  assert.match(config, /^\[cl_animation_delays_ms\]=100(,100){9}$/m);
  assert.match(config, /^\[weather_icon_dir\]=recovered\\group-\d+$/m);
  const recompiled = compileWatchface(unzipAll(recovered.zip), { faceId: 1000001880, target: PACE_4 });
  assertIntegrity(recompiled.bin, 'NANJING recompile');
  assert.ok(recompiled.bin.length + 16 <= 0x320000, 'fits the direct-send cap');
  const again = decode(recompiled.bin);
  assert.deepEqual(again.layout.modes[0].animation.delays, Array(10).fill(100));
  assert.deepEqual(again.layout.modes[0].animation.slots[0].position, { x: 0, y: 31 });
  assert.equal(again.layout.modes[1].animation, undefined);
  console.log('NANJING MARATHON: one 10-frame 376 × 340 layer at (0,31), 100 ms × 10, recovered and recompiled.');
} else {
  console.log('NANJING MARATHON acceptance skipped (set NANJING_MARATHON_BIN).');
}

// Store-only ZIP reader for createStoreZip output (no compression, no data descriptors).
function unzipAll(zip) {
  const files = new Map();
  let offset = 0;
  while (zip.readUInt32LE(offset) === 0x04034b50) {
    const size = zip.readUInt32LE(offset + 18), nameLength = zip.readUInt16LE(offset + 26), extra = zip.readUInt16LE(offset + 28);
    const name = zip.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extra;
    files.set(name, zip.subarray(start, start + size));
    offset = start + size;
  }
  return files;
}
function unzipText(zip, name) {
  const data = unzipAll(zip).get(name);
  assert.ok(data, `${name} is in the archive`);
  return data.toString('utf8');
}
