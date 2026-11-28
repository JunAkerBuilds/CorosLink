// Back and forward at the top of the sidebar, as in a browser: through the screens opened in this window, so a link
// that jumps into Settings, a sport or an activity can be undone without finding the way back in the menu. The mouse's
// back and forward buttons and the keyboard (⌘[ ⌘] on a Mac, Alt+← Alt+→ elsewhere) do the same.
import { useEffect } from "react";
import { t } from "@/lib/i18n";
import { historyKey } from "../historyKeys";
import { back, forward, useHistoryPlace } from "../router";
import "./historyArrows.css";

const MAC = navigator.userAgent.includes("Macintosh");

export function HistoryArrows() {
  const place = useHistoryPlace();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const go = historyKey(e, MAC);
      if (!go) return;
      e.preventDefault();
      if (go === "back") back(); else forward();
    };
    // Mouse buttons 4 and 5. Taken on mouseup, so the press doesn't also count as a click on what's under it.
    const onUp = (e: MouseEvent) => {
      if (e.button !== 3 && e.button !== 4) return;
      e.preventDefault();
      if (e.button === 3) back(); else forward();
    };
    const stop = (e: MouseEvent) => { if (e.button === 3 || e.button === 4) e.preventDefault(); };
    addEventListener("keydown", onKey);
    addEventListener("mouseup", onUp);
    addEventListener("mousedown", stop);
    return () => { removeEventListener("keydown", onKey); removeEventListener("mouseup", onUp); removeEventListener("mousedown", stop); };
  }, []);

  const backTip = `${t("Back")}  ${MAC ? "⌘[" : "Alt+←"}`;
  const forwardTip = `${t("Forward")}  ${MAC ? "⌘]" : "Alt+→"}`;
  return (
    <div className="rail-history">
      <button type="button" aria-label={t("Back")} data-tip={backTip} disabled={!place.back} onClick={back}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M15 6l-6 6l6 6" /></svg>
      </button>
      <button type="button" aria-label={t("Forward")} data-tip={forwardTip} disabled={!place.forward} onClick={forward}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 6l6 6l-6 6" /></svg>
      </button>
    </div>
  );
}
