export type HealthInsightKind = "stress" | "healthCheck" | "sleepHrv" | "cycle";

export interface HealthInsightMetric {
  key: string;
  label: string;
  value: number | string;
  unit?: string;
}

export interface HealthInsightPoint {
  /** ISO date or timestamp supplied by COROS; never inferred from fetch time. */
  time: string;
  value: number;
}

export interface HealthInsightSeries {
  key: string;
  label: string;
  unit?: string;
  points: HealthInsightPoint[];
}

export interface HealthInsightData {
  metrics: HealthInsightMetric[];
  series: HealthInsightSeries[];
  /** Human-readable server output when COROS returns prose instead of records. */
  report?: string;
}

export interface HealthInsightResult extends HealthInsightData {
  kind: HealthInsightKind;
  status: "ready" | "empty" | "unavailable" | "disconnected" | "error";
  days: number;
  fetchedAt?: string;
  message?: string;
}
