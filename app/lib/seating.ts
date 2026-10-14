import type { RosterRules } from "./admin-config";
import { rankRosterRecords, normalizeRankingText } from "./roster-ranking";
import { buildUnitDirectory, resolveCanonicalUnit } from "./unit-directory";
import { validateSeatingOptions, validateSeatingPeople, validateSeatingPlan } from "../../scripts/seating-schema.mjs";

export type SeatingParty = "auto" | "host" | "guest";
export type SeatingPerson = { id: string; name: string; unit: string; title: string; grade: string; weight: number | null; party: SeatingParty };
export type SeatingOptions = {
  template: "podium-auto" | "podium-single" | "podium-double" | "podium-wide" | "table" | "table-five" | "round";
  hostCompany: string;
  door: "top" | "bottom";
  rowCapacity: number;
  closeThreshold: number;
  anchorMode: "host-first" | "rank-first";
  tableCenter: "auto" | "single" | "double";
  moderatorId: string;
};
export type SeatingSeat = { id: string; group: string; row: number; position: number; seatNumber: string; personId: string | null; party: "host" | "guest" | "none"; labels: string[] };
export type SeatingPlan = { schemaVersion: 1; options: SeatingOptions; participants: SeatingPerson[]; seats: SeatingSeat[]; warnings: string[]; explanation: string; generatedAt: string; manualAdjusted: boolean; lockedSeatIds?: string[]; roomId?: string };
export const SEATING_TEMPLATE_LABELS: Record<SeatingOptions["template"], string> = {
  "podium-auto": "主席台（自动单/双中心）", "podium-single": "主席台（单中心）", "podium-double": "主席台（双中心）",
  "podium-wide": "主席台（单中心·宽间距）", table: "长方桌会谈（单/双中心）", "table-five": "长方桌会谈（5 对 5）", round: "圆桌 / 宴会式（单主位）",
};
export function defaultSeatingOptions(hostCompany: string): SeatingOptions {
  return { template: "podium-auto", hostCompany, door: "bottom", rowCapacity: 9, closeThreshold: 50, anchorMode: "host-first", tableCenter: "auto", moderatorId: "" };
}
export function normalizeSeatingPeople(value: SeatingPerson[]) {
  const people = value.map((person) => ({ ...person, name: person.name.trim().replace(/\s+/g, ""), unit: person.unit.trim(), title: person.title.trim(), grade: person.grade.trim() }))
    .filter((person) => person.name || person.unit || person.title || person.grade || person.weight !== null);
  validateSeatingPeople(people);
  const identities = new Set<string>();
  people.forEach((person) => {
    const key = `${normalizeRankingText(person.name)}:${normalizeRankingText(person.unit)}`;
    if (identities.has(key)) throw new Error(`“${person.name}（${person.unit || "单位待补"}）”重复，请核对`);
    identities.add(key);
  });
  return people;
}
export function effectiveSeatingParty(person: SeatingPerson, options: SeatingOptions, rules: RosterRules): "host" | "guest" {
  if (person.party !== "auto") return person.party;
  const units = buildUnitDirectory(rules.aliases);
  const company = resolveCanonicalUnit(options.hostCompany, units)?.canonical ?? options.hostCompany;
  const unit = resolveCanonicalUnit(person.unit, units)?.canonical ?? person.unit;
  return company.trim() && normalizeRankingText(unit) === normalizeRankingText(company) ? "host" : "guest";
}
const GRADE_WEIGHTS = [
  ["正国", 1000], ["副国", 950], ["正部", 900], ["副部", 850], ["正厅", 800], ["副厅", 750], ["正处", 700], ["副处", 650], ["正科", 600], ["副科", 550], ["科员", 500],
] as const;
export function seatingWeight(person: SeatingPerson, rules: RosterRules) {
  if (person.weight !== null) return { value: person.weight, evidence: "人工指定权重", known: true };
  const grade = normalizeRankingText(person.grade);
  const matched = GRADE_WEIGHTS.find(([keyword]) => grade.includes(keyword));
  if (matched) return { value: matched[1], evidence: `职级“${person.grade}”的默认权重（可人工覆盖）`, known: true };
  if (grade) return { value: 0, evidence: `职级“${person.grade}”未识别，请填写权重`, known: false };
  const record = { ...person, originalIndex: 0 };
  const decision = rankRosterRecords([record], rules).decisions[person.id].title;
  const known = decision.evidence.some((entry) => entry.source !== "fallback");
  return { value: known ? Math.max(1, 1000 - decision.priority) : 0, evidence: known ? `管理中心职务规则：${decision.tierLabel}` : "职务/职级未识别，暂置末位", known };
}

