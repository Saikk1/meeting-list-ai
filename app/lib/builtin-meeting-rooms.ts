import type { MeetingRoomConfig } from "./admin-config";

export const MEETING_ROOM_PRESET_VERSION = 1;
// Only supplied facts are seeded. Capacity/equipment and a default selected room
// remain unregistered, rather than being inferred from floor area or table size.
export const BUILTIN_MEETING_ROOMS: MeetingRoomConfig[] = [
  { id: "room-landmark-10f-decision", name: "10F 决策室（小会议室）", location: "置地中心 10F", areaSqm: 42.7, tableDimensions: "3.2m × 1.4m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
  { id: "room-landmark-11f-command", name: "11F 指挥中心会议室", location: "置地中心 11F", areaSqm: 106.2, tableDimensions: "2m × 6.8m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
  { id: "room-landmark-11f-talk-1", name: "11F 洽谈室1", location: "置地中心 11F", areaSqm: 12, tableDimensions: "1.6m × 0.9m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
  { id: "room-landmark-11f-talk-2", name: "11F 洽谈室2", location: "置地中心 11F", areaSqm: 17.8, tableDimensions: "1.2m × 2.4m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
  { id: "room-landmark-12f-party", name: "12F 党建会议室", location: "置地中心 12F", areaSqm: 47.7, tableDimensions: "4.8m × 1.6m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
  { id: "room-landmark-12f-talk-1", name: "12F 洽谈室1", location: "置地中心 12F", areaSqm: 35, tableDimensions: "1.5m × 4m", capacity: 0, roomSize: "small", equipment: [], requirements: "", enabled: true },
];

export function meetingRoomRequirements(room: MeetingRoomConfig | undefined) {
  if (!room) return "";
  return [room.areaSqm ? `会议室面积：${room.areaSqm}㎡` : "", room.tableDimensions ? `会议桌尺寸：${room.tableDimensions}` : "", room.requirements].filter(Boolean).join("\n");
}
