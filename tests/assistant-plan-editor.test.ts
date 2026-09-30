import assert from "node:assert/strict";
import test from "node:test";
import {
  applyMeetingCreatePatch,
  AssistantPlanEditError,
  buildAssistantCreateMeetingPlan,
} from "../app/lib/assistant-plan-editor";
import {
  parseAssistantPlan,
  type AssistantMeetingInput,
  type AssistantPlan,
} from "../app/lib/assistant-contract";

const baseInput: AssistantMeetingInput = {
  title: "市场部部门例会",
  date: "2030-08-04",
  startTime: "09:30",
  endTime: "11:30",
  location: "小会议室",
  organizer: "会务智办",
  owner: "会务小组",
  attendeeEstimate: 5,
  rosterRequired: false,
  afternoonMeeting: false,
  mealType: "business",
  alcoholRequired: true,
  parkingRequired: true,
  vehicleCount: 3,
  publicityRequired: false,
  reimbursementRequired: false,
  presentationRequired: true,
  welcomeScreenRequired: false,
  roomSize: "small",
};

test("assistant plans preserve the optional named-roster choice", () => {
  const createPlan = parseAssistantPlan({
    schemaVersion: 1,
    summary: "创建需要实名名单的会议",
    clarification: null,
    warnings: [],
    actions: [
      {
        type: "meeting.create",
        input: { ...baseInput, rosterRequired: true },
      },
    ],
  });
  const createAction = createPlan.actions[0];
  assert.equal(
    createAction.type === "meeting.create"
      ? createAction.input.rosterRequired
      : null,
    true,
  );

  const updatePlan = parseAssistantPlan({
    schemaVersion: 1,
    summary: "关闭实名名单",
    clarification: null,
    warnings: [],
    actions: [
      {
        type: "meeting.update_fields",
        meetingId: "meeting-1",
        expectedUpdatedAt: "2030-08-01T00:00:00.000Z",
        patch: { rosterRequired: false },
      },
    ],
  });
  const updateAction = updatePlan.actions[0];
  assert.equal(
    updateAction.type === "meeting.update_fields"
      ? updateAction.patch.rosterRequired
      : null,
    false,
  );
});

test("assistant plans preserve configured meeting-room snapshots", () => {
  const plan = parseAssistantPlan({
    schemaVersion: 1,
    summary: "选择三楼大会议室",
    clarification: null,
    warnings: [],
    actions: [
      {
        type: "meeting.create",
        input: {
          ...baseInput,
          location: "三楼大会议室（三楼东侧）",
          meetingRoomId: "room-1",
          roomRequirements: "会前打开中控",
          roomSize: "large",
        },
      },
    ],
  });
  const action = plan.actions[0];
  assert.equal(
    action.type === "meeting.create" ? action.input.meetingRoomId : null,
    "room-1",
  );
  assert.equal(
    action.type === "meeting.create" ? action.input.roomRequirements : null,
    "会前打开中控",
  );
});

function createPlan(
  actions: AssistantPlan["actions"] = [
    { type: "meeting.create", input: baseInput },
  ],
): AssistantPlan {
  return parseAssistantPlan({
    schemaVersion: 1,
    summary: "创建一场会议",
    clarification: null,
    warnings: [],
    actions,
  });
}

function createdInput(plan: AssistantPlan) {
  const action = plan.actions.find(
    (item) => item.type === "meeting.create",
  );
  assert.ok(action && action.type === "meeting.create");
  return action.input;
}

test("edits boolean settings while retaining a strictly parsed plan", () => {
  const edited = applyMeetingCreatePatch(createPlan(), {
    presentationRequired: false,
    welcomeScreenRequired: true,
    publicityRequired: true,
    reimbursementRequired: true,
  });

  assert.deepEqual(
    {
      presentationRequired: createdInput(edited).presentationRequired,
      welcomeScreenRequired: createdInput(edited).welcomeScreenRequired,
      publicityRequired: createdInput(edited).publicityRequired,
      reimbursementRequired: createdInput(edited).reimbursementRequired,
    },
    {
      presentationRequired: false,
      welcomeScreenRequired: true,
      publicityRequired: true,
      reimbursementRequired: true,
    },
  );
  assert.deepEqual(parseAssistantPlan(edited), edited);
});

