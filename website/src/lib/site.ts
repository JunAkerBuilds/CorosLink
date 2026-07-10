export const SITE_NAME = "CorosLink";
export const SITE_URL = "https://coros-link.vercel.app";
export const SITE_DESCRIPTION =
  "CorosLink is an unofficial, open-source COROS watch companion for desktop. Sync music from Spotify, YouTube, YouTube Music, and Apple Music, download public Apple Podcasts episodes, install offline maps, build GPX routes, and review training analytics on macOS, Windows, and Linux.";

export const SITE_KEYWORDS = [
  "CorosLink",
  "COROS desktop app",
  "COROS watch companion",
  "COROS music sync",
  "COROS Spotify sync",
  "COROS YouTube Music sync",
  "COROS Apple Music sync",
  "COROS Apple Podcasts download",
  "COROS offline maps",
  "COROS map installer",
  "COROS GPX route builder",
  "COROS training analytics",
  "COROS training dashboard",
  "COROS Pace Pro",
  "COROS Pace 3",
  "COROS Pace 4",
  "COROS Nomad",
  "COROS watch USB transfer",
  "desktop companion app",
];

export const APP_FEATURES = [
  "USB music transfer for COROS watches",
  "Spotify, YouTube, YouTube Music, Apple Music, and Apple Podcasts workflows",
  "Offline COROS map package download and install",
  "Desktop GPX route builder with elevation stats",
  "Training dashboard with recovery, load, race predictor, and activity detail",
  "Local-first storage with no CorosLink cloud account",
  "Native desktop builds for macOS, Windows, and Linux",
];

export const FAQS = [
  {
    question: "What is CorosLink?",
    answer:
      "CorosLink is an unofficial desktop companion app for COROS watch owners. It brings watch music, offline maps, GPX route planning, and COROS training analytics into one local-first app.",
  },
  {
    question: "Can CorosLink sync Spotify, YouTube, Apple Music, or Apple Podcasts to a COROS watch?",
    answer:
      "Yes. CorosLink helps build a local MP3 library from Spotify, YouTube, YouTube Music, Apple Music, and public Apple Podcasts episodes, then transfers compatible files to your COROS watch over USB.",
  },
  {
    question: "Does CorosLink install offline maps on COROS watches?",
    answer:
      "Yes. CorosLink can browse official COROS v5 map regions, cache map packages locally, and install Landscape or Topo maps to a supported COROS watch over USB.",
  },
  {
    question: "Can I build GPX routes for my COROS watch on desktop?",
    answer:
      "Yes. The route builder supports loop and point-to-point GPX routes, elevation and distance stats, GPX export, and QR sharing for import into the COROS mobile app.",
  },
  {
    question: "Is CorosLink available for macOS, Windows, and Linux?",
    answer:
      "Yes. CorosLink provides desktop releases for macOS, Windows, and Linux through GitHub Releases.",
  },
  {
    question: "Is CorosLink official COROS software?",
    answer:
      "No. CorosLink is an open-source community project and is not affiliated with, endorsed by, or maintained by COROS.",
  },
];

export function absoluteUrl(path = "/") {
  return new URL(path, SITE_URL).toString();
}
