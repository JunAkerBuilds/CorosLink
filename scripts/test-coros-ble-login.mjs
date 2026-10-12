import assert from "node:assert/strict";
import { constants, createCipheriv, generateKeyPairSync, verify } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { decodeCorosBleLoginKey, createCorosLoginCredential, COROS_BLE_LOGIN_KEY_SETTING } = require("../dist-electron/corosBleLoginKey.js");
const { CorosBleAccountAuth } = require("../dist-electron/corosBleAuth.js");
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
let secureStorage = true, savedCredentials = null, responseData = fixture(), rejected = false;
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

secureStorage = false;
const unavailable = await exports.loginCorosWatchfaces("runner@example.com", "synthetic-password", "us");
assert.equal(unavailable.watchAuthenticationAvailable, false);
assert.match(unavailable.watchAuthenticationError, /OS secure storage/);
assert.equal(settings.has(COROS_BLE_LOGIN_KEY_SETTING), false, "keys never fall back to plaintext storage");
console.log("COROS login key decryption, account identity, fresh signing, regional login, encrypted persistence, account switching, logout, expiry, and offline key restoration passed.");
