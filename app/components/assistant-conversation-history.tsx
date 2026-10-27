"use client";

import { useState } from "react";
import { ChevronRight, MessageSquare, Search } from "lucide-react";
import type { SavedConversation } from "../lib/assistant-conversations";

export function AssistantConversationHistory({ sessions, activeId, onSelect, onBack }: {
  sessions: SavedConversation[]; activeId: string;
  onSelect: (id: string) => void; onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const keywords = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt).filter((session) => {
    const text = `${session.title}\n${session.messages.map((m) => m.text).join("\n")}`.toLocaleLowerCase();
    return keywords.every((word) => text.includes(word));
  });
  return <section className="assistant-conversation-history" aria-label="对话历史">
    <header><div><h2>对话历史</h2><p>全部 {sessions.length} 个对话，点击继续聊天</p></div><button type="button" onClick={onBack}>返回对话</button></header>
    <label className="assistant-conversation-search"><Search aria-hidden="true"/><input aria-label="搜索对话历史" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索对话标题或聊天内容"/></label>
    <div className="assistant-conversation-list">
      {matches.map((session) => {
        const last = [...session.messages].reverse().find((m) => m.id !== "welcome");
        return <button type="button" key={session.id} className={`assistant-conversation-card${session.id === activeId ? " is-current" : ""}`} onClick={() => onSelect(session.id)} aria-current={session.id === activeId ? "true" : undefined}>
          <MessageSquare aria-hidden="true"/>
          <span><strong>{session.title || "新会话"}{session.id === activeId && <em>当前</em>}</strong><span className="assistant-conversation-excerpt">{last?.text || "还没有聊天内容"}</span><small>{session.updatedAt ? new Date(session.updatedAt).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "刚刚创建"} · {session.messages.filter((m) => m.id !== "welcome").length} 条消息</small></span>
          <ChevronRight aria-hidden="true"/>
        </button>;
      })}
      {!matches.length && <p className="assistant-conversation-empty">没有找到相关对话，换个关键词试试。</p>}
    </div>
  </section>;
}
