import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import {
  applySportColors,
  readStoredSportColors
} from "./calendar/sportColors";
import "./styles.css";

// Apply the persisted theme before the first paint to avoid a dark→light flash.
applyTheme(readStoredTheme());
// Apply the persisted per-sport activity colors so the calendar liserés paint correctly.
applySportColors(readStoredSportColors());

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>
);
