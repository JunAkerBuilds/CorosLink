import type { ChatProvider, ChatSettings } from "./types";
import { MAX_CUSTOM_COACH_INSTRUCTIONS } from "./types";
import {
  DEFAULT_LOCAL_CHAT_BASE_URL,
  normalizeLocalChatBaseUrl
} from "./localChatProvider";
import { DEFAULT_OPENROUTER_MODEL } from "./openRouterProvider";

export const CHAT_SETTINGS_KEYS = {
  provider: "chat.provider",
  chatgptModel: "chat.chatgpt.model",
  openRouterModel: "chat.openRouter.model",
  openRouterApiKey: "chat.openRouter.apiKey",
  claudeExecutablePath: "chat.claudeCode.executablePath",
  claudeModel: "chat.claudeCode.model",
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
  visualizationsEnabled: "chat.visualizations.enabled",
  customInstructions: "chat.customInstructions"
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
  localApiKeyStore: Pick<ChatApiKeyStore, "hasApiKey">,
  openRouterApiKeyStore: Pick<ChatApiKeyStore, "hasApiKey">
): ChatSettings {
  return {
    provider: normalizeProvider(store.get(CHAT_SETTINGS_KEYS.provider)),
    chatgpt: {
      model: store.get(CHAT_SETTINGS_KEYS.chatgptModel) || undefined
    },
    openRouter: {
      model:
        store.get(CHAT_SETTINGS_KEYS.openRouterModel) ??
        DEFAULT_OPENROUTER_MODEL,
      hasApiKey: openRouterApiKeyStore.hasApiKey()
    },
    claudeCode: {
      executablePath:
        store.get(CHAT_SETTINGS_KEYS.claudeExecutablePath) || undefined,
      model: store.get(CHAT_SETTINGS_KEYS.claudeModel) || undefined,
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
      hasApiKey: localApiKeyStore.hasApiKey(),
      toolsEnabled: store.get(CHAT_SETTINGS_KEYS.localToolsEnabled) !== "false"
    },
    sidebarOpen: store.get(CHAT_SETTINGS_KEYS.sidebarOpen) !== "false",
    visualizationsEnabled:
      store.get(CHAT_SETTINGS_KEYS.visualizationsEnabled) === "true",
    customInstructions:
      store.get(CHAT_SETTINGS_KEYS.customInstructions) || undefined
  };
}

export function saveChatSettingsToStore(
  store: ChatSettingsStore,
  localApiKeyStore: ChatApiKeyStore,
  openRouterApiKeyStore: ChatApiKeyStore,
  settings: ChatSettings
): ChatSettings {
  store.set(CHAT_SETTINGS_KEYS.provider, normalizeProvider(settings.provider));
  const chatgptModel = settings.chatgpt?.model?.trim();
  if (chatgptModel) {
    store.set(CHAT_SETTINGS_KEYS.chatgptModel, chatgptModel);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.chatgptModel]);
  }
  const openRouterModel = settings.openRouter?.model?.trim();
  store.set(
    CHAT_SETTINGS_KEYS.openRouterModel,
    openRouterModel || DEFAULT_OPENROUTER_MODEL
  );
  const executablePath = settings.claudeCode?.executablePath?.trim();
  if (executablePath) {
    store.set(CHAT_SETTINGS_KEYS.claudeExecutablePath, executablePath);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeExecutablePath]);
  }
  const claudeModel = settings.claudeCode?.model?.trim();
  if (claudeModel) {
    store.set(CHAT_SETTINGS_KEYS.claudeModel, claudeModel);
  } else {
    store.delete([CHAT_SETTINGS_KEYS.claudeModel]);
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

  if (typeof settings.customInstructions === "string") {
    const customInstructions = settings.customInstructions
      .trim()
      .slice(0, MAX_CUSTOM_COACH_INSTRUCTIONS);
    if (customInstructions) {
      store.set(CHAT_SETTINGS_KEYS.customInstructions, customInstructions);
    } else {
      store.delete([CHAT_SETTINGS_KEYS.customInstructions]);
    }
  }

  if (settings.local.clearApiKey) {
    localApiKeyStore.clearApiKey();
  } else if (
    typeof settings.local.apiKey === "string" &&
    settings.local.apiKey.trim()
  ) {
    localApiKeyStore.saveApiKey(settings.local.apiKey.trim());
  }

  if (settings.openRouter?.clearApiKey) {
    openRouterApiKeyStore.clearApiKey();
  } else if (
    typeof settings.openRouter?.apiKey === "string" &&
    settings.openRouter.apiKey.trim()
  ) {
    openRouterApiKeyStore.saveApiKey(settings.openRouter.apiKey.trim());
  }

  return readChatSettingsFromStore(
    store,
    localApiKeyStore,
    openRouterApiKeyStore
  );
}

function normalizeProvider(value: unknown): ChatProvider {
  if (
    value === "local" ||
    value === "claude-code" ||
    value === "openrouter"
  ) {
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
