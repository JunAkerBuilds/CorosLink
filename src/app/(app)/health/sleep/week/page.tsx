"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SleepLoading } from "@/components/sleep/common";
import { PeriodView } from "@/components/sleep/PeriodView";
import { useLoaded } from "@/data/core";
import { loadSleep } from "@/data/sleep";
import { t } from "@/lib/i18n";

export default function SleepWeekPage() {
  return (
    <main className="page">
      <Suspense fallback={<SleepLoading label={t("Sleep")} state={{ status: "loading" }} />}><Week /></Suspense>
    </main>
  );
}

function Week() {
  const params = useSearchParams();
  const state = useLoaded(loadSleep);
  if (state.status !== "ready") return <SleepLoading label={t("Sleep")} state={state} />;
  const at = params.get("at");
  return <PeriodView key={at ?? ""} data={state.data} origin={state.origin} range="week" initialAt={at} />;
}
