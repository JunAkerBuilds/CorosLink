import { PRIMARY_NAV_ITEMS, type PrimaryView } from "./primaryNav";
import { getHiddenNavItems } from "./hiddenNav";
import { t } from "../i18n/locale";

const DEFAULT_STARTUP_VIEW: PrimaryView = "overview";
const STARTUP_VIEW_STORAGE_KEY = "coroslink.startupView";

function isPrimaryView(value: string | null): value is PrimaryView {
  return PRIMARY_NAV_ITEMS.some(
    (item) => item.id === value && !item.excludeFromStartup,
  );
}

export function getPrimaryViewLabel(view: PrimaryView): string {
  return t(
    PRIMARY_NAV_ITEMS.find((item) => item.id === view)?.label ??
    "Overview"
  );
}

export function readStartupView(): PrimaryView {
  if (typeof window === "undefined") {
    return DEFAULT_STARTUP_VIEW;
  }

  try {
    const storedView = window.localStorage.getItem(STARTUP_VIEW_STORAGE_KEY);
    return isPrimaryView(storedView) && !getHiddenNavItems().has(storedView)
      ? storedView
      : DEFAULT_STARTUP_VIEW;
  } catch {
    return DEFAULT_STARTUP_VIEW;
  }
}

export function saveStartupView(view: PrimaryView): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(STARTUP_VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore private-mode or locked-storage failures; the app can still run.
  }
}
