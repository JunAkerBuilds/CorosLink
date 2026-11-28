// What's new in C-LINK, as the phone app shows it (C-LINK's WhatsNewView): once a release, people who updated see a
// sheet over the app, one page per new feature with Try it, then the fixes. New installs skip it (they've just seen
// the intro: welcome.ts marks it shown). Help → What's New… and the Developer page show it again. The release last
// shown is kept by the main process (main/settings.ts `/whats-new`).
import { msg } from "@/lib/i18n";

/** Names this release's pages. A new name shows the sheet once more to everyone who updates. */
export const RELEASE = "0.2.0-clink.5";

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
  phone: "M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2",
  chat: "M4 5h16v11H9l-5 4z",
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z",
  watch: "M9 3h6l1 4H8zM8 17h8l-1 4H9zM12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 10v2l1.5 1",
  mountain: "M3 20l6-11 4 6 2.5-4L21 20z",
  grip: "M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8",
  play: "M8 5v14l11-7z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
};

/** This release's feature pages, in order. A fixes-only release leaves this empty. */
export const FEATURES: Feature[] = [
  {
    id: "phone-coach", icon: ICON.phone, tint: "blue", open: "/connect", beta: true,
    title: msg("Coach on your phone, anywhere"),
    detail: msg("Your paired phone talks to Coach on this computer, in the same conversations."),
    points: [
      { icon: ICON.chat, text: msg("Pick up a conversation on whichever screen is closer") },
      { icon: ICON.globe, text: msg("Reach from anywhere, on Connections, keeps it working away from home. Off until you turn it on.") },
      { icon: ICON.watch, text: msg("No phone? Dashboard and Coach work from your watch's activities") },
    ],
  },
  {
    id: "sports", icon: ICON.mountain, tint: "mint", open: "/sports",
    title: msg("A page for every sport you do"),
    detail: msg("Walking, Hiking, Skiing and Climbing join the others, shown only when you do them."),
    points: [
      { icon: ICON.chart, text: msg("Your week, the last four weeks and the climb") },
      { icon: ICON.trophy, text: msg("Recent sessions and records") },
      { icon: ICON.grip, text: msg("Drag the sport tabs into your own order. The hub and Go to follow it.") },
    ],
  },
  {
    id: "studio", icon: ICON.sparkle, tint: "violet", open: "/studio",
    title: msg("Watch Studio, closer to the watch"),
    detail: msg("What you see while you edit is what the watch will show."),
    points: [
      { icon: ICON.play, text: msg("The canvas plays a face's animation as the watch will") },
      { icon: ICON.phone, text: msg("Send to iPhone brings the editable project too") },
      { icon: ICON.sparkle, text: msg("Watchmaker runs your own Codex CLI, with all its tools") },
      { icon: ICON.ruler, text: msg("Values, colons and icons in a slot scale as one") },
    ],
  },
];

/** The fixes worth naming, for the last page. */
export const FIXES: string[] = [
  msg("Watch Studio: dragging stays smooth on busy faces"),
  msg("Watch Studio: always-on selection boxes sit in the right place on PACE Pro"),
  msg("Watch Studio: the barometer's icon can be dragged"),
  msg("Always-on digits have clean, solid edges"),
  msg("Phones on Windows: the pairing code puts Wi-Fi first, and Allow lets them through Windows Firewall"),
  msg("Calendar: the unsaved-changes bar stays at the bottom of the window"),
  msg("Checking for updates no longer fails while a new release is still being published"),
  msg("Back and forward arrows at the top of the sidebar"),
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
