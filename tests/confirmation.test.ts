import assert from "node:assert/strict";
import test from "node:test";
import { readdir, readFile } from "node:fs/promises";
import { ConfirmationQueue } from "../app/lib/confirmation";

test("confirmation waits for explicit approval and resolves only once", async () => {
  const queue = new ConfirmationQueue();
  const answer = queue.ask("删除？");
  const request = queue.getSnapshot()!;
  assert.equal(request.message, "删除？");
  queue.answer(request.id, true);
  queue.answer(request.id, false);
  assert.equal(await answer, true);
  assert.equal(queue.getSnapshot(), null);
});

test("confirmation queues never let an old dialog approve the next request", async () => {
  const queue = new ConfirmationQueue();
  const first = queue.ask("第一次");
  const firstId = queue.getSnapshot()!.id;
  const second = queue.ask({ title: "第二次", message: "替换？", confirmLabel: "替换" });
  queue.answer(firstId, false);
  const secondRequest = queue.getSnapshot()!;
  queue.answer(firstId, true);
  assert.equal(queue.getSnapshot(), secondRequest);
  queue.answer(secondRequest.id, true);
  assert.equal(await first, false);
  assert.equal(await second, true);
});

test("unmount cancels all pending operations and clears subscribers safely", async () => {
  const queue = new ConfirmationQueue();
  let updates = 0;
  const unsubscribe = queue.subscribe(() => updates++);
  const first = queue.ask("一");
  const second = queue.ask("二");
  queue.cancelAll();
  assert.deepEqual(await Promise.all([first, second]), [false, false]);
  assert.equal(queue.getSnapshot(), null);
  assert.equal(updates, 3);
  unsubscribe();
  const next = queue.ask("三");
  queue.answer(queue.getSnapshot()!.id, false);
  assert.equal(await next, false);
  assert.equal(updates, 3);
});

test("business UI never uses blocking browser dialogs that can strand desktop focus", async () => {
  const root = new URL("../app/", import.meta.url);
  const files = await readdir(root, { recursive: true });
  for (const file of files.filter((name) => /\.(tsx?|jsx?)$/.test(name))) {
    const source = await readFile(new URL(file.replaceAll("\\", "/"), root), "utf8");
    assert.doesNotMatch(source, /\bwindow\.(?:confirm|alert|prompt)\s*\(/, file);
  }
});
