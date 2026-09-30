import assert from "node:assert/strict";
import test from "node:test";
import { cloneAdminConfig, DEFAULT_ADMIN_CONFIG } from "../app/lib/admin-config";
import { buildAssistantOperationHistoryEntry } from "../app/lib/assistant-operation-history";
import { createMeeting, type MeetingInput } from "../app/lib/meeting-data";
import type { AssistantExecutionResult } from "../app/lib/assistant-actions";
import type { AssistantPlan } from "../app/lib/assistant-contract";

const input: MeetingInput = {
  title: "测试会议", date: "2030-08-20", startTime: "09:00", location: "第一会议室",
  organizer: "综合管理部", owner: "会务组", attendeeEstimate: 8,
  afternoonMeeting: false, mealType: "none", alcoholRequired: false,
  parkingRequired: false, vehicleCount: 0, publicityRequired: false,
  reimbursementRequired: false, presentationRequired: true,
  welcomeScreenRequired: false, roomSize: "small",
};

function result(patch: Partial<AssistantExecutionResult> = {}): AssistantExecutionResult {
  return {
    executedActions: 1, createdMeetingIds: [], updatedMeetingIds: [], deletedMeetingIds: [],
    duplicatedMeetingIds: [], archivedMeetingIds: [], restoredMeetingIds: [], purgedMeetingIds: [],
    sortedMeetingIds: [], exportedRosterFiles: [], createdContactIds: [], updatedContactIds: [],
    deletedContactIds: [], adminUpdated: false, adminRevision: null,
    rosterWorkspaceResult: null, navigationPath: null, ...patch,
  };
}

test("operation history captures before state and post-write revision", () => {
  const beforeMeeting = createMeeting(input);
  beforeMeeting.id = "meeting-1";
  beforeMeeting.updatedAt = "2030-08-01T00:00:00.000Z";
  const afterMeeting = { ...beforeMeeting, owner: "张三", updatedAt: "2030-08-02T00:00:00.000Z" };
  const plan: AssistantPlan = {
    schemaVersion: 1,
    summary: "把负责人改成张三",
    clarification: null,
    warnings: [],
    actions: [{
      type: "meeting.update_fields", meetingId: beforeMeeting.id,
      expectedUpdatedAt: beforeMeeting.updatedAt, patch: { owner: "张三" },
    }],
  };
  const entry = buildAssistantOperationHistoryEntry(
    plan,
    result({ updatedMeetingIds: [beforeMeeting.id] }),
    { meetings: [beforeMeeting], contacts: [], adminRevision: 1, adminConfig: cloneAdminConfig(DEFAULT_ADMIN_CONFIG) },
    { meetings: [afterMeeting], contacts: [] },
  );
  assert.ok(entry);
  assert.equal(entry.reversible, true);
  assert.equal(entry.meetingChanges[0].before?.owner, "会务组");
  assert.equal(entry.meetingChanges[0].afterUpdatedAt, "2030-08-02T00:00:00.000Z");
});

test("roster workspace history is retained but marked non-reversible", () => {
  const plan = {
    schemaVersion: 1,
    summary: "处理名单工作区",
    clarification: null,
    warnings: [],
    actions: [{ type: "roster.workspace.process", expectedRevision: 2 }],
  } as AssistantPlan;
  const entry = buildAssistantOperationHistoryEntry(
    plan,
    result(),
    { meetings: [], contacts: [], adminRevision: 1, adminConfig: cloneAdminConfig(DEFAULT_ADMIN_CONFIG) },
    { meetings: [], contacts: [] },
  );
  assert.ok(entry);
  assert.equal(entry.reversible, false);
  assert.match(entry.limitation, /名单工作区/);
});
