// The activity upload against a mocked fetch. Nothing here reaches COROS or AWS, and no real account is used.
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { HubSession } from "./client";
import { HubExpired, HubInvalid, HubNotWired, HubProblem, HubRefused } from "./errors";
import { activityFileOf, crc32, createStoreZip, MAYBE_SENT, decodeStsCredentials, sha256Hex, signRequest, stsRequestURL, timezoneQuarters, uploadActivityFile } from "./upload";

const session: HubSession = { accessToken: "tok-123", userId: "4242", regionId: "1", baseURL: "https://teamapi.coros.com" };
const SALT = "9y78gpoERW4lBNYL";
const creds = { Region: "us-west-2", Bucket: "coros-s3", AccessKeyId: "ASIAEXAMPLE", SecretAccessKey: "secret/Example+Key", SessionToken: "session-token-example" };
const sealed = (value: unknown = creds) => Buffer.from(JSON.stringify(value)).toString("base64") + SALT;
const text = (value: string) => new TextEncoder().encode(value);

describe("the stored zip", () => {
  it("knows the usual CRC-32", () => {
    expect(crc32(text("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("holds one stored file under its name", () => {
    const data = text("hello fit");
    const zip = createStoreZip([{ name: "abc/run.fit", data }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint16(8, true)).toBe(0); // stored
    expect(view.getUint32(14, true)).toBe(crc32(data));
    expect(view.getUint32(18, true)).toBe(data.length);
    expect(view.getUint16(26, true)).toBe(11);
    expect(new TextDecoder().decode(zip.subarray(30, 41))).toBe("abc/run.fit");
    expect(new TextDecoder().decode(zip.subarray(41, 41 + data.length))).toBe("hello fit");
    const directory = 41 + data.length, end = zip.length - 22;
    expect(view.getUint32(directory, true)).toBe(0x02014b50);
    expect(view.getUint32(directory + 42, true)).toBe(0); // the file starts the archive
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(1);
    expect(view.getUint32(end + 12, true)).toBe(46 + 11);
    expect(view.getUint32(end + 16, true)).toBe(directory);
    expect(zip.length).toBe(30 + 11 + data.length + 46 + 11 + 22);
  });
});

describe("the request signature", () => {
  it("matches AWS's own example (get-vanilla)", () => {
    const authorization = signRequest({
      method: "GET", url: "https://example.amazonaws.com/", region: "us-east-1", service: "service", accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", signedHeaders: { host: "example.amazonaws.com" }, payloadHash: sha256Hex(""), amzDate: "20150830T123600Z",
    });
    expect(authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
    );
  });
});

describe("COROS's storage credentials", () => {
  it("are asked of the region's own web app", () => {
    expect(stsRequestURL("https://teamapi.coros.com")?.href).toBe("https://t.coros.com/api/proxy/oss/sts?bucket=coros-s3&service=aws&v=2");
    expect(stsRequestURL("https://teameuapi.coros.com")?.href).toBe("https://trainingeu.coros.com/api/proxy/oss/sts?bucket=eu-coros&service=aws&v=2");
    expect(stsRequestURL("https://teamcnapi.coros.com")).toBeNull();
    expect(stsRequestURL("https://teamsgapi.coros.com")).toBeNull();
  });

  it("come as base64 JSON with the salt on the end", () => {
    expect(decodeStsCredentials(sealed())).toEqual(creds);
  });

  it("are refused when incomplete, unreadable, or naming a host that isn't a bucket", () => {
    expect(() => decodeStsCredentials("not base64 json")).toThrow(HubProblem);
    expect(() => decodeStsCredentials(sealed({ ...creds, SessionToken: "" }))).toThrow("incomplete");
    for (const Bucket of ["evil.example/x", "a.b", "coros-s3.evil.example", "UPPER", "x"]) expect(() => decodeStsCredentials(sealed({ ...creds, Bucket })), Bucket).toThrow("doesn't know");
    for (const Region of ["us-west-2.evil.example", "evil", "us-west-2/x"]) expect(() => decodeStsCredentials(sealed({ ...creds, Region })), Region).toThrow("doesn't know");
  });
});

interface Seen { url: URL; method: string; headers: Record<string, string>; body: unknown; redirect: string | undefined }

function mocked(answers: Partial<Record<"sts" | "put" | "import", () => Response>> = {}) {
  const seen: Seen[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body: init?.body, redirect: init?.redirect });
    if (url.host === "t.coros.com" || url.host === "trainingeu.coros.com") return (answers.sts ?? (() => Response.json({ code: 200, data: { credentials: sealed() } })))();
    if (url.host.endsWith(".amazonaws.com")) return (answers.put ?? (() => new Response(null, { status: 200 })))();
    return (answers.import ?? (() => Response.json({ result: "0000", message: "OK", data: { importId: 987654321 } })))();
  };
  return { seen, fetchImpl };
}

const file = { name: "clink-manual-1.tcx", bytes: text("<TrainingCenterDatabase/>") };
const now = new Date("2026-11-20T08:09:10.123Z");

describe("sending an activity file to COROS", () => {
  it("asks for credentials, puts the zip in the bucket, then registers the import", async () => {
    const { seen, fetchImpl } = mocked();
    await expect(uploadActivityFile(session, file, { timezone: 4, fetchImpl, now })).resolves.toEqual({ importId: "987654321" });
    expect(seen.map((s) => `${s.method} ${s.url.origin}${s.url.pathname}`)).toEqual([
      "GET https://t.coros.com/api/proxy/oss/sts",
      `PUT https://coros-s3.s3.us-west-2.amazonaws.com/fit_zip/4242/${createHash("md5").update(file.bytes).digest("hex")}.zip`,
      "POST https://teamapi.coros.com/activity/fit/import",
    ]);
    expect(seen.every((s) => s.redirect === "manual")).toBe(true);

    const md5 = createHash("md5").update(file.bytes).digest("hex");
    const [sts, put, registered] = seen;
    expect(sts.headers.Cookie).toBe("CPL-coros-token=tok-123");
    expect(sts.url.href).not.toContain("tok-123");

    const zip = put.body as Uint8Array;
    expect(new TextDecoder().decode(zip.subarray(30, 30 + md5.length + 1 + file.name.length))).toBe(`${md5}/${file.name}`);
    expect(put.headers["x-amz-date"]).toBe("20261120T080910Z");
    expect(put.headers["x-amz-content-sha256"]).toBe(sha256Hex(zip));
    expect(put.headers["x-amz-security-token"]).toBe(creds.SessionToken);
    expect(put.headers["Content-Type"]).toBe("application/zip");
    expect(put.headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=ASIAEXAMPLE\/20261120\/us-west-2\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
    expect(put.headers).not.toHaveProperty("accesstoken");

    expect(registered.headers.accesstoken).toBe("tok-123");
    expect(registered.headers.yfheader).toBe('{"userId":"4242"}');
    expect(JSON.parse(String((registered.body as FormData).get("jsonParameter")))).toEqual({
      source: 1, timezone: 4, bucket: "coros-s3", md5, size: zip.byteLength, object: `fit_zip/4242/${md5}.zip`, serviceName: "aws", oriFileName: file.name,
    });
  });

  it("uses the European web app and bucket for a European session", async () => {
    const { seen, fetchImpl } = mocked();
    await uploadActivityFile({ ...session, baseURL: "https://teameuapi.coros.com" }, file, { timezone: 0, fetchImpl, now });
    expect(seen[0].url.href).toBe("https://trainingeu.coros.com/api/proxy/oss/sts?bucket=eu-coros&service=aws&v=2");
    expect(seen[2].url.href).toBe("https://teameuapi.coros.com/activity/fit/import");
  });

  it("says it isn't connected for the other regions, and sends nothing", async () => {
    const { seen, fetchImpl } = mocked();
    await expect(uploadActivityFile({ ...session, baseURL: "https://teamcnapi.coros.com" }, file, { timezone: 32, fetchImpl })).rejects.toThrow(HubNotWired);
    expect(seen).toHaveLength(0);
  });

  it("never sends to a host that isn't COROS's", async () => {
    const { seen, fetchImpl } = mocked();
    await expect(uploadActivityFile({ ...session, baseURL: "https://evil.example" }, file, { timezone: 0, fetchImpl })).rejects.toThrow(HubProblem);
    expect(seen).toHaveLength(0);
  });

  it("takes only .fit and .tcx files that have something in them", async () => {
    const { seen, fetchImpl } = mocked();
    await expect(uploadActivityFile(session, { name: "route.gpx", bytes: file.bytes }, { timezone: 0, fetchImpl })).rejects.toThrow(HubInvalid);
    await expect(uploadActivityFile(session, { name: "../x.fit", bytes: file.bytes }, { timezone: 0, fetchImpl })).rejects.toThrow(HubInvalid);
    await expect(uploadActivityFile(session, { name: "a.fit", bytes: new Uint8Array(0) }, { timezone: 0, fetchImpl })).rejects.toThrow("empty");
    expect(seen).toHaveLength(0);
  });

  it("finds the session ended at the credentials step", async () => {
    for (const sts of [() => new Response("{}", { status: 401 }), () => Response.json({ code: 401, message: "unauthorized" })]) {
      const { seen, fetchImpl } = mocked({ sts });
      await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).rejects.toThrow(HubExpired);
      expect(seen).toHaveLength(1);
    }
  });

  it("finds the session ended at the import step", async () => {
    const { fetchImpl } = mocked({ import: () => Response.json({ result: "0101", message: "Access token is invalid" }) });
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).rejects.toThrow(HubExpired);
  });

  it("stops when the bucket refuses the file, and never claims an import", async () => {
    const { seen, fetchImpl } = mocked({ put: () => new Response("<Error/>", { status: 403 }) });
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).rejects.toThrow("HTTP 403");
    expect(seen).toHaveLength(2);
  });

  it("passes on COROS's refusal of the file in its own words", async () => {
    const { fetchImpl } = mocked({ import: () => Response.json({ result: "5021", message: "File parsing failed" }) });
    const failure = await uploadActivityFile(session, file, { timezone: 0, fetchImpl }).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(HubRefused);
    expect((failure as HubRefused).message).toBe("File parsing failed");
  });

  it("says so when COROS can't be reached", async () => {
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl: async () => { throw new TypeError("fetch failed"); } })).rejects.toThrow("couldn't be reached");
  });

  it("answers an empty import ID when COROS names none", async () => {
    const { fetchImpl } = mocked({ import: () => Response.json({ result: "0000", message: "OK" }) });
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).resolves.toEqual({ importId: "" });
  });
});

