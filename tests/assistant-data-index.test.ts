import assert from "node:assert/strict";
import test from "node:test";
import { buildAssistantFullDataContext } from "../app/lib/assistant-data-index";
import { createMeeting, type MeetingInput } from "../app/lib/meeting-data";
import type { ContactRecord } from "../app/lib/contacts";

const input: MeetingInput = {
  title: "市场协调会", date: "2030-08-20", startTime: "09:00", location: "小会议室",
  organizer: "综合管理部", owner: "王主任", attendeeEstimate: 8,
  afternoonMeeting: false, mealType: "none", alcoholRequired: false,
  parkingRequired: false, vehicleCount: 0, publicityRequired: false,
  reimbursementRequired: false, presentationRequired: true,
  welcomeScreenRequired: false, roomSize: "small",
};

test("assistant full-data query searches every meeting and task before bounding results", () => {
  const meetings = Array.from({ length: 140 }, (_, index) => {
    const meeting = createMeeting({ ...input, title: `项目协调会${index}` });
    meeting.id = `meeting-${index}`;
    meeting.tasks = [{
      id: `task-${index}`, templateId: "task", title: `保障事项${index}`,
      description: "", phase: "before", group: "会场", status: "todo",
      owner: "会务组", dueDate: "2030-08-09", note: "", attachments: [],
    }];
    return meeting;
  });
  const result = buildAssistantFullDataContext("列出所有逾期任务", meetings, [], "2030-08-10");
  assert.equal(result.searchedEntireStore, true);
  assert.equal(result.scope.meetingTotal, 140);
  assert.equal(result.scope.taskTotal, 140);
  assert.equal(result.taskResults.matchedTotal, 140);
  assert.equal(result.taskResults.returned, 120);
  assert.equal(result.taskResults.truncated, true);
});

test("assistant full-data query matches contacts by unit and department", () => {
  const contact: ContactRecord = {
    id: "contact-1", name: "张三", unit: "宁波低空经济发展有限公司",
    department: "市场经营部", title: "经理", createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-02T00:00:00.000Z", meetingCount: 1,
    meetingIds: ["meeting-1"], lastMeetingId: "meeting-1", lastMeetingTitle: "协调会", lastMeetingDate: "2030-01-01",
  };
  const result = buildAssistantFullDataContext("通讯录里市场经营部有哪些人", [], [contact], "2030-08-10");
  assert.equal(result.scope.contactTotal, 1);
  assert.equal(result.contactResults.matchedTotal, 1);
  assert.equal(result.contactResults.items[0].name, "张三");
});
