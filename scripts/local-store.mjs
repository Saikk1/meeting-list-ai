import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { validateSeatingPlan } from "./seating-schema.mjs";

const SCHEMA_VERSION = 1;
const ADMIN_CONFIG_SCHEMA_VERSION = 2;
const MAX_HISTORY_ITEMS = 20;
const MAX_STORED_BYTES = 2 * 1024 * 1024;
const CONFIG_FILE_NAME = "admin-config.json";
const BACKUP_FILE_NAME = `${CONFIG_FILE_NAME}.bak`;
const CONTACT_SCHEMA_VERSION = 1;
const CONTACTS_FILE_NAME = "contacts.json";
const CONTACTS_BACKUP_FILE_NAME = `${CONTACTS_FILE_NAME}.bak`;
const MAX_CONTACTS = 20_000;
const MAX_CONTACTS_BYTES = 8 * 1024 * 1024;
const MAX_CONTACT_MEETING_IDS = 500;
const MAX_CONTACT_IDENTITY_ALIASES = 32;
const MEETINGS_SCHEMA_VERSION = 1;
const MEETINGS_FILE_NAME = "meetings.json";
const MEETINGS_BACKUP_FILE_NAME = `${MEETINGS_FILE_NAME}.bak`;
const MAX_MEETINGS = 5_000;
const MAX_MEETINGS_BYTES = 32 * 1024 * 1024;
const MAX_MEETING_TASKS = 1_000;
const MAX_MEETING_ATTENDEES = 5_000;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const MEETING_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,199}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const FORBIDDEN_SECRET_KEY =
  /^(?:api[-_]?key|access[-_]?token|refresh[-_]?token|secret|password|credential|authorization)$/i;

const PHASES = new Set(["before", "during", "after"]);
const CONDITIONS = new Set([
  "always",
  "roster",
  "rosterWelcomeScreen",
  "afternoon",
  "businessMeal",
  "businessMealAlcohol",
  "workMeal",
  "parking",
  "publicity",
  "presentation",
  "welcomeScreen",
  "largeMeeting",
  "reimbursement",
  "mealReimbursement",
]);
const OUTPUT_FIELD_KEYS = new Set([
  "sequence",
  "name",
  "unit",
  "department",
  "title",
  "source",
  "licensePlate",
]);

export class LocalConfigError extends Error {
  constructor(message, { code = "INVALID_CONFIG", status = 400, details } = {}) {
    super(message);
    this.name = "LocalConfigError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function fail(path, message) {
  throw new LocalConfigError(`${path}: ${message}`, {
    details: { path, message },
  });
}

function assertPlainObject(value, path) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    fail(path, "必须是对象");
  }
}

function assertExactKeys(value, allowedKeys, path, optionalKeys = []) {
  const allowed = new Set([...allowedKeys, ...optionalKeys]);
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_SECRET_KEY.test(key)) {
      fail(`${path}.${key}`, "禁止保存 API Key、令牌、密码或其他密钥");
    }
    if (!allowed.has(key)) fail(`${path}.${key}`, "不支持此字段");
  }
  for (const key of allowedKeys) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, "缺少必填字段");
  }
}

function assertString(value, path, minLength, maxLength) {
  if (typeof value !== "string") fail(path, "必须是字符串");
  const length = [...value].length;
  if (length < minLength || length > maxLength) {
    fail(path, `长度必须在 ${minLength} 到 ${maxLength} 个字符之间`);
  }
}

function assertBoolean(value, path) {
  if (typeof value !== "boolean") fail(path, "必须是布尔值");
}

function assertInteger(value, path, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    fail(path, `必须是 ${minimum} 到 ${maximum} 之间的整数`);
  }
}

function assertEnum(value, path, allowed) {
  if (!allowed.has(value)) {
    fail(path, `必须是以下值之一：${[...allowed].join("、")}`);
  }
}

function assertIdentifier(value, path) {
  assertString(value, path, 2, 64);
  if (!ID_PATTERN.test(value)) {
    fail(path, "必须以小写字母或数字开头，且只能包含小写字母、数字和连字符");
  }
}

function assertMeetingIdentifier(value, path) {
  assertString(value, path, 2, 200);
  if (!MEETING_ID_PATTERN.test(value)) {
    fail(path, "必须以小写字母或数字开头，且只能包含小写字母、数字和连字符");
  }
}

function assertNoSecretKeys(value, path = "config") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretKeys(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEY.test(key)) {
      fail(`${path}.${key}`, "禁止保存 API Key、令牌、密码或其他密钥");
    }
    assertNoSecretKeys(child, `${path}.${key}`);
  }
}

function validateRankingTiers(tiers, path, fallbackId) {
  if (!Array.isArray(tiers) || tiers.length < 1 || tiers.length > 50) {
    fail(path, "必须包含 1 到 50 个排序层级");
  }
  const ids = new Set();
  const priorities = new Set();
  const keywords = new Set();
  tiers.forEach((tier, index) => {
    const tierPath = `${path}[${index}]`;
    assertPlainObject(tier, tierPath);
    assertExactKeys(
      tier,
      ["id", "label", "priority", "keywords", "description", "enabled"],
      tierPath,
    );
    assertIdentifier(tier.id, `${tierPath}.id`);
    if (ids.has(tier.id)) fail(`${tierPath}.id`, "层级 ID 必须唯一");
    ids.add(tier.id);
    assertString(tier.label, `${tierPath}.label`, 1, 80);
    assertInteger(tier.priority, `${tierPath}.priority`, 0, 10000);
    if (priorities.has(tier.priority)) {
      fail(`${tierPath}.priority`, "同一组层级的优先级必须唯一");
    }
    priorities.add(tier.priority);
    if (!Array.isArray(tier.keywords) || tier.keywords.length > 100) {
      fail(`${tierPath}.keywords`, "必须是最多包含 100 项的数组");
    }
    tier.keywords.forEach((keyword, keywordIndex) => {
      const keywordPath = `${tierPath}.keywords[${keywordIndex}]`;
      assertString(keyword, keywordPath, 1, 80);
      const normalized = keyword.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      if (keywords.has(normalized)) fail(keywordPath, "排序关键词不能重复");
      keywords.add(normalized);
    });
    assertString(tier.description, `${tierPath}.description`, 0, 300);
    assertBoolean(tier.enabled, `${tierPath}.enabled`);
  });
  const fallback = tiers.find((tier) => tier.id === fallbackId);
  if (!fallback || !fallback.enabled || fallback.keywords.length !== 0) {
    fail(path, "兜底层级必须存在、启用且关键词为空");
  }
  return ids;
}

function validateRosterRanking(ranking, path) {
  assertPlainObject(ranking, path);
  assertExactKeys(
    ranking,
    [
      "mode",
      "unitTiers",
      "unitOverrides",
      "unknownUnitTierId",
      "titleTiers",
      "unknownTitleTierId",
      "unitTieBreak",
      "personTieBreak",
      "ai",
    ],
    path,
  );
  assertEnum(ranking.mode, `${path}.mode`, new Set(["authority", "pinyin"]));
  assertString(ranking.unknownUnitTierId, `${path}.unknownUnitTierId`, 2, 64);
  assertString(ranking.unknownTitleTierId, `${path}.unknownTitleTierId`, 2, 64);
  const unitTierIds = validateRankingTiers(
    ranking.unitTiers,
    `${path}.unitTiers`,
    ranking.unknownUnitTierId,
  );
  validateRankingTiers(
    ranking.titleTiers,
    `${path}.titleTiers`,
    ranking.unknownTitleTierId,
  );
  if (!Array.isArray(ranking.unitOverrides) || ranking.unitOverrides.length > 2000) {
    fail(`${path}.unitOverrides`, "必须是最多包含 2000 项的数组");
  }
  const overrideIds = new Set();
  const overrideUnits = new Set();
  ranking.unitOverrides.forEach((rule, index) => {
    const rulePath = `${path}.unitOverrides[${index}]`;
    assertPlainObject(rule, rulePath);
    assertExactKeys(
      rule,
      ["id", "unit", "tierId", "withinTierOrder", "enabled", "notes"],
      rulePath,
    );
    assertIdentifier(rule.id, `${rulePath}.id`);
    if (overrideIds.has(rule.id)) fail(`${rulePath}.id`, "覆盖规则 ID 必须唯一");
    overrideIds.add(rule.id);
    assertString(rule.unit, `${rulePath}.unit`, 1, 160);
    const unitKey = rule.unit.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
    if (overrideUnits.has(unitKey)) fail(`${rulePath}.unit`, "同一单位只能配置一条覆盖规则");
    overrideUnits.add(unitKey);
    if (!unitTierIds.has(rule.tierId)) fail(`${rulePath}.tierId`, "引用的单位层级不存在");
    assertInteger(rule.withinTierOrder, `${rulePath}.withinTierOrder`, 0, 100000);
    assertBoolean(rule.enabled, `${rulePath}.enabled`);
    assertString(rule.notes, `${rulePath}.notes`, 0, 300);
  });
  assertEnum(
    ranking.unitTieBreak,
    `${path}.unitTieBreak`,
    new Set(["manual-then-pinyin", "pinyin", "source"]),
  );
  assertEnum(
    ranking.personTieBreak,
    `${path}.personTieBreak`,
    new Set(["manual-then-source", "source", "name"]),
  );
  const ai = ranking.ai;
  assertPlainObject(ai, `${path}.ai`);
  assertExactKeys(
    ai,
    [
      "enabled",
      "webSearch",
      "rankingApply",
      "titleFillApply",
      "minimumConfidence",
      "preferredDomains",
      "maxSearchQueriesPerRun",
    ],
    `${path}.ai`,
  );
  assertBoolean(ai.enabled, `${path}.ai.enabled`);
  assertEnum(ai.webSearch, `${path}.ai.webSearch`, new Set(["off", "on-demand"]));
  assertEnum(ai.rankingApply, `${path}.ai.rankingApply`, new Set(["review"]));
  assertEnum(
    ai.titleFillApply,
    `${path}.ai.titleFillApply`,
    new Set(["review", "verified-auto"]),
  );
  if (
    typeof ai.minimumConfidence !== "number" ||
    !Number.isFinite(ai.minimumConfidence) ||
    ai.minimumConfidence < 0 ||
    ai.minimumConfidence > 1
  ) {
    fail(`${path}.ai.minimumConfidence`, "必须是 0 到 1 之间的数字");
  }
  if (!Array.isArray(ai.preferredDomains) || ai.preferredDomains.length > 50) {
    fail(`${path}.ai.preferredDomains`, "必须是最多包含 50 项的数组");
  }
  ai.preferredDomains.forEach((domain, index) => {
    const domainPath = `${path}.ai.preferredDomains[${index}]`;
    assertString(domain, domainPath, 1, 253);
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(domain)) {
      fail(domainPath, "必须是域名，不能包含协议、端口或路径");
    }
  });
  assertInteger(ai.maxSearchQueriesPerRun, `${path}.ai.maxSearchQueriesPerRun`, 1, 200);
}

