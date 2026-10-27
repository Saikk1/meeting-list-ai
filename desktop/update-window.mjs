import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = dirname(fileURLToPath(import.meta.url));

// Only the isolated update window can invoke these narrowly scoped actions.
export function createUpdateWindow({ BrowserWindow, ipcMain, service, getParent, onInstall, openReleases }) {
  let window;
  let installing = false;
  let notifiedVersion;
  const isTrusted = (event) => window && !window.isDestroyed()
    && event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
  const publish = (state) => {
    const parent = getParent();
    if (parent && !parent.isDestroyed()) parent.setProgressBar(state.status === "downloading" ? state.progress / 100 : -1);
    if (window && !window.isDestroyed()) window.webContents.send("desktop-updates:state", state);
    if (state.status === "downloaded" && parent && !parent.isDestroyed()) void show().catch(() => {});
  };
  service.on("state", publish);
  ipcMain.handle("desktop-updates:state", (event) => {
    if (!isTrusted(event)) throw new Error("Invalid update window");
    return service.snapshot();
  });
  ipcMain.handle("desktop-updates:action", async (event, action) => {
    if (!isTrusted(event)) throw new Error("Invalid update window");
    if (action === "check") await service.check();
    else if (action === "download") await service.download();
    else if (action === "cancel") service.cancelDownload();
    else if (action === "releases") openReleases();
    else if (action === "install" && !installing) {
      installing = true;
      try {
        const installer = await service.prepareInstall();
        if (installer) { window?.hide(); onInstall(installer); }
      } finally { installing = false; }
    }
    return service.snapshot();
  });

  async function show() {
    if (window && !window.isDestroyed()) { window.show(); window.focus(); return window; }
    window = new BrowserWindow({ parent: getParent(), title: "会务智办 · 软件更新", width: 560, height: 650,
      minWidth: 440, minHeight: 500, show: false, autoHideMenuBar: true, backgroundColor: "#f4f8ff",
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true,
        preload: join(directory, "update-preload.cjs") } });
    const current = window;
    current.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    current.webContents.on("will-navigate", (event) => event.preventDefault());
    current.on("closed", () => { if (window === current) window = null; });
    await current.loadFile(join(directory, "update-ui", "index.html"));
    if (!current.isDestroyed()) current.show();
    return current;
  }
  return {
    show,
    async checkInBackground() {
      const state = await service.check();
      if (state.status === "available" && state.version !== notifiedVersion && getParent() && !getParent().isDestroyed()) {
        notifiedVersion = state.version;
        await show();
      }
    },
    cancelInstall() { service.cancelInstall(); },
    destroy() { service.cancelDownload(); if (window && !window.isDestroyed()) window.destroy(); },
  };
}
