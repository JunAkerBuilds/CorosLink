import React from "react";
import { createRoot } from "react-dom/client";
import { WatchConnectionMenu } from "../../src/watch/WatchConnectionMenu";
import { OnWatchPanel } from "../../src/watchfaces/OnWatchPanel";
import "../../src/styles.css";
import "../../src/toolbar.css";
import "../../src/watchfaces/watchfaces.css";

const connected = { available: true, phase: "connected", connected: true, encrypted: false,
  systemBind: "authenticated", channels: [], backend: "system", transport: "corebluetooth",
  backends: [{ id: "system", label: "Mac Bluetooth", available: true }],
  modelNumber: "COROS W332", softwareRevision: "V 3.2008.0", deviceName: "COROS PACE Pro TEST", batteryPercent: 56,
  watchEvents: [{ id: 1, kind: "media-control", action: 2, value: 1, receivedAt: Date.now() }] };
const state = { ...connected };
const fixture = window.notificationFixture = { calls: [], faceCalls: [], state, pending: null, facePending: null,
  compilerCalls: 0, compilerPending: null, savedBins: [], compilerStatus: { available: true, busy: false, phase: "idle", detail: "Compiler ready." },
  faceTargets: [], faceIds: Array.from({length:10},(_,slot)=>slot===0?99:null), inventoryReads: 0, inventoryError: null,
  faceStatus: { phase: "idle", sentBytes: 0, totalBytes: 12016 },
  navigations: [], connectCalls: [], scans: 0, nearby: [], remembered: true, watchKeySaved: true };
const api = {
  getCorosNativeBleStatus: async () => ({ ...fixture.state }),
  getCorosWatchfaceStatus: async () => ({ authenticated: true, secureStorageAvailable: true, savedCredentialsAvailable: true,
    suggestedRegion: "us", watchAuthenticationAvailable: fixture.watchKeySaved }),
  // Main asks to confirm; the fixture stands in for "Remove watch key" being chosen.
  forgetCorosWatchKey: async () => {
    fixture.forgetCalls = (fixture.forgetCalls ?? 0) + 1;
    fixture.watchKeySaved = false;
    return api.getCorosWatchfaceStatus();
  },
  connectCorosNativeBle: async options => {
    fixture.connectCalls.push(options ?? {});
    if (!options?.device && !fixture.remembered) throw new Error("Error invoking remote method 'corosBle:connect': Error: Find and select your COROS watch before connecting.");
    Object.assign(fixture.state, connected, { deviceName: options?.device?.deviceName ?? connected.deviceName });
    return { ...fixture.state };
  },
  scanCorosNativeBle: async () => {
    fixture.scans++;
    Object.assign(fixture.state, { discoveredDevices: fixture.nearby });
    return { ...fixture.state };
  },
  disconnectCorosNativeBle: async () => { Object.assign(fixture.state, { phase: "idle", connected: false, systemBind: "not_authenticated" }); return { ...fixture.state }; },
  refreshCorosNativeBle: async () => ({ ...fixture.state }),
  getCorosWatchfaceCompilerStatus: async () => ({ ...fixture.compilerStatus }),
  compileCorosDirectWatchface: () => {
    fixture.compilerCalls++; fixture.compilerStatus = { available: true, busy: true, phase: "compiling", detail: "Compiling watch face…" };
    return new Promise((resolve, reject) => { fixture.compilerPending = { resolve, reject }; });
  },
  saveCorosCompiledWatchface: async id => { fixture.savedBins.push(id); return { saved: true }; },
  chooseCorosDirectWatchface: async () => ({ id: "local-preview", name: "test-face.bin", bytes: 12016, faceId: 12345 }),
  getCorosWatchfaceSyncStatus: async () => ({ ...fixture.faceStatus }),
  getCorosWatchfaceSlots: async () => {
    if (fixture.inventoryError) throw new Error(fixture.inventoryError);
    return { id: `inventory-${++fixture.inventoryReads}`, checkedAt: Date.now(), slots: fixture.faceIds.map((faceId,slot)=>({slot,faceId})) };
  },
  syncCorosWatchface: (id, target) => {
    fixture.faceCalls.push(id);
    fixture.faceTargets.push(target);
    return new Promise((resolve, reject) => { fixture.facePending = { resolve, reject }; });
  },
  cancelCorosWatchfaceSync: async () => {
    fixture.faceStatus.phase = "cancelled";
    fixture.facePending.resolve({ ...fixture.faceStatus });
  },
  sendCorosNotification: input => {
    fixture.calls.push(input);
    return new Promise((resolve, reject) => { fixture.pending = { resolve, reject }; });
  }
};

// App polls the link and owns the menu's open state; this stands in for it.
function Harness() {
  const [snapshot, setSnapshot] = React.useState(null);
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    let timer;
    const poll = async () => { setSnapshot(await api.getCorosNativeBleStatus()); timer = setTimeout(poll, 100); };
    void poll();
    return () => clearTimeout(timer);
  }, []);
  return <div className="app">
    <header className="app-header"><div className="app-toolbar-watch">
      <WatchConnectionMenu api={api} snapshot={snapshot} onSnapshotChange={setSnapshot} usbWatch={null}
        open={open} onOpenChange={setOpen}
        onOpenWatchFaces={() => fixture.navigations.push("watch")} onSignIn={() => fixture.navigations.push("sign-in")} />
    </div></header>
    <main className="watchfaces-view watchface-shell watchface-shell--hub" style={{ padding: 24 }}>
      {snapshot ? <OnWatchPanel api={api} snapshot={snapshot} onOpenWatchMenu={() => setOpen(true)} /> : null}
    </main>
  </div>;
}

const root = createRoot(document.getElementById("root"));
let revision = 0;
fixture.render = () => root.render(<Harness key={revision++} />);
fixture.render();
