import assert from "node:assert/strict";
import { constants, createCipheriv, generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { decodeCorosBleLoginKey, createCorosLoginCredential, COROS_BLE_LOGIN_KEY_SETTING, COROS_WATCH_KEY_CHECK_SETTING,
  maskCorosEmail, nextWatchKeyCheck, summarizeCorosBleLoginKey } = require("../dist-electron/corosBleLoginKey.js");
const { CorosBleAccountAuth, corosWatchKeyId, formatCorosWatchKeyId } = require("../dist-electron/corosBleAuth.js");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const userId = "123456789012345678";
const appEncKey = "0123456789abcdef";
const privateDer = privateKey.export({ format: "der", type: "pkcs1" }).toString("base64");
const publicDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const wrap = text => text.match(/.{1,64}/g).join("\n") + "\n";
function fixture(options = {}) {
  const info = { privateKey: wrap(privateDer), publicKey: wrap(publicDer), userId, ...options.keyInfo };
  const clear = Buffer.from(JSON.stringify(info).replace(`"userId":"${userId}"`, `"userId":${userId}`));
  for (let i = 0; i < clear.length; i++) clear[i] ^= Buffer.from(appEncKey)[i % 16];
  const cipher = createCipheriv("aes-128-cbc", Buffer.from(appEncKey), Buffer.from("weloop3_2015_03#"));
  return { userId, unit: 0, userProfile: { dataCollectSwitch: 131342 }, appEncKey,
    userKey: Buffer.concat([cipher.update(clear), cipher.final()]).toString("base64"), ...options.login };
}

const decoded = decodeCorosBleLoginKey(fixture(), userId);
assert.equal(decoded.accountUserId, userId, "account IDs beyond JS integer precision are retained exactly");
assert.equal(decoded.privateKeyDer, privateDer);
const credential = createCorosLoginCredential(decoded, "COROS PACE Pro TEST");
const provider = new CorosBleAccountAuth(credential, credential.deviceName);
const base = provider.initialPayload(1234);
assert.equal(base[10], 0, "English language ID matches the official PACE Pro bind");
assert.equal(base[11] & 0x20, 0x20);
assert.equal(base[11] & 0x0c, 0, "a connection does not activate/reset the watch or modify map support");
assert.equal(base.readUInt32LE(12), 131342, "use account data-collection switches rather than a captured profile");
for (const nonce of [Buffer.from("test"), Buffer.from("next")]) {
  const challenge = Buffer.alloc(17); challenge[0] = 5; challenge[9] = 5; nonce.copy(challenge, 11);
  const payload = provider.authenticatedPayload(base, challenge);
  assert.equal(payload.readBigUInt64LE(281), BigInt(userId));
  assert.equal(verify("sha256", Buffer.concat([nonce, payload.subarray(281,289)]),
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING }, payload.subarray(25,281)), true);
}
for (const bad of [
  fixture({ login: { userId: "2" } }), fixture({ keyInfo: { userId: "2" } }),
  fixture({ login: { appEncKey: "wrong" } }), fixture({ login: { userKey: "bad secret" } }),
  fixture({ login: { userId: Number(userId) } }), fixture({ login: { unit: 9 } }),
  fixture({ login: { userProfile: {} } }), fixture({ keyInfo: { privateKey: "secret-fragment" } }),
  fixture({ keyInfo: { publicKey: generateKeyPairSync("rsa", {modulusLength:2048}).publicKey.export({format:"der",type:"spki"}).toString("base64") } }),
  fixture({ keyInfo: { privateKey: generateKeyPairSync("rsa", {modulusLength:1024}).privateKey.export({format:"der",type:"pkcs1"}).toString("base64") } })
]) assert.throws(() => decodeCorosBleLoginKey(bad, userId), error => {
  assert.equal(error.message.includes("secret-fragment"), false);
  assert.equal(error.message.includes(privateDer.slice(100,120)), false);
  return /valid watch account key/.test(error.message);
});
// The key JSON's createTime (Unix seconds, as the live API sends it) is when COROS issued the key.
// It is optional: a missing or unbelievable value never stops the key being saved.
const ISSUED = 1_760_000_000;
assert.equal(decoded.issuedAt, undefined);
assert.equal(decodeCorosBleLoginKey(fixture({ keyInfo: { createTime: ISSUED, createTimeAsDateTime: "2025-10-09 08:53:20" } }), userId).issuedAt, ISSUED * 1000);
assert.equal(decodeCorosBleLoginKey(fixture({ keyInfo: { createTime: String(ISSUED) } }), userId).issuedAt, ISSUED * 1000);
for (const createTime of [1_000_000, Math.floor(Date.now() / 1000) + 3 * 86_400, "soon", -1, 1.5, null, {}]) {
  const key = decodeCorosBleLoginKey(fixture({ keyInfo: { createTime } }), userId);
  assert.equal(key.issuedAt, undefined);
  assert.equal(key.privateKeyDer, privateDer, "the key itself is still saved");
}
assert.equal(maskCorosEmail("kim@example.net"), "ki•••@example.net");
assert.equal(maskCorosEmail("ab@x.io"), "a•••@x.io");
assert.equal(maskCorosEmail(" runner@example.com "), "ru•••@example.com");
for (const bad of ["", "no-at", "a@b@c", undefined, 7]) assert.equal(maskCorosEmail(bad), undefined);
// The summary carries no key material; "last used" and problems count only for the key ID they were recorded with.
const keyId = formatCorosWatchKeyId(corosWatchKeyId(publicKey));
const at = Date.UTC(2026, 9, 20, 7, 2);
const plain = summarizeCorosBleLoginKey(decoded, undefined);
assert.deepEqual(plain, { keyId, accountId: "•••• 5678" }, "a key saved by 0.1.57 has no saved time, issue time or email");
let check = nextWatchKeyCheck(undefined, "ok", "COROS PACE 4 1A2B", keyId, at);
assert.deepEqual(summarizeCorosBleLoginKey(decoded, check).lastUsed, { at, watch: "COROS PACE 4 1A2B" });
assert.equal(summarizeCorosBleLoginKey(decoded, nextWatchKeyCheck(undefined, "ok", "COROS PACE 4", "0000", at)).lastUsed, undefined);
check = nextWatchKeyCheck(check, "mismatch", "COROS PACE 4 1A2B", keyId, at + 60_000);
assert.deepEqual(summarizeCorosBleLoginKey(decoded, check).problem, { at: at + 60_000, watch: "COROS PACE 4 1A2B", result: "mismatch" });
assert.equal(summarizeCorosBleLoginKey(decoded, check).lastUsed.at, at, "a problem keeps the last success");
check = nextWatchKeyCheck(check, "ok", "COROS PACE 4 1A2B", keyId, at + 120_000);
assert.equal(summarizeCorosBleLoginKey(decoded, check).problem, undefined, "a success clears the problem");
for (const broken of ["{", "null", JSON.stringify({ lastUsed: { at: "x", watch: 1, keyId } }), JSON.stringify({ problem: { at, watch: "w", keyId, result: "other" } })]) {
  assert.deepEqual(summarizeCorosBleLoginKey(decoded, broken), plain);
}
const full = summarizeCorosBleLoginKey({ ...decoded, savedAt: at, issuedAt: ISSUED * 1000, accountEmail: "runner@example.com" }, check);
assert.equal(full.accountEmail, "ru•••@example.com");
assert.equal(full.savedAt, at); assert.equal(full.issuedAt, ISSUED * 1000);
assert.equal(JSON.stringify(full).includes(privateDer.slice(40, 80)), false);
// CorosLink 0.1.57 reads a key with the new optional fields unchanged: still version 1.
const withMetadata = { ...decoded, savedAt: at, issuedAt: ISSUED * 1000, accountEmail: "runner@example.com" };
assert.equal(withMetadata.version, 1);
assert.equal(createCorosLoginCredential(withMetadata, "COROS PACE 4 TEST").bindProfile, createCorosLoginCredential(decoded, "COROS PACE 4 TEST").bindProfile);

