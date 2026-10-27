import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { monitorRenderer } from "../desktop/renderer-health.mjs";
const flush = () => new Promise((resolve) => setImmediate(resolve));
test("renderer failure records metadata and never reloads without a positive recovery choice", async () => {
  const webContents = new EventEmitter(), logs = [];
  let reloads = 0, prompts = 0, answer = 0;
  monitorRenderer({ webContents, isDestroyed: () => false, reload: () => reloads++ }, {
    log: (line) => logs.push(line), showRecovery: async (options) => {
      prompts++; assert.equal(options.defaultId, 0); return { response: answer };
    },
  });
  webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 7 });
  webContents.emit("render-process-gone", {}, { reason: "oom", exitCode: 7 });
  await flush(); assert.equal(prompts, 1); assert.equal(reloads, 0);
  assert.match(logs[0], /reason=oom; exitCode=7/);
  answer = 1;
  webContents.emit("render-process-gone", {}, { reason: "crashed", exitCode: 3 });
  await flush(); assert.equal(reloads, 1);
});
test("desktop logs ignore ordinary console content and accept only the diagnostic marker", () => {
  const webContents = new EventEmitter(), logs = [];
  monitorRenderer({ webContents, isDestroyed: () => false }, { log: (line) => logs.push(line), smoke: true });
  webContents.emit("console-message", {}, { message: "private prompt or API credential" });
  webContents.emit("console-message", {}, 3, "private response");
  assert.deepEqual(logs, []);
  webContents.emit("console-message", {}, { message: "meeting-assistant-render-error TypeError component" });
  assert.equal(logs.length, 1);
});
