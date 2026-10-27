export type PersonRecord = {
  id: string;
  originalIndex: number;
  name: string;
  unit: string;
  department: string;
  title: string;
  source: string;
  confidence: number;
  issues: string[];
};

const TITLE_KEYWORDS =
  /总裁|总经理|副总|董事长|主任|副主任|经理|负责人|研究员|工程师|专员|处长|局长|书记|主席|教授|顾问|总监|部长|科长|院长|所长|秘书长/;
const UNIT_KEYWORDS =
  /公司|集团|局|中心|委员会|研究院|大学|学院|协会|办公室|银行|政府|港|园区|实验室|事务所|研究所|部门|街道|管委会/;

function makeId(prefix = "row") {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function cleanCell(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanName(value: unknown) {
  return cleanCell(value).replace(/\s+/g, "");
}

function isLikelyName(value: string) {
  const name = cleanName(value);
  return /^[\u3400-\u9fff·]{2,6}$/.test(name) && !TITLE_KEYWORDS.test(name);
}

function splitLine(line: string) {
  const normalized = line.replace(/[｜|]/g, "\t").trim();
  if (!normalized) return [];
  if (normalized.includes("\t")) {
    return normalized.split("\t").map(cleanCell);
  }
  if (/[，,；;]/.test(normalized)) {
    return normalized.split(/[，,；;]/).map(cleanCell);
  }
  return normalized.split(/\s+/).map(cleanCell).filter(Boolean);
}

function isHeaderLine(cells: string[]) {
  const text = cells.join("|");
  return /姓名|名字/.test(text) && /单位|公司|机构/.test(text);
}

function headerIndex(cells: string[], patterns: RegExp[]) {
  return cells.findIndex((cell) => patterns.some((pattern) => pattern.test(cell)));
}

function inferRecord(cells: string[], source: string, index: number) {
  const values = [...cells];
  if (/^\d+[.、）)]?$/.test(values[0] ?? "")) values.shift();
  if (!values.length) return null;

  const nameIndex = values.findIndex(isLikelyName);
  if (nameIndex < 0) return null;

  const name = cleanName(values[nameIndex]);
  const remaining = values.filter((_, itemIndex) => itemIndex !== nameIndex);
  const titleIndex = remaining.findIndex((value) => TITLE_KEYWORDS.test(value));
  const title = titleIndex >= 0 ? remaining[titleIndex] : "";
  const plateIndex = remaining.findIndex((value) => /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼港澳][A-Z][A-Z0-9]{5,6}$/i.test(value.replace(/[·\s]/g, "")));
  const unitCandidates = remaining.filter(
    (value, itemIndex) =>
      itemIndex !== titleIndex &&
      itemIndex !== plateIndex &&
      !/^\d{6,}$/.test(value) &&
      !/^1\d{10}$/.test(value),
  );
  const unit =
    unitCandidates.find((value) => UNIT_KEYWORDS.test(value)) ??
    unitCandidates.sort((a, b) => b.length - a.length)[0] ??
    "";

  const issues: string[] = [];
  if (!unit) issues.push("单位缺失");

  return {
    id: makeId(),
    originalIndex: index,
    name,
    unit: cleanCell(unit),
    department: "",
    title: cleanCell(title),
    source,
    confidence: unit ? 0.88 : 0.62,
    issues,
  } satisfies PersonRecord;
}

export function parseWithRules(rawText: string) {
  const records: PersonRecord[] = [];
  let currentSource = "粘贴文本";
  let headers: string[] | null = null;
  let order = 0;

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim().replace(/^(?:参会人员|参会名单|人员名单|姓名)[：:]\s*/, "");
    if (!line || /^(?:姓名|参会人员|参会名单|人员名单)[：:]?$/.test(line)) continue;

    const sourceMatch = line.match(/^【来源：(.+)】$/);
    if (sourceMatch) {
      currentSource = sourceMatch[1];
      headers = null;
      continue;
    }
    if (/^【工作表：.+】$/.test(line)) continue;

    const cells = splitLine(line);
    if (!cells.length) continue;
    if (isHeaderLine(cells)) {
      headers = cells;
      continue;
    }
    if (/^序号$/.test(cells[0]) || cells.every((cell) => /^[-—_\s]*$/.test(cell))) {
      continue;
    }

    // A list of names is several people, not a name followed by an inferred unit.
    const names = line.replace(/[。.]$/, "").split(/[、，,；;\s]+/).filter(Boolean);
    if (!headers && !/[\t｜|]/.test(line) && names.length && names.every((name) =>
      isLikelyName(name) && !UNIT_KEYWORDS.test(name),
    )) {
      for (const name of names) {
        records.push({
          id: makeId(), originalIndex: order++, name: cleanName(name),
          unit: "", department: "", title: "", source: currentSource,
          confidence: 0.62, issues: ["单位缺失"],
        });
      }
      continue;
    }

    let record: PersonRecord | null = null;
    if (headers) {
      const nameAt = headerIndex(headers, [/姓名/, /名字/]);
      const unitAt = headerIndex(headers, [/工作单位/, /单位/, /公司/, /机构/]);
      const departmentAt = headerIndex(headers, [/部门/, /处室/, /科室/]);
      const titleAt = headerIndex(headers, [/职务/, /职位/, /岗位/]);
      const name = cleanName(cells[nameAt] ?? "");
      if (name && isLikelyName(name)) {
        const unit = cleanCell(cells[unitAt] ?? "");
        const issues = unit ? [] : ["单位缺失"];
        record = {
          id: makeId(),
          originalIndex: order,
          name,
          unit,
          department: cleanCell(cells[departmentAt] ?? ""),
          title: cleanCell(cells[titleAt] ?? ""),
          source: currentSource,
          confidence: unit ? 0.96 : 0.7,
          issues,
        };
      }
    }
    record ??= inferRecord(cells, currentSource, order);
    if (record) {
      records.push(record);
      order += 1;
    }
  }

  const seen = new Map<string, number>();
  return records.map((record) => {
    const key = `${record.name}|${record.unit}`;
    const count = seen.get(key) ?? 0;
    seen.set(key, count + 1);
    if (count > 0) {
      return {
        ...record,
        confidence: Math.min(record.confidence, 0.68),
        issues: [...record.issues, "疑似重复人员"],
      };
    }
    return record;
  });
}
