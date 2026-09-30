import type { AdminConfig } from "./admin-config";
import type { AssistantExecutionResult } from "./assistant-actions";
import type { AssistantPlan } from "./assistant-contract";
import {
  listContacts,
  replaceContacts,
  type ContactRecord,
} from "./contacts";
import {
  loadMeetingStoreSnapshot,
  replaceMeetingSnapshot,
  type MeetingRecord,
} from "./meeting-data";

const STORAGE_KEY = "meeting-assistant:operation-history:v1";
const CHANGE_EVENT = "meeting-assistant:operation-history-change";
const MAX_HISTORY = 30;
export const EMPTY_OPERATION_HISTORY: AssistantOperationHistoryEntry[] = [];

type RecordChange<T> = {
  id: string;
  before: T | null;
  afterUpdatedAt: string | null;
};

export type AssistantOperationHistoryEntry = {
  id: string;
  createdAt: string;
  summary: string;
  actionTypes: string[];
  executedActions: number;
  meetingChanges: Array<RecordChange<MeetingRecord>>;
  contactChanges: Array<RecordChange<ContactRecord>>;
  adminChange: {
    beforeRevision: number;
    beforeConfig: AdminConfig;
    afterRevision: number;
  } | null;
  reversible: boolean;
  limitation: string;
  status: "active" | "undone" | "undo_failed";
  undoneAt: string | null;
};

export type AssistantOperationSnapshot = {
  meetings: MeetingRecord[];
  contacts: ContactRecord[];
  adminRevision: number;
  adminConfig: AdminConfig;
};

let cachedRaw: string | null | undefined;
let cachedHistory = EMPTY_OPERATION_HISTORY;

function historyStorage() {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isHistoryEntry(value: unknown): value is AssistantOperationHistoryEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<AssistantOperationHistoryEntry>;
  return (
    typeof item.id === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.summary === "string" &&
    Array.isArray(item.actionTypes) &&
    Array.isArray(item.meetingChanges) &&
    Array.isArray(item.contactChanges) &&
    typeof item.reversible === "boolean" &&
    ["active", "undone", "undo_failed"].includes(item.status ?? "")
  );
}

export function loadAssistantOperationHistory() {
  const storage = historyStorage();
  if (!storage) return EMPTY_OPERATION_HISTORY;
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedHistory;
  cachedRaw = raw;
  try {
    const parsed = JSON.parse(raw || "[]") as unknown;
    cachedHistory = Array.isArray(parsed)
      ? parsed.filter(isHistoryEntry).slice(0, MAX_HISTORY)
      : EMPTY_OPERATION_HISTORY;
  } catch {
    cachedHistory = EMPTY_OPERATION_HISTORY;
  }
  return cachedHistory;
}

function persistHistory(entries: AssistantOperationHistoryEntry[]) {
  const storage = historyStorage();
  if (!storage) return;
  let next = entries.slice(0, MAX_HISTORY);
  while (next.length) {
    try {
      const raw = JSON.stringify(next);
      storage.setItem(STORAGE_KEY, raw);
      cachedRaw = raw;
      cachedHistory = next;
      window.dispatchEvent(new Event(CHANGE_EVENT));
      return;
    } catch {
      next = next.slice(0, -1);
    }
  }
}

export function subscribeAssistantOperationHistory(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  const storageListener = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    cachedRaw = undefined;
    callback();
  };
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", storageListener);
  };
}

function meetingMutation(actionType: string) {
  return actionType.startsWith("meeting.") && actionType !== "meeting.roster.export";
}

function contactMutation(actionType: string) {
  return actionType === "contact.create" || actionType === "contact.update" || actionType === "contact.delete";
}

