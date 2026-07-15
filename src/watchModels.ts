import type { WatchModelId, WatchStatus } from "../electron/types";
import apexHero from "../public/assets/apex-hero.webp";
import apex2Hero from "../public/assets/apex-2-hero.webp";
import apex2ProHero from "../public/assets/apex-2-pro-hero.webp";
import apex4Hero from "../public/assets/apex-4-hero.webp";
import apexProHero from "../public/assets/apex-pro-hero.webp";
import nomadHero from "../public/assets/nomad-hero.webp";
import pace2Hero from "../public/assets/pace-2-hero.webp";
import pace3Hero from "../public/assets/pace-3-hero.webp";
import pace4Hero from "../public/assets/pace-4-hero.webp";
import paceProHero from "../public/assets/pace-pro-hero.webp";
import vertix2Hero from "../public/assets/vertix-2-hero.webp";
import vertix2sHero from "../public/assets/vertix-2s-hero.webp";
export {
  getWatchfaceDeviceProfile,
  getWatchfaceDeviceProfileByFirmware,
  type WatchfaceDeviceProfile
} from "../electron/watchModels";

export const PACE_PRO_BYTES = 32 * 1024 * 1024 * 1024;
export const PACE_4_BYTES = 4 * 1024 * 1024 * 1024;
export const PACE_3_BYTES = PACE_4_BYTES;
export const PACE_2_BYTES = PACE_4_BYTES;
export const NOMAD_BYTES = PACE_PRO_BYTES;

export type WatchPresentationState =
  | "disconnected"
  | "connected-known"
  | "connected-unknown";

export type WatchFeatureIcon = "display" | "weight" | "battery";

export interface WatchFeature {
  icon: WatchFeatureIcon;
  label: string;
}

export interface WatchPresentation {
  state: WatchPresentationState;
  model?: WatchModelId;
  displayName: string;
  companion: string;
  connectHint: string;
  heroImage?: string;
  heroAlt?: string;
  capacityLabel?: string;
  fallbackBytes?: number;
  productName?: string;
  tagline?: string;
  features?: WatchFeature[];
}

const DISCONNECTED_PRESENTATION: WatchPresentation = {
  state: "disconnected",
  displayName: "Not connected",
  companion: "Connect your COROS watch to get started",
  connectHint: "Connect your COROS watch via USB to sync music",
};

const CONNECTED_UNKNOWN_PRESENTATION: WatchPresentation = {
  state: "connected-unknown",
  displayName: "COROS Watch",
  companion: "Your COROS watch is connected",
  connectHint: "",
};

const MODEL_PRESENTATION: Record<
  WatchModelId,
  Omit<WatchPresentation, "state"> & { state: "connected-known" }
