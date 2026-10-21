import { t, useLanguage } from "../i18n";
import { useEffect, useRef, useState } from "react";
import { Check, Star } from "lucide-react";
import {
  type PrimaryView,
  visiblePrimaryNavItems,
} from "../navigation/primaryNav";
import { getPrimaryViewLabel } from "../navigation/startupView";
import { useHiddenNavItems } from "../navigation/hiddenNav";

interface StartupViewMenuProps {
  value: PrimaryView;
  onChange: (view: PrimaryView) => void;
  showDevelopmentItems?: boolean;
  showLabel?: boolean;
}

export function StartupViewMenu({
  value,
  onChange,
  showDevelopmentItems = false,
  showLabel = false,
}: StartupViewMenuProps) {
  useLanguage();
  const hiddenNavItems = useHiddenNavItems();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeLabel = getPrimaryViewLabel(value);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        containerRef.current?.querySelector("button")?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div
      className="startup-view-menu"
      ref={containerRef}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="update-settings-trigger startup-view-trigger"
        type="button"
        aria-label={t("Startup view: {{value0}}", { value0: activeLabel })}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("Startup view: {{value0}}", { value0: activeLabel })}
        onClick={() => setOpen((current) => !current)}
      >
        <Star size={18} aria-hidden="true" />
        {showLabel ? <span>{t("Startup view")}</span> : null}
      </button>

      {open ? (
        <div className="startup-view-popover" role="menu">
          <p className="update-settings-heading">{t("Startup view")}</p>
          <div className="startup-view-options">
            {visiblePrimaryNavItems(showDevelopmentItems, hiddenNavItems).filter(
              (item) => !item.excludeFromStartup,
            ).map(({ id, label, icon: Icon, beta }) => {
              const active = id === value;

              return (
                <button
                  key={id}
                  className={`startup-view-option${active ? " is-active" : ""}`}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                    containerRef.current?.querySelector("button")?.focus();
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="startup-view-option-label">{t(label)}</span>
                  {beta ? <span className="startup-view-beta">{t("Beta")}</span> : null}
                  {active ? (
                    <Check
                      className="startup-view-check"
                      size={14}
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
