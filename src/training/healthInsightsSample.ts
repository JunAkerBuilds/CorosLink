import type { HealthInsightKind, HealthInsightResult } from "../../electron/healthInsightsTypes";

export function sampleHealthInsight(kind: HealthInsightKind, days: number): HealthInsightResult {
  const now = new Date();
  const series = (key: string, label: string, values: number[], unit?: string) => ({
    key, label, unit,
    points: values.slice(-days).map((value, index, list) => {
      const day = new Date(now);
      day.setDate(day.getDate() - list.length + index + 1);
      return { time: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`, value };
    })
  });
  const base: HealthInsightResult = { kind, days, status: "ready", fetchedAt: now.toISOString(), metrics: [], series: [] };
  switch (kind) {
    case "stress": return { ...base,
      metrics: [{ key: "stress", label: "Stress", value: 28 }],
      series: [series("stress", "Stress", [25, 31, 44, 36, 22, 34, 28])]
    };
    case "sleepHrv": return { ...base,
      metrics: [{ key: "average", label: "Sleep HRV average", value: 62, unit: "ms" }, { key: "normalRange", label: "Normal range", value: "48–72", unit: "ms" }, { key: "evaluation", label: "COROS assessment", value: "Within normal range" }],
      series: [series("average", "Sleep HRV average", [54, 58, 51, 57, 60, 65, 62], "ms")]
    };
    case "healthCheck": return { ...base,
      metrics: [{ key: "heartRate", label: "Heart rate", value: 58, unit: "bpm" }, { key: "hrv", label: "HRV", value: 64, unit: "ms" }, { key: "respiratoryRate", label: "Respiratory rate", value: 14, unit: "breaths/min" }, { key: "spo2", label: "Blood oxygen", value: 98, unit: "%" }],
      series: [series("heartRate", "Heart rate", [61, 60, 64, 62, 59, 57, 58], "bpm"), series("spo2", "Blood oxygen", [98, 97, 98, 99, 98, 99, 98], "%")]
    };
    case "cycle": return { ...base,
      metrics: [{ key: "phase", label: "Current phase", value: "Follicular" }, { key: "cycleDay", label: "Cycle day", value: 9 }, { key: "cycleLength", label: "Cycle length", value: 28, unit: "days" }]
    };
  }
}
