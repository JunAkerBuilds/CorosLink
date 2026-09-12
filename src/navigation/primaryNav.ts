import {
  ChartLineUp,
  Books,
  CalendarDots,
  Database,
  Barbell,
  Sneaker,
  SquaresFour,
  MapTrifold,
  ChatCircleDots,
  MusicNotes,
  GearSix,
  Watch,
  type Icon,
} from "@phosphor-icons/react";

export type PrimaryView =
  | "overview"
  | "media"
  | "training"
  | "gear"
  | "library"
  | "strength"
  | "data"
  | "calendar"
  | "maps"
  | "watchfaces"
  | "coach"
  | "settings";

export interface PrimaryNavItem {
  id: PrimaryView;
  label: string;
  icon: Icon;
  sectionLabel?: string;
  beta?: boolean;
  showActivity?: boolean;
  /** Shown only while the development build's Dev view is active. */
  developmentOnly?: boolean;
  /** Hidden from the startup-view picker (e.g. Settings). */
  excludeFromStartup?: boolean;
}

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { id: "overview", label: "Overview", icon: SquaresFour, sectionLabel: "Workspace" },
  { id: "media", label: "Media", icon: MusicNotes },
  { id: "maps", label: "Maps", icon: MapTrifold, beta: true },
  { id: "watchfaces", label: "Watch Faces", icon: Watch, beta: true },
  { id: "training", label: "Training Hub", icon: ChartLineUp, sectionLabel: "Training" },
  ...(import.meta.env.DEV
    ? [{
        id: "gear" as const,
        label: "Gear",
        icon: Sneaker,
        developmentOnly: true,
      }]
    : []),
  { id: "library", label: "Training Library", icon: Books },
  { id: "strength", label: "Strength", icon: Barbell, beta: true },
  { id: "calendar", label: "Calendar", icon: CalendarDots },
  {
    id: "coach",
    label: "Coach",
    icon: ChatCircleDots,
    showActivity: true,
  },
  { id: "data", label: "Data", icon: Database, sectionLabel: "Manage" },
  {
    id: "settings",
    label: "Settings",
    icon: GearSix,
    excludeFromStartup: true,
  },
];

export function visiblePrimaryNavItems(
  showDevelopmentItems: boolean,
): PrimaryNavItem[] {
  return PRIMARY_NAV_ITEMS.filter(
    (item) => !item.developmentOnly || showDevelopmentItems,
  );
}

export const SIDEBAR_EXPANDED_WIDTH = 232;
// Leave room for all three macOS window controls and their side insets.
export const SIDEBAR_COLLAPSED_WIDTH = 96;
