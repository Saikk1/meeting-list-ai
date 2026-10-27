"use client";

import {
  ArrowUpRight,
  Bot,
  CheckCircle2,
  ChevronRight,
  Info,
  History,
  KeyRound,
  LoaderCircle,
  Maximize2,
  Minimize2,
  MessagesSquare,
  LockKeyhole,
  Paperclip,
  FileText,
  RotateCcw,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import { AssistantErrorBoundary } from "./assistant-error-boundary";
import { AssistantConversationHistory } from "./assistant-conversation-history";
import { loadConversations, saveConversations, type AssistantMessage, type SavedConversation, type ConversationStore } from "../lib/assistant-conversations";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
  useSyncExternalStore,
} from "react";
import {
  activeModelRequestConfig,
  AI_PROVIDER_PRESETS,
  AI_PROVIDER_PRESET_MAP,
  CUSTOM_MODEL_OPTION_VALUE,
  isCatalogModel,
  loadAISettings,
  providerLabel,
  saveAISettings,
  type AIProviderId,
  type AISettings,
} from "../lib/ai-settings";
import {
  EMPTY_ASSISTANT_WORKING_MEMORY,
  parseAssistantAgentResponse,
  parseAssistantWorkingMemory,
  type AssistantNewMeetingDraft,
  type AssistantWorkingMemory,
} from "../lib/assistant-agent-contract";
import { executeConfirmedPlan } from "../lib/assistant-actions";
import { getAssistantWorkspaces, getServerAssistantWorkspaces, subscribeAssistantWorkspaces, type AssistantWorkspaceSnapshot } from "../lib/assistant-workspace";
import { MeetingPlanPreview } from "./meeting-plan-editor";
import { validateMeetingPlan } from "../../scripts/meeting-plan-schema.mjs";
import { buildAssistantFullDataContext } from "../lib/assistant-data-index";
import {
  buildAssistantOperationHistoryEntry,
  recordAssistantOperation,
} from "../lib/assistant-operation-history";
import {
  assistantPlanRequiresConfirmation,
  parseAssistantPlan,
  type AssistantAction,
  type AssistantMeetingInput,
  type AssistantPlan,
} from "../lib/assistant-contract";
import { buildAssistantCreateMeetingPlan } from "../lib/assistant-plan-editor";
import {
  listContacts,
  syncMeetingContacts,
  type ContactRecord,
} from "../lib/contacts";
import {
  flushMeetingPersistence,
  loadMeetingStoreSnapshot,
  type MeetingRecord,
} from "../lib/meeting-data";
import { detectAssistantIntentBoundary } from "../lib/assistant-intent";
import { BUSINESS_DOCUMENT_ACCEPT, MAX_ASSISTANT_DOCUMENTS, parseAssistantDocuments, type AssistantDocument } from "../lib/assistant-documents";
import { readBusinessDocument } from "../lib/business-document-reader";
import {
  getRosterWorkspaceSnapshot,
  type RosterWorkspaceSnapshot,
} from "../lib/roster-workspace-bridge";
import { useAdminConfig } from "../lib/use-admin-config";
import { meetingRoomRequirements } from "../lib/builtin-meeting-rooms";
import { AssistantMeetingOptionsTable } from "./assistant-meeting-options-table";
import { AssistantHistoryPanel } from "./assistant-history-panel";
import { SeatingPlanReview } from "./seating-planner";
import { generateSeatingPlan } from "../lib/seating";
import {
  AssistantOperationPreview,
  type AssistantOperationPreviewRow,
} from "./assistant-operation-preview";

type AssistantContextValue = {
  openAssistant: (message?: string) => void;
  isOpen: boolean;
};

type AssistantPhase =
  | "idle"
  | "thinking"
  | "awaiting_clarification"
  | "awaiting_confirmation"
  | "executing"
  | "completed"
  | "error";

type AgentApiPayload = {
  response?: unknown;
  memory?: unknown;
  plan?: unknown;
  error?: unknown;
};

type AssistantWebSearchResult = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  publishedAt: string | null;
};

const AssistantContext = createContext<AssistantContextValue | null>(null);

const WELCOME_MESSAGE: AssistantMessage = {
  id: "welcome",
  role: "assistant",
  text: "告诉我你最终想得到什么。我会记住前文、读取当前系统数据，并替你把事情做到可直接确认或使用。",
  suggestions: [
    "帮我安排一场新会议",
    "列出最近会议还没完成的任务",
    "在通讯录里查找市场部人员",
    "把当前会议参会名单按后台规则排序",
    "打开后台修改会议清单模板",
  ],
};

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pageKind(pathname: string) {
  if (pathname === "/") return "dashboard";
  if (pathname === "/meetings") return "meeting_list";
  if (pathname === "/meetings/new") return "meeting_new";
  if (/^\/meetings\/[^/]+$/.test(pathname)) return "meeting_detail";
  if (pathname.startsWith("/tasks")) return "tasks";
  if (pathname.startsWith("/lists")) return "roster";
  if (pathname.startsWith("/admin")) return "admin";
  return "other";
}

function currentMeetingId(pathname: string) {
  const match = pathname.match(/^\/meetings\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function isCreateMeetingRequest(text: string) {
  if (/不要|不用|取消|别/.test(text)) return false;
  return /(?:新建|创建|安排|预定|预订|预约).{0,8}(?:会议|例会)|(?:会议|例会).{0,8}(?:新建|创建|安排|预定|预订|预约)/.test(
    text,
  );
}

function requestsWebResearch(text: string) {
  return /(?:联网|网上|网络搜索|互联网|公开资料|外部核验|联网核验|查证|查职务|补全职务)/.test(
    text,
  );
}

function requestedModelSettings(text: string) {
  if (!/(?:模型|API|接口|DeepSeek|OpenAI|Kimi|豆包|Tavily)/i.test(text)) {
    return null;
  }
  if (!/(?:设置|配置|切换|更换|修改|打开|填写|启用)/.test(text)) {
    return null;
  }
  const provider: AIProviderId | null = /DeepSeek/i.test(text)
    ? "deepseek"
    : /OpenAI/i.test(text)
      ? "openai"
      : /Kimi|Moonshot/i.test(text)
        ? "kimi"
        : /豆包|火山方舟/i.test(text)
          ? "doubao"
          : /自定义/.test(text)
            ? "custom"
            : null;
  return { provider };
}

function requestedLocalNavigation(text: string) {
  if (!/(?:打开|进入|跳转到|带我去|查看)(?:一下)?/.test(text)) return null;
  if (/(?:改成|改为|设为|新增|删除|删掉|加入|移除|批量修改|更新.{0,12}为)/.test(text)) {
    return null;
  }
  if (/(?:通讯录|联系人)/.test(text)) {
    return { path: "/admin?section=contacts", label: "人员通讯录" };
  }
  if (/(?:清单模板|核对模板)/.test(text)) {
    return { path: "/admin?section=checklist", label: "清单模板设置" };
  }
  if (/(?:单位别名|名称字典)/.test(text)) {
    return { path: "/admin?section=aliases", label: "单位名称字典" };
  }
  if (/(?:名单规则|排序规则|Excel规则|导出规则)/i.test(text)) {
    return { path: "/admin?section=roster", label: "名单与导出规则" };
  }
  if (/(?:公司设置|会议默认|组织设置)/.test(text)) {
    return { path: "/admin?section=organization", label: "公司与会议设置" };
  }
  if (/(?:会议室管理|会议室设置|场地管理)/.test(text)) {
    return { path: "/admin?section=rooms", label: "会议室管理" };
  }
  if (/(?:后台|管理中心|系统设置)/.test(text)) {
    return { path: "/admin", label: "后台管理" };
  }
  if (/(?:名单治理|名单智理|名单整理|整理名单)/.test(text)) {
    return { path: "/lists", label: "名单治理" };
  }
  if (/(?:会务待办|待办中心|任务中心|任务工作台|全部待办)/.test(text)) {
    return { path: "/tasks", label: "会务待办" };
  }
  if (/(?:会议列表|我的会议|全部会议)/.test(text)) {
    return { path: "/meetings", label: "我的会议" };
  }
  if (/(?:首页|工作台)/.test(text)) {
    return { path: "/", label: "会议工作台" };
  }
  return null;
}

async function fetchAssistantWebResearch(
  query: string,
  settings: AISettings,
  signal: AbortSignal,
) {
  if (!settings.webSearch.enabled || !settings.webSearch.apiKey) {
    return {
      requested: true,
      available: false,
      error: "尚未在助手设置中启用 Tavily 联网核验",
      query,
      results: [] as AssistantWebSearchResult[],
    };
  }
  const response = await fetch("/api/web-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({
      provider: settings.webSearch.provider,
      apiKey: settings.webSearch.apiKey,
      query,
      maxResults: settings.webSearch.maxResults,
    }),
  });
  if (!response.ok) {
    return {
      requested: true,
      available: true,
      error: await responseMessage(response, "联网核验暂时失败"),
      query,
      results: [] as AssistantWebSearchResult[],
    };
  }
  const payload = (await response.json()) as {
    query?: unknown;
    results?: AssistantWebSearchResult[];
  };
  return {
    requested: true,
    available: true,
    error: "",
    query: typeof payload.query === "string" ? payload.query : query,
    results: Array.isArray(payload.results) ? payload.results : [],
  };
}

