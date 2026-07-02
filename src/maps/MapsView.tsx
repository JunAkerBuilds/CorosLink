import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Flag,
  FolderOpen,
  Gauge,
  Globe,
  HardDrive,
  KeyRound,
  Layers,
  Loader2,
  Map as MapIcon,
  MapPin,
  Mountain,
  Navigation,
  QrCode,
  RefreshCw,
  Route,
  Save,
  Search,
  TrendingDown,
  TrendingUp,
  Trash2,
  X,
  Upload
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type {
  CachedCorosMapPackage,
  CorosMapDownloadJob,
  CorosMapInstallProgress,
  CorosMapLocalSelection,
  CorosMapManifest,
  CorosMapPackage,
  GenerateRouteRequest,
  GeneratedRoute,
  RouteActivityType,
  RouteApiKeyValidation,
  RouteBuilderConfig,
  ActivityPaceBaseline,
  ActivityPaceBaselines,
  RouteElevationPreference,
  RouteShareSession,
  WatchStatus
} from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown } from "../components/SelectDropdown";
import { formatBytes, formatDate } from "../media/libraryUtils";

type MapsTab = "coros" | "routes";
type RoutePinMode = "start" | "destination" | null;
type RouteMapLayer = "street" | "dark" | "topo" | "satellite";

interface MapPackageGroup {
  key: string;
  title: string;
  parent: string;
  topo?: CorosMapPackage;
  landscape?: CorosMapPackage;
}

interface RoutePinnedPoint {
  lat: number;
  lon: number;
}

interface RouteReadinessItem {
  label: string;
  ready: boolean;
}

const ROUTE_TILE_LAYERS: Record<
  RouteMapLayer,
  {
    url: string;
    attribution: string;
    maxZoom: number;
    subdomains?: string;
    label: string;
    description: string;
  }
> = {
  street: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    label: "Street",
    description: "Standard OpenStreetMap roads",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  },
  topo: {
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    maxZoom: 17,
    label: "Topographic",
    description: "Contours and terrain for trails",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM, &copy; <a href="https://opentopomap.org">OpenTopoMap</a>'
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    label: "Satellite",
    description: "Aerial imagery (Esri World Imagery)",
    attribution: "Imagery &copy; Esri, Maxar, Earthstar Geographics"
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    maxZoom: 19,
    subdomains: "abcd",
    label: "Dark",
    description: "Low-glare dark basemap",
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
  }
};

const ROUTE_MAP_LAYER_ORDER: RouteMapLayer[] = [
  "street",
  "topo",
  "satellite",
  "dark"
];

const ORS_LOGIN_URL = "https://openrouteservice.org/log-in/";
const ORS_API_INFO_URL = "https://api.openrouteservice.org/";
const ORS_HELP_PARTITION = "persist:coroslink-help";

interface WebviewElement extends HTMLElement {
  canGoBack: () => boolean;
  canGoForward: () => boolean;
  getTitle: () => string;
  getURL: () => string;
  goBack: () => void;
  goForward: () => void;
  loadURL: (url: string) => Promise<void>;
  reload: () => void;
}

interface WebviewNavigationEvent extends Event {
  url?: string;
}

interface WebviewTitleEvent extends Event {
  title?: string;
}

interface WebviewFailLoadEvent extends Event {
  errorCode?: number;
  errorDescription?: string;
  validatedURL?: string;
  isMainFrame?: boolean;
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
  const [activeTab, setActiveTab] = useState<MapsTab>("coros");

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
            label="Route Builder"
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
        <RouteBuilderTab
          api={api}
          onMessage={onMessage}
          onError={onError}
        />
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
  const [regionFilter, setRegionFilter] = useState("all");
  const [showLandscape, setShowLandscape] = useState(true);
  const [showTopo, setShowTopo] = useState(true);
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
            onChange={setRegionFilter}
          />

          <label className="check-row maps-check">
            <input
              type="checkbox"
              checked={showLandscape}
              onChange={(event) => setShowLandscape(event.target.checked)}
            />
            Landscape
          </label>
          <label className="check-row maps-check">
            <input
              type="checkbox"
              checked={showTopo}
              onChange={(event) => setShowTopo(event.target.checked)}
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

function RouteBuilderTab({
  api,
  onMessage,
  onError
}: {
  api: CorosLinkApi;
  onMessage: (message: string | null) => void;
  onError: (message: string | null) => void;
}) {
  const [config, setConfig] = useState<RouteBuilderConfig>({
    openRouteServiceApiKey: ""
  });
  const [request, setRequest] = useState<GenerateRouteRequest>({
    startLocation: "",
    destinationLocation: "",
    distanceKm: 5,
    mode: "loop",
    activityType: "running",
    surfacePreference: "road",
    avoidHighways: false,
    elevationPreference: "any"
  });
  const [routes, setRoutes] = useState<GeneratedRoute[]>([]);
  const [activeRoute, setActiveRoute] = useState<GeneratedRoute | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedOpenRouteServiceApiKey, setSavedOpenRouteServiceApiKey] =
    useState("");
  const [helpBrowserUrl, setHelpBrowserUrl] = useState<string | null>(null);
  const [pinMode, setPinMode] = useState<RoutePinMode>(null);
  const [currentLocation, setCurrentLocation] =
    useState<RoutePinnedPoint | null>(null);
  const [locationIssue, setLocationIssue] = useState(false);
  const [mapLayer, setMapLayer] = useState<RouteMapLayer>("street");
  const [fitRequestId, setFitRequestId] = useState(0);
  const [keyValidation, setKeyValidation] =
    useState<RouteApiKeyValidation | null>(null);
  const [shareSession, setShareSession] = useState<RouteShareSession | null>(
    null
  );
  const [paceBaselines, setPaceBaselines] = useState<ActivityPaceBaselines>({});

  const draftOpenRouteServiceApiKey = config.openRouteServiceApiKey.trim();
  const hasSavedOpenRouteServiceApiKey =
    savedOpenRouteServiceApiKey.trim().length > 0;
  const hasUnsavedOpenRouteServiceApiKeyChange =
    draftOpenRouteServiceApiKey !== savedOpenRouteServiceApiKey.trim();
  const routeReadiness = getRouteReadiness(
    request,
    hasSavedOpenRouteServiceApiKey,
    hasUnsavedOpenRouteServiceApiKeyChange
  );
  const routeGenerationDisabled =
    busy === "generate-route" || !routeReadiness.ready;

  useEffect(() => {
    void Promise.all([
      api.getRouteBuilderConfig(),
      api.listGeneratedRoutes()
    ])
      .then(([nextConfig, nextRoutes]) => {
        setConfig(nextConfig);
        setSavedOpenRouteServiceApiKey(nextConfig.openRouteServiceApiKey);
        setRoutes(nextRoutes);
        setActiveRoute(nextRoutes[0] ?? null);
      })
      .catch((caught) => onError(toErrorMessage(caught)));
  }, [api, onError]);

  useEffect(() => {
    // Tear down the LAN share server if the user leaves the Route Builder.
    return () => {
      void api.stopRouteShare().catch(() => undefined);
    };
  }, [api]);

  useEffect(() => {
    // Personalise time estimates per sport from stored COROS history when available.
    void api
      .getActivityPaceBaselines()
      .then(setPaceBaselines)
      .catch(() => setPaceBaselines({}));
  }, [api]);

