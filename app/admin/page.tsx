"use client";

import {
  AlertTriangle,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Database,
  DoorOpen,
  Download,
  FileSpreadsheet,
  History,
  ListChecks,
  Plus,
  RotateCcw,
  Save,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Undo2,
  Upload,
  UsersRound,
} from "lucide-react";
import {
  type ChangeEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AssistantShell } from "../components/assistant-shell";
import {
  useWorkspaceLocation,
  useWorkspaceTabStatus,
} from "../components/workspace-tabs";
import {
  cloneAdminConfig,
  DEFAULT_ADMIN_CONFIG,
  isAdminConfig,
  type AdminConfig,
  type ChecklistTemplateConfig,
  type MeetingRoomConfig,
  type RankingTier,
  type RosterOutputField,
  type UnitRankOverride,
  type UnitAliasRule,
} from "../lib/admin-config";
import { useAdminConfig } from "../lib/use-admin-config";
import {
  compactEditableLines,
  splitEditableLines,
} from "../lib/multiline-list";
import { ContactsPanel } from "./contacts-panel";
import { ADMIN_EDIT_SECTIONS, adminSectionDirty, isAdminEditSection, replaceAdminSection, type AdminEditSection } from "../lib/admin-edit-sections";

type SectionId =
  | "overview"
  | "organization"
  | "rooms"
  | "contacts"
  | "checklist"
  | "aliases"
  | "roster"
  | "maintenance";

type Notice = {
  tone: "success" | "warning";
  text: string;
};

const ADMIN_SECTIONS: Array<{
  id: SectionId;
  label: string;
  description: string;
  icon: typeof Settings;
}> = [
  {
    id: "overview",
    label: "配置总览",
    description: "查看当前启用情况",
    icon: SlidersHorizontal,
  },
  {
    id: "organization",
    label: "公司与会议规则",
    description: "默认值、标准与提醒",
    icon: Building2,
  },
  {
    id: "contacts",
    label: "人员通讯录",
    description: "沉淀参会人并快速复用",
    icon: UsersRound,
  },
  {
    id: "rooms",
    label: "会议室管理",
    description: "场地、容量、设备与要求",
    icon: DoorOpen,
  },
  {
    id: "checklist",
    label: "清单模板",
    description: "维护流程动作模板",
    icon: ListChecks,
  },
  {
    id: "aliases",
    label: "单位名称字典",
    description: "简称、全称与合并方式",
    icon: BookOpen,
  },
  {
    id: "roster",
    label: "名单与导出",
    description: "排序、字段和文件格式",
    icon: FileSpreadsheet,
  },
  {
    id: "maintenance",
    label: "数据维护",
    description: "发布、备份与版本回滚",
    icon: Database,
  },
];

const PHASE_OPTIONS: Array<{
  value: ChecklistTemplateConfig["phase"];
  label: string;
}> = [
  { value: "before", label: "会前" },
  { value: "during", label: "会中" },
  { value: "after", label: "会后" },
];

const CONDITION_OPTIONS: Array<{
  value: ChecklistTemplateConfig["condition"];
  label: string;
}> = [
  { value: "always", label: "所有会议" },
  { value: "roster", label: "需要标准名单治理" },
  { value: "rosterWelcomeScreen", label: "需要名单且使用欢迎屏" },
  { value: "afternoon", label: "下午会议" },
  { value: "businessMeal", label: "商务餐" },
  { value: "businessMealAlcohol", label: "商务餐且用酒" },
  { value: "workMeal", label: "工作餐" },
  { value: "parking", label: "需要停车" },
  { value: "publicity", label: "需要宣传" },
  { value: "presentation", label: "需要投屏" },
  { value: "welcomeScreen", label: "需要欢迎屏" },
  { value: "largeMeeting", label: "大型会议" },
  { value: "reimbursement", label: "需要报销" },
  { value: "mealReimbursement", label: "用餐且需要报销" },
];

const REMINDER_LABELS: Array<{
  key: keyof AdminConfig["meetingRules"]["reminders"];
  label: string;
  description: string;
}> = [
  {
    key: "missingLocation",
    label: "缺少会议地点",
    description: "未填写地点时显示风险提醒",
  },
  {
    key: "missingOwner",
    label: "缺少会务负责人",
    description: "未指定负责人时显示风险提醒",
  },
  {
    key: "missingRoster",
    label: "已启用名单但尚未关联",
    description: "仅在会议明确启用名单治理、但还没有已发布名单时提醒",
  },
  {
    key: "overdueTasks",
    label: "任务已经逾期",
    description: "存在超过截止日期的未完成任务时提醒",
  },
  {
    key: "blockedTasks",
    label: "任务处于阻塞状态",
    description: "存在阻塞任务时提醒",
  },
];

