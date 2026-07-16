import crypto from "node:crypto";
import { safeStorage } from "electron";
import { deleteSettings, getSetting, setSetting } from "./database";

const SETTINGS = {
  credentials: "coros.credentials",
  legacyTrainingHubCredentials: "trainingHub.credentials"
} as const;

export interface StoredCorosCredentials {
  account: string;
  pwdHash: string;
}

export function hashCorosPassword(password: string): string {
  return crypto.createHash("md5").update(password, "utf8").digest("hex");
}

export function storeCorosCredentials(
  account: string,
  pwdHash: string
): boolean {
  const credentials = normalizeCredentials({ account, pwdHash });
  if (!credentials) {
    throw new Error("Cannot save invalid COROS credentials.");
  }

  if (!safeStorage.isEncryptionAvailable()) {
    console.warn(
      "[corosCredentials] Cannot remember COROS credentials because OS secure storage is unavailable."
    );
    return false;
  }

  try {
    const encrypted = safeStorage
      .encryptString(JSON.stringify(credentials))
      .toString("base64");
    setSetting(SETTINGS.credentials, encrypted);
    deleteSettings([SETTINGS.legacyTrainingHubCredentials]);
    return true;
  } catch (error) {
    console.warn(
      "[corosCredentials] Failed to encrypt and save COROS credentials.",
      error
    );
    return false;
  }
}

export function getStoredCorosCredentials(): StoredCorosCredentials | null {
  if (!safeStorage.isEncryptionAvailable()) {
    return null;
  }

  const current = readCredentialsSetting(SETTINGS.credentials);
  if (current) {
    return current;
  }

  // Migrate credentials saved by older builds under the Training Hub-specific
  // key. Both COROS APIs use the same password digest, so one encrypted account
  // can safely create their two independent sessions.
  const legacy = readCredentialsSetting(SETTINGS.legacyTrainingHubCredentials);
  if (legacy) {
    storeCorosCredentials(legacy.account, legacy.pwdHash);
  }
  return legacy;
}

export function clearStoredCorosCredentials(): void {
  deleteSettings([
    SETTINGS.credentials,
    SETTINGS.legacyTrainingHubCredentials
  ]);
}

function readCredentialsSetting(key: string): StoredCorosCredentials | null {
  const encoded = getSetting(key);
  if (!encoded) {
    return null;
  }

  try {
    const decrypted = safeStorage.decryptString(Buffer.from(encoded, "base64"));
    return normalizeCredentials(JSON.parse(decrypted));
  } catch {
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
