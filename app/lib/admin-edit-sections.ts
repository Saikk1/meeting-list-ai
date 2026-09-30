import { cloneAdminConfig, type AdminConfig } from "./admin-config";

export const ADMIN_EDIT_SECTIONS = {
  organization: "公司与会议规则",
  rooms: "会议室",
  checklist: "清单模板",
  aliases: "单位名称字典",
  roster: "名单与导出规则",
} as const;

export type AdminEditSection = keyof typeof ADMIN_EDIT_SECTIONS;

export function isAdminEditSection(section: string): section is AdminEditSection {
  return Object.hasOwn(ADMIN_EDIT_SECTIONS, section);
}

/** Replace only the fields owned by this editor; room defaults and aliases have separate owners. */
export function replaceAdminSection(base: AdminConfig, source: AdminConfig, section: AdminEditSection): AdminConfig {
  const next = cloneAdminConfig(base);
  const incoming = cloneAdminConfig(source);
  switch (section) {
    case "organization":
      next.organization = { ...incoming.organization, defaultMeetingRoomId: next.organization.defaultMeetingRoomId };
      next.meetingRules = incoming.meetingRules;
      break;
    case "rooms":
      next.meetingRooms = incoming.meetingRooms;
      next.organization.defaultMeetingRoomId = incoming.organization.defaultMeetingRoomId;
      break;
    case "checklist":
      next.checklistTemplates = incoming.checklistTemplates;
      break;
    case "aliases":
      next.rosterRules.aliases = incoming.rosterRules.aliases;
      break;
    case "roster":
      next.rosterRules = { ...incoming.rosterRules, aliases: next.rosterRules.aliases };
      break;
  }
  return next;
}

export function adminSectionDirty(base: AdminConfig, draft: AdminConfig, section: AdminEditSection): boolean {
  return JSON.stringify(base) !== JSON.stringify(replaceAdminSection(base, draft, section));
}
