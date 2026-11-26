// First-run setup as the main process keeps it (desktop/main/setup.ts), and whether to show it at launch.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import { navigate } from "./router";
import { SETUP_PATH } from "./setupFlow";

export type SportTile = "run" | "trail" | "ride" | "swim" | "lift" | "hike" | "tri" | "ski" | "row" | "climb" | "yoga" | "hybrid";

export interface SetupState {
  setupDone: boolean;
  showOnLaunch: boolean;
  sports: SportTile[] | null;
  /** Sessions of each sport in the last six months, and the ones picked from them. */
  found: Partial<Record<SportTile, number>>;
  picked: SportTile[];
  data: { activities: number; healthDays: number; other: number } | null;
  /** Null where it can't be set (running from source). */
  openAtLogin: boolean | null;
  weeklyBackup: boolean;
  backupFolder: string;
  lastBackupAt: string | null;
}

export async function readSetup(): Promise<SetupState | null> {
  try {
    const answer = await fetch("/api/desktop/setup", { cache: "no-store" });
    return answer.ok ? ((await answer.json()) as SetupState) : null;
  } catch {
    return null;
  }
}

export async function changeSetup(change: { setupDone?: boolean; sports?: SportTile[]; openAtLogin?: boolean; weeklyBackup?: boolean }): Promise<SetupState> {
  const answer = await fetch("/api/desktop/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(change) });
  if (!answer.ok) throw new Error(t("That didn't save."));
  return (await answer.json()) as SetupState;
}

/**
 * Once signed in: whether setup still has to be done, and if so, the app moves there (once per launch, so "Skip"
 * and links out of setup aren't pulled back). "checking" until the main process has said.
 */
let asked = false;
export function useFirstRun(ready: boolean, pathname: string): "checking" | "ok" {
  const [state, setState] = useState<"checking" | "ok">(asked ? "ok" : "checking");
  useEffect(() => {
    if (!ready || asked) return;
    asked = true;
    void readSetup().then((s) => {
      if (s?.showOnLaunch && pathname !== SETUP_PATH) navigate(SETUP_PATH, { replace: true });
      setState("ok");
    });
  }, [ready, pathname]);
  return state;
}
