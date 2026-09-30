import assert from "node:assert/strict";
import test from "node:test";

import { POST as planAssistant } from "../app/api/assistant/plan/route";
import { POST as respondAssistant } from "../app/api/assistant/respond/route";
import { POST as analyzeRanking } from "../app/api/ranking/analyze/route";
import { POST as searchWeb } from "../app/api/web-search/route";
import { cloneAdminConfig } from "../app/lib/admin-config";

const modelConfig = {
  provider: "deepseek",
  apiKey: "test-secret-key",
  baseUrl: "https://model.invalid/v1",
  model: "test-model",
};

const defaultMeetingInput = {
  title: "待命名会议",
  date: "2026-08-03",
  startTime: "14:00",
  location: "",
  organizer: "会务智办",
  owner: "会务小组",
  attendeeEstimate: 20,
  rosterRequired: false,
  afternoonMeeting: false,
  mealType: "none",
  alcoholRequired: false,
  parkingRequired: false,
  vehicleCount: 0,
  publicityRequired: false,
  reimbursementRequired: false,
  presentationRequired: true,
  welcomeScreenRequired: false,
  roomSize: "small",
};

function localRequest(path: string, body: unknown) {
  return new Request(`http://127.0.0.1:3000${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "http://127.0.0.1:3000",
    },
    body: JSON.stringify(body),
  });
}

function modelResponse(content: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

test("assistant planner accepts a safe read-only reply", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    modelResponse({
      schemaVersion: 1,
      summary: "当前没有需要执行的修改。",
      clarification: null,
      warnings: [],
      actions: [],
    });

  const response = await planAssistant(
    localRequest("/api/assistant/plan", {
      prompt: "告诉我当前状态",
      context: { meetings: [] },
      config: modelConfig,
    }),
  );
  const payload = (await response.json()) as {
    plan?: { actions?: unknown[] };
    error?: string;
  };

  assert.equal(response.status, 200, payload.error);
  assert.deepEqual(payload.plan?.actions, []);
  assert.equal(JSON.stringify(payload).includes(modelConfig.apiKey), false);
});

test("assistant planner rejects tools outside the deterministic allowlist", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    modelResponse({
      schemaVersion: 1,
      summary: "执行命令",
      clarification: null,
      warnings: [],
      actions: [{ type: "shell", command: "anything" }],
    });

  const response = await planAssistant(
    localRequest("/api/assistant/plan", {
      prompt: "执行任意代码",
      context: {},
      config: modelConfig,
    }),
  );
  assert.equal(response.status, 422);
});

test("conversational agent keeps the create intent and compiles a complete meeting", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let gatewayRequest = "";
  globalThis.fetch = async (_input, init) => {
    gatewayRequest = String(init?.body ?? "");
    return modelResponse({
      reply:
        "已整理好市场部部门例会，未提及事项按后台默认值处理。",
      mode: "preview",
      assumptions: ["负责人和其他会务选项沿用后台默认配置"],
      actions: [{ type: "meeting.create_from_draft", draft: {} }],
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {
          title: "市场部部门例会",
          date: "2026-08-04",
          startTime: "09:30",
          endTime: "11:30",
          location: "小会议室",
          attendeeEstimate: 5,
        },
        selectedMeetingId: null,
      },
      suggestions: ["确认创建"],
    });
  };

  const response = await respondAssistant(
    localRequest("/api/assistant/respond", {
      conversation: [
        { role: "user", content: "我要预定一个新的会议" },
        {
          role: "assistant",
          content: "可以，把会议名称、时间、地点和人数告诉我即可。",
        },
        {
          role: "user",
          content:
            "市场部部门例会，明天上午九点半到十一点半，在小会议室，参会人数5个",
        },
      ],
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {},
        selectedMeetingId: null,
      },
      context: {
        now: "2026-08-03T10:00:00+08:00",
        timezone: "Asia/Shanghai",
        defaultMeetingInput,
      },
      config: modelConfig,
    }),
  );
  const payload = (await response.json()) as {
    response?: { mode?: string };
    plan?: { actions?: Array<{ type?: string; input?: Record<string, unknown> }> };
    error?: string;
  };

  assert.equal(response.status, 200, payload.error);
  assert.equal(payload.response?.mode, "preview");
  assert.equal(payload.plan?.actions?.[0]?.type, "meeting.create");
  assert.equal(payload.plan?.actions?.[0]?.input?.endTime, "11:30");
  assert.equal(payload.plan?.actions?.[0]?.input?.owner, "会务小组");
  assert.match(gatewayRequest, /我要预定一个新的会议/);
  assert.match(gatewayRequest, /workingMemory/);
  assert.equal(gatewayRequest.includes(modelConfig.apiKey), false);
});

test("conversational agent still rejects unknown system actions after repair", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return modelResponse({
      reply: "执行任意命令",
      mode: "preview",
      assumptions: [],
      actions: [{ type: "shell", command: "whoami" }],
      memory: {
        activeIntent: "none",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      suggestions: [],
    });
  };

  const response = await respondAssistant(
    localRequest("/api/assistant/respond", {
      conversation: [{ role: "user", content: "执行任意代码" }],
      memory: {
        activeIntent: "none",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      context: { defaultMeetingInput },
      config: modelConfig,
    }),
  );

  assert.equal(response.status, 422);
  assert.equal(calls, 2);
});

test("person enrichment cannot invent a title without actual evidence", async () => {
  const response = await analyzeRanking(
    localRequest("/api/ranking/analyze", {
      action: "enrich-person",
      config: modelConfig,
      records: [
        {
          id: "person-1",
          name: "张三",
          unit: "",
          department: "",
          title: "",
        },
      ],
      rules: cloneAdminConfig().rosterRules.ranking,
      evidence: [],
    }),
  );
  assert.equal(response.status, 422);
});

test("assistant document reports return an editable confirmation plan with attendees and agenda", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let modelInput: Record<string, unknown> = {};
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    modelInput = JSON.parse(body.messages[1].content);
    return modelResponse({ reply: "依据方案.txt：交流会，2030-08-20 09:30，小会议室；其余设置待确认。", mode: "preview", assumptions: ["方案.txt：张三参会；单位未提供，留空"],
      actions: [{ type: "meeting.create_from_draft", draft: {} }], suggestions: [],
      memory: { activeIntent: "create_meeting", selectedMeetingId: null, newMeetingDraft: { title: "交流会", date: "2030-08-20", startTime: "09:30", location: "小会议室", notes: "讨论项目进展", attendees: [{ name: "张三", unit: "", department: "", title: "" }] } } });
  };
  const documents = [{ id: "doc-1", name: "方案.txt", size: 100, content: "交流会，2030年8月20日09:30，小会议室。张三参会。议程：讨论项目进展。" }];
  const result = await respondAssistant(localRequest("/api/assistant/respond", { conversation: [{ role: "user", content: "根据资料创建会议，确认后上报" }], documents, context: { defaultMeetingInput }, config: modelConfig }));
  const payload = await result.json();
  assert.equal(result.status, 200, payload.error);
  assert.deepEqual(modelInput.documents, documents);
  assert.equal(payload.response.mode, "preview");
  assert.equal(payload.plan.actions[0].input.attendees[0].name, "张三");
  assert.equal(payload.plan.actions[0].input.rosterRequired, false);
  assert.equal(payload.plan.actions[0].input.notes, "讨论项目进展");
});

test("assistant rejects oversized document evidence before calling a model", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => { globalThis.fetch = originalFetch; });
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call"); };
  const response = await respondAssistant(localRequest("/api/assistant/respond", { documents: [{ id: "1", name: "过大.txt", size: 100, content: "字".repeat(24001) }] }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("ranking analysis strips invented evidence references", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    modelResponse({
      units: [],
      people: [
        {
          recordId: "person-1",
          status: "verified",
          suggestedUnit: "示例单位",
          suggestedDepartment: "办公室",
          suggestedTitle: "主任",
          titleTierId: "title-principal",
          confidence: 0.99,
          reason: "模型声称已核验",
          evidenceIds: ["invented-source"],
          needsReview: false,
        },
      ],
    });

  const response = await analyzeRanking(
    localRequest("/api/ranking/analyze", {
      action: "enrich-person",
      config: modelConfig,
      records: [
        {
          id: "person-1",
          name: "张三",
          unit: "示例单位",
          department: "",
          title: "",
        },
      ],
      rules: cloneAdminConfig().rosterRules.ranking,
      evidence: [
        {
          id: "real-source",
          query: "张三 示例单位 职务",
          title: "示例单位官网",
          url: "https://example.gov.cn/person",
          snippet: "公开信息",
        },
      ],
    }),
  );
  const payload = (await response.json()) as {
    people: Array<{ status: string; evidenceIds: string[]; needsReview: boolean }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.people[0].evidenceIds, []);
  assert.equal(payload.people[0].status, "ambiguous");
  assert.equal(payload.people[0].needsReview, true);
});

test("web search only returns HTTPS evidence and never echoes the key", async (context) => {
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        results: [
          {
            title: "官方页面",
            url: "https://example.gov.cn/profile",
            content: "职务信息",
            score: 0.9,
          },
          {
            title: "非安全页面",
            url: "http://example.com/profile",
            content: "不应返回",
            score: 0.8,
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  const response = await searchWeb(
    localRequest("/api/web-search", {
      provider: "tavily",
      apiKey: "tavily-secret",
      query: "测试查询",
      maxResults: 5,
    }),
  );
  const payload = (await response.json()) as {
    results: Array<{ url: string }>;
  };

  assert.equal(response.status, 200);
  assert.deepEqual(payload.results.map((item) => item.url), [
    "https://example.gov.cn/profile",
  ]);
  assert.equal(JSON.stringify(payload).includes("tavily-secret"), false);
});
