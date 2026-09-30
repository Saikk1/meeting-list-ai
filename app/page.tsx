"use client";

import { AssistantShell } from "@/app/components/assistant-shell";
import {
  createDemoMeeting,
  EMPTY_MEETINGS,
  flushMeetingPersistence,
  loadMeetings,
  meetingProgress,
  subscribeMeetings,
  type MeetingRecord,
} from "@/app/lib/meeting-data";
import { useAdminConfig } from "@/app/lib/use-admin-config";
import {
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  FileSpreadsheet,
  ListChecks,
  MapPin,
  Plus,
  Sparkles,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useSyncExternalStore } from "react";

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
    const calculatedPercent = total ? (completed / total) * 100 : 0;
    const percent =
      explicitPercent === undefined
        ? calculatedPercent
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

function formatMeetingDate(meeting: MeetingRecord) {
  const value = new Date(
    `${meeting.date || ""}T${meeting.startTime || "00:00"}`,
  );
  if (Number.isNaN(value.getTime())) return meeting.date || "日期待定";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(value);
}

function sortByRecentlyUpdated(meetings: MeetingRecord[]) {
  return [...meetings].sort((left, right) => {
    const leftUpdated = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightUpdated = new Date(
      right.updatedAt || right.createdAt || 0,
    ).getTime();
    return rightUpdated - leftUpdated || meetingTime(right) - meetingTime(left);
  });
}

