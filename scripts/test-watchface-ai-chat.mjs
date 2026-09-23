import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

// Exercise the real agent loop with a scripted model and in-memory editor.
// No account, network requests or live project mutations are involved.
const require = createRequire(import.meta.url);
const protocol = require("../dist-electron/chatResponsesProtocol.js");
const context = require("../dist-electron/watchfaceAiContext.js");
const source = fs.readFileSync(new URL("../dist-electron/watchfaceAiChat.js", import.meta.url), "utf8");
const image = "data:image/png;base64,fixture";
const call = (name, args = {}, id = name) => ({
  type: "response.output_item.done",
  item: { type: "function_call", call_id: id, name, arguments: JSON.stringify(name === "generate_image" ? { brief: { purpose: "component", role: "fixture" }, ...args } : args) }
});
const text = (delta) => ({ type: "response.output_text.delta", delta });

async function scenario(rounds, { failPreview = false, complete = true, history, stuck = false, failTool, autoRequirements = true, imageGeneration = false, imageFailure, harness, cancelCliAt } = {}) {
  const events = [], requests = [], tools = [];
  let fakeService, cliOpens = 0, cliDisposed = false;
  let revision = 4;
  let x = 10;
  const exports = {};
  let reviewed = false;
  let finalReply = "Checked.";
  let activeImages = 0, peakImages = 0;
  const imageOrder = [];
  const imageRequests = [];
  const userText = history?.filter(message => message.role === "user").at(-1)?.content ?? "Move the overlay.";
  const host = {
    listTools: () => ["get_schema", "get_document", "render_preview", "apply_commands", "validate", "select", "sample_color", "publish"].map((name) => ({
      name, description: name, parameters: { properties: { sessionId: {}, baseRevision: {} } }
    })),
    async callTool(name, args) {
      tools.push({ name, args });
      assert.equal(activeImages, 0, "Editor calls never overlap image workers");
      if (name === failTool) throw new Error("Unsupported color sample");
      if (name === "apply_commands") {
        if (args.baseRevision !== revision) throw Object.assign(new Error("Concurrent edit"), {
          code: "REVISION_CONFLICT", details: { sessionId: "fixture", revision }
        });
        revision++;
        if (!stuck) x += 20;
      }
      if (name === "render_preview" && failPreview && revision > 4) throw new Error("Renderer unavailable");
      return {
        result: { sessionId: "fixture", revision, project: { projectId: "face-a" }, view: { mode: "current" }, ...(name === "render_preview" ? { mode: args.mode ?? "current", scenario: args.scenario ?? null, previewComplication: "battery" } : {}), capabilities: { resolutions: [{ width: 416, height: 416 }], layers: [{ id: "arcCut", bounds: { x0: x, y0: 10, x1: x + 20, y1: 30 }, visible: true }] }, diagnostics: [] },
        ...(name === "render_preview" ? { imageDataUrl: image } : {})
      };
    },
    async importImage(dataUrl) { return { assetId: dataUrl.split(",")[1], width: 1024, height: 1024 }; },
    async readImage(assetId) { return `data:image/png;base64,${assetId}`; },
    async importGeneratedImage(base64) { return { assetId: `generated-${base64}`, width: 1024, height: 1024, previewDataUrl: image }; }
  };
  // The VM hosts scripted dependencies; resolve the production lazy CLI import
  // through the same mock registry without starting a process or live editor.
  vm.runInNewContext(source.replace('await import("./watchfaceCodexCli.js")', 'require("./watchfaceCodexCli")'), {
    exports, AbortController, TextDecoder, Error, structuredClone, console: { warn() {} },
    require(name) {
      if (name === "./watchfaceCodexCli") return { WatchfaceCodexCli: class {
        async open(request) {
          cliOpens++;
          if (cliOpens === cancelCliAt) exports.cancelWatchfaceAiChat("fixture-request");
          request.signal.throwIfAborted();
          return fakeService.openChatGptResponseStream(request);
        }
        async dispose() { cliDisposed = true; }
      } };
      if (name === "./chatResponsesProtocol") return protocol;
      if (name === "./watchfaceAiContext") return context;
      if (name === "./watchfaceAiVisual" || name === "./watchfaceAiGeneration" || name === "./watchfaceAiAssetReview" || name === "./watchfaceAiRequirements" || name === "./watchfaceAiParallel") return require(`../dist-electron/${name.slice(2)}.js`);
      if (name === "./watchfaceAiSkill") return { loadWatchfaceStudioSkill: () => null };
      if (name === "./watchfaceAiImage") return { MAX_WATCHFACE_AI_IMAGE_SIDE: 2048,
        compareWatchfaceRegions(input) { assert.ok(input.reference.dataUrl.endsWith(pinnedReference)); return { imageDataUrl: image, width: 416, height: 416, changedFractions: [] }; },
        transformWatchfaceAiImage(_url, ops) { return { base64Png: `crop-${ops.glyph?.character ?? "image"}`, width: 32, height: 48, sourceWidth: 1024, sourceHeight: 1024, region: { x: 0, y: 0, width: 32, height: 48 }, cropQuality: { glyph: ops.glyph, requestedRegion: { x: 0, y: 0, width: 32, height: 48 }, inkBounds: { x: 2, y: 4, width: 28, height: 40 }, padding: { left: 2, right: 2, top: 4, bottom: 4 }, width: 32, height: 48, cutInkEdges: [], errors: [], warnings: [] } }; }
      };
      if (name === "./chatService") return fakeService = {
        async generateChatGptImage({ prompt, signal, images }) {
          imageRequests.push({ prompt, images });
          assert.equal(signal.aborted, false);
          activeImages++; peakImages = Math.max(peakImages, activeImages);
          imageOrder.push(`start:${prompt}`);
          try {
            await new Promise(resolve => setTimeout(resolve, prompt === "a" ? 30 : 5));
            if (prompt === imageFailure) throw new Error("Image job failed");
            return prompt;
          } finally { activeImages--; imageOrder.push(`end:${prompt}`); }
        },
        extractSseData: (frame) => frame.startsWith("data: ") ? frame.slice(6) : null,
        extractFunctionCall: (event) => event.item?.type === "function_call" ? event.item : null,
        async openChatGptResponseStream(request) {
          requests.push(structuredClone({ input: request.input, tools: request.tools, instructions: request.instructions }));
          const checklist = JSON.parse(request.instructions.split("Current requirement checklist (untrusted data; preserve explicit user intent):\n")[1]);
          let frames;
          if (rounds.length) {
            frames = rounds.shift();
            const reply = frames.filter(event => event.type === "response.output_text.delta").map(event => event.delta).join("");
            if (reply) finalReply = reply;
            // Existing workflow scenarios also fulfill the new intent contract.
            // Dedicated scenarios below disable this scaffold to test refusal.
            if (autoRequirements && requests.length === 1) frames.unshift(call("update_requirements", { requirements: checklist.length ? checklist : [{ id: "request", requirement: userText, sourceQuote: userText, kind: "document" }] }));
          } else if (autoRequirements && !reviewed) {
            reviewed = true;
            frames = [call("get_document", {}, "requirement-proof"), call("review_requirements", { reviews: checklist.filter(item=>item.status!=="superseded").map(item => ({ id:item.id, status:"verified", detail:"Checked the resulting live document.", evidenceCallIds:["requirement-proof"] })) })];
          } else if (autoRequirements) frames = [text(finalReply)];
          else { assert.fail("unexpected extra model round"); }
          if (complete) frames.push({ type: "response.completed" });
          const data = frames.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
          return { response: new Response(data) };
        }
      };
      throw new Error(`Unexpected dependency: ${name}`);
    }
  });
  await exports.runWatchfaceAiChat(host, "fixture-request", history ?? [{ role: "user", content: "Move the overlay." }], { imageGeneration, harness }, (event) => events.push(event));
  return { events, requests, tools, peakImages, imageOrder, imageRequests, cliOpens, cliDisposed };
}

