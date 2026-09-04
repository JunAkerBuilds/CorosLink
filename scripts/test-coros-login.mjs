import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import { mock } from "node:test";
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
  buildCorosTwoFactorVerifyPayload,
  loginTrainingHub,
  reconnectTrainingHub,
  verifyTrainingHubTwoFactor,
  resendTrainingHubTwoFactorCode,
  cancelTrainingHubTwoFactor
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
  undefined,
  "development and packaged builds must both use the production login API"
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

// Exercise the public login flow without opening the user's database, accessing
// OS credentials, or making real COROS requests.
const require = createRequire(import.meta.url);
const database = require(path.join(repoRoot, "dist-electron/database.js"));
const credentials = require(path.join(repoRoot, "dist-electron/corosCredentialStore.js"));
const settings = new Map();
let savedCredentials = null;
mock.method(database, "getSetting", (key) => settings.get(key));
mock.method(database, "setSetting", (key, value) => settings.set(key, value));
mock.method(credentials, "getStoredCorosCredentials", () => savedCredentials);
mock.method(credentials, "storeCorosCredentials", (account, pwdHash) => {
  savedCredentials = { account, pwdHash };
  return true;
});
mock.method(credentials, "clearStoredCorosCredentials", () => {
  savedCredentials = null;
});
let handleRequest;
const requests = [];
mock.method(globalThis, "fetch", async (input, init = {}) => {
  const request = {
    url: new URL(String(input)),
    method: init.method ?? "GET",
    headers: init.headers,
    body: init.body ? JSON.parse(init.body) : undefined
  };
  assert.equal(request.headers?.Cookie, undefined);
  requests.push(request);
  return handleRequest(request);
});

const success = (data) => Response.json({ result: "0000", data });
const failure = (result, message) => Response.json({ result, message });
const account = "runner@example.com";
const password = "test-password";
const regions = [
  ["3", "https://teameuapi.coros.com"],
  [1, "https://teamapi.coros.com"],
  [2, "https://teamcnapi.coros.com"],
  [4, "https://teamsgapi.coros.com"]
];

