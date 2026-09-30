import { normalizeMeetingVehicles, type MeetingVehicle } from "./meeting-vehicles";
import type { SeatingPlan } from "./seating";

export type MeetingPhase = "before" | "during" | "after";
export type TaskStatus =
  | "todo"
  | "doing"
  | "blocked"
  | "review"
  | "done"
  | "waived";

export type MealType = "none" | "business" | "work";
export type RoomSize = "small" | "large";

export type MeetingRuleReminders = {
  missingLocation: boolean;
  missingOwner: boolean;
  missingRoster: boolean;
  overdueTasks: boolean;
  blockedTasks: boolean;
};

export type MeetingRules = {
  parkingVehicleLimit: number;
  businessMealMin: number;
  businessMealMax: number;
  waterServiceIntervalMinutes: number;
  reminders: MeetingRuleReminders;
};

export type MeetingAttendee = {
  id: string;
  name: string;
  unit: string;
  department: string;
  title: string;
  /** Legacy only; moved to the meeting's independent vehicle register on load. */
  licensePlate?: string;
  source?: string;
};

export type MeetingAttachment = {
  name: string;
  size: number;
  addedAt: string;
};

export type MeetingTask = {
  id: string;
  templateId: string;
  title: string;
  description: string;
  phase: MeetingPhase;
  group: string;
  status: TaskStatus;
  owner: string;
  dueDate: string;
  note: string;
  attachments: MeetingAttachment[];
  sopImages?: string[];
};

export type MeetingInput = {
  title: string;
  date: string;
  startTime: string;
  /** Optional end time. Older meetings and the manual form remain compatible. */
  endTime?: string;
  location: string;
  /** Configured meeting-room identity; location remains a durable text snapshot. */
  meetingRoomId?: string;
  /** Room-specific setup or usage requirements captured when the meeting is created. */
  roomRequirements?: string;
  organizer: string;
  owner: string;
  attendeeEstimate: number;
  /** Whether this meeting needs a named attendee roster and roster workflow. */
  rosterRequired?: boolean;
  afternoonMeeting: boolean;
  mealType: MealType;
  alcoholRequired: boolean;
  parkingRequired: boolean;
  vehicleCount: number;
  /** Independent unit/vehicle register. No person identity is attached. */
  vehicles?: MeetingVehicle[];
  publicityRequired: boolean;
  reimbursementRequired: boolean;
  presentationRequired: boolean;
  welcomeScreenRequired: boolean;
  roomSize: RoomSize;
};

export type MeetingRecord = MeetingInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
  /** Archived meetings remain searchable but leave the active work queue. */
  archivedAt?: string;
  /** Soft-deleted meetings remain recoverable until they are permanently removed. */
  deletedAt?: string;
  notes?: string;
  tasks: MeetingTask[];
  attendees: MeetingAttendee[];
  /** Confirmed seating snapshot, separate from the source attendee roster. */
  seatingPlan?: SeatingPlan;
  templateSource?: {
    configRevision: number;
    capturedAt: string;
    checklistTemplates: ChecklistTemplateItem[];
  };
  ruleSnapshot?: MeetingRules;
};

export type ChecklistCondition =
  | "always"
  | "roster"
  | "rosterWelcomeScreen"
  | "afternoon"
  | "businessMeal"
  | "businessMealAlcohol"
  | "workMeal"
  | "parking"
  | "publicity"
  | "presentation"
  | "welcomeScreen"
  | "largeMeeting"
  | "reimbursement"
  | "mealReimbursement";

export type ChecklistTemplateItem = {
  id: string;
  title: string;
  description: string;
  phase: MeetingPhase;
  group: string;
  condition: ChecklistCondition;
  dueOffsetDays: number;
  enabled: boolean;
  sopImages?: string[];
};

export type CreateMeetingOptions = {
  checklistTemplates?: ChecklistTemplateItem[];
  configRevision?: number;
  meetingRules?: MeetingRules;
  attendees?: MeetingAttendee[];
};

export type ReplaceMeetingAttendeesOptions = {
  enableRosterWorkflow?: boolean;
  estimateMode?: "minimum" | "exact";
};

export type CreateDemoMeetingOptions = CreateMeetingOptions & {
  meetingDefaults?: Partial<MeetingInput>;
};

export const MEETING_STORAGE_KEY = "meeting-assistant:meetings:v1";
export const MEETING_MIGRATION_KEY = "meeting-assistant:meetings-file:v1";
const MEETING_CHANGE_EVENT = "meeting-assistant:change";
export const EMPTY_MEETINGS: MeetingRecord[] = [];
export type MeetingStoreSnapshot = {
  active: MeetingRecord[];
  archived: MeetingRecord[];
  deleted: MeetingRecord[];
  all: MeetingRecord[];
};

export const EMPTY_MEETING_STORE: MeetingStoreSnapshot = {
  active: EMPTY_MEETINGS,
  archived: EMPTY_MEETINGS,
  deleted: EMPTY_MEETINGS,
  all: EMPTY_MEETINGS,
};
let cachedStorageValue: string | null | undefined;
let cachedAllMeetings: MeetingRecord[] = EMPTY_MEETINGS;
let cachedMeetingStore = EMPTY_MEETING_STORE;
let hydrationPromise: Promise<void> | null = null;
let localDirtySinceStartup = false;
let persistenceTimer: ReturnType<typeof setTimeout> | null = null;
let persistenceQueue: Promise<void> = Promise.resolve();

const APPLICATION_OVERVIEW = "/sop/kingdee-application-overview.png";
const APPLICATION_FORM = "/sop/kingdee-application-form.png";
const REIMBURSEMENT_OVERVIEW =
  "/sop/kingdee-reimbursement-overview.png";
const INVOICE_IMPORT = "/sop/kingdee-invoice-import.png";

const BASE_CHECKLIST_TEMPLATE: Array<
  Omit<ChecklistTemplateItem, "enabled">
