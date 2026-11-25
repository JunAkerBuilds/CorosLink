import type { Metadata } from "next";
import "../body.css";

export const metadata: Metadata = { title: { absolute: "Body Alert · C-LINK" } };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
