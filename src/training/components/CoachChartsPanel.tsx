import { useCallback, useEffect, useState } from "react";
import { ChartLine } from "lucide-react";
import type { PinnedCoachChart } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import { CoachChartCard } from "../../chat/CoachChartCard";

interface CoachChartsPanelProps {
  api: CorosLinkApi | undefined;
  /** Bumps whenever the Training Hub refreshes, so live charts re-resolve too. */
  refreshToken?: number;
  showEmpty?: boolean;
}

/**
 * Charts the athlete pinned from Coach. Metric-bound charts re-fetch their
 * window on mount and on every hub refresh; inline-only charts stay as pinned.
 */
export function CoachChartsPanel({ api, refreshToken = 0, showEmpty = false }: CoachChartsPanelProps) {
  const [charts, setCharts] = useState<PinnedCoachChart[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const setBusy = useCallback((id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const refreshChart = useCallback(
    async (id: string) => {
      if (!api) return;
      setBusy(id, true);
      try {
        const updated = await api.refreshPinnedCoachChart(id);
        if (updated) {
          setCharts((prev) =>
            prev.map((chart) => (chart.id === id ? updated : chart))
          );
        }
        setError(null);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "Could not refresh the chart."
        );
      } finally {
        setBusy(id, false);
      }
    },
    [api, setBusy]
  );

  const unpinChart = useCallback(
    async (id: string) => {
      if (!api) return;
      setBusy(id, true);
      try {
        await api.unpinCoachChart(id);
        setCharts((prev) => prev.filter((chart) => chart.id !== id));
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not unpin the chart.");
      } finally {
        setBusy(id, false);
      }
    },
    [api, setBusy]
  );

  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    void api
      .listPinnedCoachCharts()
      .then((pinned) => {
        if (cancelled) return;
        setCharts(pinned);
        for (const chart of pinned) {
          if (chart.preview.live) void refreshChart(chart.id);
        }
      })
      .catch((caught) => {
        if (cancelled) return;
        setError(
          caught instanceof Error ? caught.message : "Could not load pinned charts."
        );
      });
    return () => {
      cancelled = true;
    };
    // refreshToken re-runs the load so hub refreshes pull fresh windows.
  }, [api, refreshChart, refreshToken]);

  if (charts.length === 0) {
    return showEmpty ? <section className="panel coach-charts-panel">
      <div className="section-heading"><div><p className="eyebrow">Coach charts</p><h2>Your pinned charts</h2></div><ChartLine size={22} aria-hidden="true" /></div>
      <p className="coach-charts-panel-note">{error || "Pin a chart from a coach conversation to see it on your dashboard."}</p>
    </section> : null;
  }

  return (
    <section className="panel coach-charts-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coach charts</p>
          <h2>
            {charts.length} pinned {charts.length === 1 ? "chart" : "charts"}
          </h2>
        </div>
        <ChartLine size={22} aria-hidden="true" />
      </div>
      {error ? <p className="coach-charts-panel-note">{error}</p> : null}
      <div className="coach-charts-panel-grid">
        {charts.map((chart) => (
          <CoachChartCard
            key={chart.id}
            preview={chart.preview}
            variant="panel"
            pinned
            busy={busyIds.has(chart.id)}
            onUnpin={() => void unpinChart(chart.id)}
          />
        ))}
      </div>
    </section>
  );
}