export function validateAdminConfig(config) {
  assertPlainObject(config, "config");
  assertNoSecretKeys(config);
  assertExactKeys(
    config,
    [
      "schemaVersion",
      "organization",
      "meetingRules",
      "checklistTemplates",
      "rosterRules",
    ],
    "config",
    ["meetingRooms", "meetingRoomPresetVersion"],
  );
  if (config.meetingRoomPresetVersion !== undefined) assertInteger(config.meetingRoomPresetVersion, "config.meetingRoomPresetVersion", 1, 10000);

  if (![1, ADMIN_CONFIG_SCHEMA_VERSION].includes(config.schemaVersion)) {
    fail("config.schemaVersion", "当前仅支持版本 1 或 2");
  }

  const organization = config.organization;
  assertPlainObject(organization, "config.organization");
  assertExactKeys(
    organization,
    [
      "name",
      "defaultOwner",
      "defaultStartTime",
      "defaultAttendeeEstimate",
      "defaultRoomSize",
      "defaultPresentationRequired",
    ],
    "config.organization",
    ["defaultMeetingRoomId"],
  );
  assertString(organization.name, "config.organization.name", 1, 80);
  assertString(
    organization.defaultOwner,
    "config.organization.defaultOwner",
    0,
    80,
  );
  assertString(
    organization.defaultStartTime,
    "config.organization.defaultStartTime",
    5,
    5,
  );
  if (!TIME_PATTERN.test(organization.defaultStartTime)) {
    fail("config.organization.defaultStartTime", "必须使用 HH:mm 格式");
  }
  assertInteger(
    organization.defaultAttendeeEstimate,
    "config.organization.defaultAttendeeEstimate",
    0,
    5000,
  );
  assertEnum(
    organization.defaultRoomSize,
    "config.organization.defaultRoomSize",
    new Set(["small", "large"]),
  );
  assertBoolean(
    organization.defaultPresentationRequired,
    "config.organization.defaultPresentationRequired",
  );

  if (organization.defaultMeetingRoomId !== undefined) {
    assertString(
      organization.defaultMeetingRoomId,
      "config.organization.defaultMeetingRoomId",
      0,
      64,
    );
    if (organization.defaultMeetingRoomId) {
      assertIdentifier(
        organization.defaultMeetingRoomId,
        "config.organization.defaultMeetingRoomId",
      );
    }
  }

  const meetingRooms = config.meetingRooms ?? [];
  if (!Array.isArray(meetingRooms) || meetingRooms.length > 500) {
    fail("config.meetingRooms", "必须是最多包含 500 项的数组");
  }
  const meetingRoomIds = new Set();
  const meetingRoomNames = new Set();
  meetingRooms.forEach((room, index) => {
    const roomPath = `config.meetingRooms[${index}]`;
    assertPlainObject(room, roomPath);
    assertExactKeys(
      room,
      [
        "id",
        "name",
        "location",
        "capacity",
        "roomSize",
        "equipment",
        "requirements",
        "enabled",
      ],
      roomPath,
      ["areaSqm", "tableDimensions"],
    );
    assertIdentifier(room.id, `${roomPath}.id`);
    if (meetingRoomIds.has(room.id)) fail(`${roomPath}.id`, "会议室 ID 必须唯一");
    meetingRoomIds.add(room.id);
    assertString(room.name, `${roomPath}.name`, 1, 100);
    const normalizedName = room.name.normalize("NFKC").trim().toLowerCase();
    if (meetingRoomNames.has(normalizedName)) {
      fail(`${roomPath}.name`, "会议室名称不能重复");
    }
    meetingRoomNames.add(normalizedName);
    assertString(room.location, `${roomPath}.location`, 0, 160);
    if (room.areaSqm !== undefined && (typeof room.areaSqm !== "number" || !Number.isFinite(room.areaSqm) || room.areaSqm <= 0 || room.areaSqm > 100000)) fail(`${roomPath}.areaSqm`, "面积必须大于 0 且不超过 100000 平方米");
    if (room.tableDimensions !== undefined) assertString(room.tableDimensions, `${roomPath}.tableDimensions`, 0, 120);
    assertInteger(room.capacity, `${roomPath}.capacity`, 0, 5000);
    assertEnum(room.roomSize, `${roomPath}.roomSize`, new Set(["small", "large"]));
    if (!Array.isArray(room.equipment) || room.equipment.length > 100) {
      fail(`${roomPath}.equipment`, "必须是最多包含 100 项的数组");
    }
    const equipmentNames = new Set();
    room.equipment.forEach((equipment, equipmentIndex) => {
      const equipmentPath = `${roomPath}.equipment[${equipmentIndex}]`;
      assertString(equipment, equipmentPath, 1, 80);
      const normalized = equipment.normalize("NFKC").trim().toLowerCase();
      if (equipmentNames.has(normalized)) fail(equipmentPath, "设备名称不能重复");
      equipmentNames.add(normalized);
    });
    assertString(room.requirements, `${roomPath}.requirements`, 0, 2000);
    assertBoolean(room.enabled, `${roomPath}.enabled`);
  });
  if (organization.defaultMeetingRoomId) {
    const defaultRoom = meetingRooms.find(
      (room) => room.id === organization.defaultMeetingRoomId,
    );
    if (!defaultRoom) {
      fail(
        "config.organization.defaultMeetingRoomId",
        "引用的默认会议室不存在",
      );
    }
    if (!defaultRoom.enabled) {
      fail(
        "config.organization.defaultMeetingRoomId",
        "默认会议室必须处于启用状态",
      );
    }
  }

  const meetingRules = config.meetingRules;
  assertPlainObject(meetingRules, "config.meetingRules");
  assertExactKeys(
    meetingRules,
    [
      "parkingVehicleLimit",
      "businessMealMin",
      "businessMealMax",
      "waterServiceIntervalMinutes",
      "reminders",
    ],
    "config.meetingRules",
  );
  assertInteger(
    meetingRules.parkingVehicleLimit,
    "config.meetingRules.parkingVehicleLimit",
    1,
    100,
  );
  assertInteger(
    meetingRules.businessMealMin,
    "config.meetingRules.businessMealMin",
    0,
    100000,
  );
  assertInteger(
    meetingRules.businessMealMax,
    "config.meetingRules.businessMealMax",
    0,
    100000,
  );
  if (meetingRules.businessMealMax < meetingRules.businessMealMin) {
    fail(
      "config.meetingRules.businessMealMax",
      "不能小于 businessMealMin",
    );
  }
  assertInteger(
    meetingRules.waterServiceIntervalMinutes,
    "config.meetingRules.waterServiceIntervalMinutes",
    5,
    240,
  );
  const reminders = meetingRules.reminders;
  assertPlainObject(reminders, "config.meetingRules.reminders");
  assertExactKeys(
    reminders,
    [
      "missingLocation",
      "missingOwner",
      "missingRoster",
      "overdueTasks",
      "blockedTasks",
    ],
    "config.meetingRules.reminders",
  );
  for (const key of Object.keys(reminders)) {
    assertBoolean(reminders[key], `config.meetingRules.reminders.${key}`);
  }

  const templates = config.checklistTemplates;
  if (!Array.isArray(templates) || templates.length < 1 || templates.length > 300) {
    fail("config.checklistTemplates", "必须包含 1 到 300 个清单模板");
  }
  const templateIds = new Set();
  templates.forEach((template, index) => {
    const path = `config.checklistTemplates[${index}]`;
    assertPlainObject(template, path);
    assertExactKeys(
      template,
      [
        "id",
        "title",
        "description",
        "phase",
        "group",
        "condition",
        "dueOffsetDays",
        "enabled",
      ],
      path,
      ["sopImages"],
    );
    assertIdentifier(template.id, `${path}.id`);
    if (templateIds.has(template.id)) fail(`${path}.id`, "ID 必须唯一");
    templateIds.add(template.id);
    assertString(template.title, `${path}.title`, 1, 120);
    assertString(template.description, `${path}.description`, 0, 1000);
    assertEnum(template.phase, `${path}.phase`, PHASES);
    assertString(template.group, `${path}.group`, 1, 80);
    assertEnum(template.condition, `${path}.condition`, CONDITIONS);
    assertInteger(template.dueOffsetDays, `${path}.dueOffsetDays`, -60, 365);
    assertBoolean(template.enabled, `${path}.enabled`);
    if (template.sopImages !== undefined) {
      if (!Array.isArray(template.sopImages) || template.sopImages.length > 10) {
        fail(`${path}.sopImages`, "必须是最多包含 10 项的数组");
      }
      template.sopImages.forEach((image, imageIndex) => {
        const imagePath = `${path}.sopImages[${imageIndex}]`;
        assertString(image, imagePath, 6, 300);
        if (!image.startsWith("/sop/")) {
          fail(imagePath, "只能引用 /sop/ 目录中的图片");
        }
      });
    }
  });

  const rosterRules = config.rosterRules;
  assertPlainObject(rosterRules, "config.rosterRules");
  assertExactKeys(
    rosterRules,
    [
      "sortDirection",
      "withinUnitOrder",
      "outputFields",
      "exportFileNameTemplate",
      "worksheetName",
      "autoFilter",
      "freezeHeader",
      "aliases",
      "extractionPromptSuffix",
    ],
    "config.rosterRules",
    config.schemaVersion === ADMIN_CONFIG_SCHEMA_VERSION ? ["ranking"] : [],
  );
  if (
    config.schemaVersion === ADMIN_CONFIG_SCHEMA_VERSION &&
    !Object.hasOwn(rosterRules, "ranking")
  ) {
    fail("config.rosterRules.ranking", "缺少必填字段");
  }
  assertEnum(
    rosterRules.sortDirection,
    "config.rosterRules.sortDirection",
    new Set(["asc", "desc"]),
  );
  assertEnum(
    rosterRules.withinUnitOrder,
    "config.rosterRules.withinUnitOrder",
    new Set(["title", "source", "name"]),
  );
  if (!Array.isArray(rosterRules.outputFields) || ![6, 7].includes(rosterRules.outputFields.length)) {
    fail("config.rosterRules.outputFields", "必须包含 7 个输出字段（兼容旧版 6 个字段）");
  }
  const outputKeys = new Set();
  rosterRules.outputFields.forEach((field, index) => {
    const path = `config.rosterRules.outputFields[${index}]`;
    assertPlainObject(field, path);
    assertExactKeys(field, ["key", "label", "width", "enabled"], path);
    assertEnum(field.key, `${path}.key`, OUTPUT_FIELD_KEYS);
    if (outputKeys.has(field.key)) fail(`${path}.key`, "字段 key 必须唯一");
    outputKeys.add(field.key);
    assertString(field.label, `${path}.label`, 1, 30);
    assertInteger(field.width, `${path}.width`, 6, 80);
    assertBoolean(field.enabled, `${path}.enabled`);
  });
  if (
    [...OUTPUT_FIELD_KEYS].some((key) => key !== "licensePlate" && !outputKeys.has(key)) ||
    (rosterRules.outputFields.length === 7 && !outputKeys.has("licensePlate"))
  ) {
    fail("config.rosterRules.outputFields", "必须完整包含标准输出字段");
  }
  for (const requiredKey of ["name", "unit"]) {
    const field = rosterRules.outputFields.find((item) => item.key === requiredKey);
    if (!field.enabled) {
      fail(
        `config.rosterRules.outputFields.${requiredKey}`,
        `${requiredKey} 字段必须启用`,
      );
    }
  }
  assertString(
    rosterRules.exportFileNameTemplate,
    "config.rosterRules.exportFileNameTemplate",
    1,
    120,
  );
  assertString(rosterRules.worksheetName, "config.rosterRules.worksheetName", 1, 31);
  if (/[:\\/?*\[\]]/.test(rosterRules.worksheetName)) {
    fail("config.rosterRules.worksheetName", "包含 Excel 不允许的工作表名称字符");
  }
  assertBoolean(rosterRules.autoFilter, "config.rosterRules.autoFilter");
  assertBoolean(rosterRules.freezeHeader, "config.rosterRules.freezeHeader");

  if (!Array.isArray(rosterRules.aliases) || rosterRules.aliases.length > 1000) {
    fail("config.rosterRules.aliases", "必须是最多包含 1000 项的数组");
  }
  const aliasIds = new Set();
  const canonicalNames = new Map();
  const aliasOwners = new Map();
  rosterRules.aliases.forEach((rule, index) => {
    const path = `config.rosterRules.aliases[${index}]`;
    assertPlainObject(rule, path);
    assertExactKeys(
      rule,
      ["id", "canonical", "aliases", "mode", "enabled", "notes"],
      path,
    );
    assertIdentifier(rule.id, `${path}.id`);
    if (aliasIds.has(rule.id)) fail(`${path}.id`, "ID 必须唯一");
    aliasIds.add(rule.id);
    assertString(rule.canonical, `${path}.canonical`, 1, 160);
    const canonicalKey = rule.canonical.trim().toLocaleLowerCase("zh-CN");
    if (canonicalNames.has(canonicalKey)) {
      fail(`${path}.canonical`, "标准单位名称必须唯一");
    }
    canonicalNames.set(canonicalKey, rule.id);
    if (!Array.isArray(rule.aliases) || rule.aliases.length < 1 || rule.aliases.length > 50) {
      fail(`${path}.aliases`, "必须包含 1 到 50 个别名");
    }
    const localAliases = new Set();
    rule.aliases.forEach((alias, aliasIndex) => {
      const aliasPath = `${path}.aliases[${aliasIndex}]`;
      assertString(alias, aliasPath, 1, 160);
      const normalized = alias.trim().toLocaleLowerCase("zh-CN");
      if (localAliases.has(normalized)) fail(aliasPath, "同一规则中的别名不能重复");
      localAliases.add(normalized);
      const existingOwner = aliasOwners.get(normalized);
      if (existingOwner && existingOwner !== canonicalKey) {
        fail(aliasPath, "同一别名不能指向多个标准单位名称");
      }
      aliasOwners.set(normalized, canonicalKey);
    });
    assertEnum(rule.mode, `${path}.mode`, new Set(["auto", "confirm"]));
    assertBoolean(rule.enabled, `${path}.enabled`);
    assertString(rule.notes, `${path}.notes`, 0, 300);
  });
  for (const [canonical, ownerId] of canonicalNames) {
    const aliasOwner = aliasOwners.get(canonical);
    if (aliasOwner && aliasOwner !== canonical) {
      fail(
        `config.rosterRules.aliases.${ownerId}.canonical`,
        "标准单位名称不能同时作为其他单位的别名",
      );
    }
  }

  assertString(
    rosterRules.extractionPromptSuffix,
    "config.rosterRules.extractionPromptSuffix",
    0,
    5000,
  );

  if (config.schemaVersion === ADMIN_CONFIG_SCHEMA_VERSION) {
    validateRosterRanking(rosterRules.ranking, "config.rosterRules.ranking");
  }

  return config;
}

