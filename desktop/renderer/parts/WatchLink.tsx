// Watch's "Connected by USB" line while the watch is plugged into this computer as a drive (main: media/watchDrive.ts).
import { useEffect, useState } from "react";
import { readMedia } from "../media";
import { tr } from "@/lib/i18n/react";
import { t } from "@/lib/i18n";

export function WatchLink() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let live = true;
    const read = () => readMedia().then((s) => { if (live) setOn(s.watch.connected); }, () => { if (live) setOn(false); });
    void read();
    const timer = setInterval(read, 3000);
    return () => { live = false; clearInterval(timer); };
  }, []);
  if (!on) return null;
  return (
    <span className="wa-link" role="status">
      <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 2v5M15 2v5M6 7h12v4a6 6 0 0 1-12 0zM12 17v5" /></svg>
      {tr("{connected} by USB", { connected: <b>{t("Connected")}</b> })}
    </span>
  );
}
