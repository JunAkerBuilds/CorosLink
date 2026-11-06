import { t, useLanguage, getLocale } from "../i18n/watchfaces";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Activity, CalendarDays, ChartNoAxesCombined, Check, ChevronDown, Circle, Clock3, CloudSun, Image, Minus, MoonStar, Plus, Search, Smartphone, Sparkles, Square, Shapes, TrendingUp, Type, X } from "lucide-react";
import type { CorosWatchfaceBackgroundElement, CorosWatchfaceDesignState } from "../../electron/types";
import { NATIVE_CHART_PAGES, NATIVE_DATA_FIELDS, nativeChartReadoutLabel } from "../../electron/watchfaceNativeCatalog";

const categories = ["All", "Time", "Calendar", "Weather", "Health", "Training", "Device", "Astronomy", "Charts"] as const;
type Category = typeof categories[number];
export type WatchfaceAddCategory = Exclude<Category, "All">;
const categoryIcons = { Time: Clock3, Calendar: CalendarDays, Weather: CloudSun, Health: Activity, Training: TrendingUp, Device: Smartphone, Astronomy: MoonStar, Charts: ChartNoAxesCombined };
/**
 * Charts are added a page at a time: every chart readout lives on one page
 * the watch's Back button steps to, and some pages need all their readouts.
 * Barometer and tide come and go together (both need the bars).
 */
const CHART_PAGE_LABELS: Record<string, string> = { sun: "Sun", moon: "Moon", "daily-a": "Daily stats", "daily-b": "Daily activity" };
const chartPageOptions = [
  { page: "bars", label: "Barometer and tide", graph: "Bars", required: ["chart_baro", "chart_tide"], optional: [] as string[], note: "Adds two pages · needs phone data" },
  ...NATIVE_CHART_PAGES.filter(page => page.id !== "barometer" && page.id !== "tide").map(page => ({
    page: page.id, label: CHART_PAGE_LABELS[page.id] ?? page.label,
    graph: page.id === "sun" || page.id === "moon" ? "Line" : "No graph",
    required: [...page.required], optional: page.sources.filter(source => !page.required.includes(source)), note: ""
  }))
];
const dataOptions: Array<{ id: string; label: string; category: WatchfaceAddCategory; keywords: string; availability?: { label: string }; chartPage?: typeof chartPageOptions[number] }> = [
  ...NATIVE_DATA_FIELDS.filter(field => field.kind !== "chart").map(field => ({ id: field.id, label: field.label, category: field.category as WatchfaceAddCategory, keywords: field.id, availability: field.availability })),
  ...chartPageOptions.map(option => ({ id: `chartpage:${option.page}`, label: option.label, category: "Charts" as const,
    keywords: `chart page ${option.graph} ${[...option.required, ...option.optional].map(source => `${source} ${nativeChartReadoutLabel(source)}`).join(" ")}`, chartPage: option }))
];
/** "Line · Sunrise / sunset · + Sun angle": what the page draws and holds. */
function chartPageDetail(option: typeof chartPageOptions[number]) {
  const labels = (sources: string[]) => sources.map(source => t(nativeChartReadoutLabel(source))).join(", ");
  return [t(option.graph), labels(option.required), ...(option.optional.length ? [`+ ${labels(option.optional)}`] : []), ...(option.note ? [t(option.note)] : [])].join(" · ");
}

/**
 * A face component outside the native data catalog: template layers (time,
 * date, fixed metrics, indicators) and ones Studio synthesizes (seconds,
 * analog hands). Deleted template layers come back through these rows.
 */
export interface WatchfaceAddFaceOption {
  id: string;
  label: string;
  category: WatchfaceAddCategory;
  added: boolean;
  onAdd: () => void;
}

/** "Training" → "training" for "Search training"; other scripts unchanged. */
function midSentenceLabel(label: string) {
  if (!getLocale().startsWith("en")) return label;
  return label.length > 1 && label[1] === label[1].toLocaleLowerCase() ? label[0].toLocaleLowerCase() + label.slice(1) : label;
}

