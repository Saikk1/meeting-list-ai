import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import {
  createServer as createHttpServer,
  request as rawHttpRequest,
} from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function reservePort() {
  const probe = createNetServer();
  await new Promise((resolveListening, rejectListening) => {
    probe.once("error", rejectListening);
    probe.listen(0, "127.0.0.1", resolveListening);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolveClosed) => probe.close(resolveClosed));
  return port;
}

async function startRuntime(
  port,
  cwd = projectDirectory,
  environmentOverrides = {},
) {
  const isolatedDataDirectory = environmentOverrides.MEETING_ASSISTANT_DATA_DIR ? null : await mkdtemp(join(tmpdir(), "runtime-provider-"));
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    DEEPSEEK_API_KEY: "",
    MEETING_ASSISTANT_INTEGRATION_TOKEN: "",
    ...(isolatedDataDirectory ? { MEETING_ASSISTANT_DATA_DIR: isolatedDataDirectory } : {}),
    ...environmentOverrides,
  };
  if (port === null) {
    delete environment.MEETING_ASSISTANT_TEST_PORT;
  } else {
    environment.MEETING_ASSISTANT_TEST_PORT = String(port);
  }

  const child = spawn(
    process.execPath,
    [resolve(cwd, "scripts", "local-server.mjs")],
    {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.testDataDirectory = isolatedDataDirectory;

  let output = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`Runtime startup timed out.\n${output}`));
    }, 10_000);

    const checkReady = () => {
      if (output.includes("App ready:")) {
        clearTimeout(timeout);
        child.off("exit", handleExit);
        resolveReady();
      }
    };
    const handleExit = (code) => {
      clearTimeout(timeout);
      rejectReady(
        new Error(`Runtime exited before startup (${code}).\n${output}`),
      );
    };

    child.stdout.on("data", checkReady);
    child.once("exit", handleExit);
  });

  return {
    child,
    output: () => output,
  };
}

async function stopRuntime(child) {
  if (child.exitCode !== null) {
    if (child.testDataDirectory) await rm(child.testDataDirectory, { recursive: true, force: true });
    return;
  }
  child.kill();
  await new Promise((resolveExit) => {
    const timeout = setTimeout(resolveExit, 3_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolveExit();
    });
  });
  if (child.testDataDirectory) await rm(child.testDataDirectory, { recursive: true, force: true });
}

async function requestStatusWithHost(port, path, hostHeader) {
  return new Promise((resolveStatus, rejectStatus) => {
    const request = rawHttpRequest(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers: { Host: hostHeader },
      },
      (response) => {
        response.resume();
        response.once("end", () => resolveStatus(response.statusCode));
      },
    );
    request.once("error", rejectStatus);
    request.end();
  });
}

