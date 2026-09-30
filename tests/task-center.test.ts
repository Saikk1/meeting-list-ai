import assert from "node:assert/strict";
import test from "node:test";
import {
  buildTaskCenterItems,
  filterTaskCenterItems,
  summarizeTaskCenter,
} from "../app/lib/task-center";
import { createMeeting, type MeetingInput } from "../app/lib/meeting-data";

const input: MeetingInput = {
  title: "全流程协调会",
  date: "2030-08-20",
  startTime: "09:00",
  location: "第一会议室",
  organizer: "综合管理部",
  owner: "会务组",
  attendeeEstimate: 10,
  afternoonMeeting: false,
  mealType: "none",
  alcoholRequired: false,
  parkingRequired: false,
  vehicleCount: 0,
  publicityRequired: false,
  reimbursementRequired: false,
  presentationRequired: true,
  welcomeScreenRequired: false,
  roomSize: "small",
};

test("task center classifies, summarizes and filters tasks across meetings", () => {
  const meeting = createMeeting(input);
  meeting.tasks = [
    { id: "overdue", templateId: "a", title: "确认座次", description: "", phase: "before", group: "名单", status: "todo", owner: "张三", dueDate: "2030-08-09", note: "", attachments: [] },
    { id: "today", templateId: "b", title: "测试设备", description: "", phase: "before", group: "会场", status: "doing", owner: "李四", dueDate: "2030-08-10", note: "", attachments: [] },
    { id: "blocked", templateId: "c", title: "确认车辆", description: "", phase: "during", group: "接待", status: "blocked", owner: "张三", dueDate: "2030-08-14", note: "", attachments: [] },
    { id: "done", templateId: "d", title: "预定会议室", description: "", phase: "before", group: "会场", status: "done", owner: "李四", dueDate: "2030-08-08", note: "", attachments: [] },
  ];
  const items = buildTaskCenterItems([meeting], "2030-08-10");
  assert.deepEqual(items.map(({ task }) => task.id), ["overdue", "today", "blocked", "done"]);
  assert.deepEqual(summarizeTaskCenter(items, "2030-08-10"), {
    open: 3,
    overdue: 1,
    today: 1,
    week: 2,
    blocked: 1,
    completed: 1,
  });
  assert.deepEqual(filterTaskCenterItems(items, { filter: "blocked" }, "2030-08-10").map(({ task }) => task.id), ["blocked"]);
  assert.deepEqual(filterTaskCenterItems(items, { filter: "open", query: "设备", owner: "李四", phase: "before" }, "2030-08-10").map(({ task }) => task.id), ["today"]);
});

test("task center excludes archived and deleted meetings", () => {
  const active = createMeeting(input);
  const archived = { ...createMeeting({ ...input, title: "归档会议" }), archivedAt: new Date().toISOString() };
  const deleted = { ...createMeeting({ ...input, title: "删除会议" }), deletedAt: new Date().toISOString() };
  assert.equal(buildTaskCenterItems([active, archived, deleted], "2030-08-10").length, active.tasks.length);
});
