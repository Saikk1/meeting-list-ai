import { pinyin } from "pinyin-pro";

import type {
  RankingTier,
  RosterRules,
  UnitRankOverride,
} from "./admin-config";

export type RankableRosterRecord = {
  id: string;
  originalIndex: number;
  name: string;
  unit: string;
  title: string;
  source?: string;
  /** A temporary order set by a user while reviewing one roster. */
  manualOrder?: number;
};

export type RankingEvidence = {
  source: "pinyin" | "unit-override" | "keyword" | "fallback";
  label: string;
  detail: string;
  ruleId?: string;
  matchedText?: string;
};

export type TierRankingDecision = {
  tierId: string;
  tierLabel: string;
  priority: number;
  matchedKeyword: string | null;
  evidence: RankingEvidence[];
};

export type UnitRankingDecision = TierRankingDecision & {
  normalizedUnit: string;
  withinTierOrder: number | null;
};

export type RecordRankingDecision = {
  recordId: string;
  position: number;
  mode: RosterRules["ranking"]["mode"];
  unit: UnitRankingDecision;
  title: TierRankingDecision;
};

export type RosterRankingResult<T extends RankableRosterRecord> = {
  records: T[];
  decisions: Record<string, RecordRankingDecision>;
};

type IndexedRecord<T extends RankableRosterRecord> = {
  record: T;
  inputIndex: number;
};

type UnitGroup<T extends RankableRosterRecord> = {
  key: string;
  pinyinKey: string;
  firstSourceIndex: number;
  firstInputIndex: number;
  records: IndexedRecord<T>[];
  decision: UnitRankingDecision;
};

type KeywordCandidate = {
  tier: RankingTier;
  tierIndex: number;
  keyword: string;
  keywordIndex: number;
  normalizedKeyword: string;
};

const NO_MANUAL_ORDER = Number.MAX_SAFE_INTEGER;

export function normalizeRankingText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/\u00a0/g, " ")
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

