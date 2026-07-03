import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Database,
  FileDown,
  FileText,
  KeyRound,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Square,
  Trash2,
  Upload,
  User
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  ChatAuthStatus,
  ChatMessage,
  ChatProvider,
  ChatSettings,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  PersistedChatEntry,
  CorosMcpStatus,
  PlanDraftPreview,
  TrainingHubExportResult,
  UploadPlanResult,
  WorkoutDeletePreview,
  DeleteWorkoutResult
} from "../../electron/types";

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "chatgpt",
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  }
};

function AssistantMarkdown({
  content,
  streaming = false
}: {
  content: string;
  streaming?: boolean;
}) {
  return (
    <div className={`chat-markdown${streaming ? " chat-markdown-streaming" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Render links in the user's browser, not inside the app window.
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          )
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface ChatViewProps {
  api: CorosLinkApi | undefined;
  onError: (message: string | null) => void;
  onPlanUploaded?: () => void;
  /** Fires when a coach request is in progress (streaming or exporting). */
  onActivityChange?: (active: boolean) => void;
}

/** Where an assistant answer's data came from, for the source indicator. */
interface SourceInfo {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

interface ChatMessageEntry {
  kind: "message";
  role: ChatMessage["role"];
  content: string;
  source?: SourceInfo;
}

interface ChatPlanDraftEntry {
  kind: "planDraft";
  draft: PlanDraftPreview;
}

interface ChatWorkoutDeleteEntry {
  kind: "workoutDelete";
  preview: WorkoutDeletePreview;
}

type ChatEntry = ChatMessageEntry | ChatPlanDraftEntry | ChatWorkoutDeleteEntry;

function upsertPlanDraftEntry(
  entries: ChatEntry[],
  draft: PlanDraftPreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "planDraft" && entry.draft.draftId === draft.draftId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "planDraft", draft };
    return next;
  }
  return [...entries, { kind: "planDraft", draft }];
}

function upsertWorkoutDeleteEntry(
  entries: ChatEntry[],
  preview: WorkoutDeletePreview
): ChatEntry[] {
  const index = entries.findIndex(
    (entry) =>
      entry.kind === "workoutDelete" &&
      entry.preview.requestId === preview.requestId
  );
  if (index >= 0) {
    const next = [...entries];
    next[index] = { kind: "workoutDelete", preview };
    return next;
  }
  return [...entries, { kind: "workoutDelete", preview }];
}

function toWireMessages(entries: ChatEntry[]): ChatMessage[] {
  return entries
    .filter((entry): entry is ChatMessageEntry => entry.kind === "message")
    .map(({ role, content }) => ({ role, content }));
}

function toPersistedEntries(entries: ChatEntry[]): PersistedChatEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "planDraft") {
      return { kind: "planDraft", draft: entry.draft };
    }
    if (entry.kind === "workoutDelete") {
      return { kind: "workoutDelete", preview: entry.preview };
    }
    return entry.source
      ? {
          kind: "message",
          role: entry.role,
          content: entry.content,
          source: entry.source
        }
      : { kind: "message", role: entry.role, content: entry.content };
  });
}

function fromPersistedEntries(entries: PersistedChatEntry[]): ChatEntry[] {
  return entries.map((entry) => {
    if (entry.kind === "planDraft") {
      return { kind: "planDraft", draft: entry.draft };
    }
    if (entry.kind === "workoutDelete") {
      return { kind: "workoutDelete", preview: entry.preview };
    }
    return entry.source
      ? {
          kind: "message",
          role: entry.role,
          content: entry.content,
          source: entry.source
        }
      : { kind: "message", role: entry.role, content: entry.content };
  });
}

function PlanPreviewCard({
  draft,
  uploading,
  uploaded,
  onUpload
}: {
  draft: PlanDraftPreview;
  uploading: boolean;
  uploaded?: UploadPlanResult;
  onUpload: () => void;
}) {
  return (
    <div className="chat-plan-card">
      <div className="chat-plan-card-header">
        <h4>{draft.name}</h4>
        <span className="chat-plan-card-summary">{draft.summary}</span>
      </div>
      <div className="chat-plan-table-wrap">
        <table className="chat-plan-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Workout</th>
              <th>Volume</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {draft.entries.map((entry) => (
              <tr key={entry.key}>
                <td>{entry.scheduleDate ?? "Library"}</td>
                <td>{entry.name}</td>
                <td>{entry.volume ?? "—"}</td>
                <td>{entry.workoutType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft.conflicts.length > 0 ? (
        <ul className="chat-plan-warnings">
          {draft.conflicts.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {draft.warnings.length > 0 ? (
        <ul className="chat-plan-notes">
          {draft.warnings.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {uploaded ? (
        <p className="chat-plan-success">
          Uploaded — {uploaded.workoutsScheduled} scheduled,{" "}
          {uploaded.workoutsCreated} saved to library.
        </p>
      ) : (
        <div className="chat-plan-actions">
          <button
            type="button"
            className="chat-plan-upload"
            onClick={onUpload}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <Upload size={14} aria-hidden="true" />
            )}
            Upload to COROS
          </button>
        </div>
      )}
    </div>
  );
}

function deleteTargetLabel(target: WorkoutDeletePreview["target"]): string {
  if (target === "scheduled") return "Calendar";
  if (target === "library") return "Library";
  return "Calendar and library";
}

function DeletePreviewCard({
  preview,
  deleting,
  deleted,
  onConfirm
}: {
  preview: WorkoutDeletePreview;
  deleting: boolean;
  deleted?: DeleteWorkoutResult;
  onConfirm: () => void;
}) {
  return (
    <div className="chat-plan-card chat-delete-card">
      <div className="chat-plan-card-header">
        <h4>Delete workout</h4>
        <span className="chat-plan-card-summary">{preview.summary}</span>
      </div>
      <dl className="chat-delete-details">
        <div>
          <dt>Target</dt>
          <dd>{deleteTargetLabel(preview.target)}</dd>
        </div>
        {preview.workoutName ? (
          <div>
            <dt>Workout</dt>
            <dd>{preview.workoutName}</dd>
          </div>
        ) : null}
        {preview.scheduleDate ? (
          <div>
            <dt>Date</dt>
            <dd>{preview.scheduleDate}</dd>
          </div>
        ) : null}
      </dl>
      {deleted ? (
        <p className="chat-plan-success">{deleted.message}</p>
      ) : (
        <div className="chat-plan-actions">
          <button
            type="button"
            className="chat-delete-confirm"
            onClick={onConfirm}
            disabled={deleting}
          >
            {deleting ? (
              <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
            ) : (
              <Trash2 size={14} aria-hidden="true" />
            )}
            Delete from COROS
          </button>
        </div>
      )}
    </div>
  );
}

function SourceBadge({ source }: { source: SourceInfo }) {
  if (source.mcpUsed) {
    const tools = source.mcpTools.filter(Boolean);
    return (
      <div className={`chat-source ${source.mcpError ? "chat-source-error" : "chat-source-mcp"}`}>
        <Database size={12} aria-hidden="true" />
        COROS MCP
        {tools.length > 0 ? ` · ${[...new Set(tools)].join(", ")}` : ""}
        {source.mcpError ? " · failed" : ""}
      </div>
    );
  }
  if (source.snapshotIncluded) {
    return (
      <div className="chat-source chat-source-snapshot">
        <FileText size={12} aria-hidden="true" />
        Training snapshot
        {source.mcpEnabled ? " · MCP not called" : ""}
      </div>
    );
  }
  return (
    <div className="chat-source chat-source-none">
      <FileText size={12} aria-hidden="true" />
      No COROS data
    </div>
  );
}

function ProviderSwitch({
  provider,
  disabled,
  onChange
}: {
  provider: ChatProvider;
  disabled?: boolean;
  onChange: (provider: ChatProvider) => void;
}) {
  return (
    <div className="chat-provider-switch" aria-label="Coach provider">
      {[
        { value: "chatgpt" as const, label: "ChatGPT" },
        { value: "local" as const, label: "Local model" }
      ].map((option) => (
        <button
          key={option.value}
          type="button"
          className={provider === option.value ? "active" : ""}
          onClick={() => onChange(option.value)}
          disabled={disabled || provider === option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function isLatestActivityFileRequest(text: string): boolean {
  const normalized = text.toLowerCase();
  return (
    /\b(download|export|save|get|grab)\b/.test(normalized) &&
    /\b(latest|last|most recent|newest|recent)\b/.test(normalized) &&
    /\b(activity|workout|run|ride)\b/.test(normalized) &&
    /\b(file|fit|original)\b/.test(normalized)
  );
}

function formatLatestActivityExportMessage(
  result: TrainingHubExportResult
): string {
  const formatLabel = result.formatLabel ?? "FIT";
  const activityName = result.activityName ? ` "${result.activityName}"` : "";
  if (!result.saved || !result.filePath) {
    return `No file saved. The latest activity ${formatLabel} export was cancelled.`;
  }
  return `Saved the latest activity ${formatLabel} file${activityName} to:\n\n\`${result.filePath}\``;
}

export function ChatView({
  api,
  onError,
  onPlanUploaded,
  onActivityChange
}: ChatViewProps) {
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [chatSettings, setChatSettings] =
    useState<ChatSettings>(DEFAULT_CHAT_SETTINGS);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [testingLocal, setTestingLocal] = useState(false);
  const [detectingLocal, setDetectingLocal] = useState(false);
  const [localApiKey, setLocalApiKey] = useState("");
  const [localConnection, setLocalConnection] =
    useState<LocalChatConnectionTest | null>(null);
  const [localDiscovery, setLocalDiscovery] =
    useState<LocalChatDiscovery | null>(null);
  const [timeline, setTimeline] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [exportingLatestActivity, setExportingLatestActivity] = useState(false);
  const [currentSource, setCurrentSource] = useState<SourceInfo | null>(null);
  const [mcpStatus, setMcpStatus] = useState<CorosMcpStatus | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);
  const [uploadingDraftId, setUploadingDraftId] = useState<string | null>(null);
  const [uploadedPlans, setUploadedPlans] = useState<
    Record<string, UploadPlanResult>
  >({});
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(
    null
  );
  const [deletedWorkouts, setDeletedWorkouts] = useState<
    Record<string, DeleteWorkoutResult>
  >({});

  // Ref so the push-event handlers filter on the current request without
  // being recreated (and re-subscribed) on every keystroke.
  const activeRequestIdRef = useRef<string | null>(null);
  // Accumulates source info across the current stream's info events.
  const sourceRef = useRef<SourceInfo | null>(null);
  const autoDetectLocalRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resetEphemeralChatState = () => {
    setUploadedPlans({});
    setDeletedWorkouts({});
  };

  const persistHistory = (
    provider: ChatProvider,
    entries: ChatEntry[],
    immediate = false
  ) => {
    if (!api) return;
    const run = () => {
      void api
        .saveChatHistory(provider, toPersistedEntries(entries))
        .catch(() => undefined);
    };
    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
      persistTimeoutRef.current = null;
    }
    if (immediate) {
      run();
      return;
    }
    persistTimeoutRef.current = setTimeout(run, 300);
  };

  const loadHistory = async (provider: ChatProvider) => {
    if (!api) return;
    try {
      const entries = await api.getChatHistory(provider);
      setTimeline(fromPersistedEntries(entries));
      resetEphemeralChatState();
    } catch {
      setTimeline([]);
      resetEphemeralChatState();
    }
  };

  // Load sign-in/provider state on mount.
  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setCheckingAuth(false);
      return;
    }
    void Promise.allSettled([api.getChatAuthStatus(), api.getChatSettings()])
      .then(async ([authResult, settingsResult]) => {
        if (cancelled) return;
        setAuthStatus(
          authResult.status === "fulfilled"
            ? authResult.value
            : { signedIn: false }
        );
        const settings =
          settingsResult.status === "fulfilled"
            ? settingsResult.value
            : DEFAULT_CHAT_SETTINGS;
        setChatSettings(settings);
        await loadHistory(settings.provider);
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
      if (persistTimeoutRef.current) {
        clearTimeout(persistTimeoutRef.current);
        persistTimeoutRef.current = null;
      }
    };
  }, [api]);

  useEffect(() => {
    if (!api || checkingAuth || streaming) return;
    persistHistory(chatSettings.provider, timeline);
  }, [api, checkingAuth, streaming, timeline, chatSettings.provider]);

  useEffect(() => {
    onActivityChange?.(streaming || exportingLatestActivity);
  }, [streaming, exportingLatestActivity, onActivityChange]);

  // Load COROS MCP connection status on mount (and shortly after, to catch the
  // silent startup reconnect completing in the main process).
  useEffect(() => {
    if (!api) return;
    let cancelled = false;
    const load = () =>
      api
        .getCorosMcpStatus()
        .then((status) => {
          if (!cancelled) setMcpStatus(status);
        })
        .catch(() => undefined);
    void load();
    const timer = setTimeout(() => void load(), 2500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api]);

  // Subscribe once to the streaming push channels.
  useEffect(() => {
    if (!api) return;
    const finishStreaming = (finalText: string) => {
      activeRequestIdRef.current = null;
      setStreaming(false);
      setStreamingText("");
      const source = sourceRef.current ?? undefined;
      setCurrentSource(null);
      sourceRef.current = null;
      if (finalText) {
        setTimeline((prev) => {
          const next: ChatEntry[] = [
            ...prev,
            { kind: "message", role: "assistant", content: finalText, source }
          ];
          persistHistory(chatSettings.provider, next, true);
          return next;
        });
      }
    };

    const unsubscribers = [
      api.onChatStreamStart((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        setStreamingText("");
      }),
      api.onChatStreamToken((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        setStreamingText((prev) => prev + payload.delta);
      }),
      api.onChatStreamInfo((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        if (payload.kind === "context") {
          sourceRef.current = {
            snapshotIncluded: payload.snapshotIncluded,
            mcpEnabled: payload.mcpEnabled,
            mcpUsed: false,
            mcpTools: []
          };
          setCurrentSource(sourceRef.current);
        } else if (payload.kind === "planDraft") {
          setTimeline((prev) => upsertPlanDraftEntry(prev, payload.draft));
        } else if (payload.kind === "workoutDelete") {
          setTimeline((prev) =>
            upsertWorkoutDeleteEntry(prev, payload.preview)
          );
        } else if (payload.kind === "mcp") {
          const base: SourceInfo = sourceRef.current ?? {
            snapshotIncluded: false,
            mcpEnabled: true,
            mcpUsed: false,
            mcpTools: []
          };
          sourceRef.current = {
            ...base,
            mcpUsed: true,
            mcpTools: payload.tool
              ? [...base.mcpTools, payload.tool]
              : base.mcpTools,
            mcpError:
              /fail|error/i.test(payload.status) || payload.message
                ? payload.message ?? payload.status
                : base.mcpError
          };
          setCurrentSource(sourceRef.current);
        }
      }),
      api.onChatStreamDone((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        finishStreaming(payload.fullText);
      }),
      api.onChatStreamError((payload) => {
        if (payload.requestId !== activeRequestIdRef.current) return;
        activeRequestIdRef.current = null;
        setStreaming(false);
        setStreamingText("");
        setCurrentSource(null);
        sourceRef.current = null;
        onError(payload.message);
        if (payload.authError) {
          setAuthStatus({ signedIn: false });
        }
      })
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [api, chatSettings.provider, onError]);

  // Keep the transcript scrolled to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, streamingText, exportingLatestActivity]);

  const handleSignIn = async () => {
    if (!api) return;
    setSigningIn(true);
    onError(null);
    try {
      const status = await api.loginChat();
      setAuthStatus(status);
      if (chatSettings.provider === "chatgpt") {
        await loadHistory("chatgpt");
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "ChatGPT sign-in failed.");
    } finally {
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!api) return;
    if (activeRequestIdRef.current) {
      void api.cancelChat(activeRequestIdRef.current);
      activeRequestIdRef.current = null;
      setStreaming(false);
      setStreamingText("");
    }
    const status = await api.logoutChat();
    setAuthStatus(status);
  };

  const handleNewChat = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.clearChatHistory(chatSettings.provider);
      setTimeline([]);
      resetEphemeralChatState();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not start a new chat.");
    }
  };

  const handleProviderChange = async (provider: ChatProvider) => {
    if (!api || provider === chatSettings.provider) return;
    const nextSettings: ChatSettings = { ...chatSettings, provider };
    setChatSettings(nextSettings);
    setLocalConnection(null);
    onError(null);
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
      await loadHistory(provider);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Provider change failed.");
    }
  };

  const updateLocalDraft = (patch: Partial<ChatSettings["local"]>) => {
    setChatSettings((current) => ({
      ...current,
      local: {
        ...current.local,
        ...patch
      }
    }));
    setLocalConnection(null);
  };

  const handleSaveLocalSettings = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const apiKey = localApiKey.trim();
      const saved = await api.saveChatSettings({
        ...chatSettings,
        local: {
          ...chatSettings.local,
          apiKey: apiKey || undefined
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local model settings saved.",
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Local settings failed.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleClearLocalApiKey = async () => {
    if (!api) return;
    setSavingSettings(true);
    onError(null);
    try {
      const saved = await api.saveChatSettings({
        ...chatSettings,
        local: {
          ...chatSettings.local,
          clearApiKey: true
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: "Local API key cleared.",
        normalizedBaseUrl: saved.local.baseUrl
      });
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not clear API key.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDetectLocalServers = async (auto = false) => {
    if (!api || detectingLocal) return;
    setDetectingLocal(true);
    if (!auto) {
      setLocalConnection(null);
      onError(null);
    }
    try {
      const discovery = await api.detectLocalChatServers(
        localApiKey.trim() || undefined
      );
      setLocalDiscovery(discovery);
      const available = discovery.servers.filter(
        (server) => server.ok && server.models.length > 0
      );
      if (available.length === 0) {
        const runningEmpty = discovery.servers.filter((server) => server.ok);
        setLocalConnection({
          ok: false,
          message:
            runningEmpty.length > 0
              ? `${runningEmpty.map((server) => server.label).join(" and ")} ${runningEmpty.length === 1 ? "is" : "are"} running, but no models were found. Pull an Ollama model or load a model in LM Studio, then detect again.`
              : "No Ollama or LM Studio server found on localhost ports 11434 or 1234."
        });
        return;
      }

      const currentBaseUrl = chatSettings.local.baseUrl;
      const currentModel = chatSettings.local.model;
      const preferred =
        available.find(
          (server) =>
            server.baseUrl === currentBaseUrl &&
            server.models.includes(currentModel)
        ) ??
        available.find((server) => server.baseUrl === currentBaseUrl) ??
        available[0];
      const model = preferred.models.includes(currentModel)
        ? currentModel
        : preferred.models[0];
      const nextSettings: ChatSettings = {
        ...chatSettings,
        provider: "local",
        local: {
          ...chatSettings.local,
          baseUrl: preferred.baseUrl,
          model
        }
      };
      const apiKey = localApiKey.trim();
      const saved = await api.saveChatSettings({
        ...nextSettings,
        local: {
          ...nextSettings.local,
          apiKey: apiKey || undefined
        }
      });
      setChatSettings(saved);
      setLocalApiKey("");
      setLocalConnection({
        ok: true,
        message: `Detected ${preferred.label} with ${preferred.models.length} model${preferred.models.length === 1 ? "" : "s"}.`,
        normalizedBaseUrl: preferred.baseUrl,
        models: preferred.models
      });
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Local model detection failed.";
      if (auto) {
        setLocalConnection({ ok: false, message });
      } else {
        onError(message);
      }
    } finally {
      setDetectingLocal(false);
    }
  };

  useEffect(() => {
    if (
      !api ||
      checkingAuth ||
      chatSettings.provider !== "local" ||
      chatSettings.local.model.trim() ||
      autoDetectLocalRef.current
    ) {
      return;
    }
    autoDetectLocalRef.current = true;
    void handleDetectLocalServers(true);
  }, [api, checkingAuth, chatSettings.provider, chatSettings.local.model]);

  const handleTestLocalConnection = async () => {
    if (!api) return;
    setTestingLocal(true);
    setLocalConnection(null);
    onError(null);
    try {
      const result = await api.testLocalChatConnection({
        ...chatSettings.local,
        apiKey: localApiKey.trim() || undefined
      });
      setLocalConnection(result);
      if (result.normalizedBaseUrl) {
        setChatSettings((current) => ({
          ...current,
          local: {
            ...current.local,
            baseUrl: result.normalizedBaseUrl ?? current.local.baseUrl
          }
        }));
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Local connection test failed.");
    } finally {
      setTestingLocal(false);
    }
  };

  const handleConnectMcp = async () => {
    if (!api || mcpBusy) return;
    setMcpBusy(true);
    onError(null);
    try {
      const status = await api.connectCorosMcp();
      setMcpStatus(status);
      // Surface the discovered tools for verification during this milestone.
      console.log("[COROS MCP] tools:", status.tools);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "COROS connection failed.");
    } finally {
      setMcpBusy(false);
    }
  };

  const handleDisconnectMcp = async () => {
    if (!api) return;
    setShowTools(false);
    const status = await api.disconnectCorosMcp();
    setMcpStatus(status);
  };

  const handleSend = async () => {
    const trimmed = input.trim();
    if (!api || !trimmed || streaming || exportingLatestActivity) return;
    if (isLatestActivityFileRequest(trimmed)) {
      await handleLatestActivityFileRequest(trimmed);
      return;
    }
    if (chatSettings.provider === "local" && !chatSettings.local.model.trim()) {
      onError("Enter a local model before starting the coach.");
      return;
    }
    if (chatSettings.provider === "local") {
      try {
        const apiKey = localApiKey.trim();
        const saved = await api.saveChatSettings({
          ...chatSettings,
          local: {
            ...chatSettings.local,
            apiKey: apiKey || undefined
          }
        });
        setChatSettings(saved);
        setLocalApiKey("");
      } catch (caught) {
        onError(caught instanceof Error ? caught.message : "Local settings failed.");
        return;
      }
    }
    const nextEntries: ChatEntry[] = [
      ...timeline,
      { kind: "message", role: "user", content: trimmed }
    ];
    const requestId = crypto.randomUUID();

    activeRequestIdRef.current = requestId;
    sourceRef.current = null;
    setCurrentSource(null);
    setTimeline(nextEntries);
    persistHistory(chatSettings.provider, nextEntries, true);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    onError(null);

    const wireMessages = toWireMessages(nextEntries);
    try {
      await api.sendChat(requestId, wireMessages);
    } catch (caught) {
      activeRequestIdRef.current = null;
      setStreaming(false);
      onError(caught instanceof Error ? caught.message : "Chat request failed.");
    }
  };

  const handleStop = () => {
    if (!api || !activeRequestIdRef.current) return;
    void api.cancelChat(activeRequestIdRef.current);
  };

  const handleUploadPlanDraft = async (draftId: string) => {
    if (!api || uploadingDraftId) return;
    setUploadingDraftId(draftId);
    onError(null);
    try {
      const result = await api.uploadTrainingPlanDraft(draftId);
      setUploadedPlans((prev) => ({ ...prev, [draftId]: result }));
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Failed to upload training plan to COROS."
      );
    } finally {
      setUploadingDraftId(null);
    }
  };

  const handleConfirmWorkoutDelete = async (requestId: string) => {
    if (!api || deletingRequestId) return;
    setDeletingRequestId(requestId);
    onError(null);
    try {
      const result = await api.confirmWorkoutDelete(requestId);
      setDeletedWorkouts((prev) => ({ ...prev, [requestId]: result }));
      onPlanUploaded?.();
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Failed to delete workout from COROS."
      );
    } finally {
      setDeletingRequestId(null);
    }
  };

  const handleLatestActivityFileRequest = async (trimmed: string) => {
    if (!api) return;

    const nextEntries: ChatEntry[] = [
      ...timeline,
      { kind: "message", role: "user", content: trimmed }
    ];
    setTimeline(nextEntries);
    persistHistory(chatSettings.provider, nextEntries, true);
    setInput("");
    setExportingLatestActivity(true);
    onError(null);

    try {
      const result = await api.exportLatestTrainingHubActivityFile(4);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: formatLatestActivityExportMessage(result)
          }
        ];
        persistHistory(chatSettings.provider, next, true);
        return next;
      });
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Latest activity FIT export failed.";
      onError(message);
      setTimeline((prev) => {
        const next: ChatEntry[] = [
          ...prev,
          {
            kind: "message",
            role: "assistant",
            content: `I couldn't download the latest activity FIT file: ${message}`
          }
        ];
        persistHistory(chatSettings.provider, next, true);
        return next;
      });
    } finally {
      setExportingLatestActivity(false);
    }
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const isLocalProvider = chatSettings.provider === "local";
  const localModelConfigured = chatSettings.local.model.trim().length > 0;
  const isBusy = streaming || exportingLatestActivity;
  const availableLocalServers =
    localDiscovery?.servers.filter(
      (server) => server.ok && server.models.length > 0
    ) ?? [];
  const selectedLocalServer =
    availableLocalServers.find(
      (server) => server.baseUrl === chatSettings.local.baseUrl
    ) ?? availableLocalServers[0];
  const discoveredLocalModels = selectedLocalServer?.models ?? [];

  if (checkingAuth) {
    return (
      <div className="chat-view chat-view-centered">
        <Loader2 className="chat-spinner" size={22} aria-hidden="true" />
      </div>
    );
  }

  if (!isLocalProvider && !authStatus?.signedIn) {
    return (
      <div className="chat-view chat-view-centered">
        <div className="panel chat-login-panel">
          <MessageCircle size={32} aria-hidden="true" />
          <h2>Your training coach</h2>
          <ProviderSwitch
            provider={chatSettings.provider}
            disabled={savingSettings || isBusy}
            onChange={(provider) => void handleProviderChange(provider)}
          />
          <p>
            Sign in with your ChatGPT account to chat with a coach that knows your
            COROS activities, recovery, and upcoming workouts.
          </p>
          <button
            type="button"
            className="primary-button"
            onClick={() => void handleSignIn()}
            disabled={signingIn || !api}
          >
            {signingIn ? (
              <Loader2 className="chat-spinner" size={16} aria-hidden="true" />
            ) : null}
            Sign in with ChatGPT
          </button>
          <p className="chat-login-note">
            Uses your existing ChatGPT subscription. Connect COROS Training Hub for
            personalised advice.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-header-title">
          <MessageCircle size={18} aria-hidden="true" />
          <span>Training Coach</span>
        </div>
        <div className="chat-header-end">
          <ProviderSwitch
            provider={chatSettings.provider}
            disabled={savingSettings || isBusy}
            onChange={(provider) => void handleProviderChange(provider)}
          />
          <button
            type="button"
            className="chat-new-chat"
            onClick={() => void handleNewChat()}
            disabled={isBusy || timeline.length === 0}
            title="Start a new conversation"
          >
            <Plus size={14} aria-hidden="true" />
            New chat
          </button>
          {isLocalProvider ? (
            <div
              className={[
                "chat-local-status",
                localConnection?.ok
                  ? "is-ready"
                  : localConnection && !localConnection.ok
                    ? "is-error"
                    : ""
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <Bot size={13} aria-hidden="true" />
              {localConnection?.ok
                ? "Local ready"
                : localConnection
                  ? "Local issue"
                  : "Local model"}
            </div>
          ) : null}
          <div className="chat-mcp">
            {mcpStatus?.connected ? (
              <button
                type="button"
                className="chat-mcp-pill connected"
                onClick={() => setShowTools((value) => !value)}
                title="COROS data connected via MCP"
              >
                <Database size={13} aria-hidden="true" />
                COROS · {mcpStatus.tools.length} tools
              </button>
            ) : (
              <button
                type="button"
                className="chat-mcp-pill"
                onClick={() => void handleConnectMcp()}
                disabled={mcpBusy}
              >
                {mcpBusy ? (
                  <Loader2 className="chat-spinner" size={13} aria-hidden="true" />
                ) : (
                  <Database size={13} aria-hidden="true" />
                )}
                {mcpBusy
                  ? "Connecting…"
                  : mcpStatus?.authorized
                    ? "Reconnect COROS"
                    : "Connect COROS"}
              </button>
            )}
            {showTools && mcpStatus?.connected ? (
              <div className="chat-mcp-panel">
                <div className="chat-mcp-panel-head">
                  <span>{mcpStatus.tools.length} COROS tools</span>
                  <button type="button" onClick={() => void handleDisconnectMcp()}>
                    Disconnect
                  </button>
                </div>
                <ul>
                  {mcpStatus.tools.map((tool) => (
                    <li key={tool.name}>
                      <code>{tool.name}</code>
                      {tool.description ? <span>{tool.description}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          {!isLocalProvider && authStatus?.email ? (
            <span className="chat-account">{authStatus.email}</span>
          ) : null}
          {!isLocalProvider ? (
            <button
              type="button"
              className="chat-signout"
              onClick={() => void handleSignOut()}
            >
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          ) : null}
        </div>
      </div>

      {isLocalProvider ? (
        <div className="chat-local-settings">
          <label className="chat-local-field">
            <span>Server</span>
            {availableLocalServers.length > 0 ? (
              <select
                value={selectedLocalServer?.baseUrl ?? chatSettings.local.baseUrl}
                onChange={(event) => {
                  const server = availableLocalServers.find(
                    (entry) => entry.baseUrl === event.target.value
                  );
                  if (!server) return;
                  updateLocalDraft({
                    baseUrl: server.baseUrl,
                    model: server.models.includes(chatSettings.local.model)
                      ? chatSettings.local.model
                      : server.models[0] ?? ""
                  });
                }}
              >
                {availableLocalServers.map((server) => (
                  <option key={server.baseUrl} value={server.baseUrl}>
                    {server.label} · {server.models.length} model
                    {server.models.length === 1 ? "" : "s"}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={chatSettings.local.baseUrl}
                onChange={(event) =>
                  updateLocalDraft({ baseUrl: event.target.value })
                }
                placeholder="http://localhost:11434/v1"
                spellCheck={false}
              />
            )}
          </label>
          <label className="chat-local-field">
            <span>Model</span>
            {discoveredLocalModels.length > 0 ? (
              <select
                value={
                  discoveredLocalModels.includes(chatSettings.local.model)
                    ? chatSettings.local.model
                    : discoveredLocalModels[0]
                }
                onChange={(event) => updateLocalDraft({ model: event.target.value })}
              >
                {discoveredLocalModels.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={chatSettings.local.model}
                onChange={(event) => updateLocalDraft({ model: event.target.value })}
                placeholder="Detect models or enter a model id"
                spellCheck={false}
              />
            )}
          </label>
          <label className="chat-local-field chat-local-field-key">
            <span>API key</span>
            <div className="chat-local-key-row">
              <KeyRound size={14} aria-hidden="true" />
              <input
                value={localApiKey}
                onChange={(event) => setLocalApiKey(event.target.value)}
                placeholder={
                  chatSettings.local.hasApiKey ? "Saved key" : "Optional"
                }
                type="password"
                spellCheck={false}
              />
              {chatSettings.local.hasApiKey ? (
                <button
                  type="button"
                  onClick={() => void handleClearLocalApiKey()}
                  disabled={savingSettings}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </label>
          <label className="chat-local-tools">
            <input
              type="checkbox"
              checked={chatSettings.local.toolsEnabled}
              onChange={(event) =>
                updateLocalDraft({ toolsEnabled: event.target.checked })
              }
            />
            <span>Use COROS tools when supported</span>
          </label>
          <div className="chat-local-actions">
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void handleDetectLocalServers()}
              disabled={detectingLocal || !api}
            >
              {detectingLocal ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <RefreshCw size={14} aria-hidden="true" />
              )}
              Detect
            </button>
            <button
              type="button"
              className="chat-local-action"
              onClick={() => void handleTestLocalConnection()}
              disabled={testingLocal || !api}
            >
              {testingLocal ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Bot size={14} aria-hidden="true" />
              )}
              Test
            </button>
            <button
              type="button"
              className="chat-local-action primary"
              onClick={() => void handleSaveLocalSettings()}
              disabled={savingSettings || !api}
            >
              {savingSettings ? (
                <Loader2 className="chat-spinner" size={14} aria-hidden="true" />
              ) : (
                <Save size={14} aria-hidden="true" />
              )}
              Save
            </button>
          </div>
          {localConnection ? (
            <p
              className={
                localConnection.ok
                  ? "chat-local-result is-ready"
                  : "chat-local-result is-error"
              }
            >
              {localConnection.message}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="chat-transcript" ref={scrollRef}>
        <div className="chat-thread">
          {timeline.length === 0 && !streaming ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Sparkles size={28} aria-hidden="true" />
              </div>
              <h3>How can I help with your training?</h3>
              <div className="chat-suggestions">
                {[
                  "How was my last run?",
                  "What should I train tomorrow?",
                  "Am I recovered enough for a hard session?",
                  "Download my latest FIT file"
                ].map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    className="chat-suggestion"
                    onClick={() => setInput(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {timeline.map((entry, index) => {
            if (entry.kind === "planDraft") {
              return (
                <div
                  key={entry.draft.draftId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <PlanPreviewCard
                      draft={entry.draft}
                      uploading={uploadingDraftId === entry.draft.draftId}
                      uploaded={uploadedPlans[entry.draft.draftId]}
                      onUpload={() =>
                        void handleUploadPlanDraft(entry.draft.draftId)
                      }
                    />
                  </div>
                </div>
              );
            }

            if (entry.kind === "workoutDelete") {
              return (
                <div
                  key={entry.preview.requestId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <DeletePreviewCard
                      preview={entry.preview}
                      deleting={deletingRequestId === entry.preview.requestId}
                      deleted={deletedWorkouts[entry.preview.requestId]}
                      onConfirm={() =>
                        void handleConfirmWorkoutDelete(entry.preview.requestId)
                      }
                    />
                  </div>
                </div>
              );
            }

            return (
              <div
                key={`message-${index}`}
                className={`chat-row chat-row-${entry.role}`}
              >
                <div className={`chat-avatar chat-avatar-${entry.role}`}>
                  {entry.role === "assistant" ? (
                    <Sparkles size={16} aria-hidden="true" />
                  ) : (
                    <User size={16} aria-hidden="true" />
                  )}
                </div>
                <div className="chat-bubble">
                  {entry.role === "assistant" ? (
                    <>
                      <AssistantMarkdown content={entry.content} />
                      {entry.source ? (
                        <SourceBadge source={entry.source} />
                      ) : null}
                    </>
                  ) : (
                    entry.content
                  )}
                </div>
              </div>
            );
          })}

          {streaming ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble">
                {streamingText ? (
                  <AssistantMarkdown content={streamingText} streaming />
                ) : (
                  <span className="chat-typing">
                    <span />
                    <span />
                    <span />
                  </span>
                )}
                {currentSource ? <SourceBadge source={currentSource} /> : null}
              </div>
            </div>
          ) : null}

          {exportingLatestActivity ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <FileDown size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble">Preparing latest activity FIT export…</div>
            </div>
          ) : null}
        </div>
      </div>

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <textarea
            className="chat-input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="Ask your coach…"
            rows={1}
            disabled={exportingLatestActivity}
          />
          {streaming ? (
            <button
              type="button"
              className="chat-send chat-stop"
              onClick={handleStop}
              title="Stop"
            >
              <Square size={15} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="chat-send"
              onClick={() => void handleSend()}
              disabled={
                !input.trim() ||
                exportingLatestActivity ||
                (isLocalProvider &&
                  !localModelConfigured &&
                  !isLatestActivityFileRequest(input.trim()))
              }
              title={
                isLocalProvider &&
                !localModelConfigured &&
                !isLatestActivityFileRequest(input.trim())
                  ? "Enter a local model first"
                  : "Send"
              }
            >
              <Send size={15} aria-hidden="true" />
            </button>
          )}
        </div>
        <p className="chat-disclaimer">
          Coach can make mistakes. Verify important training decisions.
        </p>
      </div>
    </div>
  );
}
