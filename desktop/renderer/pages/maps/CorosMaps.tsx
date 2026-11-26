// COROS Maps, from the design's MapRegions board: COROS's official region packages (Topo and Landscape), downloaded
// to this computer and copied onto the watch over USB. Left: the watch's storage, the copy in progress and the maps
// cached here. Right: the package table with search, region, map version and layer filters.
import { useEffect, useMemo, useState } from "react";
import { Select } from "@/components/ui";
import { language, locale, msg, t } from "@/lib/i18n";
import type { CachedPackage, MapManifest, MapPackage, MapRegion, MapsWatch, PackagesStatus } from "../../../maps/types";
import { bytes, cancelInstall, cancelPackage, deleteCached, downloadPackage, installPackages, manifest, packages, said } from "../../maps";
import { MapsIcon } from "./MapsIcon";
import { StorageBar } from "./StorageBar";

const VERSIONS = [6, 5, 4];
const LAYER_LABEL = { topo: msg("Topo"), landscape: msg("Landscape") } as const;

function Ring({ pct }: { pct: number }) {
  const r = 9, c = 2 * Math.PI * r;
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true" className="mp-ring">
      <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" className="mp-ring-bg" />
      <circle cx="11" cy="11" r={r} fill="none" strokeWidth="2.5" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} strokeLinecap="round" transform="rotate(-90 11 11)" className="mp-ring-on" />
    </svg>
  );
}