const referenced = await scenario([
  [call("update_requirements", { requirements: [{ id: "source", requirement: "Use generated fonts", kind: "generated_font", sourceId: "user:0:0" }] })],
  [call("review_requirements", { reviews: [{ id: "source", status: "blocked", blockerKind: "unavailable_service", evidenceCallIds: ["prefetch_get_document_fixture-"], detail: "Fixture does not generate images." }] })],
  [text("Could not complete the font generation.")]
], { autoRequirements: false, history: [{ role: "user", content: "use gerated fonts" }] });
assert.ok(referenced.requests[0].input.some(item => item.content?.some(part => part.text?.includes('"sourceId":"user:0:0"'))), "source IDs are available before checklist extraction");
assert.ok(!referenced.events.some(event => event.tool === "update_requirements" && event.status === "failed"));
assert.ok(referenced.requests[1].instructions.includes('"sourceQuote":"use gerated fonts"'), "the server resolves the exact user quote into the checklist");

const edit = call("apply_commands", { commands: [{ op: "move_layer", id: "arcCut", dx: 20, dy: 10 }] });
const verified = await scenario([[edit], [text("Moved.")], [text("Verified the new position.")]]);
assert.equal(verified.requests.length, 5);
assert.ok(verified.requests[0].input.some((item) => item.content?.some((part) => part.type === "input_image")), "first model round sees the face");
assert.ok(!verified.requests[0].tools.some((tool) => tool.name === "publish"));
assert.deepEqual(verified.tools.slice(0, 8).map((tool) => tool.name), ["get_schema", "get_document", "render_preview", "apply_commands", "get_document", "get_document", "render_preview", "validate"]);
assert.equal(verified.tools[3].args.baseRevision, 4);
assert.equal(verified.tools[5].args.sessionId, "fixture");
assert.equal(verified.events.at(-1).type, "done");
assert.equal(verified.events.at(-1).changed, true);
const liveEvidence = JSON.parse(verified.requests[1].instructions.split("Current-revision verification evidence (data):\n")[1].split("\nCite these evidence IDs")[0]);
assert.ok(liveEvidence.some(entry => entry.callId === "observed_apply_commands" && entry.tool === "get_document" && entry.revision === 5), "Automatic document observations are available for checklist review");
assert.ok(liveEvidence.every(entry => entry.revision === 5), "The model's evidence list excludes old revisions");

