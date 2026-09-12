import { useEffect, useRef, useState, type ReactNode } from "react";
import { Ellipsis } from "lucide-react";

export function ToolbarMoreMenu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    panelRef.current?.querySelector<HTMLElement>("button, a[href]")?.focus();

    function dismissOutside(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }

    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [open]);

  return (
    <div
      className="toolbar-more"
      ref={containerRef}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="icon-button toolbar-more-trigger"
        type="button"
        ref={triggerRef}
        aria-label="More toolbar options"
        aria-expanded={open}
        aria-controls="toolbar-more-panel"
        title="More options"
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis size={18} aria-hidden="true" />
      </button>
      {open ? (
        <div
          className="toolbar-more-panel"
          id="toolbar-more-panel"
          ref={panelRef}
          role="region"
          aria-label="Toolbar options"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
