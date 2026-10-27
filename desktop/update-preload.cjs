// Sandboxed Electron preloads must use CommonJS.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("meetingUpdates", {
  getState: () => ipcRenderer.invoke("desktop-updates:state"),
  action: (action) => ipcRenderer.invoke("desktop-updates:action", action),
  subscribe: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("desktop-updates:state", listener);
    return () => ipcRenderer.removeListener("desktop-updates:state", listener);
  },
});
