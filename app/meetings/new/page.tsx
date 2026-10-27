"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Car,
  CheckCircle2,
  Coffee,
  FileCheck2,
  MapPin,
  MonitorUp,
  Presentation,
  ReceiptText,
  Sparkles,
  UserPlus,
  UsersRound,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useAssistantWorkspace } from "../../components/use-assistant-workspace";
import { parseMeetingPatch } from "../../lib/assistant-contract";
import { workspaceAttendees } from "../../lib/assistant-workspace-validation";
import { FormEvent, useMemo, useState } from "react";
import { AssistantShell } from "../../components/assistant-shell";
import { MeetingAttendeeEditor } from "../../components/meeting-attendee-editor";
import { MeetingVehicleEditor } from "../../components/meeting-vehicle-editor";
import type { AdminConfig } from "../../lib/admin-config";
import { meetingRoomRequirements } from "../../lib/builtin-meeting-rooms";
import { focusMeetingIssue } from "../../lib/form-focus";
import { notifySaved } from "../../components/app-feedback";
import { syncMeetingContacts } from "../../lib/contacts";
import {
  createMeeting,
  ensureMeetingStoreReady,
  flushMeetingPersistence,
  loadAllMeetings,
  localDateValue,
  meetingRoomValidationIssues,
  normalizeMeetingAttendees,
  validateMeetingInput,
  type MeetingAttendee,
  type MeetingInput,
  saveMeeting,
} from "../../lib/meeting-data";
import { useAdminConfig } from "../../lib/use-admin-config";
import {
  useWorkspaceTabs,
  useWorkspaceTabStatus,
} from "../../components/workspace-tabs";

const tomorrow = () => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return localDateValue(date);
};

function meetingRoomLocation(name: string, location: string) {
  const cleanName = name.trim();
  const cleanLocation = location.trim();
  if (!cleanLocation) return cleanName;
  return `${cleanName}（${cleanLocation}）`;
}

const initialForm: MeetingInput = {
  title: "",
  date: tomorrow(),
  startTime: "14:00",
  endTime: "",
  location: "",
  organizer: "",
  owner: "",
  attendeeEstimate: 10,
  rosterRequired: false,
  afternoonMeeting: true,
  mealType: "none",
  alcoholRequired: false,
  parkingRequired: false,
  vehicleCount: 0,
  publicityRequired: false,
  reimbursementRequired: false,
  presentationRequired: true,
  welcomeScreenRequired: false,
  roomSize: "small",
};

export default function NewMeetingPage() {
  const { config, revision, loading, ready, error, reload } = useAdminConfig();
  if (loading) {
    return (
      <AssistantShell
        title="新建会议"
        subtitle="正在读取会议默认配置与清单模板"
      >
        <div className="assistant-loading">正在准备会议配置…</div>
      </AssistantShell>
    );
  }
  if (error && !ready) {
    return (
      <AssistantShell title="新建会议" subtitle="需要先读取管理中心的当前规则">
        <div className="assistant-panel assistant-config-error">
          <AlertTriangle aria-hidden="true" />
          <div>
            <strong>会议配置暂时无法读取</strong>
            <span>为避免用错误的默认规则创建会议，本次操作已暂停。{error}</span>
          </div>
          <button
            className="assistant-button primary"
            type="button"
            onClick={() => void reload()}
          >
            <RefreshCw size={16} />
            重新读取
          </button>
        </div>
      </AssistantShell>
    );
  }
  return <ConfiguredNewMeetingPage config={config} revision={revision} configError={error} reloadConfig={reload} />;
}