// Every COROS watch uses the same check-bind (tested on PACE Pro); only non-COROS devices are refused.
assert.equal(createCorosLoginCredential(decoded, "COROS PACE 3 TEST").deviceName, "COROS PACE 3 TEST");
assert.equal(createCorosLoginCredential(decoded, "COROS APEX 4 81D0").deviceName, "COROS APEX 4 81D0");
assert.throws(() => createCorosLoginCredential(decoded, "Garmin Forerunner"), /needs a COROS watch/);

// Public mobile login integration: regional routing, session-conflict retry,
// encrypted persistence, account switches, independent Bluetooth key lifetime,
// and explicit saved-account login.
const filename = path.resolve("dist-electron/corosWatchfaceService.js");
const serviceRequire = createRequire(filename);
const settings = new Map();
const calls = [];
let secureStorage = true, savedCredentials = null, responseData = fixture({ keyInfo: { createTime: ISSUED } }), rejected = false;
let firstConflict = true;
let releaseResponse;
let expiredMobileSession = false;
function loadService() {
const exports = {};
vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
  exports, Buffer, console, URL, FormData, Date, Intl, Error, process,
  fetch: async (input, init) => {
    const url = new URL(input); const body = JSON.parse(init.body); calls.push({url,body});
    if (url.pathname === "/coros/user/profile") {
      assert.equal(expiredMobileSession, true);
      return Response.json({result:"1019"});
    }
    assert.equal(url.pathname, "/coros/user/login");
    assert.equal(body.appKey.length, 16);
    assert.equal(body.clientType, 1);
    if (rejected) return Response.json({ result: "1030", message: "Login rejected" });
    if (firstConflict && body.checkStatus === 1) {firstConflict = false; return Response.json({result:"1115"});}
    if (releaseResponse === "hold") await new Promise(resolve => { releaseResponse = resolve; });
    const raw = JSON.stringify({result:"0000",data:{accessToken:"synthetic-token",...responseData}})
      .replace(`"userId":"${responseData.userId}"`, `"userId":${responseData.userId}`);
    return new Response(raw);
  },
  require(id) {
    if (id === "electron") return { app: { getPath: () => "/unused" }, nativeImage: {}, safeStorage: {
      isEncryptionAvailable: () => secureStorage,
      encryptString: text => Buffer.from(`encrypted:${text}`),
      decryptString: bytes => bytes.toString().slice(10)
    }};
    if (id === "./database") return { getSetting: key => settings.get(key),
      setSetting: (key,value) => settings.set(key,value), deleteSettings: keys => keys.forEach(key => settings.delete(key)) };
    if (id === "./corosCredentialStore") return { hashCorosPassword: () => "0123456789abcdef0123456789abcdef",
      getStoredCorosCredentials: () => savedCredentials,
      storeCorosCredentials: (account,pwdHash) => { savedCredentials = {account,pwdHash}; },
      clearStoredCorosCredentials: () => { savedCredentials = null; } };
    return serviceRequire(id);
  }
}, { filename });
return exports;
}
const exports = loadService();

