"use client";

import { useEffect, useState, type ReactElement } from "react";
import { track } from "@vercel/analytics";
import { motion } from "motion/react";
import { ArrowDown } from "lucide-react";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

const RELEASES_URL = "https://github.com/JunAkerBuilds/CorosLink/releases";
const API_URL = "https://api.github.com/repos/JunAkerBuilds/CorosLink/releases/latest";
const DOWNLOAD_ANALYTICS_EVENT = "Download Button Clicked";
const APPLE_ICON_PATH =
  "M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701";
const WINDOWS_ICON_PATH =
  "M0 3.449 9.75 2.1v9.451H0V3.449Zm10.949-1.5L24 0v11.4H10.949V1.949ZM0 12.6h9.75v9.451L0 20.699V12.6Zm10.949 0H24V24l-13.051-1.351V12.6Z";
const LINUX_ICON_PATH =
  "M12.504 0c-.155 0-.315.008-.48.021-4.226.333-3.105 4.807-3.17 6.298-.076 1.092-.3 1.953-1.05 3.02-.885 1.051-2.127 2.75-2.716 4.521-.278.832-.41 1.684-.287 2.489a.424.424 0 00-.11.135c-.26.268-.45.6-.663.839-.199.199-.485.267-.797.4-.313.136-.658.269-.864.68-.09.189-.136.394-.132.602 0 .199.027.4.055.536.058.399.116.728.04.97-.249.68-.28 1.145-.106 1.484.174.334.535.47.94.601.81.2 1.91.135 2.774.6.926.466 1.866.67 2.616.47.526-.116.97-.464 1.208-.946.587-.003 1.23-.269 2.26-.334.699-.058 1.574.267 2.577.2.025.134.063.198.114.333l.003.003c.391.778 1.113 1.132 1.884 1.071.771-.06 1.592-.536 2.257-1.306.631-.765 1.683-1.084 2.378-1.503.348-.199.629-.469.649-.853.023-.4-.2-.811-.714-1.376v-.097l-.003-.003c-.17-.2-.25-.535-.338-.926-.085-.401-.182-.786-.492-1.046h-.003c-.059-.054-.123-.067-.188-.135a.357.357 0 00-.19-.064c.431-1.278.264-2.55-.173-3.694-.533-1.41-1.465-2.638-2.175-3.483-.796-1.005-1.576-1.957-1.56-3.368.026-2.152.236-6.133-3.544-6.139zm.529 3.405h.013c.213 0 .396.062.584.198.19.135.33.332.438.533.105.259.158.459.166.724 0-.02.006-.04.006-.06v.105a.086.086 0 01-.004-.021l-.004-.024a1.807 1.807 0 01-.15.706.953.953 0 01-.213.335.71.71 0 00-.088-.042c-.104-.045-.198-.064-.284-.133a1.312 1.312 0 00-.22-.066c.05-.06.146-.133.183-.198.053-.128.082-.264.088-.402v-.02a1.21 1.21 0 00-.061-.4c-.045-.134-.101-.2-.183-.333-.084-.066-.167-.132-.267-.132h-.016c-.093 0-.176.03-.262.132a.8.8 0 00-.205.334 1.18 1.18 0 00-.09.4v.019c.002.089.008.179.02.267-.193-.067-.438-.135-.607-.202a1.635 1.635 0 01-.018-.2v-.02a1.772 1.772 0 01.15-.768c.082-.22.232-.406.43-.533a.985.985 0 01.594-.2zm-2.962.059h.036c.142 0 .27.048.399.135.146.129.264.288.344.465.09.199.14.4.153.667v.004c.007.134.006.2-.002.266v.08c-.03.007-.056.018-.083.024-.152.055-.274.135-.393.2.012-.09.013-.18.003-.267v-.015c-.012-.133-.04-.2-.082-.333a.613.613 0 00-.166-.267.248.248 0 00-.183-.064h-.021c-.071.006-.13.04-.186.132a.552.552 0 00-.12.27.944.944 0 00-.023.33v.015c.012.135.037.2.08.334.046.134.098.2.166.268.01.009.02.018.034.024-.07.057-.117.07-.176.136a.304.304 0 01-.131.068 2.62 2.62 0 01-.275-.402 1.772 1.772 0 01-.155-.667 1.759 1.759 0 01.08-.668 1.43 1.43 0 01.283-.535c.128-.133.26-.2.418-.2zm1.37 1.706c.332 0 .733.065 1.216.399.293.2.523.269 1.052.468h.003c.255.136.405.266.478.399v-.131a.571.571 0 01.016.47c-.123.31-.516.643-1.063.842v.002c-.268.135-.501.333-.775.465-.276.135-.588.292-1.012.267a1.139 1.139 0 01-.448-.067 3.566 3.566 0 01-.322-.198c-.195-.135-.363-.332-.612-.465v-.005h-.005c-.4-.246-.616-.512-.686-.71-.07-.268-.005-.47.193-.6.224-.135.38-.271.483-.336.104-.074.143-.102.176-.131h.002v-.003c.169-.202.436-.47.839-.601.139-.036.294-.065.466-.065zm2.8 2.142c.358 1.417 1.196 3.475 1.735 4.473.286.534.855 1.659 1.102 3.024.156-.005.33.018.513.064.646-1.671-.546-3.467-1.089-3.966-.22-.2-.232-.335-.123-.335.59.534 1.365 1.572 1.646 2.757.13.535.16 1.104.021 1.67.067.028.135.06.205.067 1.032.534 1.413.938 1.23 1.537v-.043c-.06-.003-.12 0-.18 0h-.016c.151-.467-.182-.825-1.065-1.224-.915-.4-1.646-.336-1.77.465-.008.043-.013.066-.018.135-.068.023-.139.053-.209.064-.43.268-.662.669-.793 1.187-.13.533-.17 1.156-.205 1.869v.003c-.02.334-.17.838-.319 1.35-1.5 1.072-3.58 1.538-5.348.334a2.645 2.645 0 00-.402-.533 1.45 1.45 0 00-.275-.333c.182 0 .338-.03.465-.067a.615.615 0 00.314-.334c.108-.267 0-.697-.345-1.163-.345-.467-.931-.995-1.788-1.521-.63-.4-.986-.87-1.15-1.396-.165-.534-.143-1.085-.015-1.645.245-1.07.873-2.11 1.274-2.763.107-.065.037.135-.408.974-.396.751-1.14 2.497-.122 3.854a8.123 8.123 0 01.647-2.876c.564-1.278 1.743-3.504 1.836-5.268.048.036.217.135.289.202.218.133.38.333.59.465.21.201.477.335.876.335.039.003.075.006.11.006.412 0 .73-.134.997-.268.29-.134.52-.334.74-.4h.005c.467-.135.835-.402 1.044-.7zm2.185 8.958c.037.6.343 1.245.882 1.377.588.134 1.434-.333 1.791-.765l.211-.01c.315-.007.577.01.847.268l.003.003c.208.199.305.53.391.876.085.4.154.78.409 1.066.486.527.645.906.636 1.14l.003-.007v.018l-.003-.012c-.015.262-.185.396-.498.595-.63.401-1.746.712-2.457 1.57-.618.737-1.37 1.14-2.036 1.191-.664.053-1.237-.2-1.574-.898l-.005-.003c-.21-.4-.12-1.025.056-1.69.176-.668.428-1.344.463-1.897.037-.714.076-1.335.195-1.814.12-.465.308-.797.641-.984l.045-.022zm-10.814.049h.01c.053 0 .105.005.157.014.376.055.706.333 1.023.752l.91 1.664.003.003c.243.533.754 1.064 1.189 1.637.434.598.77 1.131.729 1.57v.006c-.057.744-.48 1.148-1.125 1.294-.645.135-1.52.002-2.395-.464-.968-.536-2.118-.469-2.857-.602-.369-.066-.61-.2-.723-.4-.11-.2-.113-.602.123-1.23v-.004l.002-.003c.117-.334.03-.752-.027-1.118-.055-.401-.083-.71.043-.94.16-.334.396-.4.69-.533.294-.135.64-.202.915-.47h.002v-.002c.256-.268.445-.601.668-.838.19-.201.38-.336.663-.336zm7.159-9.074c-.435.201-.945.535-1.488.535-.542 0-.97-.267-1.28-.466-.154-.134-.28-.268-.373-.335-.164-.134-.144-.333-.074-.333.109.016.129.134.199.2.096.066.215.2.36.333.292.2.68.467 1.167.467.485 0 1.053-.267 1.398-.466.195-.135.445-.334.648-.467.156-.136.149-.267.279-.267.128.016.034.134-.147.332a8.097 8.097 0 01-.69.468zm-1.082-1.583V5.64c-.006-.02.013-.042.029-.05.074-.043.18-.027.26.004.063 0 .16.067.15.135-.006.049-.085.066-.135.066-.055 0-.092-.043-.141-.068-.052-.018-.146-.008-.163-.065zm-.551 0c-.02.058-.113.049-.166.066-.047.025-.086.068-.14.068-.05 0-.13-.02-.136-.068-.01-.066.088-.133.15-.133.08-.031.184-.047.259-.005.019.009.036.03.03.05v.02h.003z";

