import type { Metadata } from "next";
import "./health.css";
import "./sleep/sleep.css";

export const metadata: Metadata = { title: "Health" };

export default function HealthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