test("builds a strictly parsed create plan from a ready local draft", () => {
  const draft = { ...baseInput };
  const built = buildAssistantCreateMeetingPlan(draft, {
    summary: "确认后创建市场部例会",
    warnings: ["会议室尚未锁定"],
  });

  assert.ok(built);
  assert.equal(built.summary, "确认后创建市场部例会");
  assert.deepEqual(built.warnings, ["会议室尚未锁定"]);
  assert.deepEqual(createdInput(built), baseInput);
  assert.deepEqual(parseAssistantPlan(built), built);
  assert.notStrictEqual(createdInput(built), draft);
});

test("returns null while the local draft identity is incomplete", () => {
  for (const draft of [
    { ...baseInput, title: "" },
    { ...baseInput, title: "   " },
    { ...baseInput, date: "" },
    { ...baseInput, startTime: "" },
  ]) {
    assert.equal(buildAssistantCreateMeetingPlan(draft), null);
  }
});

test("normalizes a ready local draft without mutating it", () => {
  const draft: AssistantMeetingInput = {
    ...baseInput,
    parkingRequired: false,
    vehicleCount: 8,
    mealType: "work",
    alcoholRequired: true,
  };
  const snapshot = structuredClone(draft);

  const built = buildAssistantCreateMeetingPlan(draft);

  assert.ok(built);
  assert.equal(createdInput(built).vehicleCount, 0);
  assert.equal(createdInput(built).alcoholRequired, false);
  assert.deepEqual(draft, snapshot);
});

test("normalizes alcohol when the meal is not a business meal", () => {
  const edited = applyMeetingCreatePatch(createPlan(), {
    mealType: "work",
  });

  assert.equal(createdInput(edited).mealType, "work");
  assert.equal(createdInput(edited).alcoholRequired, false);

  const contradictory = applyMeetingCreatePatch(createPlan(), {
    mealType: "none",
    alcoholRequired: true,
  });
  assert.equal(createdInput(contradictory).alcoholRequired, false);
});

test("normalizes vehicle count when parking is disabled", () => {
  const edited = applyMeetingCreatePatch(createPlan(), {
    parkingRequired: false,
  });

  assert.equal(createdInput(edited).parkingRequired, false);
  assert.equal(createdInput(edited).vehicleCount, 0);

  const contradictory = applyMeetingCreatePatch(createPlan(), {
    parkingRequired: false,
    vehicleCount: 20,
  });
  assert.equal(createdInput(contradictory).vehicleCount, 0);
});

test("accepts explicit afternoon, start-time and valid end-time edits", () => {
  const edited = applyMeetingCreatePatch(createPlan(), {
    afternoonMeeting: true,
    startTime: "14:00",
    endTime: "16:45",
  });

  assert.equal(createdInput(edited).afternoonMeeting, true);
  assert.equal(createdInput(edited).startTime, "14:00");
  assert.equal(createdInput(edited).endTime, "16:45");
});

test("strict revalidation rejects an invalid edited end time", () => {
  assert.throws(
    () =>
      applyMeetingCreatePatch(createPlan(), {
        endTime: "08:30",
      }),
    /结束时间必须晚于开始时间/,
  );
});

test("does not mutate the source plan or patch", () => {
  const source = createPlan();
  const snapshot = structuredClone(source);
  const patch = {
    parkingRequired: false,
    vehicleCount: 9,
    mealType: "none" as const,
    alcoholRequired: true,
  };
  const patchSnapshot = structuredClone(patch);

  const edited = applyMeetingCreatePatch(source, patch);

  assert.deepEqual(source, snapshot);
  assert.deepEqual(patch, patchSnapshot);
  assert.notStrictEqual(edited, source);
  assert.notStrictEqual(createdInput(edited), createdInput(source));
});

test("reports missing or ambiguous meeting-create actions clearly", () => {
  assert.throws(
    () =>
      applyMeetingCreatePatch(
        createPlan([{ type: "navigate", destination: "meetings" }]),
        { title: "不会生效" },
      ),
    (error: unknown) =>
      error instanceof AssistantPlanEditError &&
      /没有 meeting\.create/.test(error.message),
  );

  const duplicatePlan = {
    ...createPlan(),
    actions: [
      { type: "meeting.create" as const, input: { ...baseInput } },
      { type: "meeting.create" as const, input: { ...baseInput } },
    ],
  };
  assert.throws(
    () => applyMeetingCreatePatch(duplicatePlan, { title: "不会生效" }),
    (error: unknown) =>
      error instanceof AssistantPlanEditError &&
      /多个 meeting\.create/.test(error.message),
  );
});
