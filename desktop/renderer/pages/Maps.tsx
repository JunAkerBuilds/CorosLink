// Maps (desktop only), from the design's Maps boards: the title row with Map areas | COROS Maps | Route Studio and the
// watch pill, then the chosen part. Each part loads only when opened.
import { lazy, Suspense, useEffect, useState } from "react";
import type { MapsWatch } from "../../maps/types";
import { mapsWatch } from "../maps";
import { navigate, useRouteParams } from "../router";
import { MapsIcon } from "./maps/MapsIcon";
import { watchLine } from "./maps/watchLine";
import "./maps.css";

const MapAreas = lazy(() => import("./maps/MapAreas"));
const CorosMaps = lazy(() => import("./maps/CorosMaps"));
const RouteStudio = lazy(() => import("./maps/RouteStudio"));

const TABS = [
  { tab: "", label: "Map areas" },
  { tab: "coros", label: "COROS Maps" },
  { tab: "routes", label: "Route Studio" },
] as const;

/** The watch as Maps sees it, read again every 15 s: the Bluetooth link and the USB drive both come and go. */
export function useMapsWatch(): [MapsWatch | null | undefined, () => void] {
  const [watch, setWatch] = useState<MapsWatch | null | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () => mapsWatch().then((w) => live && setWatch(w), () => live && setWatch(null));
    void read();
    const timer = setInterval(read, 15_000);
    return () => { live = false; clearInterval(timer); };
  }, [tick]);
  return [watch, () => setTick((t) => t + 1)];
}

export function WatchPill({ watch }: { watch: MapsWatch | null | undefined }) {
  if (watch === undefined) return null;
  return (
    <span className="mp-watch-pill">
      <span className="mp-watch-pill-icon"><MapsIcon name="watch" size={14} /></span>
      {watch?.name ?? "Watch"}
      <span className="mp-watch-pill-state">{watchLine(watch)}</span>
      <i data-on={watch && (watch.linked || watch.usb) ? "" : undefined} aria-hidden="true" />
    </span>
  );
}

export default function Maps() {
  const params = useRouteParams();
  const tab = params.tab === "coros" || params.tab === "routes" ? params.tab : "";
  const [watch, readWatch] = useMapsWatch();
  return (
    <main className={`page mp-page${tab === "routes" ? " mp-page-wide" : ""}`}>
      <div className="mp-title-row">
        <h1>Maps</h1>
        <nav className="seg mp-tabs" aria-label="Maps sections">
          {TABS.map((t) => (
            <a key={t.tab} href={`/maps${t.tab ? "/" + t.tab : ""}`} aria-current={t.tab === tab ? "page" : undefined}
              onClick={(e) => { e.preventDefault(); navigate(`/maps${t.tab ? "/" + t.tab : ""}`); }}>{t.label}</a>
          ))}
        </nav>
        <span className="mp-grow" />
        <WatchPill watch={watch} />
      </div>
      <Suspense fallback={<div className="card mp-loading" aria-busy="true" />}>
        {tab === "" && <MapAreas watch={watch} readWatch={readWatch} />}
        {tab === "coros" && <CorosMaps watch={watch} readWatch={readWatch} />}
        {tab === "routes" && <RouteStudio watch={watch} />}
      </Suspense>
    </main>
  );
}
