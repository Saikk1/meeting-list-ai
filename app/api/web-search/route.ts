import {
  cleanText,
  isLoopbackRequest,
  isSameOrigin,
  noStoreJson,
} from "../_shared/model-gateway";

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readLimitedJson(response: Response) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_RESPONSE_BYTES) {
    throw new Error("搜索服务返回内容过大");
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
      throw new Error("搜索服务返回内容过大");
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(merged) || "{}") as unknown;
}

function safeHttpsUrl(value: unknown) {
  try {
    const url = new URL(cleanText(value));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export async function POST(request: Request) {
  if (!isLoopbackRequest(request)) {
    return noStoreJson({ error: "联网搜索仅支持本机运行版" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return noStoreJson({ error: "请求来源无效" }, { status: 403 });
  }
  try {
    const payload = (await request.json()) as {
      provider?: unknown;
      apiKey?: unknown;
      query?: unknown;
      maxResults?: unknown;
    };
    if (cleanText(payload.provider).toLowerCase() !== "tavily") {
      return noStoreJson({ error: "当前仅支持 Tavily 搜索服务" }, { status: 400 });
    }
    const apiKey = cleanText(payload.apiKey);
    const query = cleanText(payload.query);
    const maxResults = Math.min(
      10,
      Math.max(1, Number(payload.maxResults) || 5),
    );
    if (!apiKey) {
      return noStoreJson({ error: "请先填写 Tavily API Key" }, { status: 503 });
    }
    if (apiKey.length > 2_000) {
      return noStoreJson({ error: "搜索 API Key 长度异常" }, { status: 400 });
    }
    if (!query || query.length > 500) {
      return noStoreJson(
        { error: "搜索词不能为空且不能超过 500 字" },
        { status: 400 },
      );
    }

    const signal = AbortSignal.timeout(30_000);
    let response: Response;
    try {
      response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          search_depth: "advanced",
          max_results: maxResults,
          include_answer: false,
          include_raw_content: false,
        }),
        signal,
      });
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof Error &&
          ["AbortError", "TimeoutError"].includes(error.name))
      ) {
        return noStoreJson({ error: "搜索服务响应超时" }, { status: 504 });
      }
      return noStoreJson(
        { error: "无法连接搜索服务，请检查网络" },
        { status: 502 },
      );
    }
    const body = (await readLimitedJson(response)) as {
      detail?: unknown;
      message?: unknown;
      results?: Array<{
        title?: unknown;
        url?: unknown;
        content?: unknown;
        score?: unknown;
        published_date?: unknown;
      }>;
    };
    if (!response.ok) {
      return noStoreJson(
        {
          error:
            cleanText(body.detail) ||
            cleanText(body.message) ||
            `搜索服务返回错误（${response.status}）`,
        },
        { status: 502 },
      );
    }
    const results = Array.isArray(body.results)
      ? body.results
          .map((item, index) => ({
            id: `search-${index + 1}`,
            title: cleanText(item.title).slice(0, 300),
            url: safeHttpsUrl(item.url),
            snippet: cleanText(item.content).slice(0, 1_500),
            score: Math.min(1, Math.max(0, Number(item.score) || 0)),
            publishedAt: cleanText(item.published_date).slice(0, 50) || null,
          }))
          .filter((item) => item.url && item.title)
      : [];
    return noStoreJson({ query, results });
  } catch (error) {
    return noStoreJson(
      {
        error:
          error instanceof Error
            ? `联网搜索失败：${error.message}`
            : "联网搜索失败",
      },
      { status: 500 },
    );
  }
}