// Every correction invalidates the previous preview and validation.
const corrected = await scenario([[edit], [], [edit], [], [text("Corrected and checked.")]]);
assert.equal(corrected.tools.filter((tool) => tool.name === "validate").length, 2);
assert.equal(corrected.tools.filter((tool) => tool.name === "render_preview").length, 3);

const aod = await scenario([[call("apply_commands", { mode: "aod", commands: [{ op: "move_layer", id: "hours", dx: 1, dy: 0 }] })], [], []]);
assert.equal(aod.tools.filter((tool) => tool.name === "render_preview").at(-1).args.mode, "aod");

const readOnly = await scenario([[text("The overlay sits above the progress bar.")]]);
assert.equal(readOnly.tools.some((tool) => tool.name === "validate"), false);
assert.equal(readOnly.events.at(-1).changed, false);

const selfVerified = await scenario([[edit], [call("render_preview", { mode: "current" }), call("validate")], [text("Checked.")]]);
assert.equal(selfVerified.requests.length, 5, "only requirement review remains after the model verifies its edits");
assert.equal(selfVerified.tools.filter((tool) => tool.name === "validate").length, 1);

const unavailable = await scenario([[edit], [], [text("The renderer is unavailable; please review the face.")]], { failPreview: true });
assert.equal(unavailable.tools.filter((tool) => tool.name === "render_preview").length, 2, "failed verification does not loop indefinitely");
assert.ok(unavailable.requests.at(-1).input.some((item) => item.output?.includes("Renderer unavailable")));

