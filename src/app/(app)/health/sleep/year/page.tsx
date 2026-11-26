"use client";
import { SleepLoading } from "@/components/sleep/common";
import { YearView } from "@/components/sleep/YearView";
import { useLoaded } from "@/data/core";
import { loadSleep } from "@/data/sleep";
import { t } from "@/lib/i18n";

export default function SleepYearPage() {
  const state = useLoaded(loadSleep);
  return (
    <main className="page">
      {state.status !== "ready" ? <SleepLoading label={t("Sleep")} state={state} /> : <YearView data={state.data} origin={state.origin} />}
    </main>
  );
}
