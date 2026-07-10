"use client";

import type { ReactNode } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import {
  LayoutDashboard,
  Music4,
  Map,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { MediaCard } from "./mocks/MediaCard";
import { FitnessCard } from "./mocks/FitnessCard";

interface Pillar {
  id: string;
  icon: LucideIcon;
  eyebrow: string;
  title: string;
  body: string;
  bullets: string[];
  image?: string;
  imageAlt?: string;
  visual?: ReactNode;
  badge?: string;
}

const PILLARS: Pillar[] = [
  {
    id: "overview",
    icon: LayoutDashboard,
    eyebrow: "Command center",
    title: "Everything about your watch, at a glance.",
    body: "The Overview dashboard detects your connected COROS watch, shows a live storage ring, surfaces your library metrics, and gives you one-click quick actions. Paste any link and download straight into your workflow.",
    bullets: [
      "Automatic USB watch detection",
      "Live storage & library stats",
      "Paste-a-link instant download",
    ],
    image: "/screenshots/overview.png",
    imageAlt: "CorosLink overview dashboard",
  },
  {
    id: "music",
    icon: Music4,
    eyebrow: "Music workflow",
    title: "Your playlist to watch, in one clean flow.",
    body: "Choose a Spotify playlist, let CorosLink turn it into a local MP3 library, then move it to the Pace Pro over USB. YouTube search is there when you need a specific track.",
    bullets: [
      "Spotify, YouTube, YouTube Music, Apple Music & Apple Podcasts",
      "Unified local library with drag-to-queue",
      "Direct, cable-fast transfer to the watch",
    ],
    visual: <MediaCard />,
  },
  {
    id: "maps",
    icon: Map,
    eyebrow: "Maps & route builder",
    title: "Offline maps and custom routes, made simple.",
    body: "Browse and install official COROS v5 map regions — Landscape or Topo — cached locally and pushed to your watch. Then design loop or point-to-point routes with a live map preview, elevation stats, GPX export, and a QR code to share to your phone.",
    bullets: [
      "Official COROS v5 map regions, offline",
      "GPX route builder with elevation & stats",
      "Share to phone via QR in one tap",
    ],
    image: "/screenshots/route-generator.png",
    imageAlt: "CorosLink route builder generating a GPX route",
    badge: "New",
  },
  {
    id: "training",
    icon: Activity,
    eyebrow: "Training hub",
    title: "Read your training story on a bigger screen.",
    body: "Sign in with your COROS account to see Stamina, Recovery, Training Load, and Resting HR at a glance. Dive into EvoLab fitness scores, a race predictor, per-activity route maps and elevation, an activity heatmap, and FIT export.",
    bullets: [
      "Recovery ring, load & 7-day trend charts",
      "EvoLab scores + race time predictor",
      "Activity heatmap, detail maps & FIT export",
    ],
    visual: <FitnessCard />,
  },
];

export function Features() {
  return (
    <div className="mx-auto max-w-[120rem] px-6 lg:px-12">
      {PILLARS.map((pillar, i) => (
        <FeatureBand key={pillar.id} pillar={pillar} flipped={i % 2 === 1} />
      ))}
    </div>
  );
}

function FeatureBand({
  pillar,
  flipped,
}: {
  pillar: Pillar;
  flipped: boolean;
}) {
  const reduced = usePrefersReducedMotion();
  const Icon = pillar.icon;
  const isTraining = pillar.id === "training";
  const isMusic = pillar.id === "music";

  const reveal = {
    initial: { opacity: 0, y: reduced ? 0 : 40 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "0px 0px -120px 0px" },
    transition: { duration: 0.7, ease: "easeOut" as const },
  };

  return (
    <section
      id={pillar.id}
      className={`grid scroll-mt-24 items-center gap-10 py-16 lg:py-24 ${
        isMusic
          ? "lg:grid-cols-1 lg:gap-10"
          : isTraining
            ? "lg:grid-cols-[minmax(0,1.48fr)_minmax(23rem,0.52fr)] lg:gap-20"
            : "lg:grid-cols-[minmax(0,0.68fr)_minmax(0,1.32fr)] lg:gap-16"
      }`}
    >
      {/* Copy */}
      <motion.div
        {...reveal}
        className={`${
          !isMusic && flipped ? "lg:order-2" : ""
        } ${isTraining ? "lg:pl-4 xl:pl-8" : ""} ${isMusic ? "max-w-6xl" : ""}`}
      >
        {isMusic ? (
          <p className="mb-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-muted sm:text-sm">
            {pillar.eyebrow}
          </p>
        ) : (
          <div className="mb-5 inline-flex items-center gap-3">
            <span className="glass-soft flex h-11 w-11 items-center justify-center rounded-2xl text-accent-strong">
              <Icon size={20} />
            </span>
            <span className="eyebrow">{pillar.eyebrow}</span>
            {pillar.badge && (
              <span className="rounded-full bg-accent/15 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-strong ring-1 ring-accent/30">
                {pillar.badge}
              </span>
            )}
          </div>
        )}

        <h2
          className={
            isMusic
              ? "max-w-5xl text-balance text-5xl font-semibold leading-[1.02] tracking-tight sm:text-6xl lg:text-[4.6rem]"
              : "text-balance text-3xl font-semibold tracking-tight sm:text-4xl"
          }
        >
          {pillar.title}
        </h2>
        <p
          className={
            isMusic
              ? "mt-8 max-w-5xl text-pretty text-xl leading-relaxed text-muted sm:text-2xl"
              : "mt-4 text-pretty text-[17px] leading-relaxed text-muted"
          }
        >
          {pillar.body}
        </p>

        {!isMusic && (
          <ul className="mt-6 space-y-3">
            {pillar.bullets.map((b) => (
              <li
                key={b}
                className="flex items-start gap-3 text-[15px] text-text/90"
              >
                <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-accent shadow-[0_0_8px_1px_rgba(47,190,145,0.7)]" />
                {b}
              </li>
            ))}
          </ul>
        )}
      </motion.div>

      {/* Visual: interactive component or screenshot */}
      <motion.div
        {...reveal}
        transition={{ ...reveal.transition, delay: reduced ? 0 : 0.1 }}
        className={`min-w-0 ${!isMusic && flipped ? "lg:order-1" : ""} ${
          isMusic ? "mx-auto w-full max-w-[96rem]" : ""
        }`}
      >
        {pillar.visual ? (
          pillar.visual
        ) : (
          <div className="glass group relative overflow-hidden rounded-glass p-2">
            <div className="pointer-events-none absolute -inset-px rounded-glass bg-[radial-gradient(60%_60%_at_50%_0%,rgba(47,190,145,0.18),transparent)]" />
            <div className="relative overflow-hidden rounded-[18px] border border-white/10">
              <Image
                src={pillar.image!}
                alt={pillar.imageAlt ?? ""}
                width={1400}
                height={900}
                className="h-auto w-full transition-transform duration-700 group-hover:scale-[1.02]"
              />
            </div>
          </div>
        )}
      </motion.div>
    </section>
  );
}
