"use client";

import { motion } from "motion/react";
import { Star } from "lucide-react";
import { GITHUB_REPO_URL, formatStarCount } from "../lib/github";
import { useGitHubStars } from "../hooks/useGitHubStars";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

export function GitHubStarCount() {
  const stars = useGitHubStars();
  const reduced = usePrefersReducedMotion();

  if (stars === null) return null;

  const linkMotion = reduced
    ? {}
    : {
        initial: { opacity: 0, y: 6 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.4, delay: 0.08, ease: "easeOut" as const },
      };

  const iconMotion = reduced
    ? {}
    : {
        initial: { rotate: -120, scale: 0 },
        animate: { rotate: 0, scale: 1 },
        transition: { type: "spring" as const, stiffness: 320, damping: 16, delay: 0.16 },
      };

  return (
    <motion.a
      {...linkMotion}
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="github-star-count-link mt-3 inline-flex items-center gap-1.5 text-xs"
    >
      <motion.span {...iconMotion} className="github-star-count-link__icon inline-flex">
        <Star size={11} className="fill-current" />
      </motion.span>
      {formatStarCount(stars)} stars on GitHub
    </motion.a>
  );
}
