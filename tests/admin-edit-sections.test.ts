import assert from "node:assert/strict";
import test from "node:test";
import { cloneAdminConfig } from "../app/lib/admin-config";
import { ADMIN_EDIT_SECTIONS, adminSectionDirty, isAdminEditSection, replaceAdminSection, type AdminEditSection } from "../app/lib/admin-edit-sections";

function draftWithEveryEditorChanged() {
  const draft = cloneAdminConfig();
  draft.organization.name = "待保存公司";
  draft.meetingRules.parkingVehicleLimit = 8;
  draft.meetingRooms[0].name = "待保存会议室";
  draft.organization.defaultMeetingRoomId = draft.meetingRooms[0].id;
  draft.checklistTemplates[0].title = "待保存模板";
  draft.rosterRules.aliases.push({ id: "test-alias", canonical: "测试单位", aliases: ["简称"], mode: "auto", enabled: true, notes: "" });
  draft.rosterRules.worksheetName = "待保存导出表";
  return draft;
}

test("every configuration editor has disjoint field ownership and independent dirty state", () => {
  const base = cloneAdminConfig();
  const draft = draftWithEveryEditorChanged();
  for (const section of Object.keys(ADMIN_EDIT_SECTIONS) as AdminEditSection[]) {
    assert.ok(adminSectionDirty(base, draft, section));
    const saved = replaceAdminSection(base, draft, section);
    for (const other of Object.keys(ADMIN_EDIT_SECTIONS) as AdminEditSection[]) {
      assert.equal(adminSectionDirty(base, saved, other), section === other);
    }
    assert.deepEqual(replaceAdminSection(saved, base, section), base);
  }
  assert.equal(base.organization.name, "会务智办");
  assert.equal(draft.meetingRooms[0].name, "待保存会议室");
});

test("saving or cancelling one editor retains all other unpublished drafts", () => {
  const base = cloneAdminConfig();
  const draft = draftWithEveryEditorChanged();
  const saved = replaceAdminSection(base, draft, "rooms");
  const rebased = replaceAdminSection(draft, saved, "rooms");
  assert.equal(adminSectionDirty(saved, rebased, "rooms"), false);
  assert.equal(adminSectionDirty(saved, rebased, "organization"), true);
  assert.equal(adminSectionDirty(saved, rebased, "aliases"), true);
  assert.equal(rebased.organization.name, draft.organization.name);
  const cancelled = replaceAdminSection(draft, base, "rooms");
  assert.equal(cancelled.organization.defaultMeetingRoomId, "");
  assert.equal(cancelled.organization.name, draft.organization.name);
  assert.deepEqual(cancelled.rosterRules, draft.rosterRules);
});

test("read-only, contact and maintenance pages are not scoped configuration editors", () => {
  for (const key of ["contacts", "overview", "maintenance", "toString", "__proto__"]) assert.equal(isAdminEditSection(key), false);
});
