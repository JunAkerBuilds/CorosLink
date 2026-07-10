import type { ChatProvider, ChatSettings } from "./types";
import {
  DEFAULT_LOCAL_CHAT_BASE_URL,
  normalizeLocalChatBaseUrl
} from "./localChatProvider";

export const CHAT_SETTINGS_KEYS = {
  provider: "chat.provider",
  claudeExecutablePath: "chat.claudeCode.executablePath",
  claudeLastConnectionStatus: "chat.claudeCode.lastConnectionStatus",
  claudeLastCheckedAt: "chat.claudeCode.lastCheckedAt",
  claudeRecentActivities: "chat.claudeCode.permissions.recentActivities",
  claudeTrainingMetrics: "chat.claudeCode.permissions.trainingMetrics",
  claudeUpcomingWorkouts: "chat.claudeCode.permissions.upcomingWorkouts",
  claudeSleepData: "chat.claudeCode.permissions.sleepData",
  claudeFullActivityFiles: "chat.claudeCode.permissions.fullActivityFiles",
  localBaseUrl: "chat.local.baseUrl",
  localModel: "chat.local.model",
  localApiKey: "chat.local.apiKey",
  localToolsEnabled: "chat.local.toolsEnabled",
  sidebarOpen: "chat.sidebar.open",
  visualizationsEnabled: "chat.visualizations.enabled"
} as const;

export interface ChatSettingsStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(keys: string[]): void;
}

export interface ChatApiKeyStore {
  hasApiKey(): boolean;
  saveApiKey(apiKey: string): void;
  clearApiKey(): void;
}

export function readChatSettingsFromStore(
  store: ChatSettingsStore,
  apiKeyStore: Pick<ChatApiKeyStore, "hasApiKey">
): ChatSettings {
  return {
    provider: normalizeProvider(store.get(CHAT_SETTINGS_KEYS.provider)),
    claudeCode: {
      executablePath:
        store.get(CHAT_SETTINGS_KEYS.claudeExecutablePath) || undefined,
      lastConnectionStatus: normalizeClaudeConnectionStatus(
        store.get(CHAT_SETTINGS_KEYS.claudeLastConnectionStatus)
      ),
      lastCheckedAt:
        store.get(CHAT_SETTINGS_KEYS.claudeLastCheckedAt) || undefined,
      permissions: {
        recentActivities:
          store.get(CHAT_SETTINGS_KEYS.claudeRecentActivities) !== "false",
        trainingMetrics:
          store.get(CHAT_SETTINGS_KEYS.claudeTrainingMetrics) !== "false",
        upcomingWorkouts:
          store.get(CHAT_SETTINGS_KEYS.claudeUpcomingWorkouts) !== "false",
        sleepData:
          store.get(CHAT_SETTINGS_KEYS.claudeSleepData) === "true",
        fullActivityFiles:
          store.get(CHAT_SETTINGS_KEYS.claudeFullActivityFiles) === "true"
      }
    },
    local: {
      baseUrl:
        store.get(CHAT_SETTINGS_KEYS.localBaseUrl) ?? DEFAULT_LOCAL_CHAT_BASE_URL,
      model: store.get(CHAT_SETTINGS_KEYS.localModel) ?? "",
      hasApiKey: apiKeyStore.hasApiKey(),
      toolsEnabled: store.get(CHAT_SETTINGS_KEYS.localToolsEnabled) !== "false"
    },
    sidebarOpen: store.get(CHAT_SETTINGS_KEYS.sidebarOpen) !== "false",
    visualizationsEnabled:
      store.get(CHAT_SETTINGS_KEYS.visualizationsEnabled) === "true"
  };
}

export function saveChatSettingsToStore(
  store: ChatSettingsStore,
  apiKeyStore: ChatApiKeyStore,
  settings: ChatSettings
): ChatSettings {
  store.set(CHAT_SETTINGS_KEYS.provider, normalizeProvider(settings.provider));
  const executablePath = settings.claudeCode?.executablePath?.trim();
  if (executablePath) {
    store.set(CHAT_SETTINGS_KEYS.claudeExecutablePath, executablePath);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeExecutablePath]);
  }
  if (settings.claudeCode?.lastConnectionStatus) {
    store.set(
      CHAT_SETTINGS_KEYS.claudeLastConnectionStatus,
      settings.claudeCode.lastConnectionStatus
    );
  }
  if (settings.claudeCode?.lastCheckedAt) {
    store.set(
      CHAT_SETTINGS_KEYS.claudeLastCheckedAt,
      settings.claudeCode.lastCheckedAt
    );
  }
  const claudePermissions = settings.claudeCode?.permissions;
  store.set(
    CHAT_SETTINGS_KEYS.claudeRecentActivities,
    claudePermissions?.recentActivities === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeTrainingMetrics,
    claudePermissions?.trainingMetrics === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeUpcomingWorkouts,
    claudePermissions?.upcomingWorkouts === false ? "false" : "true"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeSleepData,
    claudePermissions?.sleepData === true ? "true" : "false"
  );
  store.set(
    CHAT_SETTINGS_KEYS.claudeFullActivityFiles,
    claudePermissions?.fullActivityFiles === true ? "true" : "false"
  );
  store.set(
    CHAT_SETTINGS_KEYS.localBaseUrl,
    normalizeLocalChatBaseUrl(settings.local.baseUrl)
  );
  store.set(CHAT_SETTINGS_KEYS.localModel, settings.local.model.trim());
  store.set(
    CHAT_SETTINGS_KEYS.localToolsEnabled,
    settings.local.toolsEnabled ? "true" : "false"
  );
  if (typeof settings.sidebarOpen === "boolean") {
    store.set(
      CHAT_SETTINGS_KEYS.sidebarOpen,
      settings.sidebarOpen ? "true" : "false"
    );
  }
  if (typeof settings.visualizationsEnabled === "boolean") {
    store.set(
      CHAT_SETTINGS_KEYS.visualizationsEnabled,
      settings.visualizationsEnabled ? "true" : "false"
    );
  }

  if (settings.local.clearApiKey) {
    apiKeyStore.clearApiKey();
  } else if (
    typeof settings.local.apiKey === "string" &&
    settings.local.apiKey.trim()
  ) {
    apiKeyStore.saveApiKey(settings.local.apiKey.trim());
  }

  return readChatSettingsFromStore(store, apiKeyStore);
}

function normalizeProvider(value: unknown): ChatProvider {
  if (value === "local" || value === "claude-code") {
    return value;
  }
  return "chatgpt";
}

function normalizeClaudeConnectionStatus(
  value: unknown
): ChatSettings["claudeCode"]["lastConnectionStatus"] {
  return value === "not-installed" ||
    value === "sign-in-required" ||
    value === "connecting" ||
    value === "connected" ||
    value === "connection-failed" ||
    value === "usage-limit-reached"
    ? value
    : undefined;
}
