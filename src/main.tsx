import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import { applySportColors, readStoredSportColors } from "./training/sportColors";
import "./styles.css";

// Apply the persisted theme before the first paint to avoid a dark→light flash.
applyTheme(readStoredTheme());
// Apply persisted per-sport colors so the heatmap tints correctly on first paint.
applySportColors(readStoredSportColors());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
