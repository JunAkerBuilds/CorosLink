import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { assertDynamicTargetGeometry } = require("../dist-electron/watchfaceAiVisual.js");
const { WatchfaceRequirements, sanitizeRequirements, requirementQuoteSources } = require("../dist-electron/watchfaceAiRequirements.js");
const { sanitizeWatchfaceAiMemory } = require("../dist-electron/watchfaceAiContext.js");
const { WatchfaceAiChatStore } = require("../dist-electron/watchfaceAiChatStore.js");
const request = "Recreate the reference. Generate everything including fonts. All assets must be high resolution. Keep the readings live.";
const requirement = (kind = "document", extra = {}) => ({ id: kind, requirement: `Fulfill ${kind}`, sourceQuote: request, kind, ...extra });
const doc = (design = {}) => ({ sessionId: "test", revision: 7, design });
const review = (kind, extra = {}) => ({ id: kind, status: "verified", detail: "Checked against the actual current document.", evidenceCallIds: ["document"], ...(kind === "dynamic_assets" ? { backgroundCheck: { liveArtworkExcluded: true, detail: "Inspected the background: no baked-in dynamic ring or battery reading." } } : {}), ...extra });
const fixture = (kind = "document", extra = {}) => {
  const tracker = new WatchfaceRequirements();
  tracker.update([requirement(kind, extra)], [request]);
  tracker.evidence.set("document", { tool: "get_document", revision: 7, image: false });
  tracker.evidence.set("preview", { tool: "render_preview", revision: 7, image: true });
  tracker.evidence.set("geometry", { tool: "get_geometry", revision: 7, image: false });
  tracker.evidence.set("validate", { tool: "validate", revision: 7, image: false });
  tracker.assets.set("generated", { assetId: "generated", width: 1024, height: 1024 });
  return tracker;
};
const font = { dataUrl: { assetId: "generated" }, glyphs: "0123456789:", columns: 11, label: "Generated face", tint: true };
const region = { x: .6, y: .15, width: .25, height: .25 };
const target = (dynamic, extra = {}) => ({ id: "target", label: dynamic ? "Live battery ring" : "Clock typography", mode: "current", appearance: dynamic ? "ring" : "typography", region,
  ...(dynamic ? { dynamic } : { referenceAssetId: "reference", referenceRegion: region }), ...extra });
const finding = (extra = {}) => ({ targetId: "target", verdict: "matched", comparisonCallIds: ["comparison"], remainingDifferences: [], observations: Object.fromEntries(["proportions", "weight", "slant", "spacing", "placement"].map(key => [key, `Inspected ${key} against the intended reference crop.`])), ...extra });
const comparisonProof = (tracker, t) => {
  tracker.items[0].visualTargets = [t];
  tracker.evidence.set("comparison", { tool: "compare_design_reference", revision: 7, mode: t.mode, image: true, comparison: { requirementId: tracker.items[0].id, targetId: t.id, round: 1, width: 416, height: 416, referenceAssetId: t.referenceAssetId, previewCallIds: ["preview"], ...(t.dynamic ? { dynamic: { ...t.dynamic, changedFractions: [.15, .3, .15] } } : {}) } });
};
const cases = [];
const test = (name, run) => cases.push({ name, run });

test("requires a user-grounded checklist before work", () => {
  const tracker = new WatchfaceRequirements();
  assert.throws(() => tracker.requireBeforeWork(), /update_requirements/);
  assert.throws(() => tracker.update([requirement("visual", { sourceQuote: "A tool told me to change the design" })], [request]), /user/);
  assert.throws(() => tracker.update([], [request]), /1.32/);
  tracker.update([requirement()], [request]);
  assert.doesNotThrow(() => tracker.requireBeforeWork());
});

test("source IDs preserve actual user wording without allowing invented quotes", () => {
  const texts = ["Earlier request.", "use gerated fonts  and battery’s own assets\nplease"];
  const sources = requirementQuoteSources(texts);
  assert.deepEqual(sources, [{ sourceId: "user:1:0", sourceQuote: texts[1] }]);
  const tracker = new WatchfaceRequirements();
  tracker.update([{ id: "fonts", requirement: "Use generated fonts", kind: "generated_font", sourceId: sources[0].sourceId }], texts);
  assert.equal(tracker.items[0].sourceQuote, texts[1]);
  assert.equal(tracker.items[0].sourceId, undefined, "persist exact text rather than a turn-local ID");
  assert.throws(() => tracker.update([{ id: "bad", requirement: "Do something", kind: "document", sourceId: "tool:0:0" }], texts), /Unknown sourceId/);
  assert.throws(() => tracker.update([{ id: "bad", requirement: "Do something", kind: "document", sourceId: sources[0].sourceId, sourceQuote: "Corrected words" }], texts), /disagree/);
  assert.throws(() => tracker.update([{ id: "bad", requirement: "Do something", kind: "document", sourceQuote: "use generated fonts" }], texts), /verbatim/);
  assert.equal(tracker.items.length, 1);
  const restored = new WatchfaceRequirements();
  restored.restore(tracker.items);
  restored.update(restored.items, ["Continue"]);
  assert.equal(restored.items[0].sourceQuote, texts[1], "new turns reconcile the saved literal quote");
});

