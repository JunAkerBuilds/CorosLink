import { ClipboardPaste, Copy, CopyPlus } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./calendarContextMenu.css";

export interface CalendarContextMenuItem {
  id: string;
  label: string;
  icon: "copy" | "copy-day" | "paste";
  shortcut?: string;
  disabled?: boolean;
  hint?: string;
  onSelect: () => void;
}

const ICONS = {
  copy: Copy,
  "copy-day": CopyPlus,
  paste: ClipboardPaste
} as const;

export const MOD_KEY_LABEL =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform)
    ? "⌘"
    : "Ctrl+";

export function CalendarContextMenu({
  x,
  y,
  title,
  items,
  onClose
}: {
  x: number;
  y: number;
  title: string;
  items: CalendarContextMenuItem[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen when it opens near the right or bottom edge.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8))
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) {
        return;
      }
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
      );
      if (!buttons.length) return;
      event.preventDefault();
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      buttons[(current + step + buttons.length) % buttons.length]?.focus();
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("contextmenu", close, true);
    window.addEventListener("wheel", onClose, { passive: true });
    window.addEventListener("resize", onClose);
    window.addEventListener("blur", onClose);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("contextmenu", close, true);
      window.removeEventListener("wheel", onClose);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("blur", onClose);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={menuRef}
      className="calendar-context-menu"
      role="menu"
      aria-label={title}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      <p className="calendar-context-menu-title">{title}</p>
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        return (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="calendar-context-menu-item"
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
          >
            <Icon size={14} aria-hidden="true" />
            <span className="calendar-context-menu-label">{item.label}</span>
            {item.shortcut ? (
              <kbd className="calendar-context-menu-shortcut">{item.shortcut}</kbd>
            ) : null}
          </button>
        );
      })}
    </div>,
    document.body
  );
}
