// Opening what CorosLink sealed, so the move can seal it again with C-LINK's own keychain (secrets.ts).
//
// CorosLink kept its secrets (the watch key, its sign-ins) in `app_settings` as base64 of Electron's
// `safeStorage.encryptString(Async)`, which is Chromium's os_crypt under CorosLink's app name:
//   macOS   "v10" | AES-128-CBC(PKCS7), IV of 16 spaces, key PBKDF2-SHA1(password, "saltysalt", 1003, 16), the password
//           being the keychain item "CorosLink Safe Storage" / "CorosLink Key", or "coroslink …" (COROSLINK_APP_NAMES).
//   Windows "v10" | nonce(12) | AES-256-GCM ciphertext | tag(16), the key in `Local State` (os_crypt.encrypted_key:
//           "DPAPI" + the key sealed with the user's DPAPI).
//   Linux   "v10" with the password "peanuts" (no keyring), or "v11" with the password libsecret keeps, both
//           PBKDF2-SHA1(password, "saltysalt", 1, 16) and the macOS cipher.
// C-LINK ships as the CorosLink update (same app id, same team), so a signed C-LINK may read that keychain item; a
// development build gets the system's "allow" prompt once.
//
// Nothing opened here is logged or written anywhere: the move seals each value again straight away.
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * The names CorosLink's keychain entries go by: the app's, and "coroslink", the name a development CorosLink runs
 * under. On a case-insensitive disk both use the same data folder, so its values may be sealed under either.
 */
export const COROSLINK_APP_NAMES = ["CorosLink", "coroslink"] as const;

export interface OldKeychain {
  /** One sealed `app_settings` value (base64), opened; null when it can't be. Never throws. */
  open(sealedBase64: string): Promise<string | null>;
}

const V10 = Buffer.from("v10"), V11 = Buffer.from("v11");
const IV = Buffer.alloc(16, " ");

/** Chromium's CBC key from an os_crypt password (macOS: 1003 rounds; Linux: 1). */
export function cbcKey(password: string | Buffer, rounds: number): Buffer {
  return pbkdf2Sync(password, "saltysalt", rounds, 16, "sha1");
}

/** A "v10"/"v11" CBC value (macOS, Linux) opened with `key`, as latin1 (bytes). Throws when it isn't one. */
export function openCbc(data: Buffer, key: Buffer): string {
  const prefix = data.subarray(0, 3);
  if (!prefix.equals(V10) && !prefix.equals(V11)) throw new Error("not os_crypt");
  const decipher = createDecipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([decipher.update(data.subarray(3)), decipher.final()]).toString("latin1");
}

/** A Windows "v10" GCM value opened with the 32-byte key from Local State, as latin1 (bytes). Throws when it isn't one. */
export function openGcm(data: Buffer, key: Buffer): string {
  if (!data.subarray(0, 3).equals(V10) || data.length < 3 + 12 + 16) throw new Error("not os_crypt");
  const nonce = data.subarray(3, 15), tag = data.subarray(data.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(15, data.length - 16)), decipher.final()]).toString("latin1");
}

const run = (file: string, args: string[], input?: string) =>
  new Promise<string | null>((resolve) => {
    const child = execFile(file, args, { timeout: 60_000, maxBuffer: 1 << 20, windowsHide: true }, (error, stdout) => resolve(error ? null : stdout));
    if (input !== undefined) child.stdin?.end(input);
  });

/** The macOS keychain password CorosLink's os_crypt used under `name`, or null (no item, or the athlete said no). */
const macPassword = (name: string) => run("/usr/bin/security", ["find-generic-password", "-w", "-s", `${name} Safe Storage`, "-a", `${name} Key`]).then((out) => out?.replace(/\n$/, "") || null);

/** Linux: libsecret's password for CorosLink ("v11") under `name`, when there is a keyring. */
const linuxPassword = (name: string) => run("secret-tool", ["lookup", "xdg:schema", "chrome_libsecret_os_crypt_password_v2", "application", name.toLowerCase()]).then((out) => out?.replace(/\n$/, "") || null);

/** Windows: CorosLink's AES key from its Local State, opened with DPAPI (the same user's). */
async function windowsKey(folder: string): Promise<Buffer | null> {
  try {
    const state = JSON.parse(await readFile(path.join(folder, "Local State"), "utf8")) as { os_crypt?: { encrypted_key?: unknown } };
    const wrapped = Buffer.from(String(state.os_crypt?.encrypted_key ?? ""), "base64");
    if (wrapped.subarray(0, 5).toString("latin1") !== "DPAPI") return null;
    const script = "Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());" +
      "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";
    const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], wrapped.subarray(5).toString("base64"));
    const key = out ? Buffer.from(out.trim(), "base64") : null;
    return key?.length === 32 ? key : null;
  } catch {
    return null;
  }
}

