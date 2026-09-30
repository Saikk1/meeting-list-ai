import type { ContactRecord } from "./contacts";
import type { MeetingRecord, MeetingTask } from "./meeting-data";

const RESULT_LIMIT = 120;

function normalized(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function searchParts(query: string) {
  const clean = normalized(query)
    .replace(/(?:帮我|请|一下|看看|查找|查询|搜索|列出|告诉我|系统里|所有|全部|哪些|还有|有没有|多少|最近|当前)/g, "");
  const parts = new Set<string>();
  for (let index = 0; index < clean.length - 1; index += 1) {
    parts.add(clean.slice(index, index + 2));
  }
  return [...parts].slice(0, 80);
}

function textScore(fields: string[], query: string, parts: string[]) {
  const haystack = normalized(fields.join(" "));
  const exact = fields.some((field) => {
    const value = normalized(field);
    return value.length >= 2 && normalized(query).includes(value);
  });
  const overlaps = parts.reduce((score, part) => score + (haystack.includes(part) ? 1 : 0), 0);
  return (exact ? 100 : 0) + overlaps;
}

function bounded<T>(items: T[]) {
  return {
    matchedTotal: items.length,
    returned: Math.min(items.length, RESULT_LIMIT),
    truncated: items.length > RESULT_LIMIT,
    items: items.slice(0, RESULT_LIMIT),
  };
}

function unfinished(task: MeetingTask) {
  return task.status !== "done" && task.status !== "waived";
}

function taskMatchesRequestedState(task: MeetingTask, query: string, today: string) {
  if (/(?:未完成|待办|没完成|还没做)/.test(query) && !unfinished(task)) return false;
  if (/(?:已完成|完成的任务)/.test(query) && unfinished(task)) return false;
  if (/(?:逾期|超期)/.test(query) && (!unfinished(task) || !task.dueDate || task.dueDate >= today)) return false;
  if (/(?:阻塞|卡住)/.test(query) && task.status !== "blocked") return false;
  if (/(?:今天到期|今日到期)/.test(query) && task.dueDate !== today) return false;
  return true;
}

function requestedMeetingStatus(meeting: MeetingRecord, query: string) {
  if (/(?:回收站|已删除)/.test(query)) return Boolean(meeting.deletedAt);
  if (/(?:归档|已归档)/.test(query)) return Boolean(meeting.archivedAt) && !meeting.deletedAt;
  if (/(?:当前会议|进行中会议|未归档)/.test(query)) return !meeting.archivedAt && !meeting.deletedAt;
  return true;
}

/**
 * Searches every local record first, then returns a size-bounded result set to
 * the model. The `matchedTotal` fields prove the scope was global even when a
 * very large result needs to be truncated for the model context window.
 */
export function buildAssistantFullDataContext(
  query: string,
  meetings: MeetingRecord[],
  contacts: ContactRecord[],
  today: string,
) {
  const parts = searchParts(query);
  const genericMeetingQuery = /(?:所有|全部|最近|哪些|多少|有没有).{0,8}(?:会议|例会)|(?:会议|例会).{0,8}(?:所有|全部|最近|哪些|多少|有没有)/.test(query);
  const genericTaskQuery = /(?:未完成|待办|逾期|超期|阻塞|卡住|今天到期|今日到期)|(?:所有|全部|哪些|多少|有没有).{0,8}(?:任务|清单|事项)/.test(query);
  const genericContactQuery = /(?:所有|全部|哪些|多少|有没有).{0,8}(?:通讯录|联系人|人员)|(?:通讯录|联系人|人员).{0,8}(?:所有|全部|哪些|多少|有没有)/.test(query);

  const meetingCandidates = meetings
    .filter((meeting) => requestedMeetingStatus(meeting, query))
    .map((meeting) => ({
      meeting,
      score: textScore([meeting.title, meeting.location, meeting.organizer, meeting.owner, ...(meeting.vehicles ?? []).flatMap((vehicle) => [vehicle.unit, vehicle.licensePlate, vehicle.note])], query, parts),
    }))
    .filter(({ score }) => genericMeetingQuery || score > 0)
    .sort((left, right) => right.score - left.score || right.meeting.updatedAt.localeCompare(left.meeting.updatedAt))
    .map(({ meeting }) => ({
      id: meeting.id,
      title: meeting.title,
      date: meeting.date,
      startTime: meeting.startTime,
      location: meeting.location,
      organizer: meeting.organizer,
      owner: meeting.owner,
      attendeeCount: meeting.attendees.length,
      vehicles: meeting.vehicles ?? [],
      taskCount: meeting.tasks.length,
      unfinishedTaskCount: meeting.tasks.filter(unfinished).length,
      status: meeting.deletedAt ? "trash" : meeting.archivedAt ? "archived" : "active",
      updatedAt: meeting.updatedAt,
    }));

  const taskCandidates = meetings
    .flatMap((meeting) => meeting.tasks.map((task) => ({ meeting, task })))
    .filter(({ task }) => taskMatchesRequestedState(task, query, today))
    .map(({ meeting, task }) => ({
      meeting,
      task,
      score: textScore([meeting.title, task.title, task.group, task.owner, task.note], query, parts),
    }))
    .filter(({ score }) => genericTaskQuery || score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return (left.task.dueDate || "9999-12-31").localeCompare(right.task.dueDate || "9999-12-31");
    })
    .map(({ meeting, task }) => ({
      meetingId: meeting.id,
      expectedUpdatedAt: meeting.updatedAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      taskId: task.id,
      title: task.title,
      phase: task.phase,
      group: task.group,
      status: task.status,
      owner: task.owner,
      dueDate: task.dueDate,
      note: task.note,
    }));

  const attendeeCandidates = meetings
    .flatMap((meeting) => meeting.attendees.map((person) => ({ meeting, person })))
    .map(({ meeting, person }) => ({
      meeting,
      person,
      score: textScore([person.name, person.unit, person.department, person.title, meeting.title], query, parts),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || right.meeting.date.localeCompare(left.meeting.date))
    .map(({ meeting, person }) => ({
      meetingId: meeting.id,
      expectedUpdatedAt: meeting.updatedAt,
      meetingTitle: meeting.title,
      meetingDate: meeting.date,
      attendeeId: person.id,
      name: person.name,
      unit: person.unit,
      department: person.department,
      title: person.title,
    }));

  const contactCandidates = contacts
    .map((contact) => ({
      contact,
      score: textScore([contact.name, contact.unit, contact.department, contact.title], query, parts),
    }))
    .filter(({ score }) => genericContactQuery || score > 0)
    .sort((left, right) => right.score - left.score || right.contact.updatedAt.localeCompare(left.contact.updatedAt))
    .map(({ contact }) => ({
      id: contact.id,
      name: contact.name,
      unit: contact.unit,
      department: contact.department,
      title: contact.title,
      meetingCount: contact.meetingCount,
      lastMeetingTitle: contact.lastMeetingTitle,
      lastMeetingDate: contact.lastMeetingDate,
      updatedAt: contact.updatedAt,
    }));

  return {
    searchedEntireStore: true,
    scope: {
      meetingTotal: meetings.length,
      activeMeetingTotal: meetings.filter((meeting) => !meeting.archivedAt && !meeting.deletedAt).length,
      archivedMeetingTotal: meetings.filter((meeting) => meeting.archivedAt && !meeting.deletedAt).length,
      deletedMeetingTotal: meetings.filter((meeting) => meeting.deletedAt).length,
      taskTotal: meetings.reduce((total, meeting) => total + meeting.tasks.length, 0),
      attendeeRecordTotal: meetings.reduce((total, meeting) => total + meeting.attendees.length, 0),
      contactTotal: contacts.length,
    },
    meetingResults: bounded(meetingCandidates),
    taskResults: bounded(taskCandidates),
    attendeeResults: bounded(attendeeCandidates),
    contactResults: bounded(contactCandidates),
  };
}
