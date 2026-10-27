import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  executeConfirmedPlan,
  resolveAssistantNavigationPath,
  AssistantExecutionError,
} from "../app/lib/assistant-actions";
import {
  assistantPlanRequiresConfirmation,
  AssistantPlanValidationError,
  parseAssistantPlan,
  type AssistantPlan,
} from "../app/lib/assistant-contract";
import {
  createMeeting,
  type MeetingInput,
  type MeetingRecord,
} from "../app/lib/meeting-data";
import type { ContactRecord } from "../app/lib/contacts";
import {
  cloneAdminConfig,
  DEFAULT_ADMIN_CONFIG,
} from "../app/lib/admin-config";
import {
  buildAssistantRosterXlsx,
  type AssistantRosterExportPayload,
} from "../app/lib/assistant-roster-export";
import {
  validateRosterWorkspaceCommands,
  validateRosterWorkspaceSnapshot,
  type RosterWorkspaceCommand,
  type RosterWorkspaceSnapshot,
} from "../app/lib/roster-workspace-bridge";

const baseInput: MeetingInput = {
  title: "测试交流会",
  date: "2030-08-20",
  startTime: "14:00",
  location: "第一会议室",
  organizer: "综合管理部",
  owner: "会务小组",
  attendeeEstimate: 20,
  afternoonMeeting: true,
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

function plan(actions: AssistantPlan["actions"]): AssistantPlan {
  return {
    schemaVersion: 1,
    summary: "按用户要求更新会务数据",
    clarification: null,
    warnings: [],
    actions,
  };
}

function fixtureMeeting(): MeetingRecord {
  return createMeeting(baseInput);
}

test("confirmed assistant creation persists report attendees without enabling formal roster workflow", async () => {
  const saved: MeetingRecord[] = [];
  const result = await executeConfirmedPlan(plan([{ type: "meeting.create", input: {
    ...baseInput, rosterRequired: false, notes: "09:30 讨论进展", attendees: [{ name: "仅姓名", unit: "", department: "", title: "" }],
  } }]), { loadMeetings: () => [], saveMeeting: (meeting) => { saved.push(meeting); return meeting; } });
  assert.equal(result.createdMeetingIds.length, 1);
  assert.equal(saved[0].attendees[0].name, "仅姓名");
  assert.equal(saved[0].attendees[0].unit, "");
  assert.equal(saved[0].notes, "09:30 讨论进展");
  assert.equal(saved[0].rosterRequired, false);
});

function fixtureContact(
  patch: Partial<ContactRecord> = {},
): ContactRecord {
  return {
    id: "contact-1",
    name: "张三",
    unit: "宁波市交通运输局",
    department: "办公室",
    title: "主任",
    createdAt: "2030-08-01T08:00:00.000Z",
    updatedAt: "2030-08-02T08:00:00.000Z",
    meetingCount: 2,
    meetingIds: [],
    lastMeetingId: "",
    lastMeetingTitle: "",
    lastMeetingDate: "",
    ...patch,
  };
}

function fixtureWorkspaceSnapshot(
  patch: Partial<RosterWorkspaceSnapshot> = {},
): RosterWorkspaceSnapshot {
  return {
    revision: 4,
    pasteText: "张三 宁波市交通运输局 主任",
    files: [
      {
        name: "原始名单.xlsx",
        size: 1_024,
        lastModified: 1_900_000_000_000,
        kind: "excel",
      },
    ],
    step: 3,
    records: [
      {
        id: "workspace-record-1",
        originalIndex: 0,
        name: "张三",
        unit: "宁波市交通运输局",
        department: "办公室",
        title: "主任",
        source: "原始名单.xlsx",
        confidence: 0.98,
        issues: [],
      },
    ],
    recordTotal: 1,
    truncated: false,
    aliases: [
      {
        id: "workspace-alias-1",
        canonical: "宁波市交通运输局",
        aliases: ["宁波交通局"],
        reason: "简称",
        applied: false,
      },
    ],
    linkedMeeting: {
      id: "meeting-linked",
      title: "测试交流会",
      updatedAt: "2030-08-01T08:00:00.000Z",
    },
    busy: {
      processing: false,
      ranking: false,
      enrichingRecordId: null,
    },
    ...patch,
  };
}

test("strict plan parsing rejects unknown tools and extra fields", () => {
  assert.throws(
    () =>
      parseAssistantPlan({
        schemaVersion: 1,
        summary: "尝试运行任意命令",
        clarification: null,
        warnings: [],
        actions: [{ type: "shell", command: "whoami" }],
      }),
    AssistantPlanValidationError,
  );

  assert.throws(
    () =>
      parseAssistantPlan({
        ...plan([{ type: "navigate", destination: "dashboard" }]),
        apiKey: "must-not-be-accepted",
      }),
    /plan\.apiKey: 不支持此字段/,
  );
});

test("clarification plans cannot contain executable actions", () => {
  assert.throws(
    () =>
      parseAssistantPlan({
        schemaVersion: 1,
        summary: "需要确认会议",
        clarification: "请问要修改哪一场会议？",
        warnings: [],
        actions: [{ type: "navigate", destination: "meetings" }],
      }),
    /需要用户补充信息时不能同时安排操作/,
  );
});

test("parsing and navigation preview never write meeting data", () => {
  let writes = 0;
  const parsed = parseAssistantPlan(
    plan([{ type: "navigate", destination: "meetings" }]),
  );
  assert.equal(parsed.actions.length, 1);
  assert.equal(
    resolveAssistantNavigationPath(parsed.actions[0] as Extract<
      AssistantPlan["actions"][number],
      { type: "navigate" }
    >),
    "/meetings",
  );
  assert.equal(writes, 0);

  const saveMeeting = (meeting: MeetingRecord) => {
    writes += 1;
    return meeting;
  };
  void saveMeeting;
  assert.equal(writes, 0);
});

test("confirmed field and task updates are staged and saved once", async () => {
  const meeting = fixtureMeeting();
  const task = meeting.tasks.find((item) => item.templateId === "equipment-test");
  assert.ok(task);
  const saved: MeetingRecord[] = [];

  const result = await executeConfirmedPlan(
    plan([
      {
        type: "meeting.update_fields",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        patch: { location: "三楼会议室", attendeeEstimate: 36 },
      },
      {
        type: "meeting.task.update",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        taskId: task.id,
        patch: { owner: "小王", status: "doing" },
      },
    ]),
    {
      loadMeetings: () => [meeting],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].location, "三楼会议室");
  assert.equal(saved[0].attendeeEstimate, 36);
  assert.equal(
    saved[0].tasks.find((item) => item.id === task.id)?.owner,
    "小王",
  );
  assert.equal(
    saved[0].tasks.find((item) => item.id === task.id)?.status,
    "doing",
  );
  assert.deepEqual(result.updatedMeetingIds, [meeting.id]);
  assert.equal(saved[0].rosterRequired, false);
  assert.equal(result.navigationPath, null);
});

test("stale meetings stop the whole plan before saving or navigating", async () => {
  const meeting = fixtureMeeting();
  let writes = 0;
  let navigations = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.update_fields",
          meetingId: meeting.id,
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
          patch: { location: "错误写入" },
        },
        {
          type: "navigate",
          destination: "meeting_detail",
          meetingId: meeting.id,
        },
      ]),
      {
        loadMeetings: () => [meeting],
        saveMeeting: (next) => {
          writes += 1;
          return next;
        },
        navigate: () => {
          navigations += 1;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_MEETING",
  );

  assert.equal(writes, 0);
  assert.equal(navigations, 0);
});