settings.set("coros.ble.accountAuth", "old-import");
const status = await exports.loginCorosWatchfaces("runner@example.com", "synthetic-password", "eu", true);
assert.equal(status.authenticated, true);
assert.equal(status.watchAuthenticationAvailable, true);
assert.equal(status.watchAuthenticationError, undefined);
assert.equal(calls.length, 2, "complete the official 1115 checkStatus flow");
assert.equal(calls[0].url.origin, "https://apieu.coros.com");
assert.equal(calls[1].body.checkStatus, 0);
assert.equal(settings.has("coros.ble.accountAuth"), false, "normal login supersedes imported credentials");
const savedKey = settings.get(COROS_BLE_LOGIN_KEY_SETTING);
const stored = JSON.parse(Buffer.from(savedKey, "base64").toString().slice(10));
assert.equal(stored.privateKeyDer, privateDer);
assert.equal(savedKey.includes(privateDer), false);
assert.equal(JSON.stringify(status).includes(privateDer), false);
assert.equal(JSON.stringify(status).includes(appEncKey), false);
assert.equal(JSON.stringify(status).includes("synthetic-token"), false);
// Saved with when, from which account and when COROS issued it, all inside the encrypted value.
assert.equal(stored.version, 1);
assert.equal(stored.accountEmail, "runner@example.com");
assert.ok(Math.abs(stored.savedAt - Date.now()) < 60_000);
assert.equal(stored.issuedAt, ISSUED * 1000);
assert.equal(savedKey.includes("runner@example.com"), false);
assert.deepEqual(Object.keys(status.watchKey).sort(), ["accountEmail", "accountId", "issuedAt", "keyId", "savedAt"]);
assert.equal(status.watchKey.accountEmail, "ru•••@example.com");
assert.equal(status.watchKey.accountId, "•••• 5678");
assert.equal(status.watchKey.keyId, keyId);
assert.equal(status.watchKey.savedAt, stored.savedAt);

rejected = true;
await assert.rejects(exports.loginCorosWatchfaces("other@example.com", "wrong", "us"), /Login rejected/);
assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), savedKey, "rejected login must preserve the current account");
rejected = false;
responseData = {userId:"2",unit:0,userProfile:{dataCollectSwitch:0}};
const missing = await exports.loginCorosWatchfaces("other@example.com", "new-password", "us");
assert.equal(missing.authenticated, true, "catalog login remains available if watch auth is omitted");
assert.equal(missing.watchAuthenticationAvailable, false);
assert.match(missing.watchAuthenticationError, /valid watch account key/);
assert.equal(settings.has(COROS_BLE_LOGIN_KEY_SETTING), false, "an account switch cannot reuse the previous account key");

