import type { UnitAliasRule } from "./admin-config";

export type UnitDirectoryEntry = {
  id: string;
  canonical: string;
  aliases: string[];
};

export type UnitDirectoryMatch = UnitDirectoryEntry & {
  matchedText: string;
  score: number;
};

export function normalizeUnitSearchText(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}_]+/gu, "");
}

function uniqueText(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = normalizeUnitSearchText(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildUnitDirectory(rules: UnitAliasRule[]) {
  const entries = new Map<string, UnitDirectoryEntry>();

  rules.forEach((rule) => {
    if (!rule.enabled) return;
    const canonical = rule.canonical.trim();
    const canonicalKey = normalizeUnitSearchText(canonical);
    if (!canonicalKey) return;

    const aliases = uniqueText(
      rule.aliases
        .map((alias) => alias.trim())
        .filter(
          (alias) =>
            alias && normalizeUnitSearchText(alias) !== canonicalKey,
        ),
    );
    const existing = entries.get(canonicalKey);
    if (existing) {
      existing.aliases = uniqueText([...existing.aliases, ...aliases]);
      return;
    }

    entries.set(canonicalKey, {
      id: rule.id,
      canonical,
      aliases,
    });
  });

  return Array.from(entries.values()).sort((left, right) =>
    left.canonical.localeCompare(right.canonical, "zh-CN"),
  );
}

export function resolveCanonicalUnit(
  value: string,
  entries: UnitDirectoryEntry[],
) {
  const query = normalizeUnitSearchText(value);
  if (!query) return null;

  return (
    entries.find((entry) => {
      if (normalizeUnitSearchText(entry.canonical) === query) return true;
      return entry.aliases.some(
        (alias) => normalizeUnitSearchText(alias) === query,
      );
    }) ?? null
  );
}

function subsequenceScore(query: string, target: string) {
  let targetIndex = 0;
  let gapCount = 0;

  for (const character of query) {
    const nextIndex = target.indexOf(character, targetIndex);
    if (nextIndex < 0) return null;
    gapCount += nextIndex - targetIndex;
    targetIndex = nextIndex + character.length;
  }

  return gapCount;
}

function scoreCandidate(query: string, candidate: string, alias: boolean) {
  if (!candidate) return null;
  const aliasOffset = alias ? 4 : 0;
  if (candidate === query) return aliasOffset;
  if (candidate.startsWith(query)) return 10 + aliasOffset;
  if (candidate.includes(query)) return 20 + aliasOffset;
  if (query.includes(candidate)) return 30 + aliasOffset;
  const subsequence = subsequenceScore(query, candidate);
  return subsequence === null ? null : 40 + aliasOffset + subsequence;
}

export function searchUnitDirectory(
  value: string,
  entries: UnitDirectoryEntry[],
  limit = 8,
) {
  const query = normalizeUnitSearchText(value);
  const safeLimit = Math.max(0, limit);
  if (!query) {
    return entries.slice(0, safeLimit).map((entry, index) => ({
      ...entry,
      matchedText: entry.canonical,
      score: index,
    }));
  }

  return entries
    .map((entry): UnitDirectoryMatch | null => {
      const candidates = [entry.canonical, ...entry.aliases]
        .map((text, index) => ({
          text,
          score: scoreCandidate(
            query,
            normalizeUnitSearchText(text),
            index > 0,
          ),
        }))
        .filter(
          (candidate): candidate is { text: string; score: number } =>
            candidate.score !== null,
        )
        .sort((left, right) => left.score - right.score);
      const best = candidates[0];
      if (!best) return null;
      return {
        ...entry,
        matchedText: best.text,
        score: best.score,
      };
    })
    .filter((entry): entry is UnitDirectoryMatch => Boolean(entry))
    .sort(
      (left, right) =>
        left.score - right.score ||
        left.canonical.localeCompare(right.canonical, "zh-CN"),
    )
    .slice(0, safeLimit);
}