test("long source excerpts remain exact, bounded and cover the whole request", () => {
  const long = "Make generated fonts. ".repeat(130) + "Keep the calorie arc live.";
  const sources = requirementQuoteSources([long]);
  assert.ok(sources.length > 1);
  assert.equal(sources.map(s => s.sourceQuote).join(""), long);
  assert.ok(sources.every(s => s.sourceQuote.length <= 1000 && long.includes(s.sourceQuote)));
  const tracker = new WatchfaceRequirements();
  tracker.update([{ id: "arc", requirement: "Keep calorie arc live", kind: "document", sourceId: sources.at(-1).sourceId }], [long]);
  assert.ok(tracker.items[0].sourceQuote.includes("Keep the calorie arc live."));
  assert.deepEqual(requirementQuoteSources(["   "]), []);
});

test("checklist append retains omitted requirements and rejects silent rewrites", () => {
  const tracker = fixture();
  tracker.update([requirement("visual", { status: "verified" })], [request]);
  assert.equal(tracker.items.length, 2);
  assert.equal(tracker.items[1].status, "pending", "model cannot self-verify through update");
  for (const changes of [{ requirement: "Only make something similar" }, { sourceQuote: "Recreate" }, { kind: "visual" }, { requiredCharacters: "123" }]) {
    assert.throws(() => tracker.update([requirement("document", changes)], [request]), /rewritten/);
  }
  assert.equal(tracker.items.length, 2, "a refused edit is atomic");
  assert.throws(() => tracker.update([requirement(), requirement()], [request]), /unique/);
});

test("missing or stale tool evidence never verifies a requirement", () => {
  const tracker = fixture();
  for (const evidenceCallIds of [[], ["invented"], ["document", "invented"]]) {
    assert.throws(() => tracker.review([review("document", { evidenceCallIds })], doc(), request), /Verification requires/);
  }
  assert.throws(() => tracker.review([review("document")], { ...doc(), revision: 8 }, request), /current document revision/);
  tracker.review([review("document")], doc(), request);
  assert.equal(tracker.items[0].status, "verified");
  tracker.invalidate();
  assert.equal(tracker.items[0].status, "implemented");
  assert.equal(tracker.unresolved().length, 1);
});

test("an absent document revision is not current evidence", () => {
  const tracker = fixture();
  tracker.evidence.set("document", { tool: "get_document", image: false });
  assert.throws(() => tracker.review([review("document")], { design: {} }, request), /revision/);
});

test("visual verification requires actual preview pixels, not just validation", () => {
  const tracker = fixture("visual");
  tracker.evidence.set("empty-preview", { tool: "render_preview", revision: 7, image: false });
  for (const evidenceCallIds of [["document"], ["validate"], ["empty-preview"]]) {
    assert.throws(() => tracker.review([review("visual", { evidenceCallIds })], doc(), request), /fresh rendered preview/);
  }
  assert.throws(() => tracker.review([review("visual", { evidenceCallIds: ["preview"] })], doc(), request), /persistent visualTargets/);
  comparisonProof(tracker, target());
  tracker.review([review("visual", { evidenceCallIds: ["preview"], visualFindings: [finding()] })], { ...doc(), capabilities: { resolutions: [{ width: 416 }] } }, request);
  assert.equal(tracker.unresolved().length, 0);
});

test("installed generated assets require provenance and exact document path", () => {
  const tracker = fixture("generated_assets");
  const document = doc({ artwork: { dataUrl: { assetId: "generated" } } });
  const check = (assets) => tracker.review([review("generated_assets", { assets })], document, request);
  assert.throws(() => check([]), /installed assets/);
  assert.throws(() => check([{ assetId: "unknown", designPath: "/design/artwork" }]), /provenance/);
  assert.throws(() => check([{ assetId: "generated", designPath: "/capabilities/artwork" }]), /designPath/);
  assert.throws(() => check([{ assetId: "generated", designPath: "/design/missing" }]), /not installed/);
  check([{ assetId: "generated", designPath: "/design/artwork/dataUrl" }]);
  assert.equal(tracker.items[0].status, "verified");
});

