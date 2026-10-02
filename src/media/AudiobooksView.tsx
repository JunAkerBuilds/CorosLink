import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Library,
  ListOrdered,
  Loader2,
  Minus,
  Plus,
  Search,
  Timer,
  Trash2,
  Upload,
  Watch,
  X,
} from "lucide-react";
import type {
  Audiobook,
  AudiobookDraftChapter,
  AudiobookProgress,
  AudiobookSplitMode,
  AudiobookSplitOptions,
  FreeAudiobook,
  FreeAudiobookDetail,
  WatchStatus,
} from "../../electron/types";
import { formatBytes } from "./libraryUtils";
import "./audiobooks.css";

const SPLIT_STORAGE_KEY = "audiobooks.split";
const TAB_STORAGE_KEY = "audiobooks.tab";
const MIN_PART_MINUTES = 1;
const MAX_PART_MINUTES = 180;
const DEFAULT_SPLIT: AudiobookSplitOptions = { mode: "chapters", minutes: 10 };
// Converted parts are 64 kbps mono: about 29 MB per hour of audio.
const CONVERTED_BYTES_PER_SECOND = 8_000;
// A final part shorter than this is merged into the previous one.
const TINY_TAIL_SECONDS = 3;
// Past this, stopping partway through a part costs a lot of listening.
const LONG_PART_SECONDS = 30 * 60;
const PREVIEW_PART_COUNT = 5;

type AudiobookTab = "books" | "free";

/** A submitted catalogue search; the serial reruns a repeated query. */
interface FreeSearch {
  query: string;
  serial: number;
}