/** The rail's category buttons, top to bottom; each opens the picker on its tab. */
const railCategories: Array<{ category: WatchfaceAddCategory; label: string }> = [
  { category: "Time", label: "Time" },
  { category: "Calendar", label: "Date" },
  { category: "Health", label: "Health" },
  { category: "Training", label: "Training" },
  { category: "Weather", label: "Weather" },
  { category: "Device", label: "Device" },
  { category: "Astronomy", label: "Sun & moon" },
  { category: "Charts", label: "Chart" }
];

export function WatchfaceAddMenu({ design, imageDisabled, onAddImage, onAddOfficialImage, onAddElement, onAddData, faceOptions = [], chartPagesOnFace = [], variant = "button" }: {
  design: CorosWatchfaceDesignState;
  imageDisabled: boolean;
  onAddImage: () => void;
  /** Opens the official COROS asset browser instead of a file dialog. */
  onAddOfficialImage?: () => void;
  onAddElement: (kind: CorosWatchfaceBackgroundElement["kind"]) => void;
  onAddData: (id: string) => void;
  faceOptions?: WatchfaceAddFaceOption[];
  /** The chart layer's pages on the face, by page id; picking one of them opens it. */
  chartPagesOnFace?: string[];
  /** "rail": a vertical strip of category buttons beside the layer list. */
  variant?: "button" | "rail";
}) {
  useLanguage();
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
  // The rail button that opened the picker; the picker sits to its right.
  const railAnchor = useRef<HTMLElement | null>(null);
  // Set while one rail button reopens the picker another one had open.
  const reopening = useRef(false);
  const rail = variant === "rail";
  const place = useCallback(() => {
    if (rail) {
      const anchor = railAnchor.current?.getBoundingClientRect();
      if (!anchor) return;
      const width = Math.min(320, window.innerWidth - anchor.right - 22);
      const maxHeight = Math.min(580, window.innerHeight - 24);
      const next = {
        width, maxHeight,
        top: Math.max(12, Math.min(anchor.top - 12, window.innerHeight - maxHeight - 12)),
        left: anchor.right + 10
      };
      setPosition(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
      return;
    }
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
  }, [category, rail]);
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
  const close = () => { panel.current?.hidePopover(); (rail ? railAnchor.current : trigger.current)?.focus(); };
  // Pressing a rail button light-dismisses the picker before its click, so
  // remember on pointerdown whether this button's tab was the one showing.
  const shownFor = useRef<HTMLElement | null>(null);
  const noteShown = (button: HTMLElement, next: Category) => {
    shownFor.current = panel.current?.matches(":popover-open") && railAnchor.current === button && category === next ? button : null;
  };
  const openAt = (button: HTMLElement, next: Category) => {
    const toggleOff = shownFor.current === button || (open && railAnchor.current === button && category === next);
    shownFor.current = null;
    railAnchor.current = button;
    if (toggleOff) { if (panel.current?.matches(":popover-open")) panel.current.hidePopover(); return; }
    reopening.current = true;
    setCategory(next);
    if (!panel.current?.matches(":popover-open")) panel.current?.showPopover();
  };
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
  // From the rail, a category button shows just that category's data and
  // Shape shows just shapes and artwork; the rail itself is the tab bar.
  const railData = rail && category !== "All";
  const railArtwork = rail && category === "All";
  const railItem = railCategories.find(item => item.category === category);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = (label: string, group: string, keywords: string) => (category === "All" || category === group) && `${label} ${t(label)} ${group} ${t(group)} ${keywords} ${keywords.split(" ").map(word => t(word)).join(" ")}`.toLocaleLowerCase(getLocale()).includes(normalized);
  const visible = dataOptions.filter(option => matches(option.label, option.category, option.keywords));
  const visibleFace = faceOptions.filter(option => matches(option.label, option.category, `${option.category === "Time" ? t("time clock ") : ""}${option.id}`));
  const railButton = (label: string, Icon: typeof Clock3, onClick: (button: HTMLButtonElement) => void, options: { active?: boolean; disabled?: boolean; dialog?: Category } = {}) =>
    <button key={label} type="button" className={`wf-add-rail-button${options.active ? " is-active" : ""}`} disabled={options.disabled}
      aria-haspopup={options.dialog ? "dialog" : undefined} aria-expanded={options.dialog ? Boolean(options.active) : undefined} aria-controls={options.dialog ? id : undefined}
      title={t(label)} onPointerDown={event => { if (options.dialog) noteShown(event.currentTarget, options.dialog); }} onClick={event => onClick(event.currentTarget)}>
      <Icon size={18} aria-hidden="true" /><span>{t(label)}</span>
    </button>;
  return <div className={rail ? "wf-add-rail" : "wf-add-menu"} role={rail ? "toolbar" : undefined} aria-orientation={rail ? "vertical" : undefined} aria-label={rail ? t("Add to the face") : undefined}>
    {rail ? <>
      <span className="wf-add-rail-heading" aria-hidden="true">{t("Add")}</span>
      {railCategories.map(item => railButton(item.label, categoryIcons[item.category], button => openAt(button, item.category), { active: open && category === item.category && railAnchor.current?.title === t(item.label), dialog: item.category }))}
      <span className="wf-add-rail-divider" aria-hidden="true" />
      {railButton("Text", Type, () => onAddElement("text"))}
      {railButton("Shape", Shapes, button => openAt(button, "All"), { active: open && category === "All", dialog: "All" })}
      {railButton("Image", Image, () => onAddImage(), { disabled: imageDisabled })}
    </> : <button ref={trigger} type="button" className="watchface-add-sprite" aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
      popoverTarget={id} onClick={place}><Plus size={15} aria-hidden="true" /><span>{t("Add")}</span><ChevronDown size={12} aria-hidden="true" /></button>}
    <div ref={panel} id={id} className={`wf-add-popover wf-layer-picker${railData ? " is-rail-data" : ""}${railArtwork ? " is-rail-artwork" : ""}`} popover="auto" role="dialog" aria-label={t("Add a layer")} style={position}
      onKeyDown={onKeyDown}
      onToggle={event => {
        const isOpen = event.newState === "open";
        setOpen(isOpen);
        if (isOpen) reopening.current = false;
        else if (!reopening.current) { setQuery(""); setCategory("All"); }
      }}>
      <div className="wf-layer-picker-heading">{railData && railItem ? <strong className="wf-layer-picker-title">{(() => { const Icon = categoryIcons[railItem.category]; return <span className="wf-layer-picker-title-icon" aria-hidden="true"><Icon size={15} /></span>; })()}{t(railItem.label)}</strong> : <strong>{t(railArtwork ? "Shapes and artwork" : "Add a layer")}</strong>}<button type="button" aria-label={t("Close add menu")} onClick={close}><X size={15} /></button></div>
      {railData ? null : <div className="wf-layer-picker-artwork" role="group" aria-label={t("Artwork")}>
        <button type="button" data-add-option className="wf-add-image" disabled={imageDisabled} onClick={() => choose(onAddImage)}><Image size={18} /><span>{t("Image")}</span></button>
        {onAddOfficialImage ? <button type="button" data-add-option className="wf-add-official" disabled={imageDisabled} onClick={() => choose(onAddOfficialImage)}><Sparkles size={17} /><span>{t("Official")}</span></button> : null}
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("text"))}><Type size={18} /><span>{t("Text")}</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("rect"))}><Square size={17} /><span>{t("Rectangle")}</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("ellipse"))}><Circle size={17} /><span>{t("Ellipse")}</span></button>
        <button type="button" data-add-option onClick={() => choose(() => onAddElement("line"))}><Minus size={18} /><span>{t("Line")}</span></button>
      </div>}
      {railArtwork ? null : <>
      {railData ? null : <div className="wf-layer-picker-data-heading"><strong>{t("Live data")}</strong><span>{t("Updates on your watch")}</span></div>}
      <label className="wf-layer-picker-search"><Search size={15} aria-hidden="true" /><input ref={search} type="search" aria-label={t("Search data fields")} placeholder={railData && railItem ? t("Search {{value1}}", { value1: midSentenceLabel(t(railItem.label)) }) : t("Search weather, health, charts…")} value={query} onChange={event => setQuery(event.target.value)} spellCheck={false} />{query && <button type="button" aria-label={t("Clear data search")} onClick={() => { setQuery(""); search.current?.focus(); }}><X size={13} /></button>}</label>
      <div ref={tabs} className="wf-layer-picker-filters" hidden={railData} role="tablist" aria-label={t("Data categories")}>{categories.map(item => <button key={item} id={`${id}-tab-${item}`} type="button" role="tab" aria-selected={category === item} aria-controls={`${id}-data-panel`} tabIndex={category === item ? 0 : -1} onClick={() => setCategory(item)} onKeyDown={event => onTabKeyDown(event, item)}>{t(item)}</button>)}</div>
      <div id={`${id}-data-panel`} className="wf-layer-picker-results" ref={results} role="tabpanel" aria-labelledby={`${id}-tab-${category}`} tabIndex={0}>
        {categories.filter(item => item !== "All").map(group => {
          const options = visible.filter(option => option.category === group);
          const faceRows = visibleFace.filter(option => option.category === group);
          if (!options.length && !faceRows.length) return null;
          const Icon = categoryIcons[group];
          return <section key={group} aria-label={t(group)}>
            <h3><Icon size={13} aria-hidden="true" />{t(group)}{group === "Charts" && t(" · pages · Experimental")}<span>{options.length + faceRows.length}</span></h3>
            {faceRows.map(option => <button type="button" key={`face:${option.id}`} data-add-option data-face-option={option.id} aria-label={t("{{value1}} {{value2}}", { value1: t(option.added ? "Select" : "Add"), value2: t(option.label) })} onClick={() => choose(option.onAdd)}>
              <span className="wf-layer-picker-option-label">{t(option.label)}</span>{option.added ? <span className="wf-layer-picker-added"><Check size={12} />{t("On face")}</span> : <Plus size={13} className="wf-layer-picker-plus" aria-hidden="true" />}
            </button>)}
            {options.map(option => {
              if (option.chartPage) {
                const page = option.chartPage;
                const added = page.page === "bars" ? chartPagesOnFace.includes("barometer") : chartPagesOnFace.includes(page.page);
                return <button type="button" key={option.id} data-add-option data-native-data={option.id} className="wf-layer-picker-chart-page"
                  aria-label={t("{{value1}} {{value2}}", { value1: t(added ? "Open" : "Add"), value2: t(option.label) })} onClick={() => choose(() => onAddData(option.id))}>
                  <span className="wf-layer-picker-option-label">{t(option.label)}<small className="wf-layer-picker-availability">{chartPageDetail(page)}</small></span>
                  {added ? <span className="wf-layer-picker-added"><Check size={12} />{t("On face")}</span> : <Plus size={13} className="wf-layer-picker-plus" aria-hidden="true" />}
                </button>;
              }
              const [field, source] = option.id.split(":");
              const existing = design.nativeData?.[field];
              const added = existing?.enabled && (!source || (existing.chartSource ?? "chart_stress") === source || Boolean(existing.readouts?.[source]));
              return <button type="button" key={option.id} data-add-option data-native-data={option.id} aria-label={t("{{value1}} {{value2}}{{value3}}", { value1: t(added ? "Select" : "Add"), value2: t(option.label), value3: group === "Charts" ? t(" chart") : "" })} aria-describedby={option.availability ? `${id}-${option.id}-availability` : undefined} onClick={() => choose(() => onAddData(option.id))}>
                <span className="wf-layer-picker-option-label">{t(option.label)}{option.availability && <small id={`${id}-${option.id}-availability`} className="wf-layer-picker-availability">{t(option.availability.label)}</small>}</span>{added ? <span className="wf-layer-picker-added"><Check size={12} />{t("On face")}</span> : <Plus size={13} className="wf-layer-picker-plus" aria-hidden="true" />}
              </button>;
            })}
          </section>;
        })}
        {!visible.length && !visibleFace.length && <div className="wf-layer-picker-empty"><Search size={22} aria-hidden="true" /><strong>{t("No matching data fields")}</strong><span>{t("Try another name or category.")}</span><button type="button" onClick={() => { setQuery(""); setCategory("All"); search.current?.focus(); }}>{t("Clear filters")}</button></div>}
      </div>
      <div className="wf-layer-picker-footer">{design.nativeData?.chart?.enabled && (category === "Charts" || normalized.includes("chart")) ? t("Each page is a screen the watch's Back button steps to. A page on the face opens it.") : t("Add a layer, then customize it in the inspector.")}</div>
      </>}
    </div>
  </div>;
}
