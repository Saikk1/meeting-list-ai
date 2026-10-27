import assert from "node:assert/strict";
import test from "node:test";
import { syncMeetingContacts } from "../app/lib/contacts";
import {
  CHECKLIST_TEMPLATE,
  createMeeting,
  DEFAULT_MEETING_RULES,
  findMeetingRoomConflicts,
  getMeetingWarnings,
  localDateValue,
  loadMeetings,
  MEETING_STORAGE_KEY,
  meetingProgress,
  normalizeMeetingAttendees,
  phaseProgress,
  replaceMeetingAttendees,
  saveMeeting,
  setMeetingRosterRequired,
  updateMeetingFields,
  updateMeetingTask,
  validateMeetingInput,
  type ChecklistTemplateItem,
  type MeetingAttendee,
  type MeetingInput,
  type MeetingRules,
} from "../app/lib/meeting-data";

const baseMeeting: MeetingInput = {
  title: "测试会议",
  date: "2030-08-20",
  startTime: "14:00",
  location: "大会议室",
  organizer: "测试部门",
  owner: "会务小组",
  attendeeEstimate: 20,
  afternoonMeeting: true,
  mealType: "business",
  alcoholRequired: true,
  parkingRequired: true,
  vehicleCount: 3,
  publicityRequired: true,
  reimbursementRequired: true,
  presentationRequired: true,
  welcomeScreenRequired: true,
  roomSize: "large",
};

test("the built-in source checklist includes the meeting plan preparation step", () => {
  assert.equal(CHECKLIST_TEMPLATE.length, 30);
  assert.ok(CHECKLIST_TEMPLATE.some((item) => item.id === "prepare-meeting-plan" && item.phase === "before"));
  assert.equal(new Set(CHECKLIST_TEMPLATE.map((item) => item.id)).size, CHECKLIST_TEMPLATE.length);
});

test("local meeting dates do not shift through UTC conversion", () => {
  assert.equal(
    localDateValue(new Date(2026, 6, 31, 0, 30, 0)),
    "2026-07-31",
  );
});

test("manual meeting creation and assistant writes share the same time validation", () => {
  const invalid = {
    ...baseMeeting,
    startTime: "11:00",
    endTime: "09:30",
  };
  assert.equal(
    validateMeetingInput(invalid).some(
      (issue) => issue.field === "endTime" && issue.severity === "error",
    ),
    true,
  );
  assert.throws(() => createMeeting(invalid), /结束时间必须晚于开始时间/);
});

test("meeting-room conflicts use the configured room identity and overlapping time", () => {
  const existing = createMeeting({
    ...baseMeeting,
    date: "2030-09-01",
    startTime: "09:00",
    endTime: "10:30",
    meetingRoomId: "room-one",
  });
  const conflicts = findMeetingRoomConflicts(
    {
      ...baseMeeting,
      date: "2030-09-01",
      startTime: "10:00",
      endTime: "11:00",
      meetingRoomId: "room-one",
    },
    [existing],
  );
  assert.deepEqual(conflicts.map((meeting) => meeting.id), [existing.id]);
  assert.equal(
    findMeetingRoomConflicts(
      {
        ...baseMeeting,
        date: "2030-09-01",
        startTime: "10:30",
        endTime: "11:00",
        meetingRoomId: "room-one",
      },
      [existing],
    ).length,
    0,
  );
});

test("editing a meeting adds newly applicable tasks and rebases untouched deadlines", () => {
  const original = createMeeting({
    ...baseMeeting,
    date: "2030-10-10",
    parkingRequired: false,
    vehicleCount: 0,
  });
  const originalTask = original.tasks.find(
    (task) => task.templateId === "room-booking",
  );
  const updated = updateMeetingFields(original, {
    date: "2030-10-12",
    parkingRequired: true,
    vehicleCount: 2,
  });
  assert.ok(
    updated.tasks.some((task) => task.templateId === "parking-license-report"),
  );
  const updatedTask = updated.tasks.find(
    (task) => task.templateId === "room-booking",
  );
  assert.notEqual(updatedTask?.dueDate, originalTask?.dueDate);
});