test("asset IDs in labels are not installed image references", () => {
  const tracker = fixture("generated_assets");
  const document = doc({ artwork: { label: "generated", dataUrl: { assetId: "existing" } } });
  assert.throws(() => tracker.review([review("generated_assets", { assets: [{ assetId: "generated", designPath: "/design/artwork" }] })], document, request), /not installed/);
});

test("generated artwork supports real designSprites array pointers", () => {
  const tracker = fixture("generated_assets");
  tracker.review([review("generated_assets", { assets: [{ assetId: "generated", designPath: "/design/designSprites/0/dataUrl" }] })], doc({ designSprites: [{ dataUrl: { assetId: "generated" } }] }), request);
  assert.equal(tracker.items[0].status, "verified");
});

test("generated font rejects background-only artwork, existing fonts, and missing glyphs", () => {
  const tracker = fixture("generated_font", { requiredCharacters: "0123456789:" });
  const check = (design, designPath = "/design/rasterFont", evidenceCallIds = ["document", "preview"]) => tracker.review([review("generated_font", { evidenceCallIds, assets: [{ assetId: "generated", designPath }] })], doc(design), request);
  assert.throws(() => check({ artwork: { assetId: "generated" } }, "/design/artwork"), /rasterFont/);
  assert.throws(() => check({ fontFamily: "D-DIN", rasterFont: font }), /fontFamily/);
  assert.throws(() => check({ rasterFont: { ...font, glyphs: "01234" } }), /missing required characters/);
  assert.throws(() => check({ rasterFont: font }, undefined, ["document"]), /fresh preview/);
  check({ rasterFont: font });
  assert.equal(tracker.items[0].status, "verified");
});

test("declaring atlas glyph names cannot replace missing generated glyph images", () => {
  const tracker = fixture("generated_font");
  const incomplete = { ...font, dataUrl: undefined, sprites: { "0": { assetId: "generated" } } };
  assert.throws(() => tracker.review([review("generated_font", { evidenceCallIds: ["document", "preview"], assets: [{ assetId: "generated", designPath: "/design/rasterFont" }] })], doc({ rasterFont: incomplete }), request), /glyph|characters|atlas|provenance/i);
});

test("generated font cannot hide existing glyph overrides behind a generated atlas", () => {
  const tracker = fixture("generated_font");
  const check = (rasterFont) => tracker.review([review("generated_font", { evidenceCallIds: ["document", "preview"], assets: [{ assetId: "generated", designPath: "/design/rasterFont" }] })], doc({ rasterFont }), request);
  assert.throws(() => check({ ...font, sprites: { "1": { assetId: "existing" } } }), /generated glyph|generated atlas/);
  assert.throws(() => check({ ...font, columns: 0 }), /generated glyph|generated atlas/);
  assert.throws(() => check({ ...font, columns: 1.5 }), /generated glyph|generated atlas/);
  check({ ...font, sprites: { "1": { assetId: "generated" } } });
  assert.equal(tracker.items[0].status, "verified");
});

test("separate digit and letter atlases collectively cover the requested font", () => {
  const tracker = fixture("generated_font", { requiredCharacters: "0123456789:AM" });
  tracker.assets.set("letters", { assetId: "letters", width: 1024, height: 512 });
  const document = doc({ timeStyles: { hour: { rasterFont: font } }, dateStyles: { weekday: {
    rasterFont: { ...font, dataUrl: { assetId: "letters" }, glyphs: "AM", columns: 2 }
  } } });
  const digits = { assetId: "generated", designPath: "/design/timeStyles/hour/rasterFont", requiredCharacters: "0123456789:" };
  const letters = { assetId: "letters", designPath: "/design/dateStyles/weekday/rasterFont", requiredCharacters: "AM" };
  const check = (assets) => tracker.review([review("generated_font", { evidenceCallIds: ["document", "preview"], assets })], document, request);
  assert.throws(() => check([digits]), /cover every required character/);
  assert.throws(() => check([digits, { ...letters, requiredCharacters: "A" }]), /cover every required character/);
  check([digits, letters]);
  assert.equal(tracker.items[0].status, "verified");
});

test("high resolution requires measured geometry and sufficient source pixels", () => {
  const tracker = fixture("resolution");
  const document = doc({ artwork: { assetId: "generated" } });
  const binding = { assetId: "generated", designPath: "/design/artwork", requiredWidth: 800, requiredHeight: 800 };
  const check = (assets = [binding], evidenceCallIds = ["document", "geometry"]) => tracker.review([review("resolution", { assets, evidenceCallIds })], document, request);
  assert.throws(() => check([binding], ["document"]), /get_geometry/);
  for (const change of [{ requiredWidth: 2048 }, { requiredHeight: 2048 }, { requiredWidth: 0 }, { requiredWidth: Infinity }]) {
    assert.throws(() => check([{ ...binding, ...change }]), /Source pixels/);
  }
  check();
  assert.equal(tracker.items[0].status, "verified");
});

