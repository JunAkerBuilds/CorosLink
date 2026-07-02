"use client";

import { useEffect, useState } from "react";
import { track } from "@vercel/analytics";
import { motion } from "motion/react";
import { Apple, Monitor, Terminal, ArrowDown, type LucideIcon } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const RELEASES_URL = "https://github.com/JunAkerBuilds/CorosLink/releases";
const API_URL = "https://api.github.com/repos/JunAkerBuilds/CorosLink/releases/latest";
const DOWNLOAD_ANALYTICS_EVENT = "Download Button Clicked";

interface ReleaseAssets {
  macUrl: string | null;
  winUrl: string | null;
  linuxUrl: string | null;
  version: string | null;
}

const installNotes = [
  "No CorosLink account required",
  "Music, maps & tokens stay on your machine",
  "Auto-updates from GitHub Releases",
  "Unsigned builds while the project is young",
];

export function Download() {
  const reduced = usePrefersReducedMotion();
  const [assets, setAssets] = useState<ReleaseAssets>({
    macUrl: null,
    winUrl: null,
    linuxUrl: null,
    version: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchRelease() {
      try {
        const res = await fetch(API_URL);
        if (!res.ok) throw new Error("No release");
        const data = await res.json();
        if (cancelled) return;

        const find = (ext: string) =>
          data.assets?.find((a: { name: string }) => a.name.endsWith(ext))
            ?.browser_download_url ?? null;

        setAssets({
          macUrl: find(".dmg"),
          winUrl: find(".exe"),
          linuxUrl: find(".AppImage"),
          version: data.tag_name ?? null,
        });
      } catch {
        if (!cancelled) setAssets({ macUrl: null, winUrl: null, linuxUrl: null, version: null });
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchRelease();
    return () => {
      cancelled = true;
    };
  }, []);

  const releaseLabel = loading
    ? "Checking release…"
    : assets.version
      ? `Download ${assets.version}`
      : "View releases";
  const releaseStatus = loading
    ? "Checking GitHub Releases"
    : assets.version
      ? `Latest release ${assets.version}`
      : "Release assets unavailable";

  const reveal = {
    initial: { opacity: 0, y: reduced ? 0 : 34 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, margin: "0px 0px -120px 0px" },
    transition: { duration: 0.68, ease: "easeOut" as const },
  };

  return (
    <section id="download" className="scroll-mt-20 px-6 lg:px-12 py-20 md:py-28">
      <motion.div {...reveal} className="glass mx-auto max-w-6xl rounded-glass p-8 md:p-12">
        <div className="text-center">
          <p className="eyebrow">Get CorosLink</p>
          <h2 className="mt-3 text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
            Download the desktop companion.
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-pretty text-[17px] leading-relaxed text-muted">
            Free and open source for macOS, Windows, and Linux. Pull music, maps,
            routes, and training into one app — synced straight to your COROS watch.
          </p>

          <div className="mt-6 inline-flex items-center gap-2.5 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-sm">
            <span className="h-2 w-2 animate-pulse rounded-full bg-accent-strong" />
            <strong className="font-medium">{releaseStatus}</strong>
            <a
              href={RELEASES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent-strong hover:underline"
            >
              GitHub Releases →
            </a>
          </div>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          <DownloadOption
            delay={0}
            href={assets.macUrl ?? RELEASES_URL}
            label="macOS"
            meta="Apple Silicon · DMG"
            cta={assets.macUrl || loading ? releaseLabel : "View releases"}
            Icon={Apple}
            version={assets.version}
            directAsset={Boolean(assets.macUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.08}
            href={assets.winUrl ?? RELEASES_URL}
            label="Windows"
            meta="Desktop installer · EXE"
            cta={assets.winUrl || loading ? releaseLabel : "View releases"}
            Icon={Monitor}
            version={assets.version}
            directAsset={Boolean(assets.winUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.16}
            href={assets.linuxUrl ?? RELEASES_URL}
            label="Linux"
            meta="x64 · AppImage"
            cta={assets.linuxUrl || loading ? releaseLabel : "View releases"}
            Icon={Terminal}
            version={assets.version}
            directAsset={Boolean(assets.linuxUrl)}
            reduced={reduced}
          />
        </div>

        <ul className="mt-8 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-quiet">
          {installNotes.map((note) => (
            <li key={note} className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-accent" />
              {note}
            </li>
          ))}
        </ul>

        {!loading && !assets.macUrl && !assets.winUrl && !assets.linuxUrl && (
          <p className="mt-6 text-center text-sm text-quiet">
            No installer assets were found in the latest release. Use GitHub Releases
            or build from source.
          </p>
        )}
      </motion.div>
    </section>
  );
}

function DownloadOption({
  delay,
  href,
  label,
  meta,
  cta,
  Icon,
  version,
  directAsset,
  reduced,
}: {
  delay: number;
  href: string;
  label: string;
  meta: string;
  cta: string;
  Icon: LucideIcon;
  version: string | null;
  directAsset: boolean;
  reduced: boolean;
}) {
  function handleClick() {
    track(DOWNLOAD_ANALYTICS_EVENT, {
      platform: label,
      release: version ?? "unknown",
      target: directAsset ? "release-asset" : "github-releases",
    });
  }

  return (
    <motion.a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={handleClick}
      initial={{ opacity: 0, y: reduced ? 0 : 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "0px 0px -100px 0px" }}
      transition={{ delay: reduced ? 0 : delay, duration: 0.5, ease: "easeOut" }}
      whileHover={reduced ? undefined : { y: -5 }}
      whileTap={reduced ? undefined : { scale: 0.99 }}
      className="glass-soft group flex items-center gap-4 rounded-2xl p-5 transition-colors hover:border-accent/40"
    >
      <span className="flex h-12 w-12 flex-none items-center justify-center rounded-xl bg-white/[0.05] text-accent-strong">
        <Icon size={22} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs uppercase tracking-wide text-quiet">{label}</span>
        <strong className="block truncate text-[15px] font-semibold">{cta}</strong>
        <em className="block text-xs not-italic text-muted">{meta}</em>
      </span>
      <ArrowDown
        size={18}
        className="flex-none text-quiet transition-all group-hover:translate-y-0.5 group-hover:text-accent-strong"
      />
    </motion.a>
  );
}
