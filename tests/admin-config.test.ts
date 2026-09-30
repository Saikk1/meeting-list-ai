import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneAdminConfig,
  DEFAULT_ADMIN_CONFIG,
  isAdminConfig,
  upgradeAdminConfig,
} from "../app/lib/admin-config";
import { meetingRoomRequirements } from "../app/lib/builtin-meeting-rooms";
import { parseAssistantPlan } from "../app/lib/assistant-contract";

test("client import guard accepts the complete default configuration", () => {
  assert.equal(isAdminConfig(cloneAdminConfig(DEFAULT_ADMIN_CONFIG)), true);
});

test("built-in room facts are isolated editable defaults with no inferred capacities or 24F rooms", () => {
  const first = cloneAdminConfig();
  const second = cloneAdminConfig();
  assert.equal(first.meetingRooms.length, 6);
  assert.deepEqual(first.meetingRooms.map((room) => room.areaSqm), [42.7, 106.2, 12, 17.8, 47.7, 35]);
  assert.ok(first.meetingRooms.every((room) => room.capacity === 0 && !room.name.includes("24F")));
  assert.equal(first.organization.defaultMeetingRoomId, "");
  assert.match(meetingRoomRequirements(first.meetingRooms[0]), /42\.7㎡\n会议桌尺寸：3\.2m × 1\.4m/);
  first.meetingRooms[0].name = "修改";
  assert.equal(second.meetingRooms[0].name, "10F 决策室（小会议室）");
  assert.equal(isAdminConfig({ ...second, meetingRooms: [{ ...second.meetingRooms[0], areaSqm: -1 }] }), false);
});

test("assistant room configuration accepts old rooms without optional area metadata", () => {
  const room = cloneAdminConfig().meetingRooms[0];
  delete room.areaSqm;
  delete room.tableDimensions;
  const plan = parseAssistantPlan({ schemaVersion: 1, summary: "修改会议室", clarification: null, warnings: [], actions: [{ type: "admin.config.patch", expectedRevision: 1, summary: "兼容旧房间", patch: { meetingRooms: [room] } }] });
  assert.equal(plan.actions[0].type, "admin.config.patch");
});

test("client import guard rejects nested incomplete configuration", () => {
  const incomplete = cloneAdminConfig(DEFAULT_ADMIN_CONFIG) as unknown as {
    meetingRules: {
      reminders?: unknown;
    };
  };
  delete incomplete.meetingRules.reminders;
  assert.equal(isAdminConfig(incomplete), false);
});

test("legacy schema v1 is upgraded without changing its pinyin behavior", () => {
  const legacy = cloneAdminConfig(DEFAULT_ADMIN_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  legacy.schemaVersion = 1;
  const rosterRules = legacy.rosterRules as Record<string, unknown>;
  delete rosterRules.ranking;
  rosterRules.withinUnitOrder = "source";

  const upgraded = upgradeAdminConfig(legacy);

  assert.ok(upgraded);
  assert.equal(upgraded.schemaVersion, 2);
  assert.equal(upgraded.rosterRules.ranking.mode, "pinyin");
  assert.equal(upgraded.rosterRules.withinUnitOrder, "source");
});

test("saved built-in checklist conditions adopt optional roster semantics", () => {
  const legacy = cloneAdminConfig(DEFAULT_ADMIN_CONFIG);
  legacy.checklistTemplates = legacy.checklistTemplates.map((item) =>
    item.id === "print-nameplates" || item.id === "seat-order"
      ? { ...item, condition: "always" }
      : item.id === "electronic-nameplate"
        ? { ...item, condition: "welcomeScreen" }
        : item,
  );

  const upgraded = upgradeAdminConfig(legacy);
  assert.ok(upgraded);
  assert.equal(
    upgraded.checklistTemplates.find((item) => item.id === "print-nameplates")
      ?.condition,
    "roster",
  );
  assert.equal(
    upgraded.checklistTemplates.find((item) => item.id === "electronic-nameplate")
      ?.condition,
    "rosterWelcomeScreen",
  );
});

test("older configurations gain an empty meeting-room library safely", () => {
  const legacy = cloneAdminConfig(DEFAULT_ADMIN_CONFIG) as unknown as Record<
    string,
    unknown
  >;
  delete legacy.meetingRooms;
  const organization = legacy.organization as Record<string, unknown>;
  delete organization.defaultMeetingRoomId;

  const upgraded = upgradeAdminConfig(legacy);

  assert.ok(upgraded);
  assert.deepEqual(upgraded.meetingRooms, []);
  assert.equal(upgraded.organization.defaultMeetingRoomId, "");
});

test("meeting-room configuration validates its selectable room data", () => {
  const config = cloneAdminConfig(DEFAULT_ADMIN_CONFIG);
  config.meetingRooms = [
    {
      id: "room-1",
      name: "三楼大会议室",
      location: "三楼东侧",
      capacity: 36,
      roomSize: "large",
      equipment: ["投影仪", "视频会议"],
      requirements: "会前打开中控",
      enabled: true,
    },
  ];
  config.organization.defaultMeetingRoomId = "room-1";

  assert.equal(isAdminConfig(config), true);
  assert.equal(cloneAdminConfig(config).meetingRooms[0]?.capacity, 36);
});
