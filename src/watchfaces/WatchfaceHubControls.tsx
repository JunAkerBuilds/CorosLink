import {
  type ComponentType,
  type ReactNode,
  type RefObject,
  useEffect,
  useState
} from "react";
import { Search, X } from "lucide-react";

type HubIcon = ComponentType<{ size?: number; "aria-hidden"?: boolean | "true" }>;

/** The Faces website's filter bar: one glass panel of icon-led controls. */
export function HubToolbar({
  label,
  children
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="wf-hub-toolbar" role="search" aria-label={label}>
      {children}
    </div>
  );
}

export function HubSearchField({
  label,
  value,
  placeholder,
  onChange
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="wf-hub-control wf-hub-control--search">
      <span className="sr-only">{label}</span>
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button
          className="wf-hub-control-clear"
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => onChange("")}
        >
          <X size={14} aria-hidden="true" />
        </button>
      ) : null}
    </label>
  );
}

export function HubSelectField({
  label,
  icon: Icon,
  value,
  onChange,
  children
}: {
  label: string;
  icon: HubIcon;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="wf-hub-control">
      <span className="sr-only">{label}</span>
      <Icon size={16} aria-hidden="true" />
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {children}
      </select>
    </label>
  );
}

export interface HubChip<T extends string> {
  value: T;
  label: string;
  icon?: HubIcon;
  count?: number;
}

/** Pill shortcuts shown beside the results heading, like the gallery's quick filters. */
export function HubQuickFilters<T extends string>({
  label,
  chips,
  active,
  onChange
}: {
  label: string;
  chips: readonly HubChip<T>[];
  active: T;
  onChange: (value: T) => void;
}) {
  return (
    <nav className="wf-hub-chips-rail" aria-label={label}>
      {chips.map(({ value, label: chipLabel, icon: Icon, count }) => (
        <button
          key={value}
          type="button"
          className="wf-hub-filter-chip"
          aria-pressed={active === value}
          onClick={() => onChange(value)}
        >
          {Icon ? <Icon size={16} aria-hidden="true" /> : null}
          <span>{chipLabel}</span>
          {count !== undefined ? <small>{count}</small> : null}
        </button>
      ))}
    </nav>
  );
}

/** Hand-drawn underline shared with the Faces website's section headings. */
export function HubHeadingUnderline() {
  return (
    <svg className="wf-hub-underline" viewBox="0 0 180 12" preserveAspectRatio="none" aria-hidden="true">
      <path d="M4 8 C18 8 20 3 29 6 S46 6 60 6 S77 5 91 6 S109 4 120 6 S143 4 155 5 S169 5 176 5" />
    </svg>
  );
}

export function HubResultsHeading({
  id,
  icon: Icon,
  title,
  note,
  level = 2,
  children
}: {
  id: string;
  icon: HubIcon;
  title: string;
  note?: ReactNode;
  level?: 2 | 3;
  children?: ReactNode;
}) {
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <div className={`wf-hub-results-heading${level === 3 ? " is-group" : ""}`}>
      <div className="wf-hub-heading" aria-live={level === 2 ? "polite" : undefined}>
        <span className="wf-hub-emblem" aria-hidden="true">
          <span className="wf-hub-emblem-plate" />
          <Icon size={level === 2 ? 22 : 18} />
        </span>
        <Heading id={id}>
          {title}
          <HubHeadingUnderline />
        </Heading>
        {note ? <span className="wf-hub-results-note">{note}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** "Showing … · Clear filters" line under the heading when anything is filtered. */
export function HubFilterSummary({
  summary,
  onClear
}: {
  summary: string;
  onClear: () => void;
}) {
  return (
    <div className="wf-hub-filter-summary">
      <p>{summary}</p>
      <button type="button" className="wf-hub-text-link" onClick={onClear}>
        Clear filters <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/**
 * True once the element comes within `rootMargin` of its scrolling pane. It
 * stays true, so work started for a card is never cancelled by scrolling.
 */
export function useNearViewport(
  ref: RefObject<Element | null>,
  rootMargin = "320px 0px"
): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (near || !element) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    let root = element.parentElement;
    while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) {
      root = root.parentElement;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { root, rootMargin }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [near, ref, rootMargin]);
  return near;
}

/** Runs async jobs a few at a time; used for heavy thumbnail renders. */
export function createTaskQueue(concurrency: number) {
  let running = 0;
  const pending: Array<() => void> = [];
  const pump = () => {
    while (running < concurrency && pending.length > 0) {
      running += 1;
      pending.shift()!();
    }
  };
  return function enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      pending.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            running -= 1;
            pump();
          });
      });
      pump();
    });
  };
}

export function formatCachedAge(savedAt: string, now = Date.now()): string {
  const elapsed = now - Date.parse(savedAt);
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now";
  const minutes = Math.round(elapsed / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