describe("an unconfirmed import", () => {
  it("counts an answer without a result code as taken, like the desktop app", async () => {
    const { fetchImpl } = mocked({ import: () => Response.json({ data: { importId: 77 } }) });
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).resolves.toEqual({ importId: "77" });
  });

  it("says the activity may be there already when the last step goes unanswered", async () => {
    let calls = 0;
    const { fetchImpl: inner } = mocked();
    const fetchImpl: typeof fetch = async (...args) => {
      calls += 1;
      if (calls === 3) throw new DOMException("timed out", "TimeoutError");
      return inner(...args);
    };
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl })).rejects.toThrow(MAYBE_SENT);
    const { fetchImpl: unreadable } = mocked({ import: () => new Response("<html>", { status: 200 }) });
    await expect(uploadActivityFile(session, file, { timezone: 0, fetchImpl: unreadable })).rejects.toThrow(MAYBE_SENT);
  });
});

describe("what a downloaded activity file is", () => {
  const fit = new Uint8Array([14, 16, 0, 0, 0, 0, 0, 0, 0x2e, 0x46, 0x49, 0x54, 1, 2, 3]);
  const tcx = text('\uFEFF<?xml version="1.0"?>\n<TrainingCenterDatabase xmlns="x"></TrainingCenterDatabase>');

  it("reads FIT and TCX from the bytes, not the name", () => {
    expect(activityFileOf(fit).ext).toBe("fit");
    expect(activityFileOf(tcx).ext).toBe("tcx");
  });

  it("unpacks a gzipped file first", () => {
    const zipped = new Uint8Array(gzipSync(fit));
    const out = activityFileOf(zipped);
    expect(out.ext).toBe("fit");
    expect(Array.from(out.bytes)).toEqual(Array.from(fit));
  });

  it("refuses GPX and anything else COROS would drop", () => {
    expect(() => activityFileOf(text('<?xml version="1.0"?><gpx version="1.1"></gpx>'))).toThrow(HubInvalid);
    expect(() => activityFileOf(text("<html>not found</html>"))).toThrow(HubInvalid);
    expect(() => activityFileOf(new Uint8Array([0x1f, 0x8b, 1, 2]))).toThrow(HubInvalid);
  });
});

describe("the time zone the browser sends", () => {
  it("is whole quarter hours from UTC−12 to UTC+14", () => {
    expect([timezoneQuarters(-48), timezoneQuarters(0), timezoneQuarters(23), timezoneQuarters(56)]).toEqual([-48, 0, 23, 56]);
    for (const bad of [57, -49, 1.5, "4", null, undefined, NaN]) expect(() => timezoneQuarters(bad), String(bad)).toThrow(HubInvalid);
  });
});
