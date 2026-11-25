import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sleep" };

export default function SleepLayout({ children }: { children: React.ReactNode }) {
  return children;
}
