import { useEffect, useRef, useState } from "react";
import { Check, Star } from "lucide-react";
import {
  type PrimaryView,
  visiblePrimaryNavItems,
} from "../navigation/primaryNav";
import { getPrimaryViewLabel } from "../navigation/startupView";

interface StartupViewMenuProps {
  value: PrimaryView;
  onChange: (view: PrimaryView) => void;
  showDevelopmentItems?: boolean;
}

export function StartupViewMenu({
  value,
  onChange,
  showDevelopmentItems = false,
}: StartupViewMenuProps) {
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
    <div className="startup-view-menu" ref={containerRef}>
      <button
        className="update-settings-trigger startup-view-trigger"
        type="button"
        aria-label={`Startup view: ${activeLabel}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Startup view: ${activeLabel}`}
        onClick={() => setOpen((current) => !current)}
      >
        <Star size={16} aria-hidden="true" />
      </button>

      {open ? (
        <div className="startup-view-popover" role="menu">
          <p className="update-settings-heading">Startup view</p>
          <div className="startup-view-options">
            {visiblePrimaryNavItems(showDevelopmentItems).filter(
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
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="startup-view-option-label">{label}</span>
                  {beta ? <span className="startup-view-beta">Beta</span> : null}
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
