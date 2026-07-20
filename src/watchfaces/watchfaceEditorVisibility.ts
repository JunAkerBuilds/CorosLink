import type {
  CorosWatchfaceDesignState,
  CorosWatchfaceTemplateDetails
} from "../../electron/types";
import {
  isControlComplicationEnabled,
  listWatchfaceConfigAssets,
  WATCHFACE_COMPLICATIONS,
  type WatchfaceConfigAssetReference,
  type WatchfacePreviewMode
} from "./watchfaceStudio.ts";

interface WatchfacePanelLayer {
  kind: string;
  present: boolean;
  layoutGroupId?: string;
  metricId?: string;
  configAssetId?: string;
}

/**
 * Returns every config-backed asset the Layers panel must keep addressable.
 * Rendered details provide live geometry and replacement paths; source details
 * retain references deleted from the config when an asset is hidden.
 */
export function listWatchfaceEditorConfigAssets(
  sourceDetails: CorosWatchfaceTemplateDetails,
  renderedDetails: CorosWatchfaceTemplateDetails,
  virtualControlIcons: ReadonlyArray<
    (typeof WATCHFACE_COMPLICATIONS)[number]["id"]
  > = []
): WatchfaceConfigAssetReference[] {
  const byId = new Map(
    listWatchfaceConfigAssets(
      sourceDetails,
      undefined,
      virtualControlIcons,
      true
    )
      .map((reference) => [reference.id, reference])
  );
  for (const reference of listWatchfaceConfigAssets(
    renderedDetails,
    undefined,
    virtualControlIcons,
    true
  )) {
    const sourceReference = byId.get(reference.id);
    byId.set(
      reference.id,
      reference.source === null && sourceReference?.source
        ? sourceReference
        : reference
    );
  }
  return [...byId.values()];
}

/** Whether a derived layer remains recoverable from the Layers panel. */
export function watchfaceEditorLayerIsListed(
  layer: WatchfacePanelLayer,
  previewMode: WatchfacePreviewMode,
  design: CorosWatchfaceDesignState
): boolean {
  if (
    previewMode === "current" ||
    layer.present ||
    layer.kind === "background" ||
    layer.kind === "backgroundElement" ||
    layer.kind === "customSprite"
  ) {
    return true;
  }
  if (
    layer.metricId &&
    design.metricChanges?.[layer.metricId] === false
  ) {
    return true;
  }
  if (
    layer.configAssetId &&
    design.configAssetOverrides?.[layer.configAssetId]?.enabled === false
  ) {
    return true;
  }
  return Boolean(
    layer.layoutGroupId &&
    design.layerVisibility?.[layer.layoutGroupId] === false
  );
}

/** Retains an editor-added selectable battery after it has been switched off. */
export function watchfaceEditorControlBatteryIsListed(
  templateHasBattery: boolean,
  enabled: boolean,
  configured: boolean | undefined,
  legacyConfigured: boolean | undefined
): boolean {
  return (
    templateHasBattery ||
    enabled ||
    configured !== undefined ||
    legacyConfigured !== undefined
  );
}

/**
 * Keeps the parent selector recoverable after its last enabled choice removes
 * all firmware geometry. The current-mode layer panel lists this state even
 * when `present` and `visible` are both false.
 */
export function watchfaceEditorSelectableParentState(
  details: CorosWatchfaceTemplateDetails,
  design: CorosWatchfaceDesignState,
  present: boolean
): { visible: boolean; present: boolean } {
  const enabled = WATCHFACE_COMPLICATIONS.some((complication) =>
    isControlComplicationEnabled(details, design, complication.id)
  );
  return {
    visible:
      enabled && design.layerVisibility?.complication !== false,
    present
  };
}
