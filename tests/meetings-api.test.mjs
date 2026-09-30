import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { handleLocalMeetingsApi } from "../scripts/local-api.mjs";
import { createLocalMeetingStore } from "../scripts/local-store.mjs";

function makeMeeting(overrides = {}) {
  const timestamp = "2026-08-20T08:00:00.000Z";
  return {
    id: "meeting-storage-test",
    title: "本机持久化测试会议",
    date: "2026-08-22",
    startTime: "09:30",
    endTime: "11:00",
    location: "第一会议室",
    meetingRoomId: "room-one",
    roomRequirements: "提前开启投屏",
    organizer: "测试单位",
    owner: "会务组",
    attendeeEstimate: 12,
    rosterRequired: false,
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
    createdAt: timestamp,
    updatedAt: timestamp,
    tasks: [],
    attendees: [],
    ...overrides,
  };
}

async function callApi(store, init = {}) {
  const response = await handleLocalMeetingsApi(
    new Request("http://127.0.0.1:3000/api/meetings", {
      ...init,
      headers: {
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    }),
    store,
  );
  assert.ok(response);
  return response;
}

test("seating plan persists separately, invalid seat assignment cannot overwrite it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-seating-"));
  try {
    const seatingPlan = {
      schemaVersion: 1,
      options: { template: "podium-single", hostCompany: "本公司", door: "bottom", rowCapacity: 9, closeThreshold: 50, anchorMode: "host-first", tableCenter: "auto", moderatorId: "" },
      participants: [{ id: "seat-person", name: "测试人员", unit: "本公司", title: "", grade: "", weight: 100, party: "host" }],
      seats: [{ id: "seat-1-0", group: "第 1 排", row: 1, position: 0, seatNumber: "1", personId: "seat-person", party: "host", labels: ["主位"] }],
      warnings: [], explanation: "中心高于两侧，请人工确认。", generatedAt: "2026-09-30T08:00:00.000Z", manualAdjusted: false,
    };
    const meeting = makeMeeting({ seatingPlan });
    assert.equal((await callApi(createLocalMeetingStore({ dataDirectory: directory }), { method: "PUT", body: JSON.stringify({ meetings: [meeting] }) })).status, 200);
    const restarted = createLocalMeetingStore({ dataDirectory: directory });
    const restored = (await (await callApi(restarted)).json()).meetings[0];
    assert.deepEqual(restored.seatingPlan, seatingPlan);
    assert.deepEqual(restored.attendees, []);
    assert.equal(restored.rosterRequired, false);
    const invalid = { ...meeting, seatingPlan: { ...seatingPlan, seats: [] } };
    assert.equal((await callApi(restarted, { method: "PUT", body: JSON.stringify({ meetings: [invalid] }) })).status, 400);
    assert.deepEqual((await (await callApi(restarted)).json()).meetings[0].seatingPlan, seatingPlan);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("meetings persist after constructing a fresh local store", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-records-"));
  try {
    const store = createLocalMeetingStore({ dataDirectory: directory });
    const saved = await callApi(store, {
      method: "PUT",
      body: JSON.stringify({ meetings: [makeMeeting()] }),
    });
    assert.equal(saved.status, 200);

    const restartedStore = createLocalMeetingStore({
      dataDirectory: directory,
    });
    const response = await callApi(restartedStore);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.meetings.length, 1);
    assert.equal(payload.meetings[0].meetingRoomId, "room-one");
    assert.equal(payload.meetings[0].title, "本机持久化测试会议");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("transitional attendee plate data remains readable for migration", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-attendee-plates-"));
  try {
    const attendees = [
      { id: "attendee-plate", name: "测试人员", unit: "", department: "", title: "", licensePlate: "浙B01234" },
      { id: "attendee-legacy", name: "旧版人员", unit: "", department: "", title: "" },
    ];
    const saved = await callApi(createLocalMeetingStore({ dataDirectory: directory }), {
      method: "PUT", body: JSON.stringify({ meetings: [makeMeeting({ attendees })] }),
    });
    assert.equal(saved.status, 200);
    const restored = await callApi(createLocalMeetingStore({ dataDirectory: directory }));
    assert.deepEqual((await restored.json()).meetings[0].attendees, attendees);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("unit vehicles persist independently without named attendees and duplicate plates are rejected", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-unit-vehicles-"));
  try {
    const vehicles = [
      { unit: "测试单位", licensePlate: "浙B01234", note: "单位用车" },
      { unit: "测试单位", licensePlate: "浙B54321", note: "" },
    ];
    const meeting = makeMeeting({ parkingRequired: true, vehicleCount: 2, vehicles });
    const saved = await callApi(createLocalMeetingStore({ dataDirectory: directory }), {
      method: "PUT", body: JSON.stringify({ meetings: [meeting] }),
    });
    assert.equal(saved.status, 200);
    const restarted = createLocalMeetingStore({ dataDirectory: directory });
    const restored = (await (await callApi(restarted)).json()).meetings[0];
    assert.deepEqual(restored.vehicles, vehicles);
    assert.deepEqual(restored.attendees, []);
    assert.equal(restored.rosterRequired, false);
    const invalid = await callApi(restarted, { method: "PUT", body: JSON.stringify({ meetings: [{ ...meeting, vehicles: [vehicles[0], { ...vehicles[0], licensePlate: "浙b01234" }] }] }) });
    assert.equal(invalid.status, 400);
    assert.deepEqual((await (await callApi(restarted)).json()).meetings[0].vehicles, vehicles);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("meetings API rejects an invalid time range without overwriting data", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeting-invalid-time-"));
  try {
    const store = createLocalMeetingStore({ dataDirectory: directory });
    const response = await callApi(store, {
      method: "PUT",
      body: JSON.stringify({
        meetings: [makeMeeting({ startTime: "11:00", endTime: "09:30" })],
      }),
    });
    assert.equal(response.status, 400);
    const after = await callApi(store);
    assert.deepEqual((await after.json()).meetings, []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
