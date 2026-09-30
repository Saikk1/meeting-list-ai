import assert from "node:assert/strict";
import test from "node:test";
import {
  AssistantAgentValidationError,
  EMPTY_ASSISTANT_WORKING_MEMORY,
  parseAssistantAgentResponse,
  parseAssistantConversation,
  parseAssistantWorkingMemory,
  type AssistantAgentResponse,
} from "../app/lib/assistant-agent-contract";
import {
  compileAssistantAgentResponse,
  inferExplicitAssistantIntent,
  mergeAssistantWorkingMemory,
} from "../app/lib/assistant-agent-compiler";
import type { MeetingInput } from "../app/lib/meeting-data";

const defaultMeetingInput: MeetingInput = {
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

test("file-driven drafts do not substitute default dates for missing evidence", () => {
  const result = compileAssistantAgentResponse({ reply: "已整理", mode: "preview", assumptions: [], suggestions: [],
    actions: [{ type: "meeting.create_from_draft", draft: {} }],
    memory: { activeIntent: "create_meeting", selectedMeetingId: null, newMeetingDraft: { title: "资料交流会", location: "小会议室" } },
  }, { defaultMeetingInput, currentMessage: "根据资料创建会议", documentMeetingDraft: true });
  assert.equal(result.plan, null);
  assert.equal(result.memory.newMeetingDraft?.date, undefined);
  assert.equal(result.response.mode, "clarification");
});

test("document morning meetings do not inherit afternoon flags or an unrelated default room", () => {
  const result = compileAssistantAgentResponse({ reply: "确认创建", mode: "preview", assumptions: [], suggestions: [],
    actions: [{ type: "meeting.create_from_draft", draft: { title: "晨会", date: "2030-08-20", startTime: "09:30", location: "外部场地" } }],
    memory: { activeIntent: "create_meeting", selectedMeetingId: null, newMeetingDraft: {} },
  }, { defaultMeetingInput: { ...defaultMeetingInput, afternoonMeeting: true, location: "默认会议室", meetingRoomId: "default-room" }, currentMessage: "根据资料创建会议", documentMeetingDraft: true });
  const action = result.plan?.actions[0];
  assert.equal(action?.type, "meeting.create");
  if (action?.type !== "meeting.create") return;
  assert.equal(action.input.afternoonMeeting, false);
  assert.equal(action.input.meetingRoomId, "");
});

function response(
  value: Partial<AssistantAgentResponse> = {},
): AssistantAgentResponse {
  return {
    reply: "我已经理解并整理好了。",
    mode: "answer",
    assumptions: [],
    actions: [],
    memory: { ...EMPTY_ASSISTANT_WORKING_MEMORY },
    suggestions: [],
    ...value,
  };
}

test("agent response, memory and conversation reject unknown fields", () => {
  assert.throws(
    () =>
      parseAssistantAgentResponse({
        ...response(),
        arbitraryCommand: "whoami",
      }),
    /response\.arbitraryCommand: 不支持此字段/,
  );
  assert.throws(
    () =>
      parseAssistantWorkingMemory({
        ...EMPTY_ASSISTANT_WORKING_MEMORY,
        secret: "not-allowed",
      }),
    /memory\.secret: 不支持此字段/,
  );
  assert.throws(
    () =>
      parseAssistantConversation([
        { role: "user", content: "你好", tool: "shell" },
      ]),
    /conversation\[0\]\.tool: 不支持此字段/,
  );
  assert.throws(
    () =>
      parseAssistantAgentResponse(
        response({
          mode: "preview",
          actions: [
            {
              type: "meeting.create_from_draft",
              draft: { shellCommand: "whoami" },
            },
          ] as never,
        }),
      ),
    AssistantAgentValidationError,
  );
});

test("agent response keeps the shared one-hundred action limit", () => {
  const actions = Array.from(
    { length: 100 },
    () => ({ type: "contacts.open" as const }),
  );
  assert.equal(
    parseAssistantAgentResponse(response({ actions })).actions.length,
    100,
  );
  assert.throws(
    () =>
      parseAssistantAgentResponse(
        response({ actions: [...actions, { type: "contacts.open" }] }),
      ),
    /最多允许 100 个操作/,
  );
});

test("a create-meeting intent survives a clarification turn", () => {
  const first = parseAssistantAgentResponse(
    response({
      reply: "好的，请告诉我会议的基本信息。",
      mode: "clarification",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {},
        selectedMeetingId: null,
      },
    }),
  );
  const next = parseAssistantWorkingMemory({
    activeIntent: "create_meeting",
    newMeetingDraft: {
      title: "市场部部门例会",
      date: "2026-08-04",
      startTime: "09:30",
    },
    selectedMeetingId: null,
  });

  assert.deepEqual(mergeAssistantWorkingMemory(first.memory, next), next);
});

