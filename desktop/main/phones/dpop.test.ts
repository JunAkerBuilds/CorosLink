import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { b64url, checkProof, ReplayGuard, sha256b64, thumbprint } from "./dpop";

/** A proof made the way CorosKit's DPoPKey makes one. */
function phone() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { crv: string; kty: string; x: string; y: string };
  const proof = (claims: Record<string, unknown>) => {
    const head = b64url(JSON.stringify({ alg: "ES256", jwk: { crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }, typ: "dpop+jwt" }));
    const body = b64url(JSON.stringify(claims));
    return `${head}.${body}.${b64url(sign("sha256", Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: "ieee-p1363" }))}`;
  };
  return { jwk, proof };
}

const URL_PAIR = "http://192.168.1.20:47410/v1/auth/pair";
const now = 1_800_000_000_000;
const iat = now / 1000;

describe("DPoP proofs from C-LINK's phones", () => {
  it("accepts a fresh proof and gives the key's thumbprint", () => {
    const p = phone();
    const out = checkProof(p.proof({ jti: "a".repeat(22), htm: "POST", htu: URL_PAIR, iat }), { method: "POST", url: URL_PAIR, now }, new ReplayGuard().check);
    expect(out.jkt).toBe(thumbprint(p.jwk));
  });
  it("binds a token by its hash", () => {
    const p = phone();
    const url = "http://192.168.1.20:47410/v1/sync";
    const proof = p.proof({ jti: "b".repeat(22), htm: "GET", htu: url, iat, ath: sha256b64("tok") });
    expect(() => checkProof(proof, { method: "GET", url, accessToken: "other", now }, () => false)).toThrow("wrong token");
    expect(checkProof(proof, { method: "GET", url, accessToken: "tok", now }, () => false).jti).toBe("b".repeat(22));
  });
  it("refuses another URL, an old proof, a replay and a forged signature", () => {
    const p = phone(), guard = new ReplayGuard();
    const good = p.proof({ jti: "c".repeat(22), htm: "POST", htu: URL_PAIR, iat });
    expect(() => checkProof(good, { method: "POST", url: "http://192.168.1.20:47410/v1/sync", now }, () => false)).toThrow("wrong request");
    expect(() => checkProof(p.proof({ jti: "d".repeat(22), htm: "POST", htu: URL_PAIR, iat: iat - 120 }), { method: "POST", url: URL_PAIR, now }, () => false)).toThrow("stale");
    checkProof(good, { method: "POST", url: URL_PAIR, now }, guard.check);
    expect(() => checkProof(good, { method: "POST", url: URL_PAIR, now }, guard.check)).toThrow("replayed");
    const [h, b] = good.split(".");
    const other = phone().proof({ jti: "e".repeat(22), htm: "POST", htu: URL_PAIR, iat }).split(".")[2];
    expect(() => checkProof(`${h}.${b}.${other}`, { method: "POST", url: URL_PAIR, now }, () => false)).toThrow("bad signature");
  });
});
