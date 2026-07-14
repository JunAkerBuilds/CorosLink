"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Download } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";
import { BuyMeCoffee } from "./BuyMeCoffee";
import { GitHubLink } from "./GitHubLink";
import { SourceStrip } from "./SourceStrip";
import { SupporterBubbles } from "./SupporterBubbles";
import type { PublicSupporter } from "../lib/supporters";

const WATCHES = [
  { src: "/assets/pace-pro-hero.webp", label: "Pace Pro" },
  { src: "/assets/pace-4-hero.webp", label: "Pace 4" },
  { src: "/assets/pace-3-hero.webp", label: "Pace 3" },
  { src: "/assets/nomad-hero.webp", label: "Nomad" },
];

export function Hero({ supporters }: { supporters: PublicSupporter[] }) {
  const reduced = usePrefersReducedMotion();

  const fade = (delay: number) => ({
    initial: { opacity: 0, y: reduced ? 0 : 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.7, delay: reduced ? 0 : delay, ease: "easeOut" as const },
  });

  return (
    <section
      id="top"
      className="relative flex min-h-[100dvh] flex-col overflow-hidden px-5 pt-24 pb-5"
    >
      {/* Aurora backdrop */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="aurora-a absolute -top-1/4 left-1/4 h-[46rem] w-[46rem] -translate-x-1/2 rounded-full bg-accent/25 blur-[120px]" />
        <div className="aurora-b absolute -top-1/3 right-1/4 h-[40rem] w-[40rem] translate-x-1/2 rounded-full bg-accent-2/20 blur-[120px]" />
        <div className="absolute bottom-0 left-1/2 h-[30rem] w-[60rem] -translate-x-1/2 rounded-full bg-blue/10 blur-[130px]" />
        <div
          className="absolute inset-0 opacity-[0.18]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.05) 1px,transparent 1px)",
            backgroundSize: "64px 64px",
            maskImage: "radial-gradient(70% 60% at 50% 20%,#000,transparent)",
            WebkitMaskImage: "radial-gradient(70% 60% at 50% 20%,#000,transparent)",
          }}
        />
      </div>

      <SupporterBubbles supporters={supporters} />

      {/* Main content */}
      <div className="relative z-10 flex flex-1 flex-col items-center justify-center text-center">
        <motion.span
          {...fade(0)}
          className="glass-soft mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium text-muted"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-accent-strong shadow-[0_0_10px_2px_rgba(79,214,166,0.7)]" />
          Unofficial · Open source · Local-first
        </motion.span>

        <motion.h1
          {...fade(0.08)}
          className="max-w-4xl text-balance text-5xl font-semibold leading-[1.04] tracking-tight sm:text-6xl md:text-[4.5rem]"
        >
          Your <span className="text-gradient">COROS watch</span>, on desktop.
        </motion.h1>

        <motion.p
          {...fade(0.16)}
          className="mt-6 max-w-2xl text-pretty text-lg leading-relaxed text-muted"
        >
          CorosLink brings music, offline maps, route building, and training
          analytics into one beautiful command center — synced straight to your
          watch over USB. No account, no cloud, no cost.
        </motion.p>

        <motion.div {...fade(0.24)} className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <a
            href="#download"
            className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-shadow"
          >
            <Download size={17} />
            Download for free
          </a>
          <GitHubLink variant="hero" />
          <BuyMeCoffee variant="hero" />
        </motion.div>

        {/* Watch lineup */}
        <div className="mt-10 flex items-end justify-center gap-3 sm:gap-6 md:mt-12">
          {WATCHES.map((w, i) => (
            <motion.div
              key={w.label}
              initial={{ opacity: 0, y: reduced ? 0 : 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: reduced ? 0 : 0.4 + i * 0.1, ease: "easeOut" }}
              className="flex flex-col items-center"
            >
              <div className={`relative h-28 w-20 sm:h-36 sm:w-24 md:h-44 md:w-32 ${reduced ? "" : "animate-float"}`} style={{ animationDelay: `${i * 0.8}s` }}>
                <Image
                  src={w.src}
                  alt={`COROS ${w.label}`}
                  fill
                  priority={i === 0}
                  sizes="(max-width: 640px) 80px, 128px"
                  className="object-contain drop-shadow-[0_20px_40px_rgba(0,0,0,0.55)]"
                />
              </div>
              <span className="mt-2 text-[11px] font-medium text-quiet sm:text-xs">{w.label}</span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Scrolling source marquee — kept in view within the hero */}
      <div className="relative z-10">
        <SourceStrip />
      </div>
    </section>
  );
}
