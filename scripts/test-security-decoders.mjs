import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Watch files come from a Bluetooth peer, which may not be the user's watch.
// CorosLink connects only to the remembered watch's Bluetooth identity
// (watchIdentity.ts), but on Mac Bluetooth that identity follows the address,
// not a key, so a device that also copies the address still gets through.
// A forged sport-record or daily-history file must cost bounded time and
// memory to decode (it is decoded on the main process, and again after a
// restart). Runs against the compiled main-process modules
// (npm run build:electron first).

const repoRoot = path.resolve(import.meta.dirname, "..");
const load = (file) => import(pathToFileURL(path.join(repoRoot, "dist-electron", file)).href);
const { decodeCorosDailyFile } = await load("localSync/corosDailyRecord.js");
const { CorosSportRecordFormatError, decodeCorosSportRecordFile, MAX_FILE_SESSION_SECONDS, MAX_SESSION_SECONDS } = await load("localSync/corosSportRecord.js");
const sport = await import("./fixtures/coros-sport-record-fixture.mjs");
const daily = await import("./fixtures/coros-daily-fixture.mjs");

let passed = 0;
async function test(name, body) {
  try {
    await body();
    passed += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}
const timed = (body) => {
  const started = performance.now();
  const result = body();
  return { result, ms: performance.now() - started };
};

await test("daily: sleeps spanning decades are dropped without scanning every minute", () => {
  const records = [];
  for (let index = 0; index < 20; index++) {
    // 2017 → 2150, as a forged end time can say.
    records.push(daily.sleepStatusRecord(sport.DEVICE_EPOCH + 100_000_000 + index, 0xfa), daily.sleepStatusRecord(sport.DEVICE_EPOCH + 100_000_000 + index, 1),
      daily.sleepStatusRecord(sport.DEVICE_EPOCH + 0xffffff00 - index, 0xfb));
  }
  const { result, ms } = timed(() => decodeCorosDailyFile(sport.pages(records)));
  assert.equal(result.sleeps.length, 0);
  assert.ok(ms < 1_000, `took ${ms.toFixed(0)} ms`);
});

await test("daily: overlapping sleeps keep the first; HRV is averaged per night", () => {
  const night = 1_790_000_000;
  const records = [
    daily.sleepStatusRecord(night, 0xfa), daily.sleepStatusRecord(night, 3), daily.sleepStatusRecord(night + 6 * 3600, 0xfb),
    // Starts inside the night above: not a second recording.
    daily.sleepStatusRecord(night + 3600, 0xfa), daily.sleepStatusRecord(night + 3600, 4), daily.sleepStatusRecord(night + 7 * 3600, 0xfb),
    daily.hrvRecord(night + 1800, 0, { rmssd: 40, heartRate: 50, breathingRate: 14, sdnn: 30 }),
    daily.hrvRecord(night + 2 * 3600, 0, { rmssd: 51, heartRate: 50, breathingRate: 14, sdnn: 30 }),
    daily.hrvRecord(night + 10 * 3600, 0, { rmssd: 99, heartRate: 50, breathingRate: 14, sdnn: 30 })
  ];
  const decoded = decodeCorosDailyFile(sport.pages(records));
  assert.equal(decoded.sleeps.length, 1);
  assert.equal(decoded.sleeps[0].totalMinutes, 360);
  assert.deepEqual(decoded.sleepHrv, { [decoded.sleeps[0].day]: 45 }, "only readings inside the night, floored mean");
});

await test("daily: years of activity records are totalled per day in linear time", () => {
  const records = [];
  const days = 11_000;
  for (let index = 0; index < days * 20; index++) {
    const start = sport.DEVICE_EPOCH + (index % days) * 86_400 + Math.floor(index / days) * 300;
    records.push(daily.activityRecord(start, start + 60, { steps: 2, smallCalories: 4000 }));
  }
  const { result, ms } = timed(() => decodeCorosDailyFile(sport.pages(records)));
  assert.equal(result.days.length, days);
  assert.ok(result.days.every((day) => day.steps === 40 && day.calories === 80));
  assert.ok(ms < 5_000, `took ${ms.toFixed(0)} ms`);
});

const summary = (seconds) => sport.summaryRecord({ distanceCm: 1, timerCs: seconds * 100, smallCalories: 1, bestPace: 1, avgHr: 1, maxHr: 1,
  ascent: 0, descent: 0, altitudeOffset: 0, stepCadence: 1, maxStepCadence: 1, avgPower: 1 });

await test("sport: overlapping week-long sessions decode once, not once each", () => {
  const span = MAX_SESSION_SECONDS - 10;
  const records = [];
  for (let index = 0; index < 32; index++) {
    const start = 1_700_000_000 + index * 10;
    records.push(sport.startRecord(start, 0, 0), sport.pauseRecord(start + span, 0), summary(span));
  }
  const { result, ms } = timed(() => decodeCorosSportRecordFile(sport.pages(records), () => undefined));
  assert.deepEqual([result.rejected, result.incomplete], [31, 0]);
  assert.ok(ms < 10_000, `took ${ms.toFixed(0)} ms`);
});

await test("sport: one file decodes at most its budget of activity time, newest first", () => {
  // No summaries, so nothing heavy is built: only which drafts are tried is checked.
  const span = 6 * 86_400;
  const count = 20;
  const records = [];
  for (let index = 0; index < count; index++) {
    const start = 1_700_000_000 + index * 7 * 86_400;
    records.push(sport.startRecord(start, 0, 0), sport.pauseRecord(start + span, 0));
  }
  const result = decodeCorosSportRecordFile(sport.pages(records));
  const tried = Math.floor(MAX_FILE_SESSION_SECONDS / span);
  assert.deepEqual([result.incomplete, result.rejected], [tried, count - tried]);
});

await test("sport and daily: millions of tiny records are refused before they fill memory", () => {
  const file = Buffer.alloc(4 * 1024 * 1024);
  const marker = sport.marker(1);
  marker.copy(file, 0);
  for (let at = marker.length; at + 2 <= file.length; at += 2) { file[at] = 0x1a; file[at + 1] = 0; }
  for (const decode of [decodeCorosSportRecordFile, decodeCorosDailyFile]) {
    const started = performance.now();
    assert.throws(() => decode(file), CorosSportRecordFormatError);
    assert.ok(performance.now() - started < 5_000);
  }
});

await test("watch identity: an empty or malformed identity never matches, and a hostile setting is ignored", async () => {
  const { identityTag, normalizeIdentity, parsePinnedWatches, sameIdentity, watchIdentityProblem, WatchIdentityError } = await load("watchIdentity.js");
  assert.equal(sameIdentity("", ""), false, "two missing identities are not the same watch");
  assert.equal(sameIdentity(undefined, undefined), false);
  assert.equal(sameIdentity(" aa:bb:cc:dd:ee:ff ", "AA:BB:CC:DD:EE:FF"), true);
  assert.equal(normalizeIdentity("x".repeat(129)), undefined);
  for (const raw of ["", "null", "[]", "{", JSON.stringify({ system: { deviceId: 7 } }), JSON.stringify({ system: { deviceId: "" } }), JSON.stringify({ __proto__: { system: { deviceId: "A" } } })]) {
    assert.deepEqual(parsePinnedWatches(raw), {}, raw);
  }
  const parsed = parsePinnedWatches(JSON.stringify({ system: { deviceId: "abc", deviceName: { toString: 1 }, pinnedAt: "soon" }, other: { deviceId: "x" } }));
  assert.deepEqual(parsed, { system: { deviceId: "ABC", deviceName: undefined, serialNumber: undefined, modelNumber: undefined, model: undefined, pinnedAt: 0 } });
  assert.match(identityTag("5A1E3C2B-0D4F-4E6A-9B7C-1D2E3F405162"), /^id#[0-9a-f]{8}$/);
  assert.equal(watchIdentityProblem(new WatchIdentityError("mismatch")), "mismatch");
  assert.equal(watchIdentityProblem(Object.assign(new Error("x"), { watchIdentity: "other" })), undefined);
});

// A watch key backup is a file the user picks, perhaps one someone handed them. Whatever it
// says, CorosLink decrypts only with its own scrypt cost, authenticates every byte, and gives
// one plain answer for anything wrong, never one that quotes the file or the key.
await test("watch key backup: forged, tampered, truncated and oversized files get one plain error", async () => {
  const crypto = await import("node:crypto");
  const { openWatchKeyBackup, sealWatchKeyBackup, inspectWatchKeyBackup, WATCH_KEY_BACKUP_ERROR, WATCH_KEY_BACKUP_UNSUPPORTED,
    WATCH_KEY_BACKUP_NOT_A_BACKUP, MAX_WATCH_KEY_BACKUP_BYTES } = await load("corosWatchKeyBackup.js");
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyDer = privateKey.export({ format: "der", type: "pkcs1" }).toString("base64");
  const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const key = { version: 1, accountUserId: "123456789012345678", privateKeyDer, unit: 1, dataCollectSwitch: 7, issuedAt: 1_760_000_000_000, accountEmail: "runner@example.com" };
  const passphrase = "correct horse battery";
  const sealed = await sealWatchKeyBackup(key, passphrase);
  const plain = error => {
    assert.equal(error.message, WATCH_KEY_BACKUP_ERROR);
    for (const secret of [privateKeyDer.slice(60, 90), publicKeyDer.slice(60, 90), "runner@example.com", passphrase, key.accountUserId]) assert.ok(!error.message.includes(secret));
    return true;
  };
  assert.equal((await openWatchKeyBackup(sealed, passphrase)).privateKeyDer, privateKeyDer);
  await assert.rejects(openWatchKeyBackup(sealed, "wrong passphrase"), plain);
  // Header layout: magic 10, version 1, KDF id/log2N/r/p 4, salt 16, nonce 12.
  const flip = at => { const copy = Buffer.from(sealed); copy[at] ^= 0x01; return copy; };
  for (const [name, at] of [["KDF id", 11], ["scrypt cost", 12], ["scrypt r", 13], ["scrypt p", 14], ["salt", 20], ["nonce", 35], ["ciphertext", 50], ["last ciphertext byte", sealed.length - 17], ["tag", sealed.length - 1]]) {
    await assert.rejects(openWatchKeyBackup(flip(at), passphrase), plain, name);
  }
  for (const length of [0, 9, 20, 59, 60, sealed.length - 1, sealed.length - 16]) await assert.rejects(openWatchKeyBackup(sealed.subarray(0, length), passphrase), error =>
    length > 0 && length < 10 ? error.message === WATCH_KEY_BACKUP_NOT_A_BACKUP || plain(error) : plain(error), `truncated to ${length}`);
  await assert.rejects(openWatchKeyBackup(Buffer.concat([sealed, Buffer.alloc(MAX_WATCH_KEY_BACKUP_BYTES)]), passphrase), plain, "oversized");
  await assert.rejects(openWatchKeyBackup(Buffer.concat([sealed, Buffer.from([0])]), passphrase), plain, "a byte appended");
  // Version 1 only: an older or newer version is refused before any decryption.
  for (const version of [0, 2, 255]) {
    const copy = Buffer.from(sealed); copy[10] = version;
    assert.throws(() => inspectWatchKeyBackup(copy), error => error.message === WATCH_KEY_BACKUP_UNSUPPORTED);
    await assert.rejects(openWatchKeyBackup(copy, passphrase), error => error.message === WATCH_KEY_BACKUP_UNSUPPORTED);
  }
  const notOurs = Buffer.from(sealed); notOurs.write("PK\x03\x04", 0, "latin1");
  assert.throws(() => inspectWatchKeyBackup(notOurs), error => error.message === WATCH_KEY_BACKUP_NOT_A_BACKUP);

  // A well-formed file made with a cheaper scrypt (and the right passphrase) is still refused:
  // the cost is CorosLink's, never the file's, so it can't be lowered.
  const forge = (fields, { log2N = 17, r = 8, p = 1 } = {}) => {
    const salt = crypto.randomBytes(16), nonce = crypto.randomBytes(12);
    const header = Buffer.concat([Buffer.from("CLWATCHKEY", "latin1"), Buffer.from([1, 1, log2N, r, p]), salt, nonce]);
    const secret = crypto.scryptSync(passphrase.normalize("NFKC"), salt, 32, { N: 2 ** log2N, r, p, maxmem: 1024 * 1024 * 1024 });
    const cipher = crypto.createCipheriv("aes-256-gcm", secret, nonce);
    cipher.setAAD(header);
    return Buffer.concat([header, cipher.update(Buffer.from(typeof fields === "string" ? fields : JSON.stringify(fields))), cipher.final(), cipher.getAuthTag()]);
  };
  const fields = { accountUserId: key.accountUserId, privateKeyDer, publicKeyDer, unit: 1, dataCollectSwitch: 7 };
  assert.equal((await openWatchKeyBackup(forge(fields), passphrase)).accountUserId, key.accountUserId, "the forge helper matches the format");
  for (const cost of [{ log2N: 10 }, { log2N: 14 }, { r: 4 }, { p: 2 }]) {
    const started = performance.now();
    await assert.rejects(openWatchKeyBackup(forge(fields, cost), passphrase), plain, JSON.stringify(cost));
    assert.ok(performance.now() - started < 5_000);
  }
  // Authentic files whose key fails the sign-in checks: the same plain answer.
  const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const small = crypto.generateKeyPairSync("rsa", { modulusLength: 1024 });
  for (const [name, content] of [
    ["not JSON", "{"], ["an array", []], ["null", null],
    ["a public key from another pair", { ...fields, publicKeyDer: other.publicKey.export({ format: "der", type: "spki" }).toString("base64") }],
    ["RSA 1024", { ...fields, privateKeyDer: small.privateKey.export({ format: "der", type: "pkcs1" }).toString("base64"), publicKeyDer: small.publicKey.export({ format: "der", type: "spki" }).toString("base64") }],
    ["no public key", { ...fields, publicKeyDer: undefined }],
    ["account 0", { ...fields, accountUserId: "0" }], ["account with leading zero", { ...fields, accountUserId: "0123" }],
    ["account as number", { ...fields, accountUserId: 123 }], ["account past u64", { ...fields, accountUserId: "18446744073709551616" }],
    ["units 2", { ...fields, unit: 2 }], ["negative data switch", { ...fields, dataCollectSwitch: -1 }],
    ["issued in 1990", { ...fields, issuedAt: 631_152_000_000 }], ["issued next year", { ...fields, issuedAt: Date.now() + 400 * 86_400_000 }],
    ["email without @", { ...fields, accountEmail: "nobody" }], ["an extra field", { ...fields, accessToken: "token-private" }],
    ["a session token in place of the key", { ...fields, privateKeyDer: "token-private" }]
  ]) await assert.rejects(openWatchKeyBackup(forge(content), passphrase), error => plain(error) && !error.message.includes("token-private"), name);
});

console.log(`security decoders: ${passed} checks passed`);
