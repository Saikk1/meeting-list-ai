export type WorkspaceTabKind =
  | "dashboard"
  | "meetings"
  | "tasks"
  | "roster"
  | "admin"
  | "new-meeting"
  | "meeting"
  | "page";

export type WorkspaceTab = {
  id: string;
  routeKey: string;
  href: string;
  title: string;
  kind: WorkspaceTabKind;
  closable: boolean;
  dirty: boolean;
  dirtyReasons: string[];
  busy: boolean;
  lastActiveAt: number;
};

export type WorkspaceRoute = Pick<
  WorkspaceTab,
  "id" | "routeKey" | "href" | "title" | "kind" | "closable"
>;

const STATIC_ROUTES: Record<
  string,
  Pick<WorkspaceRoute, "routeKey" | "title" | "kind" | "closable">
> = {
  "/": { routeKey: "dashboard", title: "工作台", kind: "dashboard", closable: false },
  "/meetings": { routeKey: "meetings", title: "我的会议", kind: "meetings", closable: true },
  "/meetings/new": { routeKey: "new-meeting", title: "新建会议", kind: "new-meeting", closable: true },
  "/tasks": { routeKey: "tasks", title: "会务待办", kind: "tasks", closable: true },
  "/lists": { routeKey: "roster", title: "名单治理", kind: "roster", closable: true },
  "/admin": { routeKey: "admin", title: "管理中心", kind: "admin", closable: true },
};

function normalizeHref(href: string) {
  const parsed = new URL(href, "http://workspace.local");
  const pathname = parsed.pathname.replace(/\/$/, "") || "/";
  return `${pathname}${parsed.search}`;
}

export function workspaceRoute(href: string): WorkspaceRoute {
  const normalized = normalizeHref(href);
  const parsed = new URL(normalized, "http://workspace.local");
  const staticRoute = STATIC_ROUTES[parsed.pathname];
  if (staticRoute) {
    return { id: staticRoute.routeKey, href: normalized, ...staticRoute };
  }

  const meetingMatch = parsed.pathname.match(/^\/meetings\/([^/]+)$/);
  if (meetingMatch) {
    const meetingId = decodeURIComponent(meetingMatch[1]);
    const routeKey = `meeting:${meetingId}`;
    return {
      id: routeKey,
      routeKey,
      href: normalized,
      title: "会议详情",
      kind: "meeting",
      closable: true,
    };
  }

  const routeKey = `page:${parsed.pathname}`;
  return {
    id: routeKey,
    routeKey,
    href: normalized,
    title: "页面",
    kind: "page",
    closable: true,
  };
}

export function createWorkspaceTab(route: WorkspaceRoute, lastActiveAt: number): WorkspaceTab {
  return {
    ...route,
    dirty: false,
    dirtyReasons: [],
    busy: false,
    lastActiveAt,
  };
}

export function enforceWorkspaceSoftLimit(
  tabs: WorkspaceTab[],
  activeRouteKey: string,
  limit = 10,
) {
  const next = [...tabs];
  while (next.length > limit) {
    const candidate = next
      .filter(
        (tab) =>
          tab.closable &&
          tab.routeKey !== activeRouteKey &&
          !tab.dirty &&
          !tab.busy,
      )
      .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0];
    if (!candidate) break;
    next.splice(next.findIndex((tab) => tab.id === candidate.id), 1);
  }
  return next;
}

export function mostRecentWorkspaceTab(tabs: WorkspaceTab[], excludingId?: string) {
  return tabs
    .filter((tab) => tab.id !== excludingId)
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0] ?? null;
}
