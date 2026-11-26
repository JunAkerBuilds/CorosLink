// Media › Audiobooks: books turned into short MP3 parts the watch plays in order (desktop/main/media/audiobooks.ts).
// Your books lists them with what's on the watch; Free classics browses LibriVox. Every book is split in the convert
// dialog, which previews the parts before anything is converted.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Card, Field, Segmented } from "@/components/ui";
import { useStore } from "@/data/local/store";
import { t } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import {
  addFreeBook, cancelBook, chooseBook, continueBook, convertBook, deleteBook, discardDraft, MediaProblem, readBooks, readFreeBook, readFreeBooks,
  sendBook, unsendBook, uploadBook, type Book, type BooksState, type Chapter, type FreeBook, type FreeBookDetail, type Split,
} from "../media";
import {
  booksTabStore, BYTES_PER_SECOND, canContinueFrom, clampMinutes, clockAt, fileStem, length, LONG_PART, MAX_PART_MINUTES, MIN_PART_MINUTES,
  partName, partsSummary, partStarts, previewParts, splitStore, watchState,
} from "../mediaBooks";
import { carriesFiles, droppedFiles } from "../mediaInput";
import { megabytes } from "../mediaRows";
import "./mediaBooks.css";

const said = (e: unknown) => (e instanceof MediaProblem || e instanceof Error ? e.message : t("That didn't work."));
const PREVIEW = 5;

/** What the convert dialog is converting: a file read in the main process, or a book it downloads. */
interface Request {
  kind: "file" | "librivox";
  title: string; author: string | null; cover: string | null; secs: number; chapters: Chapter[];
  chapterSource: "marks" | "files" | "none"; files: number; download: number | null;
  confirm: (split: Split) => Promise<Book>;
  discard?: () => void;
}

