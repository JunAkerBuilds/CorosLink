import { useEffect, useRef, useState } from "react";
import {
  Database,
  ExternalLink,
  FileDown,
  FileText,
  Loader2,
  LogOut,
  MessageCircle,
  RefreshCw,
  Send,
  Settings2,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Upload,
  User
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  ChatAuthStatus,
  ChatProvider,
  ChatSessionSummary,
  ChatSettings,
  ClaudeCodeStatus,
  LocalChatConnectionTest,
  LocalChatDiscovery,
  CorosMcpStatus,
  PlanDraftPreview,
  TrainingHubExportResult,
  UploadPlanResult,
  WorkoutDeletePreview,
  DeleteWorkoutResult
} from "../../electron/types";
import { ActivityVisualCard } from "./ActivityVisualCard";
import { FitnessTrendCard } from "./FitnessTrendCard";
import { HrZoneCard } from "./HrZoneCard";
import { ChatSettingsModal } from "./ChatSettingsModal";
import { CorosMcpToolsPanel } from "./CorosMcpToolsPanel";
import { ChatSidebar } from "./ChatSidebar";
import { ProviderSwitch } from "./ProviderSwitch";
import {
  fromPersistedEntries,
  toPersistedEntries,
  toWireMessages,
  upsertActivityVisualEntry,
  upsertFitnessTrendEntry,
  upsertHrZoneEntry,
  upsertPlanDraftEntry,
  upsertWorkoutDeleteEntry,
  isChatVisualEntry,
  type ChatEntry,
  type SourceInfo
} from "./chatTypes";

