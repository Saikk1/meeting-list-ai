"use client";
import { useEffect, useState } from "react";
import { useActionAssistant } from "./action-assistant";
import { useAssistantWorkspace } from "./use-assistant-workspace";
import { notifySaved } from "./app-feedback";
import { confirmAction } from "../lib/confirmation";
import { flushMeetingPersistence, loadMeetingStoreSnapshot, saveMeeting, type MeetingRecord } from "../lib/meeting-data";
import { agendaText, createMeetingPlan, PLAN_SOURCE_LABELS, planSource, planSourceChanges, planTime, planWarnings, syncPlanSource, type MeetingPlan, type MeetingPlanSource } from "../lib/meeting-plan";
import { downloadMeetingPlan } from "../lib/meeting-plan-export";
import { validateMeetingPlan, validateMeetingPlanPatch } from "../../scripts/meeting-plan-schema.mjs";
import type { WorkspaceMode } from "../lib/assistant-workspace";

const newId = () => `plan-${crypto.randomUUID()}`;
export function MeetingPlanPreview({ plan }: { plan: MeetingPlan }) {
  return <article className="meeting-plan-paper" aria-label="会议方案全文预览">
    <h2>{plan.title || "会议方案（待确认）"}</h2>
    <h3>一、会议背景</h3><div className="meeting-plan-paragraph">{plan.background || "会议背景待补充"}</div>
    <h3>二、会议基本信息</h3><h4>（一）时间</h4><p>{planTime(plan)}</p><h4>（二）地点</h4><p>{plan.location || "地点待确认"}</p><h4>（三）参会人员</h4>
    {!plan.groups.length && <p>参会人员待确认</p>}
    {plan.groups.map((g, i) => <div key={g.id}><p>{i + 1}.{g.label || "分组待确认"}</p>{g.people.map((p) => <p key={p.id}>{p.name}　{p.unit !== g.label ? p.unit : ""} {p.department} {p.title}</p>)}<div className="meeting-plan-paragraph">{g.collective}</div></div>)}
    <h3>三、会议议程</h3>{!plan.agenda.length && <p>会议议程待补充</p>}{plan.agenda.map((a, i) => <p key={a.id}>{i + 1}.{agendaText(a)}</p>)}
  </article>;
}
export function MeetingPlanEditor({ meeting, onStatus }: { meeting: MeetingRecord; onStatus: (status: { dirty: boolean; busy: boolean }) => void }) {
  const [draft, setDraft] = useState<MeetingPlan>(() => structuredClone(meeting.meetingPlan ?? createMeetingPlan(meeting)));
  const [baseline, setBaseline] = useState(() => JSON.stringify(meeting.meetingPlan ?? createMeetingPlan(meeting)));
  const [savedBase, setSavedBase] = useState(() => JSON.stringify(meeting.meetingPlan ?? null));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncKeys, setSyncKeys] = useState<(keyof MeetingPlanSource)[]>([]);
  const { openAssistant } = useActionAssistant();
  const dirty = JSON.stringify(draft) !== baseline || (!meeting.meetingPlan && touched);
  const changes = planSourceChanges(draft, meeting);
  const warnings = planWarnings(draft);
  useEffect(() => { onStatus({ dirty, busy }); }, [dirty, busy, onStatus]);
  useEffect(() => {
    const saved = JSON.stringify(meeting.meetingPlan ?? null);
    if (dirty || busy || saved === savedBase) return;
    const timer = window.setTimeout(() => {
      const next = structuredClone(meeting.meetingPlan ?? createMeetingPlan(meeting));
      setDraft(next); setBaseline(JSON.stringify(next)); setSavedBase(saved);
      setTouched(false); setError(""); setSyncOpen(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [meeting, dirty, busy, savedBase]);

  function change(next: MeetingPlan) { setDraft(next); setTouched(true); setError(""); }
  function patch<K extends keyof MeetingPlan>(key: K, value: MeetingPlan[K]) { change({ ...draft, [key]: value }); }
  async function perform(next: MeetingPlan, mode: WorkspaceMode, preconfirmed = false) {
    if (busy) throw new Error("方案正在保存或导出，请稍后重试");
    validateMeetingPlan(next);
    const exporting = mode === "download" || mode === "save_download";
    const issues = [...planWarnings(next), ...planSourceChanges(next, meeting).map((k) => `${PLAN_SOURCE_LABELS[k]}与登记信息不同步`)];
    if (exporting && issues.length && !preconfirmed && !(await confirmAction(`方案仍有待核对内容：${issues.join("；")}。继续导出草稿吗？`))) return "已取消导出，草稿保留";
    setBusy(true); setError("");
    let saved = false;
    try {
      if (mode === "save" || mode === "save_download") {
        const latest = loadMeetingStoreSnapshot().all.find((m) => m.id === meeting.id && !m.deletedAt);
        if (!latest || JSON.stringify(latest.meetingPlan ?? null) !== savedBase) throw new Error("会议方案已被其他操作修改，请核对最新方案后再保存。当前草稿已保留。");
        saveMeeting({ ...latest, meetingPlan: structuredClone(next) });
        await flushMeetingPersistence();
        setSavedBase(JSON.stringify(next)); setBaseline(JSON.stringify(next)); setTouched(false); saved = true;
        notifySaved("会议方案已保存");
      }
      if (exporting) {
        const name = await downloadMeetingPlan(next, meeting.title);
        return `${saved ? "方案已保存；" : ""}Word 已生成并开始下载：${name}`;
      }
      return "会议方案已保存，待办完成状态仍由人工确认";
    } catch (e) {
      const message = `${saved ? "方案已保存，Word 下载失败，可重试下载，无需重复保存。" : ""}${e instanceof Error ? e.message : "方案操作失败"}`;
      setError(message); throw new Error(message);
    } finally { setBusy(false); }
  }
  const workspaceId = useAssistantWorkspace({ suffix: "plan", kind: "meeting_plan", meetingId: meeting.id, label: `${meeting.title} · 会议方案`, dirty,
    data: { draft, saved: meeting.meetingPlan ?? null, pending: warnings, sourceChanges: changes.map((key) => ({ field: key, label: PLAN_SOURCE_LABELS[key], previous: draft.source[key], current: planSource(meeting)[key] })) },
    editableFields: ["title", "background", "date", "startTime", "endTime", "location", "groups", "agenda"], modes: ["draft", "save", "download", "save_download"],
    apply: async (p, mode) => {
      if (Object.keys(p).length) validateMeetingPlanPatch(p);
      const next = validateMeetingPlan({ ...draft, ...p });
      if (mode === "draft") { change(next); return "已采用到会议方案编辑区，尚未保存"; }
      if (Object.keys(p).length) change(next);
      return perform(next, mode, true);
    },
  });
  function ai(text: string) { openAssistant(text); }
  async function action(mode: WorkspaceMode) { try { await perform(draft, mode); } catch { /* Error stays in the editor. */ } }
  async function reload() {
    if (dirty && !(await confirmAction("放弃当前未保存的方案修改，读取最新保存版本吗？"))) return;
    const latest = loadMeetingStoreSnapshot().all.find((m) => m.id === meeting.id);
    if (!latest) return;
    const next = structuredClone(latest.meetingPlan ?? createMeetingPlan(latest));
    setDraft(next); setBaseline(JSON.stringify(next)); setSavedBase(JSON.stringify(latest.meetingPlan ?? null)); setTouched(false); setError("");
  }
  function move<T>(items: T[], index: number, delta: number) {
    const next = [...items], target = index + delta;
    if (target < 0 || target >= next.length) return items;
    [next[index], next[target]] = [next[target], next[index]]; return next;
  }
  return <section className="assistant-panel meeting-plan-editor" data-assistant-workspace={workspaceId}>
    <div className="meeting-plan-toolbar"><div><h2>会议方案</h2><p>会前编制 · 按内部模板导出 Word · {dirty ? "有未保存修改" : meeting.meetingPlan ? "已保存" : "尚未保存"}</p></div><div>
      <button type="button" onClick={() => ai("结合当前会议已登记信息与当前方案草稿，起草完整会议方案；生成背景和议程，保留基本信息和人员，不虚构事实。")}>AI 起草整份方案</button>
      <button type="button" onClick={() => setPreview(!preview)}>{preview ? "继续编辑" : "全文预览"}</button><button type="button" disabled={busy} onClick={() => void reload()}>读取最新版本</button>
      <button type="button" disabled={busy} onClick={() => void action("save")}>保存方案</button><button type="button" disabled={busy} onClick={() => void action("download")}>下载 Word</button><button className="primary" type="button" disabled={busy} onClick={() => void action("save_download")}>保存并下载</button>
    </div></div>
    {error && <p className="meeting-form-error" role="alert">{error}</p>}
    {changes.length > 0 && <div className="meeting-plan-notice">会议信息已更新，请核对会议方案：{changes.map((k) => PLAN_SOURCE_LABELS[k]).join("、")}。<button type="button" onClick={() => { setSyncKeys(changes); setSyncOpen(!syncOpen); }}>查看差异并同步</button></div>}
    {syncOpen && <div className="meeting-plan-sync">{changes.map((k) => <label key={k}><input type="checkbox" checked={syncKeys.includes(k)} onChange={(e) => setSyncKeys(e.target.checked ? [...syncKeys, k] : syncKeys.filter((v) => v !== k))}/><strong>{PLAN_SOURCE_LABELS[k]}</strong><small>原登记：{draft.source[k] || "空"}<br/>最新登记：{planSource(meeting)[k] || "空"}</small></label>)}<button type="button" onClick={() => { change(syncPlanSource(draft, meeting, syncKeys)); setSyncOpen(false); }}>同步勾选部分到草稿</button><p>保留背景、议程、现有分组及集体描述；人员同步保留现有排序，移除已从登记删除的人员。</p></div>}
    {warnings.length > 0 && <p className="meeting-plan-hint">待核对：{warnings.join("；")}。可先保存草稿。</p>}
    {preview ? <MeetingPlanPreview plan={draft}/> : <fieldset disabled={busy} className="meeting-plan-fields">
      <label>方案标题<input data-assistant-field="title" value={draft.title} maxLength={300} onChange={(e) => patch("title", e.target.value)}/></label>
      <div className="meeting-plan-section-title"><h3>一、会议背景</h3><button type="button" onClick={() => ai("只起草或修改当前会议方案的背景，保留其他内容。结合已知会议目的，缺失事实标注待确认。")}>AI 帮写背景</button></div>
      <label>会议背景<textarea data-assistant-field="background" rows={6} maxLength={20000} value={draft.background} placeholder="可填写会议目的和讨论重点，也可粘贴已有文字后让 AI 修改" onChange={(e) => patch("background", e.target.value)}/></label>
      <h3>二、会议基本信息</h3><div className="meeting-plan-grid"><label>日期<input type="date" value={draft.date} onChange={(e) => patch("date", e.target.value)}/></label><label>开始时间<input type="time" value={draft.startTime} onChange={(e) => patch("startTime", e.target.value)}/></label><label>结束时间<input type="time" value={draft.endTime} onChange={(e) => patch("endTime", e.target.value)}/></label></div>
      <label>地点<input data-assistant-field="location" value={draft.location} maxLength={500} onChange={(e) => patch("location", e.target.value)}/></label>
      <h4>参会人员</h4>
      {draft.groups.map((g, i) => <div className="meeting-plan-group" key={g.id}><div className="meeting-plan-row"><input aria-label={`第${i + 1}组名称`} value={g.label} maxLength={300} onChange={(e) => patch("groups", draft.groups.map((v) => v.id === g.id ? { ...v, label: e.target.value } : v))}/><button type="button" disabled={i === 0} onClick={() => patch("groups", move(draft.groups, i, -1))}>上移组</button><button type="button" disabled={i === draft.groups.length - 1} onClick={() => patch("groups", move(draft.groups, i, 1))}>下移组</button><button type="button" onClick={() => patch("groups", draft.groups.filter((v) => v.id !== g.id))}>移除组</button></div>
        {g.people.map((p, j) => <div className="meeting-plan-person" key={p.id}><span>{p.name}　{p.unit} {p.department} {p.title}</span><select aria-label={`${p.name}所在分组`} value={g.id} onChange={(e) => patch("groups", draft.groups.map((v) => ({ ...v, people: v.id === g.id ? v.people.filter((person) => person.id !== p.id) : v.id === e.target.value ? [...v.people, p] : v.people })))}>{draft.groups.map((v) => <option key={v.id} value={v.id}>{v.label || "未命名组"}</option>)}</select><button type="button" disabled={j === 0} onClick={() => patch("groups", draft.groups.map((v) => v.id === g.id ? { ...v, people: move(g.people, j, -1) } : v))}>上移</button><button type="button" disabled={j === g.people.length - 1} onClick={() => patch("groups", draft.groups.map((v) => v.id === g.id ? { ...v, people: move(g.people, j, 1) } : v))}>下移</button></div>)}
        <label>集体参会描述<textarea rows={2} value={g.collective} maxLength={4000} placeholder="如：相关部门负责人（不会写入通讯录）" onChange={(e) => patch("groups", draft.groups.map((v) => v.id === g.id ? { ...v, collective: e.target.value } : v))}/></label>
      </div>)}
      <button type="button" onClick={() => patch("groups", [...draft.groups, { id: newId(), label: "", people: [], collective: "" }])}>添加参会分组</button>
      <div className="meeting-plan-section-title"><h3>三、会议议程</h3><button type="button" onClick={() => ai("结合当前会议目的、时间和方案草稿，只编排或修改会议议程，保留其他内容；发言人和时长未经确认时作为建议标注待确认。")}>AI 编排议程</button></div>
      {draft.agenda.map((a, i) => <div className="meeting-plan-group" key={a.id}><label>议程 {i + 1}<textarea data-assistant-field={`agenda.${a.id}.content`} rows={3} maxLength={4000} value={a.content} onChange={(e) => patch("agenda", draft.agenda.map((v) => v.id === a.id ? { ...v, content: e.target.value } : v))}/></label><div className="meeting-plan-row"><label>发言人（可选）<input value={a.speaker} maxLength={200} onChange={(e) => patch("agenda", draft.agenda.map((v) => v.id === a.id ? { ...v, speaker: e.target.value } : v))}/></label><label>时长（可选）<input value={a.duration} maxLength={100} onChange={(e) => patch("agenda", draft.agenda.map((v) => v.id === a.id ? { ...v, duration: e.target.value } : v))}/></label><button type="button" disabled={i === 0} onClick={() => patch("agenda", move(draft.agenda, i, -1))}>上移</button><button type="button" disabled={i === draft.agenda.length - 1} onClick={() => patch("agenda", move(draft.agenda, i, 1))}>下移</button><button type="button" onClick={() => patch("agenda", draft.agenda.filter((v) => v.id !== a.id))}>删除议程</button></div></div>)}
      <button type="button" onClick={() => patch("agenda", [...draft.agenda, { id: newId(), content: "", speaker: "", duration: "" }])}>添加议程</button>
    </fieldset>}
  </section>;
}
