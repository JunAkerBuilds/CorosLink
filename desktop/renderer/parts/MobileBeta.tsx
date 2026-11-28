// The dashboard's header on the desktop: while no phone is paired to this computer, an invite to the C-LINK phone
// beta, on its page at coroslink.com (styled like that page's beta button). It shows nothing until the phones are read, and nothing once one is paired.
import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";

export const MOBILE_URL = "https://coroslink.com/mobile";

export function MobileBeta() {
  const [paired, setPaired] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/desktop/phones", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: { phones?: unknown[] }) => { if (live) setPaired((s.phones?.length ?? 0) > 0); }, () => {});
    return () => { live = false; };
  }, []);
  if (paired !== false) return null;
  return (
    <a className="mobile-beta" href={MOBILE_URL} target="_blank" rel="noreferrer" title={t("C-LINK for iPhone and Android, now in beta")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M10.5 18.5h3" />
      </svg>
      <span>{t("Try C-LINK Mobile beta")}</span>
      <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M7 17 17 7M9 7h8v8" /></svg>
    </a>
  );
}