> = [
  {
    id: "meal-confirm-lunch",
    title: "额外确认是否需要午餐",
    description: "下午会议先向会议对接人确认是否安排午餐，再选择商务餐或工作餐。",
    phase: "before",
    group: "用餐招待筹备",
    condition: "afternoon",
    dueOffsetDays: -3,
  },
  {
    id: "business-meal-application",
    title: "线上填写业务招待申请单",
    description:
      "在金蝶人人费用中发起业务招待申请；接待/招待层级按我方口径填写。商务餐参考标准为人均300—400元。",
    phase: "before",
    group: "用餐招待筹备 · 商务餐",
    condition: "businessMeal",
    dueOffsetDays: -3,
    sopImages: [APPLICATION_OVERVIEW, APPLICATION_FORM],
  },
  {
    id: "business-meal-alcohol",
    title: "领取酒水并确认退瓶登记",
    description:
      "联系付博，从钱师傅仓库领取酒水；未使用酒水退回时，在流程末尾到仓库登记退瓶。",
    phase: "before",
    group: "用餐招待筹备 · 商务餐",
    condition: "businessMealAlcohol",
    dueOffsetDays: -1,
  },
  {
    id: "business-meal-submit",
    title: "提交线上业务招待流程",
    description: "核对往来单位、事由、招待人数、地点及申请金额后提交审批。",
    phase: "before",
    group: "用餐招待筹备 · 商务餐",
    condition: "businessMeal",
    dueOffsetDays: -2,
    sopImages: [APPLICATION_FORM],
  },
  {
    id: "work-meal-paper-application",
    title: "准备纸质业务招待申请表签字",
    description: "工作餐使用纸质申请表签字；线上流程由综合办统一处理。",
    phase: "before",
    group: "用餐招待筹备 · 工作餐",
    condition: "workMeal",
    dueOffsetDays: -2,
  },
  {
    id: "parking-demand",
    title: "统计参会车辆需求",
    description: "向各参会单位收集车辆数量和车牌信息。",
    phase: "before",
    group: "停车安排",
    condition: "parking",
    dueOffsetDays: -3,
  },
  {
    id: "parking-license-report",
    title: "提前1天报备参会车牌",
    description: "联系付博报备参会车牌，当前标准最多报备4辆车。",
    phase: "before",
    group: "停车安排",
    condition: "parking",
    dueOffsetDays: -1,
  },
  {
    id: "parking-guide",
    title: "发送停车指引",
    description: "将停车入口、停放区域和联系人发送给相关参会人员。",
    phase: "before",
    group: "停车安排",
    condition: "parking",
    dueOffsetDays: -1,
  },
  {
    id: "room-booking",
    title: "完成会议室预约",
    description: "确认会议室、使用时段、容纳人数及现场联系人。",
    phase: "before",
    group: "场地与资料筹备",
    condition: "always",
    dueOffsetDays: -3,
  },
  {
    id: "print-meeting-plan",
    title: "打印定稿会议方案",
    description: "按每位领导1份准备纸质定稿会议方案。",
    phase: "before",
    group: "场地与资料筹备",
    condition: "always",
    dueOffsetDays: -1,
  },
  {
    id: "print-nameplates",
    title: "打印参会人员姓名牌",
    description: "以会议项目中已发布的参会名单为准，逐一核对姓名和职务。",
    phase: "before",
    group: "场地与资料筹备",
    condition: "roster",
    dueOffsetDays: -1,
  },
  {
    id: "prepare-drinks",
    title: "准备茶水、矿泉水和咖啡",
    description: "按实际人数准备，并与综合办完成交接。",
    phase: "before",
    group: "场地与资料筹备",
    condition: "always",
    dueOffsetDays: -1,
  },
  {
    id: "confirm-publicity-copy",
    title: "确认是否需要OA稿或宣传稿",
    description: "明确稿件类型、素材要求、拍摄人员和提交时间。",
    phase: "before",
    group: "场地与资料筹备",
    condition: "publicity",
    dueOffsetDays: -2,
  },
  {
    id: "equipment-test",
    title: "调试全部会议设备并留存记录",
    description: "检查显示、音响、网络、话筒、电源等设备，记录调试结果。",
    phase: "before",
    group: "设备物料调试",
    condition: "always",
    dueOffsetDays: -1,
  },
  {
    id: "seat-order",
    title: "完成参会座位排序",
    description: "结合已确认名单、单位和职务完成座次安排。",
    phase: "before",
    group: "设备物料调试",
    condition: "roster",
    dueOffsetDays: -1,
  },
  {
    id: "presentation-computer",
    title: "准备Windows电脑和U盘用于PPT投屏",
    description: "提前拷贝并试播最终PPT，同时准备U盘备份。",
    phase: "before",
    group: "设备物料调试",
    condition: "presentation",
    dueOffsetDays: -1,
  },
  {
    id: "electronic-nameplate",
    title: "制作电子桌签投屏文件",
    description: "使用已确认名单制作电子桌签，并完成显示效果测试。",
    phase: "before",
    group: "设备物料调试",
    condition: "rosterWelcomeScreen",
    dueOffsetDays: -1,
  },
  {
    id: "welcome-screen",
    title: "准备会议欢迎辞PPT",
    description: "根据小会议室或大会议室屏幕规格准备对应欢迎页面。",
    phase: "before",
    group: "设备物料调试",
    condition: "welcomeScreen",
    dueOffsetDays: -1,
  },
  {
    id: "place-materials",
    title: "桌面摆放会议方案和姓名牌",
    description: "会前按座次完成材料、姓名牌及必要文具摆放。",
    phase: "during",
    group: "现场执行",
    condition: "always",
    dueOffsetDays: 0,
  },
  {
    id: "water-service",
    title: "大型会议每半小时加水",
    description: "会议进行中定时巡视并维护茶水、矿泉水供应。",
    phase: "during",
    group: "现场执行",
    condition: "largeMeeting",
    dueOffsetDays: 0,
  },
  {
    id: "photo-and-copy",
    title: "现场拍照并准备OA或宣传稿",
    description: "按既定素材要求完成现场拍摄和稿件素材收集。",
    phase: "during",
    group: "现场执行",
    condition: "publicity",
    dueOffsetDays: 0,
  },
  {
    id: "attendance-sheet",
    title: "准备并回收会议签到表",
    description: "本次需要报销时，签到表应作为报销与归档依据。",
    phase: "during",
    group: "现场执行",
    condition: "reimbursement",
    dueOffsetDays: 0,
  },
  {
    id: "invoice-and-receipt",
    title: "核对人数并取得餐费、酒水发票及消费水单",
    description: "核对实际参会人数、消费明细和开票信息，酒水按实际情况处理。",
    phase: "after",
    group: "纸质材料整理",
    condition: "mealReimbursement",
    dueOffsetDays: 1,
  },
  {
    id: "paper-package",
    title: "完成纸质申请单签字并整理附件",
    description: "附件包括会议方案、发票和消费水单，按要求完成纸质签字。",
    phase: "after",
    group: "纸质材料整理",
    condition: "mealReimbursement",
    dueOffsetDays: 1,
  },
  {
    id: "kingdee-find-application",
    title: "找到已审批的招待申请单并点击报销",
    description: "在人人费用系统的业务招待申请列表中选择审批通过单据。",
    phase: "after",
    group: "金蝶系统报销",
    condition: "reimbursement",
    dueOffsetDays: 1,
    sopImages: [REIMBURSEMENT_OVERVIEW],
  },
  {
    id: "kingdee-import-invoice",
    title: "导入发票和票据信息",
    description: "通过电脑或小程序上传票据；酒水发票按当前规定无需上传。",
    phase: "after",
    group: "金蝶系统报销",
    condition: "reimbursement",
    dueOffsetDays: 1,
    sopImages: [INVOICE_IMPORT],
  },
  {
    id: "kingdee-fix-invoice",
    title: "查看并修正发票导入异常",
    description: "根据系统异常提示核对购买方、发票号码和其他票据信息。",
    phase: "after",
    group: "金蝶系统报销",
    condition: "reimbursement",
    dueOffsetDays: 2,
    sopImages: [INVOICE_IMPORT],
  },
  {
    id: "kingdee-submit",
    title: "核对全部信息并提交报销单",
    description: "确认基本信息、业务信息、金额和附件无误后启动审批。",
    phase: "after",
    group: "金蝶系统报销",
    condition: "reimbursement",
    dueOffsetDays: 2,
  },
  {
    id: "archive-paper-documents",
    title: "将全套纸质单据移交综合办归档",
    description: "审批提交后，将完整纸质材料移交综合办并记录交接。",
    phase: "after",
    group: "金蝶系统报销",
    condition: "reimbursement",
    dueOffsetDays: 3,
  },
];

