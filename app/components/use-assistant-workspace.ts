"use client";
import { useEffect, useId, useRef } from "react";
import { registerAssistantWorkspace, type AssistantWorkspaceSnapshot, type WorkspaceMode, type WorkspaceReply } from "../lib/assistant-workspace";
import { useOptionalWorkspaceLocation } from "./workspace-tabs";

export function useAssistantWorkspace(input: {
  suffix: string; label: string; kind: string; meetingId?: string; enabled?: boolean;
  dirty: boolean; data: Record<string, unknown>; editableFields: string[]; modes?: WorkspaceMode[];
  apply: (patch: Record<string, unknown>, mode: WorkspaceMode) => WorkspaceReply | Promise<WorkspaceReply>;
}) {
  const location = useOptionalWorkspaceLocation();
  const hasLocation = Boolean(location);
  const instanceId = useId();
  const id = `${location?.tabId ?? "standalone"}:${input.suffix}:${instanceId}`;
  const applyRef = useRef(input.apply);
  useEffect(() => { applyRef.current = input.apply; }, [input.apply]);
  const json = JSON.stringify({ id, path: location?.pathname ?? "", label: input.label, kind: input.kind,
    meetingId: input.meetingId, dirty: input.dirty, data: input.data, editableFields: input.editableFields, modes: input.modes ?? ["draft"] });
  // Registration follows visible React Activity lifetimes. Hidden tabs cannot receive edits.
  useEffect(() => {
    if (!hasLocation || input.enabled === false) return;
    return registerAssistantWorkspace(JSON.parse(json) as Omit<AssistantWorkspaceSnapshot, "revision">, (patch, mode) => applyRef.current(patch, mode));
  }, [json, input.enabled, hasLocation]);
  return id;
}
