"use client";

import { AssistantShell } from "@/app/components/assistant-shell";
import {
  EMPTY_MEETINGS,
  flushMeetingPersistence,
  loadMeetings,
  meetingProgress,
  saveMeeting,
  subscribeMeetings,
  updateMeetingTask,
  type MeetingPhase,
  type MeetingRecord,
  type MeetingTask,
  type TaskStatus,
} from "@/app/lib/meeting-data";
import {
  buildTaskCenterItems,
  filterTaskCenterItems,
  summarizeTaskCenter,
  type TaskCenterFilter,
  type TaskCenterItem,
  type TaskDueState,
} from "@/app/lib/task-center";
import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  ListChecks,
  MapPin,
  Plus,
  RotateCcw,
  Save,
  Search,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState, useSyncExternalStore } from "react";

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "待办",
  doing: "进行中",
  blocked: "阻塞",
  review: "待复核",
  done: "已完成",
  waived: "无需执行",
};

const PHASE_LABELS: Record<MeetingPhase, string> = {
  before: "会议前",
  during: "会议中",
  after: "会议后",
};

const FILTERS: Array<{
  id: Exclude<TaskCenterFilter, "all">;
  label: string;
  icon: typeof ListChecks;
}> = [
  { id: "open", label: "未完成", icon: ListChecks },
  { id: "overdue", label: "已逾期", icon: AlertTriangle },
  { id: "today", label: "今天到期", icon: Clock3 },
  { id: "week", label: "未来 7 天", icon: CalendarClock },
  { id: "blocked", label: "阻塞", icon: CircleDot },
  { id: "completed", label: "已完成", icon: CheckCircle2 },
];

type NewTaskDraft = {
  meetingId: string;
  title: string;
  phase: MeetingPhase;
  owner: string;
  dueDate: string;
};

function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function formatMeetingDate(meeting: MeetingRecord) {
  const parsed = new Date(`${meeting.date}T${meeting.startTime || "00:00"}:00`);
  if (Number.isNaN(parsed.getTime())) return `${meeting.date} ${meeting.startTime}`.trim();
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  }).format(parsed);
  return `${date} ${meeting.startTime}${meeting.endTime ? `－${meeting.endTime}` : ""}`;
}

function dueLabel(state: TaskDueState, dueDate: string) {
  if (state === "completed") return dueDate || "已结束";
  if (state === "unscheduled") return "未设截止日";
  if (state === "overdue") return `${dueDate} · 已逾期`;
  if (state === "today") return `${dueDate} · 今天`;
  return dueDate;
}

