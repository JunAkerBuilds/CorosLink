import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/watchfaces/watchfaces.css";
import { WatchfaceExportPreview } from "../../src/watchfaces/WatchfaceExportPreview";

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
canvas.getContext("2d").fillRect(0, 0, 1, 1);
const dataUrl = canvas.toDataURL();
const fixture = window.compileFixture = { calls: [], pending: null, saved: [], publishes: 0, assetReads: [], archiveId: "fixture-archive",
  resolutions: [416, 800], connected: true, syncCalls: [], syncPending: null, syncStatus: { phase: "idle", sentBytes: 0, totalBytes: 0 } };
const api = {
  getCorosWatchfaceCompilerStatus: async () => ({ available: true, busy: false, phase: "idle", detail: "Compiler ready." }),
  loadCorosWatchfaceTemplateAssets: async (id, paths) => { fixture.assetReads.push(id); return paths.map(path => ({ path, dataUrl, width: 1, height: 1 })); },
  compileCorosWatchfaceArchive: input => {
    fixture.calls.push(input);
    return new Promise((resolve, reject) => { fixture.pending = { resolve, reject }; });
  },
  saveCorosCompiledWatchface: async id => { fixture.saved.push(id); return { saved: true }; },
  getCorosNativeBleStatus: async () => ({ phase: fixture.connected ? "connected" : "idle", available: true, connected: fixture.connected,
    encrypted: true, systemBind: fixture.connected ? "authenticated" : "not_authenticated", channels: [], backend: "system",
    transport: "corebluetooth", modelNumber: "COROS W332", softwareRevision: "V 3.2008.0", deviceName: "COROS PACE Pro TEST" }),
  connectCorosNativeBle: async () => { fixture.connected = true; return api.getCorosNativeBleStatus(); },
  getCorosWatchfaceSlots: async () => ({ id: "inventory", checkedAt: Date.now(), slots: Array.from({ length: 10 }, (_, slot) => ({ slot, faceId: slot === 0 ? 77 : null })) }),
  getCorosWatchfaceSyncStatus: async () => ({ ...fixture.syncStatus }),
  syncCorosWatchface: (id, target) => {
    fixture.syncCalls.push({ id, target });
    return new Promise((resolve, reject) => { fixture.syncPending = { resolve, reject }; });
  },
  cancelCorosWatchfaceSync: async () => fixture.syncPending?.resolve({ phase: "cancelled", sentBytes: 0, totalBytes: 1 })
};
const root = createRoot(document.getElementById("root"));
fixture.render = () => root.render(<div className="watchface-shell watchface-shell--studio">
  <WatchfaceExportPreview api={api} archive={{archiveId: fixture.archiveId, firmwareType: "COROS W332"}}
    details={{ resolutions: fixture.resolutions.map(width => ({ width, height: width, directory: `watchface_${width}x${width}`,
      config: {}, aodConfig: {}, icons: [], spriteFolders: [] })) }}
    name="Fixture face" languages="all" customWeekday={false} rebuilding={false}
    onLanguagesChange={() => {}} onClose={() => {}} onPublish={() => { fixture.publishes++; }} />
</div>);
fixture.render();
