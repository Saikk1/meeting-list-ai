import { applyAssistantWorkspace } from "./assistant-workspace";
import { adminConfigChanges } from "./business-data-events";
import {
  archiveMeeting,
  createMeeting,
  deleteMeeting,
  duplicateMeeting,
  loadMeetings,
  meetingRoomValidationIssues,
  purgeMeeting,
  restoreArchivedMeeting,
  restoreDeletedMeeting,
  replaceMeetingAttendees,
  saveMeeting,
  updateMeetingFields,
  updateMeetingTask,
  type CreateMeetingOptions,
  type MeetingInput,
  type MeetingRecord,
  type MeetingRoomReference,
} from "./meeting-data";
import {
  createContact as createContactRecord,
  deleteContact as deleteContactRecord,
  listContacts,
  updateContact as updateContactRecord,
  type ContactInput,
  type ContactRecord,
} from "./contacts";
import {
  cloneAdminConfig,
  isAdminConfig,
  type AdminConfig,
} from "./admin-config";
import { rankRosterRecords } from "./roster-ranking";
import { regenerateSeatingPlan } from "./seating";
import {
  downloadAssistantRosterXlsx,
  prepareAssistantRosterExport,
  type AssistantRosterExportPayload,
} from "./assistant-roster-export";
import {
  executeRosterWorkspaceCommands as executeRosterWorkspaceViaBridge,
  getRosterWorkspaceSnapshot as getRosterWorkspaceSnapshotViaBridge,
  RosterWorkspaceBridgeError,
  validateRosterWorkspaceExecutionResult,
  validateRosterWorkspaceSnapshot,
  type RosterWorkspaceCommand,
  type RosterWorkspaceExecutionResult,
  type RosterWorkspaceSnapshot,
} from "./roster-workspace-bridge";
import {
  AssistantPlanValidationError,
  mergeAdminConfigPatch,
  parseAssistantPlan,
  type AssistantAction,
  type AssistantPlan,
} from "./assistant-contract";

export type AssistantAdminConfigSnapshot = {
  revision: number;
  config: AdminConfig;
};

export type AssistantAdminConfigSaveInput = {
  expectedRevision: number;
  summary: string;
  config: AdminConfig;
};

export type AssistantAdminConfigSaveResult = {
  revision: number;
  config?: AdminConfig;
};

export type AssistantExecutionDependencies = {
  loadMeetings?: () => MeetingRecord[];
  saveMeeting?: (
    meeting: MeetingRecord,
  ) => MeetingRecord | Promise<MeetingRecord>;
  deleteMeeting?: (meetingId: string) => void | Promise<void>;
  duplicateMeeting?: (meeting: MeetingRecord) => MeetingRecord;
  archiveMeeting?: (meetingId: string) => void | Promise<void>;
  restoreArchivedMeeting?: (meetingId: string) => void | Promise<void>;
  restoreDeletedMeeting?: (meetingId: string) => void | Promise<void>;
  purgeMeeting?: (meetingId: string) => void | Promise<void>;
  meetingRooms?: readonly MeetingRoomReference[];
  navigate?: (path: string) => void | Promise<void>;
  createMeetingOptions?: CreateMeetingOptions;
  loadContacts?: () => ContactRecord[] | Promise<ContactRecord[]>;
  createContact?: (
    input: ContactInput,
  ) => ContactRecord | Promise<ContactRecord>;
  updateContact?: (
    id: string,
    input: ContactInput,
  ) => ContactRecord | Promise<ContactRecord>;
  deleteContact?: (id: string) => unknown | Promise<unknown>;
  loadAdminConfig?: () =>
    | AssistantAdminConfigSnapshot
    | Promise<AssistantAdminConfigSnapshot>;
  saveAdminConfig?: (
    input: AssistantAdminConfigSaveInput,
  ) => AssistantAdminConfigSaveResult | Promise<AssistantAdminConfigSaveResult>;
  exportRoster?: (
    payload: AssistantRosterExportPayload,
  ) => string | void | Promise<string | void>;
  getRosterWorkspaceSnapshot?: () =>
    | RosterWorkspaceSnapshot
    | Promise<RosterWorkspaceSnapshot>;
  executeRosterWorkspace?: (
    commands: readonly RosterWorkspaceCommand[],
  ) =>
    | RosterWorkspaceExecutionResult
    | Promise<RosterWorkspaceExecutionResult>;
};

export type AssistantExecutionResult = {
  executedActions: number;
  workspaceMessage?: string;
  createdMeetingIds: string[];
  updatedMeetingIds: string[];
  deletedMeetingIds: string[];
  duplicatedMeetingIds: string[];
  archivedMeetingIds: string[];
  restoredMeetingIds: string[];
  purgedMeetingIds: string[];
  sortedMeetingIds: string[];
  exportedRosterFiles: string[];
  createdContactIds: string[];
  updatedContactIds: string[];
  deletedContactIds: string[];
  adminUpdated: boolean;
  adminRevision: number | null;
  rosterWorkspaceResult: RosterWorkspaceExecutionResult | null;
  navigationPath: string | null;
};

