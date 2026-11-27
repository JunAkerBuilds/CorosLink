// What's new: a sheet over the app, a page per new feature (with Try it), then the fixes (whatsNew.ts). Skip or Esc
// closes it; ← and → turn the pages. Loaded only when it shows (App.tsx).
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui";
import { t } from "@/lib/i18n";
import { navigate } from "../router";
import { FEATURES, FIXES, ICON, type Feature } from "../whatsNew";
import "./whatsNew.css";

type Page = Feature | "fixes";

function Icon({ d, size = 20 }: { d: string; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
}

/** The page's picture: its icon on a tinted band, and for units the same run in both. */
function Hero({ page }: { page: Page }) {
  const icon = page === "fixes" ? ICON.wrench : page.icon;
  const tint = page === "fixes" ? "amber" : page.tint;
  return (
    <div className="wn-hero" data-tint={tint} aria-hidden="true">
      <span className="wn-ring" /><span className="wn-ring" data-b="" />
      <span className="wn-hero-icon"><Icon d={icon} size={38} /></span>
      {page !== "fixes" && page.id === "units" ? (
        <span className="wn-swap">
          <span><b>10.00</b> km</span><span className="wn-arrow"><Icon d={ICON.swap} size={16} /></span><span><b>6.21</b> mi</span>
        </span>
      ) : null}
    </div>
  );
}

export default function WhatsNew({ onClose }: { onClose: () => void }) {
  const pages: Page[] = [...FEATURES, ...(FIXES.length ? (["fixes"] as const) : [])];
  const [at, setAt] = useState(0);
  const page = pages[at];
  const last = at === pages.length - 1;
  const primary = useRef<HTMLButtonElement>(null);

  // The main button takes the keys on every page, so Return moves on.
  useEffect(() => { primary.current?.focus(); }, [at]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight") setAt((n) => Math.min(pages.length - 1, n + 1));
      else if (e.key === "ArrowLeft") setAt((n) => Math.max(0, n - 1));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onClose, pages.length]);

  const tryIt = (f: Feature) => { onClose(); navigate(f.open); };

  return createPortal(
    <div className="wn-scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="wn" role="dialog" aria-modal="true" aria-labelledby="wn-title">
        <header className="wn-top">
          <span className="wn-eyebrow">{t("What's new")}</span>
          {!last ? <button type="button" className="wn-skip" onClick={onClose}>{t("Skip")}</button> : null}
        </header>
        {/* Keyed, so each page's entrance plays. */}
        <div className="wn-page" key={at}>
          <Hero page={page} />
          <div className="wn-copy">
            {page !== "fixes" && page.beta ? <span className="wn-beta">{t("Beta")}</span> : null}
            <h2 id="wn-title">{page === "fixes" ? t("Fixes") : t(page.title)}</h2>
            <p>{page === "fixes" ? t("Smaller things that work better now.") : t(page.detail)}</p>
          </div>
          {page === "fixes" ? (
            <ul className="wn-fixes">{FIXES.map((f) => <li key={f}><Icon d={ICON.tick} size={16} />{t(f)}</li>)}</ul>
          ) : (
            <ul className="wn-points">{page.points.map((p) => <li key={p.text}><span className="wn-point-icon"><Icon d={p.icon} size={18} /></span>{t(p.text)}</li>)}</ul>
          )}
        </div>
        <footer className="wn-bottom">
          <div className="wn-dots" role="tablist" aria-label={t("What's new")}>
            {pages.map((p, k) => (
              <button key={k} type="button" role="tab" aria-selected={k === at} aria-label={t("Page {n} of {total}", { n: k + 1, total: pages.length })}
                data-on={k === at ? "" : undefined} onClick={() => setAt(k)} />
            ))}
          </div>
          <div className="wn-actions">
            {page !== "fixes" ? <Button onClick={() => tryIt(page)}>{t("Try it")}</Button> : null}
            <Button ref={primary} variant="primary" onClick={() => (last ? onClose() : setAt(at + 1))}>{last ? t("Got it") : t("Next")}</Button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