export function buildAssistantOperationHistoryEntry(
  plan: AssistantPlan,
  result: AssistantExecutionResult,
  before: AssistantOperationSnapshot,
  after: Pick<AssistantOperationSnapshot, "meetings" | "contacts">,
): AssistantOperationHistoryEntry | null {
  const actionTypes = plan.actions.map((action) => action.type);
  const hasWorkspaceAction = actionTypes.some((type) => type.startsWith("roster.workspace."));
  const hasFileExport = actionTypes.includes("meeting.roster.export") || actionTypes.includes("roster.workspace.export");
  const meetingIds = new Set<string>([
    ...plan.actions.filter((action) => "meetingId" in action && meetingMutation(action.type)).map((action) => (action as { meetingId: string }).meetingId),
    ...result.createdMeetingIds,
    ...result.duplicatedMeetingIds,
    ...result.purgedMeetingIds,
  ]);
  const contactIds = new Set<string>([
    ...plan.actions.filter((action) => "contactId" in action && contactMutation(action.type)).map((action) => (action as { contactId: string }).contactId),
    ...result.createdContactIds,
    ...result.updatedContactIds,
    ...result.deletedContactIds,
  ]);
  const beforeMeetings = new Map(before.meetings.map((item) => [item.id, item]));
  const afterMeetings = new Map(after.meetings.map((item) => [item.id, item]));
  const beforeContacts = new Map(before.contacts.map((item) => [item.id, item]));
  const afterContacts = new Map(after.contacts.map((item) => [item.id, item]));
  const adminChange = result.adminUpdated && result.adminRevision !== null
    ? { beforeRevision: before.adminRevision, beforeConfig: before.adminConfig, afterRevision: result.adminRevision }
    : null;
  const meetingChanges = [...meetingIds].map((id) => ({
    id,
    before: beforeMeetings.get(id) ?? null,
    afterUpdatedAt: afterMeetings.get(id)?.updatedAt ?? null,
  }));
  const contactChanges = [...contactIds].map((id) => ({
    id,
    before: beforeContacts.get(id) ?? null,
    afterUpdatedAt: afterContacts.get(id)?.updatedAt ?? null,
  }));
  const hasTrackedChange = meetingChanges.length > 0 || contactChanges.length > 0 || Boolean(adminChange);
  if (!hasTrackedChange && !hasWorkspaceAction && !hasFileExport) return null;

  return {
    id: `operation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    summary: plan.summary || `执行 ${result.executedActions} 项操作`,
    actionTypes,
    executedActions: result.executedActions,
    meetingChanges,
    contactChanges,
    adminChange,
    reversible: hasTrackedChange && !hasWorkspaceAction,
    limitation: hasWorkspaceAction
      ? "名单工作区操作暂不能整批撤销"
      : hasFileExport
        ? "数据可以撤销，但已经下载的文件不会被收回"
        : "",
    status: "active",
    undoneAt: null,
  };
}

export function recordAssistantOperation(entry: AssistantOperationHistoryEntry) {
  persistHistory([entry, ...loadAssistantOperationHistory()]);
}

async function listAllContacts() {
  const contacts: ContactRecord[] = [];
  let offset = 0;
  while (contacts.length < 20_000) {
    const page = await listContacts({ limit: 200, offset });
    contacts.push(...page.contacts);
    offset += page.contacts.length;
    if (!page.contacts.length || offset >= page.total) break;
  }
  return contacts;
}

async function currentAdminSnapshot() {
  const response = await fetch("/api/admin/config", { cache: "no-store" });
  if (!response.ok) throw new Error("后台配置读取失败，暂时不能撤销");
  return (await response.json()) as { revision: number; config: AdminConfig };
}

function assertRecordVersions<T extends { id: string; updatedAt: string }>(
  current: T[],
  changes: Array<RecordChange<T>>,
  label: string,
) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  for (const change of changes) {
    const item = currentById.get(change.id);
    if (change.afterUpdatedAt === null ? Boolean(item) : item?.updatedAt !== change.afterUpdatedAt) {
      throw new Error(`${label}已在该操作后继续发生变化，为避免覆盖新内容，本次撤销已停止。`);
    }
  }
}

function restoreChangedRecords<T extends { id: string }>(current: T[], changes: Array<RecordChange<T>>) {
  const changedIds = new Set(changes.map((change) => change.id));
  return [
    ...changes.map((change) => change.before).filter((item): item is T => Boolean(item)),
    ...current.filter((item) => !changedIds.has(item.id)),
  ];
}

function updateHistoryStatus(id: string, status: AssistantOperationHistoryEntry["status"]) {
  const timestamp = status === "undone" ? new Date().toISOString() : null;
  persistHistory(loadAssistantOperationHistory().map((entry) => entry.id === id ? { ...entry, status, undoneAt: timestamp } : entry));
}

export async function undoAssistantOperation(entry: AssistantOperationHistoryEntry) {
  if (!entry.reversible || entry.status !== "active") {
    throw new Error(entry.status === "undone" ? "这条操作已经撤销过了" : entry.limitation || "这条操作不能自动撤销");
  }
  try {
    const currentMeetings = loadMeetingStoreSnapshot().all;
    const currentContacts = entry.contactChanges.length ? await listAllContacts() : [];
    const admin = entry.adminChange ? await currentAdminSnapshot() : null;
    assertRecordVersions(currentMeetings, entry.meetingChanges, "会议数据");
    assertRecordVersions(currentContacts, entry.contactChanges, "通讯录");
    if (entry.adminChange && admin?.revision !== entry.adminChange.afterRevision) {
      throw new Error("后台配置已在该操作后继续发布新版本，为避免覆盖新配置，本次撤销已停止。");
    }

    if (entry.meetingChanges.length) {
      await replaceMeetingSnapshot(restoreChangedRecords(currentMeetings, entry.meetingChanges));
    }
    if (entry.contactChanges.length) {
      await replaceContacts(restoreChangedRecords(currentContacts, entry.contactChanges));
    }
    if (entry.adminChange) {
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: entry.adminChange.afterRevision,
          summary: `撤销助手操作：${entry.summary}`,
          config: entry.adminChange.beforeConfig,
        }),
      });
      if (!response.ok) throw new Error("后台配置撤销失败，请刷新后重试");
    }
    updateHistoryStatus(entry.id, "undone");
  } catch (error) {
    updateHistoryStatus(entry.id, "undo_failed");
    throw error;
  }
}
