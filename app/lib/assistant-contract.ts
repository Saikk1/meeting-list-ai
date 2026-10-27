import { parseWorkspaceAction, type AssistantWorkspaceAction } from "./assistant-workspace";
import type {
  MeetingAttendee,
  MeetingInput,
  MeetingTask,
} from "./meeting-data";
import type { ContactInput } from "./contacts";
import { normalizeMeetingVehicles, type MeetingVehicle } from "./meeting-vehicles";
import { validateSeatingOptions, validateSeatingPeople } from "../../scripts/seating-schema.mjs";
import type { SeatingOptions, SeatingPerson } from "./seating";
import { isMeetingRoomTableType } from "./meeting-room-layout";
import {
  DEFAULT_ADMIN_CONFIG,
  isAdminConfig,
  type AdminConfig,
  type RosterRules,
} from "./admin-config";
import type {
  RosterWorkspaceCommand,
  RosterWorkspaceRecordInput,
  RosterWorkspaceRecordPatch,
} from "./roster-workspace-bridge";

export const ASSISTANT_PLAN_SCHEMA_VERSION = 1 as const;
export const MAX_ASSISTANT_ACTIONS = 100;

export type AssistantNavigationDestination =
  | "dashboard"
  | "meetings"
  | "tasks"
  | "new_meeting"
  | "admin"
  | "admin_overview"
  | "admin_organization"
  | "admin_rooms"
  | "admin_contacts"
  | "admin_checklist"
  | "admin_aliases"
  | "admin_roster"
  | "meeting_detail"
  | "meeting_seating";

/**
 * `endTime` is optional so old meetings and forms remain valid while the
 * assistant can still understand a natural-language time range.
 */
export type AssistantMeetingInput = MeetingInput & {
  endTime?: string;
  notes?: string;
  attendees?: AssistantAttendeeInput[];
};

export type AssistantMeetingPatch = Partial<Omit<AssistantMeetingInput, "attendees">> & {
  notes?: string;
};

export type AssistantTaskPatch = Partial<
  Pick<MeetingTask, "status" | "owner" | "dueDate" | "note">
>;

export type AssistantNavigateAction = {
  type: "navigate";
  destination: AssistantNavigationDestination;
  meetingId?: string;
};

export type AssistantCreateMeetingAction = {
  type: "meeting.create";
  input: AssistantMeetingInput;
};

export type AssistantUpdateMeetingFieldsAction = {
  type: "meeting.update_fields";
  meetingId: string;
  expectedUpdatedAt: string;
  patch: AssistantMeetingPatch;
};

export type AssistantGenerateSeatingAction = {
  type: "meeting.seating.generate";
  meetingId: string;
  expectedUpdatedAt: string;
  expectedConfigRevision: number;
  options: SeatingOptions;
  participants?: SeatingPerson[];
};

export type AssistantUpdateMeetingTaskAction = {
  type: "meeting.task.update";
  meetingId: string;
  expectedUpdatedAt: string;
  taskId: string;
  patch: AssistantTaskPatch;
};

export type AssistantOpenRosterAction = {
  type: "roster.open";
  meetingId?: string;
};

export type AssistantOpenContactsAction = {
  type: "contacts.open";
};

export type AssistantCreateContactAction = {
  type: "contact.create";
  input: ContactInput;
};

export type AssistantUpdateContactAction = {
  type: "contact.update";
  contactId: string;
  expectedUpdatedAt: string;
  patch: Partial<ContactInput>;
};

export type AssistantAddAttendeeFromContactAction = {
  type: "meeting.attendee.add_from_contact";
  meetingId: string;
  expectedUpdatedAt: string;
  contactId: string;
  expectedContactUpdatedAt: string;
};

export type AssistantRemoveAttendeeAction = {
  type: "meeting.attendee.remove";
  meetingId: string;
  expectedUpdatedAt: string;
  attendeeId: MeetingAttendee["id"];
};

