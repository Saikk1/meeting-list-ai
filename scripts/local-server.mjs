import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(scriptsDirectory, "..");
const clientDirectory = resolve(projectDirectory, "dist", "client");
const serverEntry = resolve(projectDirectory, "dist", "server", "index.js");
const host = "127.0.0.1";
let preferredPort = 3000;
let activePort = 3000;

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".csv", "text/csv; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseEnvironmentLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const separator = trimmed.indexOf("=");
  if (separator <= 0) return null;

  const key = trimmed.slice(0, separator).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return null;

  let value = trimmed.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

async function loadEnvironmentFile(fileName) {
  try {
    const contents = await readFile(resolve(projectDirectory, fileName), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const parsed = parseEnvironmentLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

async function serveAsset(request) {
  const url = new URL(request.url);
  let pathname;

  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const assetPath = resolve(clientDirectory, `.${pathname}`);
  const allowedPrefix = clientDirectory.endsWith(sep)
    ? clientDirectory
    : `${clientDirectory}${sep}`;

  if (assetPath !== clientDirectory && !assetPath.startsWith(allowedPrefix)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const assetStat = await stat(assetPath);
    if (!assetStat.isFile()) return new Response("Not Found", { status: 404 });

    const headers = new Headers({
      "Content-Length": String(assetStat.size),
      "Content-Type":
        mimeTypes.get(extname(assetPath).toLowerCase()) ||
        "application/octet-stream",
    });

    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }

    return new Response(Readable.toWeb(createReadStream(assetPath)), {
      status: 200,
      headers,
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Response("Not Found", { status: 404 });
    }
    throw error;
  }
}

function toWebRequest(request) {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const requestUrl = new URL(
    request.url || "/",
    `http://${request.headers.host || `${host}:${activePort}`}`,
  );
  const init = {
    method: request.method,
    headers,
  };

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = Readable.toWeb(request);
    init.duplex = "half";
  }

  return new Request(requestUrl, init);
}

function openBrowser(url) {
  if (process.platform !== "win32") return;

  try {
    const opener = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-Command",
        `Start-Process '${url}'`,
      ],
      {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      },
    );
    opener.unref();
  } catch {
    console.log(`The browser did not open automatically. Visit: ${url}`);
  }
}

async function sendWebResponse(response, nodeResponse, method) {
  nodeResponse.statusCode = response.status;
  nodeResponse.statusMessage = response.statusText;

  for (const [name, value] of response.headers) {
    nodeResponse.setHeader(name, value);
  }
  nodeResponse.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
  nodeResponse.setHeader("X-Content-Type-Options", "nosniff");
  nodeResponse.setHeader("X-Frame-Options", "DENY");
  nodeResponse.setHeader("Referrer-Policy", "no-referrer");

  if (method === "HEAD" || !response.body) {
    nodeResponse.end();
    return;
  }

  Readable.fromWeb(response.body).pipe(nodeResponse);
}

await loadEnvironmentFile(".env");
await loadEnvironmentFile(".env.local");
// Production is deliberately pinned to one origin so browser-local meetings and
// model keys do not appear to vanish after a port change. Tests may opt into an
// isolated ephemeral port without exposing a runtime setting to packaged users.
const configuredPort =
  process.env.MEETING_ASSISTANT_DESKTOP === "1"
    ? Number.parseInt(process.env.MEETING_ASSISTANT_DESKTOP_PORT || "32187", 10)
    : process.env.NODE_ENV === "test"
    ? Number.parseInt(process.env.MEETING_ASSISTANT_TEST_PORT || "", 10)
    : Number.NaN;
preferredPort =
  Number.isInteger(configuredPort) &&
  configuredPort >= (process.env.MEETING_ASSISTANT_DESKTOP === "1" ? 0 : 1) &&
  configuredPort <= 65535
    ? configuredPort
    : 3000;
