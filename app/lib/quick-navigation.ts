import type { WorkspaceTab } from "./workspace-tabs";

export type NavigationItem = {
  href: string;
  title: string;
  detail: string;
  group: string;
  keywords?: string;
};
export const NAVIGATION_ITEMS: NavigationItem[] = [
  {
    href: "/",
    title: "工作台",
    detail: "会议概览与常用入口",
    group: "功能入口",
    keywords: "首页",
  },
  {
    href: "/meetings/new",
    title: "新建会议",
    detail: "安排时间、人员与保障事项",
    group: "功能入口",
    keywords: "创建",
  },
  {
    href: "/meetings",
    title: "我的会议",
    detail: "查找会议、归档与回收站",
    group: "功能入口",
  },
  {
    href: "/tasks",
    title: "会务待办",
    detail: "处理逾期、待执行和待复核事项",
    group: "功能入口",
    keywords: "任务 落实",
  },
  {
    href: "/lists",
    title: "名单治理",
    detail: "整理、排序与导出正式名单",
    group: "功能入口",
    keywords: "人员 Excel",
  },
  {
    href: "/admin?section=contacts",
    title: "人员通讯录",
    detail: "查找和维护联系人",
    group: "功能入口",
  },
  {
    href: "/admin?section=rooms",
    title: "会议室",
    detail: "场地、容量与桌型配置",
    group: "功能入口",
  },
  {
    href: "/admin",
    title: "管理中心",
    detail: "公司规则、模板、字典与数据维护",
    group: "功能入口",
    keywords: "设置 备份",
  },
];
export function navigationMatches(item: NavigationItem, query: string) {
  const terms = query
    .trim()
    .toLocaleLowerCase("zh-CN")
    .split(/\s+/)
    .filter(Boolean);
  const text =
    `${item.title} ${item.detail} ${item.keywords ?? ""}`.toLocaleLowerCase(
      "zh-CN",
    );
  return terms.every((term) => text.includes(term));
}
export function workspaceNavigation(
  tabs: WorkspaceTab[],
  query: string,
  unsaved = false,
): NavigationItem[] {
  return [...tabs]
    .filter((tab) => !unsaved || tab.dirty)
    .sort(
      (a, b) =>
        Number(b.dirty) - Number(a.dirty) || b.lastActiveAt - a.lastActiveAt,
    )
    .map((tab) => ({
      href: tab.href,
      title: tab.title,
      detail: tab.dirty
        ? `未保存 · ${tab.dirtyReasons.join("、") || "修改尚未保存"}`
        : tab.busy
          ? "正在处理"
          : "切回已打开页面",
      group: "已打开的工作区",
    }))
    .filter((item) => navigationMatches(item, query))
    .slice(0, 10);
}
