import {
  Activity,
  BookOpen,
  CalendarDays,
  Database,
  Dumbbell,
  Footprints,
  LayoutGrid,
  Map as MapIcon,
  MessageCircle,
  Music,
  Settings,
  Watch,
  type LucideIcon,
} from "lucide-react";

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
  icon: LucideIcon;
  beta?: boolean;
  showActivity?: boolean;
  /** Shown only while the development build's Dev view is active. */
  developmentOnly?: boolean;
  /** Hidden from the startup-view picker (e.g. Settings). */
  excludeFromStartup?: boolean;
}

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "media", label: "Media", icon: Music },
  { id: "maps", label: "Maps", icon: MapIcon, beta: true },
  { id: "watchfaces", label: "Watch Faces", icon: Watch, beta: true },
  { id: "training", label: "Training Hub", icon: Activity },
  ...(import.meta.env.DEV
    ? [{
        id: "gear" as const,
        label: "Gear",
        icon: Footprints,
        developmentOnly: true,
      }]
    : []),
  { id: "library", label: "Training Library", icon: BookOpen },
  { id: "strength", label: "Strength", icon: Dumbbell, beta: true },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  {
    id: "coach",
    label: "Coach",
    icon: MessageCircle,
    showActivity: true,
  },
  { id: "data", label: "Data", icon: Database },
  {
    id: "settings",
    label: "Settings",
    icon: Settings,
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

export const SIDEBAR_EXPANDED_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
