import assert from "node:assert/strict";
import test from "node:test";

import {
  cloneAdminConfig,
  type RosterRules,
} from "../app/lib/admin-config";
import {
  normalizeRankingText,
  rankRosterRecords,
  sortRosterRecords,
  type RankableRosterRecord,
} from "../app/lib/roster-ranking";

function rules(): RosterRules {
  return cloneAdminConfig().rosterRules;
}

function person(
  id: string,
  unit: string,
  title: string,
  originalIndex: number,
  extra: Partial<RankableRosterRecord> = {},
): RankableRosterRecord {
  return {
    id,
    name: id,
    unit,
    title,
    originalIndex,
    ...extra,
  };
}

test("authority mode ranks unit tier before pinyin and title within a unit", () => {
  const input = [
    person("经理", "阿里示例有限公司", "经理", 0),
    person("科员", "浙江省人民政府", "科员", 1),
    person("董事长", "阿里示例有限公司", "董事长", 2),
  ];

  const result = rankRosterRecords(input, rules());

  assert.deepEqual(
    result.records.map((record) => record.id),
    ["科员", "董事长", "经理"],
  );
  assert.equal(
    result.decisions["科员"].unit.tierId,
    "unit-provincial-government",
  );
  assert.equal(
    result.decisions["董事长"].title.tierId,
    "title-principal",
  );
  assert.equal(result.decisions["经理"].title.tierId, "title-middle");
});

test("longest keyword wins before tier priority", () => {
  const input = [
    person("副职", "未来研究院有限公司", "副董事长", 0),
  ];

  const result = rankRosterRecords(input, rules());
  const decision = result.decisions["副职"];

  assert.equal(decision.unit.tierId, "unit-enterprise");
  assert.equal(decision.unit.matchedKeyword, "有限公司");
  assert.equal(decision.title.tierId, "title-deputy");
  assert.equal(decision.title.matchedKeyword, "副董事长");
});

test("a composite title uses the highest-ranked confirmed role", () => {
  const input = [
    person("复合职务", "示例有限公司", "副董事长兼总经理", 0),
  ];

  const result = rankRosterRecords(input, rules());

  assert.equal(
    result.decisions["复合职务"].title.tierId,
    "title-principal",
  );
  assert.equal(
    result.decisions["复合职务"].title.matchedKeyword,
    "总经理",
  );
});

test("an enabled exact unit override takes precedence over keyword inference", () => {
  const current = rules();
  current.ranking.unitOverrides.push({
    id: "special-company",
    unit: "宁波特别有限公司",
    tierId: "unit-central-government",
    withinTierOrder: 1,
    enabled: true,
    notes: "本次会务口径列为第一层级",
  });
  const input = [
    person("普通机关", "浙江省人民政府", "主任", 0),
    person("特别单位", "宁波特别有限公司", "经理", 1),
  ];

  const result = rankRosterRecords(input, current);

  assert.deepEqual(
    result.records.map((record) => record.id),
    ["特别单位", "普通机关"],
  );
  assert.equal(
    result.decisions["特别单位"].unit.evidence[0].source,
    "unit-override",
  );
  assert.equal(
    result.decisions["特别单位"].unit.evidence[0].ruleId,
    "special-company",
  );
});

test("manual unit order is deterministic inside the same tier", () => {
  const current = rules();
  current.ranking.unitOverrides.push(
    {
      id: "z-first",
      unit: "浙江乙公司",
      tierId: "unit-enterprise",
      withinTierOrder: 10,
      enabled: true,
      notes: "",
    },
    {
      id: "a-second",
      unit: "安徽甲公司",
      tierId: "unit-enterprise",
      withinTierOrder: 20,
      enabled: true,
      notes: "",
    },
  );

  const sorted = sortRosterRecords(
    [
      person("安徽", "安徽甲公司", "经理", 0),
      person("浙江", "浙江乙公司", "经理", 1),
    ],
    current,
  );

  assert.deepEqual(
    sorted.map((record) => record.id),
    ["浙江", "安徽"],
  );
});

test("unknown unit and title use configured fallbacks with evidence", () => {
  const result = rankRosterRecords(
    [person("未知", "临时筹备组", "", 0)],
    rules(),
  );
  const decision = result.decisions["未知"];

  assert.equal(decision.unit.tierId, "unit-other");
  assert.equal(decision.unit.evidence[0].source, "fallback");
  assert.equal(decision.title.tierId, "title-other");
  assert.equal(decision.title.evidence[0].source, "fallback");
});

test("pinyin mode preserves legacy unit direction and source order", () => {
  const current = rules();
  current.ranking.mode = "pinyin";
  current.withinUnitOrder = "source";
  const input = [
    person("上海后", "上海单位", "", 8),
    person("宁波", "宁波单位", "", 3),
    person("上海前", "上海单位", "", 2),
  ];

  assert.deepEqual(
    sortRosterRecords(input, current).map((record) => record.id),
    ["宁波", "上海前", "上海后"],
  );

  current.sortDirection = "desc";
  assert.deepEqual(
    sortRosterRecords(input, current).map((record) => record.id),
    ["上海前", "上海后", "宁波"],
  );
  const result = rankRosterRecords(input, current);
  assert.equal(result.decisions["上海前"].unit.evidence[0].source, "pinyin");
});

test("pinyin compatibility does not regroup different units with the same pinyin", () => {
  const current = rules();
  current.ranking.mode = "pinyin";
  current.withinUnitOrder = "source";
  const input = [
    person("重庆一", "重庆", "", 0),
    person("崇庆", "崇庆", "", 1),
    person("重庆二", "重庆", "", 2),
  ];

  assert.deepEqual(
    sortRosterRecords(input, current).map((record) => record.id),
    ["重庆一", "崇庆", "重庆二"],
  );
});

test("title ties honor temporary manual person order", () => {
  const current = rules();
  current.ranking.personTieBreak = "manual-then-source";
  const input = [
    person("先导入", "同一公司", "经理", 0, { manualOrder: 20 }),
    person("后导入", "同一公司", "经理", 1, { manualOrder: 10 }),
  ];

  assert.deepEqual(
    sortRosterRecords(input, current).map((record) => record.id),
    ["后导入", "先导入"],
  );
});

test("sorting is stable, records decisions, and does not mutate input", () => {
  const current = rules();
  current.ranking.mode = "pinyin";
  current.withinUnitOrder = "source";
  const input = [
    person("row-b", "同一单位", "", 0),
    person("row-a", "同一单位", "", 0),
  ];
  const snapshot = structuredClone(input);

  const first = rankRosterRecords(input, current);
  const second = rankRosterRecords(input, current);

  assert.deepEqual(input, snapshot);
  assert.deepEqual(first.records, second.records);
  assert.deepEqual(
    first.records.map((record) => record.id),
    ["row-b", "row-a"],
  );
  assert.equal(first.decisions["row-b"].position, 1);
  assert.equal(first.decisions["row-a"].position, 2);
});

test("normalization makes exact overrides insensitive to spacing and punctuation", () => {
  const current = rules();
  current.ranking.unitOverrides.push({
    id: "normalized-unit",
    unit: "宁波（低空）研究院",
    tierId: "unit-state-enterprise",
    withinTierOrder: 1,
    enabled: true,
    notes: "",
  });

  const result = rankRosterRecords(
    [person("规范化", "宁波 低空 研究院", "研究员", 0)],
    current,
  );

  assert.equal(
    normalizeRankingText("宁波（低空）研究院"),
    normalizeRankingText("宁波 低空 研究院"),
  );
  assert.equal(
    result.decisions["规范化"].unit.evidence[0].source,
    "unit-override",
  );
});