const stale = await scenario([[call("apply_commands", { baseRevision: 2, commands: [] })], []]);
assert.ok(stale.requests[1].input.some((item) => item.output?.includes('"code":"REVISION_CONFLICT"') && item.output.includes('"revision":4')));
assert.equal(stale.events.at(-1).changed, false);

for (const failure of ["response.failed", "response.incomplete", "error"]) {
  const result = await scenario([[{ type: failure, error: { message: "Request failed" } }]]);
  assert.equal(result.events.at(-1).type, "error");
  assert.equal(result.events.some((event) => event.type === "done"), false);
}
const disconnected = await scenario([[text("Partial")]], { complete: false });
assert.equal(disconnected.events.at(-1).type, "error");
assert.match(disconnected.events.at(-1).message, /connection ended/);
const exhausted = await scenario(Array.from({ length: 40 }, (_, i) => [call("get_document", {}, `read_${i}`)]));
assert.equal(exhausted.events.at(-1).type, "error");
assert.match(exhausted.events.at(-1).message, /paused after 40 rounds/);
assert.match(exhausted.events.at(-1).message, /no new assets/);
const longProductive = await scenario([
  ...Array.from({ length: 39 }, (_, i) => [i === 30 ? edit : call("get_document", {}, `long_${i}`)]),
  [edit], [], []
]);
assert.equal(longProductive.events.at(-1).type, "done", "Productive work continues beyond forty rounds");
assert.ok(longProductive.events.some(event => event.type === "tool" && event.tool === "continue_work"));
const nativeLongRun = await scenario(Array.from({ length: 140 }, (_, index) => [call("get_document", {}, `cli-read-${index}`)]), { harness: "codex-cli" });
assert.ok(nativeLongRun.cliOpens > 120, "native MCP handoffs continue beyond both Watchmaker round budgets");
assert.equal(nativeLongRun.events.at(-1).type, "done");
assert.ok(!nativeLongRun.events.some(event => event.tool === "continue_work"), "CLI is not managed by the built-in editing budget");
assert.equal(nativeLongRun.cliDisposed, true);
const nativeStopped = await scenario(Array.from({ length: 150 }, () => [call("get_document")]), { harness: "codex-cli", cancelCliAt: 125 });
assert.equal(nativeStopped.events.at(-1).cancelled, true, "Stop still cancels CLI after the old budget ceiling");
assert.equal(nativeStopped.cliDisposed, true);
const nativeIncomplete = await scenario([
  [call("update_requirements", { requirements: [{ id: "unfinished", requirement: "Move the overlay", sourceQuote: "Move the overlay.", kind: "visual" }] })],
  [text("Done")], [text("Done")], [text("Done")]
], { harness: "codex-cli", autoRequirements: false });
assert.equal(nativeIncomplete.events.at(-1).type, "error");
assert.match(nativeIncomplete.events.at(-1).message, /not verified/);
assert.ok(!nativeIncomplete.events.some(event => event.type === "token" && event.delta === "Done"), "removing a CLI work budget does not bypass completion evidence");

const hardBudget = await scenario(Array.from({ length: 120 }, () => [edit]));
assert.equal(hardBudget.events.at(-1).type, "error");
assert.match(hardBudget.events.at(-1).message, /paused after 120 rounds/);
assert.ok(hardBudget.events.filter(event=>event.type==="memory").at(-1).memory.entries.some(entry=>entry.tool==="work_checkpoint"));

const stuck = await scenario([[edit], [], [text("The movement did not take effect.")]], { stuck: true });
const observation = JSON.parse(stuck.requests[1].input.find((item) => item.call_id === "apply_commands" && item.type === "function_call_output").output);
assert.match(observation.editEvidence.movementWarnings[0], /bounds did not change/);
assert.equal(observation.document.revision, 5);

