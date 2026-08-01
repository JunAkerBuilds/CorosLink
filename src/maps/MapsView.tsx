import {
  AlertCircle,
  Download,
  FolderOpen,
  Globe,
  HardDrive,
  Loader2,
  Map as MapIcon,
  RefreshCw,
  Route,
  Search,
  Trash2,
  X,
  Upload
} from "lucide-react";
import {
  type ReactNode,
  useEffect,
  useMemo,
  useState
} from "react";
import type {
  CachedCorosMapPackage,
  CorosMapDownloadJob,
  CorosMapInstallProgress,
  CorosMapLocalSelection,
  CorosMapManifest,
  CorosMapPackage,
  WatchStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown } from "../components/SelectDropdown";
import { formatBytes } from "../media/libraryUtils";
import { RouteStudio } from "./routes/RouteStudio";
import {
  defineSelectionPreference,
  selectionIsBoolean,
  selectionIsOneOf,
  useSelectionPreference
} from "../preferences/selectionPreferences";

type MapsTab = "coros" | "routes";

interface CorosMapFilterPreference {
  region: string;
  landscape: boolean;
  topo: boolean;
}

const MAPS_TAB_PREFERENCE = defineSelectionPreference<MapsTab>({
  key: "maps.activeTab",
  defaultValue: "coros",
  validate: selectionIsOneOf(["coros", "routes"])
});

const COROS_MAP_FILTER_PREFERENCE =
  defineSelectionPreference<CorosMapFilterPreference>({
    key: "maps.corosFilters",
    defaultValue: { region: "all", landscape: true, topo: true },
    validate: (value): value is CorosMapFilterPreference => {
      if (typeof value !== "object" || value === null) return false;
      const candidate = value as Record<string, unknown>;
      return (
        typeof candidate.region === "string" &&
        selectionIsBoolean(candidate.landscape) &&
        selectionIsBoolean(candidate.topo)
      );
    }
  });

interface MapPackageGroup {
  key: string;
  title: string;
  parent: string;
  topo?: CorosMapPackage;
  landscape?: CorosMapPackage;
}

interface MapsViewProps {
  api: CorosLinkApi;
  watchStatus: WatchStatus | null;
  onWatchStatusChange: (status: WatchStatus) => void;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}

export function MapsView({
  api,
  watchStatus,
  onWatchStatusChange,
  onMessage,
  onError
}: MapsViewProps) {
  const [activeTab, setActiveTab] = useSelectionPreference(
    MAPS_TAB_PREFERENCE
  );

  return (
    <div className="maps-view stack">
      <div className="media-tabs-shell">
        <nav className="media-tabs" aria-label="Maps sections">
          <MapsTabButton
            active={activeTab === "coros"}
            icon={<MapIcon size={16} aria-hidden="true" />}
            label="COROS Maps"
            onClick={() => setActiveTab("coros")}
          />
          <MapsTabButton
            active={activeTab === "routes"}
            icon={<Route size={16} aria-hidden="true" />}
            label="Route Studio"
            onClick={() => setActiveTab("routes")}
          />
        </nav>
      </div>

      {activeTab === "coros" ? (
        <CorosMapsTab
          api={api}
          watchStatus={watchStatus}
          onWatchStatusChange={onWatchStatusChange}
          onMessage={onMessage}
          onError={onError}
        />
      ) : (
        <RouteStudio api={api} onMessage={onMessage} onError={onError} />
      )}
    </div>
  );
}

function MapsTabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={active ? "media-tab active" : "media-tab"}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function CorosMapsTab({
  api,
  watchStatus,
  onWatchStatusChange,
  onMessage,
  onError
}: MapsViewProps) {
  const [manifest, setManifest] = useState<CorosMapManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useSelectionPreference(
    COROS_MAP_FILTER_PREFERENCE
  );
  const {
    region: regionFilter,
    landscape: showLandscape,
    topo: showTopo
  } = filters;
  const [localSelection, setLocalSelection] =
    useState<CorosMapLocalSelection | null>(null);
  const [downloadJobs, setDownloadJobs] = useState<CorosMapDownloadJob[]>([]);
  const [installProgress, setInstallProgress] =
    useState<CorosMapInstallProgress | null>(null);
  const [cachedPackages, setCachedPackages] = useState<
    CachedCorosMapPackage[]
  >([]);
  const [selectedCachedIds, setSelectedCachedIds] = useState<Set<string>>(
    () => new Set()
  );

  const freeBytes = watchStatus?.freeBytes;
  const watchConnected = Boolean(watchStatus?.connected);
  const batchInstalling = busy === "install-cache-batch";

  useEffect(() => {
    setSelectedCachedIds((current) => {
      const validIds = new Set(cachedPackages.map((cached) => cached.packageId));
      const next = new Set(
        [...current].filter((packageId) => validIds.has(packageId))
      );
      return next.size === current.size ? current : next;
    });
  }, [cachedPackages]);

  const transferableCachedIds = useMemo(() => {
    if (!watchConnected) {
      return [];
    }

    return cachedPackages
      .filter(
        (cached) => freeBytes === undefined || cached.sizeBytes <= freeBytes
      )
      .map((cached) => cached.packageId);
  }, [cachedPackages, watchConnected, freeBytes]);

  const selectedTotalBytes = useMemo(
    () =>
      cachedPackages
        .filter((cached) => selectedCachedIds.has(cached.packageId))
        .reduce((sum, cached) => sum + cached.sizeBytes, 0),
    [cachedPackages, selectedCachedIds]
  );

  const allTransferableSelected =
    transferableCachedIds.length > 0 &&
    transferableCachedIds.every((packageId) =>
      selectedCachedIds.has(packageId)
    );
  const someTransferableSelected = transferableCachedIds.some((packageId) =>
    selectedCachedIds.has(packageId)
  );
  const batchTooLarge =
    freeBytes !== undefined && selectedTotalBytes > freeBytes;
  const selectedCount = selectedCachedIds.size;

  useEffect(() => {
    void loadManifest();
    void loadMapCacheState();
    const unsubscribeDownloads = api.onCorosMapDownloadJobsUpdate((jobs) => {
      setDownloadJobs(jobs);
      if (jobs.some((job) => job.status === "cached")) {
        void loadCachedPackages();
      }
    });
    const unsubscribeInstall = api.onCorosMapInstallProgressUpdate((progress) => {
      setInstallProgress(progress);
    });
    return () => {
      unsubscribeDownloads();
      unsubscribeInstall();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadManifest() {
    setLoading(true);
    onError(null);
    try {
      setManifest(await api.getCorosMapManifest());
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setLoading(false);
    }
  }

  async function loadMapCacheState() {
    try {
      const [jobs, cached] = await Promise.all([
        api.listCorosMapDownloadJobs(),
        api.listCachedCorosMaps()
      ]);
      setInstallProgress(await api.getCorosMapInstallProgress());
      setDownloadJobs(jobs);
      setCachedPackages(cached);
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  async function loadCachedPackages() {
    try {
      setCachedPackages(await api.listCachedCorosMaps());
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  async function handleDownloadPackage(pkg: CorosMapPackage) {
    setBusy(`download:${pkg.id}`);
    onError(null);
    onMessage(null);
    try {
      setDownloadJobs(await api.downloadCorosMapPackage(pkg));
      onMessage(`Started downloading ${pkg.title} inside CorosLink.`);
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelDownload(job: CorosMapDownloadJob) {
    setBusy(`cancel:${job.id}`);
    onError(null);
    onMessage(null);
    try {
      setDownloadJobs(await api.cancelCorosMapDownload(job.id));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleClearDownloadJob(job: CorosMapDownloadJob) {
    setBusy(`clear:${job.id}`);
    onError(null);
    onMessage(null);
    try {
      setDownloadJobs(await api.clearCorosMapDownloadJob(job.id));
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleInstallCached(packageId: string) {
    setBusy(`install-cache:${packageId}`);
    onError(null);
    onMessage(null);
    try {
      const result = await api.installCachedCorosMap(packageId);
      onWatchStatusChange(result.watch);
      setCachedPackages(await api.listCachedCorosMaps());
      onMessage(`Installed ${formatBytes(result.sizeBytes)} of map files.`);
    } catch (caught) {
      reportInstallOutcome(caught, onMessage, onError);
    } finally {
      setBusy(null);
    }
  }

  async function handleInstallSelectedCached() {
    const packageIds = [...selectedCachedIds];
    if (packageIds.length === 0) {
      return;
    }

    setBusy("install-cache-batch");
    onError(null);
    onMessage(null);
    try {
      const result = await api.installCachedCorosMaps(packageIds);
      onWatchStatusChange(result.watch);
      setCachedPackages(await api.listCachedCorosMaps());
      setSelectedCachedIds(new Set());
      onMessage(
        `Installed ${formatBytes(result.sizeBytes)} of map files from ${packageIds.length} packages.`
      );
    } catch (caught) {
      reportInstallOutcome(caught, onMessage, onError);
    } finally {
      setBusy(null);
    }
  }

  async function handleCancelInstall() {
    onError(null);
    onMessage(null);
    try {
      await api.cancelCorosMapInstall();
    } catch (caught) {
      onError(toErrorMessage(caught));
    }
  }

  function toggleCachedSelection(packageId: string) {
    setSelectedCachedIds((current) => {
      const next = new Set(current);
      if (next.has(packageId)) {
        next.delete(packageId);
      } else {
        next.add(packageId);
      }
      return next;
    });
  }

  function toggleSelectAllCached() {
    if (allTransferableSelected) {
      setSelectedCachedIds(new Set());
      return;
    }

    setSelectedCachedIds(new Set(transferableCachedIds));
  }

  async function handleDeleteCached(packageId: string) {
    setBusy(`delete-cache:${packageId}`);
    onError(null);
    onMessage(null);
    try {
      setCachedPackages(await api.deleteCachedCorosMap(packageId));
      onMessage("Removed the cached map package.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleChooseFolder() {
    setBusy("choose-folder");
    onError(null);
    onMessage(null);
    try {
      const selection = await api.chooseCorosMapFolder();
      if (selection) {
        setLocalSelection(selection);
        onMessage("Local COROS map folder selected.");
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleInstallFolder() {
    if (!localSelection) {
      return;
    }

    setBusy("install-folder");
    onError(null);
    onMessage(null);
    try {
      const result = await api.installCorosMapFolder(localSelection.sourcePath);
      onWatchStatusChange(result.watch);
      onMessage(`Installed ${formatBytes(result.sizeBytes)} of map files.`);
    } catch (caught) {
      reportInstallOutcome(caught, onMessage, onError);
    } finally {
      setBusy(null);
    }
  }

  const regionOptions = useMemo(() => {
    const regions = new Map<string, string>();
    for (const pkg of manifest?.packages ?? []) {
      const key = pkg.parent === "global" ? pkg.region : pkg.parent;
      const title =
        pkg.parent === "global"
          ? pkg.title
          : titleFromRegionId(pkg.parent);
      regions.set(key, title);
    }

    return Array.from(regions.entries()).sort((left, right) =>
      left[1].localeCompare(right[1], undefined, { numeric: true })
    );
  }, [manifest]);

  const regionFilterOptions = useMemo(
    () => [
      { value: "all", label: "All regions" },
      ...regionOptions.map(([id, title]) => ({ value: id, label: title }))
    ],
    [regionOptions]
  );

  useEffect(() => {
    if (
      manifest &&
      !regionFilterOptions.some((option) => option.value === regionFilter)
    ) {
      setFilters((current) => ({ ...current, region: "all" }));
    }
  }, [manifest, regionFilter, regionFilterOptions, setFilters]);

  const packageGroups = useMemo(() => {
    const terms = normalizeSearch(query);
    const groups = new Map<string, MapPackageGroup>();

    for (const pkg of manifest?.packages ?? []) {
      if (
        regionFilter !== "all" &&
        pkg.region !== regionFilter &&
        pkg.parent !== regionFilter
      ) {
        continue;
      }

      if (
        terms &&
        !normalizeSearch(`${pkg.title} ${pkg.region} ${pkg.type}`).includes(
          terms
        )
      ) {
        continue;
      }

      let group = groups.get(pkg.region);
      if (!group) {
        group = {
          key: pkg.region,
          title: pkg.title,
          parent: pkg.parent
        };
        groups.set(pkg.region, group);
      }

      if (pkg.type === "topo") {
        group.topo = pkg;
      } else if (pkg.type === "landscape") {
        group.landscape = pkg;
      }
    }

    return [...groups.values()].filter(
      (group) =>
        (showTopo && group.topo) || (showLandscape && group.landscape)
    );
  }, [manifest, query, regionFilter, showLandscape, showTopo]);

  const cachedByPackageId = useMemo(() => {
    const cached = new Map<string, CachedCorosMapPackage>();
    for (const item of cachedPackages) {
      cached.set(item.packageId, item);
    }
    return cached;
  }, [cachedPackages]);

  const latestJobByPackageId = useMemo(() => {
    const jobs = new Map<string, CorosMapDownloadJob>();
    for (const job of downloadJobs) {
      if (!jobs.has(job.packageId)) {
        jobs.set(job.packageId, job);
      }
    }
    return jobs;
  }, [downloadJobs]);

  return (
    <div className="maps-grid">
      <section className="panel maps-sidebar">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Watch maps</p>
            <h2 className="watch-title">
              <span
                className={
                  watchStatus?.connected ? "watch-dot is-online" : "watch-dot"
                }
                aria-hidden="true"
              />
              {watchStatus?.connected
                ? watchStatus.name ?? "COROS watch"
                : "No watch connected"}
            </h2>
          </div>
          <HardDrive size={20} aria-hidden="true" />
        </div>

        <WatchStoragePanel status={watchStatus} />

        <div className="maps-warning">
          <AlertCircle size={18} aria-hidden="true" />
          <p>
            COROS packages are large. Install only the regions you need and
            merge into the watch map folder.
          </p>
        </div>

        <div className="local-map-install">
          <button
            type="button"
            className="secondary-button"
            onClick={handleChooseFolder}
            disabled={busy === "choose-folder"}
          >
            {busy === "choose-folder" ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <FolderOpen size={17} aria-hidden="true" />
            )}
            Choose Local Map Folder
          </button>

          {localSelection ? (
            <div className="local-map-selection">
              <strong>{shortPath(localSelection.mapPath)}</strong>
              <span>
                {formatBytes(localSelection.sizeBytes)} ·{" "}
                {localSelection.fileCount} files
              </span>
            </div>
          ) : null}

          <button
            type="button"
            className="primary-button"
            onClick={handleInstallFolder}
            disabled={
              !watchStatus?.connected ||
              !localSelection ||
              busy === "install-folder"
            }
          >
            {busy === "install-folder" ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Upload size={17} aria-hidden="true" />
            )}
            Install to Watch
          </button>
        </div>

        {installProgress ? (
          <MapInstallProgressPanel
            progress={installProgress}
            onCancel={() => void handleCancelInstall()}
          />
        ) : null}

        <div className="map-cache-section">
          <div className="map-cache-heading">
            <span>Cached maps</span>
            <button
              type="button"
              className="icon-button"
              title="Refresh cached maps"
              onClick={() => void loadCachedPackages()}
            >
              <RefreshCw size={15} aria-hidden="true" />
            </button>
          </div>

          {cachedPackages.length === 0 ? (
            <p className="map-cache-empty">No cached map packages.</p>
          ) : (
            <>
              <div className="map-cache-toolbar">
                <label className="check-row map-cache-select-all">
                  <input
                    type="checkbox"
                    checked={allTransferableSelected}
                    ref={(input) => {
                      if (input) {
                        input.indeterminate =
                          someTransferableSelected && !allTransferableSelected;
                      }
                    }}
                    onChange={toggleSelectAllCached}
                    disabled={
                      !watchConnected ||
                      transferableCachedIds.length === 0 ||
                      batchInstalling
                    }
                  />
                  Select all
                </label>
                <button
                  type="button"
                  className="primary-button map-cache-transfer-button"
                  onClick={() => void handleInstallSelectedCached()}
                  disabled={
                    selectedCount === 0 ||
                    !watchConnected ||
                    batchInstalling ||
                    batchTooLarge
                  }
                >
                  {batchInstalling ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <Upload size={17} aria-hidden="true" />
                  )}
                  Transfer selected{selectedCount > 0 ? ` (${selectedCount})` : ""}
                </button>
              </div>
              {batchTooLarge ? (
                <small className="map-cache-batch-warning">
                  Selected packages exceed current free space (
                  {formatBytes(selectedTotalBytes)} selected,{" "}
                  {formatBytes(freeBytes!)} free)
                </small>
              ) : null}
              <div className="map-cache-list">
                {cachedPackages.map((cached) => (
                  <CachedMapRow
                    key={cached.packageId}
                    cached={cached}
                    busy={busy}
                    watchConnected={watchConnected}
                    freeBytes={freeBytes}
                    selected={selectedCachedIds.has(cached.packageId)}
                    selectionDisabled={
                      batchInstalling ||
                      !watchConnected ||
                      (freeBytes !== undefined &&
                        cached.sizeBytes > freeBytes)
                    }
                    onToggleSelect={toggleCachedSelection}
                    onInstall={handleInstallCached}
                    onDelete={handleDeleteCached}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <section className="panel maps-main-panel">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Official packages</p>
            <h2>
              {manifest
                ? `v${manifest.version}${manifest.bundleVersion ? ` · ${manifest.bundleVersion}` : ""}`
                : "COROS Maps"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            title="Refresh package list"
            onClick={() => void loadManifest()}
            disabled={loading}
          >
            <RefreshCw
              size={18}
              aria-hidden="true"
              className={loading ? "spin" : ""}
            />
          </button>
        </div>

        <div className="map-filter-row">
          <label className="input-shell maps-search">
            <Search size={18} aria-hidden="true" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search regions"
            />
          </label>

          <SelectDropdown
            className="app-select--maps"
            label="Region"
            value={regionFilter}
            options={regionFilterOptions}
            onChange={(region) =>
              setFilters((current) => ({ ...current, region }))
            }
          />

          <label className="check-row maps-check">
            <input
              type="checkbox"
              checked={showLandscape}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  landscape: event.target.checked
                }))
              }
            />
            Landscape
          </label>
          <label className="check-row maps-check">
            <input
              type="checkbox"
              checked={showTopo}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  topo: event.target.checked
                }))
              }
            />
            Topo
          </label>
        </div>

        <div className="map-package-list">
          {loading && !manifest ? (
            <MapsEmpty
              icon={<Loader2 className="spin" size={20} aria-hidden="true" />}
              title="Loading packages"
            />
          ) : packageGroups.length === 0 ? (
            <MapsEmpty
              icon={<Search size={20} aria-hidden="true" />}
              title="No matching packages"
            />
          ) : (
            <div className="table-shell maps-table-shell">
              <table>
                <thead>
                  <tr>
                    <th>Region</th>
                    {showTopo ? (
                      <>
                        <th>Topo size</th>
                        <th>Topo</th>
                      </>
                    ) : null}
                    {showLandscape ? (
                      <>
                        <th>Landscape size</th>
                        <th>Landscape</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {packageGroups.map((group) => (
                    <MapRegionRow
                      key={group.key}
                      group={group}
                      showTopo={showTopo}
                      showLandscape={showLandscape}
                      freeBytes={freeBytes}
                      busy={busy}
                      watchConnected={Boolean(watchStatus?.connected)}
                      jobsByPackageId={latestJobByPackageId}
                      cachedByPackageId={cachedByPackageId}
                      onDownload={handleDownloadPackage}
                      onCancel={handleCancelDownload}
                      onClearJob={handleClearDownloadJob}
                      onInstallCached={handleInstallCached}
                      onDeleteCached={handleDeleteCached}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {manifest?.updatedAt ? (
          <p className="maps-footnote">
            COROS manifest updated {manifest.updatedAt}.
          </p>
        ) : null}
      </section>
    </div>
  );
}

function WatchStoragePanel({ status }: { status: WatchStatus | null }) {
  if (!status?.connected) {
    return (
      <div className="watch-storage is-empty">
        <HardDrive size={18} aria-hidden="true" />
        <p>
          Connect your COROS watch over USB to see storage and install maps.
        </p>
      </div>
    );
  }

  const total = status.totalBytes;
  const free = status.freeBytes;
  const used =
    status.usedBytes ??
    (total !== undefined && free !== undefined ? total - free : undefined);
  const maps = status.mapSizeBytes ?? 0;
  const hasBar =
    total !== undefined && total > 0 && used !== undefined && used >= 0;
  const mapsPct = hasBar ? Math.min(100, (maps / total) * 100) : 0;
  const otherPct = hasBar
    ? Math.max(0, Math.min(100 - mapsPct, ((used - maps) / total) * 100))
    : 0;
  const other = used !== undefined ? Math.max(0, used - maps) : undefined;

  return (
    <div className="watch-storage">
      {hasBar ? (
        <>
          <div
            className="watch-storage-bar"
            role="img"
            aria-label={`${formatBytes(used)} of ${formatBytes(total)} used`}
          >
            <span className="seg maps" style={{ width: `${mapsPct}%` }} />
            <span className="seg other" style={{ width: `${otherPct}%` }} />
          </div>
          <div className="watch-storage-caption">
            <span>
              <strong>{formatBytes(used)}</strong> used
            </span>
            <span>{formatBytes(total)} total</span>
          </div>
        </>
      ) : null}

      <div className="watch-storage-legend">
        <WatchStorageLegend
          swatch="maps"
          label="Maps"
          value={`${formatBytes(maps)} · ${status.mapFileCount ?? 0} files`}
        />
        {other !== undefined ? (
          <WatchStorageLegend
            swatch="other"
            label="Other"
            value={formatBytes(other)}
          />
        ) : null}
        <WatchStorageLegend
          swatch="free"
          label="Free"
          value={free !== undefined ? formatBytes(free) : "—"}
        />
      </div>
    </div>
  );
}

function WatchStorageLegend({
  swatch,
  label,
  value
}: {
  swatch: "maps" | "other" | "free";
  label: string;
  value: string;
}) {
  return (
    <div className="watch-storage-legend-item">
      <span className={`watch-storage-swatch ${swatch}`} aria-hidden="true" />
      <span className="watch-storage-legend-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MapInstallProgressPanel({
  progress,
  onCancel
}: {
  progress: CorosMapInstallProgress;
  onCancel: () => void;
}) {
  const percent = Math.round(Math.max(0, Math.min(progress.progress, 1)) * 100);
  const phaseLabel =
    progress.phase === "failed"
      ? "Install failed"
      : progress.phase === "cancelled"
        ? "Transfer cancelled"
        : progress.phase === "completed"
          ? "Install complete"
          : progress.phase === "preparing"
            ? "Preparing install"
            : "Copying to watch";

  return (
    <div
      className={
        progress.phase === "failed"
          ? "map-install-progress is-failed"
          : progress.phase === "cancelled"
            ? "map-install-progress is-cancelled"
            : "map-install-progress"
      }
    >
      <div className="map-install-progress-heading">
        <strong>{phaseLabel}</strong>
        <span>{percent}%</span>
      </div>
      <div className="map-download-progress-track">
        <span style={{ width: `${Math.max(2, percent)}%` }} />
      </div>
      <small>
        {progress.label} · {formatBytes(progress.copiedBytes)} of{" "}
        {formatBytes(progress.totalBytes)} · {progress.copiedFiles}/
        {progress.totalFiles} files
      </small>
      {progress.error ? (
        <p className="map-install-error">{progress.error}</p>
      ) : progress.active ? (
        <div className="map-install-progress-actions">
          <p>Keep the watch connected until the copy finishes.</p>
          <button
            type="button"
            className="secondary-button"
            onClick={onCancel}
          >
            Cancel transfer
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MapRegionRow({
  group,
  showTopo,
  showLandscape,
  freeBytes,
  busy,
  watchConnected,
  jobsByPackageId,
  cachedByPackageId,
  onDownload,
  onCancel,
  onClearJob,
  onInstallCached,
  onDeleteCached
}: {
  group: MapPackageGroup;
  showTopo: boolean;
  showLandscape: boolean;
  freeBytes?: number;
  busy: string | null;
  watchConnected: boolean;
  jobsByPackageId: Map<string, CorosMapDownloadJob>;
  cachedByPackageId: Map<string, CachedCorosMapPackage>;
  onDownload: (pkg: CorosMapPackage) => void;
  onCancel: (job: CorosMapDownloadJob) => void;
  onClearJob: (job: CorosMapDownloadJob) => void;
  onInstallCached: (packageId: string) => void;
  onDeleteCached: (packageId: string) => void;
}) {
  const regionLabel =
    group.parent === "global"
      ? "Full region"
      : titleFromRegionId(group.parent);

  const cellProps = {
    freeBytes,
    busy,
    watchConnected,
    jobsByPackageId,
    cachedByPackageId,
    onDownload,
    onCancel,
    onClearJob,
    onInstallCached,
    onDeleteCached
  };

  return (
    <tr>
      <td className="map-region-cell">
        <strong>{group.title}</strong>
        <span>{regionLabel}</span>
      </td>
      {showTopo ? <MapPackageCell pkg={group.topo} {...cellProps} /> : null}
      {showLandscape ? (
        <MapPackageCell pkg={group.landscape} {...cellProps} />
      ) : null}
    </tr>
  );
}

function MapPackageCell({
  pkg,
  freeBytes,
  busy,
  watchConnected,
  jobsByPackageId,
  cachedByPackageId,
  onDownload,
  onCancel,
  onClearJob,
  onInstallCached,
  onDeleteCached
}: {
  pkg?: CorosMapPackage;
  freeBytes?: number;
  busy: string | null;
  watchConnected: boolean;
  jobsByPackageId: Map<string, CorosMapDownloadJob>;
  cachedByPackageId: Map<string, CachedCorosMapPackage>;
  onDownload: (pkg: CorosMapPackage) => void;
  onCancel: (job: CorosMapDownloadJob) => void;
  onClearJob: (job: CorosMapDownloadJob) => void;
  onInstallCached: (packageId: string) => void;
  onDeleteCached: (packageId: string) => void;
}) {
  if (!pkg) {
    return (
      <>
        <td className="map-size-cell is-empty">
          <span className="map-type-none">—</span>
        </td>
        <td className="map-type-cell is-empty">
          <span className="map-type-none">—</span>
        </td>
      </>
    );
  }

  const job = jobsByPackageId.get(pkg.id);
  const cached = cachedByPackageId.get(pkg.id);
  const tooLarge = freeBytes !== undefined && pkg.sizeBytes > freeBytes;
  const isActiveDownload =
    job?.status === "queued" || job?.status === "downloading";
  const failedOrCancelled =
    job?.status === "failed" || job?.status === "cancelled";
  const installDisabled =
    !watchConnected || tooLarge || busy === `install-cache:${pkg.id}`;
  const downloadPercent = Math.round(
    Math.max(0, Math.min(job?.progress ?? 0, 1)) * 100
  );
  const downloadProgressLabel = `${formatProgress(job)} · ${formatBytes(
    job?.receivedBytes ?? 0
  )} of ${formatBytes(job?.sizeBytes || pkg.sizeBytes)}`;

  return (
    <>
      <td className="map-size-cell">
        <div className="map-type-meta">
          <span
            className={tooLarge ? "map-type-size is-danger" : "map-type-size"}
          >
            {formatBytes(pkg.sizeBytes)}
          </span>
          {tooLarge ? <span className="badge warning">Low space</span> : null}
          {cached ? <span className="badge success">Cached</span> : null}
        </div>
      </td>

      <td className="map-type-cell">
        {isActiveDownload ? (
          <div
            className="map-download-progress-circle"
            aria-label={downloadProgressLabel}
            title={downloadProgressLabel}
          >
            <span
              className="map-download-progress-ring"
              style={{
                background: `conic-gradient(var(--accent) ${Math.max(
                  2,
                  downloadPercent
                )}%, rgba(255, 255, 255, 0.1) 0)`
              }}
            >
              <strong>{downloadPercent}%</strong>
            </span>
          </div>
        ) : failedOrCancelled ? (
          <small className="map-download-error">
            {job.status === "failed"
              ? job.error || "Download failed."
              : "Download cancelled."}
          </small>
        ) : null}

        <div className="table-actions">
          {cached ? (
            <>
              <button
                type="button"
                className="icon-button"
                title="Install on watch"
                aria-label="Install on watch"
                onClick={() => onInstallCached(pkg.id)}
                disabled={installDisabled}
              >
                {busy === `install-cache:${pkg.id}` ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Upload size={16} aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="icon-button"
                title="Delete cached package"
                aria-label="Delete cached package"
                onClick={() => onDeleteCached(pkg.id)}
                disabled={busy === `delete-cache:${pkg.id}`}
              >
                {busy === `delete-cache:${pkg.id}` ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Trash2 size={16} aria-hidden="true" />
                )}
              </button>
            </>
          ) : isActiveDownload && job ? (
            <button
              type="button"
              className="icon-button"
              title="Cancel download"
              aria-label="Cancel download"
              onClick={() => onCancel(job)}
              disabled={busy === `cancel:${job.id}`}
            >
              {busy === `cancel:${job.id}` ? (
                <Loader2 className="spin" size={16} aria-hidden="true" />
              ) : (
                <X size={16} aria-hidden="true" />
              )}
            </button>
          ) : (
            <>
              <button
                type="button"
                className="icon-button"
                title="Download package"
                aria-label="Download package"
                onClick={() => onDownload(pkg)}
                disabled={busy === `download:${pkg.id}`}
              >
                {busy === `download:${pkg.id}` ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Download size={16} aria-hidden="true" />
                )}
              </button>
              {failedOrCancelled && job ? (
                <button
                  type="button"
                  className="icon-button"
                  title="Clear download status"
                  aria-label="Clear download status"
                  onClick={() => onClearJob(job)}
                  disabled={busy === `clear:${job.id}`}
                >
                  {busy === `clear:${job.id}` ? (
                    <Loader2 className="spin" size={16} aria-hidden="true" />
                  ) : (
                    <X size={16} aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </>
          )}
        </div>
      </td>
    </>
  );
}

function CachedMapRow({
  cached,
  busy,
  watchConnected,
  freeBytes,
  selected,
  selectionDisabled,
  onToggleSelect,
  onInstall,
  onDelete
}: {
  cached: CachedCorosMapPackage;
  busy: string | null;
  watchConnected: boolean;
  freeBytes?: number;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelect: (packageId: string) => void;
  onInstall: (packageId: string) => void;
  onDelete: (packageId: string) => void;
}) {
  const tooLarge = freeBytes !== undefined && cached.sizeBytes > freeBytes;
  const installing =
    busy === `install-cache:${cached.packageId}` ||
    busy === "install-cache-batch";

  return (
    <div className="map-cache-row">
      <label className="check-row map-cache-row-check">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(cached.packageId)}
          disabled={selectionDisabled}
          aria-label={`Select ${cached.title}`}
        />
      </label>
      <div>
        <strong>{cached.title}</strong>
        <span>
          {cached.type === "topo" ? "Topo" : "Landscape"} ·{" "}
          {formatBytes(cached.sizeBytes)}
        </span>
      </div>
      <div className="map-cache-actions">
        <button
          type="button"
          className="icon-button"
          title="Install cached package"
          onClick={() => onInstall(cached.packageId)}
          disabled={!watchConnected || tooLarge || installing}
        >
          {busy === `install-cache:${cached.packageId}` ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <Upload size={15} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          className="icon-button"
          title="Delete cached package"
          onClick={() => onDelete(cached.packageId)}
          disabled={
            busy === `delete-cache:${cached.packageId}` || installing
          }
        >
          {busy === `delete-cache:${cached.packageId}` ? (
            <Loader2 className="spin" size={15} aria-hidden="true" />
          ) : (
            <Trash2 size={15} aria-hidden="true" />
          )}
        </button>
      </div>
      {tooLarge ? <small>Too large for current free space</small> : null}
    </div>
  );
}

function MapsEmpty({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <div className="maps-empty">
      {icon}
      <strong>{title}</strong>
    </div>
  );
}

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function titleFromRegionId(value: string): string {
  return value
    .split("-")
    .map((part) =>
      /^\d+$/.test(part)
        ? part
        : `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`
    )
    .join(" ")
    .replace(/([A-Za-z]+)(\d+)$/, "$1 - $2");
}

function shortPath(value: string): string {
  const parts = value.split(/[/\\]/).filter(Boolean);
  return parts.slice(-3).join("/");
}

function formatProgress(job?: CorosMapDownloadJob): string {
  if (!job) {
    return "0%";
  }

  return `${Math.round(Math.max(0, Math.min(job.progress, 1)) * 100)}%`;
}

function reportInstallOutcome(
  error: unknown,
  onMessage: (message: string | null) => void,
  onError: (message: string | null) => void
): void {
  if (isInstallTransferCancelled(error)) {
    onError(null);
    onMessage("Transfer cancelled.");
    return;
  }

  onError(toErrorMessage(error));
}

function isInstallTransferCancelled(error: unknown): boolean {
  const message = toErrorMessage(error);
  return (
    message === "Transfer cancelled." || message.includes("Transfer cancelled.")
  );
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
