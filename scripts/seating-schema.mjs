export const SEATING_TEMPLATES = ["podium-auto", "podium-single", "podium-double", "podium-wide", "table", "table-five", "round"];

function object(value, keys, path, optional = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须为对象`);
  if (Object.keys(value).some((key) => !keys.includes(key) && !optional.includes(key)) || keys.some((key) => !Object.hasOwn(value, key))) throw new Error(`${path} 字段不完整或包含未知字段`);
}
function text(value, maximum, path, required = false) {
  if (typeof value !== "string" || value.length > maximum || (required && !value.trim())) throw new Error(`${path} 格式不正确`);
}
function integer(value, min, max, path) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${path} 超出范围`);
}

export function validateSeatingOptions(value) {
  object(value, ["template", "hostCompany", "door", "rowCapacity", "closeThreshold", "anchorMode", "tableCenter", "moderatorId"], "座次设置");
  if (!SEATING_TEMPLATES.includes(value.template)) throw new Error("不支持此座次模板");
  text(value.hostCompany, 200, "本公司名称");
  text(value.moderatorId, 200, "主持人编号");
  if (!["top", "bottom"].includes(value.door) || !["host-first", "rank-first"].includes(value.anchorMode) || !["auto", "single", "double"].includes(value.tableCenter)) throw new Error("座次方向或主位规则无效");
  integer(value.rowCapacity, 1, 30, "每排人数");
  integer(value.closeThreshold, 0, 10000, "双中心权重差");
  return value;
}

export function validateSeatingPeople(value) {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new Error("座次名单需要 1–200 人");
  const ids = new Set();
  value.forEach((person, index) => {
    const path = `第 ${index + 1} 人`;
    object(person, ["id", "name", "unit", "title", "grade", "weight", "party"], path);
    text(person.id, 200, `${path}编号`, true);
    text(person.name, 80, `${path}姓名`, true);
    text(person.unit, 200, `${path}单位`);
    text(person.title, 120, `${path}职务`);
    text(person.grade, 120, `${path}职级`);
    if (person.weight !== null) integer(person.weight, 0, 10000, `${path}权重`);
    if (!["auto", "host", "guest"].includes(person.party) || ids.has(person.id)) throw new Error(`${path}所属方无效或编号重复`);
    ids.add(person.id);
  });
  return value;
}

export function validateSeatingPlan(value) {
  object(value, ["schemaVersion", "options", "participants", "seats", "warnings", "explanation", "generatedAt", "manualAdjusted"], "座次表", ["lockedSeatIds", "roomId"]);
  if (value.roomId !== undefined) text(value.roomId, 200, "编排参考会议室");
  if (value.schemaVersion !== 1 || typeof value.manualAdjusted !== "boolean") throw new Error("座次表版本无效");
  validateSeatingOptions(value.options);
  validateSeatingPeople(value.participants);
  text(value.generatedAt, 40, "座次生成时间", true);
  if (Number.isNaN(Date.parse(value.generatedAt))) throw new Error("座次生成时间无效");
  text(value.explanation, 4000, "排座依据", true);
  if (!Array.isArray(value.warnings) || value.warnings.length > 500) throw new Error("座次提醒过多");
  value.warnings.forEach((warning) => text(warning, 1000, "座次提醒"));
  if (!Array.isArray(value.seats) || value.seats.length > 600) throw new Error("座位数量无效");
  const people = new Set(value.participants.map((person) => person.id));
  const assigned = new Set();
  const positions = new Set();
  const seatIds = new Set();
  const numbers = new Set();
  value.seats.forEach((seat) => {
    object(seat, ["id", "group", "row", "position", "seatNumber", "personId", "party", "labels"], "席位");
    text(seat.id, 200, "席位编号", true);
    text(seat.group, 120, "排/方", true);
    integer(seat.row, 1, 200, "排数");
    integer(seat.position, 0, 599, "席位位置");
    text(seat.seatNumber, 30, "座位号");
    if (!["host", "guest", "none"].includes(seat.party)) throw new Error("席位所属方无效");
    if (!Array.isArray(seat.labels) || seat.labels.length > 3 || seat.labels.some((label) => !["主位", "主宾", "主持人"].includes(label))) throw new Error("席位标签无效");
    const position = `${seat.row}:${seat.position}`;
    if (seatIds.has(seat.id) || positions.has(position)) throw new Error("席位位置重复");
    seatIds.add(seat.id); positions.add(position);
    if (seat.personId !== null) {
      if (!people.has(seat.personId) || assigned.has(seat.personId) || !seat.seatNumber || numbers.has(seat.seatNumber) || seat.party === "none") throw new Error("人员/座位号重复或不在名单中，或所属方无效");
      assigned.add(seat.personId); numbers.add(seat.seatNumber);
    } else if (seat.seatNumber || seat.party !== "none" || seat.labels.length) throw new Error("空席不可绑定人员或角色");
  });
  if (assigned.size !== people.size) throw new Error("有参会人员尚未分配座位");
  if (value.lockedSeatIds !== undefined && (!Array.isArray(value.lockedSeatIds) || value.lockedSeatIds.length > 200 || new Set(value.lockedSeatIds).size !== value.lockedSeatIds.length || value.lockedSeatIds.some((id) => typeof id !== "string" || !value.seats.some((seat) => seat.id === id && seat.personId !== null)))) throw new Error("锁定席位无效或重复");
  return value;
}
