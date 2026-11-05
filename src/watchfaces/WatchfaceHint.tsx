import { Info } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { t, useLanguage } from "../i18n/watchfaces";

/**
 * Help that used to be a paragraph between controls: an ⓘ button whose text
 * shows on hover, keyboard focus or a click, and hides on Escape or a click
 * elsewhere.
 */
export function WatchfaceHint({ children, label }: { children: ReactNode; label?: string }) {
  useLanguage();
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  useEffect(() => {
    if (!pinned) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !ref.current?.contains(event.target as Node)) setPinned(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinned]);
  return (
    <span ref={ref} className={`wf-hint${open ? " is-open" : ""}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button type="button" className="wf-hint-button" aria-label={label ?? t("More info")} aria-expanded={open} aria-describedby={open ? id : undefined}
        onFocus={() => setHovered(true)} onBlur={() => setHovered(false)} onClick={() => setPinned((value) => !value)}>
        <Info size={13} aria-hidden="true" />
      </button>
      <span id={id} role="tooltip" className="wf-hint-bubble" hidden={!open}>{children}</span>
    </span>
  );
}
