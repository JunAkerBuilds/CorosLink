"use client";

import { motion } from "motion/react";
import { Star } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

export function GitHubStarBadge({
  count,
  compact = false,
}: {
  count: string;
  compact?: boolean;
}) {
  const reduced = usePrefersReducedMotion();

  const badgeMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, scale: 0.55, y: 8 },
        animate: { opacity: 1, scale: 1, y: 0 },
        transition: { type: "spring" as const, stiffness: 460, damping: 24, delay: 0.04 },
      };

  const iconMotion = reduced
    ? {}
    : {
        initial: { rotate: -140, scale: 0 },
        animate: { rotate: 0, scale: 1 },
        transition: { type: "spring" as const, stiffness: 340, damping: 16, delay: 0.12 },
      };

  const countMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, x: -6 },
        animate: { opacity: 1, x: 0 },
        transition: { duration: 0.35, delay: 0.22, ease: "easeOut" as const },
      };

  return (
    <motion.span
      {...badgeMotion}
      className={`github-star-badge inline-flex items-center gap-1 rounded-full font-semibold ${
        compact ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-0.5 text-xs"
      }`}
    >
      <motion.span {...iconMotion} className="github-star-badge__icon inline-flex">
        <Star size={compact ? 10 : 11} className="fill-current" />
      </motion.span>
      <motion.span {...countMotion} className="github-star-badge__count">
        {count}
      </motion.span>
    </motion.span>
  );
}
