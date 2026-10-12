import { useState, type ReactNode } from "react";
import { Bluetooth, Usb } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import { CorosBluetoothMusicPanel } from "./CorosBluetoothMusicPanel";

interface WatchMusicSourcePanelProps {
  api: CorosLinkApi | undefined;
  connection: CorosNativeBleSnapshot | null;
  usbPanel: ReactNode;
  showWifiMusic?: boolean;
  wifiSyncBusy?: boolean;
  onBluetoothBusyChange?: (busy: boolean) => void;
}

export function WatchMusicSourcePanel(props: WatchMusicSourcePanelProps) {
  if (!props.connection?.connected) return props.usbPanel;

  // Unmount the optional view on disconnect or a change of watch. Reconnecting
  // starts with USB again, and pending Bluetooth reads cannot restore old rows.
  const watchKey = props.connection.deviceId ?? props.connection.watchAddress ??
    props.connection.deviceName ?? "connected";
  return <ConnectedWatchMusicSource key={watchKey} {...props} />;
}

function ConnectedWatchMusicSource({ api, connection, usbPanel, showWifiMusic, wifiSyncBusy, onBluetoothBusyChange }: WatchMusicSourcePanelProps) {
  const [useBluetooth, setUseBluetooth] = useState(false);
  const [wifiBusy, setWifiBusy] = useState(false);

  return <div className="watch-music-source">
    <div className="watch-music-source-options">
      <span>View library via</span>
      <div className="library-filter-group" role="group" aria-label="Watch music connection">
        <button type="button" className={`library-filter-option${!useBluetooth ? " active" : ""}`}
          aria-pressed={!useBluetooth} disabled={wifiBusy || wifiSyncBusy} onClick={() => setUseBluetooth(false)}>
          <Usb size={14} aria-hidden="true" /> USB
        </button>
        <button type="button" className={`library-filter-option${useBluetooth ? " active" : ""}`}
          aria-pressed={useBluetooth} disabled={wifiBusy || wifiSyncBusy} onClick={() => setUseBluetooth(true)}>
          <Bluetooth size={14} aria-hidden="true" /> Bluetooth
        </button>
      </div>
    </div>
    {useBluetooth ? <CorosBluetoothMusicPanel api={api} connection={connection} onWifiBusyChange={setWifiBusy}
      showWifiMusic={showWifiMusic} wifiSyncBusy={wifiSyncBusy} onOperationBusyChange={onBluetoothBusyChange} /> : usbPanel}
  </div>;
}
