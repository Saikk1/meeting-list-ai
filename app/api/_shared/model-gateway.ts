import {
  AI_PROVIDER_PRESET_MAP,
  type AIProviderId,
} from "../../lib/ai-model-catalog";

export type ProviderId = AIProviderId;

export type IncomingModelConfig = {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

export type ModelConfig = {
  provider: ProviderId;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const PROVIDERS: Record<
  ProviderId,
  { label: string; baseUrl: string; model: string }
> = Object.fromEntries(
  Object.values(AI_PROVIDER_PRESET_MAP).map((preset) => [
    preset.id,
    {
      label: preset.label,
      baseUrl: preset.baseUrl,
      model: preset.model,
    },
  ]),
) as Record<ProviderId, { label: string; baseUrl: string; model: string }>;

export class ModelGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

export function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function providerId(value: unknown): ProviderId {
  const candidate = cleanText(value).toLowerCase();
  return candidate in PROVIDERS ? (candidate as ProviderId) : "custom";
}

export function resolveModelConfig(
  input: IncomingModelConfig | undefined,
): ModelConfig {
  if (!input || typeof input !== "object") {
    return {
      provider: "deepseek",
      providerLabel: PROVIDERS.deepseek.label,
      apiKey: process.env.DEEPSEEK_API_KEY?.trim() ?? "",
      baseUrl:
        process.env.DEEPSEEK_BASE_URL?.trim().replace(/\/+$/, "") ||
        PROVIDERS.deepseek.baseUrl,
      model:
        process.env.DEEPSEEK_MODEL?.trim() || PROVIDERS.deepseek.model,
    };
  }
  const id = providerId(input.provider);
  const preset = PROVIDERS[id];
  return {
    provider: id,
    providerLabel: preset.label,
    apiKey: cleanText(input.apiKey),
    baseUrl: (cleanText(input.baseUrl) || preset.baseUrl).replace(/\/+$/, ""),
    model: cleanText(input.model) || preset.model,
  };
}

export function validateModelConfig(config: ModelConfig) {
  if (!config.apiKey) return "请先填写 API Key";
  if (!config.baseUrl) return "请填写 API Base URL";
  if (!config.model) return "请填写模型名称或推理接入点 ID";
  if (config.apiKey.length > 2_000) return "API Key 长度异常";
  if (config.baseUrl.length > 2_048) return "API Base URL 长度异常";
  if (config.model.length > 200) return "模型名称长度异常";
  try {
    const url = new URL(config.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) {
      return "API Base URL 只支持 http:// 或 https://";
    }
    if (url.username || url.password) {
      return "API Base URL 中不要包含账号或密码";
    }
  } catch {
    return "API Base URL 格式不正确";
  }
  return "";
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

async function readResponseBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_RESPONSE_BYTES
  ) {
    throw new ModelGatewayError("AI 服务返回内容过大，请缩小内容后重试", 502);
  }
  if (!response.body) return {};
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ModelGatewayError("AI 服务返回内容过大，请缩小内容后重试", 502);
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const raw = new TextDecoder().decode(merged);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { message: raw.slice(0, 500) };
  }
}

export function gatewayErrorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const value = body as {
    error?: { message?: unknown } | unknown;
    message?: unknown;
  };
  if (value.error && typeof value.error === "object") {
    const nested = value.error as { message?: unknown };
    if (cleanText(nested.message)) return cleanText(nested.message);
  }
  if (typeof value.error === "string" && cleanText(value.error)) {
    return cleanText(value.error);
  }
  return cleanText(value.message) || fallback;
}

export async function callJsonModel(
  config: ModelConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens: number,
) {
  const endpoint = chatCompletionsUrl(config.baseUrl);
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };
  const primary: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
    response_format: { type: "json_object" },
  };
  if (config.provider === "openai" || config.provider === "kimi") {
    primary.max_completion_tokens = maxTokens;
  } else {
    primary.max_tokens = maxTokens;
  }
  if (config.provider === "deepseek") {
    primary.thinking = { type: "disabled" };
  }

  async function send(body: Record<string, unknown>) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          ["AbortError", "TimeoutError"].includes(error.name))
      ) {
        throw new ModelGatewayError("AI 服务响应超时，请稍后重试", 504);
      }
      throw new ModelGatewayError("无法连接 AI 服务，请检查网络和接口地址", 502);
    }
    return { response, body: await readResponseBody(response) };
  }

  let result = await send(primary);
  if (!result.response.ok && [400, 404, 422].includes(result.response.status)) {
    result = await send({ model: config.model, messages, stream: false });
  }
  return result;
}

export function modelResponseContent(body: unknown) {
  const payload = body as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  return cleanText(payload?.choices?.[0]?.message?.content);
}

export function parseModelJson<T>(content: string): T {
  return JSON.parse(
    content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ) as T;
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function isLoopbackRequest(request: Request) {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

export function noStoreJson(
  data: unknown,
  init: ResponseInit & { status?: number } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}
