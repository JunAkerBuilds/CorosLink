// The desktop's own way into the COROS account, in Connections' COROS account card above Training Hub (and in
// first-run setup): connect once through COROS's MCP, then the account's activities, recordings, daily health and
// sleep come in on a timer (desktop/main/account/service.ts). The store combines them with whatever else sends them.
import { useState } from "react";
import { Button, Dropdown } from "@/components/ui";
import { IMPORT_MINUTES, connectCoros, importLabel, importNow, importStep, importSummary, setImport, useCorosImport, waitingNote } from "../corosImport";
import { useMinute, whenSynced } from "../watchLink";
import { t } from "@/lib/i18n";
// Its notes and buttons look as they do in the card, in setup too.
import "@/app/(app)/connect/connect.css";

const said = (e: unknown) => (e instanceof Error ? e.message : t("That didn't work."));

/** For the card's pill: connected through COROS's MCP. */
export function useCorosAccountConnected(): boolean {
  const status = useCorosImport();
  return !!status?.available && status.connected && !status.signIn;
}

export function CorosAccountPart() {
  const status = useCorosImport();
  const now = useMinute();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!status?.available) return null;

  const act = (work: () => Promise<unknown>) => {
    setBusy(true); setProblem(null);
    work().catch((e: unknown) => setProblem(said(e))).finally(() => setBusy(false));
  };
  const connected = status.connected && !status.signIn;
  const line = status.running
    ? `${importStep(status.step)}…${status.step?.percent != null ? ` ${status.step.percent}%` : ""}`
    : !connected
      ? status.on ? t("COROS ended the connection. Connect again.") : t("Activities, health and sleep, with the watch still on the COROS app.")
      : status.last ? t("Imported {when} · {summary}", { when: whenSynced(status.last.at, now), summary: importSummary(status.last) }) : t("Connected. The first import is on its way.");
  const waiting = connected && !status.running ? waitingNote(status.last) : null;

  return (
    <>
      <p className="cn-note" role="status">{line}</p>
      {waiting ? <p className="cn-note">{waiting}</p> : null}
      {problem || status.problem ? <p className="cn-problem" role="alert">{problem ?? status.problem}</p> : null}
      <div className="cn-card-actions">
        {!connected
          ? <Button variant="primary" disabled={busy} onClick={() => act(connectCoros)}>{status.on ? t("Connect again") : t("Connect COROS")}</Button>
          : (
            <>
              <Button disabled={busy || status.running} onClick={() => act(importNow)}>{t("Import now")}</Button>
              <Dropdown small label={t("Auto-import")} value={status.on ? status.everyMinutes : 0}
                options={IMPORT_MINUTES.map((m) => ({ value: m as number, label: m === 0 ? t("Auto-import off") : importLabel(m) }))}
                onChange={(m) => act(() => setImport(m === 0 ? { on: false } : { on: true, everyMinutes: m }))} />
            </>
          )}
      </div>
    </>
  );
}
