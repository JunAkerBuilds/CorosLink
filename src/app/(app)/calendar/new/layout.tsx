import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Add to calendar · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