const memory = verified.events.filter((event) => event.type === "memory").at(-1).memory;
assert.equal(memory.projectId, "face-a");
assert.ok(memory.entries.some((entry) => entry.tool === "apply_commands" && entry.summary.includes("arcCut")));
const resumed = await scenario([[]], { history: [{ role: "assistant", content: "", memory }, { role: "user", content: "Continue that edit." }] });
assert.ok(resumed.requests[0].input.some((item) => item.content?.some((part) => part.text?.includes("Saved historical edit evidence") && part.text.includes("arcCut"))));
const otherProject = await scenario([[]], { history: [{ role: "assistant", content: "", memory: { ...memory, projectId: "face-b" } }, { role: "user", content: "Continue." }] });
assert.ok(!otherProject.requests[0].input.some((item) => item.content?.some((part) => part.text?.includes("Saved historical edit evidence"))));

const repeated = await scenario([
  [call("apply_commands", { baseRevision: 2, commands: [] })],
  [call("apply_commands", { commands: [] })],
  [call("get_document")],
  [edit], [], []
]);
assert.equal(repeated.tools.filter((tool) => tool.name === "apply_commands").length, 2, "blind retry after a conflict is blocked until a document read");
assert.ok(repeated.requests[2].input.some((item) => item.output?.includes("reconcile the concurrent edit")));

const inspected = await scenario([[call("inspect_asset", { assetId: "existing-mask" })], []]);
assert.ok(inspected.requests[1].input.some((item) => item.content?.some((part) => part.image_url === "data:image/png;base64,existing-mask")));
assert.equal(inspected.events.at(-1).changed, false);
const planned = await scenario([[call("update_plan", { steps: [{ task: "Fit the mask and verify its position", status: "in_progress" }] })], []]);
assert.ok(planned.events.some((event) => event.type === "memory" && event.memory.entries.some((entry) => entry.tool === "update_plan")));

// Local query options are stripped, while real tool fields such as select.ids survive.
const queried = await scenario([[call("get_document", { full: true }), call("get_schema", { section: "document" }), call("select", { ids: ["arcCut"] })], []]);
assert.ok(queried.tools.every((tool) => !("full" in tool.args) && !("section" in tool.args)));
assert.deepEqual(Array.from(queried.tools.find((tool) => tool.name === "select").args.ids), ["arcCut"]);
const failingSample = call("sample_color", { x: -1, y: -1 });
const loopGuard = await scenario([[failingSample], [failingSample], [failingSample], []], { failTool: "sample_color" });
assert.equal(loopGuard.tools.filter((tool) => tool.name === "sample_color").length, 2);
assert.ok(loopGuard.requests[3].input.some((item) => item.output?.includes("already failed twice")));
const unfinishedPlan = await scenario([
  [call("update_plan", { steps: [{ task: "Move and verify the mask", status: "in_progress" }] }), edit],
  [],
  [call("update_plan", { steps: [{ task: "Move and verify the mask", status: "complete" }] })],
  []
]);
assert.ok(unfinishedPlan.requests[2].input.some((item) => item.content?.some((part) => part.text?.includes("plan still has unfinished steps"))));
assert.equal(unfinishedPlan.events.at(-1).type, "done");

