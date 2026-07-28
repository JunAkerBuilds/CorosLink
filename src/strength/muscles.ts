/**
 * Muscle taxonomy for the Strength view.
 *
 * COROS records an exercise key per set (`T####`/`S####` catalogue codes, or a
 * free-text name for user-defined exercises) but never says which muscles the
 * movement works. This module resolves a display name — the same one
 * `resolveExerciseName` produces — into weighted muscle activations, so a
 * session's sets can be attributed to the body map.
 *
 * Matching is name-based rather than code-based on purpose: custom exercises
 * only ever carry a name, and the rules then cover them for free.
 */

export type MuscleId =
  | "neck"
  | "traps"
  | "shoulders"
  | "chest"
  | "lats"
  | "biceps"
  | "triceps"
  | "forearms"
  | "abs"
  | "obliques"
  | "lowerBack"
  | "glutes"
  | "quads"
  | "hamstrings"
  | "adductors"
  | "calves";

/** Which side of the figure a muscle is drawn on. */
export type MuscleView = "front" | "back" | "both";

export type MuscleRegion = "upper" | "core" | "lower";

export interface MuscleMeta {
  id: MuscleId;
  label: string;
  /** Anatomical name, shown as a subtitle in the muscle detail. */
  anatomy: string;
  view: MuscleView;
  region: MuscleRegion;
  /** Push / pull / squat-style classification, for the balance readouts. */
  pattern: "push" | "pull" | "legs" | "core";
}

export const MUSCLES: MuscleMeta[] = [
  {
    id: "neck",
    label: "Neck",
    anatomy: "Sternocleidomastoid",
    view: "both",
    region: "upper",
    pattern: "pull"
  },
  {
    id: "traps",
    label: "Traps",
    anatomy: "Trapezius",
    view: "both",
    region: "upper",
    pattern: "pull"
  },
  {
    id: "shoulders",
    label: "Shoulders",
    anatomy: "Deltoids",
    view: "both",
    region: "upper",
    pattern: "push"
  },
  {
    id: "chest",
    label: "Chest",
    anatomy: "Pectoralis major",
    view: "front",
    region: "upper",
    pattern: "push"
  },
  {
    id: "lats",
    label: "Back",
    anatomy: "Latissimus dorsi & rhomboids",
    view: "back",
    region: "upper",
    pattern: "pull"
  },
  {
    id: "biceps",
    label: "Biceps",
    anatomy: "Biceps brachii",
    view: "front",
    region: "upper",
    pattern: "pull"
  },
  {
    id: "triceps",
    label: "Triceps",
    anatomy: "Triceps brachii",
    view: "back",
    region: "upper",
    pattern: "push"
  },
  {
    id: "forearms",
    label: "Forearms",
    anatomy: "Flexors & extensors",
    view: "both",
    region: "upper",
    pattern: "pull"
  },
  {
    id: "abs",
    label: "Abs",
    anatomy: "Rectus abdominis",
    view: "front",
    region: "core",
    pattern: "core"
  },
  {
    id: "obliques",
    label: "Obliques",
    anatomy: "External obliques",
    view: "front",
    region: "core",
    pattern: "core"
  },
  {
    id: "lowerBack",
    label: "Lower back",
    anatomy: "Erector spinae",
    view: "back",
    region: "core",
    pattern: "core"
  },
  {
    id: "glutes",
    label: "Glutes",
    anatomy: "Gluteus maximus & medius",
    view: "back",
    region: "lower",
    pattern: "legs"
  },
  {
    id: "quads",
    label: "Quads",
    anatomy: "Quadriceps femoris",
    view: "front",
    region: "lower",
    pattern: "legs"
  },
  {
    id: "hamstrings",
    label: "Hamstrings",
    anatomy: "Biceps femoris",
    view: "back",
    region: "lower",
    pattern: "legs"
  },
  {
    id: "adductors",
    label: "Adductors",
    anatomy: "Inner thigh",
    view: "front",
    region: "lower",
    pattern: "legs"
  },
  {
    id: "calves",
    label: "Calves",
    anatomy: "Gastrocnemius & soleus",
    view: "both",
    region: "lower",
    pattern: "legs"
  }
];