  async function handleSaveConfig(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("save-config");
    onError(null);
    onMessage(null);
    try {
      const nextConfig = await api.saveRouteBuilderConfig(config);
      setConfig(nextConfig);
      setSavedOpenRouteServiceApiKey(nextConfig.openRouteServiceApiKey);
      const trimmedKey = nextConfig.openRouteServiceApiKey.trim();
      if (!trimmedKey) {
        setKeyValidation(null);
        onMessage("Route API key cleared.");
        return;
      }
      onMessage("Route API key saved. Verifying…");
      const validation = await api.validateRouteApiKey(trimmedKey);
      setKeyValidation(validation);
      if (validation.status === "valid") {
        onMessage("Route API key saved and verified.");
      } else {
        onMessage(null);
        onError(validation.message);
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function runGenerate(
    routeRequest: GenerateRouteRequest,
    successMessage: string
  ) {
    setBusy("generate-route");
    onError(null);
    onMessage(null);
    try {
      const route = await api.generateRoute(routeRequest);
      setActiveRoute(route);
      setRoutes(await api.listGeneratedRoutes());
      onMessage(successMessage);
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleGenerate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (routeGenerationDisabled) {
      onError(
        hasUnsavedOpenRouteServiceApiKeyChange
          ? "Save the OpenRouteService API key before generating routes."
          : "Save an OpenRouteService API key before generating routes."
      );
      return;
    }

    await runGenerate(request, "Route generated.");
  }

  async function handleRegenerate() {
    if (routeGenerationDisabled) {
      return;
    }
    // A fresh seed nudges ORS round_trip into a different loop.
    await runGenerate(
      { ...request, variationSeed: Date.now() },
      "Generated a fresh loop."
    );
  }

  async function handleExport(route: GeneratedRoute) {
    setBusy(`export:${route.id}`);
    onError(null);
    onMessage(null);
    try {
      const filePath = await api.exportGeneratedRoute(route.id);
      if (filePath) {
        onMessage("GPX exported.");
      }
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleRouteModeChange(mode: GenerateRouteRequest["mode"]) {
    setRequestField(setRequest, "mode", mode);
    if (mode === "loop" && pinMode === "destination") {
      setPinMode(null);
    }
  }

  function handleActivityChange(activityType: RouteActivityType) {
    setRequest((current) => {
      const maxDistance = maxDistanceForActivity(activityType);
      return {
        ...current,
        activityType,
        surfacePreference: surfaceForActivity(activityType),
        // Highways only matter for cycling; clear the flag for foot sports.
        avoidHighways: isCyclingActivity(activityType)
          ? current.avoidHighways
          : false,
        distanceKm: Math.min(current.distanceKm, maxDistance)
      };
    });
  }

  async function handleDeleteRoute(route: GeneratedRoute) {
    setBusy(`delete:${route.id}`);
    onError(null);
    onMessage(null);
    try {
      await api.deleteGeneratedRoute(route.id);
      const nextRoutes = await api.listGeneratedRoutes();
      setRoutes(nextRoutes);
      setActiveRoute((current) =>
        current?.id === route.id ? nextRoutes[0] ?? null : current
      );
      onMessage("Route deleted.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleShareToPhone(route: GeneratedRoute) {
    setBusy(`share:${route.id}`);
    onError(null);
    onMessage(null);
    try {
      const session = await api.startRouteShare(route.id);
      setShareSession(session);
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  function handleCloseShare() {
    setShareSession(null);
    void api.stopRouteShare().catch(() => undefined);
  }

  function handlePinModeChange(mode: Exclude<RoutePinMode, null>) {
    if (mode === "destination" && request.mode !== "point-to-point") {
      setRequestField(setRequest, "mode", "point-to-point");
    }

    setPinMode((current) => (current === mode ? null : mode));
  }

  const applyPointToRouteField = useCallback(
    (
      point: RoutePinnedPoint,
      target: Exclude<RoutePinMode, null>,
      message: string
    ) => {
      const value = formatPinnedRoutePoint(point);
      if (target === "start") {
        setRequestField(setRequest, "startLocation", value);
      } else {
        setRequest((current) => ({
          ...current,
          mode: "point-to-point",
          destinationLocation: value
        }));
      }

      setPinMode(null);
      onMessage(message);
    },
    [onMessage]
  );

  const handlePickRoutePoint = useCallback(
    (point: RoutePinnedPoint) => {
      if (!pinMode) {
        return;
      }

      applyPointToRouteField(
        point,
        pinMode,
        pinMode === "start" ? "Start point pinned." : "Destination point pinned."
      );
    },
    [applyPointToRouteField, pinMode]
  );

  function handleUseCurrentLocation(target: Exclude<RoutePinMode, null>) {
    if (!currentLocation) {
      onError("Use Locate me before using your current location.");
      return;
    }

    applyPointToRouteField(
      currentLocation,
      target,
      target === "start"
        ? "Start set to current location."
        : "Destination set to current location."
    );
  }

  async function handleFindOnMap(target: Exclude<RoutePinMode, null>) {
    const query =
      target === "start"
        ? request.startLocation
        : request.destinationLocation ?? "";
    if (!query.trim()) {
      onError(
        target === "start"
          ? "Enter a start location to find on the map."
          : "Enter a destination to find on the map."
      );
      return;
    }

    setBusy(`geocode:${target}`);
    onError(null);
    onMessage(null);
    try {
      const result = await api.geocodeRouteLocation(query);
      applyPointToRouteField(
        { lat: result.lat, lon: result.lon },
        target,
        `Found ${result.label}.`
      );
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleLocateMe(target?: Exclude<RoutePinMode, null>) {
    if (!navigator.geolocation) {
      onError("Location is not available in this browser.");
      return;
    }

    setBusy("locate-route");
    onError(null);
    onMessage(null);
    try {
      const position = await getCurrentPositionWithFallback(() => {
        onMessage("Still locating. Trying a longer location lookup.");
      });
      const point = {
        lat: position.coords.latitude,
        lon: position.coords.longitude
      };
      setCurrentLocation(point);
      setLocationIssue(false);

      const targetField = target ?? pinMode;
      if (targetField) {
        applyPointToRouteField(
          point,
          targetField,
          targetField === "start"
            ? "Start set to current location."
            : "Destination set to current location."
        );
      } else if (!request.startLocation.trim()) {
        setRequestField(setRequest, "startLocation", formatPinnedRoutePoint(point));
        onMessage("Current location found and added as the start.");
      } else {
        onMessage("Current location found.");
      }
    } catch (caught) {
      setLocationIssue(true);
      if (isGeolocationTimeout(caught)) {
        onMessage("Native location timed out. Trying approximate location.");
        try {
          await applyApproximateRouteLocation(target);
          onError(null);
        } catch (fallbackError) {
          onError(
            `Native location timed out and approximate location failed: ${toErrorMessage(fallbackError)}`
          );
        }
      } else {
        onError(toGeolocationErrorMessage(caught));
      }
    } finally {
      setBusy(null);
    }
  }

  async function handleOpenLocationSettings() {
    setBusy("open-location-settings");
    onError(null);
    onMessage(null);
    try {
      await api.openLocationServicesSettings();
      onMessage("Opened system location settings.");
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function handleUseApproximateLocation() {
    setBusy("approximate-location");
    onError(null);
    onMessage(null);
    try {
      await applyApproximateRouteLocation();
    } catch (caught) {
      onError(toErrorMessage(caught));
    } finally {
      setBusy(null);
    }
  }

  async function applyApproximateRouteLocation(
    target?: Exclude<RoutePinMode, null>
  ) {
    const result = await api.getApproximateRouteLocation();
    const point = { lat: result.lat, lon: result.lon };
    setCurrentLocation(point);
    setLocationIssue(false);

    const targetField = target ?? pinMode;
    if (targetField) {
      applyPointToRouteField(
        point,
        targetField,
        `${targetField === "start" ? "Start" : "Destination"} set to approximate location.`
      );
    } else if (!request.startLocation.trim()) {
      setRequestField(setRequest, "startLocation", formatPinnedRoutePoint(point));
      onMessage(`Approximate location found near ${result.label} and added as the start.`);
    } else {
      onMessage(`Approximate location found near ${result.label}.`);
    }
  }

  function handleClearPins() {
    const clearStart = Boolean(parseRouteCoordinateValue(request.startLocation));
    const clearDestination = Boolean(
      parseRouteCoordinateValue(request.destinationLocation)
    );
    setRequest((current) => ({
      ...current,
      startLocation: clearStart ? "" : current.startLocation,
      destinationLocation: clearDestination ? "" : current.destinationLocation
    }));
    setPinMode(null);
    onMessage(
      clearStart || clearDestination
        ? "Pinned coordinates cleared."
        : "No pinned coordinates to clear."
    );
  }

  return (
    <>
      <div className="route-builder-grid">
        <section className="panel route-form-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Route Builder</p>
              <h2>Generate GPX</h2>
            </div>
            <Navigation size={20} aria-hidden="true" />
          </div>

          {!hasSavedOpenRouteServiceApiKey ? (
            <OpenRouteServiceKeyGuide
              config={config}
              busy={busy}
              onConfigChange={setConfig}
              onSubmit={handleSaveConfig}
              onOpenHelp={setHelpBrowserUrl}
            />
          ) : (
            <>
              <RouteApiKeyForm
                config={config}
                busy={busy}
                compact
                onConfigChange={setConfig}
                onSubmit={handleSaveConfig}
              />
              {hasUnsavedOpenRouteServiceApiKeyChange ? (
                <p className="route-api-note">
                  Save the OpenRouteService key before generating a route.
                </p>
              ) : keyValidation && keyValidation.status !== "empty" ? (
                <p
                  className={
                    keyValidation.status === "valid"
                      ? "route-api-note is-valid"
                      : "route-api-note is-invalid"
                  }
                >
                  {keyValidation.status === "valid" ? (
                    <Check size={14} aria-hidden="true" />
                  ) : (
                    <AlertCircle size={14} aria-hidden="true" />
                  )}
                  {keyValidation.message}
                </p>
              ) : null}
            </>
          )}

          <form className="route-generator-form" onSubmit={handleGenerate}>
            <div className="route-field">
              <div className="route-field-title-row">
                <span>Start location</span>
              </div>
              <div className="input-shell">
                <MapPin size={18} aria-hidden="true" />
                <input
                  value={request.startLocation}
                  onChange={(event) =>
                    setRequestField(setRequest, "startLocation", event.target.value)
                  }
                  placeholder="City, address, trailhead, or lat, lon"
                />
              </div>
              <div className="route-field-actions">
                <button
                  type="button"
                  className="route-pin-toggle"
                  onClick={() => void handleFindOnMap("start")}
                  disabled={busy === "geocode:start" || !request.startLocation.trim()}
                >
                  {busy === "geocode:start" ? (
                    <Loader2 className="spin" size={14} aria-hidden="true" />
                  ) : (
                    <Search size={14} aria-hidden="true" />
                  )}
                  Find on map
                </button>
                <button
                  type="button"
                  className="route-pin-toggle"
                  onClick={() => handleUseCurrentLocation("start")}
                  disabled={!currentLocation}
                >
                  <Navigation size={14} aria-hidden="true" />
                  Use current
                </button>
                <button
                  type="button"
                  className={
                    pinMode === "start" ? "route-pin-toggle active" : "route-pin-toggle"
                  }
                  onClick={() => handlePinModeChange("start")}
                >
                  <MapPin size={14} aria-hidden="true" />
                  Pin start
                </button>
              </div>
            </div>

            <div className="route-mode-toggle">
              <button
                type="button"
                className={request.mode === "loop" ? "active" : ""}
                onClick={() => handleRouteModeChange("loop")}
              >
                Loop
              </button>
              <button
                type="button"
                className={request.mode === "point-to-point" ? "active" : ""}
                onClick={() => handleRouteModeChange("point-to-point")}
              >
                Point-to-point
              </button>
            </div>

            {request.mode === "point-to-point" ? (
              <div className="route-field">
                <div className="route-field-title-row">
                  <span>Destination</span>
                </div>
                <div className="input-shell">
                  <MapPin size={18} aria-hidden="true" />
                  <input
                    value={request.destinationLocation ?? ""}
                    onChange={(event) =>
                      setRequestField(
                        setRequest,
                        "destinationLocation",
                        event.target.value
                      )
                    }
                    placeholder="Finish location or lat, lon"
                  />
                </div>
                <div className="route-field-actions">
                  <button
                    type="button"
                    className="route-pin-toggle"
                    onClick={() => void handleFindOnMap("destination")}
                    disabled={
                      busy === "geocode:destination" ||
                      !request.destinationLocation?.trim()
                    }
                  >
                    {busy === "geocode:destination" ? (
                      <Loader2 className="spin" size={14} aria-hidden="true" />
                    ) : (
                      <Search size={14} aria-hidden="true" />
                    )}
                    Find on map
                  </button>
                  <button
                    type="button"
                    className="route-pin-toggle"
                    onClick={() => handleUseCurrentLocation("destination")}
                    disabled={!currentLocation}
                  >
                    <Navigation size={14} aria-hidden="true" />
                    Use current
                  </button>
                  <button
                    type="button"
                    className={
                      pinMode === "destination"
                        ? "route-pin-toggle active"
                        : "route-pin-toggle"
                    }
                    onClick={() => handlePinModeChange("destination")}
                  >
                    <MapPin size={14} aria-hidden="true" />
                    Pin end
                  </button>
                </div>
              </div>
            ) : null}

          <div className="route-form-row">
            <label className="route-field">
              <span>Sport</span>
              <SelectDropdown
                className="app-select--maps"
                label="Sport"
                value={request.activityType}
                options={ROUTE_ACTIVITY_OPTIONS}
                onChange={handleActivityChange}
              />
            </label>

            <label className="route-field">
              <span>Elevation</span>
              <SelectDropdown
                className="app-select--maps"
                label="Elevation"
                value={request.elevationPreference}
                options={ROUTE_ELEVATION_OPTIONS}
                onChange={(elevationPreference) =>
                  setRequestField(
                    setRequest,
                    "elevationPreference",
                    elevationPreference
                  )
                }
              />
            </label>
          </div>

          <label className="route-field route-distance-field">
            <div className="route-distance-header">
              <span>Distance</span>
              <strong>{request.distanceKm.toFixed(1)} km</strong>
            </div>
            <div className="route-distance-controls">
              <input
                className="route-distance-slider"
                type="range"
                min="1"
                max={maxDistanceForActivity(request.activityType)}
                step="0.5"
                value={request.distanceKm}
                onChange={(event) =>
                  setRequestField(
                    setRequest,
                    "distanceKm",
                    Number(event.target.value)
                  )
                }
              />
              <input
                className="maps-number-input"
                type="number"
                min="1"
                max={maxDistanceForActivity(request.activityType)}
                step="0.5"
                value={request.distanceKm}
                onChange={(event) =>
                  setRequestField(
                    setRequest,
                    "distanceKm",
                    Number(event.target.value)
                  )
                }
              />
            </div>
          </label>

          <label
            className={
              isCyclingActivity(request.activityType)
                ? "check-row route-check"
                : "check-row route-check is-disabled"
            }
          >
            <input
              type="checkbox"
              checked={
                isCyclingActivity(request.activityType) && request.avoidHighways
              }
              disabled={!isCyclingActivity(request.activityType)}
              onChange={(event) =>
                setRequestField(setRequest, "avoidHighways", event.target.checked)
              }
            />
            Avoid highways
            {!isCyclingActivity(request.activityType) ? (
              <small>Only available for cycling routes</small>
            ) : null}
          </label>

          <RouteReadiness items={routeReadiness.items} />

          <div className="route-generate-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={routeGenerationDisabled}
            >
              {busy === "generate-route" ? (
                <Loader2 className="spin" size={18} aria-hidden="true" />
              ) : (
                <Route size={18} aria-hidden="true" />
              )}
              Generate Route
            </button>
            {request.mode === "loop" ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void handleRegenerate()}
                disabled={routeGenerationDisabled}
                title="Generate a different loop with the same settings"
              >
                <RefreshCw size={17} aria-hidden="true" />
                Shuffle loop
              </button>
            ) : null}
          </div>
          </form>
        </section>

        <section className="panel route-preview-panel">
          <div className="section-heading compact">
            <div>
              <p className="eyebrow">Preview</p>
              <h2>{activeRoute?.name ?? "No route"}</h2>
            </div>
            {activeRoute ? (
              <div className="route-preview-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void handleShareToPhone(activeRoute)}
                  disabled={busy === `share:${activeRoute.id}`}
                  title="Show a QR code to open this route on your phone"
                >
                  {busy === `share:${activeRoute.id}` ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <QrCode size={17} aria-hidden="true" />
                  )}
                  Share to phone
                </button>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void handleExport(activeRoute)}
                  disabled={busy === `export:${activeRoute.id}`}
                >
                  {busy === `export:${activeRoute.id}` ? (
                    <Loader2 className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <Download size={17} aria-hidden="true" />
                  )}
                  Export GPX
                </button>
              </div>
            ) : null}
          </div>

          {activeRoute ? (
            <p className="route-watch-hint">
              <Navigation size={14} aria-hidden="true" />
              <span>
                To navigate on your COROS watch, export this GPX, then import it
                in the COROS phone app under <strong>Profile → Route Library</strong>.
                It syncs to the watch over Bluetooth. (COROS watches can’t import
                routes over the USB cable.)
              </span>
            </p>
          ) : null}

          <RouteMapToolbar
            request={request}
            pinMode={pinMode}
            currentLocation={currentLocation}
            locationIssue={locationIssue}
            mapLayer={mapLayer}
            locating={busy === "locate-route"}
            openingLocationSettings={busy === "open-location-settings"}
            approximatingLocation={busy === "approximate-location"}
            readinessItems={routeReadiness.items}
            onPinModeChange={handlePinModeChange}
            onLocate={() => void handleLocateMe()}
            onOpenLocationSettings={() => void handleOpenLocationSettings()}
            onUseApproximateLocation={() => void handleUseApproximateLocation()}
            onClearPins={handleClearPins}
            onFitRoute={() => setFitRequestId((value) => value + 1)}
            onLayerChange={setMapLayer}
          />

          <div className="route-preview-surface">
            <RoutePreviewMap
              route={activeRoute}
              request={request}
              pinMode={pinMode}
              currentLocation={currentLocation}
              mapLayer={mapLayer}
              fitRequestId={fitRequestId}
              onPickPoint={handlePickRoutePoint}
            />
            <RouteStatsSidebar
              route={activeRoute}
              request={request}
              paceBaselines={paceBaselines}
            />
          </div>

          {routes.length > 0 ? (
            <div className="route-history">
              <h3>Recent routes</h3>
              {routes.map((route) => (
                <div
                  key={route.id}
                  className={
                    activeRoute?.id === route.id
                      ? "route-history-row active"
                      : "route-history-row"
                  }
                >
                  <button
                    type="button"
                    className="route-history-select"
                    onClick={() => setActiveRoute(route)}
                  >
                    <span>{route.name}</span>
                    <small>
                      {activityTypeLabel(route.activityType)} ·{" "}
                      {formatDate(route.createdAt)}
                    </small>
                  </button>
                  <div className="route-history-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => void handleExport(route)}
                      disabled={busy === `export:${route.id}`}
                      title="Export GPX"
                      aria-label="Export route as GPX"
                    >
                      {busy === `export:${route.id}` ? (
                        <Loader2 className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <Download size={15} aria-hidden="true" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => void handleDeleteRoute(route)}
                      disabled={busy === `delete:${route.id}`}
                      title="Delete route"
                      aria-label="Delete route"
                    >
                      {busy === `delete:${route.id}` ? (
                        <Loader2 className="spin" size={15} aria-hidden="true" />
                      ) : (
                        <Trash2 size={15} aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      </div>

      {helpBrowserUrl ? (
        <OpenRouteServiceHelpBrowser
          url={helpBrowserUrl}
          onClose={() => setHelpBrowserUrl(null)}
        />
      ) : null}

      {shareSession ? (
        <RouteShareModal session={shareSession} onClose={handleCloseShare} />
      ) : null}
    </>
  );
}

function RouteShareModal({
  session,
  onClose
}: {
  session: RouteShareSession;
  onClose: () => void;
}) {
  return (
    <div className="route-share-overlay" role="dialog" aria-modal="true">
      <div className="route-share-modal">
        <div className="route-share-header">
          <div>
            <p className="eyebrow">Share to phone</p>
            <h3>Scan to open on your phone</h3>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <img
          className="route-share-qr"
          src={session.qrDataUrl}
          alt="QR code linking to the route GPX"
          width={240}
          height={240}
        />

        <ol className="route-share-steps">
          <li>Make sure your phone is on the same Wi-Fi as this computer.</li>
          <li>Open the camera and scan the code to download the GPX.</li>
          <li>
            Tap <strong>Share / Open with…</strong> and choose the COROS app to
            import the route.
          </li>
        </ol>

        <p className="route-share-url">{session.url}</p>
        <small className="route-share-note">
          Link works on your local network only and expires in ~10 minutes.
        </small>
      </div>
    </div>
  );
}

function OpenRouteServiceKeyGuide({
  config,
  busy,
  onConfigChange,
  onSubmit,
  onOpenHelp
}: {
  config: RouteBuilderConfig;
  busy: string | null;
  onConfigChange: (config: RouteBuilderConfig) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onOpenHelp: (url: string) => void;
}) {
  return (
    <section className="ors-key-guide">
      <div className="ors-key-guide-header">
        <div className="ors-key-guide-icon">
          <KeyRound size={20} aria-hidden="true" />
        </div>
        <div>
          <p className="eyebrow">OpenRouteService</p>
          <h3>Save your route API key</h3>
        </div>
      </div>

      <p className="ors-key-guide-copy">
        Route Builder uses your own OpenRouteService key for geocoding and route
        generation.
      </p>

      <ol className="ors-key-steps">
        <li>Sign in or create an OpenRouteService account.</li>
        <li>Open API Keys or the dashboard.</li>
        <li>Copy the Basic API key and save it in CorosLink.</li>
      </ol>

      <div className="ors-key-guide-actions">
        <button
          type="button"
          className="primary-button"
          onClick={() => onOpenHelp(ORS_LOGIN_URL)}
        >
          <Globe size={17} aria-hidden="true" />
          Open OpenRouteService
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenHelp(ORS_API_INFO_URL)}
        >
          <ExternalLink size={17} aria-hidden="true" />
          API Info
        </button>
      </div>

      <RouteApiKeyForm
        config={config}
        busy={busy}
        guide
        onConfigChange={onConfigChange}
        onSubmit={onSubmit}
      />
    </section>
  );
}

function RouteApiKeyForm({
  config,
  busy,
  compact,
  guide,
  onConfigChange,
  onSubmit
}: {
  config: RouteBuilderConfig;
  busy: string | null;
  compact?: boolean;
  guide?: boolean;
  onConfigChange: (config: RouteBuilderConfig) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      className={[
        "route-api-form",
        compact && "route-api-form-compact",
        guide && "route-api-form-guide"
      ]
        .filter(Boolean)
        .join(" ")}
      onSubmit={onSubmit}
    >
      <label className="route-field">
        <span>OpenRouteService API key</span>
        <div className="input-shell">
          <KeyRound size={18} aria-hidden="true" />
          <input
            type="password"
            value={config.openRouteServiceApiKey}
            onChange={(event) =>
              onConfigChange({
                openRouteServiceApiKey: event.target.value
              })
            }
            placeholder="ors_..."
          />
        </div>
      </label>
      <button
        type="submit"
        className={guide ? "primary-button" : "secondary-button"}
        disabled={busy === "save-config"}
      >
        {busy === "save-config" ? (
          <Loader2 className="spin" size={17} aria-hidden="true" />
        ) : (
          <Save size={17} aria-hidden="true" />
        )}
        Save Key
      </button>
    </form>
  );
}

function OpenRouteServiceHelpBrowser({
  url,
  onClose
}: {
  url: string;
  onClose: () => void;
}) {
  const webviewRef = useRef<WebviewElement | null>(null);
  const domReadyRef = useRef(false);
  const pendingUrlRef = useRef(url);
  const [webviewKey, setWebviewKey] = useState(0);
  const [webviewSrc, setWebviewSrc] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [title, setTitle] = useState("OpenRouteService");
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (pendingUrlRef.current === url) {
      return;
    }

    pendingUrlRef.current = url;
    setCurrentUrl(url);
    setLoadError(null);
    setLoading(true);

    if (webviewRef.current && domReadyRef.current) {
      void webviewRef.current.loadURL(url).catch((caught) => {
        setLoadError(toErrorMessage(caught));
        setLoading(false);
      });
      return;
    }

    setWebviewSrc(url);
    setWebviewKey((value) => value + 1);
  }, [url]);

  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview) {
      return;
    }

    domReadyRef.current = false;

    const updateNavigationState = () => {
      if (!domReadyRef.current) {
        return;
      }

      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };

    const syncFromWebview = (nextUrl?: string) => {
      if (!domReadyRef.current) {
        return;
      }

      const latestUrl = nextUrl || webview.getURL() || pendingUrlRef.current;
      pendingUrlRef.current = latestUrl;
      setCurrentUrl(latestUrl);
      setTitle(webview.getTitle() || "OpenRouteService");
      updateNavigationState();
    };

    const handleDomReady = () => {
      domReadyRef.current = true;
      setLoading(false);
      setLoadError(null);
      syncFromWebview();
    };

    const handleDidStartLoading = () => {
      setLoading(true);
      setLoadError(null);
    };

    const handleDidStopLoading = () => {
      setLoading(false);
      syncFromWebview();
    };

    const handleDidFailLoad = (event: Event) => {
      const failEvent = event as WebviewFailLoadEvent;
      if (failEvent.isMainFrame === false || failEvent.errorCode === -3) {
        return;
      }

      setLoading(false);
      setLoadError(
        failEvent.errorDescription ||
          `Failed to load ${failEvent.validatedURL || pendingUrlRef.current}.`
      );
    };

    const handleNavigation = (event: Event) => {
      syncFromWebview((event as WebviewNavigationEvent).url);
    };

    const handleTitleUpdated = (event: Event) => {
      if (!domReadyRef.current) {
        return;
      }

      setTitle(
        (event as WebviewTitleEvent).title ||
          webview.getTitle() ||
          "OpenRouteService"
      );
    };

    webview.addEventListener("dom-ready", handleDomReady);
    webview.addEventListener("did-start-loading", handleDidStartLoading);
    webview.addEventListener("did-stop-loading", handleDidStopLoading);
    webview.addEventListener("did-fail-load", handleDidFailLoad);
    webview.addEventListener("did-navigate", handleNavigation);
    webview.addEventListener("did-navigate-in-page", handleNavigation);
    webview.addEventListener("page-title-updated", handleTitleUpdated);

    return () => {
      domReadyRef.current = false;
      webview.removeEventListener("dom-ready", handleDomReady);
      webview.removeEventListener("did-start-loading", handleDidStartLoading);
      webview.removeEventListener("did-stop-loading", handleDidStopLoading);
      webview.removeEventListener("did-fail-load", handleDidFailLoad);
      webview.removeEventListener("did-navigate", handleNavigation);
      webview.removeEventListener("did-navigate-in-page", handleNavigation);
      webview.removeEventListener("page-title-updated", handleTitleUpdated);
    };
  }, [webviewKey]);

  function handleRetry() {
    setLoadError(null);
    setLoading(true);

    if (webviewRef.current && domReadyRef.current) {
      webviewRef.current.reload();
      return;
    }

    setWebviewSrc(pendingUrlRef.current);
    setWebviewKey((value) => value + 1);
  }

  return (
    <div className="ors-help-backdrop" role="dialog" aria-modal="true">
      <section className="panel ors-help-modal">
        <div className="ors-help-toolbar">
          <div className="browser-nav-actions">
            <button
              type="button"
              className="icon-button"
              title="Back"
              disabled={!canGoBack}
              onClick={() => webviewRef.current?.goBack()}
            >
              <ArrowLeft size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Forward"
              disabled={!canGoForward}
              onClick={() => webviewRef.current?.goForward()}
            >
              <ArrowRight size={17} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="icon-button"
              title="Reload"
              onClick={handleRetry}
            >
              <RefreshCw size={17} aria-hidden="true" />
            </button>
          </div>

          <div className="ors-help-address">
            <strong>{title}</strong>
            <span>{currentUrl}</span>
          </div>

          <button
            type="button"
            className="icon-button"
            title="Close"
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="ors-help-webview-frame">
          <webview
            key={webviewKey}
            ref={(element) => {
              webviewRef.current = element as WebviewElement | null;
              element?.setAttribute("allowpopups", "");
            }}
            className="ors-help-webview"
            src={webviewSrc}
            partition={ORS_HELP_PARTITION}
            webpreferences="contextIsolation=yes,nodeIntegration=no,sandbox=no"
          />

          {loadError ? (
            <div className="browser-load-error">
              <AlertCircle size={24} aria-hidden="true" />
              <strong>OpenRouteService failed to load</strong>
              <span>{loadError}</span>
              <div className="browser-load-error-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleRetry}
                >
                  Retry
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={onClose}
                >
                  Close
                </button>
              </div>
            </div>
          ) : null}

          {loading && !loadError ? (
            <div className="browser-loading">
              <Loader2 className="spin" size={24} aria-hidden="true" />
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function RouteReadiness({ items }: { items: RouteReadinessItem[] }) {
  return (
    <div className="route-readiness">
      {items.map((item) => (
        <span
          key={item.label}
          className={item.ready ? "route-ready-item ready" : "route-ready-item"}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}

function RouteMapToolbar({
  request,
  pinMode,
  currentLocation,
  locationIssue,
  mapLayer,
  locating,
  openingLocationSettings,
  approximatingLocation,
  readinessItems,
  onPinModeChange,
  onLocate,
  onOpenLocationSettings,
  onUseApproximateLocation,
  onClearPins,
  onFitRoute,
  onLayerChange
}: {
  request: GenerateRouteRequest;
  pinMode: RoutePinMode;
  currentLocation: RoutePinnedPoint | null;
  locationIssue: boolean;
  mapLayer: RouteMapLayer;
  locating: boolean;
  openingLocationSettings: boolean;
  approximatingLocation: boolean;
  readinessItems: RouteReadinessItem[];
  onPinModeChange: (mode: Exclude<RoutePinMode, null>) => void;
  onLocate: () => void;
  onOpenLocationSettings: () => void;
  onUseApproximateLocation: () => void;
  onClearPins: () => void;
  onFitRoute: () => void;
  onLayerChange: (layer: RouteMapLayer) => void;
}) {
  const startPin = parseRouteCoordinateValue(request.startLocation);
  const destinationPin =
    request.mode === "point-to-point"
      ? parseRouteCoordinateValue(request.destinationLocation)
      : undefined;

  return (
    <div className="route-pin-panel">
      <div className="route-pin-actions">
        <button
          type="button"
          className="route-pin-command route-locate-command"
          onClick={onLocate}
          disabled={locating}
        >
          {locating ? (
            <Loader2 className="spin" size={16} aria-hidden="true" />
          ) : (
            <Navigation size={16} aria-hidden="true" />
          )}
          Locate me
        </button>
        <button
          type="button"
          className={
            pinMode === "start" ? "route-pin-command active" : "route-pin-command"
          }
          onClick={() => onPinModeChange("start")}
        >
          <MapPin size={16} aria-hidden="true" />
          Start
        </button>
        <button
          type="button"
          className={
            pinMode === "destination"
              ? "route-pin-command active"
              : "route-pin-command"
          }
          onClick={() => onPinModeChange("destination")}
        >
          <MapPin size={16} aria-hidden="true" />
          End
        </button>
        <button
          type="button"
          className="route-pin-command"
          onClick={onClearPins}
        >
          <Trash2 size={16} aria-hidden="true" />
          Clear pins
        </button>
        <button type="button" className="route-pin-command" onClick={onFitRoute}>
          <RefreshCw size={16} aria-hidden="true" />
          Fit route
        </button>
      </div>

      <RouteMapLayerDropdown value={mapLayer} onChange={onLayerChange} />

      {locationIssue ? (
        <div className="route-location-issue">
          <AlertCircle size={16} aria-hidden="true" />
          <span>
            Native location did not return coordinates. Allow CorosLink/Electron
            in system settings or use an approximate network location.
          </span>
          <button
            type="button"
            className="secondary-button"
            onClick={onOpenLocationSettings}
            disabled={openingLocationSettings}
          >
            {openingLocationSettings ? (
              <Loader2 className="spin" size={15} aria-hidden="true" />
            ) : (
              <ExternalLink size={15} aria-hidden="true" />
            )}
            Open Settings
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={onUseApproximateLocation}
            disabled={approximatingLocation}
          >
            {approximatingLocation ? (
              <Loader2 className="spin" size={15} aria-hidden="true" />
            ) : (
              <Navigation size={15} aria-hidden="true" />
            )}
            Use Approximate
          </button>
        </div>
      ) : null}

      <p>
        {pinMode
          ? `Click the map to set the ${pinMode === "start" ? "start" : "end"} point.`
          : "Plan from the map with exact pins, current location, or typed search."}
      </p>
      <div className="route-pin-status">
        <span className={startPin ? "badge ready" : "badge"}>
          Start {startPin ? formatPinnedRoutePoint(startPin) : "not pinned"}
        </span>
        <span className={destinationPin ? "badge ready" : "badge"}>
          End {destinationPin ? formatPinnedRoutePoint(destinationPin) : "not pinned"}
        </span>
        <span className={currentLocation ? "badge ready" : "badge"}>
          {currentLocation
            ? `Current ${formatPinnedRoutePoint(currentLocation)}`
            : "Current location not set"}
        </span>
      </div>
      <RouteReadiness items={readinessItems} />
    </div>
  );
}

function RouteMapLayerDropdown({
  value,
  onChange
}: {
  value: RouteMapLayer;
  onChange: (layer: RouteMapLayer) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const active = ROUTE_TILE_LAYERS[value];

  return (
    <div className="route-layer-dropdown" ref={containerRef}>
      <button
        type="button"
        className="route-layer-trigger"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Layers size={15} aria-hidden="true" />
        <span className="route-layer-trigger-label">{active.label}</span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={open ? "route-layer-chevron is-open" : "route-layer-chevron"}
        />
      </button>

      {open ? (
        <ul className="route-layer-menu" role="listbox">
          {ROUTE_MAP_LAYER_ORDER.map((layer) => {
            const config = ROUTE_TILE_LAYERS[layer];
            const selected = layer === value;
            return (
              <li key={layer}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={
                    selected
                      ? "route-layer-option is-selected"
                      : "route-layer-option"
                  }
                  onClick={() => {
                    onChange(layer);
                    setOpen(false);
                  }}
                >
                  <span className="route-layer-option-text">
                    <strong>{config.label}</strong>
                    <small>{config.description}</small>
                  </span>
                  {selected ? (
                    <Check size={15} aria-hidden="true" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}

function RouteStatsSidebar({
  route,
  request,
  paceBaselines
}: {
  route: GeneratedRoute | null;
  request: GenerateRouteRequest;
  paceBaselines: ActivityPaceBaselines;
}) {
  const requestedDistance = Number(request.distanceKm);
  const hasTargetDistance =
    Number.isFinite(requestedDistance) && requestedDistance > 0;
  const distanceValue = route
    ? (route.distanceMeters / 1000).toFixed(1)
    : hasTargetDistance
      ? requestedDistance.toFixed(1)
      : "—";
  const distanceUnit = route ? "km" : hasTargetDistance ? "km target" : "";

  const activityType = route?.activityType ?? request.activityType;
  const cycling = isCyclingActivity(activityType);
  const baseline = route ? paceBaselines[route.activityType] : undefined;
  const duration = route
    ? effectiveRouteDuration(route, baseline)
    : { seconds: undefined, estimated: false, fromHistory: false };
  const paceSpeed = route ? formatPaceOrSpeed(route, duration.seconds) : null;
  const climbRate = route ? climbRatePerKm(route) : undefined;
  const highwaysAvoided =
    cycling && (route ? route.avoidHighways : request.avoidHighways);

  const startLabel = route?.startLocation || request.startLocation || "Not set";
  const destinationLabel =
    route?.destinationLocation ||
    (request.mode === "point-to-point"
      ? request.destinationLocation || "Not set"
      : "Loop — returns to start");

  return (
    <aside className="route-stats-sidebar">
      <div className="route-stats-heading">
        <p className="eyebrow">Route stats</p>
        <h3>{route ? "Generated route" : "Route plan"}</h3>
      </div>

      <div className="route-stats-hero">
        <div className="route-stats-distance">
          <strong>{distanceValue}</strong>
          {distanceUnit ? <span>{distanceUnit}</span> : null}
        </div>
        <div className="route-stats-chips">
          <span className="route-chip">{activityTypeLabel(activityType)}</span>
          <span className="route-chip subtle">
            {routeModeLabel(route?.mode ?? request.mode)}
          </span>
        </div>
      </div>

      <div className="route-stat-grid">
        <RouteStat
          icon={<Clock size={14} aria-hidden="true" />}
          label={duration.estimated ? "Est. time" : "Duration"}
          value={route ? formatDuration(duration.seconds) : "—"}
        />
        <RouteStat
          icon={<Gauge size={14} aria-hidden="true" />}
          label={cycling ? "Avg speed" : duration.estimated ? "Est. pace" : "Avg pace"}
          value={paceSpeed ?? "—"}
        />
        <RouteStat
          icon={<TrendingUp size={14} aria-hidden="true" />}
          label="Ascent"
          value={route ? formatMeters(route.ascentMeters) : "—"}
        />
        <RouteStat
          icon={<TrendingDown size={14} aria-hidden="true" />}
          label="Descent"
          value={route ? formatMeters(route.descentMeters) : "—"}
        />
        <RouteStat
          icon={<Mountain size={14} aria-hidden="true" />}
          label="Climb"
          value={climbRate !== undefined ? `${Math.round(climbRate)} m/km` : "—"}
        />
        <RouteStat
          icon={<Activity size={14} aria-hidden="true" />}
          label="Terrain"
          value={
            climbRate !== undefined
              ? difficultyFromClimbRate(climbRate)
              : formatElevationPreference(request.elevationPreference)
          }
        />
      </div>

      {highwaysAvoided ? (
        <p className="route-stats-flag">
          <Check size={14} aria-hidden="true" />
          Highways avoided
        </p>
      ) : null}

      {route ? <RouteElevationProfile points={route.points} /> : null}

      <div className="route-stat-locations">
        <RouteStat
          icon={<MapPin size={14} aria-hidden="true" />}
          label="Start"
          value={startLabel}
        />
        <RouteStat
          icon={<Flag size={14} aria-hidden="true" />}
          label="End"
          value={destinationLabel}
        />
      </div>

      {route ? (
        <small className="route-stats-footnote">
          {route.points.length.toLocaleString()} track points · Generated{" "}
          {formatDate(route.createdAt)}
          {duration.estimated
            ? duration.fromHistory
              ? ` · Time from your COROS ${activityTypeLabel(
                  route.activityType
                ).toLowerCase()} pace (${baseline?.sampleSize})`
              : " · Time estimated for running"
            : ""}
        </small>
      ) : null}
    </aside>
  );
}

function RouteElevationProfile({
  points
}: {
  points: GeneratedRoute["points"];
}) {
  const profile = useMemo(() => buildElevationProfile(points), [points]);
  if (!profile) {
    return null;
  }

  return (
    <div className="route-elevation">
      <div className="route-elevation-head">
        <span>Elevation</span>
        <small>
          {Math.round(profile.minEle)}–{Math.round(profile.maxEle)} m
        </small>
      </div>
      <svg
        className="route-elevation-chart"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polygon className="route-elevation-fill" points={profile.areaPoints} />
        <polyline className="route-elevation-line" points={profile.linePoints} />
      </svg>
    </div>
  );
}

function RouteStat({
  label,
  value,
  icon
}: {
  label: string;
  value: string;
  icon?: ReactNode;
}) {
  return (
    <div className="route-stat-item">
      <span>
        {icon}
        {label}
      </span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function RoutePreviewMap({
  route,
  request,
  pinMode,
  currentLocation,
  mapLayer,
  fitRequestId,
  onPickPoint
}: {
  route: GeneratedRoute | null;
  request: GenerateRouteRequest;
  pinMode: RoutePinMode;
  currentLocation: RoutePinnedPoint | null;
  mapLayer: RouteMapLayer;
  fitRequestId: number;
  onPickPoint: (point: RoutePinnedPoint) => void;
}) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);
  const overlayRef = useRef<L.LayerGroup | null>(null);
  const lastFitRequestId = useRef(fitRequestId);
  const lastRouteRef = useRef<GeneratedRoute | null>(null);
  // Keep click-handler dependencies in refs so the map is built only once.
  const pinModeRef = useRef(pinMode);
  const onPickPointRef = useRef(onPickPoint);
  pinModeRef.current = pinMode;
  onPickPointRef.current = onPickPoint;

  // Create the map exactly once, then reuse it across prop changes so zoom/pan
  // and tile state survive re-renders.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container) {
      return;
    }

    const map = L.map(container, {
      zoomControl: true,
      attributionControl: true,
      scrollWheelZoom: true
    });
    map.setView([39.5, -98.35], 4);
    mapRef.current = map;
    overlayRef.current = L.layerGroup().addTo(map);

    map.on("click", (event: L.LeafletMouseEvent) => {
      if (!pinModeRef.current) {
        return;
      }
      onPickPointRef.current({ lat: event.latlng.lat, lon: event.latlng.lng });
    });

    const resizeObserver = new ResizeObserver(() => map.invalidateSize());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      tileLayerRef.current = null;
    };
  }, []);

  // Swap the tile layer in place instead of rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) {
      return;
    }
    const config = ROUTE_TILE_LAYERS[mapLayer];
    const nextLayer = L.tileLayer(config.url, {
      maxZoom: config.maxZoom,
      attribution: config.attribution,
      ...(config.subdomains ? { subdomains: config.subdomains } : {})
    }).addTo(map);
    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }
    tileLayerRef.current = nextLayer;
  }, [mapLayer]);

  // Redraw the route polyline and markers whenever the geometry changes.
  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) {
      return;
    }
    overlay.clearLayers();

    const routePoints = route?.points
      .filter((point) => point.lat !== undefined && point.lon !== undefined)
      .map((point) => [point.lat!, point.lon!] as [number, number]);
    const startPin = parseRouteCoordinateValue(request.startLocation);
    const destinationPin =
      request.mode === "point-to-point"
        ? parseRouteCoordinateValue(request.destinationLocation)
        : undefined;
    const boundsPoints: Array<[number, number]> = [];

    if (routePoints && routePoints.length >= 2) {
      L.polyline(routePoints, {
        color: "#74c08f",
        weight: 4,
        opacity: 0.95,
        lineCap: "round",
        lineJoin: "round"
      }).addTo(overlay);
      L.circleMarker(routePoints[0]!, {
        radius: 6,
        color: "#4da3ff",
        fillColor: "#4da3ff",
        fillOpacity: 1,
        weight: 2
      }).addTo(overlay);
      L.circleMarker(routePoints[routePoints.length - 1]!, {
        radius: 6,
        color: "#d89b22",
        fillColor: "#d89b22",
        fillOpacity: 1,
        weight: 2
      }).addTo(overlay);
      boundsPoints.push(...routePoints);
    }

    if (startPin) {
      L.circleMarker([startPin.lat, startPin.lon], {
        radius: 7,
        color: "#4da3ff",
        fillColor: "#4da3ff",
        fillOpacity: 0.92,
        weight: 2
      })
        .bindTooltip("Pinned start")
        .addTo(overlay);
      boundsPoints.push([startPin.lat, startPin.lon]);
    }

    if (destinationPin) {
      L.circleMarker([destinationPin.lat, destinationPin.lon], {
        radius: 7,
        color: "#d89b22",
        fillColor: "#d89b22",
        fillOpacity: 0.92,
        weight: 2
      })
        .bindTooltip("Pinned end")
        .addTo(overlay);
      boundsPoints.push([destinationPin.lat, destinationPin.lon]);
    }

    if (currentLocation) {
      L.circleMarker([currentLocation.lat, currentLocation.lon], {
        radius: 8,
        color: "#0f172a",
        fillColor: "#7dd3fc",
        fillOpacity: 0.92,
        weight: 3
      })
        .bindTooltip("Current location")
        .addTo(overlay);
      boundsPoints.push([currentLocation.lat, currentLocation.lon]);
    }

    // Auto-fit only when a new route appears or the user taps "Fit route";
    // otherwise leave the user's current pan/zoom untouched.
    const fitRequested = fitRequestId !== lastFitRequestId.current;
    const routeChanged = route !== lastRouteRef.current;
    lastFitRequestId.current = fitRequestId;
    lastRouteRef.current = route;
    if (boundsPoints.length > 0 && (fitRequested || routeChanged)) {
      map.fitBounds(L.latLngBounds(boundsPoints), {
        padding: [28, 28],
        maxZoom: 14
      });
    }
  }, [
    route,
    request.startLocation,
    request.destinationLocation,
    request.mode,
    currentLocation,
    fitRequestId
  ]);

  return (
    <div
      ref={mapContainerRef}
      className={pinMode ? "route-preview-map is-pinning" : "route-preview-map"}
    />
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

function getRouteReadiness(
  request: GenerateRouteRequest,
  hasSavedApiKey: boolean,
  hasUnsavedApiKeyChange: boolean
): { ready: boolean; items: RouteReadinessItem[] } {
  const distance = Number(request.distanceKm);
  const maxDistance = maxDistanceForActivity(request.activityType);
  const items: RouteReadinessItem[] = [
    {
      label: hasUnsavedApiKeyChange ? "Save key change" : "API key saved",
      ready: hasSavedApiKey && !hasUnsavedApiKeyChange
    },
    {
      label: "Start set",
      ready: request.startLocation.trim().length > 0
    },
    {
      label: "Distance valid",
      ready:
        Number.isFinite(distance) && distance > 0 && distance <= maxDistance
    }
  ];

  if (request.mode === "point-to-point") {
    items.push({
      label: "Destination set",
      ready: Boolean(request.destinationLocation?.trim())
    });
  }

  return {
    ready: items.every((item) => item.ready),
    items
  };
}

async function getCurrentPositionWithFallback(
  onFallback: () => void
): Promise<GeolocationPosition> {
  try {
    return await requestCurrentPosition({
      enableHighAccuracy: false,
      timeout: 5_000,
      maximumAge: 10 * 60_000
    });
  } catch (firstError) {
    if (!isGeolocationTimeout(firstError)) {
      throw firstError;
    }
  }

  onFallback();

  try {
    return await requestCurrentPosition({
      enableHighAccuracy: true,
      timeout: 25_000,
      maximumAge: 60_000
    });
  } catch (secondError) {
    if (!isGeolocationTimeout(secondError)) {
      throw secondError;
    }
  }

  return requestCurrentPosition({
    enableHighAccuracy: false,
    timeout: 20_000,
    maximumAge: 10 * 60_000
  });
}

function requestCurrentPosition(
  options: PositionOptions
): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function setRequestField<Key extends keyof GenerateRouteRequest>(
  setRequest: Dispatch<SetStateAction<GenerateRouteRequest>>,
  key: Key,
  value: GenerateRouteRequest[Key]
) {
  setRequest((current) => ({
    ...current,
    [key]: value
  }));
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

function parseRouteCoordinateValue(
  value?: string
): RoutePinnedPoint | undefined {
  const match = value
    ?.trim()
    .match(/^([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s+.*)?$/);

  if (!match) {
    return undefined;
  }

  const lat = Number(match[1]);
  const lon = Number(match[2]);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return undefined;
  }

  return { lat, lon };
}

function formatPinnedRoutePoint(point: RoutePinnedPoint): string {
  return `${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`;
}

function formatProgress(job?: CorosMapDownloadJob): string {
  if (!job) {
    return "0%";
  }

  return `${Math.round(Math.max(0, Math.min(job.progress, 1)) * 100)}%`;
}

function formatDuration(value?: number): string {
  if (!value || !Number.isFinite(value)) {
    return "Unknown";
  }

  const minutes = Math.round(value / 60);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
}

function formatMeters(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }

  return `${Math.round(value)} m`;
}

function routeModeLabel(mode: GenerateRouteRequest["mode"]): string {
  return mode === "point-to-point" ? "Point-to-point" : "Loop";
}

/**
 * Moving time for the route. ORS routes "running" on its walking profile, so its
 * duration is a *walking* time — useless as a running estimate. For running we
 * model a realistic time (flat pace + a climbing penalty); other sports use the
 * profile-appropriate duration ORS returns.
 */
function effectiveRouteDuration(
  route: GeneratedRoute,
  baseline: ActivityPaceBaseline | undefined
): {
  seconds: number | undefined;
  estimated: boolean;
  fromHistory: boolean;
} {
  const distanceKm = route.distanceMeters / 1000;
  const climbSeconds =
    (route.ascentMeters ?? 0) *
    (isCyclingActivity(route.activityType) ? 4 : 6); // s per metre climbed

  // Personalised: use the user's median pace for *this* sport when we have it.
  if (baseline && distanceKm > 0) {
    return {
      seconds: Math.round(baseline.secondsPerKm * distanceKm + climbSeconds),
      estimated: true,
      fromHistory: true
    };
  }

  // No history for this sport: ORS routes "running" on its walking profile, so
  // its duration is too slow — fall back to a generic 6:00 /km running model.
  if (route.activityType === "running" && distanceKm > 0) {
    return {
      seconds: Math.round(360 * distanceKm + climbSeconds),
      estimated: true,
      fromHistory: false
    };
  }

  // Walking/hiking/cycling without history use the profile-correct ORS duration.
  return {
    seconds: route.durationSeconds,
    estimated: false,
    fromHistory: false
  };
}

/** Average pace (min/km) for foot sports, or average speed (km/h) for cycling. */
function formatPaceOrSpeed(
  route: GeneratedRoute,
  durationSeconds: number | undefined
): string | null {
  const distanceKm = route.distanceMeters / 1000;
  if (!durationSeconds || durationSeconds <= 0 || distanceKm <= 0) {
    return null;
  }

  if (isCyclingActivity(route.activityType)) {
    const speed = distanceKm / (durationSeconds / 3600);
    return `${speed.toFixed(1)} km/h`;
  }

  const secondsPerKm = durationSeconds / distanceKm;
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  const normalizedMinutes = seconds === 60 ? minutes + 1 : minutes;
  const normalizedSeconds = seconds === 60 ? 0 : seconds;
  return `${normalizedMinutes}:${String(normalizedSeconds).padStart(2, "0")} /km`;
}

/** Ascent per kilometre — a robust hilliness measure. */
function climbRatePerKm(route: GeneratedRoute): number | undefined {
  const distanceKm = route.distanceMeters / 1000;
  if (distanceKm <= 0 || route.ascentMeters === undefined) {
    return undefined;
  }
  return route.ascentMeters / distanceKm;
}

function difficultyFromClimbRate(metersPerKm: number): string {
  if (metersPerKm < 10) return "Flat";
  if (metersPerKm < 25) return "Rolling";
  if (metersPerKm < 50) return "Hilly";
  return "Steep";
}

/**
 * Builds an SVG elevation profile (elevation vs. cumulative distance) normalized
 * to a 100×32 viewBox. Returns null when there isn't enough variation to plot.
 */
function buildElevationProfile(points: GeneratedRoute["points"]):
  | { linePoints: string; areaPoints: string; minEle: number; maxEle: number }
  | null {
  const valid = points.filter(
    (point) =>
      point.lat !== undefined &&
      point.lon !== undefined &&
      point.elevation !== undefined
  );
  if (valid.length < 2) {
    return null;
  }

  const distances = [0];
  for (let index = 1; index < valid.length; index += 1) {
    const previous = valid[index - 1]!;
    const current = valid[index]!;
    distances.push(
      distances[index - 1]! +
        haversineMeters(
          previous.lat!,
          previous.lon!,
          current.lat!,
          current.lon!
        )
    );
  }

  const total = distances[distances.length - 1]!;
  const elevations = valid.map((point) => point.elevation as number);
  const minEle = Math.min(...elevations);
  const maxEle = Math.max(...elevations);
  if (total <= 0 || maxEle - minEle < 2) {
    return null;
  }

  const range = maxEle - minEle;
  const linePoints = valid
    .map((point, index) => {
      const x = (distances[index]! / total) * 100;
      const y = 31 - ((point.elevation! - minEle) / range) * 30;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return {
    linePoints,
    areaPoints: `0,32 ${linePoints} 100,32`,
    minEle,
    maxEle
  };
}

function haversineMeters(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number
): number {
  const radius = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

const ROUTE_ACTIVITY_OPTIONS: Array<{
  value: RouteActivityType;
  label: string;
}> = [
  { value: "running", label: "Running" },
  { value: "walking", label: "Walking" },
  { value: "hiking", label: "Hiking" },
  { value: "cycling-road", label: "Road cycling" },
  { value: "cycling-mountain", label: "Mountain biking" }
];

const ROUTE_ELEVATION_OPTIONS: Array<{
  value: RouteElevationPreference;
  label: string;
}> = [
  { value: "any", label: "Any" },
  { value: "flatter", label: "Flatter" },
  { value: "hilly", label: "Hilly" }
];

function activityTypeLabel(activityType: RouteActivityType): string {
  return (
    ROUTE_ACTIVITY_OPTIONS.find((option) => option.value === activityType)
      ?.label ?? activityType
  );
}

function isCyclingActivity(activityType: RouteActivityType): boolean {
  return activityType.startsWith("cycling");
}

/** Keeps the legacy surface field consistent with the chosen sport. */
function surfaceForActivity(
  activityType: RouteActivityType
): GenerateRouteRequest["surfacePreference"] {
  return activityType === "hiking" || activityType === "cycling-mountain"
    ? "trail"
    : "road";
}

function maxDistanceForActivity(activityType: RouteActivityType): number {
  return isCyclingActivity(activityType) ? 300 : 100;
}

function formatElevationPreference(
  preference: GenerateRouteRequest["elevationPreference"]
): string {
  switch (preference) {
    case "flatter":
      return "Prefer flatter";
    case "hilly":
      return "Prefer hilly";
    case "any":
      return "Any elevation";
  }
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

function toGeolocationErrorMessage(error: unknown): string {
  if (isGeolocationTimeout(error)) {
    return [
      "Location lookup timed out.",
      "Check macOS Location Services for CorosLink/Electron, or type a city/address and use Find on map."
    ].join(" ");
  }

  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code?: unknown }).code === "number"
  ) {
    const code = (error as { code: number }).code;
    if (code === 1) {
      return "Location permission was denied.";
    }

    if (code === 2) {
      return "Current location is unavailable.";
    }

  }

  return toErrorMessage(error);
}

function isGeolocationTimeout(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: unknown }).code === 3
  );
}