const intent = { id: "font", requirement: "Generate a complete digit font", sourceQuote: "including fonts", kind: "generated_font" };
const fontHistory = [{ role: "user", content: "Generate everything including fonts" }];
const omitted = await scenario([[edit], [text("Done")], [text("Done")], [text("Done")]], { autoRequirements: false });
assert.equal(omitted.tools.some(tool => tool.name === "apply_commands"), false, "No mutation before requirements are recorded");
assert.ok(omitted.requests[1].input.some(item => item.output?.includes("update_requirements first")));
assert.equal(omitted.events.at(-1).type, "error");
assert.match(omitted.events.at(-1).message, /request is incomplete/);
assert.ok(!omitted.events.some(event => event.type === "token" && event.delta === "Done"));
const ignored = await scenario([
  [call("update_requirements", { requirements: [intent] })],
  [text("Everything is complete.")], [text("Everything is complete.")], [text("Everything is complete.")]
], { autoRequirements: false, history: fontHistory });
assert.equal(ignored.events.at(-1).type, "error");
assert.match(ignored.events.at(-1).message, /request is incomplete/);
assert.ok(!ignored.events.some(event => event.type === "token" && event.delta.includes("Everything is complete")), "Completion claims are held until checks pass");
const blocked = await scenario([
  [call("update_requirements", { requirements: [intent] }), call("review_requirements", { reviews: [{ id: "font", status: "blocked", blockerKind: "unavailable_service", evidenceCallIds: ["prefetch_get_document_fixture-"], detail: "Image generation is disabled." }] })],
  [text("Everything is complete.")]
], { autoRequirements: false, history: fontHistory });
assert.equal(blocked.events.at(-1).type, "done");
assert.match(blocked.events.at(-1).fullText, /request is incomplete/);
assert.match(blocked.events.at(-1).fullText, /Image generation is disabled/);
assert.ok(!blocked.events.at(-1).fullText.includes("Everything is complete"));
const staleProof = await scenario([
  [call("update_requirements", { requirements: [{ ...intent, kind: "document" }] }), edit],
  [call("review_requirements", { reviews: [{ id: "font", status: "verified", detail: "It is done", evidenceCallIds: ["prefetch_get_document_fixture-"] }] })],
  [], [], [], []
], { autoRequirements: false, history: fontHistory });
assert.ok(staleProof.events.some(event => event.type === "tool" && event.tool === "review_requirements" && event.status === "failed" && /current document revision/.test(event.message)));
const parallel = await scenario([
  [call("generate_image", { prompt: "a" }, "a"), call("generate_image", { prompt: "b" }, "b"), call("generate_image", { prompt: "c" }, "c"), call("generate_image", { prompt: "d" }, "d"), edit], []
], { imageGeneration: true, imageFailure: "b" });
assert.equal(parallel.peakImages, 3);
assert.ok(parallel.imageOrder.indexOf("start:c") < parallel.imageOrder.indexOf("end:a"));
const outputs = parallel.requests[1].input.filter(item => item.type === "function_call_output" && ["a", "b", "c", "d"].includes(item.call_id));
assert.deepEqual(outputs.map(item => item.call_id), ["a", "b", "c", "d"], "Parallel results keep call order");
assert.match(outputs[1].output, /Image job failed/);
assert.equal(parallel.events.filter(event => event.type === "generated").length, 3, "Successful siblings survive one failed job");
assert.equal(parallel.events.at(-1).type, "done");
const assetEdit = id => call("apply_commands", { commands: [{ op: "set", path: "/design/artwork", value: { dataUrl: { assetId: id }, width: 1024, height: 1024 } }] });
const reviewedImages = await scenario([
  [call("generate_image", { prompt: "a" }), assetEdit("generated-a"), call("review_generated_assets", { reviews: [{ assetId: "generated-a", status: "accepted", comparison: "Looks correct before seeing any actual pixels.", referenceAssetIds: ["reference"] }] })],
  [call("review_generated_assets", { reviews: [{ assetId: "generated-a", status: "rejected", comparison: "Serif glyphs conflict with the reference's bold slanted sans-serif clock.", referenceAssetIds: ["reference"] }] }), assetEdit("generated-a"), call("generate_image", { prompt: "b", referenceAssetIds: ["font-crop"] })],
  [call("review_generated_assets", { reviews: [{ assetId: "generated-b", status: "accepted", comparison: "The slanted sans-serif shapes and heavy strokes match the typography crop.", referenceAssetIds: ["font-crop"] }] }), assetEdit("generated-b"), call("generate_image", { prompt: "c", referenceAssetIds: [] })],
  [call("review_generated_assets", { reviews: [{ assetId: "generated-c", status: "rejected", comparison: "This unrelated experimental decoration is unnecessary for the requested face." }] })]
], { imageGeneration: true, history: [
  { role: "user", content: "Old reference", images: ["data:image/png;base64,old"] },
  { role: "assistant", content: "Earlier work." },
  { role: "user", content: "Match this font", imageRole: "design-reference", images: ["data:image/png;base64,reference"] }
] });
assert.deepEqual(structuredClone(reviewedImages.imageRequests.map(request => request.images)), [["data:image/png;base64,reference"], ["data:image/png;base64,font-crop"], []], "generation inherits selected reference, respects explicit crops and explicit independent requests");
assert.equal(reviewedImages.tools.filter(tool => tool.name === "apply_commands").length, 1, "pending and rejected images never reach the editor");
assert.ok(reviewedImages.events.some(event => event.tool === "review_generated_assets" && event.status === "failed" && /Wait for/.test(event.message)), "cannot review in the generating round before receiving pixels");
assert.equal(reviewedImages.events.at(-1).type, "done");
const stateScenario = { values: { weather_direction: "4" }, weather: { condition: 20, night: true } };
const stateProof = await scenario([[call("render_preview", { mode: "aod", scenario: stateScenario }, "state-proof")], [text("Checked.")]]);
const proofLedger = JSON.parse(stateProof.requests[1].instructions.split("Current-revision verification evidence (data):\n")[1].split("\nCite these evidence IDs")[0]);
const stateEvidence = proofLedger.find(entry => entry.callId === "state-proof");
assert.deepEqual(stateEvidence.scenario, stateScenario);
assert.equal(stateEvidence.mode, "aod");
assert.equal(stateEvidence.previewComplication, "battery");

