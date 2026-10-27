import type { Metadata } from "next";
import "./globals.css";
import "./meeting-assistant.css";
import "./admin/admin.css";
import "./experience.css";
import {
  ActionAssistantButton,
  ActionAssistantProvider,
} from "./components/action-assistant";
import { WorkspaceTabsProvider } from "./components/workspace-tabs";
import { ConfirmationDialog } from "./components/confirmation-dialog";
import { AppFeedback } from "./components/app-feedback";

export const metadata: Metadata = {
  title: "会务智办｜AI全流程会议助手",
  description:
    "会议项目、参会名单、全流程核对与会后归档各归其位的本机会务助手。",
  openGraph: {
    title: "会务智办｜AI全流程会议助手",
    description:
      "会议项目、参会名单、全流程核对与会后归档各归其位的本机会务助手。",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1732,
        height: 909,
        alt: "会务智办 AI全流程会议助手",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "会务智办｜AI全流程会议助手",
    description:
      "会议项目、参会名单、全流程核对与会后归档各归其位的本机会务助手。",
    images: ["/og.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <ActionAssistantProvider>
          <WorkspaceTabsProvider>{children}</WorkspaceTabsProvider>
          <ActionAssistantButton floating />
          <ConfirmationDialog />
          <AppFeedback />
        </ActionAssistantProvider>
      </body>
    </html>
  );
}
