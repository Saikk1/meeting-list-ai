import { LocalConfigError } from "./local-store.mjs";

export const MAX_ADMIN_REQUEST_BYTES = 2 * 1024 * 1024;
export const MAX_MEETINGS_REQUEST_BYTES = 32 * 1024 * 1024;
export const MAX_CONTACTS_REQUEST_BYTES = 10 * 1024 * 1024;

function jsonResponse(value, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function errorResponse(error) {
  if (error instanceof LocalConfigError) {
    return jsonResponse(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      },
      error.status,
    );
  }
  if (error instanceof SyntaxError) {
    return jsonResponse(
      {
        error: {
          code: "INVALID_JSON",
          message: "请求正文不是有效的 JSON",
        },
      },
      400,
    );
  }
  console.error("[ADMIN API ERROR]", error);
  return jsonResponse(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "本机数据服务发生错误",
      },
    },
    500,
  );
}

function assertRequestObject(value, requiredKeys) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new LocalConfigError("请求正文必须是对象");
  }
  const allowed = new Set(requiredKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new LocalConfigError(`请求正文包含不支持的字段：${key}`, {
        details: { path: key },
      });
    }
  }
  for (const key of requiredKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new LocalConfigError(`请求正文缺少字段：${key}`, {
        details: { path: key },
      });
    }
  }
}

function assertSameOrigin(request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") {
    throw new LocalConfigError("拒绝跨站写入本机数据", {
      code: "CROSS_ORIGIN_WRITE",
      status: 403,
    });
  }
  const origin = request.headers.get("origin");
  if (!origin) return;
  let normalizedOrigin;
  try {
    normalizedOrigin = new URL(origin).origin;
  } catch {
    throw new LocalConfigError("请求 Origin 无效", {
      code: "CROSS_ORIGIN_WRITE",
      status: 403,
    });
  }
  if (normalizedOrigin !== new URL(request.url).origin) {
    throw new LocalConfigError("拒绝跨域写入本机数据", {
      code: "CROSS_ORIGIN_WRITE",
      status: 403,
    });
  }
}

async function readJsonBody(request, maximumBytes = MAX_ADMIN_REQUEST_BYTES) {
  const limitLabel = `${Math.max(1, Math.round(maximumBytes / (1024 * 1024)))}MB`;
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new LocalConfigError("Content-Type 必须是 application/json", {
      code: "UNSUPPORTED_MEDIA_TYPE",
      status: 415,
    });
  }
  const declaredLength = Number.parseInt(
    request.headers.get("content-length") || "",
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > maximumBytes
  ) {
    throw new LocalConfigError(`请求正文超过 ${limitLabel} 限制`, {
      code: "REQUEST_TOO_LARGE",
      status: 413,
    });
  }
  if (!request.body) {
    throw new LocalConfigError("请求正文不能为空", {
      code: "INVALID_JSON",
      status: 400,
    });
  }

  const chunks = [];
  let totalBytes = 0;
  const reader = request.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new LocalConfigError(`请求正文超过 ${limitLabel} 限制`, {
          code: "REQUEST_TOO_LARGE",
          status: 413,
        });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let decoded;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LocalConfigError("请求正文必须使用有效的 UTF-8 编码", {
      code: "INVALID_JSON",
      status: 400,
    });
  }
  return JSON.parse(decoded);
}

function methodNotAllowed(allowed) {
  return jsonResponse(
    {
      error: {
        code: "METHOD_NOT_ALLOWED",
        message: "此接口不支持当前请求方法",
      },
    },
    405,
    { Allow: allowed.join(", ") },
  );
}

