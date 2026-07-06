import { PanelLeft, PanelLeftClose } from "lucide-react";
import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  PRIMARY_NAV_ITEMS,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_EXPANDED_WIDTH,
  type PrimaryView,
} from "../navigation/primaryNav";

const SIDEBAR_COLLAPSED_KEY = "coroslink.sidebarCollapsed";

const widthSpring = {
  type: "spring" as const,
  stiffness: 420,
  damping: 28,
  mass: 0.8,
};

const labelSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 36,
  mass: 0.7,
};

const overlaySpring = {
  type: "spring" as const,
  stiffness: 380,
  damping: 34,
  mass: 0.85,
};

const overlayCloseSpring = {
  type: "spring" as const,
  stiffness: 520,
  damping: 42,
  mass: 0.75,
};

function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    // Ignore storage failures in restricted environments.
  }
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

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setReduced(media.matches);

    handleChange();
    media.addEventListener("change", handleChange);

    return () => media.removeEventListener("change", handleChange);
  }, []);

  return reduced;
}

export interface AppSidebarProps {
  activeView: PrimaryView;
  onChange: (view: PrimaryView) => void;
  coachBusy?: boolean;
  appLogo: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  overlayOpen: boolean;
  onOverlayOpenChange: (open: boolean) => void;
}