export default function BooksPanel() {
  const tab = useStore(booksTabStore, "books");
  const [state, setState] = useState<BooksState | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [request, setRequest] = useState<Request | null>(null);

  const fail = (e: unknown) => setProblem(said(e));
  const converting = !!state?.books.some((b) => b.status === "converting");
  const sending = !!state?.job?.running;
  // Faster while something converts or sends, for the progress bars.
  useEffect(() => {
    let live = true;
    const read = () => readBooks().then((s) => { if (live) setState(s); }, (e) => { if (live) fail(e); });
    void read();
    const timer = setInterval(read, converting || sending ? 700 : 3000);
    return () => { live = false; clearInterval(timer); };
  }, [converting, sending]);

  const show = (book: Book) => { setState((s) => (s ? { ...s, books: [book, ...s.books.filter((b) => b.id !== book.id)] } : s)); booksTabStore.set("books"); };

  const fromDraft = (draft: Awaited<ReturnType<typeof chooseBook>>["draft"]) => {
    if (!draft) return;
    setRequest({
      kind: "file", title: draft.title, author: draft.author, cover: null, secs: draft.secs, chapters: draft.chapters,
      chapterSource: draft.chapterSource, files: draft.files, download: null,
      confirm: (split) => convertBook(draft.id, split).then((r) => r.book),
      discard: () => void discardDraft(draft.id),
    });
  };

  const choose = () => {
    setProblem(null); setReading(true);
    void chooseBook().then((r) => fromDraft(r.draft), fail).finally(() => setReading(false));
  };

  // Files dropped on the window while this section shows are one book (Media leaves those drops to this section).
  useEffect(() => {
    const drop = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer?.types) || (e.target as Element | null)?.closest?.("[data-watch-drop]")) return;
      void droppedFiles(e.dataTransfer).then((files) => {
        if (!files.length) return;
        setProblem(null); setReading(true);
        return uploadBook(files).then(fromDraft);
      }).catch(fail).finally(() => setReading(false));
    };
    window.addEventListener("drop", drop);
    return () => window.removeEventListener("drop", drop);
  });

  const run = (id: string, work: () => Promise<BooksState | void>, done?: string) => {
    setProblem(null); setNote(null); setBusy(id);
    void work().then((s) => { if (s) setState(s); if (done) setNote(done); }, fail).finally(() => setBusy(null));
  };

  const addFree = (detail: FreeBookDetail) => {
    const chapters = partStarts(detail.sections.map((s) => ({ secs: s.secs ?? 0 }))).map((start, i) => ({ title: detail.sections[i].title, start, secs: detail.sections[i].secs ?? 0 }));
    setRequest({
      kind: "librivox", title: detail.title, author: detail.author, cover: detail.cover, secs: chapters.reduce((a, c) => a + c.secs, 0) || (detail.secs ?? 0),
      chapters, chapterSource: chapters.length > 1 ? "files" : "none", files: detail.sections.length, download: detail.bytes || null,
      confirm: (split) => addFreeBook(detail.id, split).then((r) => r.book),
    });
  };

  const books = state?.books ?? [];
  const connected = !!state?.watch.connected;
  const model = state?.watch.model ?? t("the watch");

  return (
    <div className="bk">
      <div className="bk-bar">
        <Segmented small label={t("Audiobooks")} value={tab} onChange={(v) => booksTabStore.set(v)}
          options={[{ value: "books", label: `${t("Your books")}${books.length ? ` · ${books.length}` : ""}` }, { value: "free", label: t("Free classics") }]} />
        <span className="bk-grow" />
        <Button variant="primary" disabled={reading} onClick={choose}><PlusIcon />{reading ? t("Reading…") : t("Import a book")}</Button>
      </div>
      {state && !state.ffmpeg ? <p className="notice" role="alert">{tr("Converting books needs ffmpeg ({command}).", { command: <code>brew install ffmpeg</code> })}</p> : null}
      {problem ? <p className="notice" role="alert">{problem}</p> : null}
      {note ? <p className="notice" role="status">{note}</p> : null}

      {tab === "free" ? <FreeClassics onAdd={addFree} onShow={(id) => { setOpen(id); booksTabStore.set("books"); }} /> : !state ? null : books.length === 0 ? (
        <Card pad className="bk-empty">
          <div className="bk-empty-covers" aria-hidden="true"><Cover title="Moby Dick" size={64} /><Cover title="Dracula" size={64} /><Cover title="Emma" size={64} /></div>
          <h2 className="h2">{t("Put a book on your wrist")}</h2>
          <p className="muted">{t("Books are cut into short MP3 parts and sent in order, so a sync costs you one part at most.")}</p>
          <div className="actions">
            <Button variant="primary" onClick={() => booksTabStore.set("free")}><SearchIcon />{t("Browse free classics")}</Button>
            <Button onClick={choose}>{t("Import a book")}</Button>
          </div>
          <p className="muted bk-small">{t("DRM-free .m4b, .m4a, .mp3, .flac and similar. Choose several files to join them, or drop them here.")}</p>
        </Card>
      ) : (
        <ul className="bk-list">
          {books.map((b) => (
            <BookRow key={b.id} book={b} connected={connected} model={model} busy={busy} job={state.job?.book === b.id ? state.job : null} jobRunning={sending}
              open={open === b.id} onToggle={() => setOpen((o) => (o === b.id ? null : b.id))}
              onSend={() => run(b.id, () => sendBook(b.id).then((r) => { setNote(r.copying ? null : t("{title} is already on {model}.", { title: b.title, model })); return r; }))}
              onUnsend={() => { if (confirm(t("Remove {title} from {model}?", { title: b.title, model }))) run(b.id, () => unsendBook(b.id), t("Removed {title} from {model}.", { title: b.title, model })); }}
              onCancel={() => run(b.id, () => cancelBook(b.id))}
              onDelete={() => { if (confirm(b.source.kind === "file" ? t("Delete {title} from this computer? Your original file stays.", { title: b.title }) : t("Delete {title} from this computer?", { title: b.title }))) run(b.id, () => deleteBook(b.id)); }}
              onContinue={(part) => {
                const earlier = b.parts.filter((p) => p.onWatch && p.index < part).length;
                if (earlier && !confirm(earlier === 1
                  ? t("Remove the part before part {part} from {model}? Anything you send next plays after this book.", { part, model })
                  : t("Remove the {n} parts before part {part} from {model}? Anything you send next plays after this book.", { n: earlier, part, model }))) return;
                run(b.id, () => continueBook(b.id, part), !earlier ? t("{title} will be sent from part {part}.", { title: b.title, part })
                  : earlier === 1 ? t("{title} continues from part {part}. 1 part came off {model}.", { title: b.title, part, model })
                  : t("{title} continues from part {part}. {n} parts came off {model}.", { title: b.title, part, n: earlier, model }));
              }} />
          ))}
        </ul>
      )}

      {request ? <ConvertDialog request={request} onClose={() => { request.discard?.(); setRequest(null); }}
        onDone={(book) => { setRequest(null); show(book); setOpen(null); }} /> : null}
    </div>
  );
}

/* ───────────── Your books ───────────── */

