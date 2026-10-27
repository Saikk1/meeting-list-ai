import assert from "node:assert/strict";
import test from "node:test";
import { adminConfigChanges, contactsChanges } from "../app/lib/business-data-events";
import { createContact, updateContact, deleteContact, replaceContacts, syncMeetingContacts, listContacts, type ContactRecord } from "../app/lib/contacts";
import { executeConfirmedPlan } from "../app/lib/assistant-actions";
import { undoAssistantOperation, type AssistantOperationHistoryEntry } from "../app/lib/assistant-operation-history";
import { cloneAdminConfig, DEFAULT_ADMIN_CONFIG } from "../app/lib/admin-config";
import type { AssistantPlan } from "../app/lib/assistant-contract";
import type { MeetingRecord } from "../app/lib/meeting-data";

const input = { name: "测试人员", unit: "测试单位", department: "", title: "" };
const contact: ContactRecord = { ...input, id: "test-contact", createdAt: "2030-01-01", updatedAt: "2030-01-02", meetingCount: 0, meetingIds: [], lastMeetingId: "", lastMeetingTitle: "", lastMeetingDate: "" };
function plan(actions: AssistantPlan["actions"]): AssistantPlan {
  return { schemaVersion: 1, summary: "测试页面同步", clarification: null, warnings: [], actions };
}

test("every successful contact write invalidates lists and pickers, while reads and failures do not", async (t) => {
  let notifications = 0;
  const unsubscribe = contactsChanges.subscribe(() => { notifications++; });
  t.after(unsubscribe);
  t.mock.method(globalThis, "fetch", async () => Response.json({ contact, contacts: [contact], total: 1, upserted: 1 }));
  await listContacts();
  assert.equal(notifications, 0);
  await createContact(input);
  await updateContact(contact.id, input);
  await deleteContact(contact.id);
  await replaceContacts([contact]);
  const meeting = { id: "meeting-test", title: "测试会议", date: "2030-01-01", attendees: [{ id: "person-test", ...input }] } as MeetingRecord;
  await syncMeetingContacts(meeting);
  assert.equal(notifications, 5);
  await syncMeetingContacts({ ...meeting, attendees: [{ ...meeting.attendees[0], unit: "" }] });
  assert.equal(notifications, 5, "no invalidation when no contacts are written");
  t.mock.method(globalThis, "fetch", async () => Response.json({ error: "写入失败" }, { status: 500 }));
  await assert.rejects(createContact(input), /写入失败/);
  assert.equal(notifications, 5);
});

test("contact notification waits for a successful response body and revisions survive an unsubscribed page", async (t) => {
  const before = contactsChanges.getSnapshot();
  let resolveBody!: (value: unknown) => void;
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: () => new Promise((resolve) => { resolveBody = resolve; }) }) as Response);
  const saving = createContact(input);
  await Promise.resolve();
  assert.equal(contactsChanges.getSnapshot(), before);
  resolveBody({ contact });
  await saving;
  assert.equal(contactsChanges.getSnapshot(), before + 1);
  const unsubscribe = contactsChanges.subscribe(() => {});
  unsubscribe();
  t.mock.method(globalThis, "fetch", async () => Response.json({ replaced: true, total: 0 }));
  await replaceContacts([]);
  assert.equal(contactsChanges.getSnapshot(), before + 2, "a resumed page can detect writes made while its effects were stopped");
});

test("default AI execution and undo notify both contact and admin consumers after persistence", async (t) => {
  let contacts: ContactRecord[] = [];
  let config = cloneAdminConfig(DEFAULT_ADMIN_CONFIG);
  let revision = 7;
  let failWrites = false;
  const observed: string[] = [];
  const unsubscribeContacts = contactsChanges.subscribe(() => { observed.push(`contacts:${contacts.length}`); });
  const unsubscribeAdmin = adminConfigChanges.subscribe(() => { observed.push(`admin:${revision}`); });
  t.after(() => { unsubscribeContacts(); unsubscribeAdmin(); });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url);
    if (failWrites && init?.method) return Response.json({ error: "模拟写入失败" }, { status: 500 });
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.startsWith("/api/contacts")) {
      if (init?.method === "POST") contacts = [contact];
      if (init?.method === "PUT") contacts = body.contacts;
      return Response.json({ contacts, contact, total: contacts.length });
    }
    assert.equal(path, "/api/admin/config");
    if (init?.method === "PUT") { assert.equal(body.expectedRevision, revision); config = body.config; revision++; }
    return Response.json({ config, revision });
  });
  await executeConfirmedPlan(plan([{ type: "contact.create", input }]), { loadMeetings: () => [] });
  const beforeConfig = structuredClone(config);
  const adminPlan = plan([{ type: "admin.config.patch", expectedRevision: 7, summary: "修改默认负责人", patch: { organization: { defaultOwner: "测试负责人" } } }]);
  await executeConfirmedPlan(adminPlan, { loadMeetings: () => [] });
  assert.deepEqual(observed, ["contacts:1", "admin:8"]);
  const entry: AssistantOperationHistoryEntry = { id: "undo-test", createdAt: "2030-01-01", summary: "撤销测试修改", actionTypes: ["contact.create", "admin.config.patch"], executedActions: 2, meetingChanges: [], contactChanges: [{ id: contact.id, before: null, afterUpdatedAt: contact.updatedAt }], adminChange: { beforeRevision: 7, beforeConfig, afterRevision: 8 }, reversible: true, limitation: "", status: "active", undoneAt: null };
  await undoAssistantOperation(entry);
  assert.deepEqual(observed, ["contacts:1", "admin:8", "contacts:0", "admin:9"]);
  assert.deepEqual(config, beforeConfig);
  failWrites = true;
  await assert.rejects(executeConfirmedPlan(plan([{ type: "admin.config.patch", expectedRevision: 9, summary: "失败测试", patch: { organization: { defaultOwner: "不应生效" } } }]), { loadMeetings: () => [] }), /模拟写入失败/);
  assert.equal(observed.length, 4);
});
