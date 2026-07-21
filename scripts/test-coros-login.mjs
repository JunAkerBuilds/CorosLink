import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import bcrypt from "bcryptjs";

const repoRoot = path.resolve(import.meta.dirname, "..");
const distUrl = (file) =>
  pathToFileURL(path.join(repoRoot, "dist-electron", file)).href;

const {
  buildCorosLoginSecret,
  buildCorosLoginHeaders,
  buildCorosPasswordLoginPayload,
  buildCorosTwoFactorCodePayload,
  buildCorosTwoFactorVerifyPayload
} = await import(
  `${distUrl("trainingHubService.js")}?cacheBust=${Date.now()}`
);

const passwordDigest = "0123456789abcdef0123456789abcdef";
const secret = buildCorosLoginSecret(passwordDigest);

assert.match(secret.p1, /^\$2[aby]\$10\$/);
assert.match(secret.p2, /^\$2[aby]\$10\$/);
assert.equal(secret.p2.length, 29);
assert.equal(bcrypt.compareSync(passwordDigest, secret.p1), true);

assert.deepEqual(
  buildCorosPasswordLoginPayload("runner@example.com", secret, false),
  {
    account: "runner@example.com",
    accountType: 2,
    p1: secret.p1,
    p2: secret.p2
  }
);

assert.deepEqual(
  buildCorosPasswordLoginPayload("runner@example.com", secret, true),
  {
    account: "runner@example.com",
    accountType: 2,
    p1: secret.p1,
    p2: secret.p2,
    rmbm: 1
  }
);

assert.deepEqual(buildCorosTwoFactorCodePayload("runner@example.com", "2"), {
  account: "runner@example.com",
  codeType: 20,
  lengthType: 2,
  accountType: "2"
});

assert.deepEqual(
  buildCorosTwoFactorVerifyPayload("ticket-123", "app-key-123", "123456"),
  {
    loginTicket: "ticket-123",
    appKey: "app-key-123",
    code: "123456"
  }
);

const previousDevServerUrl = process.env.VITE_DEV_SERVER_URL;
delete process.env.VITE_DEV_SERVER_URL;
assert.equal(buildCorosLoginHeaders().Cookie, undefined);

process.env.VITE_DEV_SERVER_URL = "http://127.0.0.1:5173";
assert.equal(
  buildCorosLoginHeaders().Cookie,
  "x-app-req-env=202607/; x-app-req-dev=feature-202607-dev; CPL-coros-region=1"
);
assert.equal(
  buildCorosLoginHeaders({ suppressApiWarning: true })["X-No-Warnning"],
  "1"
);

if (previousDevServerUrl === undefined) {
  delete process.env.VITE_DEV_SERVER_URL;
} else {
  process.env.VITE_DEV_SERVER_URL = previousDevServerUrl;
}

console.log("COROS login protocol tests passed");
