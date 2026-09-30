import type {
  RosterOutputFieldKey,
  RosterRules,
} from "./admin-config";
import type { MeetingAttendee, MeetingRecord } from "./meeting-data";
import {
  formatRosterExportFileName,
  freezeFirstRowInXlsx,
} from "./roster-export";
import { rankRosterRecords } from "./roster-ranking";

export type AssistantRosterExportPayload = {
  meeting: MeetingRecord;
  rosterRules: RosterRules;
  records: MeetingAttendee[];
  fileName: string;
};

function outputValue(
  key: RosterOutputFieldKey,
  attendee: MeetingAttendee,
  index: number,
) {
  switch (key) {
    case "sequence":
      return index + 1;
    case "name":
      return attendee.name;
    case "unit":
      return attendee.unit;
    case "department":
      return attendee.department;
    case "title":
      return attendee.title;
    case "source":
      return attendee.source ?? "";
  }
}

function attendeeWithoutRankingIndex(
  attendee: MeetingAttendee & { originalIndex: number },
): MeetingAttendee {
  return {
    id: attendee.id,
    name: attendee.name,
    unit: attendee.unit,
    department: attendee.department,
    title: attendee.title,
    ...(attendee.source ? { source: attendee.source } : {}),
  };
}

export function prepareAssistantRosterExport(
  meeting: MeetingRecord,
  rosterRules: RosterRules,
  now = new Date(),
): AssistantRosterExportPayload {
  if (!rosterRules.outputFields.some((field) => field.enabled)) {
    throw new Error("名单导出至少需要启用一个输出字段");
  }
  const records = rankRosterRecords(
    meeting.attendees.map((attendee, originalIndex) => ({
      ...attendee,
      originalIndex,
    })),
    rosterRules,
  ).records.map(attendeeWithoutRankingIndex);
  return {
    meeting,
    rosterRules,
    records,
    fileName: formatRosterExportFileName(
      rosterRules.exportFileNameTemplate,
      meeting.title,
      now,
    ),
  };
}

export async function buildAssistantRosterXlsx(
  payload: AssistantRosterExportPayload,
): Promise<ArrayBuffer> {
  const fields = payload.rosterRules.outputFields.filter(
    (field) => field.enabled,
  );
  if (!fields.length) {
    throw new Error("名单导出至少需要启用一个输出字段");
  }

  const XLSX = await import("xlsx");
  const rows = [
    fields.map((field) => field.label),
    ...payload.records.map((attendee, index) =>
      fields.map(
        (field) => outputValue(field.key, attendee, index) ?? "",
      ),
    ),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  worksheet["!cols"] = fields.map((field) => ({ wch: field.width }));
  if (payload.rosterRules.autoFilter) {
    worksheet["!autofilter"] = {
      ref: XLSX.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: rows.length - 1, c: fields.length - 1 },
      }),
    };
  }
  if (payload.rosterRules.freezeHeader) {
    (
      worksheet as typeof worksheet & {
        "!views": Array<Record<string, string | number>>;
      }
    )["!views"] = [
      {
        state: "frozen",
        ySplit: 1,
        topLeftCell: "A2",
        activePane: "bottomLeft",
      },
    ];
  }

  const workbook = XLSX.utils.book_new();
  const worksheetName =
    payload.rosterRules.worksheetName
      .replace(/[\[\]:*?/\\]/g, "_")
      .slice(0, 31) || "参会人员名单";
  XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
  let output = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  }) as ArrayBuffer;
  if (payload.rosterRules.freezeHeader) {
    const frozen = freezeFirstRowInXlsx(output);
    output = frozen.buffer.slice(
      frozen.byteOffset,
      frozen.byteOffset + frozen.byteLength,
    ) as ArrayBuffer;
  }
  return output;
}

export async function downloadAssistantRosterXlsx(
  payload: AssistantRosterExportPayload,
): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("当前环境无法下载名单文件");
  }
  const output = await buildAssistantRosterXlsx(payload);
  const blob = new Blob([output], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = payload.fileName;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
  return payload.fileName;
}
