"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { WorkoutBuilder } from "@/components/training/WorkoutBuilder";
import { LinkButton } from "@/components/ui";
import { useLoaded } from "@/data/core";
import { loadWorkoutBuilder } from "@/data/workouts";
import "../training.css";
import { t } from "@/lib/i18n";

export default function WorkoutPage() {
  return (
    <Suspense fallback={<LoadingPage label={t("Workout builder")} />}>
      <WorkoutScreen />
    </Suspense>
  );
}

function WorkoutScreen() {
  const params = useSearchParams();
  const id = params.get("id"), date = params.get("date"), sport = params.get("sport"), library = params.get("library");
  const state = useLoaded(() => loadWorkoutBuilder({ id, date, sport, library }), [id, date, sport, library].join("|"));

  if (state.status === "loading") return <LoadingPage label={t("Workout builder")} />;
  if (state.status === "error") {
    return <LoadError error={state.error}><LinkButton href="/calendar">{t("Back to the calendar")}</LinkButton></LoadError>;
  }
  // Keyed by what was asked for, so opening another workout starts the editor afresh.
  return <WorkoutBuilder key={[id, date, sport, library].join("|")} initial={state.data} origin={state.origin} />;
}
