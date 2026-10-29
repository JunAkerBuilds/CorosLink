import { t, useLanguage } from "../i18n/tools";
import { formatNumber } from "../i18n/locale";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleCheck,
  Download,
  ExternalLink,
  Loader2,
  LogOut,
  Orbit,
  RefreshCw,
  Trash2,
  X
} from "lucide-react";
import type { AntigravityStatus, ChatSettings } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatChatModelLabel, useChatModelOptions } from "./ModelSwitch";
import { ChatSettingsSectionHeader, chatSettingsSectionDomId } from "./chatSettingsSections";
import "./antigravity.css";

// Google's Antigravity agent for Coach: CorosLink downloads it, the athlete
// signs it in with Google. These are its controls in Coach settings and on
// the setup screen shown while it isn't ready.

type AntigravityAction =
  | "checking"
  | "installing"
  | "connecting"
  | "cancelling"
  | "testing"
  | "signing-out"
  | "removing";

export interface AntigravityControls {
  status: AntigravityStatus | null;
  action: AntigravityAction | null;
  /** Re-reads the status without a spinner or clearing an error on screen. */
  reload(): void;
  /** "Check again": asks Google again when a refusal or failed sign-in is showing. */
  refresh(): void;
  install(): void;
  connect(): void;
  /** Stops a sign-in that waits on Google. */
  cancelSignIn(): void;
  /** Opens Google's page again for the sign-in that waits. */
  reopenSignIn(): void;
  disconnect(): void;
  test(): void;
  remove(): void;
  openGuide(): void;
  setModel(model: string): void;
}

/** Download and sign-in both finish outside the call that starts them. */
const POLL_MS = { installing: 1000, connecting: 2000 } as const;
/** A check that answers at once still shows its spinner, so the click is seen. */
const MIN_CHECK_MS = 600;

export function useAntigravity({
  api,
  chatSettings,
  onUpdateChatSettings,
  onError
}: {
  api: CorosLinkApi | undefined;
  chatSettings: ChatSettings;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => Promise<boolean>;
  onError: (message: string | null) => void;
}): AntigravityControls {
  const [status, setStatus] = useState<AntigravityStatus | null>(null);
  const [action, setAction] = useState<AntigravityAction | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (
      kind: AntigravityAction,
      call: () => Promise<AntigravityStatus | { ok: boolean; status: AntigravityStatus; message: string }>,
      fallback: string
    ) => {
      if (!api || busyRef.current) return;
      busyRef.current = true;
      setAction(kind);
      onError(null);
      try {
        const started = Date.now();
        const result = await call();
        if (kind === "checking") {
          await new Promise((resolve) => setTimeout(resolve, Math.max(0, MIN_CHECK_MS - (Date.now() - started))));
        }
        if ("ok" in result) {
          setStatus(result.status);
          if (!result.ok) onError(result.message);
        } else {
          setStatus(result);
        }
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : fallback);
      } finally {
        busyRef.current = false;
        setAction(null);
      }
    },
    [api, onError]
  );

  const state = status?.state;
  useEffect(() => {
    if (!api || (state !== "installing" && state !== "connecting")) return;
    const timer = setTimeout(() => {
      void api.getAntigravityStatus().then(setStatus).catch(() => undefined);
    }, POLL_MS[state]);
    return () => clearTimeout(timer);
  }, [api, state, status]);

  return {
    status,
    action,
    reload: () => void api?.getAntigravityStatus().then(setStatus).catch(() => undefined),
    refresh: () => void run("checking", () => api!.recheckAntigravity(), t("Could not check Antigravity.")),
    install: () => void run("installing", () => api!.installAntigravity(), t("The Antigravity download failed.")),
    connect: () => void run("connecting", () => api!.connectAntigravity(), t("Google sign-in failed.")),
    cancelSignIn: () =>
      void run("cancelling", () => api!.cancelAntigravitySignIn(), t("Could not cancel the Google sign-in.")),
    reopenSignIn: () => void api?.reopenAntigravitySignIn(),
    disconnect: () => void run("signing-out", () => api!.disconnectAntigravity(), t("Could not sign out of Antigravity.")),
    test: () => void run("testing", () => api!.testAntigravityConnection(), t("Antigravity connection test failed.")),
    remove: () => void run("removing", () => api!.removeAntigravity(), t("Could not remove the Antigravity download.")),
    openGuide: () => void api?.openAntigravityGuide(),
    setModel: (model) =>
      void onUpdateChatSettings({
        antigravity: { ...chatSettings.antigravity, model: model.trim() || undefined }
      })
  };
}