exports.logoutCorosWatchfaces();
responseData = fixture();
savedCredentials = {account:"runner@example.com",pwdHash:"0123456789abcdef0123456789abcdef"};
settings.set("trainingHub.baseUrl", "https://teamcnapi.coros.com");
const before = calls.length;
const signedOut = exports.getCorosWatchfaceStatus();
assert.equal(signedOut.authenticated, false);
assert.equal(signedOut.savedCredentialsAvailable, true);
assert.equal(signedOut.suggestedRegion, "cn");
assert.equal(calls.length, before, "checking status does not sign in with saved credentials");
assert.equal(settings.has(COROS_BLE_LOGIN_KEY_SETTING), false, "remembered credentials do not restore a missing key");
await exports.loginCorosWatchfacesWithSavedCredentials("cn");
assert.equal(calls.length, before+1, "the explicit saved-account sign-in retrieves the key");
assert.equal(calls.at(-1).url.origin, "https://apicn.coros.com");
assert.equal(exports.getCorosWatchfaceStatus().watchAuthenticationAvailable, true);
exports.getCorosWatchfaceStatus();
assert.equal(calls.length, before+1, "checking an existing session does not log in again");
const retainedKey = settings.get(COROS_BLE_LOGIN_KEY_SETTING);
const loggedOut = exports.logoutCorosWatchfaces();
assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), retainedKey, "cloud logout preserves the encrypted Bluetooth key");
assert.equal(settings.has("watchfaces.mobileSession"), false);
assert.equal(loggedOut.authenticated, false);
assert.equal(loggedOut.watchAuthenticationAvailable, true, "Bluetooth key availability does not require cloud sign-in");
await assert.rejects(exports.queryCorosGear(), /Sign in to your COROS mobile account/);
assert.equal(calls.length, before+1, "cloud requests remain gated after logout without silently signing in");
savedCredentials = null;
await assert.rejects(exports.loginCorosWatchfacesWithSavedCredentials("cn"), /No saved COROS credentials/);
assert.equal(calls.length, before+1, "saved-account sign-in needs remembered credentials");
const restarted = loadService();
const afterRestart = restarted.getCorosWatchfaceStatus();
assert.equal(afterRestart.authenticated, false);
assert.equal(afterRestart.savedCredentialsAvailable, false);
assert.equal(afterRestart.watchAuthenticationAvailable, true, "a new app process can use the saved key without a session or password");
assert.equal(calls.length, before+1, "restoring Bluetooth key availability does not make network requests");

// A login that does not remember the password still saves the Bluetooth key.
await exports.loginCorosWatchfaces("runner@example.com", "synthetic-password", "us", false);
assert.equal(savedCredentials, null);
const keyBeforeExpiry = settings.get(COROS_BLE_LOGIN_KEY_SETTING);
expiredMobileSession = true;
await assert.rejects(exports.listCorosPairedDevices(), /mobile session expired/);
assert.equal(settings.has("watchfaces.mobileSession"), false);
assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), keyBeforeExpiry, "cloud-session expiry preserves the encrypted Bluetooth key");
assert.equal(exports.getCorosWatchfaceStatus().authenticated, false);
assert.equal(exports.getCorosWatchfaceStatus().watchAuthenticationAvailable, true);
const afterExpiry = calls.length;
exports.logoutCorosWatchfaces();
assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), keyBeforeExpiry, "logout without remembered credentials preserves Bluetooth access");
await assert.rejects(exports.queryCorosGear(), /Sign in to your COROS mobile account/);
assert.equal(calls.length, afterExpiry, "an expired session does not cause automatic login");
expiredMobileSession = false;

releaseResponse = "hold";
responseData = fixture({keyInfo:{userId:"2"},login:{userId:"2"}});
const pendingLogin = exports.loginCorosWatchfaces("runner@example.com", "synthetic-password", "us");
exports.logoutCorosWatchfaces();
releaseResponse();
await assert.rejects(pendingLogin, /sign-in changed/);
assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), keyBeforeExpiry, "logout prevents an in-flight login from replacing the retained key");
assert.equal(settings.has("watchfaces.mobileSession"), false, "an in-flight login cannot restore a signed-out cloud session");
releaseResponse = undefined;
responseData = fixture();

// A key saved by 0.1.57 (no metadata) is still shown and used; its saved time is unknown.
settings.set(COROS_BLE_LOGIN_KEY_SETTING, Buffer.from("encrypted:" + JSON.stringify({ version: 1, accountUserId: userId,
  privateKeyDer: privateDer, unit: 0, dataCollectSwitch: 131342 })).toString("base64"));