const cropReview = { assetId: "generated-crop-0", status: "accepted", referenceAssetIds: ["generated-a"], comparison: "The zero is intact and its side bearings and baseline match the sibling digit cells." };
const cropped = await scenario([
  [call("generate_image", { prompt: "a" })],
  [call("review_generated_assets", { reviews: [{ assetId: "generated-a", status: "accepted", comparison: "The atlas contains the requested heavy slanted glyph shapes." }] }), call("crop_image", { assetId: "generated-a", crop: { x: 0, y: 0, width: 32, height: 48 }, glyph: { character: "0", setId: "clock" } }), assetEdit("generated-crop-0")],
  [call("review_generated_assets", { reviews: [cropReview] }), call("review_generated_assets", { reviews: [{ ...cropReview, glyphChecks: { identity: true, unclipped: true, baselineAndSpacing: true } }] }), assetEdit("generated-crop-0")]
], { imageGeneration: true });
assert.equal(cropped.tools.filter(tool => tool.name === "apply_commands").length, 1, "a crop needs its own acceptance before editor mutation");
assert.ok(cropped.events.some(event => event.tool === "review_generated_assets" && event.status === "failed" && /glyph crop/.test(event.message)));
const cropOutput = cropped.requests[2].input.find(item => item.type === "function_call_output" && item.call_id === "crop_image");
assert.equal(JSON.parse(cropOutput.output).cropQuality.glyph.character, "0");
assert.equal(JSON.parse(cropOutput.output).siblingCrops.length, 1);
assert.equal(cropped.events.at(-1).type, "done");

const pinnedReference = 'a'.repeat(64), rejectedAsset = 'b'.repeat(64);
const persisted = { version: 1, projectId: 'face-a', entries: [], requirements: [{ id: 'request', requirement: 'Continue', sourceQuote: 'Continue', kind: 'document', status: 'pending' }],
  designReferenceIds: [pinnedReference], generatedAssets: [{ assetId: rejectedAsset, width: 1024, height: 240 }],
  assetReviews: [{ assetId: rejectedAsset, round: 23, status: 'rejected', references: [pinnedReference], comparison: 'Fused glyphs and scratch artifacts make this atlas unusable.' }] };