function megabytes(bytes: number): string {
  return t("{{p0}} MB", { p0: formatNumber(Math.round(bytes / 1_000_000)) });
}

export function antigravityStatusLabel(status: AntigravityStatus | null): string {
  if (!status) return t("Not checked");
  switch (status.state) {
    case "unsupported":
      return t("Not available on this computer");
    case "not-installed":
      return t("Not downloaded");
    case "installing": {
      const install = status.install;
      if (!install || install.phase === "extracting") return t("Unpacking");
      const percent = Math.floor((install.receivedBytes / install.totalBytes) * 100);
      return t("Downloading {{p0}}%", { p0: formatNumber(percent) });
    }
    case "sign-in-required":
      return t("Downloaded, sign-in required");
    case "connecting":
      return t("Waiting for Google sign-in");
    case "connected":
      return t("Connected");
    case "usage-limit-reached":
      return t("Usage limit reached");
    default:
      return t("Connection failed");
  }
}

function InstallProgress({ status }: { status: AntigravityStatus | null }) {
  const install = status?.state === "installing" ? status.install : undefined;
  if (!install) return null;
  const value = install.phase === "extracting" ? install.totalBytes : install.receivedBytes;
  return (
    <progress
      className="antigravity-progress"
      max={install.totalBytes}
      value={value}
      aria-label={antigravityStatusLabel(status)}
    />
  );
}

/** While a sign-in waits on Google: open the page again, or give up and start over. */
function WaitingActions({ controls, className }: { controls: AntigravityControls; className: string }) {
  const { status, action } = controls;
  if (status?.state !== "connecting") return null;
  return (
    <>
      {status.signInUrl ? (
        <button type="button" className={className} onClick={controls.reopenSignIn} disabled={Boolean(action)}>
          <ExternalLink size={14} aria-hidden="true" />
          {t("Open Google's page")}
        </button>
      ) : null}
      <button type="button" className={className} onClick={controls.cancelSignIn} disabled={Boolean(action)}>
        {action === "cancelling" ? (
          <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
        ) : (
          <X size={14} aria-hidden="true" />
        )}
        {t("Cancel sign-in")}
      </button>
    </>
  );
}

/** The one next step the athlete takes, as a primary button. */
function PrimaryAction({
  controls,
  busy,
  className
}: {
  controls: AntigravityControls;
  busy?: boolean;
  className: string;
}) {
  const { status, action } = controls;
  const spinner = <Loader2 className="chat-spinner" size={14} aria-hidden="true" />;
  if (status?.state === "not-installed") {
    return (
      <button type="button" className={className} onClick={controls.install} disabled={Boolean(action) || busy}>
        {action === "installing" ? spinner : <Download size={14} aria-hidden="true" />}
        {status.downloadBytes
          ? t("Download Antigravity ({{p0}})", { p0: megabytes(status.downloadBytes) })
          : t("Download Antigravity")}
      </button>
    );
  }
  if (status?.state === "installing") {
    return (
      <button type="button" className={className} disabled>
        {spinner}
        {t("Downloading…")}
      </button>
    );
  }
  if (status?.installed && status.state !== "connected") {
    const waiting = status.state === "connecting" || action === "connecting";
    return (
      <button type="button" className={className} onClick={controls.connect} disabled={waiting || Boolean(action) || busy}>
        {waiting ? spinner : <Orbit size={14} aria-hidden="true" />}
        {t("Sign in with Google")}
      </button>
    );
  }
  return null;
}

