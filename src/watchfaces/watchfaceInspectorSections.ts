import type { CorosWatchfaceBackgroundElement } from "../../electron/types";
import type { EditorLayerKind } from "./watchfaceEditorModel";

export type WatchfaceInspectorSectionId =
  | "layer"
  | "transform"
  | "appearance"
  | "stroke"
  | "specific"
  | "effects"
  | "advanced";

export interface WatchfaceInspectorSectionDescriptor {
  id: WatchfaceInspectorSectionId;
  title: string;
  defaultOpen: boolean;
}

export interface WatchfaceInspectorSectionContext {
  kind: EditorLayerKind;
  backgroundKind?: CorosWatchfaceBackgroundElement["kind"];
  hasTransform?: boolean;
  hasAppearance?: boolean;
  hasStroke?: boolean;
  hasEffects?: boolean;
  hasAdvanced?: boolean;
}

export const WATCHFACE_INSPECTOR_DEFAULT_OPEN: Readonly<
  Record<WatchfaceInspectorSectionId, boolean>
> = {
  layer: true,
  transform: true,
  appearance: true,
  stroke: true,
  specific: true,
  effects: false,
  advanced: false
};

export function watchfaceInspectorSpecificTitle(
  context: Pick<WatchfaceInspectorSectionContext, "kind" | "backgroundKind">
): string {
  if (context.kind === "background") return "Background";
  if (context.kind === "customSprite") return "Image";
  if (context.kind === "configAsset") return "Asset";
  if (context.kind === "backgroundElement") {
    return context.backgroundKind === "text" ? "Text" : "Shape";
  }
  if (
    context.kind === "time" ||
    context.kind === "seconds" ||
    context.kind === "date" ||
    context.kind === "weekday" ||
    context.kind === "battery"
  ) {
    return "Typography";
  }
  if (
    context.kind === "batteryIcon" ||
    context.kind === "controlBatteryIcon"
  ) {
    return "Sprite";
  }
  if (
    context.kind === "weather" ||
    context.kind === "separators"
  ) {
    return "Indicator";
  }
  return "Data";
}

export function watchfaceInspectorSectionPlan(
  context: WatchfaceInspectorSectionContext
): WatchfaceInspectorSectionDescriptor[] {
  const sections: WatchfaceInspectorSectionDescriptor[] = [
    {
      id: "layer",
      title: "Layer",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.layer
    }
  ];
  if (context.hasTransform) {
    sections.push({
      id: "transform",
      title: "Transform",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.transform
    });
  }
  if (context.hasAppearance) {
    sections.push({
      id: "appearance",
      title: "Appearance",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.appearance
    });
  }
  if (context.hasStroke) {
    sections.push({
      id: "stroke",
      title: "Stroke",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.stroke
    });
  }
  sections.push({
    id: "specific",
    title: watchfaceInspectorSpecificTitle(context),
    defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.specific
  });
  if (context.hasEffects) {
    sections.push({
      id: "effects",
      title: "Effects",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.effects
    });
  }
  if (context.hasAdvanced) {
    sections.push({
      id: "advanced",
      title: "Advanced",
      defaultOpen: WATCHFACE_INSPECTOR_DEFAULT_OPEN.advanced
    });
  }
  return sections;
}