function centeredPositions(count: number, dual: boolean, wide: boolean, mirrored = false) {
  // Display perspective: default #2 is to the right of #1 (the seated person's left).
  const offsets: number[] = [];
  for (let rank = 0; rank < count; rank++) {
    if (dual) offsets.push(rank % 2 === 0 ? -1 - rank : rank);
    else if (!rank) offsets.push(0);
    else offsets.push((rank % 2 ? 1 : -1) * (Math.ceil(rank / 2) + (wide ? 1 : 0)));
  }
  if (dual) {
    const span = Math.max(...offsets.map(Math.abs));
    return { positions: offsets.map((offset) => mirrored ? (span - offset) / 2 : (offset + span) / 2), size: span + 1 };
  }
  const radius = Math.max(0, ...offsets.map(Math.abs), wide ? 1 : 0);
  return { positions: offsets.map((offset) => (mirrored ? -offset : offset) + radius), size: radius * 2 + 1 };
}

export function generateSeatingPlan(value: SeatingPerson[], options: SeatingOptions, rules: RosterRules, now = new Date()): SeatingPlan {
  validateSeatingOptions(options);
  const participants = normalizeSeatingPeople(value);
  const warnings: string[] = [];
  const weighted = participants.map((person, index) => ({ person, index, rank: seatingWeight(person, rules), party: effectiveSeatingParty(person, options, rules) }))
    .sort((a, b) => b.rank.value - a.rank.value || a.index - b.index);
  weighted.forEach(({ person, rank }) => {
    if (!rank.known) warnings.push(`${person.name}：${rank.evidence}，需人工确认。`);
    if (person.party === "auto" && !person.unit) warnings.push(`${person.name}：单位/所属方未填，暂按客方，请确认。`);
  });
  if (participants.some((person) => person.party === "auto") && !options.hostCompany.trim()) throw new Error("请填写本公司名称，或逐人指定主方/客方");
  const hostList = weighted.filter((entry) => entry.party === "host");
  const guestList = weighted.filter((entry) => entry.party === "guest");
  const moderator = weighted.find((entry) => entry.person.id === options.moderatorId);
  if (options.moderatorId && (!moderator || moderator.party !== "host")) throw new Error("主持人必须选择名单中的主方人员");
  function moderatorLast<T extends { person: SeatingPerson; party: "host" | "guest" }>(list: T[]) {
    const rest = list.filter((entry) => entry.person.id !== options.moderatorId);
    const moderators = list.filter((entry) => entry.person.id === options.moderatorId);
    const lastHost = rest.findLastIndex((entry) => entry.party === "host");
    rest.splice(lastHost >= 0 ? lastHost + 1 : rest.length, 0, ...moderators);
    return rest;
  }
  const hosts = moderatorLast(hostList);
  const host = hosts[0];
  const guest = guestList[0];
  if (!host) warnings.push("未识别到主方，不标注主位；请核对本公司名称或所属方。");
  if (host?.person.id === options.moderatorId) warnings.push("主持人是唯一主方，同时承担主位，请人工核对。");
  let ordered = moderatorLast(weighted);
  if (options.anchorMode === "host-first" && host) {
    const rankedOrder = ordered;
    const anchors = guest ? [host, guest] : [host];
    ordered = [...anchors, ...ordered.filter((entry) => !anchors.includes(entry))];
    if (ordered.some((entry, index) => entry !== rankedOrder[index])) warnings.push("本方主位、主宾优先与全体职级次序存在冲突，已保留本方中心席并让主宾紧邻，请确认。");
  }
  if (participants.some((person) => person.grade && person.weight === null) && participants.some((person) => !person.grade && person.title && person.weight === null)) {
    warnings.push("行政职级与公司职务使用不同来源的默认权重，不能视为统一礼宾级别；请用人工权重校准。数值越大席位越优先。");
  }
  type Entry = typeof weighted[number];
  const seats: SeatingSeat[] = [];
  const seatRanks = new Map(ordered.map((entry, index) => [entry.person.id, index + 1]));
  function labels(entry: Entry) {
    return [...(entry === host ? ["主位"] : []), ...(entry === guest ? ["主宾"] : []), ...(entry.person.id === options.moderatorId ? ["主持人"] : [])];
  }
  function placeRow(list: Entry[], row: number, group: string, dual: boolean, wide = false, mirrored = false) {
    const layout = centeredPositions(list.length, dual, wide, mirrored);
    const rowSeats = Array.from({ length: layout.size }, (_, position): SeatingSeat => ({ id: `seat-${row}-${position}`, group, row, position, seatNumber: "", personId: null, party: "none", labels: [] }));
    list.forEach((entry, rank) => {
      const position = layout.positions[rank];
      rowSeats[position] = { ...rowSeats[position], personId: entry.person.id, seatNumber: String(seatRanks.get(entry.person.id)), party: entry.party, labels: labels(entry) };
    });
    seats.push(...rowSeats);
  }
  const close = (list: Entry[]) => list.length % 2 === 0 && list.length >= 2 && list[0].rank.known && list[1].rank.known && Math.abs(list[0].rank.value - list[1].rank.value) <= options.closeThreshold;
  if (options.template === "table" || options.template === "table-five") {
    if (!hosts.length || !guestList.length) throw new Error("双边会谈需要同时存在主方和客方，请核对所属方");
    if (options.template === "table-five" && (hosts.length !== 5 || guestList.length !== 5)) throw new Error("5 对 5 模板要求主方、客方各 5 人；其他人数请选择普通长方桌会谈");
    if (hosts.length > 30 || guestList.length > 30) throw new Error("长方桌每侧最多 30 人，更多人员请改用多排主席台");
    const dual = (list: Entry[]) => options.tableCenter === "double" ? list.length % 2 === 0 : options.tableCenter === "auto" && close(list);
    if (options.tableCenter === "double" && (hosts.length % 2 || guestList.length % 2)) throw new Error("双中心会谈要求双方人数均为偶数");
    placeRow(hosts, options.door === "bottom" ? 2 : 1, "主方（背门）", dual(hosts), false, options.door === "bottom");
    placeRow(guestList, options.door === "bottom" ? 1 : 2, "客方（面门、远门）", dual(guestList), false, options.door === "top");
    warnings.push("长方桌主位与主宾分处两侧中心、相对而坐，不适用单排中的紧邻；以会谈模板为准。");
  } else if (options.template === "round") {
    if (ordered.length > 30) throw new Error("单圆桌最多 30 人，请改用多排主席台或拆分会议");
    const count = ordered.length;
    if (options.anchorMode === "rank-first" && host && ordered[0] !== host) warnings.push("圆桌主座采用全体职级优先，主方最高者不在中心主座，请确认或切换本方主位优先。");
    const positions = Array.from({ length: count }, (_, rank) => rank === 0 ? 0 : rank % 2 ? Math.ceil(rank / 2) : count - rank / 2);
    ordered.forEach((entry, rank) => seats.push({ id: `seat-1-${positions[rank]}`, group: "圆桌", row: 1, position: positions[rank], seatNumber: String(seatRanks.get(entry.person.id)), personId: entry.person.id, party: entry.party, labels: labels(entry) }));
  } else {
    if (options.template === "podium-double" && ordered.length % 2) throw new Error("主席台双中心模板需要偶数人数");
    if (options.template === "podium-double" && options.rowCapacity % 2) throw new Error("双中心模板的每排人数需设为偶数");
    for (let offset = 0; offset < ordered.length; offset += options.rowCapacity) {
      const rowList = ordered.slice(offset, offset + options.rowCapacity);
      const row = Math.floor(offset / options.rowCapacity) + 1;
      const dual = options.template === "podium-double" || (options.template === "podium-auto" && close(rowList));
      placeRow(rowList, row, `第 ${row} 排${row === 1 ? "（前排）" : ""}`, dual, options.template === "podium-wide" && row === 1);
    }
    if (host && ordered[0] !== host) warnings.push("全体职级优先：1 号居中，主方主位可能不在中间；请核对主位规则。");
    if (options.door === "top") warnings.push("主席台席位均面向图下方；图上方的门位于就座者身后，无法同时满足面门要求，请核对场地布置。");
  }
  const explanation = options.template.startsWith("table")
    ? "双方分别按确认的职级/权重安排中心席，客方面门且远门、主方背门；主方主持人置本方末位。"
    : options.template === "round"
      ? "主座位于远门、面门处；由主座向两侧交替安排，主宾紧邻主位，主持人按本方末位处理。"
      : "前排高于后排、中心高于两侧；按就座者视角，2 号在 1 号左手侧（图上右侧），由内向外交替落座。";
  const plan: SeatingPlan = { schemaVersion: 1, options: { ...options }, participants, seats, warnings, explanation, generatedAt: now.toISOString(), manualAdjusted: false };
  validateSeatingPlan(plan);
  return plan;
}

