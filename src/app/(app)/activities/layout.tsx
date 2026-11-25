import type { Metadata } from "next";

export const metadata: Metadata = { title: "Activities" };

export default function ActivitiesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