test("missing tasks stop all writes during staging", async () => {
  const meeting = fixtureMeeting();
  let writes = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.update_fields",
          meetingId: meeting.id,
          expectedUpdatedAt: meeting.updatedAt,
          patch: { owner: "小李" },
        },
        {
          type: "meeting.task.update",
          meetingId: meeting.id,
          expectedUpdatedAt: meeting.updatedAt,
          taskId: "missing-task",
          patch: { status: "done" },
        },
      ]),
      {
        loadMeetings: () => [meeting],
        saveMeeting: (next) => {
          writes += 1;
          return next;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "TASK_NOT_FOUND",
  );
  assert.equal(writes, 0);
});

test("invalid final field combinations are rejected before saving", async () => {
  const meeting = fixtureMeeting();
  let writes = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.update_fields",
          meetingId: meeting.id,
          expectedUpdatedAt: meeting.updatedAt,
          patch: { parkingRequired: false, vehicleCount: 3 },
        },
      ]),
      {
        loadMeetings: () => [meeting],
        saveMeeting: (next) => {
          writes += 1;
          return next;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "INVALID_FINAL_MEETING",
  );
  assert.equal(writes, 0);
});

test("confirmed meeting creation uses existing domain creation and options", async () => {
  const saved: MeetingRecord[] = [];
  const result = await executeConfirmedPlan(
    plan([{ type: "meeting.create", input: baseInput }]),
    {
      loadMeetings: () => [],
      createMeetingOptions: { configRevision: 17 },
      saveMeeting: (meeting) => {
        saved.push(meeting);
        return meeting;
      },
    },
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].title, baseInput.title);
  assert.equal(saved[0].templateSource?.configRevision, 17);
  assert.deepEqual(result.createdMeetingIds, [saved[0].id]);
});

test("navigation is restricted to fixed internal paths", async () => {
  const meeting = fixtureMeeting();
  const visited: string[] = [];
  const result = await executeConfirmedPlan(
    plan([
      {
        type: "roster.open",
        meetingId: meeting.id,
      },
    ]),
    {
      loadMeetings: () => [meeting],
      navigate: (path) => {
        visited.push(path);
      },
    },
  );

  const expected = `/meetings/${encodeURIComponent(meeting.id)}?tab=attendees&mode=governance`;
  assert.deepEqual(visited, [expected]);
  assert.equal(result.navigationPath, expected);

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "navigate",
            destination: "https://evil.example" as "dashboard",
          },
        ]),
      ),
    AssistantPlanValidationError,
  );
});

