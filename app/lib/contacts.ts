import type { MeetingAttendee, MeetingRecord } from "./meeting-data";

export type ContactInput = {
  name: string;
  unit: string;
  department: string;
  title: string;
  /** Legacy data only; vehicles are registered on meetings, not contacts. */
  licensePlate?: string;
};

export type ContactRecord = ContactInput & {
  id: string;
  identityAliases?: string[];
  manualOverride?: boolean;
  createdAt: string;
  updatedAt: string;
  meetingCount: number;
  meetingIds: string[];
  lastMeetingId: string;
  lastMeetingTitle: string;
  lastMeetingDate: string;
};

export type ContactListPayload = {
  schemaVersion: number;
  updatedAt: string | null;
  total: number;
  contacts: ContactRecord[];
};

async function contactApiError(response: Response) {
  try {
    const payload = (await response.json()) as {
      error?: string | { message?: string };
    };
    if (typeof payload.error === "string" && payload.error) {
      return payload.error;
    }
    if (
      payload.error &&
      typeof payload.error === "object" &&
      typeof payload.error.message === "string"
    ) {
      return payload.error.message;
    }
  } catch {
    // Fall through to the status-based message.
  }
  return `通讯录服务请求失败（${response.status}）`;
}

async function contactRequest<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(await contactApiError(response));
  }
  return (await response.json()) as T;
}

export function listContacts({
  query = "",
  limit = 50,
  offset = 0,
  signal,
}: {
  query?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}) {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    offset: String(offset),
  });
  return contactRequest<ContactListPayload>(`/api/contacts?${params}`, {
    signal,
  });
}

export async function replaceContacts(contacts: ContactRecord[]) {
  return contactRequest<{ replaced: true; total: number }>("/api/contacts", {
    method: "PUT",
    body: JSON.stringify({ contacts }),
  });
}

export async function createContact(contact: ContactInput) {
  const payload = await contactRequest<{ contact: ContactRecord }>(
    "/api/contacts",
    {
      method: "POST",
      body: JSON.stringify({ contact }),
    },
  );
  return payload.contact;
}

export async function updateContact(id: string, contact: ContactInput) {
  const payload = await contactRequest<{ contact: ContactRecord }>(
    `/api/contacts/${encodeURIComponent(id)}`,
    {
      method: "PUT",
      body: JSON.stringify({ contact }),
    },
  );
  return payload.contact;
}

export function deleteContact(id: string) {
  return contactRequest<{ deleted: true; total: number }>(
    `/api/contacts/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

function attendeeToContact(attendee: MeetingAttendee): ContactInput {
  return {
    name: attendee.name,
    unit: attendee.unit,
    department: attendee.department,
    title: attendee.title,
  };
}

export function syncMeetingContacts(meeting: MeetingRecord) {
  const completeAttendees = meeting.attendees.filter(
    (attendee) => attendee.name.trim() && attendee.unit.trim(),
  );
  const skipped = meeting.attendees.length - completeAttendees.length;
  if (!completeAttendees.length) {
    return Promise.resolve({ upserted: 0, total: 0, skipped, synced: 0 });
  }
  return contactRequest<{ upserted: number; total: number }>(
    "/api/contacts/upsert",
    {
      method: "POST",
      body: JSON.stringify({
        meeting: {
          id: meeting.id,
          title: meeting.title,
          date: meeting.date,
        },
        contacts: completeAttendees.map(attendeeToContact),
      }),
    },
  ).then((result) => ({
    ...result,
    skipped,
    synced: completeAttendees.length,
  }));
}

export async function syncHistoricalMeetingContacts(
  meetings: MeetingRecord[],
) {
  let upserted = 0;
  let total = 0;
  let skipped = 0;
  for (const meeting of meetings) {
    if (!meeting.attendees.length) continue;
    const result = await syncMeetingContacts(meeting);
    upserted += result.upserted;
    skipped += result.skipped;
    if (result.synced) total = result.total;
  }
  if (!total) {
    total = (await listContacts({ limit: 1 })).total;
  }
  return { upserted, total, skipped };
}
