import { parseAssistantDraftAttendees } from "./assistant-contract";
import type { MeetingAttendee } from "./meeting-data";

export function workspaceAttendees(value: unknown): MeetingAttendee[] {
  if (!Array.isArray(value)) throw new Error("参会人员必须是数组");
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Object.keys(item).some((key) => !["id", "name", "unit", "department", "title", "source"].includes(key))) throw new Error("参会人员字段无效");
    const parsed = parseAssistantDraftAttendees([{ name: item.name, unit: item.unit, department: item.department, title: item.title }], "页面参会人员")[0];
    const id = item.id || `attendee-${crypto.randomUUID()}`;
    if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]{1,199}$/.test(id) || ids.has(id)) throw new Error("参会人员标识无效或重复");
    ids.add(id);
    return { ...parsed, id, source: typeof item.source === "string" ? item.source.slice(0, 500) : "智能助手录入" };
  });
}
