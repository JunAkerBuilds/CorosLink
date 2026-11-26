// Developer → Activity screens (main: watch/activityScreens.ts): a PACE Pro activity's data pages over the Local mode
// watch link. Read them, back them up, sync them back unchanged (the baseline), confirm on the watch, then try other
// field counts. Every write backs up first and can be restored. Experimental; development builds in developer mode only.
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, Select } from "@/components/ui";
import { language, locale, msg, t } from "@/lib/i18n";
import { tr } from "@/lib/i18n/react";
import "./activityScreens.css";

interface Field { metricId: number; height: number }
interface Page { index: number; kind: "grid" | "special" | "unknown"; rows: number; columns: number[]; fields: Field[]; baseMetricId: number; fieldCount: number | null }
interface Device { key: string; name: string; model: string; firmware: string }
interface Sport { id: number; name: string }
interface Doc { id: string; device: Device; sport: Sport; digest: string; pages: Page[]; baseline: "unverified" | "read-back-verified" | "watch-confirmed" }
interface Backup { id: string; createdAt: number; device: Device; sport: Sport; pageCount: number; digest: string; reason: string }
interface Preview { id: string; sourceId: string; pageIndex: number; fieldCount: number; experimental: boolean; page: Page }
interface State { enabled: boolean; ready: boolean; device: Device | null; pendingRestore: Backup | null; supportedFieldCounts: number[]; backups: Backup[] }

const BASE = "/api/desktop/developer/activity-screens";
const PRESETS = [2, 3, 4, 6, 8];
const EXPERIMENTS = [5, 7, 9];
/** What the PACE Pro on 3.2008.0 did with each experimental count (CorosLink's tests). */
const TRIED: Record<number, string> = { 5: msg("All five showed and updated on PACE Pro 3.2008.0."), 7: msg("Only the first field showed on PACE Pro 3.2008.0."), 9: msg("Only one field showed on PACE Pro 3.2008.0.") };

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json", "x-clink-hub": "1" }, body: JSON.stringify(body) });
  const json = (await r.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!r.ok || !json) throw new Error(json?.message ?? t("That didn't work."));
  return json;
}

