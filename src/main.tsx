import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installRendererDiagnostics, reportCaughtRenderError } from "./diagnostics";
import { RenderErrorBoundary } from "./RenderErrorBoundary";
import { ThemeProvider } from "./theme/ThemeProvider";
import { applyTheme, readStoredTheme } from "./theme/theme";
import { applySportColors, readStoredSportColors } from "./training/sportColors";
import { UnitSystemProvider } from "./units/UnitSystemProvider";
import { initializeLanguage } from "./i18n";
import "./styles.css";
import "./desktop.css";
import "./chat/coach.css";
import "./native-sidebar.css";
import "./toolbar.css";

installRendererDiagnostics(window.corosLink);
// Loads only the selected language's catalogs; the first render waits for them.
const languageReady = initializeLanguage();

// Older running preload builds and non-macOS windows retain the opaque fallback.
if (window.corosLink?.nativeSidebarGlass) {
  document.documentElement.dataset.nativeSidebarGlass = "true";
}

// Apply the persisted theme before the first paint to avoid a dark→light flash.
applyTheme(readStoredTheme());
// Apply persisted per-sport colors so the heatmap tints correctly on first paint.
applySportColors(readStoredSportColors());

void languageReady.finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!, {
    // Errors a boundary catches never reach window "error"; keep them in Diagnostics.
    onCaughtError: (error, info) => {
      console.error(error, info.componentStack);
      reportCaughtRenderError(error);
    }
  }).render(
    <React.StrictMode>
      <ThemeProvider>
        <UnitSystemProvider>
          {/* Last resort: an error outside the views still shows something, not a blank window. */}
          <RenderErrorBoundary title="CorosLink could not be displayed" reload>
            <App />
          </RenderErrorBoundary>
        </UnitSystemProvider>
      </ThemeProvider>
    </React.StrictMode>
  );
});
