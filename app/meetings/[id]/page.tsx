"use client";

import { confirmAction } from "../../lib/confirmation";


import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock3,
  FileImage,
  FileText,
  ListChecks,
  MapPin,
  Paperclip,
  PencilLine,
  ReceiptText,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Image from "next/image";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Activity,
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AssistantShell } from "../../components/assistant-shell";
import { MeetingAttendeeEditor } from "../../components/meeting-attendee-editor";
import { MeetingVehicleEditor } from "../../components/meeting-vehicle-editor";
import { buildMeetingVehiclesXlsx, type MeetingVehicle } from "../../lib/meeting-vehicles";
import { MeetingEditor } from "../../components/meeting-editor";
import { SeatingPlanner } from "../../components/seating-planner";
import { syncMeetingContacts } from "../../lib/contacts";
import {
  EMPTY_MEETING_STORE,
  flushMeetingPersistence,
  getMeetingWarnings,
  loadMeetingStoreSnapshot,
  meetingProgress,
  phaseProgress,
  replaceMeetingAttendees,
  saveMeeting,
  subscribeMeetings,
  type MeetingPhase,
  type MeetingRecord,
  type MeetingTask,
  type TaskStatus,
  setMeetingRosterRequired,
  updateMeetingTask,
  updateMeetingFields,
} from "../../lib/meeting-data";
import { useAdminConfig } from "../../lib/use-admin-config";
import {
  useWorkspaceLocation,
  useWorkspaceTabStatus,
} from "../../components/workspace-tabs";

type MeetingTab = "overview" | "checklist" | "attendees" | "vehicles" | "seating" | "sop";

const EmbeddedRosterTool = dynamic(() => import("../../lists/roster-tool"), {
  ssr: false,
  loading: () => (
    <div className="assistant-loading">正在准备名单治理工作区…</div>
  ),
});

const PHASES: Array<{
  id: MeetingPhase;
  label: string;
  caption: string;
}> = [
  { id: "before", label: "会议前", caption: "筹备与确认" },
  { id: "during", label: "会议中", caption: "现场执行" },
  { id: "after", label: "会议后", caption: "收尾与报销" },
];

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  blocked: "阻塞",
  review: "待复核",
  done: "已完成",
  waived: "无需执行",
};

const SOP_GUIDES = [
  {
    id: "application-overview",
    title: "业务招待申请入口",
    caption: "人人费用 → 先申请后报销 → 业务招待申请单",
    image: "/sop/kingdee-application-overview.png",
  },
  {
    id: "application-form",
    title: "业务招待申请填写",
    caption: "往来单位、人数、地点、费用项目与申请金额",
    image: "/sop/kingdee-application-form.png",
  },
  {
    id: "reimbursement-overview",
    title: "业务招待报销入口",
    caption: "选择已审批通过单据后点击报销",
    image: "/sop/kingdee-reimbursement-overview.png",
  },
  {
    id: "invoice-import",
    title: "发票导入与异常处理",
    caption: "电脑端或小程序导入票据，并处理发票异常",
    image: "/sop/kingdee-invoice-import.png",
  },
];

