import type { Watch } from "../watch";
import type { PendingChange } from "@/lib/watch";
import { msg } from "@/lib/i18n";

export const SAMPLE_WATCH: Watch = {
  name: "COROS PACE Pro",
  synced: msg("Synced through your phone today at 06:58"),
  battery: { percent: 64, left: msg("About 9 days left") },
  storage: { usedGb: 11.2, totalGb: 32 },
  firmware: { version: "3.2108.0", state: msg("Up to date") },
  goals: [
    { key: "calories", name: msg("Active calories"), unit: "kcal", goal: 600, soFar: msg("520 kcal so far today"), done: 520, step: 50, max: 9999 },
    { key: "exercise", name: msg("Exercise"), unit: "min", goal: 45, soFar: msg("38 min so far today"), done: 38, step: 5, max: 1440 },
    { key: "steps", name: msg("Steps"), unit: "steps", goal: 10000, soFar: msg("8,412 so far today"), done: 8412, step: 500, max: 99999 },
  ],
  alarms: [
    { id: "a1", time: "06:15", days: [1, 2, 3, 4, 5], label: "", on: true },
    { id: "a3", time: "08:00", days: [6], label: "", on: false },
  ],
  gpsMode: "all",
  gpsOptions: [
    { mode: "standard", name: msg("Standard"), detail: msg("Longest battery, up to 38 h of GPS"), accuracy: 1, battery: 3 },
    { mode: "all", name: msg("All systems"), detail: msg("Better in cities and under trees"), accuracy: 2, battery: 2 },
    { mode: "dual", name: msg("Dual frequency"), detail: msg("Best accuracy, shortest battery"), accuracy: 3, battery: 1 },
  ],
  batteryHistory: {
    firstDay: "2026-11-06",
    levels: [34, 30, 100, 97, 91, 88, 83, 80, 76, 68, 67, 66, 65, 64],
    summary: msg("Last 14 days · 4% a day on average"),
    perDay: msg("4% a day"),
    alt: msg("Battery level over 14 days: charged to 100 percent on 8 November, now 64 percent, with steeper drops on long run days"),
  },
};

/** The sample athlete already has one change waiting: Sunday's long-run alarm, added at a desk. */
export const SAMPLE_PENDING: PendingChange[] = [
  {
    key: "alarm.a2",
    from: null,
    to: { id: "a2", time: "05:30", days: [0], label: "Long run", on: true },
    at: new Date(2026, 10, 19, 7, 20).getTime(),
  },
];
