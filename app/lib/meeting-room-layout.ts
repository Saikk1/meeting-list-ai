import type { MeetingRoomConfig } from "./admin-config";
import type { SeatingOptions } from "./seating";

export const MEETING_ROOM_TABLE_TYPES = {
  unconfigured: "未配置",
  rectangular: "长方桌",
  round: "圆桌 / 宴会式",
  podium: "主席台 / 排座",
} as const;

export type MeetingRoomTableType = keyof typeof MEETING_ROOM_TABLE_TYPES;

export function isMeetingRoomTableType(value: unknown): value is MeetingRoomTableType {
  return typeof value === "string" && Object.hasOwn(MEETING_ROOM_TABLE_TYPES, value);
}

// Physical room defaults only select a general layout. They never infer capacity,
// guest/host counts, center positions, or overwrite a saved seating plan.
export function applyMeetingRoomTableType(
  options: SeatingOptions,
  room: Pick<MeetingRoomConfig, "tableType"> | undefined,
): SeatingOptions {
  const template = room?.tableType === "rectangular" ? "table"
    : room?.tableType === "round" ? "round"
      : room?.tableType === "podium" ? "podium-auto" : undefined;
  return template ? { ...options, template } : { ...options };
}
