import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createIntegrationApi } from "../scripts/integration-api.mjs";
import { createLocalIntegrationProvider } from "../scripts/integration-provider.mjs";
import { createLocalContactStore, createLocalMeetingStore } from "../scripts/local-store.mjs";

const token = "integration-test-token-32-characters-minimum";
const timestamp = "2026-09-29T08:00:00.000Z";
function meeting(id, extra = {}) {
  return {
    id, title: "OA 对接会议", date: "2026-09-30", startTime: "09:00", endTime: "10:00",
    location: "第一会议室", organizer: "测试单位", owner: "会务组", attendeeEstimate: 10,
    rosterRequired: true, afternoonMeeting: false, mealType: "none", alcoholRequired: false,
    parkingRequired: false, vehicleCount: 0, publicityRequired: false, reimbursementRequired: false,
    presentationRequired: true, welcomeScreenRequired: false, roomSize: "small",
    createdAt: timestamp, updatedAt: timestamp, notes: "内部备注不属于集成会议 DTO",
    tasks: [{ id: "task-one", templateId: "task-template", title: "准备材料", description: "核对材料",
      phase: "before", group: "筹备", status: "doing", owner: "会务组", dueDate: "2026-09-30",
      note: "正在办理", attachments: [{ name: "内部附件.txt", size: 1, addedAt: timestamp }] }],
    attendees: [{ id: "attendee-one", name: "张三", unit: "测试单位", department: "办公室", title: "主任",
      source: "原始名单不输出" }],
    ...extra,
  };
}

function call(handler, path = "/capabilities", init = {}) {
  return handler(new Request(`http://127.0.0.1:3000/api/integrations/v1${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
  }));
}

test("integration is opt-in and authenticates before reading the provider", async () => {
  const provider = new Proxy({}, { get() { assert.fail("provider must not be read"); } });
  assert.throws(() => createIntegrationApi({ provider, token: "short" }), /集成令牌/);
  const disabled = createIntegrationApi({ provider });
  assert.equal((await call(disabled)).status, 503);
  const handler = createIntegrationApi({ provider, token });
  for (const Authorization of ["", "Bearer wrong", `Basic ${token}`]) {
    const response = await call(handler, "/meetings", { headers: { Authorization } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    const payload = await response.json();
    assert.equal(payload.error.code, "UNAUTHORIZED");
    assert.equal(payload.requestId, response.headers.get("x-request-id"));
  }
  assert.equal((await call(handler, "/meetings", { headers: { Origin: "https://oa.example.com" } })).status, 403);
  assert.equal((await call(handler, "/meetings", { method: "PUT", body: "{}" })).status, 405);
  assert.equal(await handler(new Request("http://127.0.0.1:3000/api/meetings")), null);
  const version = await handler(new Request("http://127.0.0.1:3000/api/integrations/v2/meetings", {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(version.status, 404);
  const head = await call(handler, "/capabilities", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal((await (await call(handler)).json()).data.writeSupported, false);
});

test("integration reads persisted business data with bounded pages and explicit DTOs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "oa-integration-"));
  try {
    const meetingsStore = createLocalMeetingStore({ dataDirectory: directory });
    const contactsStore = createLocalContactStore({ dataDirectory: directory });
    await meetingsStore.replaceAll({ meetings: [meeting("meeting-b"), meeting("meeting-a"),
      meeting("meeting-archived", { archivedAt: timestamp }), meeting("meeting-deleted", { deletedAt: timestamp })] });
    const contact = await contactsStore.create({ name: "张三", unit: "测试单位", department: "办公室", title: "主任" });
    const before = await meetingsStore.getSnapshot();
    const handler = createIntegrationApi({ token,
      provider: createLocalIntegrationProvider({ meetingsStore, contactsStore }) });
    const first = await (await call(handler, "/meetings?limit=1")).json();
    assert.equal(first.apiVersion, "1");
    assert.equal(first.data.total, 2);
    assert.equal(first.data.items[0].id, "meeting-a");
    assert.equal(first.data.nextOffset, 1);
    assert.ok(first.data.snapshotAt);
    assert.equal(first.data.items[0].notes, undefined);
    assert.equal(first.data.items[0].tasks, undefined);
    assert.equal((await (await call(handler, "/meetings?offset=1&limit=1")).json()).data.nextOffset, null);
    const deleted = await (await call(handler, "/meetings?status=deleted")).json();
    assert.equal(deleted.data.items[0].status, "deleted");
    assert.equal((await (await call(handler, "/meetings?status=all")).json()).data.total, 4);
    const detail = await (await call(handler, "/meetings/meeting-a")).json();
    assert.equal(detail.data.title, "OA 对接会议");
    const tasks = await (await call(handler, "/meetings/meeting-a/tasks")).json();
    assert.equal(tasks.data.items[0].status, "doing");
    assert.equal(tasks.data.items[0].meetingId, "meeting-a");
    assert.equal(tasks.data.items[0].attachments, undefined);
    const attendees = await (await call(handler, "/meetings/meeting-a/attendees")).json();
    assert.equal(attendees.data.items[0].name, "张三");
    assert.equal(attendees.data.items[0].source, undefined);
    const contacts = await (await call(handler, "/contacts?q=张三&limit=1")).json();
    assert.equal(contacts.data.items[0].id, contact.id);
    assert.equal(contacts.data.items[0].identityAliases, undefined);
    for (const path of ["/meetings/missing-meeting", "/meetings/missing-meeting/tasks", "/unknown"]) {
      assert.equal((await call(handler, path)).status, 404);
    }
    for (const path of ["/meetings?limit=1abc", "/meetings?limit=201", "/meetings?offset=-1",
      "/meetings?offset=9007199254740992", "/meetings?status=unknown", "/meetings?limit=1&limit=2",
      "/meetings?unknown=yes", "/contacts?q=" + "a".repeat(101), "/meetings/meeting-a?limit=1",
      "/meetings/%ZZ", "/meetings/a%2Fb"]) {
      assert.equal((await call(handler, path)).status, 400, path);
    }
    assert.deepEqual(await meetingsStore.getSnapshot(), before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("provider can be substituted and storage failure details stay private", async () => {
  const handler = createIntegrationApi({ token, provider: {
    async listMeetings(options) {
      assert.equal(options.status, "active");
      return { items: [{ id: "oa-meeting" }], total: 1, limit: options.limit, offset: 0,
        nextOffset: null, snapshotAt: null };
    },
    async getMeeting() { throw new Error("private file path and secret"); },
  } });
  assert.equal((await (await call(handler, "/meetings")).json()).data.items[0].id, "oa-meeting");
  const response = await call(handler, "/meetings/meeting-one");
  assert.equal(response.status, 500);
  assert.equal((await response.json()).error.message, "集成数据服务暂时不可用");
});
