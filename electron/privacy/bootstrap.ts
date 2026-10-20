import path from "node:path";
import { app, ipcMain } from "electron";
import { DataModeService } from "./dataModeService";
import { DataModeStore } from "./dataModeStore";
import { installElectronNetworkGuards } from "./electronNetworkGuards";
import { installNodeNetworkGuards } from "./networkGuards";
import { NetworkPolicy } from "./networkPolicy";
import { installIpcPolicyGate } from "./remoteFeatures";

/**
 * Imported first by main.ts, before any module that can open a connection.
 * Reads the persisted data mode synchronously, installs the guards that refuse
 * uploads to COROS, and gates IPC. Nothing here touches the network.
 */

const store = new DataModeStore(path.join(app.getPath("userData"), "privacy", "data-mode.json"));
const launch = store.load();
const localOnlyAtLaunch = launch.mode === "local_only";

export const networkPolicy = new NetworkPolicy({ enforcing: localOnlyAtLaunch });

installNodeNetworkGuards(networkPolicy);
installElectronNetworkGuards(networkPolicy);
installIpcPolicyGate(ipcMain, networkPolicy, channel => {
  if (!app.isPackaged) console.warn(`[privacy] IPC channel "${channel}" is not classified in privacy/remoteFeatures.ts.`);
});

export const dataMode = new DataModeService({
  store,
  policy: networkPolicy,
  initial: launch,
  relaunch: () => {
    app.relaunch();
    app.quit();
  }
});