> = {
  "pace-pro": {
    state: "connected-known",
    model: "pace-pro",
    displayName: "COROS Pace Pro",
    productName: "Pace Pro",
    tagline: "Crafted for Performance",
    companion: "Your Pace Pro companion",
    connectHint: "",
    heroImage: paceProHero,
    heroAlt: "COROS Pace Pro",
    capacityLabel: "32 GB Pace Pro capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "Bright AMOLED Display" },
      { icon: "weight", label: "38g Ultralight Design" },
      { icon: "battery", label: "38 Hours Full GPS" },
    ],
  },
  "pace-4": {
    state: "connected-known",
    model: "pace-4",
    displayName: "COROS Pace 4",
    productName: "Pace 4",
    tagline: "Train Without Limits",
    companion: "Your Pace 4 companion",
    connectHint: "",
    heroImage: pace4Hero,
    heroAlt: "COROS Pace 4",
    capacityLabel: "4 GB Pace 4 capacity fallback",
    fallbackBytes: PACE_4_BYTES,
    features: [
      { icon: "display", label: "Bright AMOLED Display" },
      { icon: "weight", label: "Lightweight Build" },
      { icon: "battery", label: "38 Hours Full GPS" },
    ],
  },
  "pace-3": {
    state: "connected-known",
    model: "pace-3",
    displayName: "COROS Pace 3",
    productName: "Pace 3",
    tagline: "Built to Go the Distance",
    companion: "Your Pace 3 companion",
    connectHint: "",
    heroImage: pace3Hero,
    heroAlt: "COROS Pace 3",
    capacityLabel: "4 GB Pace 3 capacity fallback",
    fallbackBytes: PACE_3_BYTES,
    features: [
      { icon: "display", label: "Always-On MIP Display" },
      { icon: "weight", label: "39g Lightweight Build" },
      { icon: "battery", label: "38 Hours Full GPS" },
    ],
  },
  "pace-2": {
    state: "connected-known",
    model: "pace-2",
    displayName: "COROS Pace 2",
    productName: "Pace 2",
    tagline: "Train Hard, Move Fast",
    companion: "Your Pace 2 companion",
    connectHint: "",
    heroImage: pace2Hero,
    heroAlt: "COROS Pace 2",
    capacityLabel: "4 GB Pace 2 capacity fallback",
    fallbackBytes: PACE_2_BYTES,
    features: [
      { icon: "display", label: "Always-On MIP Display" },
      { icon: "weight", label: "29g Ultralight Design" },
      { icon: "battery", label: "27 Hours Full GPS" },
    ],
  },
  nomad: {
    state: "connected-known",
    model: "nomad",
    displayName: "COROS Nomad",
    productName: "Nomad",
    tagline: "Ready for Any Adventure",
    companion: "Your Nomad companion",
    connectHint: "",
    heroImage: nomadHero,
    heroAlt: "COROS Nomad",
    capacityLabel: "32 GB Nomad capacity fallback",
    fallbackBytes: NOMAD_BYTES,
    features: [
      { icon: "display", label: "Bright AMOLED Display" },
      { icon: "weight", label: "Rugged Trail Build" },
      { icon: "battery", label: "Multi-Day GPS Battery" },
    ],
  },
  "vertix-2": {
    state: "connected-known",
    model: "vertix-2",
    displayName: "COROS Vertix 2",
    productName: "Vertix 2",
    tagline: "Built for Adventure",
    companion: "Your Vertix 2 companion",
    connectHint: "",
    heroImage: vertix2Hero,
    heroAlt: "COROS Vertix 2",
    capacityLabel: "32 GB Vertix 2 capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "1.4\" Sapphire Touchscreen" },
      { icon: "weight", label: "Titanium Bezel Build" },
      { icon: "battery", label: "140 Hours Full GPS" },
    ],
  },
  "vertix-2s": {
    state: "connected-known",
    model: "vertix-2s",
    displayName: "COROS Vertix 2S",
    productName: "Vertix 2S",
    tagline: "Built for the Extreme",
    companion: "Your Vertix 2S companion",
    connectHint: "",
    heroImage: vertix2sHero,
    heroAlt: "COROS Vertix 2S",
    capacityLabel: "32 GB Vertix 2S capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "1.4\" Sapphire Touchscreen" },
      { icon: "weight", label: "Titanium Bezel Build" },
      { icon: "battery", label: "118 Hours Full GPS" },
    ],
  },
  "apex-4": {
    state: "connected-known",
    model: "apex-4",
    displayName: "COROS Apex 4",
    productName: "Apex 4",
    tagline: "Built for Training and Racing",
    companion: "Your Apex 4 companion",
    connectHint: "",
    heroImage: apex4Hero,
    heroAlt: "COROS Apex 4",
    capacityLabel: "32 GB Apex 4 capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "3rd-Gen MIP Display" },
      { icon: "weight", label: "Grade 5 Titanium Bezel" },
      { icon: "battery", label: "65 Hours Full GPS (46mm)" },
    ],
  },
  "apex-2-pro": {
    state: "connected-known",
    model: "apex-2-pro",
    displayName: "COROS Apex 2 Pro",
    productName: "Apex 2 Pro",
    tagline: "Built for the Extreme",
    companion: "Your Apex 2 Pro companion",
    connectHint: "",
    heroImage: apex2ProHero,
    heroAlt: "COROS Apex 2 Pro",
    capacityLabel: "32 GB Apex 2 Pro capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "1.3\" Sapphire Touchscreen" },
      { icon: "weight", label: "Titanium Bezel Build" },
      { icon: "battery", label: "41 Hours Full GPS" },
    ],
  },
  "apex-2": {
    state: "connected-known",
    model: "apex-2",
    displayName: "COROS Apex 2",
    productName: "Apex 2",
    tagline: "Built for Adventure",
    companion: "Your Apex 2 companion",
    connectHint: "",
    heroImage: apex2Hero,
    heroAlt: "COROS Apex 2",
    capacityLabel: "32 GB Apex 2 capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "1.2\" Sapphire Touchscreen" },
      { icon: "weight", label: "Titanium Bezel Build" },
      { icon: "battery", label: "25 Hours Full GPS" },
    ],
  },
  "apex-pro": {
    state: "connected-known",
    model: "apex-pro",
    displayName: "COROS Apex Pro",
    productName: "Apex Pro",
    tagline: "Built for the Long Run",
    companion: "Your Apex Pro companion",
    connectHint: "",
    heroImage: apexProHero,
    heroAlt: "COROS Apex Pro",
    capacityLabel: "32 GB Apex Pro capacity fallback",
    fallbackBytes: PACE_PRO_BYTES,
    features: [
      { icon: "display", label: "Always-On MIP Display" },
      { icon: "weight", label: "Sapphire Glass Build" },
      { icon: "battery", label: "40 Hours Full GPS" },
    ],
  },
  apex: {
    state: "connected-known",
    model: "apex",
    displayName: "COROS Apex",
    productName: "Apex",
    tagline: "Built for the Trail",
    companion: "Your Apex companion",
    connectHint: "",
    heroImage: apexHero,
    heroAlt: "COROS Apex",
    capacityLabel: "4 GB Apex capacity fallback",
    fallbackBytes: PACE_4_BYTES,
    features: [
      { icon: "display", label: "Always-On MIP Display" },
      { icon: "weight", label: "Titanium/Steel Bezel" },
      { icon: "battery", label: "35 Hours Full GPS (46mm)" },
    ],
  },
};

export function getWatchPresentation(
  watchStatus: WatchStatus | null
): WatchPresentation {
  if (!watchStatus?.connected) {
    return DISCONNECTED_PRESENTATION;
  }

  if (watchStatus.model) {
    return MODEL_PRESENTATION[watchStatus.model];
  }

  return CONNECTED_UNKNOWN_PRESENTATION;
}
