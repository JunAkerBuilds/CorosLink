"use client";

import { Github } from "lucide-react";
import { GITHUB_REPO_URL, formatStarCount } from "../lib/github";
import { useGitHubStars } from "../hooks/useGitHubStars";
import { GitHubStarBadge } from "./GitHubStarBadge";

type GitHubLinkVariant = "nav" | "hero" | "footer";

const VARIANT_CLASS: Record<GitHubLinkVariant, string> = {
  nav: "group glass-soft flex items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors hover:text-accent-strong",
  hero: "group glass-soft inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-colors hover:text-accent-strong",
  footer:
    "glass-soft flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:text-accent-strong sm:h-9 sm:w-9",
};

export function GitHubLink({ variant }: { variant: GitHubLinkVariant }) {
  const stars = useGitHubStars();
  const starLabel = stars !== null ? formatStarCount(stars) : null;

  if (variant === "footer") {
    return (
      <a
        href={GITHUB_REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={starLabel ? `GitHub, ${starLabel} stars` : "GitHub"}
        className={VARIANT_CLASS.footer}
      >
        <Github size={16} />
      </a>
    );
  }

  return (
    <a
      href={GITHUB_REPO_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={VARIANT_CLASS[variant]}
    >
      <Github size={variant === "hero" ? 17 : 16} />
      {variant === "nav" ? (
        <>
          <span className="hidden sm:inline">GitHub</span>
          {starLabel ? <GitHubStarBadge count={starLabel} compact /> : null}
        </>
      ) : (
        <>
          View on GitHub
          {starLabel ? <GitHubStarBadge count={starLabel} /> : null}
        </>
      )}
    </a>
  );
}