export class AssistantExecutionError extends Error {
  constructor(
    message: string,
    readonly code:
      | "MEETING_NOT_FOUND"
      | "TASK_NOT_FOUND"
      | "CONTACT_NOT_FOUND"
      | "ATTENDEE_NOT_FOUND"
      | "ATTENDEE_ALREADY_EXISTS"
      | "CONTACT_ALREADY_EXISTS"
      | "STALE_MEETING"
      | "STALE_CONTACT"
      | "STALE_ADMIN_CONFIG"
      | "INVALID_FINAL_MEETING"
      | "INVALID_MEETING_STATE"
      | "MEETING_ROOM_CONFLICT"
      | "INVALID_ADMIN_CONFIG"
      | "ADMIN_CONFIG_UNAVAILABLE"
      | "ROSTER_EXPORT_UNAVAILABLE"
      | "ROSTER_WORKSPACE_UNAVAILABLE"
      | "STALE_ROSTER_WORKSPACE"
      | "ROSTER_WORKSPACE_EXECUTION_FAILED"
      | "NAVIGATION_UNAVAILABLE",
  ) {
    super(message);
    this.name = "AssistantExecutionError";
  }
}

const FIXED_NAVIGATION_PATHS = {
  dashboard: "/",
  meetings: "/meetings",
  tasks: "/tasks",
  new_meeting: "/meetings/new",
  admin: "/admin",
  admin_overview: "/admin?section=overview",
  admin_organization: "/admin?section=organization",
  admin_rooms: "/admin?section=rooms",
  admin_contacts: "/admin?section=contacts",
  admin_checklist: "/admin?section=checklist",
  admin_aliases: "/admin?section=aliases",
  admin_roster: "/admin?section=roster",
} as const;

function meetingPath(meetingId: string) {
  return `/meetings/${encodeURIComponent(meetingId)}`;
}

function rosterPath(meetingId?: string) {
  return meetingId
    ? `/meetings/${encodeURIComponent(meetingId)}?tab=attendees&mode=governance`
    : "/lists";
}

function contactsPath() {
  return "/admin?section=contacts";
}

export function resolveAssistantNavigationPath(
  action: Extract<
    AssistantAction,
    { type: "navigate" | "roster.open" | "contacts.open" }
  >,
) {
  if (action.type === "roster.open") return rosterPath(action.meetingId);
  if (action.type === "contacts.open") return contactsPath();
  if (action.destination === "meeting_detail" || action.destination === "meeting_seating") {
    if (!action.meetingId) {
      throw new AssistantPlanValidationError(
        "打开会议详情时必须提供会议 ID",
        "action.meetingId",
      );
    }
    return `${meetingPath(action.meetingId)}${action.destination === "meeting_seating" ? "?tab=seating" : ""}`;
  }
  return FIXED_NAVIGATION_PATHS[action.destination];
}

function defaultNavigate(path: string) {
  if (typeof window === "undefined") {
    throw new AssistantExecutionError(
      "当前环境无法执行页面跳转",
      "NAVIGATION_UNAVAILABLE",
    );
  }
  window.location.assign(path);
}

function requireMeeting(
  meetings: Map<string, MeetingRecord>,
  meetingId: string,
) {
  const meeting = meetings.get(meetingId);
  if (!meeting) {
    throw new AssistantExecutionError(
      "目标会议不存在或已被删除，请重新生成操作计划",
      "MEETING_NOT_FOUND",
    );
  }
  return meeting;
}

function assertExpectedRevision(
  meeting: MeetingRecord,
  expectedUpdatedAt: string,
) {
  if (meeting.updatedAt !== expectedUpdatedAt) {
    throw new AssistantExecutionError(
      `“${meeting.title}”已发生变化，请重新预览后再执行`,
      "STALE_MEETING",
    );
  }
}

function requireContact(
  contacts: Map<string, ContactRecord>,
  contactId: string,
) {
  const contact = contacts.get(contactId);
  if (!contact) {
    throw new AssistantExecutionError(
      "目标联系人不存在或已被删除，请重新生成操作计划",
      "CONTACT_NOT_FOUND",
    );
  }
  return contact;
}

function requireAttendee(
  attendees: Map<string, MeetingRecord["attendees"][number]>,
  attendeeId: string,
) {
  const attendee = attendees.get(attendeeId);
  if (!attendee) {
    throw new AssistantExecutionError(
      "排序结果包含无效参会人，请重新生成操作计划",
      "ATTENDEE_NOT_FOUND",
    );
  }
  return attendee;
}

function assertExpectedContactRevision(
  contact: ContactRecord,
  expectedUpdatedAt: string,
) {
  if (contact.updatedAt !== expectedUpdatedAt) {
    throw new AssistantExecutionError(
      `联系人“${contact.name}”已发生变化，请重新预览后再执行`,
      "STALE_CONTACT",
    );
  }
}

