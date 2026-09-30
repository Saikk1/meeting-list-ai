import {
  ASSISTANT_PLAN_SCHEMA_VERSION,
  AssistantPlanValidationError,
  assistantActionRequiresConfirmation,
  parseAssistantPlan,
  parseAssistantDraftAttendees,
  parseMeetingVehicles,
  type AssistantAction,
  type AssistantMeetingInput,
} from "./assistant-contract";
import type { MeetingInput } from "./meeting-data";

export const MAX_ASSISTANT_CONVERSATION_MESSAGES = 40;
export const MAX_ASSISTANT_AGENT_ACTIONS = 100;

export type AssistantConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AssistantAgentActiveIntent =
  | "none"
  | "create_meeting"
  | "update_meeting"
  | "manage_tasks"
  | "manage_roster"
  | "manage_contacts"
  | "manage_admin"
  | "research"
  | "delete_record"
  | "navigate";

/**
 * The model may collect a meeting over several turns. Every field is optional;
 * the compiler combines it with the previous turn and the configured defaults.
 */
export type AssistantNewMeetingDraft = Partial<AssistantMeetingInput>;

export type AssistantWorkingMemory = {
  activeIntent: AssistantAgentActiveIntent;
  newMeetingDraft: AssistantNewMeetingDraft | null;
  selectedMeetingId: string | null;
};

export type AssistantCreateMeetingFromDraftAction = {
  type: "meeting.create_from_draft";
  draft: AssistantNewMeetingDraft;
};

export type AssistantAgentAction =
  | AssistantAction
  | AssistantCreateMeetingFromDraftAction;

export type AssistantAgentMode = "answer" | "clarification" | "preview";

export type AssistantAgentResponse = {
  reply: string;
  mode: AssistantAgentMode;
  assumptions: string[];
  actions: AssistantAgentAction[];
  memory: AssistantWorkingMemory;
  suggestions: string[];
};

export class AssistantAgentValidationError extends Error {
  constructor(
    message: string,
    readonly path = "response",
  ) {
    super(`${path}: ${message}`);
    this.name = "AssistantAgentValidationError";
  }
}

type PlainObject = Record<string, unknown>;

const ACTIVE_INTENTS = new Set<AssistantAgentActiveIntent>([
  "none",
  "create_meeting",
  "update_meeting",
  "manage_tasks",
  "manage_roster",
  "manage_contacts",
  "manage_admin",
  "research",
  "delete_record",
  "navigate",
]);
const MODES = new Set<AssistantAgentMode>([
  "answer",
  "clarification",
  "preview",
]);
const ROLES = new Set<AssistantConversationMessage["role"]>([
  "user",
  "assistant",
]);
const MEAL_TYPES = new Set<MeetingInput["mealType"]>([
  "none",
  "business",
  "work",
]);
const ROOM_SIZES = new Set<MeetingInput["roomSize"]>(["small", "large"]);
const MEETING_DRAFT_KEYS = new Set<keyof AssistantNewMeetingDraft>([
  "title",
  "date",
  "startTime",
  "location",
  "meetingRoomId",
  "roomRequirements",
  "organizer",
  "owner",
  "attendeeEstimate",
  "rosterRequired",
  "afternoonMeeting",
  "mealType",
  "alcoholRequired",
  "parkingRequired",
  "vehicleCount",
  "publicityRequired",
  "reimbursementRequired",
  "presentationRequired",
  "welcomeScreenRequired",
  "roomSize",
  "endTime",
  "notes",
  "attendees",
  "vehicles",
]);

function fail(path: string, message: string): never {
  throw new AssistantAgentValidationError(message, path);
}

function plainObject(value: unknown, path: string): PlainObject {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(path, "必须是普通对象");
  }
  return value as PlainObject;
}

function exactKeys(
  value: PlainObject,
  required: readonly string[],
  optional: readonly string[],
  path: string,
) {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${path}.${key}`, "不支持此字段");
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少必填字段");
  }
}

function stringValue(
  value: unknown,
  path: string,
  options: { minimum?: number; maximum: number },
) {
  const { minimum = 0, maximum } = options;
  if (typeof value !== "string") fail(path, "必须是字符串");
  if (value.includes("\u0000")) fail(path, "不能包含空字符");
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < minimum || length > maximum) {
    fail(path, `长度必须在 ${minimum} 到 ${maximum} 个字符之间`);
  }
  return normalized;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string,
) {
  if (typeof value !== "string" || !allowed.has(value as T)) {
    fail(path, `必须是以下值之一：${[...allowed].join("、")}`);
  }
  return value as T;
}

function booleanValue(value: unknown, path: string) {
  if (typeof value !== "boolean") fail(path, "必须是布尔值");
  return value;
}

function integerValue(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
) {
  if (
    !Number.isInteger(value) ||
    (value as number) < minimum ||
    (value as number) > maximum
  ) {
    fail(path, `必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
  return value as number;
}

