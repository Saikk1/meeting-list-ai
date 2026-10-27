import {
  compileAssistantAgentResponse,
} from "../../../lib/assistant-agent-compiler";
import {
  EMPTY_ASSISTANT_WORKING_MEMORY,
  parseAssistantConversation,
  parseAssistantWorkingMemory,
} from "../../../lib/assistant-agent-contract";
import { buildAssistantAgentSystemPrompt } from "../../../lib/assistant-agent-prompt";
import { parseAssistantDocuments } from "../../../lib/assistant-documents";
import type { MeetingInput } from "../../../lib/meeting-data";
import {
  callJsonModel,
  gatewayErrorMessage,
  isLoopbackRequest,
  isSameOrigin,
  ModelGatewayError,
  modelResponseContent,
  noStoreJson,
  parseModelJson,
  resolveModelConfig,
  type IncomingModelConfig,
  validateModelConfig,
} from "../../_shared/model-gateway";

const MAX_CONTEXT_BYTES = 180_000;

const RESPONSE_TEMPLATE = {
  reply: "给用户的自然语言答复",
  mode: "answer | clarification | preview",
  assumptions: ["采用后台默认值时逐项说明"],
  actions: [],
  memory: {
    activeIntent:
      "none | create_meeting | update_meeting | manage_tasks | manage_roster | manage_contacts | manage_admin | research | delete_record | navigate",
    newMeetingDraft: null,
    selectedMeetingId: null,
  },
  suggestions: ["可选的下一步短句"],
};

const ACTION_CATALOGUE = `
- page.workspace.apply: {"type":"page.workspace.apply","workspaceId":"来自 pageWorkspace.id","expectedRevision":来自 pageWorkspace.revision 的整数,"mode":"draft|save|download|save_download","patch":{只含 pageWorkspace.editableFields 开放字段；数组使用保留未修改条目的完整数组；仅保存/下载时可为空}}。必须独占计划。
- meeting.create_from_draft: {"type":"meeting.create_from_draft","draft":{部分会议字段}}
- meeting.update_fields: {"type":"meeting.update_fields","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","patch":{允许修改的会议字段}}
- meeting.delete: {"type":"meeting.delete","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.duplicate: {"type":"meeting.duplicate","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.archive: {"type":"meeting.archive","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.restore_archived: {"type":"meeting.restore_archived","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.restore_deleted: {"type":"meeting.restore_deleted","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.purge: {"type":"meeting.purge","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- meeting.task.update: {"type":"meeting.task.update","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","taskId":"来自上下文","patch":{"status|owner|dueDate|note":"值"}}
- meeting.attendee.add: {"type":"meeting.attendee.add","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","attendee":{"name":"必填","unit":"可空","department":"可空","title":"可空"}}
- meeting.attendee.update: {"type":"meeting.attendee.update","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","attendeeId":"来自上下文","patch":{"name?":"","unit?":"","department?":"","title?":""}}
- meeting.attendee.add_from_contact: {"type":"meeting.attendee.add_from_contact","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","contactId":"来自上下文","expectedContactUpdatedAt":"来自上下文"}
- meeting.attendee.remove: {"type":"meeting.attendee.remove","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","attendeeId":"来自上下文"}
- meeting.roster.sort: {"type":"meeting.roster.sort","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","rosterRules":{完整的后台 rosterRules 配置}}
- meeting.seating.generate: {"type":"meeting.seating.generate","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","expectedConfigRevision":当前adminRevision,"options":{"template":"podium-auto|podium-single|podium-double|podium-wide|table|table-five|round","hostCompany":"本公司全称","door":"top|bottom","rowCapacity":9,"closeThreshold":50,"anchorMode":"host-first|rank-first","tableCenter":"auto|single|double","moderatorId":"主持人ID或空字符串"},"participants":[{"id":"人员ID","name":"姓名","unit":"单位","title":"职务","grade":"职级或空字符串","weight":null,"party":"auto|host|guest"}]} participants 可省略，省略时使用已保存座次名单或会议参会人员。
- meeting.roster.export: {"type":"meeting.roster.export","meetingId":"来自上下文","expectedUpdatedAt":"来自上下文","rosterRules":{完整的后台 rosterRules 配置}}
- roster.workspace.set_text: {"type":"roster.workspace.set_text","expectedRevision":来自 rosterWorkspace 的整数版本,"text":"替换后的完整原始文本"}
- roster.workspace.process: {"type":"roster.workspace.process","expectedRevision":来自 rosterWorkspace 的整数版本}
- roster.workspace.record.update: {"type":"roster.workspace.record.update","expectedRevision":来自 rosterWorkspace 的整数版本,"recordId":"来自 rosterWorkspace","patch":{需要修改的记录字段}}
- roster.workspace.record.add: {"type":"roster.workspace.record.add","expectedRevision":来自 rosterWorkspace 的整数版本,"record":{新增记录}}
- roster.workspace.record.remove: {"type":"roster.workspace.record.remove","expectedRevision":来自 rosterWorkspace 的整数版本,"recordId":"来自 rosterWorkspace"}
- roster.workspace.alias.apply: {"type":"roster.workspace.alias.apply","expectedRevision":来自 rosterWorkspace 的整数版本,"aliasId":"来自 rosterWorkspace"}
- roster.workspace.confirm: {"type":"roster.workspace.confirm","expectedRevision":来自 rosterWorkspace 的整数版本}
- roster.workspace.analyze_ranking: {"type":"roster.workspace.analyze_ranking","expectedRevision":来自 rosterWorkspace 的整数版本}
- roster.workspace.enrich_person: {"type":"roster.workspace.enrich_person","expectedRevision":来自 rosterWorkspace 的整数版本,"recordId":"来自 rosterWorkspace"}
- roster.workspace.save_to_meeting: {"type":"roster.workspace.save_to_meeting","expectedRevision":来自 rosterWorkspace 的整数版本}
- roster.workspace.export: {"type":"roster.workspace.export","expectedRevision":来自 rosterWorkspace 的整数版本}
- contact.create: {"type":"contact.create","input":{"name":"","unit":"","department":"","title":""}}
- contact.update: {"type":"contact.update","contactId":"来自上下文","expectedUpdatedAt":"来自上下文","patch":{需要修改的联系人字段}}
- contact.delete: {"type":"contact.delete","contactId":"来自上下文","expectedUpdatedAt":"来自上下文"}
- admin.config.patch: {"type":"admin.config.patch","expectedRevision":来自上下文的整数版本,"summary":"1至100字变更说明","patch":{后台配置的严格深层局部修改，数组字段使用完整数组替换}}
- navigate: {"type":"navigate","destination":"dashboard|meetings|tasks|new_meeting|admin|admin_overview|admin_organization|admin_rooms|admin_contacts|admin_checklist|admin_aliases|admin_roster|meeting_detail|meeting_seating","meetingId":"meeting_detail / meeting_seating 需要"}
- roster.open: {"type":"roster.open","meetingId":"可选，必须来自上下文"}
- contacts.open: {"type":"contacts.open"}`;