test("explicit module language maps to non-create intent boundaries", () => {
  assert.equal(
    inferExplicitAssistantIntent("去通讯录里修改这家公司的联系人"),
    "manage_contacts",
  );
  assert.equal(
    inferExplicitAssistantIntent("把会务任务清单里的设备测试标记完成"),
    "manage_tasks",
  );
  assert.equal(
    inferExplicitAssistantIntent("把参会名单重新按职务排序"),
    "manage_roster",
  );
  assert.equal(
    inferExplicitAssistantIntent("修改后台默认配置"),
    "manage_admin",
  );
  assert.equal(inferExplicitAssistantIntent("联网查一下他的职务"), "research");
  assert.equal(inferExplicitAssistantIntent("删除这位联系人"), "delete_record");
  assert.equal(inferExplicitAssistantIntent("地点改成三楼"), null);
});

test("switching away from meeting creation clears its draft", () => {
  const previous = parseAssistantWorkingMemory({
    activeIntent: "create_meeting",
    newMeetingDraft: {
      title: "市场部部门例会",
      date: "2026-08-04",
      startTime: "09:30",
    },
    selectedMeetingId: null,
  });
  const next = parseAssistantWorkingMemory({
    activeIntent: "manage_contacts",
    newMeetingDraft: {
      title: "不应继续保留的会议",
    },
    selectedMeetingId: null,
  });

  assert.deepEqual(mergeAssistantWorkingMemory(previous, next), {
    activeIntent: "manage_contacts",
    newMeetingDraft: null,
    selectedMeetingId: null,
  });
});

test("contact-edit request cannot fall back into a previous meeting draft", () => {
  const previousMemory = parseAssistantWorkingMemory({
    activeIntent: "create_meeting",
    newMeetingDraft: {
      title: "市场部部门例会",
      date: "2026-08-04",
      startTime: "09:30",
      location: "小会议室",
    },
    selectedMeetingId: null,
  });
  const result = compileAssistantAgentResponse(
    response({
      reply: "继续创建刚才的会议。",
      mode: "preview",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {},
        selectedMeetingId: null,
      },
      actions: [{ type: "meeting.create_from_draft", draft: {} }],
    }),
    {
      defaultMeetingInput,
      previousMemory,
      currentMessage:
        "通讯录里把低空公司改成宁波经济发展有限公司、市场部改成市场经营部",
    },
  );

  assert.equal(result.memory.activeIntent, "manage_contacts");
  assert.equal(result.memory.newMeetingDraft, null);
  assert.equal(result.plan, null);
  assert.equal(result.response.mode, "answer");
  assert.equal(
    result.response.actions.some(
      (action) =>
        action.type === "meeting.create" ||
        action.type === "meeting.create_from_draft",
    ),
    false,
  );
  assert.match(result.response.reply, /通讯录/);
});

test("a contact update remains valid after leaving a meeting draft", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "将更新这位联系人的单位和部门。",
      mode: "preview",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: { title: "旧会议草稿" },
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "contact.update",
          contactId: "contact-1",
          expectedUpdatedAt: "2026-08-03T08:00:00.000Z",
          patch: {
            unit: "宁波经济发展有限公司",
            department: "市场经营部",
          },
        },
      ],
    }),
    {
      defaultMeetingInput,
      previousMemory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {
          title: "市场部部门例会",
          date: "2026-08-04",
          startTime: "09:30",
        },
        selectedMeetingId: null,
      },
      currentMessage:
        "通讯录里把低空公司改成宁波经济发展有限公司、市场部改成市场经营部",
    },
  );

  assert.equal(result.memory.activeIntent, "manage_contacts");
  assert.equal(result.memory.newMeetingDraft, null);
  assert.equal(result.plan?.actions[0]?.type, "contact.update");
});

test("editing a current roster row cannot be miscompiled as a contact update", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "将修改通讯录联系人。",
      mode: "preview",
      memory: {
        activeIntent: "manage_contacts",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "contact.update",
          contactId: "contact-1",
          expectedUpdatedAt: "2026-08-03T08:00:00.000Z",
          patch: { unit: "宁波经济发展有限公司" },
        },
      ],
    }),
    {
      defaultMeetingInput,
      previousMemory: {
        activeIntent: "manage_roster",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      currentMessage: "把这条记录的单位改成宁波经济发展有限公司",
      rosterWorkspaceAvailable: true,
      rosterWorkspaceRevision: 7,
    },
  );

  assert.equal(result.memory.activeIntent, "manage_roster");
  assert.equal(result.plan, null);
  assert.equal(result.response.actions.length, 0);
  assert.match(result.response.reply, /参会名单/);
});

