import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  PRIMARY_NAV_ITEMS,
  type PrimaryView,
} from "../navigation/primaryNav";
import { SelectDropdown } from "./SelectDropdown";

export type { PrimaryView } from "../navigation/primaryNav";

interface PrimaryTabsProps {
  activeView: PrimaryView;
  onChange: (view: PrimaryView) => void;
  coachBusy?: boolean;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const media = window.matchMedia(query);
    const handleChange = () => setMatches(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, [query]);

  return matches;
}

export function PrimaryTabs({
  activeView,
  onChange,
  coachBusy = false,
}: PrimaryTabsProps) {
  const compactNav = useMediaQuery("(max-width: 720px)");
  const navRef = useRef<HTMLElement>(null);
  const tabRefs = useRef(new Map<PrimaryView, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
    ready: false,
  });

  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeTab = tabRefs.current.get(activeView);
    if (!nav || !activeTab) {
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const tabRect = activeTab.getBoundingClientRect();

    setIndicator({
      left: tabRect.left - navRect.left,
      top: tabRect.top - navRect.top,
      width: tabRect.width,
      height: tabRect.height,
      ready: true,
    });
  }, [activeView, coachBusy]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) {
      return;
    }

    const observer = new ResizeObserver(() => updateIndicator());
    observer.observe(nav);
    for (const tab of tabRefs.current.values()) {
      observer.observe(tab);
    }

    window.addEventListener("resize", updateIndicator);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  if (compactNav) {
    return (
      <SelectDropdown
        value={activeView}
        options={PRIMARY_NAV_ITEMS.map((tab) => ({
          value: tab.id,
          label: tab.beta ? `${tab.label} (Beta)` : tab.label,
        }))}
        onChange={onChange}
        label="Section"
        className="app-select--nav primary-tabs-select"
      />
    );
  }

  return (
    <nav className="primary-tabs" aria-label="Primary" ref={navRef}>
      <span
        className="primary-tabs-indicator"
        aria-hidden="true"
        style={{
          width: `${indicator.width}px`,
          height: `${indicator.height}px`,
          transform: `translate(${indicator.left}px, ${indicator.top}px)`,
          opacity: indicator.ready ? 1 : 0,
        }}
      />
      {PRIMARY_NAV_ITEMS.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeView === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            className={isActive ? "primary-tab active" : "primary-tab"}
            aria-current={isActive ? "page" : undefined}
            ref={(element) => {
              if (element) {
                tabRefs.current.set(tab.id, element);
              } else {
                tabRefs.current.delete(tab.id);
              }
            }}
            onClick={() => onChange(tab.id)}
            title={tab.beta ? `${tab.label} (Beta)` : tab.label}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="primary-tab-label">{tab.label}</span>
            {tab.showActivity && coachBusy ? (
              <span
                className="primary-tab-activity"
                aria-label="Coach is responding"
              />
            ) : null}
            {tab.beta ? <span className="primary-tab-beta">Beta</span> : null}
          </button>
        );
      })}
    </nav>
  );
}
