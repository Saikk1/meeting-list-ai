import assert from "node:assert/strict";
import test from "node:test";
import { createCloseConfirmation, restoreInputFocus } from "../desktop/window-focus.mjs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

function fakeWindow() {
  const calls = [];
  return { calls, isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
    blur: () => calls.push("window-blur"), focus: () => calls.push("window-focus"), close: () => calls.push("close"),
    webContents: { isDestroyed: () => false, focus: () => calls.push("page-focus") } };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

test("canceling desktop close restores window and renderer without reloading", async () => {
  const window = fakeWindow();
  let asks = 0;
  const handle = createCloseConfirmation(window, async () => { asks++; return { response: 0 }; });
  const event = { preventDefault: () => assert.fail("cancel must not approve unload") };
  handle(event); handle(event);
  await flush();
  assert.equal(asks, 1);
  assert.deepEqual(window.calls, ["window-blur", "window-focus", "page-focus"]);
  handle(event);
  await flush();
  assert.equal(asks, 2);
});

test("desktop discard retries close then approves unload synchronously", async () => {
  const window = fakeWindow();
  const handle = createCloseConfirmation(window, async () => ({ response: 1 }));
  handle({ preventDefault: () => assert.fail("first close must stay blocked") });
  await flush();
  assert.deepEqual(window.calls, ["close"]);
  let approved = false;
  handle({ preventDefault: () => { approved = true; } });
  assert.equal(approved, true);
});

test("failed close dialog keeps drafts and restores input focus", async () => {
  const window = fakeWindow();
  let reported = false;
  const handle = createCloseConfirmation(window, async () => { throw new Error("test"); }, () => { reported = true; });
  handle({ preventDefault: () => assert.fail("error must not discard") });
  await flush();
  assert.equal(reported, true);
  assert.deepEqual(window.calls, ["window-blur", "window-focus", "page-focus"]);
});

test("focus recovery never activates destroyed, hidden or minimized windows", () => {
  for (const key of ["isDestroyed", "isMinimized", "isVisible"]) {
    const window = fakeWindow();
    window[key] = () => key !== "isVisible";
    restoreInputFocus(window);
    assert.deepEqual(window.calls, []);
  }
});

test("desktop focus helper is included in the installation package", async () => {
  const config = await readFile(new URL("../electron-builder.config.cjs", import.meta.url), "utf8");
  assert.match(config, /"window-focus\.mjs"/);
});

test("desktop distribution only builds an installer, never a portable executable", async () => {
  const config = createRequire(import.meta.url)("../electron-builder.config.cjs");
  assert.deepEqual(config.win.target, ["nsis"]);
  assert.equal(Object.hasOwn(config, "portable"), false);
  const command = await readFile(new URL("../scripts/package-desktop.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(command, /["']portable["']/);
});