export default function DashboardPage() {
  const {
    config,
    revision,
    loading: configLoading,
    error: configError,
  } = useAdminConfig();
  const meetings = useSyncExternalStore(
    subscribeMeetings,
    loadMeetings,
    () => EMPTY_MEETINGS,
  );

  const dashboard = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const progress = meetings.map(getProgress);
    const upcoming = meetings.filter(
      (meeting) => meetingTime(meeting) >= today.getTime(),
    ).length;
    const attendeeTotal = meetings.reduce((total, meeting) => {
      const actual = Array.isArray(meeting.attendees)
        ? meeting.attendees.length
        : 0;
      return total + (actual || meeting.attendeeEstimate || 0);
    }, 0);
    const completedTasks = progress.reduce(
      (total, item) => total + item.completed,
      0,
    );
    const totalTasks = progress.reduce((total, item) => total + item.total, 0);

    return {
      upcoming,
      attendeeTotal,
      completedTasks,
      totalTasks,
      recent: sortByRecentlyUpdated(meetings).slice(0, 3),
    };
  }, [meetings]);

  async function addDemoMeeting() {
    if (configLoading || configError || !config) return;
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
    await flushMeetingPersistence();
  }

  return (
    <AssistantShell
      title="工作台"
      subtitle="从一场会议出发，名单、任务和保障进度各归其位。"
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
      <section className="assistant-hero">
        <div className="assistant-hero__content">
          <span className="assistant-eyebrow">
            <Sparkles aria-hidden="true" />
            AI 全流程会议助手
          </span>
          <h2>把一次会议，从名单到收尾管清楚</h2>
          <p>
            名单治理、流程核对、责任跟进和会后归档，都在一个系统里顺畅衔接。
          </p>
          <div className="assistant-hero__actions">
            <Link
              className="assistant-button primary assistant-button--primary"
              href="/meetings/new"
            >
              新建一场会议
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link
              className="assistant-button secondary assistant-button--secondary"
              href="/lists"
            >
              <FileSpreadsheet aria-hidden="true" />
              整理参会名单
            </Link>
          </div>
        </div>
        <div className="assistant-hero__visual" aria-hidden="true">
          <span className="assistant-hero__orb assistant-hero__orb--one" />
          <span className="assistant-hero__orb assistant-hero__orb--two" />
          <div className="assistant-hero__mini-card">
            <CheckCircle2 />
            <span>
              <strong>会前准备</strong>
              任务按情景自动生成
            </span>
          </div>
          <div className="assistant-hero__mini-card assistant-hero__mini-card--offset">
            <UsersRound />
            <span>
              <strong>人员名单</strong>
              同单位归并排序
            </span>
          </div>
        </div>
      </section>

      <section className="assistant-section" aria-labelledby="quick-tools-title">
        <div className="assistant-section__heading">
          <div>
            <span className="assistant-eyebrow">快速开始</span>
            <h2 id="quick-tools-title">常用工作入口</h2>
          </div>
        </div>
        <div className="assistant-tool-grid">
          <Link className="assistant-tool-card" href="/tasks">
            <span className="assistant-tool-card__icon assistant-tool-card__icon--blue"><ListChecks aria-hidden="true" /></span>
            <span className="assistant-tool-card__copy"><small>跨会议工作区</small><strong>会务待办</strong><span>集中查看逾期、今日和近期任务，直接调整负责人、期限与进度。</span></span>
            <ArrowRight className="assistant-tool-card__arrow" aria-hidden="true" />
          </Link>
          <Link className="assistant-tool-card" href="/lists">
            <span className="assistant-tool-card__icon assistant-tool-card__icon--blue">
              <ClipboardList aria-hidden="true" />
            </span>
            <span className="assistant-tool-card__copy">
              <small>系统模块</small>
              <strong>名单治理</strong>
              <span>导入杂乱名单，智能识别、人工核对并导出标准 Excel。</span>
            </span>
            <ArrowRight className="assistant-tool-card__arrow" aria-hidden="true" />
          </Link>

          <Link
            className="assistant-tool-card"
            href="/meetings"
          >
            <span className="assistant-tool-card__icon assistant-tool-card__icon--violet">
              <ClipboardCheck aria-hidden="true" />
            </span>
            <span className="assistant-tool-card__copy">
              <small>会议项目</small>
              <strong>流程核对</strong>
              <span>按会议情景生成保障任务，逐项落实负责人、时限和附件。</span>
            </span>
            <ArrowRight className="assistant-tool-card__arrow" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <section className="assistant-stat-grid" aria-label="会议统计">
        <article className="assistant-stat-card">
          <span className="assistant-stat-card__icon">
            <CalendarDays aria-hidden="true" />
          </span>
          <span>
            <strong>{dashboard.upcoming}</strong>
            <small>待办会议</small>
          </span>
        </article>
        <article className="assistant-stat-card">
          <span className="assistant-stat-card__icon">
            <UsersRound aria-hidden="true" />
          </span>
          <span>
            <strong>{dashboard.attendeeTotal}</strong>
            <small>预计参会人员</small>
          </span>
        </article>
        <article className="assistant-stat-card">
          <span className="assistant-stat-card__icon">
            <ClipboardCheck aria-hidden="true" />
          </span>
          <span>
            <strong>{dashboard.totalTasks}</strong>
            <small>保障任务</small>
          </span>
        </article>
        <article className="assistant-stat-card">
          <span className="assistant-stat-card__icon">
            <CheckCircle2 aria-hidden="true" />
          </span>
          <span>
            <strong>{dashboard.completedTasks}</strong>
            <small>已完成事项</small>
          </span>
        </article>
      </section>

      <section className="assistant-section" aria-labelledby="recent-title">
        <div className="assistant-section__heading">
          <div>
            <span className="assistant-eyebrow">持续推进</span>
            <h2 id="recent-title">最近会议</h2>
          </div>
          {meetings.length ? (
            <Link className="assistant-text-link" href="/meetings">
              查看全部
              <ArrowRight aria-hidden="true" />
            </Link>
          ) : null}
        </div>

        {!dashboard.recent.length ? (
          <div className="meeting-empty-state">
            <span className="meeting-empty-state__icon">
              <CalendarDays aria-hidden="true" />
            </span>
            <h3>还没有会议项目</h3>
            <p>可以先创建一场演示会议，看看全流程核对如何运作。</p>
            <div className="meeting-empty-state__actions">
              <button
                className="assistant-button primary assistant-button--primary"
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
              <Link
                className="assistant-button secondary assistant-button--secondary"
                href="/meetings/new"
              >
                自己新建
              </Link>
            </div>
          </div>
        ) : (
          <div className="meeting-recent-list">
            {dashboard.recent.map((meeting) => {
              const progress = getProgress(meeting);
              return (
                <Link
                  className="meeting-recent-card"
                  href={`/meetings/${meeting.id}`}
                  key={meeting.id}
                >
                  <span className="meeting-recent-card__date">
                    <CalendarDays aria-hidden="true" />
                    {formatMeetingDate(meeting)}
                  </span>
                  <span className="meeting-recent-card__body">
                    <strong>{meeting.title || "未命名会议"}</strong>
                    <small>
                      <MapPin aria-hidden="true" />
                      {meeting.location || "地点待定"}
                    </small>
                  </span>
                  <span className="meeting-recent-card__progress">
                    <small>
                      <Clock3 aria-hidden="true" />
                      {progress.completed}/{progress.total} 项
                    </small>
                    <strong>{progress.percent}%</strong>
                  </span>
                  <ArrowRight
                    className="meeting-recent-card__arrow"
                    aria-hidden="true"
                  />
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </AssistantShell>
  );
}