function dateValue(value: unknown, path: string) {
  const normalized = stringValue(value, path, { minimum: 10, maximum: 10 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail(path, "必须使用 YYYY-MM-DD 格式");
  }
  const parsed = new Date(`${normalized}T12:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== normalized
  ) {
    fail(path, "不是有效的日期");
  }
  return normalized;
}

function timeValue(value: unknown, path: string) {
  const normalized = stringValue(value, path, { minimum: 5, maximum: 5 });
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    fail(path, "必须使用 HH:mm 格式");
  }
  return normalized;
}

function parseMeetingDraft(
  value: unknown,
  path: string,
): AssistantNewMeetingDraft {
  const object = plainObject(value, path);
  for (const key of Object.keys(object)) {
    if (!MEETING_DRAFT_KEYS.has(key as keyof AssistantNewMeetingDraft)) {
      fail(`${path}.${key}`, "不支持此字段");
    }
  }

  const draft: AssistantNewMeetingDraft = {};
  if (Object.hasOwn(object, "vehicles")) draft.vehicles = parseMeetingVehicles(object.vehicles, `${path}.vehicles`);
  if (Object.hasOwn(object, "notes")) {
    draft.notes = stringValue(object.notes, `${path}.notes`, { maximum: 5_000 });
  }
  if (Object.hasOwn(object, "attendees")) {
    draft.attendees = parseAssistantDraftAttendees(object.attendees, `${path}.attendees`);
  }
  if (Object.hasOwn(object, "title")) {
    draft.title = stringValue(object.title, `${path}.title`, {
      minimum: 1,
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "date")) {
    draft.date = dateValue(object.date, `${path}.date`);
  }
  if (Object.hasOwn(object, "startTime")) {
    draft.startTime = timeValue(object.startTime, `${path}.startTime`);
  }
  if (Object.hasOwn(object, "endTime")) {
    draft.endTime = timeValue(object.endTime, `${path}.endTime`);
  }
  if (Object.hasOwn(object, "location")) {
    draft.location = stringValue(object.location, `${path}.location`, {
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "meetingRoomId")) {
    draft.meetingRoomId = stringValue(
      object.meetingRoomId,
      `${path}.meetingRoomId`,
      { maximum: 200 },
    );
  }
  if (Object.hasOwn(object, "roomRequirements")) {
    draft.roomRequirements = stringValue(
      object.roomRequirements,
      `${path}.roomRequirements`,
      { maximum: 2_000 },
    );
  }
  if (Object.hasOwn(object, "organizer")) {
    draft.organizer = stringValue(object.organizer, `${path}.organizer`, {
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "owner")) {
    draft.owner = stringValue(object.owner, `${path}.owner`, {
      maximum: 80,
    });
  }
  if (Object.hasOwn(object, "attendeeEstimate")) {
    draft.attendeeEstimate = integerValue(
      object.attendeeEstimate,
      `${path}.attendeeEstimate`,
      0,
      5_000,
    );
  }
  const booleanKeys = [
    "rosterRequired",
    "afternoonMeeting",
    "alcoholRequired",
    "parkingRequired",
    "publicityRequired",
    "reimbursementRequired",
    "presentationRequired",
    "welcomeScreenRequired",
  ] as const satisfies ReadonlyArray<keyof MeetingInput>;
  for (const key of booleanKeys) {
    if (Object.hasOwn(object, key)) {
      draft[key] = booleanValue(object[key], `${path}.${key}`);
    }
  }
  if (Object.hasOwn(object, "vehicleCount")) {
    draft.vehicleCount = integerValue(
      object.vehicleCount,
      `${path}.vehicleCount`,
      0,
      5_000,
    );
  }
  if (Object.hasOwn(object, "mealType")) {
    draft.mealType = enumValue(
      object.mealType,
      MEAL_TYPES,
      `${path}.mealType`,
    );
  }
  if (Object.hasOwn(object, "roomSize")) {
    draft.roomSize = enumValue(
      object.roomSize,
      ROOM_SIZES,
      `${path}.roomSize`,
    );
  }
  return draft;
}

export const EMPTY_ASSISTANT_WORKING_MEMORY: AssistantWorkingMemory = {
  activeIntent: "none",
  newMeetingDraft: null,
  selectedMeetingId: null,
};

export function parseAssistantWorkingMemory(
  value: unknown,
  path = "memory",
): AssistantWorkingMemory {
  const object = plainObject(value, path);
  exactKeys(
    object,
    ["activeIntent", "newMeetingDraft", "selectedMeetingId"],
    [],
    path,
  );
  return {
    activeIntent: enumValue(
      object.activeIntent,
      ACTIVE_INTENTS,
      `${path}.activeIntent`,
    ),
    newMeetingDraft:
      object.newMeetingDraft === null
        ? null
        : parseMeetingDraft(object.newMeetingDraft, `${path}.newMeetingDraft`),
    selectedMeetingId:
      object.selectedMeetingId === null
        ? null
        : stringValue(object.selectedMeetingId, `${path}.selectedMeetingId`, {
            minimum: 1,
            maximum: 200,
          }),
  };
}

export function parseAssistantConversationMessage(
  value: unknown,
  path = "message",
): AssistantConversationMessage {
  const object = plainObject(value, path);
  exactKeys(object, ["role", "content"], [], path);
  return {
    role: enumValue(object.role, ROLES, `${path}.role`),
    content: stringValue(object.content, `${path}.content`, {
      minimum: 1,
      maximum: 8_000,
    }),
  };
}

export function parseAssistantConversation(
  value: unknown,
  path = "conversation",
): AssistantConversationMessage[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  if (value.length > MAX_ASSISTANT_CONVERSATION_MESSAGES) {
    fail(path, `最多保留 ${MAX_ASSISTANT_CONVERSATION_MESSAGES} 条消息`);
  }
  return value.map((message, index) =>
    parseAssistantConversationMessage(message, `${path}[${index}]`),
  );
}

function parseExistingAssistantAction(
  value: unknown,
  path: string,
): AssistantAction {
  try {
    const plan = parseAssistantPlan({
      schemaVersion: ASSISTANT_PLAN_SCHEMA_VERSION,
      summary: "校验 Agent 操作",
      clarification: null,
      warnings: [],
      actions: [value],
    });
    return plan.actions[0];
  } catch (error) {
    if (error instanceof AssistantPlanValidationError) {
      fail(path, error.message.replace(/^plan\.actions\[0\](?:\.)?/, ""));
    }
    throw error;
  }
}

function parseAgentAction(value: unknown, path: string): AssistantAgentAction {
  const object = plainObject(value, path);
  const type = stringValue(object.type, `${path}.type`, {
    minimum: 1,
    maximum: 80,
  });
  if (type === "meeting.create_from_draft") {
    exactKeys(object, ["type", "draft"], [], path);
    return {
      type,
      draft: parseMeetingDraft(object.draft, `${path}.draft`),
    };
  }
  return parseExistingAssistantAction(value, path);
}

function parseStringArray(
  value: unknown,
  path: string,
  options: { maximumItems: number; maximumLength: number },
) {
  if (!Array.isArray(value) || value.length > options.maximumItems) {
    fail(path, `必须是最多包含 ${options.maximumItems} 项的数组`);
  }
  return value.map((item, index) =>
    stringValue(item, `${path}[${index}]`, {
      minimum: 1,
      maximum: options.maximumLength,
    }),
  );
}

export function parseAssistantAgentResponse(
  value: unknown,
): AssistantAgentResponse {
  const object = plainObject(value, "response");
  exactKeys(
    object,
    ["reply", "mode", "assumptions", "actions", "memory", "suggestions"],
    [],
    "response",
  );
  const mode = enumValue(object.mode, MODES, "response.mode");
  if (!Array.isArray(object.actions)) fail("response.actions", "必须是数组");
  if (object.actions.length > MAX_ASSISTANT_AGENT_ACTIONS) {
    fail(
      "response.actions",
      `最多允许 ${MAX_ASSISTANT_AGENT_ACTIONS} 个操作`,
    );
  }
  const actions = object.actions.map((action, index) =>
    parseAgentAction(action, `response.actions[${index}]`),
  );
  if (mode === "clarification" && actions.length) {
    fail("response.actions", "需要用户补充信息时不能同时安排操作");
  }
  if (mode === "preview" && !actions.length) {
    fail("response.actions", "预览模式必须至少包含一个操作");
  }
  if (
    mode === "answer" &&
    actions.some((action) => action.type === "meeting.create_from_draft" || assistantActionRequiresConfirmation(action))
  ) {
    fail("response.actions", "纯回答模式只能包含无需确认的页面操作");
  }
  return {
    reply: stringValue(object.reply, "response.reply", {
      minimum: 1,
      maximum: 8_000,
    }),
    mode,
    assumptions: parseStringArray(object.assumptions, "response.assumptions", {
      maximumItems: 10,
      maximumLength: 300,
    }),
    actions,
    memory: parseAssistantWorkingMemory(object.memory, "response.memory"),
    suggestions: parseStringArray(object.suggestions, "response.suggestions", {
      maximumItems: 6,
      maximumLength: 120,
    }),
  };
}

export function isAssistantAgentResponse(
  value: unknown,
): value is AssistantAgentResponse {
  try {
    parseAssistantAgentResponse(value);
    return true;
  } catch {
    return false;
  }
}