export function swapSeatingPeople(plan: SeatingPlan, seatId: string, personId: string) {
  validateSeatingPlan(plan);
  const target = plan.seats.find((seat) => seat.id === seatId && seat.personId !== null);
  const source = plan.seats.find((seat) => seat.personId === personId);
  if (!target || !source) throw new Error("只可交换已有人员的席位");
  if (target === source) return plan;
  if (plan.lockedSeatIds?.includes(target.id) || plan.lockedSeatIds?.includes(source.id)) throw new Error("席位已锁定，请先解锁再交换");
  const seats = plan.seats.map((seat) => seat === target ? { ...seat, personId: source.personId, party: source.party, labels: [...source.labels] }
    : seat === source ? { ...seat, personId: target.personId, party: target.party, labels: [...target.labels] } : { ...seat });
  const warning = "已人工交换席位，主位、主宾位置及主客方朝向可能改变，请会务人员最终确认。";
  const updated = { ...plan, seats, warnings: plan.warnings.includes(warning) ? plan.warnings : [...plan.warnings, warning], manualAdjusted: true, explanation: `${plan.explanation.replace(/；已人工调整席位。$/, "").replace(/。$/, "")}；已人工调整席位。` };
  validateSeatingPlan(updated);
  return updated;
}

export function toggleSeatingLock(plan: SeatingPlan, seatId: string): SeatingPlan {
  validateSeatingPlan(plan);
  if (!plan.seats.some((seat) => seat.id === seatId && seat.personId !== null)) throw new Error("只能锁定已安排人员的席位");
  const locks = plan.lockedSeatIds ?? [];
  const next = { ...plan, lockedSeatIds: locks.includes(seatId) ? locks.filter((id) => id !== seatId) : [...locks, seatId] };
  validateSeatingPlan(next);
  return next;
}