interface ReleaseAssets {
  macArmUrl: string | null;
  macX64Url: string | null;
  winUrl: string | null;
  linuxUrl: string | null;
  version: string | null;
}

const EMPTY_ASSETS: ReleaseAssets = {
  macArmUrl: null,
  macX64Url: null,
  winUrl: null,
  linuxUrl: null,
  version: null,
};

export function Download() {
  const reduced = usePrefersReducedMotion();
  const [assets, setAssets] = useState<ReleaseAssets>(EMPTY_ASSETS);
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
          macArmUrl: find("-arm64.dmg"),
          macX64Url: find("-x64.dmg"),
          winUrl: find(".exe"),
          linuxUrl: find(".AppImage"),
          version: data.tag_name ?? null,
        });
      } catch {
        if (!cancelled) setAssets(EMPTY_ASSETS);
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
    ? "Checking"
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

        <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <DownloadOption
            delay={0}
            href={assets.macArmUrl ?? RELEASES_URL}
            platform="macOS"
            title="Apple Silicon"
            meta="M-series Macs"
            format="DMG"
            cta={assets.macArmUrl || loading ? releaseLabel : "View releases"}
            Icon={MacIcon}
            version={assets.version}
            directAsset={Boolean(assets.macArmUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.08}
            href={assets.macX64Url ?? RELEASES_URL}
            platform="macOS"
            title="Intel"
            meta="Intel Macs"
            format="DMG"
            cta={assets.macX64Url || loading ? releaseLabel : "View releases"}
            Icon={MacIcon}
            version={assets.version}
            directAsset={Boolean(assets.macX64Url)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.16}
            href={assets.winUrl ?? RELEASES_URL}
            platform="Windows"
            title="Installer"
            meta="Desktop installer"
            format="EXE"
            cta={assets.winUrl || loading ? releaseLabel : "View releases"}
            Icon={WindowsIcon}
            version={assets.version}
            directAsset={Boolean(assets.winUrl)}
            reduced={reduced}
          />
          <DownloadOption
            delay={0.24}
            href={assets.linuxUrl ?? RELEASES_URL}
            platform="Linux"
            title="AppImage"
            meta="x64 desktop build"
            format="AppImage"
            cta={assets.linuxUrl || loading ? releaseLabel : "View releases"}
            Icon={LinuxIcon}
            version={assets.version}
            directAsset={Boolean(assets.linuxUrl)}
            reduced={reduced}
          />
        </div>

        {!loading &&
          !assets.macArmUrl &&
          !assets.macX64Url &&
          !assets.winUrl &&
          !assets.linuxUrl && (
          <p className="mt-6 text-center text-sm text-quiet">
            No installer assets were found in the latest release. Use GitHub Releases
            or build from source.
          </p>
        )}
      </motion.div>
    </section>
  );
}