function taskId() {
  return `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function groupByMeeting(items: TaskCenterItem[]) {
  const groups = new Map<string, { meeting: MeetingRecord; items: TaskCenterItem[] }>();
  for (const item of items) {
    const group = groups.get(item.meeting.id);
    if (group) group.items.push(item);
    else groups.set(item.meeting.id, { meeting: item.meeting, items: [item] });
  }
  return [...groups.values()];
}

function OwnerEditor({
  value,
  disabled,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <input
      className="task-center-owner"
      value={draft}
      disabled={disabled}
      placeholder="待分配"
      aria-label="负责人"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const next = draft.trim();
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

export default function TaskCenterPage() {
  const meetings = useSyncExternalStore(
    subscribeMeetings,
    loadMeetings,
    () => EMPTY_MEETINGS,
  );
  const today = localDate();
  const [filter, setFilter] = useState<TaskCenterFilter>("open");
  const [query, setQuery] = useState("");
  const [owner, setOwner] = useState("");
  const [phase, setPhase] = useState<MeetingPhase | "all">("all");
  const [savingKey, setSavingKey] = useState("");
  const [operationError, setOperationError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [newTask, setNewTask] = useState<NewTaskDraft>({
    meetingId: "",
    title: "",
    phase: "before",
    owner: "",
    dueDate: "",
  });

  const items = useMemo(
    () => buildTaskCenterItems(meetings, today),
    [meetings, today],
  );
  const summary = useMemo(
    () => summarizeTaskCenter(items, today),
    [items, today],
  );
  const owners = useMemo(
    () =>
      Array.from(
        new Set(items.map(({ task }) => task.owner.trim()).filter(Boolean)),
      ).sort((left, right) => left.localeCompare(right, "zh-CN")),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      filterTaskCenterItems(
        items,
        { filter, query, owner, phase },
        today,
      ),
    [filter, items, owner, phase, query, today],
  );
  const meetingGroups = useMemo(
    () => groupByMeeting(visibleItems),
    [visibleItems],
  );

  async function persistMeeting(next: MeetingRecord) {
    saveMeeting(next);
    await flushMeetingPersistence();
  }

  async function patchTask(
    meetingId: string,
    currentTaskId: string,
    patch: Partial<MeetingTask>,
  ) {
    const key = `${meetingId}:${currentTaskId}`;
    const currentMeeting = loadMeetings().find(
      (meeting) => meeting.id === meetingId,
    );
    if (
      !currentMeeting ||
      !currentMeeting.tasks.some((task) => task.id === currentTaskId)
    ) {
      setOperationError("这项任务已发生变化，请刷新后重试。");
      return;
    }
    setSavingKey(key);
    setOperationError("");
    try {
      await persistMeeting(
        updateMeetingTask(currentMeeting, currentTaskId, patch),
      );
    } catch {
      setOperationError("本次修改未能保存，请稍后重试。");
    } finally {
      setSavingKey((current) => (current === key ? "" : current));
    }
  }

  function openCreateTask() {
    const preferred =
      meetings.find((meeting) => meeting.date >= today) ?? meetings[0];
    setNewTask({
      meetingId: preferred?.id ?? "",
      title: "",
      phase: "before",
      owner: preferred?.owner ?? "",
      dueDate: preferred?.date ?? "",
    });
    setOperationError("");
    setShowCreate(true);
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentMeeting = loadMeetings().find(
      (meeting) => meeting.id === newTask.meetingId,
    );
    const title = newTask.title.trim();
    if (!currentMeeting || !title) {
      setOperationError("请选择会议并填写事项名称。");
      return;
    }
    const id = taskId();
    setSavingKey(`${currentMeeting.id}:${id}`);
    setOperationError("");
    try {
      await persistMeeting({
        ...currentMeeting,
        updatedAt: new Date().toISOString(),
        tasks: [
          ...currentMeeting.tasks,
          {
            id,
            templateId: id,
            title,
            description: "会务待办中临时新增的事项",
            phase: newTask.phase,
            group: "临时事项",
            status: "todo",
            owner: newTask.owner.trim(),
            dueDate: newTask.dueDate,
            note: "",
            attachments: [],
          },
        ],
      });
      setFilter("open");
      setShowCreate(false);
    } catch {
      setOperationError("临时事项未能保存，请稍后重试。");
    } finally {
      setSavingKey("");
    }
  }

  function resetFilters() {
    setFilter("open");
    setQuery("");
    setOwner("");
    setPhase("all");
  }

  const focusText = summary.overdue
    ? `先处理 ${summary.overdue} 项逾期事项`
    : summary.today
      ? `今天有 ${summary.today} 项需要收口`
      : summary.open
        ? `当前还有 ${summary.open} 项未完成`
        : "当前会议事项已经全部完成";

  return (
    <AssistantShell
      title="会务待办"
      subtitle="按会议推进真实事项：今天先做什么、谁负责、什么时候完成。"
      actions={
        <button
          className="assistant-button primary assistant-button--primary"
          type="button"
          onClick={openCreateTask}
        >
          <Plus aria-hidden="true" />
          新增临时事项
        </button>
      }
    >
      <section className="task-workbench-focus">
        <div>
          <span className="assistant-eyebrow">现在先做什么</span>
          <h2>{focusText}</h2>
          <p>
            {summary.open
              ? "任务按截止时间排列，并按所属会议归组；完成后会议进度会同步更新。"
              : "没有未完成事项，无需再补点一次完成，相关会议会按实际清单显示进度。"}
          </p>
        </div>
        <div className="task-workbench-focus__counts">
          <button type="button" onClick={() => setFilter("overdue")}>
            <strong>{summary.overdue}</strong><span>逾期</span>
          </button>
          <button type="button" onClick={() => setFilter("today")}>
            <strong>{summary.today}</strong><span>今天</span>
          </button>
          <button type="button" onClick={() => setFilter("week")}>
            <strong>{summary.week}</strong><span>近 7 天</span>
          </button>
        </div>
      </section>

      {showCreate ? (
        <form className="task-create-panel" onSubmit={(event) => void createTask(event)}>
          <div className="task-create-panel__heading">
            <div>
              <span className="assistant-eyebrow">快速补充</span>
              <h2>新增一项临时会务事项</h2>
            </div>
            <button type="button" onClick={() => setShowCreate(false)} aria-label="关闭新增事项">
              <X aria-hidden="true" />
            </button>
          </div>
          {meetings.length ? (
            <div className="task-create-panel__fields">
              <label className="task-create-panel__meeting">
                <span>所属会议</span>
                <select
                  value={newTask.meetingId}
                  onChange={(event) => {
                    const nextMeeting = meetings.find((meeting) => meeting.id === event.target.value);
                    setNewTask((current) => ({
                      ...current,
                      meetingId: event.target.value,
                      owner: nextMeeting?.owner ?? current.owner,
                      dueDate: nextMeeting?.date ?? current.dueDate,
                    }));
                  }}
                >
                  {meetings.map((meeting) => (
                    <option key={meeting.id} value={meeting.id}>{meeting.title} · {meeting.date}</option>
                  ))}
                </select>
              </label>
              <label className="task-create-panel__title">
                <span>事项名称</span>
                <input autoFocus value={newTask.title} onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))} placeholder="例如：确认领导席位调整" maxLength={120} />
              </label>
              <label>
                <span>阶段</span>
                <select value={newTask.phase} onChange={(event) => setNewTask((current) => ({ ...current, phase: event.target.value as MeetingPhase }))}>
                  <option value="before">会议前</option>
                  <option value="during">会议中</option>
                  <option value="after">会议后</option>
                </select>
              </label>
              <label>
                <span>负责人</span>
                <input value={newTask.owner} onChange={(event) => setNewTask((current) => ({ ...current, owner: event.target.value }))} placeholder="可暂不分配" />
              </label>
              <label>
                <span>截止日期</span>
                <input type="date" value={newTask.dueDate} onChange={(event) => setNewTask((current) => ({ ...current, dueDate: event.target.value }))} />
              </label>
              <button className="assistant-button primary assistant-button--primary" type="submit" disabled={Boolean(savingKey)}>
                <Save aria-hidden="true" />保存事项
              </button>
            </div>
          ) : (
            <div className="task-create-panel__empty">
              需要先创建一场会议，临时事项才有归属。
              <Link href="/meetings/new">去新建会议</Link>
            </div>
          )}
        </form>
      ) : null}

      <section className="task-center-panel">
        <div className="task-center-filterbar" aria-label="待办范围">
          {FILTERS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={filter === id ? "is-active" : ""}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
              <strong>{summary[id]}</strong>
            </button>
          ))}
        </div>

        <div className="task-center-toolbar">
          <label className="task-center-search">
            <Search aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索事项或会议" aria-label="搜索待办" />
          </label>
          <select value={owner} onChange={(event) => setOwner(event.target.value)} aria-label="按负责人筛选">
            <option value="">全部负责人</option>
            {owners.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <select value={phase} onChange={(event) => setPhase(event.target.value as MeetingPhase | "all")} aria-label="按会议阶段筛选">
            <option value="all">全部阶段</option>
            <option value="before">会议前</option>
            <option value="during">会议中</option>
            <option value="after">会议后</option>
          </select>
          <button className="task-center-reset" type="button" onClick={resetFilters}>
            <RotateCcw aria-hidden="true" />重置
          </button>
        </div>

        {operationError ? <p className="assistant-inline-error">{operationError}</p> : null}

        {!items.length ? (
          <div className="meeting-empty-state task-center-empty">
            <span className="meeting-empty-state__icon"><CheckCircle2 aria-hidden="true" /></span>
            <h3>当前会议没有适用事项</h3>
            <p>没有待执行工作时会按 100% 计算；如有临时安排，可在这里直接新增。</p>
            <button className="assistant-button primary assistant-button--primary" type="button" onClick={openCreateTask}>
              <Plus aria-hidden="true" />新增临时事项
            </button>
          </div>
        ) : !visibleItems.length ? (
          <div className="meeting-empty-state task-center-empty">
            <span className="meeting-empty-state__icon"><CheckCircle2 aria-hidden="true" /></span>
            <h3>这个范围内没有事项</h3>
            <p>可以切换上方范围，或者重置搜索条件。</p>
            <button className="assistant-button secondary assistant-button--secondary" type="button" onClick={resetFilters}>重置筛选</button>
          </div>
        ) : (
          <div className="task-meeting-groups">
            {meetingGroups.map(({ meeting, items: meetingItems }) => {
              const progress = meetingProgress(meeting);
              return (
                <section className="task-meeting-group" key={meeting.id}>
                  <header className="task-meeting-group__header">
                    <div className="task-meeting-group__date">
                      <CalendarDays aria-hidden="true" />
                      <span>{formatMeetingDate(meeting)}</span>
                    </div>
                    <div className="task-meeting-group__identity">
                      <h2>{meeting.title}</h2>
                      <span><MapPin aria-hidden="true" />{meeting.location || "地点待定"}</span>
                      <span><UserRound aria-hidden="true" />{meeting.owner || "会议负责人待定"}</span>
                    </div>
                    <div className="task-meeting-group__progress">
                      <span><strong>{progress.percent}%</strong>{progress.completed}/{progress.total} 项完成</span>
                      <i><b style={{ width: `${progress.percent}%` }} /></i>
                    </div>
                    <Link href={`/meetings/${encodeURIComponent(meeting.id)}`}>
                      进入会议<ChevronRight aria-hidden="true" />
                    </Link>
                  </header>
                  <div className="task-center-list">
                    {meetingItems.map(({ task, dueState }) => {
                      const key = `${meeting.id}:${task.id}`;
                      const disabled = savingKey === key;
                      const finished = task.status === "done" || task.status === "waived";
                      return (
                        <article className={`task-center-row${finished ? " is-complete" : ""}`} key={key}>
                          <button type="button" className="task-center-complete" aria-label={finished ? "恢复为待办" : "标记为完成"} title={finished ? "恢复为待办" : "标记为完成"} disabled={disabled} onClick={() => void patchTask(meeting.id, task.id, { status: finished ? "todo" : "done" })}>
                            {finished ? <Check aria-hidden="true" /> : null}
                          </button>
                          <div className="task-center-task">
                            <div className="task-center-task__meta"><span>{PHASE_LABELS[task.phase]}</span><span>{task.group || "通用事项"}</span></div>
                            <strong>{task.title}</strong>
                            <small>{task.description || "按会议实际情况执行并留痕"}</small>
                          </div>
                          <label className="task-center-field">
                            <span>负责人</span>
                            <OwnerEditor key={task.owner} value={task.owner} disabled={disabled} onCommit={(value) => void patchTask(meeting.id, task.id, { owner: value })} />
                          </label>
                          <label className={`task-center-field task-center-due task-center-due--${dueState}`}>
                            <span>{dueLabel(dueState, task.dueDate)}</span>
                            <input type="date" value={task.dueDate} disabled={disabled} aria-label="截止日期" onChange={(event) => void patchTask(meeting.id, task.id, { dueDate: event.target.value })} />
                          </label>
                          <label className="task-center-field">
                            <span>状态</span>
                            <select className={`task-center-status task-center-status--${task.status}`} value={task.status} disabled={disabled} aria-label="任务状态" onChange={(event) => void patchTask(meeting.id, task.id, { status: event.target.value as TaskStatus })}>
                              {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                            </select>
                          </label>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </section>
    </AssistantShell>
  );
}