function formatDate(date: string, time?: string) {
  if (!date) return "日期待定";
  const parsed = new Date(`${date}T${time || "00:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return `${date} ${time || ""}`.trim();
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: time ? "2-digit" : undefined,
    minute: time ? "2-digit" : undefined,
  }).format(parsed);
}

function formatMeetingDate(meeting: Pick<MeetingRecord, "date" | "startTime" | "endTime">) {
  const start = formatDate(meeting.date, meeting.startTime);
  return meeting.endTime ? `${start}－${meeting.endTime}` : start;
}

function statusIcon(status: TaskStatus) {
  if (status === "done" || status === "waived") {
    return <Check size={15} strokeWidth={2.8} />;
  }
  if (status === "blocked") return <AlertCircle size={15} />;
  if (status === "doing" || status === "review") {
    return <Clock3 size={15} />;
  }
  return <Circle size={15} />;
}

export default function MeetingDetailPage() {
  const { href, pathname, searchParams } = useWorkspaceLocation();
  const { config, loading: adminConfigLoading } = useAdminConfig();
  const meetingId = decodeURIComponent(pathname.split("/").filter(Boolean)[1] ?? "");
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const meetingStore = useSyncExternalStore(
    subscribeMeetings,
    loadMeetingStoreSnapshot,
    () => EMPTY_MEETING_STORE,
  );
  const meetings = meetingStore.all;
  const meeting = meetings.find(
    (item) => item.id === meetingId && !item.deletedAt,
  ) ?? null;
  const [activeTab, setActiveTab] = useState<MeetingTab>(() =>
    searchParams.get("tab") === "seating" ? "seating" : searchParams.get("tab") === "vehicles" ? "vehicles" : searchParams.get("tab") === "attendees" ? "attendees" : "overview",
  );
  const [attendeeMode, setAttendeeMode] = useState<"people" | "governance">(
    () =>
      searchParams.get("mode") === "governance" ? "governance" : "people",
  );
  const [attendeeDraft, setAttendeeDraft] = useState<
    MeetingRecord["attendees"] | null
  >(null);
  const [attendeeDirty, setAttendeeDirty] = useState(false);
  const [attendeeNotice, setAttendeeNotice] = useState("");
  const [vehicleDraft, setVehicleDraft] = useState<MeetingVehicle[] | null>(null);
  const [vehicleBusy, setVehicleBusy] = useState(false);
  const [vehicleNotice, setVehicleNotice] = useState("");
  const [vehicleBaseRevision, setVehicleBaseRevision] = useState<string | null>(null);
  const [seatingStatus, setSeatingStatus] = useState({ dirty: false, busy: false });
  const [phaseFilter, setPhaseFilter] = useState<MeetingPhase | "all">("all");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState("");
  const [editing, setEditing] = useState(false);
  const [meetingEditorDirty, setMeetingEditorDirty] = useState(false);
  const [meetingEditorBusy, setMeetingEditorBusy] = useState(false);
  const [attendeeSaving, setAttendeeSaving] = useState(false);
  const lastAppliedHrefRef = useRef(href);
  const [rosterWorkspaceStatus, setRosterWorkspaceStatus] = useState({
    dirty: false,
    busy: false,
  });

  useEffect(() => {
    if (lastAppliedHrefRef.current === href) return;
    lastAppliedHrefRef.current = href;
    const requestedTab = searchParams.get("tab");
    const timer = window.setTimeout(() => {
      if (["overview", "checklist", "attendees", "vehicles", "seating", "sop"].includes(requestedTab ?? "")) {
        setActiveTab(requestedTab as MeetingTab);
      }
      if (requestedTab === "attendees") {
        setAttendeeMode(
          searchParams.get("mode") === "governance" ? "governance" : "people",
        );
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [href, searchParams]);

  useWorkspaceTabStatus({
    title: meeting?.title || "会议详情",
    dirty: attendeeDirty || vehicleDraft !== null || seatingStatus.dirty || meetingEditorDirty || rosterWorkspaceStatus.dirty,
    dirtyReasons: [
      ...(attendeeDirty ? ["参会人员修改尚未保存"] : []),
      ...(vehicleDraft !== null ? ["参会车辆修改尚未保存"] : []),
      ...(seatingStatus.dirty ? ["座次名单或方案尚未保存"] : []),
      ...(meetingEditorDirty ? ["会议基本信息修改尚未保存"] : []),
      ...(rosterWorkspaceStatus.dirty ? ["正式名单治理结果尚未保存或导出"] : []),
    ],
    busy: attendeeSaving || vehicleBusy || seatingStatus.busy || meetingEditorBusy || rosterWorkspaceStatus.busy,
  });

  const selectedTask = useMemo(
    () => meeting?.tasks.find((task) => task.id === selectedTaskId) ?? null,
    [meeting, selectedTaskId],
  );

  const progress = meeting ? meetingProgress(meeting).percent : 0;
  const warnings = meeting
    ? getMeetingWarnings(meeting, config?.meetingRules)
    : [];
  const pendingTasks = useMemo(
    () =>
      meeting?.tasks
        .filter((task) => !["done", "waived"].includes(task.status))
        .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))
        .slice(0, 6) ?? [],
    [meeting],
  );
  const rosterEnabled = meeting?.rosterRequired === true;
  const displayedTab =
    ((activeTab === "sop" && meeting && !meeting.reimbursementRequired) ||
      (activeTab === "vehicles" && meeting && !meeting.parkingRequired))
      ? "overview"
      : activeTab;
  const attendeeEditorValue =
    attendeeDraft ?? meeting?.attendees.map((attendee) => ({ ...attendee })) ?? [];

  function replaceMeeting(next: MeetingRecord) {
    try {
      saveMeeting(next);
      setStorageError("");
    } catch {
      setStorageError(
        "本次修改未能保存。请确认浏览器允许本地存储，或先删除不再需要的旧会议后重试。",
      );
    }
  }

  function patchTask(taskId: string, patch: Partial<MeetingTask>) {
    if (!meeting) return;
    replaceMeeting(updateMeetingTask(meeting, taskId, patch));
  }

  function toggleTask(task: MeetingTask) {
    patchTask(task.id, {
      status: task.status === "done" ? "todo" : "done",
    });
  }

  function enableRoster() {
    if (!meeting) return;
    replaceMeeting(setMeetingRosterRequired(meeting, true));
    setActiveTab("attendees");
  }

  function disableRoster() {
    if (!meeting) return;
    replaceMeeting(setMeetingRosterRequired(meeting, false));
    setAttendeeNotice("已关闭标准名单治理，已录入人员继续保留。");
  }

  async function saveAttendees() {
    if (!meeting) return;
    setAttendeeSaving(true);
    try {
      const updated = replaceMeetingAttendees(meeting, attendeeEditorValue);
      const saved = saveMeeting(updated);
      await flushMeetingPersistence();
      const sync = await syncMeetingContacts(saved).catch(() => null);
      setAttendeeDraft(null);
      setAttendeeDirty(false);
      setStorageError("");
      setAttendeeNotice(
        !saved.attendees.length
          ? "已清空本会议记录的参会人员。"
          : sync?.skipped
          ? `已保存 ${saved.attendees.length} 人；其中 ${sync.skipped} 人因单位未填写，暂未写入通讯录。`
          : sync
            ? `已保存 ${saved.attendees.length} 名参会人，并同步更新通讯录。`
            : `已保存 ${saved.attendees.length} 名参会人；通讯录暂未同步，可稍后重试。`,
      );
    } catch (error) {
      setAttendeeNotice(
        error instanceof Error ? error.message : "参会人员保存失败",
      );
    } finally {
      setAttendeeSaving(false);
    }
  }

  async function saveVehicles() {
    if (!meeting || vehicleDraft === null) return;
    if (vehicleBaseRevision !== meeting.updatedAt) {
      setVehicleNotice("会议已被其他操作更新。请放弃当前车辆草稿后重新编辑，避免覆盖最新记录。");
      return;
    }
    setVehicleBusy(true);
    try {
      const updated = updateMeetingFields(meeting, { vehicles: vehicleDraft });
      saveMeeting(updated);
      await flushMeetingPersistence();
      setVehicleDraft(null);
      setVehicleBaseRevision(null);
      setVehicleNotice(`已保存 ${updated.vehicles?.length ?? 0} 辆参会车辆；未绑定或修改任何人员。`);
    } catch (error) {
      setVehicleNotice(error instanceof Error ? error.message : "车辆保存失败，请重试");
    } finally { setVehicleBusy(false); }
  }

  async function exportVehicles() {
    if (!meeting) return;
    setVehicleBusy(true);
    try {
      const buffer = await buildMeetingVehiclesXlsx(meeting.vehicles ?? []);
      const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, "_")}_参会车辆.xlsx`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setVehicleNotice(error instanceof Error ? error.message : "车辆导出失败");
    } finally { setVehicleBusy(false); }
  }

  function addAttachments(
    task: MeetingTask,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const additions = Array.from(event.target.files ?? []).map((file) => ({
      name: file.name,
      size: file.size,
      addedAt: new Date().toISOString(),
    }));
    if (!additions.length) return;
    patchTask(task.id, {
      attachments: [...(task.attachments ?? []), ...additions],
    });
    event.target.value = "";
  }

  if (!hydrated) {
    return (
      <AssistantShell title="会议详情">
        <div className="assistant-loading">正在读取本机会议数据…</div>
      </AssistantShell>
    );
  }

  if (!meeting) {
    return (
      <AssistantShell title="会议不存在">
        <div className="assistant-empty large">
          <FileText size={34} />
          <h2>没有找到这场会议</h2>
          <p>它可能已被删除，或来自另一个浏览器设备。</p>
          <Link className="assistant-button primary" href="/meetings">
            返回我的会议
          </Link>
        </div>
      </AssistantShell>
    );
  }

  return (
    <AssistantShell
      title={meeting.title}
      subtitle={`${formatMeetingDate(meeting)} · ${
        meeting.location || "地点待定"
      }`}
      actions={
        <>
          <button
            className="assistant-button primary"
            type="button"
            onClick={() => setEditing(true)}
          >
            <PencilLine size={17} />
            编辑会议信息
          </button>
          <Link className="assistant-button secondary" href="/meetings">
            <ArrowLeft size={17} />
            返回会议列表
          </Link>
        </>
      }
    >
      {storageError ? (
        <div className="meeting-storage-error" role="alert">
          <AlertCircle aria-hidden="true" />
          <span>{storageError}</span>
          <button
            type="button"
            aria-label="关闭保存错误"
            onClick={() => setStorageError("")}
          >
            <X />
          </button>
        </div>
      ) : null}
      <section className="meeting-hero assistant-panel">
        <div className="meeting-hero-main">
          <div className="meeting-date-tile">
            <span>{meeting.date.slice(5, 7) || "--"}月</span>
            <strong>{meeting.date.slice(8, 10) || "--"}</strong>
          </div>
          <div>
            <div className="meeting-kicker">
              <span className="meeting-live-dot" />
              会议保障项目
            </div>
            <h1>{meeting.title}</h1>
            <div className="meeting-meta-row">
              <span>
                <CalendarDays size={15} />
                {formatMeetingDate(meeting)}
              </span>
              <span>
                <MapPin size={15} />
                {meeting.location || "地点待补充"}
              </span>
              <span>
                <UserRound size={15} />
                {meeting.owner || "负责人待分配"}
              </span>
            </div>
          </div>
        </div>
        <div className="meeting-progress-ring" style={{ "--progress": progress } as React.CSSProperties}>
          <strong>{progress}%</strong>
          <span>整体进度</span>
        </div>
      </section>

      <nav className="meeting-tabs" aria-label="会议模块">
        {([
          ["overview", "总览", Sparkles],
          ["checklist", "流程核对", ListChecks],
          ["attendees", "参会人员", UsersRound],
          ["vehicles", "参会车辆", Car],
          ["seating", "座次编排", ClipboardCheck],
          ["sop", "报销指引", ReceiptText],
        ] as const)
          .filter(
            ([id]) => (id !== "sop" || meeting.reimbursementRequired) && (id !== "vehicles" || meeting.parkingRequired),
          )
          .map(([id, label, Icon]) => (
          <button
            type="button"
            key={String(id)}
            className={displayedTab === id ? "active" : ""}
            onClick={() => setActiveTab(id as MeetingTab)}
          >
            <Icon size={17} />
            {String(label)}
            {id === "attendees" && meeting.attendees.length ? (
              <small>{meeting.attendees.length}</small>
            ) : null}
          </button>
          ))}
      </nav>

      {displayedTab === "overview" ? (
        <div className="meeting-overview-grid">
          <div className="meeting-overview-main">
            <section className="meeting-phase-grid">
              {PHASES.map((phase) => {
                const value = phaseProgress(meeting, phase.id);
                const count = meeting.tasks.filter(
                  (task) => task.phase === phase.id,
                ).length;
                return (
                  <button
                    type="button"
                    className="assistant-panel meeting-phase-card"
                    key={phase.id}
                    onClick={() => {
                      setPhaseFilter(phase.id);
                      setActiveTab("checklist");
                    }}
                  >
                    <div className={`meeting-phase-icon ${phase.id}`}>
                      {phase.id === "before" ? (
                        <ClipboardCheck size={20} />
                      ) : phase.id === "during" ? (
                        <Clock3 size={20} />
                      ) : (
                        <ReceiptText size={20} />
                      )}
                    </div>
                    <div>
                      <span>{phase.caption}</span>
                      <strong>{phase.label}</strong>
                    </div>
                    <div className="meeting-phase-score">
                      <strong>{value}%</strong>
                      <small>{count}项</small>
                    </div>
                    <div className="meeting-mini-progress">
                      <i style={{ width: `${value}%` }} />
                    </div>
                  </button>
                );
              })}
            </section>

            <section className="assistant-panel meeting-pending-panel">
              <div className="assistant-panel-heading">
                <div>
                  <span>接下来要做</span>
                  <h2>未完成事项</h2>
                </div>
                <button
                  type="button"
                  className="assistant-text-button"
                  onClick={() => setActiveTab("checklist")}
                >
                  查看全部
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="meeting-task-list compact">
                {pendingTasks.length ? (
                  pendingTasks.map((task) => (
                    <button
                      type="button"
                      className={`meeting-task-row ${task.status}`}
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                    >
                      <span
                        className={`meeting-task-check ${task.status}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleTask(task);
                        }}
                        role="checkbox"
                        aria-checked={task.status === "done"}
                        tabIndex={0}
                      >
                        {statusIcon(task.status)}
                      </span>
                      <span className="meeting-task-copy">
                        <strong>{task.title}</strong>
                        <small>
                          {task.group} · {task.dueDate || "无固定日期"}
                        </small>
                      </span>
                      <span className={`meeting-status-badge ${task.status}`}>
                        {STATUS_LABELS[task.status]}
                      </span>
                      <ChevronRight size={16} />
                    </button>
                  ))
                ) : (
                  <div className="assistant-empty">
                    <CheckCircle2 size={28} />
                    <strong>当前事项都已处理</strong>
                    <span>可以进入下一阶段了</span>
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="meeting-overview-side">
            <section className="assistant-panel meeting-risk-panel">
              <div className="assistant-panel-heading">
                <div>
                  <span>规则检查</span>
                  <h2>风险提醒</h2>
                </div>
                <AlertCircle size={20} />
              </div>
              {warnings.length ? (
                <ul>
                  {warnings.map((warning, index) => (
                    <li key={`${warning}-${index}`}>
                      <AlertCircle size={15} />
                      <span>{warning}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="meeting-all-good">
                  <CheckCircle2 size={22} />
                  <div>
                    <strong>暂未发现明显风险</strong>
                    <span>系统会持续检查车辆上限、截止时间与必填信息</span>
                  </div>
                </div>
              )}
            </section>

            <section className="assistant-panel meeting-facts">
              <div className="assistant-panel-heading">
                <div>
                  <span>会议配置</span>
                  <h2>保障范围</h2>
                </div>
              </div>
              <div className="meeting-chip-list">
                <span>
                  <UsersRound size={14} />
                  预计{meeting.attendeeEstimate}人
                </span>
                {meeting.mealType !== "none" ? (
                  <span>
                    <ReceiptText size={14} />
                    {meeting.mealType === "business" ? "商务餐" : "工作餐"}
                  </span>
                ) : null}
                {meeting.parkingRequired ? (
                  <span>
                    <Car size={14} />
                    停车保障 {meeting.vehicleCount}辆
                  </span>
                ) : null}
                {meeting.presentationRequired ? (
                  <span>
                    <FileImage size={14} />
                    PPT投屏
                  </span>
                ) : null}
                {meeting.reimbursementRequired ? (
                  <span>
                    <ReceiptText size={14} />
                    会后报销
                  </span>
                ) : null}
              </div>
              {meeting.meetingRoomId || meeting.roomRequirements ? (
                <div className="meeting-room-requirements">
                  <strong>会议室要求</strong>
                  <span>
                    {meeting.roomRequirements || "没有额外场地要求"}
                  </span>
                </div>
              ) : null}
            </section>

            <section className="assistant-panel meeting-attendee-summary">
              <span className="meeting-summary-icon small">
                <UsersRound size={20} />
              </span>
              <div>
                <small>{rosterEnabled ? "标准名单治理已启用" : "参会人员（可选）"}</small>
                <strong>
                  {meeting.attendees.length
                    ? `${meeting.attendees.length} 人`
                    : "尚未录入具体人员"}
                </strong>
              </div>
              <button
                className="assistant-button secondary"
                type="button"
                onClick={() => {
                  setAttendeeMode("people");
                  setActiveTab("attendees");
                }}
              >
                {meeting.attendees.length ? "查看人员" : "添加人员"}
                <ChevronRight size={15} />
              </button>
            </section>
          </aside>
        </div>
      ) : null}

      {displayedTab === "checklist" ? (
        <section className="meeting-checklist-view">
          <div className="meeting-checklist-toolbar">
            <div className="meeting-filter-tabs">
              <button
                type="button"
                className={phaseFilter === "all" ? "active" : ""}
                onClick={() => setPhaseFilter("all")}
              >
                全部 {meeting.tasks.length}
              </button>
              {PHASES.map((phase) => (
                <button
                  type="button"
                  className={phaseFilter === phase.id ? "active" : ""}
                  key={phase.id}
                  onClick={() => setPhaseFilter(phase.id)}
                >
                  {phase.label}{" "}
                  {
                    meeting.tasks.filter((task) => task.phase === phase.id)
                      .length
                  }
                </button>
              ))}
            </div>
            <span className="meeting-checklist-hint">
              点击事项查看说明、负责人和留痕
            </span>
          </div>

          {(phaseFilter === "all"
            ? PHASES
            : PHASES.filter((phase) => phase.id === phaseFilter)
          ).map((phase) => {
            const phaseTasks = meeting.tasks.filter(
              (task) => task.phase === phase.id,
            );
            const groups = Array.from(
              new Set(phaseTasks.map((task) => task.group)),
            );
            if (!phaseTasks.length) {
              if (phaseFilter === "all") return null;
              return (
                <div className="meeting-phase-section" key={phase.id}>
                  <div className="meeting-phase-section-heading">
                    <div className={`meeting-phase-icon ${phase.id}`}>
                      <CheckCircle2 size={19} />
                    </div>
                    <div>
                      <span>{phase.caption}</span>
                      <h2>{phase.label}</h2>
                    </div>
                    <strong>100%</strong>
                  </div>
                  <div className="meeting-empty-phase">
                    <CheckCircle2 aria-hidden="true" />
                    <div>
                      <strong>本阶段没有适用事项</strong>
                      <span>无需额外操作，系统已按完成计入进度。</span>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div className="meeting-phase-section" key={phase.id}>
                <div className="meeting-phase-section-heading">
                  <div className={`meeting-phase-icon ${phase.id}`}>
                    {phase.id === "before" ? (
                      <ClipboardCheck size={19} />
                    ) : phase.id === "during" ? (
                      <Clock3 size={19} />
                    ) : (
                      <ReceiptText size={19} />
                    )}
                  </div>
                  <div>
                    <span>{phase.caption}</span>
                    <h2>{phase.label}</h2>
                  </div>
                  <strong>{phaseProgress(meeting, phase.id)}%</strong>
                </div>
                {groups.map((group) => (
                  <section
                    className="assistant-panel meeting-task-group"
                    key={group}
                  >
                    <header>
                      <div>
                        <strong>{group}</strong>
                        <span>
                          {
                            phaseTasks.filter((task) => task.group === group)
                              .length
                          }
                          项
                        </span>
                      </div>
                    </header>
                    <div className="meeting-task-list">
                      {phaseTasks
                        .filter((task) => task.group === group)
                        .map((task) => (
                          <button
                            type="button"
                            className={`meeting-task-row ${task.status}`}
                            key={task.id}
                            onClick={() => setSelectedTaskId(task.id)}
                          >
                            <span
                              className={`meeting-task-check ${task.status}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleTask(task);
                              }}
                              role="checkbox"
                              aria-checked={task.status === "done"}
                              tabIndex={0}
                            >
                              {statusIcon(task.status)}
                            </span>
                            <span className="meeting-task-copy">
                              <strong>{task.title}</strong>
                              <small>
                                {task.description || "点击查看任务详情"}
                              </small>
                            </span>
                            {task.sopImages?.length ? (
                              <span className="meeting-task-sop">
                                <FileImage size={14} />
                                有指引
                              </span>
                            ) : null}
                            <span className="meeting-task-owner">
                              <UserRound size={14} />
                              {task.owner || "未分配"}
                            </span>
                            <span className="meeting-task-due">
                              <CalendarDays size={14} />
                              {task.dueDate || "待定"}
                            </span>
                            <span
                              className={`meeting-status-badge ${task.status}`}
                            >
                              {STATUS_LABELS[task.status]}
                            </span>
                            <ChevronRight size={16} />
                          </button>
                        ))}
                    </div>
                  </section>
                ))}
              </div>
            );
          })}
        </section>
      ) : null}

      {displayedTab === "attendees" ? (
        attendeeMode === "governance" ? (
          <EmbeddedRosterTool
            embedded
            linkedMeetingId={meeting.id}
            onExit={() => setAttendeeMode("people")}
            onWorkspaceStatusChange={setRosterWorkspaceStatus}
          />
        ) : (
        <section className="assistant-panel meeting-attendees-view">
          <div className="assistant-panel-heading">
            <div>
              <span>{rosterEnabled ? "标准名单治理已启用" : "可选会议记录"}</span>
              <h2>参会人员</h2>
            </div>
            <div className="meeting-attendee-actions">
              <button
                className="assistant-button secondary"
                type="button"
                disabled={attendeeDirty}
                title={attendeeDirty ? "请先保存人员修改" : undefined}
                onClick={() => setAttendeeMode("governance")}
              >
              <Sparkles size={17} />
                {rosterEnabled ? "整理标准名单" : "导入或治理名单"}
              </button>
              <button
                className="assistant-button primary"
                type="button"
                disabled={!attendeeDirty || attendeeSaving}
                onClick={() => void saveAttendees()}
              >
                <Check size={17} />
                保存人员
              </button>
            </div>
          </div>
          {attendeeNotice ? (
            <div className="meeting-attendee-notice" role="status">
              {attendeeNotice}
            </div>
          ) : null}
          <MeetingAttendeeEditor
            value={attendeeEditorValue}
            onChange={(attendees) => {
              setAttendeeDraft(attendees);
              setAttendeeDirty(true);
              setAttendeeNotice("");
            }}
          />
          <div className="meeting-roster-workflow-row">
            <div>
              <strong>标准名单治理</strong>
              <span>
                {rosterEnabled
                  ? "已启用排序、桌签、座次与标准名单相关任务"
                  : "当前只记录人员，不生成名单相关任务"}
              </span>
            </div>
            <button
              className="assistant-button secondary"
              type="button"
              onClick={rosterEnabled ? disableRoster : enableRoster}
            >
              {rosterEnabled ? "关闭名单治理" : "启用名单治理"}
            </button>
          </div>
        </section>
        )
      ) : null}

      <Activity mode={displayedTab === "seating" ? "visible" : "hidden"}>
        {adminConfigLoading ? <div className="assistant-loading">正在读取会议室和座次配置…</div> : <SeatingPlanner key={meeting.id} meeting={meeting} config={config} onStatusChange={setSeatingStatus} onSave={async (seatingPlan) => {
          saveMeeting({ ...meeting, seatingPlan, updatedAt: new Date().toISOString() });
          await flushMeetingPersistence();
        }} />}
      </Activity>

      {displayedTab === "vehicles" && meeting.parkingRequired ? (
        <section className="assistant-panel meeting-attendees-view">
          <div className="assistant-panel-heading">
            <div><span>独立车辆登记</span><h2>参会车辆</h2></div>
            <div className="meeting-attendee-actions">
              <button className="assistant-button secondary" type="button" disabled={vehicleBusy || vehicleDraft !== null || !meeting.vehicles?.length} onClick={() => void exportVehicles()}>导出车辆清单</button>
              {vehicleDraft !== null ? <button className="assistant-button secondary" type="button" disabled={vehicleBusy} onClick={async () => {
                if (!await confirmAction("确定放弃尚未保存的车辆修改吗？")) return;
                setVehicleDraft(null); setVehicleBaseRevision(null); setVehicleNotice("");
              }}>放弃修改</button> : null}
              <button className="assistant-button primary" type="button" disabled={vehicleBusy || vehicleDraft === null} onClick={() => void saveVehicles()}><Check size={17} />{vehicleBusy ? "正在处理…" : "保存车辆"}</button>
            </div>
          </div>
          {vehicleNotice ? <div className="meeting-attendee-notice" role="status">{vehicleNotice}</div> : null}
          <MeetingVehicleEditor value={vehicleDraft ?? meeting.vehicles ?? []} disabled={vehicleBusy} onChange={(vehicles) => {
            if (vehicleDraft === null) setVehicleBaseRevision(meeting.updatedAt);
            setVehicleDraft(vehicles); setVehicleNotice("");
          }} />
          <p className="meeting-vehicle-editor__hint">车辆登记与参会人员、名单治理独立。是否需要停车保障仍由会议设置决定；开启停车保障后，预计车辆数不会少于已登记车辆数。</p>
        </section>
      ) : null}

      {displayedTab === "sop" && meeting.reimbursementRequired ? (
        <section className="meeting-sop-view">
          <div className="meeting-sop-intro assistant-panel">
            <span className="meeting-section-icon violet">
              <ReceiptText size={20} />
            </span>
            <div>
              <span>报销操作指引</span>
              <h2>金蝶人人费用 · 业务招待申请与报销</h2>
              <p>
                这些图片属于操作说明，不计入任务数量；也可以从相关报销任务详情中直接打开。
              </p>
            </div>
          </div>
          <div className="meeting-sop-grid">
            {SOP_GUIDES.map((guide, index) => (
              <article className="assistant-panel meeting-sop-card" key={guide.id}>
                <header>
                  <span>{index + 1}</span>
                  <div>
                    <strong>{guide.title}</strong>
                    <small>{guide.caption}</small>
                  </div>
                </header>
                <Image
                  src={guide.image}
                  alt={guide.title}
                  width={1267}
                  height={695}
                  unoptimized
                />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {selectedTask ? (
        <div
          className="meeting-drawer-backdrop"
          role="presentation"
          onMouseDown={() => setSelectedTaskId(null)}
        >
          <aside
            className="meeting-task-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="meeting-task-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="meeting-drawer-close"
              onClick={() => setSelectedTaskId(null)}
              aria-label="关闭任务详情"
            >
              <X size={20} />
            </button>
            <div className="meeting-drawer-kicker">
              <span>{selectedTask.group}</span>
              <span>·</span>
              <span>
                {PHASES.find((phase) => phase.id === selectedTask.phase)?.label}
              </span>
            </div>
            <h2 id="meeting-task-title">{selectedTask.title}</h2>
            <p className="meeting-drawer-description">
              {selectedTask.description || "按实际执行情况完成并留痕。"}
            </p>

            <div className="meeting-drawer-fields">
              <label>
                <span>当前状态</span>
                <select
                  value={selectedTask.status}
                  onChange={(event) =>
                    patchTask(selectedTask.id, {
                      status: event.target.value as TaskStatus,
                    })
                  }
                >
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option value={value} key={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>负责人</span>
                <input
                  value={selectedTask.owner}
                  onChange={(event) =>
                    patchTask(selectedTask.id, { owner: event.target.value })
                  }
                  placeholder="填写负责人"
                />
              </label>
              <label>
                <span>建议截止日期</span>
                <input
                  type="date"
                  value={selectedTask.dueDate}
                  onChange={(event) =>
                    patchTask(selectedTask.id, { dueDate: event.target.value })
                  }
                />
              </label>
            </div>

            <label className="meeting-drawer-note">
              <span>
                <PencilLine size={16} />
                执行备注
              </span>
              <textarea
                value={selectedTask.note}
                onChange={(event) =>
                  patchTask(selectedTask.id, { note: event.target.value })
                }
                placeholder="记录对接情况、待确认问题或完成说明"
              />
            </label>

            <div className="meeting-drawer-attachments">
              <div>
                <span>
                  <Paperclip size={16} />
                  留痕文件
                </span>
                <label className="assistant-button secondary compact">
                  添加文件记录
                  <input
                    type="file"
                    multiple
                    onChange={(event) => addAttachments(selectedTask, event)}
                  />
                </label>
              </div>
              {selectedTask.attachments?.length ? (
                <ul>
                  {selectedTask.attachments.map((attachment, index) => (
                    <li key={`${attachment.name}-${index}`}>
                      <FileText size={15} />
                      <span>{attachment.name}</span>
                      <button
                        type="button"
                        onClick={() =>
                          patchTask(selectedTask.id, {
                            attachments: selectedTask.attachments.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      >
                        移除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <small>本机版仅记录文件名，不会复制或上传原文件。</small>
              )}
            </div>

            {selectedTask.sopImages?.length ? (
              <div className="meeting-drawer-sop">
                <span>
                  <FileImage size={16} />
                  关联操作指引
                </span>
                <div>
                  {selectedTask.sopImages.map((image) => {
                    const guide = SOP_GUIDES.find(
                      (item) => item.image === image,
                    );
                    return (
                      <button
                        type="button"
                        key={image}
                        onClick={() => {
                          setSelectedTaskId(null);
                          setActiveTab("sop");
                        }}
                      >
                        {guide?.title || "查看操作截图"}
                        <ChevronRight size={15} />
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <button
              type="button"
              className={`assistant-button wide ${
                selectedTask.status === "done" ? "secondary" : "primary"
              }`}
              onClick={() => toggleTask(selectedTask)}
            >
              {selectedTask.status === "done" ? (
                <>
                  <Circle size={17} />
                  重新设为待办
                </>
              ) : (
                <>
                  <CheckCircle2 size={17} />
                  标记为已完成
                </>
              )}
            </button>
          </aside>
        </div>
      ) : null}
      {editing && config ? (
        <MeetingEditor
          key={`${meeting.id}-${meeting.updatedAt}`}
          meeting={meeting}
          config={config}
          meetings={meetings}
          onClose={() => {
            setEditing(false);
            setMeetingEditorDirty(false);
            setMeetingEditorBusy(false);
          }}
          onDirtyChange={setMeetingEditorDirty}
          onBusyChange={setMeetingEditorBusy}
          onSave={async (next) => {
            try {
              saveMeeting(next);
              await flushMeetingPersistence();
              setStorageError("");
            } catch (error) {
              const message =
                error instanceof Error ? error.message : "会议信息保存失败";
              setStorageError(message);
              throw error;
            }
          }}
        />
      ) : null}
    </AssistantShell>
  );
}
