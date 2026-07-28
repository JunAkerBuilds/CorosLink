import { corosSportName } from "./corosSportTypes";
import {
  WORKOUT_SPORT_CAPABILITIES,
  WORKOUT_SPORTS,
  formatIntensityType,
  formatWorkoutSport,
  workoutSportFromType
} from "./workoutCapabilities";
import type {
  TrainingHubActivity,
  TrainingHubDashboard,
  UnitSystem,
  WorkoutSport
} from "./types";
import { formatDistanceValue } from "./unitSystem.js";

export function buildCoachInstructions(): string {
  return (
    "You are a friendly, knowledgeable multi-sport endurance and strength-training coach built " +
    "into CorosLink. You have access to the athlete's recent COROS training data " +
    "below. Give concise, practical, encouraging advice grounded in that data. If " +
    "the data does not cover the question, say so rather than inventing numbers.\n\n" +
    "When building training plans: review the athlete's recent activity mix, recovery, and complete upcoming " +
    "schedule first. Honor every sport the athlete explicitly requests. For a vague request, preserve sports " +
    "demonstrated in their history and use their stated goal to choose the mix; ask one concise clarifying " +
    "question when the goal, intended sports, facilities, or equipment would materially change the plan. " +
    "Never add an unfamiliar sport merely for variety. Balance hard, easy, and rest days across all sports, " +
    "and do not assume an easy ride, swim, or strength workout is automatically a rest day. Use " +
    "draft_training_plan to validate and preview before upload. Always set the workout sport explicitly, " +
    "and always put prescribed heart rate, pace, effort pace, power, cadence, swim stroke, " +
    "weight, RPE, or climbing grade in the step's typed intensity object rather than only " +
    "in its name or prose. Unsupported activity types may inform advice but must not be silently converted " +
    "to another workout sport. In particular, Open Water Swim is not Pool Swim; ask before substituting it. " +
    "Represent triathlon or COROS Multi Sport plans as separate supported workouts. Never call " +
    "upload_training_plan until the athlete confirms via the Upload to COROS button. If " +
    "draft_training_plan returns exercise_resolution_required, update the affected steps to exact COROS " +
    "candidate names and call draft_training_plan again in the same response. Ask the athlete only when " +
    "the candidates materially change the intended movement or no supported candidate is available.\n\n" +
    "To delete workouts: use list_scheduled_workouts to find calendar entries, then " +
    "delete_workout to stage a confirmation card. The athlete must click Delete from COROS — " +
    "never claim a workout was removed until they confirm via the button."
  );
}

export function buildCoachSportCapabilityGuide(): string {
  return WORKOUT_SPORTS.map((sport) => {
    const capability = WORKOUT_SPORT_CAPABILITIES[sport];
    const targets = [...new Set([...capability.targets, ...capability.restTargets])];
    const options = [
      capability.supportsPoolLength ? "poolLength option" : undefined,
      capability.supportsGradingSystem ? "gradingSystem option" : undefined,
      capability.requiresExercise ? "training steps require an exercise" : undefined
    ].filter(Boolean);
    return (
      `- ${capability.label} (sport=${sport}): targets ${targets.join(", ")}; ` +
      `intensities ${capability.intensities.map(formatIntensityType).join(", ")}` +
      (options.length > 0 ? `; ${options.join("; ")}` : "")
    );
  }).join("\n");
}

interface ActivitySportGroup {
  key: string;
  label: string;
  planSport?: WorkoutSport;
  swim: boolean;
}

