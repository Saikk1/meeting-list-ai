import { join } from "node:path";

export function desktopDataPaths({ env, localAppData, userData }) {
  const root = env.MEETING_DESKTOP_SMOKE === "1" && env.MEETING_DESKTOP_TEST_DATA
    ? env.MEETING_DESKTOP_TEST_DATA
    : env.PORTABLE_EXECUTABLE_DIR
      ? join(env.PORTABLE_EXECUTABLE_DIR, "会务智办数据")
      : localAppData
        ? join(localAppData, "MeetingAssistantAI")
        : userData;
  return {
    root,
    profile: join(root, "desktop-profile"),
    logs: join(root, "desktop-logs"),
    portable: Boolean(env.PORTABLE_EXECUTABLE_DIR),
  };
}