type DownloadIcon = (props: { size?: number; className?: string }) => ReactElement;

function MacIcon({ size = 22, className }: { size?: number; className?: string }) {
  return <BrandIcon className={className} path={APPLE_ICON_PATH} size={size} />;
}

function DownloadOption({
  delay,
  href,
  platform,
  title,
  meta,
  format,
  cta,
  Icon,
  version,
  directAsset,
  reduced,
}: {
  delay: number;
  href: string;
  platform: string;
  title: string;
  meta: string;
  format: string;
  cta: string;
  Icon: DownloadIcon;
  version: string | null;
  directAsset: boolean;
  reduced: boolean;
}) {
  function handleClick() {
    track(DOWNLOAD_ANALYTICS_EVENT, {
      platform: `${platform} ${title}`,
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
      className="glass-soft group relative flex min-h-[13.5rem] flex-col justify-between overflow-hidden rounded-2xl p-5 transition-colors hover:border-accent/40"
    >
      <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

      <span className="flex items-start justify-between gap-4">
        <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-white/[0.06] text-accent-strong ring-1 ring-white/10">
          <Icon size={26} />
        </span>
        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-quiet">
          {format}
        </span>
      </span>

      <span className="mt-5 block min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-quiet">
          {platform}
        </span>
        <strong className="mt-1 block text-xl font-semibold tracking-tight text-text">
          {title}
        </strong>
        <em className="mt-1 block text-sm not-italic leading-relaxed text-muted">{meta}</em>
      </span>

      <span className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <strong className="min-w-0 text-sm font-semibold leading-tight text-text">
          {cta}
        </strong>
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-accent/10 text-accent-strong transition-transform group-hover:translate-y-0.5">
          <ArrowDown size={17} />
        </span>
      </span>
    </motion.a>
  );
}

function BrandIcon({
  className,
  path,
  size = 22,
}: {
  className?: string;
  path: string;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      focusable="false"
      height={size}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d={path} />
    </svg>
  );
}

function WindowsIcon({ size = 22, className }: { size?: number; className?: string }) {
  return <BrandIcon className={className} path={WINDOWS_ICON_PATH} size={size} />;
}

function LinuxIcon({ size = 22, className }: { size?: number; className?: string }) {
  return <BrandIcon className={className} path={LINUX_ICON_PATH} size={size} />;
}