test("contacts navigation is restricted to the contacts management page", () => {
  assert.equal(
    resolveAssistantNavigationPath({ type: "contacts.open" }),
    "/admin?section=contacts",
  );
  assert.equal(
    assistantPlanRequiresConfirmation(plan([{ type: "contacts.open" }])),
    false,
  );
  assert.equal(
    assistantPlanRequiresConfirmation(
      plan([{ type: "meeting.create", input: baseInput }]),
    ),
    true,
  );
});

test("admin section destinations resolve only to fixed internal paths", () => {
  const destinations = [
    ["admin_overview", "/admin?section=overview"],
    ["admin_organization", "/admin?section=organization"],
    ["admin_rooms", "/admin?section=rooms"],
    ["admin_contacts", "/admin?section=contacts"],
    ["admin_checklist", "/admin?section=checklist"],
    ["admin_aliases", "/admin?section=aliases"],
    ["admin_roster", "/admin?section=roster"],
  ] as const;

  for (const [destination, expectedPath] of destinations) {
    const action = { type: "navigate" as const, destination };
    assert.equal(resolveAssistantNavigationPath(action), expectedPath);
    assert.equal(assistantPlanRequiresConfirmation(plan([action])), false);
  }
});

test("task center navigation resolves to a fixed internal path", () => {
  const action = { type: "navigate" as const, destination: "tasks" as const };
  assert.equal(resolveAssistantNavigationPath(action), "/tasks");
  assert.equal(assistantPlanRequiresConfirmation(plan([action])), false);
});

test("assistant plans allow 100 batch actions but reject 101", () => {
  const actions: AssistantPlan["actions"] = Array.from(
    { length: 100 },
    (_, index) => ({
      type: "contact.create",
      input: {
        name: `联系人${index}`,
        unit: `单位${index}`,
        department: "",
        title: "",
      },
    }),
  );
  assert.equal(parseAssistantPlan(plan(actions)).actions.length, 100);
  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          ...actions,
          {
            type: "contact.create",
            input: {
              name: "第101位联系人",
              unit: "第101个单位",
              department: "",
              title: "",
            },
          },
        ]),
      ),
    /最多允许 100 个操作/,
  );
});

test("optional meeting end time is accepted and an invalid range is rejected", () => {
  const parsed = parseAssistantPlan(
    plan([
      {
        type: "meeting.create",
        input: { ...baseInput, endTime: "16:30" },
      },
    ]),
  );
  const action = parsed.actions[0];
  assert.equal(action.type, "meeting.create");
  if (action.type === "meeting.create") {
    assert.equal(action.input.endTime, "16:30");
  }

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "meeting.create",
            input: { ...baseInput, endTime: "13:00" },
          },
        ]),
      ),
    /结束时间必须晚于开始时间/,
  );
});

test("confirmed attendee addition resolves the contact and saves the meeting once", async () => {
  const meeting = fixtureMeeting();
  const contact = fixtureContact();
  const saved: MeetingRecord[] = [];

  const result = await executeConfirmedPlan(
    plan([
      {
        type: "meeting.attendee.add_from_contact",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        contactId: contact.id,
        expectedContactUpdatedAt: contact.updatedAt,
      },
    ]),
    {
      loadMeetings: () => [meeting],
      loadContacts: () => [contact],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );

  assert.equal(saved.length, 1);
  assert.deepEqual(
    saved[0].attendees.map(({ name, unit, department, title, source }) => ({
      name,
      unit,
      department,
      title,
      source,
    })),
    [
      {
        name: contact.name,
        unit: contact.unit,
        department: contact.department,
        title: contact.title,
        source: "通讯录",
      },
    ],
  );
  assert.deepEqual(result.updatedMeetingIds, [meeting.id]);
});

test("stale contact blocks attendee addition before meeting writes", async () => {
  const meeting = fixtureMeeting();
  const contact = fixtureContact();
  let writes = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.attendee.add_from_contact",
          meetingId: meeting.id,
          expectedUpdatedAt: meeting.updatedAt,
          contactId: contact.id,
          expectedContactUpdatedAt: "2020-01-01T00:00:00.000Z",
        },
      ]),
      {
        loadMeetings: () => [meeting],
        loadContacts: () => [contact],
        saveMeeting: (next) => {
          writes += 1;
          return next;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_CONTACT",
  );
  assert.equal(writes, 0);
});

