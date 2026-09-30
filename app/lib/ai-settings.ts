import {
  AI_PROVIDER_PRESETS,
  type AIProviderId,
} from "./ai-model-catalog";

export {
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_PRESET_MAP,
  CUSTOM_MODEL_OPTION_VALUE,
  isCatalogModel,
  type AIModelOption,
  type AIProviderId,
  type AIProviderPreset,
} from "./ai-model-catalog";

export type AIProviderSetting = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type WebSearchSetting = {
  enabled: boolean;
  provider: "tavily";
  apiKey: string;
  maxResults: number;
};

export type AISettings = {
  activeProvider: AIProviderId;
  providers: Record<AIProviderId, AIProviderSetting>;
  rememberKeys: boolean;
  webSearch: WebSearchSetting;
};

export const AI_SETTINGS_STORAGE_KEY = "meeting-list-ai:model-settings:v2";
export const WEB_SEARCH_SETTINGS_STORAGE_KEY =
  "meeting-assistant:web-search-settings:v1";
const AI_SESSION_SETTINGS_STORAGE_KEY =
  "meeting-assistant:ai-settings-session:v1";

const PROVIDER_IDS = new Set(AI_PROVIDER_PRESETS.map((item) => item.id));

export function makeDefaultAISettings(): AISettings {
  return {
    activeProvider: "deepseek",
    providers: Object.fromEntries(
      AI_PROVIDER_PRESETS.map((preset) => [
        preset.id,
        {
          apiKey: "",
          baseUrl: preset.baseUrl,
          model: preset.model,
        },
      ]),
    ) as Record<AIProviderId, AIProviderSetting>,
    rememberKeys: true,
    webSearch: {
      enabled: false,
      provider: "tavily",
      apiKey: "",
      maxResults: 5,
    },
  };
}

function clean(value: unknown, maximum = 2_048) {
  return String(value ?? "").trim().slice(0, maximum);
}

export function loadAISettings(): AISettings {
  const defaults = makeDefaultAISettings();
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (raw) {
      const value = JSON.parse(raw) as {
        activeProvider?: unknown;
        providers?: Record<string, unknown>;
        rememberKeys?: unknown;
      };
      const providerId = clean(value.activeProvider, 32);
      if (PROVIDER_IDS.has(providerId as AIProviderId)) {
        defaults.activeProvider = providerId as AIProviderId;
      }
      for (const preset of AI_PROVIDER_PRESETS) {
        const incoming = value.providers?.[preset.id];
        if (!incoming || typeof incoming !== "object") continue;
        const fields = incoming as Record<string, unknown>;
        defaults.providers[preset.id] = {
          apiKey: clean(fields.apiKey, 2_000),
          baseUrl: clean(fields.baseUrl) || preset.baseUrl,
          model: clean(fields.model, 200) || preset.model,
        };
      }
      defaults.rememberKeys = value.rememberKeys !== false;
    }
  } catch {
    window.localStorage.removeItem(AI_SETTINGS_STORAGE_KEY);
  }

  try {
    const rawSearch = window.localStorage.getItem(
      WEB_SEARCH_SETTINGS_STORAGE_KEY,
    );
    if (rawSearch) {
      const value = JSON.parse(rawSearch) as Record<string, unknown>;
      defaults.webSearch = {
        enabled: value.enabled === true,
        provider: "tavily",
        apiKey: clean(value.apiKey, 2_000),
        maxResults: Math.min(
          10,
          Math.max(1, Number(value.maxResults) || 5),
        ),
      };
    }
  } catch {
    window.localStorage.removeItem(WEB_SEARCH_SETTINGS_STORAGE_KEY);
  }

  try {
    const rawSession = window.sessionStorage.getItem(
      AI_SESSION_SETTINGS_STORAGE_KEY,
    );
    if (rawSession) {
      const value = JSON.parse(rawSession) as Partial<AISettings>;
      if (PROVIDER_IDS.has(value.activeProvider as AIProviderId)) {
        defaults.activeProvider = value.activeProvider as AIProviderId;
      }
      if (value.providers && typeof value.providers === "object") {
        for (const preset of AI_PROVIDER_PRESETS) {
          const incoming = value.providers[preset.id];
          if (!incoming) continue;
          defaults.providers[preset.id] = {
            apiKey: clean(incoming.apiKey, 2_000),
            baseUrl: clean(incoming.baseUrl) || preset.baseUrl,
            model: clean(incoming.model, 200) || preset.model,
          };
        }
      }
      if (value.webSearch && typeof value.webSearch === "object") {
        defaults.webSearch = {
          enabled: value.webSearch.enabled === true,
          provider: "tavily",
          apiKey: clean(value.webSearch.apiKey, 2_000),
          maxResults: Math.min(
            10,
            Math.max(1, Number(value.webSearch.maxResults) || 5),
          ),
        };
      }
      defaults.rememberKeys = false;
    }
  } catch {
    window.sessionStorage.removeItem(AI_SESSION_SETTINGS_STORAGE_KEY);
  }
  return defaults;
}

export function saveAISettings(settings: AISettings) {
  if (typeof window === "undefined") return;
  if (settings.rememberKeys) {
    window.sessionStorage.removeItem(AI_SESSION_SETTINGS_STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(
      AI_SESSION_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  }
  const modelPayload = {
    activeProvider: settings.activeProvider,
    providers: Object.fromEntries(
      Object.entries(settings.providers).map(([id, setting]) => [
        id,
        {
          ...setting,
          apiKey: settings.rememberKeys ? setting.apiKey : "",
        },
      ]),
    ),
    rememberKeys: settings.rememberKeys,
  };
  window.localStorage.setItem(
    AI_SETTINGS_STORAGE_KEY,
    JSON.stringify(modelPayload),
  );
  window.localStorage.setItem(
    WEB_SEARCH_SETTINGS_STORAGE_KEY,
    JSON.stringify({
      ...settings.webSearch,
      apiKey: settings.rememberKeys ? settings.webSearch.apiKey : "",
    }),
  );
}

export function activeModelRequestConfig(settings: AISettings) {
  const active = settings.providers[settings.activeProvider];
  return {
    provider: settings.activeProvider,
    apiKey: active.apiKey,
    baseUrl: active.baseUrl,
    model: active.model,
  };
}

export function providerLabel(id: AIProviderId) {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === id)?.label ?? id;
}
