// The foot of the sidebar: a light/dark switch, the "Buy me a coffee" pill, then the "Local mode" chip when it's on.
// The update prompt hangs off it too, so it opens over any screen in the shell (Updates itself is in the account menu).
// "System" lives in the account menu's Appearance flyout; this switch flips straight between light and dark.
import { useTheme } from "@/lib/theme";
import { LocalOnlyChip } from "./LocalOnlyChip";
import { UpdatePrompt } from "./Updates";

const SUN = "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8zM12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4";
const MOON = "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z";

function ThemeSwitch() {
  const { theme, setChoice } = useTheme();
  const dark = theme === "dark";
  return (
    <button type="button" role="switch" aria-checked={dark} className="theme-switch" aria-label="Dark mode"
      data-tip="Dark mode" onClick={() => setChoice(dark ? "light" : "dark")}>
      <span className="theme-track" aria-hidden="true">
        <span className="theme-thumb">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d={dark ? MOON : SUN} /></svg>
        </span>
      </span>
      <span className="rail-label">{dark ? "Dark mode" : "Light mode"}</span>
    </button>
  );
}

export function RailFoot() {
  return (
    <div className="rail-foot">
      <ThemeSwitch />
      <a className="coffee-chip" href="https://www.buymeacoffee.com/addridoa" target="_blank" rel="noreferrer" aria-label="Buy me a coffee">
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16" /><path d="M8 3.5v2.5M12 3.5v2.5" />
        </svg>
        <span className="rail-label">Buy me a coffee</span>
      </a>
      <LocalOnlyChip />
      <UpdatePrompt />
    </div>
  );
}