function limitedContext(value: unknown) {
  const raw = JSON.stringify(value ?? {});
  if (raw.length > MAX_CONTEXT_BYTES) {
    throw new Error("当前系统上下文过大，请缩小会议或通讯录范围后重试");
  }
  return JSON.parse(raw) as Record<string, unknown>;
}

function defaultMeetingInput(context: Record<string, unknown>) {
  const input = context.defaultMeetingInput;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("助手缺少后台会议默认配置，请刷新页面后重试");
  }
  return input as MeetingInput;
}

function rosterWorkspaceState(context: Record<string, unknown>) {
  const page = context.page;
  const workspace = context.rosterWorkspace;
  if (
    !page ||
    typeof page !== "object" ||
    Array.isArray(page) ||
    (page as Record<string, unknown>).kind !== "roster" ||
    !workspace ||
    typeof workspace !== "object" ||
    Array.isArray(workspace)
  ) {
    return { available: false, revision: undefined };
  }
  const value = workspace as Record<string, unknown>;
  const available =
    value.available === true &&
    typeof value.revision === "number" &&
    Number.isInteger(value.revision);
  return {
    available,
    revision: available ? (value.revision as number) : undefined,
  };
}

function systemPrompt() {
  return buildAssistantAgentSystemPrompt({
    productName: "会务智办",
    availableActions: ACTION_CATALOGUE,
    responseJsonTemplate: RESPONSE_TEMPLATE,
  });
}

