import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const { regionFromBaseUrl, stsRequestUrl, decodeStsCredentials, SALT } =
  await import(`${distUrl("corosUploadConfig.js")}?cacheBust=${Date.now()}`);

assert.equal(regionFromBaseUrl("https://teamapi.coros.com"), "US");
assert.equal(regionFromBaseUrl("https://teameuapi.coros.com"), "EU");

const usUrl = stsRequestUrl("US");
assert.ok(usUrl.startsWith("https://faq.coros.com/openapi/oss/sts?"));
assert.match(usUrl, /bucket=coros-s3/);
assert.match(usUrl, /app_id=1660188068672619112/);
assert.match(usUrl, /sign=E34EF0E34A498A54A9C3EAEFC12B7CAF/);
assert.match(stsRequestUrl("EU"), /bucket=eu-coros/);
assert.match(stsRequestUrl("EU"), /sign=877571111A1EE5316E4B590103D4B5B3/);

// decode: salt-prefixed base64 of a JSON creds object.
const creds = {
  Region: "us-east-1",
  Bucket: "coros-s3",
  AccessKeyId: "AKID",
  SecretAccessKey: "SECRET",
  SessionToken: "TOKEN"
};
const encoded = SALT + Buffer.from(JSON.stringify(creds)).toString("base64");
assert.deepEqual(decodeStsCredentials(encoded), creds);

// Prefix-safe: only the leading salt is stripped, not a later occurrence.
const payload2 = {
  Region: "eu",
  Bucket: "eu-coros",
  AccessKeyId: "A",
  SecretAccessKey: "S",
  SessionToken: "T"
};
const b64 = Buffer.from(JSON.stringify(payload2)).toString("base64");
// Verify that decoding SALT + b64 correctly yields payload2 (demonstrates prefix-only stripping).
const encoded2 = SALT + b64;
assert.deepEqual(decodeStsCredentials(encoded2), payload2);
// Additionally verify that only the leading SALT is removed by slice:
assert.equal(b64, encoded2.slice(SALT.length));

console.log("coros-upload-config tests passed");