const dynamicFixture = () => {
  const tracker = fixture("dynamic_assets");
  const stateReplacementsPath = "/design/configAssetOverrides/config:battery_icon/stateReplacements";
  const states = Object.fromEntries([0, 1, 2].map((index) => {
    tracker.assets.set(`frame-${index}`, { assetId: `frame-${index}`, width: 128, height: 64 });
    return [String(index), { dataUrl: { assetId: `frame-${index}` }, width: 128, height: 64 }];
  }));
  for (const percentage of [0, 50, 100]) tracker.evidence.set(`battery-${percentage}`, { tool: "render_preview", revision: 7, image: true, mode: "current", batteryPercent: percentage });
  const document = { ...doc({ configAssetOverrides: { "config:battery_icon": { stateReplacements: states } } }), capabilities: {
    assetContracts: [{ layerId: "batteryIcon", kind: "state-sprites", stateReplacementsPath, stateIndices: ["0", "1", "2"], installedStateIndices: ["0", "1", "2"] }]
  } };
  comparisonProof(tracker, target({ layerId: "batteryIcon", designPath: stateReplacementsPath }));
  const check = (input = document, evidenceCallIds = ["document", "geometry", "battery-0", "battery-50", "battery-100"], designPath = stateReplacementsPath) => tracker.review([review("dynamic_assets", {
    visualFindings: [finding()], evidenceCallIds: [...evidenceCallIds, "geometry"], assets: [{ assetId: "frame-0", designPath }]
  })], input, request);
  return { tracker, document, states, check };
};

test("a battery state requirement rejects a static sprite and one-image replacement", () => {
  const { check, document } = dynamicFixture();
  const replacement = { dataUrl: { assetId: "frame-0" }, width: 128, height: 64 };
  assert.throws(() => check({ ...document, design: { designSprites: [replacement] } }, undefined, "/design/designSprites/0"), /dynamic state set|standalone sprite/);
  assert.throws(() => check({ ...document, design: { configAssetOverrides: { "config:battery_icon": { replacement } } } }, undefined, "/design/configAssetOverrides/config:battery_icon/replacement"), /dynamic state set|standalone sprite/);
});

test("dynamic battery verifies every actual state and rejects missing or identical artwork", () => {
  {
    const { states, check } = dynamicFixture();
    delete states["2"];
    assert.throws(() => check(), /Every expected state/);
  }
  {
    const { tracker, check } = dynamicFixture();
    tracker.assets.delete("frame-2");
    assert.throws(() => check(), /Every expected state/);
  }
  {
    const { states, check } = dynamicFixture();
    states["1"].dataUrl = states["0"].dataUrl;
    states["2"].dataUrl = states["0"].dataUrl;
    assert.throws(() => check(), /all identical/);
  }
});

test("dynamic battery needs fresh rendered 0/50/100 scenarios and supports complete custom sets", () => {
  const { tracker, document, check } = dynamicFixture();
  assert.throws(() => check(document, ["document", "preview"]), /0%, 50% and 100%/);
  assert.throws(() => check(document, ["document", "battery-0", "battery-100"]), /0%, 50% and 100%/);
  tracker.evidence.get("battery-50").image = false;
  assert.throws(() => check(), /0%, 50% and 100%/);
  tracker.evidence.get("battery-50").image = true;
  check();
  assert.equal(tracker.items[0].status, "verified");
  tracker.invalidate();
  document.capabilities.assetContracts[0].stateIndices = [];
  check();
  assert.equal(tracker.items[0].status, "verified", "explicitly installed custom state set works without inventing a template count");
});

