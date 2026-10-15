import fs from "node:fs";
import path from "node:path";
import { getSetting, setSetting } from "./database";

/**
 * The first-run tour is for new installs only. A fresh install has no app
 * database yet, so check for one before `initializeDatabase` creates it.
 * People upgrading from a build without the tour are recorded as
 * "existing-install" and never see it unless they open it from Help.
 */
const ONBOARDING_STATUS_KEY = "onboarding.status";

type OnboardingStatus = "pending" | "completed" | "existing-install";

export function hasExistingAppData(userDataPath: string): boolean {
  return ["coroslink.sqlite", "coros-desktop.sqlite"].some((name) =>
    fs.existsSync(path.join(userDataPath, name))
  );
}

/** Call once after the database is open. Leaves an earlier decision alone. */
export function initializeOnboardingStatus(hadAppData: boolean): void {
  if (getSetting(ONBOARDING_STATUS_KEY)) {
    return;
  }
  const status: OnboardingStatus = hadAppData ? "existing-install" : "pending";
  setSetting(ONBOARDING_STATUS_KEY, status);
}

/** Stays pending until the tour is finished or skipped, so quitting mid-tour shows it again. */
export function isOnboardingPending(): boolean {
  return getSetting(ONBOARDING_STATUS_KEY) === "pending";
}

export function completeOnboarding(): void {
  const status: OnboardingStatus = "completed";
  setSetting(ONBOARDING_STATUS_KEY, status);
}
