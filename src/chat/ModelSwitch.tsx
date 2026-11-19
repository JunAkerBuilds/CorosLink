import { t, useLanguage } from "../i18n/tools";
import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ChevronDown, Gauge, Gem, Network, Orbit, RotateCcw, Sparkles, SquareTerminal, Terminal } from "lucide-react";
import type { ChatProvider } from "../../electron/types";
import {
  getChatModelOptions,
  resolveChatEffort,
  type ChatModelOption
} from "../../electron/chatModels";
import type { CorosLinkApi } from "../coroslink-api";
import { SelectDropdown, type SelectOption } from "../components/SelectDropdown";

// Last live list per provider, so a remounted picker opens on real versions.
const liveModelOptions = new Map<ChatProvider, ChatModelOption[]>();

const LIVE_CATALOG_PROVIDERS = new Set<ChatProvider>([
  "claude-code",
  "gemini-cli",
  "antigravity",
  "opencode",
  "chatgpt"
]);

/**
 * The provider's live model catalog (Claude Code's, Gemini CLI's,
 * Antigravity's, OpenCode's or the ChatGPT account's), starting from the last known or
 * static list while it loads. `ready` going true (a sign-in finishing) reloads it.
 */
export function useChatModelOptions(
  api: CorosLinkApi | undefined,
  provider: ChatProvider,
  ready = true
): ChatModelOption[] {
  const initial = () =>
    liveModelOptions.get(provider) ?? getChatModelOptions(provider);
  const [options, setOptions] = useState(initial);
  useEffect(() => {
    setOptions(initial());
    if (!api || !ready || !LIVE_CATALOG_PROVIDERS.has(provider)) {
      return;
    }
    let active = true;
    api
      .listChatModels(provider)
      .then((listed) => {
        if (!listed.length) return;
        liveModelOptions.set(provider, listed);
        if (active) setOptions(listed);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, provider, ready]);
  return options;
}

/** "Account default · Opus 5.5"; model names stay literal, only "Auto"-style rows translate. */
export function formatChatModelLabel(option: ChatModelOption): string {
  const label = option.value ? option.label : t(option.label);
  return option.detail ? `${label} · ${option.detail}` : label;
}

function renderChatGptIcon() {
  return <Sparkles size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderClaudeIcon() {
  return <Terminal size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderGeminiIcon() {
  return <Gem size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderAntigravityIcon() {
  return <Orbit size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderOpencodeIcon() {
  return <SquareTerminal size={14} strokeWidth={2.1} aria-hidden="true" />;
}

function renderOpenRouterIcon() {
  return <Network size={14} strokeWidth={2.1} aria-hidden="true" />;
}

export function ModelSwitch({
  api,
  provider,
  model,
  disabled,
  onChange
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  model: string;
  disabled?: boolean;
  onChange: (model: string) => void;
}) {
  useLanguage();
  const modelOptions = useChatModelOptions(api, provider);
  if (provider === "local") {
    return null;
  }

  const baseOptions: SelectOption<string>[] = modelOptions.map((option) => ({
    value: option.value,
    label: formatChatModelLabel(option),
    translate: false
  }));
  const options: SelectOption<string>[] = baseOptions.some(
    (option) => option.value === model
  )
    ? baseOptions
    : [...baseOptions, { value: model, label: model, translate: false }];
  const providerLabel =
    provider === "claude-code"
      ? "Claude"
      : provider === "gemini-cli"
        ? "Gemini"
        : provider === "antigravity"
          ? "Antigravity"
          : provider === "opencode"
            ? "OpenCode"
            : provider === "openrouter"
              ? "OpenRouter"
              : "ChatGPT";
  const tone =
    provider === "claude-code"
      ? "claude"
      : provider === "gemini-cli" || provider === "antigravity"
        ? "gemini"
        : provider === "opencode"
          ? "opencode"
          : provider === "openrouter"
            ? "openrouter"
            : "gpt";
  const renderIcon =
    provider === "claude-code"
      ? renderClaudeIcon
      : provider === "gemini-cli"
        ? renderGeminiIcon
        : provider === "antigravity"
          ? renderAntigravityIcon
        : provider === "opencode"
          ? renderOpencodeIcon
        : provider === "openrouter"
          ? renderOpenRouterIcon
          : renderChatGptIcon;
  const selectedLabel =
    options.find((option) => option.value === model)?.label ?? model;

  return (
    <SelectDropdown translateLabel={t}
      className={`app-select--pill chat-model-select chat-select--${tone}`}
      menuClassName={`chat-select-menu chat-select-menu--${tone}`}
      value={model}
      options={options}
      onChange={onChange}
      renderIcon={renderIcon}
      label={t("{{p0}} model", { p0: providerLabel })}
      title={t("{{p0}} model: {{p1}}", { p0: providerLabel, p1: selectedLabel })}
      disabled={disabled}
      portal
      // OpenCode lists every model of every connected provider, by "provider/Model name".
      {...(provider === "opencode" ? { menuMinWidth: 320, menuMaxHeight: 360 } : {})}
    />
  );
}

const EFFORT_LABELS: Record<string, string> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
  ultra: "Ultra"
};

/** "xhigh" → "Extra high"; a level this build does not know keeps its own name. */
export function formatChatEffortLabel(effort: string): string {
  const known = EFFORT_LABELS[effort];
  return known ? t(known, undefined, "effort") : `${effort[0].toUpperCase()}${effort.slice(1)}`;
}

/**
 * How hard the selected model thinks before it answers: a pill that opens a
 * stepped slider. Shown only for a model that offers effort levels; a saved
 * level the model lacks reads as Default.
 */
export function EffortSwitch({
  api,
  provider,
  model,
  effort,
  disabled,
  onChange
}: {
  api: CorosLinkApi | undefined;
  provider: ChatProvider;
  model: string;
  effort: string;
  disabled?: boolean;
  onChange: (effort: string) => void;
}) {
  useLanguage();
  const modelOptions = useChatModelOptions(api, provider);
  const selected = modelOptions.find((option) => option.value === model);
  const levels = selected?.efforts ?? [];
  const saved = resolveChatEffort(selected, effort) ?? "";
  const [open, setOpen] = useState(false);
  // The level under the thumb; saved a moment after the drag settles.
  const [draft, setDraft] = useState<string | null>(null);
  // Where the thumb is mid-drag, in level units; null once it has snapped to a level.
  const [dragAt, setDragAt] = useState<number | null>(null);
  // The pill's centre when the popover opened: its label resizes as the level changes.
  const [anchor, setAnchor] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const commitTimer = useRef<number | null>(null);
  const popId = useId();

  const commit = (next: string, delay: number) => {
    setDraft(next);
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      onChangeRef.current(next);
    }, delay);
  };
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (commitTimer.current === null) setDraft(null);
  }, [saved]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!levels.length || !selected) {
    return null;
  }

  const value = draft ?? saved;
  const isDefault = !value;
  const defaultLabel = t("Default", undefined, "effort");
  const valueLabel = isDefault ? defaultLabel : formatChatEffortLabel(value);
  // On Default the thumb rests where the model's own level is, when it says.
  const restingIndex = selected.defaultEffort
    ? Math.max(0, levels.indexOf(selected.defaultEffort))
    : Math.floor((levels.length - 1) / 2);
  const index = isDefault ? restingIndex : levels.indexOf(value);
  const steps = Math.max(1, levels.length - 1);
  const tone = provider === "claude-code" ? "claude" : "gpt";

  return (
    <div
      className={`app-select app-select--pill chat-model-select chat-effort-select chat-select--${tone}`}
      ref={rootRef}
    >
      <button
        type="button"
        className="app-select-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={popId}
        disabled={disabled && !open}
        title={t("Effort: {{p0}}", { p0: valueLabel })}
        onClick={(event) => {
          setAnchor(event.currentTarget.offsetWidth / 2);
          setOpen((current) => !current);
        }}
      >
        <span className="app-select-value">
          <span className="app-select-leading-icon" aria-hidden="true">
            <Gauge size={14} strokeWidth={2.1} />
          </span>
          <span className="sr-only">{t("Effort")}</span>
          <span className="app-select-value-label">{valueLabel}</span>
        </span>
        <ChevronDown
          className={open ? "app-select-icon is-open" : "app-select-icon"}
          size={17}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <div
          className="chat-effort-pop"
          id={popId}
          role="dialog"
          aria-label={t("Effort")}
          style={{ left: anchor }}
        >
          <div className="chat-effort-pop-head">
            <span aria-hidden="true" />
            <div className="chat-effort-pop-title">
              <strong data-default={isDefault || undefined}>{valueLabel}</strong>
              <span>
                {isDefault && selected.defaultEffort
                  ? `${formatChatEffortLabel(selected.defaultEffort)} · ${formatChatModelLabel(selected)}`
                  : formatChatModelLabel(selected)}
              </span>
            </div>
            <button
              type="button"
              className="chat-effort-pop-reset"
              title={t("Reset to default")}
              aria-label={t("Reset to default")}
              disabled={isDefault}
              onClick={() => commit("", 0)}
            >
              <RotateCcw size={14} strokeWidth={2.1} aria-hidden="true" />
            </button>
          </div>
          <div
            className="chat-effort-slider"
            data-default={isDefault || undefined}
            data-dragging={dragAt !== null || undefined}
            style={{ "--effort-at": (dragAt ?? index) / steps } as CSSProperties}
          >
            <span className="chat-effort-slider-fill" aria-hidden="true" />
            {levels.map((level, at) => (
              <span
                key={level}
                className="chat-effort-slider-dot"
                data-covered={!isDefault && at <= (dragAt ?? index) ? true : undefined}
                style={{ "--dot-at": at / steps } as CSSProperties}
                aria-hidden="true"
              />
            ))}
            <span className="chat-effort-slider-thumb" aria-hidden="true" />
            {/* The range glides between levels while held and settles on the nearest one. */}
            <input
              type="range"
              min={0}
              max={levels.length - 1}
              step="any"
              value={dragAt ?? index}
              autoFocus
              aria-label={t("Effort")}
              aria-valuetext={valueLabel}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragAt(dragAt ?? index);
              }}
              onChange={(event) => {
                const at = Number(event.target.value);
                setDragAt(at);
                setDraft(levels[Math.round(at)] ?? "");
              }}
              onPointerUp={(event) => {
                setDragAt(null);
                commit(levels[Math.round(Number(event.currentTarget.value))] ?? "", 0);
              }}
              onPointerCancel={() => setDragAt(null)}
              onKeyDown={(event) => {
                const to =
                  event.key === "ArrowRight" || event.key === "ArrowUp"
                    ? index + 1
                    : event.key === "ArrowLeft" || event.key === "ArrowDown"
                      ? index - 1
                      : event.key === "Home"
                        ? 0
                        : event.key === "End"
                          ? levels.length - 1
                          : null;
                if (to === null) return;
                event.preventDefault();
                // From Default the first press picks the level the thumb rests on.
                const next = isDefault && to !== 0 && to !== levels.length - 1 ? index : to;
                commit(levels[Math.min(levels.length - 1, Math.max(0, next))], 260);
              }}
            />
          </div>
          <div className="chat-effort-pop-ends" aria-hidden="true">
            <span>{formatChatEffortLabel(levels[0])}</span>
            <span>{formatChatEffortLabel(levels[levels.length - 1])}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
