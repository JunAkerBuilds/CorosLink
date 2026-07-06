export type Theme = "dark" | "paper";

export const THEME_STORAGE_KEY = "coros-theme";

/** Window chrome background — must match --bg-base in styles.css. */
export const THEME_WINDOW_BACKGROUND: Record<Theme, string> = {
  dark: "#05080b",
  paper: "#f6f3ec",
};

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

  window.corosLink?.setWindowBackground?.(THEME_WINDOW_BACKGROUND[theme]);
}

/** Where the theme change should visually originate (the toggle button). */
export interface ThemeOrigin {
  x: number;
  y: number;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => {
    finished: Promise<void>;
    ready: Promise<void>;
  };
};

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Animate a theme swap as a circular reveal that grows from `origin`, using the
 * View Transitions API. The caller supplies `commit`, which performs the actual
 * state change (and must apply the theme to the DOM synchronously). Falls back
 * to an instant swap where view transitions are unavailable or motion is
 * reduced.
 */
export function runThemeTransition(
  origin: ThemeOrigin | undefined,
  commit: () => void
): void {
  const doc = document as ViewTransitionDocument;
  const root = document.documentElement;

  if (!doc.startViewTransition || !origin || prefersReducedMotion()) {
    commit();
    return;
  }

  const { x, y } = origin;
  const endRadius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  root.style.setProperty("--theme-reveal-x", `${x}px`);
  root.style.setProperty("--theme-reveal-y", `${y}px`);
  root.style.setProperty("--theme-reveal-r", `${endRadius}px`);
  root.classList.add("theme-transitioning");

  const transition = doc.startViewTransition(() => {
    commit();
  });

  void transition.finished.finally(() => {
    root.classList.remove("theme-transitioning");
  });
}
