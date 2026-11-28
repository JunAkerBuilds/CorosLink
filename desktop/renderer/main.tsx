// The renderer: the web app's styles and fonts (bundled, so the app works offline), the theme, then the app.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/nunito/900.css";
import "@/app/globals.css";
import "./desktop.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { platformSlots } from "@/lib/platform";
import { App } from "./App";
import { LocalModeCards, LocalModePanel, LocalModeTools } from "./parts/LocalMode";
import { RailFoot } from "./parts/RailFoot";
import { HistoryArrows } from "./parts/HistoryArrows";
import { UpdatesBadge, UpdatesMenuItem } from "./parts/Updates";
import { MobileBeta } from "./parts/MobileBeta";
import { CoachAI } from "./parts/CoachAI";
import { ThisComputer } from "./parts/ThisComputer";
import { WatchLink } from "./parts/WatchLink";
import { startAutomationInbox } from "./studioAutomationInbox";
import { msg } from "@/lib/i18n";
import { loadLanguage } from "@/lib/i18n/load";
import { tellLanguage } from "./settings";

// What the web app's theme boot script does before the first paint: light, dark, or the system's.
try {
  const choice = localStorage.getItem("clink.theme") ?? "system";
  const dark = choice === "dark" || (choice === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
} catch {
  document.documentElement.dataset.theme = "light";
}

// What the desktop puts into the shared screens.
// The Mac window has no title bar (main.ts): desktop.css then clears the window buttons and adds a drag strip.
if (navigator.userAgent.includes("Macintosh")) document.documentElement.dataset.titlebar = "inset";
platformSlots.connectProfile = ThisComputer;
// Everything is kept on this computer, so "From your phone" / "From C-LINK" say nothing here. Live COROS data and
// sample data still say where they come from.
platformSlots.originShown = (origin) => origin === "coros";
// Coach's AI is picked in the desktop's own Coach settings (main process: ai/service.ts).
platformSlots.aiSettingsHref = "/coach/settings";
// …and switched right in Coach's message box: provider, model and power level (parts/CoachAI.tsx).
platformSlots.coachAI = CoachAI;
// The dashboard invites people with no phone paired here to the C-LINK iPhone beta (parts/MobileBeta.tsx).
platformSlots.dashboardNote = MobileBeta;
platformSlots.settingsHref = "/settings";
platformSlots.railNote = RailFoot;
// Back and forward through the screens opened in this window, at the top of the sidebar (parts/HistoryArrows.tsx).
platformSlots.railTop = HistoryArrows;
// C-LINK's own updates: a row in the account menu, and a dot on the account button when one is waiting.
platformSlots.accountItem = UpdatesMenuItem;
platformSlots.accountBadge = UpdatesBadge;
// Watch says when the watch is plugged into this computer.
platformSlots.watchLink = WatchLink;
// Local mode: the watch paired to this computer over Bluetooth (parts/LocalMode.tsx, main/watch/service.ts).
platformSlots.watchPanel = LocalModePanel;
platformSlots.watchCards = LocalModeCards;
platformSlots.watchTools = LocalModeTools;
// Media lives only here: the library on this computer and the watch as a USB drive (pages/Media.tsx).
// Maps plans routes and puts COROS maps on the watch (pages/Maps.tsx, main/maps/service.ts).
// Studio makes watch faces, kept on this computer (pages/Studio.tsx, main/studio.ts).
platformSlots.nav = [
  { href: "/media", label: msg("Media"), group: 3, icon: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0a3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0a3 3 0 0 1 6 0z" },
  { href: "/maps", label: msg("Maps"), group: 3, icon: "M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5zM9 4v13.5M15 6.5V20" },
  { href: "/studio", label: msg("Studio"), group: 3, icon: "M12 3a9 9 0 1 0 0 18c1.2 0 1.7-1 1.2-2-.5-1 .2-2.3 1.4-2.3H17a4 4 0 0 0 4-4C21 7 17 3 12 3zM7.5 11.5h.01M9.5 7.5h.01M14.5 7.5h.01" },
];

// Requests from the watch-face MCP server and Watchmaker reach the open Studio editor through this (studioAutomationInbox.ts).
startAutomationInbox();

// The language's words load before the first paint (src/lib/i18n/load.ts); the main process hears which it is.
void loadLanguage().then((lang) => {
  void tellLanguage(lang);
  createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
});