const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  provider: "chatgpt",
  claudeCode: {
    permissions: {
      recentActivities: true,
      trainingMetrics: true,
      upcomingWorkouts: true,
      sleepData: false,
      fullActivityFiles: false
    }
  },
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "",
    hasApiKey: false,
    toolsEnabled: true
  },
  sidebarOpen: true,
  visualizationsEnabled: false
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
  /** Text preloaded into the composer (e.g. "Ask Coach" from the calendar). */
  pendingPrompt?: string | null;
  onPendingPromptConsumed?: () => void;
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
  const uploadedResult =
    uploaded ??
    (draft.uploadResult
      ? {
          planName: draft.name,
          workoutsCreated: draft.uploadResult.workoutsCreated,
          workoutsScheduled: draft.uploadResult.workoutsScheduled,
          entries: []
        }
      : undefined);
  const isUploaded = Boolean(uploadedResult || draft.uploadedAt);

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
              <th>Steps</th>
            </tr>
          </thead>
          <tbody>
            {draft.entries.map((entry) => (
              <tr key={entry.key}>
                <td>{entry.scheduleDate ?? "Library"}</td>
                <td>{entry.name}</td>
                <td>{entry.volume ?? "—"}</td>
                <td>{entry.workoutType}</td>
                <td>{entry.stepsSummary ?? "—"}</td>
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
      {uploadedResult || isUploaded ? (
        <p className="chat-plan-success">
          Uploaded —{" "}
          {uploadedResult?.workoutsScheduled ??
            draft.uploadResult?.workoutsScheduled ??
            0}{" "}
          scheduled,{" "}
          {uploadedResult?.workoutsCreated ??
            draft.uploadResult?.workoutsCreated ??
            0}{" "}
          saved to library.
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
  onActivityChange,
  pendingPrompt,
  onPendingPromptConsumed
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
  const [claudeStatus, setClaudeStatus] = useState<ClaudeCodeStatus | null>(null);
  const [checkingClaude, setCheckingClaude] = useState(false);
  const [connectingClaude, setConnectingClaude] = useState(false);
  const [testingClaude, setTestingClaude] = useState(false);
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const activeSessionIdRef = useRef<string | null>(null);
  // Accumulates source info across the current stream's info events.
  const sourceRef = useRef<SourceInfo | null>(null);
  const autoDetectLocalRef = useRef(false);
  const claudePollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const mcpRef = useRef<HTMLDivElement>(null);
  const persistTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!pendingPrompt) {
      return;
    }
    setInput(pendingPrompt);
    onPendingPromptConsumed?.();
    // Focus after the coach panel becomes visible.
    requestAnimationFrame(() => inputRef.current?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPrompt]);

  const resetEphemeralChatState = () => {
    setUploadedPlans({});
    setDeletedWorkouts({});
  };

  const persistHistory = (
    sessionId: string | null,
    entries: ChatEntry[],
    immediate = false
  ) => {
    if (!api || !sessionId) return;
    const run = () => {
      void api
        .saveChatSession(sessionId, toPersistedEntries(entries))
        .then((summary) => {
          if (!summary) return;
          setSessions((current) => {
            const index = current.findIndex((session) => session.id === summary.id);
            if (index < 0) {
              return [summary, ...current];
            }
            const next = [...current];
            next[index] = summary;
            next.sort(
              (left, right) =>
                new Date(right.updatedAt).getTime() -
                new Date(left.updatedAt).getTime()
            );
            return next;
          });
        })
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

  const loadSession = async (sessionId: string) => {
    if (!api) return;
    try {
      const entries = await api.getChatSession(sessionId);
      setTimeline(fromPersistedEntries(entries));
      resetEphemeralChatState();
      setActiveSessionId(sessionId);
    } catch {
      setTimeline([]);
      resetEphemeralChatState();
    }
  };

  const refreshSessions = async (provider: ChatProvider) => {
    if (!api) return [];
    const listed = await api.listChatSessions(provider);
    setSessions(listed);
    return listed;
  };

  const ensureActiveSession = async (provider: ChatProvider) => {
    if (!api) return null;
    const listed = await refreshSessions(provider);
    if (listed.length > 0) {
      await loadSession(listed[0].id);
      return listed[0].id;
    }
    const created = await api.createChatSession(provider);
    setSessions([created]);
    setActiveSessionId(created.id);
    setTimeline([]);
    resetEphemeralChatState();
    return created.id;
  };

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  // Load sign-in/provider state on mount.
  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setCheckingAuth(false);
      return;
    }
    void Promise.allSettled([
      api.getChatAuthStatus(),
      api.getChatSettings(),
      api.getClaudeCodeStatus()
    ])
      .then(async ([authResult, settingsResult, claudeResult]) => {
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
        if (claudeResult.status === "fulfilled") {
          setClaudeStatus(claudeResult.value);
        }
        await ensureActiveSession(settings.provider);
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
      if (claudePollTimerRef.current) {
        clearTimeout(claudePollTimerRef.current);
        claudePollTimerRef.current = null;
      }
    };
  }, [api]);

  useEffect(() => {
    if (!api || checkingAuth || streaming || !activeSessionId) return;
    persistHistory(activeSessionId, timeline);
  }, [api, checkingAuth, streaming, timeline, activeSessionId]);

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

  useEffect(() => {
    if (!showTools || settingsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!mcpRef.current?.contains(event.target as Node)) {
        setShowTools(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowTools(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showTools, settingsOpen]);

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
          const next: ChatEntry[] = [...prev];
          if (source?.mcpError) {
            next.push({ kind: "toolNotice", message: source.mcpError });
          }
          next.push({
            kind: "message",
            role: "assistant",
            content: finalText,
            source
          });
          persistHistory(activeSessionIdRef.current, next, true);
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
        } else if (payload.kind === "activityVisual") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertActivityVisualEntry(prev, payload.preview));
          }
        } else if (payload.kind === "fitnessTrend") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertFitnessTrendEntry(prev, payload.preview));
          }
        } else if (payload.kind === "hrZoneSummary") {
          if (chatSettings.visualizationsEnabled) {
            setTimeline((prev) => upsertHrZoneEntry(prev, payload.preview));
          }
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
        if (chatSettings.provider === "claude-code") {
          void api
            .getClaudeCodeStatus()
            .then(setClaudeStatus)
            .catch(() => undefined);
        }
      })
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [api, chatSettings.provider, chatSettings.visualizationsEnabled, onError]);

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
        await ensureActiveSession("chatgpt");
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

  const refreshClaudeCodeStatus = async () => {
    if (!api || checkingClaude) return null;
    setCheckingClaude(true);
    onError(null);
    try {
      const status = await api.getClaudeCodeStatus();
      setClaudeStatus(status);
      return status;
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Claude Code detection failed."
      );
      return null;
    } finally {
      setCheckingClaude(false);
    }
  };

  const pollClaudeCodeStatus = (attempt = 0) => {
    if (!api || attempt >= 40) return;
    if (claudePollTimerRef.current) {
      clearTimeout(claudePollTimerRef.current);
    }
    claudePollTimerRef.current = setTimeout(() => {
      void api
        .getClaudeCodeStatus()
        .then((status) => {
          setClaudeStatus(status);
          if (status.state === "connecting" || status.state === "sign-in-required") {
            pollClaudeCodeStatus(attempt + 1);
          }
        })
        .catch(() => pollClaudeCodeStatus(attempt + 1));
    }, 1500);
  };

  const handleConnectClaudeCode = async () => {
    if (!api || connectingClaude) return;
    setConnectingClaude(true);
    onError(null);
    try {
      const status = await api.connectClaudeCode();
      setClaudeStatus(status);
      if (status.state === "connecting" || status.state === "sign-in-required") {
        pollClaudeCodeStatus();
      }
    } catch (caught) {
      onError(
        caught instanceof Error ? caught.message : "Claude sign-in failed."
      );
    } finally {
      setConnectingClaude(false);
    }
  };

  const handleTestClaudeCode = async () => {
    if (!api || testingClaude) return;
    setTestingClaude(true);
    onError(null);
    try {
      const result = await api.testClaudeCodeConnection();
      setClaudeStatus(result.status);
      if (!result.ok) onError(result.message);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Claude connection test failed."
      );
    } finally {
      setTestingClaude(false);
    }
  };

  const handleUpdateClaudeCode = async (
    patch: Partial<ChatSettings["claudeCode"]>
  ) => {
    const nextClaudeCode = {
      ...chatSettings.claudeCode,
      ...patch,
      permissions: {
        ...chatSettings.claudeCode.permissions,
        ...(patch.permissions ?? {})
      }
    };
    const nextSettings = { ...chatSettings, claudeCode: nextClaudeCode };
    setChatSettings(nextSettings);
    setClaudeStatus(null);
    if (!api) return;
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch (caught) {
      onError(
        caught instanceof Error
          ? caught.message
          : "Could not save Claude settings."
      );
    }
  };

  const handleNewChat = async () => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      const created = await api.createChatSession(chatSettings.provider);
      setSessions((current) => [created, ...current]);
      setActiveSessionId(created.id);
      setTimeline([]);
      resetEphemeralChatState();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not start a new chat.");
    }
  };

  const handleSelectSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity || sessionId === activeSessionId) {
      return;
    }
    onError(null);
    await loadSession(sessionId);
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!api || streaming || exportingLatestActivity) return;
    onError(null);
    try {
      await api.deleteChatSession(sessionId);
      const listed = await refreshSessions(chatSettings.provider);
      if (sessionId === activeSessionId) {
        if (listed.length > 0) {
          await loadSession(listed[0].id);
        } else {
          const created = await api.createChatSession(chatSettings.provider);
          setSessions([created]);
          setActiveSessionId(created.id);
          setTimeline([]);
          resetEphemeralChatState();
        }
      }
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "Could not delete chat.");
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
      await ensureActiveSession(provider);
      if (provider === "claude-code") {
        const status = await api.getClaudeCodeStatus();
        setClaudeStatus(status);
      }
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

  const handleUpdateChatSettings = async (patch: Partial<ChatSettings>) => {
    const nextSettings = { ...chatSettings, ...patch };
    setChatSettings(nextSettings);
    if (!api) return;
    try {
      const saved = await api.saveChatSettings(nextSettings);
      setChatSettings(saved);
    } catch {
      // keep local state even if persistence fails
    }
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
    persistHistory(activeSessionIdRef.current, nextEntries, true);
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
      setTimeline((prev) => {
        const next = prev.map((entry) =>
          entry.kind === "planDraft" && entry.draft.draftId === draftId
            ? {
                kind: "planDraft" as const,
                draft: {
                  ...entry.draft,
                  uploadedAt: Date.now(),
                  uploadResult: {
                    workoutsScheduled: result.workoutsScheduled,
                    workoutsCreated: result.workoutsCreated
                  }
                }
              }
            : entry
        );
        persistHistory(activeSessionIdRef.current, next, true);
        return next;
      });
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
    persistHistory(activeSessionIdRef.current, nextEntries, true);
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
        persistHistory(activeSessionIdRef.current, next, true);
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
        persistHistory(activeSessionIdRef.current, next, true);
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
  const isClaudeProvider = chatSettings.provider === "claude-code";
  const isChatGptProvider = chatSettings.provider === "chatgpt";
  const localModelConfigured = chatSettings.local.model.trim().length > 0;
  const isBusy = streaming || exportingLatestActivity;
  const showLoginGate = isChatGptProvider && !authStatus?.signedIn;
  const showClaudeGate =
    isClaudeProvider && claudeStatus?.state !== "connected";

  const providerSwitch = (
    <ProviderSwitch
      provider={chatSettings.provider}
      disabled={savingSettings || isBusy}
      onChange={(provider) => void handleProviderChange(provider)}
    />
  );

  const sidebarProps = {
    open: true,
    overlay: false,
    sessions,
    activeSessionId,
    busy: isBusy,
    onClose: () => {},
    onNewChat: () => void handleNewChat(),
    onSelectSession: (sessionId: string) => void handleSelectSession(sessionId),
    onDeleteSession: (sessionId: string) => void handleDeleteSession(sessionId)
  };

  const settingsModalProps = {
    open: settingsOpen,
    chatSettings,
    authStatus,
    claudeStatus,
    localApiKey,
    localConnection,
    localDiscovery,
    savingSettings,
    testingLocal,
    detectingLocal,
    signingIn,
    checkingClaude,
    connectingClaude,
    testingClaude,
    mcpStatus,
    mcpBusy,
    showTools,
    busy: isBusy,
    onClose: () => setSettingsOpen(false),
    onSignIn: () => void handleSignIn(),
    onSignOut: () => void handleSignOut(),
    onRefreshClaude: () => void refreshClaudeCodeStatus(),
    onConnectClaude: () => void handleConnectClaudeCode(),
    onTestClaude: () => void handleTestClaudeCode(),
    onOpenClaudeSetupGuide: () => void api?.openClaudeCodeSetupGuide(),
    onUpdateClaudeCode: (patch: Partial<ChatSettings["claudeCode"]>) =>
      void handleUpdateClaudeCode(patch),
    onLocalApiKeyChange: setLocalApiKey,
    onUpdateLocalDraft: updateLocalDraft,
    onDetectLocalServers: () => void handleDetectLocalServers(),
    onTestLocalConnection: () => void handleTestLocalConnection(),
    onSaveLocalSettings: () => void handleSaveLocalSettings(),
    onClearLocalApiKey: () => void handleClearLocalApiKey(),
    onConnectMcp: () => void handleConnectMcp(),
    onDisconnectMcp: () => void handleDisconnectMcp(),
    onToggleTools: () => setShowTools((value) => !value),
    onUpdateChatSettings: (patch: Partial<ChatSettings>) =>
      void handleUpdateChatSettings(patch)
  };

  if (checkingAuth) {
    return (
      <div className="chat-view chat-view-centered">
        <Loader2 className="chat-spinner" size={22} aria-hidden="true" />
      </div>
    );
  }

  if (showClaudeGate) {
    const notInstalled = claudeStatus?.state === "not-installed";
    return (
      <div className="chat-view chat-view-login">
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel chat-claude-login-panel">
              <Terminal size={32} aria-hidden="true" />
              <div className="chat-login-title-row">
                <h2>Claude Code</h2>
                <span className="chat-beta-badge">Beta</span>
              </div>
              <p>
                Use the Claude Code CLI installed on this computer with your
                existing Claude subscription. CorosLink does not read or store
                your Claude credentials.
              </p>
              <div className="chat-login-actions">
                {notInstalled ? (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void api?.openClaudeCodeSetupGuide()}
                  >
                    <ExternalLink size={16} aria-hidden="true" />
                    Install Claude Code
                  </button>
                ) : (
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => void handleConnectClaudeCode()}
                    disabled={connectingClaude || !api}
                  >
                    {connectingClaude ? (
                      <Loader2
                        className="chat-spinner"
                        size={16}
                        aria-hidden="true"
                      />
                    ) : (
                      <Terminal size={16} aria-hidden="true" />
                    )}
                    Sign in with Claude
                  </button>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void refreshClaudeCodeStatus()}
                  disabled={checkingClaude || !api}
                >
                  {checkingClaude ? (
                    <Loader2
                      className="chat-spinner"
                      size={16}
                      aria-hidden="true"
                    />
                  ) : (
                    <RefreshCw size={16} aria-hidden="true" />
                  )}
                  Check again
                </button>
              </div>
              <p className="chat-login-note">
                {claudeStatus?.message ?? "Checking for Claude Code…"}
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerSwitch}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      </div>
    );
  }

  if (showLoginGate) {
    return (
      <div
        className={["chat-view", "chat-view-login"]
          .filter(Boolean)
          .join(" ")}
      >
        <div className="chat-header">
          <div className="chat-header-title">
            <span>Training Coach</span>
          </div>
          <div className="chat-header-end">
            <button
              type="button"
              className="chat-settings-button"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open settings"
            >
              <Settings2 size={16} aria-hidden="true" />
              Settings
            </button>
          </div>
        </div>
        <div className="chat-layout">
          <ChatSidebar {...sidebarProps} />
          <div className="chat-main chat-main-login">
            <div className="panel chat-login-panel">
              <MessageCircle size={32} aria-hidden="true" />
              <h2>Your training coach</h2>
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
                Or switch to Local model below to chat without signing in.
              </p>
            </div>
            <div className="chat-composer-toolbar chat-composer-toolbar-login">
              {providerSwitch}
            </div>
          </div>
        </div>
        <ChatSettingsModal {...settingsModalProps} />
      </div>
    );
  }

  return (
    <div className="chat-view">
      <div className="chat-header">
        <div className="chat-header-title">
          <span>Training Coach</span>
        </div>
        <div className="chat-header-end">
          <button
            type="button"
            className="chat-settings-button"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
          >
            <Settings2 size={16} aria-hidden="true" />
            Settings
          </button>
          <div className="chat-mcp" ref={mcpRef}>
            {mcpStatus?.connected ? (
              <>
                <button
                  type="button"
                  className="chat-mcp-pill connected"
                  onClick={() => setShowTools((open) => !open)}
                  title="COROS data connected via MCP"
                  aria-expanded={showTools}
                  aria-haspopup="dialog"
                >
                  <Database size={13} aria-hidden="true" />
                  COROS · {mcpStatus.tools.length} tools
                </button>
                {showTools ? (
                  <CorosMcpToolsPanel
                    tools={mcpStatus.tools}
                    onDisconnect={() => void handleDisconnectMcp()}
                  />
                ) : null}
              </>
            ) : (
              <button
                type="button"
                className="chat-mcp-pill"
                onClick={() => {
                  setSettingsOpen(true);
                  void handleConnectMcp();
                }}
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
          </div>
          {isChatGptProvider && authStatus?.email ? (
            <span className="chat-account">{authStatus.email}</span>
          ) : null}
          {isChatGptProvider ? (
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

      <div className="chat-layout">
        <ChatSidebar {...sidebarProps} />
        <div className="chat-main">
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
                  "Break down my latest run by lap",
                  "Schedule an easy 8K for Saturday",
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
            if (!chatSettings.visualizationsEnabled && isChatVisualEntry(entry)) {
              return null;
            }

            if (entry.kind === "toolNotice") {
              return (
                <div
                  key={`tool-notice-${index}`}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-tool-notice">
                    {entry.message}
                  </div>
                </div>
              );
            }

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

            if (entry.kind === "activityVisual") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <ActivityVisualCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "fitnessTrend") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <FitnessTrendCard preview={entry.preview} />
                  </div>
                </div>
              );
            }

            if (entry.kind === "hrZoneSummary") {
              return (
                <div
                  key={entry.preview.previewId}
                  className="chat-row chat-row-assistant"
                >
                  <div className="chat-avatar chat-avatar-assistant">
                    <Sparkles size={16} aria-hidden="true" />
                  </div>
                  <div className="chat-bubble chat-bubble-plan">
                    <HrZoneCard preview={entry.preview} />
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
            <div className="chat-composer-toolbar">{providerSwitch}</div>
            <div className="chat-composer-inner">
              <textarea
                ref={inputRef}
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
      </div>
      <ChatSettingsModal {...settingsModalProps} />
    </div>
  );
}
