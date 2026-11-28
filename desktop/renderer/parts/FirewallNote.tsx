// While pairing on Windows: when Windows Firewall has no rule for C-LINK, phones time out with nothing here to say
// why. One button adds the rule behind a UAC prompt (desktop/main/phones/firewall.ts).
import { useState } from "react";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import "./firewallNote.css";

export type FirewallState = "allowed" | "missing" | null | undefined;

export function FirewallNote({ state }: { state: FirewallState }) {
  const [now, setNow] = useState<FirewallState>(undefined);
  const [asking, setAsking] = useState(false);
  const shown = now ?? state;
  if (shown !== "missing") return null;
  const allow = () => {
    setAsking(true);
    fetch("/api/desktop/phones/firewall", { method: "POST", cache: "no-store" })
      .then((r) => r.json() as Promise<{ firewall: FirewallState }>)
      .then((r) => setNow(r.firewall), () => {})
      .finally(() => setAsking(false));
  };
  return (
    <div className="notice fw-note" role="note">
      <span>{t("Windows Firewall may block your phone. Allow C-LINK, and set this Wi-Fi to Private in Windows settings.")}</span>
      <Button onClick={allow} disabled={asking}>{asking ? t("Waiting for Windows…") : t("Allow")}</Button>
    </div>
  );
}
