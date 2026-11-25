// Opens the official COROS library's browser over the editor. The browser itself (StudioOfficial.tsx) loads the first
// time one of its entry points is used.
import { lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import type { OfficialBrowserProps } from "./StudioOfficial";

const Browser = lazy(() => import("./StudioOfficial"));

/** The browser, drawn over the whole window (not inside the panel that opened it). */
export function OfficialPicker(props: OfficialBrowserProps) {
  return createPortal(<Suspense fallback={null}><Browser {...props} /></Suspense>, document.body);
}