/** What the conversion dialog needs, for an imported file or a LibriVox book. */
interface ConversionRequest {
  kind: "file" | "librivox";
  title: string;
  author?: string;
  coverUrl?: string;
  durationSeconds: number;
  chapters: AudiobookDraftChapter[];
  chapterSource: "marks" | "files" | "none";
  fileCount: number;
  /** Bytes downloaded before converting, for LibriVox books. */
  downloadBytes?: number;
  confirm: (split: AudiobookSplitOptions) => Promise<void>;
  discard?: () => void;
}

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
  const [tab, setTab] = useState<AudiobookTab>(readStoredTab);
  const [books, setBooks] = useState<Audiobook[]>([]);
  const [progress, setProgress] = useState<Record<string, AudiobookProgress>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [request, setRequest] = useState<ConversionRequest | null>(null);
  const [freeQuery, setFreeQuery] = useState("");
  const [freeSearch, setFreeSearch] = useState<FreeSearch>({
    query: "",
    serial: 0,
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  const connected = Boolean(watchStatus?.connected);
  const watchTrackCount = watchStatus?.tracks.length ?? 0;

  function changeTab(next: AudiobookTab) {
    setTab(next);
    writeStorage(TAB_STORAGE_KEY, next);
    scrollRef.current?.scrollTo({ top: 0 });
  }

  function submitFreeSearch(query: string) {
    setFreeSearch((current) => ({ query, serial: current.serial + 1 }));
  }

  const refresh = useCallback(async () => {
    if (!api) return;
    try {
      setBooks(await api.listAudiobooks());
    } catch (caught) {
      onError(errorMessage(caught));
    }
  }, [api, onError]);

  // The watch's track list decides which parts show as on the watch.
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
        onMessage(`"${book.title}" is ready to send: ${partCountLabel(book.parts.length)}.`);
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

  function addBook(book: Audiobook) {
    setBooks((current) => [book, ...current.filter((item) => item.id !== book.id)]);
  }

  async function handleChooseFile() {
    if (!api) return;
    setChoosing(true);
    try {
      const draft = await api.chooseAudiobookFiles();
      if (!draft) return;
      setRequest({
        kind: "file",
        title: draft.title,
        author: draft.author,
        durationSeconds: draft.durationSeconds,
        chapters: draft.chapters,
        chapterSource: draft.chapterSource,
        fileCount: draft.fileCount,
        confirm: async (split) => {
          const book = await api.convertAudiobookDraft(draft.id, split);
          addBook(book);
          changeTab("books");
        },
        discard: () => void api.discardAudiobookDraft(draft.id),
      });
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setChoosing(false);
    }
  }

  function handleAddFree(detail: FreeAudiobookDetail) {
    if (!api) return;
    const chapters = freeBookChapters(detail);
    setRequest({
      kind: "librivox",
      title: detail.title,
      author: detail.author,
      coverUrl: detail.coverUrl,
      durationSeconds: chapters.reduce((total, chapter) => total + chapter.durationSeconds, 0),
      chapters,
      chapterSource: chapters.length > 1 ? "files" : "none",
      fileCount: detail.sections.length,
      downloadBytes: detail.totalBytes || undefined,
      confirm: async (split) => {
        const book = await api.importFreeAudiobook(detail.identifier, split);
        addBook(book);
        changeTab("books");
        onMessage(`Downloading "${book.title}" from LibriVox.`);
      },
    });
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
          ? `"${book.title}" is already on the watch.`
          : `Sent ${partCountLabel(result.copied)} of "${book.title}" to the watch.`,
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
    const kept = book.source ? "" : " Your original file is kept.";
    if (!window.confirm(`Delete "${book.title}" from CorosLink?${kept}`)) {
      return;
    }
    void runBookAction(book.id, async () => {
      setBooks(await api!.deleteAudiobook(book.id));
    });
  }

  return (
    <div className="stack stack-fill audiobook-view">
      <section className="panel panel-flex audiobook-panel">
        {/* The heading floats over the scrolling books, glassed once they pass under it. */}
        <div ref={scrollRef} className="audiobook-scroll">
          <div className="section-heading audiobook-heading">
            <div>
              <p className="eyebrow">Audiobooks</p>
              <h2>
                {tab === "books"
                  ? `${books.length} book${books.length === 1 ? "" : "s"}`
                  : "Free classics"}
              </h2>
            </div>
            {tab === "free" ? (
              <form
                className="audiobook-search"
                role="search"
                onSubmit={(event: FormEvent) => {
                  event.preventDefault();
                  submitFreeSearch(freeQuery.trim());
                }}
              >
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={freeQuery}
                  placeholder="What do you want to listen to?"
                  aria-label="Search free audiobooks"
                  onChange={(event) => setFreeQuery(event.target.value)}
                />
                {freeQuery || freeSearch.query ? (
                  <button
                    type="button"
                    className="audiobook-search-clear"
                    aria-label="Clear search"
                    onClick={() => {
                      setFreeQuery("");
                      submitFreeSearch("");
                    }}
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                ) : null}
              </form>
            ) : null}
            <div className="audiobook-heading-actions">
              <div className="library-filter-group" role="tablist" aria-label="Audiobooks">
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "books"}
                  className={
                    tab === "books" ? "library-filter-option active" : "library-filter-option"
                  }
                  onClick={() => changeTab("books")}
                >
                  <BookOpen size={14} aria-hidden="true" />
                  Your books
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "free"}
                  className={
                    tab === "free" ? "library-filter-option active" : "library-filter-option"
                  }
                  onClick={() => changeTab("free")}
                >
                  <Library size={14} aria-hidden="true" />
                  Free classics
                </button>
              </div>
              <button
                className="primary-button compact-button"
                type="button"
                disabled={!api || choosing}
                onClick={() => void handleChooseFile()}
              >
                {choosing ? (
                  <Loader2 className="spin" size={16} aria-hidden="true" />
                ) : (
                  <Plus size={16} aria-hidden="true" />
                )}
                {choosing ? "Reading file" : "Import file"}
              </button>
            </div>
          </div>

          {tab === "books" ? (
            <BookShelf
              books={books}
              progress={progress}
              busyId={busyId}
              expandedId={expandedId}
              connected={connected}
              onToggle={(id) => setExpandedId((current) => (current === id ? null : id))}
              onTransfer={handleTransfer}
              onRemoveFromWatch={handleRemoveFromWatch}
              onDelete={handleDelete}
              onCancel={(book) => void api?.cancelAudiobookConversion(book.id)}
              onImport={() => void handleChooseFile()}
              onBrowseFree={() => changeTab("free")}
            />
          ) : (
            <FreeClassics
              books={books}
              search={freeSearch}
              onAdd={handleAddFree}
              onShowBooks={() => changeTab("books")}
              onError={onError}
            />
          )}
        </div>
      </section>

      {request ? (
        <ConvertDialog
          request={request}
          onClose={() => {
            request.discard?.();
            setRequest(null);
          }}
          onConfirmed={() => setRequest(null)}
          onError={onError}
        />
      ) : null}
    </div>
  );
}

/**
 * Asks how to split a book before anything is converted, with a preview of
 * the parts each choice makes and what conversion actually does.
 */
