import { createHash } from "node:crypto";
import type { CorosBleBackend } from "./corosNativeBleTypes";

/**
 * The watch's Bluetooth identity, remembered on the first connection the user
 * made and that the watch accepted (trust on first use). COROS authentication
 * only proves CorosLink to the watch, so this is what tells the remembered
 * watch apart from a device that copies its advertised name:
 * - Mac Bluetooth: CoreBluetooth's peripheral identifier (a UUID per Mac);
 * - Windows and Linux Bluetooth: the device address the OS reports (bonded);
 * - USB adapter: the watch address in the saved bond, whose key encrypts the link.
 * Kept per backend: the identifiers aren't comparable across them.
 */

export const WATCH_IDENTITY_SETTING = "coros.ble.watchIdentity";
/** A refused identity waits this long for the user's "Connect anyway". */
export const IDENTITY_CONFIRM_MS = 10 * 60_000;

export interface PinnedWatch {
  deviceId: string;
  deviceName?: string;
  serialNumber?: string;
  modelNumber?: string;
  model?: string;
  pinnedAt: number;
}

export type PinnedWatches = Partial<Record<CorosBleBackend, PinnedWatch>>;

/** Why a connection was not made: another device answered, or there is no identity to check yet. */
export type WatchIdentityProblem = "mismatch" | "unpinned";

const IDENTITY_MISMATCH_MESSAGE = "This doesn’t look like the watch you connected before.";
const IDENTITY_UNPINNED_MESSAGE = "Connect your watch from the watch menu once.";

/** Thrown where the user can't be asked (background or app-started connections). */
export class WatchIdentityError extends Error {
  readonly watchIdentity: WatchIdentityProblem;
  constructor(problem: WatchIdentityProblem) {
    super(problem === "mismatch" ? IDENTITY_MISMATCH_MESSAGE : IDENTITY_UNPINNED_MESSAGE);
    this.name = "WatchIdentityError";
    this.watchIdentity = problem;
  }
}

/** The identity problem an error carries, by property so it survives module and context boundaries. */
export function watchIdentityProblem(error: unknown): WatchIdentityProblem | undefined {
  const value = error && typeof error === "object" ? (error as { watchIdentity?: unknown }).watchIdentity : undefined;
  return value === "mismatch" || value === "unpinned" ? value : undefined;
}

export function normalizeIdentity(deviceId: unknown): string | undefined {
  if (typeof deviceId !== "string") return undefined;
  const value = deviceId.trim().toUpperCase();
  return value && value.length <= 128 ? value : undefined;
}

export function sameIdentity(a: unknown, b: unknown): boolean {
  const left = normalizeIdentity(a);
  return Boolean(left) && left === normalizeIdentity(b);
}

/** A short, non-reversible tag for logs: never the identifier itself. */
export function identityTag(deviceId: string): string {
  return `id#${createHash("sha256").update(normalizeIdentity(deviceId) ?? "").digest("hex").slice(0, 8)}`;
}

export function parsePinnedWatches(raw: string | undefined | null): PinnedWatches {
  try {
    const value = raw ? JSON.parse(raw) as unknown : {};
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const result: PinnedWatches = {};
    for (const backend of ["system", "usb"] as const) {
      const entry = (value as Record<string, unknown>)[backend] as Partial<PinnedWatch> | undefined;
      const deviceId = normalizeIdentity(entry?.deviceId);
      if (!entry || !deviceId) continue;
      const text = (field: unknown) => typeof field === "string" && field.length <= 128 ? field : undefined;
      result[backend] = {
        deviceId,
        deviceName: text(entry.deviceName), serialNumber: text(entry.serialNumber),
        modelNumber: text(entry.modelNumber), model: text(entry.model),
        pinnedAt: typeof entry.pinnedAt === "number" ? entry.pinnedAt : 0
      };
    }
    return result;
  } catch {
    return {};
  }
}
