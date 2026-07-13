import { useEffect, useRef, useState } from "react";
import { Bluetooth, FileArchive, Loader2, Send, Unplug } from "lucide-react";
import type { CorosBluetoothDeviceChoice } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  CorosRawWatchfaceInstaller,
  type CorosRawWatchfaceInstallProgress
} from "./corosRawWatchfaceInstaller";
import { inspectCorosRawWatchfaceBin } from "./corosRawWatchfaceTransfer";

type InstallerState = "idle" | "connecting" | "installing";

// The SFT packet format is mapped, but the PACE Pro rejects it unless the
// preceding SystemBind session is complete. Keep this entire Bluetooth panel
// locked until a legitimate live provider is implemented and verified: even a
// diagnostic reconnect is not useful during the carrier-patch workflow.
const DIRECT_TRANSFER_ENABLED = false;

function formatBytes(bytes: number): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
    style: "unit",
    unit: bytes >= 1_000_000 ? "megabyte" : "kilobyte",
    unitDisplay: "narrow"
  }).format(bytes / (bytes >= 1_000_000 ? 1_000_000 : 1_000));
}

interface RawBinInstallerPanelProps {
  api: CorosLinkApi;
}

export function RawBinInstallerPanel({ api }: RawBinInstallerPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [installer, setInstaller] = useState<CorosRawWatchfaceInstaller | null>(null);
  const [rawBin, setRawBin] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileDetails, setFileDetails] = useState<string | null>(null);
  const [state, setState] = useState<InstallerState>("idle");
  const [progress, setProgress] = useState<CorosRawWatchfaceInstallProgress | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [nearbyDevices, setNearbyDevices] = useState<CorosBluetoothDeviceChoice[]>([]);

  useEffect(() => {
    return () => installer?.disconnect();
  }, [installer]);

  useEffect(() => {
    if (!DIRECT_TRANSFER_ENABLED) return;
    return api.onCorosBluetoothDevices(setNearbyDevices);
  }, [api]);

  async function handleSelectFile(file?: File) {
    if (!file) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bin = inspectCorosRawWatchfaceBin(bytes);
      setRawBin(bytes);
      setFileName(file.name);
      setFileDetails(
        "614A · ID " +
          bin.watchFaceId +
          " · " +
          formatBytes(bin.sizeBytes) +
          " · CRC " +
          bin.fullFileCrc16.toString(16).padStart(4, "0").toUpperCase()
      );
      setMessage(null);
      setProgress(null);
    } catch (caught) {
      setRawBin(null);
      setFileName(null);
      setFileDetails(null);
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConnect() {
    if (!DIRECT_TRANSFER_ENABLED) {
      setMessage("Direct Bluetooth installation is disabled until a live authenticated SystemBind provider is available.");
      return;
    }
    if (installer) {
      installer.disconnect();
      setInstaller(null);
      setMessage("Disconnected from " + installer.deviceName + ".");
      return;
    }
    setState("connecting");
    setMessage(null);
    setNearbyDevices([]);
    try {
      const nextInstaller = await CorosRawWatchfaceInstaller.connect();
      setInstaller(nextInstaller);
      setMessage(
        "Connected to " +
          nextInstaller.deviceName +
          ". SystemBind session verification is still in progress, so sending is locked for now."
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setState("idle");
    }
  }

  async function handleCancelPairingScan() {
    await api.cancelCorosBluetoothDeviceSelection();
    setNearbyDevices([]);
  }

  async function handleChooseBluetoothDevice(deviceId: string) {
    await api.selectCorosBluetoothDevice(deviceId);
    setNearbyDevices([]);
  }

  async function handleInstall() {
    if (!DIRECT_TRANSFER_ENABLED || !installer || !rawBin) return;
    setState("installing");
    setMessage(null);
    setProgress(null);
    try {
      const result = await installer.install(rawBin, setProgress);
      setMessage(
        "Transferred " +
          formatBytes(result.transferredBytes) +
          " to " +
          result.deviceName +
          "."
      );
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setState("idle");
    }
  }

  const busy = state !== "idle";
  const percent = progress ? Math.round(progress.fraction * 100) : 0;

  return (
    <section className="watchface-hub-section watchface-raw-installer" aria-labelledby="raw-bin-installer-title">
      <div className="watchface-hub-section-heading">
        <div>
          <span className="watchface-raw-installer-kicker">Experimental · PACE Pro</span>
          <h2 id="raw-bin-installer-title">Direct legacy BIN installer</h2>
          <p>
            The legacy SFT transfer format is mapped, but no live authenticated
            SystemBind provider is available. Direct Bluetooth installation is
            disabled; use the official COROS Android app for carrier tests.
          </p>
        </div>
        <div className="watchface-raw-installer-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !DIRECT_TRANSFER_ENABLED}
            onClick={() => void handleConnect()}
          >
            {state === "connecting" ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : installer ? (
              <Unplug size={16} aria-hidden="true" />
            ) : (
              <Bluetooth size={16} aria-hidden="true" />
            )}
            {installer ? installer.deviceName : "Pair / connect"}
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={busy || !DIRECT_TRANSFER_ENABLED}
            onClick={() => fileInputRef.current?.click()}
          >
            <FileArchive size={16} aria-hidden="true" /> Choose BIN
          </button>
          <input
            ref={fileInputRef}
            className="watchface-raw-installer-file-input"
            type="file"
            accept=".bin,application/octet-stream"
            onChange={(event) => void handleSelectFile(event.currentTarget.files?.[0])}
          />
          <button
            className="primary-button"
            type="button"
            disabled={busy || !DIRECT_TRANSFER_ENABLED || !installer || !rawBin}
            onClick={() => void handleInstall()}
          >
            {state === "installing" ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <Send size={16} aria-hidden="true" />
            )}
            {state === "installing"
              ? "Sending " + percent + "%"
              : DIRECT_TRANSFER_ENABLED
                ? "Send to watch"
                : "SystemBind pending"}
          </button>
        </div>
      </div>
      {fileName ? (
        <p className="watchface-raw-installer-file">
          <strong>{fileName}</strong>
          <span>{fileDetails}</span>
        </p>
      ) : (
        <p className="watchface-raw-installer-file is-empty">
          Select a legacy public BIN, such as a BLOCK3 or MULTIDATA-based carrier.
        </p>
      )}
      {state === "connecting" ? (
        <div className="watchface-raw-installer-devices">
          <span>
            {nearbyDevices.length
              ? "Choose your COROS PACE Pro:"
              : "Scanning nearby Bluetooth devices. Keep the watch awake and in pairing mode."}
          </span>
          {nearbyDevices.map((device) => (
            <button
              className="secondary-button"
              type="button"
              key={device.deviceId}
              onClick={() => void handleChooseBluetoothDevice(device.deviceId)}
            >
              <Bluetooth size={15} aria-hidden="true" />
              {device.deviceName || "Unnamed Bluetooth device"}
            </button>
          ))}
          <button
            className="secondary-button"
            type="button"
            onClick={() => void handleCancelPairingScan()}
          >
            Cancel scan
          </button>
        </div>
      ) : null}
      {progress ? (
        <div
          className="watchface-raw-installer-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label={"Watch-face transfer " + percent + "%"}
        >
          <span style={{ width: percent + "%" }} />
        </div>
      ) : null}
      {message ? <p className="watchface-raw-installer-message">{message}</p> : null}
    </section>
  );
}