test("meeting scenarios instantiate only applicable tasks", () => {
  const full = createMeeting(baseMeeting);
  assert.ok(full.tasks.some((task) => task.templateId === "parking-license-report"));
  assert.ok(full.tasks.some((task) => task.templateId === "business-meal-alcohol"));
  assert.ok(full.tasks.some((task) => task.templateId === "water-service"));
  assert.ok(full.tasks.some((task) => task.sopImages?.length));

  const simple = createMeeting({
    ...baseMeeting,
    afternoonMeeting: false,
    mealType: "none",
    alcoholRequired: false,
    parkingRequired: false,
    publicityRequired: false,
    reimbursementRequired: false,
    presentationRequired: false,
    welcomeScreenRequired: false,
    roomSize: "small",
  });
  assert.ok(simple.tasks.length < full.tasks.length);
  assert.equal(
    simple.tasks.some((task) => task.templateId === "parking-license-report"),
    false,
  );
  assert.equal(
    simple.tasks.some((task) => task.templateId === "kingdee-submit"),
    false,
  );
});

test("named roster workflow is optional and controls its tasks and warning", () => {
  const withoutRoster = createMeeting({
    ...baseMeeting,
    rosterRequired: false,
  });
  assert.equal(withoutRoster.rosterRequired, false);
  assert.equal(
    withoutRoster.tasks.some((task) => task.templateId === "print-nameplates"),
    false,
  );
  assert.equal(
    withoutRoster.tasks.some((task) => task.templateId === "seat-order"),
    false,
  );
  assert.equal(
    withoutRoster.tasks.some(
      (task) => task.templateId === "electronic-nameplate",
    ),
    false,
  );
  assert.equal(
    getMeetingWarnings(withoutRoster).some((warning) =>
      warning.includes("参会名单"),
    ),
    false,
  );

  const withRoster = createMeeting({
    ...baseMeeting,
    rosterRequired: true,
  });
  assert.equal(withRoster.rosterRequired, true);
  assert.ok(
    withRoster.tasks.some((task) => task.templateId === "print-nameplates"),
  );
  assert.ok(
    getMeetingWarnings(withRoster).some((warning) =>
      warning.includes("参会名单"),
    ),
  );
});

test("enabling a roster later adds only missing roster tasks", () => {
  const meeting = createMeeting({ ...baseMeeting, rosterRequired: false });
  const enabled = setMeetingRosterRequired(meeting, true);
  const enabledAgain = setMeetingRosterRequired(enabled, true);

  assert.equal(enabled.rosterRequired, true);
  assert.ok(enabled.tasks.some((task) => task.templateId === "seat-order"));
  assert.equal(
    enabledAgain.tasks.filter((task) => task.templateId === "seat-order").length,
    1,
  );
});

test("disabled checklist items are not instantiated", () => {
  const templates: ChecklistTemplateItem[] = CHECKLIST_TEMPLATE.map(
    (item) => ({
      ...item,
      enabled: item.id !== "equipment-test",
    }),
  );
  const meeting = createMeeting(baseMeeting, {
    checklistTemplates: templates,
    configRevision: 3,
    meetingRules: DEFAULT_MEETING_RULES,
  });

  assert.equal(
    meeting.tasks.some((task) => task.templateId === "equipment-test"),
    false,
  );
  assert.equal(meeting.templateSource?.configRevision, 3);
  assert.equal(
    meeting.templateSource?.checklistTemplates.find(
      (item) => item.id === "equipment-test",
    )?.enabled,
    false,
  );
});

