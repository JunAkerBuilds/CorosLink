"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, LinkButton } from "@/components/ui";
import { HubSessionEndedError, useHubSession } from "@/data/hub";
import { NotWiredError } from "@/data/core";
import {
  connectIntervals, disconnectIntervals, importDaysStore, importIntervalsActivity, intervalsStatus, listIntervalsActivities, saveImportDays,
  type ImportDays, type IntervalsRow, type IntervalsStatus,
} from "@/data/intervals";
import { useStore } from "@/data/local/store";
import { shortDay } from "@/lib/calendar";
import { dayKey } from "@/lib/format";
import { t } from "@/lib/i18n";
import { DEFAULT_IMPORT_DAYS, IMPORT_RANGES, importDistance, importSummary, isImportDays } from "@/lib/intervals";
import "../activities.css";

const said = (e: unknown): string => (e instanceof Error ? e.message : t("C-LINK couldn't finish that. Try again."));
const CARD = { boxSizing: "border-box", padding: 18, display: "flex", flexDirection: "column", gap: 14 } as const;

interface RowState { busy: boolean; error: string | null }

export default function ImportPage() {
  const hub = useHubSession();
  const signedIn = hub?.state === "signedIn";

  /* The intervals.icu connection */
  const [status, setStatus] = useState<IntervalsStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [athleteId, setAthleteId] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [accountProblem, setAccountProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    intervalsStatus().then((next) => { if (live) setStatus(next); }, (e: unknown) => { if (live) { setStatus({ connected: false }); setAccountProblem(said(e)); } });
    return () => { live = false; };
  }, []);
  const connected = status?.connected === true;

  /* The table */
  const saved = useStore(importDaysStore, DEFAULT_IMPORT_DAYS);
  const days: ImportDays = isImportDays(saved) ? saved : DEFAULT_IMPORT_DAYS;
  const [nonce, setNonce] = useState(0);
  const [rows, setRows] = useState<IntervalsRow[]>([]);
  const [loaded, setLoaded] = useState<{ key: string; error: string | null } | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowState>>({});
  const [importingAll, setImportingAll] = useState(false);
  /** How the last "Import all" went, in one line. */
  const [allSummary, setAllSummary] = useState<string | null>(null);
  const wanted = connected && signedIn;
  const key = `${days}:${nonce}`;
  useEffect(() => {
    if (!wanted) return;
    let live = true;
    listIntervalsActivities(days).then(
      (next) => { if (live) { setRows(next); setRowState({}); setLoaded({ key, error: null }); } },
      (e: unknown) => { if (live) setLoaded({ key, error: said(e) }); },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, key]);
  const refreshing = wanted && loaded?.key !== key;
  const shown = wanted ? rows : [];
  const missing = shown.filter((row) => !row.onCoros);
  const anyBusy = Object.values(rowState).some((state) => state.busy);

  const connect = () => {
    setConnecting(true); setAccountProblem(null);
    connectIntervals(apiKey, athleteId).then((next) => { setStatus(next); setApiKey(""); setConnecting(false); }, (e: unknown) => { setAccountProblem(said(e)); setConnecting(false); });
  };
  const disconnect = () => {
    setConnecting(true); setAccountProblem(null);
    disconnectIntervals().then((next) => { setStatus(next); setRows([]); setRowState({}); setLoaded(null); setConnecting(false); }, (e: unknown) => { setAccountProblem(said(e)); setConnecting(false); });
  };

  /** Imports one row; the error when it failed, so "Import all" can tell whether to go on. */
  const importOne = async (row: IntervalsRow): Promise<unknown> => {
    setRowState((current) => ({ ...current, [row.intervalsId]: { busy: true, error: null } }));
    try {
      await importIntervalsActivity(row);
      setRows((current) => current.map((other) => (other.intervalsId === row.intervalsId ? { ...other, onCoros: true } : other)));
      setRowState((current) => ({ ...current, [row.intervalsId]: { busy: false, error: null } }));
      return null;
    } catch (e) {
      setRowState((current) => ({ ...current, [row.intervalsId]: { busy: false, error: said(e) } }));
      return e ?? new Error();
    }
  };
  const importAll = async () => {
    setImportingAll(true); setAllSummary(null);
    const queue = [...missing];
    let done = 0, failed = 0, stopped: string | null = null;
    try {
      for (const row of queue) {
        const error = await importOne(row);
        if (!error) { done += 1; continue; }
        failed += 1;
        // The same answer would come for every row left: stop and say why once.
        if (error instanceof HubSessionEndedError || error instanceof NotWiredError) { stopped = said(error); break; }
      }
    } finally {
      const left = queue.length - done - failed;
      const parts = [t("Imported {done} of {total}.", { done, total: queue.length })];
      if (failed > 0) parts.push(t("{n} failed, see the rows below.", { n: failed }));
      if (stopped) parts.push(t("Stopped with {n} left: {reason}", { n: left, reason: stopped }));
      setAllSummary(parts.join(" "));
      setImportingAll(false);
    }
  };

  const found = IMPORT_RANGES.find((range) => range.days === days)?.label;
  const rangeLabel = found ? t(found) : t("{n} days", { n: days });

  return (
    <main className="page" style={{ gap: 20, paddingTop: 24 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: "1 1 360px", minWidth: 0 }}>
          <nav aria-label={t("Breadcrumb")} className="muted" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, fontSize: 13 }}>
            <Link href="/activities" style={{ textDecoration: "none", fontWeight: 600 }}>{t("Activities")}</Link>
            <span aria-hidden="true">/</span>
            <span aria-current="page">{t("Import")}</span>
          </nav>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em" }}>{t("Import from intervals.icu")}</h1>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          <LinkButton href="/activities">{t("Cancel")}</LinkButton>
        </div>
      </div>

      {hub && !signedIn ? (
        <div className="notice">
          <span style={{ flex: "1 1 240px" }}>{hub.state === "ended" ? t("COROS signed you out. Sign in again to import.") : t("Imported activities go to your COROS account. Sign in to COROS first.")}</span>
          <LinkButton variant="primary" href="/connect">{t("Sign in to COROS")}</LinkButton>
        </div>
      ) : null}

      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", gap: 24 }}>
        <div style={{ flex: "2.4 1 640px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <Card aria-label={t("Activities")} aria-busy={refreshing} style={CARD}>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <div role="group" aria-label={t("How far back to look")} style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {IMPORT_RANGES.map((range) => (
                  <button key={range.days} type="button" className="chip" aria-pressed={days === range.days} disabled={refreshing || importingAll || anyBusy} onClick={() => saveImportDays(range.days)}>{t(range.label)}</button>
                ))}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                <Button disabled={!wanted || refreshing || importingAll || anyBusy} onClick={() => setNonce((n) => n + 1)}>{refreshing ? t("Refreshing…") : t("Refresh")}</Button>
                <Button variant="primary" style={{ fontSize: 14, fontWeight: 700 }} disabled={missing.length === 0 || importingAll || anyBusy || refreshing} onClick={() => void importAll()}>
                  {importingAll ? t("Importing…") : missing.length > 0 ? t("Import all missing ({n})", { n: missing.length }) : t("Import all missing")}
                </Button>
              </div>
            </div>

            {allSummary ? <p role="status" style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{allSummary}</p> : null}

            {!wanted ? (
              status && hub ? <span className="muted" style={{ fontSize: 13 }}>{!signedIn ? t("Sign in to COROS to compare your activities.") : t("Connect your intervals.icu account to see what COROS is missing.")}</span> : null
            ) : loaded?.key === key && loaded.error ? (
              <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--h-rose-ink)" }}>{loaded.error}</p>
            ) : loaded === null ? (
              <div className="skeleton" style={{ minHeight: 220 }} />
            ) : shown.length === 0 ? (
              <span className="muted" style={{ fontSize: 13 }}>{refreshing ? t("Refreshing…") : t("No intervals.icu activities in the last {range}.", { range: rangeLabel })}</span>
            ) : (
              <>
                <span className="muted" role="status" style={{ fontSize: 13 }}>{refreshing ? t("Refreshing…") : importSummary(shown)}</span>
                <div className="scroll-x">
                  <div role="table" aria-label={t("intervals.icu activities")} style={{ minWidth: 780 }}>
                    <div role="row" className="imp-head">
                      <span role="columnheader">{t("Activity")}</span><span role="columnheader">{t("Date")}</span><span role="columnheader">{t("Type")}</span><span role="columnheader">{t("Distance")}</span><span role="columnheader">{t("Status")}</span>
                    </div>
                    {shown.map((row) => {
                      const state = rowState[row.intervalsId];
                      return (
                        <div key={row.intervalsId} role="row" className="imp-row" style={state?.error ? { padding: "8px 4px" } : undefined}>
                          <span role="cell" style={{ minWidth: 0 }}>
                            <span style={{ fontWeight: 600 }}>{row.name}</span>
                            {state?.error ? <><br /><span role="alert" style={{ fontSize: 12, color: "var(--h-rose-ink)" }}>{state.error}</span></> : null}
                          </span>
                          <span role="cell" className="soft">{row.startEpochMs > 0 ? shortDay(dayKey(new Date(row.startEpochMs))) : "—"}</span>
                          <span role="cell" className="soft">{row.type}</span>
                          <span role="cell">{importDistance(row)}</span>
                          {row.onCoros ? (
                            <span role="cell" style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--h-mint-ink)" }}>
                              <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                              {t("On COROS")}
                            </span>
                          ) : (
                            <span role="cell">
                              <Button style={{ height: 32 }} disabled={state?.busy || importingAll || refreshing} aria-label={t("Import {name}", { name: row.name })} onClick={() => void importOne(row)}>{state?.busy ? t("Importing…") : t("Import")}</Button>
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>

        <div style={{ flex: "1 1 300px", minWidth: 0, display: "flex", flexDirection: "column", gap: 20 }}>
          <Card aria-label={t("Account")} style={CARD}>
            <h2 className="h2">{t("intervals.icu account")}</h2>
            {status === null ? <div className="skeleton" style={{ minHeight: 120 }} /> : connected ? (
              <>
                <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, color: "var(--h-mint-ink)" }}>
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{ strokeWidth: 2.4, strokeLinecap: "round", strokeLinejoin: "round" }}><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                  {status.athleteId ? t("Connected · Athlete {id}", { id: status.athleteId }) : t("Connected")}
                </span>
                <div><Button disabled={connecting || importingAll || anyBusy} onClick={disconnect}>{t("Disconnect")}</Button></div>
              </>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); connect(); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t("intervals.icu API key")}
                  <input type="password" className="field imp-field" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} disabled={connecting} />
                </label>
                <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>{t("Athlete ID")}
                  <input type="text" className="field imp-field" autoComplete="off" placeholder="i123456" value={athleteId} onChange={(e) => setAthleteId(e.target.value)} disabled={connecting} />
                </label>
                <div><Button type="submit" disabled={connecting || apiKey.trim() === "" || athleteId.trim() === ""}>{connecting ? t("Connecting…") : t("Connect")}</Button></div>
              </form>
            )}
            {accountProblem ? <p role="alert" style={{ margin: 0, fontSize: 13, fontWeight: 600, color: "var(--h-rose-ink)" }}>{accountProblem}</p> : null}
          </Card>
          <Card aria-label={t("Already on COROS")} style={CARD}>
            <h2 className="h2">{t("Already on COROS")}</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: "19px" }}>{t("An activity counts as already there when the start is within 3 minutes and the time and distance are within 5%.")}</p>
          </Card>
        </div>
      </div>
    </main>
  );
}
