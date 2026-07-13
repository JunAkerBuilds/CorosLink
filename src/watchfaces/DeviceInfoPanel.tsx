import { useEffect, useState } from "react";
import { Bluetooth, Cpu, Loader2, Radio, RefreshCw, Unplug } from "lucide-react";
import type { CorosBluetoothDeviceChoice } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import {
  CorosBluetoothDeviceInfoSession,
  type CorosBluetoothDeviceSnapshot,
  type CorosGattServiceSnapshot
} from "./corosBluetoothDeviceInfo";

type DeviceInfoState = "idle" | "connecting" | "refreshing";

interface DeviceInfoPanelProps {
  api: CorosLinkApi;
}

function serviceStatus(service: CorosGattServiceSnapshot): string {
  return service.available ? "Available" : "Unavailable";
}

function DeviceDetails({ snapshot }: { snapshot: CorosBluetoothDeviceSnapshot }) {
  const details = [
    ["Device name", snapshot.deviceNameValue],
    ["Battery", snapshot.batteryPercent === undefined ? undefined : `${snapshot.batteryPercent}%`],
    ["Manufacturer", snapshot.manufacturerName],
    ["Model", snapshot.modelNumber],
    ["Serial", snapshot.serialNumber],
    ["Firmware", snapshot.firmwareRevision],
    ["Hardware", snapshot.hardwareRevision],
    ["Software", snapshot.softwareRevision]
  ].filter((detail): detail is [string, string] => Boolean(detail[1]));

  return (
    <>
      {details.length ? (
        <>
          <dl className="coros-device-info-details">
            {details.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <p className="coros-device-info-updated">
            Last read {new Date(snapshot.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </p>
        </>
      ) : (
        <p className="watchface-raw-installer-file is-empty">
          The watch did not expose readable standard device-information values.
        </p>
      )}
    </>
  );
}

function ProtectedWatchfaceStatus() {
  return (
    <aside className="coros-device-info-protected">
      <div>
        <strong>Active watch face</strong>
        <span>Not exposed by read-only Bluetooth</span>
      </div>
      <p>
        The installed face is part of the protected COROS session. CorosLink will show it only when a legitimate,
        read-safe provider exists.
      </p>
    </aside>
  );
}

function ResolvedGattMap({ snapshot }: { snapshot: CorosBluetoothDeviceSnapshot }) {
  const channels = snapshot.services.filter((service) => service.resolvedChannel);

  return (
    <section className="coros-device-gatt-map" aria-labelledby="coros-gatt-map-title">
      <div className="coros-device-gatt-map-heading">
        <div>
          <h3 id="coros-gatt-map-title">Resolved COROS GATT map</h3>
          <p>Verified PACE Pro handle layout. This is a map only, not access to COROS message contents.</p>
        </div>
        <span>{channels.length === 3 ? "Verified" : "Partial"}</span>
      </div>

      {channels.length ? (
        <div className="coros-device-gatt-channels">
          {channels.map((service) => {
            const channel = service.resolvedChannel;
            if (!channel) return null;
            return (
              <article key={service.uuid}>
                <header>
                  <div>
                    <strong>{service.label.replace("COROS ", "")}</strong>
                    <span>{channel.description}</span>
                  </div>
                  <code>{channel.serviceHandleRange}</code>
                </header>
                <dl>
                  <div>
                    <dt>Watch to app</dt>
                    <dd>
                      <code>{channel.watchToApp.handle}</code>
                      <span>{channel.watchToApp.access}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>App to watch</dt>
                    <dd>
                      <code>{channel.appToWatch.handle}</code>
                      <span>{channel.appToWatch.access}</span>
                    </dd>
                  </div>
                </dl>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="coros-device-gatt-empty">
          This watch exposes COROS services, but its channel layout does not yet match the verified PACE Pro map.
        </p>
      )}

      <details className="coros-device-gatt-diagnostics">
        <summary>Technical UUIDs and capabilities</summary>
        <div className="coros-device-info-services" aria-label="Accessible GATT services">
        {snapshot.services.map((service) => (
          <article className={service.available ? "is-available" : ""} key={service.uuid}>
            <header>
              <strong>{service.label}</strong>
              <span>{serviceStatus(service)}</span>
            </header>
            <code>{service.uuid}</code>
            {service.available && service.characteristics.length ? (
              <ul>
                {service.characteristics.map((characteristic) => (
                  <li key={characteristic.uuid}>
                    <code>{characteristic.uuid}</code>
                    {characteristic.capabilities.length ? (
                      <span>{characteristic.capabilities.join(" · ")}</span>
                    ) : (
                      <span>no declared access</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
        ))}
        </div>
      </details>
    </section>
  );
}

/** Connects only to inspect exposed standard GATT information and capabilities. */
export function DeviceInfoPanel({ api }: DeviceInfoPanelProps) {
  const [session, setSession] = useState<CorosBluetoothDeviceInfoSession | null>(null);
  const [snapshot, setSnapshot] = useState<CorosBluetoothDeviceSnapshot | null>(null);
  const [state, setState] = useState<DeviceInfoState>("idle");
  const [nearbyDevices, setNearbyDevices] = useState<CorosBluetoothDeviceChoice[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => () => session?.disconnect(), [session]);
  useEffect(() => api.onCorosBluetoothDevices(setNearbyDevices), [api]);

  async function handleConnect() {
    if (session) {
      session.disconnect();
      setSession(null);
      setSnapshot((current) => current ? { ...current, connected: false } : null);
      setMessage("Disconnected. The watch was not unpaired or modified.");
      return;
    }
    setState("connecting");
    setNearbyDevices([]);
    setMessage(null);
    try {
      const nextSession = await CorosBluetoothDeviceInfoSession.connect();
      setSession(nextSession);
      setSnapshot(nextSession.snapshot);
      setMessage("Read-only GATT snapshot complete. No COROS proprietary characteristic was read, written, or subscribed.");
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setState("idle");
    }
  }

  async function handleChooseDevice(deviceId: string) {
    await api.selectCorosBluetoothDevice(deviceId);
    setNearbyDevices([]);
  }

  async function handleCancelScan() {
    await api.cancelCorosBluetoothDeviceSelection();
    setNearbyDevices([]);
  }

  async function handleRefresh() {
    if (!session) return;
    setState("refreshing");
    setMessage(null);
    try {
      setSnapshot(await session.refresh());
      setMessage("Standard device data refreshed. Only the Battery Service was read again.");
    } catch (caught) {
      setSnapshot({ ...session.snapshot });
      setMessage(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setState("idle");
    }
  }

  const busy = state !== "idle";

  return (
    <section className="watchface-hub-section coros-device-info" aria-labelledby="coros-device-info-title">
      <div className="watchface-hub-section-heading">
        <div>
          <span className="watchface-raw-installer-kicker">Read-only Bluetooth</span>
          <h2 id="coros-device-info-title">PACE Pro device info</h2>
          <p>
            Inspect standard device information and the accessible GATT map. This panel never writes,
            transfers files, starts SystemBind, or changes watch pairing.
          </p>
        </div>
        <div className="watchface-raw-installer-actions">
          {session ? (
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void handleRefresh()}>
              {state === "refreshing" ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              Refresh battery
            </button>
          ) : null}
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void handleConnect()}>
            {state === "connecting" ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : session ? (
              <Unplug size={16} aria-hidden="true" />
            ) : (
              <Bluetooth size={16} aria-hidden="true" />
            )}
            {session ? `Disconnect ${session.deviceName}` : "Connect read-only"}
          </button>
        </div>
      </div>

      {state === "connecting" ? (
        <div className="watchface-raw-installer-devices">
          <span>
            {nearbyDevices.length
              ? "Choose your already-paired COROS PACE Pro:"
              : "Looking for nearby Bluetooth devices. Keep the watch awake; do not reset or re-pair it."}
          </span>
          {nearbyDevices.map((device) => (
            <button className="secondary-button" type="button" key={device.deviceId} onClick={() => void handleChooseDevice(device.deviceId)}>
              <Bluetooth size={15} aria-hidden="true" />
              {device.deviceName || "Unnamed Bluetooth device"}
            </button>
          ))}
          <button className="secondary-button" type="button" onClick={() => void handleCancelScan()}>
            Cancel scan
          </button>
        </div>
      ) : null}

      {snapshot ? (
        <div className="coros-device-info-snapshot">
          <div className="coros-device-info-name">
            <Cpu size={18} aria-hidden="true" />
            <strong>{snapshot.deviceName}</strong>
            <span>{snapshot.connected ? "Connected" : "Disconnected"}</span>
          </div>
          <DeviceDetails snapshot={snapshot} />
          <ProtectedWatchfaceStatus />
          <ResolvedGattMap snapshot={snapshot} />
        </div>
      ) : (
        <p className="watchface-raw-installer-file is-empty">
          Connect to view what the watch exposes without authenticated COROS app traffic.
        </p>
      )}

      <p className="coros-device-info-limitation">
        <Radio size={14} aria-hidden="true" /> Web Bluetooth does not expose RSSI or negotiated MTU here.
        Installed watchfaces, weather values, and protected COROS data remain unavailable without a legitimate SystemBind session.
      </p>
      {message ? <p className="watchface-raw-installer-message">{message}</p> : null}
    </section>
  );
}
