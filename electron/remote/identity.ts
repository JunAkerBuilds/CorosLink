import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { sanitizeComputerName } from "./contract";

/**
 * Who this computer is to remote clients: an environment ID (16 random bytes,
 * base64url) and a P-256 key that signs relay calls and mint answers. Both are
 * made once and kept in app_settings, the private key encrypted with
 * safeStorage. Everything here is synchronous, so the check-then-create in
 * loadOrCreateRemoteIdentity can't interleave with another caller in this
 * (single-instance) process.
 */

export interface RemoteSettingsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

/** safeStorage in the app; a fake in tests. */
export interface RemoteSecretBox {
  /** Throws a plain-language error when secrets can't be kept safely. */
  ensureAvailable(): void;
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

export interface RemotePublicJwk {
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export interface RemoteIdentity {
  environmentId: string;
  publicJwk: RemotePublicJwk;
  /** RFC 7638 SHA-256 thumbprint of `publicJwk`: the key's `kid` for the relay. */
  kid: string;
  /** Private JWK (with `d`). Never leaves the main process. */
  privateJwk: RemotePublicJwk & { d: string };
}

const IDENTITY_KEY = "remote.identity";
const PORT_KEY = "remote.port";
/** Where a first port is picked: above common dev ports, below the OS's ephemeral range. */
const PORT_RANGE = { min: 41_000, max: 48_999 };

interface StoredIdentity {
  version: 1;
  environmentId: string;
  publicJwk: RemotePublicJwk;
  /** safeStorage-encrypted private JWK, base64. */
  privateKey: string;
}

export function jwkThumbprint(jwk: RemotePublicJwk): string {
  // RFC 7638: the required members, in lexicographic order, no whitespace.
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  return crypto.createHash("sha256").update(canonical).digest("base64url");
}

function isPublicJwk(value: unknown): value is RemotePublicJwk {
  const jwk = value as Partial<RemotePublicJwk> | null;
  return Boolean(
    jwk && jwk.kty === "EC" && jwk.crv === "P-256" &&
    typeof jwk.x === "string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.x) &&
    typeof jwk.y === "string" && /^[A-Za-z0-9_-]{43}$/.test(jwk.y)
  );
}

function createIdentity(secrets: RemoteSecretBox): { stored: StoredIdentity; identity: RemoteIdentity } {
  const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" }) as { kty: "EC"; crv: "P-256"; x: string; y: string; d: string };
  const publicJwk: RemotePublicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  const privateJwk = { ...publicJwk, d: jwk.d };
  const environmentId = crypto.randomBytes(16).toString("base64url");
  return {
    stored: {
      version: 1,
      environmentId,
      publicJwk,
      privateKey: secrets.encrypt(JSON.stringify(privateJwk)).toString("base64")
    },
    identity: { environmentId, publicJwk, kid: jwkThumbprint(publicJwk), privateJwk }
  };
}

/**
 * The saved identity, or a new one saved before it's returned. Refuses (throws)
 * when safeStorage can't protect the key, rather than keeping it in plain text.
 */
export function loadOrCreateRemoteIdentity(settings: RemoteSettingsStore, secrets: RemoteSecretBox): RemoteIdentity {
  secrets.ensureAvailable();
  const saved = settings.get(IDENTITY_KEY);
  if (saved) {
    let stored: StoredIdentity;
    try {
      stored = JSON.parse(saved) as StoredIdentity;
    } catch {
      throw new Error("CorosLink's remote access identity is damaged. Reset remote access to create a new one.");
    }
    if (stored.version !== 1 || !/^[A-Za-z0-9_-]{22}$/.test(stored.environmentId) || !isPublicJwk(stored.publicJwk)) {
      throw new Error("CorosLink's remote access identity is damaged. Reset remote access to create a new one.");
    }
    let privateJwk: RemoteIdentity["privateJwk"];
    try {
      privateJwk = JSON.parse(secrets.decrypt(Buffer.from(stored.privateKey, "base64")));
    } catch {
      throw new Error("Couldn't unlock CorosLink's remote access key. Check your system keychain and restart CorosLink.");
    }
    if (privateJwk.x !== stored.publicJwk.x || privateJwk.y !== stored.publicJwk.y || typeof privateJwk.d !== "string") {
      throw new Error("CorosLink's remote access identity is damaged. Reset remote access to create a new one.");
    }
    return {
      environmentId: stored.environmentId,
      publicJwk: stored.publicJwk,
      kid: jwkThumbprint(stored.publicJwk),
      privateJwk
    };
  }
  const { stored, identity } = createIdentity(secrets);
  settings.set(IDENTITY_KEY, JSON.stringify(stored));
  return identity;
}

export function hasRemoteIdentity(settings: RemoteSettingsStore): boolean {
  return Boolean(settings.get(IDENTITY_KEY));
}

/** The port to try first: the saved one, or a new random one that's then saved. */
export function preferredRemotePort(settings: RemoteSettingsStore, random: () => number = Math.random): number {
  const saved = Number(settings.get(PORT_KEY));
  if (Number.isInteger(saved) && saved >= 1024 && saved <= 65_535) return saved;
  const port = randomRemotePort(random);
  settings.set(PORT_KEY, String(port));
  return port;
}

export function randomRemotePort(random: () => number = Math.random): number {
  return PORT_RANGE.min + Math.floor(random() * (PORT_RANGE.max - PORT_RANGE.min + 1));
}

/** Called when the saved port was taken and the server settled on another. */
export function saveRemotePort(settings: RemoteSettingsStore, port: number): void {
  settings.set(PORT_KEY, String(port));
}

let cachedComputerName: string | undefined;

/** The name people know this computer by: macOS's Computer Name, else the host name. */
export function computerName(): string {
  if (cachedComputerName !== undefined) return cachedComputerName;
  let name = "";
  if (process.platform === "darwin") {
    try {
      name = execFileSync("/usr/sbin/scutil", ["--get", "ComputerName"], { encoding: "utf8", timeout: 2_000 }).trim();
    } catch {
      name = "";
    }
  } else if (process.platform === "win32") {
    name = process.env.COMPUTERNAME ?? "";
  }
  if (!name) name = os.hostname().replace(/\.local$/i, "");
  cachedComputerName = sanitizeComputerName(name) || "CorosLink";
  return cachedComputerName;
}
