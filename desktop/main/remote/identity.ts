// This computer's environment key for "Reach from anywhere": a P-256 key made once, kept sealed with the OS keychain.
// It signs every call to relay.coroslink.com and every mint answer, and the relay pins its thumbprint, so phones
// trust the computer by it. A new key means a new tunnel address; nothing here replaces one that can't be opened.
import { createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { t } from "@/lib/i18n";
import { b64url, thumbprint } from "../phones/dpop";
import type { Sealer } from "../secrets";

export interface PublicJwk { kty: "EC"; crv: "P-256"; x: string; y: string }

const FILE = "environment-key.bin";
const COORD = /^[A-Za-z0-9_-]{43}$/;

interface Saved { version: 1; x: string; y: string; d: string }

export class EnvironmentKey {
  /** RFC 7638 SHA-256 thumbprint of `publicJwk`: the `kid` of everything this key signs. */
  readonly thumbprint: string;

  private constructor(private readonly key: KeyObject, readonly publicJwk: PublicJwk) {
    this.thumbprint = thumbprint(publicJwk);
  }

  /** The key kept in `dir`, or a new one saved there first. Throws when the saved one can't be opened. */
  static async load(dir: string, sealer: Sealer): Promise<EnvironmentKey> {
    const file = path.join(dir, FILE);
    let sealed: Buffer | null = null;
    try { sealed = await fs.promises.readFile(file); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (sealed) return EnvironmentKey.open(file, sealed, sealer);

    const jwk = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ format: "jwk" });
    const saved: Saved = { version: 1, x: String(jwk.x), y: String(jwk.y), d: String(jwk.d) };
    await fs.promises.mkdir(dir, { recursive: true });
    const temp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.promises.writeFile(temp, await sealer.encrypt(JSON.stringify(saved)), { mode: 0o600 });
      // link() refuses to replace a file, so a key another caller saved meanwhile wins and is the one returned.
      await fs.promises.link(temp, file).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    } finally {
      await fs.promises.rm(temp, { force: true }).catch(() => {});
    }
    return EnvironmentKey.open(file, await fs.promises.readFile(file), sealer);
  }

  private static async open(file: string, sealed: Buffer, sealer: Sealer): Promise<EnvironmentKey> {
    let saved: Partial<Saved>;
    let stale = false;
    try {
      const opened = await sealer.decrypt(sealed);
      stale = opened.stale;
      saved = JSON.parse(opened.text) as Partial<Saved>;
    } catch {
      throw new Error(t("Couldn't unlock this computer's key for Reach from anywhere. Check your system keychain, then restart C-LINK."));
    }
    if (saved.version !== 1 || !COORD.test(saved.x ?? "") || !COORD.test(saved.y ?? "") || !COORD.test(saved.d ?? "")) {
      throw new Error(t("This computer's key for Reach from anywhere is damaged."));
    }
    const publicJwk: PublicJwk = { kty: "EC", crv: "P-256", x: saved.x!, y: saved.y! };
    const key = createPrivateKey({ key: { ...publicJwk, d: saved.d! }, format: "jwk" });
    if (stale) await fs.promises.writeFile(file, await sealer.encrypt(JSON.stringify(saved)), { mode: 0o600 });
    return new EnvironmentKey(key, publicJwk);
  }

  /** A compact ES256 JWS of `payload`; `alg` and `kid` are always this key's. */
  sign(header: Record<string, unknown>, payload: object): string {
    const input = `${b64url(JSON.stringify({ ...header, alg: "ES256", kid: this.thumbprint }))}.${b64url(JSON.stringify(payload))}`;
    return `${input}.${b64url(sign("sha256", Buffer.from(input), { key: this.key, dsaEncoding: "ieee-p1363" }))}`;
  }
}