test("created meetings keep isolated template and rule snapshots", () => {
  const templates: ChecklistTemplateItem[] = CHECKLIST_TEMPLATE.map(
    (item) => ({ ...item }),
  );
  const rules: MeetingRules = {
    ...DEFAULT_MEETING_RULES,
    parkingVehicleLimit: 2,
    businessMealMin: 188,
    businessMealMax: 388,
    waterServiceIntervalMinutes: 12,
    reminders: { ...DEFAULT_MEETING_RULES.reminders },
  };
  const meeting = createMeeting(
    { ...baseMeeting, vehicleCount: 3 },
    {
      checklistTemplates: templates,
      configRevision: 11,
      meetingRules: rules,
    },
  );
  const originalTitle = meeting.tasks[0].title;

  templates[0].title = "后来修改的标题";
  templates[0].enabled = false;
  rules.parkingVehicleLimit = 99;

  assert.equal(meeting.tasks[0].title, originalTitle);
  assert.equal(
    meeting.templateSource?.checklistTemplates[0].title,
    originalTitle,
  );
  assert.equal(meeting.templateSource?.checklistTemplates[0].enabled, true);
  assert.equal(meeting.ruleSnapshot?.parkingVehicleLimit, 2);
  assert.ok(
    meeting.tasks
      .find((task) => task.templateId === "business-meal-application")
      ?.description.includes("人均188—388元"),
  );
  assert.ok(
    meeting.tasks
      .find((task) => task.templateId === "parking-license-report")
      ?.description.includes("最多报备2辆车"),
  );
  assert.ok(
    meeting.tasks
      .find((task) => task.templateId === "water-service")
      ?.title.includes("每12分钟加水"),
  );
  assert.ok(
    getMeetingWarnings(meeting).some((warning) =>
      warning.includes("最多报备2辆"),
    ),
  );

  const laterMeeting = createMeeting(baseMeeting, {
    checklistTemplates: templates,
    configRevision: 12,
    meetingRules: rules,
  });
  assert.equal(
    laterMeeting.tasks.some(
      (task) => task.templateId === templates[0].id,
    ),
    false,
  );
  assert.equal(meeting.tasks[0].title, originalTitle);
});

test("selected directory contacts are copied into a new meeting snapshot", () => {
  const attendees: MeetingAttendee[] = [
    {
      id: "contact-zhang-san",
      name: "张三",
      unit: "宁波示例单位",
      department: "综合部",
      title: "主任",
      source: "人员通讯录",
    },
  ];
  const meeting = createMeeting(baseMeeting, { attendees });

  attendees[0].title = "后来修改的职务";

  assert.equal(meeting.attendees.length, 1);
  assert.equal(meeting.attendees[0].title, "主任");
  assert.notEqual(meeting.attendees[0], attendees[0]);
});

test("recorded attendees stay independent from formal roster governance", () => {
  const meeting = createMeeting(
    { ...baseMeeting, rosterRequired: false },
    {
      attendees: [
        {
          id: "name-only",
          name: "张三",
          unit: "",
          department: "",
          title: "",
          source: "手动录入",
        },
      ],
    },
  );

  assert.equal(meeting.attendees.length, 1);
  assert.equal(meeting.rosterRequired, false);
  assert.equal(
    meeting.tasks.some((task) => task.templateId === "print-nameplates"),
    false,
  );

  const enabled = replaceMeetingAttendees(meeting, meeting.attendees, {
    enableRosterWorkflow: true,
  });
  const disabled = setMeetingRosterRequired(enabled, false);
  assert.equal(enabled.rosterRequired, true);
  assert.equal(disabled.rosterRequired, false);
  assert.equal(disabled.attendees[0].name, "张三");
});

