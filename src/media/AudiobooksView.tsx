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
  WatchStatus,
} from "../../electron/types";
import { formatBytes } from "./libraryUtils";

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
      const book = await api.importAudiobook();
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
              Books are converted to 10-minute MP3 parts (mono, 64 kbps) named in
              play order. The watch plays files in the order they were copied,
              so parts are transferred one at a time, first to last.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={!api || importing}
            onClick={() => void handleImport()}
          >
            {importing ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : (
              <Plus size={16} aria-hidden="true" />
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
                              <span>{book.author ?? statusLabel(book)}</span>
                            </span>
                          </button>
                          {book.status === "failed" && book.error ? (
                            <p className="audiobook-error">{book.error}</p>
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
                                  <span className="audiobook-part-name">{part.name}</span>
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