// Use the live exporter-derived contract inventory, not a hand-written imitation.
const { loadWatchfaceTestModules } = await import("./load-watchface-test-modules.mjs");
const [contractModule, nativeParts] = await loadWatchfaceTestModules([
  "/src/watchfaces/watchfaceComponentAssetContracts.ts", "/src/watchfaces/nativeDataParts.ts"
]);
const componentFixture = (id, options = {}) => {
  const tracker = fixture("dynamic_assets");
  const mode = options.mode ?? "current";
  const nativeId = options.nativeId ?? "stamina";
  const design = id.startsWith("weather:") ? { weatherIndicator: { enabled: true, x: 0, y: 0, scale: 1 } } : {
    nativeData: { [nativeId]: { ...nativeParts.defaultNativeDataStyle(nativeId), enabled: true, parts: { states: { enabled: true } }, ...options.style } }
  };
  const contracts = contractModule.watchfaceComponentAssetContracts(null, design, mode);
  const contract = contracts.find(entry => entry.id === id);
  assert.ok(contract, id);
  const states = Object.fromEntries(contract.stateIndices.map(index => {
    const assetId = `frame-${index}`;
    tracker.assets.set(assetId, { assetId, width: 128, height: 128 });
    return [index, { assetId }];
  }));
  if (id.startsWith("weather:")) design.weatherIndicator.assets = { [id.split(":")[1]]: states };
  else design.nativeData[nativeId].assets = { states };
  const document = { ...doc(mode === "aod" ? { modeDesigns: { aod: design } } : design), capabilities: { assetContracts: contracts } };
  const calls = ["document"];
  for (const [index, sample] of contract.verification.scenarios.entries()) {
    const callId = `sample-${index}`;
    tracker.evidence.set(callId, { tool: "render_preview", revision: 7, image: true, mode, scenario: sample.scenario });
    calls.push(callId);
  }
  comparisonProof(tracker, target({ layerId: contract.layerId, designPath: contract.assetsPath }, { mode }));
  const check = (evidenceCallIds = calls, designPath = contract.assetsPath) => tracker.review([review("dynamic_assets", {
    visualFindings: [finding()], evidenceCallIds: [...evidenceCallIds, "geometry"], assets: [{ assetId: "frame-0", designPath }]
  })], document, request);
  return { tracker, design, document, contract, states, check, calls };
};

test("weather day and night need complete generated sets and their own actual state scenarios", () => {
  for (const set of ["day", "night"]) {
    const { tracker, contract, states, check, calls } = componentFixture(`weather:${set}`);
    assert.equal(contract.stateIndices.length, 41);
    assert.throws(() => check(["document", "preview"]), /verification.scenarios/);
    tracker.evidence.get(calls[1]).scenario = { weather: { condition: 0, night: set !== "night" } };
    assert.throws(() => check(), /Day\/night/);
    tracker.evidence.get(calls[1]).scenario = contract.verification.scenarios[0].scenario;
    const last = states["40"];
    delete states["40"];
    assert.throws(() => check(), /Every expected state/);
    states["40"] = last;
    check();
    assert.equal(tracker.items[0].status, "verified");
  }
});

test("all supported native state selectors verify actual low middle high states", () => {
  for (const [nativeId, style] of [["stamina", {}], ["weather_uv", {}], ["weather_direction", { stateCount: 8 }], ["sleep_hrv_level", {}], ["sedentary", {}], ["chart", { chartSource: "chart_moon" }]]) {
    const { tracker, check, contract, calls } = componentFixture(`native:${nativeId}:states`, { nativeId, style });
    assert.equal(contract.verification.scope, "editor-state-selection");
    assert.throws(() => check(["document", ...calls.slice(1, -1)]), /verification.scenarios/);
    check();
    assert.equal(tracker.items[0].status, "verified", nativeId);
  }
});

test("dynamic checks reject wrong modes, stale samples, disabled layers and duplicate sampled frames", () => {
  const { tracker, check, contract, states, document, calls } = componentFixture("native:stamina:states", { mode: "aod" });
  tracker.evidence.get(calls[1]).mode = "current";
  assert.throws(() => check(), /matching display mode/);
  tracker.evidence.get(calls[1]).mode = "aod";
  tracker.evidence.get(calls[1]).revision = 6;
  assert.throws(() => check(), /current document revision/);
  tracker.evidence.get(calls[1]).revision = 7;
  contract.enabled = false;
  assert.throws(() => check(), /disabled or hidden/);
  contract.enabled = true;
  document.capabilities.layers = [{ id: contract.layerId, visible: false }];
  assert.throws(() => check(), /disabled or hidden/);
  document.capabilities.layers = [];
  assert.throws(() => check(), /layer is absent/);
  document.capabilities.layers = [{ id: "unrelated", visible: true }];
  assert.throws(() => check(), /layer is absent/);
  document.capabilities.layers = [{ id: contract.layerId, visible: true }];
  const saved = { ...states };
  for (const sample of contract.verification.scenarios) states[sample.expectedPreviewStateIndex] = states["0"];
  assert.throws(() => check(), /sampled state images are identical/);
  Object.assign(states, saved);
  check();
});

