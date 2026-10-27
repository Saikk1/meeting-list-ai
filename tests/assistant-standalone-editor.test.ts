import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { MeetingAttendeeEditor } from "../app/components/meeting-attendee-editor";
import { AssistantMeetingOptionsTable } from "../app/components/assistant-meeting-options-table";
import { getAssistantWorkspaces } from "../app/lib/assistant-workspace";
import { useWorkspaceLocation } from "../app/components/workspace-tabs";
import { AssistantConversationHistory } from "../app/components/assistant-conversation-history";

test("conversation history shows all conversations with message previews, not just the active conversation", () => {
  const html = renderToString(createElement(AssistantConversationHistory, {
    sessions: [
      { id: "a", title: "会议安排", updatedAt: 1, messages: [{ id: "m-a", role: "user", text: "安排项目交流" }] },
      { id: "b", title: "人员名单", updatedAt: 2, messages: [{ id: "m-b", role: "assistant", text: "名单整理完成" }] },
    ], activeId: "a", onSelect: () => {}, onBack: () => {},
  }));
  for (const text of ["会议安排", "人员名单", "安排项目交流", "名单整理完成", "搜索对话历史"]) assert.ok(html.includes(text));
});

test("business-only workspace hook still rejects a missing provider", () => {
  function RequiresTab() { useWorkspaceLocation(); return null; }
  assert.throws(() => renderToString(createElement(RequiresTab)), /Workspace location is unavailable/);
});

test("assistant attendee editor renders outside any business workspace provider", () => {
  const before = getAssistantWorkspaces();
  const html = renderToString(createElement(MeetingAttendeeEditor, {
    value: [{ id: "standalone-person", name: "示例甲", unit: "示例单位", department: "", title: "" }],
    onChange: () => assert.fail("Rendering must not change the draft"),
  }));
  assert.ok(html.includes("示例甲"));
  assert.deepEqual(getAssistantWorkspaces(), before);
});

test("assistant meeting drafts with participants render on successive responses without tab context", () => {
  for (const title of ["示例交流会", "修改后的示例交流会"]) {
    const html = renderToString(createElement(AssistantMeetingOptionsTable, {
      input: { title, attendees: [{ name: "示例乙", unit: "示例单位", department: "", title: "" }] },
      onPatch: () => assert.fail("Rendering must not write meeting data"),
    }));
    assert.ok(html.includes(title));
    assert.ok(html.includes("示例乙"));
  }
});