function clone(value) {
  return structuredClone(value);
}

function freshState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    updatedAt: null,
    summary: "",
    config: null,
    history: [],
  };
}

function serializedState(state) {
  return `${JSON.stringify(state)}\n`;
}

function fitHistoryWithinStorageLimit(state) {
  const fitted = {
    ...state,
    history: [...state.history],
  };
  while (
    fitted.history.length > 0 &&
    Buffer.byteLength(serializedState(fitted), "utf8") > MAX_STORED_BYTES
  ) {
    fitted.history.pop();
  }
  if (Buffer.byteLength(serializedState(fitted), "utf8") > MAX_STORED_BYTES) {
    throw new LocalConfigError("当前配置本身超过 2MB 持久化限制", {
      code: "CONFIG_TOO_LARGE",
      status: 413,
    });
  }
  return fitted;
}

function validateStoredState(state) {
  assertPlainObject(state, "store");
  assertExactKeys(
    state,
    [
      "schemaVersion",
      "revision",
      "updatedAt",
      "summary",
      "config",
      "history",
    ],
    "store",
  );
  if (state.schemaVersion !== SCHEMA_VERSION) fail("store.schemaVersion", "版本不受支持");
  assertInteger(state.revision, "store.revision", 0, Number.MAX_SAFE_INTEGER);
  if (state.updatedAt !== null) assertString(state.updatedAt, "store.updatedAt", 1, 64);
  assertString(state.summary, "store.summary", 0, 200);
  if (state.revision === 0) {
    if (state.config !== null) fail("store.config", "revision 0 的配置必须为空");
  } else {
    validateAdminConfig(state.config);
  }
  if (!Array.isArray(state.history) || state.history.length > MAX_HISTORY_ITEMS) {
    fail("store.history", `最多保留 ${MAX_HISTORY_ITEMS} 条历史`);
  }
  const revisions = new Set();
  state.history.forEach((item, index) => {
    const path = `store.history[${index}]`;
    assertPlainObject(item, path);
    assertExactKeys(
      item,
      ["revision", "updatedAt", "summary", "config"],
      path,
    );
    assertInteger(item.revision, `${path}.revision`, 1, Number.MAX_SAFE_INTEGER);
    if (item.revision >= state.revision || revisions.has(item.revision)) {
      fail(`${path}.revision`, "历史版本号必须唯一且小于当前版本");
    }
    revisions.add(item.revision);
    assertString(item.updatedAt, `${path}.updatedAt`, 1, 64);
    assertString(item.summary, `${path}.summary`, 0, 200);
    validateAdminConfig(item.config);
  });
  return state;
}

function publicSnapshot(state) {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: state.revision,
    updatedAt: state.updatedAt,
    summary: state.summary,
    config: state.config === null ? null : clone(state.config),
    history: state.history.map(({ revision, updatedAt, summary }) => ({
      revision,
      updatedAt,
      summary,
    })),
  };
}

export function resolveAdminDataDirectory({
  env = process.env,
  platform = process.platform,
  userHome = homedir(),
} = {}) {
  const configured = env.MEETING_ASSISTANT_DATA_DIR?.trim();
  if (configured) {
    return isAbsolute(configured) ? configured : resolve(configured);
  }
  if (platform === "win32" && env.LOCALAPPDATA?.trim()) {
    return join(env.LOCALAPPDATA, "MeetingAssistantAI");
  }
  return join(userHome, ".meeting-assistant-ai");
}

