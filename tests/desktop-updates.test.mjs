import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { DesktopUpdates, isNewerVersion, launchUpdateInstaller, parseUpdateRelease, RELEASES_URL, UPDATE_API } from "../desktop/updates.mjs";
import { createCloseConfirmation } from "../desktop/window-focus.mjs";
import { createUpdateWindow } from "../desktop/update-window.mjs";

const bytes = Buffer.from("MZ isolated installer fixture; never executed");
const digest = createHash("sha256").update(bytes).digest("hex");
function release(version = "3.2.0") {
  const name = `MeetingAssistant-${version}-Setup.exe`;
  return { tag_name: `v${version}`, draft: false, prerelease: false, body: "测试更新说明 <script>text only</script>",
    assets: [{ name, state: "uploaded", size: bytes.length, digest: `sha256:${digest}`, browser_download_url: `${RELEASES_URL}/download/v${version}/${name}` }] };
}
async function setup(t, fetchImpl) {
  const directory = await mkdtemp(resolve(".tmp/updater-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return new DesktopUpdates({ currentVersion: "3.1.5", cacheDirectory: directory,
    fetchImpl: fetchImpl || (async (url) => url === UPDATE_API ? Response.json(release()) : new Response(bytes)) });
}

test("stable version comparison never downgrades or compares lexically", () => {
  assert.equal(isNewerVersion("3.10.0", "3.9.9"), true);
  assert.equal(isNewerVersion("3.1.5", "3.1.5"), false);
  assert.equal(isNewerVersion("3.1.4", "3.1.5"), false);
  for (const version of ["v3.2.0", "3.2.0-beta.1", "3.2", "3.2.0/../x", "3.10000000.0"]) assert.throws(() => isNewerVersion(version, "3.1.5"));
  assert.equal(parseUpdateRelease(release("3.1.4"), "3.1.5"), null);
});

test("only exact repository installers with bounded size and SHA-256 are accepted", () => {
  for (const mutate of [
    (r) => { r.draft = true; }, (r) => { r.prerelease = true; },
    (r) => { r.assets[0].browser_download_url = "https://example.com/installer.exe"; },
    (r) => { r.assets[0].browser_download_url += "?redirect=other"; },
    (r) => { r.assets[0].name = "Portable.exe"; }, (r) => { r.assets.push(r.assets[0]); },
    (r) => { r.assets[0].digest = null; }, (r) => { r.assets[0].size = 0; },
    (r) => { r.assets[0].size = 1024 ** 3; }, (r) => { r.assets[0].state = "starter"; },
  ]) { const data = release(); mutate(data); assert.throws(() => parseUpdateRelease(data, "3.1.5")); }
  assert.equal(parseUpdateRelease(release(), "3.1.5").sha256, digest);
});

test("concurrent checks share a request; current version and offline/rate limit failures are explicit", async (t) => {
  let done, calls = 0;
  const service = await setup(t, async (_url, options) => {
    calls++;
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Authorization, undefined);
    await new Promise((r) => { done = r; });
    return Response.json(release("3.1.5"));
  });
  const one = service.check(), two = service.check();
  assert.equal(one, two); done();
  assert.equal((await one).status, "upToDate"); assert.equal(calls, 1);
  service.fetchImpl = async () => new Response("", { status: 403 });
  assert.match((await service.check()).error, /频率/);
  service.fetchImpl = async () => { throw new Error("network unavailable"); };
  assert.equal((await service.check()).status, "error");
});

test("downloads verify bytes, report progress, reuse verified cache and recheck before installation", async (t) => {
  let requests = 0;
  const service = await setup(t, async (url) => {
    requests++;
    if (url === UPDATE_API) return Response.json(release());
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 10)); controller.enqueue(bytes.subarray(10)); controller.close();
    } }));
  });
  const progress = []; service.on("state", (s) => { if (s.status === "downloading") progress.push(s.progress); });
  await service.check();
  const one = service.download(), two = service.download(); assert.equal(one, two);
  assert.equal((await one).status, "downloaded");
  assert.ok(progress.some((p) => p > 0 && p < 100));
  const installer = await service.prepareInstall(); assert.deepEqual(await readFile(installer.file), bytes);
  service.cancelInstall(); assert.equal(service.snapshot().status, "downloaded");
  await writeFile(installer.file, "changed");
  assert.equal(await service.prepareInstall(), null);
  assert.equal(service.snapshot().status, "error");
  await service.download(); assert.equal(requests, 3);
  const cached = await setup(t);
  cached.cacheDirectory = service.cacheDirectory;
  cached.fetchImpl = async (url) => { assert.equal(url, UPDATE_API); return Response.json(release()); };
  await cached.check(); assert.equal((await cached.download()).status, "downloaded");
});

