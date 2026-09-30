"use client";

import { Download, Plus, Save, Trash2, Upload, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AdminConfig } from "../lib/admin-config";
import type { MeetingRecord } from "../lib/meeting-data";
import { buildSeatingXlsx, defaultSeatingOptions, effectiveSeatingParty, generateSeatingPlan, parseSeatingTables, parseSeatingText, seatingWeight, SEATING_TEMPLATE_LABELS, swapSeatingPeople, type SeatingOptions, type SeatingPerson, type SeatingPlan } from "../lib/seating";
import { ContactAutocomplete } from "./contact-autocomplete";
import "./seating-planner.css";

type Draft = { participants: SeatingPerson[]; options: SeatingOptions; plan: SeatingPlan | null };
function fromMeeting(meeting: MeetingRecord, company: string): Draft {
  if (meeting.seatingPlan) return { participants: meeting.seatingPlan.participants, options: meeting.seatingPlan.options, plan: meeting.seatingPlan };
  return { participants: meeting.attendees.map((person) => ({ id: person.id, name: person.name, unit: person.unit, title: person.title, grade: "", weight: null, party: "auto" })), options: defaultSeatingOptions(company), plan: null };
}
function snapshot(draft: Draft) { return JSON.stringify(draft); }
function newPerson(): SeatingPerson { return { id: `seat-person-${crypto.randomUUID()}`, name: "", unit: "", title: "", grade: "", weight: null, party: "auto" }; }

