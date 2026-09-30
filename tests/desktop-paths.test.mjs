import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { desktopDataPaths } from "../desktop/paths.mjs";

test("installed desktop reuses the existing business data directory", () => {
  const paths = desktopDataPaths({ env: {}, localAppData: "C:/Local", userData: "C:/Other" });
  assert.equal(paths.root, join("C:/Local", "MeetingAssistantAI"));
  assert.equal(paths.profile, join(paths.root, "desktop-profile"));
});

test("portable data is stored beside the original EXE rather than its extraction directory", () => {
  const paths = desktopDataPaths({
    env: { PORTABLE_EXECUTABLE_DIR: "D:/我的软件" },
    localAppData: "C:/Local", userData: "C:/Temp/extracted",
  });
  assert.equal(paths.root, join("D:/我的软件", "会务智办数据"));
  assert.equal(paths.portable, true);
});

test("test data overrides only apply in explicit smoke test mode", () => {
  const env = { MEETING_DESKTOP_TEST_DATA: "D:/test" };
  assert.notEqual(desktopDataPaths({ env, userData: "D:/normal" }).root, "D:/test");
  assert.equal(desktopDataPaths({ env: { ...env, MEETING_DESKTOP_SMOKE: "1" }, userData: "D:/normal" }).root, "D:/test");
});