export const CHECKLIST_TEMPLATE: ChecklistTemplateItem[] =
  BASE_CHECKLIST_TEMPLATE.map((item) => ({ ...item, enabled: true }));

export const DEFAULT_MEETING_RULES: MeetingRules = {
  parkingVehicleLimit: 4,
  businessMealMin: 300,
  businessMealMax: 400,
  waterServiceIntervalMinutes: 30,
  reminders: {
    missingLocation: true,
    missingOwner: true,
    missingRoster: true,
    overdueTasks: true,
    blockedTasks: true,
  },
};

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function applies(condition: ChecklistCondition, input: MeetingInput) {
  switch (condition) {
    case "roster":
      return input.rosterRequired === true;
    case "rosterWelcomeScreen":
      return input.rosterRequired === true && input.welcomeScreenRequired;
    case "afternoon":
      return input.afternoonMeeting;
    case "businessMeal":
      return input.mealType === "business";
    case "businessMealAlcohol":
      return input.mealType === "business" && input.alcoholRequired;
    case "workMeal":
      return input.mealType === "work";
    case "parking":
      return input.parkingRequired;
    case "publicity":
      return input.publicityRequired;
    case "presentation":
      return input.presentationRequired;
    case "welcomeScreen":
      return input.welcomeScreenRequired;
    case "largeMeeting":
      return input.roomSize === "large";
    case "reimbursement":
      return input.reimbursementRequired;
    case "mealReimbursement":
      return input.reimbursementRequired && input.mealType !== "none";
    default:
      return true;
  }
}