async function requestModelResponse(
  config: ReturnType<typeof resolveModelConfig>,
  input: Record<string, unknown>,
  repair?: { invalidContent: string; validationError: string },
) {
  const userPayload = repair
    ? {
        ...input,
        repair: {
          instruction:
            "上一份 JSON 未通过宿主安全协议。仅修正协议错误并输出完整 JSON，不要改变用户意图。",
          validationError: repair.validationError,
          invalidResponse: repair.invalidContent.slice(0, 16_000),
        },
      }
    : input;
  const result = await callJsonModel(
    config,
    [
      { role: "system", content: systemPrompt() },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
    12_000,
  );
  if (!result.response.ok) {
    throw new ModelGatewayError(
      gatewayErrorMessage(
        result.body,
        `${config.providerLabel} API 返回错误（${result.response.status}）`,
      ),
      502,
    );
  }
  const content = modelResponseContent(result.body);
  if (!content) throw new ModelGatewayError("模型没有返回会务处理结果", 502);
  return content;
}

export async function POST(request: Request) {
  if (!isLoopbackRequest(request)) {
    return noStoreJson({ error: "智能助手仅支持本机运行版" }, { status: 403 });
  }
  if (!isSameOrigin(request)) {
    return noStoreJson({ error: "请求来源无效" }, { status: 403 });
  }

  try {
    const payload = (await request.json()) as {
      conversation?: unknown;
      memory?: unknown;
      context?: unknown;
      config?: IncomingModelConfig;
      documents?: unknown;
    };
    let documents;
    try {
      documents = parseAssistantDocuments(payload.documents);
    } catch (error) {
      return noStoreJson({ error: error instanceof Error ? error.message : "资料格式无效" }, { status: 400 });
    }
    const conversation = parseAssistantConversation(payload.conversation ?? []);
    if (!conversation.length || conversation.at(-1)?.role !== "user") {
      return noStoreJson(
        { error: "会话必须以当前用户消息结束" },
        { status: 400 },
      );
    }
    const memory = parseAssistantWorkingMemory(
      payload.memory ?? EMPTY_ASSISTANT_WORKING_MEMORY,
    );
    const context = limitedContext(payload.context);
    const defaults = defaultMeetingInput(context);
    const rosterWorkspace = rosterWorkspaceState(context);
    const config = resolveModelConfig(payload.config);
    const configError = validateModelConfig(config);
    if (configError) {
      return noStoreJson(
        { error: `${configError}。请在助手设置中完成配置。` },
        { status: 503 },
      );
    }

    const modelInput = {
      currentMessage: conversation.at(-1)?.content,
      conversation,
      workingMemory: memory,
      systemContext: context,
      documents,
    };
    let content = await requestModelResponse(config, modelInput);
    let compiled;
    try {
      compiled = compileAssistantAgentResponse(parseModelJson(content), {
        defaultMeetingInput: defaults,
        previousMemory: memory,
        currentMessage: conversation.at(-1)?.content,
        rosterWorkspaceAvailable: rosterWorkspace.available,
        rosterWorkspaceRevision: rosterWorkspace.revision,
        documentMeetingDraft: documents.length > 0,
        pageWorkspace: context.pageWorkspace,
      });
    } catch (firstError) {
      content = await requestModelResponse(config, modelInput, {
        invalidContent: content,
        validationError:
          firstError instanceof Error ? firstError.message : "响应格式无效",
      });
      try {
        compiled = compileAssistantAgentResponse(parseModelJson(content), {
          defaultMeetingInput: defaults,
          previousMemory: memory,
          currentMessage: conversation.at(-1)?.content,
          rosterWorkspaceAvailable: rosterWorkspace.available,
          rosterWorkspaceRevision: rosterWorkspace.revision,
          documentMeetingDraft: documents.length > 0,
        pageWorkspace: context.pageWorkspace,
        });
      } catch (secondError) {
        return noStoreJson(
          {
            error:
              secondError instanceof Error
                ? `模型结果未通过安全校验：${secondError.message}`
                : "模型结果未通过安全校验",
          },
          { status: 422 },
        );
      }
    }

    return noStoreJson({
      provider: config.providerLabel,
      model: config.model,
      response: compiled.response,
      memory: compiled.memory,
      plan: compiled.plan,
    });
  } catch (error) {
    if (error instanceof ModelGatewayError) {
      return noStoreJson({ error: error.message }, { status: error.status });
    }
    return noStoreJson(
      { error: error instanceof Error ? error.message : "智能助手处理失败" },
      { status: 500 },
    );
  }
}