export type AssistantDeleteMeetingAction = {
  type: "meeting.delete";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantDuplicateMeetingAction = {
  type: "meeting.duplicate";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantArchiveMeetingAction = {
  type: "meeting.archive";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantRestoreArchivedMeetingAction = {
  type: "meeting.restore_archived";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantRestoreDeletedMeetingAction = {
  type: "meeting.restore_deleted";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantPurgeMeetingAction = {
  type: "meeting.purge";
  meetingId: string;
  expectedUpdatedAt: string;
};

export type AssistantAttendeeInput = Pick<
  MeetingAttendee,
  "name" | "unit" | "department" | "title"
>;

export type AssistantAttendeePatch = Partial<AssistantAttendeeInput>;

export type AssistantAddAttendeeAction = {
  type: "meeting.attendee.add";
  meetingId: string;
  expectedUpdatedAt: string;
  attendee: AssistantAttendeeInput;
};

export type AssistantUpdateAttendeeAction = {
  type: "meeting.attendee.update";
  meetingId: string;
  expectedUpdatedAt: string;
  attendeeId: MeetingAttendee["id"];
  patch: AssistantAttendeePatch;
};

export type AssistantSortMeetingRosterAction = {
  type: "meeting.roster.sort";
  meetingId: string;
  expectedUpdatedAt: string;
  rosterRules: RosterRules;
};

export type AssistantExportMeetingRosterAction = {
  type: "meeting.roster.export";
  meetingId: string;
  expectedUpdatedAt: string;
  rosterRules: RosterRules;
};

export type AssistantDeleteContactAction = {
  type: "contact.delete";
  contactId: string;
  expectedUpdatedAt: string;
};

export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [Key in keyof T]?: DeepPartial<T[Key]> }
    : T;

export type AssistantAdminConfigPatchAction = {
  type: "admin.config.patch";
  expectedRevision: number;
  summary: string;
  patch: DeepPartial<AdminConfig>;
};

export type AssistantRosterWorkspaceAction = RosterWorkspaceCommand;

export type AssistantAction =
  | AssistantWorkspaceAction
  | AssistantNavigateAction
  | AssistantCreateMeetingAction
  | AssistantUpdateMeetingFieldsAction
  | AssistantGenerateSeatingAction
  | AssistantUpdateMeetingTaskAction
  | AssistantOpenRosterAction
  | AssistantOpenContactsAction
  | AssistantCreateContactAction
  | AssistantUpdateContactAction
  | AssistantAddAttendeeFromContactAction
  | AssistantRemoveAttendeeAction
  | AssistantDeleteMeetingAction
  | AssistantDuplicateMeetingAction
  | AssistantArchiveMeetingAction
  | AssistantRestoreArchivedMeetingAction
  | AssistantRestoreDeletedMeetingAction
  | AssistantPurgeMeetingAction
  | AssistantAddAttendeeAction
  | AssistantUpdateAttendeeAction
  | AssistantSortMeetingRosterAction
  | AssistantExportMeetingRosterAction
  | AssistantDeleteContactAction
  | AssistantAdminConfigPatchAction
  | AssistantRosterWorkspaceAction;

export type AssistantPlan = {
  schemaVersion: typeof ASSISTANT_PLAN_SCHEMA_VERSION;
  summary: string;
  clarification: string | null;
  warnings: string[];
  actions: AssistantAction[];
};

export class AssistantPlanValidationError extends Error {
  constructor(
    message: string,
    readonly path = "plan",
  ) {
    super(`${path}: ${message}`);
    this.name = "AssistantPlanValidationError";
  }
}

type PlainObject = Record<string, unknown>;

const MEAL_TYPES = new Set(["none", "business", "work"]);
const ROOM_SIZES = new Set(["small", "large"]);
const TASK_STATUSES = new Set([
  "todo",
  "doing",
  "blocked",
  "review",
  "done",
  "waived",
]);
const NAVIGATION_DESTINATIONS = new Set<AssistantNavigationDestination>([
  "dashboard",
  "meetings",
  "tasks",
  "new_meeting",
  "admin",
  "admin_overview",
  "admin_organization",
  "admin_rooms",
  "admin_contacts",
  "admin_checklist",
  "admin_aliases",
  "admin_roster",
  "meeting_detail",
  "meeting_seating",
]);
const MEETING_INPUT_KEYS = [
  "title",
  "date",
  "startTime",
  "location",
  "organizer",
  "owner",
  "attendeeEstimate",
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
] as const satisfies ReadonlyArray<keyof MeetingInput>;
const MEETING_OPTIONAL_INPUT_KEYS = [
  "endTime",
  "rosterRequired",
  "meetingRoomId",
  "roomRequirements",
  "vehicles",
] as const;
const MEETING_PATCH_KEYS = new Set<string>([
  ...MEETING_INPUT_KEYS,
  ...MEETING_OPTIONAL_INPUT_KEYS,
  "notes",
]);
const TASK_PATCH_KEYS = new Set<string>([
  "status",
  "owner",
  "dueDate",
  "note",
]);
const CONTACT_INPUT_KEYS = [
  "name",
  "unit",
  "department",
  "title",
] as const satisfies ReadonlyArray<keyof ContactInput>;
const ATTENDEE_INPUT_KEYS = [
  "name",
  "unit",
  "department",
  "title",
] as const satisfies ReadonlyArray<keyof AssistantAttendeeInput>;

const ADMIN_CONFIG_SCHEMA_SAMPLE = {
  ...DEFAULT_ADMIN_CONFIG,
  checklistTemplates: [DEFAULT_ADMIN_CONFIG.checklistTemplates[0]],
  rosterRules: {
    ...DEFAULT_ADMIN_CONFIG.rosterRules,
    aliases: [
      {
        id: "alias-sample",
        canonical: "标准单位",
        aliases: ["单位简称"],
        mode: "confirm" as const,
        enabled: true,
        notes: "",
      },
    ],
    ranking: {
      ...DEFAULT_ADMIN_CONFIG.rosterRules.ranking,
      unitTiers: [DEFAULT_ADMIN_CONFIG.rosterRules.ranking.unitTiers[0]],
      unitOverrides: [
        {
          id: "unit-override-sample",
          unit: "标准单位",
          tierId:
            DEFAULT_ADMIN_CONFIG.rosterRules.ranking.unitTiers[0].id,
          withinTierOrder: 1,
          enabled: true,
          notes: "",
        },
      ],
      titleTiers: [DEFAULT_ADMIN_CONFIG.rosterRules.ranking.titleTiers[0]],
      ai: {
        ...DEFAULT_ADMIN_CONFIG.rosterRules.ranking.ai,
        preferredDomains: ["gov.cn"],
      },
    },
    outputFields: [DEFAULT_ADMIN_CONFIG.rosterRules.outputFields[0]],
  },
} satisfies AdminConfig;

function fail(path: string, message: string): never {
  throw new AssistantPlanValidationError(message, path);
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
  {
    minimum = 0,
    maximum,
  }: { minimum?: number; maximum: number },
) {
  if (typeof value !== "string") fail(path, "必须是字符串");
  if (value.includes("\u0000")) fail(path, "不能包含空字符");
  const normalized = value.trim();
  const length = [...normalized].length;
  if (length < minimum || length > maximum) {
    fail(path, `长度必须在 ${minimum} 到 ${maximum} 个字符之间`);
  }
  return normalized;
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

function dateValue(value: unknown, path: string, { required = true } = {}) {
  const normalized = stringValue(value, path, {
    minimum: required ? 10 : 0,
    maximum: 10,
  });
  if (!normalized && !required) return normalized;
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

function revisionValue(value: unknown, path: string) {
  const normalized = stringValue(value, path, {
    minimum: 1,
    maximum: 80,
  });
  if (Number.isNaN(Date.parse(normalized))) {
    fail(path, "必须是有效的更新时间");
  }
  return normalized;
}

function validateTimeRange(
  startTime: string,
  endTime: string | undefined,
  path: string,
) {
  if (endTime && endTime <= startTime) {
    fail(path, "结束时间必须晚于开始时间");
  }
}

export function parseMeetingVehicles(value: unknown, path: string): MeetingVehicle[] {
  if (!Array.isArray(value) || value.length > 500) fail(path, "最多登记 500 辆参会车辆");
  const vehicles = value.map((entry, index) => {
    const vehiclePath = `${path}[${index}]`;
    const vehicle = plainObject(entry, vehiclePath);
    exactKeys(vehicle, ["unit", "licensePlate", "note"], [], vehiclePath);
    return {
      unit: stringValue(vehicle.unit, `${vehiclePath}.unit`, { maximum: 200 }),
      licensePlate: stringValue(vehicle.licensePlate, `${vehiclePath}.licensePlate`, { minimum: 1, maximum: 40 }),
      note: stringValue(vehicle.note, `${vehiclePath}.note`, { maximum: 500 }),
    };
  });
  try { return normalizeMeetingVehicles(vehicles); } catch (error) {
    fail(path, error instanceof Error ? error.message : "车辆登记无效");
  }
}

function parseMeetingInput(
  value: unknown,
  path: string,
): AssistantMeetingInput {
  const object = plainObject(value, path);
  exactKeys(object, MEETING_INPUT_KEYS, [...MEETING_OPTIONAL_INPUT_KEYS, "attendees", "notes"], path);
  const input: AssistantMeetingInput = {
    title: stringValue(object.title, `${path}.title`, {
      minimum: 1,
      maximum: 200,
    }),
    date: dateValue(object.date, `${path}.date`),
    startTime: timeValue(object.startTime, `${path}.startTime`),
    location: stringValue(object.location, `${path}.location`, {
      maximum: 200,
    }),
    organizer: stringValue(object.organizer, `${path}.organizer`, {
      maximum: 200,
    }),
    owner: stringValue(object.owner, `${path}.owner`, { maximum: 80 }),
    attendeeEstimate: integerValue(
      object.attendeeEstimate,
      `${path}.attendeeEstimate`,
      0,
      5_000,
    ),
    rosterRequired: Object.hasOwn(object, "rosterRequired")
      ? booleanValue(object.rosterRequired, `${path}.rosterRequired`)
      : false,
    afternoonMeeting: booleanValue(
      object.afternoonMeeting,
      `${path}.afternoonMeeting`,
    ),
    mealType: enumValue(object.mealType, MEAL_TYPES, `${path}.mealType`) as MeetingInput["mealType"],
    alcoholRequired: booleanValue(
      object.alcoholRequired,
      `${path}.alcoholRequired`,
    ),
    parkingRequired: booleanValue(
      object.parkingRequired,
      `${path}.parkingRequired`,
    ),
    vehicleCount: integerValue(
      object.vehicleCount,
      `${path}.vehicleCount`,
      0,
      5_000,
    ),
    publicityRequired: booleanValue(
      object.publicityRequired,
      `${path}.publicityRequired`,
    ),
    reimbursementRequired: booleanValue(
      object.reimbursementRequired,
      `${path}.reimbursementRequired`,
    ),
    presentationRequired: booleanValue(
      object.presentationRequired,
      `${path}.presentationRequired`,
    ),
    welcomeScreenRequired: booleanValue(
      object.welcomeScreenRequired,
      `${path}.welcomeScreenRequired`,
    ),
    roomSize: enumValue(object.roomSize, ROOM_SIZES, `${path}.roomSize`) as MeetingInput["roomSize"],
    ...(Object.hasOwn(object, "endTime")
      ? { endTime: timeValue(object.endTime, `${path}.endTime`) }
      : {}),
    ...(Object.hasOwn(object, "meetingRoomId")
      ? {
          meetingRoomId: stringValue(
            object.meetingRoomId,
            `${path}.meetingRoomId`,
            { maximum: 200 },
          ),
        }
      : {}),
    ...(Object.hasOwn(object, "roomRequirements")
      ? {
          roomRequirements: stringValue(
            object.roomRequirements,
            `${path}.roomRequirements`,
            { maximum: 2_000 },
          ),
        }
      : {}),
  };

  if (Object.hasOwn(object, "attendees")) {
    // A vehicle report is independent of this attendee list.
    input.attendees = parseAssistantDraftAttendees(object.attendees, `${path}.attendees`);
  }
  if (Object.hasOwn(object, "vehicles")) input.vehicles = parseMeetingVehicles(object.vehicles, `${path}.vehicles`);
  if (Object.hasOwn(object, "notes")) {
    input.notes = stringValue(object.notes, `${path}.notes`, { maximum: 5_000 });
  }
  if (input.mealType !== "business" && input.alcoholRequired) {
    fail(`${path}.alcoholRequired`, "非商务餐不能要求酒水");
  }
  if (!input.parkingRequired && input.vehicleCount !== 0) {
    fail(`${path}.vehicleCount`, "未启用停车保障时必须为 0");
  }
  if (!input.parkingRequired && input.vehicles?.length) fail(`${path}.vehicles`, "请先启用停车保障，再登记参会车辆");
  validateTimeRange(input.startTime, input.endTime, `${path}.endTime`);
  return input;
}

export function parseMeetingPatch(
  value: unknown,
  path: string,
): AssistantMeetingPatch {
  const object = plainObject(value, path);
  if (!Object.keys(object).length) fail(path, "至少需要修改一个字段");
  for (const key of Object.keys(object)) {
    if (!MEETING_PATCH_KEYS.has(key)) fail(`${path}.${key}`, "不支持修改此字段");
  }

  const patch: AssistantMeetingPatch = {};
  if (Object.hasOwn(object, "vehicles")) patch.vehicles = parseMeetingVehicles(object.vehicles, `${path}.vehicles`);
  for (const key of MEETING_INPUT_KEYS) {
    if (!Object.hasOwn(object, key)) continue;
    const fieldPath = `${path}.${key}`;
    switch (key) {
      case "title":
        patch.title = stringValue(object[key], fieldPath, {
          minimum: 1,
          maximum: 200,
        });
        break;
      case "date":
        patch.date = dateValue(object[key], fieldPath);
        break;
      case "startTime":
        patch.startTime = timeValue(object[key], fieldPath);
        break;
      case "location":
      case "organizer":
        patch[key] = stringValue(object[key], fieldPath, { maximum: 200 });
        break;
      case "owner":
        patch.owner = stringValue(object.owner, fieldPath, { maximum: 80 });
        break;
      case "attendeeEstimate":
      case "vehicleCount":
        patch[key] = integerValue(object[key], fieldPath, 0, 5_000);
        break;
      case "afternoonMeeting":
      case "alcoholRequired":
      case "parkingRequired":
      case "publicityRequired":
      case "reimbursementRequired":
      case "presentationRequired":
      case "welcomeScreenRequired":
        patch[key] = booleanValue(object[key], fieldPath);
        break;
      case "mealType":
        patch.mealType = enumValue(object.mealType, MEAL_TYPES, fieldPath) as MeetingInput["mealType"];
        break;
      case "roomSize":
        patch.roomSize = enumValue(object.roomSize, ROOM_SIZES, fieldPath) as MeetingInput["roomSize"];
        break;
    }
  }
  if (Object.hasOwn(object, "notes")) {
    patch.notes = stringValue(object.notes, `${path}.notes`, { maximum: 5_000 });
  }
  if (Object.hasOwn(object, "endTime")) {
    patch.endTime = timeValue(object.endTime, `${path}.endTime`);
  }
  if (Object.hasOwn(object, "rosterRequired")) {
    patch.rosterRequired = booleanValue(
      object.rosterRequired,
      `${path}.rosterRequired`,
    );
  }
  if (Object.hasOwn(object, "meetingRoomId")) {
    patch.meetingRoomId = stringValue(
      object.meetingRoomId,
      `${path}.meetingRoomId`,
      { maximum: 200 },
    );
  }
  if (Object.hasOwn(object, "roomRequirements")) {
    patch.roomRequirements = stringValue(
      object.roomRequirements,
      `${path}.roomRequirements`,
      { maximum: 2_000 },
    );
  }
  return patch;
}

function parseTaskPatch(value: unknown, path: string): AssistantTaskPatch {
  const object = plainObject(value, path);
  if (!Object.keys(object).length) fail(path, "至少需要修改一个字段");
  for (const key of Object.keys(object)) {
    if (!TASK_PATCH_KEYS.has(key)) fail(`${path}.${key}`, "不支持修改此字段");
  }
  const patch: AssistantTaskPatch = {};
  if (Object.hasOwn(object, "status")) {
    patch.status = enumValue(object.status, TASK_STATUSES, `${path}.status`) as MeetingTask["status"];
  }
  if (Object.hasOwn(object, "owner")) {
    patch.owner = stringValue(object.owner, `${path}.owner`, { maximum: 80 });
  }
  if (Object.hasOwn(object, "dueDate")) {
    patch.dueDate = dateValue(object.dueDate, `${path}.dueDate`, {
      required: false,
    });
  }
  if (Object.hasOwn(object, "note")) {
    patch.note = stringValue(object.note, `${path}.note`, { maximum: 5_000 });
  }
  return patch;
}

function parseContactInput(value: unknown, path: string): ContactInput {
  const object = plainObject(value, path);
  exactKeys(object, CONTACT_INPUT_KEYS, [], path);
  return {
    name: stringValue(object.name, `${path}.name`, {
      minimum: 1,
      maximum: 80,
    }),
    unit: stringValue(object.unit, `${path}.unit`, {
      minimum: 1,
      maximum: 200,
    }),
    department: stringValue(object.department, `${path}.department`, {
      maximum: 200,
    }),
    title: stringValue(object.title, `${path}.title`, { maximum: 200 }),
  };
}

function parseContactPatch(
  value: unknown,
  path: string,
): Partial<ContactInput> {
  const object = plainObject(value, path);
  if (!Object.keys(object).length) fail(path, "至少需要修改一个字段");
  for (const key of Object.keys(object)) {
    if (!(CONTACT_INPUT_KEYS as readonly string[]).includes(key)) {
      fail(`${path}.${key}`, "不支持修改此字段");
    }
  }
  const patch: Partial<ContactInput> = {};
  if (Object.hasOwn(object, "name")) {
    patch.name = stringValue(object.name, `${path}.name`, {
      minimum: 1,
      maximum: 80,
    });
  }
  if (Object.hasOwn(object, "unit")) {
    patch.unit = stringValue(object.unit, `${path}.unit`, {
      minimum: 1,
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "department")) {
    patch.department = stringValue(object.department, `${path}.department`, {
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "title")) {
    patch.title = stringValue(object.title, `${path}.title`, { maximum: 200 });
  }
  return patch;
}

function parseAttendeeInput(
  value: unknown,
  path: string,
): AssistantAttendeeInput {
  const object = plainObject(value, path);
  exactKeys(object, ATTENDEE_INPUT_KEYS, [], path);
  return {
    name: stringValue(object.name, `${path}.name`, {
      minimum: 1,
      maximum: 80,
    }),
    unit: stringValue(object.unit, `${path}.unit`, {
      maximum: 200,
    }),
    department: stringValue(object.department, `${path}.department`, {
      maximum: 200,
    }),
    title: stringValue(object.title, `${path}.title`, { maximum: 200 }),
  };
}

export function parseAssistantDraftAttendees(value: unknown, path: string): AssistantAttendeeInput[] {
  if (!Array.isArray(value) || value.length > 200) fail(path, "参会人员必须为数组且最多 200 人");
  const identities = new Set<string>();
  return value.map((item, index) => {
    const attendee = parseAttendeeInput(item, `${path}[${index}]`);
    const identity = `${attendee.name}\u0000${attendee.unit}`.normalize("NFKC").replace(/\s/g, "").toLowerCase();
    if (identities.has(identity)) fail(`${path}[${index}]`, `重复参会人：${attendee.name}（${attendee.unit || "单位待补充"}）`);
    identities.add(identity);
    return attendee;
  });
}

function parseAttendeePatch(
  value: unknown,
  path: string,
): AssistantAttendeePatch {
  const object = plainObject(value, path);
  if (!Object.keys(object).length) fail(path, "至少需要修改一个字段");
  for (const key of Object.keys(object)) {
    if (!(ATTENDEE_INPUT_KEYS as readonly string[]).includes(key)) {
      fail(`${path}.${key}`, "不支持修改此字段");
    }
  }
  const patch: AssistantAttendeePatch = {};
  if (Object.hasOwn(object, "name")) {
    patch.name = stringValue(object.name, `${path}.name`, {
      minimum: 1,
      maximum: 80,
    });
  }
  if (Object.hasOwn(object, "unit")) {
    patch.unit = stringValue(object.unit, `${path}.unit`, {
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "department")) {
    patch.department = stringValue(object.department, `${path}.department`, {
      maximum: 200,
    });
  }
  if (Object.hasOwn(object, "title")) {
    patch.title = stringValue(object.title, `${path}.title`, { maximum: 200 });
  }
  return patch;
}

function parseRosterWorkspaceRecordInput(
  value: unknown,
  path: string,
): RosterWorkspaceRecordInput {
  const object = plainObject(value, path);
  exactKeys(object, ATTENDEE_INPUT_KEYS, [], path);
  return {
    name: stringValue(object.name, `${path}.name`, { maximum: 200 }),
    unit: stringValue(object.unit, `${path}.unit`, { maximum: 500 }),
    department: stringValue(object.department, `${path}.department`, {
      maximum: 500,
    }),
    title: stringValue(object.title, `${path}.title`, { maximum: 500 }),
  };
}

function parseRosterWorkspaceRecordPatch(
  value: unknown,
  path: string,
): RosterWorkspaceRecordPatch {
  const object = plainObject(value, path);
  if (!Object.keys(object).length) fail(path, "至少需要修改一个字段");
  for (const key of Object.keys(object)) {
    if (!(ATTENDEE_INPUT_KEYS as readonly string[]).includes(key)) {
      fail(`${path}.${key}`, "不支持修改此字段");
    }
  }
  const patch: RosterWorkspaceRecordPatch = {};
  for (const key of ATTENDEE_INPUT_KEYS) {
    if (Object.hasOwn(object, key)) {
      patch[key] = stringValue(object[key], `${path}.${key}`, {
        maximum: key === "name" ? 200 : 500,
      });
    }
  }
  return patch;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateConfigTree(
  value: unknown,
  sample: unknown,
  path: string,
  partial: boolean,
): unknown {
  if (Array.isArray(sample)) {
    if (!Array.isArray(value)) fail(path, "必须是数组");
    if (value.length > 5_000) fail(path, "数组项数不能超过 5000");
    const itemSample = sample[0];
    if (itemSample !== undefined) {
      return value.map((item, index) =>
        validateConfigTree(item, itemSample, `${path}[${index}]`, false),
      );
    }
    return cloneJson(value);
  }
  if (sample && typeof sample === "object") {
    const object = plainObject(value, path);
    if (!Object.keys(object).length) fail(path, "至少需要包含一个字段");
    const sampleObject = sample as PlainObject;
    const optionalKeys = /(?:^|\.)meetingRooms\[\d+\]$/.test(path) ? ["areaSqm", "tableDimensions", "tableType"] : [];
    exactKeys(
      object,
      partial ? [] : Object.keys(sampleObject).filter((key) => !optionalKeys.includes(key)),
      partial ? Object.keys(sampleObject) : optionalKeys,
      path,
    );
    return Object.fromEntries(
      Object.entries(object).map(([key, child]) => [
        key,
        validateConfigTree(
          child,
          sampleObject[key],
          `${path}.${key}`,
          partial,
        ),
      ]),
    );
  }
  if (typeof sample === "string") {
    if (/\.meetingRooms\[\d+\]\.tableType$/.test(path) && !isMeetingRoomTableType(value)) {
      fail(path, "必须是 unconfigured、rectangular、round 或 podium");
    }
    return stringValue(value, path, { maximum: 10_000 });
  }
  if (typeof sample === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      fail(path, "必须是有限数字");
    }
    return value;
  }
  if (typeof sample === "boolean") return booleanValue(value, path);
  fail(path, "字段类型不受支持");
}

function deepMergeConfigValue(base: unknown, patch: unknown): unknown {
  if (Array.isArray(patch)) return cloneJson(patch);
  if (
    patch &&
    typeof patch === "object" &&
    !Array.isArray(patch) &&
    base &&
    typeof base === "object" &&
    !Array.isArray(base)
  ) {
    const output = cloneJson(base) as PlainObject;
    for (const [key, value] of Object.entries(patch as PlainObject)) {
      output[key] = deepMergeConfigValue(output[key], value);
    }
    return output;
  }
  return cloneJson(patch);
}

export function mergeAdminConfigPatch(
  base: AdminConfig,
  patch: DeepPartial<AdminConfig>,
): AdminConfig {
  const merged = deepMergeConfigValue(base, patch);
  if (!isAdminConfig(merged)) {
    throw new AssistantPlanValidationError(
      "配置补丁合并后的结果无效",
      "admin.config.patch",
    );
  }
  return cloneJson(merged as AdminConfig);
}

function parseAdminConfigPatch(
  value: unknown,
  path: string,
): DeepPartial<AdminConfig> {
  const patch = validateConfigTree(
    value,
    ADMIN_CONFIG_SCHEMA_SAMPLE,
    path,
    true,
  ) as DeepPartial<AdminConfig>;
  try {
    mergeAdminConfigPatch(DEFAULT_ADMIN_CONFIG, patch);
  } catch (error) {
    fail(path, error instanceof Error ? error.message : "配置补丁无效");
  }
  return patch;
}

function parseRosterRules(value: unknown, path: string): RosterRules {
  const rosterRules = validateConfigTree(
    value,
    ADMIN_CONFIG_SCHEMA_SAMPLE.rosterRules,
    path,
    false,
  ) as RosterRules;
  const candidate = {
    ...cloneJson(DEFAULT_ADMIN_CONFIG),
    rosterRules,
  };
  if (!isAdminConfig(candidate)) fail(path, "名单排序规则无效");
  return cloneJson(rosterRules);
}

function parseAction(value: unknown, path: string): AssistantAction {
  const object = plainObject(value, path);
  const type = stringValue(object.type, `${path}.type`, {
    minimum: 1,
    maximum: 80,
  });

  switch (type) {
    case "page.workspace.apply":
      try { return parseWorkspaceAction(object); } catch (error) { fail(path, error instanceof Error ? error.message : "页面操作无效"); }
    case "navigate": {
      exactKeys(object, ["type", "destination"], ["meetingId"], path);
      const destination = enumValue(
        object.destination,
        NAVIGATION_DESTINATIONS,
        `${path}.destination`,
      );
      const meetingId = Object.hasOwn(object, "meetingId")
        ? stringValue(object.meetingId, `${path}.meetingId`, {
            minimum: 1,
            maximum: 200,
          })
        : undefined;
      if ((destination === "meeting_detail" || destination === "meeting_seating") && !meetingId) {
        fail(`${path}.meetingId`, "打开会议详情时必须提供会议 ID");
      }
      if (destination !== "meeting_detail" && destination !== "meeting_seating" && meetingId) {
        fail(`${path}.meetingId`, "当前导航目标不接受会议 ID");
      }
      return { type, destination, ...(meetingId ? { meetingId } : {}) };
    }
    case "meeting.create":
      exactKeys(object, ["type", "input"], [], path);
      return { type, input: parseMeetingInput(object.input, `${path}.input`) };
    case "meeting.delete":
    case "meeting.duplicate":
    case "meeting.archive":
    case "meeting.restore_archived":
    case "meeting.restore_deleted":
    case "meeting.purge":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
      };
    case "meeting.update_fields":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "patch"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        patch: parseMeetingPatch(object.patch, `${path}.patch`),
      };
    case "meeting.task.update":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "taskId", "patch"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        taskId: stringValue(object.taskId, `${path}.taskId`, {
          minimum: 1,
          maximum: 240,
        }),
        patch: parseTaskPatch(object.patch, `${path}.patch`),
      };
    case "meeting.attendee.add_from_contact":
      exactKeys(
        object,
        [
          "type",
          "meetingId",
          "expectedUpdatedAt",
          "contactId",
          "expectedContactUpdatedAt",
        ],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        contactId: stringValue(object.contactId, `${path}.contactId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedContactUpdatedAt: revisionValue(
          object.expectedContactUpdatedAt,
          `${path}.expectedContactUpdatedAt`,
        ),
      };
    case "meeting.attendee.add":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "attendee"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        attendee: parseAttendeeInput(object.attendee, `${path}.attendee`),
      };
    case "meeting.attendee.update":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "attendeeId", "patch"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        attendeeId: stringValue(object.attendeeId, `${path}.attendeeId`, {
          minimum: 1,
          maximum: 240,
        }),
        patch: parseAttendeePatch(object.patch, `${path}.patch`),
      };
    case "meeting.attendee.remove":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "attendeeId"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        attendeeId: stringValue(object.attendeeId, `${path}.attendeeId`, {
          minimum: 1,
          maximum: 240,
        }),
      };
    case "meeting.seating.generate": {
      exactKeys(object, ["type", "meetingId", "expectedUpdatedAt", "expectedConfigRevision", "options"], ["participants"], path);
      try {
        validateSeatingOptions(object.options);
        if (Object.hasOwn(object, "participants")) validateSeatingPeople(object.participants);
      } catch (error) { fail(path, error instanceof Error ? error.message : "座次输入无效"); }
      return {
        type, meetingId: stringValue(object.meetingId, `${path}.meetingId`, { minimum: 1, maximum: 200 }),
        expectedUpdatedAt: revisionValue(object.expectedUpdatedAt, `${path}.expectedUpdatedAt`),
        expectedConfigRevision: integerValue(object.expectedConfigRevision, `${path}.expectedConfigRevision`, 0, 10000000),
        options: object.options as SeatingOptions,
        ...(Object.hasOwn(object, "participants") ? { participants: object.participants as SeatingPerson[] } : {}),
      };
    }
    case "meeting.roster.sort":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "rosterRules"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        rosterRules: parseRosterRules(
          object.rosterRules,
          `${path}.rosterRules`,
        ),
      };
    case "meeting.roster.export":
      exactKeys(
        object,
        ["type", "meetingId", "expectedUpdatedAt", "rosterRules"],
        [],
        path,
      );
      return {
        type,
        meetingId: stringValue(object.meetingId, `${path}.meetingId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        rosterRules: parseRosterRules(
          object.rosterRules,
          `${path}.rosterRules`,
        ),
      };
    case "roster.workspace.set_text":
      exactKeys(
        object,
        ["type", "expectedRevision", "text"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        text: stringValue(object.text, `${path}.text`, {
          maximum: 100_000,
        }),
      };
    case "roster.workspace.record.update":
      exactKeys(
        object,
        ["type", "expectedRevision", "recordId", "patch"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        recordId: stringValue(object.recordId, `${path}.recordId`, {
          minimum: 1,
          maximum: 200,
        }),
        patch: parseRosterWorkspaceRecordPatch(
          object.patch,
          `${path}.patch`,
        ),
      };
    case "roster.workspace.record.add":
      exactKeys(
        object,
        ["type", "expectedRevision", "record"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        record: parseRosterWorkspaceRecordInput(
          object.record,
          `${path}.record`,
        ),
      };
    case "roster.workspace.record.remove":
    case "roster.workspace.enrich_person":
      exactKeys(
        object,
        ["type", "expectedRevision", "recordId"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        recordId: stringValue(object.recordId, `${path}.recordId`, {
          minimum: 1,
          maximum: 200,
        }),
      };
    case "roster.workspace.alias.apply":
      exactKeys(
        object,
        ["type", "expectedRevision", "aliasId"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        aliasId: stringValue(object.aliasId, `${path}.aliasId`, {
          minimum: 1,
          maximum: 200,
        }),
      };
    case "roster.workspace.process":
    case "roster.workspace.confirm":
    case "roster.workspace.analyze_ranking":
    case "roster.workspace.save_to_meeting":
    case "roster.workspace.export":
      exactKeys(object, ["type", "expectedRevision"], [], path);
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
      };
    case "contact.create":
      exactKeys(object, ["type", "input"], [], path);
      return {
        type,
        input: parseContactInput(object.input, `${path}.input`),
      };
    case "contact.update":
      exactKeys(
        object,
        ["type", "contactId", "expectedUpdatedAt", "patch"],
        [],
        path,
      );
      return {
        type,
        contactId: stringValue(object.contactId, `${path}.contactId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
        patch: parseContactPatch(object.patch, `${path}.patch`),
      };
    case "contact.delete":
      exactKeys(
        object,
        ["type", "contactId", "expectedUpdatedAt"],
        [],
        path,
      );
      return {
        type,
        contactId: stringValue(object.contactId, `${path}.contactId`, {
          minimum: 1,
          maximum: 200,
        }),
        expectedUpdatedAt: revisionValue(
          object.expectedUpdatedAt,
          `${path}.expectedUpdatedAt`,
        ),
      };
    case "admin.config.patch":
      exactKeys(
        object,
        ["type", "expectedRevision", "summary", "patch"],
        [],
        path,
      );
      return {
        type,
        expectedRevision: integerValue(
          object.expectedRevision,
          `${path}.expectedRevision`,
          0,
          2_147_483_647,
        ),
        summary: stringValue(object.summary, `${path}.summary`, {
          minimum: 1,
          maximum: 100,
        }),
        patch: parseAdminConfigPatch(object.patch, `${path}.patch`),
      };
    case "roster.open": {
      exactKeys(object, ["type"], ["meetingId"], path);
      const meetingId = Object.hasOwn(object, "meetingId")
        ? stringValue(object.meetingId, `${path}.meetingId`, {
            minimum: 1,
            maximum: 200,
          })
        : undefined;
      return { type, ...(meetingId ? { meetingId } : {}) };
    }
    case "contacts.open":
      exactKeys(object, ["type"], [], path);
      return { type };
    default:
      fail(`${path}.type`, "不是允许的助手操作");
  }
}

function validatePlanComposition(plan: AssistantPlan) {
  if (plan.actions.some((a) => a.type === "page.workspace.apply") && plan.actions.length !== 1) fail("plan.actions", "页面草稿操作须单独预览确认，不能混合其他数据操作");
  const workspaceActions = plan.actions.filter(
    (action): action is AssistantRosterWorkspaceAction =>
      action.type.startsWith("roster.workspace."),
  );
  const workspaceEditTypes = new Set<AssistantRosterWorkspaceAction["type"]>([
    "roster.workspace.record.add",
    "roster.workspace.record.update",
    "roster.workspace.record.remove",
  ]);
  if (
    workspaceActions.length > 1 &&
    workspaceActions.some((action) => !workspaceEditTypes.has(action.type))
  ) {
    fail(
      "plan.actions",
      "同一计划仅名单记录新增、修改和删除可以批量执行",
    );
  }
  if (
    new Set(workspaceActions.map((action) => action.expectedRevision)).size > 1
  ) {
    fail("plan.actions", "批量名单工作区操作必须使用相同版本");
  }
  const workspaceTargetIds = workspaceActions.flatMap((action) =>
    action.type === "roster.workspace.record.update" ||
    action.type === "roster.workspace.record.remove"
      ? [action.recordId]
      : [],
  );
  if (new Set(workspaceTargetIds).size !== workspaceTargetIds.length) {
    fail("plan.actions", "同一批操作不能重复修改或删除同一条名单记录");
  }
  const otherDataWrites = plan.actions.filter(
    (action) =>
      action.type.startsWith("meeting.") ||
      action.type === "contact.create" ||
      action.type === "contact.update" ||
      action.type === "contact.delete" ||
      action.type === "admin.config.patch",
  );
  if (workspaceActions.length && otherDataWrites.length) {
    fail(
      "plan.actions",
      "名单工作区操作不能与会议、通讯录或后台配置写入混合执行",
    );
  }

  const adminActions = plan.actions.filter(
    (action) => action.type === "admin.config.patch",
  );
  if (adminActions.length && plan.actions.length !== 1) {
    fail("plan.actions", "后台配置写入必须作为单独计划确认");
  }

  const persistentActions = plan.actions.filter((action) =>
    action.type.startsWith("meeting."),
  );
  const createActions = persistentActions.filter(
    (action) => action.type === "meeting.create",
  );
  const updateActions = persistentActions.filter(
    (action) => action.type !== "meeting.create",
  );
  if (createActions.length > 1) {
    fail("plan.actions", "一次计划最多创建一场会议");
  }
  if (createActions.length && updateActions.length) {
    fail("plan.actions", "创建会议不能与修改已有会议混在同一次计划中");
  }
  const lifecycleActions = persistentActions.filter(
    (action) =>
      action.type === "meeting.delete" ||
      action.type === "meeting.duplicate" ||
      action.type === "meeting.archive" ||
      action.type === "meeting.restore_archived" ||
      action.type === "meeting.restore_deleted" ||
      action.type === "meeting.purge",
  );
  if (lifecycleActions.length > 1) {
    fail("plan.actions", "一次计划最多处理一场会议的生命周期操作");
  }
  if (lifecycleActions.length && persistentActions.length > 1) {
    fail("plan.actions", "复制、归档、恢复或删除会议不能与其他会议写入混在同一次计划中");
  }
  const rosterExportActions = persistentActions.filter(
    (action) => action.type === "meeting.roster.export",
  );
  if (rosterExportActions.length > 1) {
    fail("plan.actions", "一次计划最多导出一场会议的名单");
  }
  if (rosterExportActions.length && persistentActions.length > 1) {
    fail("plan.actions", "名单导出不能与其他会议写入混在同一次计划中");
  }
  const seatingActions = persistentActions.filter((action) => action.type === "meeting.seating.generate");
  if (seatingActions.length && persistentActions.length > 1) fail("plan.actions", "生成座次应作为独立会议写入；人员改动请放入座次 participants 中");
  const updateMeetingIds = new Set(
    updateActions.flatMap((action) => "meetingId" in action ? [action.meetingId] : []),
  );
  if (updateMeetingIds.size > 1) {
    fail("plan.actions", "一次计划只能修改同一场会议");
  }

  const contactWriteActions = plan.actions.filter(
    (action) =>
      action.type === "contact.create" ||
      action.type === "contact.update" ||
      action.type === "contact.delete",
  );
  if (contactWriteActions.length && persistentActions.length) {
    fail(
      "plan.actions",
      "通讯录写入与会议写入不能混在同一次计划中，请分步确认",
    );
  }
  const targetedContactIds = contactWriteActions
    .filter(
      (
        action,
      ): action is Extract<
        AssistantAction,
        { type: "contact.update" | "contact.delete" }
      > => action.type === "contact.update" || action.type === "contact.delete",
    )
    .map((action) => action.contactId);
  if (new Set(targetedContactIds).size !== targetedContactIds.length) {
    fail("plan.actions", "同一计划不能重复修改或删除同一位联系人");
  }

  const navigationIndexes = plan.actions
    .map((action, index) =>
      action.type === "navigate" ||
      action.type === "roster.open" ||
      action.type === "contacts.open"
        ? index
        : -1,
    )
    .filter((index) => index >= 0);
  if (navigationIndexes.length > 1) {
    fail("plan.actions", "一次计划最多包含一个页面跳转");
  }
  if (
    navigationIndexes.length === 1 &&
    navigationIndexes[0] !== plan.actions.length - 1
  ) {
    fail("plan.actions", "页面跳转必须是计划中的最后一步");
  }
  const inaccessibleAfterAction = lifecycleActions.filter(
    (action) =>
      action.type === "meeting.delete" || action.type === "meeting.purge",
  );
  if (inaccessibleAfterAction.length && navigationIndexes.length) {
    const navigation = plan.actions[navigationIndexes[0]];
    if (
      (navigation.type === "navigate" || navigation.type === "roster.open") &&
      navigation.meetingId === inaccessibleAfterAction[0].meetingId
    ) {
      fail("plan.actions", "删除会议后不能再打开该会议或其名单");
    }
  }
}

export function parseAssistantPlan(value: unknown): AssistantPlan {
  const object = plainObject(value, "plan");
  exactKeys(
    object,
    ["schemaVersion", "summary", "clarification", "warnings", "actions"],
    [],
    "plan",
  );
  if (object.schemaVersion !== ASSISTANT_PLAN_SCHEMA_VERSION) {
    fail("plan.schemaVersion", "当前仅支持版本 1");
  }
  const summary = stringValue(object.summary, "plan.summary", {
    minimum: 1,
    maximum: 1_000,
  });
  const clarification =
    object.clarification === null
      ? null
      : stringValue(object.clarification, "plan.clarification", {
          minimum: 1,
          maximum: 1_000,
        });
  if (!Array.isArray(object.warnings) || object.warnings.length > 10) {
    fail("plan.warnings", "必须是最多包含 10 项的数组");
  }
  const warnings = object.warnings.map((warning, index) =>
    stringValue(warning, `plan.warnings[${index}]`, {
      minimum: 1,
      maximum: 300,
    }),
  );
  if (!Array.isArray(object.actions)) {
    fail("plan.actions", "必须是数组");
  }
  if (object.actions.length > MAX_ASSISTANT_ACTIONS) {
    fail("plan.actions", `最多允许 ${MAX_ASSISTANT_ACTIONS} 个操作`);
  }
  const actions = object.actions.map((action, index) =>
    parseAction(action, `plan.actions[${index}]`),
  );
  if (clarification && actions.length) {
    fail("plan.actions", "需要用户补充信息时不能同时安排操作");
  }
  const plan: AssistantPlan = {
    schemaVersion: ASSISTANT_PLAN_SCHEMA_VERSION,
    summary,
    clarification,
    warnings,
    actions,
  };
  validatePlanComposition(plan);
  return plan;
}

export function isAssistantPlan(value: unknown): value is AssistantPlan {
  try {
    parseAssistantPlan(value);
    return true;
  } catch {
    return false;
  }
}

/** Read-only navigation can run immediately; every data mutation needs consent. */
export function assistantActionRequiresConfirmation(
  action: AssistantAction,
) {
  return !(
    action.type === "navigate" ||
    action.type === "roster.open" ||
    action.type === "contacts.open"
  );
}

export function assistantPlanRequiresConfirmation(plan: AssistantPlan) {
  return plan.actions.some(assistantActionRequiresConfirmation);
}
