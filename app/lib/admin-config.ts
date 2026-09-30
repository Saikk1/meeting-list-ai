import { CHECKLIST_TEMPLATE } from "./meeting-data";
import { BUILTIN_MEETING_ROOMS, MEETING_ROOM_PRESET_VERSION } from "./builtin-meeting-rooms";

export type RosterOutputFieldKey =
  | "sequence"
  | "name"
  | "unit"
  | "department"
  | "title"
  | "source";

export type RosterOutputField = {
  key: RosterOutputFieldKey;
  label: string;
  width: number;
  enabled: boolean;
};

export type UnitAliasRule = {
  id: string;
  canonical: string;
  aliases: string[];
  mode: "auto" | "confirm";
  enabled: boolean;
  notes: string;
};

export type RankingTier = {
  id: string;
  label: string;
  priority: number;
  keywords: string[];
  description: string;
  enabled: boolean;
};

export type UnitRankOverride = {
  id: string;
  unit: string;
  tierId: string;
  withinTierOrder: number;
  enabled: boolean;
  notes: string;
};

export type RosterRankingRules = {
  mode: "authority" | "pinyin";
  unitTiers: RankingTier[];
  unitOverrides: UnitRankOverride[];
  unknownUnitTierId: string;
  titleTiers: RankingTier[];
  unknownTitleTierId: string;
  unitTieBreak: "manual-then-pinyin" | "pinyin" | "source";
  personTieBreak: "manual-then-source" | "source" | "name";
  ai: {
    enabled: boolean;
    webSearch: "off" | "on-demand";
    rankingApply: "review";
    titleFillApply: "review" | "verified-auto";
    minimumConfidence: number;
    preferredDomains: string[];
    maxSearchQueriesPerRun: number;
  };
};

export type ChecklistTemplateConfig =
  (typeof CHECKLIST_TEMPLATE)[number] & {
    enabled: boolean;
  };

export type MeetingRoomConfig = {
  id: string;
  name: string;
  location: string;
  areaSqm?: number;
  tableDimensions?: string;
  capacity: number;
  roomSize: "small" | "large";
  equipment: string[];
  requirements: string;
  enabled: boolean;
};

export type AdminConfig = {
  schemaVersion: 2;
  meetingRoomPresetVersion?: number;
  organization: {
    name: string;
    defaultOwner: string;
    defaultStartTime: string;
    defaultAttendeeEstimate: number;
    defaultRoomSize: "small" | "large";
    defaultPresentationRequired: boolean;
    defaultMeetingRoomId: string;
  };
  meetingRules: {
    parkingVehicleLimit: number;
    businessMealMin: number;
    businessMealMax: number;
    waterServiceIntervalMinutes: number;
    reminders: {
      missingLocation: boolean;
      missingOwner: boolean;
      missingRoster: boolean;
      overdueTasks: boolean;
      blockedTasks: boolean;
    };
  };
  meetingRooms: MeetingRoomConfig[];
  checklistTemplates: ChecklistTemplateConfig[];
  rosterRules: {
    sortDirection: "asc" | "desc";
    withinUnitOrder: "title" | "source" | "name";
    ranking: RosterRankingRules;
    outputFields: RosterOutputField[];
    exportFileNameTemplate: string;
    worksheetName: string;
    autoFilter: boolean;
    freezeHeader: boolean;
    aliases: UnitAliasRule[];
    extractionPromptSuffix: string;
  };
};

export type RosterRules = AdminConfig["rosterRules"];
export type OrganizationAlias = UnitAliasRule;

export type AdminConfigHistoryEntry = {
  revision: number;
  updatedAt: string;
  summary: string;
};

export type AdminConfigPayload = {
  revision: number;
  updatedAt: string | null;
  summary: string;
  config: AdminConfig | null;
  history: AdminConfigHistoryEntry[];
};

