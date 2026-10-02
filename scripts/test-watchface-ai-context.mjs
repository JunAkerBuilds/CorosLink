import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWatchfaceTestModules } from "./load-watchface-test-modules.mjs";
const require = createRequire(import.meta.url);
const { focusWatchfaceSchema, focusWatchfaceDocument, compactWatchfaceInputs, sanitizeWatchfaceAiMemory, evidenceJson, watchfaceEditEvidence } = require("../dist-electron/watchfaceAiContext.js");
const { WatchfaceAiChatStore } = require("../dist-electron/watchfaceAiChatStore.js");
const [module] = await loadWatchfaceTestModules(["/src/watchfaces/watchfaceAutomationSchema.ts"]);
const schema = module.getWatchfaceAutomationSchema();
const focused = focusWatchfaceSchema(schema);
assert.deepEqual(focused.nativeFields.find(field => field.id === "date_year").creation, { op: "add_native_field", requiresTemplateField: false }, "AI sees that missing year can be created in its initial context");
assert.ok(focused.commands.items.oneOf.some(command => command.properties.op.const === "add_native_field"));
assert.deepEqual(focused.commands, schema.commands, "all command definitions remain available initially");
assert.ok(focused.designProperties.includes("configAssetOverrides"));
assert.equal(focused.nativeFields.length, schema.nativeData.fields.length);
assert.deepEqual(focused.nativeFields.find(field => field.id === "sunriseset").components.find(part => part.assetRole === "symbols").stateIndices, ["3"], "initial context retains sparse role indices before enabling a component");
assert.equal(focused.nativeFields.find(field => field.id === "weather_direction").components.find(part => part.assetRole === "states").spriteCount, 16, "catalog defaults are available for planning new components");
assert.deepEqual(focusWatchfaceSchema(schema, "document"), schema.document);
assert.deepEqual(focusWatchfaceSchema(schema, "full"), schema);
const id = schema.nativeData.fields[0].id;
assert.equal(focusWatchfaceSchema(schema, "nativeData", [id]).fields.length, 1);
assert.throws(() => focusWatchfaceSchema(schema, "nativeData", ["unknown"]), /Unknown native/);
assert.throws(() => focusWatchfaceSchema(schema, "unknown"), /Unknown schema/);
const ratio = JSON.stringify(focused).length / JSON.stringify(schema).length;
assert.ok(ratio < .4, "focused schema should remove at least 60% of initial schema text");

const document = { sessionId: "fixture", revision: 8, view: { mode: "current" }, design: { layoutOffsets: { arcCut: { dx: 10, dy: 20 } }, configTextEdits: { "config.txt": "[raw]=text" }, modeDesigns: { aod: { backgroundColor: "#000000" } } }, advanced: { configTextBaselines: "long raw config" }, capabilities: { layers: [{ id: "arcCut" }], nativeResolutions: [{ directory: "800", width: 800, height: 800, icons: ["many sprites"], config: { key: "value" } }] } };
const compact = focusWatchfaceDocument(document);
assert.deepEqual(compact.design.layoutOffsets, document.design.layoutOffsets);
assert.deepEqual(compact.capabilities.layers, document.capabilities.layers);
assert.equal(compact.advanced, undefined);
assert.equal(compact.design.modeDesigns, undefined);
assert.equal(compact.capabilities.nativeResolutions[0].icons, undefined);
assert.deepEqual(focusWatchfaceDocument({ ...document, view: { mode: "aod" } }).design.modeDesigns, document.design.modeDesigns);
assert.ok(document.advanced, "compaction never mutates the live source");

const inputs = Array.from({ length: 5 }, (_, index) => ({ type: "function_call_output", output: JSON.stringify({ ...document, revision: index }) }));
inputs.push(...Array.from({ length: 5 }, () => ({ type: "message", role: "user", content: [{ type: "input_text", text: "Rendered preview returned by render_preview" }, { type: "input_image", image_url: "data:image/png;base64,preview" }] })));
inputs.push({ type: "message", role: "user", content: [{ type: "input_text", text: "My reference" }, { type: "input_image", image_url: "data:image/png;base64,reference" }] });
compactWatchfaceInputs(inputs);
assert.equal(inputs.filter((item) => item.output && JSON.parse(item.output).design).length, 2);
assert.equal(inputs.filter((item) => item.content?.some((part) => part.type === "input_image")).length, 3, "retain two previews plus the user's reference");

const memory = { version: 1, projectId: "face", entries: [{ tool: "apply_commands", status: "failed", summary: "Arc stayed still; inspect geometry before retrying." }] };
assert.deepEqual(sanitizeWatchfaceAiMemory(memory), memory);
assert.equal(sanitizeWatchfaceAiMemory({ version: 2, entries: [] }), undefined);
assert.equal(sanitizeWatchfaceAiMemory({ version: 1, entries: [null, { status: "invalid" }] }).entries.length, 0);
assert.ok(!evidenceJson({ dataUrl: "data:image/png;base64,secretpixels" }).includes("secretpixels"));
assert.deepEqual(watchfaceEditEvidence({}, {}, [{ op: "move_layer", id: "missing", dx: 10 }]).movementWarnings, [], "missing bounds are not proof of a failed movement");
const positioned = (x, y) => ({ capabilities: { layers: [{ id: "mask", bounds: { x0: 0, y0: 0 }, placement: { bounds: { x0: x, y0: y, x1: x + 20, y1: y + 20 } } }] } });
assert.equal(watchfaceEditEvidence(positioned(0, 0), positioned(10, 10), [{ op: "move_layer", id: "mask", dx: 10, dy: 10 }]).movementWarnings.length, 0, "compare placement coordinates rather than another frame's bounds");
assert.match(watchfaceEditEvidence(positioned(0, 0), positioned(10, 0), [{ op: "move_layer", id: "mask", dx: 10, dy: 10 }]).movementWarnings[0], /differs/);

const directory = await mkdtemp(path.join(os.tmpdir(), "watchmaker-memory-"));
try {
  const store = new WatchfaceAiChatStore(directory);
  const saved = await store.save({ projectKey: "face", messages: [{ role: "assistant", content: "", error: "Interrupted", memory }] });
  const reopened = await new WatchfaceAiChatStore(directory).load(saved.id);
  assert.deepEqual(sanitizeWatchfaceAiMemory(reopened.messages[0].memory), memory, "failed-attempt evidence survives saving and reopening the app's chat store");
} finally { await rm(directory, { recursive: true, force: true }); }
console.log(`Watchmaker context tests passed; initial schema ${JSON.stringify(schema).length} → ${JSON.stringify(focused).length} characters (${Math.round((1-ratio)*100)}% smaller).`);