function ConfiguredNewMeetingPage({
  config,
  revision,
  configError,
  reloadConfig,
}: {
  config: AdminConfig;
  revision: number;
  configError: string;
  reloadConfig: () => Promise<unknown>;
}) {
  const workspace = useWorkspaceTabs();
  const enabledRooms = useMemo(
    () => config.meetingRooms.filter((room) => room.enabled),
    [config.meetingRooms],
  );
  const [form, setForm] = useState<MeetingInput>(() => {
    const defaultRoom = config.meetingRooms.find(
      (room) =>
        room.enabled && room.id === config.organization.defaultMeetingRoomId,
    );
    return {
      ...initialForm,
      date: tomorrow(),
      organizer: config.organization.name,
      owner: config.organization.defaultOwner,
      startTime: config.organization.defaultStartTime,
      attendeeEstimate: config.organization.defaultAttendeeEstimate,
      roomSize: defaultRoom?.roomSize ?? config.organization.defaultRoomSize,
      presentationRequired: config.organization.defaultPresentationRequired,
      meetingRoomId: defaultRoom?.id,
      roomRequirements: meetingRoomRequirements(defaultRoom),
      location: defaultRoom
        ? meetingRoomLocation(defaultRoom.name, defaultRoom.location)
        : "",
    };
  });
  const [error, setError] = useState("");
  const [selectedAttendees, setSelectedAttendees] = useState<MeetingAttendee[]>(
    [],
  );
  const [saving, setSaving] = useState(false);
  const [attendeeImportStatus, setAttendeeImportStatus] = useState({ dirty: false, busy: false });
  const [initialSnapshot] = useState(() =>
    JSON.stringify({ form, attendees: [] }),
  );
  const dirty = useMemo(
    () =>
      JSON.stringify({ form, attendees: selectedAttendees }) !==
      initialSnapshot,
    [form, initialSnapshot, selectedAttendees],
  );
  useWorkspaceTabStatus({
    title: "新建会议",
    dirty: dirty || attendeeImportStatus.dirty,
    dirtyReasons: [
      ...(dirty ? ["新建会议信息和参会人员尚未保存"] : []),
      ...(attendeeImportStatus.dirty ? ["粘贴的人员名单尚未确认添加"] : []),
    ],
    busy: saving || attendeeImportStatus.busy,
  });
  const attendeeCount = selectedAttendees.filter((attendee) =>
    [attendee.name, attendee.unit, attendee.department, attendee.title].some(
      (value) => value.trim(),
    ),
  ).length;
  const formIssues = useMemo(
    () => [
      ...validateMeetingInput(form),
      ...meetingRoomValidationIssues(
        form,
        config.meetingRooms,
        loadAllMeetings(),
      ),
    ],
    [config.meetingRooms, form],
  );

  const creationOptions = useMemo(
    () => ({
      checklistTemplates: config.checklistTemplates,
      configRevision: revision,
      meetingRules: config.meetingRules,
    }),
    [config, revision],
  );

  const estimatedTasks = useMemo(() => {
    try {
      return createMeeting(
        {
          ...form,
          title: form.title || "待命名会议",
        },
        creationOptions,
      ).tasks.length;
    } catch {
      return 0;
    }
  }, [creationOptions, form]);

  function update<K extends keyof MeetingInput>(
    key: K,
    value: MeetingInput[K],
  ) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function selectMeetingRoom(id: string) {
    const room = enabledRooms.find((item) => item.id === id);
    setForm((current) => ({
      ...current,
      meetingRoomId: room?.id,
      roomRequirements: meetingRoomRequirements(room),
      location: room ? meetingRoomLocation(room.name, room.location) : "",
      roomSize: room?.roomSize ?? current.roomSize,
    }));
  }

  const workspaceId = useAssistantWorkspace({
    suffix: "registration", kind: "meeting_new", label: "会议登记 · " + (form.title || "新会议"), dirty,
    data: { draft: { ...form, attendees: selectedAttendees }, pendingAttendeeImport: attendeeImportStatus },
    editableFields: [...Object.keys(initialForm), "meetingRoomId", "roomRequirements", "vehicles", "attendees"], modes: ["draft", "save"],
    apply: async (patch, mode) => {
      if (saving) throw new Error("正在创建会议，请稍后重试");
      const { attendees, ...fields } = patch;
      const parsed = Object.keys(fields).length ? parseMeetingPatch(fields, "登记修改") : {};
      const next = { ...form, ...parsed };
      if (Object.hasOwn(parsed, "startTime") && !Object.hasOwn(parsed, "afternoonMeeting")) next.afternoonMeeting = next.startTime >= "12:00";
      const people = attendees === undefined ? selectedAttendees : workspaceAttendees(attendees);
      if (mode === "draft") { setForm(next); setSelectedAttendees(people); setError(""); return "已回填当前会议登记表，尚未创建会议"; }
      setForm(next); setSelectedAttendees(people);
      const createdMeetingId = await persistNewMeeting(next, people);
      return { message: "会议已创建并生成配套清单", createdMeetingId };
    },
  });

  async function persistNewMeeting(nextForm: MeetingInput, people: MeetingAttendee[]) {
    if (configError) throw new Error("请先重新读取会议配置，当前填写内容已保留");
    if (attendeeImportStatus.busy || attendeeImportStatus.dirty) throw new Error("请先确认添加或清空粘贴的名单");
    const attendees = normalizeMeetingAttendees(people);
    await ensureMeetingStoreReady();
    const blocking = [...validateMeetingInput(nextForm), ...meetingRoomValidationIssues(nextForm, config.meetingRooms, loadAllMeetings())].filter((issue) => issue.severity === "error");
    if (blocking.length) throw new Error(blocking.map((issue) => issue.message).join("；"));
    setSaving(true);
    try {
      const meeting = createMeeting({ ...nextForm, vehicles: nextForm.parkingRequired ? nextForm.vehicles ?? [] : [] }, { ...creationOptions, attendees });
      saveMeeting(meeting); await flushMeetingPersistence();
      await syncMeetingContacts(meeting).catch(() => null);
      workspace.replaceActiveTab("/meetings/" + meeting.id, meeting.title);
      notifySaved("会议已创建，保障事项已生成");
      return meeting.id;
    } finally { setSaving(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const blocking = formIssues.filter((issue) => issue.severity === "error");
    if (blocking.length) {
      setError(blocking.map((issue) => issue.message).join("；"));
      focusMeetingIssue(event.currentTarget, blocking[0].field); return;
    }
    try { await persistNewMeeting(form, selectedAttendees); }
    catch (error) { setError(error instanceof Error ? error.message : "会议未能保存，请稍后重试"); }
  }

  return (
    <AssistantShell
      title="新建会议"
      subtitle="先确认会议场景，系统只生成真正需要执行的保障事项"
      actions={
        <>
          <Link className="assistant-button secondary" href="/meetings">
            <ArrowLeft size={17} />
            返回会议列表
          </Link>
          <button
            className="assistant-button primary"
            type="submit"
            form="new-meeting-form"
            disabled={saving || Boolean(configError)}
          >
            {saving ? "正在创建…" : "创建会议"}
            <ArrowRight size={17} />
          </button>
        </>
      }
    >
      <form
        data-assistant-workspace={workspaceId}
        id="new-meeting-form"
        className="meeting-create-layout"
        onSubmit={submit}
      >
        {configError && <div className="meeting-form-error" role="alert">配置暂时无法更新，当前填写内容已保留。{configError}<button type="button" onClick={() => void reloadConfig()}>重新读取配置</button></div>}
        {error && (
          <div
            className="meeting-form-error experience-form-error"
            role="alert"
          >
            {error}
          </div>
        )}
        <div className="meeting-form-stack">
          <section className="assistant-panel meeting-form-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon blue">
                <CalendarDays size={20} />
              </span>
              <div>
                <p>基本信息</p>
                <h2>这是一场什么会议？</h2>
              </div>
            </div>

            <div className="meeting-fields-grid">
              <label className="meeting-field full">
                <span>会议名称 *</span>
                <input
                  autoFocus
                  name="title"
                  aria-required="true"
                  aria-invalid={!!error && !form.title.trim()}
                  value={form.title}
                  onChange={(event) => update("title", event.target.value)}
                  placeholder="例如：低空经济项目合作交流会"
                />
              </label>
              <label className="meeting-field">
                <span>会议日期 *</span>
                <input
                  type="date"
                  name="date"
                  aria-required="true"
                  value={form.date}
                  onChange={(event) => update("date", event.target.value)}
                />
              </label>
              <label className="meeting-field">
                <span>开始时间</span>
                <input
                  type="time"
                  name="startTime"
                  value={form.startTime}
                  onChange={(event) => update("startTime", event.target.value)}
                />
              </label>
              <label className="meeting-field">
                <span>结束时间</span>
                <input
                  type="time"
                  value={form.endTime ?? ""}
                  name="endTime"
                  onChange={(event) => update("endTime", event.target.value)}
                />
              </label>
              {enabledRooms.length ? (
                <label className="meeting-field full">
                  <span>选择会议室</span>
                  <select
                    value={form.meetingRoomId ?? ""}
                    name="meetingRoomId"
                    onChange={(event) => selectMeetingRoom(event.target.value)}
                  >
                    <option value="">自定义地点 / 暂不选择</option>
                    {enabledRooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.name}
                        {room.location ? ` · ${room.location}` : ""}
                        {room.capacity ? ` · ${room.capacity}人` : ""}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="meeting-field full">
                <span>
                  {form.meetingRoomId
                    ? "会议地点（已从会议室带入）"
                    : "会议地点"}
                </span>
                <div className="meeting-input-icon">
                  <MapPin size={17} />
                  <input
                    value={form.location}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        meetingRoomId: undefined,
                        roomRequirements: "",
                        location: event.target.value,
                      }))
                    }
                    placeholder="例如：公司大会议室"
                  />
                </div>
              </label>
              {form.meetingRoomId ? (
                <div className="meeting-room-selection-note meeting-field full">
                  <strong>
                    {enabledRooms.find((room) => room.id === form.meetingRoomId)
                      ?.equipment.length
                      ? `现有设备：${enabledRooms
                          .find((room) => room.id === form.meetingRoomId)!
                          .equipment.join("、")}`
                      : "未登记会议室设备"}
                  </strong>
                  {form.roomRequirements ? (
                    <span>场地要求：{form.roomRequirements}</span>
                  ) : (
                    <span>没有额外场地要求</span>
                  )}
                  {formIssues
                    .filter((issue) =>
                      ["meetingRoom", "attendeeEstimate"].includes(issue.field),
                    )
                    .map((issue) => (
                      <small
                        className={
                          issue.severity === "error" ? "error" : "warning"
                        }
                        key={`${issue.field}-${issue.message}`}
                      >
                        {issue.message}
                      </small>
                    ))}
                </div>
              ) : null}
              <label className="meeting-field">
                <span>主办 / 对接单位</span>
                <input
                  value={form.organizer}
                  onChange={(event) => update("organizer", event.target.value)}
                  placeholder="可稍后补充"
                />
              </label>
              <label className="meeting-field">
                <span>会务负责人</span>
                <input
                  value={form.owner}
                  onChange={(event) => update("owner", event.target.value)}
                  placeholder="默认用于任务负责人"
                />
              </label>
              <label className="meeting-field">
                <span>预计参会人数</span>
                <div className="meeting-input-icon">
                  <UsersRound size={17} />
                  <input
                    min={0}
                    max={5000}
                    type="number"
                    name="attendeeEstimate"
                    value={form.attendeeEstimate}
                    onChange={(event) =>
                      update(
                        "attendeeEstimate",
                        Math.max(0, Number(event.target.value) || 0),
                      )
                    }
                  />
                </div>
              </label>
              <label className="meeting-field">
                <span>会议室规模</span>
                <select
                  value={form.roomSize}
                  onChange={(event) =>
                    update("roomSize", event.target.value as "small" | "large")
                  }
                >
                  <option value="small">小型会议</option>
                  <option value="large">大型会议</option>
                </select>
              </label>
            </div>
          </section>

          <section className="assistant-panel meeting-form-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon green">
                <UserPlus size={20} />
              </span>
              <div>
                <p>参会人员</p>
                <h2>手动、通讯录或粘贴批量录入</h2>
              </div>
            </div>

            <MeetingAttendeeEditor
              value={selectedAttendees}
              disabled={saving}
              onImportStatusChange={setAttendeeImportStatus}
              onChange={(attendees) => {
                setSelectedAttendees(attendees);
                setError("");
              }}
            />

            <label className="meeting-check-row">
              <input
                type="checkbox"
                checked={form.rosterRequired === true}
                onChange={(event) => {
                  update("rosterRequired", event.target.checked);
                  setError("");
                }}
              />
              <span>
                <strong>需要整理并输出标准名单</strong>
                <small>仅在需要排序、桌签、座次或 Excel 名单时开启</small>
              </span>
            </label>
          </section>

          <section className="assistant-panel meeting-form-section">
            <div className="meeting-section-heading">
              <span className="meeting-section-icon violet">
                <Sparkles size={20} />
              </span>
              <div>
                <p>场景选择</p>
                <h2>需要哪些会议保障？</h2>
              </div>
            </div>

            <div className="meeting-scenario-grid">
              <button
                type="button"
                className={`meeting-scenario ${
                  form.afternoonMeeting ? "selected" : ""
                }`}
                onClick={() =>
                  update("afternoonMeeting", !form.afternoonMeeting)
                }
              >
                <Coffee size={20} />
                <span>
                  <strong>下午会议</strong>
                  <small>加入午餐确认事项</small>
                </span>
                <CheckCircle2 size={18} />
              </button>

              <button
                type="button"
                className={`meeting-scenario ${
                  form.parkingRequired ? "selected" : ""
                }`}
                onClick={() => {
                  const next = !form.parkingRequired;
                  update("parkingRequired", next);
                  if (!next) update("vehicleCount", 0);
                }}
              >
                <Car size={20} />
                <span>
                  <strong>停车保障</strong>
                  <small>统计车辆、报备车牌</small>
                </span>
                <CheckCircle2 size={18} />
              </button>

              <button
                type="button"
                className={`meeting-scenario ${
                  form.publicityRequired ? "selected" : ""
                }`}
                onClick={() =>
                  update("publicityRequired", !form.publicityRequired)
                }
              >
                <FileCheck2 size={20} />
                <span>
                  <strong>OA / 宣传</strong>
                  <small>稿件确认与现场拍照</small>
                </span>
                <CheckCircle2 size={18} />
              </button>

              <button
                type="button"
                className={`meeting-scenario ${
                  form.reimbursementRequired ? "selected" : ""
                }`}
                onClick={() =>
                  update("reimbursementRequired", !form.reimbursementRequired)
                }
              >
                <ReceiptText size={20} />
                <span>
                  <strong>会后报销</strong>
                  <small>签到、票据、金蝶流程</small>
                </span>
                <CheckCircle2 size={18} />
              </button>

              <button
                type="button"
                className={`meeting-scenario ${
                  form.presentationRequired ? "selected" : ""
                }`}
                onClick={() =>
                  update("presentationRequired", !form.presentationRequired)
                }
              >
                <MonitorUp size={20} />
                <span>
                  <strong>PPT 投屏</strong>
                  <small>设备调试、电脑与U盘</small>
                </span>
                <CheckCircle2 size={18} />
              </button>

              <button
                type="button"
                className={`meeting-scenario ${
                  form.welcomeScreenRequired ? "selected" : ""
                }`}
                onClick={() =>
                  update("welcomeScreenRequired", !form.welcomeScreenRequired)
                }
              >
                <Presentation size={20} />
                <span>
                  <strong>欢迎屏 / 电子桌签</strong>
                  <small>生成对应展示任务</small>
                </span>
                <CheckCircle2 size={18} />
              </button>
            </div>

            {form.parkingRequired ? (
              <label className="meeting-inline-field">
                <span>预计参会车辆</span>
                <input
                  min={0}
                  type="number"
                  name="vehicleCount"
                  value={form.vehicleCount}
                  onChange={(event) =>
                    update(
                      "vehicleCount",
                      Math.max(0, Number(event.target.value) || 0),
                    )
                  }
                />
                <small
                  className={
                    form.vehicleCount > config.meetingRules.parkingVehicleLimit
                      ? "warning"
                      : undefined
                  }
                >
                  当前清单标准最多报备
                  {config.meetingRules.parkingVehicleLimit}辆
                </small>
              </label>
            ) : null}

            {form.parkingRequired ? (
              <MeetingVehicleEditor
                value={form.vehicles ?? []}
                disabled={saving}
                onChange={(vehicles) => {
                  update("vehicles", vehicles);
                  setError("");
                }}
              />
            ) : null}

            <div className="meeting-subsection">
              <div>
                <strong>用餐安排</strong>
                <span>不同类型会生成不同的申请与报销任务</span>
              </div>
              <div className="meeting-segmented">
                {[
                  ["none", "不安排"],
                  ["business", "商务餐"],
                  ["work", "工作餐"],
                ].map(([value, label]) => (
                  <button
                    type="button"
                    key={value}
                    className={form.mealType === value ? "active" : ""}
                    onClick={() => {
                      update("mealType", value as "none" | "business" | "work");
                      if (value !== "business") {
                        update("alcoholRequired", false);
                      }
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {form.mealType === "business" ? (
              <label className="meeting-check-row">
                <input
                  type="checkbox"
                  checked={form.alcoholRequired}
                  onChange={(event) =>
                    update("alcoholRequired", event.target.checked)
                  }
                />
                <span>
                  <strong>本次需要酒水</strong>
                  <small>加入仓库领取、退瓶登记任务</small>
                </span>
              </label>
            ) : null}
          </section>
        </div>

        <aside className="assistant-panel meeting-create-summary">
          <span className="meeting-summary-icon">
            <FileCheck2 size={24} />
          </span>
          <p>将生成</p>
          <strong>{estimatedTasks}</strong>
          <h2>项适用任务</h2>
          <ul>
            <li>
              {form.rosterRequired
                ? `已开启标准名单治理，当前录入 ${attendeeCount} 人`
                : attendeeCount
                  ? `已记录 ${attendeeCount} 名参会人，不启用标准名单治理`
                  : "仅记录预计人数，不启用标准名单治理"}
            </li>
            <li>按会议前、中、后分阶段展示</li>
            <li>自动计算建议截止日期</li>
            <li>可随时调整负责人和状态</li>
            <li>操作截图挂在对应任务旁</li>
          </ul>
          <small className="meeting-local-note">
            会议信息保存在当前设备，不上传云端
          </small>
        </aside>
      </form>
    </AssistantShell>
  );
}