// Locks protect physical positions, not rank numbers. Never silently discard an incompatible lock.
export function regenerateSeatingPlan(people: SeatingPerson[], options: SeatingOptions, rules: RosterRules, previous?: SeatingPlan | null): SeatingPlan {
  const next = generateSeatingPlan(people, options, rules);
  if (previous?.roomId !== undefined) next.roomId = previous.roomId;
  if (!previous?.lockedSeatIds?.length) return next;
  validateSeatingPlan(previous);
  if (previous.options.template !== options.template || previous.options.door !== options.door || previous.options.rowCapacity !== options.rowCapacity || previous.options.tableCenter !== options.tableCenter) throw new Error("布局或朝向已改变，请先解除锁定，再重新生成");
  const locks = previous.lockedSeatIds.map((id) => previous.seats.find((seat) => seat.id === id)!);
  for (const seat of locks) {
    const target = next.seats.find((item) => item.id === seat.id);
    const oldRow = previous.seats.filter((item) => item.row === seat.row);
    const newRow = next.seats.filter((item) => item.row === seat.row);
    if (!target || target.personId === null || oldRow.length !== newRow.length || !next.participants.some((person) => person.id === seat.personId)) throw new Error("人员或中心布局变化使锁定位置不兼容，请先解锁后生成");
    if (options.template === "round" && previous.participants.length !== next.participants.length) throw new Error("圆桌人数变化，请先解锁后生成");
  }
  const lockedPeople = new Set(locks.map((seat) => seat.personId));
  const available = next.seats.filter((seat) => seat.personId !== null && !lockedPeople.has(seat.personId));
  const payloads = new Map(next.seats.filter((seat) => seat.personId !== null).map((seat) => [seat.personId, seat]));
  const seats = next.seats.map((seat) => {
    if (seat.personId === null) return seat;
    const lock = locks.find((item) => item.id === seat.id);
    const person = lock ? payloads.get(lock.personId)! : available.shift()!;
    return { ...seat, personId: person.personId, party: person.party, labels: [...person.labels] };
  });
  const result = { ...next, seats, lockedSeatIds: [...previous.lockedSeatIds], manualAdjusted: true,
    warnings: [...next.warnings, "已保留锁定人员的物理席位；主位、主宾和所属方朝向请再次核对。"] };
  validateSeatingPlan(result);
  return result;
}

