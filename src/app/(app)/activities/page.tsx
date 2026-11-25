"use client";
import { Suspense } from "react";
import { ActivitiesScreen } from "@/components/activities/ActivitiesScreen";

export default function ActivitiesPage() {
  // The table reads its filters from the URL, which is only known in the browser.
  return (
    <Suspense fallback={<main className="page"><h1 className="h1">Activities</h1><div className="skeleton" style={{ minHeight: 420 }} /></main>}>
      <ActivitiesScreen />
    </Suspense>
  );
}
