import type { MouseEvent } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { t, useLanguage } from "../i18n";

export function ThemeToggle() {
  useLanguage();
  const { theme, toggleTheme } = useTheme();
  const isPaper = theme === "paper";
  const label = isPaper ? t("Switch to dark theme") : t("Switch to light theme");

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    toggleTheme({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2
    });
  }

  return (
    <button
      className="update-settings-trigger theme-toggle"
      type="button"
      aria-label={label}
      title={label}
      onClick={handleClick}
    >
      <span className="theme-toggle-icon" key={theme}>
        {isPaper ? (
          <Moon size={16} aria-hidden="true" />
        ) : (
          <Sun size={16} aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