export function SeatingPlanner({ meeting, config, onSave, onStatusChange }: {
  meeting: MeetingRecord;
  config: AdminConfig;
  onSave: (plan: SeatingPlan) => Promise<void>;
  onStatusChange: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromMeeting(meeting, config.organization.name));
  const baseline = useRef(snapshot(draft));
  const [baselineValue, setBaselineValue] = useState(snapshot(draft));
  const persistedPlan = useRef(JSON.stringify(meeting.seatingPlan ?? null));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [rawText, setRawText] = useState("");
  const rawTextRef = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const dirty = snapshot(draft) !== baselineValue || Boolean(rawText.trim());
  const busyRef = useRef(false);
  const latestDraft = useRef(draft);

  // Assistant/external saves refresh clean workspaces only; never overwrite a draft.
  useEffect(() => {
    const signature = JSON.stringify(meeting.seatingPlan ?? null);
    if (signature === persistedPlan.current || snapshot(latestDraft.current) !== baseline.current || busyRef.current || rawText.trim()) return;
    const timer = window.setTimeout(() => {
      const next = fromMeeting(meeting, config.organization.name);
      baseline.current = snapshot(next); latestDraft.current = next;
      setBaselineValue(snapshot(next));
      persistedPlan.current = signature; setDraft(next);
      onStatusChange({ dirty: false, busy: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [config.organization.name, meeting, onStatusChange, rawText]);

  function commit(next: Draft, message = "") {
    latestDraft.current = next; setDraft(next); setNotice(message);
    onStatusChange({ dirty: snapshot(next) !== baseline.current || Boolean(rawTextRef.current.trim()), busy: busyRef.current });
  }
  function setProcessing(value: boolean, changed = snapshot(latestDraft.current) !== baseline.current || Boolean(rawTextRef.current.trim())) {
    busyRef.current = value; setBusy(value); onStatusChange({ dirty: changed, busy: value });
  }
  function patchPerson(id: string, patch: Partial<SeatingPerson>) {
    commit({ ...draft, plan: null, participants: draft.participants.map((person) => person.id === id ? { ...person, ...patch } : person) });
  }
  function patchOptions(patch: Partial<SeatingOptions>) { commit({ ...draft, options: { ...draft.options, ...patch }, plan: null }); }
  function approveReplace() { return !draft.participants.length || window.confirm("这会替换座次工作区中的人员，并清除当前预览。会议原参会人员名单不会修改。是否继续？"); }
  function applyImport(result: ReturnType<typeof parseSeatingText>) {
    if (!result.people.length) throw new Error("名单中未找到参会人员");
    if (!approveReplace()) return false;
    const next = { ...draft, participants: result.people, options: { ...draft.options, moderatorId: result.moderatorId }, plan: null };
    rawTextRef.current = ""; setRawText(""); commit(next, `已导入 ${result.people.length} 人，请核对职级、权重和所属方后生成座次。`);
    onStatusChange({ dirty: true, busy: busyRef.current });
    return true;
  }
  async function importFile(file: File) {
    setProcessing(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("文件最大 20 MB");
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (["xlsx", "xls", "csv"].includes(extension ?? "")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheets = workbook.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" }));
        applyImport(parseSeatingTables(sheets));
      } else if (extension === "docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        const document = new DOMParser().parseFromString(result.value, "text/html");
        const tables = Array.from(document.querySelectorAll("table")).map((table) => Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll("td,th")).map((cell) => cell.textContent ?? "")));
        if (!tables.length) throw new Error("Word 文件中未找到名单表格；请复制名单到文本框，或使用 Excel");
        applyImport(parseSeatingTables(tables));
      } else if (["txt", "md", "tsv"].includes(extension ?? "")) applyImport(parseSeatingText(await file.text()));
      else throw new Error("请使用 Excel、CSV、Word 表格或文本名单");
    } catch (error) { setNotice(error instanceof Error ? error.message : "名单导入失败"); }
    finally { setProcessing(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  function generate() {
    try { const plan = generateSeatingPlan(draft.participants, draft.options, config.rosterRules); commit({ participants: plan.participants, options: plan.options, plan }, "座次已生成，请核对提醒和图示，确认后保存。"); }
    catch (error) { setNotice(error instanceof Error ? error.message : "生成座次失败"); }
  }
  async function save() {
    if (!draft.plan) return;
    if (persistedPlan.current !== JSON.stringify(meeting.seatingPlan ?? null)) { setNotice("座次已被助手或其他操作更新。请先重新读取已保存座次，避免覆盖。"); return; }
    setProcessing(true);
    try {
      await onSave(draft.plan);
      baseline.current = snapshot(draft); persistedPlan.current = JSON.stringify(draft.plan);
      setBaselineValue(snapshot(draft));
      setNotice("座次表已保存到本会议，未修改原参会人员名单。");
      rawTextRef.current = ""; setRawText(""); onStatusChange({ dirty: false, busy: true });
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败，请重试"); }
    finally { setProcessing(false); }
  }
  async function download() {
    if (!draft.plan) return;
    setProcessing(true);
    try {
      const bytes = await buildSeatingXlsx(draft.plan);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, "_")}_座次表.xlsx`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(error instanceof Error ? error.message : "导出失败"); }
    finally { setProcessing(false); }
  }
  const people = new Map(draft.participants.map((person) => [person.id, person]));
  const groups = [...new Set(draft.plan?.seats.map((seat) => seat.row))].sort((a, b) => a - b);
  const door = <div className="seating-door">门 / 入口</div>;
  return (
    <section className="seating-panel assistant-panel">
      <header className="seating-header"><div><span>导入名单，一键排好座次</span><h2>会议室座次编排</h2><p>按你提供的礼宾规则生成建议方案，最终由会务人员确认。</p></div>
        <div className="seating-actions"><button className="assistant-button secondary" disabled={busy || !draft.plan} onClick={() => void download()}><Download size={16} />导出座次表</button><button className="assistant-button primary" disabled={busy || !draft.plan || !dirty} onClick={() => void save()}><Save size={16} />保存座次</button></div>
      </header>
      {notice ? <div className="seating-notice" role="status">{notice}</div> : null}
      <div className="seating-step-heading"><b>1</b><h3>名单与职级核对</h3><span>{draft.participants.length} 人</span></div>
      <div className="seating-source-actions">
        <button className="assistant-button secondary" disabled={busy || !meeting.attendees.length} onClick={() => {
          if (!approveReplace()) return;
          commit({ ...draft, participants: fromMeeting({ ...meeting, seatingPlan: undefined }, config.organization.name).participants, options: { ...draft.options, moderatorId: "" }, plan: null }, "已读取会议人员，请补充职级和所属方。");
        }}>使用会议人员（{meeting.attendees.length} 人）</button>
        <button className="assistant-button secondary" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={16} />导入名单文件</button>
        <input ref={fileInput} type="file" hidden accept=".xlsx,.xls,.csv,.docx,.txt,.md,.tsv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
        <button className="assistant-button secondary" disabled={busy} onClick={() => commit({ ...draft, participants: [...draft.participants, newPerson()], plan: null })}><Plus size={16} />手动添加</button>
      </div>
      <details className="seating-import"><summary>粘贴名单（支持 Markdown 表格或制表符分列）</summary>
        <textarea aria-label="粘贴座次名单" rows={5} value={rawText} maxLength={100000} disabled={busy} placeholder={'姓名\t单位\t职务\t职级\t所属方\n张伟\t本公司\t董事长\t正厅\t主方'} onChange={(event) => { rawTextRef.current = event.target.value; setRawText(event.target.value); onStatusChange({ dirty: snapshot(draft) !== baseline.current || Boolean(event.target.value.trim()), busy }); }} />
        <button className="assistant-button secondary" disabled={busy || !rawText.trim()} onClick={() => { try { applyImport(parseSeatingText(rawText)); } catch (error) { setNotice(error instanceof Error ? error.message : "名单解析失败"); } }}>读取并核对名单</button>
      </details>
      <fieldset className="seating-person-fields" disabled={busy}><div className="seating-scroll"><table className="seating-people-table"><thead><tr><th>姓名 *</th><th>单位</th><th>职务</th><th>职级</th><th>权重（越大越优先）</th><th>所属方</th><th aria-label="操作" /></tr></thead><tbody>
        {draft.participants.map((person, index) => <tr key={person.id}>
          <td><ContactAutocomplete ariaLabel={`座次第 ${index + 1} 人姓名`} value={person.name} onChange={(name) => patchPerson(person.id, { name })} onSelect={(contact) => patchPerson(person.id, { name: contact.name, unit: contact.unit, title: contact.title })} /></td>
          <td><input aria-label={`座次第 ${index + 1} 人单位`} value={person.unit} maxLength={200} disabled={busy} onChange={(event) => patchPerson(person.id, { unit: event.target.value })} /></td>
          <td><input aria-label={`座次第 ${index + 1} 人职务`} value={person.title} maxLength={120} disabled={busy} onChange={(event) => patchPerson(person.id, { title: event.target.value })} /></td>
          <td><input aria-label={`座次第 ${index + 1} 人职级`} value={person.grade} maxLength={120} disabled={busy} placeholder="例如：正厅" onChange={(event) => patchPerson(person.id, { grade: event.target.value })} /></td>
          <td><input aria-label={`座次第 ${index + 1} 人权重`} type="number" min={0} max={10000} value={person.weight ?? ""} disabled={busy} placeholder={String(seatingWeight(person, config.rosterRules).value)} onChange={(event) => patchPerson(person.id, { weight: event.target.value === "" ? null : Number(event.target.value) })} /><small>{person.weight === null ? "自动建议，可覆盖" : "人工指定"}</small></td>
          <td><select aria-label={`座次第 ${index + 1} 人所属方`} value={person.party} disabled={busy} onChange={(event) => patchPerson(person.id, { party: event.target.value as SeatingPerson["party"] })}><option value="auto">自动（{effectiveSeatingParty(person, draft.options, config.rosterRules) === "host" ? "主方" : "客方"}）</option><option value="host">主方</option><option value="guest">客方</option></select></td>
          <td><button className="seating-delete" aria-label={`删除座次第 ${index + 1} 人`} disabled={busy} onClick={() => commit({ ...draft, participants: draft.participants.filter((entry) => entry.id !== person.id), options: { ...draft.options, moderatorId: draft.options.moderatorId === person.id ? "" : draft.options.moderatorId }, plan: null })}><Trash2 size={15} /></button></td>
        </tr>)}
        {!draft.participants.length ? <tr><td colSpan={7} className="seating-empty">先导入名单、使用会议人员或手动添加。无需先启用正式名单治理。</td></tr> : null}
      </tbody></table></div></fieldset>
      <div className="seating-step-heading"><b>2</b><h3>选择会议形式与座次规则</h3></div>
      <div className="seating-settings">
        <label><span>会议形式</span><select value={draft.options.template} disabled={busy} onChange={(event) => { const template = event.target.value as SeatingOptions["template"]; patchOptions({ template, ...(template === "podium-double" && draft.options.rowCapacity % 2 ? { rowCapacity: 10 } : {}) }); }}>{Object.entries(SEATING_TEMPLATE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <label><span>本公司全称（自动识别主方）</span><input value={draft.options.hostCompany} maxLength={200} disabled={busy} onChange={(event) => patchOptions({ hostCompany: event.target.value })} /></label>
        <label><span>门的位置（图示）</span><select value={draft.options.door} disabled={busy} onChange={(event) => patchOptions({ door: event.target.value as SeatingOptions["door"] })}><option value="bottom">图下方</option><option value="top">图上方</option></select></label>
        <label><span>主位规则</span><select value={draft.options.anchorMode} disabled={busy} onChange={(event) => patchOptions({ anchorMode: event.target.value as SeatingOptions["anchorMode"] })}><option value="host-first">本方主位优先，主宾紧邻</option><option value="rank-first">全体职级 / 权重优先</option></select></label>
        <label><span>主持人（排在主方末位）</span><select value={draft.options.moderatorId} disabled={busy} onChange={(event) => patchOptions({ moderatorId: event.target.value })}><option value="">不指定 / 无主持人</option>{draft.participants.filter((person) => effectiveSeatingParty(person, draft.options, config.rosterRules) === "host").map((person) => <option key={person.id} value={person.id}>{person.name || "（姓名待填）"}</option>)}</select></label>
        {draft.options.template.startsWith("podium") ? <label><span>每排最多人数</span><input type="number" min={1} max={30} value={draft.options.rowCapacity} disabled={busy} onChange={(event) => patchOptions({ rowCapacity: Number(event.target.value) })} /></label> : null}
        {draft.options.template.startsWith("table") ? <label><span>会谈中心形式</span><select value={draft.options.tableCenter} disabled={busy} onChange={(event) => patchOptions({ tableCenter: event.target.value as SeatingOptions["tableCenter"] })}><option value="auto">自动选择单 / 双中心</option><option value="single">单中心</option><option value="double">双中心</option></select></label> : null}
        <label><span>双中心最大权重差</span><input type="number" min={0} max={10000} value={draft.options.closeThreshold} disabled={busy} onChange={(event) => patchOptions({ closeThreshold: Number(event.target.value) })} /></label>
      </div>
      <div className="seating-generate"><p>默认：2 号位于就座者左手侧（图上右侧）。未识别职级不会凭空补全；同权重保留名单次序。</p><button className="assistant-button primary" disabled={busy || !draft.participants.length} onClick={generate}><WandSparkles size={17} />一键生成座次</button></div>
      {draft.plan ? <>
        <div className="seating-step-heading"><b>3</b><h3>核对座次与导出</h3>{draft.plan.manualAdjusted ? <span>已人工调整</span> : null}</div>
        {draft.plan.warnings.length ? <div className="seating-warnings"><strong>需要核对</strong><ul>{draft.plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div> : null}
        <div className="seating-diagram" aria-label="座次示意图">
          {draft.options.door === "top" ? door : null}
          {draft.options.template === "round" ? <div className="seating-round" style={{ width: Math.max(680, draft.plan.seats.length * 42), height: Math.max(680, draft.plan.seats.length * 42) }}><div className="seating-round-table">圆桌</div>{draft.plan.seats.map((seat) => {
            const angle = seat.position / draft.plan!.seats.length * Math.PI * 2 + (draft.options.door === "bottom" ? -Math.PI / 2 : Math.PI / 2);
            return <div key={seat.id} className={`seating-chair ${seat.labels.length ? "is-key" : ""}`} style={{ left: `${50 + 41 * Math.cos(angle)}%`, top: `${50 + 41 * Math.sin(angle)}%` }}><b>{seat.seatNumber}</b><span>{people.get(seat.personId ?? "")?.name}</span><small>{seat.labels.join(" / ")}</small></div>;
          })}</div> : groups.map((row, index) => <div className="seating-row-block" key={row}>
            <span>{draft.plan?.seats.find((seat) => seat.row === row)?.group}</span>
            <div className="seating-row">{draft.plan?.seats.filter((seat) => seat.row === row).sort((a, b) => a.position - b.position).map((seat) => <div key={seat.id} className={`seating-chair ${seat.labels.length ? "is-key" : ""} ${seat.personId === null ? "is-empty" : ""}`}><b>{seat.seatNumber || "留空"}</b><span>{people.get(seat.personId ?? "")?.name ?? "空席"}</span><small>{seat.labels.join(" / ") || (seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : "")}</small></div>)}</div>
            {draft.options.template.startsWith("table") && index === 0 ? <div className="seating-rectangle">会谈桌</div> : null}
          </div>)}
          {draft.options.door === "bottom" ? door : null}
          <p>{draft.plan.explanation}</p>
        </div>
        <div className="seating-scroll"><table className="seating-result-table"><thead><tr><th>排 / 方</th><th>座位号</th><th>姓名（可交换席位）</th><th>单位</th><th>职务 / 职级</th><th>所属方</th><th>席位标签</th></tr></thead><tbody>
          {[...draft.plan.seats].sort((a, b) => a.row - b.row || a.position - b.position).map((seat) => { const person = people.get(seat.personId ?? ""); return <tr key={seat.id}><td>{seat.group}</td><td>{seat.seatNumber || "—"}</td><td>{person ? <select aria-label={`座位 ${seat.seatNumber} 人员`} value={person.id} disabled={busy} onChange={(event) => { try { commit({ ...draft, plan: swapSeatingPeople(draft.plan!, seat.id, event.target.value) }, "已交换两人的席位；请核对所属方和席位标签。"); } catch (error) { setNotice(error instanceof Error ? error.message : "席位调整失败"); } }}>{draft.participants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.unit || "单位未填"}</option>)}</select> : "（留空席）"}</td><td>{person?.unit}</td><td>{[person?.title, person?.grade].filter(Boolean).join(" / ")}</td><td>{seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : ""}</td><td>{seat.labels.join(" / ")}</td></tr>; })}
        </tbody></table></div>
      </> : null}
      {dirty ? <div className="seating-reset"><button className="assistant-button secondary" disabled={busy} onClick={() => {
        if (!window.confirm("放弃未保存的座次草稿并重新读取已保存座次？")) return;
        const next = fromMeeting(meeting, config.organization.name); baseline.current = snapshot(next); persistedPlan.current = JSON.stringify(meeting.seatingPlan ?? null); latestDraft.current = next;
        setBaselineValue(snapshot(next)); rawTextRef.current = ""; setDraft(next); setRawText(""); setNotice(""); onStatusChange({ dirty: false, busy: false });
      }}>放弃草稿，重新读取</button></div> : null}
    </section>
  );
}

export function SeatingPlanReview({ plan }: { plan: SeatingPlan }) {
  const people = new Map(plan.participants.map((person) => [person.id, person]));
  return <section className="seating-assistant-review"><h3>{SEATING_TEMPLATE_LABELS[plan.options.template]} · {plan.participants.length} 人</h3>
    <p>{plan.explanation}</p>
    {plan.warnings.length ? <ul className="seating-warnings">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    <div className="seating-scroll"><table className="seating-result-table"><thead><tr><th>排 / 方</th><th>座位号</th><th>姓名</th><th>单位</th><th>职务</th><th>所属方</th><th>席位标签</th></tr></thead><tbody>
      {[...plan.seats].sort((a, b) => a.row - b.row || a.position - b.position).map((seat) => { const person = people.get(seat.personId ?? ""); return <tr key={seat.id}><td>{seat.group}</td><td>{seat.seatNumber || "—"}</td><td>{person?.name ?? "（留空席）"}</td><td>{person?.unit}</td><td>{person?.title}</td><td>{seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : ""}</td><td>{seat.labels.join(" / ")}</td></tr>; })}
    </tbody></table></div>
  </section>;
}