test("truncated, oversized or corrupted downloads leave no executable or partial file", async (t) => {
  for (const content of [bytes.subarray(0, 4), Buffer.concat([bytes, bytes]), Buffer.alloc(bytes.length)]) {
    const service = await setup(t, async (url) => url === UPDATE_API ? Response.json(release()) : new Response(content));
    await service.check(); assert.equal((await service.download()).status, "error");
    assert.deepEqual(await readdir(service.cacheDirectory), []);
    assert.equal(await service.prepareInstall(), null);
  }
});

test("canceled downloads are cleaned up and can be retried", async (t) => {
  let started;
  const ready = new Promise((r) => { started = r; });
  const service = await setup(t, async (url, options) => {
    if (url === UPDATE_API) return Response.json(release());
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.subarray(0, 4)); started();
      options.signal.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
    } }));
  });
  await service.check(); const download = service.download(); await ready;
  service.cancelDownload(); assert.equal((await download).status, "available");
  assert.deepEqual(await readdir(service.cacheDirectory), []);
  service.fetchImpl = async () => new Response(bytes);
  assert.equal((await service.download()).status, "downloaded");
});

test("anonymous API limits fall back to the canonical latest page and exact checksum asset", async (t) => {
  let badChecksum = false;
  const service = await setup(t, async (url, options) => {
    assert.equal(options.credentials, "omit");
    if (url === UPDATE_API) return new Response("", { status: 403 });
    if (url === `${RELEASES_URL}/latest`) {
      const page = new Response("unused page");
      Object.defineProperty(page, "url", { value: `${RELEASES_URL}/tag/v3.2.0` }); return page;
    }
    if (url.endsWith("SHA256SUMS-3.2.0.txt")) return new Response(`${digest}  ${badChecksum ? "other.exe" : "MeetingAssistant-3.2.0-Setup.exe"}\n`);
    assert.equal(options.method, "HEAD");
    return new Response(null, { headers: { "content-length": String(bytes.length) } });
  });
  assert.equal((await service.check()).status, "available");
  badChecksum = true;
  assert.equal((await service.check()).status, "error");
});

test("installer handoff verifies again and launches only the exact NSIS update command without a shell", async (t) => {
  const service = await setup(t); await service.check(); await service.download();
  const installer = await service.prepareInstall(); let calls = 0;
  const spawn = (file, args, options) => {
    calls++; assert.equal(file, installer.file);
    assert.deepEqual(args, ["/S", "--updated", "--force-run", "/D=C:\\Apps\\会务 智办"]);
    assert.equal(options.shell, false); assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.unref = () => {};
    queueMicrotask(() => child.emit("spawn")); return child;
  };
  await launchUpdateInstaller(installer, "C:\\Apps\\会务 智办", spawn);
  await writeFile(installer.file, Buffer.alloc(bytes.length));
  await assert.rejects(launchUpdateInstaller(installer, "C:\\Apps", spawn));
  assert.equal(calls, 1);
});

test("canceling or failing the unsaved close prompt cancels pending installation", async () => {
  for (const failure of [false, true]) {
    let pending = true;
    const window = { isDestroyed: () => false, isVisible: () => true, isMinimized: () => false,
      blur() {}, focus() {}, close() { assert.fail("must not close"); }, webContents: { isDestroyed: () => false, focus() {} } };
    const handler = createCloseConfirmation(window, async () => {
      if (failure) throw new Error("dialog failed"); return { response: 0 };
    }, () => {}, () => { pending = false; });
    handler({ preventDefault() { assert.fail("must not discard"); } });
    await new Promise((r) => setImmediate(r)); assert.equal(pending, false);
  }
});

test("update IPC rejects business windows and subframes before invoking update actions", async (t) => {
  const handlers = new Map(); let updateView;
  class FakeWindow extends EventEmitter {
    constructor() { super(); this.webContents = { mainFrame: {}, setWindowOpenHandler() {}, on() {}, send() {} }; }
    isDestroyed() { return false; } async loadFile() {} show() {} focus() {}
  }
  const service = await setup(t);
  const ui = createUpdateWindow({ BrowserWindow: FakeWindow, ipcMain: { handle: (name, callback) => handlers.set(name, callback) },
    service, getParent: () => null, onInstall: () => assert.fail(), openReleases: () => assert.fail() });
  updateView = await ui.show();
  const action = handlers.get("desktop-updates:action");
  await assert.rejects(action({ sender: {}, senderFrame: {} }, "download"));
  await assert.rejects(action({ sender: updateView.webContents, senderFrame: {} }, "download"));
  assert.equal(service.snapshot().status, "idle");
  await action({ sender: updateView.webContents, senderFrame: updateView.webContents.mainFrame }, "check");
  assert.equal(service.snapshot().status, "available");
});