test("local runtime exposes authenticated versioned integration capabilities", async () => {
  const directory = await mkdtemp(join(tmpdir(), "integration-runtime-"));
  const port = await reservePort();
  const integrationToken = "runtime-integration-test-token-32-characters";
  let runtime;
  try {
    runtime = await startRuntime(port, projectDirectory, {
      MEETING_ASSISTANT_DATA_DIR: directory,
      MEETING_ASSISTANT_INTEGRATION_TOKEN: integrationToken,
      NO_OPEN_BROWSER: "1",
    });
    const url = `http://127.0.0.1:${port}/api/integrations/v1/capabilities`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${integrationToken}` } });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.apiVersion, "1");
    assert.deepEqual(payload.data.features, ["meetings.read", "tasks.read", "attendees.read", "contacts.read"]);
    assert.equal(payload.data.writeSupported, false);
  } finally {
    if (runtime) await stopRuntime(runtime.child);
    await rm(directory, { recursive: true, force: true });
  }
});

test("precompiled local runtime serves the app and API without node_modules", async () => {
  const cleanDirectory = await mkdtemp(join(tmpdir(), "会务 名单运行测试-"));
  await cp(
    resolve(projectDirectory, "dist"),
    resolve(cleanDirectory, "dist"),
    { recursive: true },
  );
  await mkdir(resolve(cleanDirectory, "scripts"));
  for (const scriptName of [
    "local-server.mjs",
    "local-api.mjs",
    "local-store.mjs",
    "seating-schema.mjs",
    "meeting-plan-schema.mjs",
    "integration-api.mjs",
    "integration-provider.mjs",
  ]) {
    await cp(
      resolve(projectDirectory, "scripts", scriptName),
      resolve(cleanDirectory, "scripts", scriptName),
    );
  }

  const port = await reservePort();
  const runtime = await startRuntime(port, cleanDirectory, {
    MEETING_ASSISTANT_DATA_DIR: resolve(cleanDirectory, "user-data"),
    NO_OPEN_BROWSER: "1",
  });
  const request = async (path) => {
    try {
      return await fetch(`http://127.0.0.1:${port}${path}`);
    } catch (error) {
      throw new Error(
        `Local runtime fetch failed for ${path}.\n${runtime.output()}`,
        { cause: error },
      );
    }
  };

  try {
    const home = await request("/");
    const integration = await request("/api/integrations/v1/capabilities");
    assert.equal(integration.status, 503);
    assert.equal((await integration.json()).error.code, "INTEGRATION_DISABLED");
    assert.equal(home.status, 200);
    assert.match(
      home.headers.get("content-type") ?? "",
      /^text\/html\b/i,
    );
    assert.equal(home.headers.get("x-frame-options"), "DENY");
    assert.equal(home.headers.get("x-content-type-options"), "nosniff");
    assert.equal(
      home.headers.get("content-security-policy"),
      "frame-ancestors 'none'",
    );
    const html = await home.text();
    assert.match(html, /会务智办/);
    assert.doesNotMatch(html, /href="\/minutes(?:["/?])|智能纪要/);
    for (const removedPath of ["/minutes", "/minutes/old-record", "/api/minutes", "/api/minutes/jobs", "/api/minutes/models"]) {
      assert.equal((await request(removedPath)).status, 404, `${removedPath} must be unavailable`);
    }

    const assetPaths = Array.from(
      new Set(
        Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)).map(
          (match) => match[1],
        ),
      ),
    );
    assert.ok(assetPaths.length >= 2, "Rendered page must reference built assets");
    for (const assetPath of assetPaths) {
      const asset = await request(assetPath);
      assert.equal(asset.status, 200, `${assetPath} was not served`);
    }

    const config = await request("/api/extract");
    assert.equal(config.status, 200);
    assert.deepEqual(await config.json(), {
      configured: false,
      provider: "DeepSeek",
      providerId: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
    });

    const missingKey = await fetch(`http://127.0.0.1:${port}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "马晓勇 宁波轿辰 执行总裁" }),
    });
    assert.equal(missingKey.status, 503);

    const adminConfig = await request("/api/admin/config");
    assert.equal(adminConfig.status, 200);
    const seededConfig = await adminConfig.json();
    assert.equal(seededConfig.revision, 1);
    assert.equal(seededConfig.config.meetingRoomPresetVersion, 1);
    assert.equal(seededConfig.config.meetingRooms.length, 6);
    assert.equal(seededConfig.config.meetingRooms[0].name, "10F 决策室（小会议室）");
    assert.equal(seededConfig.config.meetingRooms[0].areaSqm, 42.7);
    assert.doesNotMatch(runtime.output(), /ADMIN CONFIG DISABLED/);

    assert.equal(
      await requestStatusWithHost(
        port,
        "/api/admin/config",
        "attacker.example",
      ),
      421,
    );

    const icon = await request("/favicon.svg");
    assert.equal(icon.status, 200);
    assert.match(icon.headers.get("content-type") ?? "", /^image\/svg\+xml\b/i);

    for (const [route, copy] of [
      ["/meetings", "我的会议"],
      ["/meetings/new", "新建会议"],
      ["/lists", "名单治理"],
      ["/admin", "管理中心"],
    ]) {
      const page = await request(route);
      assert.equal(page.status, 200, `${route} should render`);
      assert.match(await page.text(), new RegExp(copy));
    }

    const sopImage = await request("/sop/kingdee-application-overview.png");
    assert.equal(sopImage.status, 200);
    assert.match(sopImage.headers.get("content-type") ?? "", /^image\/png\b/i);

    const socialCard = await request("/og.png");
    assert.equal(socialCard.status, 200);
    assert.match(
      socialCard.headers.get("content-type") ?? "",
      /^image\/png\b/i,
    );
  } finally {
    await stopRuntime(runtime.child);
    await rm(cleanDirectory, { recursive: true, force: true });
  }
});

test("web settings can switch OpenAI-compatible providers and retry a minimal request", async () => {
  const received = [];
  const modelServer = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      received.push({
        path: request.url,
        authorization: request.headers.authorization,
        payload,
      });

      if (
        request.headers.authorization === "Bearer key-custom" &&
        payload.response_format
      ) {
        response.statusCode = 400;
        response.setHeader("Content-Type", "application/json");
        response.end(
          JSON.stringify({
            error: { message: "response_format is not supported" },
          }),
        );
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({ connected: true }),
              },
            },
          ],
        }),
      );
    });
  });
  await new Promise((resolveListening, rejectListening) => {
    modelServer.once("error", rejectListening);
    modelServer.listen(0, "127.0.0.1", resolveListening);
  });
  const modelAddress = modelServer.address();
  const modelPort =
    typeof modelAddress === "object" && modelAddress ? modelAddress.port : 0;

  const appPort = await reservePort();
  const runtime = await startRuntime(appPort);
  const providers = [
    ["deepseek", "DeepSeek"],
    ["openai", "OpenAI"],
    ["kimi", "Kimi"],
    ["doubao", "豆包"],
    ["custom", "自定义"],
  ];

  try {
    for (const [provider, label] of providers) {
      const fullEndpoint =
        provider === "custom"
          ? `http://127.0.0.1:${modelPort}/chat/completions`
          : `http://127.0.0.1:${modelPort}`;
      const response = await fetch(
        `http://127.0.0.1:${appPort}/api/extract`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "test",
            config: {
              provider,
              apiKey: `key-${provider}`,
              baseUrl: fullEndpoint,
              model: `model-${provider}`,
            },
          }),
        },
      );
      assert.equal(response.status, 200, `${provider} test should succeed`);
      const result = await response.json();
      assert.equal(result.ok, true);
      assert.equal(result.provider, label);
      assert.equal(result.model, `model-${provider}`);
      assert.equal(JSON.stringify(result).includes(`key-${provider}`), false);
    }

    for (const [provider] of providers) {
      const calls = received.filter(
        (entry) => entry.authorization === `Bearer key-${provider}`,
      );
      assert.equal(
        calls.length,
        provider === "custom" ? 2 : 1,
        `${provider} call count`,
      );
      assert.ok(calls.every((entry) => entry.path === "/chat/completions"));
      assert.ok(
        calls.every(
          (entry) => entry.payload.model === `model-${provider}`,
        ),
      );
    }

    const customCalls = received.filter(
      (entry) => entry.authorization === "Bearer key-custom",
    );
    assert.deepEqual(customCalls[0].payload.response_format, {
      type: "json_object",
    });
    assert.equal("response_format" in customCalls[1].payload, false);

    const deepSeekCall = received.find(
      (entry) => entry.authorization === "Bearer key-deepseek",
    );
    const openAICall = received.find(
      (entry) => entry.authorization === "Bearer key-openai",
    );
    const doubaoCall = received.find(
      (entry) => entry.authorization === "Bearer key-doubao",
    );
    assert.deepEqual(deepSeekCall.payload.thinking, { type: "disabled" });
    assert.equal(deepSeekCall.payload.max_tokens, 64);
    assert.equal(openAICall.payload.max_completion_tokens, 64);
    assert.equal(doubaoCall.payload.max_tokens, 64);
  } finally {
    await stopRuntime(runtime.child);
    await new Promise((resolveClosed) => modelServer.close(resolveClosed));
  }
});

