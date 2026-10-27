"use client";

import Link from "next/link";
import {
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  ListChecks,
  Settings,
  Sparkles,
  Search,
} from "lucide-react";
import type { ReactNode } from "react";
import { useWorkspaceLocation, WorkspaceTabBar } from "./workspace-tabs";
import { openQuickNavigation } from "./quick-navigation";

type AssistantShellProps = {
  children: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  embedded?: boolean;
};

const navigation = [
  {
    href: "/",
    label: "工作台",
    icon: LayoutDashboard,
  },
  {
    href: "/meetings",
    label: "我的会议",
    icon: CalendarDays,
  },
  {
    href: "/tasks",
    label: "会务待办",
    icon: ListChecks,
  },
  {
    href: "/lists",
    label: "名单治理",
    icon: ClipboardList,
  },
  {
    href: "/admin",
    label: "管理中心",
    icon: Settings,
  },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/") {
    return pathname === "/";
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

function AssistantNavigation({
  pathname,
  variant,
}: {
  pathname: string;
  variant: "desktop" | "mobile";
}) {
  return (
    <nav
      className={`assistant-nav assistant-nav--${variant}`}
      aria-label="主导航"
    >
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);

        return (
          <Link
            key={href}
            href={href}
            className={`assistant-nav__link${
              active ? " assistant-nav__link--active" : ""
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="assistant-nav__icon" aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function AssistantBrand() {
  return (
    <Link className="assistant-brand" href="/" aria-label="会务智办首页">
      <span className="assistant-brand__mark" aria-hidden="true">
        <Sparkles />
      </span>
      <span className="assistant-brand__copy">
        <strong className="assistant-brand__name">会务智办</strong>
        <span className="assistant-brand__tagline">AI全流程会议助手</span>
      </span>
    </Link>
  );
}

export function AssistantShell({
  children,
  title,
  subtitle,
  actions,
  embedded = false,
}: AssistantShellProps) {
  const { pathname } = useWorkspaceLocation();

  if (embedded) {
    return <div className="assistant-embedded-content">{children}</div>;
  }

  return (
    <div className="assistant-shell">
      <aside className="assistant-sidebar">
        <AssistantBrand />
        <button
          className="assistant-quick-open"
          type="button"
          onClick={() => openQuickNavigation()}
        >
          <Search size={16} />
          <span>搜索与快速打开</span>
          <kbd>Ctrl K</kbd>
        </button>
        <AssistantNavigation pathname={pathname} variant="desktop" />
        <p className="assistant-sidebar__footer">
          本机单用户 · 业务数据本机保存 · AI调用按配置发送
        </p>
      </aside>

      <div className="assistant-mobile-header">
        <div className="assistant-mobile-brand-row">
          <AssistantBrand />
          <button
            className="assistant-mobile-search"
            type="button"
            aria-label="搜索与快速打开"
            onClick={() => openQuickNavigation()}
          >
            <Search size={20} />
          </button>
        </div>
        <AssistantNavigation pathname={pathname} variant="mobile" />
      </div>

      <main className="assistant-main">
        <WorkspaceTabBar />
        {(title || subtitle || actions) && (
          <header className="assistant-page-header">
            <div className="assistant-page-header__copy">
              {title && <h1 className="assistant-page-title">{title}</h1>}
              {subtitle && (
                <div className="assistant-page-subtitle">{subtitle}</div>
              )}
            </div>
            {actions && (
              <div className="assistant-page-actions" aria-label="页面操作">
                {actions}
              </div>
            )}
          </header>
        )}

        <div className="assistant-content">{children}</div>
      </main>
    </div>
  );
}