function ConvertDialog({
  request,
  onClose,
  onConfirmed,
  onError,
}: {
  request: ConversionRequest;
  onClose: () => void;
  onConfirmed: () => void;
  onError: (message: string) => void;
}) {
  const titleId = useId();
  const hasChapters = request.chapterSource !== "none" && request.chapters.length > 1;
  const stored = readStoredSplit();
  const [mode, setMode] = useState<AudiobookSplitMode>(hasChapters ? stored.mode : "minutes");
  const [minutesInput, setMinutesInput] = useState(String(stored.minutes));
  const [converting, setConverting] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const minutes = clampMinutes(Number(minutesInput));
  const split: AudiobookSplitOptions = { mode, minutes };
  const parts = useMemo(() => previewParts(request, mode, minutes), [request, mode, minutes]);
  const longestChapter = Math.max(0, ...request.chapters.map((chapter) => chapter.durationSeconds));
  const fixedCount = previewParts(request, "minutes", minutes).length;
  const stem = previewFileStem(request.title);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !converting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [converting, onClose]);

  async function handleConvert() {
    setConverting(true);
    writeStorage(SPLIT_STORAGE_KEY, JSON.stringify(split));
    try {
      await request.confirm(split);
      onConfirmed();
    } catch (caught) {
      onError(errorMessage(caught));
      setConverting(false);
    }
  }

  const chapterDescription =
    request.chapterSource === "marks"
      ? "Uses the chapter marks in the file. Each part is named after its chapter."
      : request.kind === "librivox"
        ? "One part per LibriVox section, named after the section."
        : "One part per file you chose, named after the file.";

  return createPortal(
    <div
      className="calendar-modal-backdrop audiobook-convert-backdrop"
      onClick={() => {
        if (!converting) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="calendar-modal audiobook-convert"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header
          className="audiobook-convert-header"
          style={{ "--cover-hue": titleHue(request.title) } as CSSProperties}
        >
          {request.coverUrl ? (
            <img
              className="audiobook-convert-wash"
              src={request.coverUrl}
              alt=""
              aria-hidden="true"
            />
          ) : null}
          <BookCover
            title={request.title}
            author={request.author}
            coverUrl={request.coverUrl}
            size="small"
            showTitle
          />
          <div className="audiobook-convert-heading">
            <p className="audiobook-convert-kicker">Convert for your watch</p>
            <h3 id={titleId}>{request.title}</h3>
            <p className="audiobook-convert-meta">
              {[request.author, formatLength(request.durationSeconds)]
                .filter((item): item is string => Boolean(item))
                .map((item) => (
                  <span key={item}>{item}</span>
                ))}
            </p>
          </div>
          <button
            type="button"
            className="audiobook-convert-close"
            aria-label="Close"
            disabled={converting}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="audiobook-convert-body">
          <fieldset className="audiobook-split-options">
            <legend>Split the book into</legend>
            <div className="audiobook-split-grid">
              <label
                className={`audiobook-split-option${mode === "chapters" ? " is-selected" : ""}${
                  hasChapters ? "" : " is-disabled"
                }`}
              >
                <input
                  type="radio"
                  name="audiobook-split"
                  value="chapters"
                  checked={mode === "chapters"}
                  disabled={!hasChapters}
                  onChange={() => setMode("chapters")}
                />
                <span className="audiobook-split-option-top">
                  <span className="audiobook-split-icon">
                    <ListOrdered size={18} aria-hidden="true" />
                  </span>
                  <span className="audiobook-split-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                </span>
                <span className="audiobook-split-option-title">Chapters</span>
                <span className="audiobook-split-count">
                  {hasChapters ? (
                    <>
                      <strong>{request.chapters.length}</strong> parts
                    </>
                  ) : (
                    "Not available"
                  )}
                </span>
                <span className="audiobook-split-option-hint">
                  {hasChapters
                    ? `${chapterDescription} Longest is ${formatLength(longestChapter)}.`
                    : "This book has no chapter marks, so it can only be split by length."}
                </span>
              </label>

              <label
                className={`audiobook-split-option${mode === "minutes" ? " is-selected" : ""}`}
              >
                <input
                  type="radio"
                  name="audiobook-split"
                  value="minutes"
                  checked={mode === "minutes"}
                  onChange={() => setMode("minutes")}
                />
                <span className="audiobook-split-option-top">
                  <span className="audiobook-split-icon">
                    <Timer size={18} aria-hidden="true" />
                  </span>
                  <span className="audiobook-split-check" aria-hidden="true">
                    <Check size={13} strokeWidth={3} />
                  </span>
                </span>
                <span className="audiobook-split-option-title">Equal parts</span>
                <span className="audiobook-split-count">
                  <strong>{fixedCount}</strong> {fixedCount === 1 ? "part" : "parts"}
                </span>
                <span className="audiobook-stepper">
                  <button
                    type="button"
                    aria-label="Shorter parts"
                    disabled={minutes <= MIN_PART_MINUTES}
                    onClick={() => {
                      setMode("minutes");
                      setMinutesInput(String(clampMinutes(minutes - 1)));
                    }}
                  >
                    <Minus size={14} aria-hidden="true" />
                  </button>
                  <input
                    className="audiobook-split-minutes"
                    type="number"
                    inputMode="numeric"
                    min={MIN_PART_MINUTES}
                    max={MAX_PART_MINUTES}
                    step={1}
                    value={minutesInput}
                    aria-label="Part length in minutes"
                    onFocus={() => setMode("minutes")}
                    onChange={(event) => setMinutesInput(event.target.value)}
                    onBlur={() => setMinutesInput(String(minutes))}
                  />
                  <span className="audiobook-stepper-unit">min</span>
                  <button
                    type="button"
                    aria-label="Longer parts"
                    disabled={minutes >= MAX_PART_MINUTES}
                    onClick={() => {
                      setMode("minutes");
                      setMinutesInput(String(clampMinutes(minutes + 1)));
                    }}
                  >
                    <Plus size={14} aria-hidden="true" />
                  </button>
                </span>
                <span className="audiobook-split-option-hint">
                  Cuts at the same length every time, even mid-sentence. Short parts lose less when
                  the watch restarts one.
                </span>
              </label>
            </div>
          </fieldset>

          {mode === "chapters" && longestChapter > LONG_PART_SECONDS ? (
            <p className="audiobook-convert-warning" role="note">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                Some chapters run {formatLength(longestChapter)}. If you stop partway through one,
                the watch starts that chapter again from the beginning. Equal parts keep the loss
                short.
              </span>
            </p>
          ) : null}

          <section className="audiobook-convert-preview" aria-label="Parts preview">
            <h4>Preview</h4>
            <ol>
              {parts.slice(0, PREVIEW_PART_COUNT).map((part, index) => (
                <li key={index}>
                  <span className="audiobook-convert-index">{index + 1}</span>
                  <span className="audiobook-convert-names">
                    <span className="audiobook-convert-chapter">
                      {part.title ?? `Starts at ${formatClock(part.startSeconds)}`}
                    </span>
                    <span className="audiobook-convert-file">
                      {stem}{" "}
                      {String(index + 1).padStart(Math.max(3, String(parts.length).length), "0")}
                      .mp3
                    </span>
                  </span>
                  <span className="audiobook-convert-length">
                    {formatLength(part.durationSeconds)}
                  </span>
                </li>
              ))}
            </ol>
            {parts.length > PREVIEW_PART_COUNT ? (
              <p className="audiobook-convert-more">
                + {parts.length - PREVIEW_PART_COUNT} more{" "}
                {parts.length - PREVIEW_PART_COUNT === 1 ? "part" : "parts"}
              </p>
            ) : null}
          </section>

          <section className="audiobook-how" aria-label="How conversion works">
            <h4>What happens next</h4>
            <ol>
              {request.kind === "librivox" ? (
                <li>
                  CorosLink downloads the recording from the Internet Archive
                  {request.downloadBytes ? ` (${formatBytes(request.downloadBytes)})` : ""} and
                  checks every file against its published checksum.
                </li>
              ) : null}
              <li>
                It converts the audio to mono 64 kbps MP3, the only format COROS watches play.
                {request.kind === "file" ? " Your original file isn't changed." : ""}
              </li>
              <li>
                It cuts the result into the parts above, numbered in play order. The watch can't
                remember a position inside a track, so a part you stop halfway through starts again
                from its beginning.
              </li>
              <li>
                When it's done, send the book from Your books. Parts are copied one at a time, first
                to last, because the watch plays files in the order they arrive.
              </li>
            </ol>
          </section>
        </div>

        <footer className="audiobook-convert-footer">
          <p className="audiobook-convert-summary">
            <strong>{partCountLabel(parts.length)}</strong>
            <span>about {formatBytes(request.durationSeconds * CONVERTED_BYTES_PER_SECOND)}</span>
          </p>
          <button
            className="secondary-button compact-button"
            type="button"
            disabled={converting}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="primary-button compact-button audiobook-convert-go"
            type="button"
            disabled={converting}
            onClick={() => void handleConvert()}
          >
            {converting ? (
              <Loader2 className="spin" size={16} aria-hidden="true" />
            ) : request.kind === "librivox" ? (
              <Download size={16} aria-hidden="true" />
            ) : null}
            {request.kind === "librivox"
              ? `Download and convert`
              : `Convert into ${partCountLabel(parts.length)}`}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function BookShelf({
  books,
  progress,
  busyId,
  expandedId,
  connected,
  onToggle,
  onTransfer,
  onRemoveFromWatch,
  onDelete,
  onCancel,
  onImport,
  onBrowseFree,
}: {
  books: Audiobook[];
  progress: Record<string, AudiobookProgress>;
  busyId: string | null;
  expandedId: string | null;
  connected: boolean;
  onToggle: (id: string) => void;
  onTransfer: (book: Audiobook) => void;
  onRemoveFromWatch: (book: Audiobook) => void;
  onDelete: (book: Audiobook) => void;
  onCancel: (book: Audiobook) => void;
  onImport: () => void;
  onBrowseFree: () => void;
}) {
  if (books.length === 0) {
    return (
      <div className="audiobook-empty">
        <div className="audiobook-empty-covers" aria-hidden="true">
          <BookCover title="Moby Dick" size="small" />
          <BookCover title="Dracula" size="small" />
          <BookCover title="Pride and Prejudice" size="small" />
        </div>
        <h2>Put a book on your wrist</h2>
        <p>
          COROS watches play MP3 only and forget your place inside a track, so CorosLink cuts each
          book into short parts and sends them in order. You choose how it's split before anything
          is converted.
        </p>
        <div className="audiobook-empty-actions">
          <button className="primary-button compact-button" type="button" onClick={onBrowseFree}>
            <Search size={16} aria-hidden="true" />
            Browse free classics
          </button>
          <button className="secondary-button compact-button" type="button" onClick={onImport}>
            <Plus size={16} aria-hidden="true" />
            Import a file
          </button>
        </div>
        <p className="audiobook-empty-formats">
          Imports DRM-free .m4b, .m4a, .mp3, .flac and similar files. Select several files to join
          them into one book.
        </p>
      </div>
    );
  }

  return (
    <ul className="audiobook-shelf">
      {books.map((book) => (
        <BookRow
          key={book.id}
          book={book}
          progress={progress[book.id]}
          busy={busyId === book.id}
          anyBusy={busyId !== null}
          expanded={expandedId === book.id}
          connected={connected}
          onToggle={() => onToggle(book.id)}
          onTransfer={() => onTransfer(book)}
          onRemoveFromWatch={() => onRemoveFromWatch(book)}
          onDelete={() => onDelete(book)}
          onCancel={() => onCancel(book)}
        />
      ))}
    </ul>
  );
}

function BookRow({
  book,
  progress,
  busy,
  anyBusy,
  expanded,
  connected,
  onToggle,
  onTransfer,
  onRemoveFromWatch,
  onDelete,
  onCancel,
}: {
  book: Audiobook;
  progress?: AudiobookProgress;
  busy: boolean;
  anyBusy: boolean;
  expanded: boolean;
  connected: boolean;
  onToggle: () => void;
  onTransfer: () => void;
  onRemoveFromWatch: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const ready = book.status === "ready";
  const onWatch = book.parts.filter((part) => part.onWatch).length;
  const total = book.parts.length;
  const allOnWatch = ready && total > 0 && onWatch === total;
  const transferring = busy && progress?.phase === "transferring";
  const partsId = `audiobook-parts-${book.id}`;
  const partStarts = useMemo(() => {
    let elapsed = 0;
    return book.parts.map((part) => {
      const start = elapsed;
      elapsed += part.durationSeconds;
      return start;
    });
  }, [book.parts]);

  let sendLabel = "Send to watch";
  if (transferring) sendLabel = "Sending";
  else if (allOnWatch) sendLabel = "On watch";
  else if (onWatch > 0) sendLabel = `Send ${total - onWatch} more`;

  return (
    <li className={`audiobook-row${expanded ? " is-expanded" : ""}`}>
      <div className="audiobook-row-main">
        <BookCover title={book.title} author={book.author} coverUrl={book.source?.coverUrl} />

        <div className="audiobook-row-body">
          <div className="audiobook-row-heading">
            <h3>{book.title}</h3>
            {book.author ? <p className="audiobook-author">{book.author}</p> : null}
          </div>

          {book.status === "converting" ? (
            <BookProgress progress={progress} />
          ) : book.status === "failed" ? (
            <p className="audiobook-error">{book.error ?? "Conversion failed."}</p>
          ) : (
            <>
              <dl className="audiobook-facts">
                <div>
                  <dt>Length</dt>
                  <dd>{formatLength(book.durationSeconds)}</dd>
                </div>
                <div>
                  <dt>Split into</dt>
                  <dd>{partsSummary(book)}</dd>
                </div>
                <div>
                  <dt>Size</dt>
                  <dd>{formatBytes(book.sizeBytes)}</dd>
                </div>
              </dl>
              {transferring ? (
                <BookProgress progress={progress} />
              ) : (
                <WatchMeter onWatch={onWatch} total={total} />
              )}
              {book.splitNote ? <p className="audiobook-note">{book.splitNote}</p> : null}
            </>
          )}
        </div>

        <div className="audiobook-row-actions">
          <div className="audiobook-row-tools">
            {ready ? (
              <button
                className="icon-button"
                type="button"
                title={expanded ? "Hide parts" : "Show parts"}
                aria-label={`${expanded ? "Hide" : "Show"} parts of ${book.title}`}
                aria-expanded={expanded}
                aria-controls={partsId}
                onClick={onToggle}
              >
                <ChevronDown size={16} aria-hidden="true" className="audiobook-chevron" />
              </button>
            ) : null}
            {ready ? (
              <button
                className="icon-button"
                type="button"
                title="Remove from watch"
                aria-label={`Remove ${book.title} from watch`}
                disabled={!connected || anyBusy || onWatch === 0}
                onClick={onRemoveFromWatch}
              >
                <Watch size={16} aria-hidden="true" />
              </button>
            ) : null}
            <button
              className="icon-button audiobook-delete"
              type="button"
              title="Delete from CorosLink"
              aria-label={`Delete ${book.title}`}
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </div>
          {book.status === "converting" ? (
            <button className="secondary-button compact-button" type="button" onClick={onCancel}>
              <X size={15} aria-hidden="true" />
              Cancel
            </button>
          ) : null}
          {ready ? (
            <button
              className={
                allOnWatch
                  ? "secondary-button compact-button audiobook-send is-done"
                  : "primary-button compact-button audiobook-send"
              }
              type="button"
              title={connected ? undefined : "Connect your watch over USB"}
              disabled={!connected || anyBusy || allOnWatch}
              onClick={onTransfer}
            >
              {transferring ? (
                <Loader2 className="spin" size={15} aria-hidden="true" />
              ) : allOnWatch ? (
                <Check size={15} aria-hidden="true" />
              ) : (
                <Upload size={15} aria-hidden="true" />
              )}
              {sendLabel}
            </button>
          ) : null}
        </div>
      </div>

      {expanded && ready ? (
        <ol className="audiobook-parts" id={partsId}>
          {book.parts.map((part, offset) => (
            <li key={part.index} className={part.onWatch ? "is-on-watch" : undefined}>
              <span className="audiobook-part-number">{part.index}</span>
              <span className="audiobook-part-name">
                <span>{part.chapterTitle ?? `From ${formatClock(partStarts[offset] ?? 0)}`}</span>
                <small>{part.name}</small>
              </span>
              <span className="audiobook-part-length">{formatLength(part.durationSeconds)}</span>
              <span className="audiobook-part-state">
                {part.onWatch ? (
                  <>
                    <Check size={13} aria-hidden="true" />
                    On watch
                  </>
                ) : (
                  "Not sent"
                )}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function BookProgress({ progress }: { progress?: AudiobookProgress }) {
  const percent = Math.round((progress?.progress ?? 0) * 100);
  return (
    <div className="audiobook-progress" role="status" aria-live="polite">
      <div className="audiobook-progress-label">
        <span>{progress?.message ?? "Preparing"}</span>
        <span>{percent}%</span>
      </div>
      <div
        className="audiobook-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="audiobook-progress-bar" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/** One tick per part, so the order the watch will play in stays visible. */
function WatchMeter({ onWatch, total }: { onWatch: number; total: number }) {
  if (total === 0) return null;
  const label =
    onWatch === 0
      ? "Not on the watch yet"
      : onWatch === total
        ? "Every part is on the watch"
        : `${onWatch} of ${total} parts on the watch`;
  return (
    <div className="audiobook-meter" aria-label={label} role="img">
      {total <= 60 ? (
        <div className="audiobook-meter-ticks" aria-hidden="true">
          {Array.from({ length: total }, (_, index) => (
            <span key={index} className={index < onWatch ? "is-on" : undefined} />
          ))}
        </div>
      ) : (
        <div className="audiobook-progress-track" aria-hidden="true">
          <div
            className="audiobook-progress-bar"
            style={{ width: `${Math.round((onWatch / total) * 100)}%` }}
          />
        </div>
      )}
      <span className="audiobook-meter-label">{label}</span>
    </div>
  );
}

function FreeClassics({
  books,
  search,
  onAdd,
  onShowBooks,
  onError,
}: {
  books: Audiobook[];
  search: FreeSearch;
  onAdd: (detail: FreeAudiobookDetail) => void;
  onShowBooks: () => void;
  onError: (message: string) => void;
}) {
  const api = window.corosLink;
  const [activeQuery, setActiveQuery] = useState("");
  const [results, setResults] = useState<FreeAudiobook[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detail, setDetail] = useState<FreeAudiobookDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);

  const shelfIds = useMemo(
    () =>
      new Set(
        books
          .filter((book) => book.source && book.status !== "failed")
          .map((book) => book.source!.identifier),
      ),
    [books],
  );

  // Only the newest request may update the list; an older, slower one is dropped.
  const listRequest = useRef(0);
  const loadList = useCallback(
    async (search: string) => {
      if (!api) return;
      const request = ++listRequest.current;
      setLoadingList(true);
      setListError(null);
      try {
        const next = search
          ? await api.searchFreeAudiobooks(search)
          : await api.listPopularFreeAudiobooks();
        if (request !== listRequest.current) return;
        setResults(next);
        setActiveQuery(search);
      } catch (caught) {
        if (request === listRequest.current) setListError(errorMessage(caught));
      } finally {
        if (request === listRequest.current) setLoadingList(false);
      }
    },
    [api],
  );

  useEffect(() => {
    setDetail(null);
    void loadList(search.query);
  }, [search, loadList]);

  async function openBook(book: FreeAudiobook) {
    if (!api) return;
    setLoadingDetail(book.identifier);
    try {
      setDetail(await api.loadFreeAudiobook(book.identifier));
    } catch (caught) {
      onError(errorMessage(caught));
    } finally {
      setLoadingDetail(null);
    }
  }

  if (detail) {
    const inShelf = shelfIds.has(detail.identifier);
    const convertedBytes = detail.runtimeSeconds
      ? detail.runtimeSeconds * CONVERTED_BYTES_PER_SECOND
      : undefined;
    const meta = [
      detail.runtimeSeconds ? formatLength(detail.runtimeSeconds) : null,
      detail.sections.length === 1 ? "1 section" : `${detail.sections.length} sections`,
      convertedBytes ? `about ${formatBytes(convertedBytes)} on the watch` : null,
      detail.language && detail.language !== "English" ? detail.language : null,
    ].filter((item): item is string => Boolean(item));
    return (
      <div className="audiobook-free-detail">
        <header
          className="audiobook-hero"
          style={{ "--cover-hue": titleHue(detail.title) } as CSSProperties}
        >
          {detail.coverUrl ? (
            <img
              className="audiobook-hero-backdrop"
              src={detail.coverUrl}
              alt=""
              aria-hidden="true"
            />
          ) : null}
          <button className="audiobook-back" type="button" onClick={() => setDetail(null)}>
            <ArrowLeft size={15} aria-hidden="true" />
            {activeQuery ? `Results for “${activeQuery}”` : "Most listened"}
          </button>
          <div className="audiobook-hero-body">
            <BookCover
              title={detail.title}
              author={detail.author}
              coverUrl={detail.coverUrl}
              size="large"
            />
            <div className="audiobook-hero-copy">
              <p className="audiobook-hero-kind">LibriVox audiobook</p>
              <h2>{detail.title}</h2>
              <p className="audiobook-hero-meta">
                {detail.author ? <strong>{detail.author}</strong> : null}
                {meta.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </p>
            </div>
          </div>
        </header>

        <div className="audiobook-free-actions">
          {inShelf ? (
            <button className="secondary-button audiobook-cta" type="button" onClick={onShowBooks}>
              <Check size={18} aria-hidden="true" />
              In your books
            </button>
          ) : (
            <button
              className="primary-button audiobook-cta"
              type="button"
              onClick={() => onAdd(detail)}
            >
              <Download size={18} aria-hidden="true" />
              Add to your books
            </button>
          )}
          <a
            className="audiobook-source-link"
            href={detail.pageUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on the Internet Archive
            <ExternalLink size={13} aria-hidden="true" />
          </a>
          {!inShelf ? (
            <p className="audiobook-free-hint">
              You'll choose how to split it before anything is downloaded.
            </p>
          ) : null}
        </div>

        {detail.description ? <p className="audiobook-description">{detail.description}</p> : null}

        <section className="audiobook-tracks" aria-label="Sections">
          <div className="audiobook-tracks-head" aria-hidden="true">
            <span>#</span>
            <span>Title</span>
            <Clock size={14} />
          </div>
          <ol>
            {detail.sections.map((section, index) => (
              <li key={section.name}>
                <span className="audiobook-track-number">{index + 1}</span>
                <span className="audiobook-track-title">{section.title}</span>
                <span className="audiobook-track-length">
                  {section.durationSeconds ? formatClock(section.durationSeconds) : ""}
                </span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    );
  }

  return (
    <div className="audiobook-free">
      <div className="audiobook-free-top">
        <h2 className="audiobook-free-heading">
          {activeQuery ? `Results for “${activeQuery}”` : "Most listened"}
        </h2>
        <p className="audiobook-free-credit">
          Public-domain recordings read by{" "}
          <a href="https://librivox.org" target="_blank" rel="noreferrer">
            LibriVox
          </a>{" "}
          volunteers, hosted by the Internet Archive.
        </p>
      </div>

      {listError ? (
        <div className="audiobook-free-message">
          <p>{listError}</p>
          <button
            className="secondary-button compact-button"
            type="button"
            onClick={() => void loadList(activeQuery)}
          >
            Try again
          </button>
        </div>
      ) : loadingList && !results ? (
        <ul className="audiobook-free-grid" aria-busy="true">
          {Array.from({ length: 12 }, (_, index) => (
            <li key={index} className="audiobook-free-skeleton">
              <span />
              <span />
              <span />
            </li>
          ))}
        </ul>
      ) : results && results.length === 0 ? (
        <div className="audiobook-free-message">
          <p>
            No LibriVox recordings match “{activeQuery}”. LibriVox only has books that are out of
            copyright, so try a classic title or an author's surname.
          </p>
        </div>
      ) : (
        <ul className={`audiobook-free-grid${loadingList ? " is-loading" : ""}`}>
          {(results ?? []).map((book) => {
            const owned = shelfIds.has(book.identifier);
            return (
              <li key={book.identifier}>
                <button
                  type="button"
                  className={`audiobook-free-card${owned ? " is-owned" : ""}`}
                  disabled={loadingDetail !== null}
                  onClick={() => void openBook(book)}
                >
                  <span className="audiobook-free-card-art">
                    <BookCover title={book.title} author={book.author} coverUrl={book.coverUrl} />
                    {loadingDetail === book.identifier ? (
                      <span className="audiobook-free-card-loading">
                        <Loader2 className="spin" size={18} aria-hidden="true" />
                      </span>
                    ) : (
                      <span className="audiobook-free-card-fab" aria-hidden="true">
                        {owned ? <Check size={20} /> : <ChevronRight size={22} />}
                      </span>
                    )}
                  </span>
                  <span className="audiobook-free-card-title">{book.title}</span>
                  {book.author || book.runtimeSeconds ? (
                    <span className="audiobook-free-card-meta">
                      {[book.author, book.runtimeSeconds ? formatLength(book.runtimeSeconds) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  ) : null}
                  {owned ? (
                    <span className="audiobook-free-card-owned">
                      <Check size={12} aria-hidden="true" />
                      In your books
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Cover art for a book. Downloaded books use their archive.org image;
 * imported files get a plain cover tinted from the title, so every book on
 * the shelf is recognisable at a glance.
 */
function BookCover({
  title,
  author,
  coverUrl,
  size = "medium",
  showTitle = false,
}: {
  title: string;
  author?: string;
  coverUrl?: string;
  size?: "small" | "medium" | "large";
  /** Small covers are plain boards unless asked to carry the title. */
  showTitle?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [coverUrl]);

  if (coverUrl && !failed) {
    return (
      <span className={`audiobook-cover audiobook-cover-${size}`}>
        <img src={coverUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
      </span>
    );
  }
  return (
    <span
      className={`audiobook-cover audiobook-cover-${size} audiobook-cover-typeset${
        showTitle ? " has-title" : ""
      }`}
      style={{ "--cover-hue": titleHue(title) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="audiobook-cover-title">{title}</span>
      {author && size !== "small" ? <span className="audiobook-cover-author">{author}</span> : null}
    </span>
  );
}

interface PreviewPart {
  title?: string;
  startSeconds: number;
  durationSeconds: number;
}

/** The parts a split would produce, matching what the converter does. */
function previewParts(
  request: Pick<ConversionRequest, "chapters" | "chapterSource" | "durationSeconds">,
  mode: AudiobookSplitMode,
  minutes: number,
): PreviewPart[] {
  if (mode === "chapters" && request.chapterSource !== "none" && request.chapters.length > 1) {
    return request.chapters;
  }
  const length = minutes * 60;
  const total = request.durationSeconds;
  if (!(total > 0)) return [];
  const parts: PreviewPart[] = [];
  for (let start = 0; start < total; start += length) {
    parts.push({
      startSeconds: start,
      durationSeconds: Math.min(length, total - start),
    });
  }
  // The converter merges a final blip of encoder padding into the part before.
  const last = parts[parts.length - 1];
  if (parts.length > 1 && last && last.durationSeconds < TINY_TAIL_SECONDS) {
    parts.pop();
    parts[parts.length - 1]!.durationSeconds += last.durationSeconds;
  }
  return parts;
}

/** LibriVox sections become chapters, one per downloaded file. */
function freeBookChapters(detail: FreeAudiobookDetail): AudiobookDraftChapter[] {
  const known = detail.sections.filter((section) => section.durationSeconds);
  const fallback =
    detail.runtimeSeconds && detail.sections.length
      ? detail.runtimeSeconds / detail.sections.length
      : known.length
        ? known.reduce((total, section) => total + section.durationSeconds!, 0) / known.length
        : 0;
  let start = 0;
  return detail.sections.map((section) => {
    const durationSeconds = section.durationSeconds ?? fallback;
    const chapter = {
      title: section.title,
      startSeconds: start,
      durationSeconds,
    };
    start += durationSeconds;
    return chapter;
  });
}

/** Mirrors the converter's file names closely enough for the preview. */
function previewFileStem(title: string): string {
  const stem = title
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40)
    .replace(/[\s.]+$/, "");
  return stem || "Audiobook";
}

function titleHue(title: string): number {
  let hash = 0;
  for (const character of title) {
    hash = (hash * 31 + character.codePointAt(0)!) | 0;
  }
  return Math.abs(hash) % 360;
}

function readStoredSplit(): AudiobookSplitOptions {
  try {
    const stored = JSON.parse(localStorage.getItem(SPLIT_STORAGE_KEY) ?? "null");
    if (stored && (stored.mode === "minutes" || stored.mode === "chapters")) {
      return {
        mode: stored.mode,
        minutes: clampMinutes(Number(stored.minutes)),
      };
    }
  } catch {
    // Fall through to the default.
  }
  return DEFAULT_SPLIT;
}

function readStoredTab(): AudiobookTab {
  try {
    return localStorage.getItem(TAB_STORAGE_KEY) === "free" ? "free" : "books";
  } catch {
    return "books";
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the choice then lasts for this session.
  }
}

function clampMinutes(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SPLIT.minutes;
  return Math.min(Math.max(Math.round(value), MIN_PART_MINUTES), MAX_PART_MINUTES);
}

function partCountLabel(count: number): string {
  return count === 1 ? "1 part" : `${count} parts`;
}

function partsSummary(book: Audiobook): string {
  if (book.split.mode === "chapters" && !book.splitNote) {
    return book.parts.length === 1 ? "1 chapter" : `${book.parts.length} chapters`;
  }
  return `${book.parts.length} parts of ${book.split.minutes} min`;
}

function formatLength(totalSeconds: number): string {
  if (!(totalSeconds > 0)) return "—";
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }
  if (minutes === 0) {
    return `${seconds} s`;
  }
  return `${minutes} min`;
}

/** A position in the book, like 1:05:00 or 9:00. */
function formatClock(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
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
