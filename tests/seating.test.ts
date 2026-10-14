import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import { DEFAULT_ADMIN_CONFIG } from "../app/lib/admin-config";
import { buildSeatingXlsx, defaultSeatingOptions, effectiveSeatingParty, generateSeatingPlan, parseSeatingTables, parseSeatingText, regenerateSeatingPlan, seatingWeight, swapSeatingPeople, toggleSeatingLock, type SeatingPerson, type SeatingOptions } from "../app/lib/seating";
import { seatingLayout, seatingFitScale } from "../app/lib/seating-layout";
import { applyMeetingRoomTableType } from "../app/lib/meeting-room-layout";
import { validateSeatingPlan } from "../scripts/seating-schema.mjs";
import { executeConfirmedPlan, resolveAssistantNavigationPath } from "../app/lib/assistant-actions";
import { assistantPlanRequiresConfirmation, parseAssistantPlan } from "../app/lib/assistant-contract";
import { createMeeting } from "../app/lib/meeting-data";

const rules = DEFAULT_ADMIN_CONFIG.rosterRules;
test("room table types select general seating templates without inventing counts or changing other rules", () => {
  const original = { ...defaultSeatingOptions("示例单位"), template: "table-five" as const, door: "top" as const };
  for (const [tableType, template] of [["rectangular", "table"], ["round", "round"], ["podium", "podium-auto"]] as const) {
    const result = applyMeetingRoomTableType(original, { tableType });
    assert.deepEqual(result, { ...original, template });
    assert.equal(original.template, "table-five");
  }
  assert.deepEqual(applyMeetingRoomTableType(original, {}), original);
  assert.deepEqual(applyMeetingRoomTableType(original, undefined), original);
  assert.deepEqual(applyMeetingRoomTableType(original, { tableType: "unconfigured" }), original);
});
function people(count: number): SeatingPerson[] {
  return Array.from({ length: count }, (_, index) => ({ id: `person-${index}`, name: `人员${index + 1}`, unit: index % 2 ? "客方单位" : "本公司", title: "", grade: "", weight: 1000 - index * 100, party: index % 2 ? "guest" : "host" }));
}
function options(patch: Partial<SeatingOptions> = {}): SeatingOptions {
  return { ...defaultSeatingOptions("本公司"), template: "podium-single", anchorMode: "rank-first", rowCapacity: 30, ...patch };
}
function numbers(count: number, patch: Partial<SeatingOptions> = {}) {
  return generateSeatingPlan(people(count), options(patch), rules).seats.map((seat) => seat.seatNumber);
}