test("removing a current roster row cannot be miscompiled as contact deletion", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "将删除通讯录联系人。",
      mode: "preview",
      memory: {
        activeIntent: "delete_record",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "contact.delete",
          contactId: "contact-1",
          expectedUpdatedAt: "2026-08-03T08:00:00.000Z",
        },
      ],
    }),
    {
      defaultMeetingInput,
      previousMemory: {
        activeIntent: "manage_roster",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      currentMessage: "删除这条记录",
      rosterWorkspaceAvailable: true,
      rosterWorkspaceRevision: 7,
    },
  );

  assert.equal(result.memory.activeIntent, "delete_record");
  assert.equal(result.plan, null);
  assert.equal(result.response.actions.length, 0);
  assert.doesNotMatch(result.response.reply, /通讯录联系人/);
});

test("a roster workspace record edit compiles as a confirmed workspace plan", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "将修改当前名单记录的单位和部门。",
      mode: "preview",
      memory: {
        activeIntent: "manage_roster",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "roster.workspace.record.update",
          expectedRevision: 7,
          recordId: "record-3",
          patch: {
            unit: "宁波经济发展有限公司",
            department: "市场经营部",
          },
        },
      ],
    }),
    {
      defaultMeetingInput,
      currentMessage: "把这条记录的单位和部门改一下",
      rosterWorkspaceAvailable: true,
      rosterWorkspaceRevision: 7,
    },
  );

  assert.equal(result.response.mode, "preview");
  assert.equal(result.memory.activeIntent, "manage_roster");
  assert.equal(result.plan?.actions[0]?.type, "roster.workspace.record.update");
  assert.deepEqual(result.plan?.actions[0], {
    type: "roster.workspace.record.update",
    expectedRevision: 7,
    recordId: "record-3",
    patch: {
      unit: "宁波经济发展有限公司",
      department: "市场经营部",
    },
  });
});

test("roster workspace plans must use the current snapshot revision", () => {
  assert.throws(
    () =>
      compileAssistantAgentResponse(
        response({
          reply: "将确认当前名单。",
          mode: "preview",
          memory: {
            activeIntent: "manage_roster",
            newMeetingDraft: null,
            selectedMeetingId: null,
          },
          actions: [
            {
              type: "roster.workspace.confirm",
              expectedRevision: 6,
            },
          ],
        }),
        {
          defaultMeetingInput,
          currentMessage: "确认整理结果",
          rosterWorkspaceAvailable: true,
          rosterWorkspaceRevision: 7,
        },
      ),
    /必须原样使用当前 snapshot 的 revision/,
  );
});

test("workspace actions fall back to opening roster when no snapshot is available", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "将处理名单。",
      mode: "preview",
      memory: {
        activeIntent: "manage_roster",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "roster.workspace.process",
          expectedRevision: 7,
        },
      ],
    }),
    {
      defaultMeetingInput,
      currentMessage: "重新处理这份名单",
      rosterWorkspaceAvailable: false,
    },
  );

  assert.equal(result.response.mode, "answer");
  assert.equal(result.memory.activeIntent, "manage_roster");
  assert.deepEqual(result.plan?.actions, [{ type: "roster.open" }]);
  assert.match(result.response.reply, /打开名单治理页面/);
});

test("workspace mutations are rejected in answer mode", () => {
  assert.throws(
    () =>
      parseAssistantAgentResponse(
        response({
          mode: "answer",
          actions: [
            {
              type: "roster.workspace.export",
              expectedRevision: 7,
            },
          ],
        }),
      ),
    /纯回答模式只能包含无需确认的页面操作/,
  );
});

test("a generic create request opens a draft instead of creating a placeholder meeting", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "准备创建会议",
      mode: "preview",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {},
        selectedMeetingId: null,
      },
      actions: [{ type: "meeting.create_from_draft", draft: {} }],
    }),
    { defaultMeetingInput },
  );

  assert.equal(result.plan, null);
  assert.equal(result.response.mode, "clarification");
  assert.equal(result.memory.activeIntent, "create_meeting");
  assert.match(result.response.reply, /会议草稿/);
});

