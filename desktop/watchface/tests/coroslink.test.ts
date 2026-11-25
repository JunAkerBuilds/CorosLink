// CorosLink's watch-face engine tests, moved with the engine. Each file asserts as it runs, the way it did there.
import { describe, it } from "vitest";

const files = import.meta.glob("./*.mjs");

describe("watch-face engine (from CorosLink)", () => {
  for (const [name, load] of Object.entries(files)) it(name.slice(2, -4), async () => { await load(); }, 120_000);
});
