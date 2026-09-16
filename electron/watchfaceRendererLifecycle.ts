import type { WebContents } from "electron";

export function onWatchfaceRendererNavigation(
  contents: WebContents,
  resetRenderer: () => void
): void {
  contents.on("did-start-navigation", (navigation) => {
    // Subframes and same-document navigation do not remount App's IPC listener.
    // Clearing readiness for them leaves subsequent website links queued forever.
    if (!navigation.isMainFrame || navigation.isSameDocument) return;
    resetRenderer();
  });
}