async function loadAllContacts() {
  const contacts: ContactRecord[] = [];
  let offset = 0;
  while (true) {
    const page = await listContacts({ limit: 200, offset });
    contacts.push(...page.contacts);
    offset += page.contacts.length;
    if (!page.contacts.length || offset >= page.total) return contacts;
  }
}

async function adminResponseError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: string | { message?: string };
    };
    if (typeof payload.error === "string") return payload.error;
    if (payload.error?.message) return payload.error.message;
  } catch {
    // Fall through to a status-based error.
  }
  return `后台配置服务请求失败（${response.status}）`;
}

async function loadCurrentAdminConfig(): Promise<AssistantAdminConfigSnapshot> {
  const response = await fetch("/api/admin/config", { cache: "no-store" });
  if (!response.ok) {
    throw new AssistantExecutionError(
      await adminResponseError(response),
      "ADMIN_CONFIG_UNAVAILABLE",
    );
  }
  const payload = (await response.json()) as {
    revision?: unknown;
    config?: unknown;
  };
  if (!Number.isInteger(payload.revision) || (payload.revision as number) < 0) {
    throw new AssistantExecutionError(
      "后台配置版本无效，请刷新后重试",
      "ADMIN_CONFIG_UNAVAILABLE",
    );
  }
  return {
    revision: payload.revision as number,
    config: cloneAdminConfig(payload.config),
  };
}

async function saveCurrentAdminConfig(
  input: AssistantAdminConfigSaveInput,
): Promise<AssistantAdminConfigSaveResult> {
  const response = await fetch("/api/admin/config", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new AssistantExecutionError(
      await adminResponseError(response),
      response.status === 409 ? "STALE_ADMIN_CONFIG" : "ADMIN_CONFIG_UNAVAILABLE",
    );
  }
  const payload = (await response.json()) as {
    revision?: unknown;
    config?: unknown;
  };
  if (!Number.isInteger(payload.revision)) {
    throw new AssistantExecutionError(
      "后台配置保存结果缺少有效版本号",
      "ADMIN_CONFIG_UNAVAILABLE",
    );
  }
  adminConfigChanges.notify();
  return {
    revision: payload.revision as number,
    ...(isAdminConfig(payload.config)
      ? { config: cloneAdminConfig(payload.config) }
      : {}),
  };
}

