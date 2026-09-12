import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import { applySportColors, readStoredSportColors } from "./training/sportColors";
import { UnitSystemProvider } from "./units/UnitSystemProvider";
import "./styles.css";
import "./desktop.css";
import "./chat/coach.css";
import "./native-sidebar.css";
import "./toolbar.css";

// Older running preload builds and non-macOS windows retain the opaque fallback.
if (window.corosLink?.nativeSidebarGlass) {
  document.documentElement.dataset.nativeSidebarGlass = "true";
}

// Apply the persisted theme before the first paint to avoid a dark→light flash.
applyTheme(readStoredTheme());
// Apply persisted per-sport colors so the heatmap tints correctly on first paint.
applySportColors(readStoredSportColors());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <UnitSystemProvider>
        <App />
      </UnitSystemProvider>
    </ThemeProvider>
  </React.StrictMode>
);