/** Keychain names already asked for, so a later launch doesn't ask again (each ask is the system's password prompt). */
export interface AskedNames {
  has(name: string): boolean;
  add(name: string): void;
}

/**
 * AskedNames kept in a small JSON file. Without it, a value nobody re-seals (the prompt refused, or a development build
 * sealing it again) asks on every launch.
 */
export function askedNamesFile(file: string): AskedNames {
  let names: Set<string> | null = null;
  const load = () => {
    if (names) return names;
    try {
      const read = JSON.parse(readFileSync(file, "utf8")) as unknown;
      names = new Set(Array.isArray(read) ? read.filter((n): n is string => typeof n === "string") : []);
    } catch { names = new Set(); }
    return names;
  };
  return {
    has: (name) => load().has(name),
    add: (name) => {
      load().add(name);
      try {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, JSON.stringify([...load()]));
      } catch { /* asked again next launch */ }
    },
  };
}

export interface KeychainSource {
  platform: NodeJS.Platform;
  /** CorosLink's data folder (Windows reads its Local State). */
  folder: string;
  /**
   * The app's own safeStorage, when it seals under CorosLink's name (shipped Mac builds: secrets.ts keychainName).
   * Tried first: it opens CorosLink's values in this process, as the same signed app, with no prompt.
   */
  own?: (data: Buffer) => Promise<string>;
  /** Keychain names to ask the system for (macOS `security`, Linux libsecret). Default COROSLINK_APP_NAMES; a shipped
   * build passes none on a Mac (`own` instead) and never the development name. */
  names?: readonly string[];
  /** Names asked for on an earlier launch are not asked for again (macOS, Linux). */
  asked?: AskedNames;
  /** Tests: the os_crypt password under an app name (macOS/Linux), or the 32-byte key (Windows), without asking the system. */
  secret?: (name: string) => Promise<string | Buffer | null>;
}

/** Text only when it is all UTF-8: a wrong CBC key now and then passes the padding check and gives bytes. */
const strict = new TextDecoder("utf-8", { fatal: true });

/**
 * CorosLink's keychain. Its values may be sealed under either name (COROSLINK_APP_NAMES): each is asked for only when
 * the names before it don't open a value, once, and the one that worked is tried first after that.
 */
export function corosLinkKeychain(source: KeychainSource): OldKeychain {
  const ask = async (name: string) => {
    if (source.asked?.has(name)) return null;
    source.asked?.add(name);
    return source.secret ? source.secret(name) : source.platform === "darwin" ? macPassword(name) : linuxPassword(name);
  };
  const keys = new Map<string, Promise<Buffer | null>>();
  const keyFor = (name: string, rounds: number) => {
    if (!keys.has(name)) keys.set(name, ask(name).then((p) => (typeof p === "string" && p ? cbcKey(p, rounds) : null), () => null));
    return keys.get(name)!;
  };
  let windows: Promise<Buffer | null> | null = null;
  let order = [...(source.names ?? COROSLINK_APP_NAMES)];
  const tryCbc = async (data: Buffer, rounds: number): Promise<string | null> => {
    for (const name of order) {
      const key = await keyFor(name, rounds);
      if (!key) continue;
      try {
        const text = strict.decode(Buffer.from(openCbc(data, key), "latin1"));
        order = [name, ...order.filter((n) => n !== name)];
        return text;
      } catch { /* not this one */ }
    }
    return null;
  };
  return {
    async open(sealedBase64) {
      try {
        const data = Buffer.from(sealedBase64, "base64");
        if (source.platform === "win32") {
          windows ??= source.secret ? source.secret(COROSLINK_APP_NAMES[0]).then((k) => (Buffer.isBuffer(k) && k.length === 32 ? k : null)) : windowsKey(source.folder);
          const key = await windows;
          return key ? strict.decode(Buffer.from(openGcm(data, key), "latin1")) : null;
        }
        if (source.platform === "darwin") {
          if (source.own) { try { return await source.own(data); } catch { /* not sealed with this app's key */ } }
          return await tryCbc(data, 1003);
        }
        // Linux: "v10" is the fixed password, "v11" the keyring's.
        if (data.subarray(0, 3).equals(V10)) return strict.decode(Buffer.from(openCbc(data, cbcKey("peanuts", 1)), "latin1"));
        return await tryCbc(data, 1);
      } catch {
        return null;
      }
    },
  };
}
