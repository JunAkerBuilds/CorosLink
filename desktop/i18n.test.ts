// Every English line the code passes to t, tx, tr or msg has a Spanish, German, Brazilian Portuguese and Simplified Chinese line, with the same
// {placeholders} (scripts/i18n.mjs; `node scripts/i18n.mjs check <path>` lists what's missing).
import { describe, expect, it } from "vitest";
import { conflicts, problems } from "../scripts/i18n.mjs";

describe("translation catalogs", () => {
  it("cover every line in the code", () => expect(problems()).toEqual([]));
  // Same English, two meanings: use tx("context", …) at the code, not two translations of one key.
  it("translate each line one way", () => expect(conflicts()).toEqual([]));
});