function addDays(dateValue: string, offset: number) {
  const date = new Date(`${dateValue}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateValue;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

export function localDateValue(date = new Date()) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export type MeetingValidationIssue = {
  field: keyof MeetingInput | "meetingRoom";
  message: string;
  severity: "error" | "warning";
};

export type MeetingRoomReference = {
  id: string;
  name: string;
  capacity: number;
  enabled: boolean;
};

const DATE_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_VALUE_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function validLocalDate(value: string) {
  if (!DATE_VALUE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function validateMeetingInput(input: MeetingInput) {
  const issues: MeetingValidationIssue[] = [];
  if (!input.title.trim()) {
    issues.push({ field: "title", message: "请填写会议名称", severity: "error" });
  }
  if (!validLocalDate(input.date)) {
    issues.push({ field: "date", message: "请选择有效的会议日期", severity: "error" });
  }
  if (input.startTime && !TIME_VALUE_PATTERN.test(input.startTime)) {
    issues.push({ field: "startTime", message: "开始时间格式不正确", severity: "error" });
  }
  if (input.endTime && !TIME_VALUE_PATTERN.test(input.endTime)) {
    issues.push({ field: "endTime", message: "结束时间格式不正确", severity: "error" });
  } else if (input.endTime && !input.startTime) {
    issues.push({ field: "startTime", message: "填写结束时间前需要先填写开始时间", severity: "error" });
  } else if (input.endTime && input.startTime && input.endTime <= input.startTime) {
    issues.push({ field: "endTime", message: "结束时间必须晚于开始时间", severity: "error" });
  }
  if (
    !Number.isFinite(Number(input.attendeeEstimate)) ||
    Number(input.attendeeEstimate) < 0 ||
    Number(input.attendeeEstimate) > 5_000
  ) {
    issues.push({
      field: "attendeeEstimate",
      message: "预计参会人数应在 0 到 5000 之间",
      severity: "error",
    });
  }
  if (
    input.parkingRequired &&
    (!Number.isFinite(Number(input.vehicleCount)) ||
      Number(input.vehicleCount) < 0 ||
      Number(input.vehicleCount) > 5_000)
  ) {
    issues.push({
      field: "vehicleCount",
      message: "预计车辆数应在 0 到 5000 之间",
      severity: "error",
    });
  }
  if (!input.parkingRequired && Number(input.vehicleCount) !== 0) {
    issues.push({
      field: "vehicleCount",
      message: "未启用停车保障时，预计车辆数必须为 0",
      severity: "error",
    });
  }
  if (input.mealType !== "business" && input.alcoholRequired) {
    issues.push({
      field: "alcoholRequired",
      message: "只有商务餐可以启用酒水保障",
      severity: "error",
    });
  }
  return issues;
}

export function normalizeMeetingInput(input: MeetingInput): MeetingInput {
  return {
    ...input,
    title: input.title.trim(),
    date: input.date.trim(),
    startTime: input.startTime.trim(),
    endTime: input.endTime?.trim() || "",
    location: input.location.trim(),
    meetingRoomId: input.meetingRoomId?.trim() || undefined,
    roomRequirements: input.roomRequirements?.trim() || "",
    organizer: input.organizer.trim(),
    owner: input.owner.trim(),
    attendeeEstimate: Math.max(0, Math.round(Number(input.attendeeEstimate) || 0)),
    rosterRequired: input.rosterRequired === true,
    ...(input.vehicles === undefined ? {} : { vehicles: normalizeMeetingVehicles(input.vehicles) }),
    vehicleCount: input.parkingRequired
      ? Math.max(input.vehicles ? normalizeMeetingVehicles(input.vehicles).length : 0, Math.round(Number(input.vehicleCount) || 0))
      : 0,
    alcoholRequired:
      input.mealType === "business" && Boolean(input.alcoholRequired),
  };
}

function assertMeetingInput(input: MeetingInput) {
  const error = validateMeetingInput(input).find((issue) => issue.severity === "error");
  if (error) throw new Error(error.message);
}

function timeMinutes(value: string) {
  if (!TIME_VALUE_PATTERN.test(value)) return null;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

export function findMeetingRoomConflicts(
  input: MeetingInput,
  meetings: readonly MeetingRecord[],
  excludeMeetingId?: string,
) {
  if (!input.meetingRoomId || !input.date) return [];
  const start = timeMinutes(input.startTime);
  const end = timeMinutes(input.endTime ?? "");
  return meetings.filter((meeting) => {
    if (
      meeting.id === excludeMeetingId ||
      meeting.deletedAt ||
      meeting.archivedAt ||
      meeting.meetingRoomId !== input.meetingRoomId ||
      meeting.date !== input.date
    ) {
      return false;
    }
    const existingStart = timeMinutes(meeting.startTime);
    const existingEnd = timeMinutes(meeting.endTime ?? "");
    if (start === null || existingStart === null) return true;
    const normalizedEnd = end ?? start + 60;
    const normalizedExistingEnd = existingEnd ?? existingStart + 60;
    return start < normalizedExistingEnd && existingStart < normalizedEnd;
  });
}

export function meetingRoomValidationIssues(
  input: MeetingInput,
  rooms: readonly MeetingRoomReference[],
  meetings: readonly MeetingRecord[],
  excludeMeetingId?: string,
) {
  const issues: MeetingValidationIssue[] = [];
  if (!input.meetingRoomId) return issues;
  const room = rooms.find((item) => item.id === input.meetingRoomId);
  if (!room) {
    issues.push({
      field: "meetingRoom",
      message: "所选会议室已不存在，请重新选择",
      severity: "error",
    });
    return issues;
  }
  if (!room.enabled) {
    issues.push({
      field: "meetingRoom",
      message: "所选会议室已停用，请重新选择",
      severity: "error",
    });
  }
  if (room.capacity > 0 && input.attendeeEstimate > room.capacity) {
    issues.push({
      field: "attendeeEstimate",
      message: `预计人数超过“${room.name}”登记容量 ${room.capacity} 人`,
      severity: "warning",
    });
  }
  const conflicts = findMeetingRoomConflicts(input, meetings, excludeMeetingId);
  if (conflicts.length) {
    const target = conflicts[0];
    issues.push({
      field: "meetingRoom",
      message: `“${room.name}”与“${target.title}”时间冲突（${target.startTime || "时间待定"}${target.endTime ? `－${target.endTime}` : ""}）`,
      severity: "error",
    });
  }
  return issues;
}

function cloneChecklistTemplates(
  templates: ChecklistTemplateItem[],
): ChecklistTemplateItem[] {
  return templates.map((item) => ({
    ...item,
    sopImages: item.sopImages ? [...item.sopImages] : undefined,
  }));
}

function positiveNumber(value: number, fallback: number) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function normalizeMeetingRules(rules?: MeetingRules): MeetingRules {
  const source = rules ?? DEFAULT_MEETING_RULES;
  return {
    parkingVehicleLimit: positiveNumber(
      source.parkingVehicleLimit,
      DEFAULT_MEETING_RULES.parkingVehicleLimit,
    ),
    businessMealMin: positiveNumber(
      source.businessMealMin,
      DEFAULT_MEETING_RULES.businessMealMin,
    ),
    businessMealMax: positiveNumber(
      source.businessMealMax,
      DEFAULT_MEETING_RULES.businessMealMax,
    ),
    waterServiceIntervalMinutes: positiveNumber(
      source.waterServiceIntervalMinutes,
      DEFAULT_MEETING_RULES.waterServiceIntervalMinutes,
    ),
    reminders: {
      ...DEFAULT_MEETING_RULES.reminders,
      ...(source.reminders ?? {}),
    },
  };
}

function materializeTemplateCopy(
  item: ChecklistTemplateItem,
  rules: MeetingRules,
  input: MeetingInput,
) {
  let title = item.title;
  let description = item.description;

  if (item.id === "business-meal-application") {
    const standard = `商务餐参考标准为人均${rules.businessMealMin}—${rules.businessMealMax}元。`;
    const pattern = /商务餐参考标准为人均[^。]*元。?/;
    description = pattern.test(description)
      ? description.replace(pattern, standard)
      : `${description}${description ? " " : ""}${standard}`;
  }

  if (item.id === "parking-license-report") {
    const standard = `当前标准最多报备${rules.parkingVehicleLimit}辆车。`;
    const pattern = /当前标准最多报备[^。]*辆车。?/;
    description = pattern.test(description)
      ? description.replace(pattern, standard)
      : `${description}${description ? " " : ""}${standard}`;
  }

  if (item.id === "water-service") {
    const interval = rules.waterServiceIntervalMinutes;
    const titlePattern = /每(?:半小时|\d+(?:\.\d+)?分钟)加水/;
    title = titlePattern.test(title)
      ? title.replace(titlePattern, `每${interval}分钟加水`)
      : title;
    const descriptionPattern = /会议进行中(?:定时|每\d+(?:\.\d+)?分钟)巡视/;
    const intervalCopy = `会议进行中每${interval}分钟巡视`;
    description = descriptionPattern.test(description)
      ? description.replace(descriptionPattern, intervalCopy)
      : `${description}${description ? " " : ""}执行间隔为每${interval}分钟。`;
  }

  if (item.id === "place-materials" && input.rosterRequired !== true) {
    title = "桌面摆放会议资料和必要文具";
    description = "会前完成会议资料及必要文具摆放，不涉及实名名单或姓名牌。";
  }

  return { title, description };
}

function effectiveChecklistCondition(item?: ChecklistTemplateItem) {
  if (!item) return "always" as const;
  // Saved administrator configurations from before named rosters became
  // optional still carry the old built-in conditions. Normalize only those
  // exact built-in defaults so custom tasks and deliberate edits are kept.
  if (
    ["print-nameplates", "seat-order"].includes(item.id) &&
    item.condition === "always"
  ) {
    return "roster" as const;
  }
  if (
    item.id === "electronic-nameplate" &&
    item.condition === "welcomeScreen"
  ) {
    return "rosterWelcomeScreen" as const;
  }
  return item.condition;
}

function instantiateTasks(
  meetingId: string,
  input: MeetingInput,
  templates: ChecklistTemplateItem[],
  rules: MeetingRules,
): MeetingTask[] {
  return templates
    .filter(
      (item) =>
        item.enabled !== false &&
        applies(effectiveChecklistCondition(item), input),
    )
    .map((item) => {
      const copy = materializeTemplateCopy(item, rules, input);
      return {
        id: `${meetingId}-${item.id}`,
        templateId: item.id,
        title: copy.title,
        description: copy.description,
        phase: item.phase,
        group: item.group,
        status: "todo",
        owner: input.owner,
        dueDate: addDays(input.date, item.dueOffsetDays),
        note: "",
        attachments: [],
        sopImages: item.sopImages ? [...item.sopImages] : undefined,
      };
    });
}

export function createMeeting(
  input: MeetingInput,
  options: CreateMeetingOptions = {},
): MeetingRecord {
  if (!input.parkingRequired && input.vehicles?.length) throw new Error("请先启用停车保障，再登记参会车辆");
  const attendees = normalizeMeetingAttendees(options.attendees ?? []);
  const normalized = normalizeMeetingInput({
    ...input,
    attendeeEstimate: Math.max(input.attendeeEstimate, attendees.length),
  });
  assertMeetingInput(normalized);
  const now = new Date().toISOString();
  const id = makeId("meeting");
  const checklistTemplates = cloneChecklistTemplates(
    options.checklistTemplates ?? CHECKLIST_TEMPLATE,
  );
  const ruleSnapshot = normalizeMeetingRules(options.meetingRules);
  return {
    ...normalized,
    id,
    createdAt: now,
    updatedAt: now,
    tasks: instantiateTasks(
      id,
      normalized,
      checklistTemplates,
      ruleSnapshot,
    ),
    attendees: attendees.map((attendee) => ({
      ...attendee,
      id: attendee.id || makeId("attendee"),
    })),
    templateSource: {
      configRevision: options.configRevision ?? 0,
      capturedAt: now,
      checklistTemplates,
    },
    ruleSnapshot,
  };
}

function normalizeAttendeeIdentityPart(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function normalizeMeetingAttendees(attendees: MeetingAttendee[]) {
  const normalized = attendees
    .map((attendee) => ({
      ...attendee,
      id: attendee.id.trim() || makeId("attendee"),
      name: attendee.name.trim().replace(/\s+/g, ""),
      unit: attendee.unit.trim(),
      department: attendee.department.trim(),
      title: attendee.title.trim(),
      source: attendee.source?.trim() || "手动录入",
    }))
    .filter(
      (attendee) =>
        attendee.name ||
        attendee.unit ||
        attendee.department ||
        attendee.title,
    );

  const identities = new Set<string>();
  normalized.forEach((attendee, index) => {
    if (!attendee.name) {
      throw new Error(`第 ${index + 1} 位参会人缺少姓名`);
    }
    const identity = `${normalizeAttendeeIdentityPart(attendee.name)}\u0000${normalizeAttendeeIdentityPart(attendee.unit)}`;
    if (identities.has(identity)) {
      throw new Error(
        `参会人员“${attendee.name}”${attendee.unit ? `（${attendee.unit}）` : ""}重复`,
      );
    }
    identities.add(identity);
  });
  return normalized;
}

/** Recover transitional plate values without asserting who owns/drives a vehicle. */
export function migrateMeetingVehicles(meeting: Partial<MeetingRecord>) {
  const vehicles = (meeting.vehicles ?? []).map((vehicle) => ({ ...vehicle }));
  const seen = new Set(vehicles.map((vehicle) => vehicle.licensePlate.normalize("NFKC").replace(/[\s·•]/g, "").toUpperCase()));
  for (const attendee of meeting.attendees ?? []) {
    const plate = (attendee.licensePlate ?? "").normalize("NFKC").replace(/[\s·•]/g, "").toUpperCase();
    if (!plate || seen.has(plate)) continue;
    seen.add(plate);
    vehicles.push({ unit: attendee.unit ?? "", licensePlate: plate, note: "旧版登记信息迁入，请核对报送单位" });
  }
  return normalizeMeetingVehicles(vehicles);
}

export function replaceMeetingAttendees(
  meeting: MeetingRecord,
  attendees: MeetingAttendee[],
  options: ReplaceMeetingAttendeesOptions = {},
) {
  const normalized = normalizeMeetingAttendees(attendees);
  const attendeeEstimate =
    options.estimateMode === "exact"
      ? normalized.length
      : Math.max(meeting.attendeeEstimate, normalized.length);
  const next: MeetingRecord = {
    ...meeting,
    attendees: normalized,
    attendeeEstimate,
    updatedAt: new Date().toISOString(),
  };
  return options.enableRosterWorkflow
    ? setMeetingRosterRequired(next, true)
    : next;
}

function defaultDemoInput(): MeetingInput {
  const date = new Date();
  date.setDate(date.getDate() + 5);
  return {
    title: "低空经济项目合作交流会",
    date: localDateValue(date),
    startTime: "14:00",
    location: "公司大会议室",
    organizer: "产业发展部",
    owner: "会务小组",
    attendeeEstimate: 18,
    rosterRequired: true,
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
}

export function createDemoMeeting(
  options: CreateDemoMeetingOptions = {},
) {
  const { meetingDefaults, ...creationOptions } = options;
  const meeting = createMeeting(
    { ...defaultDemoInput(), ...meetingDefaults },
    creationOptions,
  );
  meeting.tasks = meeting.tasks.map((task, index) => ({
    ...task,
    status: index < 4 ? "done" : index === 4 ? "doing" : "todo",
  }));
  saveMeeting(meeting);
  return meeting;
}

function browserStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function normalizeStoredMeetings(value: unknown): MeetingRecord[] {
  if (!Array.isArray(value)) return EMPTY_MEETINGS;
  return value
    .filter(
      (item): item is Partial<MeetingRecord> & { id: string; title: string } =>
        Boolean(item && typeof item === "object" && item.id && item.title),
    )
    .map((meeting) => {
      const attendees = Array.isArray(meeting.attendees)
        ? meeting.attendees
            .filter((attendee) => attendee && attendee.name)
            .map((attendee) => ({
              id: attendee.id || makeId("attendee"),
              name: String(attendee.name).trim(),
              unit: String(attendee.unit ?? "").trim(),
              department: String(attendee.department ?? "").trim(),
              title: String(attendee.title ?? "").trim(),
              ...(attendee.source ? { source: String(attendee.source) } : {}),
            }))
        : [];
      const tasks = Array.isArray(meeting.tasks)
        ? meeting.tasks
            .filter((task) => task && task.id && task.title && task.templateId)
            .map((task) => ({
              ...task,
              status: task.status || "todo",
              owner: task.owner || "",
              dueDate: task.dueDate || "",
              note: task.note || "",
              attachments: Array.isArray(task.attachments)
                ? task.attachments
                : [],
            }))
        : [];
      const hasHistoricalRosterTasks = tasks.some((task) =>
        ["print-nameplates", "seat-order", "electronic-nameplate"].includes(
          task.templateId,
        ),
      );
      const now = new Date().toISOString();
      return {
        id: meeting.id,
        title: String(meeting.title).trim(),
        date: String(meeting.date ?? "").trim(),
        startTime: String(meeting.startTime ?? "").trim(),
        ...(meeting.endTime === undefined
          ? {}
          : { endTime: String(meeting.endTime ?? "").trim() }),
        location: String(meeting.location ?? "").trim(),
        ...(meeting.meetingRoomId
          ? { meetingRoomId: String(meeting.meetingRoomId).trim() }
          : {}),
        ...(meeting.roomRequirements === undefined
          ? {}
          : { roomRequirements: String(meeting.roomRequirements ?? "").trim() }),
        organizer: String(meeting.organizer ?? "").trim(),
        owner: String(meeting.owner ?? "").trim(),
        attendeeEstimate: Math.max(
          0,
          Math.round(Number(meeting.attendeeEstimate) || 0),
        ),
        rosterRequired:
          typeof meeting.rosterRequired === "boolean"
            ? meeting.rosterRequired
            : attendees.length > 0 || hasHistoricalRosterTasks,
        afternoonMeeting: meeting.afternoonMeeting === true,
        mealType: ["none", "business", "work"].includes(
          String(meeting.mealType),
        )
          ? (meeting.mealType as MealType)
          : "none",
        alcoholRequired: meeting.alcoholRequired === true,
        parkingRequired: meeting.parkingRequired === true,
        vehicleCount: Math.max(0, Math.round(Number(meeting.vehicleCount) || 0)),
        publicityRequired: meeting.publicityRequired === true,
        reimbursementRequired: meeting.reimbursementRequired === true,
        presentationRequired: meeting.presentationRequired === true,
        welcomeScreenRequired: meeting.welcomeScreenRequired === true,
        roomSize: meeting.roomSize === "large" ? "large" : "small",
        createdAt:
          typeof meeting.createdAt === "string" && meeting.createdAt
            ? meeting.createdAt
            : now,
        updatedAt:
          typeof meeting.updatedAt === "string" && meeting.updatedAt
            ? meeting.updatedAt
            : now,
        ...(meeting.archivedAt ? { archivedAt: meeting.archivedAt } : {}),
        ...(meeting.deletedAt ? { deletedAt: meeting.deletedAt } : {}),
        ...(meeting.notes === undefined ? {} : { notes: String(meeting.notes) }),
        tasks,
        attendees,
        ...(meeting.seatingPlan ? { seatingPlan: meeting.seatingPlan } : {}),
        vehicles: migrateMeetingVehicles(meeting),
        ...(meeting.templateSource ? { templateSource: meeting.templateSource } : {}),
        ...(meeting.ruleSnapshot
          ? { ruleSnapshot: normalizeMeetingRules(meeting.ruleSnapshot) }
          : {}),
      } satisfies MeetingRecord;
    });
}

function rebuildMeetingStore(meetings: MeetingRecord[]) {
  cachedAllMeetings = meetings;
  cachedMeetingStore = {
    active: meetings.filter((meeting) => !meeting.deletedAt && !meeting.archivedAt),
    archived: meetings.filter(
      (meeting) => !meeting.deletedAt && Boolean(meeting.archivedAt),
    ),
    deleted: meetings.filter((meeting) => Boolean(meeting.deletedAt)),
    all: meetings,
  };
}

function initializeBrowserMeetingCache() {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const raw = storage.getItem(MEETING_STORAGE_KEY);
    if (raw === cachedStorageValue) return;
    const parsed = JSON.parse(raw || "[]");
    cachedStorageValue = raw;
    rebuildMeetingStore(normalizeStoredMeetings(parsed));
  } catch {
    cachedStorageValue = null;
    rebuildMeetingStore(EMPTY_MEETINGS);
  }
}

function publishMeetingStore(meetings: MeetingRecord[], persistBrowser = true) {
  const storage = browserStorage();
  const raw = JSON.stringify(meetings);
  if (persistBrowser && storage) storage.setItem(MEETING_STORAGE_KEY, raw);
  cachedStorageValue = raw;
  rebuildMeetingStore(meetings);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MEETING_CHANGE_EVENT));
  }
}

async function meetingApiError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: string | { message?: string };
    };
    if (typeof payload.error === "string") return payload.error;
    if (payload.error && typeof payload.error.message === "string") {
      return payload.error.message;
    }
  } catch {
    // Fall through to the status-based message.
  }
  return `会议数据保存失败（${response.status}）`;
}

async function persistMeetingsSnapshot(meetings: MeetingRecord[]) {
  if (typeof window === "undefined") return;
  const response = await fetch("/api/meetings", {
    method: "PUT",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ meetings }),
  });
  if (!response.ok) throw new Error(await meetingApiError(response));
  browserStorage()?.setItem(MEETING_MIGRATION_KEY, "1");
}

function enqueueMeetingPersistence(meetings: MeetingRecord[]) {
  const snapshot = meetings.map((meeting) => ({ ...meeting }));
  persistenceQueue = persistenceQueue.then(
    () => persistMeetingsSnapshot(snapshot),
    () => persistMeetingsSnapshot(snapshot),
  );
  return persistenceQueue;
}

function scheduleMeetingPersistence() {
  if (typeof window === "undefined") return;
  if (persistenceTimer) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = null;
    void enqueueMeetingPersistence(cachedAllMeetings).catch(() => {});
  }, 180);
}

function mergeMeetingSnapshots(
  localMeetings: MeetingRecord[],
  remoteMeetings: MeetingRecord[],
) {
  const merged = new Map<string, MeetingRecord>();
  for (const meeting of remoteMeetings) merged.set(meeting.id, meeting);
  for (const meeting of localMeetings) {
    const remote = merged.get(meeting.id);
    if (!remote || meeting.updatedAt > remote.updatedAt) {
      merged.set(meeting.id, meeting);
    }
  }
  return [...merged.values()].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
}

async function hydrateMeetingsFromFile() {
  if (typeof window === "undefined") return;
  initializeBrowserMeetingCache();
  const response = await fetch("/api/meetings", { cache: "no-store" });
  if (!response.ok) throw new Error(await meetingApiError(response));
  const payload = (await response.json()) as { meetings?: unknown };
  const remoteMeetings = normalizeStoredMeetings(payload.meetings);
  const storage = browserStorage();
  const alreadyMigrated = storage?.getItem(MEETING_MIGRATION_KEY) === "1";
  if (alreadyMigrated && !localDirtySinceStartup) {
    publishMeetingStore(remoteMeetings);
    return;
  }
  const merged = mergeMeetingSnapshots(cachedAllMeetings, remoteMeetings);
  publishMeetingStore(merged);
  await enqueueMeetingPersistence(merged);
  localDirtySinceStartup = false;
}

export function ensureMeetingStoreReady() {
  if (!hydrationPromise) {
    hydrationPromise = hydrateMeetingsFromFile().catch((error) => {
      hydrationPromise = null;
      throw error;
    });
  }
  return hydrationPromise;
}

export function loadMeetingStoreSnapshot() {
  initializeBrowserMeetingCache();
  return cachedMeetingStore;
}

export function loadMeetings(): MeetingRecord[] {
  return loadMeetingStoreSnapshot().active;
}

export function loadAllMeetings() {
  const snapshot = loadMeetingStoreSnapshot();
  return [...snapshot.active, ...snapshot.archived];
}

export function loadDeletedMeetings() {
  return loadMeetingStoreSnapshot().deleted;
}

export function subscribeMeetings(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  void ensureMeetingStoreReady().catch(() => {});
  const handleStorage = (event: StorageEvent) => {
    if (event.key === MEETING_STORAGE_KEY) {
      cachedStorageValue = undefined;
      initializeBrowserMeetingCache();
      callback();
    }
  };
  window.addEventListener(MEETING_CHANGE_EVENT, callback);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(MEETING_CHANGE_EVENT, callback);
    window.removeEventListener("storage", handleStorage);
  };
}

export function saveMeeting(meeting: MeetingRecord) {
  initializeBrowserMeetingCache();
  const next: MeetingRecord = {
    ...meeting,
    updatedAt: new Date().toISOString(),
  };
  const index = cachedAllMeetings.findIndex((item) => item.id === meeting.id);
  const updatedMeetings =
    index >= 0
      ? cachedAllMeetings.map((item, itemIndex) =>
          itemIndex === index ? next : item,
        )
      : [next, ...cachedAllMeetings];
  localDirtySinceStartup = true;
  publishMeetingStore(updatedMeetings);
  scheduleMeetingPersistence();
  return next;
}

/** Replace the complete meeting snapshot after an explicit restore action. */
export async function replaceMeetingSnapshot(meetings: MeetingRecord[]) {
  const normalized = normalizeStoredMeetings(meetings);
  localDirtySinceStartup = true;
  publishMeetingStore(normalized);
  await enqueueMeetingPersistence(normalized);
  localDirtySinceStartup = false;
  return loadMeetingStoreSnapshot();
}

export function deleteMeeting(id: string) {
  initializeBrowserMeetingCache();
  const timestamp = new Date().toISOString();
  const meetings = cachedAllMeetings.map((meeting) =>
    meeting.id === id
      ? { ...meeting, deletedAt: timestamp, archivedAt: undefined, updatedAt: timestamp }
      : meeting,
  );
  localDirtySinceStartup = true;
  publishMeetingStore(meetings);
  scheduleMeetingPersistence();
}

export function archiveMeeting(id: string) {
  initializeBrowserMeetingCache();
  const timestamp = new Date().toISOString();
  publishMeetingStore(
    cachedAllMeetings.map((meeting) =>
      meeting.id === id
        ? { ...meeting, archivedAt: timestamp, updatedAt: timestamp }
        : meeting,
    ),
  );
  localDirtySinceStartup = true;
  scheduleMeetingPersistence();
}

export function restoreArchivedMeeting(id: string) {
  initializeBrowserMeetingCache();
  const timestamp = new Date().toISOString();
  publishMeetingStore(
    cachedAllMeetings.map((meeting) =>
      meeting.id === id
        ? { ...meeting, archivedAt: undefined, updatedAt: timestamp }
        : meeting,
    ),
  );
  localDirtySinceStartup = true;
  scheduleMeetingPersistence();
}

export function restoreDeletedMeeting(id: string) {
  initializeBrowserMeetingCache();
  const timestamp = new Date().toISOString();
  publishMeetingStore(
    cachedAllMeetings.map((meeting) =>
      meeting.id === id
        ? {
            ...meeting,
            deletedAt: undefined,
            archivedAt: undefined,
            updatedAt: timestamp,
          }
        : meeting,
    ),
  );
  localDirtySinceStartup = true;
  scheduleMeetingPersistence();
}

export async function purgeMeeting(id: string) {
  initializeBrowserMeetingCache();
  const previous = cachedAllMeetings;
  publishMeetingStore(cachedAllMeetings.filter((meeting) => meeting.id !== id));
  localDirtySinceStartup = true;
  try {
    await flushMeetingPersistence();
  } catch (error) {
    publishMeetingStore(previous);
    throw error;
  }
}

export async function flushMeetingPersistence() {
  if (persistenceTimer) {
    clearTimeout(persistenceTimer);
    persistenceTimer = null;
  }
  await enqueueMeetingPersistence(cachedAllMeetings);
  localDirtySinceStartup = false;
}

export function getMeetingById(id: string) {
  return loadAllMeetings().find((meeting) => meeting.id === id) ?? null;
}

function taskCompleted(task: MeetingTask) {
  return task.status === "done" || task.status === "waived";
}

export function meetingProgress(meeting: MeetingRecord) {
  const total = meeting.tasks.length;
  const completed = meeting.tasks.filter(taskCompleted).length;
  return {
    completed,
    total,
    // 没有适用事项意味着没有待完成工作，应按 100% 而不是 0% 展示。
    percent: total ? Math.round((completed / total) * 100) : 100,
  };
}

export function phaseProgress(
  meeting: MeetingRecord,
  phase: MeetingPhase,
) {
  const tasks = meeting.tasks.filter((task) => task.phase === phase);
  if (!tasks.length) return 100;
  return Math.round(
    (tasks.filter(taskCompleted).length / tasks.length) * 100,
  );
}

export function updateMeetingTask(
  meeting: MeetingRecord,
  taskId: string,
  patch: Partial<MeetingTask>,
): MeetingRecord {
  return {
    ...meeting,
    updatedAt: new Date().toISOString(),
    tasks: meeting.tasks.map((task) =>
      task.id === taskId ? { ...task, ...patch, id: task.id } : task,
    ),
  };
}

/**
 * Enables or disables the formal roster-governance workflow without rewriting historical
 * task work. Enabling adds any roster-dependent tasks that were omitted when
 * the meeting was created; disabling preserves existing task history.
 */
export function setMeetingRosterRequired(
  meeting: MeetingRecord,
  required: boolean,
): MeetingRecord {
  const nextInput: MeetingInput = { ...meeting, rosterRequired: required };
  if (!required) {
    return {
      ...meeting,
      rosterRequired: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const templates = cloneChecklistTemplates(
    meeting.templateSource?.checklistTemplates ?? CHECKLIST_TEMPLATE,
  );
  const rules = normalizeMeetingRules(meeting.ruleSnapshot);
  const existingTemplateIds = new Set(
    meeting.tasks.map((task) => task.templateId),
  );
  const addedTasks = instantiateTasks(
    meeting.id,
    nextInput,
    templates,
    rules,
  ).filter(
    (task) =>
      !existingTemplateIds.has(task.templateId) &&
      ["roster", "rosterWelcomeScreen"].includes(
        effectiveChecklistCondition(
          templates.find((item) => item.id === task.templateId),
        ),
      ),
  );

  return {
    ...meeting,
    rosterRequired: true,
    tasks: [...meeting.tasks, ...addedTasks],
    updatedAt: new Date().toISOString(),
  };
}

function meetingInputFromRecord(meeting: MeetingRecord): MeetingInput {
  return {
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime,
    location: meeting.location,
    meetingRoomId: meeting.meetingRoomId,
    roomRequirements: meeting.roomRequirements,
    organizer: meeting.organizer,
    owner: meeting.owner,
    attendeeEstimate: meeting.attendeeEstimate,
    rosterRequired: meeting.rosterRequired,
    afternoonMeeting: meeting.afternoonMeeting,
    mealType: meeting.mealType,
    alcoholRequired: meeting.alcoholRequired,
    parkingRequired: meeting.parkingRequired,
    vehicleCount: meeting.vehicleCount,
    vehicles: meeting.vehicles,
    publicityRequired: meeting.publicityRequired,
    reimbursementRequired: meeting.reimbursementRequired,
    presentationRequired: meeting.presentationRequired,
    welcomeScreenRequired: meeting.welcomeScreenRequired,
    roomSize: meeting.roomSize,
  };
}

export function updateMeetingFields(
  meeting: MeetingRecord,
  patch: Partial<MeetingInput>,
) {
  const previousInput = meetingInputFromRecord(meeting);
  const mergedInput = { ...previousInput, ...patch };
  // Turning parking off hides the register but keeps its data for later use.
  if (patch.parkingRequired === false && patch.vehicleCount === undefined) mergedInput.vehicleCount = 0;
  if (Object.hasOwn(patch, "vehicles") && patch.vehicles?.length && !mergedInput.parkingRequired) {
    throw new Error("请先启用停车保障，再登记参会车辆");
  }
  assertMeetingInput(mergedInput);
  const normalized = normalizeMeetingInput(mergedInput);
  assertMeetingInput(normalized);
  const templates = cloneChecklistTemplates(
    meeting.templateSource?.checklistTemplates ?? CHECKLIST_TEMPLATE,
  );
  const rules = normalizeMeetingRules(meeting.ruleSnapshot);
  const byTemplateId = new Map(templates.map((item) => [item.id, item]));
  const rebasedTasks = meeting.tasks.map((task) => {
    const template = byTemplateId.get(task.templateId);
    const dueDate =
      template &&
      normalized.date !== previousInput.date &&
      task.dueDate === addDays(previousInput.date, template.dueOffsetDays)
        ? addDays(normalized.date, template.dueOffsetDays)
        : task.dueDate;
    const owner =
      normalized.owner !== previousInput.owner &&
      task.owner === previousInput.owner
        ? normalized.owner
        : task.owner;
    return { ...task, dueDate, owner };
  });
  const base: MeetingRecord = {
    ...meeting,
    ...normalized,
    tasks: rebasedTasks,
    updatedAt: new Date().toISOString(),
  };
  const existingTemplateIds = new Set(base.tasks.map((task) => task.templateId));
  const addedTasks = instantiateTasks(
    base.id,
    normalized,
    templates,
    rules,
  ).filter((task) => !existingTemplateIds.has(task.templateId));
  return {
    ...base,
    tasks: [...base.tasks, ...addedTasks],
  };
}

export function duplicateMeeting(meeting: MeetingRecord) {
  return createMeeting(
    {
      ...meetingInputFromRecord(meeting),
      title: `${meeting.title}（副本）`,
      vehicles: meeting.parkingRequired ? meeting.vehicles : [],
      meetingRoomId: undefined,
      roomRequirements: "",
    },
    {
      checklistTemplates: meeting.templateSource?.checklistTemplates,
      configRevision: meeting.templateSource?.configRevision,
      meetingRules: meeting.ruleSnapshot,
      attendees: meeting.attendees.map((attendee) => ({
        ...attendee,
        id: makeId("attendee"),
      })),
    },
  );
}

export function getMeetingWarnings(
  meeting: MeetingRecord,
  currentRules?: MeetingRules,
) {
  const rules = normalizeMeetingRules(
    meeting.ruleSnapshot ?? currentRules,
  );
  const warnings: string[] = [];
  if (rules.reminders.missingLocation && !meeting.location) {
    warnings.push("会议地点尚未填写");
  }
  if (rules.reminders.missingOwner && !meeting.owner) {
    warnings.push("会务负责人尚未分配");
  }
  if (
    meeting.parkingRequired &&
    meeting.vehicleCount > rules.parkingVehicleLimit
  ) {
    warnings.push(
      `预计车辆为${meeting.vehicleCount}辆，超过当前最多报备${rules.parkingVehicleLimit}辆的标准`,
    );
  }
  if (
    rules.reminders.missingRoster &&
    meeting.rosterRequired === true &&
    !meeting.attendees.length
  ) {
    warnings.push("参会名单尚未整理并关联到本次会议");
  }

  const today = localDateValue();
  const overdue = meeting.tasks.filter(
    (task) =>
      task.dueDate &&
      task.dueDate < today &&
      !taskCompleted(task) &&
      task.status !== "blocked",
  );
  if (rules.reminders.overdueTasks && overdue.length) {
    warnings.push(`有${overdue.length}项任务已超过建议截止日期`);
  }
  const blocked = meeting.tasks.filter((task) => task.status === "blocked");
  if (rules.reminders.blockedTasks && blocked.length) {
    warnings.push(`有${blocked.length}项任务处于阻塞状态`);
  }
  return warnings;
}
