import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Bug,
  Code2,
  Coffee,
  ExternalLink,
  Globe2,
  HelpCircle,
  LifeBuoy,
  Map as MapIcon,
  MapPin,
  Newspaper,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface ResourceLink {
  label: string;
  href: string;
  icon: LucideIcon;
}

interface ResourceGroup {
  heading: string;
  links: ResourceLink[];
}

// Curated from GitHub issues #7 (CorosLink links) and #8 (COROS resources).
const LINK_GROUPS: ResourceGroup[] = [
  {
    heading: "CorosLink",
    links: [
      {
        label: "Website",
        href: "https://coroslink.com/",
        icon: Globe2,
      },
      {
        label: "Source on GitHub",
        href: "https://github.com/JunAkerBuilds/CorosLink",
        icon: Code2,
      },
      {
        label: "Report an issue",
        href: "https://github.com/JunAkerBuilds/CorosLink/issues",
        icon: Bug,
      },
      {
        label: "Support the project",
        href: "https://www.buymeacoffee.com/addridoa",
        icon: Coffee,
      },
    ],
  },
  {
    heading: "COROS",
    links: [
      {
        label: "Getting started",
        href: "https://support.coros.com/hc/en-us/articles/38104668854676-Getting-Started",
        icon: BookOpen,
      },
      {
        label: "Release notes",
        href: "https://support.coros.com/hc/en-us/sections/20082056631700-Release-Notes-for-COROS-Devices",
        icon: Newspaper,
      },
      {
        label: "Download maps",
        href: "https://us.coros.com/maps",
        icon: MapIcon,
      },
      {
        label: "Offline maps guide",
        href: "https://support.coros.com/hc/en-us/articles/4405711354900-Downloading-Maps-to-Your-COROS-Watch",
        icon: MapPin,
      },
      {
        label: "Help & support",
        href: "https://support.coros.com/hc/en-us",
        icon: LifeBuoy,
      },
    ],
  },
];

export function ResourcesMenu({ showLabel = false }: { showLabel?: boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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
      className="resources-menu"
      ref={containerRef}
      onBlur={(event) => {
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        className="update-settings-trigger resources-menu-trigger"
        type="button"
        aria-label="Help & links"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Help & links"
        onClick={() => setOpen((value) => !value)}
      >
        <HelpCircle size={18} aria-hidden="true" />
        {showLabel ? <span>Help & links</span> : null}
      </button>

      {open ? (
        <div className="resources-popover" role="menu">
          {LINK_GROUPS.map((group) => (
            <div className="resources-group" key={group.heading}>
              <p className="update-settings-heading">{group.heading}</p>
              {group.links.map(({ label, href, icon: Icon }) => (
                <a
                  key={href}
                  className="resources-link"
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    containerRef.current?.querySelector("button")?.focus();
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  <span className="resources-link-label">{label}</span>
                  <ExternalLink
                    size={13}
                    aria-hidden="true"
                    className="resources-link-external"
                  />
                </a>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
