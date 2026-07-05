export type Theme = "dark" | "paper";

export const THEME_STORAGE_KEY = "coros-theme";

const DEFAULT_THEME: Theme = "dark";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "paper";
}

/** Read the persisted theme, falling back to the default (dark). */
export function readStoredTheme(): Theme {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) {
      return stored;
    }
  } catch {
    // localStorage may be unavailable; fall through to default.
  }
  return DEFAULT_THEME;
}

/** Persist the selected theme. */
export function storeTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore persistence failures.
  }
}

/**
 * Reflect the theme onto the document root. Dark is the implicit default, so we
 * clear the attribute for it and only set it for alternate themes.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "dark") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}
