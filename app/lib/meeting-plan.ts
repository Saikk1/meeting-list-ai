import type { MeetingAttendee, MeetingRecord } from "./meeting-data";
import { validateMeetingPlan } from "../../scripts/meeting-plan-schema.mjs";

export type PlanPerson = Pick<MeetingAttendee, "id" | "name" | "unit" | "department" | "title">;
export type PlanGroup = { id: string; label: string; people: PlanPerson[]; collective: string };
export type PlanAgenda = { id: string; content: string; speaker: string; duration: string };
export type MeetingPlanSource = { title: string; time: string; location: string; people: string };
export type MeetingPlan = {
  title: string; background: string; date: string; startTime: string; endTime: string; location: string;
  groups: PlanGroup[]; agenda: PlanAgenda[]; source: MeetingPlanSource;
};
export type MeetingPlanPatch = Partial<Omit<MeetingPlan, "source">>;
export const PLAN_SOURCE_LABELS = { title: "会议名称", time: "会议时间", location: "会议地点", people: "参会人员" };
export function planSource(meeting: MeetingRecord): MeetingPlanSource {
  return { title: meeting.title, time: JSON.stringify([meeting.date, meeting.startTime, meeting.endTime || ""]), location: meeting.location,
    people: JSON.stringify(meeting.attendees.map(({ id, name, unit, department, title }) => ({ id, name, unit, department, title }))) };
}
export function planTitle(title: string) { return /会议方案$/.test(title.trim()) ? title.trim() : `${title.trim()}会议方案`; }
function groupPeople(people: PlanPerson[]): PlanGroup[] {
  const groups: PlanGroup[] = [];
  for (const person of people) {
    const label = person.unit || "单位待确认";
    let group = groups.find((g) => g.label === label);
    if (!group) { group = { id: `group-${groups.length}-${person.id}`, label, people: [], collective: "" }; groups.push(group); }
    group.people.push({ id: person.id, name: person.name, unit: person.unit, department: person.department, title: person.title });
  }
  return groups;
}
export function createMeetingPlan(meeting: MeetingRecord): MeetingPlan {
  return { title: planTitle(meeting.title), background: "", date: meeting.date, startTime: meeting.startTime, endTime: meeting.endTime || "", location: meeting.location,
    groups: groupPeople(meeting.attendees), agenda: [], source: planSource(meeting) };
}
export function planSourceChanges(plan: MeetingPlan, meeting: MeetingRecord) {
  const next = planSource(meeting);
  return (Object.keys(next) as (keyof MeetingPlanSource)[]).filter((key) => plan.source[key] !== next[key]);
}
export function syncPlanSource(plan: MeetingPlan, meeting: MeetingRecord, keys: (keyof MeetingPlanSource)[]): MeetingPlan {
  const next = structuredClone(plan), source = planSource(meeting);
  for (const key of keys) {
    if (key === "title") next.title = planTitle(meeting.title);
    if (key === "time") { next.date = meeting.date; next.startTime = meeting.startTime; next.endTime = meeting.endTime || ""; }
    if (key === "location") next.location = meeting.location;
    if (key === "people") {
      const remaining = new Map(meeting.attendees.map((p) => [p.id, p]));
      next.groups = next.groups.map((g) => ({ ...g, people: g.people.flatMap((p) => {
        const current = remaining.get(p.id); remaining.delete(p.id);
        return current ? [{ id: current.id, name: current.name, unit: current.unit, department: current.department, title: current.title }] : [];
      }) }));
      for (const group of groupPeople([...remaining.values()])) {
        const existing = next.groups.find((g) => g.label === group.label);
        if (existing) existing.people.push(...group.people); else next.groups.push(group);
      }
    }
    next.source[key] = source[key];
  }
  return validateMeetingPlan(next);
}
export function planWarnings(plan: MeetingPlan): string[] {
  return [!plan.title.trim() && "方案标题待补充", !plan.background.trim() && "会议背景待补充", !plan.date && "会议日期待确认", !plan.startTime && "开始时间待确认", !plan.location.trim() && "地点待确认",
    !plan.groups.some((g) => g.people.length || g.collective.trim()) && "参会人员待确认", !plan.agenda.some((a) => a.content.trim()) && "会议议程待补充",
    /待确认|待补充|待定/.test(JSON.stringify([plan.background, plan.groups, plan.agenda])) && "正文包含待确认内容"].filter(Boolean) as string[];
}
export function planTime(plan: Pick<MeetingPlan, "date" | "startTime" | "endTime">) {
  const d = plan.date ? plan.date.replace(/^(\d+)-(\d+)-(\d+)$/, (_, y, m, day) => `${y}年${Number(m)}月${Number(day)}日`) : "日期待确认";
  return `${d} ${plan.startTime || "时间待确认"}${plan.endTime ? `—${plan.endTime}` : ""}`;
}
export function agendaText(a: PlanAgenda) { return `${a.content || "议程待补充"}${a.speaker ? `（${a.speaker}）` : ""}${a.duration ? `（${a.duration}）` : ""}`; }