activePort = preferredPort;
const [
  {
    handleLocalAdminApi: adminApiHandler,
    handleLocalContactsApi: contactsApiHandler,
    handleLocalMeetingsApi: meetingsApiHandler,
  },
  { createLocalConfigStore, createLocalContactStore, createLocalMeetingStore },
] = await Promise.all([
  import("./local-api.mjs"),
  import("./local-store.mjs"),
]);
const adminConfigStore = createLocalConfigStore();
const bundledConfig = JSON.parse(await readFile(resolve(projectDirectory, "dist/default-admin-config.json"), "utf8"));
await adminConfigStore.initializeDefaults(bundledConfig);
const contactsStore = createLocalContactStore();
const meetingsStore = createLocalMeetingStore();
const { createIntegrationApi } = await import("./integration-api.mjs");
const { createLocalIntegrationProvider } = await import("./integration-provider.mjs");
const integrationApiHandler = createIntegrationApi({
  provider: createLocalIntegrationProvider({ meetingsStore, contactsStore }),
  token: process.env.MEETING_ASSISTANT_INTEGRATION_TOKEN || "",
});

// Node's ESM loader requires an actual file:// URL on Windows. Passing a raw
// absolute path such as D:\meeting-list-ai\dist\server\index.js makes Node
// interpret "D:" as a URL scheme and abort with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const serverEntryUrl = pathToFileURL(serverEntry).href;
const { default: worker } = await import(serverEntryUrl);
if (!worker || typeof worker.fetch !== "function") {
  throw new Error(
    "The packaged server is invalid: dist/server/index.js must export fetch().",
  );
}
const env = {
  ASSETS: { fetch: serveAsset },
};

const server = createServer(async (request, response) => {
  try {
    const requestHost = String(request.headers.host || "")
      .trim()
      .toLowerCase();
    if (requestHost !== `${host}:${activePort}`) {
      response.statusCode = 421;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end("Misdirected request.");
      return;
    }

    const pendingTasks = [];
    const context = {
      passThroughOnException() {},
      waitUntil(task) {
        pendingTasks.push(Promise.resolve(task));
      },
    };

    const webRequest = toWebRequest(request);
    const integrationResponse = await integrationApiHandler(webRequest);
    if (integrationResponse) {
      await sendWebResponse(integrationResponse, response, request.method);
      return;
    }
    const meetingsResponse = await meetingsApiHandler(
      webRequest,
      meetingsStore,
    );
    if (meetingsResponse) {
      await sendWebResponse(meetingsResponse, response, request.method);
      return;
    }
    const contactsResponse = await contactsApiHandler(
      webRequest,
      contactsStore,
    );
    if (contactsResponse) {
      await sendWebResponse(contactsResponse, response, request.method);
      return;
    }
    const adminResponse = await adminApiHandler(
      webRequest,
      adminConfigStore,
    );
    if (adminResponse) {
      await sendWebResponse(adminResponse, response, request.method);
      return;
    }

    const staticResponse = await serveAsset(webRequest);
    if (staticResponse.status !== 404) {
      await sendWebResponse(staticResponse, response, request.method);
      return;
    }

    const webResponse = await worker.fetch(webRequest, env, context);
    await sendWebResponse(webResponse, response, request.method);
    Promise.allSettled(pendingTasks).catch(() => {});
  } catch (error) {
    console.error("[REQUEST ERROR]", error);
    if (!response.headersSent) {
      response.statusCode = 500;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
    }
    response.end("Internal error. Check the launcher window for details.");
  }
});

async function listen() {
  await new Promise((resolveListening, rejectListening) => {
    const handleError = (error) => {
      server.off("listening", handleListening);
      rejectListening(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolveListening();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(preferredPort, host);
  });
}

try {
  await listen();
  activePort = server.address().port;
  const applicationUrl = `http://${host}:${activePort}`;
  process.parentPort?.postMessage({ type: "ready", url: applicationUrl });
  console.log(`App ready: ${applicationUrl}`);
  console.log("Keep this window open while using the app.");
  if (process.env.NO_OPEN_BROWSER !== "1") {
    openBrowser(applicationUrl);
  }
} catch (error) {
  if (error?.code === "EADDRINUSE") {
    console.error(
      `[START ERROR] Port ${preferredPort} is already in use. Close the old launcher window or the program using this port, then try again. The app does not switch ports because browser data is tied to this address.`,
    );
  } else {
    console.error("[START ERROR]", error);
  }
  process.exitCode = 1;
}

process.parentPort?.on("message", ({ data }) => {
  if (data?.type !== "shutdown") return;
  server.closeAllConnections();
  server.close(() => process.exit(0));
});
