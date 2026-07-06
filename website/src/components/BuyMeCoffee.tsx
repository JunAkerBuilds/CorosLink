"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { Coffee, Sparkles } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const COFFEE_URL = "https://www.buymeacoffee.com/addridoa";

type BuyMeCoffeeVariant = "hero" | "banner" | "footer";

export function BuyMeCoffee({ variant }: { variant: BuyMeCoffeeVariant }) {
  const reduced = usePrefersReducedMotion();

  if (variant === "footer") {
    return (
      <a
        href={COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Buy me a coffee"
        className="btn-coffee-icon glass-soft flex h-10 w-10 items-center justify-center rounded-full sm:h-9 sm:w-9"
      >
        <Coffee size={16} />
      </a>
    );
  }

  if (variant === "banner") {
    return (
      <motion.a
        href={COFFEE_URL}
        target="_blank"
        rel="noopener noreferrer"
        initial={{ opacity: 0, y: reduced ? 0 : 28 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "0px 0px -100px 0px" }}
        transition={{ duration: 0.65, ease: "easeOut" }}
        whileHover={reduced ? undefined : { y: -4, scale: 1.01 }}
        whileTap={reduced ? undefined : { scale: 0.99 }}
        className="coffee-banner group relative mx-auto block max-w-4xl overflow-hidden rounded-[28px] p-6 sm:p-8"
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/20 blur-3xl transition-opacity duration-500 group-hover:opacity-100" />
        <div className="pointer-events-none absolute -bottom-12 -left-8 h-36 w-36 rounded-full bg-[#ff8c42]/15 blur-3xl" />

        <div className="relative flex flex-col items-center gap-5 text-center sm:flex-row sm:items-center sm:text-left">
          <div className="relative shrink-0">
            <div className="coffee-steam pointer-events-none absolute -top-3 left-1/2 flex -translate-x-1/2 gap-1.5">
              <span />
              <span />
              <span />
            </div>
            <Image
              src="/assets/buy-me-a-coffee.png"
              alt=""
              width={120}
              height={120}
              className="h-20 w-20 drop-shadow-[0_12px_24px_rgba(216,155,34,0.35)] sm:h-24 sm:w-24"
            />
          </div>

          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#ffd27a]">
              <Sparkles size={13} />
              Support the project
            </p>
            <h3 className="mt-2 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
              CorosLink is free — coffee keeps it brewing.
            </h3>
            <p className="mt-2 max-w-xl text-pretty text-sm leading-relaxed text-[#ffe8bf]/85 sm:text-[15px]">
              Late-night USB debugging, map tiles, and playlist fixes all run on caffeine.
              If CorosLink saves you a sync headache, buy me a coffee.
            </p>
          </div>

          <span className="btn-coffee inline-flex shrink-0 items-center gap-2 rounded-full px-6 py-3.5 text-sm font-semibold">
            <Coffee size={17} />
            Buy me a coffee
          </span>
        </div>
      </motion.a>
    );
  }

  return (
    <a
      href={COFFEE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="btn-coffee group relative inline-flex items-center gap-2 overflow-hidden rounded-full px-6 py-3 text-sm font-semibold"
    >
      <span className="coffee-steam pointer-events-none absolute -top-2 left-5 flex gap-1">
        <span />
        <span />
      </span>
      <Coffee size={17} className="relative transition-transform duration-300 group-hover:-rotate-12" />
      <span className="relative">Fuel the dev</span>
      <span className="relative text-base leading-none" aria-hidden="true">
        ☕
      </span>
    </a>
  );
}
