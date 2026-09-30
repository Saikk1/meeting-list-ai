import {
  ASSISTANT_PLAN_SCHEMA_VERSION,
  parseAssistantPlan,
  type AssistantAction,
  type AssistantPlan,
} from "./assistant-contract";
import {
  AssistantAgentValidationError,
  EMPTY_ASSISTANT_WORKING_MEMORY,
  parseAssistantAgentResponse,
  parseAssistantWorkingMemory,
  type AssistantAgentResponse,
  type AssistantNewMeetingDraft,
  type AssistantWorkingMemory,
} from "./assistant-agent-contract";
import type { MeetingInput } from "./meeting-data";

export type AssistantAgentCompileOptions = {
  defaultMeetingInput: MeetingInput;
  previousMemory?: AssistantWorkingMemory;
  /** The latest user message lets the deterministic host enforce intent boundaries. */
  currentMessage?: string;
  rosterWorkspaceAvailable?: boolean;
  rosterWorkspaceRevision?: number;
  /** File-driven reports must not silently invent missing date/time defaults. */
  documentMeetingDraft?: boolean;
};

export type CompiledAssistantAgentResponse = {
  response: AssistantAgentResponse;
  memory: AssistantWorkingMemory;
  plan: AssistantPlan | null;
};

const NON_CREATE_INTENT_LABELS = {
  update_meeting: "已有会议",
  manage_tasks: "会务任务",
  manage_roster: "参会名单",
  manage_contacts: "通讯录",
  manage_admin: "后台设置",
  research: "信息查询",
  delete_record: "删除操作",
  navigate: "页面导航",
} as const;

type ExplicitNonCreateIntent = keyof typeof NON_CREATE_INTENT_LABELS;

/**
 * Recognize only explicit module switches. It is intentionally conservative:
 * ordinary follow-up text must not accidentally destroy an in-progress draft.
 */
export function inferExplicitAssistantIntent(
  message: string | undefined,
): AssistantWorkingMemory["activeIntent"] | null {
  const text = message?.trim();
  if (!text) return null;

  if (/删除|删掉|移除|清空/.test(text)) return "delete_record";
  if (/通讯录|联系人|联系人员/.test(text)) return "manage_contacts";
  if (/(?:生成|编排|调整|排好|排一下|打开|重排).{0,12}(?:座次|座位)|(?:座次|座位).{0,12}(?:编排|调整|生成|重排)/.test(text)) return "update_meeting";
  if (/参会名单|人员名单|名单整理|名册|座次排序|名单排序/.test(text)) {
    return "manage_roster";
  }
  if (/后台(?:管理|设置)?|系统设置|默认配置|配置规则|管理配置/.test(text)) {
    return "manage_admin";
  }
  if (/任务清单|核对清单|会务任务|待办|核对项|任务状态/.test(text)) {
    return "manage_tasks";
  }
  if (/查询|查一下|查找|搜索|联网查|联网搜|研究一下|有哪些|是什么/.test(text)) {
    return "research";
  }
  if (/(?:新建|创建|安排|预定|预约|新增)(?:一场|一个|新的)?[^，。；]{0,12}会议/.test(text)) {
    return "create_meeting";
  }
  if (/(?:修改|更新|调整|变更)[^，。；]{0,16}会议/.test(text)) {
    return "update_meeting";
  }
  if (/打开|跳转|进入/.test(text)) return "navigate";
  return null;
}

function isMeetingCreateAction(
  action: AssistantAgentResponse["actions"][number],
) {
  return (
    action.type === "meeting.create_from_draft" ||
    action.type === "meeting.create"
  );
}

function isRosterWorkspaceAction(
  action: AssistantAgentResponse["actions"][number],
) {
  return action.type.startsWith("roster.workspace.");
}

