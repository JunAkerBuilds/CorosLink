// Encryption with the OS keychain (safeStorage), and the secret that seals the web app's cookies.
import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { safeStorage } from "electron";
import type { OldKeychain } from "./coroslink/oldKeychain";

/**
 * The name C-LINK's keychain item goes by, or null for Electron's default (the app's name: "C-LINK Safe Storage").
 * A shipped Mac build is CorosLink's update (same app id `app.coroslink`, same team), so it seals with CorosLink's own
 * item, "CorosLink Safe Storage": its own values and the ones CorosLink sealed then open in this process, as the same
 * signed app, without a prompt. Electron fixes the item's name from the app's name before `ready` (main.ts sets it
 * then, and shows "C-LINK" again after).
 */
export function keychainName(packaged: boolean, platform: NodeJS.Platform): string | null {
  return packaged && platform === "darwin" ? "CorosLink" : null;
}

/** Values sealed under the other name (by a development build, or a shipped build from before the change), opened
 * once and then sealed again with this one. */
let other: OldKeychain | null = null;
export function setKeychainFallback(fallback: OldKeychain | null): void { other = fallback; }

export interface Sealer {
  encrypt(text: string): Promise<Buffer>;
  /** `stale` means the keychain key changed: write the value again so it is sealed with the new key. */
  decrypt(data: Buffer): Promise<{ text: string; stale: boolean }>;
}

let available: Promise<boolean> | null = null;
const canEncrypt = () => (available ??= safeStorage.isAsyncEncryptionAvailable());
/** Whether the keychain really encrypts here; where it doesn't, account sessions stay in memory only. */
export const keychainSecure = (): Promise<boolean> => canEncrypt();

/** The OS keychain. Where there is none (some Linux desktops) values are kept as plain text, as Chromium does. */
export const keychain: Sealer = {
  encrypt: async (text) => ((await canEncrypt()) ? safeStorage.encryptStringAsync(text) : Buffer.from(text, "utf8")),
  decrypt: async (data) => {
    if (!(await canEncrypt())) return { text: data.toString("utf8"), stale: false };
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(data);
      return { text: result, stale: shouldReEncrypt };
    } catch (error) {
      const text = other ? await other.open(data.toString("base64")) : null;
      if (text === null) throw error;
      return { text, stale: true };
    }
  },
};

/** The cookie-sealing secret: made once per install and kept encrypted. A new one signs everyone out. */
export async function cookieSecret(file: string): Promise<string> {
  try {
    const { text, stale } = await keychain.decrypt(await readFile(file));
    if (stale) await writeFile(file, await keychain.encrypt(text), { mode: 0o600 });
    return text;
  } catch {
    const secret = randomBytes(32).toString("base64url");
    await writeFile(file, await keychain.encrypt(secret), { mode: 0o600 });
    return secret;
  }
}
