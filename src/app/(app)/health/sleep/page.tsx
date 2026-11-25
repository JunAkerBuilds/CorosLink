"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { SleepLoading } from "@/components/sleep/common";
import { NightView } from "@/components/sleep/NightView";
import { useLoaded } from "@/data/core";
import { loadSleep } from "@/data/sleep";

export default function SleepNightPage() {
  return (
    <main className="page">
      <Suspense fallback={<SleepLoading label="Sleep" state={{ status: "loading" }} />}><Night /></Suspense>
    </main>
  );
}

function Night() {
  const params = useSearchParams();
  const state = useLoaded(loadSleep);
  if (state.status !== "ready") return <SleepLoading label="Sleep" state={state} />;
  return <NightView key={params.get("night") ?? ""} data={state.data} origin={state.origin} initialDay={params.get("night")} />;
}
