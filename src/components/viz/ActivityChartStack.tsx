"use client";
import { useRef, type ReactNode } from "react";
import { areaPath, indexAt, linePath, zonePaths } from "@/lib/chart";

const W = 800;

export interface ChartRow {
  key: string;
  label: string;
  /** Small text after the label: "Avg 4:46 /km · Best 4:28 /km". */
  sub?: string;
  height: number;
  values: readonly number[];
  /** Value drawn at the bottom and at the top. Swap them to draw a lower value higher (pace). */
  low: number;
  high: number;
  text: (v: number) => string;
  unit: string;
  describe: string;
  draw:
    | { kind: "zones"; zoneOf: (v: number) => number; colors: readonly string[]; avg?: number }
    | { kind: "line"; color: string; area?: boolean }
    | { kind: "area" };
}

/**
 * Charts over one axis with one shared marker. Pointing anywhere over the charts, or focusing one and pressing
 * the arrow keys, moves `index` for all of them; the page moves the map marker and the readouts from the same index.
 */
export function ActivityChartStack({ rows, n, index, onIndex, marks, grid, valueText, small }: {
  rows: readonly ChartRow[]; n: number; index: number; onIndex: (i: number) => void;
  /** Lap boundaries as fractions of the axis, drawn as dashed rules. */
  marks?: readonly number[];
  /** Side by side instead of stacked (running dynamics). */
  grid?: boolean;
  /** Where the marker is, in words, for screen readers. */
  valueText: string;
  small?: boolean;
}) {
  const plots = useRef<HTMLDivElement>(null);
  const cx = n > 1 ? (index / (n - 1)) * W : 0;

  const point = (e: React.PointerEvent) => {
    // Every chart is as wide as its neighbours, so the one under the pointer gives the scale.
    const el = (e.target as HTMLElement).closest?.("[data-plot]") ?? plots.current?.querySelector("[data-plot]");
    const rect = el?.getBoundingClientRect();
    if (rect && rect.width > 0) onIndex(indexAt(e.clientX, rect, n));
  };
  const key = (e: React.KeyboardEvent) => {
    const jump = Math.max(1, Math.round(n / 10));
    const to: Record<string, number> = {
      ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1,
      PageDown: index - jump, PageUp: index + jump, Home: 0, End: n - 1,
    };
    if (!(e.key in to)) return;
    e.preventDefault();
    onIndex(Math.max(0, Math.min(n - 1, to[e.key])));
  };
  const nss = { vectorEffect: "non-scaling-stroke" } as const;

  return (
    <div ref={plots} className="ad-plots" data-grid={grid || undefined} onPointerMove={point} onPointerDown={point}>
      {rows.map((row) => {
        const h = row.height;
        const rules = (marks ?? []).filter((m) => m > 0.001 && m < 0.999).map((m) => `M${(m * W).toFixed(1)} 0V${h}`).join("");
        const d = row.draw;
        let body: ReactNode;
        if (d.kind === "zones") {
          const paths = zonePaths(row.values, W, h, row.low, row.high, d.zoneOf, d.colors.length);
          const avgY = d.avg == null ? null : h - ((d.avg - row.low) / (row.high - row.low || 1)) * h;
          body = (
            <>
              {avgY != null && avgY > 0 && avgY < h ? <path d={`M0 ${avgY.toFixed(1)}H${W}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.4)", strokeDasharray: "6 5", ...nss }} /> : null}
              {paths.map((p, z) => (p ? <path key={z} d={p} fill="none" style={{ stroke: d.colors[z], strokeWidth: 2.2, strokeLinecap: "round", ...nss }} /> : null))}
            </>
          );
        } else if (d.kind === "line") {
          body = (
            <>
              {d.area ? <path d={areaPath(row.values, W, h, row.low, row.high)} style={{ fill: d.color, opacity: 0.14 }} /> : null}
              <path d={linePath(row.values, W, h, row.low, row.high)} fill="none" style={{ stroke: d.color, strokeWidth: 2, strokeLinejoin: "round", ...nss }} />
            </>
          );
        } else {
          body = <path d={areaPath(row.values, W, h, row.low, row.high)} style={{ fill: "rgba(var(--fg-rgb), 0.16)" }} />;
        }
        const now = row.values[index];
        return (
          <div
            key={row.key} className="ad-chart" tabIndex={0} role="slider" aria-label={`${row.label} along the activity`}
            aria-valuemin={0} aria-valuemax={n - 1} aria-valuenow={index} aria-valuetext={`${valueText}, ${row.text(now)} ${row.unit}`} onKeyDown={key}
          >
            <div className="ad-chart-head">
              <span>{row.label}{row.sub ? <small>{row.sub}</small> : null}</span>
              <span className="num" style={small ? { fontSize: 18 } : undefined}>{row.text(now)} <small>{row.unit}</small></span>
            </div>
            <svg data-plot role="img" aria-label={row.describe} width="100%" height={h} viewBox={`0 0 ${W} ${h}`} preserveAspectRatio="none">
              {rules ? <path d={rules} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.22)", strokeDasharray: "3 5", ...nss }} /> : null}
              {body}
              <path d={`M${cx.toFixed(1)} 0V${h}`} fill="none" style={{ stroke: "rgba(var(--fg-rgb), 0.6)", ...nss }} />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
