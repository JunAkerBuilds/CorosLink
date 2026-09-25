import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Activity, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, Circle, CloudSun, Image, Minus, MoonStar, Plus, Search, Sparkles, Square, TrendingUp, Type, X } from "lucide-react";
import type { CorosWatchfaceBackgroundElement, CorosWatchfaceDesignState } from "../../electron/types";
import { NATIVE_CHART_SOURCES, NATIVE_DATA_FIELDS } from "../../electron/watchfaceNativeCatalog";

const categories = ["All", "Calendar", "Weather", "Health", "Training", "Astronomy", "Charts"] as const;
type Category = typeof categories[number];
const categoryIcons = { Calendar: CalendarDays, Weather: CloudSun, Health: Activity, Training: TrendingUp, Astronomy: MoonStar, Charts: ChartNoAxesCombined };
const dataOptions = [
  ...NATIVE_DATA_FIELDS.filter(field => field.kind !== "chart").map(field => ({ id: field.id, label: field.label, category: field.category, keywords: field.id, availability: field.availability })),
  ...NATIVE_CHART_SOURCES.map(source => ({ id: `chart:${source.id}`, label: source.label, category: "Charts" as const, keywords: `${source.id} ${source.category}`, availability: undefined }))
];

/** Firmware time digits the template lacks, which Studio can synthesize. */
export interface WatchfaceAddTimeOption {
  id: string;
  label: string;
  added: boolean;
  onAdd: () => void;
}

