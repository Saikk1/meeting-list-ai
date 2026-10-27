"use client";

import {
  Activity,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search, X } from "lucide-react";
import { AppDialog } from "./app-dialog";
import { openQuickNavigation, QuickNavigation } from "./quick-navigation";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createWorkspaceTab,
  enforceWorkspaceSoftLimit,
  mostRecentWorkspaceTab,
  workspaceRoute,
  type WorkspaceTab,
} from "../lib/workspace-tabs";

type TabStatus = {
  enabled?: boolean;
  title?: string;
  dirty?: boolean;
  dirtyReasons?: string[];
  busy?: boolean;
};

type WorkspaceLocation = {
  tabId: string;
  href: string;
  pathname: string;
  searchParams: URLSearchParams;
};

type PendingReplacement = {
  fromRouteKey: string;
  targetHref: string;
  title?: string;
};

type WorkspaceContextValue = {
  tabs: WorkspaceTab[];
  activeRouteKey: string;
  updateTabStatus: (tabId: string, status: TabStatus) => void;
  focusTab: (tab: WorkspaceTab) => void;
  closeTab: (tab: WorkspaceTab) => void;
  replaceActiveTab: (href: string, title?: string) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
const WorkspaceLocationContext = createContext<WorkspaceLocation | null>(null);

function hrefFromLocation(pathname: string, searchParams: URLSearchParams) {
  const search = searchParams.toString();
  return `${pathname}${search ? `?${search}` : ""}`;
}

function parseLocation(tabId: string, href: string): WorkspaceLocation {
  const parsed = new URL(href, "http://workspace.local");
  return {
    tabId,
    href,
    pathname: parsed.pathname,
    searchParams: parsed.searchParams,
  };
}

function WorkspaceActivity({
  tab,
  visible,
  children,
}: {
  tab: WorkspaceTab;
  visible: boolean;
  children: ReactNode;
}) {
  const location = useMemo(
    () => parseLocation(tab.id, tab.href),
    [tab.href, tab.id],
  );
  return (
    <Activity mode={visible ? "visible" : "hidden"}>
      <WorkspaceLocationContext.Provider value={location}>
        {children}
      </WorkspaceLocationContext.Provider>
    </Activity>
  );
}

export function WorkspaceTabsProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentHref = hrefFromLocation(pathname, searchParams);
  const currentRoute = useMemo(
    () => workspaceRoute(currentHref),
    [currentHref],
  );
  const clockRef = useRef(1);
  const [cache, setCache] = useState<Map<string, ReactNode>>(
    () => new Map([[currentRoute.routeKey, children]]),
  );
  const scrollRef = useRef(new Map<string, number>());
  const previousRouteRef = useRef(currentRoute.routeKey);
  const pendingReplacementRef = useRef<PendingReplacement | null>(null);
  const [closeCandidate, setCloseCandidate] = useState<WorkspaceTab | null>(
    null,
  );
  const [busyNotice, setBusyNotice] = useState("");
  const [quickOpen, setQuickOpen] = useState<{ unsaved: boolean } | null>(null);
  useEffect(() => {
    const open = (event: Event) =>
      setQuickOpen({ unsaved: !!(event as CustomEvent).detail?.unsaved });
    const keyboard = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !event.altKey &&
        !event.isComposing
      ) {
        if (document.querySelector("dialog[open]")) return;
        event.preventDefault();
        setQuickOpen({ unsaved: false });
      }
    };
    window.addEventListener("open-quick-navigation", open);
    window.addEventListener("keydown", keyboard);
    return () => {
      window.removeEventListener("open-quick-navigation", open);
      window.removeEventListener("keydown", keyboard);
    };
  }, []);
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() => {
    const dashboard = createWorkspaceTab(workspaceRoute("/"), 0);
    if (currentRoute.routeKey === dashboard.routeKey) return [dashboard];
    return [dashboard, createWorkspaceTab(currentRoute, 1)];
  });

  useEffect(() => {
    const previousRouteKey = previousRouteRef.current;
    if (previousRouteKey !== currentRoute.routeKey) {
      previousRouteRef.current = currentRoute.routeKey;
      window.requestAnimationFrame(() => {
        window.scrollTo(0, scrollRef.current.get(currentRoute.routeKey) ?? 0);
      });
    }

    const pending = pendingReplacementRef.current;
    if (
      pending &&
      workspaceRoute(pending.targetHref).routeKey === currentRoute.routeKey
    ) {
      setCache((currentCache) => {
        const nextCache = new Map(currentCache);
        nextCache.delete(pending.fromRouteKey);
        return nextCache;
      });
    }
    setTabs((current) => {
      const now = ++clockRef.current;
      let next = current;
      if (
        pending &&
        workspaceRoute(pending.targetHref).routeKey === currentRoute.routeKey
      ) {
        next = current.filter((tab) => tab.routeKey !== pending.fromRouteKey);
        scrollRef.current.delete(pending.fromRouteKey);
        pendingReplacementRef.current = null;
      }

      const existing = next.find(
        (tab) => tab.routeKey === currentRoute.routeKey,
      );
      if (existing) {
        const title = pending?.title || existing.title;
        next = next.map((tab) =>
          tab.id === existing.id
            ? { ...tab, href: currentHref, title, lastActiveAt: now }
            : tab,
        );
      } else {
        next = [
          ...next,
          createWorkspaceTab(
            { ...currentRoute, title: pending?.title || currentRoute.title },
            now,
          ),
        ];
      }
      return enforceWorkspaceSoftLimit(next, currentRoute.routeKey);
    });
  }, [currentHref, currentRoute]);

  useEffect(() => {
    const rememberScroll = () => {
      scrollRef.current.set(currentRoute.routeKey, window.scrollY);
    };
    rememberScroll();
    window.addEventListener("scroll", rememberScroll, { passive: true });
    return () => {
      rememberScroll();
      window.removeEventListener("scroll", rememberScroll);
    };
  }, [currentRoute.routeKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCache((current) => {
        if (current.has(currentRoute.routeKey)) return current;
        const next = new Map(current);
        next.set(currentRoute.routeKey, children);
        return next;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [children, currentRoute.routeKey]);

  useEffect(() => {
    const valid = new Set(tabs.map((tab) => tab.routeKey));
    valid.add(currentRoute.routeKey);
    const timer = window.setTimeout(() => {
      setCache((current) => {
        const next = new Map(current);
        let changed = false;
        for (const routeKey of next.keys()) {
          if (!valid.has(routeKey)) {
            next.delete(routeKey);
            changed = true;
          }
        }
        return changed ? next : current;
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentRoute.routeKey, tabs]);

  useEffect(() => {
    if (!tabs.some((tab) => tab.dirty)) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [tabs]);


  const updateTabStatus = useCallback((tabId: string, status: TabStatus) => {
    setTabs((current) =>
      current.map((tab) => {
        if (tab.id !== tabId) return tab;
        const nextReasons = status.dirtyReasons ?? tab.dirtyReasons;
        const next = {
          ...tab,
          title: status.title ?? tab.title,
          dirty: status.dirty ?? tab.dirty,
          dirtyReasons: nextReasons,
          busy: status.busy ?? tab.busy,
        };
        if (
          next.title === tab.title &&
          next.dirty === tab.dirty &&
          next.busy === tab.busy &&
          next.dirtyReasons.length === tab.dirtyReasons.length &&
          next.dirtyReasons.every(
            (reason, index) => reason === tab.dirtyReasons[index],
          )
        )
          return tab;
        return next;
      }),
    );
  }, []);

  const focusTab = useCallback(
    (tab: WorkspaceTab) => router.push(tab.href),
    [router],
  );

  const commitClose = useCallback(
    (tab: WorkspaceTab) => {
      const target =
        tab.routeKey === currentRoute.routeKey
          ? mostRecentWorkspaceTab(tabs, tab.id)
          : null;
      setTabs((current) => current.filter((item) => item.id !== tab.id));
      setCache((current) => {
        const next = new Map(current);
        next.delete(tab.routeKey);
        return next;
      });
      scrollRef.current.delete(tab.routeKey);
      setCloseCandidate(null);
      if (target) router.push(target.href);
    },
    [currentRoute.routeKey, router, tabs],
  );

  const closeTab = useCallback(
    (tab: WorkspaceTab) => {
      if (!tab.closable) return;
      if (tab.busy) {
        setBusyNotice("当前页面正在处理数据，请等待操作完成后再关闭。");
        return;
      }
      if (tab.dirty) {
        setCloseCandidate(tab);
        return;
      }
      commitClose(tab);
    },
    [commitClose],
  );

  const replaceActiveTab = useCallback(
    (href: string, title?: string) => {
      pendingReplacementRef.current = {
        fromRouteKey: currentRoute.routeKey,
        targetHref: href,
        title,
      };
      router.replace(href);
    },
    [currentRoute.routeKey, router],
  );

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      tabs,
      activeRouteKey: currentRoute.routeKey,
      updateTabStatus,
      focusTab,
      closeTab,
      replaceActiveTab,
    }),
    [
      tabs,
      currentRoute.routeKey,
      updateTabStatus,
      focusTab,
      closeTab,
      replaceActiveTab,
    ],
  );

  const renderTabs = tabs.some((tab) => tab.routeKey === currentRoute.routeKey)
    ? tabs
    : [...tabs, createWorkspaceTab(currentRoute, tabs.length + 1)];

  return (
    <WorkspaceContext.Provider value={value}>
      {renderTabs.map((tab) => (
        <WorkspaceActivity
          key={tab.id}
          tab={tab}
          visible={tab.routeKey === currentRoute.routeKey}
        >
          {cache.get(tab.routeKey) ??
            (tab.routeKey === currentRoute.routeKey ? children : null)}
        </WorkspaceActivity>
      ))}
      {closeCandidate ? (
        <AppDialog
          className="workspace-dialog app-confirmation-dialog"
          labelledBy="workspace-close-title"
          onClose={() => setCloseCandidate(null)}
        >
          <h2 id="workspace-close-title">关闭“{closeCandidate.title}”？</h2>
          <p>这个页签中还有未保存的内容，关闭后将无法恢复：</p>
          <ul>
            {(closeCandidate.dirtyReasons.length
              ? closeCandidate.dirtyReasons
              : ["当前页面的未保存修改"]
            ).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <div className="workspace-dialog__actions">
            <button type="button" onClick={() => setCloseCandidate(null)}>
              继续编辑
            </button>
            <button
              type="button"
              className="is-danger"
              onClick={() => commitClose(closeCandidate)}
            >
              放弃并关闭
            </button>
          </div>
        </AppDialog>
      ) : null}
      {busyNotice ? (
        <AppDialog
          className="workspace-dialog app-confirmation-dialog"
          labelledBy="workspace-busy-title"
          onClose={() => setBusyNotice("")}
        >
          <h2 id="workspace-busy-title">暂时不能关闭</h2>
          <p>{busyNotice}</p>
          <div className="workspace-dialog__actions">
            <button type="button" onClick={() => setBusyNotice("")}>
              知道了
            </button>
          </div>
        </AppDialog>
      ) : null}
      {quickOpen && (
        <QuickNavigation
          tabs={tabs}
          unsaved={quickOpen.unsaved}
          onClose={() => setQuickOpen(null)}
        />
      )}
    </WorkspaceContext.Provider>
  );
}

export function WorkspaceTabBar() {
  const workspace = useContext(WorkspaceContext);
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pane = scroll.current;
    const active = pane?.querySelector<HTMLElement>(".workspace-tab.is-active");
    if (!pane || !active) return;
    const bounds = active.getBoundingClientRect(),
      viewport = pane.getBoundingClientRect();
    if (bounds.left < viewport.left || bounds.right > viewport.right)
      pane.scrollTo({
        left:
          pane.scrollLeft +
          bounds.left -
          viewport.left -
          (pane.clientWidth - bounds.width) / 2,
        behavior: "smooth",
      });
  }, [workspace?.activeRouteKey, workspace?.tabs.length]);
  if (!workspace) return null;
  return (
    <div className="workspace-tabbar">
      <div
        ref={scroll}
        className="workspace-tabbar__scroll"
        role="tablist"
        aria-label="已打开的工作区"
      >
        {workspace.tabs.map((tab) => {
          const active = tab.routeKey === workspace.activeRouteKey;
          return (
            <div
              className={`workspace-tab${active ? " is-active" : ""}`}
              key={tab.id}
              role="tab"
              aria-selected={active}
            >
              <button
                className="workspace-tab__label"
                type="button"
                onClick={() => workspace.focusTab(tab)}
                title={tab.title}
              >
                {tab.dirty ? <i aria-label="有未保存修改" /> : null}
                <span>{tab.title}</span>
              </button>
              {tab.closable ? (
                <button
                  className="workspace-tab__close"
                  type="button"
                  onClick={() => workspace.closeTab(tab)}
                  aria-label={`关闭${tab.title}`}
                >
                  <X aria-hidden="true" />
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="workspace-tabbar__tools">
        {workspace.tabs.some((tab) => tab.dirty) && (
          <button
            type="button"
            className="workspace-unsaved"
            onClick={() => openQuickNavigation(true)}
            title="查看未保存的页签"
          >
            未保存 · {workspace.tabs.filter((tab) => tab.dirty).length}
          </button>
        )}
        <button
          type="button"
          className="workspace-quick-button"
          aria-label="搜索与快速打开"
          title="搜索与快速打开（Ctrl K）"
          onClick={() => openQuickNavigation()}
        >
          <Search size={17} />
        </button>
      </div>
    </div>
  );
}

export function useWorkspaceLocation() {
  const location = useOptionalWorkspaceLocation();
  if (!location) throw new Error("Workspace location is unavailable");
  return location;
}

// Shared editors also render in the global assistant, outside a business tab.
export function useOptionalWorkspaceLocation() {
  return useContext(WorkspaceLocationContext);
}

export function useWorkspaceTabStatus(status: TabStatus) {
  const workspace = useContext(WorkspaceContext);
  const location = useContext(WorkspaceLocationContext);
  const updateTabStatus = workspace?.updateTabStatus;
  const { enabled = true, title, dirty, busy } = status;
  const reasonsKey = (status.dirtyReasons ?? []).join("\u0000");
  useEffect(() => {
    if (!enabled || !updateTabStatus || !location) return;
    updateTabStatus(location.tabId, {
      title,
      dirty,
      busy,
      dirtyReasons: reasonsKey ? reasonsKey.split("\u0000") : [],
    });
  }, [busy, dirty, enabled, location, reasonsKey, title, updateTabStatus]);
}

export function useWorkspaceTabs() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Workspace tabs are unavailable");
  return workspace;
}
