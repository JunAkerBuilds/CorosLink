import { useLanguage, t } from "../../i18n/training";
import { useCallback, useEffect, useRef, useState } from "react";
import { ChartLine } from "lucide-react";
import type { PinnedCoachChart } from "../../../electron/types";
import type { CorosLinkApi } from "../../coroslink-api";
import type { CoachPrefill } from "../../chat/chatTypes";
import { CoachChartCard } from "../../chat/CoachChartCard";
import { buildMakeLivePrompt } from "../../chat/coachChartFreshness";
import type { ChartCardSize } from "../widgetSizing";
import "../chartSizing.css";

interface CoachChartsPanelProps {
  api: CorosLinkApi | undefined;
  /** Dashboard height tier; sets the plot height and how much chrome each card keeps. */
  size?: ChartCardSize;
  /** Bumps whenever the Training Hub refreshes, so live charts re-resolve too. */
  refreshToken?: number;
  showEmpty?: boolean;
  /** Opens Coach with a prompt; used to rebuild snapshot charts with bound data. */
  onOpenCoach?: (prefill: CoachPrefill) => void;
}

/** A live chart older than this is refreshed when the page is shown or focused. */
const STALE_MS = 10 * 60 * 1000;
/** Background cadence while the Training Hub stays open. */
const POLL_MS = 15 * 60 * 1000;

/**
 * Charts the athlete pinned from Coach. Charts with bound series or tiles
 * refresh on mount, on every hub refresh, whenever the window comes back
 * after a while, and on a slow timer; snapshot charts stay as pinned.
 */
export function CoachChartsPanel({ api, size, refreshToken = 0, showEmpty = false, onOpenCoach }: CoachChartsPanelProps) {
  useLanguage();
  const [charts, setCharts] = useState<PinnedCoachChart[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  // Relative stamps ("12 min ago") drift, so re-render once a minute.
  const [, setTick] = useState(0);
  const chartsRef = useRef<PinnedCoachChart[]>([]);
  chartsRef.current = charts;

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

  /** Refresh every live chart, or only the ones that have gone stale. */
  const refreshLive = useCallback(
    (force: boolean) => {
      const now = Date.now();
      for (const chart of chartsRef.current) {
        if (!chart.preview.live) continue;
        const age = now - new Date(chart.preview.resolvedAt).getTime();
        if (force || !Number.isFinite(age) || age > STALE_MS) void refreshChart(chart.id);
      }
    },
    [refreshChart]
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
        chartsRef.current = pinned;
        refreshLive(true);
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
  }, [api, refreshLive, refreshToken]);

  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) refreshLive(false);
    };
    const timer = window.setInterval(onVisible, POLL_MS);
    const tick = window.setInterval(() => setTick((value) => value + 1), 60_000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [refreshLive]);

  if (charts.length === 0) {
    return showEmpty ? (
      <section className="panel coach-charts-panel is-empty" data-chart-size={size}>
        <p className="eyebrow">{t("Coach charts")}</p>
        <div className="coach-charts-panel-empty">
          <ChartLine size={20} aria-hidden="true" />
          <p>{error || t("Pin a chart from a coach conversation to see it on your dashboard.")}</p>
        </div>
      </section>
    ) : null;
  }

  // A lone chart is the widget: its own title leads and the status line names
  // Coach. Several charts share one small label; each card keeps its status.
  const single = charts.length === 1;
  return (
    <section className={`panel coach-charts-panel${single ? " is-single" : ""}`} data-chart-size={size}>
      {single ? null : <p className="eyebrow coach-charts-panel-label">{t("Coach charts")}</p>}
      {error ? <p className="coach-charts-panel-note" role="alert">{error}</p> : null}
      <div className="coach-charts-panel-grid">
        {charts.map((chart) => (
          <CoachChartCard
            key={chart.id}
            preview={chart.preview}
            variant="panel"
            eyebrow={single ? t("Coach") : undefined}
            pinned
            busy={busyIds.has(chart.id)}
            onUnpin={() => void unpinChart(chart.id)}
            onRefresh={chart.preview.live ? () => void refreshChart(chart.id) : undefined}
            onMakeLive={onOpenCoach ? () => onOpenCoach(buildMakeLivePrompt(chart.preview)) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
