import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { encodePng } from "../../watchface/compiler/png";
import { readZip } from "../../watchface/zipRead";
import { createStoreZip } from "../../watchface/zipStore";
import { describeTemplate, inspectTemplate, templateAssets, templateConfigTexts } from "../../watchface/archive/template";
import { buildWatchfaceArchive } from "../../watchface/archive/build";
import { duplicateName, templatesFor, WatchfaceStudio, type ProjectSummary, type StoredProject } from "./studio";
import { getWatchfaceTarget } from "../../watchface/watchfaceTargets";
import { readdirSync, readFileSync } from "node:fs";
import { PhoneSend } from "./phoneSend";
import { compiledFixture } from "../../watchface/archive/testFixtures";

const png = (w: number, h: number, rgba: [number, number, number, number] = [255, 255, 255, 255]) =>
  encodePng({ width: w, height: h, data: new Uint8Array(w * h * 4).map((_, i) => rgba[i % 4]) });
const dataUrl = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

/** A small editable template with PACE Pro's 416 layout and the 800 master, separate hour and minute digits. */
function template(): Buffer {
  const files: { name: string; data: Buffer }[] = [
    { name: "info.json", data: Buffer.from('{"m_name":"SIMPLE","m_app":"watchface_800x800","m_preview":"watchface_customize.png","o_wf_ver":0,"o_template_id":478947569257513340,"o_diy_version":1}') },
    { name: "watchface_customize.png", data: png(40, 40, [9, 9, 9, 255]) },
  ];
  for (const size of [416, 800]) {
    const dir = `watchface_${size}x${size}`, s = size / 416;
    files.push({ name: `${dir}/background.png`, data: png(size / 8, size / 8, [0, 0, 0, 255]) });
    files.push({ name: `${dir}/thmb.png`, data: png(Math.round(size * 315 / 416), Math.round(size * 315 / 416), [0, 0, 0, 255]) });
    for (let d = 0; d < 10; d++) files.push({ name: `${dir}/01/${String(d).padStart(2, "0")}.png`, data: png(Math.round(20 * s), Math.round(30 * s)) });
    files.push({ name: `${dir}/config.txt`, data: Buffer.from([
      "[watchface_id]=0x00000026", "[background_icon_pos]={0,0}", "[background_icon]=background.png", "[bg_color]=0x000000",
      `[time_hour_high_pos]={${Math.round(100 * s)},${Math.round(150 * s)}}`, "[time_hour_high_font]=01",
      `[time_hour_low_pos]={${Math.round(120 * s)},${Math.round(150 * s)}}`, "[time_hour_low_font]=01",
      `[time_minute_high_pos]={${Math.round(220 * s)},${Math.round(150 * s)}}`, "[time_minute_high_font]=01",
      `[time_minute_low_pos]={${Math.round(240 * s)},${Math.round(150 * s)}}`, "[time_minute_low_font]=01", "",
    ].join("\r\n")) });
  }
  return createStoreZip(files);
}

const PACE_PRO = getWatchfaceTarget("pace-pro")!;
const TEMPLATE_ID = templatesFor(PACE_PRO).themes[0].id!;

function studio(extra: { pickFolder?: () => Promise<string | null>; phone?: PhoneSend } = {}) {
  const starter = template();
  const fetched: string[] = [];
  const s = new WatchfaceStudio(mkdtempSync(path.join(tmpdir(), "studio-")), {
    ...extra,
    fetch: (async (url: string) => { fetched.push(String(url)); return new Response(new Uint8Array(starter)); }) as typeof fetch,
    archiveWorker: "/nowhere/watchfaceArchive.cjs", compilerWorker: "/nowhere/watchfaceCompiler.cjs",
  });
  return { s, fetched, starter };
}
const call = async (s: WatchfaceStudio, method: string, route: string, body?: unknown, hub = true) =>
  s.answer(new Request(`clink://app/api/desktop/studio${route}`, {
    method, ...(body !== undefined ? { body: body instanceof Uint8Array ? new Blob([new Uint8Array(body)]) : JSON.stringify(body) } : {}),
    headers: { "Content-Type": "application/json", ...(hub ? { "X-Clink-Hub": "1" } : {}) },
  }));
const jsonOf = async <T>(r: Response) => (await r.json()) as T;
const design = (extra: Record<string, unknown> = {}) => ({ version: 1, digitColor: "#ffffff", ...extra });

