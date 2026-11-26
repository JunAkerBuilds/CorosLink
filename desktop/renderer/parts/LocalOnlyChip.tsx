// The sidebar's "Local mode" chip while the watch syncs with this computer and nothing is uploaded to COROS;
// it opens Settings → Privacy & local data.
import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { dataMode, readSettings } from "../settings";

export function LocalOnlyChip() {
  const mode = useSyncExternalStore(dataMode.subscribe, dataMode.get);
  useEffect(() => { if (dataMode.get() === null) readSettings().catch(() => undefined); }, []);
  if (mode !== "localOnly") return null;
  return (
    <Link href="/settings/privacy" className="lo-chip" aria-label={t("Local mode is on")}>
      <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 6h16v10H4zM2 19h20" /></svg>
      <span className="rail-label">{t("Local mode")}</span>
    </Link>
  );
}
