export type WorkspaceMode = "draft" | "save" | "download" | "save_download";
export type AssistantWorkspaceSnapshot = {
  id: string; path: string; label: string; kind: string; meetingId?: string;
  revision: number; dirty: boolean; data: Record<string, unknown>;
  editableFields: string[]; modes: WorkspaceMode[];
};
export type AssistantWorkspaceAction = {
  type: "page.workspace.apply"; workspaceId: string; expectedRevision: number;
  mode: WorkspaceMode; patch: Record<string, unknown>;
};
export type WorkspaceReply = string | { message: string; createdMeetingId: string };
type WorkspaceHandler = (patch: Record<string, unknown>, mode: WorkspaceMode) => WorkspaceReply | Promise<WorkspaceReply>;
type Entry = { snapshot: AssistantWorkspaceSnapshot; apply: WorkspaceHandler };
const entries = new Map<string, Entry>();
const revisions = new Map<string, { signature: string; revision: number }>();
const inFlight = new Set<string>();
const listeners = new Set<() => void>();
let revision = 0;
let allSnapshots: AssistantWorkspaceSnapshot[] = [];
const empty: AssistantWorkspaceSnapshot[] = [];
function changed() { allSnapshots = [...entries.values()].map((e) => e.snapshot); for (const f of listeners) f(); }
export function registerAssistantWorkspace(snapshot: Omit<AssistantWorkspaceSnapshot, "revision">, apply: WorkspaceHandler) {
  const signature = JSON.stringify(snapshot);
  const previous = revisions.get(snapshot.id);
  const nextRevision = previous?.signature === signature ? previous.revision : ++revision;
  revisions.set(snapshot.id, { signature, revision: nextRevision });
  const entry = { snapshot: { ...snapshot, revision: nextRevision }, apply };
  entries.set(snapshot.id, entry); changed();
  return () => { if (entries.get(snapshot.id) === entry) { entries.delete(snapshot.id); changed(); } };
}
export const subscribeAssistantWorkspaces = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const getAssistantWorkspaces = () => allSnapshots;
export const getServerAssistantWorkspaces = () => empty;
export function getAssistantWorkspace(id: string) { return entries.get(id)?.snapshot ?? null; }
export async function applyAssistantWorkspace(action: AssistantWorkspaceAction) {
  const entry = entries.get(action.workspaceId);
  if (!entry || entry.snapshot.revision !== action.expectedRevision) throw new Error("目标页面已切换、关闭或内容发生变化，请返回原页面重新生成预览；当前修改已保留。");
  if (!entry.snapshot.modes.includes(action.mode)) throw new Error("当前页面不支持此操作");
  if (Object.keys(action.patch).some((key) => !entry.snapshot.editableFields.includes(key))) throw new Error("助手试图修改未开放的页面字段");
  if (inFlight.has(action.workspaceId)) throw new Error("此工作区正在处理另一项操作，请稍后重试");
  inFlight.add(action.workspaceId);
  try {
    const reply = await entry.apply(action.patch, action.mode);
    return { message: typeof reply === "string" ? reply : reply.message, createdMeetingId: typeof reply === "string" ? undefined : reply.createdMeetingId, meetingId: entry.snapshot.meetingId, persisted: action.mode === "save" || action.mode === "save_download" };
  } finally { inFlight.delete(action.workspaceId); }
}
export function parseWorkspaceAction(value: Record<string, unknown>): AssistantWorkspaceAction {
  const allowed = ["type", "workspaceId", "expectedRevision", "mode", "patch"];
  if (Object.keys(value).some((k) => !allowed.includes(k)) || allowed.some((k) => !Object.hasOwn(value, k))) throw new Error("页面操作字段无效");
  if (typeof value.workspaceId !== "string" || !value.workspaceId || value.workspaceId.length > 300 || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 0) throw new Error("页面操作目标或版本无效");
  if (!["draft", "save", "download", "save_download"].includes(String(value.mode))) throw new Error("页面操作模式无效");
  const patch = value.patch;
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.getPrototypeOf(patch) !== Object.prototype || JSON.stringify(patch).length > 100000) throw new Error("页面修改内容无效或过长");
  function safe(v: unknown, depth: number) {
    if (depth > 12) throw new Error("页面修改嵌套过深");
    if (v && typeof v === "object") for (const [k, item] of Object.entries(v)) {
      if (["__proto__", "constructor", "prototype"].includes(k)) throw new Error("页面修改包含非法字段");
      safe(item, depth + 1);
    }
  }
  safe(patch, 0);
  return value as AssistantWorkspaceAction;
}
