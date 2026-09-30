export type AIProviderId =
  | "deepseek"
  | "openai"
  | "kimi"
  | "doubao"
  | "custom";

export type AIModelOption = {
  id: string;
  label: string;
};

export type AIProviderPreset = {
  id: AIProviderId;
  label: string;
  baseUrl: string;
  model: string;
  models: AIModelOption[];
  apiKeyUrl: string;
  docsUrl: string;
};

export const CUSTOM_MODEL_OPTION_VALUE = "__custom_model__";

/**
 * Curated text/chat models supported by this product's OpenAI-compatible
 * request path. Keep a custom entry in the UI because account entitlements,
 * dated model IDs and inference endpoint IDs can differ by provider.
 */
export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    models: [
      {
        id: "deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
      },
      {
        id: "deepseek-v4-pro",
        label: "DeepSeek V4 Pro",
      },
    ],
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    docsUrl: "https://api-docs.deepseek.com/quick_start/pricing-details-cny/",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.6-terra",
    models: [
      {
        id: "gpt-5.6-terra",
        label: "GPT-5.6 Terra",
      },
      {
        id: "gpt-5.6-luna",
        label: "GPT-5.6 Luna",
      },
      {
        id: "gpt-5.6-sol",
        label: "GPT-5.6 Sol",
      },
      {
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
      },
    ],
    apiKeyUrl: "https://platform.openai.com/api-keys",
    docsUrl: "https://developers.openai.com/api/docs/models",
  },
  {
    id: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    models: [
      { id: "kimi-k3", label: "Kimi K3" },
      { id: "kimi-k2.6", label: "Kimi K2.6" },
      {
        id: "kimi-k2.7-code",
        label: "Kimi K2.7 Code",
      },
      {
        id: "kimi-k2.7-code-highspeed",
        label: "Kimi K2.7 Code Highspeed",
      },
    ],
    apiKeyUrl: "https://platform.kimi.com/console/api-keys",
    docsUrl: "https://platform.kimi.com/docs/models",
  },
  {
    id: "doubao",
    label: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-0-lite-260215",
    models: [
      {
        id: "doubao-seed-2-0-lite-260215",
        label: "Doubao Seed 2.0 Lite",
      },
      {
        id: "doubao-seed-2-0-pro-260215",
        label: "Doubao Seed 2.0 Pro",
      },
    ],
    apiKeyUrl: "https://console.volcengine.com/ark/apiKey",
    docsUrl: "https://www.volcengine.com/docs/82379/?lang=zh",
  },
  {
    id: "custom",
    label: "自定义",
    baseUrl: "",
    model: "",
    models: [],
    apiKeyUrl: "",
    docsUrl: "",
  },
];

export const AI_PROVIDER_PRESET_MAP = Object.fromEntries(
  AI_PROVIDER_PRESETS.map((preset) => [preset.id, preset]),
) as Record<AIProviderId, AIProviderPreset>;

export function isCatalogModel(providerId: AIProviderId, model: string) {
  return AI_PROVIDER_PRESET_MAP[providerId].models.some(
    (option) => option.id === model,
  );
}
