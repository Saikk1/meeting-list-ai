export type AssistantMessage = {
  id: string; role: "user" | "assistant" | "system"; text: string;
  assumptions?: string[]; suggestions?: string[];
  link?: { label: string; path: string };
  sources?: Array<{ title: string; url: string }>;
};
export type SavedConversation = { id: string; title: string; messages: AssistantMessage[]; updatedAt: number };
export type ConversationStore = { version: 1; activeId: string; open: boolean; sessions: SavedConversation[] };
export const CONVERSATION_STORAGE_KEY = "meeting-list-ai:assistant-conversations:v1";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid conversation text");
  return value;
}
function strings(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Invalid conversation list");
  return value.map(string);
}
function message(value: unknown): AssistantMessage {
  if (!value || typeof value !== "object") throw new Error("Invalid message");
  const v = value as Record<string, unknown>;
  if (!["user", "assistant", "system"].includes(String(v.role))) throw new Error("Invalid role");
  // Whitelist display history only. Never serialize keys, files, pending actions or drafts.
  const result: AssistantMessage = { id: string(v.id), role: v.role as AssistantMessage["role"], text: string(v.text) };
  if (v.assumptions !== undefined) result.assumptions = strings(v.assumptions);
  if (v.suggestions !== undefined) result.suggestions = strings(v.suggestions);
  if (v.link && typeof v.link === "object") {
    const link = v.link as Record<string, unknown>, path = string(link.path);
    if (path.startsWith("/") && !path.startsWith("//")) result.link = { path, label: string(link.label) };
  }
  if (v.sources !== undefined) {
    if (!Array.isArray(v.sources)) throw new Error("Invalid sources");
    result.sources = v.sources.flatMap((source) => {
      if (!source || typeof source !== "object") throw new Error("Invalid source");
      const url = string(source.url), title = string(source.title);
      return /^https?:\/\//i.test(url) ? [{ url, title }] : [];
    });
  }
  return result;
}
export function parseConversationStore(value: unknown): ConversationStore {
  if (!value || typeof value !== "object") throw new Error("Invalid conversation store");
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.sessions) || !v.sessions.length) throw new Error("Invalid store version");
  const ids = new Set<string>();
  const sessions = v.sessions.map((item): SavedConversation => {
    if (!item || typeof item !== "object" || !Array.isArray(item.messages)) throw new Error("Invalid session");
    const id = string(item.id);
    if (!id || ids.has(id) || !Number.isSafeInteger(item.updatedAt) || item.updatedAt < 0) throw new Error("Invalid session identity");
    ids.add(id);
    const messages = item.messages.map(message);
    if (new Set(messages.map((m: AssistantMessage) => m.id)).size !== messages.length) throw new Error("Duplicate messages");
    return { id, title: string(item.title), messages, updatedAt: item.updatedAt };
  });
  const activeId = typeof v.activeId === "string" && ids.has(v.activeId) ? v.activeId : sessions[0].id;
  return { version: 1, activeId, open: v.open === true, sessions };
}
export function loadConversations(storage: Storage): { store: ConversationStore | null; error: string } {
  try {
    const raw = storage.getItem(CONVERSATION_STORAGE_KEY);
    return { store: raw ? parseConversationStore(JSON.parse(raw)) : null, error: "" };
  } catch {
    return { store: null, error: "本机聊天历史读取失败，原记录未覆盖；当前对话仍可继续。" };
  }
}
export function saveConversations(storage: Storage, value: ConversationStore): string {
  try {
    const incoming = parseConversationStore(value);
    const previous = loadConversations(storage);
    if (previous.error) return previous.error;
    // Preserve other browser tabs' sessions; changing the active tab must not erase them.
    const merged = new Map(previous.store?.sessions.map((s) => [s.id, s]));
    for (const session of incoming.sessions) {
      if ((merged.get(session.id)?.updatedAt ?? -1) <= session.updatedAt) merged.set(session.id, session);
    }
    storage.setItem(CONVERSATION_STORAGE_KEY, JSON.stringify({ ...incoming, sessions: [...merged.values()] }));
    return "";
  } catch {
    return "聊天记录未能保存到本机，可能是存储空间不足或浏览器限制。当前记录仍在页面中，请勿刷新。";
  }
}
