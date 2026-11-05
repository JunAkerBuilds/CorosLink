import { Fragment, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { t, useLanguage } from "../i18n/watchfaces";

/** One readout on a chart page, drawn as a chip under the page's name. */
export type ChartPageChip = {
  source: string;
  label: string;
  /** Hidden on the watch: the page keeps it invisibly (dashed chip). */
  hidden: boolean;
  /** The readout the chart layer edits now. */
  editing?: boolean;
  /** Present when clicking the chip edits that readout. */
  onClick?: () => void;
};

/** A chart page the watch stops on when Back is pressed. */
export type ChartPageRow = {
  id: string;
  label: string;
  chips: ChartPageChip[];
  /** Short state on the name line: "Graph only", "Hides weather"… */
  note?: string;
  noteTitle?: string;
  /** The page the preview shows. */
  current?: boolean;
  onClick?: () => void;
  title?: string;
  actions?: ReactNode;
};

/**
 * The chart's pages as the watch shows them: only the pages Back stops on,
 * numbered in firmware order (NATIVE_CHART_PAGES), each with its readouts as
 * chips. Pages the watch skips are offered in the Add page menu instead.
 * Rendered as `<li>`s inside the layers list.
 */
export function ChartPageRows({ rows, addOptions, onAdd, addTitle }: {
  rows: ChartPageRow[];
  addOptions?: { id: string; label: string }[];
  onAdd?: (id: string) => void;
  addTitle?: string;
}) {
  useLanguage();
  return <>
    {rows.map((row, index) => (
      <li key={row.id} className="wf-layer-item wf-chart-page-item">
        <div className={`wf-chart-page-card${row.current ? " is-current" : ""}${row.onClick ? " is-interactive" : ""}`}>
          {row.onClick ? (
            <button type="button" className="wf-chart-page-head" title={row.title} aria-current={row.current ? "true" : undefined} onClick={row.onClick}>
              <ChartPageHead row={row} number={index + 1} />
            </button>
          ) : (
            <div className="wf-chart-page-head" title={row.title}><ChartPageHead row={row} number={index + 1} /></div>
          )}
          {row.chips.length ? (
            <div className="wf-chart-page-chips" role="group" aria-label={row.label}>
              {row.chips.map(chip => {
                const className = `wf-chart-page-chip${chip.hidden ? " is-hidden" : ""}${chip.editing ? " is-editing" : ""}`;
                const title = chip.hidden ? t("Hidden on the watch") : chip.onClick ? t("Edit this readout") : undefined;
                return <Fragment key={chip.source}>
                  {chip.onClick ? (
                    <button type="button" className={className} title={title} aria-pressed={chip.editing ? "true" : "false"} onClick={chip.onClick}>{chip.label}</button>
                  ) : <span className={className} title={title}>{chip.label}</span>}
                </Fragment>;
              })}
            </div>
          ) : null}
        </div>
        {row.actions ? <span className="wf-layer-row-actions wf-chart-page-actions">{row.actions}</span> : null}
      </li>
    ))}
    {onAdd && addOptions?.length ? (
      <li className="wf-chart-page-add">
        <span className="wf-chart-page-add-face" aria-hidden="true"><Plus size={13} />{t("Add page")}</span>
        <select aria-label={t("Add a watch page")} title={addTitle} value="" onChange={event => { if (event.target.value) onAdd(event.target.value); }}>
          <option value="">{t("Choose a page…")}</option>
          {addOptions.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
        </select>
      </li>
    ) : null}
  </>;
}

function ChartPageHead({ row, number }: { row: ChartPageRow; number: number }) {
  return <>
    <span className="wf-chart-page-index" aria-hidden="true">{number}</span>
    <span className="wf-chart-page-name">{row.label}</span>
    {row.note ? <span className="wf-chart-page-meta" title={row.noteTitle}>{row.note}</span> : null}
  </>;
}

/**
 * The note for fields the watch hides on a page, by field id: min/max on
 * every non-daily page, wind on daily pages, all weather on sun and moon.
 */
export function hiddenFieldsNote(ids: string[], label: (id: string) => string): { note: string; title: string } | undefined {
  if (!ids.length) return undefined;
  const only = (set: string[]) => ids.every(id => set.includes(id));
  const note = only(["weather_temp_min", "weather_temp_max"]) ? t("Hides min/max")
    : only(["weather_wind", "weather_direction"]) ? t("Hides wind")
    : ids.length === 1 ? t("Hides {{label}}", { label: label(ids[0]) })
    : t("Hides weather");
  return { note, title: `${t("Hidden on this page:")} ${ids.map(label).join(", ")}` };
}

/**
 * Barometer and tide pages draw the bar graph plus, optionally, their number.
 * Their chips say so ("Graph", "Current reading") rather than repeating the
 * page's name.
 */
export function barPageChips(bars: boolean, chips: ChartPageChip[]): ChartPageChip[] {
  if (!bars) return chips;
  return [{ source: "graph", label: t("Graph"), hidden: false }, ...chips.map(chip => ({ ...chip, label: t("Current reading") }))];
}

/** "1 page" / "N pages", for the Chart row. */
export function chartPageCount(count: number): string {
  return count === 1 ? t("1 page") : t("{{count}} pages", { count });
}