describe("template archives", () => {
  it("inspects and describes a starter with digits, layouts and the 800 master", () => {
    const zip = template();
    const info = inspectTemplate(zip);
    expect(info.sourceTemplateId).toBe("478947569257513340");
    expect(info.resolutionProfile).toBe("amoled-416-800");
    const details = describeTemplate(zip, "x");
    expect(details.resolutions.map((r) => r.width).sort()).toEqual([416, 800]);
    const master = details.resolutions.find((r) => r.width === 800)!;
    expect(master.config.time_minute_low_pos).toBe("{462,288}");
    expect(master.spriteFolders[0]).toMatchObject({ folder: "01", kind: "digits" });
    expect(master.spriteFolders[0].files[0]).toMatchObject({ width: 38, height: 58 });
    expect(templateConfigTexts(zip).map((f) => f.path)).toEqual(["watchface_416x416/config.txt", "watchface_800x800/config.txt"]);
    const [asset] = templateAssets(zip, ["watchface_800x800/01/00.png"]);
    expect(asset).toMatchObject({ width: 38, height: 58 });
    expect(asset.dataUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(() => templateAssets(zip, ["watchface_800x800/config.txt"])).toThrow(/PNG/);
    expect(templateAssets(zip, ["watchface_800x800/missing.png"], true)).toEqual([]);
  });

  it("builds the final archive: overrides, a new Studio sprite, artwork at each size, an untouched template elsewhere", () => {
    const zip = template();
    const out = buildWatchfaceArchive(zip, {
      backgroundDataUrl: dataUrl(png(800, 800, [200, 0, 0, 255])),
      configOverrides: [{ path: "watchface_800x800/config.txt", values: { time_minute_high_pos: "{300,300}", time_minute_high_font: "studio\\minutes" } }],
      assetReplacements: Array.from({ length: 10 }, (_, d) => ({ path: `watchface_800x800/studio/minutes/${String(d).padStart(2, "0")}.png`, dataUrl: dataUrl(png(38, 58, [255, 0, 0, 255])), create: true })),
    });
    const files = new Map(readZip(out).map((e) => [e.path, e]));
    const config = files.get("watchface_800x800/config.txt")!.read().toString();
    expect(config).toContain("[time_minute_high_pos]={300,300}");
    expect(config).toContain("[time_hour_high_pos]={192,288}");
    expect(config.includes("\r\n")).toBe(true);
    expect(files.has("watchface_800x800/studio/minutes/09.png")).toBe(true);
    const bg = files.get("watchface_416x416/background.png")!.read();
    expect([bg.readUInt32BE(16), bg.readUInt32BE(20)]).toEqual([52, 52]);
    expect(files.get("info.json")!.read().toString()).toContain("478947569257513340");
    expect(() => buildWatchfaceArchive(zip, { backgroundDataUrl: dataUrl(png(8, 8)), configOverrides: [{ path: "watchface_800x800/config.txt", values: { not_a_key: "1" } }] })).toThrow(/does not define: not_a_key/);
    expect(() => buildWatchfaceArchive(zip, { backgroundDataUrl: dataUrl(png(8, 8)), assetReplacements: [{ path: "watchface_800x800/01/00.png", dataUrl: dataUrl(png(5, 5)) }] })).toThrow(/38×58/);
  });
});

describe("Studio projects", () => {
  it("lists the bundled templates for a watch without signing in", async () => {
    const { s } = studio();
    const { templates } = await jsonOf<{ templates: { id: string; name: string }[] }>(await call(s, "GET", "/templates?watch=pace-pro"));
    expect(templates.length).toBeGreaterThan(5);
    expect(templates.every((t) => /^\d+$/.test(t.id))).toBe(true);
    expect(JSON.stringify(templates)).not.toContain("https://");
  });

  it("makes a project from a template, saves, reopens, duplicates, exports and imports it in CorosLink's format", async () => {
    const { s, fetched } = studio();
    expect((await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }, false)).status).toBe(403);
    const made = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }))).project;
    expect(made.firmwareType).toBe("COROS W332");
    expect(made.startedFrom).toBe("template");
    expect(made.sourceTemplateId).toBe("478947569257513340");
    // A second project from the same template comes from the cache.
    await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, blank: true, design: design() });
    expect(fetched).toHaveLength(1);

    const details = (await jsonOf<{ details: { resolutions: unknown[] } }>(await call(s, "GET", `/projects/${made.projectId}/template`))).details;
    expect(details.resolutions).toHaveLength(2);

    const edited = design({ separateAutoTime: true, timeStyles: { minutes: { color: "#ff4c6e", scale: 1 } } });
    const preview = dataUrl(png(20, 20));
    const saved = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", `/projects/${made.projectId}`, { name: "Mine", design: edited, previewDataUrl: preview }))).project;
    expect(saved.name).toBe("Mine");
    expect(saved.startedFrom).toBeUndefined();
    const reopened = await jsonOf<{ project: StoredProject; template: { resolutionProfile: string } }>(await call(s, "GET", `/projects/${made.projectId}`));
    expect(reopened.project.design).toEqual(edited);
    expect(reopened.template.resolutionProfile).toBe("amoled-416-800");
    expect((await call(s, "GET", `/projects/${made.projectId}/preview`)).headers.get("content-type")).toBe("image/png");

    const copy = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", `/projects/${made.projectId}/duplicate`))).project;
    expect(copy.name).toBe("Mine copy");
    const list = (await jsonOf<{ projects: ProjectSummary[] }>(await call(s, "GET", "/projects"))).projects;
    expect(list[0].projectId).toBe(copy.projectId);
    expect(list).toHaveLength(3);

    const exported = await call(s, "POST", `/projects/${made.projectId}/export/project`, { name: "Mine", design: edited });
    const zip = Buffer.from(await exported.arrayBuffer());
    expect(readZip(zip).map((e) => e.path)).toEqual(["coroslink-project.json", "starter.dat", "preview.png"]);
    const manifest = JSON.parse(readZip(zip)[0].read().toString());
    expect(manifest).toMatchObject({ format: "coroslink-watchface-project", version: 1, name: "Mine", sourceTemplateId: "478947569257513340" });

    const imported = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects/import?name=Mine.zip", new Uint8Array(zip)))).project;
    expect(imported.startedFrom).toBeUndefined();
    expect((await jsonOf<{ project: StoredProject }>(await call(s, "GET", `/projects/${imported.projectId}`))).project.design).toEqual(edited);
    const plain = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects/import?name=face.dat&watch=pace-pro", new Uint8Array(template())))).project;
    expect(plain).toMatchObject({ name: "SIMPLE", startedFrom: "template", firmwareType: "COROS W332" });
    expect((await jsonOf<{ error: { message: string } }>(await call(s, "POST", "/projects/import?name=x.bin", new Uint8Array(Buffer.from("614Aabcdefgh"))))).error.message).toMatch(/can't be opened|cannot be opened/);
    // A real BIN is recovered into an editable project (sources.test.ts covers it end to end).

    await call(s, "POST", `/projects/${copy.projectId}/delete`);
    expect((await call(s, "GET", `/projects/${copy.projectId}`)).status).toBe(404);
  });

  it("builds the Final watch ZIP and a BIN that passes compile.ts's checks", async () => {
    const { s } = studio();
    const made = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }))).project;
    const input = {
      backgroundDataUrl: dataUrl(png(800, 800, [0, 40, 80, 255])),
      configOverrides: [{ path: "watchface_416x416/config.txt", values: { time_minute_high_pos: "{230,160}" } }],
    };
    const final = await call(s, "POST", `/projects/${made.projectId}/export/final`, input);
    expect(final.headers.get("content-type")).toBe("application/zip");
    const config = readZip(Buffer.from(await final.arrayBuffer())).find((e) => e.path === "watchface_416x416/config.txt")!.read().toString();
    expect(config).toContain("[time_minute_high_pos]={230,160}");
    const bin = await call(s, "POST", `/projects/${made.projectId}/export/bin`, input);
    expect(bin.status).toBe(200);
    const bytes = Buffer.from(await bin.arrayBuffer());
    expect(bytes.toString("latin1", 0, 4)).toBe("614A");
    expect(JSON.parse(decodeURIComponent(bin.headers.get("x-clink-warnings")!))).toBeInstanceOf(Array);
  });

  it("sends from one prepared build: compiled BIN, iPhone code, folders, no install without a watch", async () => {
    const folder = mkdtempSync(path.join(tmpdir(), "studio-out-"));
    const phone = new PhoneSend({ hosts: () => ["192.168.1.20"] });
    const { s } = studio({ pickFolder: async () => folder, phone });
    const made = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }))).project;
    const { prepared } = await jsonOf<{ prepared: { id: string; watch: string; details: { resolutions: { directory: string }[] } } }>(
      await call(s, "POST", `/projects/${made.projectId}/send/prepare`, { backgroundDataUrl: dataUrl(png(800, 800, [0, 40, 80, 255])) }));
    expect(prepared.watch).toBe("pace-pro");
    expect(prepared.details.resolutions.map((r) => r.directory)).toContain("watchface_416x416");
    const assets = await jsonOf<{ assets: { path: string }[] }>(await call(s, "POST", `/prepared/${prepared.id}/assets`, { paths: ["watchface_416x416/background.png", "watchface_416x416/gone.png"] }));
    expect(assets.assets.map((a) => a.path)).toEqual(["watchface_416x416/background.png"]);

    const bin = await call(s, "POST", `/prepared/${prepared.id}/bin`, { name: "Mint", fullColor: true });
    expect(Buffer.from(await bin.arrayBuffer()).toString("latin1", 0, 4)).toBe("614A");
    expect(bin.headers.get("content-disposition")).toContain("Mint.bin");

    const sent = await jsonOf<{ send: { link: string } }>(await call(s, "POST", `/prepared/${prepared.id}/phone`, { name: "Mint" }));
    expect(sent.send.link).toMatch(/^coroslink:\/\/face\/1\?a=192\.168\.1\.20&p=\d+&k=/);
    expect((await jsonOf<{ status: { active: boolean } }>(await call(s, "GET", "/phone"))).status.active).toBe(true);
    expect((await jsonOf<{ status: { active: boolean } }>(await call(s, "POST", "/phone/stop"))).status.active).toBe(false);

    const install = await call(s, "POST", `/prepared/${prepared.id}/install`, {});
    expect(install.status).toBe(409);
    expect((await jsonOf<{ watch: { connected: boolean } }>(await call(s, "GET", "/watch"))).watch.connected).toBe(false);
    // The COROS app needs the account (corosShare.test.ts covers the upload).
    expect((await call(s, "POST", `/prepared/${prepared.id}/coros`, { name: "Mint" })).status).toBe(401);

    const { folder: picked } = await jsonOf<{ folder: { id: string; label: string } }>(await call(s, "POST", "/folders/pick"));
    expect(picked.label).toBe(path.basename(folder));
    await call(s, "POST", `/prepared/${prepared.id}/folder`, { folderId: picked.id, name: "Mint (PACE Pro)" });
    await call(s, "POST", `/prepared/${prepared.id}/folder`, { folderId: picked.id, name: "Mint", unpacked: true });
    expect(readdirSync(folder).sort()).toEqual(["Mint", "Mint (PACE Pro).zip"]);
    expect(readFileSync(path.join(folder, "Mint", "watchface_416x416", "config.txt"), "utf8")).toContain("background_icon");
    expect((await call(s, "POST", `/prepared/${prepared.id}/folder`, { folderId: folder, name: "x" })).status).toBe(400);
    expect((await call(s, "POST", "/prepared/00000000-0000-0000-0000-000000000000/bin", {})).status).toBe(410);
    expect((await call(s, "POST", `/prepared/${prepared.id}/bin`, {}, false)).status).toBe(403);
  });

  it("converts to another watch as a new project and keeps scratch copies out of the list", async () => {
    const { s } = studio();
    const made = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }))).project;
    const converted = await jsonOf<{ project: ProjectSummary; result: { rebuilt: boolean; noCorosTemplate: boolean } }>(await call(s, "POST", `/projects/${made.projectId}/convert`, { watch: "apex-4", design: design({ digitColor: "#53cba1" }) }));
    const apex = converted.project;
    expect(converted.result.rebuilt).toBe(false);
    // The bundled catalog's packages here are PACE Pro's, so APEX 4 gets a local carrier.
    expect(converted.result.noCorosTemplate).toBe(true);
    expect(apex.name).toBe(`${made.name} (APEX 4)`);
    expect(apex.firmwareType).toBe("COROS W541");
    const opened = await jsonOf<{ project: StoredProject; template: { resolutionDirectories: string[] } }>(await call(s, "GET", `/projects/${apex.projectId}`));
    expect(opened.template.resolutionDirectories).toEqual(expect.arrayContaining(["watchface_240x240", "watchface_260x260", "watchface_280x280", "watchface_800x800"]));
    expect(opened.project.design.digitColor).toBe("#53cba1");
    // The source stays as it was.
    expect((await jsonOf<{ template: { resolutionDirectories: string[] } }>(await call(s, "GET", `/projects/${made.projectId}`))).template.resolutionDirectories).toEqual(["watchface_416x416", "watchface_800x800"]);
    const scratch = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", `/projects/${made.projectId}/convert`, { watch: "pace-4", design: design(), scratch: true }))).project;
    const listed = (await jsonOf<{ projects: ProjectSummary[] }>(await call(s, "GET", "/projects"))).projects.map((p) => p.projectId);
    expect(listed).toContain(apex.projectId);
    expect(listed).not.toContain(scratch.projectId);
    expect((await call(s, "POST", `/projects/${made.projectId}/convert`, { watch: "nope" })).status).toBe(400);
  });

  it("sends a face recovered from a BIN, builds it for every watch, and converts it by rebuilding", async () => {
    const { s } = studio();
    const imported = await call(s, "POST", "/projects/import?name=Recovered", new Uint8Array(compiledFixture()));
    const made = (await jsonOf<{ project: ProjectSummary }>(imported)).project;
    expect(made.firmwareType).toBe("COROS W332");
    const input = { backgroundDataUrl: dataUrl(png(800, 800, [0, 40, 80, 255])) };
    const sizes = (zip: Buffer) => readZip(zip).flatMap((e) => e.path.match(/^watchface_(\d+)x\1\/config\.txt$/)?.[1] ?? []).map(Number).sort((a, b) => a - b);

    // Its own watch: built from its 416 layout with PACE Pro's carrier (the catalog's template).
    const own = await call(s, "POST", `/projects/${made.projectId}/export/final`, input);
    expect(own.status, await own.clone().text()).toBe(200);
    const ownZip = Buffer.from(await own.arrayBuffer());
    expect(sizes(ownZip)).toEqual([416, 800]);
    expect(readZip(ownZip).find((e) => e.path === "info.json")!.read().toString()).toMatch(/"o_template_id":478947569257513340\b/);

    // All watches: another watch straight from the same composition.
    const { prepared } = await jsonOf<{ prepared: { watch: string } }>(await call(s, "POST", `/projects/${made.projectId}/send/prepare`, { ...input, watch: "nomad" }));
    expect(prepared.watch).toBe("nomad");
    expect((await call(s, "POST", `/projects/${made.projectId}/send/prepare`, { ...input, watch: "nope" })).status).toBe(400);

    // Convert needs the composition, and opens the rebuilt face as a new starter.
    expect((await call(s, "POST", `/projects/${made.projectId}/convert`, { watch: "pace-4" })).status).toBe(400);
    const converted = await jsonOf<{ project: ProjectSummary; result: { rebuilt: boolean } }>(
      await call(s, "POST", `/projects/${made.projectId}/convert`, { watch: "pace-4", build: input, design: design() }));
    expect(converted.result.rebuilt).toBe(true);
    expect(converted.project).toMatchObject({ name: "Recovered (PACE 4)", firmwareType: "COROS W336", startedFrom: "template" });
    const opened = await jsonOf<{ project: StoredProject; template: { resolutionDirectories: string[]; recoveredFromCompiled?: boolean } }>(await call(s, "GET", `/projects/${converted.project.projectId}`));
    expect(opened.template.resolutionDirectories.sort()).toEqual(["watchface_390x390", "watchface_800x800"]);
    expect(opened.template.recoveredFromCompiled).toBeUndefined();
    expect(opened.project.design).toEqual({ version: 1 });
    // From there it converts like any face with an 800 master.
    const again = await jsonOf<{ result: { rebuilt: boolean } }>(await call(s, "POST", `/projects/${converted.project.projectId}/convert`, { watch: "pace-pro", design: design() }));
    expect(again.result.rebuilt).toBe(false);
  });

  it("builds a face with an 800 master only for its own watch", async () => {
    const { s } = studio();
    const made = (await jsonOf<{ project: ProjectSummary }>(await call(s, "POST", "/projects", { watch: "pace-pro", templateId: TEMPLATE_ID, design: design() }))).project;
    const other = await call(s, "POST", `/projects/${made.projectId}/send/prepare`, { backgroundDataUrl: dataUrl(png(800, 800)), watch: "pace-4" });
    expect(other.status).toBe(400);
    expect((await jsonOf<{ error: { message: string } }>(other)).error.message).toBe("Convert this face for PACE 4 first.");
  });

  it("names copies the way CorosLink does", () => {
    expect(duplicateName("Run", [])).toBe("Run copy");
    expect(duplicateName("Run", ["Run copy", "run COPY 2"])).toBe("Run copy 3");
    expect(duplicateName("Run copy 4", [])).toBe("Run copy 5");
  });
});
