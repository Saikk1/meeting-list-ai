import assert from "node:assert/strict";
import test from "node:test";
import { CONVERSATION_STORAGE_KEY, loadConversations, saveConversations, type ConversationStore } from "../app/lib/assistant-conversations";

function storage() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
const snapshot = (): ConversationStore => ({ version: 1, activeId: "b", open: true, sessions: [
  { id: "a", title: "会议筹备", updatedAt: 1, messages: [{ id: "m1", role: "user", text: "根据讨论整理会议背景" }, { id: "m2", role: "assistant", text: "背景初稿", assumptions: ["地点待确认"] }] },
  { id: "b", title: "人员整理", updatedAt: 2, messages: [{ id: "m3", role: "user", text: "处理另一份名单" }] },
] });

test("refresh restores every conversation independently, its full messages and the active conversation", () => {
  const disk = storage(), original = snapshot();
  assert.equal(saveConversations(disk, original), "");
  assert.deepEqual(loadConversations(disk), { store: original, error: "" });
  const updated = snapshot(); updated.sessions[0].updatedAt = 3;
  updated.sessions[0].messages.push({ id: "m4", role: "user", text: "接着修改上一版" });
  assert.equal(saveConversations(disk, updated), "");
  const restored = loadConversations(disk).store!;
  assert.equal(restored.sessions[0].messages.at(-1)?.text, "接着修改上一版");
  assert.deepEqual(restored.sessions[1], original.sessions[1]);
});
test("serialized history excludes configuration, attachments, drafts and executable pending actions", () => {
  const disk = storage(), original = snapshot();
  Object.assign(original.sessions[0], { apiKey: "fixture-private-key", documents: ["fixture-file"], memory: { newMeetingDraft: "fixture-draft" }, plan: "fixture-action" });
  Object.assign(original.sessions[0].messages[0], { apiKey: "fixture-secret" });
  assert.equal(saveConversations(disk, original), "");
  const raw = disk.data.get(CONVERSATION_STORAGE_KEY)!;
  for (const forbidden of ["fixture-private-key", "fixture-file", "fixture-draft", "fixture-action", "fixture-secret"]) assert.ok(!raw.includes(forbidden));
});
test("saving one browser tab preserves other tabs' sessions and newer history", () => {
  const disk = storage(), latest = snapshot(); latest.sessions[0].updatedAt = 20;
  latest.sessions[0].messages.push({ id: "new", role: "assistant", text: "较新回复" });
  saveConversations(disk, latest);
  saveConversations(disk, { ...snapshot(), sessions: [snapshot().sessions[0]], activeId: "a" });
  const restored = loadConversations(disk).store!;
  assert.equal(restored.sessions.length, 2);
  assert.equal(restored.sessions[0].messages.at(-1)?.text, "较新回复");
});
test("corrupt history is preserved and quota failures are reported without silently dropping old sessions", () => {
  const disk = storage(); disk.setItem(CONVERSATION_STORAGE_KEY, "{invalid");
  assert.ok(loadConversations(disk).error);
  assert.ok(saveConversations(disk, snapshot()));
  assert.equal(disk.getItem(CONVERSATION_STORAGE_KEY), "{invalid");
  const full = { getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); } };
  assert.match(saveConversations(full, snapshot()), /未能保存/);
});
