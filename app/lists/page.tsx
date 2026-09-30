"use client";

import dynamic from "next/dynamic";
import { useEffect } from "react";
import { AssistantShell } from "../components/assistant-shell";
import {
  useWorkspaceLocation,
  useWorkspaceTabs,
} from "../components/workspace-tabs";

const RosterTool = dynamic(() => import("./roster-tool"), {
  ssr: false,
  loading: () => (
    <AssistantShell
      title="名单治理"
      subtitle="导入、核对、排序并导出标准参会名单。"
    >
      <div className="roster-module-loading">
        <span />
        正在加载名单治理…
      </div>
    </AssistantShell>
  ),
});

export default function ListsPage() {
  const { searchParams } = useWorkspaceLocation();
  const { replaceActiveTab } = useWorkspaceTabs();
  const linkedMeetingId = searchParams.get("meeting");

  useEffect(() => {
    if (!linkedMeetingId) return;
    replaceActiveTab(
      `/meetings/${encodeURIComponent(linkedMeetingId)}?tab=attendees&mode=governance`,
    );
  }, [linkedMeetingId, replaceActiveTab]);

  if (linkedMeetingId) {
    return (
      <AssistantShell title="参会人员" subtitle="正在打开会议中的名单治理…">
        <div className="roster-module-loading">
          <span />
          正在跳转到会议参会人员…
        </div>
      </AssistantShell>
    );
  }

  return <RosterTool />;
}
