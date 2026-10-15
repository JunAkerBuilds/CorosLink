import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";
import "../../src/watchfaces/watchfaces.css";
import { WatchfaceExportPreview } from "../../src/watchfaces/WatchfaceExportPreview";
import QRCode from "qrcode";

const canvas = document.createElement("canvas");
canvas.width = canvas.height = 1;
canvas.getContext("2d").fillRect(0, 0, 1, 1);
const dataUrl = canvas.toDataURL();
const fixture = window.compileFixture = { calls: [], pending: null, saved: [], publishes: 0, assetReads: [], archiveId: "fixture-archive",
  resolutions: [416, 800], connected: true, syncCalls: [], syncPending: null, syncStatus: { phase: "idle", sentBytes: 0, totalBytes: 0 },
  // Send to iPhone (WatchfacePhoneSendCard).
  platform: "darwin", phoneSends: [], phoneStops: 0, airDrops: [], phoneSendError: null, phoneSendTtlMs: 10 * 60_000, emitPhoneStatus: null };
const phoneLink = "coroslink://face/1?a=192.168.1.20&p=52814&k=q6urq6urq6urq6urq6urqw&h=9Po9_KQKJ55mEW79ftZqF1FZw746v6TTt5TvhumpC6Y&s=4096&n=Fixture%20face&w=pace-pro";
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
  cancelCorosWatchfaceSync: async () => fixture.syncPending?.resolve({ phase: "cancelled", sentBytes: 0, totalBytes: 1 }),
  get platform() { return fixture.platform; },
  startCorosWatchfacePhoneSend: async input => {
    fixture.phoneSends.push(input);
    if (fixture.phoneSendError) throw new Error(`Error invoking remote method 'watchfaces:phoneSendStart': Error: ${fixture.phoneSendError}`);
    return { link: phoneLink, qrDataUrl: await QRCode.toDataURL(phoneLink, { margin: 1, width: 360, errorCorrectionLevel: "M" }),
      name: input.name, size: 4096, hosts: ["192.168.1.20"], expiresAt: fixture.phoneExpiresAt = Date.now() + fixture.phoneSendTtlMs };
  },
  stopCorosWatchfacePhoneSend: async () => { fixture.phoneStops++; },
  airDropCorosWatchfaceToIphone: async input => { fixture.airDrops.push(input); },
  onCorosWatchfacePhoneSendStatus: callback => { fixture.emitPhoneStatus = callback; return () => { fixture.emitPhoneStatus = null; }; }
};
const root = createRoot(document.getElementById("root"));
fixture.render = () => root.render(<div className="watchface-shell watchface-shell--studio">
  <WatchfaceExportPreview api={api} archive={{archiveId: fixture.archiveId, firmwareType: "COROS W332"}}
    details={{ resolutions: fixture.resolutions.map(width => ({ width, height: width, directory: `watchface_${width}x${width}`,
      config: {}, aodConfig: {}, icons: [], spriteFolders: [] })) }}
    name="Fixture face" languages="all" customWeekday={false} rebuilding={false}
    onLanguagesChange={() => {}} onClose={() => {}} onPublish={() => { fixture.publishes++; }} />
</div>);
fixture.unmount = () => root.render(null);
fixture.render();
