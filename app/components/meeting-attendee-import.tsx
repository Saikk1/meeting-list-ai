"use client";

import { useAssistantWorkspace } from "./use-assistant-workspace";
import { workspaceAttendees } from "../lib/assistant-workspace-validation";
import { ClipboardPaste, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { activeModelRequestConfig, loadAISettings } from "../lib/ai-settings";
import { appendRecognizedAttendees, recognizeMeetingAttendees } from "../lib/meeting-attendee-import";
import type { MeetingAttendee } from "../lib/meeting-data";
import type { PersonRecord } from "../lib/roster-parser";
import type { AdminConfig } from "../lib/admin-config";

export type AttendeeImportStatus = { dirty: boolean; busy: boolean };

export function MeetingAttendeeImport({
  value, onChange, disabled, config, configUnavailable, onStatusChange,
}: {
  value: MeetingAttendee[];
  onChange: (value: MeetingAttendee[]) => void;
  disabled: boolean;
  config: AdminConfig;
  configUnavailable: boolean;
  onStatusChange?: (status: AttendeeImportStatus) => void;
}) {
  const [text, setText] = useState("");
  const [records, setRecords] = useState<PersonRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const request = useRef<AbortController | null>(null);
  const dirty = Boolean(text.trim() || records.length);
  const workspaceId = useAssistantWorkspace({
    suffix: "attendee-import", kind: "attendees", label: "粘贴识别参会人员", dirty,
    data: { draft: { text, attendees: value }, recognized: records }, editableFields: ["text", "attendees"], modes: ["draft"],
    apply: (patch) => {
      if (disabled || busy) throw new Error("人员正在处理，请稍后重试");
      if (patch.text !== undefined) { if (typeof patch.text !== "string" || patch.text.length > 60000) throw new Error("粘贴内容无效"); setText(patch.text); setRecords([]); }
      if (patch.attendees !== undefined) { onChange(workspaceAttendees(patch.attendees)); setText(""); setRecords([]); }
      return "已采用到人员编辑区，尚未保存";
    },
  });
  useEffect(() => { onStatusChange?.({ dirty, busy }); }, [dirty, busy, onStatusChange]);
  useEffect(() => () => { request.current?.abort(); onStatusChange?.({ dirty: false, busy: false }); }, [onStatusChange]);

  async function recognize() {
    if (busy || disabled || configUnavailable) return;
    setBusy(true);
    setNotice("");
    setRecords([]);
    const controller = new AbortController();
    request.current = controller;
    const timer = window.setTimeout(() => controller.abort(), 65_000);
    try {
      const result = await recognizeMeetingAttendees(text, {
        config: activeModelRequestConfig(loadAISettings()),
        promptSuffix: config.rosterRules.extractionPromptSuffix,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setRecords(result.records);
      setNotice(result.records.length ? result.message : "未识别到有效人员，请检查内容；简单名单可用顿号分隔或每人一行。复杂段落请在智能助手的模型设置中配置 AI。");
    } catch (error) {
      setNotice(controller.signal.aborted ? "识别已超时，请重试或拆分名单。" : error instanceof Error ? error.message : "识别失败，请重试");
    } finally {
      window.clearTimeout(timer);
      request.current = null;
      setBusy(false);
    }
  }

  function confirm() {
    const result = appendRecognizedAttendees(value, records, config.rosterRules.aliases);
    if (result.added) onChange(result.attendees);
    setRecords([]);
    setText("");
    setNotice(`已添加 ${result.added} 人到当前表格${result.skipped ? `，跳过 ${result.skipped} 条同姓名、同单位的重复记录` : ""}。请核对表格并保存会议人员。`);
  }

  return (
    <details data-assistant-workspace={workspaceId} className="meeting-attendee-import">
      <summary><ClipboardPaste size={16} aria-hidden="true" /> 粘贴名单，批量添加</summary>
      <div className="meeting-attendee-import__body">
        <label>
          <span>粘贴一段人员介绍、姓名列表或 Excel 表格</span>
          <textarea
            aria-label="待识别的参会人员名单"
            rows={4}
            value={text}
            disabled={disabled || busy}
            placeholder={"例如：参会人员：张三、李四、王五\n也可以粘贴包含姓名、单位、部门、职务的整段文字或表格"}
            onChange={(event) => { setText(event.target.value); setRecords([]); setNotice(""); }}
          />
        </label>
        <small>使用现有 AI 模型设置；未配置时按本地规则识别。识别结果先预览，确认后添加到当前表格。</small>
        {configUnavailable ? <p role="alert">正在读取人员规则或读取失败，请稍后重试。</p> : null}
        <div className="meeting-attendee-import__actions">
          <button className="assistant-button secondary" type="button" disabled={disabled || busy || !text.trim() || configUnavailable} onClick={() => void recognize()}>
            <Sparkles size={16} aria-hidden="true" /> {busy ? "正在识别…" : "识别人员"}
          </button>
          <button className="assistant-button secondary" type="button" disabled={disabled || busy || !dirty} onClick={() => { setText(""); setRecords([]); setNotice(""); }}>清空</button>
        </div>
        {notice ? <p role="status">{notice}</p> : null}
        {records.length ? <>
          <strong>识别到 {records.length} 人，请核对后确认添加</strong>
          <div className="meeting-attendee-editor__table-wrap meeting-attendee-import__preview">
            <table>
              <thead><tr><th>姓名</th><th>单位</th><th>部门</th><th>职务</th><th>核对提醒</th></tr></thead>
              <tbody>{records.map((record) => <tr key={record.id}>
                <td>{record.name}</td><td>{record.unit || "待补充"}</td><td>{record.department || "—"}</td><td>{record.title || "—"}</td><td>{record.issues.join("；") || "—"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <button className="assistant-button primary" type="button" disabled={disabled || busy || configUnavailable} onClick={confirm}>确认添加到人员表</button>
          <small>添加后可逐项修改；同姓名且同单位的记录跳过，保留原有手填信息。单位缺失仍可保存到会议。</small>
        </> : null}
      </div>
    </details>
  );
}