export const MUSCLE_BY_ID: Record<MuscleId, MuscleMeta> = Object.fromEntries(
  MUSCLES.map((muscle) => [muscle.id, muscle])
) as Record<MuscleId, MuscleMeta>;

export interface MuscleActivation {
  muscle: MuscleId;
  /** Share of the set credited to this muscle; the list sums to 1. */
  share: number;
}

export interface ExerciseTargets {
  activations: MuscleActivation[];
  /** Stretching, foam rolling and warm-up drills carry no training credit. */
  mobility: boolean;
}

interface MuscleRule {
  match: RegExp;
  primary?: MuscleId[];
  secondary?: MuscleId[];
  mobility?: boolean;
}

/** A secondary muscle earns this fraction of a primary's credit. */
const SECONDARY_WEIGHT = 0.45;

/**
 * First match wins, so the list runs specific → general. Where a broad rule
 * would swallow a movement that belongs elsewhere ("Plank Row" is a back
 * exercise, "Pike Push Up" is a shoulder press), the exception sits above it.
 */
const MUSCLE_RULES: MuscleRule[] = [
  // ---- Body regions reported by unstructured (free) strength sessions ----
  { match: /^full body$/, primary: ["chest", "lats", "quads", "glutes"], secondary: ["shoulders", "abs", "hamstrings"] },
  { match: /^shoulders$/, primary: ["shoulders"], secondary: ["traps"] },
  { match: /^arms$/, primary: ["biceps", "triceps"], secondary: ["forearms"] },
  { match: /^chest$/, primary: ["chest"], secondary: ["triceps", "shoulders"] },
  { match: /^back$/, primary: ["lats"], secondary: ["traps", "lowerBack", "biceps"] },
  { match: /^abs$/, primary: ["abs"], secondary: ["obliques"] },
  { match: /^legs (and )?hips$/, primary: ["quads", "glutes"], secondary: ["hamstrings", "calves"] },

  // ---- Mobility, warm-ups and filler laps ----
  { match: /\bstretch(es|ing)?\b/, mobility: true },
  {
    match:
      /foam rolling|foot rolling|\bwarm ?up\b|cool down|^rest$|^training$|stick warmup|cat cow|knee hug|frog pose|thoracic spine rotation|standing forward bend|leg swing|prone hip circles|balance|single leg hold|^power point$|^lucky cat$|^[abc] skips$/,
    mobility: true
  },

  // ---- Neck ----
  { match: /neck resistance|neck bridge|press the neck|head harness/, primary: ["neck"] },

  // ---- Grip and forearms ----
  { match: /wrist curl|wrist roller|open hand grip|half crimp|fingertip/, primary: ["forearms"] },
  { match: /farmers walk/, primary: ["forearms", "traps"], secondary: ["abs", "quads"] },
  { match: /hangboard|one arm bar hangs|hang with|slope hang/, primary: ["forearms", "lats"], secondary: ["abs"] },
  { match: /reverse curl/, primary: ["forearms", "biceps"] },

  // ---- Traps ----
  { match: /shrug/, primary: ["traps"], secondary: ["forearms"] },
  { match: /upright row/, primary: ["traps", "shoulders"], secondary: ["biceps"] },

  // ---- Calves ----
  { match: /calf raise|calves raise|tibialis|ankle eversion|ankle inversion/, primary: ["calves"] },
  { match: /skipping rope|jump rope|straight leg hops|single leg hops/, primary: ["calves"], secondary: ["quads"] },

  // ---- Core ----
  { match: /copenhagen plank/, primary: ["adductors", "obliques"] },
  { match: /plank row/, primary: ["lats", "abs"], secondary: ["biceps"] },
  { match: /plank push up/, primary: ["chest", "abs"], secondary: ["triceps"] },
  {
    match:
      /oblique|side bend|russian twist|windshield wiper|wood ?chop|trunk rotation|side plank|cable rotation|twist throw|windmill|standing knee to elbow|plank with rotation|side bridge/,
    primary: ["obliques"],
    secondary: ["abs"]
  },
  {
    match:
      /crunch|sit ups?|leg raise toe to bar|hanging leg raise|incline leg raise|upright leg raise|seated leg raise|v ups|v sit|l sit|dead bug|ab wheel|abdominal fallout|knee tucks|scissors kick|plank jacks|saw plank|buzzsaw|mountain climber|exercise ball pull in|exercise ball circles|leg raise/,
    primary: ["abs"]
  },
  { match: /\bplanks?\b/, primary: ["abs"], secondary: ["shoulders", "obliques"] },
  { match: /bird dog/, primary: ["lowerBack", "abs"], secondary: ["glutes"] },
  { match: /anti rotation(al)?/, primary: ["abs", "obliques"], secondary: ["shoulders"] },

  // ---- Lower back ----
  {
    match: /back extension|hyperexten|good morning|prone cobra|supine cobra|superman/,
    primary: ["lowerBack"],
    secondary: ["glutes", "hamstrings"]
  },

  // ---- Hip hinge ----
  {
    match: /deadlift/,
    primary: ["hamstrings", "glutes"],
    secondary: ["lowerBack", "traps", "forearms"]
  },
  { match: /inverse nordic/, primary: ["quads"] },
  { match: /leg curl|nordic hamstring|standing hamstring/, primary: ["hamstrings"] },
  { match: /cable pull through/, primary: ["glutes", "hamstrings"], secondary: ["lowerBack"] },

  // ---- Glutes and hips ----
  {
    match:
      /hip thrust|glute bridge|glute kickback|donkey kick|reverse kickback|hip bridge|single leg bridge|exercise ball bridges|buttocks lift|^bridge$|hip extension/,
    primary: ["glutes"],
    secondary: ["hamstrings"]
  },
  {
    match: /clamshell|hip abduction|lateral band walk|thigh abductor|side leg raise/,
    primary: ["glutes"],
    secondary: ["adductors"]
  },
  { match: /adductor|inner thigh|hip adduction/, primary: ["adductors"] },
  { match: /hip flexion/, primary: ["quads"], secondary: ["abs"] },

  // ---- Squat and lunge ----
  {
    match: /sumo squat|lateral squat|side squat|curtsey squat/,
    primary: ["quads", "glutes", "adductors"],
    secondary: ["hamstrings"]
  },
  {
    match: /squat/,
    primary: ["quads", "glutes"],
    secondary: ["hamstrings", "lowerBack", "abs"]
  },
  { match: /lunge/, primary: ["quads", "glutes"], secondary: ["hamstrings", "calves"] },
  { match: /leg extension/, primary: ["quads"] },
  { match: /leg press/, primary: ["quads", "glutes"], secondary: ["hamstrings"] },
  {
    match: /step ups?|box jump|squat jump|jump squat|wall sit|high knee|knee drive|step down/,
    primary: ["quads", "glutes"],
    secondary: ["calves"]
  },

  // ---- Horizontal and vertical press ----
  { match: /pike push up|handstand/, primary: ["shoulders"], secondary: ["triceps", "abs"] },
  { match: /push press/, primary: ["shoulders"], secondary: ["quads", "triceps"] },
  {
    match: /close grip (bench|dumbbell bench)|diamond push up|close grip push up/,
    primary: ["triceps"],
    secondary: ["chest", "shoulders"]
  },
  {
    match: /bench press|chest press|floor press|pec deck|chest flys?|dumbbell flys|cable flys|cable crossover|suspended chest flys/,
    primary: ["chest"],
    secondary: ["triceps", "shoulders"]
  },
  { match: /push ?ups?/, primary: ["chest"], secondary: ["triceps", "shoulders", "abs"] },
  { match: /\bdips?\b/, primary: ["chest", "triceps"], secondary: ["shoulders"] },
  { match: /pullover/, primary: ["lats", "chest"], secondary: ["triceps"] },

  // ---- Pulls ----
  { match: /indoor rower|skierg|sledpull/, primary: ["lats", "quads"], secondary: ["hamstrings", "abs"] },
  {
    match: /pull ?ups?|chin ?ups?|pulldowns?|pull down|scap pulls?|^archer/,
    primary: ["lats"],
    secondary: ["biceps", "forearms"]
  },
  {
    match: /face pull|reverse fly|rear delt|prone [ytwai]s|external rotation/,
    primary: ["shoulders"],
    secondary: ["traps", "lats"]
  },
  { match: /back flys/, primary: ["lats"], secondary: ["shoulders"] },
  { match: /\brows?\b/, primary: ["lats"], secondary: ["biceps", "forearms", "lowerBack"] },

  // ---- Shoulders ----
  {
    match:
      /lateral (dumbbell )?raise|front raise|front arm raise|shoulder press|military press|arnold press|behind the neck press|seated front press|banded press|overhead press|plate halo|ball slam|ball throw|overhead ball|rainbow slam/,
    primary: ["shoulders"],
    secondary: ["triceps", "traps"]
  },

  // ---- Arms ----
  { match: /tricep|pushdown|skull ?crusher|kickback/, primary: ["triceps"] },
  { match: /curl/, primary: ["biceps"], secondary: ["forearms"] },

  // ---- Full-body and conditioning ----
  { match: /burpee/, primary: ["quads", "chest"], secondary: ["abs", "shoulders"] },
  {
    match: /snatch|power clean|\bclean\b|thruster|turkish get up|kettlebell swing|wallball/,
    primary: ["glutes", "shoulders", "quads"],
    secondary: ["hamstrings", "lowerBack", "traps"]
  },
  { match: /battle rope|sledpush/, primary: ["shoulders", "abs"], secondary: ["quads", "forearms"] },
  { match: /kickboxing|kickbox/, primary: ["quads", "abs"], secondary: ["shoulders", "obliques"] },
  { match: /leg lifts?/, primary: ["glutes", "quads"], secondary: ["abs"] },
  {
    match: /\brun\b|running|incline walking|ski step|\btrot\b|back and forth step/,
    primary: ["quads", "calves"],
    secondary: ["hamstrings", "glutes"]
  },
  { match: /jumping jacks|crawl|bounce a boat|wheel run|bounding|jump/, primary: ["quads", "calves"], secondary: ["abs"] }
];