function activitySportGroup(activity: TrainingHubActivity): ActivitySportGroup {
  const sportType = activity.sportType;
  const sportName = activity.sportName ?? corosSportName(sportType) ?? `Sport type ${sportType}`;
  const normalized = sportName.toLocaleLowerCase();
  let planSport: WorkoutSport | undefined;

  if (sportType === 102 || /trail run/.test(normalized)) planSport = "trailRun";
  else if ([100, 101, 103].includes(sportType) || /\brun\b/.test(normalized)) planSport = "run";
  else if ((sportType >= 200 && sportType <= 299) || /bike|cycl|ride/.test(normalized)) planSport = "bike";
  else if (sportType === 300 || /pool swim/.test(normalized)) planSport = "swim";
  else if (sportType === 402 || /strength/.test(normalized)) planSport = "strength";
  else if (sportType === 502 || /xc ski|cross.?country ski/.test(normalized)) planSport = "xcSki";
  else if (sportType === 800 || /indoor climb/.test(normalized)) planSport = "indoorClimb";
  else if (sportType === 801 || /boulder/.test(normalized)) planSport = "bouldering";
  else if (/hyrox/.test(normalized)) planSport = "hyrox";

  return {
    key: planSport ? `plan:${planSport}` : `activity:${sportType}:${normalized}`,
    label: planSport ? formatWorkoutSport(planSport) : sportName,
    planSport,
    swim: sportType === 300 || sportType === 301 || /swim/.test(normalized)
  };
}

function formatTotalDuration(seconds: number): string {
  const roundedMinutes = Math.round(seconds / 60);
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;
  if (hours <= 0) return `${minutes} min`;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

export function formatRecentActivityMix(
  activities: TrainingHubActivity[],
  unitSystem: UnitSystem
): string {
  const groups = new Map<
    string,
    ActivitySportGroup & { count: number; duration: number; distance: number; trainingLoad: number }
  >();

  for (const activity of activities) {
    const sport = activitySportGroup(activity);
    const current = groups.get(sport.key) ?? {
      ...sport,
      count: 0,
      duration: 0,
      distance: 0,
      trainingLoad: 0
    };
    current.count += 1;
    current.duration += activity.duration ?? 0;
    current.distance += activity.distance ?? 0;
    current.trainingLoad += activity.trainingLoad ?? 0;
    groups.set(sport.key, current);
  }

  return [...groups.values()]
    .sort((left, right) => right.count - left.count || right.duration - left.duration)
    .map((group) => {
      const parts = [
        `${group.count} activit${group.count === 1 ? "y" : "ies"}`,
        group.duration > 0 ? formatTotalDuration(group.duration) : undefined,
        group.distance > 0
          ? formatDistanceValue(group.distance, unitSystem, { swim: group.swim })
          : undefined,
        group.trainingLoad > 0 ? `load ${Math.round(group.trainingLoad)}` : undefined
      ].filter(Boolean);
      const planningNote = group.planSport
        ? `plan sport=${group.planSport}`
        : "not directly plan-authorable";
      return `- ${group.label} (${planningNote}): ${parts.join(" · ")}`;
    })
    .join("\n");
}

export function formatUpcomingWorkoutSport(sportType: number | undefined): string | undefined {
  if (sportType === undefined) return undefined;
  const sport = workoutSportFromType(sportType);
  return sport ? formatWorkoutSport(sport) : `Sport type ${sportType}`;
}

export function formatCoachDashboard(dashboard: TrainingHubDashboard): string {
  const lines: string[] = [];
  if (dashboard.rhr != null) lines.push(`- Resting HR: ${dashboard.rhr} bpm`);
  if (dashboard.recoveryPct != null) lines.push(`- Recovery: ${dashboard.recoveryPct}%`);
  if (dashboard.fullRecoveryHours != null) {
    lines.push(`- Full recovery in ~${dashboard.fullRecoveryHours} h`);
  }
  const predictor = dashboard.racePredictor;
  if (predictor?.staminaLevel != null) {
    lines.push(`- Running stamina level: ${predictor.staminaLevel}`);
  }
  const predictions = (predictor?.runScoreList ?? [])
    .filter((score) => score.distanceLabel && score.predictSeconds)
    .slice(0, 4)
    .map(
      (score) =>
        `${score.distanceLabel} ~${formatClockDuration(score.predictSeconds ?? 0)}`
    );
  if (predictions.length > 0) {
    lines.push(`- Running race predictions: ${predictions.join(", ")}`);
  }
  return lines.join("\n");
}

function formatClockDuration(value: number): string {
  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
