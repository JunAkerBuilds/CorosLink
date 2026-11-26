import { describe, expect, it } from "vitest";
import type { CorosWatchfaceTemplateDetails } from "../watchface/types";
import { makeDefaultDesign } from "../watchface/engine/watchfaceBackground";
import { blankWatchfaceDesign } from "../watchface/engine/watchfaceBlankStart";
import { createWatchfaceSimulation } from "../watchface/engine/watchfaceSimulation";
import { answerAutomation, automationDocument, type AutomationHost, type Snapshot } from "./studioAutomation";
import type { FaceSource, Mode } from "./studioFace";

/** A clock-only template at 800 and 416, shaped like COROS's editable ones. */
function template(aod = false): CorosWatchfaceTemplateDetails {
  const resolution = (width: number) => {
    const directory = `watchface_${width}x${width}`;
    const s = width / 800, n = (v: number) => Math.round(v * s);
    const at = (x: number, y: number) => `{${n(x)},${n(y)}}`;
    const files = Array.from({ length: 10 }, (_, i) => ({ path: `${directory}/digits/${String(i).padStart(2, "0")}.png`, width: n(60), height: n(90) }));
    return {
      directory, width, height: width,
      config: {
        background_icon: "background.png",
        time_hour_high_pos: at(150, 300), time_hour_low_pos: at(250, 300), time_minute_high_pos: at(450, 300), time_minute_low_pos: at(550, 300),
        time_hour_high_font: "digits", time_hour_low_font: "digits", time_minute_high_font: "digits", time_minute_low_font: "digits",
      },
      aodConfig: aod ? { bg_color: "#000000", time_hour_high_pos: at(150, 300), time_hour_high_font: "digits" } : {},
      spriteFolders: [{ folder: "digits", kind: "digits", aod: false, files }],
      icons: [{ path: `${directory}/background.png`, width, height: width }],
    };
  };
  return { templateId: "auto-test", resolutions: [resolution(800), resolution(416)] } as unknown as CorosWatchfaceTemplateDetails;
}

/** The editor as automation sees it, in memory: a history, a view and a drawing that records what it drew. */
function fakeHost(details = template()) {
  const source = { details, baselines: {}, watch: {}, projectId: "p1", loadAssets: async () => [] } as unknown as FaceSource;
  let doc = { now: { name: "Face", design: blankWatchfaceDesign({ ...makeDefaultDesign(), artwork: null }, details) } as Snapshot, past: [] as Snapshot[], future: [] as Snapshot[] };
  let revision = 1, mode: Mode = "current", selection: string[] = [], sim = createWatchfaceSimulation(new Date(2026, 10, 25, 10, 9));
  const drawn: { mode: Mode; size: number; background: string }[] = [];
  let saved = 0;
  const images = new Map<string, { width: number; height: number; data: Uint8ClampedArray }>();
  const host: AutomationHost = {
    sessionId: "s1", projectId: "p1", source,
    snapshot: () => doc.now, revision: () => revision, dirty: () => false, busy: () => false,
    canUndo: () => doc.past.length > 0, canRedo: () => doc.future.length > 0,
    commit: (next) => { doc = { now: next, past: [...doc.past, doc.now], future: [] }; revision++; },
    undo: () => { doc = { now: doc.past.at(-1)!, past: doc.past.slice(0, -1), future: [doc.now, ...doc.future] }; revision++; },
    redo: () => { doc = { now: doc.future[0], past: [...doc.past, doc.now], future: doc.future.slice(1) }; revision++; },
    mode: () => mode, setMode: (m) => { mode = m; },
    selection: () => selection, select: (ids) => { selection = ids; },
    simulation: () => sim, setSimulation: (s) => { sim = s; },
    render: async (design, m, size) => { drawn.push({ mode: m, size, background: design.backgroundColor ?? "" }); return "data:image/png;base64,AA=="; },
    decode: async (url) => images.get(url) ?? { width: 2, height: 2, data: new Uint8ClampedArray(16) },
    save: async () => { saved++; },
  };
  return { host, drawn, images, saves: () => saved, history: () => doc };
}

