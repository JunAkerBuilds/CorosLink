import { createRoot } from "react-dom/client";
import { SettingsView } from "../../src/settings/SettingsView";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { installRendererDiagnostics } from "../../src/diagnostics";
import "../../src/styles.css";

installRendererDiagnostics(window.corosLink);
// ?focus=privacy opens Settings at that section, as the Local-Only button does.
const focus = new URLSearchParams(location.search).get("focus") as "watch" | "weather" | "privacy" | null;
createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 24 }}>
    <UnitSystemProvider>
      <SettingsView api={window.corosLink!} updateSnapshot={{ status: "idle", currentVersion: "0.1.test" } as never}
        focusSection={focus ? { section: focus, key: 1 } : undefined}
        updateBusy={false} onCheckForUpdates={() => undefined} onError={console.error} />
    </UnitSystemProvider>
  </div>
);
