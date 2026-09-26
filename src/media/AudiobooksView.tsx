import { Fragment, useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Loader2,
  Plus,
  Trash2,
  Upload,
  Watch,
  X,
} from "lucide-react";
import type {
  Audiobook,
  AudiobookProgress,
  AudiobookSplitMode,
  AudiobookSplitOptions,
  WatchStatus,
} from "../../electron/types";
import { formatBytes } from "./libraryUtils";

const SPLIT_STORAGE_KEY = "audiobooks.split";
const MIN_PART_MINUTES = 1;
const MAX_PART_MINUTES = 180;
const DEFAULT_SPLIT: AudiobookSplitOptions = { mode: "minutes", minutes: 10 };
const SPLIT_MODES: Array<{ value: AudiobookSplitMode; label: string }> = [
  { value: "minutes", label: "Every N minutes" },
  { value: "chapters", label: "By chapter" },
];

interface AudiobooksViewProps {
  watchStatus: WatchStatus | null;
  onWatchStatusChange: (status: WatchStatus) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}

export function AudiobooksView({
  watchStatus,
  onWatchStatusChange,
  onMessage,
  onError,
}: AudiobooksViewProps) {
  const api = window.corosLink;
  const [books, setBooks] = useState<Audiobook[]>([]);
  const [progress, setProgress] = useState<Record<string, AudiobookProgress>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [split, setSplit] = useState<AudiobookSplitOptions>(readStoredSplit);
  const [minutesInput, setMinutesInput] = useState(String(split.minutes));

  function updateSplit(next: AudiobookSplitOptions) {
    setSplit(next);
    try {
      localStorage.setItem(SPLIT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable; the choice then lasts for this session.
    }
  }

  function commitMinutes(raw: string) {
    const minutes = clampMinutes(Number(raw));
    setMinutesInput(String(minutes));
    updateSplit({ ...split, minutes });
  }
  const connected = Boolean(watchStatus?.connected);
  const watchTrackCount = watchStatus?.tracks.length ?? 0;

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setBooks(await api.listAudiobooks());
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }, [api, onError]);

  // The watch's track list decides which parts show as "on watch".
  useEffect(() => {
    void refresh();
  }, [refresh, connected, watchTrackCount]);

  useEffect(() => {
    if (!api) return;
    const offProgress = api.onAudiobookProgress((next) =>
      setProgress((current) => ({ ...current, [next.id]: next })),
    );
    const offUpdated = api.onAudiobookUpdated((book) => {
      setProgress((current) => withoutKey(current, book.id));
      if (book.status === "ready") {
        onMessage(`"${book.title}" is ready: ${book.parts.length} parts.`);
      } else if (book.status === "failed" && book.error) {
        onError(`${book.title}: ${book.error}`);
      }
      void refresh();
    });
    return () => {
      offProgress();
      offUpdated();
    };
  }, [api, onError, onMessage, refresh]);

  async function handleImport() {
    if (!api) return;
    setImporting(true);
    try {
      const book = await api.importAudiobook({
        ...split,
        minutes: clampMinutes(Number(minutesInput)),
      });
      if (book) {
        setBooks((current) => [book, ...current.filter((item) => item.id !== book.id)]);
      }
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setImporting(false);
    }
  }

  async function runBookAction(id: string, action: () => Promise<void>) {
    setBusyId(id);
    try {
      await action();
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setBusyId(null);
      setProgress((current) =>
        current[id]?.phase === "transferring" ? withoutKey(current, id) : current,
      );
      void refresh();
    }
  }

  function handleTransfer(book: Audiobook) {
    void runBookAction(book.id, async () => {
      const result = await api!.transferAudiobook(book.id);
      onWatchStatusChange(result.watch);
      onMessage(
        result.copied === 0
          ? `All parts of "${book.title}" are already on the watch.`
          : `Copied ${result.copied} part${result.copied === 1 ? "" : "s"} of "${book.title}" to the watch.`,
      );
    });
  }

  function handleRemoveFromWatch(book: Audiobook) {
    void runBookAction(book.id, async () => {
      onWatchStatusChange(await api!.removeAudiobookFromWatch(book.id));
      onMessage(`Removed "${book.title}" from the watch.`);
    });
  }

  function handleDelete(book: Audiobook) {
    if (!window.confirm(`Delete the converted files for "${book.title}"? Your original file is kept.`)) {
      return;
    }
    void runBookAction(book.id, async () => {
      setBooks(await api!.deleteAudiobook(book.id));
    });
  }

  return (
    <div className="stack stack-fill audiobook-view">
      <section className="panel panel-flex audiobook-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audiobooks</p>
            <h2>
              {books.length} book{books.length === 1 ? "" : "s"}
            </h2>
            <p className="audiobook-hint">
              Books are converted to MP3 parts (mono, 64 kbps) named in play
              order. The watch plays files in the order they were copied, so
              parts are transferred one at a time, first to last.
            </p>
          </div>
          <BookOpen size={22} aria-hidden="true" />
        </div>

        <div className="audiobook-toolbar">
          <span className="audiobook-toolbar-label">Split</span>
          <div className="library-filter-group" role="group" aria-label="How to split audiobooks">
            {SPLIT_MODES.map((option) => (
              <button
                key={option.value}
                className={
                  split.mode === option.value
                    ? "library-filter-option active"
                    : "library-filter-option"
                }
                type="button"
                aria-pressed={split.mode === option.value}
                onClick={() => updateSplit({ ...split, mode: option.value })}
              >
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <label className="audiobook-minutes-field">
            <span>{split.mode === "chapters" ? "No chapters? Every" : "Every"}</span>
            <input
              type="number"
              inputMode="numeric"
              min={MIN_PART_MINUTES}
              max={MAX_PART_MINUTES}
              step={1}
              value={minutesInput}
              aria-label="Part length in minutes"
              onChange={(event) => setMinutesInput(event.target.value)}
              onBlur={(event) => commitMinutes(event.target.value)}
            />
            <span>min</span>
          </label>
          <button
            className="primary-button compact-button audiobook-import-button"
            type="button"
            disabled={!api || importing}
            onClick={() => void handleImport()}
          >
            {importing ? (
              <Loader2 className="spin" size={17} aria-hidden="true" />
            ) : (
              <Plus size={17} aria-hidden="true" />
            )}
            Import audiobook
          </button>
        </div>

        {books.length === 0 ? (
          <div className="empty-state">
            <BookOpen size={24} aria-hidden="true" />
            <strong>No audiobooks yet</strong>
            <span>
              Choose a DRM-free .m4b, .m4a, .mp3 or similar file. Select several
              files to join them into one book.
            </span>
          </div>
        ) : (
          <div className="table-shell">
            <table>
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Length</th>
                  <th>Parts on watch</th>
                  <th>Size</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {books.map((book) => {
                  const bookProgress = progress[book.id];
                  const onWatch = book.parts.filter((part) => part.onWatch).length;
                  const busy = busyId === book.id;
                  const expanded = expandedId === book.id;
                  const ready = book.status === "ready";
                  return (
                    <Fragment key={book.id}>
                      <tr>
                        <td>
                          <button
                            className="audiobook-title-button"
                            type="button"
                            disabled={!ready}
                            aria-expanded={expanded}
                            onClick={() => setExpandedId(expanded ? null : book.id)}
                          >
                            {ready ? (
                              expanded ? (
                                <ChevronDown size={15} aria-hidden="true" />
                              ) : (
                                <ChevronRight size={15} aria-hidden="true" />
                              )
                            ) : (
                              <BookOpen size={15} aria-hidden="true" />
                            )}
                            <span className="audiobook-title-copy">
                              <strong>{book.title}</strong>
                              <span>
                                {[book.author, splitLabel(book)].filter(Boolean).join(" · ")}
                              </span>
                            </span>
                          </button>
                          {book.status === "failed" && book.error ? (
                            <p className="audiobook-error">{book.error}</p>
                          ) : null}
                          {ready && book.splitNote ? (
                            <p className="audiobook-note">{book.splitNote}</p>
                          ) : null}
                        </td>
                        <td>{book.durationSeconds > 0 ? formatLength(book.durationSeconds) : "—"}</td>
                        <td>
                          {ready ? (
                            <span
                              className={
                                onWatch === book.parts.length
                                  ? "badge ready"
                                  : onWatch > 0
                                    ? "badge warning"
                                    : "badge"
                              }
                            >
                              {onWatch} / {book.parts.length}
                            </span>
                          ) : (
                            <span className={book.status === "failed" ? "badge danger" : "badge"}>
                              {statusLabel(book)}
                            </span>
                          )}
                        </td>
                        <td>{ready ? formatBytes(book.sizeBytes) : "—"}</td>
                        <td>
                          <div className="table-actions">
                            {book.status === "converting" ? (
                              <button
                                className="icon-button"
                                type="button"
                                title="Cancel conversion"
                                aria-label={`Cancel converting ${book.title}`}
                                onClick={() => void api?.cancelAudiobookConversion(book.id)}
                              >
                                <X size={16} aria-hidden="true" />
                              </button>
                            ) : null}
                            {ready ? (
                              <>
                                <button
                                  className="icon-button"
                                  type="button"
                                  title={
                                    connected
                                      ? onWatch === book.parts.length
                                        ? "Already on watch"
                                        : "Transfer to watch"
                                      : "Connect your watch over USB"
                                  }
                                  aria-label={`Transfer ${book.title} to watch`}
                                  disabled={
                                    !connected || busyId !== null || onWatch === book.parts.length
                                  }
                                  onClick={() => handleTransfer(book)}
                                >
                                  {busy ? (
                                    <Loader2 className="spin" size={16} aria-hidden="true" />
                                  ) : (
                                    <Upload size={16} aria-hidden="true" />
                                  )}
                                </button>
                                <button
                                  className="icon-button"
                                  type="button"
                                  title="Remove from watch"
                                  aria-label={`Remove ${book.title} from watch`}
                                  disabled={!connected || busyId !== null || onWatch === 0}
                                  onClick={() => handleRemoveFromWatch(book)}
                                >
                                  <Watch size={16} aria-hidden="true" />
                                </button>
                              </>
                            ) : null}
                            <button
                              className="icon-button"
                              type="button"
                              title="Delete converted files"
                              aria-label={`Delete ${book.title}`}
                              disabled={busyId !== null}
                              onClick={() => handleDelete(book)}
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {bookProgress ? (
                        <tr className="audiobook-progress-row">
                          <td colSpan={5}>
                            <div className="library-transfer-progress" role="status" aria-live="polite">
                              <div className="library-transfer-progress-label">
                                <span className="library-transfer-progress-name">
                                  {bookProgress.message}
                                </span>
                                <span>{Math.round(bookProgress.progress * 100)}%</span>
                              </div>
                              <div
                                className="library-transfer-progress-track"
                                role="progressbar"
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuenow={Math.round(bookProgress.progress * 100)}
                              >
                                <div
                                  className="library-transfer-progress-bar"
                                  style={{ width: `${Math.round(bookProgress.progress * 100)}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {expanded && ready ? (
                        <tr className="audiobook-parts-row">
                          <td colSpan={5}>
                            <ol className="audiobook-parts">
                              {book.parts.map((part) => (
                                <li key={part.index}>
                                  <span className="audiobook-part-name">
                                    {part.name}
                                    {part.chapterTitle ? (
                                      <small>{part.chapterTitle}</small>
                                    ) : null}
                                  </span>
                                  <span>{formatLength(part.durationSeconds)}</span>
                                  <span>{formatBytes(part.sizeBytes)}</span>
                                  <span className={part.onWatch ? "badge ready" : "badge"}>
                                    {part.onWatch ? "On watch" : "Local"}
                                  </span>
                                </li>
                              ))}
                            </ol>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function readStoredSplit(): AudiobookSplitOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(SPLIT_STORAGE_KEY) ?? "null");
    if (stored && (stored.mode === "minutes" || stored.mode === "chapters")) {
      return { mode: stored.mode, minutes: clampMinutes(Number(stored.minutes)) };
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_SPLIT;
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT.minutes;
  return Math.min(Math.max(Math.round(value), MIN_PART_MINUTES), MAX_PART_MINUTES);
}

function splitLabel(book: Audiobook): string {
  if (book.status === "converting") return "Converting";
  if (book.status === "failed") return "";
  if (book.split.mode === "chapters" && !book.splitNote) {
    return `${book.parts.length} chapters`;
  }
  return `${book.split.minutes}-min parts`;
}

function statusLabel(book: Audiobook): string {
  switch (book.status) {
    case "converting":
      return "Converting";
    case "failed":
      return "Failed";
    default:
      return "Ready";
  }
}

function formatLength(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  }
  if (minutes === 0) {
    return `${seconds} s`;
  }
  return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}
