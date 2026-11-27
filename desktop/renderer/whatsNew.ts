// What's new in C-LINK, as the phone app shows it (C-LINK's WhatsNewView): once a release, people who updated see a
// sheet over the app, one page per new feature with Try it, then the fixes. New installs skip it (they've just seen
// the intro: welcome.ts marks it shown). Help → What's New… and the Developer page show it again. The release last
// shown is kept by the main process (main/settings.ts `/whats-new`).
import { msg } from "@/lib/i18n";

/** Names this release's pages. A new name shows the sheet once more to everyone who updates. */
export const RELEASE = "0.2.0-clink.4";

/** Sent on the window to open the sheet now (Help → What's New…, the Developer page). */
export const SHOW_WHATS_NEW = "clink:whats-new";

/** A line on a feature page, with its icon (a 24 × 24 path). */
export interface Point { icon: string; text: string }

export interface Feature {
  id: string;
  icon: string;
  /** The hero's tint: one of the app's health colours. */
  tint: "mint" | "blue" | "violet" | "amber";
  title: string;
  detail: string;
  points: Point[];
  /** Where Try it goes. */
  open: string;
  /** Not finished yet, and says so. */
  beta?: boolean;
}

export const ICON = {
  ruler: "M3 17 17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2",
  route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 4-4h6M18 9v6a4 4 0 0 1-4 4H8",
  swim: "M2 17c2 0 2-1.5 4-1.5S8 17 10 17s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M2 21c2 0 2-1.5 4-1.5S8 21 10 21s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 13l4-8 4 3M15 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  weight: "M6 7h12l2 13H4zM9 7a3 3 0 0 1 6 0",
  swap: "M7 7h13l-3-3M17 17H4l3 3",
  mail: "M4 5h16v14H4zM4 6l8 7 8-7",
  reply: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 6 6v4",
  tag: "M20 12 12 20l-9-9V3h8zM7.5 7.5h.01",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  bug: "M8 8a4 4 0 0 1 8 0v1H8zM6 10h12v4a6 6 0 0 1-12 0zM12 10v10M3 13h3M18 13h3M4 7l2.5 2M20 7l-2.5 2M4 20l2.5-2.5M20 20l-2.5-2.5",
  plane: "M2 12h4l3-8h2l-1 8h5l2-3h2l-1 4 1 4h-2l-2-3h-5l1 8H9l-3-8H2z",
  wrench: "M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z",
  tick: "M5 12.5l4.5 4.5L19 7.5",
};

/** This release's feature pages, in order. A fixes-only release leaves this empty. */
export const FEATURES: Feature[] = [
  {
    id: "units", icon: ICON.ruler, tint: "mint", open: "/settings",
    title: msg("Miles or kilometres, your pick"),
    detail: msg("Settings → Language & units switches every screen to imperial."),
    points: [
      { icon: ICON.route, text: msg("Distances in miles and feet, paces in min/mi, speeds in mph") },
      { icon: ICON.swim, text: msg("Swims in yards, starting on a 25 yd pool") },
      { icon: ICON.weight, text: msg("Body weight and lifts in pounds") },
      { icon: ICON.swap, text: msg("Your data stays as it is, so you can switch back any time") },
    ],
  },
  {
    id: "report", icon: ICON.mail, tint: "blue", open: "/settings/logs?send",
    title: msg("Tell me what broke"),
    detail: msg("Help → Report a Problem… sends the error log and your message straight to me."),
    points: [
      { icon: ICON.reply, text: msg("Add an email if you'd like a reply") },
      { icon: ICON.tag, text: msg("You get a reference back to quote") },
      { icon: ICON.shield, text: msg("Home folders and keys are taken out first") },
    ],
  },
  {
    id: "privacy", icon: ICON.shield, tint: "violet", open: "/settings/privacy",
    title: msg("Your data, your call"),
    detail: msg("Usage counts and crash reports each have a switch in Settings → Privacy."),
    points: [
      { icon: ICON.chart, text: msg("Usage counts: a random ID, the app version and your OS. Nothing more.") },
      { icon: ICON.bug, text: msg("Crash reports stay off until you turn them on") },
      { icon: ICON.plane, text: msg("Nothing is sent in Local mode") },
    ],
  },
];

/** The fixes worth naming, for the last page. */
export const FIXES: string[] = [
  msg("Watch Studio: Download offers the project ZIP to upload to Community"),
  msg("Watch Studio: the Download menu opens above the panels, not under them"),
  msg("Watch Studio: text and shapes sit just above the background in Layers, and a click picks the layer in front"),
  msg("Watch Studio: an “i” on each layer says how that kind of layer works"),
  msg("Watch Studio: thin pictures no longer show as a checkered strip"),
  msg("A pace typed with /km or /mi is read in that unit"),
  msg("Popovers are as solid as the drop-down menus, so busy pages don't show through"),
];

const BASE = "/api/desktop/settings/whats-new";

/** Whether this release's sheet is still to show. */
export async function whatsNewDue(): Promise<boolean> {
  try {
    const answer = await fetch(BASE, { cache: "no-store" });
    return answer.ok && ((await answer.json()) as { shown?: string }).shown !== RELEASE;
  } catch {
    return false;
  }
}

/** Notes this release's sheet as shown (when it opens, so a crash inside it can't bring it back every launch). */
export async function markWhatsNew(shown = RELEASE): Promise<void> {
  await fetch(BASE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shown }) }).catch(() => undefined);
}

/** Opens the sheet now, from anywhere in the window. */
export function showWhatsNew(): void {
  dispatchEvent(new Event(SHOW_WHATS_NEW));
}
