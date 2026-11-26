"use client";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { LoadError, LoadingPage } from "@/components/training/LoadStates";
import { PlanEditor } from "@/components/training/PlanEditor";
import { LinkButton } from "@/components/ui";
import { useLoaded } from "@/data/core";
import { loadPlanEditor } from "@/data/plans";
import { createTrainingPlan } from "@/lib/plan";
import "../plans.css";
import { t } from "@/lib/i18n";

export default function PlanEditorPage() {
  return (
    <Suspense fallback={<LoadingPage label={t("Plan editor")} />}>
      <EditorScreen />
    </Suspense>
  );
}

function EditorScreen() {
  const params = useSearchParams();
  const id = params.get("id"), draft = params.get("draft") === "1" && !id;
  // One blank plan for as long as this page is open, so re-reading the data never swaps it for another.
  const [blank] = useState(() => createTrainingPlan());
  const state = useLoaded(() => loadPlanEditor({ id, draft, blank }), `${id ?? ""}|${draft}`);

  if (state.status === "loading") return <LoadingPage label={t("Plan editor")} />;
  if (state.status === "error") return <LoadError error={state.error}><LinkButton href="/calendar/plans">{t("Back to Plans")}</LinkButton></LoadError>;
  // Keyed by the plan, so saving a new plan (same id) keeps the editor and its undo history.
  return <PlanEditor key={state.data.plan.id} initial={state.data} origin={state.origin} draft={draft} />;
}
