import { getSetting, setSetting } from "./database";

/**
 * The first-run tour shows once to everyone who hasn't finished or skipped it,
 * new installs and updates alike. Early builds stored "existing-install" to
 * hide it from updates; that value now counts as not seen, like no value.
 */
const ONBOARDING_STATUS_KEY = "onboarding.status";

/** Stays pending until the tour is finished or skipped, so quitting mid-tour shows it again. */
export function isOnboardingPending(): boolean {
  return getSetting(ONBOARDING_STATUS_KEY) !== "completed";
}

export function completeOnboarding(): void {
  setSetting(ONBOARDING_STATUS_KEY, "completed");
}
