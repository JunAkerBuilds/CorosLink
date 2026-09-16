import assert from "node:assert/strict";
import { WatchfaceAutomationBroker } from "../dist-electron/watchfaceAutomationBroker.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sent = [];
let activations = 0;
const broker = new WatchfaceAutomationBroker({ activate: () => { activations += 1; }, send: (request) => sent.push(request), readyTimeoutMs: 25, requestTimeoutMs: 25 });

const opening = broker.dispatch("open", { archive: "starter" });
await tick();
assert.equal(sent.length, 0, "requests wait until their renderer scope is listening");
broker.setReady("hub", true);
await tick();
assert.equal(sent[0].method, "open");
broker.respond({ id: "foreign", result: "ignored" });
broker.respond({ id: sent[0].id, result: { opened: true } });
assert.deepEqual(await opening, { opened: true });

broker.setReady("editor", true);
const first = broker.dispatch("apply_commands", { baseRevision: 0 });
const second = broker.dispatch("undo", { baseRevision: 1 });
await tick();
assert.equal(sent.length, 2, "only one editor operation may run at a time");
broker.respond({ id: sent[1].id, result: { revision: 1 } });
assert.deepEqual(await first, { revision: 1 });
await tick();
assert.equal(sent[2].method, "undo");
broker.respond({ id: sent[2].id, error: { code: "REVISION_CONFLICT", message: "Read again", details: { revision: 2 } } });
await assert.rejects(second, (error) => error.code === "REVISION_CONFLICT" && error.details.revision === 2);

const slow = broker.dispatch("build_archive", {});
await assert.rejects(slow, (error) => error.code === "EDITOR_TIMEOUT");
const afterSlow = broker.dispatch("apply_commands", {});
await tick();
assert.equal(sent.length, 4, "a timed-out operation retains the queue until it really finishes");
broker.respond({ id: sent[3].id, result: { archiveId: "completed-late" } });
await tick();
assert.equal(sent.length, 5);
broker.respond({ id: sent[4].id, result: "next" });
assert.equal(await afterSlow, "next");

const interrupted = broker.dispatch("render_preview", {});
const queued = broker.dispatch("save", {});
const interruptedCheck = assert.rejects(interrupted, (error) => error.code === "EDITOR_DISCONNECTED");
const queuedCheck = assert.rejects(queued, (error) => error.code === "EDITOR_DISCONNECTED");
await tick();
broker.cancel();
await Promise.all([interruptedCheck, queuedCheck]);
await assert.rejects(broker.dispatch("get_document", {}), (error) => error.code === "NO_OPEN_PROJECT");
assert.ok(activations >= 6);
console.log("Watch-face automation broker tests passed");