test("podium single center preserves explicit seated-left / diagram-right convention", () => {
  assert.deepEqual(numbers(3), ["3", "1", "2"]);
  assert.deepEqual(numbers(5), ["5", "3", "1", "2", "4"]);
  assert.deepEqual(numbers(4), ["", "3", "1", "2", "4"]);
});
test("dual and wide layouts place central seats and intentional gaps correctly", () => {
  assert.deepEqual(numbers(4, { template: "podium-double", rowCapacity: 4 }), ["3", "1", "2", "4"]);
  assert.deepEqual(numbers(3, { template: "podium-wide" }), ["3", "", "1", "", "2"]);
  assert.throws(() => numbers(3, { template: "podium-double", rowCapacity: 4 }), /偶数/);
  assert.throws(() => numbers(4, { template: "podium-double", rowCapacity: 3 }), /偶数/);
});
test("automatic dual center depends on known close levels and even numbers", () => {
  assert.equal(numbers(4, { template: "podium-auto", closeThreshold: 100 }).length, 4);
  assert.equal(numbers(4, { template: "podium-auto", closeThreshold: 50 }).length, 5);
  const unknown = people(4).map((person) => ({ ...person, weight: null }));
  assert.equal(generateSeatingPlan(unknown, options({ template: "podium-auto" }), rules).seats.length, 5);
});
test("multirow layouts never lose or duplicate people, front row precedes back", () => {
  for (let count = 1; count <= 200; count++) {
    const plan = generateSeatingPlan(people(count).map((person) => ({ ...person, weight: 200 - Number(person.id.split("-")[1]) })), options({ rowCapacity: 9 }), rules);
    const occupied = plan.seats.filter((seat) => seat.personId !== null);
    assert.equal(new Set(occupied.map((seat) => seat.personId)).size, count);
    assert.equal(occupied.length, count);
    assert.equal(plan.seats.find((seat) => seat.seatNumber === "1")?.row, 1);
    validateSeatingPlan(plan);
  }
});
test("host-first reserves main host and adjacent main guest, moderator is last host", () => {
  const list = people(5);
  list[0].weight = 800;
  list[1].weight = 900;
  const plan = generateSeatingPlan(list, options({ anchorMode: "host-first", moderatorId: list[2].id }), rules);
  assert.equal(plan.seats.find((seat) => seat.seatNumber === "1")?.personId, list[0].id);
  assert.deepEqual(plan.seats.find((seat) => seat.seatNumber === "2")?.labels, ["主宾"]);
  assert.ok(Number(plan.seats.find((seat) => seat.personId === list[2].id)?.seatNumber) > Number(plan.seats.find((seat) => seat.personId === list[4].id)?.seatNumber));
  assert.match(plan.warnings.join(" "), /冲突/);
  const hostHigher = people(3);
  hostHigher[1].weight = 1;
  assert.match(generateSeatingPlan(hostHigher, options({ anchorMode: "host-first" }), rules).warnings.join(" "), /主宾优先.*冲突/);
  assert.throws(() => generateSeatingPlan(list, options({ moderatorId: list[1].id }), rules), /主方/);
});
test("table 5 versus 5 arranges guest facing far door and mirrors host orientation", () => {
  const plan = generateSeatingPlan(people(10), options({ template: "table-five", anchorMode: "host-first" }), rules);
  const host = plan.seats.filter((seat) => seat.row === 2);
  const guest = plan.seats.filter((seat) => seat.row === 1);
  assert.ok(host.every((seat) => seat.party === "host"));
  assert.ok(guest.every((seat) => seat.party === "guest"));
  assert.equal(host.find((seat) => seat.labels.includes("主位"))?.position, 2);
  assert.equal(guest.find((seat) => seat.labels.includes("主宾"))?.position, 2);
  assert.equal(host.find((seat) => seat.personId === "person-2")?.position, 1);
  assert.equal(guest.find((seat) => seat.personId === "person-3")?.position, 3);
  assert.match(guest[0].group, /面门、远门/);
  const flipped = generateSeatingPlan(people(10), options({ template: "table-five", door: "top" }), rules);
  assert.equal(flipped.seats.find((seat) => seat.labels.includes("主宾"))?.row, 2);
  assert.throws(() => generateSeatingPlan(people(9), options({ template: "table-five" }), rules), /各 5 人/);
  assert.throws(() => generateSeatingPlan(people(10), options({ template: "table", tableCenter: "double" }), rules), /偶数/);
});
test("round layout alternates from the far-door anchor, with adjacent main guest", () => {
  const plan = generateSeatingPlan(people(5), options({ template: "round", anchorMode: "host-first" }), rules);
  assert.deepEqual(plan.seats.map((seat) => seat.position), [0, 1, 4, 2, 3]);
  assert.deepEqual(plan.seats[0].labels, ["主位"]);
  assert.deepEqual(plan.seats[1].labels, ["主宾"]);
  assert.throws(() => generateSeatingPlan(people(31).map((person) => ({ ...person, weight: 1 })), options({ template: "round" }), rules), /最多 30/);
});
test("party inference uses canonical exact unit match, explicit party takes precedence", () => {
  const aliases = { ...rules, aliases: [{ id: "alias-test", canonical: "本公司", aliases: ["本司"], mode: "auto" as const, enabled: true, notes: "" }] };
  assert.equal(effectiveSeatingParty({ ...people(1)[0], unit: "本司", party: "auto" }, options(), aliases), "host");
  assert.equal(effectiveSeatingParty({ ...people(1)[0], unit: "本公司子公司", party: "auto" }, options(), aliases), "guest");
  assert.equal(effectiveSeatingParty({ ...people(1)[0], party: "guest" }, options(), aliases), "guest");
  assert.throws(() => generateSeatingPlan([{ ...people(1)[0], party: "auto" }], options({ hostCompany: "" }), rules), /本公司/);
});
test("weights are reviewable defaults, unknown grades cannot be silently inferred", () => {
  assert.equal(seatingWeight({ ...people(1)[0], grade: "正厅级", weight: null }, rules).value, 800);
  assert.equal(seatingWeight({ ...people(1)[0], grade: "正厅级", weight: 123 }, rules).value, 123);
  assert.equal(seatingWeight({ ...people(1)[0], grade: "不明级别", title: "董事长", weight: null }, rules).known, false);
  const plan = generateSeatingPlan([{ ...people(1)[0], grade: "不明级别", weight: null }], options(), rules);
  assert.match(plan.warnings.join(" "), /需人工确认/);
});
test("Markdown and reordered headers preserve fields, party and moderator", () => {
  const parsed = parseSeatingText("| 单位 | 姓名 | 职务 | 职级 | 所属方 | 权重 | 角色 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 本公司 | 张伟 | 董事长 | 正厅 | 主方 | 900 | 主持人 |\n| 单位 | 姓名 | 职务 | 职级 | 所属方 | 权重 | 角色 |\n| 客单位 | 李四 | 总经理 | 副厅 | 客方 | | |");
  assert.equal(parsed.people.length, 2);
  assert.equal(parsed.people[0].name, "张伟");
  assert.equal(parsed.people[0].weight, 900);
  assert.equal(parsed.people[1].weight, null);
  assert.equal(parsed.moderatorId, parsed.people[0].id);
  assert.throws(() => parseSeatingText("姓名\t单位\t所属方\n张伟\t本公司\t未知方"), /无法识别/);
  assert.throws(() => parseSeatingText("姓名\t单位\t权重\n张伟\t本公司\tabc"), /权重/);
  assert.throws(() => parseSeatingText("姓名\t单位\n张伟\t本公司\n张伟\t本公司"), /重复/);
  assert.throws(() => parseSeatingText("姓名\t单位\n\t本公司"), /姓名/);
});
test("manual swaps are bijective, retain physical seat numbers and flag review", () => {
  const plan = generateSeatingPlan(people(3), options(), rules);
  const original = JSON.stringify(plan);
  const seat = plan.seats.find((item) => item.seatNumber === "1")!;
  const swapped = swapSeatingPeople(plan, seat.id, "person-1");
  assert.equal(JSON.stringify(plan), original);
  assert.equal(swapped.seats.find((item) => item.id === seat.id)?.seatNumber, "1");
  assert.deepEqual(swapped.seats.find((item) => item.id === seat.id)?.labels, ["主宾"]);
  assert.equal(swapped.manualAdjusted, true);
  assert.match(swapped.warnings.join(" "), /人工交换/);
  validateSeatingPlan(swapped);
  assert.throws(() => validateSeatingPlan({ ...plan, seats: plan.seats.slice(1) }), /尚未分配/);
  assert.throws(() => validateSeatingPlan({ ...plan, seats: plan.seats.map((item) => ({ ...item, personId: "unknown" })) }), /不在名单/);
});
test("multi-table import maps each header independently and ignores unrelated tables", () => {
  const imported = parseSeatingTables([
    [["说明", "人数"], ["普通表格", 5]],
    [["姓名", "单位", "所属方"], ["张伟", "本公司", "主方"]],
    [["单位", "所属方", "姓名"], ["客单位", "客方", "李四"]],
  ]);
  assert.deepEqual(imported.people.map((person) => [person.name, person.unit, person.party]), [["张伟", "本公司", "host"], ["李四", "客单位", "guest"]]);
  assert.equal(new Set(imported.people.map((person) => person.id)).size, 2);
  assert.throws(() => parseSeatingTables([]), /1–200/);
});

