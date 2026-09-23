import { useState } from "react";
import { createRoot } from "react-dom/client";
import { TrainingActivities } from "../../src/training/components/TrainingActivities";
import { TrainingHubHeader } from "../../src/training/components/TrainingHubHeader";
import { ThemeProvider, useTheme } from "../../src/theme/ThemeProvider";
import { UnitSystemProvider, useUnitSystem } from "../../src/units/UnitSystemProvider";
import type { TrainingHubActivity, TrainingHubActivityDetail } from "../../electron/types";
import "../../src/styles.css";
import "../../src/training/trainingHub.css";

const activities: TrainingHubActivity[] = [
  { activityId: "run", name: "Ottawa Run", sportType: 100, distance: 7010, duration: 2868, avgHr: 172, calories: 723, elevationGain: 15 },
  { activityId: "swim", name: "Open Water", sportType: 301, distance: 183, duration: 1628, avgHr: 145, calories: 312, elevationGain: 0 },
  { activityId: "ride", name: "Montreal Road Bike", sportType: 200, distance: 3070, duration: 1018, avgHr: 138, calories: 248, elevationGain: 32 },
  { activityId: "walk", name: "Montreal Walk", sportType: 900, distance: 2610, duration: 2252, avgHr: 98, calories: 216, elevationGain: 18 },
  { activityId: "run2", name: "Ottawa Run", sportType: 100, distance: 6630, duration: 3241, avgHr: 157, calories: 654, elevationGain: 20 },
  { activityId: "run3", name: "Hamilton Run", sportType: 100, distance: 7010, duration: 3889, avgHr: 145, calories: 701, elevationGain: 31 },
  { activityId: "missing", name: "10km Easy Run", sportType: 100, distance: 3140, duration: 1386 },
  { activityId: "indoor", name: "Evening Strength", sportType: 402, duration: 1800, avgHr: 131, calories: 205 },
  { activityId: "failed", name: "Unavailable route", sportType: 104, duration: 1200, distance: 1200 }
].map((activity, index) => ({ ...activity, startTime: new Date(2026, 8, 21 - index, 12, 45).getTime() / 1000 }));
const state = { calls: [] as string[], exports: [] as string[], active: 0, maxActive: 0 };
Object.assign(window, { activitiesTest: state });
const details = new Map(activities.map((activity, index) => [activity.activityId, {
  ...activity, laps: [], raw: {}, track: activity.activityId === "missing" ? undefined : { points: Array.from({ length: 45 }, (_, i) => ({
    lat: 45.422 + .008 * Math.sin(i / 7 + index), lon: -75.71 + .0013 * i + .004 * Math.cos(i / 3), distance: i * 150, elevation: 70 + i % 12
  })) }
} as TrainingHubActivityDetail]));
async function load(activity: TrainingHubActivity) {
  state.calls.push(activity.activityId); state.active++; state.maxActive = Math.max(state.active, state.maxActive);
  await new Promise(resolve => setTimeout(resolve, 80));
  state.active--;
  if (activity.activityId === "failed") throw new Error("Offline");
  return details.get(activity.activityId)!;
}
function Fixture() {
  const [selected, setSelected] = useState<TrainingHubActivity | null>(null);
  const { setTheme } = useTheme();
  const { setUnitSystem } = useUnitSystem();
  Object.assign(window, { setTestTheme: setTheme, setTestUnits: setUnitSystem });
  return <main className="stack training-dashboard" style={{ padding: "28px 32px", height: "100vh", overflow: "auto" }}>
    <TrainingHubHeader connected status={null} busy={null} sampleMode={false} activeTab="activities" tabIdPrefix="fixture" activityCount={activities.length}
      onTabChange={() => {}} onRefresh={() => {}} onLogout={() => {}} />
    <TrainingActivities activities={activities} sportTypes={[]} selectedActivity={selected} activityDetail={selected ? details.get(selected.activityId)! : null}
      busy={null} onLoadDetail={setSelected} onExportFile={(activity, type) => state.exports.push(`${activity.activityId}:${type}`)} loadPreview={load} />
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><UnitSystemProvider><Fixture /></UnitSystemProvider></ThemeProvider>);