test("DeepSeek-compatible JSON response is normalized by the local API", async () => {
  let receivedPayload = null;
  const modelServer = createHttpServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      receivedPayload = JSON.parse(body);
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  records: [
                    {
                      name: "贺 世 博",
                      unit: "上海九誓科技有限公司",
                      department: "",
                      title: "",
                      source: "测试名单.xlsx",
                      confidence: 0.96,
                      issues: [],
                    },
                  ],
                  aliases: [],
                }),
              },
            },
          ],
          usage: { total_tokens: 42 },
        }),
      );
    });
  });
  await new Promise((resolveListening, rejectListening) => {
    modelServer.once("error", rejectListening);
    modelServer.listen(0, "127.0.0.1", resolveListening);
  });
  const modelAddress = modelServer.address();
  const modelPort =
    typeof modelAddress === "object" && modelAddress ? modelAddress.port : 0;

  const appPort = await reservePort();
  const runtime = await startRuntime(appPort, projectDirectory, {
    DEEPSEEK_API_KEY: "local-test-key",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}`,
    DEEPSEEK_MODEL: "deepseek-v4-flash",
  });

  try {
    const response = await fetch(`http://127.0.0.1:${appPort}/api/extract`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: "贺 世 博 上海九誓科技有限公司",
        sources: ["测试名单.xlsx"],
        promptSuffix: "九誓通常指上海九誓科技有限公司",
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.records[0].name, "贺世博");
    assert.equal(result.records[0].unit, "上海九誓科技有限公司");
    assert.equal(result.records[0].title, "");
    assert.equal(receivedPayload.model, "deepseek-v4-flash");
    assert.deepEqual(receivedPayload.response_format, {
      type: "json_object",
    });
    assert.match(
      receivedPayload.messages[0].content,
      /九誓通常指上海九誓科技有限公司/,
    );
    assert.match(receivedPayload.messages[0].content, /不补写、不猜测/);
  } finally {
    await stopRuntime(runtime.child);
    await new Promise((resolveClosed) => modelServer.close(resolveClosed));
  }
});
