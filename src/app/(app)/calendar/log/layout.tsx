import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Log activity · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
