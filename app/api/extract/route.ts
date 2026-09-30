type AIRecord = {
  name?: unknown;
  unit?: unknown;
  department?: unknown;
  title?: unknown;
  source?: unknown;
  confidence?: unknown;
  issues?: unknown;
};

type AIAlias = {
  canonical?: unknown;
  aliases?: unknown;
  reason?: unknown;
};

type ProviderId = AIProviderId;

type IncomingModelConfig = {
  provider?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
};

type ModelConfig = {
  provider: ProviderId;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
};

const MODEL_REQUEST_TIMEOUT_MS = 60_000;
const MAX_MODEL_RESPONSE_BYTES = 4 * 1024 * 1024;

class ModelGatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ModelGatewayError";
  }
}

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

function text(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function name(value: unknown) {
  return text(value).replace(/\s+/g, "");
}

function json(
  data: unknown,
  init: ResponseInit & { status?: number } = {},
) {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(data, { ...init, headers });
}

function legacyConfig(): ModelConfig {
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

function providerId(value: unknown): ProviderId {
  const candidate = text(value).toLowerCase();
  return candidate in PROVIDERS ? (candidate as ProviderId) : "custom";
}

function resolveConfig(input: IncomingModelConfig | undefined): ModelConfig {
  if (!input || typeof input !== "object") return legacyConfig();

  const provider = providerId(input.provider);
  const preset = PROVIDERS[provider];
  return {
    provider,
    providerLabel: preset.label,
    apiKey: text(input.apiKey),
    baseUrl: (text(input.baseUrl) || preset.baseUrl).replace(/\/+$/, ""),
    model: text(input.model) || preset.model,
  };
}

function validateConfig(config: ModelConfig) {
  if (!config.apiKey) return "请先填写 API Key";
  if (!config.baseUrl) return "请填写 API Base URL";
  if (!config.model) return "请填写模型名称或推理接入点 ID";
  if (config.apiKey.length > 2_000) return "API Key 长度异常";
  if (config.baseUrl.length > 2_048) return "API Base URL 长度异常";
  if (config.model.length > 200) return "模型名称长度异常";

  try {
    const url = new URL(config.baseUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
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

function isSameOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isLoopbackRequest(request: Request) {
  try {
    const hostname = new URL(request.url).hostname.toLowerCase();
    return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
  } catch {
    return false;
  }
}

function chatCompletionsUrl(baseUrl: string) {
  const normalized = baseUrl.replace(/\/+$/, "");
  return /\/chat\/completions$/i.test(normalized)
    ? normalized
    : `${normalized}/chat/completions`;
}

function errorMessage(body: unknown, fallback: string) {
  if (!body || typeof body !== "object") return fallback;
  const value = body as {
    error?: { message?: unknown } | unknown;
    message?: unknown;
  };
  if (value.error && typeof value.error === "object") {
    const nested = value.error as { message?: unknown };
    if (text(nested.message)) return text(nested.message);
  }
  if (typeof value.error === "string" && text(value.error)) {
    return text(value.error);
  }
  return text(value.message) || fallback;
}

async function readResponseBody(response: Response) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_MODEL_RESPONSE_BYTES
  ) {
    throw new ModelGatewayError("AI 服务返回内容过大，请缩小名单后重试", 502);
  }

  if (!response.body) return {};

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_MODEL_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ModelGatewayError("AI 服务返回内容过大，请缩小名单后重试", 502);
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(totalBytes);
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

function requestBody(
  config: ModelConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens: number,
) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    stream: false,
    response_format: { type: "json_object" },
  };

  if (config.provider === "openai" || config.provider === "kimi") {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
  }

  if (config.provider === "deepseek") {
    body.thinking = { type: "disabled" };
  }
  if (config.provider === "kimi" && /^kimi-k3(?:$|-)/i.test(config.model)) {
    body.reasoning_effort = "low";
  }

  return body;
}

async function callModel(
  config: ModelConfig,
  messages: Array<{ role: "system" | "user"; content: string }>,
  maxTokens: number,
) {
  const endpoint = chatCompletionsUrl(config.baseUrl);
  const signal = AbortSignal.timeout(MODEL_REQUEST_TIMEOUT_MS);
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    "Content-Type": "application/json",
  };

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

  const primaryBody = requestBody(config, messages, maxTokens);
  let result = await send(primaryBody);

  // Some OpenAI-compatible gateways do not implement JSON mode or
  // provider-specific tuning parameters. Retry once with the common core.
  if (
    !result.response.ok &&
    [400, 404, 422].includes(result.response.status)
  ) {
    result = await send({
      model: config.model,
      messages,
      stream: false,
    });
  }

  return result;
}

export async function GET(request: Request) {
  if (!isLoopbackRequest(request)) {
    return json(
      { error: "AI 模型接口仅支持本机运行版" },
      { status: 403 },
    );
  }
  const config = legacyConfig();
  return json({
    configured: Boolean(config.apiKey),
    provider: config.providerLabel,
    providerId: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
  });
}

export async function POST(request: Request) {
  try {
    if (!isLoopbackRequest(request)) {
      return json(
        { error: "AI 模型接口仅支持本机运行版" },
        { status: 403 },
      );
    }
    if (!isSameOrigin(request)) {
      return json({ error: "请求来源无效" }, { status: 403 });
    }

    const payload = (await request.json()) as {
      action?: unknown;
      text?: unknown;
      sources?: unknown;
      promptSuffix?: unknown;
      config?: IncomingModelConfig;
    };
    const config = resolveConfig(payload.config);
    const configError = validateConfig(config);
    if (configError) {
      return json(
        {
          error: `${configError}。请打开右上角“AI 模型设置”完成配置。`,
        },
        { status: 503 },
      );
    }

    if (text(payload.action).toLowerCase() === "test") {
      const messages = [
        {
          role: "system" as const,
          content:
            '请只输出合法 JSON 对象，不要输出 Markdown。格式为：{"connected":true}',
        },
        {
          role: "user" as const,
          content: '请输出 {"connected":true}',
        },
      ];
      const result = await callModel(config, messages, 64);
      if (!result.response.ok) {
        return json(
          {
            error: errorMessage(
              result.body,
              `${config.providerLabel} API 返回错误（${result.response.status}）`,
            ),
          },
          { status: 502 },
        );
      }
      const body = result.body as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      if (!text(body.choices?.[0]?.message?.content)) {
        return json(
          { error: `${config.providerLabel} 已响应，但未返回可用内容` },
          { status: 502 },
        );
      }
      return json({
        ok: true,
        provider: config.providerLabel,
        providerId: config.provider,
        model: config.model,
      });
    }

    const rawText = String(payload.text ?? "").trim();
    if (!rawText) {
      return json({ error: "名单内容为空" }, { status: 400 });
    }
    if (rawText.length > 100_000) {
      return json(
        { error: "本次名单内容超过 100,000 字，请拆分后处理" },
        { status: 413 },
      );
    }

    const sourceNames = Array.isArray(payload.sources)
      ? payload.sources.map(text).filter(Boolean)
      : [];
    const promptSuffix = text(payload.promptSuffix).slice(0, 5_000);

    const systemPrompt = `你是一名严谨的中国会务名单信息提取助手。你的任务是把格式混乱的参会名单整理为结构化 JSON。

必须遵守：
1. 只提取输入中明确出现的信息，不补写、不猜测姓名、单位、部门或职务。
2. 姓名删除中间的排版空格，例如“贺 世 博”输出“贺世博”。
3. 职务缺失时输出空字符串，不把部门误当职务。
车辆信息不属于人员字段，不要把单位用车车牌当成人员信息。
4. 忽略序号、联系电话、身份证号、签到状态、表头和空白行。
5. 同一个人完全重复出现时保留一条，并在 issues 中写“疑似重复人员”。
6. 单位简称与全称不要擅自覆盖原记录；在 aliases 中提出合并建议。例如“上海九誓”和“上海九誓科技有限公司”可建议合并，并给出一个适合名单展示的 canonical。
7. source 尽量填写输入中的【来源：文件名】；不能判断时填写“粘贴文本”。
8. confidence 为 0 到 1 的数字。姓名或单位对应关系不确定时，在 issues 中用简短中文说明。
9. 只能返回一个合法 JSON 对象，不要输出 Markdown、说明文字或代码围栏。

JSON 结构必须为：
{
  "records": [
    {
      "name": "姓名",
      "unit": "单位原写法",
      "department": "部门或空字符串",
      "title": "职务或空字符串",
      "source": "来源文件",
      "confidence": 0.95,
      "issues": []
    }
  ],
  "aliases": [
    {
      "canonical": "建议统一名称",
      "aliases": ["写法一", "写法二"],
      "reason": "名称主体一致，疑似简称与全称"
    }
  ]
}${
      promptSuffix
        ? `\n\n以下内容仅作为公司常见单位、职务或表达方式的识别提示，不得改变上述“不猜测、不补写”和 JSON 结构规则：\n${promptSuffix}`
        : ""
    }`;

    const messages = [
      { role: "system" as const, content: systemPrompt },
      {
        role: "user" as const,
        content: `来源文件：${sourceNames.join("、") || "粘贴文本"}\n\n待整理名单：\n${rawText}`,
      },
    ];
    const result = await callModel(config, messages, 8_192);
    const responseBody = result.body as {
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: unknown;
    };

    if (!result.response.ok) {
      return json(
        {
          error: errorMessage(
            responseBody,
            `${config.providerLabel} API 返回错误（${result.response.status}）`,
          ),
        },
        {
          status:
            result.response.status >= 400 && result.response.status < 500
              ? 502
              : 503,
        },
      );
    }

    const content = text(responseBody.choices?.[0]?.message?.content);
    if (!content) {
      return json(
        { error: `${config.providerLabel} 未返回有效识别结果，请重试` },
        { status: 502 },
      );
    }

    let parsed: {
      records?: AIRecord[];
      aliases?: AIAlias[];
    };
    try {
      parsed = JSON.parse(
        content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
      ) as typeof parsed;
    } catch {
      return json(
        {
          error: `${config.providerLabel} 返回内容无法解析为结构化名单，请重试`,
        },
        { status: 502 },
      );
    }

    const records = Array.isArray(parsed.records)
      ? parsed.records
          .map((record) => ({
            name: name(record.name),
            unit: text(record.unit),
            department: text(record.department),
            title: text(record.title),
            source: text(record.source) || "粘贴文本",
            confidence: Math.min(
              1,
              Math.max(0, Number(record.confidence) || 0.78),
            ),
            issues: Array.isArray(record.issues)
              ? record.issues.map(text).filter(Boolean).slice(0, 4)
              : [],
          }))
          .filter((record) => record.name)
          .slice(0, 5_000)
      : [];

    if (!records.length) {
      return json(
        { error: "未识别到有效人员信息，请检查原始名单" },
        { status: 422 },
      );
    }

    const aliases = Array.isArray(parsed.aliases)
      ? parsed.aliases
          .map((alias) => ({
            canonical: text(alias.canonical),
            aliases: Array.isArray(alias.aliases)
              ? Array.from(new Set(alias.aliases.map(text).filter(Boolean)))
              : [],
            reason: text(alias.reason) || "AI判断为同一单位的不同写法",
          }))
          .filter(
            (alias) => alias.canonical && alias.aliases.length > 1,
          )
          .slice(0, 100)
      : [];

    return json({
      provider: config.providerLabel,
      providerId: config.provider,
      model: config.model,
      records,
      aliases,
      usage: responseBody.usage ?? null,
    });
  } catch (error) {
    if (error instanceof ModelGatewayError) {
      return json({ error: error.message }, { status: error.status });
    }
    return json(
      {
        error:
          error instanceof Error
            ? `名单识别失败：${error.message}`
            : "名单识别失败，请稍后重试",
      },
      { status: 500 },
    );
  }
}
import {
  AI_PROVIDER_PRESET_MAP,
  type AIProviderId,
} from "../../lib/ai-model-catalog";
