import { describe, expect, it } from "vitest";
import { addRuleLine, elevatedCommand, firewallState, FIREWALL_RULE } from "./firewall";

describe("Windows Firewall rule for phones", () => {
  it("allows only this app, inbound TCP, on private and domain networks", () => {
    expect(addRuleLine("C:\\Program Files\\C-LINK\\C-LINK.exe")).toBe(
      `advfirewall firewall add rule name=${FIREWALL_RULE} dir=in action=allow program="C:\\Program Files\\C-LINK\\C-LINK.exe" protocol=TCP profile=private,domain enable=yes`,
    );
  });

  it("runs netsh elevated, with a ' in the install path kept literal", () => {
    const command = elevatedCommand("C:\\Users\\O'Neil\\AppData\\Local\\Programs\\C-LINK\\C-LINK.exe");
    expect(command).toContain("-Verb RunAs");
    expect(command).toContain(`program="C:\\Users\\O''Neil\\AppData`);
    expect(command.endsWith("exit $p.ExitCode")).toBe(true);
  });

  it("says nothing off Windows", async () => {
    if (process.platform !== "win32") expect(await firewallState()).toBeNull();
  });
});