test("multi-turn meeting details compile with configured defaults", () => {
  const previousMemory = parseAssistantWorkingMemory({
    activeIntent: "create_meeting",
    newMeetingDraft: {},
    selectedMeetingId: null,
  });
  const result = compileAssistantAgentResponse(
    response({
      reply: "已整理好市场部部门例会，确认后我会直接创建。",
      mode: "preview",
      assumptions: ["组织者和负责人沿用后台默认配置"],
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
      actions: [{ type: "meeting.create_from_draft", draft: {} }],
      suggestions: ["确认创建", "把地点改成三楼会议室"],
    }),
    { defaultMeetingInput, previousMemory },
  );

  assert.equal(result.plan?.actions.length, 1);
  const action = result.plan?.actions[0];
  assert.equal(action?.type, "meeting.create");
  if (action?.type !== "meeting.create") return;
  assert.deepEqual(action.input, {
    ...defaultMeetingInput,
    title: "市场部部门例会",
    date: "2026-08-04",
    startTime: "09:30",
    endTime: "11:30",
    location: "小会议室",
    attendeeEstimate: 5,
  });
  assert.equal(action.input.organizer, "会务智办");
  assert.equal(action.input.owner, "会务小组");
  assert.equal(action.input.presentationRequired, true);
  assert.equal(result.memory.newMeetingDraft?.endTime, "11:30");
  assert.equal(action.input.endTime, "11:30");
  assert.deepEqual(result.plan.warnings, ["组织者和负责人沿用后台默认配置"]);
});

test("non-blocking create questions are normalized into a preview", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "是否还需要停车、茶歇或欢迎屏？",
      mode: "clarification",
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
    }),
    { defaultMeetingInput },
  );

  assert.equal(result.response.mode, "preview");
  assert.match(result.response.reply, /市场部部门例会/);
  assert.equal(result.plan?.actions[0]?.type, "meeting.create");
});

test("a genuinely ambiguous target is not auto-confirmed", () => {
  const result = compileAssistantAgentResponse(
    response({
      reply: "通讯录里有两位同名联系人，请问您指哪位？",
      mode: "clarification",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {
          title: "市场部部门例会",
          date: "2026-08-04",
          startTime: "09:30",
        },
        selectedMeetingId: null,
      },
    }),
    { defaultMeetingInput },
  );

  assert.equal(result.response.mode, "clarification");
  assert.equal(result.plan, null);
});

test("later draft fields override both previous turns and defaults", () => {
  const result = compileAssistantAgentResponse(
    response({
      mode: "preview",
      memory: {
        activeIntent: "create_meeting",
        newMeetingDraft: { location: "小会议室" },
        selectedMeetingId: null,
      },
      actions: [
        {
          type: "meeting.create_from_draft",
          draft: { location: "三楼会议室", presentationRequired: false },
        },
      ],
    }),
    {
      defaultMeetingInput,
      previousMemory: {
        activeIntent: "create_meeting",
        newMeetingDraft: {
          title: "季度例会",
          date: "2026-08-05",
          startTime: "10:00",
        },
        selectedMeetingId: null,
      },
    },
  );

  const action = result.plan?.actions[0];
  assert.equal(action?.type, "meeting.create");
  if (action?.type !== "meeting.create") return;
  assert.equal(action.input.title, "季度例会");
  assert.equal(action.input.location, "三楼会议室");
  assert.equal(action.input.presentationRequired, false);
  assert.equal(result.memory.newMeetingDraft?.location, "三楼会议室");
});

test("the compiler never guesses relative dates", () => {
  assert.throws(
    () =>
      parseAssistantAgentResponse(
        response({
          mode: "preview",
          memory: {
            activeIntent: "create_meeting",
            newMeetingDraft: { date: "明天" },
            selectedMeetingId: null,
          } as never,
          actions: [{ type: "meeting.create_from_draft", draft: {} }],
        }),
      ),
    /date: (?:必须使用 YYYY-MM-DD 格式|长度必须在 10 到 10 个字符之间)/,
  );
});

test("clarification has no plan while answer only allows safe navigation", () => {
  const clarification = compileAssistantAgentResponse(
    response({
      mode: "clarification",
      reply: "找到两场同名会议，请问您指哪一场？",
      memory: {
        activeIntent: "update_meeting",
        newMeetingDraft: null,
        selectedMeetingId: null,
      },
    }),
    { defaultMeetingInput },
  );
  assert.equal(clarification.plan, null);

  const navigation = compileAssistantAgentResponse(
    response({
      mode: "answer",
      actions: [{ type: "navigate", destination: "meetings" }],
    }),
    { defaultMeetingInput },
  );
  assert.equal(navigation.plan?.actions[0]?.type, "navigate");

  assert.throws(() =>
    parseAssistantAgentResponse(
      response({
        mode: "answer",
        actions: [{ type: "contact.create", input: { name: "张三", unit: "测试单位", department: "", title: "" } }],
      }),
    ),
  /纯回答模式只能包含无需确认的页面操作/);
});
