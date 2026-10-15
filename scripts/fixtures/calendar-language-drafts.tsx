import React from "react";
import { createRoot } from "react-dom/client";
import { WorkoutEditorModal } from "../../src/calendar/WorkoutEditorModal";
import { CalendarConnections } from "../../src/calendar/CalendarConnections";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { setLanguage } from "../../src/i18n";
import type { CorosLinkApi } from "../../src/coroslink-api";
import type { WorkoutEditorContext, WorkoutEditorDocument, TrainingPlanEntry } from "../../electron/types";

const fixture = window as unknown as {
  editorLoads: number;
  switchLanguage: typeof setLanguage;
  showCalendar: () => void;
};
fixture.editorLoads = 0;
fixture.switchLanguage = setLanguage;
setLanguage("en");
const context: WorkoutEditorContext = {
  distanceUnit: "metric", paceUnit: "km", zones: {}, lthrZones: [],
  defaultPoolLength: { value: 25, unit: "m" }, climbSystems: {}
};
const editorApi = {
  getWorkoutForEdit: async (): Promise<WorkoutEditorDocument> => {
    fixture.editorLoads += 1;
    return {
      ref: { kind: "library", programId: "library-run" }, revision: "fixture-1", canEdit: true,
      draft: { name: "Original workout", sport: "run", sportType: 1, overview: "", nodes: [] }, context
    };
  }
} as unknown as CorosLinkApi;
const planEntry = {
  id: "linked-workout", kind: "workout", title: "Original workout",
  programId: "library-run", weekIndex: 0, dayIndex: 0
} as TrainingPlanEntry;
let root = createRoot(document.getElementById("root")!);
root.render(<UnitSystemProvider><WorkoutEditorModal api={editorApi} planEntry={planEntry} onClose={() => {}} onError={() => {}} /></UnitSystemProvider>);

fixture.showCalendar = () => {
  setLanguage("en");
  root.unmount();
  document.body.innerHTML = '<div id="root"></div>';
  const status = async () => ({
    connected: false, configured: false, accountMatches: true, clientId: "saved-client"
  });
  const calendarApi = { getGoogleCalendarStatus: status, getAppleCalendarStatus: status } as unknown as CorosLinkApi;
  root = createRoot(document.getElementById("root")!);
  root.render(<CalendarConnections api={calendarApi} />);
};