test("confirmed attendee removal requires the current meeting revision", async () => {
  const attendee = {
    id: "attendee-1",
    name: "李四",
    unit: "市发改委",
    department: "",
    title: "处长",
  };
  const meeting = createMeeting(baseInput, { attendees: [attendee] });
  const saved: MeetingRecord[] = [];

  await executeConfirmedPlan(
    plan([
      {
        type: "meeting.attendee.remove",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        attendeeId: attendee.id,
      },
    ]),
    {
      loadMeetings: () => [meeting],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );
  assert.equal(saved.length, 1);
  assert.deepEqual(saved[0].attendees, []);
});

test("confirmed contact update preflights its revision and sends a full record", async () => {
  const contact = fixtureContact();
  const writes: Array<{ id: string; title: string; unit: string }> = [];
  const result = await executeConfirmedPlan(
    plan([
      {
        type: "contact.update",
        contactId: contact.id,
        expectedUpdatedAt: contact.updatedAt,
        patch: { title: "副局长" },
      },
    ]),
    {
      loadMeetings: () => [],
      loadContacts: () => [contact],
      updateContact: (id, input) => {
        writes.push({ id, title: input.title, unit: input.unit });
        return { ...contact, ...input, updatedAt: new Date().toISOString() };
      },
    },
  );

  assert.deepEqual(writes, [
    { id: contact.id, title: "副局长", unit: contact.unit },
  ]);
  assert.deepEqual(result.updatedContactIds, [contact.id]);
  assert.deepEqual(result.updatedMeetingIds, []);
});

test("confirmed contact creation calls only the allowlisted contact writer", async () => {
  const created: ContactRecord[] = [];
  const input = {
    name: "王五",
    unit: "市经信局",
    department: "办公室",
    title: "主任",
  };
  const result = await executeConfirmedPlan(
    plan([{ type: "contact.create", input }]),
    {
      loadMeetings: () => [],
      loadContacts: () => [],
      createContact: (next) => {
        const record = fixtureContact({
          ...next,
          id: "contact-created",
        });
        created.push(record);
        return record;
      },
    },
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].name, input.name);
  assert.deepEqual(result.createdContactIds, ["contact-created"]);
  assert.deepEqual(result.createdMeetingIds, []);
});

test("contact and meeting writes cannot be combined in one confirmation", () => {
  const meeting = fixtureMeeting();
  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "contact.create",
            input: {
              name: "王五",
              unit: "市经信局",
              department: "办公室",
              title: "主任",
            },
          },
          {
            type: "meeting.update_fields",
            meetingId: meeting.id,
            expectedUpdatedAt: meeting.updatedAt,
            patch: { owner: "王五" },
          },
        ]),
      ),
    /通讯录写入与会议写入不能混在同一次计划中/,
  );
});

test("direct attendee add and attendee update are validated and saved", async () => {
  const existing = {
    id: "attendee-existing",
    name: "李四",
    unit: "市发改委",
    department: "办公室",
    title: "处长",
  };
  const meeting = createMeeting(baseInput, { attendees: [existing] });
  const saved: MeetingRecord[] = [];

  const result = await executeConfirmedPlan(
    plan([
      {
        type: "meeting.attendee.update",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        attendeeId: existing.id,
        patch: { title: "副主任" },
      },
      {
        type: "meeting.attendee.add",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        attendee: {
          name: "王五",
          unit: "市经信局",
          department: "产业处",
          title: "主任",
        },
      },
    ]),
    {
      loadMeetings: () => [meeting],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].attendees[0].title, "副主任");
  assert.deepEqual(
    saved[0].attendees.slice(1).map(({ name, unit, department, title, source }) => ({
      name,
      unit,
      department,
      title,
      source,
    })),
    [
      {
        name: "王五",
        unit: "市经信局",
        department: "产业处",
        title: "主任",
        source: "智能助手录入",
      },
    ],
  );
  assert.deepEqual(result.updatedMeetingIds, [meeting.id]);
  assert.equal(saved[0].rosterRequired, false);
});

test("assistant can save a name-only attendee without enabling roster governance", async () => {
  const meeting = fixtureMeeting();
  const saved: MeetingRecord[] = [];

  await executeConfirmedPlan(
    plan([
      {
        type: "meeting.attendee.add",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        attendee: {
          name: "王五",
          unit: "",
          department: "",
          title: "",
        },
      },
    ]),
    {
      loadMeetings: () => [meeting],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );

  assert.equal(saved[0].attendees[0].name, "王五");
  assert.equal(saved[0].attendees[0].unit, "");
  assert.equal(saved[0].rosterRequired, false);
});

test("attendee updates cannot create a duplicate identity", async () => {
  const first = {
    id: "attendee-first",
    name: "甲",
    unit: "单位甲",
    department: "",
    title: "",
  };
  const second = {
    id: "attendee-second",
    name: "乙",
    unit: "单位乙",
    department: "",
    title: "",
  };
  const meeting = createMeeting(baseInput, { attendees: [first, second] });
  let writes = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.attendee.update",
          meetingId: meeting.id,
          expectedUpdatedAt: meeting.updatedAt,
          attendeeId: first.id,
          patch: { name: second.name, unit: second.unit },
        },
      ]),
      {
        loadMeetings: () => [meeting],
        saveMeeting: (next) => {
          writes += 1;
          return next;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "ATTENDEE_ALREADY_EXISTS",
  );
  assert.equal(writes, 0);
});