try {
  for (const [regionId, baseUrl] of regions) {
    settings.clear();
    savedCredentials = null;
    requests.length = 0;
    handleRequest = ({ url, method, body }) => {
      if (url.pathname === "/account/login") {
        assert.equal(url.origin, "https://teamapi.coros.com");
        assert.equal(method, "POST");
        assert.equal(body.account, account);
        assert.equal(bcrypt.compareSync(credentials.hashCorosPassword(password), body.p1), true);
        assert.equal(body.rmbm, 1);
        return success({
          twoFactorRequired: true,
          loginTicket: "ticket-123",
          appKey: "app-key-123",
          // The verification account is an opaque server value, not the email.
          account: "encrypted-account",
          accountType2fa: 2,
          regionId,
          userId: "42"
        });
      }
      assert.equal(url.origin, baseUrl, "2FA and session requests must use the account region");
      if (url.pathname === "/account/captcha") {
        assert.deepEqual(body, {
          account: "encrypted-account", accountType: "2", codeType: 20, lengthType: 2
        });
        return success();
      }
      if (url.pathname === "/account/2fa/login/verify") {
        if (body.code === "000000") return failure("1042", "Invalid verification code");
        assert.deepEqual(body, {
          loginTicket: "ticket-123", appKey: "app-key-123", code: "123456"
        });
        return success({ accessToken: "test-token" });
      }
      if (url.pathname === "/activity/query") return success({ dataList: [] });
      if (url.pathname === "/account/query") return success({ userId: "42" });
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await loginTrainingHub(` ${account} `, password, true);
    assert.equal(result.twoFactorRequired, true);
    assert.equal(result.email, account, "show the email, not the encrypted verification identifier");
    assert.equal(result.status.authenticated, false);
    assert.equal(savedCredentials, null, "credentials are saved only after verification");
    await resendTrainingHubTwoFactorCode();
    assert.equal(requests.filter(({ url }) => url.pathname === "/account/captcha").length, 2);
    await assert.rejects(verifyTrainingHubTwoFactor("000000"), /COROS verification failed \(1042\)/);
    assert.equal(settings.size, 0, "failed verification must not persist a session");
    const status = await verifyTrainingHubTwoFactor(" 123456 ");
    assert.equal(status.authenticated, true);
    assert.equal(status.baseUrl, baseUrl);
    assert.equal(status.regionId, String(regionId));
    assert.equal(savedCredentials.account, account, "reconnect must keep the original login email");
    assert.equal(savedCredentials.pwdHash, credentials.hashCorosPassword(password));
    await assert.rejects(verifyTrainingHubTwoFactor("123456"), /No COROS verification is in progress/);

    settings.clear();
    const reconnected = await reconnectTrainingHub();
    assert.equal(reconnected.twoFactorRequired, true);
    cancelTrainingHubTwoFactor();
    await assert.rejects(resendTrainingHubTwoFactorCode(), /No COROS verification is in progress/);
  }

  // Accounts without 2FA also follow the advertised region immediately.
  for (const [regionId, baseUrl] of regions) {
    settings.clear();
    handleRequest = ({ url, body }) => {
      if (url.pathname === "/account/login") {
        assert.equal(body.rmbm, undefined);
        return success({ accessToken: "test-token", userId: "42", regionId });
      }
      assert.equal(url.origin, baseUrl);
      if (url.pathname === "/activity/query") return success({ dataList: [] });
      if (url.pathname === "/account/query") return success({ userId: "42" });
      throw new Error(`Unexpected request: ${url}`);
    };
    const result = await loginTrainingHub(account, password, false);
    assert.equal(result.twoFactorRequired, false);
    assert.equal(result.status.baseUrl, baseUrl);
    assert.equal(savedCredentials, null, "opting out clears remembered credentials");
  }

  // Regional fallback must include the current Singapore endpoint. Temporary
  // failures from the account/activity probes must not reset it to the US.
  settings.clear();
  requests.length = 0;
  handleRequest = ({ url }) => {
    if (url.pathname === "/account/login") {
      return url.origin === "https://teamsgapi.coros.com"
        ? success({ accessToken: "sg-token", userId: "42", regionId: 4 })
        : failure("1030", "Incorrect user name or password");
    }
    throw new Error("Temporary network failure");
  };
  const singapore = await loginTrainingHub(account, password);
  assert.equal(singapore.status.baseUrl, "https://teamsgapi.coros.com");
  assert.deepEqual(
    requests.filter(({ url }) => url.pathname === "/account/login").map(({ url }) => url.origin),
    ["https://teamapi.coros.com", "https://teameuapi.coros.com", "https://teamcnapi.coros.com", "https://teamsgapi.coros.com"]
  );

  // If COROS does not supply a known region, keep the successful login host.
  for (const regionId of [undefined, 99]) {
    settings.clear();
    handleRequest = ({ url }) => {
      if (url.pathname === "/account/login") {
        return url.origin === "https://teameuapi.coros.com"
          ? success({ accessToken: "eu-token", userId: "42", regionId })
          : failure("1030", "Incorrect user name or password");
      }
      assert.equal(url.origin, "https://teameuapi.coros.com");
      return success({ userId: "42", dataList: [] });
    };
    const result = await loginTrainingHub(account, password);
    assert.equal(result.status.baseUrl, "https://teameuapi.coros.com");
  }

  // Identify the failing step when the API returns the reported error. Do not
  // save credentials or leave a usable challenge after the code request fails.
  settings.clear();
  handleRequest = ({ url }) => {
    if (url.pathname === "/account/login") {
      return success({ loginTicket: "ticket", appKey: "key", regionId: 3 });
    }
    assert.equal(url.origin, "https://teameuapi.coros.com");
    assert.equal(url.pathname, "/account/captcha");
    return failure("1031", "Parameter input error");
  };
  await assert.rejects(
    loginTrainingHub(account, password, true),
    /COROS could not send a verification code \(1031\): Parameter input error/
  );
  assert.equal(savedCredentials, null);
  assert.equal(settings.size, 0);
  await assert.rejects(verifyTrainingHubTwoFactor("123456"), /No COROS verification is in progress/);

  // Preserve a useful rejection instead of the last region's generic error.
  for (const lastRegionOffline of [false, true]) {
    handleRequest = ({ url }) => {
      assert.equal(url.pathname, "/account/login");
      if (url.origin === "https://teameuapi.coros.com") {
        return failure("1030", "Incorrect user name or password");
      }
      if (lastRegionOffline && url.origin === "https://teamsgapi.coros.com") {
        throw new Error("fetch failed");
      }
      return failure("1031", "Parameter input error");
    };
    await assert.rejects(
      loginTrainingHub(account, password),
      /COROS password login failed \(1030\): Incorrect user name or password/
    );
  }

  handleRequest = () => failure("1031", "Parameter input error");
  await assert.rejects(
    loginTrainingHub(account, password),
    /COROS password login failed \(1031\): Parameter input error/
  );
  handleRequest = () => { throw new Error("fetch failed"); };
  await assert.rejects(loginTrainingHub(account, password), /fetch failed/);
} finally {
  cancelTrainingHubTwoFactor();
  mock.restoreAll();
}

console.log("COROS login protocol and flow tests passed");
