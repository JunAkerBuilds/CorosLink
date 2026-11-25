import type { Metadata } from "next";

export const metadata: Metadata = { title: "Riding" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
