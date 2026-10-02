import crypto from "node:crypto";
import type { CoachCorosActionPreview, CorosMcpTool, UnitSystem } from "./types";
import { corosInputSchema, isCorosWorkoutWrite } from "./coachCorosTools";
import { distanceUnit, formatDistanceValue, formatElevationValue, formatPaceValue } from "./unitSystem";

type ObjectValue = Record<string, unknown>;
const record = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === "string" ? value : "";
const ACTION_TTL = 24 * 60 * 60_000;

interface ReadRequest { name: string; args: ObjectValue }
interface StoredAction {
  name: string;
  args: ObjectValue;
  preview: CoachCorosActionPreview;
  connectionKey: string;
  claude: boolean;
  source?: { request: ReadRequest; digest: string };
}

export interface CorosActionDependencies {
  tools: () => CorosMcpTool[];
  call: (name: string, args: ObjectValue) => Promise<string>;
  load: () => string | undefined;
  save: (value: string) => void;
  connectionKey: () => string;
  canConfirm: (claude: boolean) => boolean;
  now?: () => number;
}

const digest = (value: string) => crypto.createHash("sha256").update(value).digest("hex");


function sourceRead(name: string, args: ObjectValue): ReadRequest | undefined {
  if (name === "scheduleWorkout" || name === "updateWorkoutDetails") return { name: "queryWorkoutDetails", args: { workoutId: args.workoutId } };
  if (name === "updateScheduledWorkout") return { name: "queryScheduledWorkoutDetails", args: { date: args.date, idInPlan: args.idInPlan } };
  if (name === "updateTrainingPlan") return { name: "queryTrainingPlanDetails", args: { planId: record(args.planInfo).planId } };
  return undefined;
}

function validateDestination(name: string, args: ObjectValue): void {
  const plan = record(args.planInfo);
  const id = name === "updateTrainingPlan" ? plan.planId : args.workoutId ?? args.idInPlan;
  if ((name.startsWith("update") || name === "scheduleWorkout") && (typeof id !== "string" || !/^[1-9]\d*$/.test(id))) throw new Error("Read the existing workout first and preserve its complete decimal ID as a string.");
  const date = args.date ?? plan.planStartDate;
  if (date !== undefined) {
    const value = String(date);
    const iso = value.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3");
    const parsed = new Date(`${iso}T00:00:00Z`);
    if (!/^\d{8}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) throw new Error("Choose a valid calendar date.");
  }
  if (plan.totalWeeks !== undefined && (!Number.isInteger(plan.totalWeeks) || Number(plan.totalWeeks) < 4 || Number(plan.totalWeeks) > 16)) throw new Error("Use local plan drafts for plans outside COROS MCP's 4–16 week range.");
  if (name === "createTrainingPlan" && (!text(plan.planName).trim() || !text(plan.planOverview).trim() || !plan.planStartDate || !plan.totalWeeks || !list(args.courseList).length)) throw new Error("A new plan needs a name, overview, start date, duration, and workouts.");
}

