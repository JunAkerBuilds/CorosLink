import {
  normalizeWorkoutExerciseName,
  workoutExerciseId,
  workoutExerciseName,
  workoutExerciseNameSimilarity
} from "./workoutCapabilities";

export const EXERCISE_SEARCH_MUSCLES = [
  "neck",
  "traps",
  "shoulders",
  "chest",
  "lats",
  "biceps",
  "triceps",
  "forearms",
  "abs",
  "obliques",
  "lower_back",
  "glutes",
  "quads",
  "hamstrings",
  "adductors",
  "calves"
] as const;

export type ExerciseSearchMuscle = (typeof EXERCISE_SEARCH_MUSCLES)[number];

export const EXERCISE_SEARCH_MOVEMENTS = [
  "push",
  "pull",
  "squat",
  "hinge",
  "lunge",
  "core",
  "carry",
  "conditioning",
  "mobility",
  "climb"
] as const;

export type ExerciseSearchMovement = (typeof EXERCISE_SEARCH_MOVEMENTS)[number];

export const EXERCISE_SEARCH_EQUIPMENT = [
  "bodyweight",
  "machine",
  "dumbbell",
  "barbell",
  "cable",
  "resistance_band",
  "kettlebell",
  "medicine_ball",
  "exercise_ball",
  "suspension",
  "bosu",
  "sled",
  "rope"
] as const;

export type ExerciseSearchEquipment = (typeof EXERCISE_SEARCH_EQUIPMENT)[number];

export interface WorkoutExerciseSearchInput {
  query?: string;
  targetMuscles?: readonly ExerciseSearchMuscle[];
  movementPatterns?: readonly ExerciseSearchMovement[];
  equipment?: readonly ExerciseSearchEquipment[];
  limit?: number;
}

export interface WorkoutExerciseSearchResult {
  id: string;
  name: string;
  targetMuscles: ExerciseSearchMuscle[];
  movementPatterns: ExerciseSearchMovement[];
  equipment: ExerciseSearchEquipment[];
  relevance: number;
  matchReasons: string[];
}

interface ExerciseClassification {
  targetMuscles: ExerciseSearchMuscle[];
  movementPatterns: ExerciseSearchMovement[];
  equipment: ExerciseSearchEquipment[];
}

interface MuscleRule {
  match: RegExp;
  muscles: readonly ExerciseSearchMuscle[];
}

const MUSCLE_RULES: readonly MuscleRule[] = [
  { match: /neck resistance|neck bridge|press the neck|head harness/, muscles: ["neck"] },
  { match: /shrug|upright row/, muscles: ["traps"] },
  { match: /wrist|farmer|hangboard|grip|bar hangs?/, muscles: ["forearms"] },
  { match: /calf|tibialis|ankle eversion|ankle inversion|jump rope|skipping rope/, muscles: ["calves"] },
  { match: /adductor|inner thigh|hip adduction|copenhagen/, muscles: ["adductors"] },
  { match: /oblique|side bend|russian twist|wood ?chop|rotation|side plank|windmill/, muscles: ["obliques", "abs"] },
  { match: /crunch|sit up|leg raise|v up|v sit|l sit|dead bug|ab wheel|plank|mountain climber|knee tuck/, muscles: ["abs"] },
  { match: /back extension|hyperexten|good morning|superman|bird dog/, muscles: ["lower_back", "glutes", "hamstrings"] },
  { match: /deadlift|leg curl|nordic hamstring|pull through|kettlebell swing/, muscles: ["hamstrings", "glutes", "lower_back"] },
  { match: /hip thrust|glute bridge|glute kickback|donkey kick|hip extension|clamshell|hip abduction|lateral band walk/, muscles: ["glutes", "hamstrings"] },
  { match: /squat|leg press|leg extension|lunge|step up|box jump|wall sit|high knee/, muscles: ["quads", "glutes", "hamstrings"] },
  { match: /bench press|chest press|floor press|pec deck|chest fly|dumbbell fly|cable fly|crossover|push up|\bdips?\b|pullover/, muscles: ["chest", "triceps", "shoulders"] },
  { match: /pull up|chin up|pulldown|pull down|\brows?\b|pullover|back fly/, muscles: ["lats", "biceps", "forearms"] },
  { match: /face pull|reverse fly|rear delt|lateral raise|front raise|shoulder press|military press|arnold press|overhead press|seated front press|upright row|battle rope/, muscles: ["shoulders", "triceps", "traps"] },
  { match: /tricep|pushdown|skull ?crusher|kickback/, muscles: ["triceps"] },
  { match: /bicep|\bcurls?\b|preacher/, muscles: ["biceps", "forearms"] },
  { match: /burpee|thruster|snatch|power clean|turkish get up|wallball/, muscles: ["quads", "glutes", "shoulders", "chest", "abs"] }
];

