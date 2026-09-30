import { createHash, randomUUID, timingSafeEqual } from "node:crypto";

export const INTEGRATION_API_PREFIX = "/api/integrations/v1";

class IntegrationError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function integerParam(params, name, fallback, minimum, maximum) {
  const value = params.get(name);
  if (value === null) return fallback;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum || Number(value) > maximum) {
    throw new IntegrationError("INVALID_QUERY", `${name} 必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return Number(value);
}

function queryOptions(url, resource) {
  const allowed = new Set(["limit", "offset", ...(resource === "meetings" ? ["status"] : []),
    ...(resource === "contacts" ? ["q"] : [])]);
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) {
      throw new IntegrationError("INVALID_QUERY", `不支持或重复的查询参数：${key}`);
    }
  }
  const options = {
    limit: integerParam(url.searchParams, "limit", 50, 1, 200),
    offset: integerParam(url.searchParams, "offset", 0, 0, Number.MAX_SAFE_INTEGER),
  };
  if (resource === "meetings") {
    options.status = url.searchParams.get("status") ?? "active";
    if (!["active", "archived", "deleted", "all"].includes(options.status)) {
      throw new IntegrationError("INVALID_QUERY", "status 必须是 active、archived、deleted 或 all");
    }
  }
  if (resource === "contacts") {
    options.query = url.searchParams.get("q") ?? "";
    if (options.query.length > 100) {
      throw new IntegrationError("INVALID_QUERY", "q 不能超过 100 个字符");
    }
  }
  return options;
}

/** provider: listMeetings/getMeeting/listMeetingTasks/listMeetingAttendees/listContacts.
 * Authentication and wire DTOs stay separate from a vendor-specific OA adapter.
 */
export function createIntegrationApi({ provider, token = "" }) {
  if (token && (!/^[\x21-\x7e]{32,256}$/.test(token))) {
    throw new Error("集成令牌必须是 32 到 256 位不含空格的 ASCII 字符");
  }
  const tokenHash = token ? createHash("sha256").update(token).digest() : null;

  return async function handleIntegrationApi(request) {
    const url = new URL(request.url);
    // Own the entire namespace, including unsupported future versions.
    if (url.pathname !== "/api/integrations" && !url.pathname.startsWith("/api/integrations/")) return null;
    const requestId = randomUUID();
    const respond = (payload, status = 200, extraHeaders = {}) => new Response(
      request.method === "HEAD" ? null : JSON.stringify({ apiVersion: "1", requestId, ...payload }),
      { status, headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
        ...extraHeaders,
      } },
    );
    try {
      if (!tokenHash) {
        throw new IntegrationError("INTEGRATION_DISABLED", "OA 集成接口尚未启用", 503);
      }
      const authorization = request.headers.get("authorization") ?? "";
      const bearer = /^Bearer ([\x21-\x7e]+)$/i.exec(authorization)?.[1] ?? "";
      const receivedHash = createHash("sha256").update(bearer).digest();
      if (!bearer || !timingSafeEqual(tokenHash, receivedHash)) {
        throw new IntegrationError("UNAUTHORIZED", "集成令牌无效或缺失", 401);
      }
      // This is a server-to-server boundary; browser embedding needs a future
      // gateway/SSO design, rather than sending integration credentials to pages.
      if (request.headers.has("origin") || request.headers.get("sec-fetch-site") === "cross-site") {
        throw new IntegrationError("BROWSER_ACCESS_DENIED", "集成接口仅供服务端调用", 403);
      }
      if (!url.pathname.startsWith(`${INTEGRATION_API_PREFIX}/`)) {
        throw new IntegrationError("NOT_FOUND", "集成接口或版本不存在", 404);
      }
      if (!["GET", "HEAD"].includes(request.method)) {
        return respond({ error: { code: "METHOD_NOT_ALLOWED", message: "当前集成接口仅支持读取" } },
          405, { Allow: "GET, HEAD" });
      }
      const path = url.pathname.slice(INTEGRATION_API_PREFIX.length);
      let data;
      if (path === "/capabilities") {
        if (url.search) throw new IntegrationError("INVALID_QUERY", "此接口不接受查询参数");
        data = {
          provider: "meeting-assistant",
          features: ["meetings.read", "tasks.read", "attendees.read", "contacts.read"],
          maxPageSize: 200,
          authentication: "bearer",
          writeSupported: false,
        };
      } else if (path === "/meetings") {
        data = await provider.listMeetings(queryOptions(url, "meetings"));
      } else if (path === "/contacts") {
        data = await provider.listContacts(queryOptions(url, "contacts"));
      } else {
        const match = /^\/meetings\/([^/]+)(?:\/(tasks|attendees))?$/.exec(path);
        if (!match) throw new IntegrationError("NOT_FOUND", "集成接口不存在", 404);
        let id;
        try { id = decodeURIComponent(match[1]); } catch {
          throw new IntegrationError("INVALID_ID", "会议 ID 编码无效");
        }
        if (!/^[a-z0-9][a-z0-9-]{1,199}$/.test(id)) {
          throw new IntegrationError("INVALID_ID", "会议 ID 无效");
        }
        const options = queryOptions(url, "detail");
        if (match[2] === "tasks") data = await provider.listMeetingTasks(id, options);
        else if (match[2] === "attendees") data = await provider.listMeetingAttendees(id, options);
        else {
          if (url.search) throw new IntegrationError("INVALID_QUERY", "会议详情不接受查询参数");
          data = await provider.getMeeting(id);
        }
        if (data === null) throw new IntegrationError("MEETING_NOT_FOUND", "会议不存在", 404);
      }
      return respond({ data });
    } catch (error) {
      const known = error instanceof IntegrationError;
      const code = known ? error.code : "INTEGRATION_ERROR";
      // Storage failures can include internal paths. Keep those off the wire.
      if (!known) console.error(`[INTEGRATION ERROR] ${requestId}`);
      return respond({ error: { code, message: known ? error.message : "集成数据服务暂时不可用" } },
        known ? error.status : 500, code === "UNAUTHORIZED" ? { "WWW-Authenticate": "Bearer" } : {});
    }
  };
}
