import {
  Activity,
  LayoutGrid,
  Map as MapIcon,
  MessageCircle,
  Music,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type PrimaryView = "overview" | "media" | "training" | "maps" | "coach";

interface PrimaryTabConfig {
  id: PrimaryView;
  label: string;
  icon: LucideIcon;
  beta?: boolean;
  showActivity?: boolean;
}

const PRIMARY_TABS: PrimaryTabConfig[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "media", label: "Media", icon: Music },
  { id: "maps", label: "Maps", icon: MapIcon, beta: true },
  { id: "training", label: "Training Hub", icon: Activity },
  {
    id: "coach",
    label: "Coach",
    icon: MessageCircle,
    beta: true,
    showActivity: true,
  },
];

interface PrimaryTabsProps {
  activeView: PrimaryView;
  onChange: (view: PrimaryView) => void;
  coachBusy?: boolean;
}

export function PrimaryTabs({
  activeView,
  onChange,
  coachBusy = false,
}: PrimaryTabsProps) {
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
      {PRIMARY_TABS.map((tab) => {
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
          >
            <Icon size={16} aria-hidden="true" />
            {tab.label}
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
