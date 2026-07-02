"use client";

import { motion } from "motion/react";
import {
  ShieldCheck,
  GitBranch,
  MonitorSmartphone,
  Usb,
  UserX,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

interface Item {
  Icon: LucideIcon;
  title: string;
  body: string;
}

const ITEMS: Item[] = [
  {
    Icon: ShieldCheck,
    title: "Local-first & private",
    body: "Your music, maps, and tokens live on your own machine in SQLite and plain files. Nothing is sent to a CorosLink server — there isn't one.",
  },
  {
    Icon: GitBranch,
    title: "Open source",
    body: "The full app is on GitHub. Read it, build it, contribute — no black boxes.",
  },
  {
    Icon: MonitorSmartphone,
    title: "Cross-platform",
    body: "Native builds for macOS (Apple Silicon), Windows, and Linux.",
  },
  {
    Icon: Usb,
    title: "Direct USB transfer",
    body: "Talks to your watch over the cable — fast, reliable, no phone in the middle.",
  },
  {
    Icon: UserX,
    title: "No account needed",
    body: "Install and go. Sign in to sources only when you actually want them.",
  },
  {
    Icon: RefreshCw,
    title: "Auto-updates",
    body: "In-app updates pulled straight from GitHub Releases keep you current.",
  },
];

export function Highlights() {
  const reduced = usePrefersReducedMotion();

  return (
    <section className="mx-auto max-w-[120rem] px-6 lg:px-12 py-16 md:py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p className="eyebrow">Why CorosLink</p>
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
          Built the way a companion app should be.
        </h2>
      </div>

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {ITEMS.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: reduced ? 0 : 26 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "0px 0px -80px 0px" }}
            transition={{ duration: 0.55, delay: reduced ? 0 : (i % 3) * 0.08, ease: "easeOut" }}
            className="glass-soft group relative overflow-hidden rounded-3xl p-6 transition-colors hover:border-accent/30"
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-accent/10 blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
            <span className="glass-soft flex h-11 w-11 items-center justify-center rounded-2xl text-accent-strong">
              <item.Icon size={20} />
            </span>
            <h3 className="mt-4 text-lg font-semibold">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted">{item.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
