"use client";

import {
  EMPTY_OPERATION_HISTORY,
  loadAssistantOperationHistory,
  subscribeAssistantOperationHistory,
  undoAssistantOperation,
  type AssistantOperationHistoryEntry,
} from "../lib/assistant-operation-history";
import { CheckCircle2, Clock3, History, RotateCcw, ShieldAlert } from "lucide-react";
import { useState, useSyncExternalStore } from "react";

function operationTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function AssistantHistoryPanel({
  onUndone,
  onError,
}: {
  onUndone: (entry: AssistantOperationHistoryEntry) => void;
  onError: (message: string) => void;
}) {
  const history = useSyncExternalStore(
    subscribeAssistantOperationHistory,
    loadAssistantOperationHistory,
    () => EMPTY_OPERATION_HISTORY,
  );
  const [undoingId, setUndoingId] = useState("");

  async function undo(entry: AssistantOperationHistoryEntry) {
    setUndoingId(entry.id);
    try {
      await undoAssistantOperation(entry);
      onUndone(entry);
    } catch (error) {
      onError(error instanceof Error ? error.message : "撤销失败，请稍后重试");
    } finally {
      setUndoingId("");
    }
  }

  return (
    <section className="assistant-history" aria-label="操作历史">
      <div className="assistant-history__heading">
        <span><History aria-hidden="true" />操作历史</span>
        <small>最多保留最近 30 条助手操作</small>
      </div>
      {!history.length ? (
        <div className="assistant-history__empty">
          <History aria-hidden="true" />
          <strong>还没有已执行的操作</strong>
          <span>通过助手确认执行后，会在这里留下记录。</span>
        </div>
      ) : (
        <div className="assistant-history__list">
          {history.map((entry) => (
            <article className="assistant-history__item" key={entry.id}>
              <span className={`assistant-history__state assistant-history__state--${entry.status}`}>
                {entry.status === "undone" ? <CheckCircle2 aria-hidden="true" /> : entry.status === "undo_failed" ? <ShieldAlert aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
              </span>
              <div>
                <strong>{entry.summary}</strong>
                <span>{operationTime(entry.createdAt)} · {entry.executedActions} 项操作</span>
                {entry.limitation ? <small>{entry.limitation}</small> : null}
                {entry.status === "undone" ? <small>已撤销</small> : null}
                {entry.status === "undo_failed" ? <small>上次撤销未完成，可在确认数据后重试</small> : null}
              </div>
              {entry.reversible && entry.status !== "undone" ? (
                <button type="button" disabled={Boolean(undoingId)} onClick={() => void undo(entry)}>
                  <RotateCcw aria-hidden="true" />
                  {undoingId === entry.id ? "撤销中" : "撤销"}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
