import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/i18n/allCatalogs";
import { setLanguage } from "../../src/i18n";
import { ActivityDetailPanel } from "../../src/training/components/ActivityDetailPanel";
import { ThemeProvider } from "../../src/theme/ThemeProvider";
import { UnitSystemProvider, useUnitSystem } from "../../src/units/UnitSystemProvider";
import type { TrainingHubActivity, TrainingHubActivityDetail } from "../../electron/types";
import "../../src/styles.css";
import "../../src/training/trainingHub.css";

// A swim's activity page, in the dialog (showcase) and calendar aside (compact) layouts.
// The test hands over the detail CorosLink builds from a decoded watch swim.
function Fixture() {
  const [detail, setDetail] = useState<TrainingHubActivityDetail | null>(null);
  const { setUnitSystem } = useUnitSystem();
  Object.assign(window, { setSwimDetail: setDetail, setTestUnits: setUnitSystem, setTestLanguage: setLanguage });
  if (!detail) return null;
  const listActivity = { activityId: detail.activityId, name: detail.name, sportType: detail.sportType, startTime: detail.startTime } as TrainingHubActivity;
  return <main style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 520px", gap: 24, padding: 24 }}>
    <section className="swim-showcase"><ActivityDetailPanel detail={detail} listActivity={listActivity} sportTypes={[]} embedded variant="showcase" /></section>
    <aside className="swim-compact activities-detail-sidebar"><ActivityDetailPanel detail={detail} listActivity={listActivity} sportTypes={[]} /></aside>
  </main>;
}
createRoot(document.getElementById("root")!).render(<ThemeProvider><UnitSystemProvider><Fixture /></UnitSystemProvider></ThemeProvider>);