function rosterWorkspaceRevision(
  action: AssistantAgentResponse["actions"][number],
) {
  if (!isRosterWorkspaceAction(action)) return null;
  const value = (action as unknown as { expectedRevision?: unknown })
    .expectedRevision;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isRosterWorkspaceRequest(message: string | undefined) {
  const text = message?.trim();
  if (!text) return false;
  return /名单工作区|当前记录|这条记录|第(?:\d+|[一二三四五六七八九十]+)(?:条记录|条|行)|原始(?:名单|文本)|处理这份名单|整理这份名单|(?:名单|工作区).{0,12}(?:修改|改成|新增|添加|删除|移除|排序|导出)|(?:修改|改成|新增|添加|删除|移除).{0,12}(?:名单|记录)|重新提取|应用别名|确认整理|分析排名|按职务排序|按单位排序|补全.{0,8}职务|保存到会议|导出(?:名单|表格|Excel)/i.test(
    text,
  );
}

function isMisdirectedWorkspaceMutation(
  action: AssistantAgentResponse["actions"][number],
) {
  return (
    action.type === "meeting.create" ||
    action.type === "meeting.create_from_draft" ||
    action.type === "meeting.update_fields" ||
    action.type === "meeting.roster.sort" ||
    action.type === "meeting.seating.generate" ||
    action.type.startsWith("meeting.attendee.") ||
    action.type.startsWith("contact.")
  );
}

function boundaryFallbackReply(
  intent: AssistantWorkingMemory["activeIntent"],
) {
  const label =
    intent in NON_CREATE_INTENT_LABELS
      ? NON_CREATE_INTENT_LABELS[intent as ExplicitNonCreateIntent]
      : "当前事项";
  return `已切换到${label}处理，不会继续创建上一场会议。请重试刚才的要求。`;
}

function validatedDefaultMeetingInput(value: MeetingInput): MeetingInput {
  const plan = parseAssistantPlan({
    schemaVersion: ASSISTANT_PLAN_SCHEMA_VERSION,
    summary: "校验默认会议配置",
    clarification: null,
    warnings: [],
    actions: [{ type: "meeting.create", input: value }],
  });
  const action = plan.actions[0];
  if (action.type !== "meeting.create") {
    throw new Error("默认会议配置校验失败");
  }
  return action.input;
}

function hasCreateCore(draft: AssistantNewMeetingDraft | null) {
  return Boolean(draft?.title && draft.date && draft.startTime);
}

function isNonBlockingCreateClarification(reply: string) {
  if (/哪一(?:个|场)|哪位|同名|冲突|多个候选|无法确定|请从.+选择/.test(reply)) {
    return false;
  }
  return /组织者|负责人|设备|投屏|欢迎屏|停车|茶歇|用餐|报销|酒水|宣传|修改当前|创建.*全新|是否.*新建/.test(
    reply,
  );
}

function meetingPreviewReply(
  draft: AssistantNewMeetingDraft,
  defaults: MeetingInput,
) {
  const time = draft.endTime
    ? `${draft.startTime}－${draft.endTime}`
    : draft.startTime;
  const location = draft.location || defaults.location || "地点待定";
  const people = draft.attendeeEstimate ?? defaults.attendeeEstimate;
  return `已整理好“${draft.title}”：${draft.date} ${time}，${location}，预计${people}人。未提及事项按后台默认配置处理。`;
}

function planSummary(reply: string) {
  return [...reply].slice(0, 1_000).join("");
}

/**
 * Preserve a draft while the user remains in the create-meeting intent. Moving
 * to another intent is an explicit boundary and clears stale draft state.
 */
export function mergeAssistantWorkingMemory(
  previousValue: AssistantWorkingMemory,
  nextValue: AssistantWorkingMemory,
): AssistantWorkingMemory {
  const previous = parseAssistantWorkingMemory(previousValue, "previousMemory");
  const next = parseAssistantWorkingMemory(nextValue, "nextMemory");
  if (
    next.activeIntent === "none" &&
    previous.activeIntent === "create_meeting"
  ) {
    return {
      ...previous,
      newMeetingDraft: {
        ...(previous.newMeetingDraft ?? {}),
        ...(next.newMeetingDraft ?? {}),
      },
    };
  }
  if (next.activeIntent !== "create_meeting") {
    return {
      ...next,
      newMeetingDraft: null,
    };
  }
  return {
    ...next,
    newMeetingDraft: {
      ...(previous.activeIntent === "create_meeting"
        ? previous.newMeetingDraft ?? {}
        : {}),
      ...(next.newMeetingDraft ?? {}),
    },
  };
}

export function compileAssistantAgentResponse(
  value: unknown,
  options: AssistantAgentCompileOptions,
): CompiledAssistantAgentResponse {
  const parsedResponse = parseAssistantAgentResponse(value);
  const previous = options.previousMemory
    ? parseAssistantWorkingMemory(options.previousMemory, "previousMemory")
    : EMPTY_ASSISTANT_WORKING_MEMORY;
  const inferredIntent = inferExplicitAssistantIntent(options.currentMessage);
  const workspaceLanguage = isRosterWorkspaceRequest(options.currentMessage);
  const isExplicitOtherModule =
    inferredIntent !== null &&
    inferredIntent !== "manage_roster" &&
    inferredIntent !== "research" &&
    !(inferredIntent === "delete_record" && workspaceLanguage);
  const rosterWorkspaceTurn = Boolean(
    options.rosterWorkspaceAvailable &&
      !isExplicitOtherModule &&
      (workspaceLanguage ||
        inferredIntent === "manage_roster" ||
        (previous.activeIntent === "manage_roster" && inferredIntent === null)),
  );
  const explicitIntent = rosterWorkspaceTurn && inferredIntent !== "delete_record"
    ? "manage_roster"
    : inferredIntent;
  const requestedMemory: AssistantWorkingMemory = explicitIntent
    ? {
        ...parsedResponse.memory,
        activeIntent: explicitIntent,
        ...(explicitIntent === "create_meeting"
          ? {}
          : { newMeetingDraft: null }),
      }
    : parsedResponse.memory;
  let memory = mergeAssistantWorkingMemory(previous, requestedMemory);
  const defaults = validatedDefaultMeetingInput(options.defaultMeetingInput);

  const crossedCreateBoundary = memory.activeIntent !== "create_meeting";
  let filteredActions = crossedCreateBoundary
    ? parsedResponse.actions.filter((action) => !isMeetingCreateAction(action))
    : parsedResponse.actions;
  if (rosterWorkspaceTurn) {
    filteredActions = filteredActions.filter(
      (action) => !isMisdirectedWorkspaceMutation(action),
    );
  }

  const requestedWorkspaceActions = parsedResponse.actions.filter(
    isRosterWorkspaceAction,
  );
  if (requestedWorkspaceActions.length && !options.rosterWorkspaceAvailable) {
    filteredActions = [{ type: "roster.open" }];
    memory = {
      ...memory,
      activeIntent: "manage_roster",
      newMeetingDraft: null,
    };
  }
  if (
    requestedWorkspaceActions.length &&
    options.rosterWorkspaceAvailable &&
    Number.isInteger(options.rosterWorkspaceRevision)
  ) {
    for (const action of requestedWorkspaceActions) {
      if (rosterWorkspaceRevision(action) !== options.rosterWorkspaceRevision) {
        throw new AssistantAgentValidationError(
          "名单工作区操作必须原样使用当前 snapshot 的 revision",
          "response.actions",
        );
      }
    }
  }
  const discardedStaleCreate =
    filteredActions.length !== parsedResponse.actions.length;
  const openedUnavailableWorkspace =
    requestedWorkspaceActions.length > 0 &&
    !options.rosterWorkspaceAvailable;

  const boundaryResponse: AssistantAgentResponse = {
    ...parsedResponse,
    memory,
    actions: filteredActions,
    ...(openedUnavailableWorkspace
      ? {
          mode: "answer" as const,
          reply:
            "当前页面没有可用的名单治理工作区，我先为您打开名单治理页面。",
          assumptions: [],
        }
      : {}),
    ...(discardedStaleCreate && !filteredActions.length
      ? {
          mode: "answer" as const,
          reply: boundaryFallbackReply(memory.activeIntent),
          assumptions: [],
        }
      : {}),
  };

  // A model may still mechanically ask for organizer, equipment or parking
  // after it has already extracted the actual meeting. The deterministic host
  // turns that non-blocking question into the ready-to-confirm preview the
  // user asked for, while keeping all writes behind the confirmation gate.
  const response: AssistantAgentResponse =
    boundaryResponse.mode === "clarification" &&
    memory.activeIntent === "create_meeting" &&
    hasCreateCore(memory.newMeetingDraft) &&
    isNonBlockingCreateClarification(boundaryResponse.reply)
      ? {
          ...boundaryResponse,
          reply: meetingPreviewReply(memory.newMeetingDraft!, defaults),
          mode: "preview",
          assumptions: boundaryResponse.assumptions.length
            ? boundaryResponse.assumptions
            : ["组织者、负责人和未明确的会务选项沿用后台默认配置"],
          actions: [
            { type: "meeting.create_from_draft", draft: {} },
          ],
        }
      : boundaryResponse;

  let waitingForMeetingTitle = false;
  const actions: AssistantAction[] = response.actions.flatMap((action) => {
    if (action.type !== "meeting.create_from_draft") return [action];
    const draft: AssistantNewMeetingDraft = {
      ...(memory.newMeetingDraft ?? {}),
      ...action.draft,
    };
    memory = {
      ...memory,
      activeIntent: "create_meeting",
      newMeetingDraft: draft,
    };
    if (!draft.title?.trim() || (options.documentMeetingDraft && (!draft.date || !draft.startTime))) {
      waitingForMeetingTitle = true;
      return [];
    }
    return [{
      type: "meeting.create",
      input: {
        ...defaults,
        ...draft,
        afternoonMeeting: draft.afternoonMeeting ?? (draft.startTime ?? defaults.startTime) >= "12:00",
        ...(defaults.meetingRoomId && draft.location !== undefined && draft.location !== defaults.location && !draft.meetingRoomId
          ? { meetingRoomId: "", roomRequirements: draft.roomRequirements ?? "" }
          : {}),
      },
    }];
  });

  const normalizedResponse: AssistantAgentResponse = {
    ...response,
    ...(waitingForMeetingTitle
      ? {
          mode: "clarification" as const,
          reply:
            options.documentMeetingDraft
              ? "资料中的会议名称、日期或开始时间尚未齐全，请在会议草稿中补充；其他已识别信息已保留。"
              : "已打开一份新会议草稿。请填写会议名称，其他内容可以直接在表格中选择，也可以继续用自然语言补充。",
          actions: [],
        }
      : {}),
    memory,
  };
  if (!actions.length) {
    return { response: normalizedResponse, memory, plan: null };
  }

  const plan = parseAssistantPlan({
    schemaVersion: ASSISTANT_PLAN_SCHEMA_VERSION,
    summary: planSummary(response.reply),
    clarification: null,
    warnings: response.assumptions,
    actions,
  });
  return { response: normalizedResponse, memory, plan };
}
