/** Explain known launch failures without treating an unrun validation as a pass. */
export function explainDesktopLaunchFailure(output = "", desktopLog = "") {
  if (/Renderer stopped: reason=launch-failed; exitCode=49(?:\D|$)/.test(desktopLog)) {
    return "当前执行账户无法创建 Chromium 渲染进程所需的受限令牌（sandbox error 49）。请在正常 Windows 用户终端运行同一验证命令；保留桌面沙箱设置。";
  }
  if (/GPU process exited unexpectedly: exit_code=-1073741515(?:\D|$)/.test(output)) {
    return "GPU 辅助进程在初始化时以 0xC0000135 退出（Windows 组件加载失败）。应检查运行组件及执行账户环境，并在正常 Windows 用户终端验证；此结果不能代替应用功能测试。";
  }
  return null;
}
