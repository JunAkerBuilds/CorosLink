import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Generate a training plan · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
