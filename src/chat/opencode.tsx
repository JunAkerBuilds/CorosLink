import { t, useLanguage } from "../i18n/tools";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CircleCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  SquareTerminal,
  Terminal
} from "lucide-react";
import type { ChatSettings, OpencodeStatus } from "../../electron/types";
import type { CorosLinkApi } from "../coroslink-api";
import { formatChatModelLabel, useChatModelOptions } from "./ModelSwitch";
import { ChatSettingsSectionHeader, chatSettingsSectionDomId } from "./chatSettingsSections";
import "./opencode.css";

// OpenCode for Coach: the athlete's own install, with whichever model
// providers they connected in it. These are its controls in Coach settings
// and on the setup screen shown while it isn't ready.

type OpencodeAction = "checking" | "testing";

export interface OpencodeControls {
  status: OpencodeStatus | null;
  action: OpencodeAction | null;
  /** Re-reads the status without a spinner or clearing an error on screen. */
  reload(): void;
  /** "Check": starts OpenCode to see which models it offers now. */
  refresh(): void;
  test(): void;
  openGuide(topic: "install" | "providers"): void;
  setModel(model: string): void;
  setExecutablePath(executablePath: string): void;
}

/** A check that answers at once still shows its spinner, so the click is seen. */
const MIN_CHECK_MS = 600;

/** Whether Coach can use OpenCode: installed, and it has a model to offer. */
export function opencodeReady(status: OpencodeStatus | null): boolean {
  return Boolean(status?.installed && status.authenticated);
}

