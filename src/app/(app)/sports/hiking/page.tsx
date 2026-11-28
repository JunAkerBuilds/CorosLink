"use client";
import { SportScreen } from "@/components/sports/SportScreen";
import { t } from "@/lib/i18n";
import "../sports.css";

export default function HikingPage() {
  return <SportScreen family="hike" name={t("Hiking")} />;
}