const legacy = exports.getCorosWatchfaceStatus();
assert.equal(legacy.watchAuthenticationAvailable, true);
assert.deepEqual(legacy.watchKey, { keyId, accountId: "•••• 5678" });
settings.set(COROS_WATCH_KEY_CHECK_SETTING, nextWatchKeyCheck(undefined, "ok", "COROS PACE 4 1A2B", keyId, at));
assert.deepEqual(exports.getCorosWatchfaceStatus().watchKey.lastUsed, { at, watch: "COROS PACE 4 1A2B" }, "the status follows a new check record");
const forgotten = exports.forgetCorosWatchKey();
assert.equal(forgotten.watchAuthenticationAvailable, false);
assert.equal(forgotten.watchKey, undefined);
assert.equal(settings.has(COROS_WATCH_KEY_CHECK_SETTING), false, "removing the key also removes where it was used");

secureStorage = false;
const unavailable = await exports.loginCorosWatchfaces("runner@example.com", "synthetic-password", "us");
assert.equal(unavailable.watchAuthenticationAvailable, false);
assert.match(unavailable.watchAuthenticationError, /OS secure storage/);
assert.equal(settings.has(COROS_BLE_LOGIN_KEY_SETTING), false, "keys never fall back to plaintext storage");
console.log("COROS login key decryption, account identity, fresh signing, regional login, encrypted persistence, account switching, logout, expiry, and offline key restoration passed.");

