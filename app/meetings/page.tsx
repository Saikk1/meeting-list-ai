"use client";

import { AssistantShell } from "@/app/components/assistant-shell";
import {
  archiveMeeting,
  createDemoMeeting,
  deleteMeeting,
  duplicateMeeting,
  EMPTY_MEETING_STORE,
  flushMeetingPersistence,
  loadMeetingStoreSnapshot,
  meetingProgress,
  purgeMeeting,
  restoreArchivedMeeting,
  restoreDeletedMeeting,
  saveMeeting,
  subscribeMeetings,
  type MeetingRecord,
} from "@/app/lib/meeting-data";
import { useAdminConfig } from "@/app/lib/use-admin-config";
import {
  ArrowRight,
  Archive,
  ArchiveRestore,
  CalendarDays,
  Car,
  Copy,
  FileText,
  LayoutGrid,
  List,
  MapPin,
  Megaphone,
  MonitorUp,
  Plus,
  ReceiptText,
  Search,
  Sparkles,
  Trash2,
  Utensils,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useSyncExternalStore } from "react";

type MeetingListView = "active" | "archived" | "trash";
type MeetingTimeFilter = "all" | "upcoming" | "week" | "month" | "past";
type MeetingDisplay = "cards" | "agenda";

const PAGE_RENDER_TIME = Date.now();

type ProgressSummary = {
  completed: number;
  total: number;
  percent: number;
};

