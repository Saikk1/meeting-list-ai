"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  const initializedRef = useRef(false);
  const [state, setState] = useState<AdminConfigState>(FALLBACK_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const reload = useCallback(async () => {
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
      setState(next);
      return next;
    } catch (requestError) {
      const message =
        requestError instanceof Error
          ? requestError.message
          : "读取配置失败";
      setError(message);
      setState(FALLBACK_STATE);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    const timer = window.setTimeout(() => {
      initializedRef.current = true;
      void reload();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [reload]);

  return {
    ...state,
    loading,
    error,
    reload,
  };
}
