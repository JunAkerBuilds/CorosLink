import type { Muscle, MuscleState, Strength } from "../strength";

const m = (name: string, note: string, fatigue: number, state: MuscleState): Muscle => ({ name, note, fatigue, state });

export const SAMPLE_STRENGTH: Strength = {
  suggestion: {
    title: "Push day",
    text: "Chest, shoulders and triceps are ready. Six exercises, about 50 minutes, built from what you lifted in the last six months. Plan it here and log it in the app at the gym.",
    figureAlt: "The muscle figure's torso, close up, with chest, shoulders and triceps lit in ember",
  },
  muscles: [
    m("Chest", "Ready", 12, "ready"), m("Shoulders", "Ready", 15, "ready"), m("Triceps", "Ready", 14, "ready"),
    m("Biceps", "Ready tonight", 31, "recovering"), m("Forearms", "Ready", 16, "ready"), m("Abs", "Ready", 6, "ready"),
    m("Obliques", "Ready", 4, "ready"), m("Traps", "Ready", 18, "ready"), m("Lats", "Ready in 1 day", 44, "recovering"),
    m("Upper back", "Ready in 1 day", 38, "recovering"), m("Lower back", "Ready", 11, "ready"), m("Glutes", "Ready", 13, "ready"),
    m("Abductors", "Ready", 7, "ready"), m("Quads", "Ready", 19, "ready"), m("Hamstrings", "Ready", 17, "ready"),
    m("Adductors", "Ready", 5, "ready"), m("Calves", "Not trained in 16 days", 0, "overdue"),
  ],
  ranges: [
    { key: "4w", label: "4 weeks", per: "week", totals: [4.0, 4.6, 4.7, 5.4], change: "+17%", workouts: 8, sets: 150, hours: 6.2 },
    {
      key: "12w", label: "12 weeks", per: "week",
      totals: [3.1, 3.4, 3.2, 3.8, 3.6, 4.1, 3.9, 4.4, 4.0, 4.6, 4.7, 5.4],
      change: "+12%", workouts: 22, sets: 412, hours: 17.3,
    },
    {
      key: "year", label: "Year", per: "month",
      totals: [11.8, 12.4, 13.1, 12.2, 13.9, 14.6, 13.8, 15.2, 15.9, 16.4, 17.1, 18.7],
      change: "+21%", workouts: 94, sets: 1760, hours: 73.9,
    },
  ],
  lifts: [
    { name: "Squat", bestKg: 102.5, note: "New best, +2.5 kg", history: [90, 90, 92.5, 92.5, 95, 95, 97.5, 97.5, 100, 100, 100, 102.5] },
    { name: "Bench press", bestKg: 77.5, note: "+2.5 kg in 12 weeks", history: [72.5, 72.5, 75, 75, 75, 75, 75, 77.5, 75, 77.5, 77.5, 77.5] },
    { name: "Deadlift", bestKg: 130, note: "+5 kg in 12 weeks", history: [120, 120, 122.5, 125, 125, 125, 127.5, 127.5, 127.5, 130, 130, 130] },
    { name: "Overhead press", bestKg: 50, note: "Holding for 5 weeks", history: [45, 45, 47.5, 47.5, 47.5, 50, 50, 50, 50, 50, 50, 50] },
  ],
  workouts: [
    { date: "Tue 17 Nov", name: "Upper body", top: "Bench press 77.5 kg × 5 · Row 70 kg × 8 · Pull-up +10 kg × 6", sets: 18, liftedKg: 5420, seconds: 2890 },
    { date: "Wed 11 Nov", name: "Lower body", top: "Squat 102.5 kg × 3 · Romanian deadlift 90 kg × 8", sets: 20, liftedKg: 8960, seconds: 2692 },
    { date: "Sat 7 Nov", name: "Lower body", top: "Deadlift 130 kg × 3 · Split squat 40 kg × 10", sets: 19, liftedKg: 8410, seconds: 2780 },
    { date: "Tue 3 Nov", name: "Upper body", top: "Overhead press 50 kg × 5 · Bench press 75 kg × 6", sets: 18, liftedKg: 5180, seconds: 2825 },
    { date: "Sat 31 Oct", name: "Lower body", top: "Squat 100 kg × 4 · Leg press 180 kg × 10", sets: 20, liftedKg: 8730, seconds: 2740 },
  ],
};
