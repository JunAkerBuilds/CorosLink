import { PanelLeft, RotateCcw } from "lucide-react";
import { forwardRef } from "react";
import { t, useLanguage } from "../i18n";
import {
  canHideNavItem,
  setNavItemHidden,
  showAllNavItems,
  useHiddenNavItems,
} from "../navigation/hiddenNav";
import { visiblePrimaryNavItems } from "../navigation/primaryNav";
import "./sidebarSettings.css";

interface SidebarSettingsProps {
  showDevelopmentItems?: boolean;
}

export const SidebarSettings = forwardRef<HTMLDivElement, SidebarSettingsProps>(
  function SidebarSettings({ showDevelopmentItems = false }, ref) {
    useLanguage();
    const hiddenNavItems = useHiddenNavItems();
    const items = visiblePrimaryNavItems(showDevelopmentItems);
    const hiddenCount = items.filter((item) => hiddenNavItems.has(item.id)).length;

    return (
      <div className="panel settings-sidebar-panel" id="settings-sidebar" ref={ref}>
        <div className="settings-sidebar-heading">
          <div className="settings-units-heading">
            <span className="settings-units-icon" aria-hidden="true">
              <PanelLeft size={22} strokeWidth={1.9} />
            </span>
            <div>
              <p className="eyebrow">{t("Navigation")}</p>
              <h2>{t("Sidebar")}</h2>
              <p>
                {t("Hide the features you don't use. Nothing is removed, and you can bring them back here or by right-clicking the sidebar.")}
              </p>
            </div>
          </div>
          {hiddenCount > 0 ? (
            <button className="secondary-button" type="button" onClick={showAllNavItems}>
              <RotateCcw size={15} aria-hidden="true" />
              {t("Show all")}
            </button>
          ) : null}
        </div>

        <ul className="settings-sidebar-list">
          {items.map((item) => {
            const Icon = item.icon;
            const hideable = canHideNavItem(item.id);
            const visible = !hiddenNavItems.has(item.id);
            const label = t(item.label);

            return (
              <li key={item.id}>
                <label
                  className={[
                    "settings-sidebar-row",
                    visible ? "" : "is-hidden",
                    hideable ? "" : "is-locked",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <span className="settings-sidebar-icon" aria-hidden="true">
                    <Icon size={18} />
                  </span>
                  <span className="settings-sidebar-label">
                    {label}
                    {item.beta ? (
                      <span className="settings-sidebar-beta">{t("Beta")}</span>
                    ) : null}
                  </span>
                  {hideable ? null : (
                    <span className="settings-sidebar-note">{t("Always shown")}</span>
                  )}
                  <input
                    type="checkbox"
                    role="switch"
                    checked={visible}
                    disabled={!hideable}
                    aria-label={t("Show {{value0}} in the sidebar", { value0: label })}
                    onChange={(event) => setNavItemHidden(item.id, !event.target.checked)}
                  />
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  },
);