export function useOpencode({
  api,
  chatSettings,
  onUpdateChatSettings,
  onError
}: {
  api: CorosLinkApi | undefined;
  chatSettings: ChatSettings;
  onUpdateChatSettings: (patch: Partial<ChatSettings>) => Promise<boolean>;
  onError: (message: string | null) => void;
}): OpencodeControls {
  const [status, setStatus] = useState<OpencodeStatus | null>(null);
  const [action, setAction] = useState<OpencodeAction | null>(null);
  const busyRef = useRef(false);

  const run = useCallback(
    async (
      kind: OpencodeAction,
      call: () => Promise<OpencodeStatus | { ok: boolean; status: OpencodeStatus; message: string }>,
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

  const reload = useCallback(() => {
    void api?.getOpencodeStatus().then(setStatus).catch(() => undefined);
  }, [api]);

  return {
    status,
    action,
    reload,
    refresh: () => void run("checking", () => api!.recheckOpencode(), t("Could not check OpenCode.")),
    test: () => void run("testing", () => api!.testOpencodeConnection(), t("OpenCode connection test failed.")),
    openGuide: (topic) => void api?.openOpencodeSetupGuide(topic),
    setModel: (model) =>
      void onUpdateChatSettings({
        opencode: { ...chatSettings.opencode, model: model.trim() || undefined }
      }),
    setExecutablePath: (executablePath) => {
      setStatus(null);
      void onUpdateChatSettings({
        opencode: { ...chatSettings.opencode, executablePath: executablePath.trim() || undefined }
      }).then(reload);
    }
  };
}

export function opencodeStatusLabel(status: OpencodeStatus | null): string {
  if (!status) return t("Not checked");
  switch (status.state) {
    case "not-installed":
      return t("Not installed");
    case "sign-in-required":
      return status.modelCount === 0 ? t("Installed, no provider connected") : t("Installed, sign-in required");
    case "connected":
      return t("Connected");
    case "usage-limit-reached":
      return t("Usage limit reached");
    default:
      return t("Connection failed");
  }
}

/** A status message, with the commands it quotes in backticks set as code. */
function StatusMessage({ text }: { text: string }) {
  return (
    <>
      {text.split("`").map((part, index) =>
        index % 2 === 1 ? (
          <code className="chat-opencode-command" key={index}>
            {part}
          </code>
        ) : (
          part
        )
      )}
    </>
  );
}

/** The path is saved when the field is left, so a half-typed one is never looked up. */
function ExecutablePathField({ value, onCommit }: { value: string; onCommit: (path: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft);
  };
  return (
    <label className="chat-local-field">
      <span>{t("OpenCode executable")}</span>
      <div className="chat-claude-path-row">
        <Terminal size={15} aria-hidden="true" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          placeholder={t("Auto-detect OpenCode")}
          spellCheck={false}
        />
      </div>
    </label>
  );
}

export function OpencodeSettingsSection({
  api,
  chatSettings,
  controls,
  busy
}: {
  api: CorosLinkApi | undefined;
  chatSettings: ChatSettings;
  controls: OpencodeControls;
  busy?: boolean;
}) {
  useLanguage();
  const { status, action } = controls;
  const ready = opencodeReady(status);
  const options = useChatModelOptions(api, "opencode", ready);
  const model = chatSettings.opencode?.model ?? "";
  const working = Boolean(action);

  return (
    <section
      className="chat-settings-section chat-claude-section chat-opencode-section"
      id={chatSettingsSectionDomId("opencode")}
      data-settings-section="opencode"
    >
      <ChatSettingsSectionHeader id="opencode" badge="Beta" />
      <p className="chat-settings-copy">
        {t("Uses OpenCode installed on this computer with the model providers you connected in it. CorosLink never reads or stores your OpenCode credentials or API keys.")}
      </p>

      <div className="chat-settings-field-grid">
        <ExecutablePathField
          value={chatSettings.opencode?.executablePath ?? ""}
          onCommit={controls.setExecutablePath}
        />
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

      <div className="chat-claude-status" data-state={status?.state}>
        {action === "checking" ? (
          <Loader2 className="chat-spinner" size={15} aria-hidden="true" />
        ) : status?.state === "connected" ? (
          <CircleCheck size={15} aria-hidden="true" />
        ) : (
          <SquareTerminal size={15} aria-hidden="true" />
        )}
        <div>
          <strong>{opencodeStatusLabel(status)}</strong>
          <span>
            {status ? <StatusMessage text={status.message} /> : t("Check this computer for an installed OpenCode.")}
          </span>
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
        {status?.state === "not-installed" ? (
          <button type="button" className="chat-local-action primary" onClick={() => controls.openGuide("install")}>
            <ExternalLink size={14} aria-hidden="true" />
            {t("Install OpenCode")}
          </button>
        ) : null}
        {ready ? (
          <button type="button" className="chat-local-action primary" onClick={controls.test} disabled={working || busy}>
            {action === "testing" ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <Bot size={14} aria-hidden="true" />
            )}
            {t("Test connection")}
          </button>
        ) : null}
        {status?.installed ? (
          <button type="button" className="chat-local-action" onClick={() => controls.openGuide("providers")}>
            <ExternalLink size={14} aria-hidden="true" />
            {t("Connect a provider")}
          </button>
        ) : null}
      </div>
      <p className="chat-settings-copy">
        {t("OpenCode gets the same Coach tools as ChatGPT; its own file, shell, and web tools stay off. Coaching prompts and the COROS data it requests go to the provider of the model you pick, under your OpenCode sign-in. Drafts stay local until you click an upload or delete button.")}
      </p>
    </section>
  );
}

/** Shown in place of the conversation until OpenCode is installed and has a model to offer. */
export function OpencodeGatePanel({ controls }: { controls: OpencodeControls }) {
  useLanguage();
  const { status, action } = controls;
  const notInstalled = status?.state === "not-installed";
  return (
    <div className="panel chat-login-panel chat-claude-login-panel chat-opencode-login-panel">
      <SquareTerminal size={32} aria-hidden="true" />
      <div className="chat-login-title-row">
        <h2>OpenCode</h2>
        <span className="chat-beta-badge">{t("Beta")}</span>
      </div>
      <p>
        {t("Coach with OpenCode and any model from the providers you connected in it. CorosLink uses the OpenCode installed on this computer and does not read or store its credentials.")}
      </p>
      <div className="chat-login-actions">
        {notInstalled ? (
          <button type="button" className="primary-button" onClick={() => controls.openGuide("install")}>
            <ExternalLink size={16} aria-hidden="true" />
            {t("Install OpenCode")}
          </button>
        ) : null}
        <button
          type="button"
          className={notInstalled ? "secondary-button" : "primary-button"}
          onClick={controls.refresh}
          disabled={Boolean(action)}
        >
          {action === "checking" ? (
            <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
          {t("Check again")}
        </button>
      </div>
      <p className="chat-login-note">
        {status ? <StatusMessage text={status.message} /> : t("Checking for OpenCode…")}
      </p>
      {status?.installed ? (
        <button type="button" className="chat-login-link" onClick={() => controls.openGuide("providers")}>
          <ExternalLink size={13} aria-hidden="true" />
          {t("Connect a provider")}
        </button>
      ) : null}
    </div>
  );
}
