import type { WatchModelId } from "./watchModels";

/** Device identity is independent of the resolution trees shared by templates. */
export const WATCHFACE_TARGETS = [
  { model: "pace-pro", label: "PACE Pro", firmwareType: "COROS W332", display: "amoled", previewSize: 416, sizes: [416, 800] },
  { model: "pace-4-pro", label: "PACE 4 Pro", firmwareType: "COROS W337", display: "amoled", previewSize: 466, sizes: [466, 800] },
  { model: "pace-4", label: "PACE 4", firmwareType: "COROS W336", display: "amoled", previewSize: 390, sizes: [390, 800] },
  { model: "pace-3", label: "PACE 3", firmwareType: "COROS W331", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] },
  { model: "nomad", label: "NOMAD", firmwareType: "COROS W942", display: "mip", previewSize: 260, sizes: [240, 260, 280, 800] },
  { model: "vertix-2", label: "VERTIX 2", firmwareType: "COROS B19", display: "mip", previewSize: 280, sizes: [240, 260, 280, 800] },
  { model: "vertix-2s", label: "VERTIX 2S", firmwareType: "COROS B19S", display: "mip", previewSize: 280, sizes: [240, 260, 280, 800] },
  { model: "apex-4", label: "APEX 4", firmwareType: "COROS W541", display: "mip", previewSize: 260, sizes: [240, 260, 280, 800] },
  { model: "pace-2", label: "PACE 2", firmwareType: "COROS B18", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] },
  { model: "apex-2-pro", label: "APEX 2 Pro", firmwareType: "COROS B20", display: "mip", previewSize: 260, sizes: [240, 260, 280, 800] },
  { model: "apex-2", label: "APEX 2", firmwareType: "COROS B21", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] },
  { model: "apex-pro", label: "APEX Pro", firmwareType: "COROS B17", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] },
  { model: "vertix", label: "VERTIX", firmwareType: "COROS B16", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] }
] as const satisfies ReadonlyArray<{
  model: WatchModelId;
  label: string;
  firmwareType: string;
  display: "mip" | "amoled";
  previewSize: number;
  sizes: readonly number[];
}>;

export type WatchfaceTarget = (typeof WATCHFACE_TARGETS)[number];

export function getWatchfaceTarget(modelOrFirmware: string | undefined): WatchfaceTarget | undefined {
  const value = modelOrFirmware?.trim().toLowerCase();
  return WATCHFACE_TARGETS.find(target =>
    target.model === value || target.firmwareType.toLowerCase() === value
  );
}

/** The model number the watch reports over Bluetooth ("W332"): its firmware type without "COROS ". */
export function watchfaceTargetHardware(target: WatchfaceTarget): string {
  return target.firmwareType.replace(/^COROS\s+/i, "");
}

/**
 * The target for a reported model number ("W332", "COROS W332", "W332-3.2008.0"). Longer
 * hardware IDs are tried first so "B19S" is not read as "B19".
 */
export function watchfaceTargetForModelNumber(modelNumber: string | undefined): WatchfaceTarget | undefined {
  const value = modelNumber?.trim().toUpperCase();
  if (!value) return undefined;
  return [...WATCHFACE_TARGETS].sort((a, b) => watchfaceTargetHardware(b).length - watchfaceTargetHardware(a).length)
    .find(target => new RegExp(`\\b${watchfaceTargetHardware(target)}\\b`).test(value));
}

/** The target for an advertised name ("COROS APEX 4 81D0"); the hex suffix only tells watches apart. */
export function watchfaceTargetForDeviceName(deviceName: string | undefined): WatchfaceTarget | undefined {
  const model = deviceName?.trim().replace(/\s+[0-9A-F]{4,8}$/i, "").toUpperCase();
  return model ? WATCHFACE_TARGETS.find(target => `COROS ${target.label}`.toUpperCase() === model) : undefined;
}

/**
 * The connected watch's target: by model number, else by advertised name. Only PACE Pro's model
 * number (W332) has been seen on a real watch; the name covers a model number CorosLink doesn't know.
 */
export function connectedWatchfaceTarget(watch: { modelNumber?: string; deviceName?: string } | null | undefined):
  { target: WatchfaceTarget; source: "model-number" | "name" } | undefined {
  const byModel = watchfaceTargetForModelNumber(watch?.modelNumber);
  if (byModel) return { target: byModel, source: "model-number" };
  const byName = watchfaceTargetForDeviceName(watch?.deviceName);
  return byName ? { target: byName, source: "name" } : undefined;
}

/** PACE Pro on firmware 3.2008.0 is the only watch every Bluetooth feature was checked on. */
export function isValidatedWatch(watch: { modelNumber?: string; deviceName?: string; firmwareRevision?: string; softwareRevision?: string } | null | undefined): boolean {
  return connectedWatchfaceTarget(watch)?.target.model === "pace-pro" &&
    /(^|[^0-9.])3\.2008\.0($|[^0-9])/.test([watch?.firmwareRevision, watch?.softwareRevision].filter(Boolean).join(" "));
}

/**
 * What a compiled BIN looks like for a target: the layout it compiles, the magic (screen size
 * reversed, then A for AMOLED or R for memory-in-pixel: "614A", "062R") and the picker thumbnail,
 * about 0.757 of the screen (measured from COROS's compiler).
 */
export interface WatchfaceBinTarget {
  model: WatchModelId;
  label: string;
  screen: number;
  display: "amoled" | "mip";
  layout: string;
  magic: string;
  thumbnail: number;
}

const THUMBNAILS: Record<number, number> = { 240: 182, 260: 197, 280: 212, 390: 295, 416: 315, 466: 353 };

export function watchfaceBinTarget(target: WatchfaceTarget): WatchfaceBinTarget {
  const screen = target.previewSize;
  return {
    model: target.model, label: target.label, screen, display: target.display,
    layout: `watchface_${screen}x${screen}`,
    magic: String(screen).split("").reverse().join("") + (target.display === "mip" ? "R" : "A"),
    thumbnail: THUMBNAILS[screen] ?? Math.round(screen * 0.7572)
  };
}

/** The targets a compiled BIN's magic fits; same-screen watches (APEX 4, NOMAD and APEX 2 Pro) share one BIN. */
export function watchfaceTargetsForMagic(magic: string): WatchfaceTarget[] {
  return WATCHFACE_TARGETS.filter(target => watchfaceBinTarget(target).magic === magic);
}
