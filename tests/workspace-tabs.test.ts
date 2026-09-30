import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkspaceTab,
  enforceWorkspaceSoftLimit,
  mostRecentWorkspaceTab,
  workspaceRoute,
} from "../app/lib/workspace-tabs";

test("static workspaces reuse a route key even when their query changes", () => {
  assert.equal(workspaceRoute("/admin?section=rooms").routeKey, "admin");
  assert.equal(workspaceRoute("/admin?section=contacts").routeKey, "admin");
  assert.equal(workspaceRoute("/meetings/new").routeKey, "new-meeting");
});

test("every meeting detail receives an independent workspace", () => {
  assert.equal(workspaceRoute("/meetings/a").routeKey, "meeting:a");
  assert.equal(workspaceRoute("/meetings/b?tab=attendees").routeKey, "meeting:b");
  assert.notEqual(
    workspaceRoute("/meetings/a").routeKey,
    workspaceRoute("/meetings/b").routeKey,
  );
});

test("the soft limit evicts only the oldest clean inactive workspace", () => {
  const tabs = Array.from({ length: 11 }, (_, index) => ({
    ...createWorkspaceTab(workspaceRoute(`/meetings/meeting-${index}`), index),
    dirty: index === 0,
    dirtyReasons: index === 0 ? ["未保存"] : [],
  }));
  const limited = enforceWorkspaceSoftLimit(tabs, "meeting:meeting-10", 10);
  assert.equal(limited.length, 10);
  assert.ok(limited.some((tab) => tab.routeKey === "meeting:meeting-0"));
  assert.ok(!limited.some((tab) => tab.routeKey === "meeting:meeting-1"));
});

test("dirty and busy workspaces may exceed the soft limit", () => {
  const tabs = Array.from({ length: 11 }, (_, index) => ({
    ...createWorkspaceTab(workspaceRoute(`/meetings/meeting-${index}`), index),
    dirty: index !== 10,
    busy: index === 10,
  }));
  assert.equal(
    enforceWorkspaceSoftLimit(tabs, "meeting:meeting-10", 10).length,
    11,
  );
});

test("closing the active workspace returns to the most recently used tab", () => {
  const dashboard = createWorkspaceTab(workspaceRoute("/"), 1);
  const meetings = createWorkspaceTab(workspaceRoute("/meetings"), 5);
  const tasks = createWorkspaceTab(workspaceRoute("/tasks"), 3);
  assert.equal(
    mostRecentWorkspaceTab([dashboard, meetings, tasks], meetings.id)?.id,
    tasks.id,
  );
});