export async function buildSeatingXlsx(plan: SeatingPlan) {
  validateSeatingPlan(plan);
  const XLSX = await import("xlsx");
  const people = new Map(plan.participants.map((person) => [person.id, person]));
  const rows = [["排/方", "座位号", "姓名", "单位", "职务", "职级", "所属方", "席位标签"],
    ...[...plan.seats].sort((a, b) => a.row - b.row || a.position - b.position).map((seat) => {
      const person = people.get(seat.personId ?? "");
      return [seat.group, seat.seatNumber, person?.name ?? "（留空席）", person?.unit ?? "", person?.title ?? "", person?.grade ?? "", seat.party === "host" ? "主方" : seat.party === "guest" ? "客方" : "", seat.labels.join(" / ")];
    })];
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [18, 8, 14, 40, 20, 14, 10, 22].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, sheet, "座次表");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["排座依据", plan.explanation], ["模板", SEATING_TEMPLATE_LABELS[plan.options.template]], ["本公司", plan.options.hostCompany], ["门的位置", plan.options.door === "bottom" ? "图下方" : "图上方"], ["锁定席位", plan.seats.filter((seat) => plan.lockedSeatIds?.includes(seat.id)).map((seat) => `${seat.seatNumber}号 ${people.get(seat.personId ?? "")?.name ?? ""}`).join("、")], ...plan.warnings.map((warning) => ["核对提醒", warning])]), "依据与提醒");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
}

export function parseSeatingRows(rows: unknown[][]): { people: SeatingPerson[]; moderatorId: string } {
  const text = (value: unknown) => String(value ?? "").trim();
  const nonEmpty = rows.filter((row) => row.some((cell) => text(cell)) && !row.every((cell) => /^[-:—\s]*$/.test(text(cell))));
  const headerIndex = nonEmpty.findIndex((row) => row.some((cell) => /^(姓名|名字|name)$/i.test(text(cell))));
  const headers = headerIndex >= 0 ? nonEmpty[headerIndex].map(text) : ["姓名", "单位", "职务", "职级", "所属方", "权重"];
  const data = (headerIndex >= 0 ? nonEmpty.slice(headerIndex + 1) : nonEmpty).filter((row) => !row.some((cell) => /^(姓名|名字|name)$/i.test(text(cell))));
  const column = (pattern: RegExp) => headers.findIndex((header) => pattern.test(header));
  const columns = { name: column(/^(姓名|名字|name)$/i), unit: column(/单位|公司|机构|organization/i), title: column(/职务|职位|岗位|title/i), grade: column(/职级|级别|grade/i), weight: column(/权重|weight/i), party: column(/所属方|主客|方别|party/i), role: column(/角色|标签|role/i) };
  let moderatorId = "";
  const people = data.map((row, index): SeatingPerson => {
    const cell = (key: keyof typeof columns) => columns[key] >= 0 ? text(row[columns[key]]) : "";
    const weightText = cell("weight");
    const party = cell("party");
    if (party && !/^(主方|本方|主办方|客方|嘉宾方|自动|host|guest|auto)$/i.test(party)) throw new Error(`第 ${index + 1} 行所属方“${party}”无法识别，请用主方/客方`);
    const id = `seating-import-${index + 1}`;
    if (/主持人/.test(cell("role"))) {
      if (moderatorId) throw new Error("名单包含多位主持人，请人工确认一位主持人");
      moderatorId = id;
    }
    return { id, name: cell("name"), unit: cell("unit"), title: cell("title"), grade: cell("grade"), weight: weightText ? Number(weightText) : null,
      party: /^(主方|本方|主办方|host)$/i.test(party) ? "host" : /^(客方|嘉宾方|guest)$/i.test(party) ? "guest" : "auto" };
  });
  return { people: normalizeSeatingPeople(people), moderatorId };
}

export function parseSeatingText(value: string) {
  if (value.length > 100000) throw new Error("名单文本最多 100,000 字");
  const rows = value.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    if (line.includes("|")) return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
    if (line.includes("\t")) return line.split("\t");
    return line.split(/[,，]|\s{2,}/);
  });
  return parseSeatingRows(rows);
}

export function parseSeatingTables(tables: unknown[][][]) {
  const named = tables.filter((rows) => rows.some((row) => row.some((cell) => /^(姓名|名字|name)$/i.test(String(cell ?? "").trim()))));
  const selected = named.length ? named : tables.filter((rows) => rows.length).slice(0, 1);
  const imported = selected.map((rows, tableIndex) => {
    const result = parseSeatingRows(rows);
    return { people: result.people.map((person) => ({ ...person, id: `${tableIndex}-${person.id}` })), moderatorId: result.moderatorId ? `${tableIndex}-${result.moderatorId}` : "" };
  });
  if (imported.filter((result) => result.moderatorId).length > 1) throw new Error("多个表格中有多位主持人，请核对后导入");
  return { people: normalizeSeatingPeople(imported.flatMap((result) => result.people)), moderatorId: imported.find((result) => result.moderatorId)?.moderatorId ?? "" };
}
