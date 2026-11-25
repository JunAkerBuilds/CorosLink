// Send to COROS against a fake COROS. CorosLink's publish tests and its "Must not regress" items (replacement-checklist
// §5): the upload cap exactly 10,485,760 B (error 9021), over 10 MB PNGs recompressed losslessly toward 8 MB, the
// template ID patched as raw text beyond JS safe integers.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { decodePng } from "../../watchface/compiler/png";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import { guardFetch } from "../dataMode";
import type { Sealer } from "../secrets";
import { AccountProblem, CorosAccount } from "./corosAccount";
import {
  archiveTemplate, buildCreateLinkBody, fitWatchfaceArchiveSize, isOfficialShareUrl, LOCAL_TEMPLATE_PUBLISH_ERROR, MAX_COROS_UPLOAD_BYTES, publishToCoros,
  type CorosPublishInput,
} from "./corosShare";

const sealed: Sealer = { encrypt: async (t) => Buffer.from(`sealed:${t}`), decrypt: async (b) => ({ text: b.toString().slice(7), stale: false }) };
const TOKEN = "token-abc";
const SOURCE_ID = "478947569257513340";
const SAVED_ID = "478814257230741704";

interface Call { path: string; method: string; body?: BodyInit | null; headers: Headers }

function fakeCoros(options: { link?: string; saveResult?: string; linkResult?: string } = {}) {
  const calls: Call[] = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    calls.push({ path: u.hostname + u.pathname, method: init?.method ?? "GET", body: init?.body, headers: new Headers(init?.headers) });
    if (u.pathname === "/coros/user/login") return new Response(`{"result":"0000","data":{"accessToken":"${TOKEN}","userId":1}}`);
    if (u.pathname === "/coros/watchFaceTemplateUserCustom/saveOrUpdateV2") {
      if (options.saveResult) return new Response(`{"result":"${options.saveResult}","message":"Refused"}`);
      return new Response(`{"result":"0000","data":{"watchFaceTemplateId":${SAVED_ID}}}`);
    }
    if (u.pathname === "/coros/watchface/share/createLink") {
      if (options.linkResult) return new Response(`{"result":"${options.linkResult}","message":"Expired"}`);
      return new Response(JSON.stringify({ result: "0000", data: { url: options.link ?? "https://faq.coros.com/share/abc", expireTimestamp: Date.UTC(2026, 10, 25), previewImageUrl: "https://s3.coros.com/p.png" } }));
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

async function signedIn(fetch?: typeof globalThis.fetch) {
  const account = new CorosAccount(mkdtempSync(path.join(tmpdir(), "clink-share-")), { sealer: sealed, secure: async () => true, ...(fetch ? { fetch } : {}) });
  await account.signIn({ email: "a@b.c", password: "right", region: "us" });
  return account;
}

/** A stored ZIP of exactly `size` bytes whose one file can't be made smaller. */
function archiveOf(size: number): Buffer {
  const overhead = createStoreZip([{ name: "face.bin", data: Buffer.alloc(0) }]).length;
  return createStoreZip([{ name: "face.bin", data: Buffer.alloc(size - overhead, 7) }]);
}

const input = (archive: Buffer, extra: Partial<CorosPublishInput> = {}): CorosPublishInput =>
  ({ archive, name: "Ridge", firmwareType: "COROS W332", sourceTemplateId: SOURCE_ID, watchFaceVersion: 5, backgroundImageId: 13, ...extra });

describe("Send to COROS", () => {
  it("uploads the face as COROS's app does, the template ID as a raw number", async () => {
    const { fetch, calls } = fakeCoros();
    const account = await signedIn(fetch);
    const archive = archiveOf(4096);
    const link = await publishToCoros(account, input(archive), { now: () => 0 });
    expect(link).toMatchObject({ url: "https://faq.coros.com/share/abc", expiresAt: new Date(Date.UTC(2026, 10, 25)).toISOString(), previewImageUrl: "https://s3.coros.com/p.png" });
    expect(link.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(link).not.toHaveProperty("accessToken");
    expect(JSON.stringify(link)).not.toContain(TOKEN);

    const save = calls.find((c) => c.path === "api.coros.com/coros/watchFaceTemplateUserCustom/saveOrUpdateV2")!;
    expect(save.method).toBe("POST");
    expect(save.headers.get("content-type")).toBeNull();
    const form = save.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    const json = String(form.get("jsonParameter"));
    expect(json).toContain(`"srcWatchFaceTemplateId":${SOURCE_ID},`);
    expect(JSON.parse(json)).toMatchObject({ accessToken: TOKEN, backgroundImageId: 13, firmwareType: "COROS W332", language: "en-US", maxWatchFaceVersion: 5, releaseType: 1, saveOrUpdate: 1, version: 2, watchFaceTemplateName: "Ridge" });
    expect(form.get("saveOrUpdate")).toBe("1");
    const file = form.get("watchFaceTemplateUserCustomZipFile") as File;
    expect(file.name).toBe("watchFaceTemplateUserCustomZipFile.dat");
    expect(Buffer.from(await file.arrayBuffer()).equals(archive)).toBe(true);
    // As it goes on the wire: one multipart body.
    const wire = new Request("https://x.test", { method: "POST", body: form });
    expect(wire.headers.get("content-type")).toMatch(/^multipart\/form-data; boundary=/);
    expect(await wire.text()).toContain(`"srcWatchFaceTemplateId":${SOURCE_ID},`);

    const create = calls.find((c) => c.path === "api.coros.com/coros/watchface/share/createLink")!;
    expect(create.headers.get("content-type")).toBe("application/json");
    expect(create.body).toBe(`{"type":2,"watchFaceTemplateUserCustom":{"backgroundImageId":13,"firmwareType":"COROS W332","srcWatchFaceTemplateId":${SOURCE_ID},"watchFaceTemplateId":${SAVED_ID},"watchFaceTemplateName":"Ridge"}}`);
  });

  it("builds the createLink body with both IDs unrounded", () => {
    expect(buildCreateLinkBody({ backgroundImageId: 0, firmwareType: "COROS W332", sourceTemplateId: "250506", templateId: "478814257230741704", name: "Summit \"A\"" }))
      .toBe('{"type":2,"watchFaceTemplateUserCustom":{"backgroundImageId":0,"firmwareType":"COROS W332","srcWatchFaceTemplateId":250506,"watchFaceTemplateId":478814257230741704,"watchFaceTemplateName":"Summit \\"A\\""}}');
    expect(() => buildCreateLinkBody({ backgroundImageId: 0, firmwareType: "x", sourceTemplateId: "1e5", templateId: "1", name: "x" })).toThrow(/template ID/);
  });

  it("uploads exactly 10,485,760 bytes and refuses one more that can't be made smaller", async () => {
    expect(MAX_COROS_UPLOAD_BYTES).toBe(10_485_760);
    const { fetch, calls } = fakeCoros();
    const account = await signedIn(fetch);
    await expect(publishToCoros(account, input(archiveOf(MAX_COROS_UPLOAD_BYTES)))).resolves.toMatchObject({ url: "https://faq.coros.com/share/abc" });
    const over = publishToCoros(account, input(archiveOf(MAX_COROS_UPLOAD_BYTES + 1)));
    await expect(over).rejects.toThrow("This face is 10.0 MB even after compression, and COROS accepts custom faces up to 10.0 MB. Remove some images or use smaller ones, then publish again.");
    expect(calls.filter((c) => c.path.endsWith("/saveOrUpdateV2"))).toHaveLength(1);
  });

  it("compresses a face over 10 MB losslessly before uploading it", async () => {
    // A 1,900 × 1,400 PNG stored without compression: ~10.6 MB, a few KB once deflated.
    const width = 1900, height = 1400;
    const rows = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rows.writeUInt32BE(((x >> 4) & 1) ? 0x204060ff : 0xffffffff, y * (width * 4 + 1) + 1 + x * 4);
    const chunk = (type: string, data: Buffer) => {
      const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, "latin1");
      const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(data, crc32(head.subarray(4))));
      return Buffer.concat([head, data, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr.set([8, 6, 0, 0, 0], 8);
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows, { level: 0 })), chunk("IEND", Buffer.alloc(0))]);
    const archive = createStoreZip([{ name: "info.json", data: Buffer.from(`{"o_template_id":${SOURCE_ID}}`) }, { name: "watchface_416x416/background.png", data: big }]);
    expect(archive.length).toBeGreaterThan(MAX_COROS_UPLOAD_BYTES);

    const { fetch, calls } = fakeCoros();
    await publishToCoros(await signedIn(fetch), input(archive));
    const sent = Buffer.from(await ((calls.find((c) => c.path.endsWith("/saveOrUpdateV2"))!.body as FormData).get("watchFaceTemplateUserCustomZipFile") as File).arrayBuffer());
    expect(sent.length).toBeLessThan(1024 * 1024);
    const entries = readZip(sent);
    expect(entries.map((e) => e.path)).toEqual(["info.json", "watchface_416x416/background.png"]);
    expect(Buffer.from(decodePng(entries[1].read()).data).equals(Buffer.from(decodePng(big).data))).toBe(true);
  }, 60_000);

  it("leaves archives at or under 10 MB untouched", async () => {
    const zip = archiveOf(4096);
    const untouched = await fitWatchfaceArchiveSize(zip, { triggerBytes: zip.length });
    expect(untouched.bytes).toBe(zip);
    expect(untouched.fit).toBeUndefined();
  });

  it("accepts only an https link on faq.coros.com", async () => {
    expect(isOfficialShareUrl("https://faq.coros.com/x")).toBe(true);
    for (const bad of ["http://faq.coros.com/x", "https://faq.coros.com.evil.test/x", "https://evil.test/faq.coros.com", "not a url"]) expect(isOfficialShareUrl(bad)).toBe(false);
    const { fetch } = fakeCoros({ link: "https://evil.test/share" });
    await expect(publishToCoros(await signedIn(fetch), input(archiveOf(4096)))).rejects.toThrow(/official share link/);
  });

  it("signs out when COROS says the session expired (1019)", async () => {
    const { fetch } = fakeCoros({ linkResult: "1019" });
    const account = await signedIn(fetch);
    await expect(publishToCoros(account, input(archiveOf(4096)))).rejects.toMatchObject({ code: "signedOut", status: 401 });
    expect((await account.status()).signedIn).toBe(false);
  });

  it("refuses a face on a local carrier template, and bad input, before uploading", async () => {
    const { fetch, calls } = fakeCoros();
    const account = await signedIn(fetch);
    const archive = archiveOf(4096);
    await expect(publishToCoros(account, input(archive, { sourceTemplateId: "0" }))).rejects.toThrow(LOCAL_TEMPLATE_PUBLISH_ERROR);
    await expect(publishToCoros(account, input(archive, { sourceTemplateId: "0000" }))).rejects.toThrow(LOCAL_TEMPLATE_PUBLISH_ERROR);
    await expect(publishToCoros(account, input(archive, { name: " \n " }))).rejects.toThrow(/name/);
    await expect(publishToCoros(account, input(archive, { name: "x".repeat(65) }))).rejects.toThrow(/64/);
    await expect(publishToCoros(account, input(archive, { firmwareType: "" }))).rejects.toThrow(/firmware/);
    await expect(publishToCoros(account, input(archive, { backgroundImageId: -1 }))).rejects.toThrow(/Background image/);
    await expect(publishToCoros(account, input(archive, { backgroundImageId: 1.5 }))).rejects.toThrow(/Background image/);
    await expect(publishToCoros(account, input(archive, { language: "english" }))).rejects.toThrow(/en-US/);
    await expect(publishToCoros(account, input(archive, { sourceTemplateId: "12a" }))).rejects.toThrow(/template ID/);
    expect(calls.filter((c) => c.path.endsWith("/saveOrUpdateV2"))).toHaveLength(0);
    const signedOut = new CorosAccount(mkdtempSync(path.join(tmpdir(), "clink-share-")), { sealer: sealed, secure: async () => true, fetch });
    await expect(publishToCoros(signedOut, input(archive))).rejects.toMatchObject({ code: "signedOut" });
  });

  it("reads the template from the archive's info.json as raw text", () => {
    const zip = (info: string) => createStoreZip([{ name: "info.json", data: Buffer.from(info) }]);
    expect(archiveTemplate(zip(`{"m_name":"RIDGE","o_wf_ver":5,"o_template_id":${SOURCE_ID},"o_diy_version":1}`))).toEqual({ sourceTemplateId: SOURCE_ID, watchFaceVersion: 5 });
    expect(archiveTemplate(zip('{"o_template_id":"250506"}'))).toEqual({ sourceTemplateId: "250506", watchFaceVersion: 0 });
    expect(() => archiveTemplate(zip('{"o_wf_ver":1}'))).toThrow(/o_template_id/);
    expect(() => archiveTemplate(zip(`{"o_template_id":1,"o_wf_ver":1000}`))).toThrow(/o_wf_ver/);
    expect(() => archiveTemplate(createStoreZip([{ name: "x.txt", data: Buffer.from("x") }]))).toThrow(/info.json/);
    expect(() => archiveTemplate(Buffer.from("not a zip"))).toThrow(AccountProblem);
  });
});

describe("Send to COROS in Local-Only Mode", () => {
  const original = globalThis.fetch;
  afterEach(() => { globalThis.fetch = original; });

  it("is stopped, and says why", async () => {
    const { fetch, calls } = fakeCoros();
    globalThis.fetch = fetch;
    const blocked: string[] = [];
    guardFetch(() => true, (b) => blocked.push(b.target));
    // Signing in is a read and still works; the upload is stopped.
    const account = await signedIn();
    const sent = publishToCoros(account, input(archiveOf(4096)));
    await expect(sent).rejects.toBeInstanceOf(AccountProblem);
    await expect(sent).rejects.toMatchObject({ code: "localOnly", status: 403, message: expect.stringContaining("Local-Only Mode is on") });
    expect(blocked).toEqual(["api.coros.com/coros/watchFaceTemplateUserCustom/saveOrUpdateV2"]);
    expect(calls.map((c) => c.path)).toEqual(["api.coros.com/coros/user/login"]);
  });
});
