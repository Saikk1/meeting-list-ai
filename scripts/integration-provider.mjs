// This provider is the boundary between the v1 integration contract and storage.
// A future OA/server provider implements these methods without changing routes.
function meetingDto(meeting) {
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date,
    startTime: meeting.startTime,
    endTime: meeting.endTime ?? null,
    location: meeting.location,
    meetingRoomId: meeting.meetingRoomId ?? null,
    organizer: meeting.organizer,
    owner: meeting.owner,
    attendeeEstimate: meeting.attendeeEstimate,
    vehicles: meeting.vehicles ?? [],
    status: meeting.deletedAt ? "deleted" : meeting.archivedAt ? "archived" : "active",
    createdAt: meeting.createdAt,
    updatedAt: meeting.updatedAt,
    archivedAt: meeting.archivedAt ?? null,
    deletedAt: meeting.deletedAt ?? null,
  };
}

function page(items, { limit, offset }, snapshotAt) {
  return {
    items: items.slice(offset, offset + limit),
    total: items.length,
    limit,
    offset,
    nextOffset: offset + limit < items.length ? offset + limit : null,
    snapshotAt,
  };
}

export function createLocalIntegrationProvider({ meetingsStore, contactsStore }) {
  async function findMeeting(id) {
    const snapshot = await meetingsStore.getSnapshot();
    return { snapshot, meeting: snapshot.meetings.find((item) => item.id === id) };
  }

  return {
    async listMeetings(options) {
      const snapshot = await meetingsStore.getSnapshot();
      const items = snapshot.meetings.map(meetingDto)
        .filter((meeting) => options.status === "all" || meeting.status === options.status)
        .sort((a, b) => a.id.localeCompare(b.id, "en"));
      return page(items, options, snapshot.updatedAt);
    },
    async getMeeting(id) {
      const { meeting } = await findMeeting(id);
      return meeting ? meetingDto(meeting) : null;
    },
    async listMeetingTasks(id, options) {
      const { snapshot, meeting } = await findMeeting(id);
      if (!meeting) return null;
      const items = meeting.tasks.map((task) => ({
        id: task.id,
        meetingId: meeting.id,
        title: task.title,
        description: task.description,
        phase: task.phase,
        group: task.group,
        status: task.status,
        owner: task.owner,
        dueDate: task.dueDate,
        note: task.note,
      }));
      return page(items, options, snapshot.updatedAt);
    },
    async listMeetingAttendees(id, options) {
      const { snapshot, meeting } = await findMeeting(id);
      if (!meeting) return null;
      const items = meeting.attendees.map((attendee) => ({
        id: attendee.id,
        meetingId: meeting.id,
        name: attendee.name,
        unit: attendee.unit,
        department: attendee.department,
        title: attendee.title,
      }));
      return page(items, options, snapshot.updatedAt);
    },
    async listContacts(options) {
      const snapshot = await contactsStore.list(options);
      return {
        items: snapshot.contacts.map((contact) => ({
          id: contact.id,
          name: contact.name,
          unit: contact.unit,
          department: contact.department,
          title: contact.title,
          createdAt: contact.createdAt,
          updatedAt: contact.updatedAt,
        })),
        total: snapshot.total,
        limit: options.limit,
        offset: options.offset,
        nextOffset: options.offset + options.limit < snapshot.total
          ? options.offset + options.limit : null,
        snapshotAt: snapshot.updatedAt,
      };
    },
  };
}