test("meeting roster sort reuses configured authority and title rules", async () => {
  const attendees = [
    {
      id: "company",
      name: "企业人员",
      unit: "示例科技有限公司",
      department: "",
      title: "总经理",
    },
    {
      id: "government-deputy",
      name: "政府副职",
      unit: "宁波市人民政府",
      department: "",
      title: "副主任",
    },
    {
      id: "government-principal",
      name: "政府正职",
      unit: "宁波市人民政府",
      department: "",
      title: "主任",
    },
  ];
  const meeting = createMeeting(baseInput, { attendees });
  const saved: MeetingRecord[] = [];

  const result = await executeConfirmedPlan(
    plan([
      {
        type: "meeting.roster.sort",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
        rosterRules: cloneAdminConfig(DEFAULT_ADMIN_CONFIG).rosterRules,
      },
    ]),
    {
      loadMeetings: () => [meeting],
      saveMeeting: (next) => {
        saved.push(next);
        return next;
      },
    },
  );

  assert.deepEqual(
    saved[0].attendees.map((attendee) => attendee.id),
    ["government-principal", "government-deputy", "company"],
  );
  assert.deepEqual(result.sortedMeetingIds, [meeting.id]);
});

test("meeting roster export validates, ranks, builds xlsx and reports its file", async () => {
  const attendees = [
    {
      id: "company",
      name: "企业人员",
      unit: "示例科技有限公司",
      department: "市场部",
      title: "总经理",
      source: "通讯录",
    },
    {
      id: "government-deputy",
      name: "政府副职",
      unit: "宁波市人民政府",
      department: "办公室",
      title: "副主任",
      source: "名单",
    },
    {
      id: "government-principal",
      name: "政府正职",
      unit: "宁波市人民政府",
      department: "办公室",
      title: "主任",
      source: "名单",
    },
  ];
  const meeting = createMeeting(baseInput, { attendees });
  const rosterRules = cloneAdminConfig(DEFAULT_ADMIN_CONFIG).rosterRules;
  const exports: AssistantRosterExportPayload[] = [];
  const workbooks: ArrayBuffer[] = [];
  const saved: MeetingRecord[] = [];
  const exportAction = {
    type: "meeting.roster.export" as const,
    meetingId: meeting.id,
    expectedUpdatedAt: meeting.updatedAt,
    rosterRules,
  };

  assert.equal(assistantPlanRequiresConfirmation(plan([exportAction])), true);
  const result = await executeConfirmedPlan(plan([exportAction]), {
    loadMeetings: () => [meeting],
    saveMeeting: (next) => {
      saved.push(next);
      return next;
    },
    exportRoster: async (payload) => {
      exports.push(payload);
      workbooks.push(await buildAssistantRosterXlsx(payload));
      return payload.fileName;
    },
  });

  const captured = exports[0];
  const workbookBytes = workbooks[0];
  assert.ok(captured);
  assert.ok(workbookBytes);
  assert.deepEqual(
    captured.records.map((attendee) => attendee.id),
    ["government-principal", "government-deputy", "company"],
  );
  assert.match(captured.fileName, /测试交流会.*\.xlsx$/);
  assert.deepEqual(result.exportedRosterFiles, [captured.fileName]);
  assert.deepEqual(result.updatedMeetingIds, [meeting.id]);
  assert.equal(saved[0].rosterRequired, true);

  const workbook = XLSX.read(workbookBytes, { type: "array" });
  assert.equal(workbook.SheetNames[0], rosterRules.worksheetName);
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Array<string | number>>(worksheet, {
    header: 1,
    defval: "",
  });
  assert.deepEqual(
    rows[0],
    rosterRules.outputFields
      .filter((field) => field.enabled)
      .map((field) => field.label),
  );
  assert.equal(rows[1][1], "政府正职");
  assert.equal(rows[2][1], "政府副职");
  assert.equal(rows[3][1], "企业人员");
});

test("stale roster export is blocked before download", async () => {
  const meeting = fixtureMeeting();
  let exports = 0;
  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.roster.export",
          meetingId: meeting.id,
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
          rosterRules: cloneAdminConfig(DEFAULT_ADMIN_CONFIG).rosterRules,
        },
      ]),
      {
        loadMeetings: () => [meeting],
        exportRoster: () => {
          exports += 1;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_MEETING",
  );
  assert.equal(exports, 0);

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "meeting.roster.export",
            meetingId: meeting.id,
            expectedUpdatedAt: meeting.updatedAt,
            rosterRules: cloneAdminConfig(DEFAULT_ADMIN_CONFIG).rosterRules,
          },
          {
            type: "meeting.update_fields",
            meetingId: meeting.id,
            expectedUpdatedAt: meeting.updatedAt,
            patch: { owner: "新负责人" },
          },
        ]),
      ),
    /名单导出不能与其他会议写入混在同一次计划中/,
  );
});

test("meeting deletion validates revision and reports the deleted id", async () => {
  const meeting = fixtureMeeting();
  const deleted: string[] = [];
  const visited: string[] = [];
  const result = await executeConfirmedPlan(
    plan([
      {
        type: "meeting.delete",
        meetingId: meeting.id,
        expectedUpdatedAt: meeting.updatedAt,
      },
      { type: "navigate", destination: "meetings" },
    ]),
    {
      loadMeetings: () => [meeting],
      deleteMeeting: (id) => {
        deleted.push(id);
      },
      navigate: (path) => {
        visited.push(path);
      },
    },
  );

  assert.deepEqual(deleted, [meeting.id]);
  assert.deepEqual(result.deletedMeetingIds, [meeting.id]);
  assert.deepEqual(visited, ["/meetings"]);

  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "meeting.delete",
          meetingId: meeting.id,
          expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
        },
      ]),
      {
        loadMeetings: () => [meeting],
        deleteMeeting: () => {
          throw new Error("must not run");
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_MEETING",
  );
});