const MOVEMENT_RULES: readonly {
  match: RegExp;
  movement: ExerciseSearchMovement;
}[] = [
  { match: /stretch|foam roll|warm ?up|cool down|mobility|cat cow|balance/, movement: "mobility" },
  { match: /climb|hangboard|crimp|bar hangs?/, movement: "climb" },
  { match: /farmer|carry|walk with/, movement: "carry" },
  { match: /crunch|sit up|leg raise|v up|plank|rotation|wood ?chop|side bend|dead bug|ab wheel|bird dog/, movement: "core" },
  { match: /lunge|step up|step down/, movement: "lunge" },
  { match: /deadlift|good morning|hip thrust|glute bridge|leg curl|nordic|pull through|kettlebell swing|back extension|hyperexten/, movement: "hinge" },
  { match: /squat|leg press|leg extension|wall sit/, movement: "squat" },
  { match: /pull up|chin up|pulldown|pull down|\brows?\b|face pull|reverse fly|back fly|shrug|\bcurls?\b|preacher/, movement: "pull" },
  { match: /press|push up|\bdips?\b|fly|crossover|pushdown|tricep|lateral raise|front raise/, movement: "push" },
  { match: /burpee|jump|battle rope|skipping rope|jump rope|sled|wallball|thruster|snatch|clean/, movement: "conditioning" }
];

const EQUIPMENT_RULES: readonly {
  match: RegExp;
  equipment: ExerciseSearchEquipment;
}[] = [
  { match: /dumbbell/, equipment: "dumbbell" },
  { match: /smith machine|\bmachine\b|pec deck|leg press|leg extension|leg curl|thigh abduct|thigh adduct|hack squat/, equipment: "machine" },
  { match: /barbell|t bar/, equipment: "barbell" },
  { match: /cable|pulley|pushdown|crossover/, equipment: "cable" },
  { match: /resistance band|with bands?|banded|band walk/, equipment: "resistance_band" },
  { match: /kettlebell/, equipment: "kettlebell" },
  { match: /medicine ball|ball throw|ball slam|wallball/, equipment: "medicine_ball" },
  { match: /exercise ball/, equipment: "exercise_ball" },
  { match: /trx|suspended/, equipment: "suspension" },
  { match: /bosu/, equipment: "bosu" },
  { match: /sled/, equipment: "sled" },
  { match: /battle rope|skipping rope|jump rope/, equipment: "rope" },
  { match: /push up|pull up|chin up|sit up|crunch|plank|burpee|mountain climber|\bdips?\b|leg raise|jumping jack/, equipment: "bodyweight" }
];

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function classifyWorkoutExerciseName(name: string): ExerciseClassification {
  const normalized = normalizeWorkoutExerciseName(name);
  return {
    targetMuscles: unique(
      MUSCLE_RULES.filter((rule) => rule.match.test(normalized)).flatMap((rule) => rule.muscles)
    ),
    movementPatterns: unique(
      MOVEMENT_RULES.filter((rule) => rule.match.test(normalized)).map((rule) => rule.movement)
    ),
    equipment: unique(
      EQUIPMENT_RULES.filter((rule) => rule.match.test(normalized)).map((rule) => rule.equipment)
    )
  };
}

function overlapCount<T>(left: readonly T[], right: ReadonlySet<T>): number {
  return left.filter((value) => right.has(value)).length;
}

export function searchWorkoutExerciseCatalog(
  catalog: readonly Record<string, unknown>[],
  input: WorkoutExerciseSearchInput
): WorkoutExerciseSearchResult[] {
  const query = input.query?.trim() ?? "";
  const requestedMuscles = new Set(input.targetMuscles ?? []);
  const requestedMovements = new Set(input.movementPatterns ?? []);
  const requestedEquipment = new Set(input.equipment ?? []);
  const limit = Math.min(12, Math.max(1, Math.round(input.limit ?? 8)));

  const results = catalog.flatMap((row) => {
    const id = workoutExerciseId(row);
    const name = workoutExerciseName(row);
    if (!id || !name) return [];
    const classification = classifyWorkoutExerciseName(name);
    const muscleMatches = overlapCount(classification.targetMuscles, requestedMuscles);
    const movementMatches = overlapCount(classification.movementPatterns, requestedMovements);
    const equipmentMatches = overlapCount(classification.equipment, requestedEquipment);
    const nameSimilarity = query ? workoutExerciseNameSimilarity(query, name) : 0;

    if (requestedMuscles.size > 0 && muscleMatches === 0) return [];
    if (requestedMovements.size > 0 && movementMatches === 0) return [];
    if (requestedEquipment.size > 0 && equipmentMatches === 0) return [];
    if (
      query &&
      nameSimilarity < 0.22 &&
      requestedMuscles.size === 0 &&
      requestedMovements.size === 0
    ) {
      return [];
    }

    const reasons = [
      nameSimilarity === 1
        ? "same words as requested"
        : nameSimilarity >= 0.6
          ? "strong name match"
          : nameSimilarity >= 0.22
            ? "related name"
            : undefined,
      muscleMatches > 0
        ? `targets ${classification.targetMuscles.filter((muscle) => requestedMuscles.has(muscle)).join(", ")}`
        : undefined,
      movementMatches > 0
        ? `${classification.movementPatterns.filter((movement) => requestedMovements.has(movement)).join(", ")} movement`
        : undefined,
      equipmentMatches > 0
        ? `uses ${classification.equipment.filter((item) => requestedEquipment.has(item)).join(", ")}`
        : undefined
    ].filter((reason): reason is string => Boolean(reason));

    return [{
      id,
      name,
      ...classification,
      relevance:
        nameSimilarity * 100 + muscleMatches * 18 + movementMatches * 14 + equipmentMatches * 12,
      matchReasons: reasons
    }];
  });

  return [...new Map(results.map((result) => [result.id, result])).values()]
    .sort((left, right) => right.relevance - left.relevance || left.name.localeCompare(right.name))
    .slice(0, limit)
    .map((result) => ({ ...result, relevance: Math.round(result.relevance) }));
}
