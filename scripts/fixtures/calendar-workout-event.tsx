import { createRoot } from "react-dom/client";
import { CalendarView } from "../../src/calendar/CalendarView";
import { UnitSystemProvider } from "../../src/units/UnitSystemProvider";
import { getLocalHappenDayKey } from "../../src/training/formatters";
import { defaultCalendarEventTiming } from "../../electron/calendarSyncTypes";
import type { CalendarWorkoutEvent, CalendarWorkoutEventRef, CalendarEventTiming } from "../../electron/calendarSyncTypes";
import type { TrainingHubScheduledWorkoutEntry, TrainingHubStatus } from "../../electron/types";
import type { CorosLinkApi } from "../../src/coroslink-api";
import "../../src/styles.css";
const fixture = window as unknown as {
  eventCalls: unknown[]; syncCalls: unknown[]; errors: unknown[]; offline: boolean;
};
fixture.eventCalls=[]; fixture.syncCalls=[]; fixture.errors=[];
const workout: TrainingHubScheduledWorkoutEntry = {planId:"p",idInPlan:"w",planProgramId:"program",happenDay:getLocalHappenDayKey(),name:"Morning run",sportType:1,volume:"5 km"};
let saved: CalendarWorkoutEvent | undefined;
const api = {
  onWorkoutEditsChanged: ()=>()=>{},
  getGoogleCalendarStatus: async()=>({connected:true,accountMatches:true,calendar:{id:"g"},autoSync:false}),
  getAppleCalendarStatus: async()=>({connected:true,accountMatches:true,calendar:{id:"a"},autoSync:false}),
  listScheduledWorkouts: async()=>[{...workout,calendarEvent:saved}],
  listTrainingHubActivities: async()=>[],
  getDailyMetrics: async()=>({dayList:[],weekList:[]}),
  getCalendarWorkoutEvent: async()=>saved?.timing ?? {...defaultCalendarEventTiming(),timeZone:"America/Toronto"},
  updateCalendarWorkoutEvent: async(input:{ref:CalendarWorkoutEventRef;timing:CalendarEventTiming})=>{
    fixture.eventCalls.push(input);
    saved={timing:input.timing,revision:String(fixture.eventCalls.length)};
    return {event:saved,synced:fixture.offline?["Apple Calendar"]:["Google Calendar","Apple Calendar"],errors:fixture.offline?["Google Calendar: Offline"]:[]};
  },
  rescheduleWorkout: async(_entry:unknown,day:string)=>{workout.happenDay=day;},
  syncEditedCalendarWorkout: async(ref:CalendarWorkoutEventRef)=>{fixture.syncCalls.push(ref);return {synced:["Google Calendar","Apple Calendar"],errors:[]};},
} as unknown as CorosLinkApi;
createRoot(document.getElementById("root")!).render(<UnitSystemProvider><main style={{padding:24,height:"100vh"}}>
  <CalendarView api={api} status={{authenticated:true,userId:"u"} as TrainingHubStatus} sportTypes={[]} refreshToken={0} onMessage={()=>{}} onError={error=>{if(error)fixture.errors.push(error);}} onOpenTraining={()=>{}} onOpenCoach={()=>{}} />
</main></UnitSystemProvider>);