async function fileExists(path) {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function readStateFile(path) {
  const contents = await readFile(path, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_STORED_BYTES) {
    throw new LocalConfigError("配置文件超过 2MB 限制");
  }
  return validateStoredState(JSON.parse(contents));
}

export function createLocalConfigStore({
  dataDirectory = resolveAdminDataDirectory(),
  now = () => new Date(),
} = {}) {
  const mainPath = join(dataDirectory, CONFIG_FILE_NAME);
  const backupPath = join(dataDirectory, BACKUP_FILE_NAME);
  let writeQueue = Promise.resolve();

  async function loadUnsafe() {
    try {
      return { state: await readStateFile(mainPath), source: "main" };
    } catch (mainError) {
      if (mainError?.code === "ENOENT") {
        try {
          return { state: await readStateFile(backupPath), source: "backup" };
        } catch (backupError) {
          if (backupError?.code === "ENOENT") {
            return { state: freshState(), source: "empty" };
          }
          throw new LocalConfigError("备份配置文件损坏，无法恢复", {
            code: "CONFIG_CORRUPTED",
            status: 500,
            details: { cause: backupError.message },
          });
        }
      }
      try {
        return { state: await readStateFile(backupPath), source: "backup" };
      } catch (backupError) {
        throw new LocalConfigError("主配置和备份配置均已损坏", {
          code: "CONFIG_CORRUPTED",
          status: 500,
          details: {
            main: mainError.message,
            backup: backupError?.message,
          },
        });
      }
    }
  }

  async function writeAtomic(state, source) {
    await mkdir(dataDirectory, { recursive: true });
    const serialized = serializedState(state);
    if (Buffer.byteLength(serialized, "utf8") > MAX_STORED_BYTES) {
      throw new LocalConfigError("持久化配置超过 2MB 限制", {
        code: "CONFIG_TOO_LARGE",
        status: 413,
      });
    }
    const temporaryPath = join(
      dataDirectory,
      `.${CONFIG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    const handle = await open(temporaryPath, "wx");
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    try {
      if (source === "main" && (await fileExists(mainPath))) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
      } else if (source === "backup") {
        await rm(mainPath, { force: true });
      }
      await rename(temporaryPath, mainPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      if (!(await fileExists(mainPath)) && (await fileExists(backupPath))) {
        await rename(backupPath, mainPath).catch(() => {});
      }
      throw error;
    }
  }

  function enqueue(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  // Packaged defaults are public, code-owned data. Never import a user's local
  // database into the installer, and never reinsert rooms they later delete.
  async function initializeDefaults(defaultConfig) {
    validateAdminConfig(defaultConfig);
    assertInteger(defaultConfig.meetingRoomPresetVersion, "默认会议室版本", 1, 10000);
    return enqueue(async () => {
      const { state: current, source } = await loadUnsafe();
      if ((current.config?.meetingRoomPresetVersion ?? 0) >= defaultConfig.meetingRoomPresetVersion) return publicSnapshot(current);
      let config;
      if (current.config === null) config = clone(defaultConfig);
      else {
        config = clone(current.config);
        const rooms = config.meetingRooms ?? [];
        const normalizeName = (name) => name.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
        const ids = new Set(rooms.map((room) => room.id));
        const names = new Set(rooms.map((room) => normalizeName(room.name)));
        config.meetingRooms = [...rooms, ...defaultConfig.meetingRooms.filter((room) => !ids.has(room.id) && !names.has(normalizeName(room.name))).map(clone)];
        config.meetingRoomPresetVersion = defaultConfig.meetingRoomPresetVersion;
      }
      const timestamp = now().toISOString();
      const next = fitHistoryWithinStorageLimit({
        schemaVersion: SCHEMA_VERSION, revision: current.revision + 1,
        updatedAt: timestamp, summary: current.config ? "补充安装内置会议室（保留已有配置）" : "初始化安装内置配置与会议室",
        config,
        history: current.revision > 0 ? [{ revision: current.revision, updatedAt: current.updatedAt, summary: current.summary, config: clone(current.config) }, ...current.history].slice(0, MAX_HISTORY_ITEMS) : [],
      });
      validateStoredState(next);
      await writeAtomic(next, source);
      return publicSnapshot(next);
    });
  }

  async function getSnapshot() {
    await writeQueue;
    const { state } = await loadUnsafe();
    return publicSnapshot(state);
  }

  async function save({ expectedRevision, summary, config }) {
    return enqueue(async () => {
      assertInteger(
        expectedRevision,
        "expectedRevision",
        0,
        Number.MAX_SAFE_INTEGER,
      );
      assertString(summary, "summary", 0, 200);
      validateAdminConfig(config);
      const { state: current, source } = await loadUnsafe();
      if (current.revision !== expectedRevision) {
        throw new LocalConfigError("配置已被其他修改覆盖，请刷新后重试", {
          code: "REVISION_CONFLICT",
          status: 409,
          details: {
            expectedRevision,
            currentRevision: current.revision,
          },
        });
      }
      const timestamp = now().toISOString();
      const history =
        current.revision > 0
          ? [
              {
                revision: current.revision,
                updatedAt: current.updatedAt,
                summary: current.summary,
                config: clone(current.config),
              },
              ...current.history,
            ].slice(0, MAX_HISTORY_ITEMS)
          : [];
      const next = fitHistoryWithinStorageLimit({
        schemaVersion: SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: timestamp,
        summary,
        config: { ...clone(config), ...(current.config?.meetingRoomPresetVersion ? { meetingRoomPresetVersion: Math.max(current.config.meetingRoomPresetVersion, config.meetingRoomPresetVersion ?? 0) } : {}) },
        history,
      });
      validateStoredState(next);
      await writeAtomic(next, source);
      return publicSnapshot(next);
    });
  }

  async function rollback({ expectedRevision, targetRevision }) {
    return enqueue(async () => {
      assertInteger(
        expectedRevision,
        "expectedRevision",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      assertInteger(
        targetRevision,
        "targetRevision",
        1,
        Number.MAX_SAFE_INTEGER,
      );
      const { state: current, source } = await loadUnsafe();
      if (current.revision !== expectedRevision) {
        throw new LocalConfigError("配置已被其他修改覆盖，请刷新后重试", {
          code: "REVISION_CONFLICT",
          status: 409,
          details: {
            expectedRevision,
            currentRevision: current.revision,
          },
        });
      }
      const target = current.history.find(
        (item) => item.revision === targetRevision,
      );
      if (!target) {
        throw new LocalConfigError("指定的历史版本不存在或已超出保留范围", {
          code: "HISTORY_NOT_FOUND",
          status: 404,
          details: { targetRevision },
        });
      }
      const timestamp = now().toISOString();
      const next = fitHistoryWithinStorageLimit({
        schemaVersion: SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: timestamp,
        summary: `回滚至版本 ${targetRevision}`,
        config: { ...clone(target.config), ...(current.config?.meetingRoomPresetVersion ? { meetingRoomPresetVersion: Math.max(current.config.meetingRoomPresetVersion, target.config.meetingRoomPresetVersion ?? 0) } : {}) },
        history: [
          {
            revision: current.revision,
            updatedAt: current.updatedAt,
            summary: current.summary,
            config: clone(current.config),
          },
          ...current.history,
        ].slice(0, MAX_HISTORY_ITEMS),
      });
      validateStoredState(next);
      await writeAtomic(next, source);
      return publicSnapshot(next);
    });
  }

  async function getExport() {
    await writeQueue;
    const { state } = await loadUnsafe();
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now().toISOString(),
      revision: state.revision,
      updatedAt: state.updatedAt,
      summary: state.summary,
      config: state.config === null ? null : clone(state.config),
    };
  }

  return {
    dataDirectory,
    mainPath,
    backupPath,
    getSnapshot,
    initializeDefaults,
    save,
    rollback,
    getExport,
  };
}

function normalizeContactText(
  value,
  path,
  { required = false, maximum = 200 } = {},
) {
  if (typeof value !== "string") {
    throw new LocalConfigError(`${path}: 必须是字符串`, {
      code: "INVALID_CONTACT",
      details: { path },
    });
  }
  const normalized = value
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const length = [...normalized].length;
  if ((required && !length) || length > maximum) {
    throw new LocalConfigError(
      `${path}: ${required ? "不能为空，且" : ""}长度不能超过 ${maximum} 个字符`,
      {
        code: "INVALID_CONTACT",
        details: { path },
      },
    );
  }
  return normalized;
}

function normalizeContactInput(value, path = "contact") {
  assertPlainObject(value, path);
  assertExactKeys(
    value,
    ["name", "unit", "department", "title"],
    path,
    ["source", "licensePlate"],
  );
  return {
    name: normalizeContactText(value.name, `${path}.name`, {
      required: true,
      maximum: 80,
    }).replace(/\s+/g, ""),
    unit: normalizeContactText(value.unit, `${path}.unit`, {
      required: true,
      maximum: 200,
    }),
    department: normalizeContactText(value.department, `${path}.department`, {
      maximum: 120,
    }),
    title: normalizeContactText(value.title, `${path}.title`, {
      maximum: 120,
    }),
    licensePlate: normalizeContactText(value.licensePlate ?? "", `${path}.licensePlate`, { maximum: 40 }).toUpperCase(),
  };
}

function normalizeContactIdentityPart(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function contactIdentity(contact) {
  return `${normalizeContactIdentityPart(contact.name)}\u0000${normalizeContactIdentityPart(contact.unit)}`;
}

function contactIdentityAliases(contact) {
  return Array.isArray(contact.identityAliases) ? contact.identityAliases : [];
}

function contactClaimedIdentities(contact) {
  return [contactIdentity(contact), ...contactIdentityAliases(contact)];
}

function canonicalContactUnit(unit, rules) {
  const key = normalizeContactIdentityPart(unit);
  const rule = rules.find((item) => item.enabled &&
    [item.canonical, ...item.aliases].some((text) => normalizeContactIdentityPart(text) === key));
  return rule?.canonical.trim() ?? unit;
}

function canonicalContactIdentity(identity, rules) {
  const separator = identity.indexOf("\u0000");
  if (separator < 0) return identity;
  return `${identity.slice(0, separator)}\u0000${normalizeContactIdentityPart(canonicalContactUnit(identity.slice(separator + 1), rules))}`;
}

// Only exact, configured unit aliases are equivalent. Never merge by name alone.
export function reconcileContactUnits(contacts, rules) {
  const groups = new Map();
  for (const contact of contacts) {
    const identity = canonicalContactIdentity(contactIdentity(contact), rules);
    const group = groups.get(identity) ?? [];
    group.push(contact);
    groups.set(identity, group);
  }
  return Array.from(groups.values(), (group) => {
    const preferred = [...group].sort((a, b) =>
      Number(Boolean(b.manualOverride)) - Number(Boolean(a.manualOverride)) ||
      b.updatedAt.localeCompare(a.updatedAt) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const winner = preferred[0];
    const unit = canonicalContactUnit(winner.unit, rules);
    if (group.length === 1 && winner.unit === unit) return winner;
    const identity = contactIdentity({ ...winner, unit });
    const identityAliases = [...new Set(group.flatMap((item) => contactClaimedIdentities(item)))].filter((alias) => alias !== identity);
    const meetingIds = [...new Set(group.flatMap((item) => item.meetingIds))].slice(-MAX_CONTACT_MEETING_IDS);
    const latestMeeting = [...group].filter((item) => item.lastMeetingId).sort((a, b) =>
      b.lastMeetingDate.localeCompare(a.lastMeetingDate) || b.updatedAt.localeCompare(a.updatedAt))[0];
    return {
      ...winner,
      unit,
      identityAliases,
      department: winner.manualOverride ? winner.department : preferred.find((item) => item.department)?.department ?? "",
      title: winner.manualOverride ? winner.title : preferred.find((item) => item.title)?.title ?? "",
      ...(group.some((item) => Object.hasOwn(item, "licensePlate"))
        ? { licensePlate: preferred.find((item) => item.licensePlate)?.licensePlate ?? "" } : {}),
      createdAt: [...group].map((item) => item.createdAt).sort()[0],
      updatedAt: [...group].map((item) => item.updatedAt).sort().at(-1),
      meetingIds,
      meetingCount: meetingIds.length,
      lastMeetingId: latestMeeting?.lastMeetingId ?? "",
      lastMeetingTitle: latestMeeting?.lastMeetingTitle ?? "",
      lastMeetingDate: latestMeeting?.lastMeetingDate ?? "",
    };
  });
}

function validateIsoDateTime(value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (
    typeof value !== "string" ||
    !value ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new LocalConfigError(`${path}: 必须是有效的日期时间`, {
      code: "CONTACTS_CORRUPTED",
      status: 500,
      details: { path },
    });
  }
}

function validateStoredContact(contact, index) {
  const path = `contacts[${index}]`;
  assertPlainObject(contact, path);
  assertExactKeys(
    contact,
    [
      "id",
      "name",
      "unit",
      "department",
      "title",
      "createdAt",
      "updatedAt",
      "meetingCount",
      "meetingIds",
      "lastMeetingId",
      "lastMeetingTitle",
      "lastMeetingDate",
    ],
    path,
    ["identityAliases", "manualOverride", "licensePlate"],
  );
  assertIdentifier(contact.id, `${path}.id`);
  normalizeContactInput(
    {
      name: contact.name,
      unit: contact.unit,
      department: contact.department,
      title: contact.title,
      licensePlate: contact.licensePlate ?? "",
    },
    path,
  );
  validateIsoDateTime(contact.createdAt, `${path}.createdAt`);
  validateIsoDateTime(contact.updatedAt, `${path}.updatedAt`);
  assertInteger(contact.meetingCount, `${path}.meetingCount`, 0, MAX_CONTACTS);
  if (!Array.isArray(contact.meetingIds)) {
    fail(`${path}.meetingIds`, "必须是数组");
  }
  if (contact.meetingIds.length > MAX_CONTACT_MEETING_IDS) {
    fail(
      `${path}.meetingIds`,
      `最多保留 ${MAX_CONTACT_MEETING_IDS} 个会议记录`,
    );
  }
  const uniqueMeetingIds = new Set();
  contact.meetingIds.forEach((meetingId, meetingIndex) => {
    assertString(
      meetingId,
      `${path}.meetingIds[${meetingIndex}]`,
      1,
      200,
    );
    uniqueMeetingIds.add(meetingId);
  });
  if (
    uniqueMeetingIds.size !== contact.meetingIds.length ||
    contact.meetingCount !== contact.meetingIds.length
  ) {
    fail(`${path}.meetingIds`, "会议记录必须去重并与参会次数一致");
  }
  assertString(contact.lastMeetingId, `${path}.lastMeetingId`, 0, 200);
  assertString(contact.lastMeetingTitle, `${path}.lastMeetingTitle`, 0, 200);
  assertString(contact.lastMeetingDate, `${path}.lastMeetingDate`, 0, 40);
  if (
    Object.hasOwn(contact, "identityAliases") &&
    !Array.isArray(contact.identityAliases)
  ) {
    fail(`${path}.identityAliases`, "必须是数组");
  }
  if (Object.hasOwn(contact, "manualOverride")) {
    assertBoolean(contact.manualOverride, `${path}.manualOverride`);
  }
  const aliases = contactIdentityAliases(contact);
  if (aliases.length > MAX_CONTACT_IDENTITY_ALIASES) {
    fail(
      `${path}.identityAliases`,
      `历史姓名与单位标识最多保留 ${MAX_CONTACT_IDENTITY_ALIASES} 项`,
    );
  }
  const canonicalIdentity = contactIdentity(contact);
  const uniqueAliases = new Set();
  aliases.forEach((alias, aliasIndex) => {
    const aliasPath = `${path}.identityAliases[${aliasIndex}]`;
    assertString(alias, aliasPath, 1, 400);
    if (alias === canonicalIdentity) fail(aliasPath, "不能与当前姓名和单位重复");
    if (uniqueAliases.has(alias)) fail(aliasPath, "历史姓名与单位标识重复");
    uniqueAliases.add(alias);
  });
}

function validateContactsState(state) {
  assertPlainObject(state, "contactsState");
  assertExactKeys(
    state,
    ["schemaVersion", "updatedAt", "contacts"],
    "contactsState",
  );
  if (state.schemaVersion !== CONTACT_SCHEMA_VERSION) {
    throw new LocalConfigError("通讯录文件版本不受支持", {
      code: "CONTACTS_CORRUPTED",
      status: 500,
    });
  }
  validateIsoDateTime(state.updatedAt, "contactsState.updatedAt", {
    nullable: true,
  });
  if (!Array.isArray(state.contacts) || state.contacts.length > MAX_CONTACTS) {
    throw new LocalConfigError(
      `通讯录最多保存 ${MAX_CONTACTS.toLocaleString()} 人`,
      {
        code: "CONTACTS_TOO_LARGE",
        status: 413,
      },
    );
  }
  const identities = new Set();
  const ids = new Set();
  state.contacts.forEach((contact, index) => {
    validateStoredContact(contact, index);
    if (ids.has(contact.id)) fail(`contacts[${index}].id`, "联系人 ID 重复");
    for (const identity of contactClaimedIdentities(contact)) {
      if (identities.has(identity)) {
        fail(`contacts[${index}]`, "联系人当前或历史姓名、单位标识重复");
      }
      identities.add(identity);
    }
    ids.add(contact.id);
  });
  return state;
}

function freshContactsState() {
  return {
    schemaVersion: CONTACT_SCHEMA_VERSION,
    updatedAt: null,
    contacts: [],
  };
}

function serializedContactsState(state) {
  return `${JSON.stringify(state)}\n`;
}

async function readContactsStateFile(path) {
  const contents = await readFile(path, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_CONTACTS_BYTES) {
    throw new LocalConfigError("通讯录文件超过 8MB 限制", {
      code: "CONTACTS_TOO_LARGE",
      status: 413,
    });
  }
  return validateContactsState(JSON.parse(contents));
}

function isSubsequence(query, candidate) {
  let queryIndex = 0;
  for (const character of candidate) {
    if (character === query[queryIndex]) queryIndex += 1;
    if (queryIndex === query.length) return true;
  }
  return false;
}

function contactSearchScore(contact, rawQuery, rules = []) {
  const query = normalizeContactIdentityPart(rawQuery);
  if (!query) return 100;
  const name = normalizeContactIdentityPart(contact.name);
  const unit = normalizeContactIdentityPart(contact.unit);
  const department = normalizeContactIdentityPart(contact.department);
  const title = normalizeContactIdentityPart(contact.title);
  const licensePlate = normalizeContactIdentityPart(contact.licensePlate ?? "");
  if (name === query) return 0;
  if (name.startsWith(query)) return 10;
  if (name.includes(query)) return 20;
  if (unit.startsWith(query)) return 30;
  if (unit.includes(query)) return 40;
  const unitAliases = rules.filter((rule) => rule.enabled && normalizeContactIdentityPart(rule.canonical) === unit)
    .flatMap((rule) => rule.aliases).map(normalizeContactIdentityPart);
  if (unitAliases.some((alias) => alias.includes(query))) return 40;
  if (department.includes(query) || title.includes(query) || licensePlate.includes(query)) return 50;
  const combined = `${name}${unit}${department}${title}${licensePlate}`;
  return isSubsequence(query, combined) ? 60 : null;
}

export function createLocalContactStore({
  dataDirectory = resolveAdminDataDirectory(),
  now = () => new Date(),
  getUnitAliases = async () => (await createLocalConfigStore({ dataDirectory }).getSnapshot()).config?.rosterRules.aliases ?? [],
} = {}) {
  const mainPath = join(dataDirectory, CONTACTS_FILE_NAME);
  const backupPath = join(dataDirectory, CONTACTS_BACKUP_FILE_NAME);
  let writeQueue = Promise.resolve();
  let activeUnitAliases = [];

  async function loadStoredUnsafe() {
    try {
      return { state: await readContactsStateFile(mainPath), source: "main" };
    } catch (mainError) {
      if (mainError?.code === "ENOENT") {
        try {
          return {
            state: await readContactsStateFile(backupPath),
            source: "backup",
          };
        } catch (backupError) {
          if (backupError?.code === "ENOENT") {
            return { state: freshContactsState(), source: "empty" };
          }
          throw new LocalConfigError("通讯录备份文件损坏，无法恢复", {
            code: "CONTACTS_CORRUPTED",
            status: 500,
            details: { cause: backupError.message },
          });
        }
      }
      try {
        return {
          state: await readContactsStateFile(backupPath),
          source: "backup",
        };
      } catch (backupError) {
        throw new LocalConfigError("通讯录主文件和备份均已损坏", {
          code: "CONTACTS_CORRUPTED",
          status: 500,
          details: {
            main: mainError.message,
            backup: backupError?.message,
          },
        });
      }
    }
  }

  async function loadUnsafe() {
    const loaded = await loadStoredUnsafe();
    activeUnitAliases = await getUnitAliases();
    const contacts = reconcileContactUnits(loaded.state.contacts, activeUnitAliases);
    if (JSON.stringify(contacts) === JSON.stringify(loaded.state.contacts)) return loaded;
    const state = { ...loaded.state, updatedAt: now().toISOString(), contacts };
    await writeAtomic(state, loaded.source);
    return { state, source: "main" };
  }

  function claimedIdentities(contact) {
    return [...new Set(contactClaimedIdentities(contact).map((identity) => canonicalContactIdentity(identity, activeUnitAliases)))];
  }

  function canonicalInput(contact) {
    return { ...contact, unit: canonicalContactUnit(contact.unit, activeUnitAliases) };
  }

  async function writeAtomic(state, source) {
    validateContactsState(state);
    const serialized = serializedContactsState(state);
    if (Buffer.byteLength(serialized, "utf8") > MAX_CONTACTS_BYTES) {
      throw new LocalConfigError("通讯录超过 8MB 持久化限制", {
        code: "CONTACTS_TOO_LARGE",
        status: 413,
      });
    }
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = join(
      dataDirectory,
      `.${CONTACTS_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }

    try {
      if (source === "main" && (await fileExists(mainPath))) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
      } else if (source === "backup") {
        await rm(mainPath, { force: true });
      }
      await rename(temporaryPath, mainPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      if (!(await fileExists(mainPath)) && (await fileExists(backupPath))) {
        await rename(backupPath, mainPath).catch(() => {});
      }
      throw error;
    }
  }

  function enqueue(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function list({ query = "", limit = 50, offset = 0 } = {}) {
    return enqueue(async () => {
      assertString(query, "query", 0, 100);
      assertInteger(limit, "limit", 1, 200);
      assertInteger(offset, "offset", 0, Number.MAX_SAFE_INTEGER);
      const { state } = await loadUnsafe();
      const matched = state.contacts
        .map((contact) => ({
          contact,
          score: contactSearchScore(contact, query, activeUnitAliases),
        }))
        .filter((item) => item.score !== null)
        .sort(
          (a, b) =>
            a.score - b.score ||
            b.contact.updatedAt.localeCompare(a.contact.updatedAt) ||
            a.contact.name.localeCompare(b.contact.name, "zh-CN"),
        );
      return {
        schemaVersion: CONTACT_SCHEMA_VERSION,
        updatedAt: state.updatedAt,
        total: matched.length,
        contacts: clone(
          matched.slice(offset, offset + limit).map((item) => item.contact),
        ),
      };
    });
  }

  async function replaceAll({ contacts }) {
    return enqueue(async () => {
      if (!Array.isArray(contacts)) {
        throw new LocalConfigError("contacts: 必须是数组", {
          code: "INVALID_CONTACT",
        });
      }
      const timestamp = now().toISOString();
      const { source } = await loadUnsafe();
      const restored = validateContactsState({
        schemaVersion: CONTACT_SCHEMA_VERSION,
        updatedAt: timestamp,
        contacts: clone(contacts),
      });
      const next = validateContactsState({
        schemaVersion: CONTACT_SCHEMA_VERSION,
        updatedAt: timestamp,
        contacts: reconcileContactUnits(restored.contacts, activeUnitAliases),
      });
      await writeAtomic(next, source);
      return { replaced: true, total: next.contacts.length };
    });
  }

  async function upsertMeeting({ meeting, contacts }) {
    return enqueue(async () => {
      assertPlainObject(meeting, "meeting");
      assertExactKeys(meeting, ["id", "title"], "meeting", ["date"]);
      const meetingId = normalizeContactText(meeting.id, "meeting.id", {
        required: true,
        maximum: 200,
      });
      const meetingTitle = normalizeContactText(
        meeting.title,
        "meeting.title",
        {
          required: true,
          maximum: 200,
        },
      );
      const meetingDate = normalizeContactText(
        meeting.date ?? "",
        "meeting.date",
        { maximum: 40 },
      );
      if (!Array.isArray(contacts) || contacts.length > 5_000) {
        throw new LocalConfigError("单次最多同步 5,000 名参会人", {
          code: "INVALID_CONTACT",
        });
      }
      const { state: current, source } = await loadUnsafe();
      const normalizedContacts = contacts.map((contact, index) =>
        canonicalInput(normalizeContactInput(contact, `contacts[${index}]`)),
      );
      if (!normalizedContacts.length) {
        return { upserted: 0, total: current.contacts.length };
      }
      const timestamp = now().toISOString();
      const nextContacts = current.contacts.map((contact) => clone(contact));
      const byIdentity = new Map();
      nextContacts.forEach((contact, index) => {
        claimedIdentities(contact).forEach((identity) => {
          byIdentity.set(identity, index);
        });
      });
      const touchedIdentities = new Set();

      for (const contact of normalizedContacts) {
        const identity = contactIdentity(contact);
        if (touchedIdentities.has(identity)) continue;
        touchedIdentities.add(identity);
        const existingIndex = byIdentity.get(identity);
        if (existingIndex === undefined) {
          if (nextContacts.length >= MAX_CONTACTS) {
            throw new LocalConfigError(
              `通讯录最多保存 ${MAX_CONTACTS.toLocaleString()} 人`,
              {
                code: "CONTACTS_TOO_LARGE",
                status: 413,
              },
            );
          }
          const created = {
            id: `contact-${randomUUID()}`,
            ...contact,
            identityAliases: [],
            manualOverride: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            meetingCount: 1,
            meetingIds: [meetingId],
            lastMeetingId: meetingId,
            lastMeetingTitle: meetingTitle,
            lastMeetingDate: meetingDate,
          };
          nextContacts.push(created);
          byIdentity.set(identity, nextContacts.length - 1);
          continue;
        }
        const existing = nextContacts[existingIndex];
        const meetingIds = existing.meetingIds.includes(meetingId)
          ? [...existing.meetingIds]
          : [...existing.meetingIds, meetingId].slice(-MAX_CONTACT_MEETING_IDS);
        const isLatestMeeting = !existing.lastMeetingId ||
          (meetingDate ? !existing.lastMeetingDate || meetingDate >= existing.lastMeetingDate : !existing.lastMeetingDate);
        nextContacts[existingIndex] = {
          ...existing,
          licensePlate: contact.licensePlate || existing.licensePlate || "",
          ...(existing.manualOverride
            ? {}
            : {
                department: contact.department || existing.department,
                title: contact.title || existing.title,
              }),
          updatedAt: timestamp,
          meetingCount: meetingIds.length,
          meetingIds,
          lastMeetingId: isLatestMeeting ? meetingId : existing.lastMeetingId,
          lastMeetingTitle: isLatestMeeting || meetingId === existing.lastMeetingId ? meetingTitle : existing.lastMeetingTitle,
          lastMeetingDate: isLatestMeeting ? meetingDate : existing.lastMeetingDate,
        };
      }

      const next = {
        schemaVersion: CONTACT_SCHEMA_VERSION,
        updatedAt: timestamp,
        contacts: nextContacts,
      };
      await writeAtomic(next, source);
      return {
        upserted: touchedIdentities.size,
        total: nextContacts.length,
      };
    });
  }

  async function create(contact) {
    return enqueue(async () => {
      const { state: current, source } = await loadUnsafe();
      const normalized = canonicalInput(normalizeContactInput(contact));
      if (
        current.contacts.some((item) =>
          claimedIdentities(item).includes(contactIdentity(normalized)),
        )
      ) {
        throw new LocalConfigError("同姓名、同单位的联系人已经存在", {
          code: "CONTACT_CONFLICT",
          status: 409,
        });
      }
      if (current.contacts.length >= MAX_CONTACTS) {
        throw new LocalConfigError(
          `通讯录最多保存 ${MAX_CONTACTS.toLocaleString()} 人`,
          {
            code: "CONTACTS_TOO_LARGE",
            status: 413,
          },
        );
      }
      const timestamp = now().toISOString();
      const created = {
        id: `contact-${randomUUID()}`,
        ...normalized,
        identityAliases: [],
        manualOverride: true,
        createdAt: timestamp,
        updatedAt: timestamp,
        meetingCount: 0,
        meetingIds: [],
        lastMeetingId: "",
        lastMeetingTitle: "",
        lastMeetingDate: "",
      };
      await writeAtomic(
        {
          schemaVersion: CONTACT_SCHEMA_VERSION,
          updatedAt: timestamp,
          contacts: [created, ...current.contacts],
        },
        source,
      );
      return clone(created);
    });
  }

  async function update(id, contact) {
    return enqueue(async () => {
      const normalizedId = normalizeContactText(id, "contactId", {
        required: true,
        maximum: 80,
      });
      const { state: current, source } = await loadUnsafe();
      const normalized = canonicalInput(normalizeContactInput(contact));
      const index = current.contacts.findIndex(
        (item) => item.id === normalizedId,
      );
      if (index < 0) {
        throw new LocalConfigError("联系人不存在或已被删除", {
          code: "CONTACT_NOT_FOUND",
          status: 404,
        });
      }
      const previous = current.contacts[index];
      const previousIdentity = contactIdentity(previous);
      const identity = contactIdentity(normalized);
      if (
        current.contacts.some(
          (item, itemIndex) =>
            itemIndex !== index &&
            claimedIdentities(item).includes(identity),
        )
      ) {
        throw new LocalConfigError("修改后会与现有联系人重复", {
          code: "CONTACT_CONFLICT",
          status: 409,
        });
      }
      const timestamp = now().toISOString();
      const identityAliases = [
        ...contactIdentityAliases(previous),
        ...(previousIdentity === identity ? [] : [previousIdentity]),
      ]
        .filter((alias) => alias !== identity)
        .filter((alias, aliasIndex, aliases) => aliases.indexOf(alias) === aliasIndex)
        .slice(-MAX_CONTACT_IDENTITY_ALIASES);
      const updated = {
        ...previous,
        ...normalized,
        licensePlate: Object.hasOwn(contact, "licensePlate") ? normalized.licensePlate : previous.licensePlate ?? "",
        identityAliases,
        manualOverride: true,
        updatedAt: timestamp,
      };
      const contacts = current.contacts.map((item, itemIndex) =>
        itemIndex === index ? updated : item,
      );
      await writeAtomic(
        {
          schemaVersion: CONTACT_SCHEMA_VERSION,
          updatedAt: timestamp,
          contacts,
        },
        source,
      );
      return clone(updated);
    });
  }

  async function remove(id) {
    return enqueue(async () => {
      const normalizedId = normalizeContactText(id, "contactId", {
        required: true,
        maximum: 80,
      });
      const { state: current, source } = await loadUnsafe();
      const contacts = current.contacts.filter(
        (contact) => contact.id !== normalizedId,
      );
      if (contacts.length === current.contacts.length) {
        throw new LocalConfigError("联系人不存在或已被删除", {
          code: "CONTACT_NOT_FOUND",
          status: 404,
        });
      }
      const timestamp = now().toISOString();
      await writeAtomic(
        {
          schemaVersion: CONTACT_SCHEMA_VERSION,
          updatedAt: timestamp,
          contacts,
        },
        source,
      );
      return { deleted: true, total: contacts.length };
    });
  }

  return {
    dataDirectory,
    mainPath,
    backupPath,
    list,
    replaceAll,
    upsertMeeting,
    create,
    update,
    remove,
  };
}

function assertOptionalString(value, path, maximum) {
  if (value === undefined) return;
  assertString(value, path, 0, maximum);
}

function assertOptionalIsoDateTime(value, path) {
  if (value === undefined) return;
  validateIsoDateTime(value, path);
}

function validateStoredMeetingRules(rules, path) {
  assertPlainObject(rules, path);
  assertExactKeys(
    rules,
    [
      "parkingVehicleLimit",
      "businessMealMin",
      "businessMealMax",
      "waterServiceIntervalMinutes",
      "reminders",
    ],
    path,
  );
  assertInteger(rules.parkingVehicleLimit, `${path}.parkingVehicleLimit`, 0, 5000);
  assertInteger(rules.businessMealMin, `${path}.businessMealMin`, 0, 1_000_000);
  assertInteger(rules.businessMealMax, `${path}.businessMealMax`, 0, 1_000_000);
  if (rules.businessMealMax < rules.businessMealMin) {
    fail(`${path}.businessMealMax`, "不能低于最低标准");
  }
  assertInteger(
    rules.waterServiceIntervalMinutes,
    `${path}.waterServiceIntervalMinutes`,
    1,
    1440,
  );
  assertPlainObject(rules.reminders, `${path}.reminders`);
  const reminderKeys = [
    "missingLocation",
    "missingOwner",
    "missingRoster",
    "overdueTasks",
    "blockedTasks",
  ];
  assertExactKeys(rules.reminders, reminderKeys, `${path}.reminders`);
  for (const key of reminderKeys) {
    assertBoolean(rules.reminders[key], `${path}.reminders.${key}`);
  }
}

function validateStoredChecklistTemplate(item, path) {
  assertPlainObject(item, path);
  assertExactKeys(
    item,
    [
      "id",
      "title",
      "description",
      "phase",
      "group",
      "condition",
      "dueOffsetDays",
      "enabled",
    ],
    path,
    ["sopImages"],
  );
  assertIdentifier(item.id, `${path}.id`);
  assertString(item.title, `${path}.title`, 1, 200);
  assertString(item.description, `${path}.description`, 0, 2_000);
  assertEnum(item.phase, `${path}.phase`, PHASES);
  assertString(item.group, `${path}.group`, 1, 120);
  assertEnum(item.condition, `${path}.condition`, CONDITIONS);
  assertInteger(item.dueOffsetDays, `${path}.dueOffsetDays`, -365, 365);
  assertBoolean(item.enabled, `${path}.enabled`);
  if (item.sopImages !== undefined) {
    if (!Array.isArray(item.sopImages) || item.sopImages.length > 50) {
      fail(`${path}.sopImages`, "必须是最多包含 50 项的数组");
    }
    item.sopImages.forEach((image, index) =>
      assertString(image, `${path}.sopImages[${index}]`, 1, 1_000),
    );
  }
}

function validateStoredMeetingTask(task, path) {
  assertPlainObject(task, path);
  assertExactKeys(
    task,
    [
      "id",
      "templateId",
      "title",
      "description",
      "phase",
      "group",
      "status",
      "owner",
      "dueDate",
      "note",
      "attachments",
    ],
    path,
    ["sopImages"],
  );
  assertMeetingIdentifier(task.id, `${path}.id`);
  assertMeetingIdentifier(task.templateId, `${path}.templateId`);
  assertString(task.title, `${path}.title`, 1, 200);
  assertString(task.description, `${path}.description`, 0, 2_000);
  assertEnum(task.phase, `${path}.phase`, PHASES);
  assertString(task.group, `${path}.group`, 1, 120);
  assertEnum(
    task.status,
    `${path}.status`,
    new Set(["todo", "doing", "blocked", "review", "done", "waived"]),
  );
  assertString(task.owner, `${path}.owner`, 0, 120);
  assertString(task.dueDate, `${path}.dueDate`, 0, 40);
  assertString(task.note, `${path}.note`, 0, 20_000);
  if (!Array.isArray(task.attachments) || task.attachments.length > 1_000) {
    fail(`${path}.attachments`, "必须是最多包含 1000 项的数组");
  }
  task.attachments.forEach((attachment, index) => {
    const attachmentPath = `${path}.attachments[${index}]`;
    assertPlainObject(attachment, attachmentPath);
    assertExactKeys(attachment, ["name", "size", "addedAt"], attachmentPath);
    assertString(attachment.name, `${attachmentPath}.name`, 1, 500);
    assertInteger(attachment.size, `${attachmentPath}.size`, 0, Number.MAX_SAFE_INTEGER);
    validateIsoDateTime(attachment.addedAt, `${attachmentPath}.addedAt`);
  });
  if (task.sopImages !== undefined) {
    if (!Array.isArray(task.sopImages) || task.sopImages.length > 50) {
      fail(`${path}.sopImages`, "必须是最多包含 50 项的数组");
    }
    task.sopImages.forEach((image, index) =>
      assertString(image, `${path}.sopImages[${index}]`, 1, 1_000),
    );
  }
}

function validateStoredMeeting(meeting, index) {
  const path = `meetings[${index}]`;
  assertPlainObject(meeting, path);
  assertExactKeys(
    meeting,
    [
      "id",
      "title",
      "date",
      "startTime",
      "location",
      "organizer",
      "owner",
      "attendeeEstimate",
      "rosterRequired",
      "afternoonMeeting",
      "mealType",
      "alcoholRequired",
      "parkingRequired",
      "vehicleCount",
      "publicityRequired",
      "reimbursementRequired",
      "presentationRequired",
      "welcomeScreenRequired",
      "roomSize",
      "createdAt",
      "updatedAt",
      "tasks",
      "attendees",
    ],
    path,
    [
      "endTime",
      "meetingRoomId",
      "roomRequirements",
      "notes",
      "templateSource",
      "ruleSnapshot",
      "archivedAt",
      "deletedAt",
      "vehicles",
      "seatingPlan",
    ],
  );
  assertMeetingIdentifier(meeting.id, `${path}.id`);
  assertString(meeting.title, `${path}.title`, 1, 200);
  assertString(meeting.date, `${path}.date`, 1, 40);
  assertString(meeting.startTime, `${path}.startTime`, 0, 20);
  if (meeting.startTime && !TIME_PATTERN.test(meeting.startTime)) {
    fail(`${path}.startTime`, "时间格式不正确");
  }
  assertOptionalString(meeting.endTime, `${path}.endTime`, 20);
  if (meeting.endTime && !TIME_PATTERN.test(meeting.endTime)) {
    fail(`${path}.endTime`, "时间格式不正确");
  }
  if (meeting.endTime && meeting.startTime && meeting.endTime <= meeting.startTime) {
    fail(`${path}.endTime`, "必须晚于开始时间");
  }
  assertString(meeting.location, `${path}.location`, 0, 500);
  assertOptionalString(meeting.meetingRoomId, `${path}.meetingRoomId`, 200);
  assertOptionalString(meeting.roomRequirements, `${path}.roomRequirements`, 2_000);
  assertString(meeting.organizer, `${path}.organizer`, 0, 200);
  assertString(meeting.owner, `${path}.owner`, 0, 120);
  assertInteger(meeting.attendeeEstimate, `${path}.attendeeEstimate`, 0, 5_000);
  assertBoolean(meeting.rosterRequired, `${path}.rosterRequired`);
  assertBoolean(meeting.afternoonMeeting, `${path}.afternoonMeeting`);
  assertEnum(meeting.mealType, `${path}.mealType`, new Set(["none", "business", "work"]));
  assertBoolean(meeting.alcoholRequired, `${path}.alcoholRequired`);
  assertBoolean(meeting.parkingRequired, `${path}.parkingRequired`);
  assertInteger(meeting.vehicleCount, `${path}.vehicleCount`, 0, 5_000);
  if (meeting.seatingPlan !== undefined) {
    try { validateSeatingPlan(meeting.seatingPlan); } catch (error) {
      fail(`${path}.seatingPlan`, error instanceof Error ? error.message : "座次表无效");
    }
  }
  if (meeting.vehicles !== undefined) {
    if (!Array.isArray(meeting.vehicles) || meeting.vehicles.length > 500) fail(`${path}.vehicles`, "最多登记 500 辆参会车辆");
    const plates = new Set();
    meeting.vehicles.forEach((vehicle, index) => {
      const vehiclePath = `${path}.vehicles[${index}]`;
      assertPlainObject(vehicle, vehiclePath);
      assertExactKeys(vehicle, ["unit", "licensePlate", "note"], vehiclePath);
      assertString(vehicle.unit, `${vehiclePath}.unit`, 0, 200);
      assertString(vehicle.licensePlate, `${vehiclePath}.licensePlate`, 1, 40);
      assertString(vehicle.note, `${vehiclePath}.note`, 0, 500);
      const plate = vehicle.licensePlate.normalize("NFKC").replace(/[\s·•]/g, "").toUpperCase();
      if (!plate || plates.has(plate)) fail(`${vehiclePath}.licensePlate`, "车牌为空或重复，请核对");
      plates.add(plate);
    });
  }
  assertBoolean(meeting.publicityRequired, `${path}.publicityRequired`);
  assertBoolean(meeting.reimbursementRequired, `${path}.reimbursementRequired`);
  assertBoolean(meeting.presentationRequired, `${path}.presentationRequired`);
  assertBoolean(meeting.welcomeScreenRequired, `${path}.welcomeScreenRequired`);
  assertEnum(meeting.roomSize, `${path}.roomSize`, new Set(["small", "large"]));
  validateIsoDateTime(meeting.createdAt, `${path}.createdAt`);
  validateIsoDateTime(meeting.updatedAt, `${path}.updatedAt`);
  assertOptionalIsoDateTime(meeting.archivedAt, `${path}.archivedAt`);
  assertOptionalIsoDateTime(meeting.deletedAt, `${path}.deletedAt`);
  assertOptionalString(meeting.notes, `${path}.notes`, 20_000);
  if (!Array.isArray(meeting.tasks) || meeting.tasks.length > MAX_MEETING_TASKS) {
    fail(`${path}.tasks`, `最多保存 ${MAX_MEETING_TASKS} 项任务`);
  }
  meeting.tasks.forEach((task, taskIndex) =>
    validateStoredMeetingTask(task, `${path}.tasks[${taskIndex}]`),
  );
  if (
    !Array.isArray(meeting.attendees) ||
    meeting.attendees.length > MAX_MEETING_ATTENDEES
  ) {
    fail(`${path}.attendees`, `最多保存 ${MAX_MEETING_ATTENDEES} 名参会人`);
  }
  meeting.attendees.forEach((attendee, attendeeIndex) => {
    const attendeePath = `${path}.attendees[${attendeeIndex}]`;
    assertPlainObject(attendee, attendeePath);
    assertExactKeys(
      attendee,
      ["id", "name", "unit", "department", "title"],
      attendeePath,
      ["source", "licensePlate"],
    );
    assertMeetingIdentifier(attendee.id, `${attendeePath}.id`);
    assertString(attendee.name, `${attendeePath}.name`, 1, 80);
    assertString(attendee.unit, `${attendeePath}.unit`, 0, 200);
    assertString(attendee.department, `${attendeePath}.department`, 0, 120);
    assertString(attendee.title, `${attendeePath}.title`, 0, 120);
    assertOptionalString(attendee.licensePlate, `${attendeePath}.licensePlate`, 40);
    assertOptionalString(attendee.source, `${attendeePath}.source`, 500);
  });
  if (meeting.templateSource !== undefined) {
    const sourcePath = `${path}.templateSource`;
    assertPlainObject(meeting.templateSource, sourcePath);
    assertExactKeys(
      meeting.templateSource,
      ["configRevision", "capturedAt", "checklistTemplates"],
      sourcePath,
    );
    assertInteger(
      meeting.templateSource.configRevision,
      `${sourcePath}.configRevision`,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    validateIsoDateTime(meeting.templateSource.capturedAt, `${sourcePath}.capturedAt`);
    if (
      !Array.isArray(meeting.templateSource.checklistTemplates) ||
      meeting.templateSource.checklistTemplates.length > 300
    ) {
      fail(`${sourcePath}.checklistTemplates`, "必须是最多包含 300 项的数组");
    }
    meeting.templateSource.checklistTemplates.forEach((item, itemIndex) =>
      validateStoredChecklistTemplate(
        item,
        `${sourcePath}.checklistTemplates[${itemIndex}]`,
      ),
    );
  }
  if (meeting.ruleSnapshot !== undefined) {
    validateStoredMeetingRules(meeting.ruleSnapshot, `${path}.ruleSnapshot`);
  }
}

function validateMeetingsState(state) {
  assertPlainObject(state, "meetingsState");
  assertExactKeys(
    state,
    ["schemaVersion", "updatedAt", "meetings"],
    "meetingsState",
  );
  if (state.schemaVersion !== MEETINGS_SCHEMA_VERSION) {
    throw new LocalConfigError("会议数据文件版本不受支持", {
      code: "MEETINGS_CORRUPTED",
      status: 500,
    });
  }
  validateIsoDateTime(state.updatedAt, "meetingsState.updatedAt", {
    nullable: true,
  });
  if (!Array.isArray(state.meetings) || state.meetings.length > MAX_MEETINGS) {
    throw new LocalConfigError(`最多保存 ${MAX_MEETINGS.toLocaleString()} 场会议`, {
      code: "MEETINGS_TOO_LARGE",
      status: 413,
    });
  }
  const ids = new Set();
  state.meetings.forEach((meeting, index) => {
    validateStoredMeeting(meeting, index);
    if (ids.has(meeting.id)) fail(`meetings[${index}].id`, "会议 ID 重复");
    ids.add(meeting.id);
  });
  return state;
}

async function readMeetingsStateFile(path) {
  const contents = await readFile(path, "utf8");
  if (Buffer.byteLength(contents, "utf8") > MAX_MEETINGS_BYTES) {
    throw new LocalConfigError("会议数据文件超过 32MB 限制", {
      code: "MEETINGS_TOO_LARGE",
      status: 413,
    });
  }
  return validateMeetingsState(JSON.parse(contents));
}

export function createLocalMeetingStore({
  dataDirectory = resolveAdminDataDirectory(),
  now = () => new Date(),
} = {}) {
  const mainPath = join(dataDirectory, MEETINGS_FILE_NAME);
  const backupPath = join(dataDirectory, MEETINGS_BACKUP_FILE_NAME);
  let writeQueue = Promise.resolve();

  function freshMeetingsState() {
    return {
      schemaVersion: MEETINGS_SCHEMA_VERSION,
      updatedAt: null,
      meetings: [],
    };
  }

  async function loadUnsafe() {
    try {
      return { state: await readMeetingsStateFile(mainPath), source: "main" };
    } catch (mainError) {
      if (mainError?.code === "ENOENT") {
        try {
          return { state: await readMeetingsStateFile(backupPath), source: "backup" };
        } catch (backupError) {
          if (backupError?.code === "ENOENT") {
            return { state: freshMeetingsState(), source: "empty" };
          }
          throw new LocalConfigError("会议数据备份文件损坏，无法恢复", {
            code: "MEETINGS_CORRUPTED",
            status: 500,
            details: { cause: backupError.message },
          });
        }
      }
      try {
        return { state: await readMeetingsStateFile(backupPath), source: "backup" };
      } catch (backupError) {
        throw new LocalConfigError("会议数据主文件和备份均已损坏", {
          code: "MEETINGS_CORRUPTED",
          status: 500,
          details: {
            main: mainError.message,
            backup: backupError?.message,
          },
        });
      }
    }
  }

  async function writeAtomic(state, source) {
    validateMeetingsState(state);
    const serialized = `${JSON.stringify(state)}\n`;
    if (Buffer.byteLength(serialized, "utf8") > MAX_MEETINGS_BYTES) {
      throw new LocalConfigError("会议数据超过 32MB 持久化限制", {
        code: "MEETINGS_TOO_LARGE",
        status: 413,
      });
    }
    await mkdir(dataDirectory, { recursive: true });
    const temporaryPath = join(
      dataDirectory,
      `.${MEETINGS_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
    );
    let handle;
    try {
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    } finally {
      await handle?.close().catch(() => {});
    }
    try {
      if (source === "main" && (await fileExists(mainPath))) {
        await rm(backupPath, { force: true });
        await rename(mainPath, backupPath);
      } else if (source === "backup") {
        await rm(mainPath, { force: true });
      }
      await rename(temporaryPath, mainPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => {});
      if (!(await fileExists(mainPath)) && (await fileExists(backupPath))) {
        await rename(backupPath, mainPath).catch(() => {});
      }
      throw error;
    }
  }

  function enqueue(operation) {
    const pending = writeQueue.then(operation, operation);
    writeQueue = pending.catch(() => {});
    return pending;
  }

  async function getSnapshot() {
    await writeQueue;
    const { state } = await loadUnsafe();
    return clone(state);
  }

  async function replaceAll({ meetings }) {
    return enqueue(async () => {
      const { source } = await loadUnsafe();
      const state = {
        schemaVersion: MEETINGS_SCHEMA_VERSION,
        updatedAt: now().toISOString(),
        meetings: clone(meetings),
      };
      validateMeetingsState(state);
      await writeAtomic(state, source);
      return clone(state);
    });
  }

  return {
    dataDirectory,
    mainPath,
    backupPath,
    getSnapshot,
    replaceAll,
  };
}
