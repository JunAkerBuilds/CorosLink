import { useDeferredValue, useMemo, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Loader2,
  Music,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { LocalTrack, WatchStatus, WatchTrack } from "../../electron/types";
import { getWatchPresentation } from "../watchModels";
import {
  createWatchTrackNameIndex,
  formatBytes,
  formatDate,
  isLocalTrackOnWatchByIndex,
  sumBytes,
} from "./libraryUtils";
import { trackAvatarColor, trackInitial } from "./trackAvatar";

type SortDirection = "asc" | "desc";
type LocalLibrarySortKey = "title" | "size" | "created" | "status";
type WatchLibrarySortKey = "name" | "size" | "modified";
type LocalTrackFilter = "all" | "pending" | "synced";
type WatchTrackFilter = "all" | "selected";

interface SortState<Key extends string> {
  key: Key;
  direction: SortDirection;
}

const localSortDefaults: Record<LocalLibrarySortKey, SortDirection> = {
  title: "asc",
  size: "desc",
  created: "desc",
  status: "asc",
};

const watchSortDefaults: Record<WatchLibrarySortKey, SortDirection> = {
  name: "asc",
  size: "desc",
  modified: "desc",
};

function nextSortState<Key extends string>(
  current: SortState<Key>,
  key: Key,
  defaults: Record<Key, SortDirection>,
): SortState<Key> {
  if (current.key === key) {
    return {
      key,
      direction: current.direction === "asc" ? "desc" : "asc",
    };
  }

  return { key, direction: defaults[key] };
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function compareDates(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime();
}

function applySortDirection(value: number, direction: SortDirection): number {
  return direction === "asc" ? value : -value;
}

function getLocalFileName(track: LocalTrack): string {
  return track.filePath.split(/[/\\]/).pop() ?? track.title;
}

function normalizeSearchValue(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase();
}

function getSearchTerms(value: string): string[] {
  return normalizeSearchValue(value).trim().split(/\s+/).filter(Boolean);
}

function buildSearchText(values: string[]): string {
  return values.map(normalizeSearchValue).join(" ");
}

function searchTextMatchesTerms(searchText: string, terms: string[]): boolean {
  return terms.every((term) => searchText.includes(term));
}

interface LocalTrackSearchItem {
  track: LocalTrack;
  fileName: string;
  onWatch: boolean;
  searchText: string;
}

interface WatchTrackSearchItem {
  track: WatchTrack;
  searchText: string;
}

function sortLocalTrackItems(
  items: LocalTrackSearchItem[],
  sort: SortState<LocalLibrarySortKey>,
): LocalTrackSearchItem[] {
  return [...items].sort((a, b) => {
    let result = 0;

    if (sort.key === "title") {
      result = compareText(a.track.title, b.track.title);
    } else if (sort.key === "size") {
      result = a.track.sizeBytes - b.track.sizeBytes;
    } else if (sort.key === "created") {
      result = compareDates(a.track.createdAt, b.track.createdAt);
    } else {
      result = Number(a.onWatch) - Number(b.onWatch);
    }

    if (result !== 0) {
      return applySortDirection(result, sort.direction);
    }

    return compareText(a.track.title, b.track.title);
  });
}

function sortWatchTrackItems(
  items: WatchTrackSearchItem[],
  sort: SortState<WatchLibrarySortKey>,
): WatchTrackSearchItem[] {
  return [...items].sort((a, b) => {
    let result = 0;

    if (sort.key === "name") {
      result = compareText(a.track.name, b.track.name);
    } else if (sort.key === "size") {
      result = a.track.sizeBytes - b.track.sizeBytes;
    } else {
      result = compareDates(a.track.modifiedAt, b.track.modifiedAt);
    }

    if (result !== 0) {
      return applySortDirection(result, sort.direction);
    }

    return compareText(a.track.name, b.track.name);
  });
}

interface LibrarySyncLayoutProps {
  localPanel: ReactNode;
  watchPanel: ReactNode;
  pendingCount: number;
  localCount: number;
  watchConnected: boolean;
}

export function LibrarySyncLayout({
  localPanel,
  watchPanel,
  pendingCount,
  localCount,
  watchConnected,
}: LibrarySyncLayoutProps) {
  return (
    <div className="library-sync-grid">
      {localPanel}
      <LibraryConnector
        pendingCount={pendingCount}
        localCount={localCount}
        watchConnected={watchConnected}
      />
      {watchPanel}
    </div>
  );
}

function LibraryConnector({
  pendingCount,
  localCount,
  watchConnected,
}: {
  pendingCount: number;
  localCount: number;
  watchConnected: boolean;
}) {
  let label = watchConnected ? "Watch connected" : "Connect watch";
  if (watchConnected && pendingCount > 0) {
    label = `${pendingCount} to sync`;
  } else if (watchConnected && pendingCount === 0 && localCount > 0) {
    label = "All synced";
  }

  return (
    <div className="library-connector" aria-hidden="true">
      <span className="library-connector-line" />
      <span
        className={
          watchConnected && pendingCount === 0
            ? "library-connector-pill ready"
            : "library-connector-pill"
        }
      >
        {label}
      </span>
      <span className="library-connector-line" />
    </div>
  );
}

/**
 * Live progress of a track transfer batch, shown while tracks stream to the
 * watch so the UI stays responsive instead of freezing on a blocking copy.
 */
export interface TrackTransferProgress {
  /** 1-based index of the track currently transferring. */
  index: number;
  /** Total tracks in the current batch. */
  total: number;
  /** Display name of the track currently transferring. */
  name: string;
  /** 0..1 progress of the current file. */
  fileProgress: number;
}

interface LocalLibraryPanelProps {
  downloads: LocalTrack[];
  watchTracks: WatchTrack[];
  watchConnected: boolean;
  busy: string | null;
  transferProgress: TrackTransferProgress | null;
  selectedIds: Set<string>;
  canTransferAll: boolean;
  onToggleSelect: (id: string) => void;
  onSelectTracks: (ids: string[], selected: boolean) => void;
  onClearSelection: () => void;
  onTransfer: (id: string) => void;
  onTransferAll: () => void;
  onTransferDownloads: (tracks: LocalTrack[]) => void;
  onDeleteDownload: (track: LocalTrack) => void;
  onDeleteDownloads: (tracks: LocalTrack[]) => void;
}

export function LocalLibraryPanel({
  downloads,
  watchTracks,
  watchConnected,
  busy,
  transferProgress,
  selectedIds,
  canTransferAll,
  onToggleSelect,
  onSelectTracks,
  onClearSelection,
  onTransfer,
  onTransferAll,
  onTransferDownloads,
  onDeleteDownload,
  onDeleteDownloads,
}: LocalLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState<LocalTrackFilter>("all");
  const [sort, setSort] = useState<SortState<LocalLibrarySortKey>>({
    key: "created",
    direction: "desc",
  });
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTerms = useMemo(
    () => getSearchTerms(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const watchIndex = useMemo(
    () => createWatchTrackNameIndex(watchTracks),
    [watchTracks],
  );
  const localTrackItems = useMemo<LocalTrackSearchItem[]>(
    () =>
      downloads.map((track) => {
        const fileName = getLocalFileName(track);

        return {
          track,
          fileName,
          onWatch: isLocalTrackOnWatchByIndex(
            track,
            watchIndex,
            watchConnected,
          ),
          searchText: buildSearchText([track.title, fileName, track.url]),
        };
      }),
    [downloads, watchConnected, watchIndex],
  );
  const someSelected = selectedIds.size > 0;
  const selectedItems = useMemo(
    () => localTrackItems.filter(({ track }) => selectedIds.has(track.id)),
    [localTrackItems, selectedIds],
  );
  const selectedTracks = useMemo(
    () => selectedItems.map(({ track }) => track),
    [selectedItems],
  );
  const pendingSelectedTracks = useMemo(
    () =>
      selectedItems
        .filter(({ onWatch }) => !onWatch)
        .map(({ track }) => track),
    [selectedItems],
  );
  const totalSize = useMemo(() => sumBytes(downloads), [downloads]);
  const selectedSize = useMemo(() => sumBytes(selectedTracks), [selectedTracks]);
  const pendingLocalCount = useMemo(
    () => localTrackItems.filter(({ onWatch }) => !onWatch).length,
    [localTrackItems],
  );
  const syncedCount = downloads.length - pendingLocalCount;
  const visibleLocalItems = useMemo(() => {
    const filtered = localTrackItems.filter((item) => {
      if (trackFilter === "pending" && item.onWatch) {
        return false;
      }
      if (trackFilter === "synced" && !item.onWatch) {
        return false;
      }

      return searchTextMatchesTerms(item.searchText, searchTerms);
    });

    return sortLocalTrackItems(filtered, sort);
  }, [localTrackItems, searchTerms, sort, trackFilter]);
  const visibleIds = useMemo(
    () => visibleLocalItems.map(({ track }) => track.id),
    [visibleLocalItems],
  );
  const selectedVisibleCount = useMemo(
    () =>
      visibleLocalItems.filter(({ track }) => selectedIds.has(track.id)).length,
    [selectedIds, visibleLocalItems],
  );
  const allVisibleSelected =
    visibleLocalItems.length > 0 &&
    selectedVisibleCount === visibleLocalItems.length;
  const isTransferring = busy?.startsWith("transfer") ?? false;
  const isDeletingLocal = busy?.startsWith("delete-local") ?? false;
  const countLabel =
    visibleLocalItems.length === downloads.length
      ? `${downloads.length} track${downloads.length === 1 ? "" : "s"}`
      : `${visibleLocalItems.length}/${downloads.length} tracks`;

  const filterOptions: Array<{
    value: LocalTrackFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: "All", count: downloads.length },
    { value: "pending", label: "Pending", count: pendingLocalCount },
    { value: "synced", label: "Synced", count: syncedCount },
  ];

  function handleBulkDelete() {
    if (selectedTracks.length === 0) {
      return;
    }

    onDeleteDownloads(selectedTracks);
  }

  function handleBulkTransfer() {
    if (pendingSelectedTracks.length === 0) {
      return;
    }

    onTransferDownloads(pendingSelectedTracks);
  }

  function handleSelectVisible() {
    if (visibleIds.length === 0) {
      return;
    }

    onSelectTracks(visibleIds, !allVisibleSelected);
  }

  function emptyTitle() {
    if (downloads.length === 0) {
      return "No local tracks";
    }
    if (searchTerms.length > 0) {
      return "No matching local tracks";
    }
    if (trackFilter === "pending") {
      return "No pending transfers";
    }
    if (trackFilter === "synced") {
      return "No synced tracks";
    }

    return "No local tracks";
  }

  return (
    <section className="library-panel library-panel--local" aria-label="Local cache">
      <header className="library-panel-header">
        <div>
          <p className="eyebrow">CorosLink</p>
          <h3>Local cache</h3>
        </div>
        <em>
          {countLabel} · {formatBytes(totalSize)}
        </em>
      </header>

      <div className="library-panel-actions">
        {someSelected ? (
          <div className="library-bulk-actions">
            {pendingSelectedTracks.length > 0 ? (
              <button
                className="primary-button compact-button"
                type="button"
                disabled={!watchConnected || isTransferring || isDeletingLocal}
                onClick={handleBulkTransfer}
              >
                {busy === "transfer-selected" ? (
                  <Loader2 className="spin" size={17} aria-hidden="true" />
                ) : (
                  <Upload size={17} aria-hidden="true" />
                )}
                Transfer selected ({pendingSelectedTracks.length})
              </button>
            ) : null}
            <button
              className="secondary-button compact-button danger-button"
              type="button"
              disabled={isDeletingLocal || isTransferring}
              onClick={handleBulkDelete}
            >
              {busy === "delete-local-bulk" ? (
                <Loader2 className="spin" size={17} aria-hidden="true" />
              ) : (
                <Trash2 size={17} aria-hidden="true" />
              )}
              Delete selected ({selectedIds.size})
            </button>
          </div>
        ) : canTransferAll ? (
          <button
            className="primary-button compact-button"
            type="button"
            disabled={isTransferring}
            onClick={onTransferAll}
          >
            {busy === "transfer-all" ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Upload size={17} aria-hidden="true" />
            )}
            Transfer all ({pendingLocalCount})
          </button>
        ) : (
          <span className="library-panel-hint">
            {downloads.length === 0
              ? "Download tracks from YouTube or Spotify"
              : pendingLocalCount === 0
                ? (
                    <span className="library-sync-indicator">
                      <CheckCircle2 size={15} aria-hidden="true" />
                      All synced
                    </span>
                  )
                : `${pendingLocalCount} not on watch`}
          </span>
        )}
      </div>

      {transferProgress ? (
        <div
          className="library-transfer-progress"
          role="status"
          aria-live="polite"
        >
          <div className="library-transfer-progress-label">
            <span className="library-transfer-progress-name">
              {transferProgress.total > 1
                ? `Transferring ${transferProgress.index} of ${transferProgress.total}`
                : "Transferring"}
              {transferProgress.name ? ` · ${transferProgress.name}` : ""}
            </span>
            <span>{Math.round(transferProgress.fileProgress * 100)}%</span>
          </div>
          <div
            className="library-transfer-progress-track"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(transferProgress.fileProgress * 100)}
          >
            <div
              className="library-transfer-progress-bar"
              style={{
                width: `${Math.round(transferProgress.fileProgress * 100)}%`,
              }}
            />
          </div>
        </div>
      ) : null}

      {downloads.length > 0 ? (
        <div className="library-panel-tools">
          <div className="library-search-field">
            <Search size={15} aria-hidden="true" />
            <input
              type="search"
              aria-label="Search local tracks"
              placeholder="Search local tracks"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery ? (
              <button
                className="library-search-clear"
                type="button"
                title="Clear search"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <div className="library-filter-group" aria-label="Local track filter">
            {filterOptions.map((option) => (
              <button
                key={option.value}
                className={
                  trackFilter === option.value
                    ? "library-filter-option active"
                    : "library-filter-option"
                }
                type="button"
                onClick={() => setTrackFilter(option.value)}
              >
                <span>{option.label}</span>
                <small>{option.count}</small>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {downloads.length > 0 ? (
        <div className="library-selection-bar">
          <label className="library-select-all">
            <input
              type="checkbox"
              aria-label="Select visible local tracks"
              checked={allVisibleSelected}
              disabled={visibleLocalItems.length === 0}
              onChange={handleSelectVisible}
            />
            Select visible
          </label>
          {someSelected ? (
            <div className="library-selection-meta">
              <span>
                {selectedTracks.length} selected · {formatBytes(selectedSize)}
              </span>
              <button
                className="library-selection-clear"
                type="button"
                onClick={onClearSelection}
              >
                Clear
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {visibleLocalItems.length > 0 ? (
        <div className="library-track-header">
          <span />
          <span />
          <SortButton
            label="Track"
            sortKey="title"
            sort={sort}
            onSort={(key) =>
              setSort((current) =>
                nextSortState(current, key, localSortDefaults),
              )
            }
          />
          <SortButton
            label="Size"
            sortKey="size"
            sort={sort}
            onSort={(key) =>
              setSort((current) =>
                nextSortState(current, key, localSortDefaults),
              )
            }
          />
          <SortButton
            label="Added"
            sortKey="created"
            sort={sort}
            onSort={(key) =>
              setSort((current) =>
                nextSortState(current, key, localSortDefaults),
              )
            }
          />
          <SortButton
            label="Status"
            sortKey="status"
            sort={sort}
            onSort={(key) =>
              setSort((current) =>
                nextSortState(current, key, localSortDefaults),
              )
            }
          />
          <span />
        </div>
      ) : null}

      <div className="library-track-stack">
        {visibleLocalItems.length === 0 ? (
          <LibraryEmptyState title={emptyTitle()} />
        ) : (
          visibleLocalItems.map(({ track, fileName, onWatch }) => {
            const selected = selectedIds.has(track.id);

            return (
              <div
                key={track.id}
                className={selected ? "library-track-row is-selected" : "library-track-row"}
              >
                <input
                  type="checkbox"
                  className="library-track-select"
                  aria-label={`Select ${track.title}`}
                  checked={selected}
                  onChange={() => onToggleSelect(track.id)}
                />
                <div
                  className="track-avatar"
                  style={{ backgroundColor: trackAvatarColor(track.title) }}
                  aria-hidden="true"
                >
                  {trackInitial(track.title)}
                </div>
                <span className="library-track-meta">
                  <strong>{track.title}</strong>
                  <small>{fileName}</small>
                </span>
                <span className="library-track-size">{formatBytes(track.sizeBytes)}</span>
                <span className="library-track-date">{formatDate(track.createdAt)}</span>
                <span
                  className={onWatch ? "badge ready library-track-status" : "badge library-track-status"}
                >
                  {onWatch ? "Synced" : "Not synced"}
                </span>
                <div className="library-track-actions">
                  <button
                    className="icon-button"
                    type="button"
                    title="Transfer to watch"
                    disabled={
                      !watchConnected ||
                      onWatch ||
                      busy === `transfer:${track.id}` ||
                      isTransferring
                    }
                    onClick={() => onTransfer(track.id)}
                  >
                    {busy === `transfer:${track.id}` ? (
                      <Loader2 className="spin" size={17} aria-hidden="true" />
                    ) : (
                      <Upload size={17} aria-hidden="true" />
                    )}
                  </button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title="Delete local track"
                    disabled={
                      busy === `delete-local:${track.id}` ||
                      isDeletingLocal ||
                      isTransferring
                    }
                    onClick={() => onDeleteDownload(track)}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

interface WatchLibraryPanelProps {
  watchStatus: WatchStatus | null;
  watchConnected: boolean;
  busy: string | null;
  selectedPaths: Set<string>;
  onToggleSelect: (relativePath: string) => void;
  onSelectTracks: (relativePaths: string[], selected: boolean) => void;
  onClearSelection: () => void;
  onDeleteWatchTrack: (track: WatchTrack) => void;
  onDeleteWatchTracks: (tracks: WatchTrack[]) => void;
}

export function WatchLibraryPanel({
  watchStatus,
  watchConnected,
  busy,
  selectedPaths,
  onToggleSelect,
  onSelectTracks,
  onClearSelection,
  onDeleteWatchTrack,
  onDeleteWatchTracks,
}: WatchLibraryPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [trackFilter, setTrackFilter] = useState<WatchTrackFilter>("all");
  const [sort, setSort] = useState<SortState<WatchLibrarySortKey>>({
    key: "name",
    direction: "asc",
  });
  const watchTracks = watchStatus?.tracks ?? [];
  const presentation = getWatchPresentation(watchStatus);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTerms = useMemo(
    () => getSearchTerms(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const watchTrackItems = useMemo<WatchTrackSearchItem[]>(
    () =>
      watchTracks.map((track) => ({
        track,
        searchText: buildSearchText([track.name, track.relativePath]),
      })),
    [watchTracks],
  );
  const someSelected = selectedPaths.size > 0;
  const selectedTracks = useMemo(
    () => watchTracks.filter((track) => selectedPaths.has(track.relativePath)),
    [selectedPaths, watchTracks],
  );
  const totalSize = useMemo(() => sumBytes(watchTracks), [watchTracks]);
  const selectedSize = useMemo(() => sumBytes(selectedTracks), [selectedTracks]);
  const visibleWatchItems = useMemo(() => {
    const filtered = watchTrackItems.filter((item) => {
      if (
        trackFilter === "selected" &&
        !selectedPaths.has(item.track.relativePath)
      ) {
        return false;
      }

      return searchTextMatchesTerms(item.searchText, searchTerms);
    });

    return sortWatchTrackItems(filtered, sort);
  }, [searchTerms, selectedPaths, sort, trackFilter, watchTrackItems]);
  const visibleWatchTracks = useMemo(
    () => visibleWatchItems.map(({ track }) => track),
    [visibleWatchItems],
  );
  const visiblePaths = useMemo(
    () => visibleWatchTracks.map((track) => track.relativePath),
    [visibleWatchTracks],
  );
  const selectedVisibleCount = useMemo(
    () =>
      visibleWatchTracks.filter((track) =>
        selectedPaths.has(track.relativePath),
      ).length,
    [selectedPaths, visibleWatchTracks],
  );
  const allVisibleSelected =
    visibleWatchTracks.length > 0 &&
    selectedVisibleCount === visibleWatchTracks.length;
  const isDeletingWatch = busy?.startsWith("delete-watch") ?? false;
  const countLabel =
    visibleWatchTracks.length === watchTracks.length
      ? `${watchTracks.length} track${watchTracks.length === 1 ? "" : "s"}`
      : `${visibleWatchTracks.length}/${watchTracks.length} tracks`;
  const storageLabel =
    watchStatus?.usedBytes != null
      ? `${formatBytes(watchStatus.usedBytes)} used`
      : formatBytes(totalSize);
  const filterOptions: Array<{
    value: WatchTrackFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: "All", count: watchTracks.length },
    { value: "selected", label: "Selected", count: selectedTracks.length },
  ];

  function handleBulkDelete() {
    if (selectedTracks.length === 0) {
      return;
    }

    onDeleteWatchTracks(selectedTracks);
  }

  function handleSelectVisible() {
    if (visiblePaths.length === 0) {
      return;
    }

    onSelectTracks(visiblePaths, !allVisibleSelected);
  }

  function emptyTitle() {
    if (!watchConnected) {
      return "Connect a COROS watch";
    }
    if (watchTracks.length === 0) {
      return "No MP3 files on the watch";
    }
    if (searchTerms.length > 0) {
      return "No matching watch tracks";
    }
    if (trackFilter === "selected") {
      return "No selected watch tracks";
    }

    return "No MP3 files on the watch";
  }

  return (
    <section
      className={`library-panel library-panel--watch ${
        watchConnected ? "is-connected" : "is-disconnected"
      }`}
      aria-label="On watch"
    >
      <header className="library-panel-header">
        <div>
          <p className="eyebrow">{presentation.displayName}</p>
          <h3>On watch</h3>
        </div>
        <em>
          {watchConnected
            ? `${countLabel} · ${storageLabel}`
            : "Not connected"}
        </em>
      </header>

      <div className="library-panel-actions">
        {someSelected ? (
          <button
            className="secondary-button danger-button"
            type="button"
            disabled={isDeletingWatch}
            onClick={handleBulkDelete}
          >
            {busy === "delete-watch-bulk" ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Trash2 size={17} aria-hidden="true" />
            )}
            Delete selected ({selectedPaths.size})
          </button>
        ) : (
          <span className="library-panel-hint">
            {!watchConnected
              ? presentation.connectHint || "Connect your watch via USB"
              : watchTracks.length === 0
                ? "No MP3 files on the watch"
                : "Select tracks to delete from watch"}
          </span>
        )}
      </div>

      {!watchConnected ? (
        <LibraryEmptyState
          title={emptyTitle()}
          subtitle="to view and manage your music"
          variant="watch"
        />
      ) : watchTracks.length > 0 ? (
        <>
          <div className="library-panel-tools">
            <div className="library-search-field">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="Search watch tracks"
                placeholder="Search watch tracks"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {searchQuery ? (
                <button
                  className="library-search-clear"
                  type="button"
                  title="Clear search"
                  onClick={() => setSearchQuery("")}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            <div className="library-filter-group" aria-label="Watch track filter">
              {filterOptions.map((option) => (
                <button
                  key={option.value}
                  className={
                    trackFilter === option.value
                      ? "library-filter-option active"
                      : "library-filter-option"
                  }
                  type="button"
                  onClick={() => setTrackFilter(option.value)}
                >
                  <span>{option.label}</span>
                  <small>{option.count}</small>
                </button>
              ))}
            </div>
          </div>
          <div className="library-selection-bar">
            <label className="library-select-all">
              <input
                type="checkbox"
                aria-label="Select visible watch tracks"
                checked={allVisibleSelected}
                disabled={visibleWatchTracks.length === 0}
                onChange={handleSelectVisible}
              />
              Select visible
            </label>
            {someSelected ? (
              <div className="library-selection-meta">
                <span>
                  {selectedTracks.length} selected · {formatBytes(selectedSize)}
                </span>
                <button
                  className="library-selection-clear"
                  type="button"
                  onClick={onClearSelection}
                >
                  Clear
                </button>
              </div>
            ) : null}
          </div>
          {visibleWatchTracks.length > 0 ? (
            <div className="library-track-header">
              <span />
              <span />
              <SortButton
                label="Track"
                sortKey="name"
                sort={sort}
                onSort={(key) =>
                  setSort((current) =>
                    nextSortState(current, key, watchSortDefaults),
                  )
                }
              />
              <SortButton
                label="Size"
                sortKey="size"
                sort={sort}
                onSort={(key) =>
                  setSort((current) =>
                    nextSortState(current, key, watchSortDefaults),
                  )
                }
              />
              <SortButton
                label="Modified"
                sortKey="modified"
                sort={sort}
                onSort={(key) =>
                  setSort((current) =>
                    nextSortState(current, key, watchSortDefaults),
                  )
                }
              />
              <span>Status</span>
              <span />
            </div>
          ) : null}
          <div className="library-track-stack">
            {visibleWatchTracks.length === 0 ? (
              <LibraryEmptyState title={emptyTitle()} />
            ) : (
              visibleWatchTracks.map((track) => {
                const selected = selectedPaths.has(track.relativePath);

                return (
                  <div
                    key={track.relativePath}
                    className={
                      selected ? "library-track-row is-selected" : "library-track-row"
                    }
                  >
                    <input
                      type="checkbox"
                      className="library-track-select"
                      aria-label={`Select ${track.name}`}
                      checked={selected}
                      onChange={() => onToggleSelect(track.relativePath)}
                    />
                    <div className="track-avatar track-avatar--watch" aria-hidden="true" />
                    <span className="library-track-meta">
                      <strong>{track.name}</strong>
                      <small>{track.relativePath}</small>
                    </span>
                    <span className="library-track-size">{formatBytes(track.sizeBytes)}</span>
                    <span className="library-track-date">{formatDate(track.modifiedAt)}</span>
                    <span className="badge ready library-track-status">On watch</span>
                    <div className="library-track-actions">
                      <button
                        className="icon-button danger"
                        type="button"
                        title="Delete from watch"
                        disabled={
                          !watchConnected ||
                          busy === `delete-watch:${track.relativePath}` ||
                          isDeletingWatch
                        }
                        onClick={() => onDeleteWatchTrack(track)}
                      >
                        <Trash2 size={17} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <LibraryEmptyState title={emptyTitle()} />
      )}
    </section>
  );
}

interface SortButtonProps<Key extends string> {
  label: string;
  sortKey: Key;
  sort: SortState<Key>;
  onSort: (key: Key) => void;
}

function SortButton<Key extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: SortButtonProps<Key>) {
  const active = sort.key === sortKey;
  const Icon = active
    ? sort.direction === "asc"
      ? ArrowUp
      : ArrowDown
    : ArrowUpDown;
  const nextDirection =
    active && sort.direction === "asc" ? "descending" : "ascending";

  return (
    <button
      className={active ? "library-sort-button active" : "library-sort-button"}
      type="button"
      aria-label={`Sort by ${label} ${nextDirection}`}
      onClick={() => onSort(sortKey)}
    >
      {label}
      <Icon size={13} aria-hidden="true" />
    </button>
  );
}

function WatchConnectIllustration() {
  return (
    <div className="watch-connect-illustration">
      <svg
        className="watch-connect-art"
        viewBox="0 0 260 260"
        fill="none"
        aria-hidden="true"
      >
        {/* orbiting dotted ring */}
        <circle cx="130" cy="130" r="84" className="watch-ring" />

        {/* watch bands */}
        <path
          className="watch-line"
          d="M108 90 L108 58 Q108 48 118 48 L142 48 Q152 48 152 58 L152 90"
        />
        <path
          className="watch-line"
          d="M108 170 L108 202 Q108 212 118 212 L142 212 Q152 212 152 202 L152 170"
        />

        {/* watch case */}
        <circle cx="130" cy="130" r="46" className="watch-line" />
        <circle cx="130" cy="130" r="38" className="watch-line watch-line--faint" />

        {/* side buttons */}
        <rect x="175" y="117" width="7" height="18" rx="3.5" className="watch-line" />
        <rect
          x="175"
          y="140"
          width="6"
          height="11"
          rx="3"
          className="watch-line watch-line--faint"
        />

        {/* scattered particles */}
        <circle cx="44" cy="150" r="2" className="watch-dot watch-dot--amber" />
        <circle cx="30" cy="172" r="1.6" className="watch-dot watch-dot--green" />
        <circle cx="52" cy="108" r="1.4" className="watch-dot watch-dot--muted" />
        <circle cx="80" cy="52" r="1.5" className="watch-dot watch-dot--teal" />
        <circle cx="96" cy="232" r="2" className="watch-dot watch-dot--amber" />
        <circle cx="122" cy="214" r="1.6" className="watch-dot watch-dot--green" />
        <circle cx="150" cy="228" r="2.1" className="watch-dot watch-dot--amber" />
        <circle cx="168" cy="58" r="1.4" className="watch-dot watch-dot--muted" />
        <circle cx="200" cy="196" r="1.6" className="watch-dot watch-dot--amber" />
        <circle cx="212" cy="120" r="1.6" className="watch-dot watch-dot--teal" />
        <circle cx="196" cy="150" r="1.5" className="watch-dot watch-dot--muted" />
        <circle cx="222" cy="86" r="1.5" className="watch-dot watch-dot--amber" />
        <circle cx="74" cy="196" r="1.4" className="watch-dot watch-dot--muted" />
        <circle cx="60" cy="230" r="1.5" className="watch-dot watch-dot--green" />
      </svg>
      <Music className="watch-connect-note" size={34} aria-hidden="true" />
    </div>
  );
}

function LibraryEmptyState({
  title,
  subtitle,
  variant = "default",
}: {
  title: string;
  subtitle?: string;
  variant?: "default" | "watch";
}) {
  return (
    <div
      className={`library-empty-state${
        variant === "watch" ? " library-empty-state--watch" : ""
      }`}
    >
      {variant === "watch" ? (
        <WatchConnectIllustration />
      ) : (
        <Music size={24} aria-hidden="true" />
      )}
      <strong>{title}</strong>
      {subtitle ? (
        <span className="library-empty-subtitle">{subtitle}</span>
      ) : null}
    </div>
  );
}
