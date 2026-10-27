import { app, BrowserWindow, dialog, ipcMain, Menu, net, shell, utilityProcess } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopDataPaths } from "./paths.mjs";
import { createCloseConfirmation, restoreInputFocus } from "./window-focus.mjs";
import { verifyAssistantDraft, verifyConfirmationInput } from "./input-smoke.mjs";
import { monitorRenderer } from "./renderer-health.mjs";
import { DesktopUpdates, launchUpdateInstaller, RELEASES_URL } from "./updates.mjs";
import { createUpdateWindow } from "./update-window.mjs";

const smoke = process.env.MEETING_DESKTOP_SMOKE === "1";
const paths = desktopDataPaths({
  env: process.env,
  localAppData: process.env.LOCALAPPDATA,
  userData: app.getPath("userData"),
});
await mkdir(paths.profile, { recursive: true });
await mkdir(paths.logs, { recursive: true });
app.setPath("userData", paths.profile);
app.setPath("sessionData", paths.profile);
const logPath = join(paths.logs, "desktop.log");
let mainWindow;
let backend;
let quitting = false;
let forceQuit = false;
let readyUrl = "";
let updates;
let updateWindow;
let pendingInstaller;
let updateTimer;

async function showUpdates() {
  if (!app.isPackaged || process.platform !== "win32" || paths.portable) {
    await dialog.showMessageBox(mainWindow, { type: "info", title: "软件更新", message: "自动更新适用于 Windows 安装版。请到 GitHub 发布页下载安装版。" });
    return;
  }
  await updateWindow.show();
  if (updates.snapshot().status === "idle") await updates.check();
}

function log(message) {
  appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
}

async function reportSmoke(value) {
  if (smoke && process.env.MEETING_DESKTOP_REPORT) {
    await writeFile(process.env.MEETING_DESKTOP_REPORT, JSON.stringify(value, null, 2));
  }
}

