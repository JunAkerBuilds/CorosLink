import type { ChatProvider, ChatSettings } from "./types";
import {
  DEFAULT_LOCAL_CHAT_BASE_URL,
  normalizeLocalChatBaseUrl
} from "./localChatProvider";

export const CHAT_SETTINGS_KEYS = {
  provider: "chat.provider",
  localBaseUrl: "chat.local.baseUrl",
  localModel: "chat.local.model",
  localApiKey: "chat.local.apiKey",
  localToolsEnabled: "chat.local.toolsEnabled"
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
    local: {
      baseUrl:
        store.get(CHAT_SETTINGS_KEYS.localBaseUrl) ?? DEFAULT_LOCAL_CHAT_BASE_URL,
      model: store.get(CHAT_SETTINGS_KEYS.localModel) ?? "",
      hasApiKey: apiKeyStore.hasApiKey(),
      toolsEnabled: store.get(CHAT_SETTINGS_KEYS.localToolsEnabled) !== "false"
    }
  };
}

export function saveChatSettingsToStore(
  store: ChatSettingsStore,
  apiKeyStore: ChatApiKeyStore,
  settings: ChatSettings
): ChatSettings {
  store.set(CHAT_SETTINGS_KEYS.provider, normalizeProvider(settings.provider));
  store.set(
    CHAT_SETTINGS_KEYS.localBaseUrl,
    normalizeLocalChatBaseUrl(settings.local.baseUrl)
  );
  store.set(CHAT_SETTINGS_KEYS.localModel, settings.local.model.trim());
  store.set(
    CHAT_SETTINGS_KEYS.localToolsEnabled,
    settings.local.toolsEnabled ? "true" : "false"
  );

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
  return value === "local" ? "local" : "chatgpt";
}
