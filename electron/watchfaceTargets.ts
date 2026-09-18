import type { WatchModelId } from "./watchModels";

/** Device identity is independent of the resolution trees shared by templates. */
export const WATCHFACE_TARGETS = [
  { model: "pace-pro", label: "PACE Pro", firmwareType: "COROS W332", display: "amoled", previewSize: 416, sizes: [416, 800] },
  { model: "pace-4", label: "PACE 4", firmwareType: "COROS W336", display: "amoled", previewSize: 390, sizes: [390, 800] },
  { model: "pace-3", label: "PACE 3", firmwareType: "COROS W331", display: "mip", previewSize: 240, sizes: [240, 260, 280, 800] },
  { model: "nomad", label: "NOMAD", firmwareType: "COROS W942", display: "mip", previewSize: 260, sizes: [240, 260, 280, 800] },
  { model: "vertix-2", label: "VERTIX 2", firmwareType: "COROS B19", display: "mip", previewSize: 280, sizes: [240, 260, 280, 800] },
  { model: "vertix-2s", label: "VERTIX 2S", firmwareType: "COROS B19S", display: "mip", previewSize: 280, sizes: [240, 260, 280, 800] },
  { model: "apex-4", label: "APEX 4", firmwareType: "COROS W541", display: "mip", previewSize: 260, sizes: [240, 260, 280, 800] }
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