export function rosterPinyinKey(value: unknown) {
  const cleaned = String(value ?? "")
    .normalize("NFKC")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "zzzzzz";
  return pinyin(cleaned, {
    toneType: "none",
    type: "array",
    nonZh: "consecutive",
  })
    .join("")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function compareText(left: string, right: string) {
  return left.localeCompare(right, "en");
}

function enabledTier(
  tiers: RankingTier[],
  id: string,
): RankingTier | undefined {
  return tiers.find((tier) => tier.enabled && tier.id === id);
}

function fallbackTier(tiers: RankingTier[], fallbackId: string) {
  return (
    enabledTier(tiers, fallbackId) ??
    [...tiers]
      .filter((tier) => tier.enabled)
      .sort(
        (left, right) =>
          right.priority - left.priority || compareText(left.id, right.id),
      )[0] ?? {
      id: fallbackId || "unknown",
      label: "未识别",
      priority: 10_000,
      keywords: [],
      description: "",
      enabled: true,
    }
  );
}

function keywordDecision(
  value: string,
  tiers: RankingTier[],
  fallbackId: string,
  subjectLabel: string,
): TierRankingDecision {
  const normalizedValue = normalizeRankingText(value);
  const candidates: KeywordCandidate[] = [];

  tiers.forEach((tier, tierIndex) => {
    if (!tier.enabled) return;
    tier.keywords.forEach((keyword, keywordIndex) => {
      const normalizedKeyword = normalizeRankingText(keyword);
      if (
        normalizedKeyword &&
        normalizedValue.includes(normalizedKeyword)
      ) {
        candidates.push({
          tier,
          tierIndex,
          keyword,
          keywordIndex,
          normalizedKeyword,
        });
      }
    });
  });

  candidates.sort(
    (left, right) =>
      [...right.normalizedKeyword].length -
        [...left.normalizedKeyword].length ||
      left.tier.priority - right.tier.priority ||
      left.tierIndex - right.tierIndex ||
      left.keywordIndex - right.keywordIndex ||
      compareText(left.tier.id, right.tier.id),
  );

  const matched = candidates[0];
  if (matched) {
    return {
      tierId: matched.tier.id,
      tierLabel: matched.tier.label,
      priority: matched.tier.priority,
      matchedKeyword: matched.keyword,
      evidence: [
        {
          source: "keyword",
          label: `命中${subjectLabel}关键词`,
          detail: `“${value || "（空）"}”命中“${matched.keyword}”，归入“${matched.tier.label}”`,
          ruleId: matched.tier.id,
          matchedText: matched.keyword,
        },
      ],
    };
  }

  const fallback = fallbackTier(tiers, fallbackId);
  return {
    tierId: fallback.id,
    tierLabel: fallback.label,
    priority: fallback.priority,
    matchedKeyword: null,
    evidence: [
      {
        source: "fallback",
        label: `${subjectLabel}未识别`,
        detail: value
          ? `“${value}”未命中已启用的${subjectLabel}关键词，使用“${fallback.label}”`
          : `${subjectLabel}为空，使用“${fallback.label}”`,
        ruleId: fallback.id,
      },
    ],
  };
}

function matchingUnitOverride(
  unit: string,
  overrides: UnitRankOverride[],
) {
  const normalizedUnit = normalizeRankingText(unit);
  return overrides
    .filter(
      (override) =>
        override.enabled &&
        normalizeRankingText(override.unit) === normalizedUnit,
    )
    .sort(
      (left, right) =>
        left.withinTierOrder - right.withinTierOrder ||
        compareText(left.id, right.id),
    )[0];
}

function unitDecision(unit: string, rules: RosterRules): UnitRankingDecision {
  const ranking = rules.ranking;
  const override = matchingUnitOverride(unit, ranking.unitOverrides);
  if (override) {
    const tier = enabledTier(ranking.unitTiers, override.tierId);
    if (tier) {
      return {
        tierId: tier.id,
        tierLabel: tier.label,
        priority: tier.priority,
        normalizedUnit: normalizeRankingText(unit),
        withinTierOrder: override.withinTierOrder,
        matchedKeyword: null,
        evidence: [
          {
            source: "unit-override",
            label: "命中单位覆盖规则",
            detail:
              override.notes ||
              `“${unit || "（空）"}”按管理中心规则归入“${tier.label}”`,
            ruleId: override.id,
            matchedText: override.unit,
          },
        ],
      };
    }
  }

  const decision = keywordDecision(
    unit,
    ranking.unitTiers,
    ranking.unknownUnitTierId,
    "单位",
  );
  return {
    ...decision,
    normalizedUnit: normalizeRankingText(unit),
    withinTierOrder: null,
  };
}

function titleDecision(title: string, rules: RosterRules) {
  const segments = title
    .split(/(?:兼任?|以及|及|[、，,;/；/])/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const candidates = (segments.length ? segments : [title]).map(
    (segment, index) => ({
      index,
      decision: keywordDecision(
        segment,
        rules.ranking.titleTiers,
        rules.ranking.unknownTitleTierId,
        "职务",
      ),
    }),
  );
  return candidates.sort(
    (left, right) =>
      left.decision.priority - right.decision.priority ||
      left.index - right.index,
  )[0].decision;
}

function compareInputOrder<T extends RankableRosterRecord>(
  left: IndexedRecord<T>,
  right: IndexedRecord<T>,
) {
  return (
    left.record.originalIndex - right.record.originalIndex ||
    left.inputIndex - right.inputIndex ||
    compareText(left.record.id, right.record.id)
  );
}

function comparePersonTieBreak<T extends RankableRosterRecord>(
  left: IndexedRecord<T>,
  right: IndexedRecord<T>,
  rules: RosterRules,
) {
  switch (rules.ranking.personTieBreak) {
    case "name": {
      const nameCompare = compareText(
        rosterPinyinKey(left.record.name),
        rosterPinyinKey(right.record.name),
      );
      return nameCompare || compareInputOrder(left, right);
    }
    case "manual-then-source": {
      const leftManual = Number.isFinite(left.record.manualOrder)
        ? Number(left.record.manualOrder)
        : NO_MANUAL_ORDER;
      const rightManual = Number.isFinite(right.record.manualOrder)
        ? Number(right.record.manualOrder)
        : NO_MANUAL_ORDER;
      return leftManual - rightManual || compareInputOrder(left, right);
    }
    case "source":
      return compareInputOrder(left, right);
  }
}

function comparePeople<T extends RankableRosterRecord>(
  left: IndexedRecord<T>,
  right: IndexedRecord<T>,
  rules: RosterRules,
) {
  switch (rules.withinUnitOrder) {
    case "name": {
      const nameCompare = compareText(
        rosterPinyinKey(left.record.name),
        rosterPinyinKey(right.record.name),
      );
      return nameCompare || compareInputOrder(left, right);
    }
    case "source":
      return compareInputOrder(left, right);
    case "title": {
      const leftTitle = titleDecision(left.record.title, rules);
      const rightTitle = titleDecision(right.record.title, rules);
      return (
        leftTitle.priority - rightTitle.priority ||
        comparePersonTieBreak(left, right, rules)
      );
    }
  }
}

function compareAuthorityGroups<T extends RankableRosterRecord>(
  left: UnitGroup<T>,
  right: UnitGroup<T>,
  rules: RosterRules,
) {
  const tierCompare = left.decision.priority - right.decision.priority;
  if (tierCompare) return tierCompare;

  switch (rules.ranking.unitTieBreak) {
    case "manual-then-pinyin": {
      const orderCompare =
        (left.decision.withinTierOrder ?? NO_MANUAL_ORDER) -
        (right.decision.withinTierOrder ?? NO_MANUAL_ORDER);
      if (orderCompare) return orderCompare;
      break;
    }
    case "source": {
      const sourceCompare =
        left.firstSourceIndex - right.firstSourceIndex ||
        left.firstInputIndex - right.firstInputIndex;
      if (sourceCompare) return sourceCompare;
      break;
    }
    case "pinyin":
      break;
  }

  const pinyinDirection = rules.sortDirection === "desc" ? -1 : 1;
  return (
    compareText(left.pinyinKey, right.pinyinKey) * pinyinDirection ||
    compareText(left.key, right.key) ||
    left.firstSourceIndex - right.firstSourceIndex ||
    left.firstInputIndex - right.firstInputIndex
  );
}

function comparePinyinRecords<T extends RankableRosterRecord>(
  left: IndexedRecord<T>,
  right: IndexedRecord<T>,
  rules: RosterRules,
) {
  const pinyinCompare = compareText(
    rosterPinyinKey(left.record.unit),
    rosterPinyinKey(right.record.unit),
  );
  if (pinyinCompare) {
    return rules.sortDirection === "desc" ? -pinyinCompare : pinyinCompare;
  }

  // Keep the legacy V1 comparator exactly for source/name. A V1 config is
  // migrated to one of these two values, so upgrading cannot reorder a list.
  if (rules.withinUnitOrder === "name") {
    const nameCompare = compareText(
      rosterPinyinKey(left.record.name),
      rosterPinyinKey(right.record.name),
    );
    if (nameCompare) return nameCompare;
  } else if (rules.withinUnitOrder === "title") {
    const titleCompare =
      titleDecision(left.record.title, rules).priority -
      titleDecision(right.record.title, rules).priority;
    if (titleCompare) return titleCompare;
    const tieCompare = comparePersonTieBreak(left, right, rules);
    if (tieCompare) return tieCompare;
  }

  return compareInputOrder(left, right);
}

function makeGroups<T extends RankableRosterRecord>(
  records: T[],
  rules: RosterRules,
) {
  const groups = new Map<string, UnitGroup<T>>();
  records.forEach((record, inputIndex) => {
    const key = normalizeRankingText(record.unit);
    const indexed = { record, inputIndex };
    const existing = groups.get(key);
    if (existing) {
      existing.records.push(indexed);
      existing.firstSourceIndex = Math.min(
        existing.firstSourceIndex,
        record.originalIndex,
      );
      existing.firstInputIndex = Math.min(existing.firstInputIndex, inputIndex);
      return;
    }
    groups.set(key, {
      key,
      pinyinKey: rosterPinyinKey(record.unit),
      firstSourceIndex: record.originalIndex,
      firstInputIndex: inputIndex,
      records: [indexed],
      decision: unitDecision(record.unit, rules),
    });
  });
  return [...groups.values()];
}

/**
 * Sorts a roster without mutating either the input array or its records and
 * returns an auditable decision for every output row.
 */
export function rankRosterRecords<T extends RankableRosterRecord>(
  records: readonly T[],
  rules: RosterRules,
): RosterRankingResult<T> {
  const sortedRecords: T[] = [];
  const decisions: Record<string, RecordRankingDecision> = {};

  if (rules.ranking.mode === "pinyin") {
    const indexed = records
      .map((record, inputIndex) => ({ record, inputIndex }))
      .sort((left, right) => comparePinyinRecords(left, right, rules));
    indexed.forEach(({ record }, index) => {
      const inferredUnit = unitDecision(record.unit, rules);
      sortedRecords.push(record);
      decisions[record.id] = {
        recordId: record.id,
        position: index + 1,
        mode: "pinyin",
        unit: {
          ...inferredUnit,
          evidence: [
            {
              source: "pinyin",
              label: "单位拼音排序",
              detail: `按单位完整拼音${
                rules.sortDirection === "desc" ? "降序" : "升序"
              }排列`,
            },
          ],
        },
        title: titleDecision(record.title, rules),
      };
    });
    return { records: sortedRecords, decisions };
  }

  const groups = makeGroups([...records], rules).sort((left, right) =>
    compareAuthorityGroups(left, right, rules),
  );

  for (const group of groups) {
    const members = [...group.records].sort((left, right) =>
      comparePeople(left, right, rules),
    );
    for (const member of members) {
      const position = sortedRecords.length + 1;
      sortedRecords.push(member.record);
      const title = titleDecision(member.record.title, rules);
      decisions[member.record.id] = {
        recordId: member.record.id,
        position,
        mode: rules.ranking.mode,
        unit: group.decision,
        title,
      };
    }
  }

  return { records: sortedRecords, decisions };
}

export function sortRosterRecords<T extends RankableRosterRecord>(
  records: readonly T[],
  rules: RosterRules,
) {
  return rankRosterRecords(records, rules).records;
}
