import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { flushSync } from "react-dom";
import {
  applyTheme,
  readStoredTheme,
  runThemeTransition,
  storeTheme,
  type Theme,
  type ThemeOrigin
} from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme, origin?: ThemeOrigin) => void;
  toggleTheme: (origin?: ThemeOrigin) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());

  useEffect(() => {
    storeTheme(theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme, origin?: ThemeOrigin) => {
    // Commit the state change *and* the DOM attribute inside the view
    // transition callback so the snapshot captures the new theme. flushSync
    // forces React to paint the update synchronously within that callback.
    runThemeTransition(origin, () => {
      flushSync(() => setThemeState(next));
      applyTheme(next);
    });
  }, []);

  const toggleTheme = useCallback(
    (origin?: ThemeOrigin) => {
      setTheme(theme === "dark" ? "paper" : "dark", origin);
    },
    [theme, setTheme]
  );

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
