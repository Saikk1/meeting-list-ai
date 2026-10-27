import assert from "node:assert/strict";
import test from "node:test";
import { explainDesktopLaunchFailure } from "../scripts/desktop-test-diagnostics.mjs";

test("desktop launch diagnostics distinguish token creation from generic load errors", () => {
  const diagnosis = explainDesktopLaunchFailure("", "Renderer stopped: reason=launch-failed; exitCode=49\nStartup failed: ERR_FAILED");
  assert.match(diagnosis, /受限令牌.*49/);
  assert.match(diagnosis, /正常 Windows 用户终端/);
  assert.equal(explainDesktopLaunchFailure("ERR_FAILED (-2) loading localhost", "Renderer stopped: reason=crashed; exitCode=49"), null);
});

test("desktop launch diagnostics identify the Windows loader failure without accepting a pass", () => {
  assert.match(explainDesktopLaunchFailure("GPU process exited unexpectedly: exit_code=-1073741515"), /0xC0000135.*组件加载失败/);
  assert.equal(explainDesktopLaunchFailure("GPU process exited unexpectedly: exit_code=1"), null);
  assert.equal(explainDesktopLaunchFailure("network request failed"), null);
});
