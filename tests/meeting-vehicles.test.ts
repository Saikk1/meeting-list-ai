import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { createMeeting, duplicateMeeting, migrateMeetingVehicles, updateMeetingFields, type MeetingInput } from "../app/lib/meeting-data";
import { buildMeetingVehiclesXlsx, normalizeMeetingVehicles } from "../app/lib/meeting-vehicles";
import { executeConfirmedPlan } from "../app/lib/assistant-actions";
import { parseAssistantPlan } from "../app/lib/assistant-contract";
import { parseAssistantWorkingMemory } from "../app/lib/assistant-agent-contract";

const input: MeetingInput = {
  title: "车辆报备会议", date: "2030-08-20", startTime: "09:30", location: "小会议室", organizer: "测试单位", owner: "会务组", attendeeEstimate: 8,
  rosterRequired: false, afternoonMeeting: false, mealType: "none", alcoholRequired: false, parkingRequired: true, vehicleCount: 0,
  publicityRequired: false, reimbursementRequired: false, presentationRequired: false, welcomeScreenRequired: false, roomSize: "small",
};
const vehicles = [
  { unit: "单位甲", licensePlate: " 浙b01234 ", note: "单位公务车" },
  { unit: "单位甲", licensePlate: "浙B54321", note: "" },
];

test("multiple unit vehicles need no people or roster and count cannot fall below registered cars", () => {
  const meeting = createMeeting({ ...input, vehicles });
  assert.deepEqual(meeting.attendees, []);
  assert.equal(meeting.rosterRequired, false);
  assert.equal(meeting.vehicleCount, 2);
  assert.equal(meeting.vehicles?.[0].licensePlate, "浙B01234");
  assert.equal(updateMeetingFields(meeting, { vehicleCount: 1 }).vehicleCount, 2);
  assert.throws(() => normalizeMeetingVehicles([...vehicles, { ...vehicles[0], licensePlate: "浙B01234" }]), /重复/);
  assert.throws(() => normalizeMeetingVehicles([{ unit: "单位甲", licensePlate: "", note: "" }]), /缺少车牌/);
});

test("parking disabled preserves vehicle register but rejects new registration until enabled", () => {
  const meeting = createMeeting({ ...input, vehicles });
  const disabled = updateMeetingFields(meeting, { parkingRequired: false });
  assert.equal(disabled.vehicleCount, 0);
  assert.deepEqual(disabled.vehicles, meeting.vehicles);
  assert.equal(updateMeetingFields(disabled, { parkingRequired: true }).vehicleCount, 2);
  assert.throws(() => updateMeetingFields(disabled, { vehicles }), /停车保障/);
  assert.throws(() => createMeeting({ ...input, parkingRequired: false, vehicles }), /停车保障/);
  assert.doesNotThrow(() => duplicateMeeting(disabled));
});

test("legacy attendee plates migrate by unit without assigning a driver or duplicating plates", () => {
  const migrated = migrateMeetingVehicles({ attendees: [
    { id: "one", name: "张三", unit: "单位甲", title: "", department: "", licensePlate: "浙b01234" },
    { id: "two", name: "李四", unit: "单位甲", title: "", department: "", licensePlate: "浙B01234" },
  ] });
  assert.equal(migrated.length, 1);
  assert.equal(migrated[0].unit, "单位甲");
  assert.equal(Object.hasOwn(migrated[0], "name"), false);
});

test("vehicles export has unit and plate rows independent of the personnel Excel", async () => {
  const workbook = XLSX.read(await buildMeetingVehiclesXlsx(vehicles), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets["参会车辆"]);
  assert.deepEqual(rows.map((row) => row.车牌号), ["浙B01234", "浙B54321"]);
  assert.equal(rows[0].单位, "单位甲");
  assert.equal(rows[0].备注, "单位公务车");
  assert.equal(Object.hasOwn(rows[0], "姓名"), false);
});

test("assistant draft and confirmed actions support independent unit cars and parking activation", async () => {
  const memory = parseAssistantWorkingMemory({ activeIntent: "create_meeting", selectedMeetingId: null, newMeetingDraft: { parkingRequired: true, vehicles } });
  assert.equal(memory.newMeetingDraft?.vehicles?.[0].licensePlate, "浙B01234");
  const meeting = createMeeting({ ...input, parkingRequired: false });
  const plan = parseAssistantPlan({ schemaVersion: 1, summary: "登记单位车辆", clarification: null, warnings: [], actions: [
    { type: "meeting.update_fields", meetingId: meeting.id, expectedUpdatedAt: meeting.updatedAt, patch: { parkingRequired: true, vehicles } },
  ] });
  let saved = meeting;
  await executeConfirmedPlan(plan, { loadMeetings: () => [meeting], saveMeeting: (next) => { saved = next; return next; } });
  assert.equal(saved.parkingRequired, true);
  assert.equal(saved.vehicles?.length, 2);
  assert.deepEqual(saved.attendees, []);
  assert.equal(saved.rosterRequired, false);
  const closeParking = parseAssistantPlan({ schemaVersion: 1, summary: "关闭停车", clarification: null, warnings: [], actions: [
    { type: "meeting.update_fields", meetingId: saved.id, expectedUpdatedAt: saved.updatedAt, patch: { parkingRequired: false } },
  ] });
  await executeConfirmedPlan(closeParking, { loadMeetings: () => [saved], saveMeeting: (next) => { saved = next; return next; } });
  assert.equal(saved.parkingRequired, false);
  assert.equal(saved.vehicles?.length, 2);
});
