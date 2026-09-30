"use client";

import { useId } from "react";
import type { MeetingRoomConfig } from "../lib/admin-config";
import { meetingRoomRequirements } from "../lib/builtin-meeting-rooms";
import type { AssistantNewMeetingDraft } from "../lib/assistant-agent-contract";
import { MeetingAttendeeEditor } from "./meeting-attendee-editor";
import { MeetingVehicleEditor } from "./meeting-vehicle-editor";

export type AssistantMeetingOptionsTableProps = {
  /**
   * A draft is intentionally accepted here: the assistant can show this form
   * as soon as it understands that the user wants to create a meeting.
   */
  input: AssistantNewMeetingDraft;
  onPatch: (patch: AssistantNewMeetingDraft) => void;
  disabled?: boolean;
  meetingRooms?: MeetingRoomConfig[];
};

type ToggleProps = {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
};

function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: ToggleProps) {
  const status = checked ? "需要" : "不需要";

  return (
    <label className="assistant-meeting-options-table__switch" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={`${label}：${status}`}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className="assistant-meeting-options-table__switch-track"
        aria-hidden="true"
      />
      <span className="assistant-meeting-options-table__switch-status">
        {status}
      </span>
    </label>
  );
}

function clampedInteger(value: string, minimum: number, maximum: number) {
  if (!value) return minimum;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return minimum;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function AssistantMeetingOptionsTable({
  input,
  onPatch,
  disabled = false,
  meetingRooms = [],
}: AssistantMeetingOptionsTableProps) {
  const uid = useId().replaceAll(":", "");
  const fieldId = (name: string) => `assistant-meeting-${uid}-${name}`;
  const titleMissing = !input.title?.trim();
  const dateMissing = !input.date;
  const startTimeMissing = !input.startTime;
  const timeRangeInvalid = Boolean(
    input.startTime && input.endTime && input.endTime <= input.startTime,
  );

  function patchStartTime(startTime: string) {
    const patch: AssistantNewMeetingDraft = { startTime };
    if (/^\d{2}:\d{2}$/.test(startTime)) {
      patch.afternoonMeeting = Number.parseInt(startTime.slice(0, 2), 10) >= 12;
    }
    onPatch(patch);
  }

  const enabledRooms = meetingRooms.filter((room) => room.enabled);

  function selectMeetingRoom(id: string) {
    const room = enabledRooms.find((item) => item.id === id);
    onPatch(
      room
        ? {
            meetingRoomId: room.id,
            location: room.location.trim()
              ? `${room.name}（${room.location}）`
              : room.name,
            roomRequirements: meetingRoomRequirements(room),
            roomSize: room.roomSize,
          }
        : {
            meetingRoomId: undefined,
            roomRequirements: undefined,
            location: "",
          },
    );
  }

  return (
    <section
      className="assistant-meeting-options-table"
      aria-labelledby={fieldId("heading")}
    >
      <div className="assistant-meeting-options-table__heading">
        <div>
          <strong id={fieldId("heading")}>会议草稿</strong>
          <span>可直接填写，也可继续用自然语言修改</span>
        </div>
        <span className="assistant-meeting-options-table__draft-badge">
          待确认
        </span>
      </div>

      <div className="assistant-meeting-options-table__frame">
        <table>
          <caption className="assistant-meeting-options-table__sr-only">
            新建会议信息和会务保障选项
          </caption>
          <thead>
            <tr>
              <th scope="col">事项</th>
              <th scope="col">填写或选择</th>
            </tr>
          </thead>

          <tbody aria-label="会议基本信息">
            <tr className="assistant-meeting-options-table__section-row">
              <th colSpan={2} scope="colgroup">
                基本信息
              </th>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("title")}>
                  会议名称
                  <span className="assistant-meeting-options-table__required">
                    必填
                  </span>
                </label>
              </th>
              <td>
                <input
                  id={fieldId("title")}
                  className={titleMissing ? "is-missing" : undefined}
                  type="text"
                  value={input.title ?? ""}
                  disabled={disabled}
                  required
                  aria-invalid={titleMissing}
                  placeholder="例如：市场部部门例会"
                  onChange={(event) => onPatch({ title: event.target.value })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("date")}>
                  日期
                  <span className="assistant-meeting-options-table__required">
                    必填
                  </span>
                </label>
              </th>
              <td>
                <input
                  id={fieldId("date")}
                  className={dateMissing ? "is-missing" : undefined}
                  type="date"
                  value={input.date ?? ""}
                  disabled={disabled}
                  required
                  aria-invalid={dateMissing}
                  onChange={(event) => onPatch({ date: event.target.value })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">
                会议时间
                <span className="assistant-meeting-options-table__required">
                  必填
                </span>
              </th>
              <td>
                <div className="assistant-meeting-options-table__time-grid">
                  <label htmlFor={fieldId("start-time")}>
                    <span>开始</span>
                    <input
                      id={fieldId("start-time")}
                      className={startTimeMissing ? "is-missing" : undefined}
                      type="time"
                      value={input.startTime ?? ""}
                      disabled={disabled}
                      required
                      aria-invalid={startTimeMissing}
                      onChange={(event) => patchStartTime(event.target.value)}
                    />
                  </label>
                  <label htmlFor={fieldId("end-time")}>
                    <span>结束</span>
                    <input
                      id={fieldId("end-time")}
                      className={timeRangeInvalid ? "is-invalid" : undefined}
                      type="time"
                      value={input.endTime ?? ""}
                      disabled={disabled}
                      aria-invalid={timeRangeInvalid}
                      aria-describedby={
                        timeRangeInvalid ? fieldId("time-error") : undefined
                      }
                      onChange={(event) =>
                        onPatch({ endTime: event.target.value || undefined })
                      }
                    />
                  </label>
                </div>
                {timeRangeInvalid ? (
                  <small
                    id={fieldId("time-error")}
                    className="assistant-meeting-options-table__error"
                  >
                    结束时间应晚于开始时间
                  </small>
                ) : null}
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("meeting-room")}>会议室</label>
              </th>
              <td>
                <select
                  id={fieldId("meeting-room")}
                  value={input.meetingRoomId ?? ""}
                  disabled={disabled || !enabledRooms.length}
                  onChange={(event) => selectMeetingRoom(event.target.value)}
                >
                  <option value="">
                    {enabledRooms.length ? "自定义地点 / 暂不选择" : "后台尚未配置会议室"}
                  </option>
                  {enabledRooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                      {room.capacity ? ` · ${room.capacity}人` : ""}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("location")}>
                  地点
                  <span className="assistant-meeting-options-table__optional">
                    可稍后补充
                  </span>
                </label>
              </th>
              <td>
                <input
                  id={fieldId("location")}
                  type="text"
                  value={input.location ?? ""}
                  disabled={disabled}
                  placeholder="例如：小会议室"
                  onChange={(event) =>
                    onPatch({
                      meetingRoomId: undefined,
                      roomRequirements: undefined,
                      location: event.target.value,
                    })
                  }
                />
                {input.meetingRoomId && input.roomRequirements ? (
                  <small className="assistant-meeting-options-table__room-note">
                    场地要求：{input.roomRequirements}
                  </small>
                ) : null}
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("attendee-estimate")}>预计人数</label>
              </th>
              <td>
                <div className="assistant-meeting-options-table__number-field">
                  <input
                    id={fieldId("attendee-estimate")}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={5000}
                    value={input.attendeeEstimate ?? 0}
                    disabled={disabled}
                    onChange={(event) =>
                      onPatch({
                        attendeeEstimate: clampedInteger(
                          event.target.value,
                          0,
                          5000,
                        ),
                      })
                    }
                  />
                  <span>人</span>
                </div>
              </td>
            </tr>
            <tr>
              <th scope="row">标准名单治理</th>
              <td>
                <select
                  id={fieldId("roster-required")}
                  aria-label="是否需要整理并输出标准名单"
                  value={input.rosterRequired ? "yes" : "no"}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ rosterRequired: event.target.value === "yes" })
                  }
                >
                  <option value="no">不需要</option>
                  <option value="yes">需要</option>
                </select>
              </td>
            </tr>
          </tbody>

          <tbody aria-label="会务责任信息">
            <tr className="assistant-meeting-options-table__section-row">
              <th colSpan={2} scope="colgroup">
                责任与场地
              </th>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("organizer")}>组织者</label>
              </th>
              <td>
                <input
                  id={fieldId("organizer")}
                  type="text"
                  autoComplete="organization"
                  value={input.organizer ?? ""}
                  disabled={disabled}
                  placeholder="采用后台默认值"
                  onChange={(event) =>
                    onPatch({ organizer: event.target.value })
                  }
                />
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("owner")}>负责人</label>
              </th>
              <td>
                <input
                  id={fieldId("owner")}
                  type="text"
                  value={input.owner ?? ""}
                  disabled={disabled}
                  placeholder="采用后台默认值"
                  onChange={(event) => onPatch({ owner: event.target.value })}
                />
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("room-size")}>会议室规格</label>
              </th>
              <td>
                <select
                  id={fieldId("room-size")}
                  value={input.roomSize ?? "small"}
                  disabled={disabled}
                  onChange={(event) =>
                    onPatch({ roomSize: event.target.value as "small" | "large" })
                  }
                >
                  <option value="small">小型会议室</option>
                  <option value="large">大型会议室</option>
                </select>
              </td>
            </tr>
          </tbody>

          <tbody aria-label="会务保障选项">
            <tr className="assistant-meeting-options-table__section-row">
              <th colSpan={2} scope="colgroup">
                保障选项
              </th>
            </tr>
            <tr>
              <th scope="row">PPT 演示设备</th>
              <td>
                <Toggle
                  id={fieldId("presentation")}
                  label="PPT 演示设备"
                  checked={input.presentationRequired ?? false}
                  disabled={disabled}
                  onChange={(presentationRequired) =>
                    onPatch({ presentationRequired })
                  }
                />
              </td>
            </tr>
            <tr>
              <th scope="row">欢迎屏</th>
              <td>
                <Toggle
                  id={fieldId("welcome-screen")}
                  label="欢迎屏"
                  checked={input.welcomeScreenRequired ?? false}
                  disabled={disabled}
                  onChange={(welcomeScreenRequired) =>
                    onPatch({ welcomeScreenRequired })
                  }
                />
              </td>
            </tr>
            <tr>
              <th scope="row">停车保障</th>
              <td>
                <div className="assistant-meeting-options-table__inline-options">
                  <Toggle
                    id={fieldId("parking")}
                    label="停车保障"
                    checked={input.parkingRequired ?? false}
                    disabled={disabled}
                    onChange={(parkingRequired) =>
                      onPatch({
                        parkingRequired,
                        vehicleCount: parkingRequired
                          ? Math.max(1, input.vehicleCount ?? 0)
                          : 0,
                      })
                    }
                  />
                  {input.parkingRequired ? (
                    <label
                      className="assistant-meeting-options-table__compact-number"
                      htmlFor={fieldId("vehicle-count")}
                    >
                      <span>车辆数</span>
                      <input
                        id={fieldId("vehicle-count")}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={5000}
                        value={input.vehicleCount ?? 1}
                        disabled={disabled}
                        onBlur={() => {
                          if (!input.vehicleCount || input.vehicleCount < 1) {
                            onPatch({ vehicleCount: 1 });
                          }
                        }}
                        onChange={(event) =>
                          onPatch({
                            vehicleCount: clampedInteger(
                              event.target.value,
                              0,
                              5000,
                            ),
                          })
                        }
                      />
                    </label>
                  ) : null}
                </div>
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor={fieldId("meal-type")}>用餐安排</label>
              </th>
              <td>
                <div className="assistant-meeting-options-table__inline-options">
                  <select
                    id={fieldId("meal-type")}
                    value={input.mealType ?? "none"}
                    disabled={disabled}
                    onChange={(event) => {
                      const mealType = event.target.value as
                        | "none"
                        | "work"
                        | "business";
                      onPatch({
                        mealType,
                        ...(mealType === "business"
                          ? {}
                          : { alcoholRequired: false }),
                      });
                    }}
                  >
                    <option value="none">不安排用餐</option>
                    <option value="work">工作餐</option>
                    <option value="business">商务餐</option>
                  </select>
                  {input.mealType === "business" ? (
                    <Toggle
                      id={fieldId("alcohol")}
                      label="酒水"
                      checked={input.alcoholRequired ?? false}
                      disabled={disabled}
                      onChange={(alcoholRequired) =>
                        onPatch({ alcoholRequired })
                      }
                    />
                  ) : null}
                </div>
              </td>
            </tr>
            <tr>
              <th scope="row">报销</th>
              <td>
                <Toggle
                  id={fieldId("reimbursement")}
                  label="报销"
                  checked={input.reimbursementRequired ?? false}
                  disabled={disabled}
                  onChange={(reimbursementRequired) =>
                    onPatch({ reimbursementRequired })
                  }
                />
              </td>
            </tr>
            <tr>
              <th scope="row">对外宣传</th>
              <td>
                <Toggle
                  id={fieldId("publicity")}
                  label="对外宣传"
                  checked={input.publicityRequired ?? false}
                  disabled={disabled}
                  onChange={(publicityRequired) =>
                    onPatch({ publicityRequired })
                  }
                />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <label className="assistant-meeting-document-notes">
        <span>议程与备注（可选）</span>
        <textarea rows={3} maxLength={5000} value={input.notes ?? ""} disabled={disabled}
          onChange={(event) => onPatch({ notes: event.target.value })} />
      </label>
      <MeetingAttendeeEditor
        value={(input.attendees ?? []).map((attendee, index) => ({ ...attendee, id: `draft-${index}`, source: "会议草稿" }))}
        disabled={disabled}
        onChange={(attendees) => onPatch({ attendees: attendees.map(({ name, unit, department, title }) => ({ name, unit, department, title })) })}
      />
      {input.parkingRequired ? <MeetingVehicleEditor value={input.vehicles ?? []} disabled={disabled} onChange={(vehicles) => onPatch({ vehicles })} /> : null}
    </section>
  );
}