export function AntigravitySettingsSection({
  api,
  chatSettings,
  controls,
  busy
}: {
  api: CorosLinkApi | undefined;
  chatSettings: ChatSettings;
  controls: AntigravityControls;
  busy?: boolean;
}) {
  useLanguage();
  const { status, action } = controls;
  const options = useChatModelOptions(api, "antigravity", status?.state === "connected");
  const model = chatSettings.antigravity?.model ?? "";
  const working = Boolean(action) || status?.state === "installing";

  return (
    <section
      className="chat-settings-section chat-claude-section chat-antigravity-section"
      id={chatSettingsSectionDomId("antigravity")}
      data-settings-section="antigravity"
    >
      <ChatSettingsSectionHeader id="antigravity" badge="Beta" />
      <p className="chat-settings-copy">
        {t("Runs Google's official Antigravity agent. CorosLink downloads it from Google, keeps it in its own folder, and signs it in with your Google account separately from the Antigravity app and CLI. CorosLink never sees your Google password.")}
      </p>

      {status?.installed ? (
        <div className="chat-settings-field-grid">
          <label className="chat-local-field">
            <span>{t("Model")}</span>
            <select value={model} onChange={(event) => controls.setModel(event.target.value)} disabled={busy}>
              {options.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatChatModelLabel(option)}
                </option>
              ))}
              {options.some((option) => option.value === model) ? null : <option value={model}>{model}</option>}
            </select>
          </label>
        </div>
      ) : null}

      <div className="chat-claude-status" data-state={status?.state}>
        {action === "checking" || status?.state === "installing" || status?.state === "connecting" ? (
          <Loader2 className="chat-spinner" size={15} aria-hidden="true" />
        ) : status?.state === "connected" ? (
          <CircleCheck size={15} aria-hidden="true" />
        ) : (
          <Orbit size={15} aria-hidden="true" />
        )}
        <div>
          <strong>{antigravityStatusLabel(status)}</strong>
          <span>{status?.message ?? t("Check whether Antigravity is downloaded and signed in.")}</span>
          <InstallProgress status={status} />
        </div>
      </div>

      <div className="chat-local-actions chat-claude-actions">
        <button type="button" className="chat-local-action" onClick={controls.refresh} disabled={working || busy}>
          {action === "checking" ? (
            <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
          ) : (
            <RefreshCw size={14} aria-hidden="true" />
          )}
          {t("Check")}
        </button>
        <PrimaryAction controls={controls} busy={busy} className="chat-local-action primary" />
        <WaitingActions controls={controls} className="chat-local-action" />
        {status?.state === "connected" ? (
          <>
            <button type="button" className="chat-local-action primary" onClick={controls.test} disabled={working || busy}>
              {action === "testing" ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              {t("Test connection")}
            </button>
            <button type="button" className="chat-local-action" onClick={controls.disconnect} disabled={working || busy}>
              <LogOut size={14} aria-hidden="true" />
              {t("Sign out")}
            </button>
          </>
        ) : null}
        {status?.installed && status.state !== "connecting" ? (
          <button type="button" className="chat-local-action" onClick={controls.remove} disabled={working || busy}>
            <Trash2 size={14} aria-hidden="true" />
            {t("Remove download")}
          </button>
        ) : null}
        <button type="button" className="chat-local-action" onClick={controls.openGuide}>
          <ExternalLink size={14} aria-hidden="true" />
          {t("Plans")}
        </button>
      </div>
      <p className="chat-settings-copy">
        {t("Antigravity gets the same Coach tools as ChatGPT; its own file, terminal, and web tools stay off. Coaching prompts and the COROS data it requests go to Google under your Antigravity sign-in. Drafts stay local until you click an upload or delete button.")}
      </p>
    </section>
  );
}

/** Shown in place of the conversation until Antigravity is downloaded and signed in. */
export function AntigravityGatePanel({ controls }: { controls: AntigravityControls }) {
  useLanguage();
  const { status, action } = controls;
  return (
    <div className="panel chat-login-panel chat-claude-login-panel chat-antigravity-login-panel">
      <Orbit size={32} aria-hidden="true" />
      <div className="chat-login-title-row">
        <h2>Google Antigravity</h2>
        <span className="chat-beta-badge">{t("Beta")}</span>
      </div>
      <p>
        {t("Coach with Google's Antigravity agent and your Google account. CorosLink downloads it from Google once and signs it in through your browser; it never sees your Google password.")}
      </p>
      <div className="chat-login-actions">
        {status?.state === "unsupported" ? null : (
          <PrimaryAction controls={controls} className="primary-button" />
        )}
        <WaitingActions controls={controls} className="secondary-button" />
        <button
          type="button"
          className="secondary-button"
          onClick={controls.refresh}
          disabled={Boolean(action) || status?.state === "installing"}
        >
          {action === "checking" ? (
            <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {t("Check again")}
        </button>
      </div>
      <InstallProgress status={status} />
      <p className="chat-login-note">
        {!status
          ? t("Checking Antigravity…")
          : status.state === "installing"
            ? antigravityStatusLabel(status)
            : status.message}
      </p>
      <button type="button" className="chat-login-link" onClick={controls.openGuide}>
        <ExternalLink size={13} aria-hidden="true" />
        {t("Which Google plans include Antigravity")}
      </button>
    </div>
  );
}