function BookRow({ book, connected, model, busy, job, jobRunning, open, onToggle, onSend, onUnsend, onCancel, onDelete, onContinue }: {
  book: Book; connected: boolean; model: string; busy: string | null; job: BooksState["job"]; jobRunning: boolean; open: boolean;
  onToggle: () => void; onSend: () => void; onUnsend: () => void; onCancel: () => void; onDelete: () => void; onContinue: (part: number) => void;
}) {
  const ready = book.status === "ready";
  const w = watchState(book);
  const starts = useMemo(() => partStarts(book.parts), [book.parts]);
  const sendingThis = !!job?.running;
  const locked = !!busy || jobRunning;
  const cover = book.source.kind === "file" ? null : book.source.cover;
  const sendLabel = sendingThis ? t("Sending…") : w.all ? t("On {model}", { model }) : w.onWatch ? t("Send {n} more", { n: w.toPlay - w.onWatch }) : t("Send to watch");
  const parts = `bk-parts-${book.id}`;

  return (
    <li>
      <Card className="bk-row" data-open={open || undefined}>
        <div className="bk-main">
          <Cover title={book.title} src={cover} size={72} />
          <div className="bk-body">
            <div className="bk-name"><h3>{book.title}</h3>{book.author ? <span className="muted">{book.author}</span> : null}</div>
            {book.status === "converting" ? <Bar value={book.progress?.progress ?? 0} label={book.progress?.message ?? t("Starting")} />
              : book.status === "failed" ? <p className="bk-error">{book.error ?? t("The conversion failed.")}</p>
              : (<>
                <span className="bk-facts muted"><span>{length(book.secs)}</span><span>{partsSummary(book)}</span><span>{megabytes(book.bytes)}</span></span>
                {sendingThis ? <Bar value={job!.totalBytes ? job!.sentBytes / job!.totalBytes : 0} label={t("Copying part {n} of {total}", { n: Math.min(job!.done + 1, job!.total), total: job!.total })} />
                  : job?.error ? <p className="bk-error">{job.error}</p> : <Ticks book={book} />}
                {book.note ? <span className="bk-small muted">{book.note}</span> : null}
              </>)}
          </div>
          <div className="bk-acts">
            {ready ? <button type="button" className="bk-icon" aria-expanded={open} aria-controls={parts} aria-label={open ? t("Hide parts of {title}", { title: book.title }) : t("Show parts of {title}", { title: book.title })} title={open ? t("Hide parts") : t("Show parts")} onClick={onToggle}><ChevronIcon /></button> : null}
            {ready ? <button type="button" className="bk-icon" aria-label={t("Remove {title} from the watch", { title: book.title })} title={t("Remove from watch")} disabled={!connected || locked || !w.anyOnWatch} onClick={onUnsend}><UnwatchIcon /></button> : null}
            <button type="button" className="bk-icon bk-delete" aria-label={t("Delete {title}", { title: book.title })} title={t("Delete")} disabled={busy === book.id || sendingThis} onClick={onDelete}><TrashIcon /></button>
            {book.status === "converting" ? <Button onClick={onCancel}>{t("Cancel")}</Button> : null}
            {ready ? <Button variant={w.all ? "glass" : "primary"} className="bk-send" disabled={!connected || locked || w.all} title={connected ? undefined : t("Plug in your watch")} onClick={onSend}>{w.all ? <CheckIcon /> : <UploadIcon />}{sendLabel}</Button> : null}
          </div>
        </div>
        {open && ready ? (
          <div className="bk-parts" id={parts}>
            {book.parts.length > 1 && connected ? <p className="muted bk-small">{w.anyOnWatch ? t("Finished some? Choose the part you're on: the ones before it come off the watch.") : t("Choose where the next send starts.")}</p> : null}
            <ol>
              {book.parts.map((p, i) => {
                const listened = p.index < book.resume;
                return (
                  <li key={p.index} data-state={listened ? "listened" : p.onWatch ? "on" : undefined}>
                    <span className="bk-num num">{p.index}</span>
                    <span className="bk-pname"><span>{p.chapter ?? t("From {time}", { time: clockAt(starts[i] ?? 0) })}</span><small className="muted">{p.name}</small></span>
                    <span className="num muted">{length(p.secs)}</span>
                    <span className="bk-pstate">{p.onWatch ? <><CheckIcon />{t("On watch")}</> : listened ? t("Listened") : t("Not sent")}</span>
                    <span>{connected && !locked && canContinueFrom(book, p) ? <button type="button" className="md-link" aria-label={t("Continue {title} from part {part}", { title: book.title, part: p.index })} onClick={() => onContinue(p.index)}>{w.anyOnWatch ? t("I'm here") : t("Start here")}</button> : null}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </Card>
    </li>
  );
}

function Bar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);
  return (
    <span className="bk-bar-wrap" role="status" aria-live="polite">
      <span className="bk-bar-label"><span>{label}</span><span className="num">{pct}%</span></span>
      <span className="md-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct}%` }} /></span>
    </span>
  );
}

/** One tick per part, in play order: listened ones dim, the ones on the watch lit. */
function Ticks({ book }: { book: Book }) {
  const w = watchState(book);
  const status = w.onWatch === 0 ? t("Not on the watch") : w.all ? (w.listened ? t("The rest is on the watch") : t("On the watch")) : t("{n} of {total} on the watch", { n: w.onWatch, total: w.toPlay });
  const label = w.listened ? `${t("From part {part} of {total}", { part: book.resume, total: book.parts.length })} · ${status}` : status;
  return (
    <span className="bk-ticks" role="img" aria-label={label}>
      {book.parts.length <= 80 ? (
        <span className="bk-tick-row" aria-hidden="true">{book.parts.map((p) => <i key={p.index} data-state={p.index < book.resume ? "listened" : p.onWatch ? "on" : undefined} />)}</span>
      ) : (
        <span className="md-progress" aria-hidden="true"><i style={{ width: `${((w.listened + w.onWatch) / book.parts.length) * 100}%` }} /></span>
      )}
      <span className="bk-small muted">{label}</span>
    </span>
  );
}

/* ───────────── Free classics ───────────── */

function FreeClassics({ onAdd, onShow }: { onAdd: (d: FreeBookDetail) => void; onShow: (bookId: string) => void }) {
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  const [list, setList] = useState<FreeBook[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [detail, setDetail] = useState<FreeBookDetail | null>(null);
  const [loading, setLoading] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void readFreeBooks(asked).then((r) => { if (live) setList(r.books); }, (e) => { if (live) setProblem(said(e)); });
    return () => { live = false; };
  }, [asked]);

  const ask = (q: string) => {
    setDetail(null);
    if (q === asked) return;
    setList(null); setProblem(null); setAsked(q);
  };
  const openBook = (id: string) => {
    setLoading(id); setProblem(null);
    void readFreeBook(id).then((r) => setDetail(r.book), (e) => setProblem(said(e))).finally(() => setLoading(null));
  };

  return (
    <div className="bk-free">
      <form className="bk-search" role="search" onSubmit={(e) => { e.preventDefault(); ask(query.trim()); }}>
        <Field type="search" aria-label={t("Search free audiobooks")} placeholder={t("Title or author")} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" variant="primary"><SearchIcon />{t("Search")}</Button>
        {asked ? <Button onClick={() => { setQuery(""); ask(""); }}>{t("Most popular")}</Button> : null}
        <span className="bk-grow" />
        <span className="muted bk-small">{t("Public-domain recordings from LibriVox")}</span>
      </form>
      {problem ? <p className="notice" role="alert">{problem}</p> : null}

      {detail ? (
        <Card className="bk-detail" aria-label={detail.title}>
          <div className="bk-detail-head">
            <Cover title={detail.title} src={detail.cover} size={120} />
            <div className="bk-body">
              <button type="button" className="md-link bk-back" onClick={() => setDetail(null)}>← {t("All books")}</button>
              <h2 className="h2">{detail.title}</h2>
              <span className="muted">{[detail.author, detail.language, detail.secs ? length(detail.secs) : null, detail.sections.length === 1 ? t("1 section") : t("{n} sections", { n: detail.sections.length }), detail.bytes ? megabytes(detail.bytes) : null].filter(Boolean).join(" · ")}</span>
              {detail.about ? <p className="bk-about">{detail.about}</p> : null}
              <div className="actions">
                {detail.added ? <Button onClick={() => onShow(detail.added!)}><CheckIcon />{t("In your books")}</Button> : <Button variant="primary" onClick={() => onAdd(detail)}><DownloadIcon />{t("Download and convert")}</Button>}
                <a className="md-link bk-ext" href={detail.page} target="_blank" rel="noreferrer">archive.org</a>
              </div>
            </div>
          </div>
          <ol className="bk-sections">
            {detail.sections.map((s, i) => <li key={s.name}><span className="bk-num num">{i + 1}</span><span className="bk-pname"><span>{s.title}</span></span><span className="num muted">{s.secs ? length(s.secs) : ""}</span></li>)}
          </ol>
        </Card>
      ) : !list ? <p className="muted bk-small">{t("Loading…")}</p> : list.length === 0 ? <Card pad><p className="muted">{t("No recordings match. Try fewer words.")}</p></Card> : (
        <ul className="bk-grid">
          {list.map((b) => (
            <li key={b.id}>
              <button type="button" className="bk-tile" aria-busy={loading === b.id} disabled={!!loading} onClick={() => openBook(b.id)}>
                <Cover title={b.title} src={b.cover} size={132} />
                <b>{b.title}</b>
                <span className="muted">{b.author ?? ""}</span>
                <span className="muted bk-small">{[b.secs ? length(b.secs) : null, b.language].filter(Boolean).join(" · ")}{b.added ? <span className="bk-added"> · {t("In your books")}</span> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────── Convert ───────────── */

/** Asks how to split a book before anything is converted, with the parts each choice makes. */
function ConvertDialog({ request, onClose, onDone }: { request: Request; onClose: () => void; onDone: (book: Book) => void }) {
  const titleId = useId();
  const stored = useStore(splitStore, { mode: "chapters", minutes: 10 } as Split);
  const hasChapters = request.chapterSource !== "none" && request.chapters.length > 1;
  const [mode, setMode] = useState<Split["mode"]>(hasChapters ? stored.mode : "minutes");
  const [typed, setTyped] = useState(String(stored.minutes));
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const minutes = clampMinutes(Number(typed));
  const split: Split = { mode, minutes };
  const parts = useMemo(() => previewParts(request.chapters, request.secs, { mode, minutes }), [request, mode, minutes]);
  const equalCount = useMemo(() => previewParts([], request.secs, { mode: "minutes", minutes }).length, [request.secs, minutes]);
  const longest = Math.max(0, ...request.chapters.map((c) => c.secs));
  const stem = fileStem(request.title);

  useEffect(() => {
    box.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !working) onClose(); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [working, onClose]);

  const go = () => {
    setWorking(true); setProblem(null);
    splitStore.set(split);
    void request.confirm(split).then(onDone, (e) => { setProblem(said(e)); setWorking(false); });
  };
  const step = (by: number) => { setMode("minutes"); setTyped(String(clampMinutes(minutes + by))); };
  const chapterHint = request.chapterSource === "marks" ? t("From the file's chapter marks") : request.kind === "librivox" ? t("One per LibriVox section") : t("One per file");

  return createPortal(
    <div className="bk-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget && !working) onClose(); }}>
      <div ref={box} className="bk-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={working} tabIndex={-1}>
        <header className="bk-dialog-head">
          <Cover title={request.title} src={request.cover} size={64} />
          <div className="bk-body">
            <h2 id={titleId} className="h2">{request.title}</h2>
            <span className="muted">{[request.author, request.secs ? length(request.secs) : null].filter(Boolean).join(" · ")}</span>
          </div>
          <button type="button" className="bk-icon" aria-label={t("Close")} disabled={working} onClick={onClose}><CloseIcon /></button>
        </header>

        <fieldset className="bk-split">
          <legend>{t("Split into")}</legend>
          <label data-on={mode === "chapters" || undefined} data-off={!hasChapters || undefined}>
            <input type="radio" name="split" checked={mode === "chapters"} disabled={!hasChapters} onChange={() => setMode("chapters")} />
            <b>{t("Chapters")}</b>
            <span className="bk-count">{hasChapters ? tr("{n} parts", { n: <strong className="num">{request.chapters.length}</strong> }) : t("None in this book")}</span>
            {hasChapters ? <span className="muted bk-small">{chapterHint} · {t("longest {length}", { length: length(longest) })}</span> : null}
          </label>
          <label data-on={mode === "minutes" || undefined}>
            <input type="radio" name="split" checked={mode === "minutes"} onChange={() => setMode("minutes")} />
            <b>{t("Equal parts")}</b>
            <span className="bk-count">{request.secs ? (equalCount === 1 ? tr("{n} part", { n: <strong className="num">{equalCount}</strong> }) : tr("{n} parts", { n: <strong className="num">{equalCount}</strong> })) : t("{n} min each", { n: minutes })}</span>
            <span className="bk-stepper">
              <button type="button" aria-label={t("Shorter parts")} disabled={minutes <= MIN_PART_MINUTES} onClick={() => step(-1)}>−</button>
              <input type="number" inputMode="numeric" min={MIN_PART_MINUTES} max={MAX_PART_MINUTES} value={typed} aria-label={t("Part length in minutes")}
                onFocus={() => setMode("minutes")} onChange={(e) => setTyped(e.target.value)} onBlur={() => setTyped(String(minutes))} />
              <span className="muted">min</span>
              <button type="button" aria-label={t("Longer parts")} disabled={minutes >= MAX_PART_MINUTES} onClick={() => step(1)}>+</button>
            </span>
            <span className="muted bk-small">{t("Each ends at a pause, not mid-word")}</span>
          </label>
        </fieldset>

        {mode === "chapters" && longest > LONG_PART ? <p className="notice">{t("Some chapters run {length}. Plugging the watch in sends you back to the start of the one you're in.", { length: length(longest) })}</p> : null}

        <section className="bk-preview" aria-label={t("Parts")}>
          <ol>
            {parts.slice(0, PREVIEW).map((p, i) => (
              <li key={i}>
                <span className="bk-num num">{i + 1}</span>
                <span className="bk-pname"><span>{p.title ?? t("From {time}", { time: clockAt(p.start) })}</span><small className="muted">{partName(stem, i + 1, parts.length)}</small></span>
                <span className="num muted">{mode === "minutes" ? "≈ " : ""}{length(p.secs)}</span>
              </li>
            ))}
          </ol>
          {parts.length > PREVIEW ? <span className="muted bk-small">{parts.length - PREVIEW === 1 ? t("+ 1 more part") : t("+ {n} more parts", { n: parts.length - PREVIEW })}</span> : null}
        </section>

        {problem ? <p className="notice" role="alert">{problem}</p> : null}
        <footer className="bk-dialog-foot">
          <span className="muted bk-small">
            {[request.download ? t("Downloads {size}", { size: megabytes(request.download) }) : null, "mono 64 kbps MP3", t("about {size}", { size: megabytes(request.secs * BYTES_PER_SECOND) }), request.kind === "file" ? t("your file stays as it is") : null].filter(Boolean).join(" · ")}
          </span>
          <span className="bk-grow" />
          <Button disabled={working} onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={working} onClick={go}>{working ? t("Starting…") : request.kind === "librivox" ? t("Download and convert") : parts.length === 1 ? t("Convert into 1 part") : t("Convert into {n} parts", { n: parts.length })}</Button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

/** A cover from the source, or the title's first letter on a colour of its own. */
function Cover({ title, src, size }: { title: string; src?: string | null; size: number }) {
  const [failed, setFailed] = useState(false);
  const hue = [...title].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const style = { width: size, height: size, borderRadius: size >= 100 ? 18 : 12 };
  if (src && !failed) return <img className="bk-cover" src={src} alt="" loading="lazy" style={style} onError={() => setFailed(true)} />;
  return (
    <span className="bk-cover bk-cover-blank" aria-hidden="true" style={{ ...style, background: `linear-gradient(150deg, hsl(${hue} 45% 44%), hsl(${(hue + 30) % 360} 50% 26%))` }}>
      <span style={{ fontSize: Math.max(10, size * 0.13) }}>{title}</span>
    </span>
  );
}

const Svg = ({ d, size = 16, w = 2 }: { d: string; size?: number; w?: number }) => <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w} strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;
const PlusIcon = () => <Svg d="M12 5v14M5 12h14" w={2.2} />;
const SearchIcon = () => <Svg d="M11 18a7 7 0 1 0 0-14a7 7 0 0 0 0 14zM20 20l-4-4" size={15} w={2.4} />;
const ChevronIcon = () => <Svg d="M6 9l6 6 6-6" />;
const CheckIcon = () => <Svg d="M5 12.5l4.5 4.5L19 7.5" size={14} w={2.4} />;
const UploadIcon = () => <Svg d="M12 19V8M7 12l5-5 5 5M5 4h14" size={15} />;
const DownloadIcon = () => <Svg d="M12 4v11M7 10l5 5 5-5M5 20h14" size={15} w={2.2} />;
const TrashIcon = () => <Svg d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />;
const CloseIcon = () => <Svg d="M6 6l12 12M18 6L6 18" size={18} />;
const UnwatchIcon = () => <Svg d="M12 7a5 5 0 1 0 0 10a5 5 0 0 0 0-10zM9.4 7.7l.8-4.2h3.6l.8 4.2M9.4 16.3l.8 4.2h3.6l.8-4.2M3 3l18 18" />;
