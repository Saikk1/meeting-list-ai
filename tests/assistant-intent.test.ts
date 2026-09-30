import assert from "node:assert/strict";
import test from "node:test";

import {
  detectAssistantIntentBoundary,
  leavesMeetingDraft,
} from "../app/lib/assistant-intent";

test("an explicit contacts request leaves a stale meeting draft", () => {
  const text =
    "通讯录里，把低空公司的单位改成宁波经济发展有限公司，而且市场部改成市场经营部";
  assert.equal(
    detectAssistantIntentBoundary(text, "create_meeting"),
    "manage_contacts",
  );
  assert.equal(leavesMeetingDraft(text, "create_meeting"), true);
});

test("meeting field corrections keep the active create draft", () => {
  assert.equal(
    detectAssistantIntentBoundary("地点改成三楼会议室，时间改到下午三点", "create_meeting"),
    null,
  );
  assert.equal(
    leavesMeetingDraft("地点改成三楼会议室，时间改到下午三点", "create_meeting"),
    false,
  );
});

test("meeting lifecycle commands leave a stale create draft", () => {
  assert.equal(
    detectAssistantIntentBoundary("把上周的交流会归档", "create_meeting"),
    "update_meeting",
  );
  assert.equal(
    detectAssistantIntentBoundary("恢复回收站里的项目会", "create_meeting"),
    "update_meeting",
  );
  assert.equal(
    detectAssistantIntentBoundary("复制明天的部门例会", "create_meeting"),
    "update_meeting",
  );
});

test("major system modules have deterministic boundaries", () => {
  assert.equal(
    detectAssistantIntentBoundary("把停车上限改成六辆", "none"),
    "manage_admin",
  );
  assert.equal(
    detectAssistantIntentBoundary("把参会名单按职务重新排序", "none"),
    "manage_roster",
  );
  assert.equal(
    detectAssistantIntentBoundary("把第三行的单位改成宁波经发", "create_meeting"),
    "manage_roster",
  );
  assert.equal(
    detectAssistantIntentBoundary("看看未完成任务", "none"),
    "manage_tasks",
  );
  assert.equal(
    detectAssistantIntentBoundary("打开会务待办中心", "create_meeting"),
    "manage_tasks",
  );
  assert.equal(
    detectAssistantIntentBoundary("看看最近有哪些会议", "create_meeting"),
    "research",
  );
  assert.equal(
    detectAssistantIntentBoundary("删除昨天的部门例会", "create_meeting"),
    "delete_record",
  );
});