test("contact create update and delete batch is fully preflighted before writes", async () => {
  const first = fixtureContact({ id: "contact-first" });
  const second = fixtureContact({
    id: "contact-second",
    unit: "目标单位",
  });
  const writes: string[] = [];

  const result = await executeConfirmedPlan(
    plan([
      {
        type: "contact.update",
        contactId: first.id,
        expectedUpdatedAt: first.updatedAt,
        patch: { unit: second.unit },
      },
      {
        type: "contact.delete",
        contactId: second.id,
        expectedUpdatedAt: second.updatedAt,
      },
      {
        type: "contact.create",
        input: {
          name: "王五",
          unit: "新单位",
          department: "办公室",
          title: "主任",
        },
      },
    ]),
    {
      loadMeetings: () => [],
      loadContacts: () => [first, second],
      deleteContact: (id) => {
        writes.push(`delete:${id}`);
      },
      updateContact: (id, input) => {
        writes.push(`update:${id}:${input.unit}`);
        return { ...first, ...input, id };
      },
      createContact: (input) => {
        writes.push(`create:${input.name}`);
        return fixtureContact({ ...input, id: "contact-created" });
      },
    },
  );

  assert.deepEqual(writes, [
    "delete:contact-second",
    "update:contact-first:目标单位",
    "create:王五",
  ]);
  assert.deepEqual(result.deletedContactIds, [second.id]);
  assert.deepEqual(result.updatedContactIds, [first.id]);
  assert.deepEqual(result.createdContactIds, ["contact-created"]);
});

test("contact batch duplicate detection prevents every writer", async () => {
  let writes = 0;
  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "contact.create",
          input: {
            name: "同名",
            unit: "同单位",
            department: "",
            title: "",
          },
        },
        {
          type: "contact.create",
          input: {
            name: "同名",
            unit: "同单位",
            department: "另一个部门",
            title: "经理",
          },
        },
      ]),
      {
        loadMeetings: () => [],
        loadContacts: () => [],
        createContact: (input) => {
          writes += 1;
          return fixtureContact(input);
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "CONTACT_ALREADY_EXISTS",
  );
  assert.equal(writes, 0);
});

test("admin config patch deep-merges and publishes as an isolated action", async () => {
  const current = cloneAdminConfig(DEFAULT_ADMIN_CONFIG);
  const saves: Array<{
    expectedRevision: number;
    summary: string;
    config: typeof current;
  }> = [];
  const result = await executeConfirmedPlan(
    plan([
      {
        type: "admin.config.patch",
        expectedRevision: 7,
        summary: "调整默认负责人和提醒",
        patch: {
          organization: { defaultOwner: "综合办" },
          meetingRules: { reminders: { blockedTasks: false } },
        },
      },
    ]),
    {
      loadMeetings: () => [],
      loadAdminConfig: () => ({ revision: 7, config: current }),
      saveAdminConfig: (input) => {
        saves.push(input);
        return { revision: 8, config: input.config };
      },
    },
  );

  assert.equal(saves.length, 1);
  assert.equal(saves[0].config.organization.defaultOwner, "综合办");
  assert.equal(saves[0].config.organization.name, current.organization.name);
  assert.equal(saves[0].config.meetingRules.reminders.blockedTasks, false);
  assert.equal(saves[0].config.meetingRules.reminders.overdueTasks, true);
  assert.equal(result.adminUpdated, true);
  assert.equal(result.adminRevision, 8);

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "admin.config.patch",
            expectedRevision: 7,
            summary: "非法字段",
            patch: { organization: { apiKey: "secret" } } as never,
          },
        ]),
      ),
    /不支持此字段/,
  );
  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "admin.config.patch",
            expectedRevision: 7,
            summary: "不能混合导航",
            patch: { organization: { defaultOwner: "综合办" } },
          },
          { type: "navigate", destination: "admin" },
        ]),
      ),
    /后台配置写入必须作为单独计划确认/,
  );
});