export default function CorosMaps({ watch, readWatch }: { watch: MapsWatch | null | undefined; readWatch: () => void }) {
  const [version, setVersion] = useState<number | "match">("match");
  const shownVersion = version === "match" ? watch?.mapVersion ?? 5 : version;
  const [got, setGot] = useState<{ version: number; manifest: MapManifest } | null>(null);
  const list = got?.version === shownVersion ? got.manifest : null;
  const [status, setStatus] = useState<PackagesStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [continent, setContinent] = useState("all");
  const [layers, setLayers] = useState({ topo: true, landscape: true });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let live = true;
    manifest(shownVersion).then((m) => live && setGot({ version: shownVersion, manifest: m }), (e) => live && setProblem(said(e)));
    return () => { live = false; };
  }, [shownVersion, refresh]);

  const active = Boolean(status?.jobs.some((j) => j.state === "downloading") || status?.install?.state === "copying");
  useEffect(() => {
    let live = true;
    const read = () => packages().then((s) => live && setStatus(s), () => {});
    void read();
    const timer = setInterval(read, active ? 1000 : 10_000);
    return () => { live = false; clearInterval(timer); };
  }, [active, refresh]);

  const continents = useMemo(() => [...new Set(list?.regions.map((r) => r.continent) ?? [])].sort(), [list]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (list?.regions ?? []).filter((r) => (continent === "all" || r.continent === continent)
      && (!needle || r.name.toLowerCase().includes(needle) || r.parent?.toLowerCase().includes(needle))
      && ((layers.topo && r.topo) || (layers.landscape && r.landscape)));
  }, [list, q, continent, layers]);

  const cached = status?.cached ?? [];
  const cachedIds = new Set(cached.map((c) => c.packageId));
  const onWatch = new Set(status?.onWatch ?? []);
  const free = watch?.storage?.freeBytes;
  const installing = status?.install?.state === "copying";
  const selectedBytes = cached.filter((c) => checked.has(c.packageId)).reduce((a, c) => a + c.sizeBytes, 0);
  const act = (work: Promise<PackagesStatus>) => work.then(setStatus, (e) => setProblem(said(e)));
  const install = (ids: string[]) => {
    if (!watch?.usb) { setProblem(t("Plug the watch in with its USB cable to install maps.")); return; }
    void act(installPackages(ids));
  };

  const cell = (region: MapRegion, pkg: MapPackage | undefined) => {
    if (!pkg) return <td className="mp-cell-none">–</td>;
    const job = status?.jobs.find((j) => j.packageId === pkg.id);
    const low = free != null && pkg.sizeBytes > free;
    return (
      <td>
        <div className="mp-cell">
          <span className="mp-cell-size">{bytes(pkg.sizeBytes)}</span>
          {onWatch.has(pkg.id) ? <span className="mp-cell-on"><MapsIcon name="check" size={14} />{t("On your watch")}</span>
            : job?.state === "downloading" ? (
              <span className="mp-cell-dl"><Ring pct={job.totalBytes ? (job.receivedBytes / job.totalBytes) * 100 : 0} /><b>{job.totalBytes ? Math.round((job.receivedBytes / job.totalBytes) * 100) : 0}%</b>
                <button type="button" className="mp-ib" aria-label={t("Cancel {region} {layer} download", { region: region.name, layer: t(LAYER_LABEL[pkg.layer]) })} onClick={() => void act(cancelPackage(pkg.id))}><MapsIcon name="close" size={15} /></button></span>
            ) : cachedIds.has(pkg.id) ? (
              <span className="mp-cell-cached"><span className="mp-tag">{t("Cached")}</span>
                <button type="button" className="btn btn-glass mp-sm" onClick={() => install([pkg.id])} disabled={installing}><MapsIcon name="usb" size={14} />{t("Install on watch")}</button>
                <button type="button" className="mp-ib" aria-label={t("Delete cached {region} {layer}", { region: region.name, layer: t(LAYER_LABEL[pkg.layer]) })} onClick={() => void act(deleteCached(pkg.id))}><MapsIcon name="trash" size={15} /></button></span>
            ) : job?.state === "failed" ? (
              <span className="mp-cell-failed"><span><b>{t("Download failed.")}</b><small>{job.receivedBytes ? t("Download again to continue from {size}.", { size: bytes(job.receivedBytes) }) : job.message ?? t("Try again.")}</small></span>
                <button type="button" className="btn btn-glass mp-sm" onClick={() => void act(downloadPackage(pkg.id))}><MapsIcon name="refresh" size={14} />{t("Resume")}</button></span>
            ) : (
              <>
                {low && <span className="mp-cell-low"><b>{t("Low space")}</b><small>{t("More than the {size} free", { size: bytes(free) })}</small></span>}
                <button type="button" className="mp-ib" aria-label={t("Download {region} {layer}", { region: region.name, layer: t(LAYER_LABEL[pkg.layer]) })} title={t("Download package")} onClick={() => void act(downloadPackage(pkg.id))}><MapsIcon name="download" size={16} /></button>
              </>
            )}
        </div>
      </td>
    );
  };

  const regionOf = (c: CachedPackage) => c.region;
  return (
    <div className="mp-regions">
      <aside className="mp-regions-side" aria-label={t("Watch maps")}>
        <section className="card card-pad mp-watch-card" aria-label={t("Watch storage")}>
          <div className="mp-watch-row">
            <span className="mp-watch-icon"><MapsIcon name="watch" size={22} /></span>
            <span><b>{t("Watch maps")}</b><small>{watch ? `${watch.name} · ${watch.usb ? t("USB cable") : watch.linked ? t("Bluetooth only") : t("not plugged in")}` : t("No watch plugged in")}</small></span>
            {watch?.storage && <small className="mp-right">{t("{size} used", { size: bytes(watch.storage.totalBytes - watch.storage.freeBytes) })}<br />{t("{size} total", { size: bytes(watch.storage.totalBytes) })}</small>}
          </div>
          {!watch?.storage && <small className="mp-note"><MapsIcon name="usb" size={14} />{watch?.linked
            ? t("Bluetooth is too slow for COROS packages. Plug the watch into this computer with its USB cable and allow it on the watch.")
            : t("Plug the watch into this computer with its USB cable and allow it on the watch.")}</small>}
          {watch?.storage ? <StorageBar storage={watch.storage} /> : <button type="button" className="btn btn-glass" onClick={readWatch}>{t("Check again")}</button>}
          <small className="mp-note"><MapsIcon name="info" size={14} />{t("COROS packages are large. Install only the regions you need.")}</small>
        </section>

        {status?.install && status.install.state !== "cancelled" && (
          status.install.state === "copying" ? (
            <section className="card card-pad mp-copy" aria-label={t("Copy progress")}>
              <div className="mp-copy-head"><span>{t("Copying {name}", { name: status.install.label })}</span><b>{status.install.totalBytes ? Math.round((status.install.copiedBytes / status.install.totalBytes) * 100) : 0}%</b></div>
              <div className="mp-bar" role="progressbar" aria-label={t("Copy progress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.install.totalBytes ? Math.round((status.install.copiedBytes / status.install.totalBytes) * 100) : 0}>
                <span style={{ width: `${status.install.totalBytes ? (status.install.copiedBytes / status.install.totalBytes) * 100 : 0}%` }} />
              </div>
              <small>{t("{n} of {total} files · {copied} of {size}", { n: status.install.filesDone, total: status.install.files, copied: bytes(status.install.copiedBytes), size: bytes(status.install.totalBytes) })}</small>
              <div className="mp-copy-foot"><small>{t("Keep the watch connected until the copy finishes.")}</small><button type="button" className="btn btn-glass" onClick={() => void act(cancelInstall())}>{t("Cancel")}</button></div>
            </section>
          ) : (
            <section className={`card card-pad mp-done${status.install.state === "failed" ? " mp-done-bad" : ""}`} aria-label={t("Copied")}>
              <span className="mp-done-icon"><MapsIcon name={status.install.state === "failed" ? "warn" : "check"} size={17} /></span>
              <span>{status.install.state === "failed" ? status.install.message ?? t("The copy stopped.") : t("{name} is on your watch.", { name: status.install.label })}</span>
            </section>
          )
        )}

        <section className="card card-pad mp-cached" aria-label={t("Cached maps")}>
          <div className="mp-card-head"><span><h2>{t("Cached maps")}</h2><small>{t("On this computer")} · {bytes(status?.cacheBytes ?? 0)}</small></span><span className="mp-grow" />
            <button type="button" className="mp-ib" aria-label={t("Refresh cached maps")} onClick={() => setRefresh((r) => r + 1)}><MapsIcon name="refresh" size={16} /></button></div>
          {cached.length ? (
            <ul>
              {cached.map((c) => (
                <li key={c.packageId}>
                  <input type="checkbox" aria-label={t("Select {region} {layer}", { region: regionOf(c), layer: t(LAYER_LABEL[c.layer]) })} checked={checked.has(c.packageId)}
                    onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(c.packageId)) n.delete(c.packageId); else n.add(c.packageId); return n; })} />
                  <span><b>{regionOf(c)}</b><small>{t(LAYER_LABEL[c.layer])} · v{c.version} · {bytes(c.sizeBytes)}</small></span>
                  <button type="button" className="mp-ib" aria-label={t("Install cached package")} title={t("Install on watch")} onClick={() => install([c.packageId])} disabled={installing}><MapsIcon name="usb" size={16} /></button>
                  <button type="button" className="mp-ib" aria-label={t("Delete cached package")} onClick={() => void act(deleteCached(c.packageId))}><MapsIcon name="trash" size={16} /></button>
                </li>
              ))}
            </ul>
          ) : <p className="mp-note">{t("Packages you download stay here, ready to copy to any watch that reads the same map version.")}</p>}
          <button type="button" className="btn btn-primary mp-wide" onClick={() => install([...checked])} disabled={!checked.size || installing}><MapsIcon name="usb" size={16} />{t("Transfer selected ({n})", { n: checked.size })}</button>
          <small className="mp-note mp-center">{checked.size ? `${bytes(selectedBytes)}${free != null ? ` · ${t("{size} free on the watch", { size: bytes(free) })}` : ""}` : t("Pick cached maps to copy onto the watch.")}</small>
        </section>
      </aside>

      <section className="card card-pad mp-packages" aria-label={t("Official packages")}>
        <div className="mp-card-head">
          <span><small className="mp-label">{t("Official packages")}</small><h2>{list ? `v${list.version} · ${list.release}` : `v${shownVersion}`}</h2></span>
          <span className="mp-grow" />
          <button type="button" className="mp-ib" aria-label={t("Refresh package list")} onClick={() => setRefresh((r) => r + 1)}><MapsIcon name="refresh" size={16} /></button>
        </div>
        <div className="mp-filters">
          <label className="mp-search"><MapsIcon name="search" size={15} /><input type="search" aria-label={t("Search regions")} placeholder={t("Search regions")} value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <Select field className="mp-select" aria-label={t("Region")} value={continent} onChange={(e) => setContinent(e.target.value)}>
            <option value="all">{t("All regions")}</option>
            {continents.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select field className="mp-select" aria-label={t("Map version")} value={String(version)} onChange={(e) => setVersion(e.target.value === "match" ? "match" : Number(e.target.value))}>
            <option value="match">{t("Match my watch (v{version})", { version: watch?.mapVersion ?? 5 })}</option>
            {VERSIONS.map((v) => <option key={v} value={v}>v{v}</option>)}
          </Select>
          <div className="mp-chips" role="group" aria-label={t("Layers")}>
            <button type="button" className="chip" aria-pressed={layers.topo} onClick={() => setLayers((l) => ({ ...l, topo: !l.topo }))}>{t("Topo")}</button>
            <button type="button" className="chip" aria-pressed={layers.landscape} onClick={() => setLayers((l) => ({ ...l, landscape: !l.landscape }))}>{t("Landscape")}</button>
          </div>
        </div>
        {problem && <p className="mp-problem" role="alert">{problem}</p>}
        {!list ? <div className="mp-table-loading" aria-busy="true">{t("Loading COROS's package list…")}</div> : rows.length ? (
          <div className="mp-table-wrap">
            <table className="mp-table">
              <thead><tr>
                <th scope="col">{t("Region")}</th>
                {layers.topo && <th scope="col"><span><MapsIcon name="mountain" size={14} />{t("Topo")}<small>· {t("contours, trails, POIs")}</small></span></th>}
                {layers.landscape && <th scope="col"><span><MapsIcon name="layers" size={14} />{t("Landscape")}<small>· {t("roads, water, land")}</small></span></th>}
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <th scope="row"><b>{r.name}</b>{r.parent && <small>{list.regions.find((p) => p.id === r.parent)?.name ?? r.parent}</small>}</th>
                    {layers.topo && cell(r, r.topo)}
                    {layers.landscape && cell(r, r.landscape)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="mp-table-empty"><b>{t("No matching packages")}</b><small>{t("Try another name, or pick All regions.")}</small></div>}
        {list && <small className="mp-note">{t("COROS manifest updated {date}.", { date: new Date(list.updatedAt).toLocaleDateString(language() === "en" ? undefined : locale(), { day: "numeric", month: "short", year: "numeric" }) })}</small>}
      </section>
    </div>
  );
}
