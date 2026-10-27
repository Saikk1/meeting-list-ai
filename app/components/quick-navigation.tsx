"use client";
import Link from "next/link";
import {
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ArrowUpRight, Search, X } from "lucide-react";
import { AppDialog } from "./app-dialog";
import {
  EMPTY_MEETING_STORE,
  loadMeetingStoreSnapshot,
  subscribeMeetings,
} from "../lib/meeting-data";
import {
  NAVIGATION_ITEMS,
  navigationMatches,
  workspaceNavigation,
  type NavigationItem,
} from "../lib/quick-navigation";
import type { WorkspaceTab } from "../lib/workspace-tabs";

export function openQuickNavigation(unsaved = false) {
  window.dispatchEvent(
    new CustomEvent("open-quick-navigation", { detail: { unsaved } }),
  );
}

export function QuickNavigation({
  tabs,
  unsaved,
  onClose,
}: {
  tabs: WorkspaceTab[];
  unsaved: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const dialogBody = useRef<HTMLDivElement>(null);
  const meetings = useSyncExternalStore(
    subscribeMeetings,
    loadMeetingStoreSnapshot,
    () => EMPTY_MEETING_STORE,
  );
  const term = query.trim();
  const items = useMemo(() => {
    const opened = workspaceNavigation(tabs, term, unsaved);
    if (unsaved) return opened;
    const pages = NAVIGATION_ITEMS.filter((item) =>
      navigationMatches(item, term),
    );
    const foundMeetings: NavigationItem[] = term
      ? [...meetings.active, ...meetings.archived]
          .map((meeting) => ({
            href: `/meetings/${encodeURIComponent(meeting.id)}`,
            title: meeting.title,
            detail: [
              meeting.date,
              meeting.location,
              meeting.owner,
              meeting.organizer,
              meeting.archivedAt ? "已归档" : "",
            ]
              .filter(Boolean)
              .join(" · "),
            group: "会议",
          }))
          .filter((item) => navigationMatches(item, term))
          .slice(0, 8)
      : [];
    const seen = new Set<string>();
    return [...opened, ...pages, ...foundMeetings].filter(
      (item) => {
        if (seen.has(item.href)) return false;
        seen.add(item.href);
        return true;
      },
    );
  }, [tabs, term, unsaved, meetings]);
  function changeQuery(value: string) {
    setQuery(value);
  }
  const groups = [...new Set(items.map((item) => item.group))];
  return (
    <AppDialog
      className="quick-navigation"
      labelledBy="quick-navigation-title"
      onClose={onClose}
    >
      <header>
        <div>
          <h2 id="quick-navigation-title">
            {unsaved ? "未保存的工作区" : "搜索与快速打开"}
          </h2>
          <p>
            {unsaved
              ? "切回页面后，点击对应的保存按钮。"
              : "搜索功能、会议名称、地点、负责人或单位。"}
          </p>
        </div>
        <button type="button" aria-label="关闭快速打开" onClick={onClose}>
          <X size={20} />
        </button>
      </header>
      <label className="quick-navigation-search">
        <Search size={20} />
        <input
          data-dialog-focus
          maxLength={200}
          aria-label="搜索功能或会议"
          placeholder={
            unsaved ? "查找未保存页签" : "例如：通讯录、周例会、调研方案"
          }
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              dialogBody.current
                ?.querySelector<HTMLAnchorElement>("a")
                ?.focus();
            }
          }}
        />
        {query && (
          <button
            type="button"
            aria-label="清空快速搜索"
            onClick={() => changeQuery("")}
          >
            <X size={16} />
          </button>
        )}
      </label>
      <div
        className="quick-navigation-results"
        ref={dialogBody}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp"].includes(event.key)) return;
          const links = Array.from(
            dialogBody.current?.querySelectorAll<HTMLAnchorElement>("a") ?? [],
          );
          const index = links.indexOf(
            document.activeElement as HTMLAnchorElement,
          );
          if (index < 0) return;
          event.preventDefault();
          if (event.key === "ArrowUp" && index === 0) {
            document
              .querySelector<HTMLInputElement>(".quick-navigation-search input")
              ?.focus();
            return;
          }
          links[
            Math.max(
              0,
              Math.min(
                links.length - 1,
                index + (event.key === "ArrowDown" ? 1 : -1),
              ),
            )
          ]?.focus();
        }}
      >
        {groups.map((group) => (
          <section key={group}>
            <h3>{group}</h3>
            <ul>
              {items
                .filter((item) => item.group === group)
                .map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} onClick={onClose}>
                      <span>
                        <strong>{item.title}</strong>
                        <small>{item.detail}</small>
                      </span>
                      <ArrowUpRight size={17} />
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        ))}
        {!items.length && (
          <div className="quick-navigation-empty">
            <Search size={28} />
            <strong>
              {unsaved ? "没有匹配的未保存页签" : "没有找到匹配内容"}
            </strong>
            <p>
              {unsaved
                ? "所有修改都应在对应页面明确保存。"
                : "试试会议名称、负责人或更短的关键词。"}
            </p>
          </div>
        )}
        <p className="quick-navigation-feedback" role="status">
          {term ? `找到 ${items.length} 个入口或结果` : "切换页面会保留当前页签，未保存内容仅在本次会话有效。"}
        </p>
      </div>
      <footer>
        <span>↑ ↓ 选择 · Enter 打开</span>
        <span>Esc 关闭 · Ctrl K 快速打开</span>
      </footer>
    </AppDialog>
  );
}