function assistantRosterWorkspaceContext(
  snapshot: RosterWorkspaceSnapshot | null,
) {
  if (!snapshot) return { available: false as const };
  const records = snapshot.records.slice(0, 100).map((record) => ({
    id: record.id,
    originalIndex: record.originalIndex,
    name: record.name,
    unit: record.unit,
    department: record.department,
    title: record.title,
    source: record.source,
    confidence: record.confidence,
    issues: record.issues.slice(0, 5),
  }));
  return {
    available: true as const,
    revision: snapshot.revision,
    step: snapshot.step,
    pasteText: snapshot.pasteText.slice(0, 20_000),
    files: snapshot.files.slice(0, 30),
    records,
    recordTotal: snapshot.recordTotal,
    truncated:
      snapshot.truncated || snapshot.recordTotal > records.length,
    aliases: snapshot.aliases.slice(0, 100),
    linkedMeeting: snapshot.linkedMeeting,
    busy: snapshot.busy,
  };
}

function meetingSummary(meeting: MeetingRecord) {
  const unfinishedTasks = meeting.tasks.filter(
    (task) => task.status !== "done" && task.status !== "waived",
  );
  const today = localDateOffset();
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime ?? "",
    location: meeting.location,
    meetingRoomId: meeting.meetingRoomId ?? "",
    roomRequirements: meeting.roomRequirements ?? "",
    organizer: meeting.organizer,
    owner: meeting.owner,
    attendeeEstimate: meeting.attendeeEstimate,
    attendeeCount: meeting.attendees.length,
    vehicles: meeting.vehicles ?? [],
    hasSeatingPlan: Boolean(meeting.seatingPlan),
    rosterRequired: meeting.rosterRequired === true,
    taskCount: meeting.tasks.length,
    completedTaskCount: meeting.tasks.length - unfinishedTasks.length,
    unfinishedTaskCount: unfinishedTasks.length,
    overdueTaskCount: unfinishedTasks.filter(
      (task) => task.dueDate && task.dueDate < today,
    ).length,
    blockedTaskCount: unfinishedTasks.filter(
      (task) => task.status === "blocked",
    ).length,
    status: meeting.deletedAt
      ? "trash"
      : meeting.archivedAt
        ? "archived"
        : "active",
    archivedAt: meeting.archivedAt ?? "",
    deletedAt: meeting.deletedAt ?? "",
    unfinishedTasks: unfinishedTasks.slice(0, 12).map((task) => ({
      id: task.id,
      title: task.title,
      phase: task.phase,
      group: task.group,
      status: task.status,
      owner: task.owner,
      dueDate: task.dueDate,
      note: task.note,
    })),
    updatedAt: meeting.updatedAt,
  };
}

function readableValue(input: unknown) {
  if (typeof input === "boolean") return input ? "是" : "否";
  return String(input ?? "空");
}

function adminPatchSummary(value: unknown) {
  const entries: string[] = [];
  const visit = (current: unknown, path: string[]) => {
    if (entries.length >= 10) return;
    if (
      current &&
      typeof current === "object" &&
      !Array.isArray(current)
    ) {
      for (const [key, child] of Object.entries(current)) {
        visit(child, [...path, key]);
        if (entries.length >= 10) break;
      }
      return;
    }
    entries.push(`${path.join(".")} → ${readableValue(current)}`);
  };
  visit(value, []);
  return `${entries.join("；")}${entries.length >= 10 ? "；…" : ""}`;
}

function createMeetingPreviewMessage(
  input: Extract<AssistantAction, { type: "meeting.create" }>["input"],
) {
  const time = `${input.startTime}${input.endTime ? `－${input.endTime}` : ""}`;
  return `已整理好“${input.title}”：${input.date} ${time}，${input.location || "地点待定"}，预计${input.attendeeEstimate}人。下面的会务选项已按后台默认值填好，可以直接调整。`;
}

function actionDescription(
  action: AssistantAction,
  meetings: MeetingRecord[],
  contacts: ContactRecord[],
  rosterWorkspace: RosterWorkspaceSnapshot | null = null,
) {
  const meeting =
    "meetingId" in action
      ? meetings.find((item) => item.id === action.meetingId)
      : null;
  const contact =
    "contactId" in action
      ? contacts.find((item) => item.id === action.contactId)
      : null;
  const workspaceRecord =
    "recordId" in action
      ? rosterWorkspace?.records.find((item) => item.id === action.recordId)
      : null;
  const workspaceAlias =
    "aliasId" in action
      ? rosterWorkspace?.aliases.find((item) => item.id === action.aliasId)
      : null;
  switch (action.type) {
    case "page.workspace.apply": return "当前业务工作区" + "；" + ({ draft: "采用到编辑区，尚未保存", save: "保存修改", download: "下载草稿", save_download: "保存并下载" })[action.mode] + "；修改字段：" + (Object.keys(action.patch).join("、") || "无新增修改");
    case "meeting.create":
      return `新建会议“${action.input.title}”（${action.input.date} ${action.input.startTime}${action.input.endTime ? `－${action.input.endTime}` : ""}，${action.input.location || "地点待定"}，${action.input.attendeeEstimate}人）`;
    case "meeting.update_fields": {
      const labels: Record<string, string> = {
        title: "名称",
        date: "日期",
        startTime: "开始时间",
        endTime: "结束时间",
        location: "地点",
        meetingRoomId: "会议室",
        roomRequirements: "场地要求",
        organizer: "主办单位",
        owner: "负责人",
        rosterRequired: "标准名单治理",
        attendeeEstimate: "预计人数",
        afternoonMeeting: "下午会议",
        mealType: "用餐类型",
        alcoholRequired: "酒水",
        parkingRequired: "停车",
        vehicleCount: "车辆数",
        vehicles: "参会车辆清单",
        publicityRequired: "宣传",
        reimbursementRequired: "报销",
        presentationRequired: "投屏",
        welcomeScreenRequired: "欢迎屏",
        roomSize: "会议室规格",
        notes: "备注",
      };
      return `修改“${meeting?.title ?? action.meetingId}”：${Object.entries(
        action.patch,
      )
        .map(([key, value]) => {
          if (key === "vehicles" && Array.isArray(value)) {
            return `参会车辆清单更新为 ${value.length} 辆：${value.map((vehicle) => `${vehicle.unit || "单位待补充"} ${vehicle.licensePlate}${vehicle.note ? `（${vehicle.note}）` : ""}`).join("、") || "清空车辆登记"}`;
          }
          const before = meeting
            ? (meeting as unknown as Record<string, unknown>)[key]
            : "";
          return `${labels[key] ?? key} ${readableValue(before)} → ${readableValue(value)}`;
        })
        .join("；")}`;
    }
    case "meeting.delete":
      return `将会议“${meeting?.title ?? action.meetingId}”移入回收站，清单和参会名单会一并保留`;
    case "meeting.duplicate":
      return `复制会议“${meeting?.title ?? action.meetingId}”及其保障设置和参会人快照；会议室需在副本中重新选择`;
    case "meeting.archive":
      return `将会议“${meeting?.title ?? action.meetingId}”归档并保留全部历史记录`;
    case "meeting.restore_archived":
      return `将归档会议“${meeting?.title ?? action.meetingId}”恢复到当前会议`;
    case "meeting.restore_deleted":
      return `从回收站恢复会议“${meeting?.title ?? action.meetingId}”`;
    case "meeting.purge":
      return `彻底删除回收站中的会议“${meeting?.title ?? action.meetingId}”，此操作无法恢复`;
    case "meeting.task.update": {
      const task = meeting?.tasks.find((item) => item.id === action.taskId);
      const labels: Record<string, string> = {
        status: "状态",
        owner: "负责人",
        dueDate: "截止日期",
        note: "备注",
      };
      return `更新“${meeting?.title ?? action.meetingId}”的任务“${task?.title ?? action.taskId}”：${Object.entries(
        action.patch,
      )
        .map(([key, value]) => `${labels[key] ?? key} → ${readableValue(value)}`)
        .join("；")}`;
    }
    case "meeting.attendee.add_from_contact":
      return `把通讯录中的“${contact?.name ?? action.contactId}”加入“${meeting?.title ?? action.meetingId}”参会名单`;
    case "meeting.attendee.add":
      return `把“${action.attendee.name}”（${action.attendee.unit}）加入“${meeting?.title ?? action.meetingId}”参会名单`;
    case "meeting.attendee.update": {
      const attendee = meeting?.attendees.find(
        (item) => item.id === action.attendeeId,
      );
      return `修改“${meeting?.title ?? action.meetingId}”的参会人“${attendee?.name ?? action.attendeeId}”：${Object.entries(
        action.patch,
      )
        .map(([key, value]) => `${key} → ${readableValue(value)}`)
        .join("；")}`;
    }
    case "meeting.attendee.remove": {
      const attendee = meeting?.attendees.find(
        (item) => item.id === action.attendeeId,
      );
      return `从“${meeting?.title ?? action.meetingId}”移除参会人“${attendee?.name ?? action.attendeeId}”`;
    }
    case "meeting.seating.generate":
      return `为“${meeting?.title ?? action.meetingId}”生成座次；确认后写入独立座次方案，不修改原人员名单。`;
    case "meeting.roster.sort":
      return `按后台${
        action.rosterRules.ranking.mode === "authority"
          ? "单位与职务层级"
          : "单位拼音"
      }规则重排“${meeting?.title ?? action.meetingId}”的参会名单`;
    case "meeting.roster.export":
      return `按后台排序与 Excel 字段规则导出“${meeting?.title ?? action.meetingId}”的参会名单`;
    case "contact.create":
      return `新增联系人“${action.input.name}”（${action.input.unit || "单位待补充"}${action.input.title ? `，${action.input.title}` : ""}）`;
    case "contact.update":
      return `修改联系人“${contact?.name ?? action.contactId}”：${Object.entries(
        action.patch,
      )
        .map(([key, value]) => `${key} → ${readableValue(value)}`)
        .join("；")}`;
    case "contact.delete":
      return `从通讯录删除“${contact?.name ?? action.contactId}”（不会改动历史会议中的人员快照）`;
    case "admin.config.patch":
      return `发布后台配置“${action.summary}”：${adminPatchSummary(action.patch)}`;
    case "roster.workspace.set_text":
      return `替换名单治理工作区的原始文本（${action.text.length} 个字符）`;
    case "roster.workspace.process":
      return "使用当前文件、原始文本和后台规则重新智能整理名单";
    case "roster.workspace.record.update":
      return `修改当前名单记录“${workspaceRecord?.name || action.recordId}”：${Object.entries(
        action.patch,
      )
        .map(([key, value]) => `${key} → ${readableValue(value)}`)
        .join("；")}`;
    case "roster.workspace.record.add":
      return `在当前名单新增“${action.record.name || "待补姓名"}”（${action.record.unit || "单位待补"}）`;
    case "roster.workspace.record.remove":
      return `从当前名单移除“${workspaceRecord?.name || action.recordId}”`;
    case "roster.workspace.alias.apply":
      return `应用单位归并建议：${workspaceAlias?.aliases.join("、") || action.aliasId} → ${workspaceAlias?.canonical || "标准单位名称"}`;
    case "roster.workspace.confirm":
      return "确认当前名单核对结果并生成排序预览";
    case "roster.workspace.analyze_ranking":
      return "对当前名单执行 AI 单位层级与职务排序分析";
    case "roster.workspace.enrich_person":
      return `联网核验并补全“${workspaceRecord?.name || action.recordId}”的职务候选`;
    case "roster.workspace.save_to_meeting":
      return `把当前名单保存到“${rosterWorkspace?.linkedMeeting?.title || "关联会议"}”并同步通讯录`;
    case "roster.workspace.export":
      return "按当前核对结果和后台 Excel 规则导出名单";
    case "roster.open":
      return `打开${meeting ? `“${meeting.title}”的` : ""}名单治理`;
    case "contacts.open":
      return "打开人员通讯录";
    case "navigate":
      return `打开系统页面：${action.destination}`;
  }
}