function makeAttendeeId(contactId: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `attendee-${crypto.randomUUID()}`;
  }
  return `attendee-${contactId}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function sameAttendeeAsContact(
  attendee: MeetingRecord["attendees"][number],
  contact: ContactRecord,
) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
  return (
    normalize(attendee.name) === normalize(contact.name) &&
    normalize(attendee.unit) === normalize(contact.unit)
  );
}

function sameAttendeeIdentity(
  attendee: MeetingRecord["attendees"][number],
  candidate: { name: string; unit: string },
) {
  const normalize = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
  return (
    normalize(attendee.name) === normalize(candidate.name) &&
    normalize(attendee.unit) === normalize(candidate.unit)
  );
}

function contactIdentity(input: Pick<ContactInput, "name" | "unit">) {
  return `${input.name.trim().toLocaleLowerCase("zh-CN")}\u0000${input.unit
    .trim()
    .toLocaleLowerCase("zh-CN")}`;
}

function validateFinalMeetingInput(meeting: MeetingRecord) {
  const endTime = (meeting as MeetingRecord & { endTime?: string }).endTime;
  const input: MeetingInput & { endTime?: string } = {
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    location: meeting.location,
    ...(meeting.meetingRoomId
      ? { meetingRoomId: meeting.meetingRoomId }
      : {}),
    ...(meeting.roomRequirements
      ? { roomRequirements: meeting.roomRequirements }
      : {}),
    organizer: meeting.organizer,
    owner: meeting.owner,
    attendeeEstimate: meeting.attendeeEstimate,
    rosterRequired: meeting.rosterRequired === true,
    afternoonMeeting: meeting.afternoonMeeting,
    mealType: meeting.mealType,
    alcoholRequired: meeting.alcoholRequired,
    parkingRequired: meeting.parkingRequired,
    vehicleCount: meeting.vehicleCount,
    vehicles: meeting.parkingRequired ? meeting.vehicles ?? [] : [],
    publicityRequired: meeting.publicityRequired,
    reimbursementRequired: meeting.reimbursementRequired,
    presentationRequired: meeting.presentationRequired,
    welcomeScreenRequired: meeting.welcomeScreenRequired,
    roomSize: meeting.roomSize,
    ...(endTime ? { endTime } : {}),
  };
  try {
    parseAssistantPlan({
      schemaVersion: 1,
      summary: "校验会议修改结果",
      clarification: null,
      warnings: [],
      actions: [{ type: "meeting.create", input }],
    });
  } catch (error) {
    throw new AssistantExecutionError(
      error instanceof Error
        ? `会议修改后的字段组合无效：${error.message}`
        : "会议修改后的字段组合无效",
      "INVALID_FINAL_MEETING",
    );
  }
}

function validateMeetingRoomBeforeWrite(
  meeting: MeetingRecord,
  rooms: readonly MeetingRoomReference[] | undefined,
  meetings: readonly MeetingRecord[],
  excludeMeetingId?: string,
) {
  if (!rooms) return;
  const blocking = meetingRoomValidationIssues(
    meeting,
    rooms,
    meetings,
    excludeMeetingId,
  ).find((issue) => issue.severity === "error");
  if (blocking) {
    throw new AssistantExecutionError(
      blocking.message,
      "MEETING_ROOM_CONFLICT",
    );
  }
}

function navigationAction(plan: AssistantPlan) {
  return plan.actions.find(
    (
      action,
    ): action is Extract<
      AssistantAction,
      { type: "navigate" | "roster.open" | "contacts.open" }
    > =>
      action.type === "navigate" ||
      action.type === "roster.open" ||
      action.type === "contacts.open",
  );
}

function rosterWorkspaceCommands(
  plan: AssistantPlan,
): RosterWorkspaceCommand[] {
  return plan.actions.filter(
    (action): action is RosterWorkspaceCommand =>
      action.type.startsWith("roster.workspace."),
  );
}

function throwRosterWorkspaceError(error: unknown): never {
  if (error instanceof AssistantExecutionError) throw error;
  if (error instanceof RosterWorkspaceBridgeError) {
    if (error.code === "STALE_REVISION") {
      throw new AssistantExecutionError(
        error.message,
        "STALE_ROSTER_WORKSPACE",
      );
    }
    if (error.code === "UNAVAILABLE" || error.code === "TIMEOUT") {
      throw new AssistantExecutionError(
        error.message,
        "ROSTER_WORKSPACE_UNAVAILABLE",
      );
    }
    throw new AssistantExecutionError(
      error.message,
      "ROSTER_WORKSPACE_EXECUTION_FAILED",
    );
  }
  throw new AssistantExecutionError(
    error instanceof Error ? error.message : "名单治理工作区执行失败",
    "ROSTER_WORKSPACE_EXECUTION_FAILED",
  );
}

/**
 * This is the only function in the assistant core that mutates meeting or
 * contact data. Parsing, staging and navigation-path resolution stay pure;
 * writes happen only after the complete plan has passed preflight checks.
 */
export async function executeConfirmedPlan(
  untrustedPlan: unknown,
  dependencies: AssistantExecutionDependencies = {},
): Promise<AssistantExecutionResult> {
  const plan = parseAssistantPlan(untrustedPlan);
  if (plan.clarification) {
    throw new AssistantPlanValidationError(
      "需要补充信息的计划不能执行",
      "plan.clarification",
    );
  }

  const pageAction = plan.actions.find((a) => a.type === "page.workspace.apply");
  const workspaceCommands = rosterWorkspaceCommands(plan);
  let workspaceSnapshot: RosterWorkspaceSnapshot | null = null;
  if (workspaceCommands.length) {
    try {
      const getSnapshot =
        dependencies.getRosterWorkspaceSnapshot ??
        getRosterWorkspaceSnapshotViaBridge;
      workspaceSnapshot = validateRosterWorkspaceSnapshot(
        await Promise.resolve(getSnapshot()),
      );
      if (
        workspaceSnapshot.revision !==
        workspaceCommands[0].expectedRevision
      ) {
        throw new AssistantExecutionError(
          "名单治理工作区已发生变化，请重新预览后再执行",
          "STALE_ROSTER_WORKSPACE",
        );
      }
    } catch (error) {
      throwRosterWorkspaceError(error);
    }
  }

  const load = dependencies.loadMeetings ?? loadMeetings;
  const save = dependencies.saveMeeting ?? saveMeeting;
  const navigate = dependencies.navigate ?? defaultNavigate;
  const initialMeetings = load();
  const initialById = new Map(
    initialMeetings.map((meeting) => [meeting.id, meeting]),
  );
  const stagedById = new Map(initialById);
  const changedMeetingIds = new Set<string>();
  const deletedMeetingIds = new Set<string>();
  const archivedMeetingIds = new Set<string>();
  const restoredArchivedMeetingIds = new Set<string>();
  const restoredDeletedMeetingIds = new Set<string>();
  const purgedMeetingIds = new Set<string>();
  const sortedMeetingIds = new Set<string>();
  const stagedRosterExports: AssistantRosterExportPayload[] = [];
  const createdMeetings: MeetingRecord[] = [];
  const duplicatedMeetingIds = new Set<string>();
  const needsContacts = plan.actions.some(
    (action) =>
      action.type === "contact.create" ||
      action.type === "contact.update" ||
      action.type === "contact.delete" ||
      action.type === "meeting.attendee.add_from_contact",
  );
  const initialContacts = needsContacts
    ? await Promise.resolve(
        (dependencies.loadContacts ?? loadAllContacts)(),
      )
    : [];
  const initialContactsById = new Map(
    initialContacts.map((contact) => [contact.id, contact]),
  );
  const stagedContactInputs = new Map<string, ContactInput>(
    initialContacts.map((contact) => [
      contact.id,
      {
        name: contact.name,
        unit: contact.unit,
        department: contact.department,
        title: contact.title,
      },
    ]),
  );
  const stagedContactCreates: ContactInput[] = [];
  const stagedContactUpdates: Array<{ id: string; input: ContactInput }> = [];
  const stagedContactDeletes: string[] = [];
  let stagedAdminSave: AssistantAdminConfigSaveInput | null = null;
  const adminAction = plan.actions.find(
    (
      action,
    ): action is Extract<AssistantAction, { type: "admin.config.patch" }> =>
      action.type === "admin.config.patch",
  );
  const adminSnapshot = adminAction || plan.actions.some((action) => action.type === "meeting.seating.generate")
    ? await Promise.resolve(
        (dependencies.loadAdminConfig ?? loadCurrentAdminConfig)(),
      )
    : null;
  const destination = navigationAction(plan);

  if (destination && !dependencies.navigate && typeof window === "undefined") {
    throw new AssistantExecutionError(
      "当前环境无法执行页面跳转",
      "NAVIGATION_UNAVAILABLE",
    );
  }

  // Stage and validate every operation before the first persistent write.
  for (const action of plan.actions) {
    switch (action.type) {
      case "page.workspace.apply": break;
      case "meeting.create": {
        const { attendees, notes, ...meetingInput } = action.input;
        const created = createMeeting(
          meetingInput,
          {
            ...dependencies.createMeetingOptions,
            ...(attendees ? { attendees: attendees.map((attendee, index) => ({
              ...attendee, id: `assistant-attendee-${index}`, source: "智能助手录入",
            })) } : {}),
          },
        );
        if (notes !== undefined) created.notes = notes;
        validateMeetingRoomBeforeWrite(
          created,
          dependencies.meetingRooms,
          [...stagedById.values(), ...createdMeetings],
        );
        createdMeetings.push(created);
        break;
      }
      case "meeting.delete": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (original.deletedAt) {
          throw new AssistantExecutionError(
            "该会议已经在回收站中，无需重复删除",
            "INVALID_MEETING_STATE",
          );
        }
        deletedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.duplicate": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (original.deletedAt) {
          throw new AssistantExecutionError(
            "回收站中的会议不能直接复制，请先恢复",
            "INVALID_MEETING_STATE",
          );
        }
        const duplicate = (dependencies.duplicateMeeting ?? duplicateMeeting)(
          original,
        );
        validateMeetingRoomBeforeWrite(
          duplicate,
          dependencies.meetingRooms,
          [...stagedById.values(), ...createdMeetings],
        );
        createdMeetings.push(duplicate);
        duplicatedMeetingIds.add(duplicate.id);
        break;
      }
      case "meeting.archive": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (original.deletedAt || original.archivedAt) {
          throw new AssistantExecutionError(
            "只有当前会议可以归档",
            "INVALID_MEETING_STATE",
          );
        }
        archivedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.restore_archived": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (!original.archivedAt || original.deletedAt) {
          throw new AssistantExecutionError(
            "该会议不在归档中",
            "INVALID_MEETING_STATE",
          );
        }
        validateMeetingRoomBeforeWrite(
          { ...original, archivedAt: undefined },
          dependencies.meetingRooms,
          [...stagedById.values()],
          original.id,
        );
        restoredArchivedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.restore_deleted": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (!original.deletedAt) {
          throw new AssistantExecutionError(
            "该会议不在回收站中",
            "INVALID_MEETING_STATE",
          );
        }
        validateMeetingRoomBeforeWrite(
          { ...original, deletedAt: undefined, archivedAt: undefined },
          dependencies.meetingRooms,
          [...stagedById.values()],
          original.id,
        );
        restoredDeletedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.purge": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        if (!original.deletedAt) {
          throw new AssistantExecutionError(
            "只有回收站中的会议可以彻底删除",
            "INVALID_MEETING_STATE",
          );
        }
        purgedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.update_fields": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        let next: MeetingRecord;
        try {
          next = updateMeetingFields(current, action.patch);
        } catch (error) {
          throw new AssistantExecutionError(
            error instanceof Error
              ? `会议修改后的字段组合无效：${error.message}`
              : "会议修改后的字段组合无效",
            "INVALID_FINAL_MEETING",
          );
        }
        validateFinalMeetingInput(next);
        validateMeetingRoomBeforeWrite(
          next,
          dependencies.meetingRooms,
          [...stagedById.values()],
          current.id,
        );
        stagedById.set(action.meetingId, next);
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.task.update": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        if (!current.tasks.some((task) => task.id === action.taskId)) {
          throw new AssistantExecutionError(
            "目标任务不存在或已被删除，请重新生成操作计划",
            "TASK_NOT_FOUND",
          );
        }
        stagedById.set(
          action.meetingId,
          updateMeetingTask(current, action.taskId, action.patch),
        );
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.attendee.add_from_contact": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const contact = requireContact(
          initialContactsById,
          action.contactId,
        );
        assertExpectedContactRevision(
          contact,
          action.expectedContactUpdatedAt,
        );
        const current = requireMeeting(stagedById, action.meetingId);
        if (
          current.attendees.some((attendee) =>
            sameAttendeeAsContact(attendee, contact),
          )
        ) {
          throw new AssistantExecutionError(
            `“${contact.name}”已经在本次会议的参会名单中`,
            "ATTENDEE_ALREADY_EXISTS",
          );
        }
        stagedById.set(
          action.meetingId,
          replaceMeetingAttendees(current, [
            ...current.attendees,
            {
              id: makeAttendeeId(contact.id),
              name: contact.name,
              unit: contact.unit,
              department: contact.department,
              title: contact.title,
              source: "通讯录",
            },
          ]),
        );
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.attendee.add": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        if (
          current.attendees.some((attendee) =>
            sameAttendeeIdentity(attendee, action.attendee),
          )
        ) {
          throw new AssistantExecutionError(
            `“${action.attendee.name}”已经在本次会议的参会名单中`,
            "ATTENDEE_ALREADY_EXISTS",
          );
        }
        stagedById.set(
          action.meetingId,
          replaceMeetingAttendees(current, [
            ...current.attendees,
            {
              id: makeAttendeeId("manual"),
              ...action.attendee,
              source: "智能助手录入",
            },
          ]),
        );
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.attendee.update": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        const attendee = current.attendees.find(
          (item) => item.id === action.attendeeId,
        );
        if (!attendee) {
          throw new AssistantExecutionError(
            "目标参会人不存在或已被移除，请重新生成操作计划",
            "ATTENDEE_NOT_FOUND",
          );
        }
        const updatedAttendee = { ...attendee, ...action.patch, id: attendee.id };
        if (
          current.attendees.some(
            (item) =>
              item.id !== attendee.id &&
              sameAttendeeIdentity(item, updatedAttendee),
          )
        ) {
          throw new AssistantExecutionError(
            `“${updatedAttendee.name}”已经在本次会议的参会名单中`,
            "ATTENDEE_ALREADY_EXISTS",
          );
        }
        stagedById.set(
          action.meetingId,
          replaceMeetingAttendees(
            current,
            current.attendees.map((item) =>
            item.id === attendee.id ? updatedAttendee : item,
            ),
          ),
        );
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.attendee.remove": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        if (!current.attendees.some((item) => item.id === action.attendeeId)) {
          throw new AssistantExecutionError(
            "目标参会人不存在或已被移除，请重新生成操作计划",
            "ATTENDEE_NOT_FOUND",
          );
        }
        stagedById.set(
          action.meetingId,
          replaceMeetingAttendees(
            current,
            current.attendees.filter(
            (item) => item.id !== action.attendeeId,
            ),
          ),
        );
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.seating.generate": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        if (!adminSnapshot || adminSnapshot.revision !== action.expectedConfigRevision) throw new AssistantExecutionError("座次规则配置已变化，请重新生成操作预览", "STALE_ADMIN_CONFIG");
        const participants = action.participants ?? current.seatingPlan?.participants ?? current.attendees.map((person) => ({ id: person.id, name: person.name, unit: person.unit, title: person.title, grade: "", weight: null, party: "auto" as const }));
        const seatingPlan = regenerateSeatingPlan(participants, action.options, adminSnapshot.config.rosterRules, current.seatingPlan);
        stagedById.set(action.meetingId, { ...current, seatingPlan, updatedAt: new Date().toISOString() });
        changedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.roster.sort": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        const ranked = rankRosterRecords(
          current.attendees.map((attendee, index) => ({
            ...attendee,
            originalIndex: index,
          })),
          action.rosterRules,
        ).records;
        const attendeesById = new Map(
          current.attendees.map((attendee) => [attendee.id, attendee]),
        );
        stagedById.set(
          action.meetingId,
          replaceMeetingAttendees(
            current,
            ranked.map((attendee) =>
              requireAttendee(attendeesById, attendee.id),
            ),
            { enableRosterWorkflow: true },
          ),
        );
        changedMeetingIds.add(action.meetingId);
        sortedMeetingIds.add(action.meetingId);
        break;
      }
      case "meeting.roster.export": {
        const original = requireMeeting(initialById, action.meetingId);
        assertExpectedRevision(original, action.expectedUpdatedAt);
        const current = requireMeeting(stagedById, action.meetingId);
        try {
          stagedRosterExports.push(
            prepareAssistantRosterExport(current, action.rosterRules),
          );
          stagedById.set(
            action.meetingId,
            replaceMeetingAttendees(current, current.attendees, {
              enableRosterWorkflow: true,
            }),
          );
          changedMeetingIds.add(action.meetingId);
        } catch (error) {
          throw new AssistantExecutionError(
            error instanceof Error
              ? `名单导出配置无效：${error.message}`
              : "名单导出配置无效",
            "ROSTER_EXPORT_UNAVAILABLE",
          );
        }
        break;
      }
      case "contact.create": {
        stagedContactCreates.push(action.input);
        stagedContactInputs.set(
          `__new-contact-${stagedContactCreates.length}`,
          action.input,
        );
        break;
      }
      case "contact.update": {
        const original = requireContact(
          initialContactsById,
          action.contactId,
        );
        assertExpectedContactRevision(original, action.expectedUpdatedAt);
        const staged = {
          id: original.id,
          input: {
            name: action.patch.name ?? original.name,
            unit: action.patch.unit ?? original.unit,
            department: action.patch.department ?? original.department,
            title: action.patch.title ?? original.title,
          },
        };
        stagedContactUpdates.push(staged);
        stagedContactInputs.set(staged.id, staged.input);
        break;
      }
      case "contact.delete": {
        const original = requireContact(
          initialContactsById,
          action.contactId,
        );
        assertExpectedContactRevision(original, action.expectedUpdatedAt);
        stagedContactDeletes.push(original.id);
        stagedContactInputs.delete(original.id);
        break;
      }
      case "admin.config.patch": {
        if (
          !adminSnapshot ||
          !Number.isInteger(adminSnapshot.revision) ||
          !isAdminConfig(adminSnapshot.config)
        ) {
          throw new AssistantExecutionError(
            "后台配置快照无效，请刷新后重试",
            "ADMIN_CONFIG_UNAVAILABLE",
          );
        }
        if (adminSnapshot.revision !== action.expectedRevision) {
          throw new AssistantExecutionError(
            "后台配置已发生变化，请重新预览后再执行",
            "STALE_ADMIN_CONFIG",
          );
        }
        let config: AdminConfig;
        try {
          config = mergeAdminConfigPatch(adminSnapshot.config, action.patch);
        } catch (error) {
          throw new AssistantExecutionError(
            error instanceof Error
              ? `后台配置修改后的结果无效：${error.message}`
              : "后台配置修改后的结果无效",
            "INVALID_ADMIN_CONFIG",
          );
        }
        if (!isAdminConfig(config)) {
          throw new AssistantExecutionError(
            "后台配置修改后的结果无效",
            "INVALID_ADMIN_CONFIG",
          );
        }
        stagedAdminSave = {
          expectedRevision: action.expectedRevision,
          summary: action.summary,
          config,
        };
        break;
      }
      case "roster.workspace.set_text":
      case "roster.workspace.process":
      case "roster.workspace.record.update":
      case "roster.workspace.record.add":
      case "roster.workspace.record.remove":
      case "roster.workspace.alias.apply":
      case "roster.workspace.confirm":
      case "roster.workspace.analyze_ranking":
      case "roster.workspace.enrich_person":
      case "roster.workspace.save_to_meeting":
      case "roster.workspace.export":
        // The complete workspace command batch was preflighted above and is
        // executed atomically through the browser bridge after other staging.
        break;
      case "navigate":
      case "roster.open":
      case "contacts.open": {
        if ("meetingId" in action && action.meetingId) {
          requireMeeting(initialById, action.meetingId);
        }
        break;
      }
    }
  }

  const contactIdentityOwners = new Map<string, string>();
  for (const [id, input] of stagedContactInputs) {
    const identity = contactIdentity(input);
    const existingOwner = contactIdentityOwners.get(identity);
    if (existingOwner && existingOwner !== id) {
      throw new AssistantExecutionError(
        `通讯录中已存在“${input.name}（${input.unit}）”`,
        "CONTACT_ALREADY_EXISTS",
      );
    }
    contactIdentityOwners.set(identity, id);
  }

  const savedCreatedIds: string[] = [];
  const savedDuplicatedMeetingIds: string[] = [];
  const savedUpdatedIds: string[] = [];
  const savedCreatedContactIds: string[] = [];
  const savedUpdatedContactIds: string[] = [];
  const savedDeletedContactIds: string[] = [];
  const deleteContact = dependencies.deleteContact ?? deleteContactRecord;
  const updateContact = dependencies.updateContact ?? updateContactRecord;
  const createContact = dependencies.createContact ?? createContactRecord;
  for (const contactId of stagedContactDeletes) {
    await Promise.resolve(deleteContact(contactId));
    savedDeletedContactIds.push(contactId);
  }
  for (const staged of stagedContactUpdates) {
    savedUpdatedContactIds.push(
      (await Promise.resolve(updateContact(staged.id, staged.input))).id,
    );
  }
  for (const input of stagedContactCreates) {
    savedCreatedContactIds.push(
      (await Promise.resolve(createContact(input))).id,
    );
  }
  for (const meeting of createdMeetings) {
    const savedMeeting = await Promise.resolve(save(meeting));
    savedCreatedIds.push(savedMeeting.id);
    if (duplicatedMeetingIds.has(meeting.id)) {
      savedDuplicatedMeetingIds.push(savedMeeting.id);
    }
  }
  for (const meetingId of changedMeetingIds) {
    savedUpdatedIds.push(
      (await Promise.resolve(save(requireMeeting(stagedById, meetingId)))).id,
    );
  }
  const savedDeletedMeetingIds: string[] = [];
  const removeMeeting = dependencies.deleteMeeting ?? deleteMeeting;
  for (const meetingId of deletedMeetingIds) {
    await Promise.resolve(removeMeeting(meetingId));
    savedDeletedMeetingIds.push(meetingId);
  }
  const savedArchivedMeetingIds: string[] = [];
  const archive = dependencies.archiveMeeting ?? archiveMeeting;
  for (const meetingId of archivedMeetingIds) {
    await Promise.resolve(archive(meetingId));
    savedArchivedMeetingIds.push(meetingId);
  }
  const savedRestoredMeetingIds: string[] = [];
  const restoreArchive =
    dependencies.restoreArchivedMeeting ?? restoreArchivedMeeting;
  for (const meetingId of restoredArchivedMeetingIds) {
    await Promise.resolve(restoreArchive(meetingId));
    savedRestoredMeetingIds.push(meetingId);
  }
  const restoreDeleted =
    dependencies.restoreDeletedMeeting ?? restoreDeletedMeeting;
  for (const meetingId of restoredDeletedMeetingIds) {
    await Promise.resolve(restoreDeleted(meetingId));
    savedRestoredMeetingIds.push(meetingId);
  }
  const savedPurgedMeetingIds: string[] = [];
  const purge = dependencies.purgeMeeting ?? purgeMeeting;
  for (const meetingId of purgedMeetingIds) {
    await Promise.resolve(purge(meetingId));
    savedPurgedMeetingIds.push(meetingId);
  }

  let adminRevision: number | null = null;
  if (stagedAdminSave) {
    const saveAdmin = dependencies.saveAdminConfig ?? saveCurrentAdminConfig;
    const result = await Promise.resolve(saveAdmin(stagedAdminSave));
    if (!Number.isInteger(result.revision)) {
      throw new AssistantExecutionError(
        "后台配置保存结果缺少有效版本号",
        "ADMIN_CONFIG_UNAVAILABLE",
      );
    }
    adminRevision = result.revision;
  }

  const exportedRosterFiles: string[] = [];
  const exportRoster =
    dependencies.exportRoster ?? downloadAssistantRosterXlsx;
  for (const payload of stagedRosterExports) {
    try {
      const exportedFileName = await Promise.resolve(exportRoster(payload));
      exportedRosterFiles.push(
        typeof exportedFileName === "string" && exportedFileName.trim()
          ? exportedFileName
          : payload.fileName,
      );
    } catch (error) {
      if (error instanceof AssistantExecutionError) throw error;
      throw new AssistantExecutionError(
        error instanceof Error
          ? `名单导出失败：${error.message}`
          : "名单导出失败",
        "ROSTER_EXPORT_UNAVAILABLE",
      );
    }
  }

  let rosterWorkspaceResult: RosterWorkspaceExecutionResult | null = null;
  if (workspaceCommands.length) {
    try {
      const executeWorkspace =
        dependencies.executeRosterWorkspace ??
        executeRosterWorkspaceViaBridge;
      rosterWorkspaceResult = validateRosterWorkspaceExecutionResult(
        await Promise.resolve(executeWorkspace(workspaceCommands)),
        workspaceCommands,
      );
    } catch (error) {
      throwRosterWorkspaceError(error);
    }
  }

  const pageResult = pageAction ? await applyAssistantWorkspace(pageAction) : null;
  if (pageResult?.persisted && pageResult.meetingId) savedUpdatedIds.push(pageResult.meetingId);
  if (pageResult?.createdMeetingId) savedCreatedIds.push(pageResult.createdMeetingId);

  const navigationPath = destination
    ? resolveAssistantNavigationPath(destination)
    : null;
  if (navigationPath) await navigate(navigationPath);

  return {
    executedActions: plan.actions.length,
    ...(pageResult ? { workspaceMessage: pageResult.message } : {}),
    createdMeetingIds: savedCreatedIds,
    updatedMeetingIds: savedUpdatedIds,
    deletedMeetingIds: savedDeletedMeetingIds,
    duplicatedMeetingIds: savedDuplicatedMeetingIds,
    archivedMeetingIds: savedArchivedMeetingIds,
    restoredMeetingIds: savedRestoredMeetingIds,
    purgedMeetingIds: savedPurgedMeetingIds,
    sortedMeetingIds: [...sortedMeetingIds],
    exportedRosterFiles,
    createdContactIds: savedCreatedContactIds,
    updatedContactIds: savedUpdatedContactIds,
    deletedContactIds: savedDeletedContactIds,
    adminUpdated: adminRevision !== null,
    adminRevision,
    rosterWorkspaceResult,
    navigationPath,
  };
}