export function WatchfaceAddMenu({ design, imageDisabled, onAddImage, onAddOfficialImage, onAddElement, onAddData, timeOptions = [] }: {
  design: CorosWatchfaceDesignState;
  imageDisabled: boolean;
  onAddImage: () => void;
  /** Opens the official COROS asset browser instead of a file dialog. */
  onAddOfficialImage?: () => void;
  onAddElement: (kind: CorosWatchfaceBackgroundElement["kind"]) => void;
  onAddData: (id: string) => void;
  timeOptions?: WatchfaceAddTimeOption[];
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const tabs = useRef<HTMLDivElement>(null);
  const results = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("All");
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320, maxHeight: 580 });
  const place = useCallback(() => {
    const button = trigger.current;
    if (!button) return;
    const anchor = button.getBoundingClientRect();
    const pane = button.closest(".wf-layers-pane")?.getBoundingClientRect();
    const width = Math.min(320, window.innerWidth - 24);
    const below = window.innerHeight - anchor.bottom - 20;
    const above = anchor.top - 20;
    const upwards = below < 300 && above > below;
    const availableHeight = upwards ? above : below;
    const maxHeight = category === "All" ? availableHeight : Math.min(580, availableHeight);
    const next = {
      width, maxHeight,
      top: upwards ? Math.max(12, anchor.top - maxHeight - 8) : anchor.bottom + 8,
      left: Math.max(12, Math.min(pane ? pane.left + 10 : anchor.left, window.innerWidth - width - 12))
    };
    setPosition(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
  }, [category]);
  useEffect(() => { if (open) search.current?.focus(); }, [open]);
  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) place(); };
    window.addEventListener("resize", place);
    window.addEventListener("scroll", onScroll, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", onScroll, true); };
  }, [open, place]);
  useEffect(() => { results.current?.scrollTo({ top: 0 }); }, [query, category]);
  useEffect(() => {
    if (!open) return;
    const strip = tabs.current;
    const active = strip?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
    if (!strip || !active) return;
    const viewport = strip.getBoundingClientRect();
    const tab = active.getBoundingClientRect();
    if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
    else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
  }, [category, open]);
  const close = () => { panel.current?.hidePopover(); trigger.current?.focus(); };
  const choose = (action: () => void) => { close(); action(); };
  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, item: Category) => {
    const index = categories.indexOf(item);
    const next = event.key === "ArrowRight" ? (index + 1) % categories.length
      : event.key === "ArrowLeft" ? (index + categories.length - 1) % categories.length
      : event.key === "Home" ? 0
      : event.key === "End" ? categories.length - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    event.stopPropagation();
    setCategory(categories[next]);
    tabs.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus({ preventScroll: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); close(); return; }
    if ((event.target as HTMLElement).closest('[role="tab"]')) return;
    const options = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>("[data-add-option]:not(:disabled)") ?? []);
    if (event.key === "Enter" && event.target === search.current) { event.preventDefault(); results.current?.querySelector<HTMLButtonElement>("[data-add-option]")?.click(); }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    if (event.target === search.current) {
      const matches = Array.from(results.current?.querySelectorAll<HTMLButtonElement>("[data-add-option]") ?? []);
      (event.key === "ArrowDown" ? matches[0] : matches.at(-1))?.focus();
      return;
    }
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
  };
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (label: string, group: string, keywords: string) => (category === "All" || category === group) && `${label} ${group} ${keywords}`.toLocaleLowerCase().includes(normalized);
  const visible = dataOptions.filter(option => matches(option.label, option.category, option.keywords));
  const visibleTime = timeOptions.filter(option => matches(option.label, "Calendar", `time clock ${option.id}`));
  return <div className="wf-add-menu">
    <button ref={trigger} type="button" className="watchface-add-sprite" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      popoverTarget={id} onClick={place}><Plus size={15} aria-hidden="true" /><span>Add</span><ChevronDown size={12} aria-hidden="true" /></button>
    <div ref={panel} id={id} className="wf-add-popover wf-layer-picker" popover="auto" role="dialog" aria-label="Add a layer" style={position}
      onKeyDown={onKeyDown}
      onToggle={event => {
        const isOpen = event.newState === "open";
        setOpen(isOpen);
        if (!isOpen) { setQuery(""); setCategory("All"); }
      }}>
      <div className="wf-layer-picker-heading"><strong>Add a layer</strong><button type="button" aria-label="Close add menu" onClick={close}><X size={15} /></button></div>
      <div className="wf-layer-picker-artwork" role="group" aria-label="Artwork">
        <button type="button" data-add-option className="wf-add-image" disabled={imageDisabled} onClick={() => choose(onAddImage)}><Image size={18} /><span>Image</span></button>
        {onAddOfficialImage ? <button type="button" data-add-option className="wf-add-official" disabled={imageDisabled} onClick={() => choose(onAddOfficialImage)}><Sparkles size={17} /><span>Official</span></button> : null}
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("text"))}><Type size={18} /><span>Text</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("rect"))}><Square size={17} /><span>Rectangle</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("ellipse"))}><Circle size={17} /><span>Ellipse</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("line"))}><Minus size={18} /><span>Line</span></button>
      </div>
      <div className="wf-layer-picker-data-heading"><strong>Live data</strong><span>Updates on your watch</span></div>
      <label className="wf-layer-picker-search"><Search size={15} aria-hidden="true" /><input ref={search} type="search" aria-label="Search data fields" placeholder="Search weather, health, charts…" value={query} onChange={event => setQuery(event.target.value)} spellCheck={false} />{query && <button type="button" aria-label="Clear data search" onClick={() => { setQuery(""); search.current?.focus(); }}><X size={13} /></button>}</label>
      <div ref={tabs} className="wf-layer-picker-filters" role="tablist" aria-label="Data categories">{categories.map(item => <button key={item} id={`${id}-tab-${item}`} type="button" role="tab" aria-selected={category === item} aria-controls={`${id}-data-panel`} tabIndex={category === item ? 0 : -1} onClick={() => setCategory(item)} onKeyDown={event => onTabKeyDown(event, item)}>{item}</button>)}</div>
      <div id={`${id}-data-panel`} className="wf-layer-picker-results" ref={results} role="tabpanel" aria-labelledby={`${id}-tab-${category}`} tabIndex={0}>
        {categories.filter(item => item !== "All").map(group => {
          const options = visible.filter(option => option.category === group);
          const timeRows = group === "Calendar" ? visibleTime : [];
          if (!options.length && !timeRows.length) return null;
          const Icon = categoryIcons[group];
          return <section key={group} aria-label={group}>
            <h3><Icon size={13} aria-hidden="true" />{group}{group === "Charts" && " · Experimental"}<span>{options.length + timeRows.length}</span></h3>
            {timeRows.map(option => <button type="button" key={`time:${option.id}`} data-add-option data-time-option={option.id} aria-label={`${option.added ? "Select" : "Add"} ${option.label}`} onClick={() => choose(option.onAdd)}>
              <span className="wf-layer-picker-option-label">{option.label}</span>{option.added ? <span className="wf-layer-picker-added"><Check size={12} />On face</span> : <Plus size={13} className="wf-layer-picker-plus" aria-hidden="true" />}
            </button>)}
            {options.map(option => {
              const [field, source] = option.id.split(":");
              const existing = design.nativeData?.[field];
              const added = existing?.enabled && (!source || (existing.chartSource ?? "chart_stress") === source);
              return <button type="button" key={option.id} data-add-option data-native-data={option.id} aria-label={`${added ? "Select" : "Add"} ${option.label}${group === "Charts" ? " chart" : ""}`} aria-describedby={option.availability ? `${id}-${option.id}-availability` : undefined} onClick={() => choose(() => onAddData(option.id))}>
                <span className="wf-layer-picker-option-label">{option.label}{option.availability && <small id={`${id}-${option.id}-availability`} className="wf-layer-picker-availability">{option.availability.label}</small>}</span>{added ? <span className="wf-layer-picker-added"><Check size={12} />On face</span> : <Plus size={13} className="wf-layer-picker-plus" aria-hidden="true" />}
              </button>;
            })}
          </section>;
        })}
        {!visible.length && !visibleTime.length && <div className="wf-layer-picker-empty"><Search size={22} aria-hidden="true" /><strong>No matching data fields</strong><span>Try another name or category.</span><button type="button" onClick={() => { setQuery(""); setCategory("All"); search.current?.focus(); }}>Clear filters</button></div>}
      </div>
      <div className="wf-layer-picker-footer">{design.nativeData?.chart?.enabled && (category === "Charts" || normalized.includes("chart")) ? "Choosing another chart replaces the current one." : "Add a layer, then customize it in the inspector."}</div>
    </div>
  </div>;
}