function operationPreviewRow(
  action: AssistantAction,
  index: number,
  meetings: MeetingRecord[],
  contacts: ContactRecord[],
  rosterWorkspace: RosterWorkspaceSnapshot | null,
  pageWorkspace: AssistantWorkspaceSnapshot | null = null,
): AssistantOperationPreviewRow {
  const raw = action as unknown as Record<string, unknown>;
  const type = String(raw.type ?? "system.action");
  const meeting =
    typeof raw.meetingId === "string"
      ? meetings.find((item) => item.id === raw.meetingId)
      : null;
  const contact =
    typeof raw.contactId === "string"
      ? contacts.find((item) => item.id === raw.contactId)
      : null;
  const moduleLabel = type === "page.workspace.apply" ? "当前页面" : type.startsWith("meeting.task")
    ? "核对清单"
    : type.startsWith("meeting.attendee") || type.startsWith("meeting.roster")
      ? "参会名单"
      : type.startsWith("meeting")
        ? "会议项目"
        : type.startsWith("contact")
          ? "人员通讯录"
          : type.startsWith("admin")
            ? "后台管理"
            : type.includes("roster")
              ? "名单治理"
              : "系统导航";
  const operationLabels: Record<string, string> = {
    "page.workspace.apply": "采用 / 保存 / 导出",
    "meeting.create": "新建",
    "meeting.update_fields": "修改",
    "meeting.delete": "移入回收站",
    "meeting.duplicate": "复制",
    "meeting.archive": "归档",
    "meeting.restore_archived": "恢复归档",
    "meeting.restore_deleted": "恢复",
    "meeting.purge": "彻底删除",
    "meeting.task.update": "更新任务",
    "meeting.attendee.add_from_contact": "加入参会人",
    "meeting.attendee.add": "新增参会人",
    "meeting.attendee.update": "修改参会人",
    "meeting.attendee.remove": "移除参会人",
    "meeting.roster.sort": "按规则排序",
    "meeting.seating.generate": "生成座次",
    "meeting.roster.export": "导出 Excel",
    "contact.create": "新增联系人",
    "contact.update": "修改联系人",
    "contact.delete": "删除联系人",
    "admin.config.patch": "发布配置修改",
    "roster.workspace.set_text": "替换原始文本",
    "roster.workspace.process": "智能整理",
    "roster.workspace.record.update": "修改记录",
    "roster.workspace.record.add": "新增记录",
    "roster.workspace.record.remove": "移除记录",
    "roster.workspace.alias.apply": "应用单位归并",
    "roster.workspace.confirm": "确认核对",
    "roster.workspace.analyze_ranking": "AI 分析排序",
    "roster.workspace.enrich_person": "核验职务",
    "roster.workspace.save_to_meeting": "保存到会议",
    "roster.workspace.export": "导出 Excel",
    "roster.open": "打开",
    "contacts.open": "打开",
    navigate: "打开",
  };
  const target = (type === "page.workspace.apply" ? pageWorkspace?.label : "") ||
    meeting?.title ||
    contact?.name ||
    (type === "contact.create" &&
    raw.input &&
    typeof raw.input === "object" &&
    !Array.isArray(raw.input)
      ? String((raw.input as Record<string, unknown>).name ?? "新联系人")
      : "") ||
    (type === "meeting.create" &&
    raw.input &&
    typeof raw.input === "object" &&
    !Array.isArray(raw.input)
      ? String((raw.input as Record<string, unknown>).title ?? "新会议")
      : type === "admin.config.patch"
        ? "当前后台配置"
        : "系统");
  return {
    id: `${type}-${index}`,
    module: moduleLabel,
    operation: operationLabels[type] ?? type,
    target,
    change: actionDescription(action, meetings, contacts, rosterWorkspace),
    tone:
      type.endsWith(".delete") ||
      type.endsWith(".remove") ||
      type.endsWith(".purge")
      ? "danger"
      : type === "admin.config.patch"
        ? "warning"
        : "normal",
  };
}

async function responseMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

function localDateOffset(days = 0) {
  const value = new Date(Date.now() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function AssistantPortal({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const scan = () => {
      const next = [...document.querySelectorAll<HTMLElement>('dialog[data-assistant-dialog="true"][open]')].at(-1) ?? document.body;
      setHost((previous) => previous === next ? previous : next);
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
    return () => observer.disconnect();
  }, []);
  return host ? createPortal(children, host) : null;
}
type BusinessSelection = { workspaceId: string; field: string; text: string; start: number; end: number };
type SessionInfo = SavedConversation & { phase: AssistantPhase };
export function ActionAssistantProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SessionInfo[]>([{ id: "session-initial", title: "新会话", phase: "idle", messages: [WELCOME_MESSAGE], updatedAt: 0 }]);
  const [activeId, setActiveId] = useState("session-initial");
  const [mountedSessions, setMountedSessions] = useState(() => new Set(["session-initial"]));
  const [open, setOpen] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyBlocked, setHistoryBlocked] = useState(false);
  const [historyStatus, setHistoryStatus] = useState("正在读取本机聊天历史…");
  const [request, setRequest] = useState<{ id: string; text: string; token: number } | null>(null);
  const [selection, setSelection] = useState<BusinessSelection | null>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const result = loadConversations(window.localStorage);
        if (result.store) {
          setSessions(result.store.sessions.map((s) => ({ ...s, phase: "idle" })));
          setActiveId(result.store.activeId); setOpen(result.store.open);
          setMountedSessions(new Set([result.store.activeId]));
        }
        setHistoryBlocked(Boolean(result.error));
        if (result.error) setHistoryStatus(result.error);
      } catch {
        setHistoryBlocked(true); setHistoryStatus("浏览器不允许保存聊天历史；当前对话仅在页面内保留。");
      }
      setHistoryReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const historyJson = useMemo(() => JSON.stringify({ version: 1, activeId, open, sessions: sessions.map(({ id, title, messages, updatedAt }) => ({ id, title, messages, updatedAt })) }), [activeId, open, sessions]);
  useEffect(() => {
    if (!historyReady || historyBlocked) return;
    let error = "";
    try { error = saveConversations(window.localStorage, JSON.parse(historyJson) as ConversationStore); }
    catch { error = "浏览器不允许保存聊天历史，当前记录仍在页面中，请勿刷新。"; }
    const timer = window.setTimeout(() => setHistoryStatus(error || "聊天记录已保存到本机，刷新后可恢复。"), 0);
    return () => window.clearTimeout(timer);
  }, [historyJson, historyReady, historyBlocked]);
  useEffect(() => {
    const capture = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest(".action-assistant-layer")) return;
      const container = target.closest("[data-assistant-workspace]");
      if (!container) return;
      const input = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement ? target : null;
      const start = input?.selectionStart ?? 0, end = input?.selectionEnd ?? 0;
      const next = { workspaceId: container.getAttribute("data-assistant-workspace") || "", field: target.getAttribute("data-assistant-field") || target.getAttribute("name") || target.getAttribute("data-assistant-record") || "", text: input ? input.value.slice(start, end) : window.getSelection()?.toString().slice(0, 8000) || "", start, end };
      setSelection((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    for (const name of ["focusin", "select", "mouseup", "keyup"]) document.addEventListener(name, capture);
    return () => { for (const name of ["focusin", "select", "mouseup", "keyup"]) document.removeEventListener(name, capture); };
  }, []);
  const newSession = useCallback(() => {
    const id = makeId("session");
    setSessions((current) => [...current, { id, title: "新会话", phase: "idle", messages: [WELCOME_MESSAGE], updatedAt: Date.now() }]);
    setActiveId(id); setOpen(true);
    setMountedSessions((current) => new Set([...current, id]));
  }, []);
  const selectSession = useCallback((id: string) => {
    setMountedSessions((current) => current.has(id) ? current : new Set([...current, id]));
    setActiveId(id);
  }, []);
  const updateSession = useCallback((id: string, patch: Partial<SessionInfo>) => {
    setSessions((current) => {
      const index = current.findIndex((entry) => entry.id === id);
      if (index < 0 || !Object.entries(patch).some(([k, v]) => current[index][k as keyof SessionInfo] !== v)) return current;
      const next = [...current];
      const changedHistory = patch.messages !== undefined || patch.title !== undefined;
      next[index] = { ...current[index], ...patch, updatedAt: changedHistory ? Math.max(Date.now(), current[index].updatedAt + 1) : current[index].updatedAt };
      return next;
    });
  }, []);
  const openAssistant = useCallback((message?: string) => {
    if (message) setRequest({ id: activeId, text: message, token: Date.now() });
    setOpen(true);
  }, [activeId]);
  useEffect(() => {
    document.body.classList.toggle("assistant-docked", open);
    return () => document.body.classList.remove("assistant-docked");
  }, [open]);
  const value = useMemo(() => ({ openAssistant, isOpen: open }), [openAssistant, open]);
  return <AssistantContext.Provider value={value}>{children}{historyReady && sessions.filter((s) => mountedSessions.has(s.id)).map((session) =>
    <AssistantErrorBoundary key={session.id} visible={open && activeId === session.id} onClose={() => setOpen(false)} onFailure={() => updateSession(session.id, { phase: "error" })}>
    <AssistantSession sessionId={session.id} initialMessages={session.messages} historyStatus={historyStatus} open={open && activeId === session.id} setOpen={setOpen}
      sessions={sessions} onSelect={selectSession} onNew={newSession} onUpdate={updateSession}
      request={request?.id === session.id ? request : null} selection={selection} />
    </AssistantErrorBoundary>
  )}</AssistantContext.Provider>;
}

