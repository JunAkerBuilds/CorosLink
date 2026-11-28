"use client";
import { SportScreen } from "@/components/sports/SportScreen";
import { t } from "@/lib/i18n";
import "../sports.css";

export default function ClimbingPage() {
  return <SportScreen family="climb" name={t("Climbing")} />;
}
