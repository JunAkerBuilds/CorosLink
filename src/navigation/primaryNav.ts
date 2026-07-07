import {
  Activity,
  CalendarDays,
  LayoutGrid,
  Map as MapIcon,
  MessageCircle,
  Music,
  type LucideIcon,
} from "lucide-react";

export type PrimaryView =
  | "overview"
  | "media"
  | "training"
  | "calendar"
  | "maps"
  | "coach";

export interface PrimaryNavItem {
  id: PrimaryView;
  label: string;
  icon: LucideIcon;
  beta?: boolean;
  showActivity?: boolean;
}

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "media", label: "Media", icon: Music },
  { id: "maps", label: "Maps", icon: MapIcon, beta: true },
  { id: "training", label: "Training Hub", icon: Activity },
  { id: "calendar", label: "Calendar", icon: CalendarDays },
  {
    id: "coach",
    label: "Coach",
    icon: MessageCircle,
    beta: true,
    showActivity: true,
  },
];

export const SIDEBAR_EXPANDED_WIDTH = 248;
export const SIDEBAR_COLLAPSED_WIDTH = 72;