function Diagram({ page }: { page: Page }) {
  if (page.kind !== "grid") return <div className="as-dial as-dial-special"><span>{page.kind === "special" ? t("Special page") : t("Unknown layout")}<small>{t("Kept as it is")}</small></span></div>;
  const starts = page.columns.map((_, row) => page.columns.slice(0, row).reduce((a, b) => a + b, 0));
  return (
    <div className="as-dial" aria-label={t("{n} fields", { n: page.fieldCount ?? "" })}>
      {page.columns.map((n, row) => {
        const fields = page.fields.slice(starts[row], starts[row] + n);
        return <div key={row} className="as-row" style={{ flexGrow: fields[0]?.height ?? 1 }}>{fields.map((f, i) => <span key={i}>#{f.metricId}</span>)}</div>;
      })}
      <div className="as-base">#{page.baseMetricId}</div>
    </div>
  );
}

const BASELINE = { unverified: msg("Not verified"), "read-back-verified": msg("Read back, check the watch"), "watch-confirmed": msg("Confirmed on the watch") } as const;

export default function ActivityScreens() {
  const [state, setState] = useState<State | null>(null);
  const [sports, setSports] = useState<Sport[]>([]);
  const [sportId, setSportId] = useState(0);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [pageIndex, setPageIndex] = useState(0);
  const [count, setCount] = useState(4);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [baseline, setBaseline] = useState<Backup | null>(null);
  const [backupId, setBackupId] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ error: boolean; text: string } | null>(null);
  const working = useRef(false);

  const refresh = useCallback(() => call<State>("").then(setState), []);
  useEffect(() => { void refresh().catch((e: unknown) => setNote({ error: true, text: e instanceof Error ? e.message : t("That didn't work.") })); }, [refresh]);

  const run = async (label: string, work: () => Promise<string | void>, forgetOnError = false) => {
    if (working.current) return;
    working.current = true; setBusy(label); setNote(null);
    try { const said = await work(); if (said) setNote({ error: false, text: said }); } catch (e) {
      if (forgetOnError) { setDoc(null); setPreview(null); }
      setNote({ error: true, text: e instanceof Error ? e.message : t("That didn't work.") });
    } finally {
      await refresh().catch(() => undefined);
      working.current = false; setBusy(null);
    }
  };
  const take = (next: Doc) => { setDoc(next); setSportId(next.sport.id); setPreview(null); setPageIndex((i) => Math.min(i, Math.max(0, next.pages.length - 1))); };

  const read = () => run(msg("Reading"), async () => {
    const list = sports.length ? sports : (await call<{ sports: Sport[] }>("/sports", {})).sports;
    if (!list.length) throw new Error(t("The watch listed no ordinary activities."));
    setSports(list);
    const pick = list.some((s) => s.id === sportId) ? sportId : list[0].id;
    take((await call<{ document: Doc }>("/read", { sportId: pick })).document);
  });
  const ready = !!state?.ready;
  const locked = !!busy;
  const pending = state?.pendingRestore ?? null;
  const verified = !!doc && doc.baseline !== "unverified";
  const confirmed = doc?.baseline === "watch-confirmed";
  const experimental = !!doc?.pages.some((p) => p.kind === "grid" && !PRESETS.includes(p.fieldCount ?? 0));
  const page = doc?.pages[pageIndex];

  if (!state) return null;
  return (
    <Card pad className="as" aria-busy={!!busy}>
      <div className="as-head">
        <div><span className="as-badge">{t("Experimental")} · PACE Pro</span><h2>{t("Activity screens")}</h2></div>
        <Button disabled={!ready || locked} onClick={() => void read()}>{busy === "Reading" ? t("Reading…") : doc ? t("Read again") : t("Read pages")}</Button>
      </div>
      {!ready ? <p className="as-muted">{tr("Connect a PACE Pro in {mode} to read its activity pages.", { mode: <Link href="/watch">{t("Local mode")}</Link> })}</p> : null}
      {pending ? (
        <div className="as-alert" role="alert">
          <span>{t("A sync of {sport} was interrupted. Restore its backup before anything else.", { sport: pending.sport.name })}</span>
          <Button disabled={!ready || locked} onClick={() => void run(msg("Restoring"), async () => { take((await call<{ document: Doc }>("/restore", { backupId: pending.id })).document); return t("Restored and read back."); })}>{t("Restore")}</Button>
        </div>
      ) : null}
      {sports.length ? (
        <label className="as-field">{t("Activity")}
          <Select value={sportId} disabled={locked} onChange={(e) => { setSportId(Number(e.target.value)); setDoc(null); setPreview(null); setBaseline(null); setPageIndex(0); }}>
            {sports.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </label>
      ) : null}

      {doc ? (<>
        <div className="as-summary">
          <b>{doc.sport.name} · {t("{n} pages", { n: doc.pages.length })}</b>
          <span className="as-muted">{doc.device.name} · {doc.device.firmware}</span>
          <span className="as-chip" data-state={doc.baseline}>{t(BASELINE[doc.baseline])}</span>
        </div>
        <div className="as-pages" role="group" aria-label={t("Pages")}>
          {doc.pages.map((p) => (
            <button key={p.index} type="button" aria-pressed={p.index === pageIndex} disabled={locked} onClick={() => { setPageIndex(p.index); setPreview(null); }}>
              <Diagram page={p} /><span>{t("Page {n}", { n: p.index + 1 })} · {p.fieldCount ?? t("special")}</span>
            </button>
          ))}
        </div>
        <p className="as-muted">{t("Numbers are the watch's metric ids, not readings.")}</p>
        <div className="as-actions">
          <Button disabled={!ready || locked} onClick={() => void run(msg("Backing up"), async () => { const { backup } = await call<{ backup: Backup }>("/backup", { snapshotId: doc.id }); setBackupId(backup.id); return t("Backed up on this computer."); })}>{t("Back up")}</Button>
          <Button variant="primary" disabled={!ready || locked || !!pending || experimental} onClick={() => void run(msg("Syncing"), async () => {
            const r = await call<{ document: Doc; backup: Backup }>("/baseline", { snapshotId: doc.id });
            take(r.document); setBaseline(r.backup); setBackupId(r.backup.id);
            return t("Synced unchanged and read back byte for byte. Check the pages on the watch, then confirm.");
          }, true)}>{t("Sync unchanged")}</Button>
          {verified && !confirmed && !experimental ? (
            <Button disabled={!ready || locked || !!pending} onClick={() => void run(msg("Confirming"), async () => { take((await call<{ document: Doc }>("/confirm", { snapshotId: doc.id })).document); return t("Confirmed. Experimental layouts are open."); })}>{t("They match on the watch")}</Button>
          ) : null}
          {baseline && baseline.digest !== doc.digest ? (
            <Button disabled={!ready || locked || !!pending} onClick={() => void run(msg("Restoring"), async () => { take((await call<{ document: Doc }>("/restore", { backupId: baseline.id })).document); return t("Baseline restored and read back."); }, true)}>{t("Back to baseline")}</Button>
          ) : null}
        </div>
        {experimental ? <p className="as-muted">{t("These pages hold an experimental layout. Restore the standard backup before a new baseline.")}</p> : null}

        <div className="as-layout">
          <label className="as-field">{t("Page {n} layout", { n: pageIndex + 1 })}
            <Select value={count} disabled={locked || !verified || page?.kind !== "grid"} onChange={(e) => { setCount(Number(e.target.value)); setPreview(null); }}>
              {PRESETS.map((n) => <option key={n} value={n}>{t("{n} fields", { n })}</option>)}
              {EXPERIMENTS.map((n) => <option key={n} value={n} disabled={!confirmed || !state.supportedFieldCounts.includes(n)}>{t("{n} fields", { n })} · {t("experimental")}</option>)}
            </Select>
          </label>
          <Button disabled={!ready || locked || !verified || !!pending || page?.kind !== "grid" || (EXPERIMENTS.includes(count) && !confirmed)}
            onClick={() => void run(msg("Previewing"), async () => { setPreview((await call<{ preview: Preview }>("/preview", { snapshotId: doc.id, pageIndex, fieldCount: count })).preview); })}>{t("Preview")}</Button>
        </div>
        {!verified ? <p className="as-muted">{t("Sync the pages unchanged first, so there's a baseline to come back to.")}</p> : null}
        {TRIED[count] ? <p className="as-muted">{t(TRIED[count])}</p> : null}
        {preview ? (
          <div className="as-preview">
            <Diagram page={preview.page} />
            <div>
              <b>{t("Page {n}", { n: preview.pageIndex + 1 })} · {t("{n} fields", { n: preview.fieldCount })}{preview.experimental ? ` · ${t("experimental")}` : ""}</b>
              <p className="as-muted">{t("Uses metrics already on the pages. The other pages and the bottom field stay.")}</p>
              <Button variant="primary" disabled={!ready || locked || !!pending || preview.sourceId !== doc.id} onClick={() => void run(msg("Syncing"), async () => {
                const r = await call<{ document: Doc; backup: Backup }>("/apply", { previewId: preview.id });
                take(r.document); setBackupId(r.backup.id);
                return t("Synced and read back. Check every field on the watch; restore a backup to undo.");
              }, true)}>{t("Sync to watch")}</Button>
            </div>
          </div>
        ) : null}
      </>) : null}

      <div className="as-backups">
        <label className="as-field">{t("Backups")}
          <Select value={backupId} disabled={locked || !state.backups.length} onChange={(e) => setBackupId(e.target.value)}>
            <option value="">{state.backups.length ? t("Pick a backup") : t("None yet")}</option>
            {state.backups.map((b) => <option key={b.id} value={b.id}>{b.sport.name} · {t("{n} pages", { n: b.pageCount })} · {new Date(b.createdAt).toLocaleString(language() === "en" ? undefined : locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · {b.reason} · {b.id.slice(0, 8)}</option>)}
          </Select>
        </label>
        <Button disabled={!ready || locked || !backupId} onClick={() => void run(msg("Restoring"), async () => { take((await call<{ document: Doc }>("/restore", { backupId })).document); return t("Restored and read back."); }, true)}>{t("Restore")}</Button>
        <a className={`btn btn-glass${backupId ? "" : " as-off"}`} href={backupId ? `${BASE}/backups/${backupId}/export` : undefined} download aria-disabled={!backupId}>{t("Export")}</a>
      </div>
      {busy ? <p className="as-muted" role="status">{t(busy)}…</p> : null}
      {note ? <p className={note.error ? "as-error" : "as-ok"} role={note.error ? "alert" : "status"}>{note.text}</p> : null}
    </Card>
  );
}
