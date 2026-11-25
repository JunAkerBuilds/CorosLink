"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SleepLoading } from "@/components/sleep/common";
import { PeriodView } from "@/components/sleep/PeriodView";
import { useLoaded } from "@/data/core";
import { loadSleep } from "@/data/sleep";

export default function SleepMonthPage() {
  return (
    <main className="page">
      <Suspense fallback={<SleepLoading label="Sleep" state={{ status: "loading" }} />}><Month /></Suspense>
    </main>
  );
}

function Month() {
  const params = useSearchParams();
  const state = useLoaded(loadSleep);
  if (state.status !== "ready") return <SleepLoading label="Sleep" state={state} />;
  const at = params.get("at");
  return <PeriodView key={at ?? ""} data={state.data} origin={state.origin} range="month" initialAt={at} />;
}