function exportResponse(payload) {
  const date = new Date().toISOString().slice(0, 10);
  const fileName = encodeURIComponent(`会务智办配置-${date}.json`);
  return new Response(`${JSON.stringify(payload, null, 2)}\n`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="meeting-assistant-config-${date}.json"; filename*=UTF-8''${fileName}`,
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function handleLocalAdminApi(request, store) {
  const { pathname } = new URL(request.url);
  if (
    pathname !== "/api/admin/config" &&
    !pathname.startsWith("/api/admin/config/")
  ) {
    return null;
  }

  try {
    if (pathname === "/api/admin/config") {
      if (request.method === "GET" || request.method === "HEAD") {
        const snapshot = await store.getSnapshot();
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json; charset=utf-8",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        return jsonResponse(snapshot);
      }
      if (request.method === "PUT") {
        assertSameOrigin(request);
        const body = await readJsonBody(request);
        assertRequestObject(body, ["expectedRevision", "summary", "config"]);
        return jsonResponse(await store.save(body));
      }
      return methodNotAllowed(["GET", "HEAD", "PUT"]);
    }

    if (pathname === "/api/admin/config/export") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed(["GET", "HEAD"]);
      }
      const exported = await store.getExport();
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return exportResponse(exported);
    }

    if (pathname === "/api/admin/config/rollback") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      assertRequestObject(body, ["expectedRevision", "targetRevision"]);
      return jsonResponse(await store.rollback(body));
    }

    return jsonResponse(
      {
        error: {
          code: "NOT_FOUND",
          message: "本机配置接口不存在",
        },
      },
      404,
    );
  } catch (error) {
    return errorResponse(error);
  }
}

function boundedQueryInteger(value, fallback, minimum, maximum, path) {
  if (value === null || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new LocalConfigError(
      `${path} 必须是 ${minimum} 到 ${maximum} 之间的整数`,
      {
        code: "INVALID_QUERY",
        details: { path },
      },
    );
  }
  return parsed;
}

export async function handleLocalContactsApi(request, store) {
  const url = new URL(request.url);
  const { pathname } = url;
  if (pathname !== "/api/contacts" && !pathname.startsWith("/api/contacts/")) {
    return null;
  }

  try {
    if (pathname === "/api/contacts") {
      if (request.method === "GET" || request.method === "HEAD") {
        const query = url.searchParams.get("q") ?? "";
        if ([...query].length > 100) {
          throw new LocalConfigError("搜索内容不能超过 100 个字符", {
            code: "INVALID_QUERY",
            details: { path: "q" },
          });
        }
        const limit = boundedQueryInteger(
          url.searchParams.get("limit"),
          50,
          1,
          200,
          "limit",
        );
        const offset = boundedQueryInteger(
          url.searchParams.get("offset"),
          0,
          0,
          Number.MAX_SAFE_INTEGER,
          "offset",
        );
        const snapshot = await store.list({ query, limit, offset });
        if (request.method === "HEAD") {
          return new Response(null, {
            status: 200,
            headers: {
              "Cache-Control": "no-store",
              "Content-Type": "application/json; charset=utf-8",
              "X-Content-Type-Options": "nosniff",
            },
          });
        }
        return jsonResponse(snapshot);
      }
      if (request.method === "POST") {
        assertSameOrigin(request);
        const body = await readJsonBody(request);
        assertRequestObject(body, ["contact"]);
        return jsonResponse({ contact: await store.create(body.contact) }, 201);
      }
      if (request.method === "PUT") {
        assertSameOrigin(request);
        const body = await readJsonBody(request, MAX_CONTACTS_REQUEST_BYTES);
        assertRequestObject(body, ["contacts"]);
        return jsonResponse(await store.replaceAll(body));
      }
      return methodNotAllowed(["GET", "HEAD", "POST", "PUT"]);
    }

    if (pathname === "/api/contacts/upsert") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      assertRequestObject(body, ["meeting", "contacts"]);
      return jsonResponse(await store.upsertMeeting(body));
    }

    const contactId = pathname.slice("/api/contacts/".length);
    if (!contactId || contactId.includes("/")) {
      return jsonResponse(
        {
          error: {
            code: "NOT_FOUND",
            message: "通讯录接口不存在",
          },
        },
        404,
      );
    }
    if (request.method === "PUT") {
      assertSameOrigin(request);
      const body = await readJsonBody(request);
      assertRequestObject(body, ["contact"]);
      return jsonResponse({
        contact: await store.update(contactId, body.contact),
      });
    }
    if (request.method === "DELETE") {
      assertSameOrigin(request);
      return jsonResponse(await store.remove(contactId));
    }
    return methodNotAllowed(["PUT", "DELETE"]);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleLocalMeetingsApi(request, store) {
  const { pathname } = new URL(request.url);
  if (pathname !== "/api/meetings") return null;

  try {
    if (request.method === "GET" || request.method === "HEAD") {
      const snapshot = await store.getSnapshot();
      if (request.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "application/json; charset=utf-8",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      return jsonResponse(snapshot);
    }
    if (request.method === "PUT") {
      assertSameOrigin(request);
      const body = await readJsonBody(request, MAX_MEETINGS_REQUEST_BYTES);
      assertRequestObject(body, Object.hasOwn(body, "expectedRevision") ? ["meetings", "expectedRevision"] : ["meetings"]);
      if (Object.hasOwn(body, "expectedRevision") && (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0)) throw new LocalConfigError("会议版本号无效");
      return jsonResponse(await store.replaceAll(body));
    }
    return methodNotAllowed(["GET", "HEAD", "PUT"]);
  } catch (error) {
    return errorResponse(error);
  }
}