describe("studio automation", () => {
  it("describes the open face with its layers' placement in master pixels", () => {
    const { host } = fakeHost();
    const doc = automationDocument(host);
    expect(doc).toMatchObject({ sessionId: "s1", revision: 1, project: { projectId: "p1", name: "Face" }, capabilities: { aod: false, placement: { width: 800, height: 800 } } });
    expect(doc.capabilities.resolutions.map((r) => r.width)).toEqual([800, 416]);
    const hours = doc.capabilities.layers.find((l) => l.kind === "time");
    expect(hours?.placement?.bounds).toMatchObject({ x: expect.any(Number), width: expect.any(Number) });
    expect(doc.capabilities.nativeData.fieldIds.length).toBeGreaterThan(10);
  });

  it("applies a batch as one undo step and selects what changed", async () => {
    const { host, history } = fakeHost();
    const before = automationDocument(host);
    const layer = before.capabilities.layers.find((l) => l.placement?.movable)!;
    const result = await answerAutomation(host, "apply_commands", {
      sessionId: "s1", baseRevision: 1,
      commands: [{ op: "move_layer", id: layer.id, dx: 10, dy: 0 }, { op: "set", path: "/design/backgroundColor", value: "#112233" }],
    }) as { revision: number; changedLayerIds: string[] };
    expect(result.revision).toBe(2);
    expect(history().past).toHaveLength(1);
    expect(history().now.design.backgroundColor).toBe("#112233");
    expect(host.selection()).toContain(layer.id);
    const after = automationDocument(host).capabilities.layers.find((l) => l.id === layer.id)!;
    expect(after.placement!.bounds!.x).toBeCloseTo(layer.placement!.bounds!.x + 10, 0);
    await answerAutomation(host, "undo", { sessionId: "s1", baseRevision: 2 });
    expect(history().now.design.backgroundColor).not.toBe("#112233");
  });

  it("refuses a stale revision, another session and a bad batch without touching the face", async () => {
    const { host, history } = fakeHost();
    const cmd = [{ op: "set", path: "/design/backgroundColor", value: "#000001" }];
    await expect(answerAutomation(host, "apply_commands", { sessionId: "s1", baseRevision: 0, commands: cmd })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(answerAutomation(host, "apply_commands", { sessionId: "old", baseRevision: 1, commands: cmd })).rejects.toMatchObject({ code: "STALE_SESSION" });
    await expect(answerAutomation(host, "apply_commands", { sessionId: "s1", baseRevision: 1, commands: [cmd[0], { op: "set", path: "/design/nope/deeper", value: 1 }] })).rejects.toThrow();
    expect(history().past).toHaveLength(0);
    expect(host.revision()).toBe(1);
  });

  it("refuses always-on on a template without it, and switches to it on one with it", async () => {
    await expect(answerAutomation(fakeHost().host, "render_preview", { sessionId: "s1", mode: "aod" })).rejects.toMatchObject({ code: "UNSUPPORTED_MODE" });
    const { host } = fakeHost(template(true));
    await answerAutomation(host, "set_view", { sessionId: "s1", mode: "aod", simulation: { values: { battery: "5" } } });
    expect(host.mode()).toBe("aod");
    expect(host.simulation().values).toEqual({ battery: "5" });
  });

  it("draws previews at a resolution or a size, and checks contrast on black and white backdrops", async () => {
    const { host, drawn } = fakeHost();
    const preview = await answerAutomation(host, "render_preview", { sessionId: "s1", resolution: 416 }) as { width: number; resolution: string; dataUrl: string };
    expect(preview).toMatchObject({ width: 416, resolution: "watchface_416x416", dataUrl: expect.stringMatching(/^data:image\/png/) });
    await expect(answerAutomation(host, "render_preview", { sessionId: "s1", resolution: 333 })).rejects.toMatchObject({ code: "UNKNOWN_RESOLUTION" });
    drawn.length = 0;
    // A blank face starts with its time hidden: shown again, it is measured.
    await answerAutomation(host, "apply_commands", { sessionId: "s1", baseRevision: 1, commands: [{ op: "set_visibility", id: "hours", visible: true }] });
    const contrast = await answerAutomation(host, "check_contrast", { sessionId: "s1", ids: ["hours", "minutes", "nope"] }) as { results: unknown[]; skipped: { id: string; reason: string }[] };
    expect(drawn.some((d) => d.background === "#000000")).toBe(true);
    expect(drawn.some((d) => d.background === "#FFFFFF")).toBe(true);
    expect(drawn.every((d) => d.size === 800)).toBe(true);
    // The fake drawing is blank, so nothing is measured; each layer says why.
    expect(contrast.results).toHaveLength(0);
    expect(contrast.skipped).toEqual([
      { id: "minutes", reason: "The layer is hidden." }, { id: "nope", reason: "No such layer in this mode." },
      { id: "hours", reason: "Nothing visible is drawn in its box." },
    ]);
  });

  it("selects known layers only, validates, and saves with a new name as an undo step", async () => {
    const { host, saves, history } = fakeHost();
    await expect(answerAutomation(host, "select", { sessionId: "s1", layerIds: ["nope"] })).rejects.toMatchObject({ code: "UNKNOWN_LAYER" });
    await answerAutomation(host, "select", { sessionId: "s1", layerIds: ["background"] });
    expect(host.selection()).toEqual(["background"]);
    await answerAutomation(host, "validate", { sessionId: "s1" });
    await answerAutomation(host, "save", { sessionId: "s1", baseRevision: 1, name: "Night" });
    expect(history().now.name).toBe("Night");
    expect(saves()).toBe(1);
    await expect(answerAutomation(host, "frobnicate", {})).rejects.toMatchObject({ code: "METHOD_NOT_FOUND" });
  });
});
