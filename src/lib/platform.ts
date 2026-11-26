// Parts the desktop app (desktop/renderer/main.tsx) puts into the screens in src/, set before the first render.
import type { ComponentType } from "react";
import type { Origin } from "@/data/core";

export const platformSlots: {
  /** The profile at the top of Connections (the desktop's This computer). */
  connectProfile?: ComponentType;
  /** Which "where these numbers come from" badges to show; every one when unset. Sample data always shows. */
  originShown?: (origin: Origin) => boolean;
  /** Where the host app picks Coach's AI, instead of pasting an Anthropic key here. */
  aiSettingsHref?: string;
  /** In Coach's message box: the host app's own AI, model and power level picker, in place of the read-only label. */
  coachAI?: ComponentType;
  /** In Connections' COROS account card, above Training Hub: the host app's own way into the account (the desktop's import). */
  corosAccount?: ComponentType;
  /** A hook: whether that way in is connected, for the card's pill. */
  useCorosAccountConnected?: () => boolean;
  /** The host app's Settings page, linked from the account menu. */
  settingsHref?: string;
  /** A row the host app adds to the account menu, after Settings (the desktop's Updates, with its flyout). */
  accountItem?: ComponentType;
  /** A mark on the account button, such as a dot when the host app wants attention (an update is waiting). */
  accountBadge?: ComponentType;
  /** Something the host app shows at the foot of the sidebar, above the watch and account (the desktop's Local-Only chip). */
  railNote?: ComponentType;
  /** Sidebar items only the host app has (the desktop's Media), placed after the web app's own in their group. */
  nav?: readonly NavItem[];
  /** A line on Watch under the sync line, saying how the watch is linked to this device right now (the desktop's USB). */
  watchLink?: ComponentType;
  /** Under that line on Watch: how the watch syncs with this device and its own actions (the desktop's Local mode). */
  watchPanel?: ComponentType;
  /** Cards at the top of Watch's board, before the watch's settings (the desktop's Last sync, On this computer). */
  watchCards?: ComponentType;
  /** Cards at the foot of Watch's board (the desktop's Watch tools). */
  watchTools?: ComponentType;
} = {};

export interface NavItem { href: string; label: string; group: number; icon: string }