/** Lowercase, drop punctuation, collapse whitespace. */
function normalizeExerciseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const targetsCache = new Map<string, ExerciseTargets>();

const NO_TARGETS: ExerciseTargets = { activations: [], mobility: false };

/**
 * Resolve a display exercise name into weighted muscle activations. Unknown
 * names return no activations rather than a guess, so the body map only ever
 * shows work it can actually account for.
 */
export function resolveExerciseTargets(name: string): ExerciseTargets {
  const normalized = normalizeExerciseName(name);
  if (!normalized) {
    return NO_TARGETS;
  }

  const cached = targetsCache.get(normalized);
  if (cached) {
    return cached;
  }

  const rule = MUSCLE_RULES.find((candidate) => candidate.match.test(normalized));
  let resolved: ExerciseTargets = NO_TARGETS;

  if (rule?.mobility) {
    resolved = { activations: [], mobility: true };
  } else if (rule) {
    const weights = new Map<MuscleId, number>();
    for (const muscle of rule.primary ?? []) {
      weights.set(muscle, (weights.get(muscle) ?? 0) + 1);
    }
    for (const muscle of rule.secondary ?? []) {
      weights.set(muscle, (weights.get(muscle) ?? 0) + SECONDARY_WEIGHT);
    }
    const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
    if (total > 0) {
      resolved = {
        mobility: false,
        activations: [...weights.entries()].map(([muscle, weight]) => ({
          muscle,
          share: weight / total
        }))
      };
    }
  }

  targetsCache.set(normalized, resolved);
  return resolved;
}
