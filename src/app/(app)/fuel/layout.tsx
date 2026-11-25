import type { Metadata } from "next";

export const metadata: Metadata = { title: { absolute: "Fuel · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