test("dynamic preview evidence must explicitly identify its display mode", () => {
  const native = componentFixture("native:stamina:states");
  delete native.tracker.evidence.get(native.calls[1]).mode;
  assert.throws(() => native.check(), /matching display mode/);
  native.tracker.evidence.get(native.calls[1]).mode = "current";
  native.check();
  const battery = dynamicFixture();
  delete battery.tracker.evidence.get("battery-50").mode;
  assert.throws(() => battery.check(), /matching display mode/);
  battery.tracker.evidence.get("battery-50").mode = "current";
  battery.check();
});

test("incompatible native mappings and unselectable roles cannot claim dynamic verification", () => {
  for (const [nativeId, stateCount] of [["stamina", 12], ["weather_uv", 7]]) {
    const { check, contract } = componentFixture(`native:${nativeId}:states`, { nativeId, style: { stateCount } });
    assert.equal(contract.verification.supported, false);
    assert.throws(() => check(), /verification is unavailable/);
  }
  const inventory = contractModule.watchfaceComponentAssetContracts(null, { weatherIndicator: { enabled: true } }, "current");
  assert.equal(inventory.find(entry => entry.id === "weather:units").verification.supported, false);
});

test("selectable battery proof must actually show the battery complication", () => {
  const { tracker, document, check } = dynamicFixture();
  document.capabilities.assetContracts[0].layerId = "controlBatteryIcon";
  comparisonProof(tracker, target({ layerId: "controlBatteryIcon", designPath: document.capabilities.assetContracts[0].stateReplacementsPath }));
  assert.throws(() => check(), /Select the battery complication/);
  for (const percentage of [0, 50, 100]) tracker.evidence.get(`battery-${percentage}`).previewComplication = "battery";
  check();
});

test("restoring verification reopens blockers and preserves their explanation", () => {
  const original = fixture();
  original.review([review("document")], doc(), request);
  original.update([requirement("data_mapping")], [request]);
  original.review([{ id: "data_mapping", status: "blocked", blockerKind: "unsupported_capability", evidenceCallIds: ["document"], detail: "Firmware does not expose a live battery arc." }], doc(), request);
  const tracker = new WatchfaceRequirements();
  tracker.restore(original.items, [...original.assets.values()]);
  assert.throws(() => tracker.requireBeforeWork(), /update_requirements/);
  assert.equal(tracker.items.find((item) => item.id === "document").status, "pending");
  assert.equal(tracker.items.find((item) => item.id === "data_mapping").status, "pending");
  assert.match(tracker.items.find((item) => item.id === "data_mapping").detail, /Firmware/);
  assert.equal(tracker.assets.get("generated").width, 1024);
  tracker.update([requirement()], [request, "Continue"]);
  assert.doesNotThrow(() => tracker.requireBeforeWork());
  assert.throws(() => tracker.review([review("document")], doc(), "Continue"), /Verification requires/);
});

test("restore resets transient evidence and reconciliation even on a reused tracker", () => {
  const tracker = fixture();
  tracker.restore([requirement()]);
  assert.throws(() => tracker.requireBeforeWork(), /update_requirements/);
  assert.equal(tracker.evidence.size, 0);
  assert.equal(tracker.assets.size, 0);
});

test("superseding requires inherited requirement and a quote from latest user message", () => {
  const tracker = fixture();
  const supersede = { id: "document", status: "superseded", detail: "User revised the requirement.", userChangeQuote: "Use D-DIN instead" };
  assert.throws(() => tracker.review([supersede], doc(), "Use D-DIN instead"), /later message/);
  tracker.restore(tracker.items);
  tracker.update([requirement()], [request, "Use D-DIN instead"]);
  assert.throws(() => tracker.review([{ ...supersede, userChangeQuote: request }], doc(), "Use D-DIN instead"), /later message/);
  tracker.review([supersede], doc(), "Use D-DIN instead");
  assert.equal(tracker.items[0].status, "superseded");
  tracker.update([requirement("visual")], [request, "Use D-DIN instead"]);
  assert.throws(() => tracker.review([{ id: "document", status: "pending", detail: "Restore it" }], doc(), request), /retained as history/);
});