// ----- Watch key backup: a passphrase-protected .coroswatchkey file, restored on this or another computer -----
const os = await import("node:os");
const backupModule = require("../dist-electron/corosWatchKeyBackup.js");
const { registerCorosWatchKeyBackupIpc } = require("../dist-electron/corosWatchKeyBackupIpc.js");
const { isExpectedError } = require("../dist-electron/diagnosticsLog.js");
const work = fs.mkdtempSync(path.join(os.tmpdir(), "coroslink-watch-key-backup-"));
const passphrase = "correct horse battery staple";
const storedKey = () => JSON.parse(Buffer.from(settings.get(COROS_BLE_LOGIN_KEY_SETTING), "base64").toString().slice(10));
const saveKey = key => settings.set(COROS_BLE_LOGIN_KEY_SETTING, Buffer.from("encrypted:" + JSON.stringify(key)).toString("base64"));
const sessionFor = id => settings.set("watchfaces.mobileSession", Buffer.from("encrypted:" + JSON.stringify({ accessToken: "synthetic-token", userId: id, region: "us" })).toString("base64"));
const noKeyMaterial = (value, label) => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const secret of [privateDer.slice(100, 140), publicDer.slice(100, 140), passphrase, "runner@example.com", "synthetic-token", userId]) {
    assert.equal(text.includes(secret), false, `${label} must not contain ${secret.slice(0, 12)}…`);
  }
};
try {
  secureStorage = true;
  const fresh = loadService();
  const original = { ...decoded, savedAt: at, issuedAt: ISSUED * 1000, accountEmail: "runner@example.com" };
  saveKey(original);
  settings.set(COROS_WATCH_KEY_CHECK_SETTING, nextWatchKeyCheck(undefined, "ok", "COROS PACE 4 1A2B", keyId, at));
  settings.delete("watchfaces.mobileSession");

  // Round trip: the exact key (account, DER, units, data switch, issue time, email) comes back; savedAt is the import time.
  assert.throws(() => backupModule.watchKeyPassphrase("short", "export"), /at least 8 characters/);
  assert.throws(() => backupModule.watchKeyPassphrase("x".repeat(1025), "export"), /at most 1,024/);
  assert.throws(() => backupModule.watchKeyPassphrase(42, "import"), /Enter the backup passphrase/);
  assert.equal(backupModule.watchKeyPassphrase("x".repeat(1024), "export").length, 1024);
  await assert.rejects(fresh.createCorosWatchKeyBackup("short"), /at least 8 characters/);
  const backup = await fresh.createCorosWatchKeyBackup(passphrase);
  assert.equal(backup.keyId, keyId);
  noKeyMaterial(backup.data.toString("latin1"), "the encrypted file");
  assert.equal(backup.data.includes(Buffer.from(privateDer, "base64").subarray(40, 80)), false, "no raw DER either");
  assert.ok(backup.data.length < backupModule.MAX_WATCH_KEY_BACKUP_BYTES / 4);
  const again = await fresh.createCorosWatchKeyBackup(passphrase);
  assert.notEqual(again.data.subarray(15, 43).toString("hex"), backup.data.subarray(15, 43).toString("hex"), "a new salt and nonce every time");
  const reopened = await backupModule.openWatchKeyBackup(backup.data, passphrase);
  const { savedAt: _savedAt, ...expected } = original;
  assert.deepEqual(reopened, expected, "export then import gives the identical key");
  // The same passphrase typed in another normalisation form still opens it.
  const accented = await backupModule.sealWatchKeyBackup(original, "café au lait!");
  assert.equal((await backupModule.openWatchKeyBackup(accented, "café au lait!")).privateKeyDer, privateDer);

  // Identical key: nothing to replace.
  const same = await fresh.openCorosWatchKeyBackup(backup.data, passphrase);
  assert.equal(same.alreadySaved, true);
  assert.equal(same.replaces, undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(same.backup)), { keyId, accountId: "•••• 5678", accountEmail: "ru•••@example.com" });
  await assert.rejects(fresh.openCorosWatchKeyBackup(backup.data, "wrong passphrase!"), error => error.message === "Wrong passphrase or damaged file.");

  // Restore after removal (or on a new computer): stored through secure storage, saved now, last-used record cleared.
  fresh.forgetCorosWatchKey();
  settings.set(COROS_WATCH_KEY_CHECK_SETTING, nextWatchKeyCheck(undefined, "mismatch", "COROS PACE 4 1A2B", keyId, at));
  settings.set("coros.ble.accountAuth", "old-import");
  const restorable = await fresh.openCorosWatchKeyBackup(backup.data, passphrase);
  assert.equal(restorable.alreadySaved, false);
  assert.equal(restorable.replaces, undefined);
  assert.equal(restorable.signsOutOtherAccount, false);
  const beforeRestore = Date.now();
  const restoredStatus = fresh.saveRestoredCorosWatchKey(restorable);
  assert.equal(restoredStatus.watchAuthenticationAvailable, true);
  assert.equal(restoredStatus.watchKey.keyId, keyId);
  assert.equal(restoredStatus.watchKey.problem, undefined, "the old check record is gone");
  assert.equal(settings.has(COROS_WATCH_KEY_CHECK_SETTING), false);
  assert.equal(settings.has("coros.ble.accountAuth"), false);
  noKeyMaterial(restoredStatus, "the status");
  const restoredKey = storedKey();
  assert.ok(restoredKey.savedAt >= beforeRestore, "savedAt is the import time");
  assert.equal(restoredKey.issuedAt, ISSUED * 1000);
  assert.equal(restoredKey.accountEmail, "runner@example.com");
  assert.deepEqual(createCorosLoginCredential(restoredKey, "COROS PACE 4 TEST"), createCorosLoginCredential(original, "COROS PACE 4 TEST"), "it signs in to a watch exactly as before");
  assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING).includes(privateDer), false);

  // Replace flow: a different key is saved; the backup says what it replaces.
  const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const otherKey = { ...decoded, privateKeyDer: otherPair.privateKey.export({ format: "der", type: "pkcs1" }).toString("base64"), savedAt: at };
  saveKey(otherKey);
  const replacing = await fresh.openCorosWatchKeyBackup(backup.data, passphrase);
  assert.equal(replacing.alreadySaved, false);
  assert.equal(replacing.replaces.keyId, formatCorosWatchKeyId(corosWatchKeyId(otherPair.publicKey)));
  assert.equal(replacing.replaces.accountId, "•••• 5678");

  // Account mismatch: signed in to COROS as another account. Saving signs that account out,
  // so one account's key never sits beside another account's sign-in.
  sessionFor("987654321");
  const mixed = await fresh.openCorosWatchKeyBackup(backup.data, passphrase);
  assert.equal(mixed.signsOutOtherAccount, true);
  sessionFor(userId);
  // (A new process: the service keeps the session it read in memory.)
  assert.equal((await loadService().openCorosWatchKeyBackup(backup.data, passphrase)).signsOutOtherAccount, false, "the key's own account stays signed in");
  sessionFor("987654321");
  const fresh2 = loadService();
  const switched = fresh2.saveRestoredCorosWatchKey(await fresh2.openCorosWatchKeyBackup(backup.data, passphrase));
  assert.equal(switched.authenticated, false, "the other account is signed out");
  assert.equal(settings.has("watchfaces.mobileSession"), false);
  assert.equal(switched.watchKey.keyId, keyId);

  // Weak storage: refused with the existing message, nothing written.
  secureStorage = false;
  const keptValue = settings.get(COROS_BLE_LOGIN_KEY_SETTING);
  await assert.rejects(fresh2.openCorosWatchKeyBackup(backup.data, passphrase), /OS secure storage is required/);
  assert.throws(() => fresh2.saveRestoredCorosWatchKey(restorable), /OS secure storage is required/);
  await assert.rejects(fresh2.createCorosWatchKeyBackup(passphrase), /OS secure storage is required/);
  assert.equal(settings.get(COROS_BLE_LOGIN_KEY_SETTING), keptValue);
  secureStorage = true;

  // File writes: owner-only, atomic (no temp file left), and an existing file is replaced with 0600.
  const target = path.join(work, "existing.coroswatchkey");
  fs.writeFileSync(target, "old", { mode: 0o644 });
  await backupModule.writeWatchKeyBackupFile(target, backup.data);
  assert.equal(fs.statSync(target).mode & 0o777, 0o600);
  assert.deepEqual(fs.readFileSync(target), backup.data);
  assert.deepEqual(fs.readdirSync(work), ["existing.coroswatchkey"], "no temporary file is left behind");
  const huge = path.join(work, "huge.coroswatchkey");
  fs.writeFileSync(huge, Buffer.alloc(backupModule.MAX_WATCH_KEY_BACKUP_BYTES + 1));
  await assert.rejects(backupModule.readWatchKeyBackupFile(huge), error => error.message === "Wrong passphrase or damaged file.");
  fs.rmSync(huge);

  // IPC: main-window sender only, passphrase bounds, paths from dialogs only, nothing secret in results or diagnostics.
  const handlers = new Map();
  const dialogs = [];
  const notices = [];
  let nextSave = { canceled: false, filePath: path.join(work, "chosen") };
  let nextOpen = { canceled: false, filePaths: [target] };
  let nextConfirm = 1;
  const service = { status: () => fresh2.getCorosWatchfaceStatus(), createBackup: fresh2.createCorosWatchKeyBackup,
    openBackup: fresh2.openCorosWatchKeyBackup, saveRestored: fresh2.saveRestoredCorosWatchKey };
  registerCorosWatchKeyBackupIpc({
    ipc: { handle: (channel, listener) => handlers.set(channel, listener) },
    owner: event => { if (event.sender !== "main") throw new Error("Use watch key backup from CorosLink's main window."); return "window"; },
    service,
    saveDialog: async (_owner, options) => { dialogs.push(["save", options]); return nextSave; },
    openDialog: async (_owner, options) => { dialogs.push(["open", options]); return nextOpen; },
    confirm: async (_owner, options) => { dialogs.push(["confirm", options]); return nextConfirm; },
    text: source => source,
    notice: message => notices.push(message)
  });
  const main = { sender: "main" };
  const invoke = (channel, event, input) => handlers.get(channel)(event, input);
  for (const channel of ["watchfaces:backupWatchKey", "watchfaces:chooseWatchKeyBackup", "watchfaces:restoreWatchKey", "watchfaces:cancelWatchKeyRestore"]) {
    await assert.rejects(async () => invoke(channel, { sender: "webview" }, { passphrase }), /main window/, channel);
  }
  assert.equal(dialogs.length, 0, "another sender never gets a dialog");
  for (const bad of [undefined, null, {}, { passphrase: 12345678 }, { passphrase: "short" }, { passphrase: "x".repeat(1025) }]) {
    await assert.rejects(invoke("watchfaces:backupWatchKey", main, bad), /passphrase of at/);
  }
  assert.equal(dialogs.length, 0, "a bad passphrase never opens the save dialog");
  // The renderer can't name the destination: a path in the input is ignored.
  const exported = await invoke("watchfaces:backupWatchKey", main, { passphrase, filePath: path.join(work, "renderer-chosen.coroswatchkey") });
  assert.deepEqual(exported, { saved: true });
  assert.equal(dialogs[0][1].defaultPath, `coros-watch-key-${keyId.toLowerCase()}.coroswatchkey`);
  assert.deepEqual(dialogs[0][1].filters[0].extensions, ["coroswatchkey"]);
  assert.equal(fs.existsSync(path.join(work, "renderer-chosen.coroswatchkey")), false);
  const written = path.join(work, "chosen.coroswatchkey");
  assert.equal(fs.statSync(written).mode & 0o777, 0o600, "the extension is added and the file is 0600");
  nextSave = { canceled: false, filePath: path.join(work, "no-such-folder", "key.coroswatchkey") };
  await assert.rejects(invoke("watchfaces:backupWatchKey", main, { passphrase }), error => /couldn't save the watch key backup there/.test(error.message) && !error.message.includes(work));
  nextSave = { canceled: true };
  assert.deepEqual(await invoke("watchfaces:backupWatchKey", main, { passphrase }), { saved: false });

  // Restore: choose (native dialog), then the passphrase. Wrong passphrase: plain, not logged, retry allowed.
  await assert.rejects(invoke("watchfaces:restoreWatchKey", main, { passphrase }), /Choose a watch key backup first/);
  nextOpen = { canceled: false, filePaths: [written] };
  assert.deepEqual(await invoke("watchfaces:chooseWatchKeyBackup", main), { chosen: true });
  await assert.rejects(invoke("watchfaces:restoreWatchKey", main, { passphrase: "not the passphrase" }), error =>
    error.message === "Wrong passphrase or damaged file." && isExpectedError(error));
  const identical = await invoke("watchfaces:restoreWatchKey", main, { passphrase });
  assert.equal(identical.outcome, "alreadySaved", "the identical key: just say it's already saved");
  assert.equal(dialogs.filter(([kind]) => kind === "confirm").length, 0, "no confirmation for the identical key");
  await assert.rejects(invoke("watchfaces:restoreWatchKey", main, { passphrase }), /Choose a watch key backup first/, "the chosen file is dropped after use");

  // A different saved key: confirm first, showing both key IDs and accounts. Cancel keeps it.
  saveKey(otherKey);
  const otherKeyId = formatCorosWatchKeyId(corosWatchKeyId(otherPair.publicKey));
  await invoke("watchfaces:chooseWatchKeyBackup", main);
  nextConfirm = 0;
  const cancelled = await invoke("watchfaces:restoreWatchKey", main, { passphrase });
  assert.equal(cancelled.outcome, "cancelled");
  assert.equal(storedKey().privateKeyDer, otherKey.privateKeyDer, "cancel keeps the saved key");
  const confirmation = dialogs.findLast(([kind]) => kind === "confirm")[1];
  assert.equal(confirmation.message, "Replace the saved watch key?");
  assert.match(confirmation.detail, new RegExp(`Saved now: key ${otherKeyId}, COROS account •••• 5678\\.`));
  assert.match(confirmation.detail, new RegExp(`In the backup: key ${keyId}, ru•••@example\\.com\\.`));
  assert.deepEqual(confirmation.buttons, ["Cancel", "Replace watch key"]);
  await invoke("watchfaces:chooseWatchKeyBackup", main);
  nextConfirm = 1;
  const replaced = await invoke("watchfaces:restoreWatchKey", main, { passphrase });
  assert.equal(replaced.outcome, "restored");
  assert.equal(storedKey().privateKeyDer, privateDer);
  // Another account signed in: the warning says restoring signs it out.
  fresh2.forgetCorosWatchKey();
  sessionFor("987654321");
  await invoke("watchfaces:chooseWatchKeyBackup", main);
  const crossAccount = await invoke("watchfaces:restoreWatchKey", main, { passphrase });
  const warning = dialogs.findLast(([kind]) => kind === "confirm")[1];
  assert.equal(warning.message, "Restore a watch key from another COROS account?");
  assert.match(warning.detail, /signs you out/);
  assert.equal(crossAccount.status.authenticated, false);
  assert.equal(crossAccount.outcome, "restored");

  // The wrong file, an oversized one, or one that can't be read: a plain message, no path, not logged.
  const notBackup = path.join(work, "photo.coroswatchkey");
  fs.writeFileSync(notBackup, Buffer.alloc(200, 0x41));
  nextOpen = { canceled: false, filePaths: [notBackup] };
  await assert.rejects(invoke("watchfaces:chooseWatchKeyBackup", main), error => /isn't a CorosLink watch key backup/.test(error.message) && isExpectedError(error));
  fs.writeFileSync(notBackup, Buffer.concat([backup.data, Buffer.alloc(backupModule.MAX_WATCH_KEY_BACKUP_BYTES)]));
  await assert.rejects(invoke("watchfaces:chooseWatchKeyBackup", main), error => error.message === "Wrong passphrase or damaged file.");
  nextOpen = { canceled: false, filePaths: [path.join(work, "missing.coroswatchkey")] };
  await assert.rejects(invoke("watchfaces:chooseWatchKeyBackup", main), error => error.message === "Wrong passphrase or damaged file." && !error.message.includes(work));
  nextOpen = { canceled: true, filePaths: [] };
  assert.deepEqual(await invoke("watchfaces:chooseWatchKeyBackup", main), { chosen: false });

  // Diagnostics: what happened and the four-digit key ID only.
  assert.deepEqual(notices, [`Watch key backup exported (key ${keyId}).`, `Watch key imported from a backup (key ${keyId}).`, `Watch key imported from a backup (key ${keyId}).`]);
  for (const result of [exported, identical, cancelled, replaced, crossAccount]) noKeyMaterial(result, "an IPC result");
  noKeyMaterial(notices, "diagnostics");
  noKeyMaterial(dialogs.map(([, options]) => options), "dialog text");
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
console.log("Watch key backup: round trip, normalised passphrases, identical and replaced keys, account mismatch sign-out, secure storage refusal, 0600 atomic files, main-window IPC, input bounds and leak checks passed.");

