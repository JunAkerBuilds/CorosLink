// The COROS account import (desktop/main/account/service.ts) as Connections and setup read and drive it.
import { useEffect, useSyncExternalStore } from "react";
import { t } from "@/lib/i18n";

export interface LastImport {
  at: string; activities: number; details: number; healthDays: number; nights: number; waiting: number; refused?: string; problems: string[];
  /** Set when signed in to Training Hub: the recordings that came from it. */
  fromHub?: number;
}
export interface ImportStatus {
  /** Whether the helper is here (a Mac with it built). */
  available: boolean;
  on: boolean;
  connected: boolean;
  signIn: boolean;
  everyMinutes: number;
  running: boolean;
  step: { step: string; percent?: number } | null;
  last: LastImport | null;
  problem: string | null;
}

/** Auto-import choices in minutes; 0 is off (main: account/service.ts IMPORT_MINUTES). */
export const IMPORT_MINUTES = [0, 15, 30, 60, 180] as const;
export const importLabel = (m: number) => (m === 0 ? t("Off") : m < 60 ? t("Every {n} min", { n: m }) : m === 60 ? t("Every hour") : t("Every {n} hours", { n: m / 60 }));

export class ImportProblem extends Error {}

async function call(path: string, body?: object): Promise<ImportStatus> {
  const answer = await fetch(`/api/desktop/account${path}`, body
    ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    : { cache: "no-store" });
  const parsed = (await answer.json().catch(() => ({}))) as ImportStatus & { error?: { message: string } };
  if (!answer.ok || parsed.error) throw new ImportProblem(parsed.error?.message ?? t("That didn't work."));
  publish(parsed);
  return parsed;
}

let current: ImportStatus | null = null;
const listeners = new Set<() => void>();
function publish(next: ImportStatus) { current = next; for (const l of listeners) l(); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export const readImport = () => call("");
export const connectCoros = () => call("/connect", {});
export const importNow = () => call("/run", {});
export const setImport = (change: { on?: boolean; everyMinutes?: number }) => call("/settings", change);

/** The status, read on first use and every few seconds while an import runs (every minute otherwise). */
export function useCorosImport(): ImportStatus | null {
  const status = useSyncExternalStore(subscribe, () => current);
  const running = !!status?.running;
  useEffect(() => {
    if (!current) readImport().catch(() => undefined);
    const timer = setInterval(() => readImport().catch(() => undefined), running ? 2_000 : 60_000);
    return () => clearInterval(timer);
  }, [running]);
  return status;
}

/** What an import is doing, in words. */
export function importStep(step: ImportStatus["step"]): string {
  if (step?.step === "recordings") return t("Reading recordings");
  if (step?.step === "hub") return t("Downloading recordings from Training Hub");
  return t("Reading your COROS account");
}

/** One line on what the last import brought. */
export function importSummary(last: LastImport): string {
  const parts = [
    last.activities === 1 ? t("1 activity") : t("{n} activities", { n: last.activities }),
    last.nights === 1 ? t("1 night") : t("{n} nights", { n: last.nights }),
    last.healthDays === 1 ? t("1 day of health") : t("{n} days of health", { n: last.healthDays }),
  ];
  return parts.join(" · ");
}

/**
 * How many recordings are still to come. From Training Hub they come with the next imports; through COROS's MCP
 * alone, about 40 a day, and signing in to Training Hub brings them sooner.
 */
export function waitingNote(last: LastImport | null): string | null {
  if (!last || last.waiting <= 0) return null;
  const one = last.waiting === 1, n = last.waiting;
  if (last.fromHub !== undefined) {
    return one ? t("1 recording still to come. It comes from Training Hub with the next imports.")
      : t("{n} recordings still to come. They come from Training Hub with the next imports.", { n });
  }
  return one ? t("1 recording still to come. COROS sends about 40 a day; signing in to Training Hub brings them sooner.")
    : t("{n} recordings still to come. COROS sends about 40 a day; signing in to Training Hub brings them sooner.", { n });
}
