"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { adminConfigChanges } from "./business-data-events";
import {
  cloneAdminConfig,
  DEFAULT_ADMIN_CONFIG,
  isAdminConfig,
  type AdminConfig,
  type AdminConfigHistoryEntry,
  type AdminConfigPayload,
} from "./admin-config";

type AdminConfigState = {
  config: AdminConfig;
  revision: number;
  updatedAt: string;
  summary: string;
  history: AdminConfigHistoryEntry[];
};

const FALLBACK_STATE: AdminConfigState = {
  config: cloneAdminConfig(DEFAULT_ADMIN_CONFIG),
  revision: 0,
  updatedAt: "",
  summary: "系统内置默认配置",
  history: [],
};

function normalizePayload(value: unknown): AdminConfigState {
  if (!value || typeof value !== "object") return FALLBACK_STATE;
  const payload = value as Partial<AdminConfigPayload>;
  if (!isAdminConfig(payload.config)) return FALLBACK_STATE;
  return {
    config: cloneAdminConfig(payload.config),
    revision: Number(payload.revision) || 0,
    updatedAt:
      typeof payload.updatedAt === "string" ? payload.updatedAt : "",
    summary:
      typeof payload.summary === "string" && payload.summary
        ? payload.summary
        : "已发布配置",
    history: Array.isArray(payload.history)
      ? payload.history.filter(
          (item): item is AdminConfigHistoryEntry =>
            typeof item?.revision === "number" &&
            typeof item?.updatedAt === "string" &&
            typeof item?.summary === "string",
        )
      : [],
  };
}

export function useAdminConfig() {
  const requestSequence = useRef(0);
  const changeRevision = useSyncExternalStore(adminConfigChanges.subscribe, adminConfigChanges.getSnapshot, adminConfigChanges.getServerSnapshot);
  const [state, setState] = useState<AdminConfigState>(FALLBACK_STATE);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/admin/config", {
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`读取配置失败（${response.status}）`);
      }
      const next = normalizePayload(await response.json());
      if (sequence === requestSequence.current) {
        setState(next);
        setReady(true);
      }
      return next;
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "读取配置失败";
      if (sequence === requestSequence.current) setError(message);
      return null;
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void reload();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestSequence.current += 1;
    };
  }, [reload, changeRevision]);

  return {
    ...state,
    loading: loading && !ready,
    refreshing: loading && ready,
    ready,
    error,
    reload,
  };
}
