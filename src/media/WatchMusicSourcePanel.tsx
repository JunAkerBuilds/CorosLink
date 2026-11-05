import { t, useLanguage } from "../i18n/tools";
import { useEffect, useState, type ReactNode } from "react";
import { Bluetooth, Usb } from "lucide-react";
import type { CorosLinkApi } from "../coroslink-api";
import type { CorosNativeBleSnapshot } from "../../electron/corosNativeBleTypes";
import { CorosBluetoothMusicPanel } from "./CorosBluetoothMusicPanel";
import { publishWatchMusicInventory, useNeteaseSend } from "./watchMusicInventoryStore";

interface WatchMusicSourcePanelProps {
  api: CorosLinkApi | undefined;
  connection: CorosNativeBleSnapshot | null;
  usbPanel: ReactNode;
  showWifiMusic?: boolean;
  wifiSyncBusy?: boolean;
  onBluetoothBusyChange?: (busy: boolean) => void;
}

export function WatchMusicSourcePanel(props: WatchMusicSourcePanelProps) {
  useLanguage();
  if (!props.connection?.connected) return props.usbPanel;

  // Unmount the optional view on disconnect or a change of watch. Reconnecting
  // starts with USB again, and pending Bluetooth reads cannot restore old rows.
  const watchKey = props.connection.deviceId ?? props.connection.watchAddress ??
    props.connection.deviceName ?? "connected";
  return <ConnectedWatchMusicSource key={watchKey} {...props} />;
}

function ConnectedWatchMusicSource({ api, connection, usbPanel, showWifiMusic, wifiSyncBusy, onBluetoothBusyChange }: WatchMusicSourcePanelProps) {
  useLanguage();
  const [useBluetooth, setUseBluetooth] = useState(false);
  const [wifiBusy, setWifiBusy] = useState(false);
  // A Bluetooth read belongs to this watch: drop it on disconnect or a watch change, not on a USB/Bluetooth view switch.
  useEffect(() => () => publishWatchMusicInventory(null), []);
  // NetEase playlists are picked and created in the Bluetooth view: open it when Wi-Fi sends switch to NetEase.
  const { destination } = useNeteaseSend();
  useEffect(() => { if (destination === "netease") setUseBluetooth(true); }, [destination]);

  return <div className="watch-music-source">
    <div className="watch-music-source-options">
      <span>{t("View library via")}</span>
      <div className="library-filter-group" role="group" aria-label={t("Watch music connection")}>
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
