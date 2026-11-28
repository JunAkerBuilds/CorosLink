// Reach from anywhere: paired phones get to this computer away from home, through its own Cloudflare Tunnel. Off
// until the athlete turns it on; turning it on signs this computer in to the coroslink.com account the phone uses.
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Switch } from "@/components/ui";
import { t } from "@/lib/i18n";

export interface CloudStatus {
  signedIn: boolean; handle: string | null; signingIn: boolean;
  enabled: boolean; linked: boolean; state: "off" | "linking" | "online" | "offline" | "error"; message?: string;
  hostname: string | null;
  connector: { source: string | null; version: string | null; needsDownload: boolean; downloading: boolean; progress: number | null; connections: number; portBlocked: boolean };
}

async function call(action: string, body?: object): Promise<CloudStatus> {
  const answer = await fetch(`/api/desktop/phones/cloud${action ? `/${action}` : ""}`, { cache: "no-store", ...(body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}) });
  const json = (await answer.json()) as CloudStatus & { error?: { message: string } };
  if (!answer.ok) throw new Error(json.error?.message ?? t("That didn't work."));
  return json;
}

const STATE: Record<CloudStatus["state"], { tone?: "ok" | "bad"; text: string }> = {
  off: { text: "Off" },
  linking: { text: "Connecting…" },
  online: { tone: "ok", text: "On" },
  offline: { tone: "bad", text: "Not connected" },
  error: { tone: "bad", text: "Not working" },
};

export function ReachAnywhere() {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = useCallback(() => call("").then(setStatus, () => {}), []);
  useEffect(() => { void read(); }, [read]);
  // While something is under way (signing in, connecting, downloading), check every two seconds.
  const moving = !!status && (status.signingIn || status.state === "linking" || status.connector.downloading);
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void read(), 2000);
    return () => clearInterval(timer);
  }, [moving, read]);

  const act = (action: string, body: object = {}) => {
    setProblem(null);
    setBusy(true);
    call(action, body).then(setStatus, (e: unknown) => setProblem(e instanceof Error ? e.message : String(e))).finally(() => setBusy(false));
  };
  if (!status) return null;
  const state = STATE[status.state];
  const needsConnector = status.connector.needsDownload && !status.connector.downloading;

  return (
    <Card className="cn-list cn-wide" aria-label={t("Reach from anywhere")}>
      <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        {t("Reach from anywhere")}
        {status.enabled ? <span className="cn-pill" data-tone={state.tone}>{t(state.text)}</span> : null}
        <span style={{ marginLeft: "auto" }}>
          <Switch
            label={t("Reach from anywhere")}
            checked={status.enabled}
            disabled={busy || status.signingIn || !status.signedIn || needsConnector}
            onChange={(on) => act("enabled", { on })}
          />
        </span>
      </h3>
      <p className="cn-note">{t("Your phone reaches this computer away from home, through Cloudflare.")}</p>
      {!status.signedIn ? (
        <div className="tc-actions">
          <Button variant="primary" disabled={busy || status.signingIn} onClick={() => act("signin")}>{status.signingIn ? t("Waiting for the browser…") : t("Sign in with coroslink.com")}</Button>
        </div>
      ) : (
        <span className="cn-note">
          {t("Signed in as {handle}", { handle: status.handle ?? "" })} · <button type="button" className="tc-remove" disabled={busy} onClick={() => act("signout")}>{t("Sign out")}</button>
        </span>
      )}
      {status.signedIn && needsConnector ? (
        <div className="tc-actions">
          <Button disabled={busy} onClick={() => act("download")}>{t("Get Cloudflare's connector")}</Button>
        </div>
      ) : null}
      {status.connector.downloading ? <span className="cn-note">{t("Downloading… {n}%", { n: Math.round((status.connector.progress ?? 0) * 100) })}</span> : null}
      {status.enabled && status.connector.portBlocked ? <p role="alert" className="cn-problem">{t("This network blocks Cloudflare's tunnel. Try another network.")}</p> : null}
      {status.enabled && status.message && status.state !== "online" ? <p role="alert" className="cn-problem">{status.message}</p> : null}
      {problem ? <p role="alert" className="cn-problem">{problem}</p> : null}
    </Card>
  );
}
