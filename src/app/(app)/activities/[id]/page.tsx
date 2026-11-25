"use client";
import { useParams } from "next/navigation";
import { ActivityScreen } from "@/components/activities/ActivityScreen";

export default function ActivityPage() {
  const { id } = useParams<{ id: string }>();
  const key = decodeURIComponent(id);
  return <ActivityScreen key={key} id={key} />;
}
