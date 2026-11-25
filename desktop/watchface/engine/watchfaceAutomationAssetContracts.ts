import type { CorosWatchfaceDesignState, CorosWatchfaceResolutionDetails } from "../types";
import { batteryPreviewStateIndex, batteryStateMeaning, COROS_BATTERY_STATE_ORDER } from "./watchfaceBatteryStates";
import { watchfaceComponentAssetContracts } from "./watchfaceComponentAssetContracts";
import { DEFAULT_ANIMATION_DELAY, MAX_ANIMATION_DELAY, MAX_ANIMATION_FRAMES, MIN_ANIMATION_DELAY } from "./watchfaceAnimationLimits";

/** Describe sprite roles from the actual template, without copying PNG payloads. */
export function watchfaceAutomationAssetContracts(
  resolution: CorosWatchfaceResolutionDetails | null,
  design: CorosWatchfaceDesignState,
  mode: "current" | "aod" = "current"
): Array<Record<string, unknown>> {
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
        meaning: batteryStateMeaning(stateIndices.length, index),
        replacementPath: `${stateReplacementsPath}/${index}`
      })),
      referenceFrame: resolution ? { directory: resolution.directory, width: resolution.width, height: resolution.height } : null,
      installedStateIndices: Object.keys(override?.stateReplacements ?? {}).filter((index) => /^\d+$/.test(index)).sort((a, b) => Number(a) - Number(b)),
      hasStaticReplacement: Boolean(override?.replacement),
      behavior: "Firmware selects the battery sprite as charge changes. Each state is a separate image; layer position and scale affect the whole state set.",
      replacementWarning: "A single replacement is a fallback copied into battery states; using one image for every state makes the indicator look static. Preserve the ordered template state set and draw distinct charge levels. Do not replace this role with a decorative background image.",
      stateOrder: "Keys are zero-based positions in the ordered template files array, not numbers parsed from filenames. " + (stateIndices.length === 12 ? COROS_BATTERY_STATE_ORDER : "Nonstandard state count: preserve the template order; firmware meanings are unknown."),
      stateMappingKnown: stateIndices.length === 12,
      verification: {
        tool: "render_preview",
        ...(layerId === "controlBatteryIcon" ? { setup: { tool: "set_view", previewComplication: "battery" } } : {}),
        scenarios: [0, 50, 100].map((battery) => ({
          scenario: { values: { battery: String(battery) } },
          expectedPreviewStateIndex: stateIndices.length ? String(batteryPreviewStateIndex(stateIndices.length, battery)) : null
        })),
        note: "For standard twelve-frame sets, normal charge uses 1 + floor(percent / 10): 0% → 1, 50% → 6, 100% → 11. Index 0 is charging and is not selected by percentage simulation. Other state counts use an approximate preview; their firmware mapping is unknown. If templateKnown is false, inspect a known template or explicitly author and test a complete ordered custom state set; do not invent a template state count. Firmware-specific behavior still needs an on-watch check."
      }
    };
  });
  const animation = design.animation;
  const animationContract = {
    layerId: "animation", label: "Native sprite animation", kind: "frame-sequence" as const, mode,
    designPath: "/design/animation", supportedInMode: mode === "current",
    present: Boolean(animation?.frames.length), enabled: animation?.enabled ?? false,
    frameCount: animation?.frames.length ?? 0, maxFrames: MAX_ANIMATION_FRAMES,
    frameSize: animation ? { width: animation.width, height: animation.height } : null,
    position: animation ? { x: animation.x, y: animation.y } : null,
    delaysMs: animation?.delays ?? [],
    delayRangeMs: { minimum: MIN_ANIMATION_DELAY, maximum: MAX_ANIMATION_DELAY, default: DEFAULT_ANIMATION_DELAY },
    referenceFrame: resolution ? { directory: resolution.directory, width: resolution.width, height: resolution.height } : null,
    targets: "AMOLED watches (PACE Pro, PACE 4, PACE 4 Pro), and the MIP watches PACE 3, NOMAD, APEX 4, APEX 2 and APEX 2 Pro, where all frames together must stay under 64 KB encoded (about one byte per pixel before compression) : the compiler cuts the shared empty margin, then leaves frames out evenly to fit, with a warning saying how many play. VERTIX 2/2S, VERTIX, PACE 2 and APEX Pro always drop it.",
    behavior: "The watch plays the frames itself, looping, each held for its delay, over the flattened background and under progress arcs, time, date and data. Only the Current (lit) screen animates; AOD never does. One animation per face.",
    create: "Set /design/animation to {enabled:true, x, y, width, height, frames:[{assetId}…], delays:[ms…]} in one apply_commands batch (mode current). x/y is the top-left in capabilities.placement pixels; width/height must equal every frame's PNG size in those pixels.",
    edit: "Replace frames by setting /design/animation/frames (and width/height if the size changes); retime with /design/animation/delays (one per frame). Move with move_layer/place_layers on layer animation; hide with set_visibility; remove with op unset on /design/animation.",
    verification: {
      tool: "render_preview",
      note: "render_preview shows frame 0 as a still; the editor canvas plays the loop. Check frame 0's placement, then inspect_asset the other frames for consistent size, registration (same anchor point frame to frame) and transparent backgrounds. Playback on the watch itself (wake, duration) is unverified."
    }
  };
  return [...battery, ...(mode === "current" || animation ? [animationContract] : []), ...watchfaceComponentAssetContracts(resolution, design, mode)];
}
