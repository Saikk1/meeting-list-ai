"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { confirmAction } from "../lib/confirmation";

type Props = {
  children: ReactNode;
  visible: boolean;
  onClose: () => void;
  onFailure: () => void;
};
type State = { failed: boolean; errorName: string; componentStack: string };

// Keep an assistant render failure outside the business workspace's React tree.
// Deliberately exclude the error message, prompts and API settings from diagnostics.
export class AssistantErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, errorName: "", componentStack: "" };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, errorName: error instanceof Error ? error.name : "RenderError", componentStack: "" };
  }

  componentDidCatch(_error: Error, info: ErrorInfo) {
    const componentStack = (info.componentStack || "").slice(0, 12000);
    console.error("meeting-assistant-render-error", this.state.errorName, componentStack);
    this.setState({ componentStack });
    this.props.onFailure();
  }

  async restart() {
    if (await confirmAction("重建会清除本会话的附件和助手内未保存的草稿，已记录的聊天历史将保留。其他会话、业务页面草稿和已保存数据不受影响。确认重建？")) {
      this.setState({ failed: false, errorName: "", componentStack: "" });
    }
  }

  render() {
    if (!this.state.failed) return this.props.children;
    if (!this.props.visible) return null;
    return <div className="action-assistant-layer" role="presentation">
      <aside className="action-assistant-drawer" role="dialog" aria-label="助手异常恢复">
        <header className="action-assistant-header"><strong>会务智能助手</strong><button type="button" onClick={this.props.onClose}>关闭助手</button></header>
        <div className="action-assistant-messages" role="alert">
          <h2>助手界面发生异常</h2>
          <p>当前会话已停止显示，业务页面和其他会话保持原状。可以先关闭助手，继续处理工作。</p>
          <p>重建会保留已记录的聊天历史，并清除附件及助手内未保存草稿。已保存的数据不受影响。</p>
          <button type="button" onClick={() => void this.restart()}>重建此会话</button>
          <details><summary>查看诊断信息</summary><pre>{this.state.errorName}{"\n"}{this.state.componentStack}</pre></details>
        </div>
      </aside>
    </div>;
  }
}
