import type { CorosWatchfaceDesignState, CorosWatchfaceResolutionDetails } from "../../electron/types";
import { batteryPreviewStateIndex } from "./watchfaceStudio";
import { watchfaceComponentAssetContracts } from "./watchfaceComponentAssetContracts";

/** Describe sprite roles from the actual template, without copying PNG payloads. */
export function watchfaceAutomationAssetContracts(
  resolution: CorosWatchfaceResolutionDetails | null,
  design: CorosWatchfaceDesignState,
  mode: "current" | "aod" = "current"
): Array<Record<string, any>> {
  const folders = resolution?.spriteFolders ?? [];
  const config = resolution?.config ?? {};
  const documentRoot = mode === "aod" ? "/design/modeDesigns/aod" : "/design";
  const battery = ([
    { layerId: "batteryIcon", overrideId: "config:battery_icon", configKey: "battery_icon_dir", label: "Fixed battery indicator" },
    { layerId: "controlBatteryIcon", overrideId: "config:control_battery_icon", configKey: "control_battery_icon_dir", label: "Battery indicator in the selectable metric slot" }
  ] as const).map(({ layerId, overrideId, configKey, label }) => {
    const configured = config[configKey]?.replace(/\\/g, "/");
    const explicit = configured ? folders.find((folder) => folder.kind === "state" && folder.folder === configured) : undefined;
    const fallbackName = layerId === "batteryIcon" ? "cl_battery_icon" : "battery";
    const folder = explicit ?? folders.find((candidate) => candidate.kind === "state" && candidate.folder.replace(/^a\//, "") === fallbackName);
    const override = design.configAssetOverrides?.[overrideId];
    const stateIndices = (folder?.files ?? []).map((_, index) => String(index));
    const stateReplacementsPath = `${documentRoot}/configAssetOverrides/${overrideId}/stateReplacements`;
    return {
      layerId, label, kind: "state-sprites" as const, liveSource: "battery", mode,
      configKey, overrideId, stateReplacementsPath,
      editStateReplacementsPath: `/design/configAssetOverrides/${overrideId}/stateReplacements`,
      templateKnown: Boolean(folder?.files.length),
      templateFolder: folder?.folder ?? null,
      stateIndices,
      spriteCount: stateIndices.length || null,
      states: (folder?.files ?? []).map((file, index) => ({
        index: String(index), path: file.path, width: file.width, height: file.height,
        replacementPath: `${stateReplacementsPath}/${index}`
      })),
      referenceFrame: resolution ? { directory: resolution.directory, width: resolution.width, height: resolution.height } : null,
      installedStateIndices: Object.keys(override?.stateReplacements ?? {}).filter((index) => /^\d+$/.test(index)).sort((a, b) => Number(a) - Number(b)),
      hasStaticReplacement: Boolean(override?.replacement),
      behavior: "Firmware selects the battery sprite as charge changes. Each state is a separate image; layer position and scale affect the whole state set.",
      replacementWarning: "A single replacement is a fallback copied into battery states; using one image for every state makes the indicator look static. Preserve the ordered template state set and draw distinct charge levels. Do not replace this role with a decorative background image.",
      stateOrder: "Keys are zero-based positions in the ordered template files array, not numbers parsed from filenames. Preserve extra template states; their firmware meanings need an on-watch check.",
      verification: {
        tool: "render_preview",
        ...(layerId === "controlBatteryIcon" ? { setup: { tool: "set_view", previewComplication: "battery" } } : {}),
        scenarios: [0, 50, 100].map((battery) => ({
          scenario: { values: { battery: String(battery) } },
          expectedPreviewStateIndex: stateIndices.length ? String(batteryPreviewStateIndex(stateIndices.length, battery)) : null
        })),
        note: "The editor previews charge using the first ten states at most; remaining template frames may be special states. If templateKnown is false, inspect a known template or explicitly author and test a complete ordered custom state set; do not invent a template state count. Firmware-specific behavior still needs an on-watch check."
      }
    };
  });
  return [...battery, ...watchfaceComponentAssetContracts(resolution, design, mode)];
}