function AssistantSession({ sessionId, initialMessages, historyStatus, open, setOpen, sessions, onSelect, onNew, onUpdate, request, selection }: {
  initialMessages: AssistantMessage[]; historyStatus: string;
  sessionId: string; open: boolean; setOpen: (open: boolean) => void; sessions: SessionInfo[];
  onSelect: (id: string) => void; onNew: () => void; onUpdate: (id: string, patch: Partial<SessionInfo>) => void;
  request: { text: string; token: number } | null; selection: BusinessSelection | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { config: adminConfig, revision, reload: reloadAdminConfig } =
    useAdminConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationHistoryOpen, setConversationHistoryOpen] = useState(false);
  const [layoutMode, setLayoutMode] = useState<"auto" | "wide" | "compact">("auto");
  const [selectedPane, setSelectedPane] = useState<"auto" | "conversation" | "workspace">("auto");
  const [settings, setSettings] = useState<AISettings>(() => loadAISettings());
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<AssistantPhase>("idle");
  const [plan, setPlan] = useState<AssistantPlan | null>(null);
  const [planMeetings, setPlanMeetings] = useState<MeetingRecord[]>([]);
  const [planPageWorkspace, setPlanPageWorkspace] = useState<AssistantWorkspaceSnapshot | null>(null);
  const [planContacts, setPlanContacts] = useState<ContactRecord[]>([]);
  const [planRosterWorkspace, setPlanRosterWorkspace] =
    useState<RosterWorkspaceSnapshot | null>(null);
  const [createDraft, setCreateDraft] =
    useState<AssistantMeetingInput | null>(null);
  const [createDraftError, setCreateDraftError] = useState("");
  const [memory, setMemory] = useState<AssistantWorkingMemory>({
    ...EMPTY_ASSISTANT_WORKING_MEMORY,
  });
  const [messages, setMessages] = useState<AssistantMessage[]>(() => initialMessages.length ? initialMessages : [WELCOME_MESSAGE]);
  useEffect(() => { onUpdate(sessionId, { messages }); }, [messages, sessionId, onUpdate]);
  const [retryText, setRetryText] = useState("");
  const [documents, setDocuments] = useState<AssistantDocument[]>([]);
  const [readingDocuments, setReadingDocuments] = useState(false);
  const [documentProgress, setDocumentProgress] = useState("");
  const [documentError, setDocumentError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const documentReadRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const snapshots = useSyncExternalStore(subscribeAssistantWorkspaces, getAssistantWorkspaces, getServerAssistantWorkspaces);
  const candidates = snapshots.filter((ws) => ws.path === pathname);
  const workspacePriority = (ws: AssistantWorkspaceSnapshot) => ({ meeting_editor: 100, meeting_plan: 90, seating: 80, meeting_new: 70, admin: 60, roster: 50, attendees: 40 }[ws.kind] ?? 0) + (ws.editableFields.length ? 10 : 0);
  const pageWorkspace = candidates.find((ws) => ws.id === selection?.workspaceId) ?? [...candidates].sort((a, b) => workspacePriority(b) - workspacePriority(a))[0] ?? null;
  useEffect(() => { onUpdate(sessionId, { phase }); }, [phase, sessionId, onUpdate]);
  useEffect(() => {
    if (!request) return;
    const timer = window.setTimeout(() => { setPrompt(request.text); setSettings(loadAISettings()); }, 0);
    return () => window.clearTimeout(timer);
  }, [request]);
  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => { setSettings(loadAISettings()); setConversationHistoryOpen(false); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  const loading = phase === "thinking";
  const executing = phase === "executing";
  const activeSetting = settings.providers[settings.activeProvider];
  const activePreset = AI_PROVIDER_PRESET_MAP[settings.activeProvider];
  const activeUsesCatalogModel = isCatalogModel(
    settings.activeProvider,
    activeSetting.model,
  );
  const configured = Boolean(
    activeSetting.apiKey && activeSetting.baseUrl && activeSetting.model,
  );
  const hasDestructivePlan = Boolean(
    plan?.actions.some(
      (action) =>
        action.type.endsWith(".delete") || action.type.endsWith(".remove"),
    ),
  );
  const hasAdminPlan = Boolean(
    plan?.actions.some((action) => action.type === "admin.config.patch"),
  );
  const seatingPreviews = useMemo(() => (plan?.actions ?? []).filter((action) => action.type === "meeting.seating.generate").map((action) => {
    try {
      const meeting = planMeetings.find((item) => item.id === action.meetingId);
      if (!meeting) throw new Error("目标会议不存在，请重新读取");
      if (action.expectedConfigRevision !== revision) throw new Error("座次规则配置已变化，请重新生成预览");
      const participants = action.participants ?? meeting.seatingPlan?.participants ?? meeting.attendees.map((person) => ({ id: person.id, name: person.name, unit: person.unit, title: person.title, grade: "", weight: null, party: "auto" as const }));
      return { plan: generateSeatingPlan(participants, action.options, adminConfig.rosterRules), error: "" };
    } catch (error) { return { plan: null, error: error instanceof Error ? error.message : "座次预览失败" }; }
  }), [adminConfig.rosterRules, plan, planMeetings, revision]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [messages, phase, plan]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      documentReadRef.current += 1;
    },
    [],
  );

  useEffect(() => {
    if (!documents.length && !createDraft && !loading && !executing && !readingDocuments) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [documents.length, createDraft, loading, executing, readingDocuments]);

  async function addDocuments(files: File[]) {
    if (!files.length || readingDocuments || loading || executing) return;
    if (files.length + documents.length > MAX_ASSISTANT_DOCUMENTS) {
      setDocumentError(`一次最多添加 ${MAX_ASSISTANT_DOCUMENTS} 份资料，请先移除不需要的文件。`);
      return;
    }
    const token = ++documentReadRef.current;
    setReadingDocuments(true);
    setDocumentError("");
    const accepted = [...documents];
    const errors: string[] = [];
    try {
      for (const file of files) {
        if (token !== documentReadRef.current) return;
        setDocumentProgress(`正在读取 ${file.name}…`);
        try {
          const result = await readBusinessDocument(file, (message) => {
            if (token === documentReadRef.current) setDocumentProgress(`${file.name}：${message}`);
          });
          const next = parseAssistantDocuments([...accepted, {
            id: makeId("document"), name: file.name, size: file.size, content: result.content,
          }]);
          accepted.splice(0, accepted.length, ...next);
        } catch (error) {
          errors.push(error instanceof Error ? error.message : `${file.name} 读取失败`);
        }
      }
      if (token !== documentReadRef.current) return;
      setDocuments(accepted);
      setDocumentError(errors.join("；"));
    } finally {
      if (token === documentReadRef.current) {
        setReadingDocuments(false);
        setDocumentProgress("");
      }
    }
  }

  function patchActiveSetting(patch: Partial<typeof activeSetting>) {
    setSettings((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [current.activeProvider]: {
          ...current.providers[current.activeProvider],
          ...patch,
        },
      },
    }));
  }

  function saveSettingsPanel() {
    saveAISettings(settings);
    setSettingsOpen(false);
    setMessages((current) => [
      ...current,
      {
        id: makeId("settings"),
        role: "system",
        text: `已启用 ${providerLabel(settings.activeProvider)}；密钥只用于本机转发调用。`,
      },
    ]);
  }

  function resetConversation() { setConversationHistoryOpen(false); onNew(); }

  async function contactSnapshot() {
    try {
      const contacts: ContactRecord[] = [];
      let offset = 0;
      while (contacts.length < 20_000) {
        const page = await listContacts({
          limit: Math.min(200, 20_000 - contacts.length),
          offset,
        });
        contacts.push(...page.contacts);
        offset += page.contacts.length;
        if (!page.contacts.length || offset >= page.total) break;
      }
      return contacts;
    } catch {
      throw new Error("通讯录读取失败，无法完成本次全量系统查询，请稍后重试。");
    }
  }

  function defaultMeetingDraft(): AssistantMeetingInput {
    const defaultRoom = adminConfig.meetingRooms.find(
      (room) =>
        room.enabled &&
        room.id === adminConfig.organization.defaultMeetingRoomId,
    );
    return {
      title: "",
      date: localDateOffset(1),
      startTime: adminConfig.organization.defaultStartTime,
      location: defaultRoom
        ? defaultRoom.location.trim()
          ? `${defaultRoom.name}（${defaultRoom.location}）`
          : defaultRoom.name
        : "",
      ...(defaultRoom ? { meetingRoomId: defaultRoom.id } : {}),
      ...(defaultRoom && meetingRoomRequirements(defaultRoom)
        ? { roomRequirements: meetingRoomRequirements(defaultRoom) }
        : {}),
      organizer: adminConfig.organization.name,
      owner: adminConfig.organization.defaultOwner,
      attendeeEstimate: adminConfig.organization.defaultAttendeeEstimate,
      afternoonMeeting:
        adminConfig.organization.defaultStartTime >= "12:00",
      mealType: "none",
      alcoholRequired: false,
      parkingRequired: false,
      vehicleCount: 0,
      publicityRequired: false,
      reimbursementRequired: false,
      presentationRequired:
        adminConfig.organization.defaultPresentationRequired,
      welcomeScreenRequired: false,
      roomSize: defaultRoom?.roomSize ?? adminConfig.organization.defaultRoomSize,
    };
  }

  function memoryDraftFromInput(input: AssistantMeetingInput) {
    const draft: AssistantNewMeetingDraft = { ...input };
    if (draft.attendees) draft.attendees = draft.attendees.filter((attendee) => attendee.name.trim());
    if (!draft.title?.trim()) delete draft.title;
    if (!draft.date?.trim()) delete draft.date;
    if (!draft.startTime?.trim()) delete draft.startTime;
    if (!draft.endTime?.trim()) delete draft.endTime;
    return draft;
  }

  function patchCreateDraft(patch: Partial<AssistantMeetingInput>) {
    if (!createDraft) return;
    const next: AssistantMeetingInput = { ...createDraft, ...patch };
    if (Object.hasOwn(patch, "startTime") && !Object.hasOwn(patch, "afternoonMeeting")) {
      next.afternoonMeeting = Boolean(next.startTime && next.startTime >= "12:00");
    }
    if (!next.parkingRequired) next.vehicleCount = 0;
    if (next.mealType !== "business") next.alcoholRequired = false;
    if (!next.endTime) delete next.endTime;
    if (!next.meetingRoomId) delete next.meetingRoomId;
    if (!next.roomRequirements) delete next.roomRequirements;

    setCreateDraft(next);
    setMemory({
      activeIntent: "create_meeting",
      newMeetingDraft: memoryDraftFromInput(next),
      selectedMeetingId: null,
    });
    try {
      const nextPlan = buildAssistantCreateMeetingPlan(next, {
        summary: next.title.trim()
          ? `创建会议：${next.title.trim()}`
          : "填写新会议草稿",
      });
      setPlan(nextPlan);
      setCreateDraftError("");
      setPhase(nextPlan ? "awaiting_confirmation" : "idle");
    } catch (error) {
      setPlan(null);
      setCreateDraftError(
        error instanceof Error ? error.message : "会议设置存在冲突",
      );
      setPhase("error");
    }
  }

  async function runPlan(
    nextPlan: AssistantPlan,
    requiresConfirmation: boolean,
  ) {
    setPhase("executing");
    try {
      const touchesContacts = nextPlan.actions.some((action) =>
        ["contact.create", "contact.update", "contact.delete"].includes(action.type) ||
        (action.type === "meeting.create" && Boolean(action.input.attendees?.length)),
      );
      const beforeSnapshot = {
        meetings: [...loadMeetingStoreSnapshot().all],
        contacts: touchesContacts ? await contactSnapshot() : [],
        adminRevision: revision,
        adminConfig: JSON.parse(JSON.stringify(adminConfig)) as typeof adminConfig,
      };
      const result = await executeConfirmedPlan(nextPlan, {
        loadMeetings: () => loadMeetingStoreSnapshot().all,
        meetingRooms: adminConfig.meetingRooms,
        navigate: (path) => router.push(path),
        createMeetingOptions: {
          checklistTemplates: adminConfig.checklistTemplates.filter(
            (item) => item.enabled,
          ),
          configRevision: revision,
          meetingRules: adminConfig.meetingRules,
        },
      });
      await flushMeetingPersistence();
      const contactSyncMessages: string[] = [];
      const createsWithAttendees = nextPlan.actions.some((action) => action.type === "meeting.create" && Boolean(action.input.attendees?.length));
      for (const id of createsWithAttendees ? result.createdMeetingIds : []) {
        const meeting = loadMeetingStoreSnapshot().all.find((item) => item.id === id);
        if (!meeting?.attendees.length) continue;
        try {
          const synced = await syncMeetingContacts(meeting);
          if (synced.skipped) contactSyncMessages.push(`${synced.skipped} 人因单位缺失暂未同步通讯录，仍已保存在会议中`);
        } catch {
          contactSyncMessages.push("会议已保存；通讯录同步暂时失败，可稍后补录，勿重复创建会议");
        }
      }
      const afterContacts = touchesContacts ? await contactSnapshot() : [];
      if (createsWithAttendees) {
        const beforeContacts = new Map(beforeSnapshot.contacts.map((contact) => [contact.id, contact]));
        for (const contact of afterContacts) {
          const previous = beforeContacts.get(contact.id);
          if (!previous) result.createdContactIds.push(contact.id);
          else if (previous.updatedAt !== contact.updatedAt) result.updatedContactIds.push(contact.id);
        }
      }
      const historyEntry = buildAssistantOperationHistoryEntry(
        nextPlan,
        result,
        beforeSnapshot,
        {
          meetings: [...loadMeetingStoreSnapshot().all],
          contacts: afterContacts,
        },
      );
      if (historyEntry) recordAssistantOperation(historyEntry);
      const createdMeetingId = result.createdMeetingIds[0];
      const parts = [
        createdMeetingId ? "会议已创建并生成配套清单" : "",
        result.updatedMeetingIds.length ? "会议数据已更新" : "",
        result.sortedMeetingIds.length ? "参会名单已按配置规则重排" : "",
        result.exportedRosterFiles.length
          ? `名单已生成并开始下载：${result.exportedRosterFiles.join("、")}`
          : "",
        result.deletedMeetingIds.length ? "会议已移入回收站" : "",
        result.duplicatedMeetingIds.length
          ? "会议副本已创建，请重新确认日期和会议室"
          : "",
        result.archivedMeetingIds.length ? "会议已归档" : "",
        result.restoredMeetingIds.length ? "会议已恢复到当前会议" : "",
        result.purgedMeetingIds.length ? "会议已彻底删除" : "",
        result.createdContactIds.length ? "联系人已加入通讯录" : "",
        result.updatedContactIds.length ? "联系人信息已更新" : "",
        result.deletedContactIds.length ? "联系人已从通讯录删除" : "",
        result.adminUpdated
          ? `后台配置已发布${result.adminRevision === null ? "" : `为 r${result.adminRevision}`}`
          : "",
        result.rosterWorkspaceResult?.message ?? "",
        result.workspaceMessage ?? "",
        result.navigationPath ? "页面已为你打开" : "",
        ...contactSyncMessages,
      ].filter(Boolean);
      if (result.adminUpdated) await reloadAdminConfig();
      setMessages((current) => [
        ...current,
        {
          id: makeId("done"),
          role: "system",
          text: parts.join("；") || `已完成 ${result.executedActions} 项操作。`,
          ...(createdMeetingId
            ? {
                link: {
                  label: "打开刚创建的会议",
                  path: `/meetings/${encodeURIComponent(createdMeetingId)}`,
                },
              }
            : {}),
        },
      ]);
      if (createdMeetingId) {
        setDocuments([]);
        setMemory({
          activeIntent: "none",
          newMeetingDraft: null,
          selectedMeetingId: createdMeetingId,
        });
        setCreateDraft(null);
        setCreateDraftError("");
      } else if (
        memory.selectedMeetingId &&
        (result.deletedMeetingIds.includes(memory.selectedMeetingId) ||
          result.purgedMeetingIds.includes(memory.selectedMeetingId) ||
          result.archivedMeetingIds.includes(memory.selectedMeetingId))
      ) {
        setMemory({
          activeIntent: "none",
          newMeetingDraft: null,
          selectedMeetingId: null,
        });
      }
      setPlan(null);
      setPhase("completed");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: makeId("execute-error"),
          role: "system",
          text: error instanceof Error ? error.message : "操作执行失败",
        },
      ]);
      setPhase(requiresConfirmation ? "awaiting_confirmation" : "error");
    }
  }

  async function sendMessage(explicitText?: string) {
    const requestText = (explicitText ?? (prompt.trim() || (documents.length
      ? createDraft
        ? "根据已添加资料补充这份会议草稿，保留已知内容，给我确认后录入本系统。"
        : "根据已添加资料创建一场会议，自动识别并填写必要信息和参会人，给我确认后录入本系统。"
      : ""))).trim();
    if (!requestText || loading || executing || readingDocuments) return;
    if (sessions.find((entry) => entry.id === sessionId)?.title === "新会话") onUpdate(sessionId, { title: requestText.slice(0, 24) });
    const intentBoundary = detectAssistantIntentBoundary(
      requestText,
      memory.activeIntent,
    );
    const wantsCreateMeeting =
      pageWorkspace?.kind !== "meeting_new" && (intentBoundary === "create_meeting" || isCreateMeetingRequest(requestText));
    let requestMemory = memory;
    if (wantsCreateMeeting) {
      const localDraft = createDraft ?? defaultMeetingDraft();
      requestMemory = {
        activeIntent: "create_meeting",
        newMeetingDraft:
          memory.activeIntent === "create_meeting"
            ? memory.newMeetingDraft ?? {}
            : {},
        selectedMeetingId: null,
      };
      setCreateDraft(localDraft);
      setCreateDraftError("");
      setMemory(requestMemory);
    } else if (intentBoundary) {
      requestMemory = {
        activeIntent: intentBoundary,
        newMeetingDraft: null,
        selectedMeetingId: memory.selectedMeetingId,
      };
      setCreateDraft(null);
      setCreateDraftError("");
      setPlan(null);
      setMemory(requestMemory);
    }
    const modelSettingsRequest = requestedModelSettings(requestText);
    if (modelSettingsRequest) {
      const nextSettings = modelSettingsRequest.provider
        ? { ...settings, activeProvider: modelSettingsRequest.provider }
        : settings;
      setSettings(nextSettings);
      setSettingsOpen(true);
      setPrompt("");
      setMessages((current) => [
        ...current,
        { id: makeId("user"), role: "user", text: requestText },
        {
          id: makeId("assistant"),
          role: "assistant",
          text: modelSettingsRequest.provider
            ? `已为你打开 ${providerLabel(modelSettingsRequest.provider)} 设置。API Key 仍请在本机输入框中填写，助手不会读取或回显密钥。`
            : "已打开模型与联网设置。API Key 请在本机输入框中填写，助手不会读取或回显密钥。",
        },
      ]);
      setPhase("idle");
      return;
    }
    const localNavigation = requestedLocalNavigation(requestText);
    if (localNavigation) {
      setPrompt("");
      setMessages((current) => [
        ...current,
        { id: makeId("user"), role: "user", text: requestText },
        {
          id: makeId("assistant"),
          role: "assistant",
          text: `已为你打开${localNavigation.label}。`,
        },
      ]);
      router.push(localNavigation.path);
      setPhase("completed");
      return;
    }
    if (!configured) {
      if (wantsCreateMeeting) {
        setPrompt("");
        setMessages((current) => [
          ...current,
          { id: makeId("user"), role: "user", text: requestText },
          {
            id: makeId("assistant"),
            role: "assistant",
            text: "已打开新会议表格。你可以直接填写并创建；配置大模型 API 后，也可以继续用自然语言回填。",
          },
        ]);
        setPhase("idle");
        return;
      }
      setSettingsOpen(true);
      setMessages((current) => [
        ...current,
        {
          id: makeId("warning"),
          role: "system",
          text: "请先配置一个可用的大模型 API。",
        },
      ]);
      return;
    }

    const requestWorkspace = pageWorkspace ? structuredClone(pageWorkspace) : null;
    const requestSelection = selection?.workspaceId === requestWorkspace?.id ? structuredClone(selection) : null;
    const userMessage: AssistantMessage = {
      id: makeId("user"),
      role: "user",
      text: requestText,
    };
    const conversation = [
      ...messages
        .filter(
          (message): message is AssistantMessage & {
            role: "user" | "assistant";
          } => message.role === "user" || message.role === "assistant",
        )
        .map((message) => ({ role: message.role, content: message.text })),
      { role: "user" as const, content: requestText },
    ].slice(-40);

    setMessages((current) => [...current, {
      ...userMessage,
      text: documents.length ? `${requestText}\n资料：${documents.map((item) => item.name).join("、")}` : requestText,
    }]);
    setPrompt("");
    setPlan(null);
    setRetryText(requestText);
    setPhase("thinking");
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    try {
      const allMeetings = [...loadMeetingStoreSnapshot().all].sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
      const meetingId = requestWorkspace?.meetingId || currentMeetingId(pathname);
      const current = allMeetings.find((meeting) => meeting.id === meetingId);
      const scopedMeetings = allMeetings.slice(
        0,
        pathname.startsWith("/lists") ? 8 : pathname.startsWith("/tasks") ? 40 : 20,
      );
      if (current && !scopedMeetings.some((item) => item.id === current.id)) {
        scopedMeetings.push(current);
      }
      const contacts = await contactSnapshot();
      const rosterWorkspace = (pathname.startsWith("/lists") || requestWorkspace?.kind === "roster")
        ? await getRosterWorkspaceSnapshot({ timeoutMs: 800 }).catch(() => null)
        : null;
      const webResearch = requestsWebResearch(requestText)
        ? await fetchAssistantWebResearch(requestText, settings, controller.signal)
        : {
            requested: false,
            available: Boolean(
              settings.webSearch.enabled && settings.webSearch.apiKey,
            ),
            error: "",
            query: "",
            results: [] as AssistantWebSearchResult[],
          };
      const today = localDateOffset();
      const fullDataQuery = buildAssistantFullDataContext(
        requestText,
        allMeetings,
        contacts,
        today,
      );
      const defaultMeetingInput: AssistantMeetingInput = {
        ...defaultMeetingDraft(),
        title: "待命名会议",
      };
      const response = await fetch("/api/assistant/respond", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          conversation,
          memory: requestMemory,
          config: activeModelRequestConfig(settings),
          documents,
          context: {
            now: new Date().toISOString(),
            localDate: today,
            timezone: "Asia/Shanghai",
            page: {
              kind: requestWorkspace?.kind === "roster" ? "roster" : pageKind(pathname),
              module: requestWorkspace?.kind ?? null,
              path: pathname,
              currentMeetingId: meetingId || null,
            },
            pageWorkspace: requestWorkspace,
            selection: requestSelection,
            meetings: scopedMeetings.map(meetingSummary),
            currentMeeting: current
              ? {
                  ...meetingSummary(current),
                  notes: current.notes ?? "",
                  meetingPlan: current.meetingPlan ?? null,
                  vehicles: current.vehicles ?? [],
                  seatingPlan: current.seatingPlan ?? null,
                  attendees: current.attendees.map((attendee) => ({
                    id: attendee.id,
                    name: attendee.name,
                    unit: attendee.unit,
                    department: attendee.department,
                    title: attendee.title,
                  })),
                  tasks: current.tasks.map((task) => ({
                    id: task.id,
                    title: task.title,
                    phase: task.phase,
                    group: task.group,
                    status: task.status,
                    owner: task.owner,
                    dueDate: task.dueDate,
                    note: task.note,
                  })),
                }
              : null,
            contacts: contacts
              .slice(0, pathname.startsWith("/lists") ? 150 : 400)
              .map((contact) => ({
              id: contact.id,
              name: contact.name,
              unit: contact.unit,
              department: contact.department,
              title: contact.title,
              updatedAt: contact.updatedAt,
              meetingCount: contact.meetingCount,
              meetingIds: contact.meetingIds.slice(-10),
              lastMeetingId: contact.lastMeetingId,
              lastMeetingTitle: contact.lastMeetingTitle,
              lastMeetingDate: contact.lastMeetingDate,
              })),
            fullDataQuery,
            rosterWorkspace: assistantRosterWorkspaceContext(rosterWorkspace),
            adminRevision: revision,
            adminConfig,
            defaults: defaultMeetingInput,
            defaultMeetingInput,
            meetingRules: adminConfig.meetingRules,
            checklistTemplates: adminConfig.checklistTemplates
              .filter((item) => item.enabled)
              .map((item) => ({
                id: item.id,
                title: item.title,
                phase: item.phase,
                group: item.group,
                condition: item.condition,
              })),
            webResearch,
            capabilities: {
              meetings: true,
              checklists: true,
              taskCenter: true,
              contacts: true,
              attendees: true,
              roster: true,
              meetingDelete: true,
              meetingLifecycle: true,
              directAttendeeEditing: true,
              contactDeleteAndBulkUpdate: true,
              configuredRosterSorting: true,
              adminConfiguration: true,
              webSearchConfigured: Boolean(
                settings.webSearch.enabled && settings.webSearch.apiKey,
              ),
            },
          },
        }),
      });
      if (!response.ok) {
        throw new Error(
          await responseMessage(response, "智能助手暂时无法处理这项要求"),
        );
      }
      const payload = (await response.json()) as AgentApiPayload;
      const agentResponse = parseAssistantAgentResponse(payload.response);
      const nextMemory = parseAssistantWorkingMemory(payload.memory);
      const serverPlan = payload.plan ? parseAssistantPlan(payload.plan) : null;
      const serverCreateAction = serverPlan?.actions.find(
        (
          action,
        ): action is Extract<AssistantAction, { type: "meeting.create" }> =>
          action.type === "meeting.create",
      );
      const nextCreateDraft = serverCreateAction
        ? { ...serverCreateAction.input }
        : nextMemory.activeIntent === "create_meeting"
          ? {
              ...defaultMeetingDraft(),
              ...(nextMemory.newMeetingDraft ?? {}),
              title: nextMemory.newMeetingDraft?.title ?? "",
              ...(documents.length ? {
                date: nextMemory.newMeetingDraft?.date ?? "",
                startTime: nextMemory.newMeetingDraft?.startTime ?? "",
              } : {}),
            }
          : null;
      let nextPlan = serverPlan;
      let nextDraftError = "";
      if (
        !nextPlan &&
        nextCreateDraft &&
        agentResponse.mode !== "clarification"
      ) {
        try {
          nextPlan = buildAssistantCreateMeetingPlan(nextCreateDraft);
        } catch (error) {
          nextDraftError =
            error instanceof Error ? error.message : "会议设置存在冲突";
        }
      }
      const createAction = nextPlan?.actions.find(
        (
          action,
        ): action is Extract<AssistantAction, { type: "meeting.create" }> =>
          action.type === "meeting.create",
      );
      setMemory(nextMemory);
      setCreateDraft(nextCreateDraft);
      setCreateDraftError(nextDraftError);
      setPlanPageWorkspace(requestWorkspace);
      setPlanMeetings(allMeetings);
      setPlanContacts(contacts);
      setPlanRosterWorkspace(rosterWorkspace);
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: makeId("assistant"),
          role: "assistant",
          text: (requestWorkspace ? "【" + requestWorkspace.label + "】\n" : "") + (documents.length && nextCreateDraft
            ? agentResponse.reply
            : createAction
            ? createMeetingPreviewMessage(createAction.input)
            : nextCreateDraft
              ? "已为你打开一份新会议表格。可以直接填写，也可以继续用自然语言告诉我时间、地点、人数或其他要求，我会回填到同一张表里。"
              : agentResponse.reply),
          assumptions: nextCreateDraft && !documents.length
            ? undefined
            : agentResponse.assumptions,
          suggestions: nextPlan || nextCreateDraft
            ? undefined
            : agentResponse.suggestions,
          sources: webResearch.results.map((source) => ({
            title: source.title,
            url: source.url,
          })),
        },
      ]);

      if (nextPlan && !assistantPlanRequiresConfirmation(nextPlan)) {
        setPlan(null);
        await runPlan(nextPlan, false);
      } else if (nextPlan) {
        setPlan(nextPlan);
        setPhase("awaiting_confirmation");
      } else {
        setPlan(null);
        setPhase(
          agentResponse.mode === "clarification"
            ? "awaiting_clarification"
            : "idle",
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setMessages((current) => [
          ...current,
          {
            id: makeId("stopped"),
            role: "system",
            text: "已停止本次处理，前面的会话和草稿仍然保留。",
          },
        ]);
        setPhase("idle");
      } else {
        setMessages((current) => [
          ...current,
          {
            id: makeId("error"),
            role: "system",
            text: error instanceof Error ? error.message : "智能助手处理失败",
            suggestions: ["重试上一条"],
          },
        ]);
        setPhase("error");
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }

  function suggestionClick(text: string) {
    if (text === "重试上一条" && retryText) {
      void sendMessage(retryText);
      return;
    }
    void sendMessage(text);
  }

  function cancelCreateDraft() {
    setCreateDraft(null);
    setCreateDraftError("");
    setPlan(null);
    setMemory({ ...EMPTY_ASSISTANT_WORKING_MEMORY });
    setPhase("idle");
    setMessages((current) => [
      ...current,
      {
        id: makeId("cancelled-draft"),
        role: "system",
        text: "已取消这份新会议草稿。",
      },
    ]);
  }

  const pagePreviewAction = plan?.actions.find((a) => a.type === "page.workspace.apply");
  let planDocumentPreview = null;
  if (pagePreviewAction) {
    const captured = planPageWorkspace;
    if (captured?.kind === "meeting_plan") {
      try { planDocumentPreview = validateMeetingPlan({ ...(captured.data.draft as object), ...pagePreviewAction.patch }); } catch { /* The actual executor rejects invalid content. */ }
    }
  }
  const hasWorkspace = Boolean(createDraft || plan?.actions.length);
  const wideLayout = layoutMode === "wide" || (layoutMode === "auto" && hasWorkspace);
  const activePane = selectedPane === "auto"
    ? hasWorkspace ? "workspace" : "conversation"
    : selectedPane;

  return (
    <AssistantPortal>
      {open ? (
        <div className={`action-assistant-layer${wideLayout ? " is-wide" : ""}`} role="presentation">
          <aside
            className={`action-assistant-drawer${wideLayout ? " is-wide" : ""}${hasWorkspace ? " has-workspace" : ""}`}
            role="dialog"
            aria-modal="false"
            aria-label="会务智能助手"
          >
            <header className="action-assistant-header">
              <div>
                <span><Sparkles /> 会务智能助手</span>
                <label className="assistant-conversation-title">
                  <select aria-label="切换 AI 会话" title="切换对话历史" value={sessionId} onChange={(e) => onSelect(e.target.value)}>
                    {sessions.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}{entry.phase === "thinking" ? " · 生成中" : entry.phase === "awaiting_confirmation" ? " · 待确认" : ""}</option>)}
                  </select>
                </label>
                <small className="assistant-current-workspace" title={pageWorkspace?.label}>正在协助：{pageWorkspace?.label ?? ({ "/": "工作台", "/meetings": "我的会议", "/meetings/new": "会议登记", "/tasks": "会务待办", "/lists": "名单治理", "/admin": "管理中心" }[pathname] || "当前页面")}</small>
              </div>
              <div>
                <button type="button" aria-label="对话历史" title="浏览全部对话历史" aria-pressed={conversationHistoryOpen} onClick={() => { setConversationHistoryOpen((current) => !current); setHistoryOpen(false); setSettingsOpen(false); }}><MessagesSquare/></button>
                <button
                  type="button"
                  onClick={() => setLayoutMode(wideLayout ? "compact" : "wide")}
                  aria-label={wideLayout ? "收起工作区" : "展开工作区"}
                  title={wideLayout ? "收起工作区" : "展开工作区"}
                >
                  {wideLayout ? <Minimize2 /> : <Maximize2 />}
                </button>
                <button
                  type="button"
                  onClick={resetConversation}
                  aria-label="新建会话"
                  title="新建会话，保留当前对话历史"
                >
                  <RotateCcw />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen((value) => !value);
                    setSettingsOpen(false);
                    setConversationHistoryOpen(false);
                  }}
                  aria-label="操作历史与撤销"
                  title="操作历史与撤销"
                  aria-pressed={historyOpen}
                >
                  <History />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSettingsOpen((value) => !value);
                    setHistoryOpen(false);
                    setConversationHistoryOpen(false);
                  }}
                  aria-label="助手设置"
                >
                  <Settings2 />
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="关闭智能助手"
                >
                  <X />
                </button>
              </div>
            </header>

            {conversationHistoryOpen && <AssistantConversationHistory sessions={sessions} activeId={sessionId} onSelect={(id) => { onSelect(id); setConversationHistoryOpen(false); }} onBack={() => setConversationHistoryOpen(false)}/>}
            <div className="assistant-conversation-content" hidden={conversationHistoryOpen}>
            {settingsOpen ? (
              <section className="action-assistant-settings">
                <label>
                  <span>模型服务商</span>
                  <select
                    value={settings.activeProvider}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        activeProvider: event.target.value as AIProviderId,
                      }))
                    }
                  >
                    {AI_PROVIDER_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="action-assistant-settings__field-heading">
                    <span>API Key</span>
                    {activePreset.apiKeyUrl ? (
                      <a
                        href={activePreset.apiKeyUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(event) => event.stopPropagation()}
                      >
                        获取 API Key
                        <ArrowUpRight aria-hidden="true" />
                      </a>
                    ) : null}
                  </span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={activeSetting.apiKey}
                    onChange={(event) =>
                      patchActiveSetting({ apiKey: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>API Base URL</span>
                  <input
                    value={activeSetting.baseUrl}
                    onChange={(event) =>
                      patchActiveSetting({ baseUrl: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>模型名称 / 接入点</span>
                  {activePreset.models.length ? (
                    <select
                      value={
                        activeUsesCatalogModel
                          ? activeSetting.model
                          : CUSTOM_MODEL_OPTION_VALUE
                      }
                      onChange={(event) =>
                        patchActiveSetting({
                          model:
                            event.target.value === CUSTOM_MODEL_OPTION_VALUE
                              ? ""
                              : event.target.value,
                        })
                      }
                    >
                      {activePreset.models.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                      <option value={CUSTOM_MODEL_OPTION_VALUE}>
                        自定义模型名称 / 接入点 ID
                      </option>
                    </select>
                  ) : null}
                  {!activeUsesCatalogModel ? (
                    <input
                      value={activeSetting.model}
                      placeholder={
                        settings.activeProvider === "doubao"
                          ? "填写模型名称或 ep-... 接入点 ID"
                          : "填写模型名称"
                      }
                      onChange={(event) =>
                        patchActiveSetting({ model: event.target.value })
                      }
                    />
                  ) : null}
                </label>
                <label className="action-assistant-settings__check">
                  <input
                    type="checkbox"
                    checked={settings.rememberKeys}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        rememberKeys: event.target.checked,
                      }))
                    }
                  />
                  <span>在当前浏览器保存密钥</span>
                </label>
                <div className="action-assistant-settings__divider" />
                <label className="action-assistant-settings__check">
                  <input
                    type="checkbox"
                    checked={settings.webSearch.enabled}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        webSearch: {
                          ...current.webSearch,
                          enabled: event.target.checked,
                        },
                      }))
                    }
                  />
                  <span>启用 Tavily 联网核验</span>
                </label>
                {settings.webSearch.enabled ? (
                  <label>
                    <span>Tavily API Key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={settings.webSearch.apiKey}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          webSearch: {
                            ...current.webSearch,
                            apiKey: event.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                ) : null}
                <div className="action-assistant-settings__note">
                  <LockKeyhole />
                  密钥不写入会议、通讯录或后台配置文件。
                </div>
                <button type="button" onClick={saveSettingsPanel}>
                  <KeyRound /> 保存设置
                </button>
              </section>
            ) : null}

            {historyOpen ? (
              <AssistantHistoryPanel
                onUndone={(entry) => {
                  void reloadAdminConfig();
                  setMessages((current) => [
                    ...current,
                    {
                      id: makeId("undo"),
                      role: "system",
                      text: `已撤销：${entry.summary}`,
                    },
                  ]);
                }}
                onError={(message) => {
                  setMessages((current) => [
                    ...current,
                    { id: makeId("undo-error"), role: "system", text: message },
                  ]);
                }}
              />
            ) : null}

            {hasWorkspace ? (
              <nav className="action-assistant-pane-tabs" aria-label="助手工作区">
                <button type="button" aria-pressed={activePane === "conversation"} onClick={() => setSelectedPane("conversation")}>对话</button>
                <button type="button" aria-pressed={activePane === "workspace"} onClick={() => setSelectedPane("workspace")}>核对与确认</button>
              </nav>
            ) : null}
            <div className="action-assistant-body" data-active-pane={activePane}>
              <div className="action-assistant-conversation">
            <div className="action-assistant-messages" aria-live="polite">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={`action-assistant-message-group is-${message.role}`}
                >
                  <div className={`action-assistant-message is-${message.role}`}>
                    {message.text}
                  </div>
                  {message.assumptions?.length ? (
                    <div className="action-assistant-assumptions">
                      <span><Info /> 本次采用</span>
                      <ul>
                        {message.assumptions.map((assumption) => (
                          <li key={assumption}>{assumption}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {message.link ? (
                    <button
                      type="button"
                      className="action-assistant-result-link"
                      onClick={() => router.push(message.link!.path)}
                    >
                      {message.link.label} <ArrowUpRight />
                    </button>
                  ) : null}
                  {message.sources?.length ? (
                    <div className="action-assistant-sources">
                      <span>联网依据 · 待人工核验</span>
                      <ul>
                        {message.sources.map((source) => (
                          <li key={source.url}>
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {source.title}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {message.suggestions?.length ? (
                    <div className="action-assistant-suggestions">
                      {message.suggestions.map((suggestion) => (
                        <button
                          type="button"
                          key={suggestion}
                          disabled={loading || executing}
                          onClick={() => suggestionClick(suggestion)}
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
              {loading ? (
                <div className="action-assistant-message is-assistant is-loading">
                  <LoaderCircle /> 正在结合前文和系统数据处理…
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <form
              className="action-assistant-composer"
              onSubmit={(event) => {
                event.preventDefault();
                void sendMessage();
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                hidden
                multiple
                accept={BUSINESS_DOCUMENT_ACCEPT}
                aria-label="添加会议相关资料"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? []);
                  event.target.value = "";
                  void addDocuments(files);
                }}
              />
              <div className="action-assistant-document-toolbar">
                <button type="button" disabled={readingDocuments || loading || executing}
                  onClick={() => fileInputRef.current?.click()}>
                  <Paperclip /> 添加资料
                </button>
                <span>会议方案、通知、名单均可</span>
              </div>
              {documents.length ? (
                <div className="action-assistant-documents">
                  {documents.map((document) => (
                    <div className="action-assistant-document" key={document.id}>
                      <details>
                        <summary><FileText /> <span>{document.name}</span><small>{document.content.length.toLocaleString()} 字</small></summary>
                        <pre>{document.content}</pre>
                      </details>
                      <button type="button" aria-label={`移除资料 ${document.name}`} disabled={loading || executing || readingDocuments}
                        onClick={() => setDocuments((current) => current.filter((item) => item.id !== document.id))}><X /></button>
                    </div>
                  ))}
                  <span>发送时将资料文字交给所选模型识别；确认前不会保存会议。</span>
                </div>
              ) : null}
              {readingDocuments ? <div className="action-assistant-document-progress" role="status"><LoaderCircle /> {documentProgress}</div> : null}
              {documentError ? <div className="action-assistant-document-error" role="alert">{documentError}</div> : null}
              <textarea
                rows={2}
                maxLength={4000}
                value={prompt}
                placeholder={
                  createDraft
                    ? "继续说也可以：改到后天下午三点，需要停车和工作餐"
                    : "直接说结果：查待办、改联系人、排名单、更新规则或创建会议"
                }
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
              />
              {loading ? (
                <button
                  type="button"
                  className="action-assistant-stop"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Square /> <span>停止</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={(!prompt.trim() && !documents.length) || executing || readingDocuments}
                >
                  <Send /> <span>{documents.length && !prompt.trim() ? "识别并填入会议草稿" : "发送"}</span>
                </button>
              )}
              <small>支持 Word、Excel、PDF、图片及文本，每份 ≤20 MB；Enter 发送，Shift + Enter 换行。</small>
              <small className="assistant-history-status" role="status" title={`${historyStatus} 附件与待确认草稿不随刷新恢复。`}>{historyStatus}</small>
            </form>
              </div>
            {hasWorkspace ? (
              <section className="action-assistant-preview">
                <div className="action-assistant-preview__heading">
                  <ShieldCheck />
                  <strong>
                    {createDraft ? "填写并确认会议" : "准备替你执行"}
                  </strong>
                  <span>
                    {createDraft
                      ? plan
                        ? "可创建"
                        : "填写中"
                      : `${plan?.actions.length ?? 0} 项`}
                  </span>
                </div>
                <div className="action-assistant-preview__body">
                {createDraft ? (
                  <AssistantMeetingOptionsTable
                    input={createDraft}
                    disabled={executing || loading || readingDocuments}
                    onPatch={patchCreateDraft}
                    meetingRooms={adminConfig.meetingRooms}
                  />
                ) : (<>
                  {pagePreviewAction && <div className="assistant-draft-preview">
                  <strong>{({ draft: "采用到草稿（尚未保存）", save: "保存到目标会议", download: "下载当前草稿", save_download: "保存并下载 Word" })[pagePreviewAction.mode]}</strong>
                  {planDocumentPreview ? <><p>请核对所有待确认内容；采用到草稿后仍需保存。</p><MeetingPlanPreview plan={planDocumentPreview}/></> : <pre>{JSON.stringify(pagePreviewAction.patch, null, 2)}</pre>}
                </div>}
                <AssistantOperationPreview
                    rows={(plan?.actions ?? []).map((action, index) =>
                      operationPreviewRow(
                        action,
                        index,
                        planMeetings,
                        planContacts,
                        planRosterWorkspace,
                        planPageWorkspace,
                      ),
                    )}
                  />
                </>)}
                {seatingPreviews.map((preview, index) => preview.plan ? <SeatingPlanReview key={index} plan={preview.plan} /> : <div className="action-assistant-preview__error" role="alert" key={index}>{preview.error}</div>)}
                </div>
                {createDraftError ? (
                  <div className="action-assistant-preview__error" role="alert">
                    {createDraftError}
                  </div>
                ) : null}
                <div className="action-assistant-preview__actions">
                  <button
                    type="button"
                    className="secondary"
                    onClick={
                      createDraft
                        ? cancelCreateDraft
                        : () => {
                            setPlan(null);
                            setPhase("idle");
                            setMessages((current) => [
                              ...current,
                              {
                                id: makeId("cancelled"),
                                role: "system",
                                text: "已取消执行；已理解的上下文仍保留，可以直接告诉我怎么改。",
                              },
                            ]);
                          }
                    }
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (plan) void runPlan(plan, true);
                    }}
                    disabled={executing || loading || readingDocuments || !plan || Boolean(createDraftError) || seatingPreviews.some((preview) => preview.error)}
                  >
                    {executing ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <CheckCircle2 />
                    )}
                    {executing
                      ? "正在执行"
                      : createDraft
                        ? plan
                          ? "确认创建会议"
                          : "请完善必填项"
                        : hasDestructivePlan
                          ? "确认删除"
                          : hasAdminPlan
                            ? "确认发布配置"
                            : "确认执行"}
                  </button>
                </div>
              </section>
            ) : null}

            </div>
            </div>
          </aside>
        </div>
      ) : null}
    </AssistantPortal>
  );
}

export function useActionAssistant() {
  const value = useContext(AssistantContext);
  if (!value) {
    throw new Error("useActionAssistant 必须在 ActionAssistantProvider 内使用");
  }
  return value;
}

export function ActionAssistantButton({
  compact = false,
  floating = false,
}: {
  compact?: boolean;
  floating?: boolean;
}) {
  const { openAssistant, isOpen } = useActionAssistant();

  if (floating && isOpen) return null;

  return (
    <button
      type="button"
      className={`action-assistant-launcher${compact ? " is-compact" : ""}${
        floating ? " is-floating" : ""
      }`}
      onClick={() => openAssistant()}
      aria-label="打开会务智能助手"
      aria-haspopup="dialog"
      aria-expanded={isOpen}
    >
      <Bot />
      <span>智能助手</span>
      {!compact ? <ChevronRight /> : null}
    </button>
  );
}