const resumedReviews = await scenario([
  [assetEdit(rejectedAsset), call('generate_image', { prompt: 'recovery' })],
  [call('review_generated_assets', { reviews: [{ assetId: 'generated-recovery', status: 'rejected', referenceAssetIds: [pinnedReference], comparison: 'The replacement still fails to match the reference clock.' }] })]
], { imageGeneration: true, history: [{ role: 'assistant', content: 'Previous attempt stopped.', memory: persisted }, { role: 'user', content: 'Continue', imageRole: 'diagnostic', images: ['data:image/png;base64,diagnostic'] }] });
assert.equal(resumedReviews.tools.filter(tool => tool.name === 'apply_commands').length, 0, 'rejected pixels stay blocked in a later run');
assert.deepEqual(structuredClone(resumedReviews.imageRequests[0].images), [`data:image/png;base64,${pinnedReference}`], 'diagnostic image does not replace persisted design reference');
const recoveredMemory = resumedReviews.events.filter(event => event.type === 'memory').at(-1).memory;
assert.equal(recoveredMemory.assetReviews.find(item => item.assetId === rejectedAsset).status, 'rejected');
assert.deepEqual(structuredClone(recoveredMemory.designReferenceIds), [pinnedReference]);

const visualTarget = { id: "clock", label: "Clock typeface", mode: "current", appearance: "typography", region: { x: .2, y: .4, width: .6, height: .2 }, referenceAssetId: pinnedReference, referenceRegion: { x: .2, y: .4, width: .6, height: .2 } };
const visualFinding = { targetId: "clock", verdict: "matched", comparisonCallIds: ["comparison"], observations: Object.fromEntries(["proportions", "weight", "slant", "spacing", "placement"].map(key => [key, `Inspected the reference and resulting ${key}.`])), remainingDifferences: [] };
const visualReview = call("review_requirements", { reviews: [{ id: "fidelity", status: "verified", detail: "Compared the actual reference and current typography crop.", evidenceCallIds: ["clock-preview"], visualFindings: [visualFinding] }] });
const comparedReference = await scenario([
  [call("update_requirements", { requirements: [{ id: "fidelity", requirement: "Match the clock", sourceQuote: "Match the clock", kind: "visual", visualTargets: [visualTarget] }] }), call("compare_design_reference", { requirementId: "fidelity", targetId: "clock", previewCallIds: ["invented"] }, "bad-comparison"), call("render_preview", { mode: "current", resolution: 416 }, "clock-preview")],
  [call("compare_design_reference", { requirementId: "fidelity", targetId: "clock", previewCallIds: ["clock-preview"] }, "comparison"), visualReview],
  [visualReview],
  [text("Compared the clock to the reference.")]
], { autoRequirements: false, history: [{ role: "assistant", content: "Saved reference.", memory: { version: 1, projectId: "face-a", entries: [], designReferenceIds: [pinnedReference] } }, { role: "user", content: "Match the clock", imageRole: "diagnostic", images: ["data:image/png;base64,diagnostic"] }] });
assert.ok(comparedReference.events.some(e => e.tool === "compare_design_reference" && e.status === "failed" && /fresh previews/.test(e.message)), "invented preview evidence is refused");
assert.ok(comparedReference.events.some(e => e.tool === "review_requirements" && e.status === "failed" && /later round/.test(e.message)), "cannot assess pixels before receiving the comparison board");
assert.ok(comparedReference.events.some(e => e.tool === "review_requirements" && e.status === "done"), "fresh inspected comparison completes in a later round");
assert.ok(comparedReference.requests[2].input.some(item => item.content?.some(part => part.type === "input_image")), "comparison pixels reach the model");
const visualMemory = comparedReference.events.filter(e => e.type === "memory").at(-1).memory;
assert.equal(visualMemory.requirements[0].visualFindings[0].targetId, "clock");
assert.equal(visualMemory.requirements[0].visualTargets[0].referenceAssetId, pinnedReference);
console.log("Watchmaker agent loop tests passed");
