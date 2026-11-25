import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CookieJar } from "./cookieJar";
import type { Sealer } from "./secrets";

const plain: Sealer = { encrypt: async (t) => Buffer.from(`sealed:${t}`), decrypt: async (b) => ({ text: b.toString().slice(7), stale: false }) };
const file = () => path.join(mkdtempSync(path.join(tmpdir(), "jar-")), "cookies.bin");

describe("cookie jar", () => {
  it("keeps cookies by path and drops expired ones", async () => {
    const jar = await CookieJar.open(file(), plain);
    jar.set("a", "1", { path: "/api/hub", maxAge: 60 });
    jar.set("b", "2", { maxAge: 0 });
    expect(jar.get("a", "/api/hub/calendar")).toBe("1");
    expect(jar.get("a", "/api/account/session")).toBeUndefined();
    expect(jar.get("b", "/")).toBeUndefined();
  });

  it("saves sealed and reads it back", async () => {
    const where = file();
    const jar = await CookieJar.open(where, plain);
    jar.set("clink_account", "token", { path: "/" });
    await jar.save();
    expect(readFileSync(where, "utf8").startsWith("sealed:")).toBe(true);
    expect((await CookieJar.open(where, plain)).get("clink_account", "/api/sync")).toBe("token");
  });

  it("starts empty when the file can't be read", async () => {
    const broken: Sealer = { ...plain, decrypt: async () => { throw new Error("other computer"); } };
    expect((await CookieJar.open(file(), broken)).all("/")).toEqual([]);
  });
});
