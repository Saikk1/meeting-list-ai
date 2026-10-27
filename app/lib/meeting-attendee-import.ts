import type { UnitAliasRule } from "./admin-config";
import type { activeModelRequestConfig } from "./ai-settings";
import type { MeetingAttendee } from "./meeting-data";
import { parseWithRules, type PersonRecord } from "./roster-parser";
import { buildUnitDirectory, resolveCanonicalUnit } from "./unit-directory";

export async function recognizeMeetingAttendees(
  text: string,
  options: {
    config: ReturnType<typeof activeModelRequestConfig>;
    promptSuffix: string;
    signal?: AbortSignal;
  },
): Promise<{ records: PersonRecord[]; message: string }> {
  if (!text.trim()) throw new Error("请先粘贴人员名单");
  if (text.length > 100_000) {
    throw new Error("本次名单超过 100,000 字，请拆分后识别，系统不会截断人员。");
  }
  let message = "未配置 AI，已使用本地规则。复杂段落建议配置 AI 后识别，或按每人一行粘贴。";
  try {
    let configured = Boolean(options.config.apiKey.trim());
    if (!configured) {
      const status = await fetch("/api/extract", { signal: options.signal });
      if (status.ok) configured = (await status.json()).configured === true;
    }
    if (configured) {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: options.signal,
        body: JSON.stringify({
          text,
          sources: ["会议粘贴名单"],
          promptSuffix: options.promptSuffix,
          config: options.config.apiKey.trim() ? options.config : undefined,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI 识别失败");
      const records: PersonRecord[] = [];
      if (Array.isArray(data.records)) {
        for (const input of data.records) {
          if (!input || typeof input !== "object") continue;
          const cell = (key: string) => typeof input[key] === "string"
            ? input[key].replace(/\s+/g, " ").trim() : "";
          const name = cell("name");
          if (!name) continue;
          const unit = cell("unit");
          records.push({
            id: crypto.randomUUID(), originalIndex: records.length,
            name, unit, department: cell("department"), title: cell("title"),
            source: "会议粘贴名单（AI识别）", confidence: 0.82,
            issues: [
              ...(!unit ? ["单位缺失"] : []),
              ...(Array.isArray(input.issues) ? input.issues.filter(
                (issue: unknown): issue is string => typeof issue === "string",
              ) : []),
            ],
          });
        }
      }
      if (records.length) return { records, message: "AI 识别完成，请核对后添加。" };
      message = "AI 未返回有效人员，已使用本地规则，请核对是否遗漏。";
    }
  } catch (error) {
    if (options.signal?.aborted) throw error;
    message = `AI 暂不可用，已使用本地规则，请核对是否遗漏。${error instanceof Error ? error.message : ""}`;
  }
  return { records: parseWithRules(text), message };
}

// Only exact names and configured unit relationships identify duplicates.
// Keep existing manual fields, and keep the same name at different units.
export function appendRecognizedAttendees(
  existing: MeetingAttendee[],
  incoming: Pick<PersonRecord, "name" | "unit" | "department" | "title" | "source">[],
  aliases: UnitAliasRule[],
) {
  const directory = buildUnitDirectory(aliases);
  const canonical = (unit: string) =>
    resolveCanonicalUnit(unit, directory)?.canonical ?? unit.trim();
  const key = (name: string, unit: string) => JSON.stringify([
    name.normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("zh-CN"),
    canonical(unit).normalize("NFKC").replace(/\s+/g, "").toLocaleLowerCase("zh-CN"),
  ]);
  const seen = new Set(existing.filter((item) => item.name.trim()).map(
    (item) => key(item.name, item.unit),
  ));
  const additions: MeetingAttendee[] = [];
  let skipped = 0;
  for (const item of incoming) {
    if (!item.name.trim()) continue;
    const identity = key(item.name, item.unit);
    if (seen.has(identity)) { skipped++; continue; }
    seen.add(identity);
    additions.push({
      id: crypto.randomUUID(), name: item.name.trim(), unit: canonical(item.unit),
      department: item.department, title: item.title, source: item.source,
    });
  }
  return { attendees: [...existing, ...additions], added: additions.length, skipped };
}
