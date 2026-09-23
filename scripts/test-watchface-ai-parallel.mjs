import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { runWatchfaceAiParallel, WATCHFACE_AI_IMAGE_CONCURRENCY } = require("../dist-electron/watchfaceAiParallel.js");
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((finish, fail) => { resolve = finish; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

// Exercise actual overlap and refill; do not depend on elapsed wall-clock time.
{
  const gates = Array.from({ length: 7 }, deferred);
  const started = [];
  let active = 0;
  let peak = 0;
  const controller = new AbortController();
  const pending = runWatchfaceAiParallel(gates, async (gate, index, signal) => {
    assert.equal(signal, controller.signal);
    started.push(index);
    peak = Math.max(peak, ++active);
    await gate.promise;
    active--;
    return `image-${index}`;
  }, { signal: controller.signal, concurrency: 100 });
  assert.deepEqual(started, [0, 1, 2], "concurrency is capped even if caller requests more");
  gates[2].resolve();
  await tick();
  assert.deepEqual(started, [0, 1, 2, 3], "new job fills the first available slot");
  for (const index of [3, 1, 4, 0, 5, 6]) { gates[index].resolve(); await tick(); }
  const outcomes = await pending;
  assert.equal(peak, WATCHFACE_AI_IMAGE_CONCURRENCY);
  assert.deepEqual(outcomes.map((result) => result.value), gates.map((_, index) => `image-${index}`));
}

{
  const failure = new Error("Provider rate limit");
  const outcomes = await runWatchfaceAiParallel([0, 1, 2, 3], async (item) => {
    if (item === 1) throw failure;
    return item;
  }, { signal: new AbortController().signal, concurrency: 2 });
  assert.deepEqual(outcomes, [
    { status: "fulfilled", value: 0 }, { status: "rejected", reason: failure },
    { status: "fulfilled", value: 2 }, { status: "fulfilled", value: 3 }
  ], "one failed job does not prevent other images from completing");
}

{
  const controller = new AbortController();
  const cleanup = deferred();
  const started = [];
  let settled = false;
  const pending = runWatchfaceAiParallel([0, 1, 2, 3, 4], async (item, _, signal) => {
    started.push(item);
    await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    await cleanup.promise;
    signal.throwIfAborted();
  }, { signal: controller.signal }).then((results) => { settled = true; return results; });
  controller.abort(new Error("User cancelled"));
  await tick();
  assert.equal(settled, false, "cancellation waits for in-flight cleanup");
  assert.deepEqual(started, [0, 1, 2]);
  cleanup.resolve();
  const results = await pending;
  assert.equal(results.length, 5);
  assert.ok(results.every((result) => result.status === "rejected" && result.reason === controller.signal.reason));
  assert.deepEqual(started, [0, 1, 2], "no queued job starts after abort");
}

{
  const controller = new AbortController();
  controller.abort();
  const outcomes = await runWatchfaceAiParallel([1, 2], async () => assert.fail("must not start"), { signal: controller.signal });
  assert.equal(outcomes.length, 2);
  assert.ok(outcomes.every((outcome) => outcome.status === "rejected"));
  assert.deepEqual(await runWatchfaceAiParallel([], async () => assert.fail("empty"), { signal: controller.signal }), []);
  await assert.rejects(runWatchfaceAiParallel([1], async () => 1, { signal: controller.signal, concurrency: 0 }), RangeError);
}

console.log("Watchmaker parallel image tests passed (cap, ordering, failure isolation, cancellation cleanup).");

// Exercise the production token-refresh region without loading Electron or
// touching real credentials. Simultaneous image jobs must share token rotation.
const chatSource = readFileSync(new URL("../dist-electron/chatService.js", import.meta.url), "utf8");
const refreshStart = chatSource.indexOf("const tokenRefreshes =");
const refreshEnd = chatSource.indexOf("// ----- Encrypted token persistence", refreshStart);
assert.ok(refreshStart >= 0 && refreshEnd > refreshStart);
const tokenFixture = () => {
  let token = { access_token: "old-access", refresh_token: "old-refresh", account_id: "one", expires_at: 0 };
  let refreshCount = 0;
  let storedCount = 0;
  const gate = deferred();
  const context = vm.createContext({
    getStoredToken: () => token,
    storeToken: (value) => { storedCount++; token = value; },
    refreshAccessToken: async () => { refreshCount++; return gate.promise; }
  });
  vm.runInContext(chatSource.slice(refreshStart, refreshEnd) + "\nglobalThis.read = getValidToken;", context);
  return {
    read: () => context.read(),
    set: (value) => { token = value; },
    complete: (value) => gate.resolve(value),
    fail: (error) => gate.reject(error),
    state: () => ({ token, refreshCount, storedCount })
  };
};
const freshToken = { access_token: "fresh-access", refresh_token: "fresh-refresh", account_id: "one", expires_at: Math.floor(Date.now() / 1000) + 3600 };
{
  const fixture = tokenFixture();
  const requests = Array.from({ length: 3 }, () => fixture.read());
  assert.equal(fixture.state().refreshCount, 1);
  fixture.complete(freshToken);
  assert.ok((await Promise.all(requests)).every((value) => value === freshToken));
  assert.equal(fixture.state().storedCount, 1);
  assert.equal(await fixture.read(), freshToken);
}
{
  const fixture = tokenFixture();
  const requests = [fixture.read(), fixture.read()];
  const failure = new Error("Temporary refresh failure");
  fixture.fail(failure);
  assert.ok((await Promise.allSettled(requests)).every((result) => result.status === "rejected" && result.reason === failure));
  await assert.rejects(fixture.read(), (error) => error === failure);
  assert.equal(fixture.state().refreshCount, 2, "a rejected refresh is removed so a later request can retry");
}
for (const replacement of [undefined, { ...freshToken, account_id: "two" }]) {
  const fixture = tokenFixture();
  const result = fixture.read();
  fixture.set(replacement);
  fixture.complete(freshToken);
  await assert.rejects(result, (error) => error.authError === true && /sign-in changed/.test(error.message));
  assert.equal(fixture.state().storedCount, 0, "stale refresh cannot restore sign-out or replace another account");
  assert.equal(fixture.state().token, replacement);
}
console.log("Watchmaker token refresh tests passed (single-flight rotation and sign-in changes).");
