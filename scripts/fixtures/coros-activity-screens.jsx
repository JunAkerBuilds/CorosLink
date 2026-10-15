import React from "react";
import { createRoot } from "react-dom/client";
import { CorosActivityScreenPanel } from "../../src/watchfaces/CorosActivityScreenPanel";
import "../../src/styles.css";
import "../../src/watchfaces/watchLink.css";

const root = createRoot(document.getElementById("root"));
const fixture = window.activityFixture = {
  snapshot: { available: true, phase: "connected", transport: "corebluetooth", connected: true, encrypted: true, systemBind: "authenticated", channels: [],
    deviceName: "COROS PACE Pro TEST", deviceId: "fixture-watch", modelNumber: "COROS W332", firmwareRevision: "3.2008.0", authenticatedAt: 1 },
  disabled: false, busy: [], api: window.corosLink
};
fixture.render = () => root.render(<main style={{ padding: 24, maxWidth: 1000 }}>
  <CorosActivityScreenPanel api={fixture.api} snapshot={fixture.snapshot} disabled={fixture.disabled} onBusy={busy => fixture.busy.push(busy)} />
</main>);
fixture.render();
