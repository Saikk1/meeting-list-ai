"use client";

import { useAssistantWorkspace } from "./use-assistant-workspace";
import { validateSeatingOptions, validateSeatingPeople } from "../../scripts/seating-schema.mjs";
import { ArrowLeftRight, Download, LockKeyhole, Plus, Redo2, Save, Search, Trash2, Undo2, UnlockKeyhole, Upload, WandSparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AdminConfig } from "../lib/admin-config";
import { confirmAction } from "../lib/confirmation";
import type { MeetingRecord } from "../lib/meeting-data";
import { applyMeetingRoomTableType, MEETING_ROOM_TABLE_TYPES } from "../lib/meeting-room-layout";
import { buildSeatingXlsx, defaultSeatingOptions, effectiveSeatingParty, parseSeatingTables, parseSeatingText, regenerateSeatingPlan, seatingWeight, SEATING_TEMPLATE_LABELS, swapSeatingPeople, toggleSeatingLock, type SeatingOptions, type SeatingPerson, type SeatingPlan } from "../lib/seating";
import { ContactAutocomplete } from "./contact-autocomplete";
import { SeatingCanvas } from "./seating-canvas";
import "./seating-planner.css";

type Draft = { participants: SeatingPerson[]; options: SeatingOptions; plan: SeatingPlan | null; roomId: string };
function fromMeeting(meeting: MeetingRecord, config: AdminConfig): Draft {
  if (meeting.seatingPlan) return { participants: meeting.seatingPlan.participants, options: meeting.seatingPlan.options, plan: meeting.seatingPlan, roomId: meeting.seatingPlan.roomId ?? meeting.meetingRoomId ?? "" };
  const room = config.meetingRooms.find((entry) => entry.id === meeting.meetingRoomId);
  return { participants: meeting.attendees.map((person) => ({ id: person.id, name: person.name, unit: person.unit, title: person.title, grade: "", weight: null, party: "auto" })), options: applyMeetingRoomTableType(defaultSeatingOptions(config.organization.name), room), plan: null, roomId: meeting.meetingRoomId ?? "" };
}
function snapshot(draft: Draft) { return JSON.stringify(draft); }
function newPerson(): SeatingPerson { return { id: `seat-person-${crypto.randomUUID()}`, name: "", unit: "", title: "", grade: "", weight: null, party: "auto" }; }

