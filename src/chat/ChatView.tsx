import { useEffect, useRef, useState } from "react";
import {
  Database,
  FileText,
  Loader2,
  LogOut,
  MessageCircle,
  Send,
  Sparkles,
  Square,
  User
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { CorosLinkApi } from "../coroslink-api";
import type {
  ChatAuthStatus,
  ChatMessage,
  CorosMcpStatus
} from "../../electron/types";

function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-markdown">
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
}

/** Where an assistant answer's data came from, for the source indicator. */
interface SourceInfo {
  snapshotIncluded: boolean;
  mcpEnabled: boolean;
  mcpUsed: boolean;
  mcpTools: string[];
  mcpError?: string;
}

interface ChatEntry {
  role: ChatMessage["role"];
  content: string;
  source?: SourceInfo;
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

export function ChatView({ api, onError }: ChatViewProps) {
  const [authStatus, setAuthStatus] = useState<ChatAuthStatus | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [currentSource, setCurrentSource] = useState<SourceInfo | null>(null);
  const [mcpStatus, setMcpStatus] = useState<CorosMcpStatus | null>(null);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [showTools, setShowTools] = useState(false);

  // Ref so the push-event handlers filter on the current request without
  // being recreated (and re-subscribed) on every keystroke.
  const activeRequestIdRef = useRef<string | null>(null);
  // Accumulates source info across the current stream's info events.
  const sourceRef = useRef<SourceInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load sign-in state on mount.
  useEffect(() => {
    let cancelled = false;
    if (!api) {
      setCheckingAuth(false);
      return;
    }
    void api
      .getChatAuthStatus()
      .then((status) => {
        if (!cancelled) setAuthStatus(status);
      })
      .catch(() => {
        if (!cancelled) setAuthStatus({ signedIn: false });
      })
      .finally(() => {
        if (!cancelled) setCheckingAuth(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api]);

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
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: finalText, source }
        ]);
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
        } else {
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
        }
        setCurrentSource(sourceRef.current);
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
  }, [api, onError]);

  // Keep the transcript scrolled to the newest content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, streamingText]);

  const handleSignIn = async () => {
    if (!api) return;
    setSigningIn(true);
    onError(null);
    try {
      const status = await api.loginChat();
      setAuthStatus(status);
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
    setMessages([]);
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
    if (!api || !trimmed || streaming) return;
    const nextEntries: ChatEntry[] = [...messages, { role: "user", content: trimmed }];
    const requestId = crypto.randomUUID();

    activeRequestIdRef.current = requestId;
    sourceRef.current = null;
    setCurrentSource(null);
    setMessages(nextEntries);
    setInput("");
    setStreaming(true);
    setStreamingText("");
    onError(null);

    // Send only the wire fields (role/content); source is renderer-only.
    const wireMessages: ChatMessage[] = nextEntries.map(({ role, content }) => ({
      role,
      content
    }));
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

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  if (checkingAuth) {
    return (
      <div className="chat-view chat-view-centered">
        <Loader2 className="chat-spinner" size={22} aria-hidden="true" />
      </div>
    );
  }

  if (!authStatus?.signedIn) {
    return (
      <div className="chat-view chat-view-centered">
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
          {authStatus.email ? (
            <span className="chat-account">{authStatus.email}</span>
          ) : null}
          <button
            type="button"
            className="chat-signout"
            onClick={() => void handleSignOut()}
          >
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </div>
      </div>

      <div className="chat-transcript" ref={scrollRef}>
        <div className="chat-thread">
          {messages.length === 0 && !streaming ? (
            <div className="chat-empty">
              <div className="chat-empty-icon">
                <Sparkles size={28} aria-hidden="true" />
              </div>
              <h3>How can I help with your training?</h3>
              <div className="chat-suggestions">
                {[
                  "How was my last run?",
                  "What should I train tomorrow?",
                  "Am I recovered enough for a hard session?"
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

          {messages.map((message, index) => (
            <div key={index} className={`chat-row chat-row-${message.role}`}>
              <div className={`chat-avatar chat-avatar-${message.role}`}>
                {message.role === "assistant" ? (
                  <Sparkles size={16} aria-hidden="true" />
                ) : (
                  <User size={16} aria-hidden="true" />
                )}
              </div>
              <div className="chat-bubble">
                {message.role === "assistant" ? (
                  <>
                    <AssistantMarkdown content={message.content} />
                    {message.source ? <SourceBadge source={message.source} /> : null}
                  </>
                ) : (
                  message.content
                )}
              </div>
            </div>
          ))}

          {streaming ? (
            <div className="chat-row chat-row-assistant">
              <div className="chat-avatar chat-avatar-assistant">
                <Sparkles size={16} aria-hidden="true" />
              </div>
              <div className="chat-bubble">
                {streamingText ? (
                  <AssistantMarkdown content={streamingText} />
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
              disabled={!input.trim()}
              title="Send"
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
