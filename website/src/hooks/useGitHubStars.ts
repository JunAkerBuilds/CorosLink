"use client";

import { useEffect, useState } from "react";
import { GITHUB_REPO_API } from "../lib/github";

export function useGitHubStars() {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch(GITHUB_REPO_API);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      } catch {
        /* ignore — link still works without the count */
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return stars;
}