test("meeting attendee normalization allows missing units and rejects duplicates", () => {
  const normalized = normalizeMeetingAttendees([
    {
      id: "person-one",
      name: " 张 三 ",
      unit: "",
      department: "",
      title: "",
      source: "",
    },
    {
      id: "blank-row",
      name: "",
      unit: "",
      department: "",
      title: "",
    },
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].name, "张三");
  assert.equal(normalized[0].unit, "");
  assert.equal(normalized[0].source, "手动录入");

  assert.throws(
    () =>
      normalizeMeetingAttendees([
        normalized[0],
        { ...normalized[0], id: "person-two" },
      ]),
    /重复/,
  );
});

test("contact sync skips name-only attendees without blocking complete people", async () => {
  const meeting = createMeeting(baseMeeting, {
    attendees: [
      {
        id: "complete-person",
        name: "李四",
        unit: "宁波示例单位",
        department: "办公室",
        title: "主任",
      },
      {
        id: "name-only-person",
        name: "王五",
        unit: "",
        department: "",
        title: "",
      },
    ],
  });
  const originalFetch = globalThis.fetch;
  let sentContacts: unknown[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      contacts?: unknown[];
    };
    sentContacts = body.contacts ?? [];
    return new Response(JSON.stringify({ upserted: 1, total: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await syncMeetingContacts(meeting);
    assert.equal(result.synced, 1);
    assert.equal(result.skipped, 1);
    assert.equal(sentContacts.length, 1);
    assert.equal(
      (sentContacts[0] as { name: string }).name,
      "李四",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("meeting reminder switches control every optional warning", () => {
  const meeting = createMeeting(
    {
      ...baseMeeting,
      date: "2000-01-01",
      location: "",
      owner: "",
    },
    {
      meetingRules: {
        ...DEFAULT_MEETING_RULES,
        reminders: {
          missingLocation: false,
          missingOwner: false,
          missingRoster: false,
          overdueTasks: false,
          blockedTasks: false,
        },
      },
    },
  );
  meeting.tasks[0].status = "blocked";

  assert.deepEqual(getMeetingWarnings(meeting), []);
});

test("legacy meetings can use current rules as a warning fallback", () => {
  const legacyMeeting = createMeeting({
    ...baseMeeting,
    vehicleCount: 5,
  });
  delete legacyMeeting.ruleSnapshot;
  const currentRules: MeetingRules = {
    ...DEFAULT_MEETING_RULES,
    parkingVehicleLimit: 6,
    reminders: { ...DEFAULT_MEETING_RULES.reminders },
  };

  assert.equal(
    getMeetingWarnings(legacyMeeting, currentRules).some((warning) =>
      warning.includes("超过当前最多报备"),
    ),
    false,
  );
});

test("progress and rule warnings are deterministic", () => {
  const meeting = createMeeting({
    ...baseMeeting,
    vehicleCount: 6,
  });
  assert.equal(meetingProgress(meeting).percent, 0);
  assert.ok(
    getMeetingWarnings(meeting).some((warning) => warning.includes("超过")),
  );

  const completed = updateMeetingTask(meeting, meeting.tasks[0].id, {
    status: "done",
  });
  assert.ok(meetingProgress(completed).percent > 0);
  assert.ok(phaseProgress(completed, meeting.tasks[0].phase) > 0);
});

test("an empty meeting or phase is complete because no work is applicable", () => {
  const meeting = createMeeting(baseMeeting);
  meeting.tasks = meeting.tasks.filter((task) => task.phase !== "after");
  assert.equal(phaseProgress(meeting, "after"), 100);

  meeting.tasks = [];
  assert.deepEqual(meetingProgress(meeting), {
    completed: 0,
    total: 0,
    percent: 100,
  });
});

test("saving a meeting publishes a fresh snapshot for reactive pages", () => {
  const values = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
      removeItem(key: string) {
        values.delete(key);
      },
    },
    dispatchEvent() {
      return true;
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    values.delete(MEETING_STORAGE_KEY);
    const before = loadMeetings();
    saveMeeting(createMeeting(baseMeeting));
    const after = loadMeetings();

    assert.notStrictEqual(after, before);
    assert.equal(after.length, 1);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", previousWindow);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
});