function makeLocalId(prefix: string) {
  const safePrefix =
    prefix
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 24) || "item";
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${safePrefix}-${crypto.randomUUID()}`;
  }
  return `${safePrefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`.slice(0, 64);
}

function formatDateTime(value: string) {
  if (!value) return "尚未发布";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

async function responseErrorMessage(
  response: Response,
  fallback: string,
) {
  const payload = (await response.json().catch(() => null)) as
    | {
        error?:
          | string
          | {
              message?: string;
            };
      }
    | null;
  if (typeof payload?.error === "string") return payload.error;
  if (payload?.error?.message) return payload.error.message;
  return fallback;
}

function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`admin-toggle${checked ? " is-on" : ""}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`admin-field ${className}`}>
      <span className="admin-field__label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function RankingTierEditor({
  tiers,
  fallbackId,
  onPatch,
  onRemove,
}: {
  tiers: RankingTier[];
  fallbackId: string;
  onPatch: (id: string, patch: Partial<RankingTier>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="admin-ranking-tiers">
      {[...tiers]
        .sort((a, b) => a.priority - b.priority)
        .map((tier) => {
          const fallback = tier.id === fallbackId;
          return (
            <article className="admin-ranking-tier" key={tier.id}>
              <div className="admin-ranking-tier__topline">
                <Toggle
                  checked={tier.enabled}
                  disabled={fallback}
                  label={`${tier.label}启用状态`}
                  onChange={(enabled) => onPatch(tier.id, { enabled })}
                />
                <input
                  aria-label="层级名称"
                  maxLength={80}
                  value={tier.label}
                  onChange={(event) =>
                    onPatch(tier.id, { label: event.target.value })
                  }
                />
                <label>
                  <span>优先级</span>
                  <input
                    aria-label={`${tier.label}优先级`}
                    type="number"
                    min={0}
                    max={10000}
                    value={tier.priority}
                    onChange={(event) =>
                      onPatch(tier.id, {
                        priority: Math.min(
                          10000,
                          Math.max(0, Number(event.target.value) || 0),
                        ),
                      })
                    }
                  />
                </label>
                {fallback ? (
                  <span className="admin-ranking-tier__fallback">兜底</span>
                ) : (
                  <button
                    type="button"
                    className="admin-icon-button danger"
                    title="删除层级"
                    onClick={() => onRemove(tier.id)}
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
              <Field
                label="匹配关键词"
                hint={
                  fallback
                    ? "兜底层级不设置关键词。"
                    : "使用逗号或换行分隔；系统优先采用最长的命中词。"
                }
              >
                <textarea
                  rows={2}
                  disabled={fallback}
                  placeholder="例如：人民政府，管理局"
                  value={tier.keywords.join("，")}
                  onChange={(event) =>
                    onPatch(tier.id, {
                      keywords: Array.from(
                        new Set(
                          event.target.value
                            .split(/[，,\n]/)
                            .map((value) => value.trim())
                            .filter(Boolean),
                        ),
                      ),
                    })
                  }
                />
              </Field>
              <input
                aria-label={`${tier.label}说明`}
                maxLength={300}
                placeholder="说明（可选）"
                value={tier.description}
                onChange={(event) =>
                  onPatch(tier.id, { description: event.target.value })
                }
              />
            </article>
          );
        })}
    </div>
  );
}

export default function AdminPage() {
  const { href, searchParams } = useWorkspaceLocation();
  const {
    config,
    revision,
    updatedAt,
    summary,
    history,
    loading,
    error,
    reload,
  } = useAdminConfig();
  const [draft, setDraft] = useState<AdminConfig>(() =>
    cloneAdminConfig(DEFAULT_ADMIN_CONFIG),
  );
  const [activeSection, setActiveSection] = useState<SectionId>(() => {
    const requested = searchParams.get("section");
    return requested && ADMIN_SECTIONS.some((section) => section.id === requested)
      ? (requested as SectionId)
      : "overview";
  });
  const [saving, setSaving] = useState(false);
  const [publishSummary, setPublishSummary] =
    useState("更新管理中心配置");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [expandedTaskId, setExpandedTaskId] = useState("");
  const [selectedHistoryRevision, setSelectedHistoryRevision] =
    useState<number | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const lastAppliedHrefRef = useRef(href);
  const loadedRevisionRef = useRef<number | null>(null);
  const [configConflict, setConfigConflict] = useState(false);
  const [contactEditorDirty, setContactEditorDirty] = useState(false);
  const [contactEditorBusy, setContactEditorBusy] = useState(false);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(config),
    [config, draft],
  );
  const editSection = isAdminEditSection(activeSection) ? activeSection : null;
  const sectionDirty = editSection ? adminSectionDirty(config, draft, editSection) : false;

  useWorkspaceTabStatus({
    title: "管理中心",
    dirty: dirty || contactEditorDirty,
    dirtyReasons: [
      ...(dirty ? ["管理中心配置尚未发布"] : []),
      ...(contactEditorDirty ? ["联系人编辑内容尚未保存"] : []),
    ],
    busy: saving || contactEditorBusy,
  });

  useEffect(() => {
    if (lastAppliedHrefRef.current === href) return;
    lastAppliedHrefRef.current = href;
    const requested = searchParams.get("section");
    if (
      requested &&
      ADMIN_SECTIONS.some((section) => section.id === requested)
    ) {
      const timer = window.setTimeout(
        () => setActiveSection(requested as SectionId),
        0,
      );
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [href, searchParams]);

  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(() => {
      if (loadedRevisionRef.current === null || !dirty) {
        setDraft(cloneAdminConfig(config));
        setSelectedHistoryRevision(null);
        loadedRevisionRef.current = revision;
        setConfigConflict(false);
      } else if (loadedRevisionRef.current !== revision) {
        setConfigConflict(true);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [config, dirty, loading, revision]);
  const enabledChecklistCount = draft.checklistTemplates.filter(
    (item) => item.enabled,
  ).length;
  const enabledOutputFieldCount = draft.rosterRules.outputFields.filter(
    (field) => field.enabled,
  ).length;
  const enabledAliasesCount = draft.rosterRules.aliases.filter(
    (alias) => alias.enabled,
  ).length;

  function patchOrganization(
    patch: Partial<AdminConfig["organization"]>,
  ) {
    setDraft((current) => ({
      ...current,
      organization: { ...current.organization, ...patch },
    }));
  }

  function patchMeetingRules(
    patch: Partial<AdminConfig["meetingRules"]>,
  ) {
    setDraft((current) => ({
      ...current,
      meetingRules: { ...current.meetingRules, ...patch },
    }));
  }

  function addMeetingRoom() {
    const room: MeetingRoomConfig = {
      id: makeLocalId("meeting-room"),
      name: "新会议室",
      location: "",
      capacity: 10,
      roomSize: "small",
      equipment: [],
      requirements: "",
      enabled: true,
    };
    setDraft((current) => ({
      ...current,
      meetingRooms: [...current.meetingRooms, room],
    }));
    window.requestAnimationFrame(() => {
      const input = document.getElementById(`${room.id}-name`) as HTMLInputElement | null;
      input?.closest("article")?.scrollIntoView({ block: "start" });
      input?.focus({ preventScroll: true });
    });
  }

  function patchMeetingRoom(
    id: string,
    patch: Partial<MeetingRoomConfig>,
  ) {
    setDraft((current) => {
      const nextRooms = current.meetingRooms.map((room) =>
        room.id === id ? { ...room, ...patch, id: room.id } : room,
      );
      const disabledDefault =
        patch.enabled === false &&
        current.organization.defaultMeetingRoomId === id;
      return {
        ...current,
        meetingRooms: nextRooms,
        organization: disabledDefault
          ? { ...current.organization, defaultMeetingRoomId: "" }
          : current.organization,
      };
    });
  }

  function removeMeetingRoom(id: string) {
    if (!window.confirm("确定删除这个会议室吗？已有会议中的地点快照不会改变。")) {
      return;
    }
    setDraft((current) => ({
      ...current,
      meetingRooms: current.meetingRooms.filter((room) => room.id !== id),
      organization:
        current.organization.defaultMeetingRoomId === id
          ? { ...current.organization, defaultMeetingRoomId: "" }
          : current.organization,
    }));
  }

  function patchRosterRules(
    patch: Partial<AdminConfig["rosterRules"]>,
  ) {
    setDraft((current) => ({
      ...current,
      rosterRules: { ...current.rosterRules, ...patch },
    }));
  }

  function patchRanking(
    patch: Partial<AdminConfig["rosterRules"]["ranking"]>,
  ) {
    setDraft((current) => ({
      ...current,
      rosterRules: {
        ...current.rosterRules,
        ranking: { ...current.rosterRules.ranking, ...patch },
      },
    }));
  }

  function patchRankingTier(
    kind: "unitTiers" | "titleTiers",
    id: string,
    patch: Partial<RankingTier>,
  ) {
    patchRanking({
      [kind]: draft.rosterRules.ranking[kind].map((tier) =>
        tier.id === id ? { ...tier, ...patch, id: tier.id } : tier,
      ),
    });
  }

  function addRankingTier(kind: "unitTiers" | "titleTiers") {
    const tiers = draft.rosterRules.ranking[kind];
    const priority = Math.min(
      8900,
      Math.max(
        0,
        ...tiers
          .filter((tier) => tier.priority < 9000)
          .map((tier) => tier.priority),
      ) + 100,
    );
    patchRanking({
      [kind]: [
        ...tiers,
        {
          id: makeLocalId(kind === "unitTiers" ? "unit-tier" : "title-tier"),
          label: "新层级",
          priority,
          keywords: [],
          description: "",
          enabled: true,
        },
      ],
    });
  }

  function removeRankingTier(
    kind: "unitTiers" | "titleTiers",
    id: string,
  ) {
    const ranking = draft.rosterRules.ranking;
    if (
      id === ranking.unknownUnitTierId ||
      id === ranking.unknownTitleTierId
    ) {
      setNotice({ tone: "warning", text: "兜底层级不能删除。" });
      return;
    }
    patchRanking({
      [kind]: ranking[kind].filter((tier) => tier.id !== id),
      ...(kind === "unitTiers"
        ? {
            unitOverrides: ranking.unitOverrides.filter(
              (rule) => rule.tierId !== id,
            ),
          }
        : {}),
    });
  }

  function addUnitOverride() {
    const firstTier = draft.rosterRules.ranking.unitTiers.find(
      (tier) => tier.id !== draft.rosterRules.ranking.unknownUnitTierId,
    );
    const rule: UnitRankOverride = {
      id: makeLocalId("unit-rank"),
      unit: "",
      tierId:
        firstTier?.id ?? draft.rosterRules.ranking.unknownUnitTierId,
      withinTierOrder: 1000,
      enabled: true,
      notes: "",
    };
    patchRanking({
      unitOverrides: [...draft.rosterRules.ranking.unitOverrides, rule],
    });
  }

  function patchUnitOverride(
    id: string,
    patch: Partial<UnitRankOverride>,
  ) {
    patchRanking({
      unitOverrides: draft.rosterRules.ranking.unitOverrides.map((rule) =>
        rule.id === id ? { ...rule, ...patch, id: rule.id } : rule,
      ),
    });
  }

  function removeUnitOverride(id: string) {
    patchRanking({
      unitOverrides: draft.rosterRules.ranking.unitOverrides.filter(
        (rule) => rule.id !== id,
      ),
    });
  }

  function patchChecklistItem(
    id: string,
    patch: Partial<ChecklistTemplateConfig>,
  ) {
    setDraft((current) => ({
      ...current,
      checklistTemplates: current.checklistTemplates.map((item) =>
        item.id === id ? { ...item, ...patch, id: item.id } : item,
      ),
    }));
  }

  function addChecklistItem() {
    const item: ChecklistTemplateConfig = {
      id: makeLocalId("custom-task"),
      title: "新建核对事项",
      description: "填写这项工作的执行要求和验收标准。",
      phase: "before",
      group: "自定义事项",
      condition: "always",
      dueOffsetDays: -1,
      enabled: true,
    };
    setDraft((current) => ({
      ...current,
      checklistTemplates: [...current.checklistTemplates, item],
    }));
    setExpandedTaskId(item.id);
    window.setTimeout(() => {
      document
        .getElementById(`admin-task-${item.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function duplicateChecklistItem(item: ChecklistTemplateConfig) {
    const copyItem: ChecklistTemplateConfig = {
      ...item,
      id: makeLocalId(`${item.id}-copy`),
      title: `${item.title}（副本）`,
      sopImages: item.sopImages ? [...item.sopImages] : undefined,
    };
    setDraft((current) => {
      const index = current.checklistTemplates.findIndex(
        (candidate) => candidate.id === item.id,
      );
      const next = [...current.checklistTemplates];
      next.splice(index + 1, 0, copyItem);
      return { ...current, checklistTemplates: next };
    });
    setExpandedTaskId(copyItem.id);
    window.setTimeout(() => {
      document
        .getElementById(`admin-task-${copyItem.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 0);
  }

  function moveChecklistItem(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.checklistTemplates.findIndex(
        (item) => item.id === id,
      );
      const target = index + direction;
      if (index < 0 || target < 0 || target >= current.checklistTemplates.length) {
        return current;
      }
      const next = [...current.checklistTemplates];
      [next[index], next[target]] = [next[target], next[index]];
      return { ...current, checklistTemplates: next };
    });
  }

  function removeChecklistItem(id: string) {
    if (!window.confirm("确定删除这项清单模板吗？发布后仅影响以后新建的会议。")) {
      return;
    }
    setDraft((current) => ({
      ...current,
      checklistTemplates: current.checklistTemplates.filter(
        (item) => item.id !== id,
      ),
    }));
    setExpandedTaskId("");
  }

  function addAlias() {
    const alias: UnitAliasRule = {
      id: makeLocalId("unit-alias"),
      canonical: "",
      aliases: [],
      mode: "confirm",
      enabled: true,
      notes: "",
    };
    patchRosterRules({
      aliases: [...draft.rosterRules.aliases, alias],
    });
  }

  function patchAlias(id: string, patch: Partial<UnitAliasRule>) {
    patchRosterRules({
      aliases: draft.rosterRules.aliases.map((alias) =>
        alias.id === id ? { ...alias, ...patch, id: alias.id } : alias,
      ),
    });
  }

  function removeAlias(id: string) {
    patchRosterRules({
      aliases: draft.rosterRules.aliases.filter((alias) => alias.id !== id),
    });
  }

  function patchOutputField(
    key: RosterOutputField["key"],
    patch: Partial<RosterOutputField>,
  ) {
    patchRosterRules({
      outputFields: draft.rosterRules.outputFields.map((field) =>
        field.key === key ? { ...field, ...patch, key: field.key } : field,
      ),
    });
  }

  function moveOutputField(key: RosterOutputField["key"], direction: -1 | 1) {
    const next = [...draft.rosterRules.outputFields];
    const index = next.findIndex((field) => field.key === key);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patchRosterRules({ outputFields: next });
  }

  async function publishConfig(
    nextConfig: AdminConfig,
    nextSummary: string,
    section?: AdminEditSection,
  ) {
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: loadedRevisionRef.current ?? revision,
          summary: nextSummary.trim() || "更新管理中心配置",
          config: nextConfig,
        }),
      });
      if (response.status === 409) {
        throw new Error("配置已被其他页面更新，请重新加载后再发布");
      }
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            `发布失败（${response.status}）`,
          ),
        );
      }
      const saved = await response.json();
      if (!isAdminConfig(saved.config) || !Number.isInteger(saved.revision)) {
        throw new Error("保存结果异常，请重新读取配置后核对。");
      }
      loadedRevisionRef.current = saved.revision;
      setDraft((current) => section ? replaceAdminSection(current, saved.config, section) : cloneAdminConfig(saved.config));
      setConfigConflict(false);
      await reload();
      setNotice({
        tone: "success",
        text: section ? `${ADMIN_EDIT_SECTIONS[section]}已保存并生效，其他页面的未保存修改仍保留。` : "全部配置已保存。会议模板用于以后新建会议；名单规则从下一次整理或导出开始生效。",
      });
    } catch (requestError) {
      setNotice({
        tone: "warning",
        text:
          requestError instanceof Error
            ? requestError.message
            : "配置发布失败",
      });
    } finally {
      setSaving(false);
    }
  }

  async function rollbackConfig() {
    if (selectedHistoryRevision === null) return;
    setSaving(true);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/config/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedRevision: revision,
          targetRevision: selectedHistoryRevision,
        }),
      });
      if (response.status === 409) {
        throw new Error("配置版本已变化，请重新加载后再回滚");
      }
      if (!response.ok) {
        throw new Error(
          await responseErrorMessage(
            response,
            `回滚失败（${response.status}）`,
          ),
        );
      }
      await reload();
      setNotice({
        tone: "success",
        text: `已将历史版本 r${selectedHistoryRevision} 重新发布为最新配置。`,
      });
    } catch (requestError) {
      setNotice({
        tone: "warning",
        text:
          requestError instanceof Error
            ? requestError.message
            : "历史版本回滚失败",
      });
    } finally {
      setSaving(false);
    }
  }

  function exportConfig() {
    const blob = new Blob([JSON.stringify(draft, null, 2)], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `会务智办配置_r${revision || 0}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function importConfig(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const importedConfig =
        isAdminConfig(parsed)
          ? parsed
          : parsed &&
              typeof parsed === "object" &&
              "config" in parsed &&
              isAdminConfig(
                (parsed as { config?: unknown }).config,
              )
            ? (parsed as { config: AdminConfig }).config
            : null;
      if (!importedConfig) {
        throw new Error("文件不是有效的会务智办配置，或版本不受支持");
      }
      setDraft(cloneAdminConfig(importedConfig));
      setNotice({
        tone: "success",
        text: "配置已导入到草稿，请检查后点击“发布配置”。",
      });
    } catch (importError) {
      setNotice({
        tone: "warning",
        text:
          importError instanceof Error
            ? importError.message
            : "配置文件读取失败",
      });
    }
  }

  const headerActions = (
    <>
      <button
        className="assistant-button secondary"
        type="button"
        disabled={!dirty || saving}
        onClick={() => setDraft(cloneAdminConfig(config))}
      >
        <RotateCcw size={15} />
        放弃全部修改
      </button>
      <button
        className="assistant-button primary"
        type="button"
        disabled={!dirty || saving || loading || configConflict || Boolean(error)}
        onClick={() => void publishConfig(draft, publishSummary)}
      >
        <Save size={15} />
        {saving ? "正在保存" : "保存全部配置"}
      </button>
    </>
  );

  return (
    <AssistantShell
      title="管理中心"
      subtitle="维护公司标准、会议流程、人员通讯录和名单规则"
      actions={
        activeSection === "contacts" ? (
          <span className="admin-version-badge">修改即时保存</span>
        ) : editSection ? (
          <span className="admin-version-badge">在当前编辑区保存</span>
        ) : (
          headerActions
        )
      }
    >
      <div className="admin-page-workspace">
      <div className="admin-boundary-note">
        <ShieldCheck aria-hidden="true" />
        <div>
          <strong>
            {activeSection === "contacts"
              ? "独立人员资料库"
              : "独立配置工作区"}
          </strong>
          {activeSection === "contacts" ? (
            <span>
              历史会议参会人会自动沉淀；新增、修改和删除均即时保存，无需发布配置。
            </span>
          ) : (
            <span className={`admin-boundary-note__feedback${error || configConflict ? " is-warning" : notice?.tone === "success" ? " is-success" : ""}`} role="status" aria-live="polite">
              {configConflict
                ? "后台配置已出现新版本。当前未发布草稿已保留；请先发布或放弃草稿，再重新读取最新配置。"
                : error || notice?.text || "会议默认值、清单和提醒只影响以后新建的会议；名单字典与导出规则从下一次名单整理开始生效。"}
            </span>
          )}
        </div>
        <span className="admin-version-badge">
          {activeSection === "contacts" ? "即时生效" : `当前版本 r${revision}`}
        </span>
      </div>

      <div className="admin-layout">
        <aside className="admin-section-nav assistant-panel">
          <div className="admin-section-nav__heading">
            <span>ADMINISTRATION</span>
            <strong>系统配置</strong>
          </div>
          {ADMIN_SECTIONS.map(({ id, label, description, icon: Icon }) => (
            <button
              type="button"
              key={id}
              className={activeSection === id ? "is-active" : ""}
              onClick={() => setActiveSection(id)}
            >
              <Icon aria-hidden="true" />
              <span>
                <strong>{label}</strong>
                <small>{description}</small>
              </span>
            </button>
          ))}
          <div className="admin-section-nav__status">
            <span className={dirty ? "is-dirty" : ""} />
            <div>
              <strong>{dirty ? "有未发布修改" : "配置已同步"}</strong>
              <small>{formatDateTime(updatedAt)}</small>
            </div>
          </div>
        </aside>

        <section className="admin-workspace">
          <div className="admin-workspace__content" inert={saving}>
          {loading && activeSection !== "contacts" ? (
            <div className="assistant-panel admin-loading">
              <span className="admin-loading__spinner" />
              正在读取管理配置
            </div>
          ) : (
            <>
              {activeSection === "overview" && (
                <OverviewSection
                  draft={draft}
                  revision={revision}
                  summary={summary}
                  updatedAt={updatedAt}
                  enabledChecklistCount={enabledChecklistCount}
                  enabledOutputFieldCount={enabledOutputFieldCount}
                  enabledAliasesCount={enabledAliasesCount}
                  dirty={dirty}
                  onNavigate={setActiveSection}
                />
              )}

              {activeSection === "organization" && (
                <div className="admin-section-stack">
                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="ORGANIZATION"
                      title="公司与会议默认值"
                      description="新建会议时自动带出这些内容，使用者仍可在单次会议中修改。"
                    />
                    <div className="admin-form-grid">
                      <Field label="组织名称" className="wide">
                        <input
                          value={draft.organization.name}
                          onChange={(event) =>
                            patchOrganization({ name: event.target.value })
                          }
                        />
                      </Field>
                      <Field label="默认会务负责人">
                        <input
                          value={draft.organization.defaultOwner}
                          onChange={(event) =>
                            patchOrganization({
                              defaultOwner: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="默认开始时间">
                        <input
                          type="time"
                          value={draft.organization.defaultStartTime}
                          onChange={(event) =>
                            patchOrganization({
                              defaultStartTime: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="默认参会人数">
                        <input
                          min={0}
                          type="number"
                          value={
                            draft.organization.defaultAttendeeEstimate
                          }
                          onChange={(event) =>
                            patchOrganization({
                              defaultAttendeeEstimate: Math.min(
                                5000,
                                Math.max(
                                  0,
                                  Number(event.target.value) || 0,
                                ),
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="默认会议规模">
                        <select
                          value={draft.organization.defaultRoomSize}
                          onChange={(event) =>
                            patchOrganization({
                              defaultRoomSize: event.target.value as
                                | "small"
                                | "large",
                            })
                          }
                        >
                          <option value="small">小型会议</option>
                          <option value="large">大型会议</option>
                        </select>
                      </Field>
                      <div className="admin-setting-line">
                        <div>
                          <strong>默认需要投屏</strong>
                          <span>新建会议默认勾选投屏与演示设备准备</span>
                        </div>
                        <Toggle
                          label="默认需要投屏"
                          checked={
                            draft.organization.defaultPresentationRequired
                          }
                          onChange={(checked) =>
                            patchOrganization({
                              defaultPresentationRequired: checked,
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="BUSINESS RULES"
                      title="业务标准"
                      description="把容易变化的数字标准集中到这里管理，不再散落在代码里。"
                    />
                    <div className="admin-rule-grid">
                      <Field label="停车车辆上限" hint="超过此数量时触发提醒">
                        <div className="admin-input-suffix">
                          <input
                            min={1}
                            max={100}
                            type="number"
                            value={
                              draft.meetingRules.parkingVehicleLimit
                            }
                            onChange={(event) =>
                              patchMeetingRules({
                                parkingVehicleLimit: Math.min(
                                  100,
                                  Math.max(
                                    1,
                                    Number(event.target.value) || 1,
                                  ),
                                ),
                              })
                            }
                          />
                          <span>辆</span>
                        </div>
                      </Field>
                      <Field label="商务餐参考下限">
                        <div className="admin-input-suffix">
                          <input
                            min={0}
                            max={100000}
                            type="number"
                            value={draft.meetingRules.businessMealMin}
                            onChange={(event) =>
                              patchMeetingRules({
                                businessMealMin: Math.min(
                                  100000,
                                  Math.max(
                                    0,
                                    Number(event.target.value) || 0,
                                  ),
                                ),
                                businessMealMax: Math.max(
                                  draft.meetingRules.businessMealMax,
                                  Math.min(
                                    100000,
                                    Math.max(
                                      0,
                                      Number(event.target.value) || 0,
                                    ),
                                  ),
                                ),
                              })
                            }
                          />
                          <span>元/人</span>
                        </div>
                      </Field>
                      <Field label="商务餐参考上限">
                        <div className="admin-input-suffix">
                          <input
                            min={0}
                            max={100000}
                            type="number"
                            value={draft.meetingRules.businessMealMax}
                            onChange={(event) =>
                              patchMeetingRules({
                                businessMealMax: Math.min(
                                  100000,
                                  Math.max(
                                    draft.meetingRules.businessMealMin,
                                    Number(event.target.value) || 0,
                                  ),
                                ),
                              })
                            }
                          />
                          <span>元/人</span>
                        </div>
                      </Field>
                      <Field label="大型会议加水间隔">
                        <div className="admin-input-suffix">
                          <input
                            min={5}
                            max={240}
                            type="number"
                            value={
                              draft.meetingRules
                                .waterServiceIntervalMinutes
                            }
                            onChange={(event) =>
                              patchMeetingRules({
                                waterServiceIntervalMinutes: Math.min(
                                  240,
                                  Math.max(
                                    5,
                                    Number(event.target.value) || 5,
                                  ),
                                ),
                              })
                            }
                          />
                          <span>分钟</span>
                        </div>
                      </Field>
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="REMINDERS"
                      title="风险提醒"
                      description="关闭后，对应风险不再出现在会议概览中。"
                    />
                    <div className="admin-setting-list">
                      {REMINDER_LABELS.map((item) => (
                        <div className="admin-setting-line" key={item.key}>
                          <div>
                            <strong>{item.label}</strong>
                            <span>{item.description}</span>
                          </div>
                          <Toggle
                            label={item.label}
                            checked={
                              draft.meetingRules.reminders[item.key]
                            }
                            onChange={(checked) =>
                              patchMeetingRules({
                                reminders: {
                                  ...draft.meetingRules.reminders,
                                  [item.key]: checked,
                                },
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div hidden={activeSection !== "contacts"}>
                <ContactsPanel
                  onDirtyChange={setContactEditorDirty}
                  onBusyChange={setContactEditorBusy}
                />
              </div>

              {activeSection === "rooms" && (
                <div className="admin-section-stack">
                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="MEETING ROOMS"
                      title="会议室管理"
                      description="维护可预约的会议室。新建会议和智能助手只显示已启用的会议室，选中后会自动带入地点、规模和场地要求。"
                      action={
                        <button
                          className="assistant-button primary compact"
                          type="button"
                          onClick={addMeetingRoom}
                        >
                          <Plus size={14} />
                          新增会议室
                        </button>
                      }
                    />
                    <div className="admin-form-grid">
                      <Field
                        label="默认会议室"
                        hint="创建会议时优先选中；仍可切换为其他会议室或自定义地点。"
                        className="wide"
                      >
                        <select
                          value={draft.organization.defaultMeetingRoomId}
                          onChange={(event) =>
                            patchOrganization({
                              defaultMeetingRoomId: event.target.value,
                            })
                          }
                        >
                          <option value="">不预设会议室</option>
                          {draft.meetingRooms
                            .filter((room) => room.enabled)
                            .map((room) => (
                              <option key={room.id} value={room.id}>
                                {room.name}
                                {room.capacity ? `（${room.capacity}人）` : ""}
                              </option>
                            ))}
                        </select>
                      </Field>
                    </div>
                  </div>

                  {draft.meetingRooms.length ? (
                    <div className="admin-room-list">
                      {draft.meetingRooms.map((room) => (
                        <article
                          className={`assistant-panel admin-card admin-room-card${
                            room.enabled ? "" : " is-disabled"
                          }`}
                          key={room.id}
                        >
                          <div className="admin-room-card__top">
                            <div>
                              <DoorOpen aria-hidden="true" />
                              <span>
                                <strong>{room.name || "未命名会议室"}</strong>
                                <small>
                                  {room.enabled ? "组织会议时可选择" : "已停用"}
                                </small>
                              </span>
                            </div>
                            <Toggle
                              label={`${room.name}启用状态`}
                              checked={room.enabled}
                              onChange={(enabled) =>
                                patchMeetingRoom(room.id, { enabled })
                              }
                            />
                            <button
                              type="button"
                              className="admin-delete-button"
                              onClick={() => removeMeetingRoom(room.id)}
                            >
                              <Trash2 />
                              删除
                            </button>
                          </div>
                          <div className="admin-form-grid">
                            <Field label="会议室名称">
                              <input
                                id={`${room.id}-name`}
                                maxLength={100}
                                value={room.name}
                                placeholder="例如：三楼大会议室"
                                onChange={(event) =>
                                  patchMeetingRoom(room.id, {
                                    name: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="所在位置">
                              <input
                                maxLength={160}
                                value={room.location}
                                placeholder="例如：公司三楼东侧"
                                onChange={(event) =>
                                  patchMeetingRoom(room.id, {
                                    location: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field label="会议室面积（㎡）">
                              <input type="number" min={0.1} max={100000} step="0.1" value={room.areaSqm ?? ""} placeholder="未登记" onChange={(event) => patchMeetingRoom(room.id, { areaSqm: event.target.value === "" ? undefined : Number(event.target.value) })} />
                            </Field>
                            <Field label="会议桌尺寸" hint="按实际报送尺寸填写，不自动推算可坐人数。">
                              <input maxLength={120} value={room.tableDimensions ?? ""} placeholder="例如：3.2m × 1.4m" onChange={(event) => patchMeetingRoom(room.id, { tableDimensions: event.target.value })} />
                            </Field>
                            <Field label="容纳人数" hint="0 表示未登记；不能仅凭面积或桌子尺寸推算。">
                              <div className="admin-input-suffix">
                                <input
                                  type="number"
                                  min={0}
                                  max={5000}
                                  value={room.capacity}
                                  onChange={(event) =>
                                    patchMeetingRoom(room.id, {
                                      capacity: Math.min(
                                        5000,
                                        Math.max(
                                          0,
                                          Number(event.target.value) || 0,
                                        ),
                                      ),
                                    })
                                  }
                                />
                                <span>人</span>
                              </div>
                            </Field>
                            <Field label="会议室规模">
                              <select
                                value={room.roomSize}
                                onChange={(event) =>
                                  patchMeetingRoom(room.id, {
                                    roomSize: event.target.value as
                                      | "small"
                                      | "large",
                                  })
                                }
                              >
                                <option value="small">小型会议室</option>
                                <option value="large">大型会议室</option>
                              </select>
                            </Field>
                            <Field
                              label="现有设备"
                              hint="每行一个，例如：投影仪、电视屏、视频会议、电子桌签。"
                            >
                              <textarea
                                rows={4}
                                maxLength={3000}
                                value={room.equipment.join("\n")}
                                onChange={(event) =>
                                  patchMeetingRoom(room.id, {
                                    equipment: splitEditableLines(
                                      event.target.value,
                                    ),
                                  })
                                }
                                onBlur={(event) =>
                                  patchMeetingRoom(room.id, {
                                    equipment: compactEditableLines(
                                      splitEditableLines(
                                        event.currentTarget.value,
                                      ),
                                    ),
                                  })
                                }
                              />
                            </Field>
                            <Field
                              label="场地要求"
                              hint="选中会议室后会带入单次会议，便于会务人员核对。"
                            >
                              <textarea
                                rows={4}
                                maxLength={2000}
                                value={room.requirements}
                                placeholder="例如：使用后关闭中控；桌椅采用U型摆放。"
                                onChange={(event) =>
                                  patchMeetingRoom(room.id, {
                                    requirements: event.target.value,
                                  })
                                }
                              />
                            </Field>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="assistant-panel admin-empty-state">
                      <DoorOpen />
                      <strong>尚未配置会议室</strong>
                      <span>新增会议室后，组织会议时即可直接选择。</span>
                      <button
                        className="assistant-button secondary compact"
                        type="button"
                        onClick={addMeetingRoom}
                      >
                        <Plus size={14} />
                        新增第一个会议室
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeSection === "checklist" && (
                <div className="assistant-panel admin-card">
                  <SectionHeading
                    eyebrow="CHECKLIST TEMPLATES"
                    title="会议清单模板"
                    description={`共 ${draft.checklistTemplates.length} 项，当前启用 ${enabledChecklistCount} 项。清单顺序也会成为新会议中的默认显示顺序。`}
                    action={
                      <button
                        className="assistant-button primary compact"
                        type="button"
                        onClick={addChecklistItem}
                      >
                        <Plus size={14} />
                        新增事项
                      </button>
                    }
                  />
                  <div className="admin-template-list">
                    {draft.checklistTemplates.map((item, index) => {
                      const expanded = expandedTaskId === item.id;
                      return (
                        <article
                          id={`admin-task-${item.id}`}
                          className={`admin-template-item${
                            item.enabled ? "" : " is-disabled"
                          }`}
                          key={item.id}
                        >
                          <div className="admin-template-item__summary">
                            <span className="admin-template-item__order">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="admin-template-item__main">
                              <strong>{item.title || "未命名事项"}</strong>
                              <span>
                                {
                                  PHASE_OPTIONS.find(
                                    (option) =>
                                      option.value === item.phase,
                                  )?.label
                                }
                                · {item.group || "未分组"} ·
                                {item.dueOffsetDays === 0
                                  ? " 会议当天"
                                  : item.dueOffsetDays < 0
                                    ? ` 提前 ${Math.abs(item.dueOffsetDays)} 天`
                                    : ` 会后 ${item.dueOffsetDays} 天`}
                              </span>
                            </div>
                            <Toggle
                              label={`${item.title}启用状态`}
                              checked={item.enabled}
                              onChange={(enabled) =>
                                patchChecklistItem(item.id, { enabled })
                              }
                            />
                            <div className="admin-icon-actions">
                              <button
                                type="button"
                                title="上移"
                                disabled={index === 0}
                                onClick={() =>
                                  moveChecklistItem(item.id, -1)
                                }
                              >
                                <ChevronUp />
                              </button>
                              <button
                                type="button"
                                title="下移"
                                disabled={
                                  index ===
                                  draft.checklistTemplates.length - 1
                                }
                                onClick={() =>
                                  moveChecklistItem(item.id, 1)
                                }
                              >
                                <ChevronDown />
                              </button>
                              <button
                                type="button"
                                title="复制"
                                onClick={() =>
                                  duplicateChecklistItem(item)
                                }
                              >
                                <Copy />
                              </button>
                              <button
                                type="button"
                                title="删除"
                                className="danger"
                                disabled={
                                  draft.checklistTemplates.length <= 1
                                }
                                onClick={() =>
                                  removeChecklistItem(item.id)
                                }
                              >
                                <Trash2 />
                              </button>
                            </div>
                            <button
                              className="admin-template-item__expand"
                              type="button"
                              aria-expanded={expanded}
                              onClick={() =>
                                setExpandedTaskId(expanded ? "" : item.id)
                              }
                            >
                              {expanded ? "收起" : "编辑"}
                              <ChevronDown />
                            </button>
                          </div>
                          {expanded && (
                            <div className="admin-template-editor">
                              <Field label="事项标题" className="wide">
                                <input
                                  maxLength={120}
                                  value={item.title}
                                  onChange={(event) =>
                                    patchChecklistItem(item.id, {
                                      title: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field
                                label="执行说明"
                                className="wide"
                              >
                                <textarea
                                  maxLength={1000}
                                  rows={3}
                                  value={item.description}
                                  onChange={(event) =>
                                    patchChecklistItem(item.id, {
                                      description: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field label="阶段">
                                <select
                                  value={item.phase}
                                  onChange={(event) =>
                                    patchChecklistItem(item.id, {
                                      phase: event.target.value as
                                        ChecklistTemplateConfig["phase"],
                                    })
                                  }
                                >
                                  {PHASE_OPTIONS.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="分组">
                                <input
                                  maxLength={80}
                                  value={item.group}
                                  onChange={(event) =>
                                    patchChecklistItem(item.id, {
                                      group: event.target.value,
                                    })
                                  }
                                />
                              </Field>
                              <Field
                                label="生成条件"
                                hint="满足条件时才会加入新会议"
                              >
                                <select
                                  value={item.condition}
                                  onChange={(event) =>
                                    patchChecklistItem(item.id, {
                                      condition: event.target.value as
                                        ChecklistTemplateConfig["condition"],
                                    })
                                  }
                                >
                                  {CONDITION_OPTIONS.map((option) => (
                                    <option
                                      key={option.value}
                                      value={option.value}
                                    >
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field
                                label="截止日期偏移"
                                hint="负数为会前，0为当天，正数为会后"
                              >
                                <div className="admin-input-suffix">
                                  <input
                                    min={-60}
                                    max={365}
                                    type="number"
                                    value={item.dueOffsetDays}
                                    onChange={(event) =>
                                      patchChecklistItem(item.id, {
                                        dueOffsetDays: Math.min(
                                          365,
                                          Math.max(
                                            -60,
                                            Number(event.target.value) || 0,
                                          ),
                                        ),
                                      })
                                    }
                                  />
                                  <span>天</span>
                                </div>
                              </Field>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              {activeSection === "aliases" && (
                <div className="assistant-panel admin-card">
                  <SectionHeading
                    eyebrow="UNIT DICTIONARY"
                    title="单位名称字典"
                    description="将常见简称、旧称和不同写法归到统一单位名称。自动合并适合确定映射，人工确认适合可能存在歧义的写法。"
                    action={
                      <button
                        className="assistant-button primary compact"
                        type="button"
                        onClick={addAlias}
                      >
                        <Plus size={14} />
                        新增映射
                      </button>
                    }
                  />
                  {draft.rosterRules.aliases.length ? (
                    <div className="admin-alias-list">
                      {draft.rosterRules.aliases.map((alias) => (
                        <article className="admin-alias-card" key={alias.id}>
                          <div className="admin-alias-card__top">
                            <Toggle
                              label="单位映射启用状态"
                              checked={alias.enabled}
                              onChange={(enabled) =>
                                patchAlias(alias.id, { enabled })
                              }
                            />
                            <select
                              aria-label="合并方式"
                              value={alias.mode}
                              onChange={(event) =>
                                patchAlias(alias.id, {
                                  mode: event.target.value as
                                    | "auto"
                                    | "confirm",
                                })
                              }
                            >
                              <option value="confirm">人工确认</option>
                              <option value="auto">自动合并</option>
                            </select>
                            <button
                              type="button"
                              className="admin-delete-button"
                              onClick={() => removeAlias(alias.id)}
                            >
                              <Trash2 />
                              删除
                            </button>
                          </div>
                          <div className="admin-form-grid">
                            <Field label="标准单位名称">
                              <input
                                maxLength={160}
                                placeholder="例如：上海九誓科技有限公司"
                                value={alias.canonical}
                                onChange={(event) =>
                                  patchAlias(alias.id, {
                                    canonical: event.target.value,
                                  })
                                }
                              />
                            </Field>
                            <Field
                              label="简称或其他写法"
                              hint="多个写法请用换行分隔"
                            >
                              <textarea
                                maxLength={8050}
                                rows={3}
                                placeholder={"上海九誓\n九誓科技"}
                                value={alias.aliases.join("\n")}
                                onChange={(event) =>
                                  patchAlias(alias.id, {
                                    // Keep trailing empty lines while editing so
                                    // pressing Enter actually creates a new row.
                                    aliases: splitEditableLines(
                                      event.target.value,
                                    ),
                                  })
                                }
                                onBlur={(event) =>
                                  patchAlias(alias.id, {
                                    aliases: compactEditableLines(
                                      splitEditableLines(
                                        event.currentTarget.value,
                                      ),
                                    ),
                                  })
                                }
                              />
                            </Field>
                            <Field label="备注" className="wide">
                              <input
                                maxLength={300}
                                placeholder="记录映射来源或使用边界"
                                value={alias.notes}
                                onChange={(event) =>
                                  patchAlias(alias.id, {
                                    notes: event.target.value,
                                  })
                                }
                              />
                            </Field>
                          </div>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className="admin-empty-state">
                      <BookOpen />
                      <strong>尚未维护单位名称映射</strong>
                      <span>
                        添加后，名单治理可以自动识别简称并输出统一名称。
                      </span>
                      <button
                        className="assistant-button secondary compact"
                        type="button"
                        onClick={addAlias}
                      >
                        <Plus size={14} />
                        新增第一条映射
                      </button>
                    </div>
                  )}
                </div>
              )}

              {activeSection === "roster" && (
                <div className="admin-section-stack">
                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="SORTING"
                      title="名单排序规则"
                      description="默认先按单位层级，再在同单位内按职务层级；所有规则均可修改。"
                    />
                    <div className="admin-form-grid">
                      <Field label="单位排序方式">
                        <select
                          value={draft.rosterRules.ranking.mode}
                          onChange={(event) =>
                            patchRanking({
                              mode: event.target.value as
                                | "authority"
                                | "pinyin",
                            })
                          }
                        >
                          <option value="authority">单位层级优先</option>
                          <option value="pinyin">单位拼音排序（兼容模式）</option>
                        </select>
                      </Field>
                      <Field label="同单位人员顺序">
                        <select
                          value={draft.rosterRules.withinUnitOrder}
                          onChange={(event) =>
                            patchRosterRules({
                              withinUnitOrder: event.target.value as
                                | "title"
                                | "source"
                                | "name",
                            })
                          }
                        >
                          <option value="title">按职务层级</option>
                          <option value="source">保留原始顺序</option>
                          <option value="name">按姓名拼音排序</option>
                        </select>
                      </Field>
                      {draft.rosterRules.ranking.mode === "pinyin" && (
                        <Field label="拼音排序方向">
                          <select
                            value={draft.rosterRules.sortDirection}
                            onChange={(event) =>
                              patchRosterRules({
                                sortDirection: event.target.value as
                                  | "asc"
                                  | "desc",
                              })
                            }
                          >
                            <option value="asc">升序（A → Z）</option>
                            <option value="desc">降序（Z → A）</option>
                          </select>
                        </Field>
                      )}
                    </div>
                    <div className="admin-inline-note">
                      <ShieldCheck />
                      <span>
                        AI 和联网结果只生成排序建议；确认前不会改名单，也不会自动覆盖已有职务。
                      </span>
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="UNIT AUTHORITY"
                      title="单位层级"
                      description="数字越小越靠前。关键词仅作初步识别，具体单位可在下方设置覆盖规则。"
                      action={
                        <button
                          className="assistant-button secondary compact"
                          type="button"
                          onClick={() => addRankingTier("unitTiers")}
                        >
                          <Plus size={14} />
                          新增层级
                        </button>
                      }
                    />
                    <RankingTierEditor
                      tiers={draft.rosterRules.ranking.unitTiers}
                      fallbackId={draft.rosterRules.ranking.unknownUnitTierId}
                      onPatch={(id, patch) =>
                        patchRankingTier("unitTiers", id, patch)
                      }
                      onRemove={(id) => removeRankingTier("unitTiers", id)}
                    />
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="UNIT OVERRIDES"
                      title="指定单位优先级"
                      description="用于修正名称无法判断的单位；单位名称按标准全称精确匹配。"
                      action={
                        <button
                          className="assistant-button secondary compact"
                          type="button"
                          onClick={addUnitOverride}
                        >
                          <Plus size={14} />
                          新增指定单位
                        </button>
                      }
                    />
                    {draft.rosterRules.ranking.unitOverrides.length ? (
                      <div className="admin-ranking-overrides">
                        {draft.rosterRules.ranking.unitOverrides.map((rule) => (
                          <div className="admin-ranking-override" key={rule.id}>
                            <Toggle
                              checked={rule.enabled}
                              label={`${rule.unit || "新单位"}启用状态`}
                              onChange={(enabled) =>
                                patchUnitOverride(rule.id, { enabled })
                              }
                            />
                            <input
                              aria-label="标准单位全称"
                              placeholder="标准单位全称"
                              value={rule.unit}
                              onChange={(event) =>
                                patchUnitOverride(rule.id, {
                                  unit: event.target.value,
                                })
                              }
                            />
                            <select
                              aria-label="单位层级"
                              value={rule.tierId}
                              onChange={(event) =>
                                patchUnitOverride(rule.id, {
                                  tierId: event.target.value,
                                })
                              }
                            >
                              {draft.rosterRules.ranking.unitTiers.map((tier) => (
                                <option key={tier.id} value={tier.id}>
                                  {tier.label}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label="同层级顺序"
                              type="number"
                              min={0}
                              max={100000}
                              value={rule.withinTierOrder}
                              onChange={(event) =>
                                patchUnitOverride(rule.id, {
                                  withinTierOrder: Math.min(
                                    100000,
                                    Math.max(0, Number(event.target.value) || 0),
                                  ),
                                })
                              }
                            />
                            <button
                              type="button"
                              className="admin-icon-button danger"
                              title="删除指定单位规则"
                              onClick={() => removeUnitOverride(rule.id)}
                            >
                              <Trash2 />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="admin-empty-state compact">
                        <Building2 />
                        <strong>尚未指定具体单位</strong>
                        <span>仅依靠上方关键词规则；遇到特殊单位时再添加即可。</span>
                      </div>
                    )}
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="TITLE SENIORITY"
                      title="职务层级"
                      description="同单位内部按此层级排列；最长关键词优先，例如“副董事长”不会误判成“董事长”。"
                      action={
                        <button
                          className="assistant-button secondary compact"
                          type="button"
                          onClick={() => addRankingTier("titleTiers")}
                        >
                          <Plus size={14} />
                          新增层级
                        </button>
                      }
                    />
                    <RankingTierEditor
                      tiers={draft.rosterRules.ranking.titleTiers}
                      fallbackId={draft.rosterRules.ranking.unknownTitleTierId}
                      onPatch={(id, patch) =>
                        patchRankingTier("titleTiers", id, patch)
                      }
                      onRemove={(id) => removeRankingTier("titleTiers", id)}
                    />
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="OUTPUT COLUMNS"
                      title="Excel 输出字段"
                      description={`当前启用 ${enabledOutputFieldCount} 列。拖动的替代操作为上下移动，便于键盘和触屏使用。`}
                    />
                    <div className="admin-output-list">
                      {draft.rosterRules.outputFields.map((field, index) => (
                        <div className="admin-output-row" key={field.key}>
                          <span className="admin-output-row__order">
                            {index + 1}
                          </span>
                          <Toggle
                            label={`${field.label}输出状态`}
                            checked={field.enabled}
                            disabled={
                              field.key === "name" ||
                              field.key === "unit"
                            }
                            onChange={(enabled) =>
                              patchOutputField(field.key, { enabled })
                            }
                          />
                          <div className="admin-output-row__key">
                            <strong>{field.label}</strong>
                            <code>{field.key}</code>
                          </div>
                          <Field label="表头名称">
                            <input
                              value={field.label}
                              onChange={(event) =>
                                patchOutputField(field.key, {
                                  label: event.target.value,
                                })
                              }
                            />
                          </Field>
                          <Field label="列宽">
                            <input
                              min={6}
                              max={80}
                              type="number"
                              value={field.width}
                              onChange={(event) =>
                                patchOutputField(field.key, {
                                  width: Math.min(
                                    80,
                                    Math.max(
                                      6,
                                      Number(event.target.value) || 6,
                                    ),
                                  ),
                                })
                              }
                            />
                          </Field>
                          <div className="admin-icon-actions">
                            <button
                              type="button"
                              title="上移"
                              disabled={index === 0}
                              onClick={() =>
                                moveOutputField(field.key, -1)
                              }
                            >
                              <ChevronUp />
                            </button>
                            <button
                              type="button"
                              title="下移"
                              disabled={
                                index ===
                                draft.rosterRules.outputFields.length - 1
                              }
                              onClick={() =>
                                moveOutputField(field.key, 1)
                              }
                            >
                              <ChevronDown />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="EXCEL EXPORT"
                      title="文件与工作表"
                      description="文件名支持占位符：{会议名称}、{日期}、{时间}。"
                    />
                    <div className="admin-form-grid">
                      <Field label="导出文件名模板">
                        <input
                          maxLength={120}
                          value={
                            draft.rosterRules.exportFileNameTemplate
                          }
                          onChange={(event) =>
                            patchRosterRules({
                              exportFileNameTemplate: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field label="工作表名称">
                        <input
                          maxLength={31}
                          value={draft.rosterRules.worksheetName}
                          onChange={(event) =>
                            patchRosterRules({
                              worksheetName: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="admin-setting-list compact">
                      <div className="admin-setting-line">
                        <div>
                          <strong>启用自动筛选</strong>
                          <span>在 Excel 表头添加筛选按钮</span>
                        </div>
                        <Toggle
                          label="启用自动筛选"
                          checked={draft.rosterRules.autoFilter}
                          onChange={(autoFilter) =>
                            patchRosterRules({ autoFilter })
                          }
                        />
                      </div>
                      <div className="admin-setting-line">
                        <div>
                          <strong>冻结首行</strong>
                          <span>滚动名单时始终显示表头</span>
                        </div>
                        <Toggle
                          label="冻结首行"
                          checked={draft.rosterRules.freezeHeader}
                          onChange={(freezeHeader) =>
                            patchRosterRules({ freezeHeader })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="AI EXTRACTION"
                      title="AI 提取补充要求"
                      description="追加到系统内置提取提示词末尾。只填写公司的特殊口径，不必重复通用要求。"
                    />
                    <Field
                      label="补充提示词"
                      hint="例如：优先将集团名称识别为单位、子公司名称识别为部门。留空时使用系统默认提示词。"
                    >
                      <textarea
                        maxLength={5000}
                        rows={5}
                        value={draft.rosterRules.extractionPromptSuffix}
                        onChange={(event) =>
                          patchRosterRules({
                            extractionPromptSuffix: event.target.value,
                          })
                        }
                      />
                    </Field>
                  </div>
                </div>
              )}

              {activeSection === "maintenance" && (
                <div className="admin-section-stack">
                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="PUBLISH"
                      title="保存全部配置草稿"
                      description="这里会提交各配置页的所有未保存修改，并创建可回滚的新版本。日常编辑请使用各页面底部的保存按钮。"
                    />
                    <div className="admin-publish-row">
                      <Field label="版本说明">
                        <input
                          maxLength={100}
                          value={publishSummary}
                          onChange={(event) =>
                            setPublishSummary(event.target.value)
                          }
                        />
                      </Field>
                      <button
                        className="assistant-button primary"
                        type="button"
                        disabled={!dirty || saving || loading || configConflict || Boolean(error)}
                        onClick={() =>
                          void publishConfig(draft, publishSummary)
                        }
                      >
                        <Save size={15} />
                        {saving ? "正在保存" : "保存全部配置"}
                      </button>
                    </div>
                    <div className="admin-impact-note">
                      <AlertTriangle />
                      <span>
                        会议模板不会改写已有会议任务；名单字典、排序和 Excel 规则会在下一次整理或导出时使用。
                      </span>
                    </div>
                  </div>

                  <div className="admin-maintenance-grid">
                    <div className="assistant-panel admin-card">
                      <SectionHeading
                        eyebrow="BACKUP"
                        title="导入与导出"
                        description="用 JSON 文件在设备间迁移配置，导入后仍需手动发布。"
                      />
                      <div className="admin-action-list">
                        <button
                          className="admin-action-button"
                          type="button"
                          onClick={exportConfig}
                        >
                          <Download />
                          <span>
                            <strong>导出当前草稿</strong>
                            <small>下载完整 JSON 配置备份</small>
                          </span>
                        </button>
                        <button
                          className="admin-action-button"
                          type="button"
                          onClick={() => importInputRef.current?.click()}
                        >
                          <Upload />
                          <span>
                            <strong>导入配置文件</strong>
                            <small>读取并校验 schemaVersion 1</small>
                          </span>
                        </button>
                        <input
                          ref={importInputRef}
                          hidden
                          type="file"
                          accept="application/json,.json"
                          onChange={(event) => void importConfig(event)}
                        />
                      </div>
                    </div>

                    <div className="assistant-panel admin-card">
                      <SectionHeading
                        eyebrow="RESET"
                        title="恢复系统默认"
                        description="恢复最初内置的29项清单及所有默认规则，并发布为新版本。"
                      />
                      <button
                        className="admin-reset-button"
                        type="button"
                        disabled={saving}
                        onClick={() => {
                          if (
                            window.confirm(
                              "确定恢复系统默认配置吗？当前配置仍会保留在历史版本中。",
                            )
                          ) {
                            void publishConfig(
                              cloneAdminConfig(DEFAULT_ADMIN_CONFIG),
                              "恢复默认配置",
                            );
                          }
                        }}
                      >
                        <RotateCcw />
                        <span>
                          <strong>恢复默认并发布</strong>
                          <small>不会修改已经创建的会议</small>
                        </span>
                      </button>
                    </div>
                  </div>

                  <div className="assistant-panel admin-card">
                    <SectionHeading
                      eyebrow="VERSION HISTORY"
                      title="历史版本"
                      description="选择历史版本并重新发布。回滚不会删除之后的版本，因此仍可再次恢复。"
                    />
                    {history.length ? (
                      <>
                        <div className="admin-history-list">
                          {history.map((entry) => (
                            <button
                              type="button"
                              key={`${entry.revision}-${entry.updatedAt}`}
                              className={
                                selectedHistoryRevision === entry.revision
                                  ? "is-selected"
                                  : ""
                              }
                              onClick={() =>
                                setSelectedHistoryRevision(entry.revision)
                              }
                            >
                              <span className="admin-history-revision">
                                r{entry.revision}
                              </span>
                              <span>
                                <strong>{entry.summary}</strong>
                                <small>
                                  {formatDateTime(entry.updatedAt)}
                                </small>
                              </span>
                              {entry.revision === revision && (
                                <span className="admin-current-label">
                                  当前
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                        <button
                          className="assistant-button secondary"
                          type="button"
                          disabled={
                            selectedHistoryRevision === null ||
                            selectedHistoryRevision === revision ||
                            saving
                          }
                          onClick={() => void rollbackConfig()}
                        >
                          <Undo2 size={15} />
                          将选中版本重新发布
                        </button>
                      </>
                    ) : (
                      <div className="admin-empty-state compact">
                        <History />
                        <strong>暂无历史版本</strong>
                        <span>再次发布配置后，这里会显示可回滚的上一版本。</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
          </div>
          {editSection ? (
            <footer className="editor-save-bar" aria-label={`${ADMIN_EDIT_SECTIONS[editSection]}保存操作`}>
              <div><strong>{sectionDirty ? "当前页有未保存修改" : "当前页已保存"}</strong><span>仅保存{ADMIN_EDIT_SECTIONS[editSection]}，不提交其他页面的草稿</span></div>
              <div className="editor-save-bar__actions">
                <button className="assistant-button secondary" type="button" disabled={!sectionDirty || saving || loading} onClick={() => setDraft((current) => replaceAdminSection(current, config, editSection))}>取消本页修改</button>
                <button className="assistant-button primary" type="button" disabled={!sectionDirty || saving || loading || configConflict || Boolean(error)} onClick={() => void publishConfig(replaceAdminSection(config, draft, editSection), `保存${ADMIN_EDIT_SECTIONS[editSection]}`, editSection)}><Save size={15} />{saving ? "正在保存…" : `保存${ADMIN_EDIT_SECTIONS[editSection]}`}</button>
              </div>
            </footer>
          ) : null}
        </section>
      </div>
      </div>
    </AssistantShell>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="admin-card-heading">
      <div>
        <span>{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}

function OverviewSection({
  draft,
  revision,
  summary,
  updatedAt,
  enabledChecklistCount,
  enabledOutputFieldCount,
  enabledAliasesCount,
  dirty,
  onNavigate,
}: {
  draft: AdminConfig;
  revision: number;
  summary: string;
  updatedAt: string;
  enabledChecklistCount: number;
  enabledOutputFieldCount: number;
  enabledAliasesCount: number;
  dirty: boolean;
  onNavigate: (section: SectionId) => void;
}) {
  const reminderCount = Object.values(
    draft.meetingRules.reminders,
  ).filter(Boolean).length;
  return (
    <div className="admin-section-stack">
      <div className="admin-overview-hero assistant-panel">
        <div>
          <span className="admin-overview-hero__eyebrow">
            CONFIGURATION CENTER
          </span>
          <h2>{draft.organization.name || "未命名组织"}</h2>
          <p>
            {dirty ? "未发布草稿预览" : `当前发布版本 r${revision}`} ·{" "}
            {summary}
          </p>
          <small>最近发布：{formatDateTime(updatedAt)}</small>
        </div>
        <div className="admin-overview-hero__status">
          {dirty ? <AlertTriangle /> : <CheckCircle2 />}
          <span>
            <strong>{dirty ? "有修改尚未发布" : "当前配置已生效"}</strong>
            <small>配置格式版本 {draft.schemaVersion}</small>
          </span>
        </div>
      </div>

      <div className="admin-stat-grid">
        <button type="button" onClick={() => onNavigate("checklist")}>
          <span className="blue">
            <ListChecks />
          </span>
          <div>
            <strong>{enabledChecklistCount}</strong>
            <small>项清单模板启用</small>
          </div>
          <em>共 {draft.checklistTemplates.length} 项</em>
        </button>
        <button type="button" onClick={() => onNavigate("aliases")}>
          <span className="violet">
            <BookOpen />
          </span>
          <div>
            <strong>{enabledAliasesCount}</strong>
            <small>条单位映射启用</small>
          </div>
          <em>共 {draft.rosterRules.aliases.length} 条</em>
        </button>
        <button type="button" onClick={() => onNavigate("roster")}>
          <span className="green">
            <FileSpreadsheet />
          </span>
          <div>
            <strong>{enabledOutputFieldCount}</strong>
            <small>列名单字段输出</small>
          </div>
          <em>
            {draft.rosterRules.sortDirection === "asc"
              ? "单位升序"
              : "单位降序"}
          </em>
        </button>
        <button type="button" onClick={() => onNavigate("organization")}>
          <span className="orange">
            <AlertTriangle />
          </span>
          <div>
            <strong>{reminderCount}</strong>
            <small>类风险提醒启用</small>
          </div>
          <em>共 5 类</em>
        </button>
      </div>

      <div className="admin-overview-grid">
        <div className="assistant-panel admin-card">
          <SectionHeading
            eyebrow="MEETING DEFAULTS"
            title="新会议默认口径"
            description="这些值会在创建页面中预填。"
          />
          <dl className="admin-definition-list">
            <div>
              <dt>会务负责人</dt>
              <dd>{draft.organization.defaultOwner || "未设置"}</dd>
            </div>
            <div>
              <dt>开始时间</dt>
              <dd>{draft.organization.defaultStartTime}</dd>
            </div>
            <div>
              <dt>参会人数</dt>
              <dd>{draft.organization.defaultAttendeeEstimate} 人</dd>
            </div>
            <div>
              <dt>会议规模</dt>
              <dd>
                {draft.organization.defaultRoomSize === "large"
                  ? "大型会议"
                  : "小型会议"}
              </dd>
            </div>
            <div>
              <dt>停车上限</dt>
              <dd>{draft.meetingRules.parkingVehicleLimit} 辆</dd>
            </div>
            <div>
              <dt>加水间隔</dt>
              <dd>
                {draft.meetingRules.waterServiceIntervalMinutes} 分钟
              </dd>
            </div>
          </dl>
          <button
            className="assistant-button secondary compact"
            type="button"
            onClick={() => onNavigate("organization")}
          >
            <Settings size={14} />
            修改默认口径
          </button>
        </div>

        <div className="assistant-panel admin-card">
          <SectionHeading
            eyebrow="CONFIGURATION SCOPE"
            title="生效边界"
            description="配置变更与业务数据保持明确隔离。"
          />
          <div className="admin-scope-list">
            <div>
              <CheckCircle2 />
              <span>
                <strong>以后新建的会议</strong>
                <small>使用最新清单模板、默认值和提醒规则</small>
              </span>
            </div>
            <div>
              <CheckCircle2 />
              <span>
                <strong>以后整理的名单</strong>
                <small>使用最新单位字典、排序和 Excel 格式</small>
              </span>
            </div>
            <div className="muted">
              <ShieldCheck />
              <span>
                <strong>已有会议保持不变</strong>
                <small>不会覆盖已经核对、分配或完成的任务</small>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
