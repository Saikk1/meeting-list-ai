import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { strFromU8, unzipSync } from "fflate";
import { createMeeting, type MeetingInput } from "../app/lib/meeting-data";
import { createMeetingPlan, planSourceChanges, syncPlanSource, planWarnings } from "../app/lib/meeting-plan";
import { buildMeetingPlanDocx } from "../app/lib/meeting-plan-export";
import { validateMeetingPlan, validateMeetingPlanPatch } from "../scripts/meeting-plan-schema.mjs";
import { applyAssistantWorkspace, getAssistantWorkspace, registerAssistantWorkspace } from "../app/lib/assistant-workspace";
import { parseAssistantPlan } from "../app/lib/assistant-contract";
import { compileAssistantAgentResponse } from "../app/lib/assistant-agent-compiler";

const input: MeetingInput = { title: "虚构产业交流会", date: "2030-08-20", startTime: "09:00", endTime: "11:00", location: "测试会议室", organizer: "示例单位", owner: "示例会务组", attendeeEstimate: 2, afternoonMeeting: false, mealType: "none", alcoholRequired: false, parkingRequired: false, vehicleCount: 0, publicityRequired: false, reimbursementRequired: false, presentationRequired: true, welcomeScreenRequired: false, roomSize: "small" };
function meeting() {
  return createMeeting(input, { attendees: [{ id: "person-a", name: "测试甲", unit: "示例甲单位", department: "业务部", title: "负责人" }, { id: "person-b", name: "测试乙", unit: "示例乙单位", department: "", title: "经理" }] });
}
test("plan uses registered facts and keeps unknown writing empty", () => {
  const m = meeting(), p = createMeetingPlan(m);
  assert.equal(p.title, input.title + "会议方案"); assert.equal(p.background, ""); assert.deepEqual(p.agenda, []);
  assert.equal(p.groups.length, 2); assert.deepEqual(planSourceChanges(p, m), []);
  assert.ok(planWarnings(p).includes("会议背景待补充")); validateMeetingPlan(p);
});
test("selective source sync preserves writing, custom grouping and participant order", () => {
  const m = meeting(), p = createMeetingPlan(m);
  p.background = "人工背景"; p.agenda = [{ id: "agenda-1", content: "人工议程", speaker: "", duration: "" }];
  p.groups[0].label = "自定义来宾"; p.groups[0].collective = "相关工作人员";
  const latest = { ...m, location: "新测试地点", date: "2030-08-21", attendees: [{ ...m.attendees[0], title: "新职务" }, { id: "person-c", name: "测试丙", unit: "示例丙单位", department: "", title: "" }] };
  const synced = syncPlanSource(p, latest, ["location", "people"]);
  assert.equal(synced.location, "新测试地点"); assert.equal(synced.date, m.date);
  assert.equal(synced.background, "人工背景"); assert.deepEqual(synced.agenda, p.agenda);
  assert.equal(synced.groups[0].label, "自定义来宾"); assert.equal(synced.groups[0].collective, "相关工作人员");
  assert.equal(synced.groups[0].people[0].title, "新职务"); assert.equal(synced.groups.flatMap((g) => g.people).length, 2);
  assert.deepEqual(planSourceChanges(synced, latest), ["time"]); assert.equal(m.attendees[0].title, "负责人");
});
test("plan validator rejects unsafe fields, duplicate identities and invalid time ranges", () => {
  const p = createMeetingPlan(meeting());
  assert.throws(() => validateMeetingPlanPatch({ source: p.source }), /不支持/);
  assert.throws(() => validateMeetingPlan({ ...p, endTime: "08:00" }), /晚于/);
  assert.throws(() => validateMeetingPlan({ ...p, groups: [p.groups[0], { ...p.groups[1], people: p.groups[0].people }] }), /重复/);
});
test("Word output uses clean template styles, complete sections and escaped text", async () => {
  const template = await readFile(new URL("../public/templates/meeting-plan.docx", import.meta.url));
  const p = createMeetingPlan(meeting()); p.background = "背景<&>\n第二段";
  p.groups[0].collective = "相关部门工作人员";
  p.agenda = Array.from({ length: 35 }, (_, i) => ({ id: `a-${i}`, content: `议程${i + 1}`, speaker: "", duration: "10分钟（待确认）" }));
  const zip = unzipSync(buildMeetingPlanDocx(p, template)), xml = strFromU8(zip["word/document.xml"]);
  for (const text of ["一、会议背景", "二、会议基本信息", "三、会议议程", "背景&lt;&amp;&gt;", "第二段", "相关部门工作人员", "35.议程35"]) assert.ok(xml.includes(text), text);
  assert.ok(!xml.includes("{{")); assert.match(xml, /w:sz w:val="44"/); assert.match(xml, /w:pgSz w:w="11906" w:h="16838"/);
  assert.match(strFromU8(zip["word/styles.xml"]), /FangSong_GB2312/);
  assert.ok(strFromU8(unzipSync(template)["word/document.xml"]).includes("{{TITLE}}")); assert.ok(!Object.keys(zip).some((k) => k.startsWith("docProps/") || k.includes("comments")));
});
test("workspace revisions survive tab hiding but reject edits and closed instances", async () => {
  const snapshot = { id: "test-workspace", path: "/meetings/a", label: "A会议 · 方案", kind: "meeting_plan", dirty: false, data: { draft: createMeetingPlan(meeting()) }, editableFields: ["background"], modes: ["draft" as const] };
  let applied = "";
  const handler = (p: Record<string, unknown>) => { applied = String(p.background); return "已采用"; };
  let unregister = registerAssistantWorkspace(snapshot, handler);
  const expectedRevision = getAssistantWorkspace(snapshot.id)!.revision;
  const action = { type: "page.workspace.apply" as const, workspaceId: snapshot.id, expectedRevision, mode: "draft" as const, patch: { background: "生成背景" } };
  unregister(); await assert.rejects(() => applyAssistantWorkspace(action), /切换|关闭/);
  unregister = registerAssistantWorkspace(snapshot, handler);
  assert.equal(getAssistantWorkspace(snapshot.id)!.revision, expectedRevision);
  await applyAssistantWorkspace(action); assert.equal(applied, "生成背景");
  unregister(); unregister = registerAssistantWorkspace({ ...snapshot, data: { draft: { ...snapshot.data.draft, background: "刚刚人工编辑" } } }, handler);
  await assert.rejects(() => applyAssistantWorkspace(action), /发生变化/); assert.equal(applied, "生成背景"); unregister();
});
test("compiler enforces page target, fields and preview, without stale create intent", () => {
  const ws = { id: "plan-a", revision: 42, kind: "meeting_plan", editableFields: ["background", "agenda"], modes: ["draft"], data: { draft: createMeetingPlan(meeting()) } };
  const action = { type: "page.workspace.apply", workspaceId: ws.id, expectedRevision: ws.revision, mode: "draft", patch: { background: "当前会议背景" } };
  const response = { reply: "将采用到当前方案草稿", mode: "preview", assumptions: [], suggestions: [], memory: { activeIntent: "update_meeting", selectedMeetingId: null, newMeetingDraft: null }, actions: [action] };
  const result = compileAssistantAgentResponse(response, { defaultMeetingInput: input, pageWorkspace: ws, currentMessage: "帮我起草会议背景", previousMemory: { activeIntent: "create_meeting", selectedMeetingId: null, newMeetingDraft: { title: "旧会议" } } });
  assert.equal(result.memory.activeIntent, "update_meeting"); assert.equal(result.memory.newMeetingDraft, null);
  assert.equal(result.plan?.actions[0].type, "page.workspace.apply");
  assert.throws(() => compileAssistantAgentResponse({ ...response, actions: [{ ...action, expectedRevision: 41 }] }, { defaultMeetingInput: input, pageWorkspace: ws }), /版本|目标/);
  assert.throws(() => compileAssistantAgentResponse({ ...response, actions: [{ ...action, patch: { title: "越权修改" } }] }, { defaultMeetingInput: input, pageWorkspace: ws }), /开放字段/);
  assert.throws(() => parseAssistantPlan({ schemaVersion: 1, summary: "混合", clarification: null, warnings: [], actions: [action, { type: "contacts.open" }] }), /单独/);
});
