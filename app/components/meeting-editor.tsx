"use client";

import { AlertTriangle, Save, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { AdminConfig } from "../lib/admin-config";
import { confirmAction } from "../lib/confirmation";
import { useAssistantWorkspace } from "./use-assistant-workspace";
import { parseMeetingPatch } from "../lib/assistant-contract";
import { AppDialog } from "./app-dialog";
import { notifySaved } from "./app-feedback";
import { focusMeetingIssue } from "../lib/form-focus";
import { meetingRoomRequirements } from "../lib/builtin-meeting-rooms";
import {
  meetingRoomValidationIssues,
  updateMeetingFields,
  validateMeetingInput,
  type MeetingInput,
  type MeetingRecord,
} from "../lib/meeting-data";

function inputFromMeeting(meeting: MeetingRecord): MeetingInput {
  return {
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime ?? "",
    location: meeting.location,
    meetingRoomId: meeting.meetingRoomId,
    roomRequirements: meeting.roomRequirements ?? "",
    organizer: meeting.organizer,
    owner: meeting.owner,
    attendeeEstimate: meeting.attendeeEstimate,
    rosterRequired: meeting.rosterRequired,
    afternoonMeeting: meeting.afternoonMeeting,
    mealType: meeting.mealType,
    alcoholRequired: meeting.alcoholRequired,
    parkingRequired: meeting.parkingRequired,
    vehicleCount: meeting.vehicleCount,
    publicityRequired: meeting.publicityRequired,
    reimbursementRequired: meeting.reimbursementRequired,
    presentationRequired: meeting.presentationRequired,
    welcomeScreenRequired: meeting.welcomeScreenRequired,
    roomSize: meeting.roomSize,
  };
}

function meetingRoomLocation(name: string, location: string) {
  const cleanLocation = location.trim();
  return cleanLocation ? `${name.trim()}（${cleanLocation}）` : name.trim();
}

export function MeetingEditor({
  meeting,
  config,
  meetings,
  onClose,
  onSave,
  onDirtyChange,
  onBusyChange,
}: {
  meeting: MeetingRecord;
  config: AdminConfig;
  meetings: readonly MeetingRecord[];
  onClose: () => void;
  onSave: (meeting: MeetingRecord) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [form, setForm] = useState<MeetingInput>(() =>
    inputFromMeeting(meeting),
  );
  const [baseline, setBaseline] = useState(() => JSON.stringify(inputFromMeeting(meeting)));
  const savedFields = JSON.stringify(inputFromMeeting(meeting));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dirty = useMemo(
    () => JSON.stringify(form) !== baseline,
    [form, baseline],
  );
  const conflict = savedFields !== baseline;
  useEffect(() => {
    if (!conflict || dirty || saving) return;
    const timer = window.setTimeout(() => { setForm(inputFromMeeting(meeting)); setBaseline(savedFields); }, 0);
    return () => window.clearTimeout(timer);
  }, [meeting, savedFields, conflict, dirty, saving]);
  const issues = useMemo(
    () => [
      ...validateMeetingInput(form),
      ...meetingRoomValidationIssues(
        form,
        config.meetingRooms,
        meetings,
        meeting.id,
      ),
    ],
    [config.meetingRooms, form, meeting.id, meetings],
  );

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving);
  }, [onBusyChange, saving]);

  async function requestClose() {
    if (saving) return;
    if (
      dirty &&
      !(await confirmAction("会议编辑中还有未保存的修改，确定放弃这些修改吗？"))
    )
      return;
    onClose();
  }

  function update<K extends keyof MeetingInput>(
    key: K,
    value: MeetingInput[K],
  ) {
    setError("");
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectRoom(id: string) {
    const room = config.meetingRooms.find((item) => item.id === id);
    if (!room) {
      setForm((current) => ({
        ...current,
        meetingRoomId: undefined,
        roomRequirements: "",
      }));
      return;
    }
    setForm((current) => ({
      ...current,
      meetingRoomId: room.id,
      location: meetingRoomLocation(room.name, room.location),
      roomSize: room.roomSize,
      roomRequirements: meetingRoomRequirements(room),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (conflict) { setError("会议信息已被其他操作更新，当前草稿已保留，请先核对最新版本。"); return; }
    const blocking = issues.filter((issue) => issue.severity === "error");
    if (blocking.length) {
      setError(blocking.map((issue) => issue.message).join("；"));
      focusMeetingIssue(event.currentTarget, blocking[0].field);
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(updateMeetingFields(meeting, form));
      notifySaved("会议信息已保存");
      onClose();
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "会议信息保存失败，请稍后重试。",
      );
    } finally {
      setSaving(false);
    }
  }

  const workspaceId = useAssistantWorkspace({
    suffix: "meeting-editor", kind: "meeting_editor", label: meeting.title + " · 编辑会议信息", meetingId: meeting.id, dirty,
    data: { draft: form, saved: inputFromMeeting(meeting), issues }, editableFields: Object.keys(inputFromMeeting(meeting)), modes: ["draft"],
    apply: (patch) => {
      if (saving) throw new Error("正在保存，请稍后重试");
      const next = Object.keys(patch).length ? parseMeetingPatch(patch, "会议修改") : {};
      setForm({ ...form, ...next }); setError("");
      return "已回填会议信息编辑区，尚未保存";
    },
  });
  return (
    <AppDialog
      className="meeting-editor meeting-editor-dialog"
      labelledBy="meeting-editor-title"
      onClose={() => void requestClose()}
      busy={saving}
      assistantEnabled
    >
      <header>
        <div>
          <span>会议设置</span>
          <h2 id="meeting-editor-title">编辑会议信息</h2>
          <p>修改后会同步更新会议总览；新启用的保障场景会自动补齐对应清单。</p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          disabled={saving}
          aria-label="关闭编辑会议信息"
        >
          <X />
        </button>
      </header>

      <form data-assistant-workspace={workspaceId} onSubmit={submit}>
          <div className="meeting-editor-body" inert={saving}>
          {conflict && <div className="meeting-form-error" role="alert">会议信息已更新，当前未保存草稿已保留。<button type="button" onClick={async () => {
            if (dirty && !await confirmAction("放弃当前会议信息草稿，读取最新保存版本吗？")) return;
            setForm(inputFromMeeting(meeting)); setBaseline(savedFields); setError("");
          }}>放弃草稿并读取最新版本</button></div>}
          {error ? (
            <div className="meeting-form-error" role="alert">
              {error}
            </div>
          ) : null}
          <div className="meeting-editor-grid">
            <label className="wide">
              <span>会议名称 *</span>
              <input
                data-dialog-focus
                name="title"
                aria-required="true"
                aria-invalid={
                  !!error &&
                  issues.some(
                    (issue) =>
                      issue.field === "title" && issue.severity === "error",
                  )
                }
                value={form.title}
                onChange={(event) => update("title", event.target.value)}
              />
            </label>
            <label>
              <span>会议日期 *</span>
              <input
                name="date"
                aria-required="true"
                type="date"
                value={form.date}
                onChange={(event) => update("date", event.target.value)}
              />
            </label>
            <label>
              <span>开始时间</span>
              <input
                name="startTime"
                type="time"
                value={form.startTime}
                onChange={(event) => update("startTime", event.target.value)}
              />
            </label>
            <label>
              <span>结束时间</span>
              <input
                name="endTime"
                type="time"
                value={form.endTime ?? ""}
                onChange={(event) => update("endTime", event.target.value)}
              />
            </label>
            <label>
              <span>会议室</span>
              <select
                name="meetingRoomId"
                value={form.meetingRoomId ?? ""}
                onChange={(event) => selectRoom(event.target.value)}
              >
                <option value="">自定义地点 / 暂不选择</option>
                {config.meetingRooms.map((room) => (
                  <option
                    value={room.id}
                    key={room.id}
                    disabled={!room.enabled}
                  >
                    {room.name}
                    {room.location ? ` · ${room.location}` : ""}
                    {room.capacity ? ` · ${room.capacity}人` : ""}
                    {room.enabled ? "" : " · 已停用"}
                  </option>
                ))}
              </select>
            </label>
            <label className="wide">
              <span>会议地点</span>
              <input
                value={form.location}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    location: event.target.value,
                    meetingRoomId: undefined,
                    roomRequirements: "",
                  }))
                }
              />
            </label>
            <label>
              <span>主办 / 对接单位</span>
              <input
                value={form.organizer}
                onChange={(event) => update("organizer", event.target.value)}
              />
            </label>
            <label>
              <span>会务负责人</span>
              <input
                value={form.owner}
                onChange={(event) => update("owner", event.target.value)}
              />
            </label>
            <label>
              <span>预计参会人数</span>
              <input
                type="number"
                min={0}
                max={5000}
                value={form.attendeeEstimate}
                name="attendeeEstimate"
                onChange={(event) =>
                  update("attendeeEstimate", Number(event.target.value) || 0)
                }
              />
            </label>
            <label>
              <span>会议规模</span>
              <select
                value={form.roomSize}
                onChange={(event) =>
                  update(
                    "roomSize",
                    event.target.value as MeetingInput["roomSize"],
                  )
                }
              >
                <option value="small">小型会议</option>
                <option value="large">大型会议</option>
              </select>
            </label>
            <label>
              <span>用餐安排</span>
              <select
                value={form.mealType}
                onChange={(event) => {
                  const mealType = event.target
                    .value as MeetingInput["mealType"];
                  setForm((current) => ({
                    ...current,
                    mealType,
                    alcoholRequired:
                      mealType === "business" && current.alcoholRequired,
                  }));
                }}
              >
                <option value="none">不需要</option>
                <option value="business">商务餐</option>
                <option value="work">工作餐</option>
              </select>
            </label>
            <label>
              <span>预计车辆</span>
              <input
                type="number"
                min={0}
                max={5000}
                disabled={!form.parkingRequired}
                value={form.vehicleCount}
                name="vehicleCount"
                onChange={(event) =>
                  update("vehicleCount", Number(event.target.value) || 0)
                }
              />
            </label>
          </div>

          <fieldset className="meeting-editor-options">
            <legend>保障选项</legend>
            {[
              ["rosterRequired", "需要整理并输出标准名单"],
              ["afternoonMeeting", "下午会议"],
              ["presentationRequired", "需要PPT投屏"],
              ["welcomeScreenRequired", "需要欢迎屏"],
              ["parkingRequired", "需要停车保障"],
              ["publicityRequired", "需要宣传摄影"],
              ["reimbursementRequired", "需要会后报销"],
            ].map(([key, label]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={Boolean(form[key as keyof MeetingInput])}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setForm((current) => ({
                      ...current,
                      [key]: checked,
                      ...(key === "parkingRequired" && !checked
                        ? { vehicleCount: 0 }
                        : {}),
                    }));
                  }}
                />
                <span>{label}</span>
              </label>
            ))}
            {form.mealType === "business" ? (
              <label>
                <input
                  type="checkbox"
                  checked={form.alcoholRequired}
                  onChange={(event) =>
                    update("alcoholRequired", event.target.checked)
                  }
                />
                <span>商务餐需要酒水</span>
              </label>
            ) : null}
          </fieldset>

          {issues.length ? (
            <div className="meeting-editor-issues">
              {issues.map((issue) => (
                <p
                  className={issue.severity}
                  key={`${issue.field}-${issue.message}`}
                >
                  <AlertTriangle /> {issue.message}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <footer>
          <span className="experience-save-state" role="status">
            {saving
              ? "正在保存，请稍候"
              : dirty
                ? "有未保存的修改"
                : "尚未修改"}
          </span>
          <button
            type="button"
            className="assistant-button secondary"
            onClick={requestClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            className="assistant-button primary"
            disabled={saving}
          >
            <Save /> {saving ? "正在保存…" : "保存修改"}
          </button>
        </footer>
      </form>
    </AppDialog>
  );
}
