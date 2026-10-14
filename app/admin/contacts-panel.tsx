"use client";

import { confirmAction } from "../lib/confirmation";

import {
  AlertCircle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createContact,
  deleteContact,
  listContacts,
  syncHistoricalMeetingContacts,
  type ContactInput,
  type ContactListPayload,
  type ContactRecord,
  updateContact,
} from "../lib/contacts";
import { loadAllMeetings } from "../lib/meeting-data";
import {
  buildUnitDirectory,
  resolveCanonicalUnit,
  searchUnitDirectory,
} from "../lib/unit-directory";
import { useAdminConfig } from "../lib/use-admin-config";
import "./contacts-panel.css";

const PAGE_SIZE = 20;

const EMPTY_CONTACT: ContactInput = {
  name: "",
  unit: "",
  department: "",
  title: "",
};

type EditorState = {
  mode: "create" | "edit";
  id?: string;
  values: ContactInput;
  initialValues: ContactInput;
};

type Notice = {
  tone: "success" | "warning";
  text: string;
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatMeetingDate(value: string) {
  if (!value) return "日期未记录";
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (parts) return `${parts[1]}年${Number(parts[2])}月${Number(parts[3])}日`;
  return value;
}

export function ContactsPanel({
  onDirtyChange,
  onBusyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
} = {}) {
  const formHeadingId = useId();
  const unitInputId = useId();
  const unitListboxId = useId();
  const requestSequence = useRef(0);
  const historicalSyncStateRef = useRef<"idle" | "running" | "complete">("idle");
  const { config: adminConfig } = useAdminConfig();
  const [ready, setReady] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [payload, setPayload] = useState<ContactListPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [syncMessage, setSyncMessage] = useState("正在整理历史会议参会人…");
  const [syncError, setSyncError] = useState("");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [unitSuggestionsOpen, setUnitSuggestionsOpen] = useState(false);
  const [unitActiveIndex, setUnitActiveIndex] = useState(0);
  const editorDirty = Boolean(
    editor &&
      JSON.stringify(editor.values) !== JSON.stringify(editor.initialValues),
  );

  useEffect(() => {
    onDirtyChange?.(editorDirty);
  }, [editorDirty, onDirtyChange]);

  useEffect(() => {
    onBusyChange?.(saving || Boolean(deletingId));
  }, [deletingId, onBusyChange, saving]);

  const unitDirectory = useMemo(
    () => buildUnitDirectory(adminConfig.rosterRules.aliases),
    [adminConfig.rosterRules.aliases],
  );
  const unitMatches = useMemo(
    () => searchUnitDirectory(editor?.values.unit ?? "", unitDirectory),
    [editor?.values.unit, unitDirectory],
  );

  const totalPages = Math.max(
    1,
    Math.ceil((payload?.total ?? 0) / PAGE_SIZE),
  );

  const rangeLabel = useMemo(() => {
    if (!payload?.total || !payload.contacts.length) return "暂无联系人";
    const start = page * PAGE_SIZE + 1;
    const end = start + payload.contacts.length - 1;
    return `第 ${start}–${end} 位，共 ${payload.total} 位`;
  }, [page, payload]);

  useEffect(() => {
    if (historicalSyncStateRef.current === "complete") return;
    historicalSyncStateRef.current = "running";
    let disposed = false;
    const meetings = loadAllMeetings();
    const meetingsWithAttendees = meetings.filter(
      (meeting) => meeting.attendees.length > 0,
    );

    async function backfillContacts() {
      if (!meetingsWithAttendees.length) {
        if (!disposed) {
          setSyncMessage("暂无历史参会人需要补录");
          historicalSyncStateRef.current = "complete";
          setReady(true);
        }
        return;
      }

      try {
        const result = await syncHistoricalMeetingContacts(
          meetingsWithAttendees,
        );
        if (!disposed) {
          setSyncMessage(
            `已核对 ${meetingsWithAttendees.length} 场历史会议，通讯录现有 ${result.total} 位联系人${result.skipped ? `；${result.skipped} 人因单位缺失暂未同步` : ""}`,
          );
        }
      } catch (error) {
        if (!disposed) {
          setSyncError(errorMessage(error, "历史参会人自动补录失败"));
          setSyncMessage("");
        }
      } finally {
        if (!disposed) {
          historicalSyncStateRef.current = "complete";
          setReady(true);
        }
      }
    }

    void backfillContacts();
    return () => {
      disposed = true;
      if (historicalSyncStateRef.current === "running") {
        historicalSyncStateRef.current = "idle";
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryInput.trim());
      setPage(0);
    }, 220);
    return () => window.clearTimeout(timer);
  }, [queryInput]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;

    void listContacts({
      query,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      signal: controller.signal,
    })
      .then((result) => {
        if (requestSequence.current !== sequence) return;
        setPayload(result);
        const lastPage = Math.max(0, Math.ceil(result.total / PAGE_SIZE) - 1);
        if (page > lastPage) setPage(lastPage);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setListError(errorMessage(error, "通讯录读取失败"));
      })
      .finally(() => {
        if (requestSequence.current === sequence) setLoading(false);
      });

    return () => controller.abort();
  }, [page, query, ready, reloadKey]);

  function openCreateEditor() {
    setNotice(null);
    setUnitSuggestionsOpen(false);
    setUnitActiveIndex(0);
    setEditor({
      mode: "create",
      values: { ...EMPTY_CONTACT },
      initialValues: { ...EMPTY_CONTACT },
    });
  }

  function openEditEditor(contact: ContactRecord) {
    const standardUnit =
      resolveCanonicalUnit(contact.unit, unitDirectory)?.canonical ??
      contact.unit;
    setNotice(null);
    setUnitSuggestionsOpen(false);
    setUnitActiveIndex(0);
    const values = {
      name: contact.name,
      unit: standardUnit,
      department: contact.department,
      title: contact.title,
    };
    setEditor({
      mode: "edit",
      id: contact.id,
      values,
      initialValues: { ...values },
    });
  }

  function updateEditorField(field: keyof ContactInput, value: string) {
    setEditor((current) =>
      current
        ? { ...current, values: { ...current.values, [field]: value } }
        : current,
    );
  }

  function selectUnit(canonical: string) {
    updateEditorField("unit", canonical);
    setUnitSuggestionsOpen(false);
    setUnitActiveIndex(0);
  }

  function normalizeEditorUnit() {
    setUnitSuggestionsOpen(false);
    setEditor((current) => {
      if (!current) return current;
      const match = resolveCanonicalUnit(current.values.unit, unitDirectory);
      if (!match || match.canonical === current.values.unit) return current;
      return {
        ...current,
        values: { ...current.values, unit: match.canonical },
      };
    });
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || saving) return;
    const standardUnit =
      resolveCanonicalUnit(editor.values.unit, unitDirectory)?.canonical ??
      editor.values.unit.trim();
    const contact = {
      name: editor.values.name.trim(),
      unit: standardUnit,
      department: editor.values.department.trim(),
      title: editor.values.title.trim(),
    };
    if (!contact.name || !contact.unit) {
      setNotice({ tone: "warning", text: "请填写姓名和单位。" });
      return;
    }

    setSaving(true);
    setNotice(null);
    try {
      if (editor.mode === "edit" && editor.id) {
        await updateContact(editor.id, contact);
        setNotice({ tone: "success", text: `已更新 ${contact.name} 的信息。` });
      } else {
        await createContact(contact);
        setNotice({ tone: "success", text: `已将 ${contact.name} 加入通讯录。` });
      }
      setEditor(null);
      setLoading(true);
      setReloadKey((current) => current + 1);
    } catch (error) {
      setNotice({
        tone: "warning",
        text: errorMessage(error, "联系人保存失败"),
      });
    } finally {
      setSaving(false);
    }
  }

  async function removeContact(contact: ContactRecord) {
    if (deletingId) return;
    const confirmed = await confirmAction(
      `确定删除“${contact.name}（${contact.unit}）”吗？\n\n删除后不会影响已经保存的会议名单。`,
    );
    if (!confirmed) return;

    setDeletingId(contact.id);
    setNotice(null);
    try {
      await deleteContact(contact.id);
      setNotice({ tone: "success", text: `已删除联系人 ${contact.name}。` });
      if (editor?.id === contact.id) setEditor(null);
      if ((payload?.contacts.length ?? 0) === 1 && page > 0) {
        setLoading(true);
        setPage((current) => Math.max(0, current - 1));
      } else {
        setLoading(true);
        setReloadKey((current) => current + 1);
      }
    } catch (error) {
      setNotice({
        tone: "warning",
        text: errorMessage(error, "联系人删除失败"),
      });
    } finally {
      setDeletingId("");
    }
  }

  return (
    <section className="contacts-panel" aria-labelledby="contacts-heading">
      <header className="contacts-panel__header">
        <div className="contacts-panel__title">
          <span className="contacts-panel__title-icon" aria-hidden="true">
            <UsersRound />
          </span>
          <div>
            <span>CONTACT DIRECTORY</span>
            <h2 id="contacts-heading">参会人员通讯录</h2>
            <p>历史参会人自动沉淀；日后录入名单时可模糊搜索并带入完整信息。</p>
          </div>
        </div>
        <button
          className="contacts-panel__primary-button"
          type="button"
          onClick={openCreateEditor}
        >
          <Plus aria-hidden="true" />
          新增联系人
        </button>
      </header>

      <div
        className={`contacts-panel__sync ${syncError ? "is-warning" : ""}`}
        role={syncError ? "alert" : "status"}
        aria-live="polite"
      >
        {ready ? (
          syncError ? (
            <AlertCircle aria-hidden="true" />
          ) : (
            <Clock3 aria-hidden="true" />
          )
        ) : (
          <LoaderCircle className="is-spinning" aria-hidden="true" />
        )}
        <span>{syncError || syncMessage}</span>
      </div>

      {notice ? (
        <div
          className={`contacts-panel__notice is-${notice.tone}`}
          role={notice.tone === "warning" ? "alert" : "status"}
          aria-live="polite"
        >
          {notice.text}
        </div>
      ) : null}

      {editor ? (
        <form
          className="contacts-panel__editor"
          aria-labelledby={formHeadingId}
          onSubmit={submitContact}
        >
          <div className="contacts-panel__editor-heading">
            <div>
              <span>{editor.mode === "edit" ? "EDIT CONTACT" : "NEW CONTACT"}</span>
              <h3 id={formHeadingId}>
                {editor.mode === "edit" ? "修改联系人" : "新增联系人"}
              </h3>
              <p>保存后即时生效，不需要发布管理中心配置。</p>
            </div>
            <button
              type="button"
              aria-label="关闭联系人编辑表单"
              onClick={() => {
                setEditor(null);
                setUnitSuggestionsOpen(false);
              }}
              disabled={saving}
            >
              <X aria-hidden="true" />
            </button>
          </div>

          <div className="contacts-panel__form-grid">
            <label>
              <span>姓名 <em>*</em></span>
              <input
                value={editor.values.name}
                required
                maxLength={80}
                autoComplete="name"
                placeholder="例如：马晓勇"
                onChange={(event) => updateEditorField("name", event.target.value)}
              />
            </label>
            <div className="contacts-panel__field">
              <label htmlFor={unitInputId}>
                单位 <em>*</em>
              </label>
              <div className="contacts-panel__unit-combobox">
                <input
                  id={unitInputId}
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={unitSuggestionsOpen}
                  aria-controls={unitListboxId}
                  aria-activedescendant={
                    unitSuggestionsOpen && unitMatches[unitActiveIndex]
                      ? `${unitListboxId}-${unitActiveIndex}`
                      : undefined
                  }
                  value={editor.values.unit}
                  required
                  maxLength={200}
                  autoComplete="organization"
                  placeholder="输入全称、简称或旧称搜索"
                  onFocus={() => {
                    setUnitSuggestionsOpen(true);
                    setUnitActiveIndex(0);
                  }}
                  onBlur={normalizeEditorUnit}
                  onChange={(event) => {
                    updateEditorField("unit", event.target.value);
                    setUnitSuggestionsOpen(true);
                    setUnitActiveIndex(0);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowDown" && unitMatches.length) {
                      event.preventDefault();
                      setUnitSuggestionsOpen(true);
                      setUnitActiveIndex((current) =>
                        Math.min(current + 1, unitMatches.length - 1),
                      );
                    } else if (event.key === "ArrowUp" && unitMatches.length) {
                      event.preventDefault();
                      setUnitSuggestionsOpen(true);
                      setUnitActiveIndex((current) => Math.max(current - 1, 0));
                    } else if (
                      event.key === "Enter" &&
                      unitSuggestionsOpen &&
                      unitMatches[unitActiveIndex]
                    ) {
                      event.preventDefault();
                      selectUnit(unitMatches[unitActiveIndex].canonical);
                    } else if (event.key === "Escape") {
                      setUnitSuggestionsOpen(false);
                    }
                  }}
                />
                {unitSuggestionsOpen ? (
                  <div
                    id={unitListboxId}
                    className="contacts-panel__unit-options"
                    role="listbox"
                    aria-label="标准单位名称"
                  >
                    {unitMatches.length ? (
                      unitMatches.map((match, index) => (
                        <button
                          id={`${unitListboxId}-${index}`}
                          key={match.id}
                          type="button"
                          role="option"
                          aria-selected={index === unitActiveIndex}
                          className={index === unitActiveIndex ? "is-active" : ""}
                          onMouseDown={(event) => event.preventDefault()}
                          onMouseEnter={() => setUnitActiveIndex(index)}
                          onClick={() => selectUnit(match.canonical)}
                        >
                          <Building2 aria-hidden="true" />
                          <span>
                            <strong>{match.canonical}</strong>
                            <small>
                              {match.matchedText === match.canonical
                                ? "标准单位全称"
                                : `匹配写法：${match.matchedText}`}
                            </small>
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="contacts-panel__unit-empty">
                        未找到字典匹配项，可继续手动填写
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <small className="contacts-panel__field-help">
                来自管理中心“单位名称字典”，选中后统一使用标准全称
              </small>
            </div>
            <label>
              <span>部门</span>
              <input
                value={editor.values.department}
                maxLength={120}
                autoComplete="organization-title"
                placeholder="例如：经营管理部"
                onChange={(event) =>
                  updateEditorField("department", event.target.value)
                }
              />
            </label>
            <label>
              <span>职务</span>
              <input
                value={editor.values.title}
                maxLength={120}
                placeholder="例如：董事长"
                onChange={(event) => updateEditorField("title", event.target.value)}
              />
            </label>
          </div>

          <div className="contacts-panel__editor-actions">
            <button
              type="button"
              onClick={() => {
                setEditor(null);
                setUnitSuggestionsOpen(false);
              }}
              disabled={saving}
            >
              取消
            </button>
            <button type="submit" className="is-primary" disabled={saving}>
              {saving ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : null}
              {saving ? "正在保存…" : "保存并立即生效"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="contacts-panel__toolbar">
        <label className="contacts-panel__search">
          <Search aria-hidden="true" />
          <span className="contacts-panel__sr-only">搜索通讯录</span>
          <input
            type="search"
            value={queryInput}
            placeholder="搜索姓名、单位、部门、职务或车牌号"
            onChange={(event) => {
              const nextValue = event.target.value;
              if (nextValue.trim() !== query || page !== 0) {
                setLoading(true);
                setListError("");
              }
              setQueryInput(nextValue);
            }}
          />
          {queryInput ? (
            <button
              type="button"
              aria-label="清空搜索"
              onClick={() => {
                if (query || page !== 0) {
                  setLoading(true);
                  setListError("");
                }
                setQueryInput("");
              }}
            >
              <X aria-hidden="true" />
            </button>
          ) : null}
        </label>
        <span className="contacts-panel__range" aria-live="polite">
          {rangeLabel}
        </span>
      </div>

      <div className="contacts-panel__list-frame" aria-busy={loading}>
        {listError ? (
          <div className="contacts-panel__empty is-error" role="alert">
            <AlertCircle aria-hidden="true" />
            <strong>通讯录暂时无法读取</strong>
            <span>{listError}</span>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                setListError("");
                setReloadKey((key) => key + 1);
              }}
            >
              重新加载
            </button>
          </div>
        ) : loading && !payload ? (
          <div className="contacts-panel__empty" role="status">
            <LoaderCircle className="is-spinning" aria-hidden="true" />
            <strong>正在读取通讯录</strong>
          </div>
        ) : payload && payload.contacts.length > 0 ? (
          <div className="contacts-panel__table-scroll">
            <table className="contacts-panel__table">
              <caption className="contacts-panel__sr-only">
                参会人员通讯录搜索结果
              </caption>
              <thead>
                <tr>
                  <th scope="col">联系人</th>
                  <th scope="col">单位与部门</th>
                  <th scope="col">职务</th>
                  <th scope="col">参会记录</th>
                  <th scope="col">操作</th>
                </tr>
              </thead>
              <tbody>
                {payload.contacts.map((contact) => {
                  const displayUnit =
                    resolveCanonicalUnit(contact.unit, unitDirectory)
                      ?.canonical ?? contact.unit;
                  return (
                  <tr key={contact.id}>
                    <td data-label="联系人">
                      <div className="contacts-panel__person">
                        <span aria-hidden="true">
                          <UserRound />
                        </span>
                        <strong>{contact.name}</strong>
                      </div>
                    </td>
                    <td data-label="单位与部门">
                      <div className="contacts-panel__organization">
                        <strong>
                          <Building2 aria-hidden="true" />
                          {displayUnit}
                        </strong>
                        <span>{contact.department || "部门未填写"}</span>
                      </div>
                    </td>
                    <td data-label="职务">
                      <span className={contact.title ? "contacts-panel__title-tag" : "contacts-panel__muted"}>
                        {contact.title || "未填写"}
                      </span>
                    </td>
                    <td data-label="参会记录">
                      {contact.meetingCount > 0 ? (
                        <div className="contacts-panel__history">
                          <strong>{contact.meetingCount} 次参会</strong>
                          <span title={contact.lastMeetingTitle}>
                            最近：{contact.lastMeetingTitle || "会议名称未记录"}
                          </span>
                          <small>{formatMeetingDate(contact.lastMeetingDate)}</small>
                        </div>
                      ) : (
                        <span className="contacts-panel__manual-tag">手动添加</span>
                      )}
                    </td>
                    <td data-label="操作">
                      <div className="contacts-panel__row-actions">
                        <button
                          type="button"
                          aria-label={`修改联系人 ${contact.name}`}
                          title="修改联系人"
                          onClick={() => openEditEditor(contact)}
                        >
                          <Pencil aria-hidden="true" />
                          <span>修改</span>
                        </button>
                        <button
                          type="button"
                          className="is-danger"
                          aria-label={`删除联系人 ${contact.name}`}
                          title="删除联系人"
                          disabled={deletingId === contact.id}
                          onClick={() => void removeContact(contact)}
                        >
                          {deletingId === contact.id ? (
                            <LoaderCircle className="is-spinning" aria-hidden="true" />
                          ) : (
                            <Trash2 aria-hidden="true" />
                          )}
                          <span>{deletingId === contact.id ? "删除中" : "删除"}</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="contacts-panel__empty">
            <UsersRound aria-hidden="true" />
            <strong>{query ? "没有匹配的联系人" : "通讯录还是空的"}</strong>
            <span>
              {query
                ? "可以换一个姓名、单位、部门或职务关键词。"
                : "新建联系人，或在会议名单中保存参会人后自动沉淀。"}
            </span>
            {!query ? (
              <button type="button" onClick={openCreateEditor}>
                <Plus aria-hidden="true" />
                新增第一位联系人
              </button>
            ) : null}
          </div>
        )}
      </div>

      <footer className="contacts-panel__pagination" aria-label="通讯录分页">
        <span>
          第 {Math.min(page + 1, totalPages)} / {totalPages} 页
        </span>
        <div>
          <button
            type="button"
            disabled={page <= 0 || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => Math.max(0, current - 1));
            }}
          >
            <ChevronLeft aria-hidden="true" />
            上一页
          </button>
          <button
            type="button"
            disabled={page + 1 >= totalPages || loading}
            onClick={() => {
              setLoading(true);
              setPage((current) => current + 1);
            }}
          >
            下一页
            <ChevronRight aria-hidden="true" />
          </button>
        </div>
      </footer>
    </section>
  );
}

export default ContactsPanel;
