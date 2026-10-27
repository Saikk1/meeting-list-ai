export type AssistantIntentBoundary =
  | "create_meeting"
  | "update_meeting"
  | "manage_tasks"
  | "manage_roster"
  | "manage_contacts"
  | "manage_admin"
  | "research"
  | "delete_record"
  | "navigate";

function containsNegatedCreate(text: string) {
  return /(?:不要|不用|取消|别)(?:再|继续)?(?:新建|创建|安排|预定|预订|预约)/.test(
    text,
  );
}

/**
 * Detect only explicit module boundaries. Detailed intent understanding stays
 * with the model, while this small deterministic guard prevents a stale
 * meeting draft from swallowing a later contacts/admin/roster request.
 */
export function detectAssistantIntentBoundary(
  input: string,
  currentIntent = "none",
): AssistantIntentBoundary | null {
  const text = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!text) return null;
  if (/会议方案|会议背景|会议议程|编排议程|起草背景/.test(text)) return "update_meeting";

  if (/(?:通讯录|联系人|联系人员|人员档案|常用人员)/.test(text)) {
    return "manage_contacts";
  }
  if (
    /(?:后台(?:管理|设置)?|管理中心|系统(?:设置|配置)|默认(?:值|配置)|会议规则|停车(?:车辆)?上限|商务餐.{0,8}(?:上限|下限|标准)|加水间隔|风险提醒|清单模板|单位别名|名称字典|排序规则|输出字段|工作表名称|配置版本|恢复默认)/.test(
      text,
    )
  ) {
    return "manage_admin";
  }
  if (
    /(?:参会名单|人员名单|名单治理|名单智理|名单整理|名单排序|导出名单|导出\s*Excel|职务补全|单位归并|同单位|座次|当前记录|这条记录|第(?:\d+|[一二三四五六七八九十]+)(?:条|行)|原始文本|重新提取|应用别名)/i.test(
      text,
    )
  ) {
    return "manage_roster";
  }
  if (/(?:流程清单|核对清单|会务清单|会务待办|待办中心|任务中心|任务工作台|待办任务|未完成任务|逾期任务|任务状态|SOP)/i.test(text)) {
    return "manage_tasks";
  }

  if (
    !containsNegatedCreate(text) &&
    /(?:新建|创建|安排|预定|预订|预约).{0,10}(?:会议|例会)|(?:会议|例会).{0,10}(?:新建|创建|安排|预定|预订|预约)/.test(
      text,
    )
  ) {
    return "create_meeting";
  }

  if (/(?:删除|删掉|清空).{0,20}(?:会议|例会|联系人|通讯录|名单|记录)/.test(text)) {
    return "delete_record";
  }

  if (
    /(?:删除|取消|修改|调整|更改|改掉|重命名|复制|归档|恢复|移入回收站).{0,16}(?:会议|例会|[\u4e00-\u9fff]{1,12}会)|(?:会议|例会|[\u4e00-\u9fff]{1,12}会).{0,16}(?:删除|取消|修改|调整|更改|改掉|重命名|复制|归档|恢复|移入回收站)/.test(
      text,
    )
  ) {
    return "update_meeting";
  }

  if (
    currentIntent !== "create_meeting" &&
    /^(?:打开|进入|跳转到|带我去|查看)(?:一下)?/.test(text)
  ) {
    return "navigate";
  }
  if (
    /^(?:帮我)?(?:看看|查一下|查询|统计|汇总|告诉我|搜索|联网核验)|(?:有哪些|有多少|是否有|谁还|哪些还)/.test(
      text,
    )
  ) {
    return "research";
  }
  return null;
}

export function leavesMeetingDraft(
  input: string,
  currentIntent: string,
) {
  const next = detectAssistantIntentBoundary(input, currentIntent);
  return Boolean(
    currentIntent === "create_meeting" &&
      next &&
      next !== "create_meeting",
  );
}
