const ui = Object.fromEntries(["title", "versions", "status", "progress", "error", "release", "notes", "primary", "cancel", "releases"].map((id) => [id, document.getElementById(id)]));
let nextAction = "check";
function render(state) {
  const titles = { idle: "检查软件更新", checking: "正在检查更新", upToDate: "当前已是最新版本", available: "发现新版本",
    downloading: "正在下载更新", downloaded: "更新已准备好", installing: "正在退出并安装", error: "暂时无法更新" };
  ui.title.textContent = titles[state.status] || "软件更新";
  ui.versions.textContent = `当前版本 ${state.currentVersion}${state.version ? `　→　新版 ${state.version}` : ""}`;
  ui.status.textContent = ({ idle: "从 GitHub Releases 检查正式版本。", checking: "正在连接 GitHub…",
    upToDate: "你正在使用最新版本。", available: "点击下载，完成后可直接退出并安装。", downloading: `已下载 ${state.progress}% · 可以关闭此窗口，下载会继续。`,
    downloaded: "下载完成并通过校验，点击下方按钮开始更新。", installing: "正在关闭软件；如果有未保存内容，请在主窗口确认。", error: "可以重试，也可以打开发布页手动下载。" })[state.status] || "";
  ui.progress.hidden = state.status !== "downloading";
  ui.progress.value = state.progress;
  ui.error.hidden = !state.error;
  ui.error.textContent = state.error;
  ui.release.hidden = !state.notes;
  ui.notes.textContent = state.notes;
  nextAction = state.status === "downloaded" ? "install" : state.version ? "download" : "check";
  ui.primary.textContent = ({ check: "检查更新", download: "下载更新", install: "退出并安装" })[nextAction];
  ui.primary.disabled = ["checking", "downloading", "installing"].includes(state.status);
  ui.cancel.hidden = state.status !== "downloading";
}
async function act(action) {
  try { render(await window.meetingUpdates.action(action)); }
  catch { ui.error.hidden = false; ui.error.textContent = "操作失败，请关闭此窗口后重新检查更新。"; }
}
ui.primary.addEventListener("click", () => { void act(nextAction); });
ui.cancel.addEventListener("click", () => { void act("cancel"); });
ui.releases.addEventListener("click", () => { void act("releases"); });
window.meetingUpdates.subscribe(render);
window.meetingUpdates.getState().then(render).catch(() => {
  ui.error.hidden = false; ui.error.textContent = "无法读取更新状态，请重新打开更新窗口。";
});