test("stale admin config blocks publishing", async () => {
  let writes = 0;
  await assert.rejects(
    executeConfirmedPlan(
      plan([
        {
          type: "admin.config.patch",
          expectedRevision: 3,
          summary: "修改默认负责人",
          patch: { organization: { defaultOwner: "综合办" } },
        },
      ]),
      {
        loadMeetings: () => [],
        loadAdminConfig: () => ({
          revision: 4,
          config: cloneAdminConfig(DEFAULT_ADMIN_CONFIG),
        }),
        saveAdminConfig: (input) => {
          writes += 1;
          return { revision: 5, config: input.config };
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_ADMIN_CONFIG",
  );
  assert.equal(writes, 0);
});

test("roster workspace commands are strict and every command needs confirmation", () => {
  const commands: RosterWorkspaceCommand[] = [
    {
      type: "roster.workspace.set_text",
      expectedRevision: 4,
      text: "李四 示例单位 经理",
    },
    { type: "roster.workspace.process", expectedRevision: 4 },
    {
      type: "roster.workspace.record.update",
      expectedRevision: 4,
      recordId: "workspace-record-1",
      patch: { title: "副主任" },
    },
    {
      type: "roster.workspace.record.add",
      expectedRevision: 4,
      record: {
        name: "王五",
        unit: "示例单位",
        department: "",
        title: "经理",
      },
    },
    {
      type: "roster.workspace.record.remove",
      expectedRevision: 4,
      recordId: "workspace-record-1",
    },
    {
      type: "roster.workspace.alias.apply",
      expectedRevision: 4,
      aliasId: "workspace-alias-1",
    },
    { type: "roster.workspace.confirm", expectedRevision: 4 },
    { type: "roster.workspace.analyze_ranking", expectedRevision: 4 },
    {
      type: "roster.workspace.enrich_person",
      expectedRevision: 4,
      recordId: "workspace-record-1",
    },
    { type: "roster.workspace.save_to_meeting", expectedRevision: 4 },
    { type: "roster.workspace.export", expectedRevision: 4 },
  ];

  for (const command of commands) {
    const parsed = parseAssistantPlan(plan([command]));
    assert.equal(parsed.actions[0].type, command.type);
    assert.equal(assistantPlanRequiresConfirmation(parsed), true);
  }

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "roster.workspace.record.update",
            expectedRevision: 4,
            recordId: "workspace-record-1",
            patch: { phone: "123" } as never,
          },
        ]),
      ),
    /不支持修改此字段/,
  );
  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          { type: "roster.workspace.process", expectedRevision: 4 },
          { type: "roster.workspace.confirm", expectedRevision: 4 },
        ]),
      ),
    /仅名单记录新增、修改和删除可以批量执行/,
  );
});

test("roster workspace record edits execute as one preflighted batch", async () => {
  const commands: RosterWorkspaceCommand[] = [
    {
      type: "roster.workspace.record.update",
      expectedRevision: 4,
      recordId: "workspace-record-1",
      patch: { title: "副主任" },
    },
    {
      type: "roster.workspace.record.add",
      expectedRevision: 4,
      record: {
        name: "王五",
        unit: "示例单位",
        department: "市场部",
        title: "经理",
      },
    },
  ];
  let received: readonly RosterWorkspaceCommand[] = [];
  const result = await executeConfirmedPlan(plan(commands), {
    loadMeetings: () => [],
    getRosterWorkspaceSnapshot: () => fixtureWorkspaceSnapshot(),
    executeRosterWorkspace: (nextCommands) => {
      received = nextCommands;
      return {
        revision: 5,
        commandTypes: nextCommands.map((command) => command.type),
        affectedRecordIds: ["workspace-record-1", "workspace-record-2"],
        message: "已批量更新 2 条名单记录",
        exportedFileName: null,
      };
    },
  });

  assert.deepEqual(received, commands);
  assert.deepEqual(result.rosterWorkspaceResult, {
    revision: 5,
    commandTypes: commands.map((command) => command.type),
    affectedRecordIds: ["workspace-record-1", "workspace-record-2"],
    message: "已批量更新 2 条名单记录",
    exportedFileName: null,
  });
  assert.deepEqual(result.updatedMeetingIds, []);
});

test("roster workspace stale revisions and mixed data writes are blocked", async () => {
  let executes = 0;
  await assert.rejects(
    executeConfirmedPlan(
      plan([{ type: "roster.workspace.export", expectedRevision: 3 }]),
      {
        loadMeetings: () => [],
        getRosterWorkspaceSnapshot: () => fixtureWorkspaceSnapshot(),
        executeRosterWorkspace: () => {
          executes += 1;
          return {
            revision: 4,
            commandTypes: ["roster.workspace.export"],
            affectedRecordIds: [],
            message: "已导出",
            exportedFileName: "名单.xlsx",
          };
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "STALE_ROSTER_WORKSPACE",
  );
  assert.equal(executes, 0);

  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          { type: "roster.workspace.confirm", expectedRevision: 4 },
          {
            type: "contact.create",
            input: {
              name: "赵六",
              unit: "示例单位",
              department: "",
              title: "",
            },
          },
        ]),
      ),
    /不能与会议、通讯录或后台配置写入混合执行/,
  );
});

test("roster workspace bridge validators enforce truncation and atomic batches", () => {
  assert.deepEqual(
    validateRosterWorkspaceSnapshot(fixtureWorkspaceSnapshot()),
    fixtureWorkspaceSnapshot(),
  );
  assert.throws(
    () =>
      validateRosterWorkspaceSnapshot(
        fixtureWorkspaceSnapshot({ recordTotal: 2, truncated: false }),
      ),
    /records 数量与 recordTotal 不一致/,
  );
  assert.throws(
    () =>
      validateRosterWorkspaceCommands([
        { type: "roster.workspace.process", expectedRevision: 4 },
        { type: "roster.workspace.confirm", expectedRevision: 4 },
      ]),
    /仅名单记录新增、修改和删除可以批量执行/,
  );
  assert.throws(
    () =>
      validateRosterWorkspaceCommands([
        {
          type: "roster.workspace.record.update",
          expectedRevision: 4,
          recordId: "workspace-record-1",
          patch: { title: "主任" },
        },
        {
          type: "roster.workspace.record.remove",
          expectedRevision: 4,
          recordId: "workspace-record-1",
        },
      ]),
    /不能重复修改或删除同一条记录/,
  );
});

