"use client";

import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  ClipboardPaste,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  FileScan,
  FileText,
  Globe2,
  Info,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  PlugZap,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  UploadCloud,
  UserRound,
  WandSparkles,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AssistantShell } from "../components/assistant-shell";
import { ContactAutocomplete } from "../components/contact-autocomplete";
import type {
  RosterOutputFieldKey,
  RosterRules,
  UnitAliasRule,
} from "../lib/admin-config";
import {
  AI_PROVIDER_PRESETS,
  CUSTOM_MODEL_OPTION_VALUE,
  isCatalogModel,
  loadAISettings,
  saveAISettings,
  type AIModelOption,
} from "../lib/ai-settings";
import {
  syncMeetingContacts,
  type ContactRecord,
} from "../lib/contacts";
import {
  formatRosterExportFileName,
  freezeFirstRowInXlsx,
} from "../lib/roster-export";
import { rankRosterRecords } from "../lib/roster-ranking";
import {
  MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS,
  publishRosterWorkspaceSnapshot,
  registerRosterWorkspaceBridge,
  RosterWorkspaceBridgeError,
  type RosterWorkspaceBridgeHandler,
  type RosterWorkspaceCommand,
  type RosterWorkspaceExecutionResult,
  type RosterWorkspaceRecordInput,
  type RosterWorkspaceRecordPatch,
  type RosterWorkspaceSnapshot,
} from "../lib/roster-workspace-bridge";
import { useAdminConfig } from "../lib/use-admin-config";
import {
  useWorkspaceLocation,
  useWorkspaceTabStatus,
} from "../components/workspace-tabs";
import { readBusinessDocument } from "../lib/business-document-reader";
import {
  EMPTY_MEETING_STORE,
  getMeetingById,
  flushMeetingPersistence,
  loadMeetingStoreSnapshot,
  replaceMeetingAttendees,
  saveMeeting,
  subscribeMeetings,
  type MeetingRecord,
} from "../lib/meeting-data";

type Step = 1 | 2 | 3 | 4;

type SourceFile = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  content: string;
  kind: "excel" | "word" | "text" | "pdf" | "image";
};

type PersonRecord = {
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

type AliasSuggestion = {
  id: string;
  canonical: string;
  aliases: string[];
  reason: string;
  applied?: boolean;
};

type SearchEvidence = {
  id: string;
  query: string;
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string | null;
};

type UnitRankingSuggestion = {
  unit: string;
  tierId: string;
  withinTierOrder: number;
  confidence: number;
  reason: string;
  evidenceIds: string[];
  needsReview: boolean;
};

type PersonEnrichmentSuggestion = {
  recordId: string;
  status: "verified" | "ambiguous" | "not-found";
  suggestedUnit: string;
  suggestedDepartment: string;
  suggestedTitle: string;
  titleTierId: string;
  confidence: number;
  reason: string;
  evidenceIds: string[];
  needsReview: boolean;
};

type RankingAnalysis = {
  units: UnitRankingSuggestion[];
  people: PersonEnrichmentSuggestion[];
  evidence: SearchEvidence[];
};

type AcceptedUnitRanking = Pick<
  UnitRankingSuggestion,
  "unit" | "tierId" | "withinTierOrder" | "reason"
>;

type ModelStatus = {
  configured: boolean;
  connected: boolean;
  provider: string;
  model: string;
  loading: boolean;
};

type ProviderId = "deepseek" | "openai" | "kimi" | "doubao" | "custom";

type ProviderSetting = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

type ProviderSettingsMap = Record<ProviderId, ProviderSetting>;

type ProviderPreset = {
  id: ProviderId;
  label: string;
  baseUrl: string;
  model: string;
  modelLabel: string;
  models: AIModelOption[];
  apiKeyUrl: string;
  docsUrl: string;
};

type ConnectionTest = {
  state: "idle" | "loading" | "success" | "error";
  message: string;
};

const STEPS = [
  { id: 1, label: "人员来源" },
  { id: 2, label: "信息识别" },
  { id: 3, label: "人工核对" },
  { id: 4, label: "保存导出" },
] as const;

const SAMPLE_TEXT = `序号\t姓名\t单位\t职务
12\t贺 世 博\t上海九誓科技有限公司\t
1\t马晓勇\t宁波轿辰\t执行总裁
7\t黄乾炜\t上海九誓\t
5\t陈晓\t宁波低空经济发展有限公司\t项目经理
9\t周明\t浙江省低空产业研究院\t研究员`;

const MODEL_SETTINGS_STORAGE_KEY = "meeting-list-ai:model-settings:v2";

const PROVIDER_PRESENTATION: Record<
  ProviderId,
  Pick<ProviderPreset, "modelLabel">
> = {
  deepseek: {
    modelLabel: "模型名称",
  },
  openai: {
    modelLabel: "模型名称",
  },
  kimi: {
    modelLabel: "模型名称",
  },
  doubao: {
    modelLabel: "模型名称 / 接入点 ID",
  },
  custom: {
    modelLabel: "模型名称",
  },
};

const PROVIDER_PRESETS: ProviderPreset[] = AI_PROVIDER_PRESETS.map(
  (provider) => ({
    ...provider,
    ...PROVIDER_PRESENTATION[provider.id],
  }),
);

const PROVIDER_MAP = Object.fromEntries(
  PROVIDER_PRESETS.map((provider) => [provider.id, provider]),
) as Record<ProviderId, ProviderPreset>;

function makeDefaultProviderSettings(): ProviderSettingsMap {
  return Object.fromEntries(
    PROVIDER_PRESETS.map((provider) => [
      provider.id,
      {
        apiKey: "",
        baseUrl: provider.baseUrl,
        model: provider.model,
      },
    ]),
  ) as ProviderSettingsMap;
}

function cloneProviderSettings(
  settings: ProviderSettingsMap,
): ProviderSettingsMap {
  return Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      { ...value },
    ]),
  ) as ProviderSettingsMap;
}

function normalizeStoredProviderSettings(value: unknown): ProviderSettingsMap {
  const defaults = makeDefaultProviderSettings();
  if (!value || typeof value !== "object") return defaults;
  const stored = value as Partial<Record<ProviderId, Partial<ProviderSetting>>>;

  for (const provider of PROVIDER_PRESETS) {
    const candidate = stored[provider.id];
    if (!candidate || typeof candidate !== "object") continue;
    defaults[provider.id] = {
      apiKey: String(candidate.apiKey ?? "").trim(),
      baseUrl:
        String(candidate.baseUrl ?? "").trim() || defaults[provider.id].baseUrl,
      model:
        String(candidate.model ?? "").trim() || defaults[provider.id].model,
    };
  }
  return defaults;
}

function modelSignature(provider: ProviderId, setting: ProviderSetting) {
  return [
    provider,
    setting.baseUrl.trim().replace(/\/+$/, ""),
    setting.model.trim(),
    setting.apiKey.trim(),
  ].join("\n");
}

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

function withRecordPatch(
  record: PersonRecord,
  patch: RosterWorkspaceRecordPatch,
): PersonRecord {
  const updated = { ...record };
  if (Object.hasOwn(patch, "name")) {
    updated.name = cleanName(patch.name);
  }
  for (const key of ["unit", "department", "title"] as const) {
    if (Object.hasOwn(patch, key)) updated[key] = patch[key] ?? "";
  }

  const issues = updated.issues.filter(
    (issue) =>
      !(issue === "单位缺失" && updated.unit) &&
      !(issue === "姓名待确认" && updated.name),
  );
  if (!updated.unit && !issues.includes("单位缺失")) {
    issues.push("单位缺失");
  }
  if (!updated.name && !issues.includes("姓名待确认")) {
    issues.push("姓名待确认");
  }
  return { ...updated, issues };
}

function makeManualRecord(
  input: RosterWorkspaceRecordInput,
  originalIndex: number,
  source = "智能助手",
): PersonRecord {
  return withRecordPatch(
    {
      id: makeId(),
      originalIndex,
      name: "",
      unit: "",
      department: "",
      title: "",
      source,
      confidence: 1,
      issues: ["姓名待确认", "单位缺失"],
    },
    input,
  );
}