function duration(seconds: unknown): string {
  const n = Number(seconds);
  return n % 60 === 0 ? `${n / 60} min` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function sectionSummary(section: ObjectValue, sport: number, unitSystem: UnitSystem, depth = 0): string {
  const intensityFields = ["sectionIntensity", "intensityPercentStart", "intensityPercentEnd", "intensityValueStart", "intensityValueEnd"];
  if (section.intervalGroup) {
    if (depth > 0) throw new Error("Nested interval groups are not supported.");
    if (["intensityType", "targetType", "targetValue", ...intensityFields].some(key => section[key] !== undefined)) throw new Error("Set targets and intensity on interval steps, not the group.");
    const sets = list(section.sets);
    if (!sets.length || !Number.isInteger(section.repeats) || Number(section.repeats) < 1 || Number(section.repeats) > 20) throw new Error("An interval group needs 1–20 repetitions and steps.");
    return `${section.repeats} × (${sets.map(item => sectionSummary(record(item), sport, unitSystem, depth + 1)).join("; ")})`;
  }
  if (section.sets !== undefined || section.repeats !== undefined) throw new Error("Only interval groups may have sets or repeats.");
  if (depth && ![2, 3].includes(Number(section.sectionType))) throw new Error("Interval steps must be training or recovery.");
  if (!(sport === 5 ? [1, 3, 4] : [1, 2, 4]).includes(Number(section.targetType))) throw new Error("This target is unsupported for the sport in COROS MCP. Use a local workout draft.");
  if (section.targetType === 4 && section.targetValue != null && section.targetValue !== 0) throw new Error("An open step cannot have a preset target.");
  const kind = ({ 1: "Warm-up", 2: "Training", 3: "Recovery", 4: "Cool-down" } as Record<number, string>)[Number(section.sectionType)];
  const target = ({ 1: formatDistanceValue(Number(section.targetValue), unitSystem), 2: duration(section.targetValue), 3: `${formatElevationValue(Number(section.targetValue), unitSystem)} ascent`, 4: "Open" } as Record<number, string>)[Number(section.targetType)];
  if (!kind || !target || (section.targetType !== 4 && !(Number(section.targetValue) > 0))) throw new Error("Every workout step needs a valid type and target.");
  const metric = ({ 1: "Heart rate", 2: "Pace", 3: "Effort threshold pace", 4: "Power" } as Record<number, string>)[Number(section.intensityType)];
  let intensity = "No intensity target";
  if (metric) {
    if (!(sport === 2 ? [1, 4] : sport === 5 ? [1, 2, 3, 4] : [1, 2, 4]).includes(Number(section.intensityType))) throw new Error("This intensity metric is unsupported for the sport in COROS MCP. Use a local workout draft.");
    const formats = [section.sectionIntensity !== undefined, section.intensityPercentStart !== undefined || section.intensityPercentEnd !== undefined, section.intensityValueStart !== undefined || section.intensityValueEnd !== undefined];
    if (formats.filter(Boolean).length !== 1) throw new Error("Each step needs exactly one intensity format.");
    if (formats[0] && (Number(section.sectionIntensity) < 1 || Number(section.sectionIntensity) > (sport === 2 && section.intensityType === 4 ? 7 : 6) || (section.intensityType === 4 && sport !== 2))) throw new Error("This intensity zone is unsupported. Use an absolute range or a local workout draft.");
    if (formats[1] && (section.intensityType === 4 || !(Number(section.intensityPercentStart) >= 20 && Number(section.intensityPercentEnd) > Number(section.intensityPercentStart) && Number(section.intensityPercentEnd) <= (section.intensityType === 1 ? 120 : 140)))) throw new Error("Invalid threshold percentage range.");
    if (formats[2]) {
      const [min, max] = section.intensityType === 1 ? [30, 240] : section.intensityType === 2 ? [120, 1499] : [10, 2000];
      if (section.intensityType === 3 || ![section.intensityValueStart, section.intensityValueEnd].every(value => Number(value) >= min && Number(value) <= max)) throw new Error("Invalid absolute intensity range.");
    }
    if (section.sectionIntensity !== undefined) intensity = `${metric} zone ${section.sectionIntensity}`;
    else if (section.intensityPercentStart !== undefined && section.intensityPercentEnd !== undefined) intensity = `${metric} ${section.intensityPercentStart}–${section.intensityPercentEnd}% of threshold`;
    else if (section.intensityValueStart !== undefined && section.intensityValueEnd !== undefined) {
      const pace = section.intensityType === 2;
      const low = pace ? formatPaceValue(Number(section.intensityValueStart), unitSystem, true) : section.intensityValueStart;
      const high = pace ? formatPaceValue(Number(section.intensityValueEnd), unitSystem, true) : section.intensityValueEnd;
      intensity = `${metric}: ${low}–${high} ${pace ? `/${distanceUnit(unitSystem)}` : section.intensityType === 1 ? "bpm" : "W"}`;
    } else throw new Error("The intensity metric needs a zone or range.");
  } else if (section.intensityType !== undefined || intensityFields.some(key => section[key] !== undefined)) throw new Error("Unsupported intensity. Use the local workout draft tools for this prescription.");
  return `${kind}: ${target} · ${intensity}`;
}

function actionDetails(args: ObjectValue, unitSystem: UnitSystem): string[] {
  const details: string[] = [];
  const plan = record(args.planInfo);
  if (plan.planName) details.push(text(plan.planName));
  if (plan.planOverview) details.push(text(plan.planOverview));
  if (plan.totalWeeks) details.push(`${plan.totalWeeks} weeks`);
  const courses = args.course ? [args.course] : list(args.courseList);
  for (const value of courses) {
    const course = record(value);
    const sport = ({ 1: "Run", 2: "Bike", 4: "Rest day", 5: "Trail run" } as Record<number, string>)[Number(course.sportType)];
    if (!sport || (course.sportType === 4 && !args.planInfo)) throw new Error("Use local drafts for Strength and other sports unsupported by COROS MCP.");
    if (!text(course.courseName).trim() || !text(course.courseDescription).trim()) throw new Error("A workout name and description are required.");
    if (course.strengthBodypart != null || course.intensityType !== undefined) throw new Error("Strength and course-level intensity are unsupported by COROS MCP. Use a local workout draft.");
    if (args.planInfo ? !Number.isInteger(course.dayNo) || Number(course.dayNo) < 0 : course.dayNo !== undefined) throw new Error("Only plan workouts must specify a non-negative day offset.");
    if (course.sportType === 4 ? list(course.sections).length > 0 : list(course.sections).length === 0) throw new Error("Sport workouts need steps; rest days must have no steps.");
    details.push(`${course.dayNo === undefined ? "" : `Day ${Number(course.dayNo) + 1} · `}${sport} · ${course.courseName}`);
    if (course.courseDescription) details.push(text(course.courseDescription));
    details.push(...list(course.sections).map(section => sectionSummary(record(section), Number(course.sportType), unitSystem)));
  }
  const phase = record(args.phaseInfo);
  if (phase.planRationale) details.push(text(phase.planRationale));
  for (const value of list(phase.periodization)) {
    const p = record(value);
    const label = ({ 1: "Preparation", 2: "Base", 3: "Build", 4: "Peak", 5: "Race", 6: "Transition" } as Record<number, string>)[Number(p.phaseType)];
    details.push(`${label ?? "Training phase"}: ${p.startDate}–${p.endDate} · ${p.durationWeeks} weeks`);
  }
  return details;
}

function parsedResponse(response: string): ObjectValue {
  try { return record(JSON.parse(response)); } catch { return {}; }
}

// Live COROS tools can return their human-readable text as a JSON string.
function responseText(response: string): string {
  try {
    const value: unknown = JSON.parse(response);
    return typeof value === "string" ? value : response;
  } catch { return response; }
}

function responseId(response: string, key: string, label: string): string | undefined {
  response = responseText(response);
  const parsed = parsedResponse(response);
  const value = parsed[key] ?? record(parsed.data)[key];
  if (typeof value === "string" && /^\d+$/.test(value)) return value;
  // Never round the 64-bit identifiers by converting through a JS number.
  const jsonId = response.match(new RegExp(`"${key}"\\s*:\\s*(?:"([0-9]+)"|([0-9]+)(?=\\s*[,}\\]]|\\s*$))`, "i"));
  if (jsonId) return jsonId[1] ?? jsonId[2];
  return response.match(new RegExp(`\\b(?:${key}|${label})\\s*[:：]\\s*"?([0-9]+)(?=["\\s,;)}\\]]|$)`, "i"))?.[1];
}

export function createCorosActionService(deps: CorosActionDependencies) {
  const now = deps.now ?? Date.now;
  let actions: StoredAction[] | undefined;
  const active = new Set<string>();
  const load = () => {
    if (!actions) {
      try { actions = JSON.parse(deps.load() ?? "[]") as StoredAction[]; } catch { actions = []; }
      if (!Array.isArray(actions)) actions = [];
    }
    return actions;
  };
  const persist = () => deps.save(JSON.stringify(load()));
  const callRead = (request: ReadRequest) => deps.call(`coros__${request.name}`, request.args);
  const restore = (preview: CoachCorosActionPreview): CoachCorosActionPreview => {
    const action = load().find(item => item.preview.requestId === preview.requestId);
    if (!action) return preview;
    if (action.preview.state === "saving" && !active.has(preview.requestId)) {
      action.preview.state = "uncertain";
      action.preview.message = "The previous save was interrupted. Check COROS before preparing another change.";
      persist();
    }
    return structuredClone(action.preview);
  };

  return {
    restore,
    async stage(name: string, input: ObjectValue, claude = false, unitSystem: UnitSystem = "metric"): Promise<CoachCorosActionPreview> {
      if (!isCorosWorkoutWrite(name)) throw new Error("Unsupported COROS workout action.");
      const tool = deps.tools().find(tool => tool.name === name);
      if (!tool) throw new Error("This COROS tool is unavailable. Refresh the connection or use a local workout draft.");
      const { review_summary, ...args } = structuredClone(input);
      if (!text(review_summary).trim()) throw new Error("Provide a plain-language review_summary for the athlete.");
      const { AjvJsonSchemaValidator } = await import("@modelcontextprotocol/sdk/validation/ajv");
      const checked = new AjvJsonSchemaValidator().getValidator(corosInputSchema(tool.inputSchema))(args);
      if (!checked.valid) throw new Error(`Invalid COROS workout arguments: ${checked.errorMessage}`);
      validateDestination(name.slice(7), args);
      const details = actionDetails(args, unitSystem);
      const shortName = name.slice(7);
      const read = sourceRead(shortName, args);
      let source: StoredAction["source"];
      if (read) {
        const response = await callRead(read);
        if (shortName.startsWith("update") && /(?:["']?editable["']?\s*[:=]\s*false|^\s*Editable via MCP:\s*no\b)/im.test(responseText(response))) throw new Error("COROS reports that this workout cannot be edited through MCP. Use CorosLink's workout editor.");
        source = { request: read, digest: digest(response) };
      }
      const destination = /TrainingPlan$/.test(shortName) ? "Training Plan" : /ScheduledWorkout$/.test(shortName) || shortName === "scheduleWorkout" ? "Calendar" : "Workout Library";
      if (shortName === "updateTrainingPlan") details.unshift("Each changed day replaces all sessions on that day.");
      if (shortName === "updateWorkoutDetails") details.unshift("Changes the library template. Existing calendar copies keep their current content.");
      if (shortName === "scheduleWorkout") details.push("Schedules an unchanged copy of the selected library workout, including its exercises and sets.");
      const date = args.date ?? record(args.planInfo).planStartDate;
      const preview: CoachCorosActionPreview = {
        requestId: crypto.randomUUID(), title: shortName.startsWith("update") ? "Review workout changes" : shortName === "scheduleWorkout" ? "Schedule saved workout" : destination === "Training Plan" ? "Review training plan" : "Review workout",
        summary: text(review_summary).trim(), destination,
        ...(date ? { date: String(date) } : {}), details, createdAt: now(), state: "pending"
      };
      const connectionKey = deps.connectionKey();
      if (!connectionKey) throw new Error("Reconnect COROS before preparing this change.");
      actions = load().filter(action => now() - action.preview.createdAt < ACTION_TTL || active.has(action.preview.requestId)).slice(-99);
      actions.push({ name, args, preview, connectionKey, claude, source });
      persist();
      return structuredClone(preview);
    },
    async confirm(requestId: string): Promise<CoachCorosActionPreview> {
      const action = load().find(item => item.preview.requestId === requestId);
      if (!action) throw new Error("This review expired. Ask the coach to prepare it again.");
      if (active.has(requestId)) throw new Error("This change is already being saved.");
      if (action.preview.state === "saved" || action.preview.state === "uncertain") return structuredClone(action.preview);
      if (action.preview.state === "saving") {
        return restore(action.preview);
      }
      if (now() - action.preview.createdAt > ACTION_TTL) throw new Error("This review expired. Ask the coach to prepare it again.");
      if (!deps.canConfirm(action.claude)) throw new Error("Workout access is disabled in Coach settings.");
      if (deps.connectionKey() !== action.connectionKey) throw new Error("The COROS connection changed. Ask the coach to refresh this review.");
      if (!deps.tools().some(tool => tool.name === action.name)) throw new Error("Reconnect COROS before saving this change.");
      active.add(requestId);
      try {
        if (action.source && digest(await callRead(action.source.request)) !== action.source.digest) throw new Error("This workout changed since the preview. Ask the coach to read it again before editing or scheduling it.");
        if (deps.connectionKey() !== action.connectionKey || !deps.canConfirm(action.claude)) throw new Error("The COROS connection or workout access changed. Ask the coach to refresh this review.");
        action.preview.state = "saving";
        persist(); // Record dispatch before the remote write, including across app restarts.
        let response: string;
        try { response = await deps.call(action.name, action.args); }
        catch {
          action.preview.state = "uncertain";
          action.preview.message = "COROS did not confirm the save. Check the destination before trying again to avoid a duplicate.";
          persist();
          return structuredClone(action.preview);
        }
        action.preview.state = "saved";
        action.preview.message = "COROS accepted the change.";
        persist();
        // Read back known targets and IDs returned by creates. A failed read must never repeat the write.
        const shortName = action.name.slice(7);
        let read = shortName.startsWith("update") ? action.source?.request : undefined;
        if (shortName === "createSingleWorkout") {
          const id = responseId(response, "workoutId", "Workout ID");
          if (id) read = { name: "queryWorkoutDetails", args: { workoutId: id } };
        } else if (shortName === "createScheduledWorkout" || shortName === "scheduleWorkout") {
          const id = responseId(response, "idInPlan", "idInPlan");
          if (id) read = { name: "queryScheduledWorkoutDetails", args: { date: action.args.date, idInPlan: id } };
        } else if (shortName === "createTrainingPlan") {
          const id = responseId(response, "planId", "Plan ID");
          if (id) read = { name: "queryTrainingPlanDetails", args: { planId: id } };
        }
        try {
          if (read) { await callRead(read); action.preview.message += " The saved item is available to read."; }
          else action.preview.message += " Refresh the destination to inspect the saved workout.";
        } catch { action.preview.message += " Read-back is temporarily unavailable; do not save it again."; }
        persist();
        return structuredClone(action.preview);
      } finally { active.delete(requestId); }
    }
  };
}
