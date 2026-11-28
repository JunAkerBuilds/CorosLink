import { createHash, createPublicKey, verify, type JsonWebKey } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Sealer } from "../secrets";
import { EnvironmentKey } from "./identity";

const sealer: Sealer = {
  encrypt: async (text) => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decrypt: async (data) => {
    const text = data.toString();
    if (!text.startsWith("sealed:")) throw new Error("not ours");
    return { text: Buffer.from(text.slice(7), "base64").toString(), stale: false };
  },
};

const dirs: string[] = [];
const tempDir = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clink-identity-")); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

describe("the environment key", () => {
  it("is made once, sealed, and the same key on every load", async () => {
    const dir = tempDir();
    const first = await EnvironmentKey.load(dir, sealer);
    const again = await EnvironmentKey.load(dir, sealer);
    expect(again.thumbprint).toBe(first.thumbprint);
    expect(again.publicJwk).toEqual(first.publicJwk);
    const file = fs.readFileSync(path.join(dir, "environment-key.bin"), "utf8");
    expect(file.startsWith("sealed:")).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(["environment-key.bin"]);
  });

  it("keeps one key when two loads race", async () => {
    const dir = tempDir();
    const keys = await Promise.all([EnvironmentKey.load(dir, sealer), EnvironmentKey.load(dir, sealer), EnvironmentKey.load(dir, sealer)]);
    expect(new Set(keys.map((k) => k.thumbprint)).size).toBe(1);
  });

  it("has the RFC 7638 thumbprint of its public JWK", async () => {
    const key = await EnvironmentKey.load(tempDir(), sealer);
    const { crv, kty, x, y } = key.publicJwk;
    expect(key.thumbprint).toBe(createHash("sha256").update(`{"crv":"${crv}","kty":"${kty}","x":"${x}","y":"${y}"}`).digest("base64url"));
  });

  it("signs a compact ES256 JWS with its own alg and kid", async () => {
    const key = await EnvironmentKey.load(tempDir(), sealer);
    const jws = key.sign({ typ: "test+jws", alg: "none", kid: "other" }, { hello: "world" });
    const [header, payload, signature] = jws.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({ typ: "test+jws", alg: "ES256", kid: key.thumbprint });
    expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toEqual({ hello: "world" });
    const publicKey = createPublicKey({ key: key.publicJwk as JsonWebKey, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("refuses a key it can't open, and leaves it alone", async () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "environment-key.bin"), "sealed on another computer");
    await expect(EnvironmentKey.load(dir, sealer)).rejects.toThrow(/unlock/);
    expect(fs.readFileSync(path.join(dir, "environment-key.bin"), "utf8")).toBe("sealed on another computer");
  });

  it("seals the key again when the keychain asks", async () => {
    const dir = tempDir();
    await EnvironmentKey.load(dir, sealer);
    let sealedAgain = 0;
    const staleSealer: Sealer = { encrypt: async (text) => { sealedAgain++; return sealer.encrypt(text); }, decrypt: async (data) => ({ ...(await sealer.decrypt(data)), stale: true }) };
    await EnvironmentKey.load(dir, staleSealer);
    expect(sealedAgain).toBe(1);
  });
});