test("composition rules prevent partial cross-meeting writes", () => {
  const first = fixtureMeeting();
  const second = fixtureMeeting();
  assert.throws(
    () =>
      parseAssistantPlan(
        plan([
          {
            type: "meeting.update_fields",
            meetingId: first.id,
            expectedUpdatedAt: first.updatedAt,
            patch: { owner: "甲" },
          },
          {
            type: "meeting.update_fields",
            meetingId: second.id,
            expectedUpdatedAt: second.updatedAt,
            patch: { owner: "乙" },
          },
        ]),
      ),
    /一次计划只能修改同一场会议/,
  );
});

test("meeting lifecycle actions are confirmed, state-checked and executed", async () => {
  const active = fixtureMeeting();
  const archived = {
    ...active,
    archivedAt: "2030-08-21T08:00:00.000Z",
    updatedAt: "2030-08-21T08:00:00.000Z",
  };
  const deleted = {
    ...active,
    deletedAt: "2030-08-22T08:00:00.000Z",
    updatedAt: "2030-08-22T08:00:00.000Z",
  };
  const calls: string[] = [];

  const archivedResult = await executeConfirmedPlan(
    plan([{
      type: "meeting.archive",
      meetingId: active.id,
      expectedUpdatedAt: active.updatedAt,
    }]),
    {
      loadMeetings: () => [active],
      archiveMeeting: (id) => { calls.push(`archive:${id}`); },
    },
  );
  assert.deepEqual(archivedResult.archivedMeetingIds, [active.id]);

  const restoredArchiveResult = await executeConfirmedPlan(
    plan([{
      type: "meeting.restore_archived",
      meetingId: archived.id,
      expectedUpdatedAt: archived.updatedAt,
    }]),
    {
      loadMeetings: () => [archived],
      restoreArchivedMeeting: (id) => { calls.push(`restore-archive:${id}`); },
    },
  );
  assert.deepEqual(restoredArchiveResult.restoredMeetingIds, [active.id]);

  const restoredDeletedResult = await executeConfirmedPlan(
    plan([{
      type: "meeting.restore_deleted",
      meetingId: deleted.id,
      expectedUpdatedAt: deleted.updatedAt,
    }]),
    {
      loadMeetings: () => [deleted],
      restoreDeletedMeeting: (id) => { calls.push(`restore-trash:${id}`); },
    },
  );
  assert.deepEqual(restoredDeletedResult.restoredMeetingIds, [active.id]);

  const purgedResult = await executeConfirmedPlan(
    plan([{
      type: "meeting.purge",
      meetingId: deleted.id,
      expectedUpdatedAt: deleted.updatedAt,
    }]),
    {
      loadMeetings: () => [deleted],
      purgeMeeting: (id) => { calls.push(`purge:${id}`); },
    },
  );
  assert.deepEqual(purgedResult.purgedMeetingIds, [active.id]);

  const saved: MeetingRecord[] = [];
  const duplicatedResult = await executeConfirmedPlan(
    plan([{
      type: "meeting.duplicate",
      meetingId: active.id,
      expectedUpdatedAt: active.updatedAt,
    }]),
    {
      loadMeetings: () => [active],
      saveMeeting: (meeting) => {
        saved.push(meeting);
        return meeting;
      },
    },
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].meetingRoomId, undefined);
  assert.deepEqual(duplicatedResult.duplicatedMeetingIds, [saved[0].id]);
  assert.equal(
    assistantPlanRequiresConfirmation(
      plan([{
        type: "meeting.archive",
        meetingId: active.id,
        expectedUpdatedAt: active.updatedAt,
      }]),
    ),
    true,
  );
  assert.deepEqual(calls, [
    `archive:${active.id}`,
    `restore-archive:${active.id}`,
    `restore-trash:${active.id}`,
    `purge:${active.id}`,
  ]);
});

test("assistant meeting writes cannot bypass configured room conflicts", async () => {
  const existing = createMeeting({
    ...baseInput,
    title: "已占用会议",
    date: "2030-08-20",
    startTime: "10:00",
    endTime: "11:00",
    meetingRoomId: "room-a",
  });
  let writes = 0;

  await assert.rejects(
    executeConfirmedPlan(
      plan([{
        type: "meeting.create",
        input: {
          ...baseInput,
          title: "时间冲突会议",
          date: "2030-08-20",
          startTime: "10:30",
          endTime: "11:30",
          meetingRoomId: "room-a",
        },
      }]),
      {
        loadMeetings: () => [existing],
        meetingRooms: [
          { id: "room-a", name: "第一会议室", capacity: 30, enabled: true },
        ],
        saveMeeting: (meeting) => {
          writes += 1;
          return meeting;
        },
      },
    ),
    (error: unknown) =>
      error instanceof AssistantExecutionError &&
      error.code === "MEETING_ROOM_CONFLICT",
  );
  assert.equal(writes, 0);
});