test("old plans remain valid; lock validation rejects empty, unknown and duplicate seats", () => {
  const plan = generateSeatingPlan(people(4), options(), rules);
  validateSeatingPlan(plan);
  assert.throws(() => toggleSeatingLock(plan, "seat-1-0"), /已安排/);
  assert.throws(() => validateSeatingPlan({ ...plan, lockedSeatIds: ["missing"] }), /锁定/);
  const id = plan.seats.find((seat) => seat.personId)!.id;
  assert.throws(() => validateSeatingPlan({ ...plan, lockedSeatIds: [id, id] }), /锁定/);
  const locked = toggleSeatingLock(plan, id);
  assert.deepEqual(locked.lockedSeatIds, [id]);
  assert.equal(plan.lockedSeatIds, undefined);
  assert.deepEqual(toggleSeatingLock(locked, id).lockedSeatIds, []);
});

test("locks block swaps in both directions and survive regeneration without duplicate people", () => {
  const list = people(5);
  let plan = generateSeatingPlan(list, options(), rules);
  const target = plan.seats.find((seat) => seat.personId === list[0].id)!;
  plan = { ...toggleSeatingLock(plan, target.id), roomId: "room-example" };
  assert.throws(() => swapSeatingPeople(plan, target.id, list[1].id), /锁定/);
  assert.throws(() => swapSeatingPeople(plan, plan.seats.find((seat) => seat.personId === list[1].id)!.id, list[0].id), /锁定/);
  const changed = list.map((person, index) => ({ ...person, weight: index * 100 }));
  const regenerated = regenerateSeatingPlan(changed, options(), rules, plan);
  assert.equal(regenerated.seats.find((seat) => seat.id === target.id)?.personId, list[0].id);
  assert.equal(regenerated.roomId, "room-example");
  assert.deepEqual(regenerated.lockedSeatIds, [target.id]);
  assert.equal(new Set(regenerated.seats.map((seat) => seat.personId)).size, 5);
  validateSeatingPlan(regenerated);
  assert.throws(() => regenerateSeatingPlan(changed, options({ door: "top" }), rules, plan), /先解除锁定/);
  assert.throws(() => regenerateSeatingPlan(changed.slice(1), options(), rules, plan), /先解锁/);
  assert.throws(() => regenerateSeatingPlan(changed, options({ template: "podium-wide" }), rules, plan), /先解除锁定/);
});