export function AppSidebar({
  activeView,
  onChange,
  coachBusy = false,
  appLogo,
  expanded,
  onExpandedChange,
  overlayOpen,
  onOverlayOpenChange,
}: AppSidebarProps) {
  const overlayMode = useMediaQuery("(max-width: 720px)");
  const reducedMotion = useReducedMotion();
  const navRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<PrimaryView, HTMLButtonElement>());
  const [indicator, setIndicator] = useState({
    top: 0,
    height: 0,
    ready: false,
  });

  const isOpen = overlayMode ? overlayOpen : true;
  const showLabels = overlayMode ? true : expanded;
  const shellWidth = overlayMode
    ? 0
    : expanded
      ? SIDEBAR_EXPANDED_WIDTH
      : SIDEBAR_COLLAPSED_WIDTH;

  const updateIndicator = useCallback(() => {
    const nav = navRef.current;
    const activeItem = itemRefs.current.get(activeView);
    if (!nav || !activeItem || !isOpen) {
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const itemRect = activeItem.getBoundingClientRect();

    setIndicator({
      top: itemRect.top - navRect.top,
      height: itemRect.height,
      ready: true,
    });
  }, [activeView, coachBusy, expanded, isOpen, overlayMode]);

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
    for (const item of itemRefs.current.values()) {
      observer.observe(item);
    }

    window.addEventListener("resize", updateIndicator);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateIndicator);
    };
  }, [updateIndicator]);

  useEffect(() => {
    if (!overlayMode || !overlayOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOverlayOpenChange(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [overlayMode, overlayOpen, onOverlayOpenChange]);

  const handleSelect = (view: PrimaryView) => {
    onChange(view);
    if (overlayMode) {
      onOverlayOpenChange(false);
    }
  };

  const handleToggleExpanded = () => {
    const nextExpanded = !expanded;
    onExpandedChange(nextExpanded);
    writeSidebarCollapsed(!nextExpanded);
  };

  const widthTransition = reducedMotion
    ? { duration: 0.01 }
    : widthSpring;
  const labelTransition = reducedMotion
    ? { duration: 0.01 }
    : labelSpring;

  const sidebarPanel = (
    <motion.aside
      className={[
        "app-sidebar",
        overlayMode ? "is-overlay" : "",
        !overlayMode && !expanded ? "is-collapsed" : "",
        isOpen ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden={!isOpen}
      initial={false}
      animate={
        overlayMode
          ? {
              x: overlayOpen ? 0 : "-110%",
              opacity: overlayOpen ? 1 : 0,
            }
          : { x: 0, opacity: 1 }
      }
      transition={
        overlayMode
          ? reducedMotion
            ? { duration: 0.01 }
            : overlayOpen
              ? overlaySpring
              : overlayCloseSpring
          : undefined
      }
    >
      <div className="app-sidebar-inner">
        <div className="app-sidebar-brand">
          <div className="brand-mark">
            <img src={appLogo} alt="" aria-hidden="true" />
          </div>
          <motion.div
            className={[
              "app-sidebar-brand-copy",
              showLabels ? "" : "is-hidden",
            ]
              .filter(Boolean)
              .join(" ")}
            initial={false}
            animate={{
              opacity: showLabels ? 1 : 0,
              x: showLabels ? 0 : -8,
            }}
            transition={labelTransition}
            aria-hidden={!showLabels}
          >
            <strong>CorosLink</strong>
          </motion.div>
        </div>

        <nav
          className="app-sidebar-nav"
          aria-label="Primary"
          ref={navRef}
        >
          <span
            className="app-sidebar-indicator"
            aria-hidden="true"
            style={{
              height: `${indicator.height}px`,
              transform: `translateY(${indicator.top}px)`,
              opacity: indicator.ready ? 1 : 0,
            }}
          />
          {PRIMARY_NAV_ITEMS.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeView === item.id;
            const tooltip = item.beta
              ? `${item.label} (Beta)`
              : item.label;

            return (
              <button
                key={item.id}
                type="button"
                className={[
                  "app-sidebar-nav-item",
                  isActive ? "active" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                aria-current={isActive ? "page" : undefined}
                title={!showLabels ? tooltip : undefined}
                ref={(element) => {
                  if (element) {
                    itemRefs.current.set(item.id, element);
                  } else {
                    itemRefs.current.delete(item.id);
                  }
                }}
                onClick={() => handleSelect(item.id)}
              >
                <span className="app-sidebar-nav-icon">
                  <Icon size={18} aria-hidden="true" />
                  {item.showActivity && coachBusy ? (
                    <span
                      className="primary-tab-activity app-sidebar-nav-activity"
                      aria-label="Coach is responding"
                    />
                  ) : null}
                </span>
                <motion.span
                  className={[
                    "app-sidebar-nav-copy",
                    showLabels ? "" : "is-hidden",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  initial={false}
                  animate={{
                    opacity: showLabels ? 1 : 0,
                    x: showLabels ? 0 : -6,
                  }}
                  transition={{
                    ...labelTransition,
                    delay: reducedMotion || !showLabels ? 0 : index * 0.025,
                  }}
                  aria-hidden={!showLabels}
                >
                  <span className="app-sidebar-nav-label">{item.label}</span>
                  {item.beta ? (
                    <span className="primary-tab-beta">Beta</span>
                  ) : null}
                </motion.span>
              </button>
            );
          })}
        </nav>

        {!overlayMode ? (
          <div className="app-sidebar-footer">
            <button
              type="button"
              className="app-sidebar-toggle"
              aria-expanded={expanded}
              aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
              title={expanded ? "Collapse sidebar" : "Expand sidebar"}
              onClick={handleToggleExpanded}
            >
              {expanded ? (
                <PanelLeftClose size={18} aria-hidden="true" />
              ) : (
                <PanelLeft size={18} aria-hidden="true" />
              )}
              <motion.span
                className={[
                  "app-sidebar-toggle-label",
                  showLabels ? "" : "is-hidden",
                ]
                  .filter(Boolean)
                  .join(" ")}
                initial={false}
                animate={{
                  opacity: showLabels ? 1 : 0,
                  x: showLabels ? 0 : -6,
                }}
                transition={labelTransition}
                aria-hidden={!showLabels}
              >
                Collapse
              </motion.span>
            </button>
          </div>
        ) : null}
      </div>
    </motion.aside>
  );

  return (
    <>
      {overlayMode ? (
        <button
          type="button"
          className={[
            "app-sidebar-overlay",
            overlayOpen ? "is-visible" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          aria-label="Close navigation"
          aria-hidden={!overlayOpen}
          tabIndex={overlayOpen ? 0 : -1}
          onClick={() => onOverlayOpenChange(false)}
        />
      ) : null}

      {overlayMode ? (
        <div className="app-sidebar-shell is-overlay-mode">{sidebarPanel}</div>
      ) : (
        <motion.div
          className="app-sidebar-shell"
          initial={false}
          animate={{ width: shellWidth }}
          transition={widthTransition}
          style={{ minWidth: 0, overflow: "hidden" }}
        >
          {sidebarPanel}
        </motion.div>
      )}
    </>
  );
}

export function createInitialSidebarExpanded(): boolean {
  return !readSidebarCollapsed();
}
