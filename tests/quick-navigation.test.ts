import assert from "node:assert/strict";
import test from "node:test";
import {
  NAVIGATION_ITEMS,
  navigationMatches,
  workspaceNavigation,
} from "../app/lib/quick-navigation";
import { createWorkspaceTab, workspaceRoute } from "../app/lib/workspace-tabs";

test("quick navigation finds business terms and requires every search term", () => {
  assert.ok(
    NAVIGATION_ITEMS.some(
      (item) =>
        item.title === "人员通讯录" && navigationMatches(item, "通讯录"),
    ),
  );
  assert.equal(NAVIGATION_ITEMS.some(item => item.href.startsWith("/minutes")), false);
  assert.equal(
    navigationMatches(
      { href: "/a", title: "示例项目会", detail: "2030 示例甲", group: "会议" },
      "项目 示例甲",
    ),
    true,
  );
  assert.equal(
    navigationMatches(
      { href: "/a", title: "示例项目会", detail: "2030 示例甲", group: "会议" },
      "项目 不存在",
    ),
    false,
  );
});

test("unsaved workspace search excludes saved tabs and retains reasons and original navigation", () => {
  const tabs = [
    {
      ...createWorkspaceTab(workspaceRoute("/meetings/new"), 1),
      dirty: true,
      dirtyReasons: ["会议草稿"],
    },
    createWorkspaceTab(workspaceRoute("/tasks"), 3),
    {
      ...createWorkspaceTab(workspaceRoute("/admin?section=rooms"), 2),
      dirty: true,
      dirtyReasons: ["会议室规则"],
    },
  ];
  const before = JSON.stringify(tabs);
  const items = workspaceNavigation(tabs, "", true);
  assert.deepEqual(
    items.map((item) => item.href),
    ["/admin?section=rooms", "/meetings/new"],
  );
  assert.match(items[0].detail, /未保存.*会议室规则/);
  assert.equal(workspaceNavigation(tabs, "草稿", true)[0].title, "新建会议");
  assert.equal(JSON.stringify(tabs), before);
});