test("regeneration retains several locks and rejects changing centered geometry", () => {
  const plan = generateSeatingPlan(people(4), options({ template: "podium-auto", closeThreshold: 100 }), rules);
  const locked = toggleSeatingLock(toggleSeatingLock(plan, plan.seats[0].id), plan.seats[1].id);
  const next = regenerateSeatingPlan(people(4), locked.options, rules, locked);
  for (const id of locked.lockedSeatIds!) assert.equal(next.seats.find((seat) => seat.id === id)?.personId, locked.seats.find((seat) => seat.id === id)?.personId);
  assert.throws(() => regenerateSeatingPlan(people(4), { ...locked.options, closeThreshold: 0 }, rules, locked), /先解锁/);
});

test("canvas geometry preserves centered seats, table facing, front rows and round bounds", () => {
  const plan = generateSeatingPlan(people(5), options({ rowCapacity: 3 }), rules);
  const layout = seatingLayout(plan);
  const front = plan.seats.find((seat) => seat.seatNumber === "1")!;
  const back = plan.seats.find((seat) => seat.row === 2 && seat.personId)!;
  assert.equal(layout.points.find((point) => point.id === front.id)?.x, layout.width / 2);
  assert.ok(layout.points.find((point) => point.id === front.id)!.y > layout.points.find((point) => point.id === back.id)!.y);
  for (const template of ["table-five", "round"] as const) {
    const plan = generateSeatingPlan(people(10), options({ template }), rules);
    const layout = seatingLayout(plan);
    assert.equal(layout.points.length, plan.seats.length);
    assert.ok(layout.table);
    assert.ok(layout.points.every((point) => point.x > 0 && point.x < layout.width && point.y > 0 && point.y < layout.height));
    if (template === "table-five") {
      assert.equal(layout.points.find((point) => point.id === plan.seats.find((seat) => seat.row === 1)!.id)?.facing, "down");
      assert.equal(layout.points.find((point) => point.id === plan.seats.find((seat) => seat.row === 2)!.id)?.facing, "up");
    }
  }
  assert.ok(seatingFitScale(420, 400, layout) < 1);
});
test("Excel output groups physical rows and keeps empty seats, titles and evidence", async () => {
  const plan = generateSeatingPlan(people(3), options({ template: "podium-wide" }), rules);
  const workbook = XLSX.read(await buildSeatingXlsx(plan), { type: "array" });
  assert.deepEqual(workbook.SheetNames, ["座次表", "依据与提醒"]);
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets["座次表"], { header: 1, defval: "" });
  assert.deepEqual(rows[0], ["排/方", "座位号", "姓名", "单位", "职务", "职级", "所属方", "席位标签"]);
  assert.equal(rows.filter((row) => row[2] === "（留空席）").length, 2);
  assert.equal(rows.find((row) => row[2] === "人员1")?.[4], "");
  assert.equal(rows.find((row) => row[2] === "人员1")?.[7], "主位");
});
test("assistant generates reviewed independent seating, rejects stale rules and navigates", async () => {
  const meeting = createMeeting({ ...DEFAULT_ADMIN_CONFIG.organization, title: "座次测试", date: "2030-10-01", startTime: "09:00", location: "第一会议室", organizer: "本公司", owner: "会务组", attendeeEstimate: 3, afternoonMeeting: false, mealType: "none", alcoholRequired: false, parkingRequired: false, vehicleCount: 0, publicityRequired: false, reimbursementRequired: false, presentationRequired: false, welcomeScreenRequired: false, roomSize: "small", rosterRequired: false });
  const action = { type: "meeting.seating.generate", meetingId: meeting.id, expectedUpdatedAt: meeting.updatedAt, expectedConfigRevision: 7, options: options(), participants: people(3) };
  const plan = parseAssistantPlan({ schemaVersion: 1, summary: "生成座次", clarification: null, warnings: [], actions: [action] });
  assert.equal(assistantPlanRequiresConfirmation(plan), true);
  let writes = 0;
  await assert.rejects(() => executeConfirmedPlan(plan, { loadMeetings: () => [meeting], loadAdminConfig: () => ({ revision: 8, config: DEFAULT_ADMIN_CONFIG }), saveMeeting: (record) => { writes++; return record; } }), /配置已变化/);
  assert.equal(writes, 0);
  await executeConfirmedPlan(plan, { loadMeetings: () => [meeting], loadAdminConfig: () => ({ revision: 7, config: DEFAULT_ADMIN_CONFIG }), saveMeeting: (record) => {
    writes++; assert.equal(record.rosterRequired, false); assert.deepEqual(record.attendees, meeting.attendees); assert.equal(record.seatingPlan?.participants.length, 3); return record;
  } });
  assert.equal(writes, 1);
  assert.equal(resolveAssistantNavigationPath({ type: "navigate", destination: "meeting_seating", meetingId: meeting.id }), `/meetings/${meeting.id}?tab=seating`);
  assert.throws(() => parseAssistantPlan({ ...plan, actions: [action, { ...action }] }), /座次/);
});