export function SeatingPlanner({ meeting, config, onSave, onStatusChange }: {
  meeting: MeetingRecord; config: AdminConfig;
  onSave: (plan: SeatingPlan) => Promise<void>;
  onStatusChange: (status: { dirty: boolean; busy: boolean }) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => fromMeeting(meeting, config));
  const baseline = useRef(snapshot(draft));
  const [baselineValue, setBaselineValue] = useState(snapshot(draft));
  const persistedPlan = useRef(JSON.stringify(meeting.seatingPlan ?? null));
  const latestDraft = useRef(draft);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [rawText, setRawText] = useState("");
  const rawTextRef = useRef("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [personPage, setPersonPage] = useState(0);
  const [selectedPersonId, setSelectedPersonId] = useState("");
  const [selectedSeatId, setSelectedSeatId] = useState("");
  const [swapSourceId, setSwapSourceId] = useState("");
  const [view, setView] = useState<"map" | "table">("map");
  const history = useRef<{ past: Draft[]; future: Draft[] }>({ past: [], future: [] });
  const [historyCounts, setHistoryCounts] = useState({ past: 0, future: 0 });
  const dirty = snapshot(draft) !== baselineValue || Boolean(rawText.trim());
  const stale = Boolean(draft.plan && (JSON.stringify(draft.participants) !== JSON.stringify(draft.plan.participants) || JSON.stringify(draft.options) !== JSON.stringify(draft.plan.options)));
  const ready = Boolean(draft.plan && !stale && !rawText.trim());
  const room = config.meetingRooms.find((entry) => entry.id === draft.roomId);
  const person = draft.participants.find((entry) => entry.id === selectedPersonId);
  const selectedSeat = draft.plan?.seats.find((entry) => entry.id === selectedSeatId);
  const locked = draft.plan?.lockedSeatIds?.includes(selectedSeatId) ?? false;
  const locks = draft.plan?.lockedSeatIds?.length ?? 0;

  const workspaceId = useAssistantWorkspace({
    suffix: "seating", kind: "seating", meetingId: meeting.id, label: meeting.title + " · 座次工作区", dirty,
    data: { draft, rawText, selectedPersonId, selectedSeatId }, editableFields: ["participants", "options", "rawText"], modes: ["draft"],
    apply: (patch) => {
      if (busy) throw new Error("座次正在处理");
      const participants = patch.participants === undefined ? draft.participants : validateSeatingPeople(patch.participants);
      const options = patch.options === undefined ? draft.options : validateSeatingOptions(patch.options);
      if (patch.rawText !== undefined) {
        if (typeof patch.rawText !== "string" || patch.rawText.length > 60000) throw new Error("座次原始名单无效");
        rawTextRef.current = patch.rawText; setRawText(patch.rawText);
      }
      const plan = regenerateSeatingPlan(participants, options, config.rosterRules, draft.plan);
      commit({ ...draft, participants: plan.participants, options: plan.options, plan: { ...plan, roomId: draft.roomId } }, "AI 修改已采用，请核对后保存");
      return "已更新当前座次草稿，尚未保存，原参会名单未修改";
    },
  });

  // Activity resumes effects, but only a clean workspace may adopt externally saved data.
  useEffect(() => {
    const signature = JSON.stringify(meeting.seatingPlan ?? null);
    if (snapshot(fromMeeting(meeting, config)) === baseline.current || snapshot(latestDraft.current) !== baseline.current || busyRef.current || rawTextRef.current.trim()) return;
    const timer = window.setTimeout(() => {
      if (snapshot(latestDraft.current) !== baseline.current || busyRef.current || rawTextRef.current.trim()) return;
      const next = fromMeeting(meeting, config);
      baseline.current = snapshot(next); latestDraft.current = next; persistedPlan.current = signature;
      setBaselineValue(snapshot(next)); setDraft(next); history.current = { past: [], future: [] };
      setHistoryCounts({ past: 0, future: 0 }); setSelectedPersonId(""); setSelectedSeatId(""); setSwapSourceId("");
      onStatusChange({ dirty: false, busy: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [config, meeting, onStatusChange, dirty, busy]);

  function commit(next: Draft, message = "", record = true) {
    if (record && snapshot(next) !== snapshot(latestDraft.current)) {
      history.current.past = [...history.current.past.slice(-59), latestDraft.current]; history.current.future = [];
      setHistoryCounts({ past: history.current.past.length, future: 0 });
    }
    latestDraft.current = next; setDraft(next); setNotice(message); setSwapSourceId("");
    onStatusChange({ dirty: snapshot(next) !== baseline.current || Boolean(rawTextRef.current.trim()), busy: busyRef.current });
  }
  function travel(direction: "past" | "future") {
    const stack = history.current[direction]; const next = stack.at(-1); if (!next || busy) return;
    stack.pop(); history.current[direction === "past" ? "future" : "past"].push(latestDraft.current);
    setHistoryCounts({ past: history.current.past.length, future: history.current.future.length }); commit(next, direction === "past" ? "已撤销上一步。" : "已重做。", false);
  }
  function setProcessing(value: boolean) {
    busyRef.current = value; setBusy(value);
    onStatusChange({ dirty: snapshot(latestDraft.current) !== baseline.current || Boolean(rawTextRef.current.trim()), busy: value });
  }
  function patchPerson(id: string, patch: Partial<SeatingPerson>) {
    commit({ ...draft, participants: draft.participants.map((entry) => entry.id === id ? { ...entry, ...patch } : entry) });
  }
  function patchOptions(patch: Partial<SeatingOptions>) { commit({ ...draft, options: { ...draft.options, ...patch } }); }
  function chooseRoom(roomId: string) {
    const selectedRoom = config.meetingRooms.find((entry) => entry.id === roomId);
    const options = applyMeetingRoomTableType(draft.options, selectedRoom);
    const changedLayout = options.template !== draft.options.template;
    commit({ ...draft, roomId, options }, selectedRoom?.tableType && selectedRoom.tableType !== "unconfigured"
      ? `已带入会议室桌型：${MEETING_ROOM_TABLE_TYPES[selectedRoom.tableType]}。${changedLayout && locks ? "布局已变更，请先解除锁定再重新生成。" : "可按本次会议临时调整布局。"}`
      : "此会议室未配置桌型，保留当前布局；可在管理中心配置。");
  }
  function selectSeat(id: string) {
    const personId = draft.plan?.seats.find((entry) => entry.id === id)?.personId ?? "";
    setSelectedSeatId(id); setSelectedPersonId(personId); setSwapSourceId("");
    setQuery(""); setPersonPage(Math.max(0, Math.floor(draft.participants.findIndex((entry) => entry.id === personId) / 6)));
  }
  function selectPerson(id: string) {
    setSelectedPersonId(id); setSelectedSeatId(draft.plan?.seats.find((entry) => entry.personId === id)?.id ?? ""); setSwapSourceId("");
  }
  function swap(sourceId: string, targetId: string) {
    if (!ready || busy || !draft.plan) return;
    const source = draft.plan.seats.find((entry) => entry.id === sourceId);
    if (!source?.personId) return;
    try {
      const plan = swapSeatingPeople(draft.plan, targetId, source.personId);
      commit({ ...draft, plan }, "已交换席位，请核对主位、主宾及主客方朝向。");
      setSelectedSeatId(targetId); setSelectedPersonId(source.personId);
    } catch (error) { setNotice(error instanceof Error ? error.message : "交换失败"); setSwapSourceId(""); }
  }
  async function approveReplace() {
    return !draft.participants.length || await confirmAction("将替换座次工作区人员，清除当前预览及锁定。会议原参会人员不会修改。是否继续？");
  }
  async function applyImport(result: ReturnType<typeof parseSeatingText>) {
    if (!result.people.length) throw new Error("名单中未找到参会人员");
    if (!await approveReplace()) return;
    rawTextRef.current = ""; setRawText("");
    commit({ ...draft, participants: result.people, options: { ...draft.options, moderatorId: result.moderatorId }, plan: null }, `已导入 ${result.people.length} 人，请核对所属方和排序依据。`);
    setSelectedPersonId(result.people[0]?.id ?? ""); setSelectedSeatId("");
  }
  async function importFile(file: File) {
    setProcessing(true);
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error("文件最大 20 MB");
      const extension = file.name.split(".").pop()?.toLowerCase();
      if (["xlsx", "xls", "csv"].includes(extension ?? "")) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
        await applyImport(parseSeatingTables(workbook.SheetNames.map((name) => XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" }))));
      } else if (extension === "docx") {
        const mammoth = await import("mammoth"); const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
        const document = new DOMParser().parseFromString(result.value, "text/html");
        const tables = Array.from(document.querySelectorAll("table")).map((table) => Array.from(table.querySelectorAll("tr")).map((row) => Array.from(row.querySelectorAll("td,th")).map((cell) => cell.textContent ?? "")));
        if (!tables.length) throw new Error("Word 中未找到名单表格，请粘贴名单或使用 Excel");
        await applyImport(parseSeatingTables(tables));
      } else if (["txt", "md", "tsv"].includes(extension ?? "")) await applyImport(parseSeatingText(await file.text()));
      else throw new Error("请使用 Excel、CSV、Word 表格或文本名单");
    } catch (error) { setNotice(error instanceof Error ? error.message : "导入失败"); }
    finally { setProcessing(false); if (fileInput.current) fileInput.current.value = ""; }
  }
  function generate() {
    try {
      if (rawText.trim()) throw new Error("请先读取或清空粘贴名单，再生成座次");
      const plan = { ...regenerateSeatingPlan(draft.participants, draft.options, config.rosterRules, draft.plan), roomId: draft.roomId };
      commit({ ...draft, participants: plan.participants, options: plan.options, plan }, locks ? "已重新生成，并保留锁定席位，请核对后保存。" : "座次建议已生成，可以在图上调整，确认后保存。");
      setView("map"); setSelectedSeatId(""); setSelectedPersonId("");
    } catch (error) { setNotice(error instanceof Error ? error.message : "生成失败"); }
  }
  async function save() {
    if (!ready || !draft.plan) return;
    if (persistedPlan.current !== JSON.stringify(meeting.seatingPlan ?? null)) { setNotice("座次已被助手或其他操作更新，请先重新读取，避免覆盖。"); return; }
    setProcessing(true);
    try {
      const plan = { ...draft.plan, roomId: draft.roomId }; const next = { ...draft, plan };
      await onSave(plan); latestDraft.current = next; setDraft(next);
      baseline.current = snapshot(next); persistedPlan.current = JSON.stringify(plan); setBaselineValue(snapshot(next));
      setNotice("已保存本会议座次；原参会人员名单未修改。");
    } catch (error) { setNotice(error instanceof Error ? error.message : "保存失败"); }
    finally { setProcessing(false); }
  }
  async function download() {
    if (!ready || !draft.plan) return;
    setProcessing(true);
    try {
      const bytes = await buildSeatingXlsx(draft.plan);
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, "_")}_座次表.xlsx`; anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(error instanceof Error ? error.message : "导出失败"); }
    finally { setProcessing(false); }
  }
  async function reset() {
    if (!await confirmAction("放弃未保存的座次草稿并重新读取已保存方案？")) return;
    const next = fromMeeting(meeting, config); baseline.current = snapshot(next); persistedPlan.current = JSON.stringify(meeting.seatingPlan ?? null);
    setBaselineValue(snapshot(next)); rawTextRef.current = ""; setRawText(""); history.current = { past: [], future: [] };
    setHistoryCounts({ past: 0, future: 0 }); commit(next, "已重新读取已保存方案。", false); setSelectedPersonId(""); setSelectedSeatId("");
  }
  const filteredPeople = draft.participants.filter((entry) => `${entry.name} ${entry.unit} ${entry.title}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pageCount = Math.max(1, Math.ceil(filteredPeople.length / 6));
  const visiblePage = Math.min(personPage, pageCount - 1);
  const weight = person ? seatingWeight(person, config.rosterRules) : null;
  return <section data-assistant-workspace={workspaceId} className="seating-panel assistant-panel">
    <header className="seating-header"><div><span>SEATING WORKSPACE</span><h2>座次工作台</h2><p>先核对人员，再生成建议；关键席位可锁定，最终由会务人员确认。</p></div>
      <div className="seating-actions">
        <button type="button" className="assistant-button secondary" disabled={busy || !ready} onClick={() => void download()}><Download size={16} />导出 Excel</button>
        <button type="button" className="assistant-button primary" disabled={busy || !ready || !dirty} onClick={() => void save()}><Save size={16} />{busy ? "处理中…" : "保存座次"}</button>
      </div>
    </header>
    <div className="seating-toolbar">
      <label><span>编排参考会议室</span><select aria-label="编排参考会议室" disabled={busy} value={draft.roomId} onChange={(event) => chooseRoom(event.target.value)}>
        <option value="">自定义场地 / 暂不选择</option>{config.meetingRooms.filter((entry) => entry.enabled || entry.id === draft.roomId).map((entry) => <option value={entry.id} key={entry.id}>{entry.name}{!entry.enabled ? "（已停用）" : ""}</option>)}
        {draft.roomId && !room ? <option value={draft.roomId}>原会议室（已移除）</option> : null}
      </select></label>
      <label><span>布局模板</span><select aria-label="布局模板" value={draft.options.template} disabled={busy} onChange={(event) => {
        const template = event.target.value as SeatingOptions["template"]; patchOptions({ template, ...(template === "podium-double" && draft.options.rowCapacity % 2 ? { rowCapacity: 10 } : {}) });
      }}>{Object.entries(SEATING_TEMPLATE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <button type="button" className="assistant-button primary" disabled={busy || !draft.participants.length} onClick={generate}><WandSparkles size={16} />{draft.plan ? "重新生成" : "生成座次"}</button>
    </div>
    <div className="seating-room-info"><span>{room ? [room.location, room.areaSqm ? `${room.areaSqm}㎡` : "", room.tableDimensions ? `会议桌 ${room.tableDimensions}` : "", `桌型：${MEETING_ROOM_TABLE_TYPES[room.tableType ?? "unconfigured"]}`, room.capacity > 0 ? `登记容量 ${room.capacity} 人` : "容量未登记"].filter(Boolean).join(" · ") : "未选择参考会议室"} · 图示不按实测尺寸绘制</span><span>{draft.participants.length} 人 · {locks} 席锁定</span></div>
    {room && room.capacity > 0 && draft.participants.length > room.capacity ? <div className="seating-warnings" role="alert">当前 {draft.participants.length} 人超过会议室登记容量 {room.capacity} 人，请确认场地；不自动删减人员。</div> : null}
    {room && !room.enabled ? <div className="seating-warnings" role="alert">参考会议室已停用，请另选可用场地。</div> : null}
    {notice ? <div className="seating-notice" role="status">{notice}</div> : null}
    {stale ? <div className="seating-warnings" role="status">人员或规则已修改，图中仍为上次方案。请重新生成后再调位、保存或导出；锁定与草稿不会自动丢失。</div> : null}
    <div className="seating-workspace">
      <aside className="seating-person-panel">
        <div className="seat-panel-heading"><h3>参会人员</h3><span>{draft.participants.length}</span></div>
        <div className="seating-source-actions">
          <button type="button" disabled={busy || !meeting.attendees.length} onClick={async () => {
            if (!await approveReplace()) return;
            const next = fromMeeting({ ...meeting, seatingPlan: undefined }, config);
            commit({ ...draft, participants: next.participants, plan: null, options: { ...draft.options, moderatorId: "" } }, "已读取会议人员，请核对所属方和排序依据。"); setSelectedSeatId(""); setSelectedPersonId(next.participants[0]?.id ?? "");
          }}>读取会议人员</button>
          <button type="button" disabled={busy} onClick={() => fileInput.current?.click()}><Upload size={14} />导入</button>
          <button type="button" aria-label="添加座次人员" disabled={busy} onClick={() => { const entry = newPerson(); commit({ ...draft, participants: [...draft.participants, entry] }); selectPerson(entry.id); }}><Plus size={14} />添加</button>
          <input ref={fileInput} type="file" hidden accept=".xlsx,.xls,.csv,.docx,.txt,.md,.tsv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
        </div>
        <label className="seat-search"><Search size={15} /><input aria-label="搜索座次人员" placeholder="搜索姓名、单位或职务" value={query} onChange={(event) => { setQuery(event.target.value); setPersonPage(0); }} /></label>
        <div className="seat-person-list">{filteredPeople.slice(visiblePage * 6, visiblePage * 6 + 6).map((entry) => {
          const party = effectiveSeatingParty(entry, draft.options, config.rosterRules); const rank = seatingWeight(entry, config.rosterRules);
          const seat = draft.plan?.seats.find((item) => item.personId === entry.id);
          return <button type="button" key={entry.id} className={selectedPersonId === entry.id ? "selected" : ""} onClick={() => selectPerson(entry.id)}>
            <div><strong>{entry.name || "姓名待填"}</strong><span className={`seat-party ${party}`}>{party === "host" ? "主方" : "客方"}</span></div>
            <small>{entry.unit || "单位未填"}</small><small>{entry.title || "职务未填"}{!rank.known ? " · 顺序待核对" : ""}</small>
            {seat ? <span className="seat-person-position">{seat.seatNumber}号{draft.plan?.lockedSeatIds?.includes(seat.id) ? " · 锁定" : ""}</span> : null}
          </button>;
        })}{!filteredPeople.length ? <p className="seating-empty">{draft.participants.length ? "没有匹配人员" : "读取会议人员，或添加、导入名单。"}</p> : null}</div>
        {pageCount > 1 ? <div className="seat-person-pages"><button type="button" disabled={visiblePage === 0} onClick={() => setPersonPage(visiblePage - 1)}>上一页</button><span>{visiblePage + 1} / {pageCount}</span><button type="button" disabled={visiblePage === pageCount - 1} onClick={() => setPersonPage(visiblePage + 1)}>下一页</button></div> : null}
        <details className="seating-import"><summary>粘贴名单</summary><textarea aria-label="粘贴座次名单" rows={5} maxLength={100000} disabled={busy} value={rawText} placeholder={"姓名\t单位\t职务\t职级\t所属方\n示例甲\t本公司\t负责人\t\t主方"} onChange={(event) => { rawTextRef.current = event.target.value; setRawText(event.target.value); onStatusChange({ dirty: snapshot(draft) !== baseline.current || Boolean(event.target.value.trim()), busy }); }} /><button type="button" disabled={busy || !rawText.trim()} onClick={async () => { setProcessing(true); try { await applyImport(parseSeatingText(rawText)); } catch (error) { setNotice(error instanceof Error ? error.message : "解析失败"); } finally { setProcessing(false); } }}>读取并核对</button><small>支持 Markdown 表格、制表符分列；导入会替换座次人员。</small></details>
      </aside>
      <div className="seating-main-panel">
        <div className="seat-main-heading"><div className="seat-view-tabs"><button type="button" className={view === "map" ? "active" : ""} onClick={() => setView("map")}>座次图</button><button type="button" className={view === "table" ? "active" : ""} onClick={() => setView("table")}>分组表格</button></div><div className="seat-history">
          <button type="button" aria-label="撤销座次操作" disabled={busy || !historyCounts.past} onClick={() => travel("past")}><Undo2 size={16} /></button>
          <button type="button" aria-label="重做座次操作" disabled={busy || !historyCounts.future} onClick={() => travel("future")}><Redo2 size={16} /></button>
        </div></div>
        {draft.plan ? view === "map" ? <SeatingCanvas plan={draft.plan} selectedId={selectedSeatId} swapSourceId={swapSourceId} disabled={busy || !ready} onSelect={selectSeat} onSwap={swap} /> : <SeatingResultTable plan={draft.plan} onSelect={selectSeat} selectedId={selectedSeatId} /> : <div className="seat-canvas-empty"><div>座次图将在这里生成</div><p>1. 读取或添加人员<br />2. 选择布局，核对规则<br />3. 生成建议，在图上调整</p><button type="button" className="assistant-button primary" disabled={busy || !draft.participants.length} onClick={generate}><WandSparkles size={16} />生成座次建议</button></div>}
        {swapSourceId ? <div className="seating-notice">请选择要交换的另一席。<button type="button" onClick={() => setSwapSourceId("")}>取消交换</button></div> : null}
        {draft.plan ? <details className="seat-evidence"><summary>排座依据与核对提醒{draft.plan.warnings.length ? `（${draft.plan.warnings.length}）` : ""}</summary><p>{draft.plan.explanation}</p><ul>{draft.plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
      </div>
      <aside className="seating-inspector">
        <div className="seat-panel-heading"><h3>{selectedSeat?.personId === person?.id && person ? `${selectedSeat?.seatNumber}号席位` : "人员与规则"}</h3>{selectedSeat && locked ? <LockKeyhole size={15} /> : null}</div>
        {person ? <>
          {selectedSeat && selectedSeat.personId === person.id ? <div className="seat-selected-summary"><span>{selectedSeat.group}</span><strong>{person.name || "姓名待填"}</strong><small>{selectedSeat.labels.join(" · ") || "普通席位"}</small><div>
            <button type="button" disabled={busy || !ready || locked} onClick={() => setSwapSourceId(selectedSeat.id)}><ArrowLeftRight size={14} />交换席位</button>
            <button type="button" disabled={busy || !draft.plan} onClick={() => { if (draft.plan) commit({ ...draft, plan: toggleSeatingLock(draft.plan, selectedSeat.id) }, locked ? "已解锁席位。" : "已锁定人员与物理位置，重新生成时将保留。"); }}>{locked ? <UnlockKeyhole size={14} /> : <LockKeyhole size={14} />}{locked ? "解锁" : "锁定"}</button>
          </div></div> : null}
          <fieldset className="seat-person-editor" disabled={busy}>
            <label><span>姓名 *</span><ContactAutocomplete ariaLabel="座次人员姓名" value={person.name} onChange={(name) => patchPerson(person.id, { name })} onSelect={(contact) => patchPerson(person.id, { name: contact.name, unit: contact.unit, title: contact.title })} /></label>
            <label><span>单位</span><input aria-label="座次人员单位" maxLength={200} value={person.unit} onChange={(event) => patchPerson(person.id, { unit: event.target.value })} /></label>
            <label><span>职务</span><input aria-label="座次人员职务" maxLength={120} value={person.title} onChange={(event) => patchPerson(person.id, { title: event.target.value })} /></label>
            <label><span>所属方</span><select aria-label="座次人员所属方" value={person.party} onChange={(event) => patchPerson(person.id, { party: event.target.value as SeatingPerson["party"] })}><option value="auto">自动（{effectiveSeatingParty(person, draft.options, config.rosterRules) === "host" ? "主方" : "客方"}）</option><option value="host">主方</option><option value="guest">客方</option></select></label>
            <details><summary>职级与人工权重</summary>
              <label><span>职级</span><input aria-label="座次人员职级" maxLength={120} placeholder="可留空" value={person.grade} onChange={(event) => patchPerson(person.id, { grade: event.target.value })} /></label>
              <label><span>人工权重（越大越优先）</span><input aria-label="座次人员权重" type="number" min={0} max={10000} value={person.weight ?? ""} placeholder={String(weight?.value ?? 0)} onChange={(event) => patchPerson(person.id, { weight: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <p>{weight?.evidence}。行政职级与公司职务不天然等价，请人工校准。</p>
            </details>
            <button type="button" className="seat-remove-person" disabled={busy} onClick={() => {
              if (draft.plan?.seats.some((seat) => seat.personId === person.id && draft.plan?.lockedSeatIds?.includes(seat.id))) { setNotice("此人员所在席位已锁定，请先解锁再删除。"); return; }
              commit({ ...draft, participants: draft.participants.filter((entry) => entry.id !== person.id), options: { ...draft.options, moderatorId: draft.options.moderatorId === person.id ? "" : draft.options.moderatorId } }); setSelectedPersonId(""); setSelectedSeatId("");
            }}><Trash2 size={14} />删除此人员</button>
          </fieldset>
        </> : <p className="seat-inspector-placeholder">点击左侧人员或图中座位查看详情、修改信息和调整座位。</p>}
        <details className="seat-rule-settings" open={!draft.plan}>
          <summary>排座规则</summary><fieldset disabled={busy}>
            <label><span>入口位置（示意）</span><select aria-label="座次入口位置" value={draft.options.door} onChange={(event) => patchOptions({ door: event.target.value as SeatingOptions["door"] })}><option value="bottom">图下方</option><option value="top">图上方</option></select></label>
            <label><span>主位规则</span><select value={draft.options.anchorMode} onChange={(event) => patchOptions({ anchorMode: event.target.value as SeatingOptions["anchorMode"] })}><option value="host-first">本方主位优先</option><option value="rank-first">全体职级 / 权重优先</option></select></label>
            {draft.options.template.startsWith("podium") ? <label><span>每排最多人数</span><input type="number" min={1} max={30} value={draft.options.rowCapacity} onChange={(event) => patchOptions({ rowCapacity: Number(event.target.value) })} /></label> : null}
            {draft.options.template.startsWith("table") ? <label><span>中心形式</span><select value={draft.options.tableCenter} onChange={(event) => patchOptions({ tableCenter: event.target.value as SeatingOptions["tableCenter"] })}><option value="auto">自动单 / 双中心</option><option value="single">单中心</option><option value="double">双中心</option></select></label> : null}
            <label><span>主持人（主方末位）</span><select value={draft.options.moderatorId} onChange={(event) => patchOptions({ moderatorId: event.target.value })}><option value="">不指定</option>{draft.participants.filter((entry) => effectiveSeatingParty(entry, draft.options, config.rosterRules) === "host").map((entry) => <option key={entry.id} value={entry.id}>{entry.name || "姓名待填"}</option>)}</select></label>
            <details><summary>高级规则</summary><label><span>主方单位全称</span><input maxLength={200} value={draft.options.hostCompany} onChange={(event) => patchOptions({ hostCompany: event.target.value })} /></label><label><span>双中心最大权重差</span><input type="number" min={0} max={10000} value={draft.options.closeThreshold} onChange={(event) => patchOptions({ closeThreshold: Number(event.target.value) })} /></label></details>
          </fieldset>
          <p>2 号在就座者左手侧（单排图上右侧）；会谈双方按各自朝向镜像排列。同权重保留原顺序。</p>
        </details>
        {locks ? <button type="button" className="seat-unlock-all" disabled={busy} onClick={async () => {
          if (draft.plan && await confirmAction("解除全部锁定？当前排座不会改变。")) commit({ ...draft, plan: { ...draft.plan, lockedSeatIds: [] } }, "已解除全部锁定，当前位置不变。");
        }}><UnlockKeyhole size={14} />解除全部锁定（{locks}）</button> : null}
      </aside>
    </div>
    <footer className="seating-footer"><span>{dirty ? "有未保存修改" : draft.plan ? "已保存方案" : "尚未生成方案"} · 座次独立保存，不修改会议人员和正式名单</span>{dirty ? <button type="button" disabled={busy} onClick={reset}>放弃草稿，重新读取</button> : null}</footer>
  </section>;
}

function SeatingResultTable({ plan, onSelect, selectedId }: { plan: SeatingPlan; onSelect?: (id: string) => void; selectedId?: string }) {
  const people = new Map(plan.participants.map((person) => [person.id, person]));
  return <div className="seating-scroll"><table className="seating-result-table"><thead><tr><th>排 / 方</th><th>座位号</th><th>姓名</th><th>单位</th><th>职务 / 职级</th><th>所属方</th><th>席位标签</th></tr></thead><tbody>
    {[...plan.seats].sort((a, b) => a.row - b.row || a.position - b.position).map((seat) => {
      const person = people.get(seat.personId ?? "");
      return <tr key={seat.id} className={selectedId === seat.id ? "selected" : ""}><td>{seat.group}</td><td>{seat.seatNumber || "—"}</td><td>{person && onSelect ? <button type="button" onClick={() => onSelect(seat.id)}>{person.name}</button> : person?.name ?? "留空席"}</td><td>{person?.unit}</td><td>{[person?.title, person?.grade].filter(Boolean).join(" / ")}</td><td>{seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : ""}</td><td>{seat.labels.join(" / ")}{plan.lockedSeatIds?.includes(seat.id) ? " · 锁定" : ""}</td></tr>;
    })}
  </tbody></table></div>;
}

export function SeatingPlanReview({ plan }: { plan: SeatingPlan }) {
  return <section className="seating-assistant-review"><h3>{SEATING_TEMPLATE_LABELS[plan.options.template]} · {plan.participants.length} 人</h3><p>{plan.explanation}</p>
    {plan.warnings.length ? <ul className="seating-warnings">{plan.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : null}
    <SeatingResultTable plan={plan} />
  </section>;
}