function applyAliasToRecords(
  records: PersonRecord[],
  suggestion: AliasSuggestion,
) {
  return records.map((record) =>
    suggestion.aliases.includes(record.unit)
      ? { ...record, unit: suggestion.canonical }
      : record,
  );
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

function parseWithRules(rawText: string) {
  const records: PersonRecord[] = [];
  let currentSource = "粘贴文本";
  let headers: string[] | null = null;
  let order = 0;

  const lines = rawText.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

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

function unitCore(value: string) {
  return cleanCell(value)
    .replace(/[（）()]/g, "")
    .replace(
      /(股份有限责任公司|有限责任公司|股份有限公司|科技有限公司|集团有限公司|有限公司|集团|科技)$/g,
      "",
    )
    .replace(/\s+/g, "");
}

function buildAliasSuggestions(records: PersonRecord[]) {
  const grouped = new Map<string, Set<string>>();
  records.forEach((record) => {
    if (!record.unit) return;
    const core = unitCore(record.unit);
    if (core.length < 3) return;
    const aliases = grouped.get(core) ?? new Set<string>();
    aliases.add(record.unit);
    grouped.set(core, aliases);
  });

  return Array.from(grouped.entries())
    .filter(([, aliases]) => aliases.size > 1)
    .map(([core, aliases]) => {
      const aliasList = Array.from(aliases).sort((a, b) => a.length - b.length);
      return {
        id: makeId("alias"),
        canonical: aliasList.includes(core) ? core : aliasList[0],
        aliases: aliasList,
        reason: "名称主体一致，疑似为简称与全称",
      } satisfies AliasSuggestion;
    });
}

function mergeAliasSuggestions(
  ...groups: AliasSuggestion[][]
): AliasSuggestion[] {
  const merged = new Map<string, AliasSuggestion>();
  groups.flat().forEach((suggestion) => {
    const aliases = Array.from(
      new Set(
        [suggestion.canonical, ...suggestion.aliases]
          .map(cleanCell)
          .filter(Boolean),
      ),
    );
    if (!suggestion.canonical || aliases.length < 2) return;
    const key = `${suggestion.canonical}|${[...aliases].sort().join("|")}`;
    if (!merged.has(key)) {
      merged.set(key, {
        ...suggestion,
        aliases,
      });
    }
  });
  return Array.from(merged.values());
}

function applyConfiguredAliases(
  records: PersonRecord[],
  rules: UnitAliasRule[],
) {
  let normalized = records;
  const suggestions: AliasSuggestion[] = [];

  rules
    .filter((rule) => rule.enabled)
    .forEach((rule) => {
      const variants = Array.from(
        new Set(
          [rule.canonical, ...rule.aliases].map(cleanCell).filter(Boolean),
        ),
      );
      const variantSet = new Set(variants);
      const matchedUnits = Array.from(
        new Set(
          normalized
            .map((record) => record.unit)
            .filter((unit) => variantSet.has(unit)),
        ),
      );
      if (!matchedUnits.some((unit) => unit !== rule.canonical)) return;

      if (rule.mode === "auto") {
        normalized = normalized.map((record) =>
          variantSet.has(record.unit)
            ? { ...record, unit: rule.canonical }
            : record,
        );
        return;
      }

      suggestions.push({
        id: makeId("alias"),
        canonical: rule.canonical,
        aliases: variants,
        reason: rule.notes || "命中管理中心的单位名称库",
      });
    });

  return { records: normalized, suggestions };
}

function normalizeSuggestionsWithAutomaticAliases(
  suggestions: AliasSuggestion[],
  rules: UnitAliasRule[],
) {
  const automaticMap = new Map<string, string>();
  rules
    .filter((rule) => rule.enabled && rule.mode === "auto")
    .forEach((rule) => {
      [rule.canonical, ...rule.aliases]
        .map(cleanCell)
        .filter(Boolean)
        .forEach((variant) => automaticMap.set(variant, rule.canonical));
    });

  return suggestions
    .map((suggestion) => {
      const canonical =
        automaticMap.get(cleanCell(suggestion.canonical)) ||
        cleanCell(suggestion.canonical);
      const aliases = Array.from(
        new Set(
          [canonical, ...suggestion.aliases]
            .map((value) => automaticMap.get(cleanCell(value)) || cleanCell(value))
            .filter(Boolean),
        ),
      );
      return { ...suggestion, canonical, aliases };
    })
    .filter((suggestion) => suggestion.aliases.length > 1);
}

function sortRecords(records: PersonRecord[], rules: RosterRules) {
  return rankRosterRecords(records, rules).records;
}

function withAcceptedAIUnitRankings(
  rules: RosterRules,
  accepted: Record<string, AcceptedUnitRanking>,
): RosterRules {
  const validTierIds = new Set(
    rules.ranking.unitTiers.filter((tier) => tier.enabled).map((tier) => tier.id),
  );
  const configuredUnits = new Set(
    rules.ranking.unitOverrides
      .filter((rule) => rule.enabled)
      .map((rule) => cleanCell(rule.unit).toLocaleLowerCase("zh-CN")),
  );
  const aiOverrides = Object.values(accepted)
    .filter(
      (item) =>
        validTierIds.has(item.tierId) &&
        !configuredUnits.has(cleanCell(item.unit).toLocaleLowerCase("zh-CN")),
    )
    .map((item, index) => ({
      id: `ai-unit-rank-${index}`,
      unit: item.unit,
      tierId: item.tierId,
      withinTierOrder: item.withinTierOrder,
      enabled: true,
      notes: `本次名单已确认的 AI 建议：${item.reason}`,
    }));
  return {
    ...rules,
    ranking: {
      ...rules.ranking,
      unitOverrides: [...aiOverrides, ...rules.ranking.unitOverrides],
    },
  };
}

function outputValue(
  field: RosterOutputFieldKey,
  record: PersonRecord,
  index: number,
) {
  switch (field) {
    case "sequence":
      return index + 1;
    case "name":
      return record.name;
    case "unit":
      return record.unit;
    case "department":
      return record.department;
    case "title":
      return record.title;
    case "source":
      return record.source;
  }
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function readMeetingFile(
  file: File,
  onProgress?: (message: string) => void,
): Promise<SourceFile> {
  const result = await readBusinessDocument(file, onProgress);
  return {
    id: makeId("file"),
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    ...result,
  };
}

function Stepper({ current }: { current: Step }) {
  return (
    <nav className="stepper" aria-label="名单整理进度">
      {STEPS.map((step, index) => {
        const complete = current > step.id;
        const active = current === step.id;
        return (
          <div className="step-item" key={step.id}>
            <div
              className={`step-number ${active ? "active" : ""} ${complete ? "complete" : ""}`}
              aria-current={active ? "step" : undefined}
            >
              {complete ? <Check size={17} strokeWidth={2.8} /> : step.id}
            </div>
            <span className={active ? "step-label active" : "step-label"}>
              {step.label}
            </span>
            {index < STEPS.length - 1 ? (
              <span className={complete ? "step-line complete" : "step-line"} />
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}

function StatusPill({
  modelStatus,
  onClick,
}: {
  modelStatus: ModelStatus;
  onClick: () => void;
}) {
  const label = modelStatus.loading
    ? "载入 AI 设置"
    : modelStatus.connected
      ? `${modelStatus.provider} AI 已连接`
      : modelStatus.configured
        ? `${modelStatus.provider} AI 已配置`
      : "规则模式";
  return (
    <button
      type="button"
      className={`status-pill ${
        modelStatus.connected
          ? "connected"
          : modelStatus.configured
            ? "configured"
            : "offline"
      }`}
      onClick={onClick}
      aria-label="打开 AI 模型设置"
    >
      <span className="status-dot" />
      {label}
      <ChevronRight size={15} />
    </button>
  );
}

export default function RosterTool({
  linkedMeetingId: linkedMeetingIdProp,
  embedded = false,
  onExit,
  onWorkspaceStatusChange,
}: {
  linkedMeetingId?: string | null;
  embedded?: boolean;
  onExit?: () => void;
  onWorkspaceStatusChange?: (status: { dirty: boolean; busy: boolean }) => void;
} = {}) {
  const { searchParams } = useWorkspaceLocation();
  const linkedMeetingId = linkedMeetingIdProp ?? searchParams.get("meeting");
  const meetingStore = useSyncExternalStore(
    subscribeMeetings,
    loadMeetingStoreSnapshot,
    () => EMPTY_MEETING_STORE,
  );
  const linkedMeeting = linkedMeetingId
    ? meetingStore.all.find(
        (meeting) => meeting.id === linkedMeetingId && !meeting.deletedAt,
      ) ?? null
    : null;
  const {
    config: adminConfig,
    loading: adminConfigLoading,
    error: adminConfigError,
    reload: reloadAdminConfig,
  } = useAdminConfig();
  const rosterRules = adminConfig.rosterRules;
  const [step, setStep] = useState<Step>(1);
  const [sourceMode, setSourceMode] = useState<"manual" | "import">(
    linkedMeetingId ? "manual" : "import",
  );
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [pasteText, setPasteText] = useState("");
  const [records, setRecords] = useState<PersonRecord[]>([]);
  const [aliases, setAliases] = useState<AliasSuggestion[]>([]);
  const [rankingAnalysis, setRankingAnalysis] =
    useState<RankingAnalysis | null>(null);
  const [selectedUnitSuggestions, setSelectedUnitSuggestions] = useState<
    Set<string>
  >(new Set());
  const [acceptedUnitRankings, setAcceptedUnitRankings] = useState<
    Record<string, AcceptedUnitRanking>
  >({});
  const [rankingAnalyzing, setRankingAnalyzing] = useState(false);
  const [enrichmentAnalysis, setEnrichmentAnalysis] = useState<
    RankingAnalysis | null
  >(null);
  const [enrichmentRecordId, setEnrichmentRecordId] = useState("");
  const [enrichmentLoadingId, setEnrichmentLoadingId] = useState("");
  const [processing, setProcessing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileProgress, setFileProgress] = useState("");
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [showModelInfo, setShowModelInfo] = useState(false);
  const [activeProvider, setActiveProvider] =
    useState<ProviderId>("deepseek");
  const [providerSettings, setProviderSettings] =
    useState<ProviderSettingsMap>(() => makeDefaultProviderSettings());
  const [rememberKeys, setRememberKeys] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [legacyStatus, setLegacyStatus] = useState({
    configured: false,
    provider: "DeepSeek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
  });
  const [verifiedSignature, setVerifiedSignature] = useState("");
  const [draftActiveProvider, setDraftActiveProvider] =
    useState<ProviderId>("deepseek");
  const [draftProviderSettings, setDraftProviderSettings] =
    useState<ProviderSettingsMap>(() => makeDefaultProviderSettings());
  const [draftRememberKeys, setDraftRememberKeys] = useState(true);
  const [showApiKey, setShowApiKey] = useState(false);
  const [connectionTest, setConnectionTest] = useState<ConnectionTest>({
    state: "idle",
    message: "",
  });
  const workspaceSignature = useMemo(
    () =>
      JSON.stringify({
        files: files.map((file) => [file.name, file.size, file.lastModified]),
        pasteText,
        records,
        aliases,
        acceptedUnitRankings,
      }),
    [acceptedUnitRankings, aliases, files, pasteText, records],
  );
  const [workspaceBaseline, setWorkspaceBaseline] = useState(() =>
    JSON.stringify({
      files: [],
      pasteText: "",
      records: [],
      aliases: [],
      acceptedUnitRankings: {},
    }),
  );
  const workspaceDirty = workspaceSignature !== workspaceBaseline;
  const modelSettingsDirty =
    showModelInfo &&
    (draftActiveProvider !== activeProvider ||
      draftRememberKeys !== rememberKeys ||
      JSON.stringify(draftProviderSettings) !== JSON.stringify(providerSettings));
  const rosterTabDirty = workspaceDirty || modelSettingsDirty;
  const workspaceBusy =
    processing ||
    fileLoading ||
    rankingAnalyzing ||
    Boolean(enrichmentLoadingId) ||
    connectionTest.state === "testing";

  useWorkspaceTabStatus({
    enabled: !embedded,
    title: "名单治理",
    dirty: rosterTabDirty,
    dirtyReasons: [
      ...(workspaceDirty ? ["名单导入、核对或排序结果尚未导出"] : []),
      ...(modelSettingsDirty ? ["AI 模型设置尚未保存"] : []),
    ],
    busy: workspaceBusy,
  });

  useEffect(() => {
    onWorkspaceStatusChange?.({ dirty: rosterTabDirty, busy: workspaceBusy });
  }, [onWorkspaceStatusChange, rosterTabDirty, workspaceBusy]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceRevisionRef = useRef(0);
  const workspaceSnapshotRef = useRef<RosterWorkspaceSnapshot | null>(null);
  const workspaceContentRef = useRef<{
    step: Step;
    files: SourceFile[];
    pasteText: string;
    records: PersonRecord[];
    aliases: AliasSuggestion[];
    acceptedUnitRankings: Record<string, AcceptedUnitRanking>;
    linkedMeeting: MeetingRecord | null;
  } | null>(null);
  const workspaceExecuteRef = useRef<RosterWorkspaceBridgeHandler["execute"]>(
    async () => {
      throw new RosterWorkspaceBridgeError(
        "UNAVAILABLE",
        "名单治理工作区尚未就绪",
      );
    },
  );

  useEffect(() => {
    let mounted = true;
    const restoreTimer = window.setTimeout(() => {
      if (!mounted) return;
      try {
        const stored = loadAISettings();
        const restoredProvider =
          stored.activeProvider in PROVIDER_MAP
            ? (stored.activeProvider as ProviderId)
            : "deepseek";
        const restoredSettings = normalizeStoredProviderSettings(
          stored.providers,
        );
        setActiveProvider(restoredProvider);
        setProviderSettings(restoredSettings);
        setRememberKeys(stored.rememberKeys);
      } catch {
        window.localStorage.removeItem(MODEL_SETTINGS_STORAGE_KEY);
      }
    }, 0);

    fetch("/api/extract")
      .then((response) => response.json())
      .then((data) => {
        if (!mounted) return;
        setLegacyStatus({
          configured: Boolean(data.configured),
          provider: data.provider || "DeepSeek",
          model: data.model || "deepseek-v4-flash",
          baseUrl: data.baseUrl || "https://api.deepseek.com",
        });
      })
      .catch(() => {})
      .finally(() => {
        if (mounted) setSettingsLoading(false);
      });
    return () => {
      mounted = false;
      window.clearTimeout(restoreTimer);
    };
  }, []);

  const activeSetting = providerSettings[activeProvider];
  const usesLegacyConfig =
    activeProvider === "deepseek" &&
    !activeSetting.apiKey &&
    legacyStatus.configured;
  const activeModelConfig = useMemo(
    () => ({
      provider: activeProvider,
      apiKey: activeSetting.apiKey,
      baseUrl: activeSetting.baseUrl,
      model: activeSetting.model,
    }),
    [activeProvider, activeSetting],
  );
  const modelStatus: ModelStatus = useMemo(() => {
    const provider = PROVIDER_MAP[activeProvider];
    const configured = Boolean(activeSetting.apiKey) || usesLegacyConfig;
    return {
      configured,
      connected:
        Boolean(activeSetting.apiKey) &&
        verifiedSignature === modelSignature(activeProvider, activeSetting),
      provider: usesLegacyConfig ? legacyStatus.provider : provider.label,
      model: usesLegacyConfig ? legacyStatus.model : activeSetting.model,
      loading: settingsLoading,
    };
  }, [
    activeProvider,
    activeSetting,
    legacyStatus.model,
    legacyStatus.provider,
    settingsLoading,
    usesLegacyConfig,
    verifiedSignature,
  ]);
  const draftPreset = PROVIDER_MAP[draftActiveProvider];
  const draftSetting = draftProviderSettings[draftActiveProvider];
  const draftUsesCatalogModel = isCatalogModel(
    draftActiveProvider,
    draftSetting.model,
  );

  const effectiveRosterRules = useMemo(
    () => withAcceptedAIUnitRankings(rosterRules, acceptedUnitRankings),
    [acceptedUnitRankings, rosterRules],
  );
  const rankingResult = useMemo(
    () => rankRosterRecords(records, effectiveRosterRules),
    [effectiveRosterRules, records],
  );
  const sortedRecords = rankingResult.records;
  const enabledOutputFields = useMemo(
    () => rosterRules.outputFields.filter((field) => field.enabled),
    [rosterRules.outputFields],
  );
  const rosterSortDescription =
    rosterRules.ranking.mode === "authority"
      ? `单位层级优先 · 同单位${
          rosterRules.withinUnitOrder === "title"
            ? "按职务层级"
            : rosterRules.withinUnitOrder === "name"
              ? "按姓名拼音"
              : "保留原顺序"
        }`
      : `单位拼音${
          rosterRules.sortDirection === "desc" ? "降序" : "升序"
        } · 同单位${
          rosterRules.withinUnitOrder === "name"
            ? "按姓名拼音"
            : rosterRules.withinUnitOrder === "title"
              ? "按职务层级"
              : "保留原顺序"
        }`;
  const displayedSortDescription = `${rosterSortDescription}${
    Object.keys(acceptedUnitRankings).length
      ? ` · ${Object.keys(acceptedUnitRankings).length} 个 AI 建议已确认`
      : ""
  }`;
  const exportPreviewName = formatRosterExportFileName(
    rosterRules.exportFileNameTemplate,
    linkedMeeting?.title,
  );
  const unitCount = useMemo(
    () => new Set(records.map((record) => record.unit).filter(Boolean)).size,
    [records],
  );
  const issueCount = useMemo(
    () => records.filter((record) => record.issues.length > 0).length,
    [records],
  );
  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return records;
    return records.filter((record) =>
      [record.name, record.unit, record.department, record.title, record.source]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [records, searchQuery]);

  const combinedText = useMemo(() => {
    const fileParts = files.map((file) => `【来源：${file.name}】\n${file.content}`);
    if (pasteText.trim()) fileParts.push(`【来源：粘贴文本】\n${pasteText.trim()}`);
    return fileParts.join("\n\n");
  }, [files, pasteText]);

  useEffect(() => {
    const previous = workspaceContentRef.current;
    const contentChanged = Boolean(
      previous &&
        (previous.step !== step ||
          previous.files !== files ||
          previous.pasteText !== pasteText ||
          previous.records !== records ||
          previous.aliases !== aliases ||
          previous.acceptedUnitRankings !== acceptedUnitRankings ||
          previous.linkedMeeting !== linkedMeeting),
    );
    if (contentChanged) workspaceRevisionRef.current += 1;
    workspaceContentRef.current = {
      step,
      files,
      pasteText,
      records,
      aliases,
      acceptedUnitRankings,
      linkedMeeting,
    };

    const visibleRecords = records.slice(
      0,
      MAX_ROSTER_WORKSPACE_SNAPSHOT_RECORDS,
    );
    const snapshot: RosterWorkspaceSnapshot = {
      revision: workspaceRevisionRef.current,
      pasteText: pasteText.slice(0, 100_000),
      files: files.slice(0, 100).map((file) => ({
        name: file.name.slice(0, 240) || "未命名文件",
        size: Math.max(0, file.size),
        lastModified: Math.max(0, file.lastModified),
        kind: file.kind,
      })),
      step,
      records: visibleRecords.map((record) => ({
        id:
          record.id.slice(0, 200) ||
          `snapshot-record-${Math.max(0, record.originalIndex)}`,
        originalIndex: Math.max(0, record.originalIndex),
        name: record.name.slice(0, 200),
        unit: record.unit.slice(0, 500),
        department: record.department.slice(0, 500),
        title: record.title.slice(0, 500),
        source: record.source.slice(0, 500),
        confidence: Number.isFinite(record.confidence)
          ? record.confidence
          : 0,
        issues: record.issues
          .map((issue) => issue.slice(0, 500))
          .filter(Boolean)
          .slice(0, 100),
      })),
      recordTotal: records.length,
      truncated: records.length > visibleRecords.length,
      aliases: aliases.slice(0, 2_000).map((alias) => ({
        id: alias.id.slice(0, 200) || `snapshot-alias-${alias.canonical.slice(0, 80)}`,
        canonical: alias.canonical.slice(0, 500),
        aliases: alias.aliases.slice(0, 100).map((name) => name.slice(0, 500)),
        reason: alias.reason.slice(0, 1_000),
        applied: Boolean(alias.applied),
      })),
      linkedMeeting: linkedMeeting
        ? {
            id: linkedMeeting.id.slice(0, 200),
            title: (linkedMeeting.title || "未命名会议").slice(0, 500),
            updatedAt:
              linkedMeeting.updatedAt ||
              linkedMeeting.createdAt ||
              new Date(0).toISOString(),
          }
        : null,
      busy: {
        processing,
        ranking: rankingAnalyzing,
        enrichingRecordId: enrichmentLoadingId || null,
      },
    };
    workspaceSnapshotRef.current = snapshot;
    publishRosterWorkspaceSnapshot(snapshot);
  }, [
    acceptedUnitRankings,
    aliases,
    enrichmentLoadingId,
    files,
    linkedMeeting,
    pasteText,
    processing,
    rankingAnalyzing,
    records,
    step,
  ]);

  function openModelSettings() {
    setDraftActiveProvider(activeProvider);
    setDraftProviderSettings(cloneProviderSettings(providerSettings));
    setDraftRememberKeys(rememberKeys);
    setShowApiKey(false);
    setConnectionTest({ state: "idle", message: "" });
    setShowModelInfo(true);
  }

  function switchDraftProvider(provider: ProviderId) {
    setDraftActiveProvider(provider);
    setShowApiKey(false);
    setConnectionTest({ state: "idle", message: "" });
  }

  function updateDraftSetting(
    key: keyof ProviderSetting,
    value: string,
  ) {
    setDraftProviderSettings((current) => ({
      ...current,
      [draftActiveProvider]: {
        ...current[draftActiveProvider],
        [key]: value,
      },
    }));
    setConnectionTest({ state: "idle", message: "" });
  }

  function resetDraftDefaults() {
    setDraftProviderSettings((current) => ({
      ...current,
      [draftActiveProvider]: {
        ...current[draftActiveProvider],
        baseUrl: draftPreset.baseUrl,
        model: draftPreset.model,
      },
    }));
    setConnectionTest({ state: "idle", message: "" });
  }

  function validateDraftSetting(requireKey: boolean) {
    if (requireKey && !draftSetting.apiKey.trim()) return "请填写 API Key";
    if (!draftSetting.apiKey.trim() && !requireKey) return "";
    if (!draftSetting.baseUrl.trim()) return "请填写 API Base URL";
    if (!draftSetting.model.trim()) return `请填写${draftPreset.modelLabel}`;
    try {
      const url = new URL(draftSetting.baseUrl.trim());
      if (!["http:", "https:"].includes(url.protocol)) {
        return "API Base URL 需要以 http:// 或 https:// 开头";
      }
    } catch {
      return "API Base URL 格式不正确";
    }
    return "";
  }

  async function testModelConnection() {
    const error = validateDraftSetting(true);
    if (error) {
      setConnectionTest({ state: "error", message: error });
      return;
    }

    setConnectionTest({ state: "loading", message: "正在验证接口和模型…" });
    try {
      const response = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "test",
          config: {
            provider: draftActiveProvider,
            apiKey: draftSetting.apiKey.trim(),
            baseUrl: draftSetting.baseUrl.trim(),
            model: draftSetting.model.trim(),
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "连接测试失败");
      }
      setVerifiedSignature(
        modelSignature(draftActiveProvider, {
          apiKey: draftSetting.apiKey.trim(),
          baseUrl: draftSetting.baseUrl.trim(),
          model: draftSetting.model.trim(),
        }),
      );
      setConnectionTest({
        state: "success",
        message: `${draftPreset.label} · ${draftSetting.model.trim()} 连接成功`,
      });
    } catch (error) {
      setConnectionTest({
        state: "error",
        message:
          error instanceof Error ? error.message : "连接测试失败，请检查配置",
      });
    }
  }

  function saveModelSettings() {
    const error = validateDraftSetting(false);
    if (error) {
      setConnectionTest({ state: "error", message: error });
      return;
    }

    const normalizedSettings = cloneProviderSettings(draftProviderSettings);
    for (const provider of PROVIDER_PRESETS) {
      normalizedSettings[provider.id] = {
        apiKey: normalizedSettings[provider.id].apiKey.trim(),
        baseUrl: normalizedSettings[provider.id].baseUrl.trim(),
        model: normalizedSettings[provider.id].model.trim(),
      };
    }

    setActiveProvider(draftActiveProvider);
    setProviderSettings(normalizedSettings);
    setRememberKeys(draftRememberKeys);

    const sharedSettings = loadAISettings();
    saveAISettings({
      ...sharedSettings,
      activeProvider: draftActiveProvider,
      providers: normalizedSettings,
      rememberKeys: draftRememberKeys,
    });

    const selectedSetting = normalizedSettings[draftActiveProvider];
    setNotice({
      tone: "info",
      text: selectedSetting.apiKey
        ? `已切换至 ${draftPreset.label} · ${selectedSetting.model}`
        : "API Key 已清除，当前使用本地规则模式",
    });
    setShowModelInfo(false);
  }

  async function addFiles(fileList: FileList | File[]) {
    const incoming = Array.from(fileList);
    if (!incoming.length) return;
    setFileLoading(true);
    setNotice(null);
    try {
      const parsed: SourceFile[] = [];
      for (const file of incoming) {
        setFileProgress(`正在读取 ${file.name}`);
        parsed.push(
          await readMeetingFile(file, (message) =>
            setFileProgress(`${file.name}：${message}`),
          ),
        );
      }
      setFiles((current) => {
        const fingerprints = new Set(
          current.map(
            (file) =>
              `${file.name}\u0000${file.size}\u0000${file.lastModified}`,
          ),
        );
        const additions = parsed.filter((file) => {
          const fingerprint = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
          if (fingerprints.has(fingerprint)) return false;
          fingerprints.add(fingerprint);
          return true;
        });
        return [...current, ...additions];
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "文件读取失败，请更换文件后重试",
      });
    } finally {
      setFileLoading(false);
      setFileProgress("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function startProcessing() {
    if (adminConfigError) {
      setNotice({
        tone: "error",
        text: "管理中心规则读取失败，请先重新读取规则，避免按错误口径整理名单。",
      });
      return false;
    }
    if (!combinedText.trim()) {
      setNotice({ tone: "error", text: "请先上传文件或粘贴名单内容" });
      return false;
    }
    if (combinedText.length > 100_000) {
      setNotice({
        tone: "error",
        text: `当前名单合计 ${combinedText.length.toLocaleString()} 字，超过 100,000 字上限。请拆成两次处理，系统不会静默截断人员。`,
      });
      return false;
    }
    const latestConfigState = await reloadAdminConfig();
    if (!latestConfigState) {
      setNotice({
        tone: "error",
        text: "管理中心规则重新读取失败，本次整理已暂停，请稍后重试。",
      });
      return false;
    }
    const processingRules = latestConfigState.config.rosterRules;
    setNotice(null);
    setProcessing(true);
    setStep(2);

    let nextRecords: PersonRecord[] = [];
    let nextAliases: AliasSuggestion[] = [];
    let fallbackReason = "";

    if (modelStatus.configured) {
      try {
        const response = await fetch("/api/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: combinedText,
            sources: files.map((file) => file.name),
            promptSuffix: processingRules.extractionPromptSuffix,
            config: activeModelConfig.apiKey
              ? activeModelConfig
              : undefined,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "AI 识别失败");
        }
        nextRecords = (data.records ?? []).map(
          (record: Partial<PersonRecord>, index: number) => ({
            id: makeId(),
            originalIndex: index,
            name: cleanName(record.name),
            unit: cleanCell(record.unit),
            department: cleanCell(record.department),
            title: cleanCell(record.title),
            source: cleanCell(record.source) || "AI识别",
            confidence: Number(record.confidence) || 0.82,
            issues: Array.isArray(record.issues)
              ? record.issues.map(cleanCell).filter(Boolean)
              : [],
          }),
        );
        nextAliases = (data.aliases ?? []).map(
          (alias: Partial<AliasSuggestion>) => ({
            id: makeId("alias"),
            canonical: cleanCell(alias.canonical),
            aliases: Array.isArray(alias.aliases)
              ? alias.aliases.map(cleanCell).filter(Boolean)
              : [],
            reason: cleanCell(alias.reason) || "AI判断为同一单位的不同写法",
          }),
        );
      } catch (error) {
        fallbackReason =
          error instanceof Error
            ? error.message
            : `${modelStatus.provider} API 暂时不可用`;
      }
    }

    if (!nextRecords.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 650));
      nextRecords = parseWithRules(combinedText);
      nextAliases = buildAliasSuggestions(nextRecords);
    }

    const configuredAliases = applyConfiguredAliases(
      nextRecords,
      processingRules.aliases,
    );
    nextRecords = configuredAliases.records;
    nextAliases = mergeAliasSuggestions(
      normalizeSuggestionsWithAutomaticAliases(
        nextAliases.length
          ? nextAliases
          : buildAliasSuggestions(nextRecords),
        processingRules.aliases,
      ),
      configuredAliases.suggestions,
    );

    setRecords(nextRecords);
    setAliases(nextAliases);
    setProcessing(false);
    setStep(3);

    if (!nextRecords.length) {
      setNotice({
        tone: "error",
        text: "暂未识别到有效人员，请检查名单中是否包含姓名",
      });
    } else if (fallbackReason) {
      setNotice({
        tone: "info",
        text: `${modelStatus.provider} 调用未完成，已切换为本地规则识别：${fallbackReason}`,
      });
    } else if (!modelStatus.configured) {
      setNotice({
        tone: "info",
        text: "当前未配置 AI 模型，已使用本地规则完成识别；可在右上角填写 API Key",
      });
    }
    return nextRecords.length > 0;
  }

  function startManualEntry() {
    const seed = linkedMeeting?.attendees.length
      ? linkedMeeting.attendees.map((attendee, index) => ({
          ...makeManualRecord(
              {
                name: attendee.name,
                unit: attendee.unit,
                department: attendee.department,
                title: attendee.title,
              },
              index,
              attendee.source || "会议已有人员",
            ),
          id: attendee.id,
        }))
      : [
          makeManualRecord(
            { name: "", unit: "", department: "", title: "" },
            0,
            "手动录入",
          ),
        ];
    setRecords(seed);
    setAliases([]);
    setRankingAnalysis(null);
    setAcceptedUnitRankings({});
    setNotice(null);
    setStep(3);
  }

  function updateRecord(id: string, key: keyof PersonRecord, value: string) {
    setRecords((current) =>
      current.map((record) =>
        record.id === id &&
        (key === "name" ||
          key === "unit" ||
          key === "department" ||
          key === "title")
          ? withRecordPatch(record, { [key]: value })
          : record,
      ),
    );
  }

  function applyContactToRecord(id: string, contact: ContactRecord) {
    setRecords((current) =>
      current.map((record) =>
        record.id === id
          ? {
              ...record,
              name: contact.name,
              unit: contact.unit,
              department: contact.department,
              title: contact.title,
              source: "人员通讯录",
              confidence: 1,
              issues: [],
            }
          : record,
      ),
    );
    setNotice({
      tone: "info",
      text: `已从通讯录带入 ${contact.name} 的单位、部门和职务`,
    });
  }

  function applyAlias(aliasId: string) {
    const suggestion = aliases.find((alias) => alias.id === aliasId);
    if (!suggestion) return;
    setRecords((current) => applyAliasToRecords(current, suggestion));
    setAliases((current) =>
      current.map((alias) =>
        alias.id === aliasId ? { ...alias, applied: true } : alias,
      ),
    );
  }

  function addEmptyRecord() {
    setRecords((current) => [
      ...current,
      makeManualRecord(
        {
        name: "",
        unit: "",
        department: "",
        title: "",
        },
        current.length,
        "手动新增",
      ),
    ]);
  }

  function removeRecord(recordId: string) {
    setRecords((current) =>
      current.filter((record) => record.id !== recordId),
    );
  }

  async function searchWeb(query: string) {
    const aiSettings = loadAISettings();
    if (!aiSettings.webSearch.enabled || !aiSettings.webSearch.apiKey) {
      return [] as SearchEvidence[];
    }
    const response = await fetch("/api/web-search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: aiSettings.webSearch.provider,
        apiKey: aiSettings.webSearch.apiKey,
        query,
        maxResults: aiSettings.webSearch.maxResults,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          results?: Array<Omit<SearchEvidence, "query">>;
        }
      | null;
    if (!response.ok) {
      throw new Error(payload?.error || "联网搜索失败");
    }
    return (payload?.results ?? []).map((item) => ({ ...item, query }));
  }

  async function analyzeRosterRanking() {
    if (!records.length || rankingAnalyzing) return false;
    if (!modelStatus.configured) {
      setNotice({
        tone: "error",
        text: "请先在右上角配置大模型 API，再使用 AI 排序分析。",
      });
      return false;
    }
    setRankingAnalyzing(true);
    setNotice({
      tone: "info",
      text: "正在分析单位和职务层级；已启用联网核验时会同时查询公开来源。",
    });
    try {
      const aiSettings = loadAISettings();
      const evidence: SearchEvidence[] = [];
      if (aiSettings.webSearch.enabled && aiSettings.webSearch.apiKey) {
        const units = Array.from(
          new Set(records.map((record) => cleanCell(record.unit)).filter(Boolean)),
        ).slice(
          0,
          Math.min(
            8,
            rosterRules.ranking.ai.maxSearchQueriesPerRun,
          ),
        );
        for (let index = 0; index < units.length; index += 1) {
          const unit = units[index];
          const query = `${unit} 单位性质 上级主管 官方`;
          const results = await searchWeb(query);
          evidence.push(
            ...results.map((item, resultIndex) => ({
              ...item,
              id: `unit-${index + 1}-${resultIndex + 1}`,
            })),
          );
        }
      }
      const response = await fetch("/api/ranking/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "analyze-ranking",
          config: activeModelConfig.apiKey ? activeModelConfig : undefined,
          records: records.map((record) => ({
            id: record.id,
            name: record.name,
            unit: record.unit,
            department: record.department,
            title: record.title,
          })),
          rules: rosterRules.ranking,
          evidence,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (RankingAnalysis & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "AI 排序分析失败");
      }
      const analysis: RankingAnalysis = {
        units: Array.isArray(payload.units) ? payload.units : [],
        people: Array.isArray(payload.people) ? payload.people : [],
        evidence: Array.isArray(payload.evidence) ? payload.evidence : evidence,
      };
      setRankingAnalysis(analysis);
      setSelectedUnitSuggestions(
        new Set(
          analysis.units
            .filter(
              (item) =>
                item.confidence >=
                rosterRules.ranking.ai.minimumConfidence,
            )
            .map((item) => item.unit),
        ),
      );
      setNotice(null);
      return true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "AI 排序分析失败",
      });
      return false;
    } finally {
      setRankingAnalyzing(false);
    }
  }

  function applyRankingSuggestions() {
    if (!rankingAnalysis) return;
    const accepted = Object.fromEntries(
      rankingAnalysis.units
        .filter((item) => selectedUnitSuggestions.has(item.unit))
        .map((item) => [
          item.unit,
          {
            unit: item.unit,
            tierId: item.tierId,
            withinTierOrder: item.withinTierOrder,
            reason: item.reason,
          },
        ]),
    ) as Record<string, AcceptedUnitRanking>;
    setAcceptedUnitRankings(accepted);
    setRankingAnalysis(null);
    setNotice({
      tone: "info",
      text: `已将 ${Object.keys(accepted).length} 个经确认的 AI 单位排序建议应用到本次名单。`,
    });
  }

  async function lookupPersonTitle(record: PersonRecord) {
    if (enrichmentLoadingId) return false;
    if (!record.name) {
      setNotice({ tone: "error", text: "请先填写姓名再联网核验职务。" });
      return false;
    }
    if (!modelStatus.configured) {
      setNotice({ tone: "error", text: "请先配置大模型 API。" });
      return false;
    }
    const aiSettings = loadAISettings();
    if (!aiSettings.webSearch.enabled || !aiSettings.webSearch.apiKey) {
      setNotice({
        tone: "error",
        text: "请在智能助手设置中启用 Tavily 并填写搜索 API Key。",
      });
      return false;
    }
    setEnrichmentLoadingId(record.id);
    setNotice({
      tone: "info",
      text: `正在联网核验 ${record.name} 的公开职务信息…`,
    });
    try {
      const query = `${record.name} ${record.unit || ""} 职务 官方`.trim();
      const results = await searchWeb(query);
      const evidence = results.map((item, index) => ({
        ...item,
        id: `person-${index + 1}`,
      }));
      if (!evidence.length) {
        throw new Error("没有检索到可用的公开来源，未补写任何信息");
      }
      const response = await fetch("/api/ranking/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "enrich-person",
          config: activeModelConfig.apiKey ? activeModelConfig : undefined,
          records: [
            {
              id: record.id,
              name: record.name,
              unit: record.unit,
              department: record.department,
              title: record.title,
            },
          ],
          rules: rosterRules.ranking,
          evidence,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | (RankingAnalysis & { error?: string })
        | null;
      if (!response.ok || !payload) {
        throw new Error(payload?.error || "职务核验失败");
      }
      setEnrichmentRecordId(record.id);
      setEnrichmentAnalysis({
        units: Array.isArray(payload.units) ? payload.units : [],
        people: Array.isArray(payload.people) ? payload.people : [],
        evidence: Array.isArray(payload.evidence) ? payload.evidence : evidence,
      });
      setNotice(null);
      return true;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : "职务核验失败",
      });
      return false;
    } finally {
      setEnrichmentLoadingId("");
    }
  }

  function applyPersonEnrichment(suggestion: PersonEnrichmentSuggestion) {
    if (!enrichmentAnalysis || suggestion.recordId !== enrichmentRecordId) return;
    const firstEvidence = enrichmentAnalysis.evidence.find((item) =>
      suggestion.evidenceIds.includes(item.id),
    );
    setRecords((current) =>
      current.map((record) =>
        record.id === suggestion.recordId
          ? {
              ...record,
              unit: suggestion.suggestedUnit || record.unit,
              department:
                suggestion.suggestedDepartment || record.department,
              title: suggestion.suggestedTitle || record.title,
              source: firstEvidence
                ? `联网核验：${new URL(firstEvidence.url).hostname}`
                : "联网核验（人工确认）",
              confidence: suggestion.confidence,
            }
          : record,
      ),
    );
    setEnrichmentAnalysis(null);
    setEnrichmentRecordId("");
    setNotice({
      tone: "info",
      text: "已按你选中的公开来源候选带入信息；原有内容没有被静默覆盖。",
    });
  }

  function resetAll() {
    setFiles([]);
    setPasteText("");
    setRecords([]);
    setAliases([]);
    setRankingAnalysis(null);
    setAcceptedUnitRankings({});
    setEnrichmentAnalysis(null);
    setNotice(null);
    setSearchQuery("");
    setStep(1);
    setWorkspaceBaseline(
      JSON.stringify({
        files: [],
        pasteText: "",
        records: [],
        aliases: [],
        acceptedUnitRankings: {},
      }),
    );
  }

  async function exportExcel() {
    if (!records.length) return null;
    const latestConfigState = await reloadAdminConfig();
    if (!latestConfigState) {
      setNotice({
        tone: "error",
        text: "管理中心规则重新读取失败，本次导出已暂停，请稍后重试。",
      });
      return null;
    }
    const exportRules = withAcceptedAIUnitRankings(
      latestConfigState.config.rosterRules,
      acceptedUnitRankings,
    );
    const exportRecords = sortRecords(records, exportRules);
    const fields = exportRules.outputFields.filter((field) => field.enabled);
    const XLSX = await import("xlsx");
    const rows = [
      fields.map((field) => field.label),
      ...exportRecords.map((record, index) =>
        fields.map((field) => outputValue(field.key, record, index) || ""),
      ),
    ];
    const worksheet = XLSX.utils.aoa_to_sheet(rows);
    worksheet["!cols"] = fields.map((field) => ({ wch: field.width }));
    if (exportRules.autoFilter) {
      worksheet["!autofilter"] = {
        ref: XLSX.utils.encode_range({
          s: { r: 0, c: 0 },
          e: { r: rows.length - 1, c: fields.length - 1 },
        }),
      };
    }
    if (exportRules.freezeHeader) {
      (
        worksheet as typeof worksheet & {
          "!views": Array<Record<string, string | number>>;
        }
      )["!views"] = [
        {
          state: "frozen",
          ySplit: 1,
          topLeftCell: "A2",
          activePane: "bottomLeft",
        },
      ];
    }
    const workbook = XLSX.utils.book_new();
    const worksheetName =
      exportRules.worksheetName.replace(/[\[\]:*?/\\]/g, "_").slice(0, 31) ||
      "参会人员名单";
    XLSX.utils.book_append_sheet(workbook, worksheet, worksheetName);
    const fileName = formatRosterExportFileName(
      exportRules.exportFileNameTemplate,
      linkedMeeting?.title,
    );
    let output = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    }) as ArrayBuffer;
    if (exportRules.freezeHeader) {
      output = freezeFirstRowInXlsx(output).buffer as ArrayBuffer;
    }
    const blob = new Blob([output], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice({ tone: "info", text: `${fileName} 已生成并开始下载` });
    setWorkspaceBaseline(workspaceSignature);
    return fileName;
  }

  async function saveRosterToLinkedMeeting() {
    if (!linkedMeeting) return false;
    const currentMeeting = getMeetingById(linkedMeeting.id);
    if (!currentMeeting) {
      setNotice({
        tone: "error",
        text: "关联的会议已被删除或不存在，名单没有写回会议；仍可独立导出 Excel。",
      });
      return false;
    }
    if (
      sourceMode === "import" &&
      currentMeeting.attendees.length &&
      !window.confirm(
        `保存后将用当前 ${sortedRecords.length} 人替换会议中已有的 ${currentMeeting.attendees.length} 人。是否继续？`,
      )
    ) {
      return false;
    }
    const updated: MeetingRecord = replaceMeetingAttendees(
      currentMeeting,
      sortedRecords.map((record, index) => ({
        id: record.id || `attendee-${Date.now()}-${index}`,
        name: record.name,
        unit: record.unit,
        department: record.department,
        title: record.title,
        source: record.source,
      })),
      { enableRosterWorkflow: true, estimateMode: "exact" },
    );
    try {
      const savedMeeting = saveMeeting(updated);
      await flushMeetingPersistence();
      let contactSyncWarning = "";
      try {
        const sync = await syncMeetingContacts(savedMeeting);
        if (sync.skipped) {
          contactSyncWarning = `；${sync.skipped} 人因单位未填写，暂未写入通讯录`;
        }
      } catch {
        contactSyncWarning = "；会议已保存，但人员通讯录同步失败，可稍后在管理中心重新同步";
      }
      setNotice({
        tone: "info",
        text: contactSyncWarning
          ? `已将 ${sortedRecords.length} 人保存到“${updated.title}”${contactSyncWarning}。`
          : `已将 ${sortedRecords.length} 人保存到“${updated.title}”，会议项目中的名单与人员通讯录已同步更新。`,
      });
      setWorkspaceBaseline(workspaceSignature);
      return true;
    } catch {
      setNotice({
        tone: "error",
        text: "名单未能写回会议。请确认浏览器允许本地存储，或先删除不再需要的旧会议；Excel 仍可独立导出。",
      });
      return false;
    }
  }

  function confirmReview() {
    if (!records.length) {
      setNotice({ tone: "error", text: "当前没有可导出的人员信息" });
      return false;
    }
    if (records.some((record) => !record.name)) {
      setNotice({
        tone: "error",
        text: "仍有姓名为空，请补充后再生成结果",
      });
      return false;
    }
    setNotice(null);
    setStep(4);
    return true;
  }

  async function executeWorkspaceCommands(
    commands: readonly RosterWorkspaceCommand[],
  ): Promise<RosterWorkspaceExecutionResult> {
    const snapshot = workspaceSnapshotRef.current;
    if (!snapshot || !commands.length) {
      throw new RosterWorkspaceBridgeError(
        "UNAVAILABLE",
        "名单治理工作区尚未就绪",
      );
    }
    if (
      commands.some(
        (command) => command.expectedRevision !== snapshot.revision,
      )
    ) {
      throw new RosterWorkspaceBridgeError(
        "STALE_REVISION",
        "名单治理工作区已发生变化，请重新预览后再执行",
      );
    }

    const commandTypes = commands.map((command) => command.type);
    const affectedRecordIds: string[] = [];
    let exportedFileName: string | null = null;
    let message = "名单工作区操作已完成";
    const recordEditTypes = new Set<RosterWorkspaceCommand["type"]>([
      "roster.workspace.record.add",
      "roster.workspace.record.update",
      "roster.workspace.record.remove",
    ]);

    if (commands.every((command) => recordEditTypes.has(command.type))) {
      const nextRecords = [...records];
      for (const command of commands) {
        switch (command.type) {
          case "roster.workspace.record.add": {
            const originalIndex =
              nextRecords.reduce(
                (maximum, record) =>
                  Math.max(maximum, record.originalIndex),
                -1,
              ) + 1;
            const added = makeManualRecord(
              command.record,
              originalIndex,
            );
            nextRecords.push(added);
            affectedRecordIds.push(added.id);
            break;
          }
          case "roster.workspace.record.update": {
            const recordIndex = nextRecords.findIndex(
              (record) => record.id === command.recordId,
            );
            if (recordIndex < 0) {
              throw new RosterWorkspaceBridgeError(
                "INVALID_COMMAND",
                `未找到名单记录 ${command.recordId}`,
              );
            }
            nextRecords[recordIndex] = withRecordPatch(
              nextRecords[recordIndex],
              command.patch,
            );
            affectedRecordIds.push(command.recordId);
            break;
          }
          case "roster.workspace.record.remove": {
            const recordIndex = nextRecords.findIndex(
              (record) => record.id === command.recordId,
            );
            if (recordIndex < 0) {
              throw new RosterWorkspaceBridgeError(
                "INVALID_COMMAND",
                `未找到名单记录 ${command.recordId}`,
              );
            }
            nextRecords.splice(recordIndex, 1);
            affectedRecordIds.push(command.recordId);
            break;
          }
          default:
            throw new RosterWorkspaceBridgeError(
              "INVALID_COMMAND",
              "批量命令只能新增、修改或删除名单记录",
            );
        }
      }
      // Commit the complete edit batch once so a failure cannot leave a
      // partially updated roster in the page.
      setRecords(nextRecords);
      message = `已完成 ${commands.length} 项名单记录修改`;
    } else {
      if (commands.length !== 1) {
        throw new RosterWorkspaceBridgeError(
          "INVALID_COMMAND",
          "除名单记录编辑外，其他工作区命令必须逐项执行",
        );
      }
      const command = commands[0];
      switch (command.type) {
        case "roster.workspace.set_text":
          setPasteText(command.text);
          message = command.text.trim()
            ? "已更新待识别的粘贴名单"
            : "已清空粘贴名单";
          break;
        case "roster.workspace.process": {
          const processed = await startProcessing();
          if (!processed) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              "名单识别未完成，请根据页面提示检查输入或配置",
            );
          }
          message = "名单识别已完成，请核对人员信息";
          break;
        }
        case "roster.workspace.alias.apply": {
          const suggestion = aliases.find(
            (alias) => alias.id === command.aliasId,
          );
          if (!suggestion) {
            throw new RosterWorkspaceBridgeError(
              "INVALID_COMMAND",
              `未找到单位归并建议 ${command.aliasId}`,
            );
          }
          affectedRecordIds.push(
            ...records
              .filter((record) =>
                suggestion.aliases.includes(record.unit),
              )
              .map((record) => record.id),
          );
          applyAlias(command.aliasId);
          message = `已将单位写法统一为“${suggestion.canonical}”`;
          break;
        }
        case "roster.workspace.confirm": {
          if (!confirmReview()) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              "名单仍有姓名或单位为空，请补充后再确认",
            );
          }
          message = "名单已确认并生成排序预览";
          break;
        }
        case "roster.workspace.analyze_ranking": {
          if (!(await analyzeRosterRanking())) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              "AI 排序分析未完成，请根据页面提示检查模型配置",
            );
          }
          message = "AI 排序建议已生成，等待人工选择应用";
          break;
        }
        case "roster.workspace.enrich_person": {
          const record = records.find(
            (item) => item.id === command.recordId,
          );
          if (!record) {
            throw new RosterWorkspaceBridgeError(
              "INVALID_COMMAND",
              `未找到名单记录 ${command.recordId}`,
            );
          }
          if (!(await lookupPersonTitle(record))) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              `未能生成 ${record.name || "该人员"} 的公开职务候选`,
            );
          }
          affectedRecordIds.push(record.id);
          message = `已生成 ${record.name} 的职务候选，等待人工采用`;
          break;
        }
        case "roster.workspace.save_to_meeting":
          if (!(await saveRosterToLinkedMeeting())) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              "名单未能保存到关联会议",
            );
          }
          affectedRecordIds.push(...records.slice(0, 100).map((item) => item.id));
          message = `名单已保存到“${linkedMeeting?.title ?? "关联会议"}”`;
          break;
        case "roster.workspace.export":
          exportedFileName = await exportExcel();
          if (!exportedFileName) {
            throw new RosterWorkspaceBridgeError(
              "EXECUTION_FAILED",
              "Excel 未能生成，请根据页面提示检查名单和导出配置",
            );
          }
          message = `${exportedFileName} 已生成并开始下载`;
          break;
        default:
          throw new RosterWorkspaceBridgeError(
            "INVALID_COMMAND",
            "名单工作区命令不受支持",
          );
      }
    }

    return {
      revision: Math.max(
        workspaceRevisionRef.current,
        commands[0].expectedRevision,
      ),
      commandTypes,
      affectedRecordIds: affectedRecordIds.slice(0, 100),
      message,
      exportedFileName,
    };
  }

  useEffect(() => {
    workspaceExecuteRef.current = executeWorkspaceCommands;
  });

  useEffect(
    () =>
      registerRosterWorkspaceBridge({
        getSnapshot: () => {
          const snapshot = workspaceSnapshotRef.current;
          if (!snapshot) {
            throw new RosterWorkspaceBridgeError(
              "UNAVAILABLE",
              "名单治理工作区尚未就绪",
            );
          }
          return snapshot;
        },
        execute: (commands) => workspaceExecuteRef.current(commands),
      }),
    [],
  );

  return (
    <AssistantShell
      embedded={embedded}
      title="名单治理"
      subtitle={
        linkedMeeting
          ? `关联会议：${linkedMeeting.title}`
          : "导入、核对、排序并导出标准参会名单。"
      }
      actions={
        <>
          {linkedMeeting ? (
            <Link
              className="roster-home-link"
              href={`/meetings/${linkedMeeting.id}`}
            >
              <ArrowLeft size={16} />
              返回会议
            </Link>
          ) : null}
          <StatusPill
            modelStatus={modelStatus}
            onClick={openModelSettings}
          />
          <button
            type="button"
            className="icon-button"
            onClick={() => setShowHelp(true)}
            aria-label="使用帮助"
          >
            <CircleHelp size={21} />
          </button>
        </>
      }
    >
      <div className="roster-page-wrap">
        {embedded ? (
          <div className="roster-embedded-toolbar">
            <button type="button" onClick={onExit}>
              <ArrowLeft size={16} />
              返回人员记录
            </button>
            <div>
              <strong>
                标准名单治理{linkedMeeting ? ` · ${linkedMeeting.title}` : ""}
              </strong>
              <span>需要时再导入、排序与导出，不影响普通人员记录</span>
            </div>
            <StatusPill
              modelStatus={modelStatus}
              onClick={openModelSettings}
            />
          </div>
        ) : null}
        {linkedMeeting && !embedded ? (
          <div className="roster-meeting-link">
            <Building2 size={17} />
            <span>
              当前名单将关联到
              <strong>{linkedMeeting.title}</strong>
            </span>
            <Link href={`/meetings/${linkedMeeting.id}`}>查看会议项目</Link>
          </div>
        ) : null}
        <Stepper current={step} />

        {notice ? (
          <div className={`notice ${notice.tone}`} role="status">
            {notice.tone === "error" ? (
              <AlertCircle size={18} />
            ) : (
              <Info size={18} />
            )}
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => setNotice(null)}
              aria-label="关闭提示"
            >
              <X size={17} />
            </button>
          </div>
        ) : null}

        {step === 1 || step === 2 ? (
          <section className="import-view">
            <div className="section-heading">
              <div>
                <p className="eyebrow">新建整理任务</p>
                <h1>选择人员来源</h1>
                <p>可以直接填写或从通讯录选人，也可以导入文件交给 AI 识别。</p>
              </div>
              {files.length || pasteText ? (
                <button type="button" className="text-button" onClick={resetAll}>
                  <RotateCcw size={16} />
                  清空重来
                </button>
              ) : null}
            </div>

            <div className="roster-source-switcher" role="tablist" aria-label="人员来源">
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === "manual"}
                className={sourceMode === "manual" ? "active" : ""}
                onClick={() => setSourceMode("manual")}
              >
                <UserRound size={19} />
                <span>
                  <strong>直接录入</strong>
                  <small>自由填写或从通讯录选择</small>
                </span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={sourceMode === "import"}
                className={sourceMode === "import" ? "active" : ""}
                onClick={() => setSourceMode("import")}
              >
                <UploadCloud size={19} />
                <span>
                  <strong>文件 / 文本导入</strong>
                  <small>Excel、Word、PDF、图片或粘贴文本</small>
                </span>
              </button>
            </div>

            {sourceMode === "manual" ? (
              <div className="card roster-manual-source">
                <div className="roster-manual-source-icon">
                  <UserRound size={25} />
                </div>
                <div>
                  <h2>{linkedMeeting?.attendees.length ? "继续编辑会议人员" : "直接填写参会人员"}</h2>
                  <p>
                    {linkedMeeting?.attendees.length
                      ? `将带入会议中已记录的 ${linkedMeeting.attendees.length} 人，可继续修改、排序和导出。`
                      : "姓名为必填项，单位、部门和职务均可留空；输入姓名时可模糊搜索通讯录。"}
                  </p>
                  <span>无需上传文件，也无需配置 AI 模型。</span>
                </div>
                <button type="button" className="primary-button" onClick={startManualEntry}>
                  <ArrowRight size={18} />
                  {linkedMeeting?.attendees.length ? "带入并继续" : "开始录入"}
                </button>
              </div>
            ) : (
            <div className="import-grid">
              <div className="card import-card">
                <div
                  className={`dropzone ${dragging ? "dragging" : ""} ${
                    fileLoading ? "loading" : ""
                  }`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    if (event.currentTarget === event.target) setDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    void addFiles(event.dataTransfer.files);
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv,.docx,.pdf,.png,.jpg,.jpeg,.webp,.txt,.md"
                    multiple
                    onChange={(event) => {
                      if (event.target.files) void addFiles(event.target.files);
                    }}
                  />
                  <div className="upload-icon">
                    {fileLoading ? (
                      <LoaderCircle className="spin" size={30} />
                    ) : (
                      <UploadCloud size={31} />
                    )}
                  </div>
                  <h2>{fileLoading ? "正在读取并识别文件…" : "拖拽名单文件到此处"}</h2>
                  <p>{fileLoading && fileProgress ? fileProgress : "或点击选择文件，单个文件不超过 20 MB"}</p>
                  <div className="format-tags">
                    <span>
                      <FileSpreadsheet size={15} /> Excel
                    </span>
                    <span>
                      <FileText size={15} /> Word
                    </span>
                    <span>
                      <FileScan size={15} /> PDF / OCR
                    </span>
                    <span>
                      <ClipboardPaste size={15} /> 文本
                    </span>
                  </div>
                </div>

                {files.length ? (
                  <div className="file-list" aria-label="已上传文件">
                    {files.map((file) => (
                      <div className="file-row" key={file.id}>
                        <div
                          className={`file-kind ${
                            file.kind === "excel" ? "excel" : file.kind === "word" ? "word" : "pdf"
                          }`}
                        >
                          {file.kind === "excel" ? (
                            <FileSpreadsheet size={18} />
                          ) : file.kind === "pdf" || file.kind === "image" ? (
                            <FileScan size={18} />
                          ) : (
                            <FileText size={18} />
                          )}
                        </div>
                        <div className="file-meta">
                          <strong>{file.name}</strong>
                          <span>{formatBytes(file.size)} · 已读取</span>
                        </div>
                        <CheckCircle2 className="file-ok" size={18} />
                        <button
                          type="button"
                          className="row-action"
                          aria-label={`移除 ${file.name}`}
                          onClick={() =>
                            setFiles((current) =>
                              current.filter((item) => item.id !== file.id),
                            )
                          }
                        >
                          <X size={17} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                <div className="paste-divider">
                  <span>也可以直接粘贴名单内容</span>
                </div>
                <textarea
                  className="paste-area"
                  value={pasteText}
                  onChange={(event) => setPasteText(event.target.value)}
                  placeholder={"例如：\n马晓勇  宁波轿辰  执行总裁\n黄乾炜  上海九誓"}
                  maxLength={100_000}
                />
                <div className="input-footer">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => setPasteText(SAMPLE_TEXT)}
                  >
                    <ClipboardPaste size={17} />
                    使用示例数据
                  </button>
                  <span>{pasteText.length.toLocaleString()} / 100,000 字</span>
                </div>

                <div className="import-actions">
                  {adminConfigError ? (
                    <div className="privacy-note roster-config-error">
                      <AlertCircle size={16} />
                      <span>管理规则读取失败</span>
                      <button
                        type="button"
                        onClick={() => void reloadAdminConfig()}
                      >
                        重新读取
                      </button>
                    </div>
                  ) : (
                    <div className="privacy-note">
                      <LockKeyhole size={16} />
                      文件仅用于本次整理，不长期保存
                    </div>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      processing ||
                      fileLoading ||
                      adminConfigLoading ||
                      Boolean(adminConfigError) ||
                      combinedText.length > 100_000 ||
                      !combinedText.trim()
                    }
                    onClick={() => void startProcessing()}
                  >
                    {processing ? (
                      <>
                        <LoaderCircle className="spin" size={19} />
                        正在识别并整理…
                      </>
                    ) : (
                      <>
                        <WandSparkles size={19} />
                        {adminConfigLoading
                          ? "正在加载管理规则"
                          : "开始智能整理"}
                      </>
                    )}
                  </button>
                </div>
              </div>

              <aside className="card rules-card">
                <div className="side-title">
                  <div className="side-title-icon">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <h2>整理结果将包含</h2>
                    <p>可在下一步逐项核对</p>
                  </div>
                </div>

                <div className="field-list">
                  <div>
                    <span className="field-icon">
                      <UserRound size={18} />
                    </span>
                    <p>
                      <strong>姓名</strong>
                      <span>清理姓名中的多余空格</span>
                    </p>
                  </div>
                  <div>
                    <span className="field-icon">
                      <Building2 size={18} />
                    </span>
                    <p>
                      <strong>单位</strong>
                      <span>识别简称并聚合同单位人员</span>
                    </p>
                  </div>
                  <div>
                    <span className="field-icon">
                      <FileText size={18} />
                    </span>
                    <p>
                      <strong>职务</strong>
                      <span>缺失职务保持为空，不擅自补全</span>
                    </p>
                  </div>
                </div>

                <div className="rule-divider" />
                <h3>当前整理规则</h3>
                <ul className="rule-list">
                  <li>
                    <CheckCircle2 size={17} />
                    同单位人员自动聚合
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    {rosterRules.ranking.mode === "authority"
                      ? "按单位层级排列"
                      : `按单位完整拼音${
                          rosterRules.sortDirection === "desc" ? "降序" : "升序"
                        }排列`}
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    单位内部
                    {rosterRules.withinUnitOrder === "title"
                      ? "按职务层级排序"
                      : rosterRules.withinUnitOrder === "name"
                        ? "按姓名拼音排序"
                        : "保留原名单顺序"}
                  </li>
                  <li>
                    <CheckCircle2 size={17} />
                    疑似错误交由人工确认
                  </li>
                </ul>

                <div className="info-box">
                  <Info size={17} />
                  <span>AI 负责理解，规则程序负责排序与导出</span>
                </div>
              </aside>
            </div>
            )}
          </section>
        ) : null}

        {step === 3 ? (
          <section className="review-view">
            <div className="section-heading review-heading">
              <div>
                <p className="eyebrow">识别完成</p>
                <h1>核对人员信息</h1>
                <p>可直接修改单元格；系统不会擅自补全缺失职务。</p>
              </div>
              <div className="summary-strip">
                <div>
                  <strong>{records.length}</strong>
                  <span>人员</span>
                </div>
                <div>
                  <strong>{unitCount}</strong>
                  <span>单位</span>
                </div>
                <div className={issueCount ? "warning-stat" : ""}>
                  <strong>{issueCount}</strong>
                  <span>待确认</span>
                </div>
              </div>
            </div>

            {aliases.some((alias) => !alias.applied) ? (
              <div className="alias-panel">
                <div className="alias-heading">
                  <Sparkles size={19} />
                  <div>
                    <strong>发现可能属于同一单位的不同写法</strong>
                    <span>确认后，相关人员的单位名称将统一更新</span>
                  </div>
                </div>
                <div className="alias-list">
                  {aliases
                    .filter((alias) => !alias.applied)
                    .map((alias) => (
                      <div className="alias-item" key={alias.id}>
                        <div>
                          <span>{alias.aliases.join(" / ")}</span>
                          <small>{alias.reason}</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => applyAlias(alias.id)}
                        >
                          合并为“{alias.canonical}”
                        </button>
                      </div>
                    ))}
                </div>
              </div>
            ) : null}

            <div className="card table-card">
              <div className="table-toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索姓名、单位或职务"
                  />
                </div>
                <div className="toolbar-actions">
                  <span className="sort-hint">
                    <Building2 size={16} />
                    {displayedSortDescription}
                  </span>
                  <button
                    type="button"
                    className="secondary-button compact ranking-analyze-button"
                    onClick={() => void analyzeRosterRanking()}
                    disabled={rankingAnalyzing || !records.length}
                  >
                    {rankingAnalyzing ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <WandSparkles size={16} />
                    )}
                    {rankingAnalyzing ? "正在分析" : "AI 分析排序"}
                  </button>
                  {Object.keys(acceptedUnitRankings).length ? (
                    <button
                      type="button"
                      className="text-button compact"
                      onClick={() => setAcceptedUnitRankings({})}
                    >
                      撤销 AI 排序
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="secondary-button compact"
                    onClick={addEmptyRecord}
                  >
                    <Plus size={16} />
                    新增人员
                  </button>
                </div>
              </div>

              <div className="table-scroll">
                <table className="edit-table">
                  <thead>
                    <tr>
                      <th className="index-col">序号</th>
                      <th>姓名</th>
                      <th>单位</th>
                      <th>部门</th>
                      <th>职务</th>
                      <th>识别状态</th>
                      <th className="action-col">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRecords.map((record) => {
                      const actualIndex =
                        records.findIndex((item) => item.id === record.id) + 1;
                      return (
                        <tr
                          key={record.id}
                          className={record.issues.length ? "has-issue" : ""}
                        >
                          <td className="index-cell">{actualIndex}</td>
                          <td>
                            <ContactAutocomplete
                              className={!record.name ? "invalid" : ""}
                              value={record.name}
                              onChange={(value) =>
                                updateRecord(record.id, "name", value)
                              }
                              onSelect={(contact) =>
                                applyContactToRecord(record.id, contact)
                              }
                              ariaLabel={`第 ${actualIndex} 行姓名，可搜索通讯录`}
                            />
                          </td>
                          <td>
                            <input
                              value={record.unit}
                              onChange={(event) =>
                                updateRecord(record.id, "unit", event.target.value)
                              }
                              placeholder="可留空"
                              aria-label={`第 ${actualIndex} 行单位`}
                            />
                          </td>
                          <td>
                            <input
                              value={record.department}
                              onChange={(event) =>
                                updateRecord(
                                  record.id,
                                  "department",
                                  event.target.value,
                                )
                              }
                              placeholder="可留空"
                              aria-label={`第 ${actualIndex} 行部门`}
                            />
                          </td>
                          <td className="title-lookup-cell">
                            <input
                              value={record.title}
                              onChange={(event) =>
                                updateRecord(record.id, "title", event.target.value)
                              }
                              placeholder="可留空"
                              aria-label={`第 ${actualIndex} 行职务`}
                            />
                            <button
                              type="button"
                              title="联网核验并给出职务候选"
                              aria-label={`联网核验 ${record.name || "该人员"} 的职务`}
                              disabled={
                                !record.name ||
                                enrichmentLoadingId === record.id
                              }
                              onClick={() => void lookupPersonTitle(record)}
                            >
                              {enrichmentLoadingId === record.id ? (
                                <LoaderCircle className="spin" size={15} />
                              ) : (
                                <Globe2 size={15} />
                              )}
                            </button>
                          </td>
                          <td>
                            {record.issues.length ? (
                              <span
                                className="row-status warning"
                                title={record.issues.join("、")}
                              >
                                <AlertCircle size={15} />
                                {record.issues[0]}
                              </span>
                            ) : (
                              <span className="row-status success">
                                <CheckCircle2 size={15} />
                                已识别
                              </span>
                            )}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="row-action danger"
                              aria-label={`删除 ${record.name || "该人员"}`}
                              onClick={() => removeRecord(record.id)}
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {!filteredRecords.length ? (
                  <div className="empty-table">未找到匹配人员</div>
                ) : null}
              </div>
            </div>

            <div className="bottom-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setStep(1)}
              >
                <ArrowLeft size={17} />
                返回来源选择
              </button>
              <p>
                <Info size={16} />
                姓名必填；单位、部门和职务可留空
              </p>
              <button
                type="button"
                className="primary-button"
                onClick={confirmReview}
              >
                确认并预览结果
                <ArrowRight size={18} />
              </button>
            </div>
          </section>
        ) : null}

        {step === 4 ? (
          <section className="result-view">
            <div className="section-heading result-heading">
              <div>
                <p className="eyebrow">整理完成</p>
                <h1>标准参会人员名单</h1>
                <p>
                  同单位人员已归并，当前采用{displayedSortDescription}。
                </p>
              </div>
              <div className="result-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setStep(3)}
                >
                  <ArrowLeft size={17} />
                  返回核对
                </button>
                {linkedMeeting ? (
                  <button
                    type="button"
                    className="secondary-button roster-save-meeting"
                    onClick={saveRosterToLinkedMeeting}
                  >
                    <Building2 size={17} />
                    保存到会议
                  </button>
                ) : null}
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void exportExcel()}
                >
                  <Download size={18} />
                  导出 Excel
                </button>
              </div>
            </div>

            <div className="result-summary">
              <div>
                <span className="summary-icon blue">
                  <UserRound size={20} />
                </span>
                <p>
                  <strong>{sortedRecords.length}</strong>
                  <span>有效人员</span>
                </p>
              </div>
              <div>
                <span className="summary-icon green">
                  <Building2 size={20} />
                </span>
                <p>
                  <strong>{unitCount}</strong>
                  <span>参会单位</span>
                </p>
              </div>
              <div>
                <span className="summary-icon violet">
                  <CheckCircle2 size={20} />
                </span>
                <p>
                  <strong>100%</strong>
                  <span>必填项完整</span>
                </p>
              </div>
              <div className="summary-rule">
                <Sparkles size={18} />
                <span>
                  最终规则
                  <strong>{displayedSortDescription}</strong>
                </span>
              </div>
            </div>

            <div className="card result-table-card">
              <div className="result-table-header">
                <div>
                  <FileSpreadsheet size={19} />
                  <strong>{exportPreviewName}</strong>
                </div>
                <span>预览前 {sortedRecords.length} 条</span>
              </div>
              <div className="table-scroll">
                <table className="result-table">
                  <thead>
                    <tr>
                      {enabledOutputFields.map((field) => (
                        <th key={field.key}>{field.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRecords.map((record, index) => (
                      <tr key={record.id}>
                        {enabledOutputFields.map((field) => {
                          const value = outputValue(field.key, record, index);
                          const decision = rankingResult.decisions[record.id];
                          const rankingLabel =
                            rosterRules.ranking.mode === "authority" &&
                            decision &&
                            (field.key === "unit" || field.key === "title")
                              ? field.key === "unit"
                                ? decision.unit.tierLabel
                                : decision.title.tierLabel
                              : "";
                          return (
                            <td
                              className={
                                field.key === "name"
                                  ? "name-cell"
                                  : value
                                    ? ""
                                    : "empty-value"
                              }
                              key={field.key}
                            >
                              {value || " "}
                              {rankingLabel ? (
                                <small
                                  className="ranking-basis"
                                  title={
                                    field.key === "unit"
                                      ? decision.unit.evidence[0]?.detail
                                      : decision.title.evidence[0]?.detail
                                  }
                                >
                                  {rankingLabel}
                                </small>
                              ) : null}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="finish-bar">
              <div>
                <CheckCircle2 size={20} />
                <span>
                  名单已整理完成
                  <small>下载后可继续在 Excel 中编辑</small>
                </span>
              </div>
              <button type="button" className="text-button" onClick={resetAll}>
                <RotateCcw size={16} />
                整理另一份名单
              </button>
            </div>
          </section>
        ) : null}
      </div>

      <footer className="app-footer">
        AI 负责识别，规则程序负责排序与导出，重要信息请在导出前人工核对
      </footer>

      {rankingAnalysis ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setRankingAnalysis(null)}
        >
          <section
            className="modal ranking-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ranking-review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setRankingAnalysis(null)}
              aria-label="关闭"
            >
              <X size={19} />
            </button>
            <div className="model-modal-heading">
              <div className="modal-icon"><WandSparkles size={23} /></div>
              <div>
                <p>人工确认后才生效</p>
                <h2 id="ranking-review-title">AI 排序建议</h2>
              </div>
            </div>
            <div className="ranking-review-note">
              <Info size={16} />
              <span>
                建议只作用于本次名单。管理中心里配置的指定单位规则优先级更高。
              </span>
            </div>
            <div className="ranking-suggestion-list">
              {rankingAnalysis.units.map((suggestion) => {
                const sources = rankingAnalysis.evidence.filter((item) =>
                  suggestion.evidenceIds.includes(item.id),
                );
                return (
                  <article className="ranking-suggestion" key={suggestion.unit}>
                    <label className="ranking-suggestion__select">
                      <input
                        type="checkbox"
                        checked={selectedUnitSuggestions.has(suggestion.unit)}
                        onChange={(event) =>
                          setSelectedUnitSuggestions((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(suggestion.unit);
                            else next.delete(suggestion.unit);
                            return next;
                          })
                        }
                      />
                      <strong>{suggestion.unit}</strong>
                    </label>
                    <select
                      aria-label={`${suggestion.unit}的单位层级`}
                      value={suggestion.tierId}
                      onChange={(event) =>
                        setRankingAnalysis((current) =>
                          current
                            ? {
                                ...current,
                                units: current.units.map((item) =>
                                  item.unit === suggestion.unit
                                    ? { ...item, tierId: event.target.value }
                                    : item,
                                ),
                              }
                            : current,
                        )
                      }
                    >
                      {rosterRules.ranking.unitTiers
                        .filter((tier) => tier.enabled)
                        .map((tier) => (
                          <option key={tier.id} value={tier.id}>
                            {tier.label}
                          </option>
                        ))}
                    </select>
                    <span className="ranking-confidence">
                      置信度 {Math.round(suggestion.confidence * 100)}%
                    </span>
                    <p>{suggestion.reason || "模型未提供补充说明"}</p>
                    {sources.length ? (
                      <div className="ranking-source-links">
                        {sources.map((source) => (
                          <a
                            href={source.url}
                            key={source.id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Globe2 size={13} /> {source.title}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <small>未使用联网来源，仅作为 AI 语义建议</small>
                    )}
                  </article>
                );
              })}
            </div>
            <div className="model-actions">
              <button
                type="button"
                className="secondary-button"
                onClick={() => setRankingAnalysis(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="primary-button"
                disabled={!selectedUnitSuggestions.size}
                onClick={applyRankingSuggestions}
              >
                <Check size={17} />
                应用选中建议
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {enrichmentAnalysis ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setEnrichmentAnalysis(null)}
        >
          <section
            className="modal enrichment-review-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="enrichment-review-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setEnrichmentAnalysis(null)}
              aria-label="关闭"
            >
              <X size={19} />
            </button>
            <div className="model-modal-heading">
              <div className="modal-icon"><Globe2 size={23} /></div>
              <div>
                <p>公开来源候选</p>
                <h2 id="enrichment-review-title">选择要带入的职务信息</h2>
              </div>
            </div>
            <div className="ranking-review-note warning">
              <AlertCircle size={16} />
              <span>
                同名人员可能不是同一个人。请核对单位与来源；系统不会自动选择候选。
              </span>
            </div>
            <div className="enrichment-candidate-list">
              {enrichmentAnalysis.people.length ? (
                enrichmentAnalysis.people.map((suggestion) => {
                  const sources = enrichmentAnalysis.evidence.filter((item) =>
                    suggestion.evidenceIds.includes(item.id),
                  );
                  const applicable = Boolean(
                    suggestion.suggestedTitle && sources.length,
                  );
                  return (
                    <article className="enrichment-candidate" key={suggestion.recordId}>
                      <div>
                        <span className={`candidate-status is-${suggestion.status}`}>
                          {suggestion.status === "verified"
                            ? "证据匹配"
                            : suggestion.status === "ambiguous"
                              ? "存在歧义"
                              : "未找到"}
                        </span>
                        <span>置信度 {Math.round(suggestion.confidence * 100)}%</span>
                      </div>
                      <h3>{suggestion.suggestedTitle || "没有可带入的职务"}</h3>
                      <p>
                        {[suggestion.suggestedUnit, suggestion.suggestedDepartment]
                          .filter(Boolean)
                          .join(" · ") || "单位信息未确认"}
                      </p>
                      <small>{suggestion.reason}</small>
                      <div className="ranking-source-links">
                        {sources.map((source) => (
                          <a
                            href={source.url}
                            key={source.id}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Globe2 size={13} /> {source.title}
                          </a>
                        ))}
                      </div>
                      <button
                        type="button"
                        className="primary-button"
                        disabled={!applicable}
                        onClick={() => applyPersonEnrichment(suggestion)}
                      >
                        <Check size={16} />
                        我已核对，带入此候选
                      </button>
                    </article>
                  );
                })
              ) : (
                <div className="empty-table">未形成可核验的职务候选</div>
              )}
            </div>
          </section>
        </div>
      ) : null}

      {showHelp ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowHelp(false)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowHelp(false)}
              aria-label="关闭"
            >
              <X size={19} />
            </button>
            <div className="modal-icon">
              <CircleHelp size={23} />
            </div>
            <h2 id="help-title">三分钟完成名单整理</h2>
            <ol className="help-steps">
              <li>
                <span>1</span>
                上传 Excel、Word，或直接粘贴名单文字
              </li>
              <li>
                <span>2</span>
                由 AI 识别人员信息，规则程序清洗数据
              </li>
              <li>
                <span>3</span>
                核对异常项和单位合并建议
              </li>
              <li>
                <span>4</span>
                按管理中心规则排序并导出标准 Excel
              </li>
            </ol>
            <button
              type="button"
              className="primary-button modal-primary"
              onClick={() => setShowHelp(false)}
            >
              知道了
            </button>
          </section>
        </div>
      ) : null}

      {showModelInfo ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setShowModelInfo(false)}
        >
          <section
            className="modal model-modal model-settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="model-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="model-settings-dialog__header">
            <button
              type="button"
              className="modal-close"
              onClick={() => setShowModelInfo(false)}
              aria-label="关闭"
            >
              <X size={19} />
            </button>
            <div className="model-modal-heading">
              <div className="modal-icon">
                <Settings2 size={23} />
              </div>
              <div>
                <p>模型连接</p>
                <h2 id="model-title">AI 模型设置</h2>
              </div>
            </div>
            </div>

            <div className="model-settings-dialog__body">
            <div
              className="provider-switcher"
              role="tablist"
              aria-label="选择 AI 服务商"
            >
              {PROVIDER_PRESETS.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  role="tab"
                  aria-selected={draftActiveProvider === provider.id}
                  className={`provider-option ${
                    draftActiveProvider === provider.id ? "active" : ""
                  }`}
                  onClick={() => switchDraftProvider(provider.id)}
                >
                  <strong>{provider.label}</strong>
                </button>
              ))}
            </div>

            <div className="model-form">
              <label className="settings-field">
                <span className="settings-field-heading">
                  <span>API Key</span>
                  {draftPreset.apiKeyUrl ? (
                    <a
                      href={draftPreset.apiKeyUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(event) => event.stopPropagation()}
                    >
                      获取 API Key
                      <ArrowUpRight size={13} aria-hidden="true" />
                    </a>
                  ) : null}
                </span>
                <div className="secret-input">
                  <KeyRound size={17} />
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={draftSetting.apiKey}
                    onChange={(event) =>
                      updateDraftSetting("apiKey", event.target.value)
                    }
                    placeholder="在这里粘贴 API Key"
                    autoComplete="new-password"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((visible) => !visible)}
                    aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {showApiKey ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </label>

              <label className="settings-field">
                <span>API Base URL</span>
                <input
                  type="url"
                  value={draftSetting.baseUrl}
                  onChange={(event) =>
                    updateDraftSetting("baseUrl", event.target.value)
                  }
                  placeholder="https://example.com/v1"
                  spellCheck={false}
                />
              </label>

              <label className="settings-field model-settings-dialog__model-field">
                <span>{draftPreset.modelLabel}</span>
                {draftPreset.models.length ? (
                  <select
                    value={
                      draftUsesCatalogModel
                        ? draftSetting.model
                        : CUSTOM_MODEL_OPTION_VALUE
                    }
                    onChange={(event) =>
                      updateDraftSetting(
                        "model",
                        event.target.value === CUSTOM_MODEL_OPTION_VALUE
                          ? ""
                          : event.target.value,
                      )
                    }
                  >
                    {draftPreset.models.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                    <option value={CUSTOM_MODEL_OPTION_VALUE}>
                      自定义模型名称 / 接入点 ID
                    </option>
                  </select>
                ) : null}
                {!draftUsesCatalogModel ? (
                  <input
                    type="text"
                    value={draftSetting.model}
                    onChange={(event) =>
                      updateDraftSetting("model", event.target.value)
                    }
                    placeholder={
                      draftActiveProvider === "doubao"
                        ? "填写模型名称或 ep-... 接入点 ID"
                        : "填写模型名称"
                    }
                    spellCheck={false}
                  />
                ) : null}
              </label>
            </div>

            <div className="settings-options">
              <label className="remember-row">
                <input
                  type="checkbox"
                  checked={draftRememberKeys}
                  onChange={(event) =>
                    setDraftRememberKeys(event.target.checked)
                  }
                />
                <span>
                  <strong>在此浏览器记住配置</strong>
                  <small>公共电脑建议取消勾选；清理浏览器数据会移除 Key</small>
                </span>
              </label>
              <div className="settings-link-actions">
                <button
                  type="button"
                  onClick={resetDraftDefaults}
                  disabled={
                    draftSetting.baseUrl === draftPreset.baseUrl &&
                    draftSetting.model === draftPreset.model
                  }
                >
                  恢复默认
                </button>
                <button
                  type="button"
                  className="danger-link"
                  onClick={() => updateDraftSetting("apiKey", "")}
                  disabled={!draftSetting.apiKey}
                >
                  清除 Key
                </button>
              </div>
            </div>

            <div className="model-settings-dialog__feedback" aria-live="polite">
            {connectionTest.state !== "idle" ? (
              <div className={`connection-test ${connectionTest.state}`}>
                {connectionTest.state === "loading" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : connectionTest.state === "success" ? (
                  <CheckCircle2 size={17} />
                ) : (
                  <AlertCircle size={17} />
                )}
                <span>{connectionTest.message}</span>
              </div>
            ) : null}
            </div>

            <div className="model-security-note">
              <LockKeyhole size={16} />
              <span>
                Key 不写入项目文件和导出表格；识别名单时，仅发送给当前选择的模型服务商。
              </span>
            </div>
            </div>

            <div className="model-actions model-settings-dialog__footer">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void testModelConnection()}
                disabled={connectionTest.state === "loading"}
              >
                {connectionTest.state === "loading" ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <PlugZap size={17} />
                )}
                测试连接
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={saveModelSettings}
              >
                <Check size={17} />
                保存并使用
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </AssistantShell>
  );
}