async function fail(error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`Startup failed: ${message}`);
  await reportSmoke({ ok: false, error: message });
  if (!smoke) {
    dialog.showErrorBox("会务智办无法启动", `${message}\n\n运行日志：${logPath}`);
  }
  app.quit();
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("before-quit", (event) => {
    if (forceQuit) return;
    // Let the window's beforeunload protection run before terminating the server.
    if (mainWindow && !mainWindow.isDestroyed()) {
      event.preventDefault();
      mainWindow.close();
      return;
    }
    if (backend && !quitting) {
      event.preventDefault();
      quitting = true;
      backend.postMessage({ type: "shutdown" });
      const timeout = setTimeout(() => {
        backend?.kill();
        forceQuit = true;
        app.quit();
      }, 5000);
      backend.once("exit", () => {
        clearTimeout(timeout);
        backend = undefined;
        forceQuit = true;
        app.quit();
      });
    }
  });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", (event) => {
    if (!pendingInstaller) return;
    event.preventDefault();
    const installer = pendingInstaller;
    pendingInstaller = null;
    // Reached only after the main window allowed unload and the backend stopped.
    void launchUpdateInstaller(installer, dirname(process.execPath)).catch(() => {
      dialog.showErrorBox("更新未能启动", "安装包校验失败或无法运行，请重新打开软件下载更新，或从 GitHub 发布页手动安装。");
    }).finally(() => { forceQuit = true; app.quit(); });
  });

  void app.whenReady().then(async () => {
  const fixture = Buffer.from("MZ isolated updater smoke fixture; not an executable");
  const nextVersion = app.getVersion().split(".").map((part, index) => index === 2 ? Number(part) + 1 : part).join(".");
  updates = new DesktopUpdates({ currentVersion: app.getVersion(), cacheDirectory: join(paths.root, "desktop-updates"),
    // Smoke mode exercises IPC/UI with a deterministic feed, never the public network.
    fetchImpl: smoke ? async (url) => url.endsWith("/latest") ? Response.json({ tag_name: `v${nextVersion}`, draft: false, prerelease: false,
      body: "独立测试数据：验证版本检测、下载进度和安装包校验。本次测试不会执行安装程序。", assets: [{ name: `MeetingAssistant-${nextVersion}-Setup.exe`, state: "uploaded", size: fixture.length,
        digest: `sha256:${createHash("sha256").update(fixture).digest("hex")}`, browser_download_url: `${RELEASES_URL}/download/v${nextVersion}/MeetingAssistant-${nextVersion}-Setup.exe` }] }) : new Response(fixture)
      : (url, options) => net.fetch(url, options) });
  updateWindow = createUpdateWindow({ BrowserWindow, ipcMain, service: updates, getParent: () => mainWindow,
    onInstall: (installer) => { if (!smoke) { pendingInstaller = installer; app.quit(); } },
    openReleases: () => void shell.openExternal(RELEASES_URL) });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: "会务智办", submenu: [
      { label: `软件更新（当前 ${app.getVersion()}）…`, click: () => { void showUpdates().catch(() => log("Update window unavailable")); } },
      { type: "separator" },
      { label: "打开数据文件夹", click: () => void shell.openPath(paths.root) },
      { label: "打开运行日志", click: () => void shell.openPath(paths.logs) },
      { type: "separator" },
      { label: "退出", click: () => app.quit() },
    ] },
    { label: "编辑", submenu: [
      { role: "undo", label: "撤销" }, { role: "redo", label: "重做" },
      { type: "separator" }, { role: "cut", label: "剪切" },
      { role: "copy", label: "复制" }, { role: "paste", label: "粘贴" },
      { role: "selectAll", label: "全选" },
    ] },
    { label: "视图", submenu: [
      { label: "恢复输入焦点", accelerator: "CmdOrCtrl+Shift+F6", click: () => restoreInputFocus(mainWindow) },
      { type: "separator" },
      { role: "zoomIn", label: "放大" }, { role: "zoomOut", label: "缩小" },
      { role: "resetZoom", label: "实际大小" }, { role: "togglefullscreen", label: "全屏" },
    ] },
  ]));

  const runtime = app.isPackaged
    ? join(process.resourcesPath, "runtime")
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");

  try {
    readyUrl = await new Promise((resolveReady, rejectReady) => {
      backend = utilityProcess.fork(join(runtime, "scripts", "local-server.mjs"), [], {
        cwd: runtime,
        env: {
          ...process.env,
          NODE_ENV: "production",
          NO_OPEN_BROWSER: "1",
          MEETING_ASSISTANT_DESKTOP: "1",
          MEETING_ASSISTANT_DATA_DIR: paths.root,
          MEETING_ASSISTANT_DESKTOP_PORT: smoke
            ? process.env.MEETING_DESKTOP_TEST_PORT || "0"
            : "32187",
        },
        stdio: "pipe",
        serviceName: "会务智办后台",
      });
      const timer = setTimeout(() => rejectReady(new Error("后台启动超时，请重新打开软件。")), 30000);
      backend.on("message", (message) => {
        if (message?.type === "ready") {
          clearTimeout(timer);
          resolveReady(message.url);
        }
      });
      backend.on("exit", (code) => {
        clearTimeout(timer);
        if (!readyUrl) rejectReady(new Error(`后台启动失败（${code}），请检查运行日志。`));
        else if (!quitting) void fail(new Error("后台意外停止，请重新打开软件。"));
      });
      // Keep a short startup error log; never include request bodies or API keys.
      backend.stderr?.on("data", (chunk) => log(String(chunk).slice(0, 2000)));
    });

    mainWindow = new BrowserWindow({
      title: "会务智办",
      width: 1440,
      height: 940,
      minWidth: 800,
      minHeight: 600,
      backgroundColor: "#f4f8ff",
      show: false,
      icon: join(runtime, "dist", "client", "favicon.svg"),
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    const localOrigin = new URL(readyUrl).origin;
    monitorRenderer(mainWindow, { log, smoke, showRecovery: (options) => dialog.showMessageBox(mainWindow, options) });
    const openExternal = (url) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    };
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (new URL(url).origin !== localOrigin) {
        event.preventDefault();
        openExternal(url);
      }
    });
    mainWindow.on("focus", () => {
      if (!mainWindow.webContents.isDestroyed()) mainWindow.webContents.focus();
    });
    mainWindow.webContents.on("will-prevent-unload", smoke ? (event) => event.preventDefault() : createCloseConfirmation(mainWindow, (window) =>
      dialog.showMessageBox(window, {
        type: "question",
        title: "确认关闭软件",
        message: "工作区还有未保存修改，关闭后将丢失。请保存后再关闭，或确认放弃修改。",
        buttons: ["继续使用", "关闭软件"],
        defaultId: 0,
        cancelId: 0,
      }), (error) => log(`Close confirmation failed: ${error instanceof Error ? error.name : "unknown"}`), () => {
        pendingInstaller = null;
        updates.cancelInstall();
      }));
    mainWindow.on("closed", () => {
      clearInterval(updateTimer);
      mainWindow = undefined;
      updateWindow.destroy();
    });
    mainWindow.once("ready-to-show", () => {
      if (!smoke) mainWindow.show();
    });
    await mainWindow.loadURL(readyUrl);
    log(`Ready (${paths.portable ? "portable" : "installed"})`);

    if (!smoke && app.isPackaged && process.platform === "win32" && !paths.portable) {
      const check = () => { void updateWindow.checkInBackground().catch(() => log("Update check unavailable")); };
      updateTimer = setInterval(check, 6 * 60 * 60 * 1000);
      updateTimer.unref();
      const startupCheck = setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) check(); }, 10000);
      startupCheck.unref();
    }

    if (smoke) {
      const checks = {};
      for (const path of ["/", "/meetings/new", "/admin", "/lists", "/tasks"]) {
        const response = await fetch(`${readyUrl}${path}`);
        if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
        checks[path] = response.status;
      }
      const rendered = await mainWindow.webContents.executeJavaScript("document.body.innerText");
      if (!rendered.includes("会务智办")) throw new Error("桌面窗口未正确渲染应用。");
      const contactsResponse = await fetch(`${readyUrl}/api/contacts`);
      const configResponse = await fetch(`${readyUrl}/api/admin/config`);
      if (!contactsResponse.ok || !configResponse.ok) throw new Error("数据接口不可用。");
      const configPayload = await configResponse.json();
      const builtinRoomCount = configPayload.config?.meetingRooms?.length;
      const decisionRoom = configPayload.config?.meetingRooms?.find((room) => room.id === "room-landmark-10f-decision");
      if (builtinRoomCount !== 6 || decisionRoom?.areaSqm !== 42.7 || decisionRoom?.tableDimensions !== "3.2m × 1.4m") throw new Error("安装内置会议室资料缺失。");
      const restoredRoom = decisionRoom.name === "决策室（桌面重启保留测试）";
      const restoredTableType = decisionRoom.tableType === "round";
      if (!restoredRoom) {
        decisionRoom.name = "决策室（桌面重启保留测试）";
        decisionRoom.tableType = "round";
        const saved = await fetch(`${readyUrl}/api/admin/config`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: configPayload.revision, summary: "桌面内置会议室修改保留测试", config: configPayload.config }) });
        if (!saved.ok) throw new Error(`会议室保存失败：${saved.status}`);
      }
      const meetingsResponse = await fetch(`${readyUrl}/api/meetings`);
      if (!meetingsResponse.ok) throw new Error("会议接口不可用。");
      const meetings = await meetingsResponse.json();
      const restoredMeeting = meetings.meetings?.some((meeting) => meeting.id === "desktop-smoke-meeting");
      if (!restoredMeeting) {
        const timestamp = new Date().toISOString();
        const save = await fetch(`${readyUrl}/api/meetings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ meetings: [{
            id: "desktop-smoke-meeting", title: "桌面验证会议", date: "2030-01-01",
            startTime: "09:30", endTime: "11:00", location: "测试会议室",
            organizer: "测试单位", owner: "测试人员", attendeeEstimate: 5,
            rosterRequired: false, afternoonMeeting: false, mealType: "none",
            alcoholRequired: false, parkingRequired: false, vehicleCount: 0,
            publicityRequired: false, reimbursementRequired: false,
            presentationRequired: false, welcomeScreenRequired: false,
            roomSize: "small", createdAt: timestamp, updatedAt: timestamp,
            tasks: [], attendees: [],
          }] }),
        });
        if (!save.ok) throw new Error(`会议保存失败：${save.status}`);
      }
      const contacts = await contactsResponse.json();
      const restoredContact = contacts.contacts?.some((contact) => contact.name === "桌面验证联系人");
      if (!restoredContact) {
        const save = await fetch(`${readyUrl}/api/contacts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contact: { name: "桌面验证联系人", unit: "验证单位", department: "", title: "" } }),
        });
        if (!save.ok) throw new Error(`通讯录保存失败：${save.status}`);
      }
      const restoredProfile = await mainWindow.webContents.executeJavaScript("localStorage.getItem('desktop-smoke') === 'saved'");
      await mainWindow.webContents.executeJavaScript("localStorage.setItem('desktop-smoke', 'saved')");
      const inputRecovery = await verifyConfirmationInput(mainWindow, readyUrl);
      const assistantDraft = await verifyAssistantDraft(mainWindow);
      const updateView = await updateWindow.show();
      await updateView.webContents.executeJavaScript("window.meetingUpdates.action('check')");
      await updateView.webContents.executeJavaScript("window.meetingUpdates.action('download')");
      const updaterUi = await updateView.webContents.executeJavaScript("new Promise((resolve, reject) => { const deadline = Date.now() + 5000; const timer = setInterval(() => { if (document.querySelector('#title').textContent === '更新已准备好' && document.querySelector('#primary').textContent === '退出并安装') { clearInterval(timer); resolve(true); } else if (Date.now() > deadline) { clearInterval(timer); reject(new Error('Update UI did not receive IPC state')); } }, 25); })");
      await writeFile(join(dirname(process.env.MEETING_DESKTOP_REPORT), "update-window.png"), (await updateView.webContents.capturePage()).toPNG());
      await reportSmoke({ ok: true, checks, inputRecovery, assistantDraft, updaterUi, builtinRoomCount, restoredRoom, restoredTableType, restoredContact, restoredMeeting, restoredProfile, dataDirectory: paths.root, packaged: app.isPackaged, portable: paths.portable, node: process.versions.node });
      mainWindow.destroy();
      app.quit();
    }
  } catch (error) {
    await fail(error);
  }
  }).catch(fail);
}
