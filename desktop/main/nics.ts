// Which of this computer's network adapters a phone on the same Wi-Fi can reach. Shared by phone sync and Send to
// iPhone, which both put addresses in a QR code that the phone tries in order.
import type { NetworkInterfaceInfo } from "node:os";

/** Adapters a phone can't reach: VMs, containers, WSL/Hyper-V, VPN tunnels, bridges, Bluetooth. */
export const VIRTUAL_ADAPTER = /docker|veth|vmnet|vmware|vbox|virtualbox|virbr|vethernet|hyper-v|wsl|utun|tun\d|tap\d|bridge|loopback|bluetooth|zerotier/i;
/** The Wi-Fi adapter on macOS, Windows (any language) and Linux. */
export const WIFI_ADAPTER = /^(en0|wi-?fi|wlan|wlp|wireless)/i;

/**
 * This computer's IPv4 addresses that `accept` allows, Wi-Fi first, then other adapters, then link-local
 * (169.254.x: an adapter that got no address, common on Windows). Virtual adapters are left out unless `keep` says
 * otherwise (Tailscale's tunnel is one a phone can use).
 */
export function phoneReachable(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>, accept: (address: string) => boolean, keep: (address: string) => boolean = () => false): string[] {
  const found = Object.entries(interfaces).flatMap(([name, list]) => (list ?? [])
    .filter((entry) => !entry.internal && entry.family === "IPv4" && accept(entry.address))
    .filter((entry) => keep(entry.address) || !VIRTUAL_ADAPTER.test(name))
    .map((entry) => ({ address: entry.address, rank: entry.address.startsWith("169.254.") ? 3 : keep(entry.address) ? 2 : WIFI_ADAPTER.test(name) ? 0 : 1 })));
  found.sort((a, b) => a.rank - b.rank);
  return [...new Set(found.map((f) => f.address))];
}
