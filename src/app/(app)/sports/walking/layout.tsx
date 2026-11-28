import type { Metadata } from "next";

export const metadata: Metadata = { title: "Walking" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