function numericField(
  value: Record<string, unknown>,
  names: string[],
): number | undefined {
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function taskIsComplete(task: unknown) {
  if (!task || typeof task !== "object") return false;
  const status = String((task as Record<string, unknown>).status ?? "");
  return [
    "done",
    "complete",
    "completed",
    "not_applicable",
    "waived",
    "完成",
    "已完成",
    "无需执行",
  ].includes(status);
}

function getProgress(meeting: MeetingRecord): ProgressSummary {
  const raw: unknown = meetingProgress(meeting);
  const fallbackTotal = Array.isArray(meeting.tasks) ? meeting.tasks.length : 0;
  const fallbackCompleted = Array.isArray(meeting.tasks)
    ? meeting.tasks.filter(taskIsComplete).length
    : 0;

  if (typeof raw === "number") {
    const percent = raw <= 1 ? raw * 100 : raw;
    return {
      completed: fallbackCompleted,
      total: fallbackTotal,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
    };
  }

  if (raw && typeof raw === "object") {
    const value = raw as Record<string, unknown>;
    const total =
      numericField(value, ["total", "totalTasks"]) ?? fallbackTotal;
    const completed =
      numericField(value, ["completed", "completedTasks", "done"]) ??
      fallbackCompleted;
    const explicitPercent = numericField(value, [
      "percent",
      "percentage",
      "completionRate",
    ]);
    const percent =
      explicitPercent === undefined
        ? total
          ? (completed / total) * 100
          : 0
        : explicitPercent <= 1
          ? explicitPercent * 100
          : explicitPercent;

    return {
      completed,
      total,
      percent: Math.max(0, Math.min(100, Math.round(percent))),
    };
  }

  return {
    completed: fallbackCompleted,
    total: fallbackTotal,
    percent: fallbackTotal
      ? Math.round((fallbackCompleted / fallbackTotal) * 100)
      : 0,
  };
}

function meetingTime(meeting: MeetingRecord) {
  const value = new Date(
    `${meeting.date || "1970-01-01"}T${meeting.startTime || "00:00"}`,
  ).getTime();
  return Number.isFinite(value) ? value : 0;
}

function formatDate(meeting: MeetingRecord) {
  const value = new Date(
    `${meeting.date || ""}T${meeting.startTime || "00:00"}`,
  );
  if (Number.isNaN(value.getTime())) return meeting.date || "日期待定";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(value);
}

function meetingPhase(meeting: MeetingRecord) {
  const meetingDate = new Date(`${meeting.date || ""}T00:00:00`);
  if (Number.isNaN(meetingDate.getTime())) {
    return { label: "筹备中", tone: "active" };
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round(
    (meetingDate.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  );
  if (days < 0) return { label: "已结束", tone: "past" };
  if (days === 0) return { label: "今天", tone: "today" };
  if (days === 1) return { label: "明天", tone: "soon" };
  if (days <= 7) return { label: `${days} 天后`, tone: "soon" };
  return { label: "筹备中", tone: "active" };
}

function meetingTags(meeting: MeetingRecord) {
  const tags: { label: string; icon: typeof Car }[] = [];
  if (meeting.mealType && meeting.mealType !== "none") {
    tags.push({
      label:
        meeting.mealType === "business"
          ? "商务用餐"
          : meeting.mealType === "work"
            ? "工作餐"
            : "用餐保障",
      icon: Utensils,
    });
  }
  if (meeting.parkingRequired) {
    tags.push({ label: "停车保障", icon: Car });
  }
  if (meeting.publicityRequired) {
    tags.push({ label: "宣传拍摄", icon: Megaphone });
  }
  if (meeting.reimbursementRequired) {
    tags.push({ label: "报销归档", icon: ReceiptText });
  }
  if (meeting.presentationRequired) {
    tags.push({ label: "会议演示", icon: MonitorUp });
  }
  if (!tags.length) {
    tags.push({ label: "标准会议", icon: FileText });
  }
  return tags.slice(0, 4);
}

export default function MeetingsPage() {
  const {
    config,
    revision,
    loading: configLoading,
    error: configError,
  } = useAdminConfig();
  const meetingStore = useSyncExternalStore(
    subscribeMeetings,
    loadMeetingStoreSnapshot,
    () => EMPTY_MEETING_STORE,
  );
  const [view, setView] = useState<MeetingListView>("active");
  const [operationError, setOperationError] = useState("");
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<MeetingTimeFilter>("all");
  const [display, setDisplay] = useState<MeetingDisplay>("cards");
  const meetings = meetingStore[view === "trash" ? "deleted" : view];

  const sortedMeetings = useMemo(
    () =>
      meetings
        .filter((meeting) => {
          const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
          if (
            normalizedQuery &&
            ![
              meeting.title,
              meeting.organizer,
              meeting.owner,
              meeting.location,
            ].some((value) =>
              value.toLocaleLowerCase("zh-CN").includes(normalizedQuery),
            )
          ) {
            return false;
          }
          if (view !== "active" || timeFilter === "all") return true;
          const value = meetingTime(meeting);
          const now = PAGE_RENDER_TIME;
          if (timeFilter === "upcoming") return value >= now;
          if (timeFilter === "past") return value < now;
          if (timeFilter === "week") {
            return value >= now && value <= now + 7 * 24 * 60 * 60 * 1000;
          }
          const currentMonth = new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Shanghai",
            year: "numeric",
            month: "2-digit",
          }).format(new Date(now));
          return meeting.date.startsWith(currentMonth);
        })
        .sort((left, right) => {
        const leftPast = meetingTime(left) < PAGE_RENDER_TIME;
        const rightPast = meetingTime(right) < PAGE_RENDER_TIME;
        if (leftPast !== rightPast) return leftPast ? 1 : -1;
        return leftPast
          ? meetingTime(right) - meetingTime(left)
          : meetingTime(left) - meetingTime(right);
      }),
    [meetings, query, timeFilter, view],
  );
  const agendaGroups = useMemo(() => {
    const groups = new Map<string, MeetingRecord[]>();
    for (const meeting of sortedMeetings) {
      const key = meeting.date || "date-pending";
      groups.set(key, [...(groups.get(key) ?? []), meeting]);
    }
    return [...groups.entries()];
  }, [sortedMeetings]);

  async function runMeetingOperation(operation: () => void | Promise<void>) {
    setOperationError("");
    try {
      await operation();
      await flushMeetingPersistence();
      return true;
    } catch (error) {
      setOperationError(
        error instanceof Error
          ? error.message
          : "会议操作未能写入本机数据文件，请稍后重试。",
      );
      return false;
    }
  }

  async function addDemoMeeting() {
    if (configLoading || configError || !config) return;
    await runMeetingOperation(() => {
      createDemoMeeting({
        checklistTemplates: config.checklistTemplates,
        configRevision: revision,
        meetingRules: config.meetingRules,
        meetingDefaults: {
          organizer: config.organization.name,
          owner: config.organization.defaultOwner,
          startTime: config.organization.defaultStartTime,
          attendeeEstimate: config.organization.defaultAttendeeEstimate,
          roomSize: config.organization.defaultRoomSize,
          presentationRequired:
            config.organization.defaultPresentationRequired,
        },
      });
    });
  }

  async function removeMeeting(meeting: MeetingRecord) {
    if (
      !window.confirm(
        `确定将“${meeting.title || "未命名会议"}”移入回收站吗？之后仍可恢复。`,
      )
    ) {
      return;
    }
    await runMeetingOperation(() => deleteMeeting(meeting.id));
  }

  async function copyMeeting(meeting: MeetingRecord) {
    const completed = await runMeetingOperation(() =>
      saveMeeting(duplicateMeeting(meeting)),
    );
    if (completed) setView("active");
  }

  async function archive(meeting: MeetingRecord) {
    await runMeetingOperation(() => archiveMeeting(meeting.id));
  }

  async function restoreArchive(meeting: MeetingRecord) {
    const completed = await runMeetingOperation(() =>
      restoreArchivedMeeting(meeting.id),
    );
    if (completed) setView("active");
  }

  async function restoreDeleted(meeting: MeetingRecord) {
    const completed = await runMeetingOperation(() =>
      restoreDeletedMeeting(meeting.id),
    );
    if (completed) setView("active");
  }

  async function removePermanently(meeting: MeetingRecord) {
    if (
      !window.confirm(
        `彻底删除“${meeting.title || "未命名会议"}”后将无法恢复，是否继续？`,
      )
    ) {
      return;
    }
    await runMeetingOperation(() => purgeMeeting(meeting.id));
  }

  return (
    <AssistantShell
      title="我的会议"
      subtitle="一场会议一个项目，名单、清单和材料在项目内相互关联。"
      actions={
        <Link
          className="assistant-button primary assistant-button--primary"
          href="/meetings/new"
        >
          <Plus aria-hidden="true" />
          新建会议
        </Link>
      }
    >
      {operationError ? (
        <p className="meeting-list-error" role="alert">
          {operationError}
        </p>
      ) : null}
      <nav className="meeting-list-views" aria-label="会议分类">
        {[
          ["active", "当前会议", meetingStore.active.length],
          ["archived", "已归档", meetingStore.archived.length],
          ["trash", "回收站", meetingStore.deleted.length],
        ].map(([id, label, count]) => (
          <button
            type="button"
            key={String(id)}
            className={view === id ? "active" : ""}
            onClick={() => setView(id as MeetingListView)}
          >
            {String(label)} <small>{Number(count)}</small>
          </button>
        ))}
      </nav>
      <section className="meeting-list-toolbar" aria-label="查找和显示会议">
        <label className="meeting-list-search">
          <Search aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会议名称、地点、负责人或组织单位"
            aria-label="搜索会议"
          />
        </label>
        {view === "active" ? (
          <div className="meeting-list-filters" aria-label="会议时间范围">
            {[
              ["all", "全部"],
              ["upcoming", "待举行"],
              ["week", "未来7天"],
              ["month", "本月"],
              ["past", "已结束"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                className={timeFilter === id ? "active" : ""}
                onClick={() => setTimeFilter(id as MeetingTimeFilter)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="meeting-display-switch" aria-label="显示方式">
          <button
            type="button"
            className={display === "cards" ? "active" : ""}
            onClick={() => setDisplay("cards")}
            title="卡片视图"
          >
            <LayoutGrid aria-hidden="true" />
            卡片
          </button>
          <button
            type="button"
            className={display === "agenda" ? "active" : ""}
            onClick={() => setDisplay("agenda")}
            title="日程视图"
          >
            <List aria-hidden="true" />
            日程
          </button>
        </div>
      </section>
      {!meetings.length ? (
        <section className="meeting-empty-state meeting-empty-state--page">
          <span className="meeting-empty-state__icon">
            {view === "active" ? (
              <CalendarDays aria-hidden="true" />
            ) : view === "archived" ? (
              <Archive aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </span>
          <span className="assistant-eyebrow">
            <Sparkles aria-hidden="true" />
            {view === "active"
              ? "从一场会议开始"
              : view === "archived"
                ? "归档会议"
                : "安全删除"}
          </span>
          <h2>
            {view === "active"
              ? "会议项目还是空的"
              : view === "archived"
                ? "还没有归档会议"
                : "回收站是空的"}
          </h2>
          <p>
            {view === "active"
              ? "新建项目后，系统会根据用餐、停车、宣传和报销等情景生成适用的保障清单。"
              : view === "archived"
                ? "完成的会议可以归档，历史信息和任务留痕仍会保留。"
                : "删除的会议会先进入这里，可以恢复，也可以确认后彻底删除。"}
          </p>
          {view === "active" ? (
            <div className="meeting-empty-state__actions">
            <Link
              className="assistant-button primary assistant-button--primary"
              href="/meetings/new"
            >
              <Plus aria-hidden="true" />
              新建会议
            </Link>
            <button
              className="assistant-button secondary assistant-button--secondary"
              type="button"
              disabled={configLoading || Boolean(configError)}
              title={
                configError
                  ? "管理中心配置读取失败，请先修复后再创建"
                  : undefined
              }
              onClick={addDemoMeeting}
            >
              <Sparkles aria-hidden="true" />
              创建演示会议
            </button>
            </div>
          ) : null}
        </section>
      ) : !sortedMeetings.length ? (
        <section className="meeting-empty-state meeting-empty-state--page meeting-empty-state--filtered">
          <span className="meeting-empty-state__icon">
            <Search aria-hidden="true" />
          </span>
          <span className="assistant-eyebrow">没有匹配结果</span>
          <h2>换个关键词或时间范围试试</h2>
          <p>当前会议数据没有被删除，只是被搜索或时间条件暂时隐藏。</p>
          <button
            className="assistant-button secondary assistant-button--secondary"
            type="button"
            onClick={() => {
              setQuery("");
              setTimeFilter("all");
            }}
          >
            清除筛选条件
          </button>
        </section>
      ) : (
        <section className="meeting-list-section">
          <div className="meeting-list-summary">
            <div>
              <span className="assistant-eyebrow">会议项目</span>
              <h2>
                {sortedMeetings.length} 场
                {view === "active" ? "会议正在管理" : view === "archived" ? "会议已归档" : "会议待处理"}
              </h2>
            </div>
            <p>
              {view === "active"
                ? "即将开始的会议优先显示，已结束会议自动排在后面。"
                : view === "archived"
                  ? "归档不会删除会议，随时可以恢复到当前会议。"
                  : "回收站内会议不会参与工作台统计和智能助手操作。"}
            </p>
          </div>

          {display === "agenda" ? (
            <div className="meeting-agenda">
              {agendaGroups.map(([date, items]) => (
                <section className="meeting-agenda-day" key={date}>
                  <header>
                    <CalendarDays aria-hidden="true" />
                    <div>
                      <strong>{formatDate(items[0])}</strong>
                      <span>{items.length} 场会议</span>
                    </div>
                  </header>
                  <div className="meeting-agenda-items">
                    {items.map((meeting) => {
                      const progress = getProgress(meeting);
                      return (
                        <Link
                          className="meeting-agenda-item"
                          href={
                            view === "trash"
                              ? "/meetings"
                              : `/meetings/${meeting.id}`
                          }
                          key={meeting.id}
                          onClick={
                            view === "trash"
                              ? (event) => {
                                  event.preventDefault();
                                  void restoreDeleted(meeting);
                                }
                              : undefined
                          }
                        >
                          <time>
                            {meeting.startTime || "待定"}
                            {meeting.endTime ? `–${meeting.endTime}` : ""}
                          </time>
                          <div className="meeting-agenda-item__main">
                            <strong>{meeting.title || "未命名会议"}</strong>
                            <span>
                              {meeting.location || "地点待定"}
                              {meeting.owner ? ` · ${meeting.owner}负责` : ""}
                            </span>
                          </div>
                          <div className="meeting-agenda-item__progress">
                            <span>{progress.percent}%</span>
                            <small>
                              {progress.completed}/{progress.total} 项
                            </small>
                          </div>
                          <ArrowRight aria-hidden="true" />
                        </Link>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
          <div className="meeting-card-grid">
            {sortedMeetings.map((meeting) => {
              const progress = getProgress(meeting);
              const phase = meetingPhase(meeting);
              const attendees = Array.isArray(meeting.attendees)
                ? meeting.attendees.length
                : 0;

              return (
                <article className="meeting-card" key={meeting.id}>
                  <div className="meeting-card__topline">
                    <span
                      className={`meeting-status meeting-status--${phase.tone}`}
                    >
                      {phase.label}
                    </span>
                    <div className="meeting-card__actions">
                      {view === "trash" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void restoreDeleted(meeting)}
                            aria-label={`恢复${meeting.title || "该会议"}`}
                            title="恢复会议"
                          >
                            <ArchiveRestore aria-hidden="true" />
                          </button>
                          <button
                            className="danger"
                            type="button"
                            onClick={() => void removePermanently(meeting)}
                            aria-label={`彻底删除${meeting.title || "该会议"}`}
                            title="彻底删除"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void copyMeeting(meeting)}
                            aria-label={`复制${meeting.title || "该会议"}`}
                            title="复制会议"
                          >
                            <Copy aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void (view === "archived"
                                ? restoreArchive(meeting)
                                : archive(meeting))
                            }
                            aria-label={`${view === "archived" ? "恢复" : "归档"}${meeting.title || "该会议"}`}
                            title={view === "archived" ? "恢复到当前会议" : "归档会议"}
                          >
                            {view === "archived" ? (
                              <ArchiveRestore aria-hidden="true" />
                            ) : (
                              <Archive aria-hidden="true" />
                            )}
                          </button>
                          <button
                            className="danger"
                            type="button"
                            onClick={() => void removeMeeting(meeting)}
                            aria-label={`删除${meeting.title || "该会议"}`}
                            title="移入回收站"
                          >
                            <Trash2 aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="meeting-card__heading">
                    <h2>{meeting.title || "未命名会议"}</h2>
                    <p>
                      {meeting.organizer
                        ? `${meeting.organizer} · `
                        : ""}
                      {meeting.owner ? `${meeting.owner}负责` : "负责人待定"}
                    </p>
                  </div>

                  <dl className="meeting-card__meta">
                    <div>
                      <dt>
                        <CalendarDays aria-hidden="true" />
                        日期
                      </dt>
                      <dd>
                        {formatDate(meeting)}
                        {meeting.startTime ? ` ${meeting.startTime}` : ""}
                        {meeting.endTime ? `－${meeting.endTime}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt>
                        <MapPin aria-hidden="true" />
                        地点
                      </dt>
                      <dd>{meeting.location || "待确定"}</dd>
                    </div>
                    <div>
                      <dt>
                        <UsersRound aria-hidden="true" />
                        人数
                      </dt>
                      <dd>
                        {attendees || meeting.attendeeEstimate || 0} 人
                        {attendees ? "（已录入）" : "（预计）"}
                      </dd>
                    </div>
                  </dl>

                  <div className="meeting-tag-list" aria-label="保障情景">
                    {meetingTags(meeting).map(({ label, icon: Icon }) => (
                      <span className="meeting-tag" key={label}>
                        <Icon aria-hidden="true" />
                        {label}
                      </span>
                    ))}
                  </div>

                  <div className="meeting-progress">
                    <div className="meeting-progress__label">
                      <span>保障进度</span>
                      <strong>
                        {progress.completed}/{progress.total} 项 ·{" "}
                        {progress.percent}%
                      </strong>
                    </div>
                    <div
                      className="meeting-progress__track"
                      role="progressbar"
                      aria-label={`${meeting.title || "会议"}保障进度`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress.percent}
                    >
                      <span
                        className="meeting-progress__value"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>

                  {view === "trash" ? (
                    <button
                      className="meeting-card__open"
                      type="button"
                      onClick={() => void restoreDeleted(meeting)}
                    >
                      恢复会议
                      <ArchiveRestore aria-hidden="true" />
                    </button>
                  ) : (
                    <Link
                      className="meeting-card__open"
                      href={`/meetings/${meeting.id}`}
                    >
                      打开会议
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  )}
                </article>
              );
            })}
          </div>
          )}
        </section>
      )}
    </AssistantShell>
  );
}