test("sanitizer and actual chat store preserve requirements and generated provenance", async () => {
  const items = [requirement("visual", { status: "verified" }), requirement("generated_font", { status: "blocked", detail: "Need the remaining punctuation.", requiredCharacters: "0123456789:" })];
  const sanitized = sanitizeRequirements([...items, null, { ...items[0] }, { ...items[0], id: "bad/id" }]);
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[1].requiredCharacters, "0123456789:");
  const memory = sanitizeWatchfaceAiMemory({ version: 1, projectId: "test", entries: [], requirements: items, generatedAssets: [{ assetId: "generated", width: 1024, height: 1024 }, { assetId: "invalid", width: -1, height: 10 }] });
  assert.equal(memory.requirements.length, 2);
  assert.equal(memory.generatedAssets.length, 1);
  const directory = await mkdtemp(path.join(os.tmpdir(), "watchmaker-requirements-"));
  try {
    const store = new WatchfaceAiChatStore(directory);
    const saved = await store.save({ projectKey: "test", messages: [{ role: "user", content: request }, { role: "assistant", content: "", error: "Interrupted", memory }] });
    const loaded = await new WatchfaceAiChatStore(directory).load(saved.id);
    assert.deepEqual(sanitizeWatchfaceAiMemory(loaded.messages[1].memory), memory);
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test("all typography covers each role, native sparse symbols, calendar labels and AM/PM", () => {
  const tracker = fixture("generated_font", { typographyScope: "all" });
  const design = { timeStyles: { hours: { rasterFont: font } }, dateStyles: { weekday: { rasterFont: { ...font, labels: Object.fromEntries(["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"].map(label => [label, { assetId: "generated" }])) } } }, ampmIndicator: { enabled: true, rasterFont: { ...font, labels: { AM: { assetId: "generated" }, PM: { assetId: "generated" } } } }, nativeData: { distance: { assets: { digits: Object.fromEntries([..."0123456789"].map(index => [index, { assetId: "generated" }])), symbols: { "3": { assetId: "generated" } } } } } };
  const contracts = [
    { id: "typography:hours", layerId: "hours", rasterFontPath: "/design/timeStyles/hours/rasterFont", orderedValues: [..."0123456789"] },
    { id: "typography:weekday", layerId: "weekday", rasterFontPath: "/design/dateStyles/weekday/rasterFont", orderedValues: ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] },
    { id: "ampm", layerId: "ampm", kind: "paired-labels", rasterFontPath: "/design/ampmIndicator/rasterFont", orderedValues: ["AM", "PM"] },
    { id: "native:distance:digits", layerId: "native:distance", kind: "native-component-assets", assetRole: "digits", assetsPath: "/design/nativeData/distance/assets/digits", stateIndices: [..."0123456789"] },
    { id: "native:distance:symbols", layerId: "native:distance", kind: "native-component-assets", assetRole: "symbols", assetsPath: "/design/nativeData/distance/assets/symbols", stateIndices: ["3"] }
  ];
  const document = { ...doc(design), capabilities: { assetContracts: contracts, layers: ["hours", "weekday", "ampm", "native:distance"].map(id => ({ id, visible: true })) } };
  tracker.captureTypography(document);
  const bindings = contracts.map(contract => ({ assetId: "generated", designPath: contract.rasterFontPath ?? contract.assetsPath }));
  const check = (assets = bindings) => tracker.review([review("generated_font", { assets, evidenceCallIds: ["document", "preview"] })], document, request);
  assert.throws(() => check([bindings[0]]), /weekday.*missing installed font binding/);
  delete design.ampmIndicator.rasterFont.labels.PM;
  assert.throws(() => check(), /missing required characters/);
  design.ampmIndicator.rasterFont.labels.PM = { assetId: "generated" };
  design.nativeData.distance.assets.symbols = { "0": { assetId: "generated" } };
  assert.throws(() => check(), /Every native digit/);
  design.nativeData.distance.assets.symbols = { "3": { assetId: "generated" } };
  check();
  document.capabilities.layers = document.capabilities.layers.filter(layer => layer.id !== "weekday");
  assert.throws(() => check(), /weekday.*hidden/);
});

test("static text cannot disappear from the saved all-typography obligation", () => {
  const tracker = fixture("generated_font");
  const contract = { id: "bgel:km", layerId: "bgel:km", kind: "drawn-element", elementKind: "text", elementPath: "/design/backgroundElements/0" };
  const document = { ...doc({ backgroundElements: [{ id: "km", kind: "text", text: "KM" }] }), capabilities: { assetContracts: [contract], layers: [{ id: "bgel:km", visible: true }] } };
  tracker.captureTypography(document);
  document.design.backgroundElements = [];
  document.capabilities.assetContracts = [];
  document.capabilities.layers = [{ id: "sprite:km", visible: true }];
  document.design.designSprites = [{ id: "km", dataUrl: { assetId: "generated" } }];
  const binding = { assetId: "generated", designPath: "/design/designSprites/0/dataUrl", componentId: "bgel:km" };
  const check = () => tracker.review([review("generated_font", { assets: [binding], evidenceCallIds: ["document", "preview"] })], document, request);
  // No digit requirement is implied for an explicitly captured static-only inventory.
  check();
  document.capabilities.layers[0].visible = false;
  assert.throws(check, /replacement static text is hidden/);
});

test("failed atlases cannot be dismissed as hard blockers without capability evidence", () => {
  const tracker = fixture("generated_font");
  assert.throws(() => tracker.review([{ id: "generated_font", status: "blocked", detail: "Two atlases looked bad." }], doc(), request), /recoverable/);
  assert.equal(tracker.items[0].status, "pending");
});

test("dynamic states reject static fallback, inconsistent canvases and uninspected background", () => {
  const { document, states, check } = dynamicFixture();
  document.design.configAssetOverrides["config:battery_icon"].replacement = states["0"];
  assert.throws(() => check(), /Remove the single static replacement/);
  delete document.design.configAssetOverrides["config:battery_icon"].replacement;
  states["1"].width = 64;
  assert.throws(() => check(), /consistent positive canvas/);
});

test("visual targets survive saving and cannot be silently switched from ring to icon", () => {
  const tracker = fixture("visual", { visualTargets: [target()] });
  assert.throws(() => tracker.update([requirement("visual", { visualTargets: [target(undefined, { region: { ...region, width: .05 } })] })], [request]), /silently rewritten/);
  const saved = sanitizeRequirements(tracker.items);
  assert.deepEqual(saved[0].visualTargets, [target()]);
  tracker.restore(saved);
  tracker.update([requirement("visual")], [request]);
  assert.deepEqual(tracker.items[0].visualTargets, [target()], "omitting targets preserves them");
});

test("fidelity needs fresh inspected crops at native and master size, and admits approximations", () => {
  const tracker = fixture("visual");
  comparisonProof(tracker, target());
  const document = { ...doc(), capabilities: { resolutions: [{ width: 416 }, { width: 800 }] } };
  const check = (f = finding(), status = "verified", round = 2) => tracker.review([review("visual", { evidenceCallIds: ["preview"], visualFindings: [f], status })], document, request, round);
  assert.throws(() => check(), /native and master/);
  tracker.evidence.set("master", structuredClone(tracker.evidence.get("comparison")));
  Object.assign(tracker.evidence.get("master").comparison, { width: 800, height: 800 });
  const valid = finding({ comparisonCallIds: ["comparison", "master"] });
  assert.throws(() => check(valid, "verified", 1), /later round/);
  const approximate = { ...valid, verdict: "approximation", remainingDifferences: ["Teko digits are too narrow and widely spaced."] };
  assert.throws(() => check(approximate), /approximation/);
  check(approximate, "implemented");
  assert.equal(tracker.unresolved().length, 1);
  assert.deepEqual(sanitizeRequirements(tracker.items)[0].visualFindings[0].remainingDifferences, approximate.remainingDifferences);
  tracker.evidence.get("comparison").revision = 6;
  assert.throws(() => check(valid), /current revision/);
  tracker.evidence.get("comparison").revision = 7;
  check(valid);
});

test("target geometry rejects hidden, oversized, wrong-mode and nearby components", () => {
  const t = target({ layerId: "batteryIcon", designPath: "/design/states" });
  const document = { revision: 7, capabilities: { placement: { width: 800, height: 800 } } };
  const geometry = { revision: 7, mode: "current", layers: [{ id: "batteryIcon", visible: true, box: { x: 480, y: 120, width: 200, height: 200 } }] };
  assert.doesNotThrow(() => assertDynamicTargetGeometry(t, document, geometry));
  for (const patch of [{ width: 20 }, { width: 800 }, { x: 250 }]) {
    const invalid = structuredClone(geometry); Object.assign(invalid.layers[0].box, patch);
    assert.throws(() => assertDynamicTargetGeometry(t, document, invalid), /does not cover/);
  }
  geometry.layers[0].visible = false;
  assert.throws(() => assertDynamicTargetGeometry(t, document, geometry), /Fresh geometry/);
  geometry.layers[0].visible = true; geometry.mode = "aod";
  assert.throws(() => assertDynamicTargetGeometry(t, document, geometry), /Fresh geometry/);
});

test("nearby icon evidence cannot verify the intended dynamic ring", () => {
  const { tracker, check } = dynamicFixture();
  tracker.evidence.get("comparison").comparison.dynamic.layerId = "controlBatteryIcon";
  assert.throws(() => check(), /exact requested live target/);
  tracker.evidence.get("comparison").comparison.dynamic.layerId = "batteryIcon";
  tracker.evidence.get("comparison").comparison.dynamic.changedFractions = [0, 0, 0];
  assert.throws(() => check(), /exact requested live target/);
});

let failures = 0;
for (const { name, run } of cases) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
}
assert.equal(failures, 0, `${failures} requirement regression(s) failed`);
console.log(`Watchmaker requirement tests passed (${cases.length} cases).`);
