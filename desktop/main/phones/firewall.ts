// Windows Firewall and the phone server. Windows asks once, the first time C-LINK listens, and only for the network
// type the PC is on then; a "Cancel" or a Wi-Fi marked Public leaves phones timing out with nothing on the computer
// to say why. The installer adds this rule when it runs as admin (build/installer.nsh on the release branch); for a
// per-user install, "Allow" in Remote access adds it behind a UAC prompt. Private and domain networks only: on a
// Public one (a café) phones stay blocked, and the note says to mark home Wi-Fi Private.
import { execFile } from "node:child_process";

/** The rule's name, as the installer writes it too. No spaces, so it passes through netsh and PowerShell unquoted. */
export const FIREWALL_RULE = "C-LINK-phones";

export type FirewallState = "allowed" | "missing" | null;

/** The netsh command line that adds the rule for `program`. */
export function addRuleLine(program: string): string {
  return `advfirewall firewall add rule name=${FIREWALL_RULE} dir=in action=allow program="${program}" protocol=TCP profile=private,domain enable=yes`;
}

/** PowerShell that runs that as admin (one UAC prompt) and exits with netsh's code, or non-zero when it's declined. */
export function elevatedCommand(program: string): string {
  // Single-quoted PowerShell strings take everything literally except ', which doubles.
  const line = addRuleLine(program).replace(/'/g, "''");
  return `$p = Start-Process -FilePath netsh -ArgumentList '${line}' -Verb RunAs -WindowStyle Hidden -Wait -PassThru; exit $p.ExitCode`;
}

const run = (file: string, args: string[]) => new Promise<number>((resolve) => {
  execFile(file, args, { windowsHide: true, timeout: 120_000 }, (error) => resolve(error ? (typeof error.code === "number" ? error.code : 1) : 0));
});

/** Whether the rule is there: null off Windows, where nothing needs it. netsh can read rules without admin. */
export async function firewallState(): Promise<FirewallState> {
  if (process.platform !== "win32") return null;
  return (await run("netsh", ["advfirewall", "firewall", "show", "rule", `name=${FIREWALL_RULE}`])) === 0 ? "allowed" : "missing";
}

/** Adds the rule for this app behind a UAC prompt. Resolves to the state afterwards ("missing" if declined). */
export async function allowThroughFirewall(): Promise<FirewallState> {
  if (process.platform !== "win32") return null;
  if ((await firewallState()) === "allowed") return "allowed";
  await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", elevatedCommand(process.execPath)]);
  return firewallState();
}
