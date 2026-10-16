import { calculateJwkThumbprint } from "jose";
import { base64UrlEncode, type EnvironmentPublicJwk } from "./protocol";
import { RelayError } from "./http";

export function randomBase64Url(byteLength = 32): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(byteLength)));
}

/** Decodes a PKCS8 PEM ("-----BEGIN PRIVATE KEY-----", e.g. an APNs .p8) or bare base64 DER. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/u, "")
    .replace(/-----END [^-]+-----/u, "")
    .replace(/\\n/gu, "")
    .replace(/\s+/gu, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function importEs256Pkcs8(pem: string, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    pemToDer(pem),
    { name: "ECDSA", namedCurve: "P-256" },
    extractable,
    ["sign"],
  );
}

const BASE64URL_P256_COORDINATE = /^[A-Za-z0-9_-]{43}$/u;

/** Accepts exactly a public P-256 JWK; anything carrying private members is refused. */
export function parseEnvironmentPublicJwk(value: unknown): EnvironmentPublicJwk {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RelayError("invalid_request", "publicJwk must be a JWK object.");
  }
  const jwk = value as Record<string, unknown>;
  if ("d" in jwk || "p" in jwk || "q" in jwk || "k" in jwk) {
    throw new RelayError("invalid_request", "publicJwk must not contain private key material.");
  }
  if (
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string" ||
    !BASE64URL_P256_COORDINATE.test(jwk.x) ||
    !BASE64URL_P256_COORDINATE.test(jwk.y)
  ) {
    throw new RelayError("invalid_request", "publicJwk must be a P-256 EC public key.");
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

export function jwkThumbprint(jwk: EnvironmentPublicJwk): Promise<string> {
  return calculateJwkThumbprint({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, "sha256");
}

/** Constant-time comparison for equal-length ASCII strings. */
export function timingSafeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
