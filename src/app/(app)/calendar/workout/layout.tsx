import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Structured workout · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
