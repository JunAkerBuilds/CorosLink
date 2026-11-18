import crypto from "node:crypto";
import { safeStorage } from "electron";
import { deleteSettings, getSetting, setSetting } from "./database";
import { recordDiagnosticError } from "./diagnosticsService";

const SETTINGS = {
  credentials: "coros.credentials",
  legacyTrainingHubCredentials: "trainingHub.credentials"
} as const;

export interface StoredCorosCredentials {
  account: string;
  pwdHash: string;
}

/**
 * The last credentials decrypted or saved, with the ciphertext they came from.
 * Status reads are synchronous, while safeStorage decrypts asynchronously, so
 * they answer from here; a changed or cleared setting invalidates it.
 */
let cached: { encoded: string; credentials: StoredCorosCredentials } | null = null;

export function hashCorosPassword(password: string): string {
  return crypto.createHash("md5").update(password, "utf8").digest("hex");
}

export async function storeCorosCredentials(
  account: string,
  pwdHash: string
): Promise<boolean> {
  const credentials = normalizeCredentials({ account, pwdHash });
  if (!credentials) {
    throw new Error("Cannot save invalid COROS credentials.");
  }

  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    console.warn(
      "[corosCredentials] Cannot remember COROS credentials because OS secure storage is unavailable."
    );
    return false;
  }

  try {
    const encrypted = (
      await safeStorage.encryptStringAsync(JSON.stringify(credentials))
    ).toString("base64");
    setSetting(SETTINGS.credentials, encrypted);
    deleteSettings([SETTINGS.legacyTrainingHubCredentials]);
    cached = { encoded: encrypted, credentials };
    return true;
  } catch (error) {
    console.warn(
      "[corosCredentials] Failed to encrypt and save COROS credentials.",
      error
    );
    // Without a saved login, an expired COROS session can't re-login on its own.
    recordDiagnosticError("corosAccount:saveLogin", error);
    return false;
  }
}

export async function getStoredCorosCredentials(): Promise<StoredCorosCredentials | null> {
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    return null;
  }

  const current = await readCredentialsSetting(SETTINGS.credentials);
  if (current) {
    return current;
  }

  // Migrate credentials saved by older builds under the Training Hub-specific
  // key. Both COROS APIs use the same password digest, so one encrypted account
  // can safely create their two independent sessions.
  const legacy = await readCredentialsSetting(SETTINGS.legacyTrainingHubCredentials);
  if (legacy) {
    await storeCorosCredentials(legacy.account, legacy.pwdHash);
  }
  return legacy;
}

/**
 * The saved COROS login without decrypting it: what the last decrypt or save
 * found, while the setting still holds that ciphertext. Call
 * loadStoredCorosCredentials() at startup so this is filled before use.
 */
export function peekStoredCorosCredentials(): StoredCorosCredentials | null {
  if (!cached) return null;
  return getSetting(SETTINGS.credentials) === cached.encoded ? cached.credentials : null;
}

/** Decrypts the saved login (if any) so peekStoredCorosCredentials() can answer. */
export async function loadStoredCorosCredentials(): Promise<void> {
  await getStoredCorosCredentials();
}

export function clearStoredCorosCredentials(): void {
  cached = null;
  deleteSettings([
    SETTINGS.credentials,
    SETTINGS.legacyTrainingHubCredentials
  ]);
}

async function readCredentialsSetting(key: string): Promise<StoredCorosCredentials | null> {
  const encoded = getSetting(key);
  if (!encoded) {
    return null;
  }
  if (cached?.encoded === encoded) {
    return cached.credentials;
  }

  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(
      Buffer.from(encoded, "base64")
    );
    const credentials = normalizeCredentials(JSON.parse(result));
    // The OS key rotated: rewrite under the current key (the legacy key is
    // migrated to the current one by the caller anyway).
    if (credentials && key === SETTINGS.credentials) {
      if (shouldReEncrypt) {
        await storeCorosCredentials(credentials.account, credentials.pwdHash);
      } else {
        cached = { encoded, credentials };
      }
    }
    return credentials;
  } catch (error) {
    recordDiagnosticError("corosAccount:readSavedLogin", error);
    return null;
  }
}

function normalizeCredentials(value: unknown): StoredCorosCredentials | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<StoredCorosCredentials>;
  const account =
    typeof candidate.account === "string" ? candidate.account.trim() : "";
  const pwdHash =
    typeof candidate.pwdHash === "string"
      ? candidate.pwdHash.trim().toLowerCase()
      : "";
  if (!account || !/^[a-f0-9]{32}$/.test(pwdHash)) {
    return null;
  }
  return { account, pwdHash };
}
