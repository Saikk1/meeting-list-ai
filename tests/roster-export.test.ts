import assert from "node:assert/strict";
import test from "node:test";

import { strFromU8, unzipSync } from "fflate";
import * as XLSX from "xlsx";
import { cloneAdminConfig } from "../app/lib/admin-config";
import { createMeeting } from "../app/lib/meeting-data";
import { buildAssistantRosterXlsx, prepareAssistantRosterExport } from "../app/lib/assistant-roster-export";

import {
  formatRosterExportFileName,
  freezeFirstRowInXlsx,
} from "../app/lib/roster-export";

test("personnel Excel contains no vehicle columns", async () => {
  const config = cloneAdminConfig();
  const meeting = createMeeting({
    title: "停车保障会议", date: "2030-08-20", startTime: "09:30", location: "测试会议室", organizer: "测试部门", owner: "测试人员", attendeeEstimate: 1,
    rosterRequired: false, afternoonMeeting: false, mealType: "none", alcoholRequired: false, parkingRequired: true, vehicleCount: 1,
    publicityRequired: false, reimbursementRequired: false, presentationRequired: false, welcomeScreenRequired: false, roomSize: "small",
    vehicles: [{ unit: "测试单位", licensePlate: "浙B01234", note: "单位用车" }],
  }, { attendees: [
    { id: "person", name: "张三", unit: "测试单位", department: "", title: "" },
  ] });
  const payload = prepareAssistantRosterExport(meeting, config.rosterRules);
  const workbook = XLSX.read(await buildAssistantRosterXlsx(payload), { type: "array" });
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
  assert.equal(rows[0].姓名, "张三");
  assert.equal(Object.hasOwn(rows[0], "车牌号"), false);
  assert.equal(meeting.rosterRequired, false);
});

test("roster export filename resolves Chinese placeholders", () => {
  const now = new Date(2026, 6, 31, 9, 8, 7);
  assert.equal(
    formatRosterExportFileName(
      "{会议名称}_参会名单_{日期}_{时间}",
      "低空 / 交流会",
      now,
    ),
    "低空 _ 交流会_参会名单_20260731_090807.xlsx",
  );
  assert.equal(
    formatRosterExportFileName("{会议名称}_参会名单_{日期}", "", now),
    "参会名单_20260731.xlsx",
  );
});

test("freeze header writes an actual frozen pane into the first worksheet", () => {
  const worksheet = XLSX.utils.aoa_to_sheet([
    ["姓名", "单位"],
    ["贺世博", "上海九誓"],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "名单");
  const original = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;

  const frozen = freezeFirstRowInXlsx(original);
  const archive = unzipSync(frozen);
  const xml = strFromU8(archive["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<pane [^>]*ySplit="1"[^>]*state="frozen"\/>/);
  assert.match(xml, /<selection [^>]*activeCell="A2"[^>]*\/>/);
});
