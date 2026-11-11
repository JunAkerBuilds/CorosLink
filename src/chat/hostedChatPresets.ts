// One-click hosted OpenAI-compatible APIs for the "Local / OpenAI-compatible
// API" Coach provider (issue #157). Each preset only fills the server URL and a
// default model; the athlete pastes their own key for that provider. Every
// base URL serves GET /models, which the connection test relies on.

export interface HostedChatPreset {
  id: string;
  /** Brand name, shown as is. */
  name: string;
  /** Optional region qualifier, translated where it is shown. */
  region?: "International" | "China";
  baseUrl: string;
  defaultModel: string;
  keysUrl: string;
}

export const HOSTED_CHAT_PRESETS: HostedChatPreset[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-v4-flash",
    keysUrl: "https://platform.deepseek.com/api_keys"
  },
  {
    id: "qwen-intl",
    name: "Qwen",
    region: "International",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    keysUrl: "https://modelstudio.console.alibabacloud.com/"
  },
  {
    id: "qwen-cn",
    name: "Qwen",
    region: "China",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    defaultModel: "qwen-plus",
    keysUrl: "https://bailian.console.aliyun.com/"
  },
  {
    id: "mimo",
    name: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    defaultModel: "mimo-v2.5-pro",
    keysUrl: "https://platform.xiaomimimo.com/"
  }
];

function comparableUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

export function findHostedChatPreset(
  baseUrl: string
): HostedChatPreset | undefined {
  const target = comparableUrl(baseUrl);
  if (!target) return undefined;
  return HOSTED_CHAT_PRESETS.find(
    (preset) => comparableUrl(preset.baseUrl) === target
  );
}