export const DEFAULT_ADMIN_CONFIG: AdminConfig = {
  schemaVersion: 2,
  meetingRoomPresetVersion: MEETING_ROOM_PRESET_VERSION,
  organization: {
    name: "会务智办",
    defaultOwner: "会务小组",
    defaultStartTime: "14:00",
    defaultAttendeeEstimate: 20,
    defaultRoomSize: "small",
    defaultPresentationRequired: true,
    defaultMeetingRoomId: "",
  },
  meetingRules: {
    parkingVehicleLimit: 4,
    businessMealMin: 300,
    businessMealMax: 400,
    waterServiceIntervalMinutes: 30,
    reminders: {
      missingLocation: true,
      missingOwner: true,
      missingRoster: true,
      overdueTasks: true,
      blockedTasks: true,
    },
  },
  meetingRooms: structuredClone(BUILTIN_MEETING_ROOMS),
  checklistTemplates: CHECKLIST_TEMPLATE.map((item) => ({
    ...item,
    sopImages: item.sopImages ? [...item.sopImages] : undefined,
    enabled: true,
  })),
  rosterRules: {
    sortDirection: "asc",
    withinUnitOrder: "title",
    ranking: {
      mode: "authority",
      unitTiers: [
        {
          id: "unit-central-government",
          label: "国家级机关与中央单位",
          priority: 100,
          keywords: [
            "中共中央",
            "国务院",
            "全国人大",
            "全国政协",
            "最高人民法院",
            "最高人民检察院",
          ],
          description: "中央层级只使用明确关键词，其余情况由指定单位或 AI 核验",
          enabled: true,
        },
        {
          id: "unit-provincial-government",
          label: "省级党政机关",
          priority: 200,
          keywords: [
            "省委",
            "省人民政府",
            "省人大常委会",
            "省政协",
            "省高级人民法院",
            "省人民检察院",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "unit-municipal-government",
          label: "市级党政机关",
          priority: 300,
          keywords: [
            "市委",
            "市人民政府",
            "市人大常委会",
            "市政协",
            "市中级人民法院",
            "市人民检察院",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "unit-district-government",
          label: "区县级党政机关",
          priority: 400,
          keywords: [
            "区委",
            "县委",
            "区人民政府",
            "县人民政府",
            "区人大常委会",
            "县人大常委会",
            "区政协",
            "县政协",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "unit-government-other",
          label: "其他党政机关与监管部门",
          priority: 450,
          keywords: ["管理局", "委员会"],
          description: "无法从名称判断行政层级时使用，建议再人工或联网核验",
          enabled: true,
        },
        {
          id: "unit-public-institution",
          label: "事业单位、院校及科研机构",
          priority: 500,
          keywords: ["事业单位", "研究院", "研究所", "大学", "学院"],
          description: "",
          enabled: true,
        },
        {
          id: "unit-state-enterprise",
          label: "国有企业",
          priority: 600,
          keywords: ["国有资本", "国资运营"],
          description: "所有制不宜仅凭名称判断，优先使用单位覆盖或联网核验",
          enabled: true,
        },
        {
          id: "unit-social-organization",
          label: "协会及社会组织",
          priority: 700,
          keywords: ["协会", "商会", "学会", "联合会"],
          description: "",
          enabled: true,
        },
        {
          id: "unit-enterprise",
          label: "其他企业",
          priority: 800,
          keywords: ["有限公司", "公司", "集团", "银行"],
          description: "",
          enabled: true,
        },
        {
          id: "unit-other",
          label: "未识别单位",
          priority: 9000,
          keywords: [],
          description: "没有命中规则时使用",
          enabled: true,
        },
      ],
      unitOverrides: [],
      unknownUnitTierId: "unit-other",
      titleTiers: [
        {
          id: "title-principal",
          label: "主要负责人",
          priority: 100,
          keywords: [
            "党委书记",
            "党组书记",
            "董事长",
            "局长",
            "主任",
            "院长",
            "校长",
            "会长",
            "执行总裁",
            "总裁",
            "总经理",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "title-deputy",
          label: "副职领导",
          priority: 200,
          keywords: [
            "党委副书记",
            "党组副书记",
            "副董事长",
            "副局长",
            "副主任",
            "副院长",
            "副校长",
            "副会长",
            "常务副总经理",
            "副总经理",
            "副总裁",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "title-middle",
          label: "中层正职",
          priority: 300,
          keywords: [
            "办公室主任",
            "部门主任",
            "秘书长",
            "总监",
            "部长",
            "处长",
            "科长",
            "所长",
            "经理",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "title-deputy-middle",
          label: "中层副职",
          priority: 400,
          keywords: [
            "副办公室主任",
            "副部门主任",
            "副总监",
            "副部长",
            "副处长",
            "副科长",
            "副所长",
            "副经理",
          ],
          description: "",
          enabled: true,
        },
        {
          id: "title-professional",
          label: "专业及其他岗位",
          priority: 500,
          keywords: ["研究员", "教授", "高级工程师", "工程师", "顾问", "专员"],
          description: "",
          enabled: true,
        },
        {
          id: "title-other",
          label: "职务未知",
          priority: 9000,
          keywords: [],
          description: "职务为空或没有命中规则时使用",
          enabled: true,
        },
      ],
      unknownTitleTierId: "title-other",
      unitTieBreak: "manual-then-pinyin",
      personTieBreak: "manual-then-source",
      ai: {
        enabled: true,
        webSearch: "on-demand",
        rankingApply: "review",
        titleFillApply: "review",
        minimumConfidence: 0.92,
        preferredDomains: ["gov.cn"],
        maxSearchQueriesPerRun: 30,
      },
    },
    outputFields: [
      { key: "sequence", label: "序号", width: 10, enabled: true },
      { key: "name", label: "姓名", width: 16, enabled: true },
      { key: "unit", label: "单位", width: 34, enabled: true },
      { key: "department", label: "部门", width: 24, enabled: false },
      { key: "title", label: "职务", width: 24, enabled: true },
      { key: "source", label: "来源", width: 24, enabled: false },
    ],
    exportFileNameTemplate: "{会议名称}_参会名单_{日期}",
    worksheetName: "参会人员名单",
    autoFilter: true,
    freezeHeader: true,
    aliases: [],
    extractionPromptSuffix: "",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value),
  );
}

function hasValidBaseConfig(value: unknown) {
  if (!isRecord(value)) return false;
  const organization = value.organization;
  const meetingRules = value.meetingRules;
  const rosterRules = value.rosterRules;
  const meetingRooms = value.meetingRooms;
  if (
    ![1, 2].includes(Number(value.schemaVersion)) ||
    !isRecord(organization) ||
    !isRecord(meetingRules) ||
    !isRecord(meetingRules.reminders) ||
    !Array.isArray(value.checklistTemplates) ||
    !isRecord(rosterRules) ||
    !Array.isArray(rosterRules.outputFields) ||
    !Array.isArray(rosterRules.aliases)
  ) {
    return false;
  }

  const reminders = meetingRules.reminders;
  const reminderKeys = [
    "missingLocation",
    "missingOwner",
    "missingRoster",
    "overdueTasks",
    "blockedTasks",
  ];
  const checklistValid = value.checklistTemplates.every(
    (item) =>
      isRecord(item) &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.description === "string" &&
      ["before", "during", "after"].includes(String(item.phase)) &&
      typeof item.group === "string" &&
      typeof item.condition === "string" &&
      typeof item.dueOffsetDays === "number" &&
      typeof item.enabled === "boolean" &&
      (item.sopImages === undefined ||
        (Array.isArray(item.sopImages) &&
          item.sopImages.every((image) => typeof image === "string"))),
  );
  const outputFieldsValid = rosterRules.outputFields.every(
    (field) =>
      isRecord(field) &&
      typeof field.key === "string" &&
      typeof field.label === "string" &&
      typeof field.width === "number" &&
      typeof field.enabled === "boolean",
  );
  const aliasesValid = rosterRules.aliases.every(
    (alias) =>
      isRecord(alias) &&
      typeof alias.id === "string" &&
      typeof alias.canonical === "string" &&
      Array.isArray(alias.aliases) &&
      alias.aliases.every((entry) => typeof entry === "string") &&
      ["auto", "confirm"].includes(String(alias.mode)) &&
      typeof alias.enabled === "boolean" &&
      typeof alias.notes === "string",
  );
  const meetingRoomsValid =
    meetingRooms === undefined ||
    (Array.isArray(meetingRooms) &&
      meetingRooms.every(
        (room) =>
          isRecord(room) &&
          typeof room.id === "string" &&
          typeof room.name === "string" &&
          typeof room.location === "string" &&
          (room.areaSqm === undefined || (typeof room.areaSqm === "number" && Number.isFinite(room.areaSqm) && room.areaSqm > 0 && room.areaSqm <= 100000)) &&
          (room.tableDimensions === undefined || (typeof room.tableDimensions === "string" && room.tableDimensions.length <= 120)) &&
          typeof room.capacity === "number" &&
          Number.isFinite(room.capacity) &&
          room.capacity >= 0 &&
          ["small", "large"].includes(String(room.roomSize)) &&
          Array.isArray(room.equipment) &&
          room.equipment.every((item) => typeof item === "string") &&
          typeof room.requirements === "string" &&
          typeof room.enabled === "boolean",
      ));

  return (
    typeof organization.name === "string" &&
    typeof organization.defaultOwner === "string" &&
    typeof organization.defaultStartTime === "string" &&
    typeof organization.defaultAttendeeEstimate === "number" &&
    ["small", "large"].includes(String(organization.defaultRoomSize)) &&
    typeof organization.defaultPresentationRequired === "boolean" &&
    (organization.defaultMeetingRoomId === undefined ||
      typeof organization.defaultMeetingRoomId === "string") &&
    typeof meetingRules.parkingVehicleLimit === "number" &&
    typeof meetingRules.businessMealMin === "number" &&
    typeof meetingRules.businessMealMax === "number" &&
    typeof meetingRules.waterServiceIntervalMinutes === "number" &&
    reminderKeys.every((key) => typeof reminders[key] === "boolean") &&
    checklistValid &&
    ["asc", "desc"].includes(String(rosterRules.sortDirection)) &&
    ["title", "source", "name"].includes(String(rosterRules.withinUnitOrder)) &&
    outputFieldsValid &&
    typeof rosterRules.exportFileNameTemplate === "string" &&
    typeof rosterRules.worksheetName === "string" &&
    typeof rosterRules.autoFilter === "boolean" &&
    typeof rosterRules.freezeHeader === "boolean" &&
    aliasesValid &&
    meetingRoomsValid &&
    (value.meetingRoomPresetVersion === undefined || (Number.isInteger(value.meetingRoomPresetVersion) && Number(value.meetingRoomPresetVersion) >= 1 && Number(value.meetingRoomPresetVersion) <= 10000)) &&
    typeof rosterRules.extractionPromptSuffix === "string"
  );
}

function isRankingTier(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    Array.isArray(value.keywords) &&
    value.keywords.every((keyword) => typeof keyword === "string") &&
    typeof value.description === "string" &&
    typeof value.enabled === "boolean"
  );
}

function isUnitRankOverride(value: unknown) {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.unit === "string" &&
    typeof value.tierId === "string" &&
    typeof value.withinTierOrder === "number" &&
    Number.isFinite(value.withinTierOrder) &&
    typeof value.notes === "string" &&
    typeof value.enabled === "boolean"
  );
}

function isRankingRules(value: unknown): value is RosterRankingRules {
  if (!isRecord(value) || !isRecord(value.ai)) return false;
  return (
    ["authority", "pinyin"].includes(String(value.mode)) &&
    Array.isArray(value.unitTiers) &&
    value.unitTiers.every(isRankingTier) &&
    Array.isArray(value.unitOverrides) &&
    value.unitOverrides.every(isUnitRankOverride) &&
    typeof value.unknownUnitTierId === "string" &&
    Array.isArray(value.titleTiers) &&
    value.titleTiers.every(isRankingTier) &&
    typeof value.unknownTitleTierId === "string" &&
    ["manual-then-pinyin", "pinyin", "source"].includes(
      String(value.unitTieBreak),
    ) &&
    ["manual-then-source", "source", "name"].includes(
      String(value.personTieBreak),
    ) &&
    typeof value.ai.enabled === "boolean" &&
    ["off", "on-demand"].includes(String(value.ai.webSearch)) &&
    value.ai.rankingApply === "review" &&
    ["review", "verified-auto"].includes(String(value.ai.titleFillApply)) &&
    typeof value.ai.minimumConfidence === "number" &&
    Number.isFinite(value.ai.minimumConfidence) &&
    Array.isArray(value.ai.preferredDomains) &&
    value.ai.preferredDomains.every((domain) => typeof domain === "string") &&
    typeof value.ai.maxSearchQueriesPerRun === "number" &&
    Number.isFinite(value.ai.maxSearchQueriesPerRun)
  );
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function normalizeOptionalRosterConditions(config: AdminConfig) {
  config.checklistTemplates = config.checklistTemplates.map((item) => {
    if (
      ["print-nameplates", "seat-order"].includes(item.id) &&
      item.condition === "always"
    ) {
      return { ...item, condition: "roster" };
    }
    if (
      item.id === "electronic-nameplate" &&
      item.condition === "welcomeScreen"
    ) {
      return { ...item, condition: "rosterWelcomeScreen" };
    }
    return item;
  });
  return config;
}

function normalizeMeetingRooms(config: AdminConfig) {
  // Transitional configs may contain the old person-bound plate column.
  config.rosterRules.outputFields = config.rosterRules.outputFields.filter(
    (field) => (field.key as string) !== "licensePlate",
  );
  config.meetingRooms = Array.isArray(config.meetingRooms)
    ? config.meetingRooms.map((room) => ({
        ...room,
        equipment: Array.isArray(room.equipment) ? [...room.equipment] : [],
      }))
    : [];
  config.organization.defaultMeetingRoomId =
    typeof config.organization.defaultMeetingRoomId === "string"
      ? config.organization.defaultMeetingRoomId
      : "";
  if (
    config.organization.defaultMeetingRoomId &&
    !config.meetingRooms.some(
      (room) =>
        room.id === config.organization.defaultMeetingRoomId && room.enabled,
    )
  ) {
    config.organization.defaultMeetingRoomId = "";
  }
  return config;
}

export function upgradeAdminConfig(value: unknown): AdminConfig | null {
  if (!hasValidBaseConfig(value) || !isRecord(value)) return null;
  const rosterRules = value.rosterRules as Record<string, unknown>;
  if (Number(value.schemaVersion) === 2) {
    if (!isRankingRules(rosterRules.ranking)) return null;
    return normalizeMeetingRooms(
      normalizeOptionalRosterConditions(deepClone(value) as AdminConfig),
    );
  }

  const legacy = deepClone(value) as Record<string, unknown>;
  const legacyRoster = legacy.rosterRules as Record<string, unknown>;
  legacy.schemaVersion = 2;
  legacyRoster.ranking = {
    ...deepClone(DEFAULT_ADMIN_CONFIG.rosterRules.ranking),
    mode: "pinyin",
  };
  if (legacyRoster.withinUnitOrder === "title") {
    legacyRoster.withinUnitOrder = "source";
  }
  return normalizeMeetingRooms(
    normalizeOptionalRosterConditions(legacy as AdminConfig),
  );
}

export function cloneAdminConfig(config: unknown = DEFAULT_ADMIN_CONFIG) {
  return deepClone(upgradeAdminConfig(config) ?? DEFAULT_ADMIN_CONFIG);
}

export function isAdminConfig(value: unknown) {
  return upgradeAdminConfig(value) !== null;
}
