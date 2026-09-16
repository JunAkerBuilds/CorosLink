import { createRoot } from "react-dom/client";
import { SettingsView } from "../../src/settings/SettingsView";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { installRendererDiagnostics } from "../../src/diagnostics";
import "../../src/styles.css";

installRendererDiagnostics(window.corosLink);
createRoot(document.getElementById("root")!).render(
  <div style={{ padding: 24 }}>
    <UnitSystemProvider>
      <SettingsView api={window.corosLink!} updateSnapshot={{ status: "idle", currentVersion: "0.1.test" } as never}
        updateBusy={false} onCheckForUpdates={() => undefined} onError={console.error} />
    </UnitSystemProvider>
  </div>
);
