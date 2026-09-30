import type { MeetingPhase, MeetingRecord, MeetingTask } from "./meeting-data";

export type TaskCenterFilter =
  | "open"
  | "overdue"
  | "today"
  | "week"
  | "blocked"
  | "completed"
  | "all";
export type TaskDueState = "overdue" | "today" | "upcoming" | "unscheduled" | "completed";
export type TaskCenterItem = { meeting: MeetingRecord; task: MeetingTask; dueState: TaskDueState };
export type TaskCenterQuery = {
  filter: TaskCenterFilter;
  query?: string;
  owner?: string;
  phase?: MeetingPhase | "all";
};
export type TaskCenterSummary = {
  open: number;
  overdue: number;
  today: number;
  week: number;
  blocked: number;
  completed: number;
};

export function taskIsFinished(task: MeetingTask) {
  return task.status === "done" || task.status === "waived";
}

function parseLocalDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOffset(value: string, days: number) {
  const date = parseLocalDate(value);
  if (!date) return value;
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function taskDueState(task: MeetingTask, today: string): TaskDueState {
  if (taskIsFinished(task)) return "completed";
  if (!parseLocalDate(task.dueDate)) return "unscheduled";
  if (task.dueDate < today) return "overdue";
  if (task.dueDate === today) return "today";
  return "upcoming";
}

function dueRank(item: TaskCenterItem) {
  return { overdue: 0, today: 1, upcoming: 2, unscheduled: 3, completed: 4 }[item.dueState];
}

export function buildTaskCenterItems(meetings: MeetingRecord[], today: string): TaskCenterItem[] {
  return meetings
    .filter((meeting) => !meeting.archivedAt && !meeting.deletedAt)
    .flatMap((meeting) => meeting.tasks.map((task) => ({ meeting, task, dueState: taskDueState(task, today) })))
    .sort((left, right) => {
      const rank = dueRank(left) - dueRank(right);
      if (rank) return rank;
      const dueDate = (left.task.dueDate || "9999-12-31").localeCompare(right.task.dueDate || "9999-12-31");
      if (dueDate) return dueDate;
      const meetingDate = left.meeting.date.localeCompare(right.meeting.date);
      if (meetingDate) return meetingDate;
      return left.task.title.localeCompare(right.task.title, "zh-CN");
    });
}

export function summarizeTaskCenter(items: TaskCenterItem[], today: string): TaskCenterSummary {
  const weekEnd = dateOffset(today, 7);
  return items.reduce<TaskCenterSummary>((summary, item) => {
    if (taskIsFinished(item.task)) {
      summary.completed += 1;
      return summary;
    }
    summary.open += 1;
    if (item.dueState === "overdue") summary.overdue += 1;
    if (item.dueState === "today") summary.today += 1;
    if (item.task.dueDate >= today && item.task.dueDate <= weekEnd) summary.week += 1;
    if (item.task.status === "blocked") summary.blocked += 1;
    return summary;
  }, { open: 0, overdue: 0, today: 0, week: 0, blocked: 0, completed: 0 });
}

export function filterTaskCenterItems(items: TaskCenterItem[], options: TaskCenterQuery, today: string) {
  const query = (options.query ?? "").normalize("NFKC").trim().toLowerCase();
  const owner = (options.owner ?? "").trim();
  const weekEnd = dateOffset(today, 7);
  return items.filter((item) => {
    const finished = taskIsFinished(item.task);
    if (options.filter === "open" && finished) return false;
    if (options.filter === "completed" && !finished) return false;
    if (options.filter === "overdue" && item.dueState !== "overdue") return false;
    if (options.filter === "today" && item.dueState !== "today") return false;
    if (options.filter === "week" && (finished || !item.task.dueDate || item.task.dueDate < today || item.task.dueDate > weekEnd)) return false;
    if (options.filter === "blocked" && item.task.status !== "blocked") return false;
    if (owner && item.task.owner !== owner) return false;
    if (options.phase && options.phase !== "all" && item.task.phase !== options.phase) return false;
    if (!query) return true;
    return [item.task.title, item.task.description, item.task.group, item.task.owner, item.meeting.title, item.meeting.location]
      .join(" ").toLowerCase().includes(query);
  });
}
