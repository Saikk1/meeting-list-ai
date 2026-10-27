export function monitorRenderer(window, { log, showRecovery, smoke = false }) {
  let asking = false;
  window.webContents.on("render-process-gone", async (_event, details) => {
    log(`Renderer stopped: reason=${details.reason}; exitCode=${details.exitCode}`);
    if (smoke || asking || window.isDestroyed()) return;
    asking = true;
    try {
      const { response } = await showRecovery({
        type: "error", title: "界面进程已停止",
        message: "界面进程意外停止，未保存的页面草稿可能无法恢复。",
        detail: `原因：${details.reason}；退出代码：${details.exitCode}。可打开运行日志提供诊断信息。`,
        buttons: ["保留窗口", "重新加载界面"], defaultId: 0, cancelId: 0,
      });
      if (response === 1 && !window.isDestroyed()) window.reload();
    } catch { log("Renderer recovery dialog failed"); }
    finally { asking = false; }
  });
  window.webContents.on("console-message", (_event, ...args) => {
    const message = typeof args[0] === "object" ? args[0]?.message : args[1];
    if (typeof message === "string" && message.startsWith("meeting-assistant-render-error")) log(message.slice(0, 16000));
  });
}
