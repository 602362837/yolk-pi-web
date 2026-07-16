"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  StudioChildPanelStatus,
  StudioChildSessionListItem,
  StudioChildSessionListResponse,
} from "@/lib/types";

const ACTIVE_POLL_MS = 5000;

const ACTIVE_STATUSES = new Set<StudioChildPanelStatus>([
  "queued",
  "running",
  "waiting_for_user",
]);

function isActivePanelStatus(status: StudioChildPanelStatus): boolean {
  return ACTIVE_STATUSES.has(status);
}

export type StudioChildSessionsLoadState =
  | "idle"
  | "loading"
  | "ready"
  | "error";

export interface UseStudioChildSessionsResult {
  children: StudioChildSessionListItem[];
  counts: StudioChildSessionListResponse["counts"] | null;
  limits: StudioChildSessionListResponse["limits"] | null;
  parentSessionId: string | null;
  generatedAt: string | null;
  loadState: StudioChildSessionsLoadState;
  /** True when a refresh failed but previous data is still shown. */
  stale: boolean;
  errorMessage: string | null;
  hasActive: boolean;
  refresh: () => void;
}

const EMPTY_CHILDREN: StudioChildSessionListItem[] = [];

function isAbortError(error: unknown): boolean {
  return (
    (error as { name?: string } | null)?.name === "AbortError"
    || (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError")
  );
}

function parseListResponse(data: unknown): StudioChildSessionListResponse | null {
  if (!data || typeof data !== "object") return null;
  const body = data as Partial<StudioChildSessionListResponse>;
  if (body.kind !== "ypi_studio_child_sessions") return null;
  if (typeof body.parentSessionId !== "string" || !Array.isArray(body.children)) return null;
  if (!body.counts || !body.limits || typeof body.generatedAt !== "string") return null;
  return body as StudioChildSessionListResponse;
}

/**
 * Fetch + race-safe refresh for the Chat top-bar YPI Studio child session panel.
 * Independent of useAgentSession tool events; keyed by parent session id.
 */
export function useStudioChildSessions(
  parentSessionId: string | null | undefined,
  options: {
    /** Bump to revalidate (agent end, studio tool, session list refresh, etc.). */
    refreshKey?: number;
    /** When true, revalidate once on open. */
    panelOpen?: boolean;
  } = {},
): UseStudioChildSessionsResult {
  const { refreshKey = 0, panelOpen = false } = options;
  const normalizedParentId = parentSessionId?.trim() || null;

  const [children, setChildren] = useState<StudioChildSessionListItem[]>(EMPTY_CHILDREN);
  const [counts, setCounts] = useState<StudioChildSessionListResponse["counts"] | null>(null);
  const [limits, setLimits] = useState<StudioChildSessionListResponse["limits"] | null>(null);
  const [responseParentId, setResponseParentId] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<StudioChildSessionsLoadState>("idle");
  const [stale, setStale] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [manualRefreshToken, setManualRefreshToken] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const hasDataRef = useRef(false);
  const activeCountRef = useRef(0);
  const parentIdRef = useRef<string | null>(normalizedParentId);

  parentIdRef.current = normalizedParentId;

  const applySuccess = useCallback((body: StudioChildSessionListResponse, generation: number) => {
    if (generation !== generationRef.current) return;
    if (body.parentSessionId !== parentIdRef.current) return;
    setChildren(body.children);
    setCounts(body.counts);
    setLimits(body.limits);
    setResponseParentId(body.parentSessionId);
    setGeneratedAt(body.generatedAt);
    setLoadState("ready");
    setStale(false);
    setErrorMessage(null);
    hasDataRef.current = true;
    activeCountRef.current = body.counts.active;
  }, []);

  const applyFailure = useCallback((message: string, generation: number, parentId: string) => {
    // A parent switch updates parentIdRef during render before its effect can
    // abort/bump generation, so failures need the same identity guard as success.
    if (generation !== generationRef.current || parentId !== parentIdRef.current) return;
    if (hasDataRef.current) {
      setStale(true);
      setErrorMessage(message);
      // Keep loadState ready so the panel keeps showing cached rows.
      setLoadState("ready");
      return;
    }
    setChildren(EMPTY_CHILDREN);
    setCounts(null);
    setLimits(null);
    setResponseParentId(parentIdRef.current);
    setGeneratedAt(null);
    setLoadState("error");
    setStale(false);
    setErrorMessage(message);
    activeCountRef.current = 0;
  }, []);

  const resetForParent = useCallback((nextParentId: string | null) => {
    abortRef.current?.abort();
    abortRef.current = null;
    generationRef.current += 1;
    hasDataRef.current = false;
    activeCountRef.current = 0;
    setChildren(EMPTY_CHILDREN);
    setCounts(null);
    setLimits(null);
    setResponseParentId(nextParentId);
    setGeneratedAt(null);
    setStale(false);
    setErrorMessage(null);
    setLoadState(nextParentId ? "loading" : "idle");
  }, []);

  const fetchList = useCallback(async (reason: "initial" | "refresh" | "poll" | "panel") => {
    const parentId = parentIdRef.current;
    if (!parentId) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++generationRef.current;

    if (!hasDataRef.current) {
      setLoadState("loading");
      setErrorMessage(null);
      setStale(false);
    } else if (reason === "refresh" || reason === "panel") {
      // Keep existing rows visible during revalidate.
      setErrorMessage(null);
    }

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(parentId)}/studio-children`, {
        signal: controller.signal,
        cache: "no-store",
      });
      if (generation !== generationRef.current) return;

      let payload: unknown = null;
      try {
        payload = await res.json();
      } catch {
        payload = null;
      }

      if (!res.ok) {
        const err = (payload as { error?: string } | null)?.error;
        applyFailure(err?.trim() || `Failed to load studio child sessions (${res.status})`, generation, parentId);
        return;
      }

      const body = parseListResponse(payload);
      if (!body) {
        applyFailure("Invalid studio child sessions response", generation, parentId);
        return;
      }
      applySuccess(body, generation);
    } catch (error) {
      if (isAbortError(error) || generation !== generationRef.current) return;
      applyFailure(error instanceof Error ? error.message : "Failed to load studio child sessions", generation, parentId);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [applyFailure, applySuccess]);

  // Parent session identity change: clear and load immediately.
  useEffect(() => {
    resetForParent(normalizedParentId);
    if (!normalizedParentId) return;
    void fetchList("initial");
    return () => {
      abortRef.current?.abort();
    };
    // fetchList/resetForParent are stable enough; identity is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run on parent id change
  }, [normalizedParentId]);

  // Event-driven revalidate (agent end / studio tool / session list refresh / manual).
  // Parent switches are handled by the identity effect above; do not re-run this on parent change alone.
  useEffect(() => {
    if (!normalizedParentId) return;
    if (refreshKey === 0 && manualRefreshToken === 0) return;
    void fetchList("refresh");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, manualRefreshToken]);

  // Revalidate when the panel is opened (not on every render while open).
  const prevPanelOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevPanelOpenRef.current;
    prevPanelOpenRef.current = panelOpen;
    if (!normalizedParentId || !panelOpen || wasOpen) return;
    void fetchList("panel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelOpen, normalizedParentId]);

  // Active + visible 5s polling; stop when terminal-only, hidden, or unmounted.
  useEffect(() => {
    if (!normalizedParentId) return;

    let timer: number | null = null;

    const stop = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const maybeStart = () => {
      stop();
      if (document.visibilityState !== "visible") return;
      if (activeCountRef.current <= 0) return;
      timer = window.setInterval(() => {
        if (document.visibilityState !== "visible") return;
        if (activeCountRef.current <= 0) {
          stop();
          return;
        }
        void fetchList("poll");
      }, ACTIVE_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        if (activeCountRef.current > 0) {
          void fetchList("poll");
        }
        maybeStart();
      } else {
        stop();
      }
    };

    // Re-evaluate when data changes (hasActive may flip).
    maybeStart();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [normalizedParentId, children, fetchList]);

  const refresh = useCallback(() => {
    setManualRefreshToken((token) => token + 1);
  }, []);

  const hasActive = (counts?.active ?? 0) > 0
    || children.some((child) => isActivePanelStatus(child.status)
      || (child.status === "unknown" && !child.finishedAt));

  return {
    children,
    counts,
    limits,
    parentSessionId: responseParentId ?? normalizedParentId,
    generatedAt,
    loadState,
    stale,
    errorMessage,
    hasActive,
    refresh,
  };
}
