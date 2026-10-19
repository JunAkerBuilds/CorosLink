import { t, useLanguage } from "../i18n";
import { Eye, EyeSlash, SlidersHorizontal } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PrimaryNavItem } from "../navigation/primaryNav";
import "./sidebarNavMenu.css";

export interface SidebarNavMenuProps {
  x: number;
  y: number;
  /** The item that was right-clicked, if any. */
  target: PrimaryNavItem | null;
  targetHideable: boolean;
  hiddenItems: PrimaryNavItem[];
  onHide: (item: PrimaryNavItem) => void;
  onShow: (item: PrimaryNavItem) => void;
  onCustomize: () => void;
  onClose: () => void;
}

export function SidebarNavMenu({
  x,
  y,
  target,
  targetHideable,
  hiddenItems,
  onHide,
  onShow,
  onCustomize,
  onClose,
}: SidebarNavMenuProps) {
  useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  // Keep the menu on screen when it opens near the bottom of the sidebar.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
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
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
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

  const select = (action: () => void) => {
    onClose();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="sidebar-nav-menu"
      role="menu"
      aria-label={t("Sidebar")}
      style={position}
      onContextMenu={(event) => event.preventDefault()}
    >
      {target ? (
        <button
          type="button"
          role="menuitem"
          className="sidebar-nav-menu-item"
          disabled={!targetHideable}
          title={targetHideable ? undefined : t("Overview and Settings always stay in the sidebar.")}
          onClick={() => select(() => onHide(target))}
        >
          <EyeSlash size={15} aria-hidden="true" />
          <span className="sidebar-nav-menu-label">
            {t("Hide {{value0}}", { value0: t(target.label) })}
          </span>
        </button>
      ) : null}

      {hiddenItems.length > 0 ? (
        <>
          {target ? <hr className="sidebar-nav-menu-separator" /> : null}
          <p className="sidebar-nav-menu-heading">{t("Hidden")}</p>
          {hiddenItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="sidebar-nav-menu-item"
                aria-label={t("Show {{value0}}", { value0: t(item.label) })}
                onClick={() => select(() => onShow(item))}
              >
                <Icon size={15} aria-hidden="true" />
                <span className="sidebar-nav-menu-label">{t(item.label)}</span>
                <span className="sidebar-nav-menu-hint" aria-hidden="true">
                  <Eye size={13} />
                  {t("Show")}
                </span>
              </button>
            );
          })}
        </>
      ) : null}

      {target || hiddenItems.length > 0 ? (
        <hr className="sidebar-nav-menu-separator" />
      ) : null}
      <button
        type="button"
        role="menuitem"
        className="sidebar-nav-menu-item"
        onClick={() => select(onCustomize)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" />
        <span className="sidebar-nav-menu-label">{t("Customize sidebar…")}</span>
      </button>
    </div>,
    document.body,
  );
}
