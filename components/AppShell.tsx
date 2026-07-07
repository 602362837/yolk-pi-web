"use client";

import { useState, useCallback, useRef, useEffect, type CSSProperties } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SessionSidebar } from "./SessionSidebar";
import { ChatWindow } from "./ChatWindow";
import { FileViewer } from "./FileViewer";
import { TabBar, type Tab } from "./TabBar";
import { ModelsConfig } from "./ModelsConfig";
import { SkillsConfig } from "./SkillsConfig";
import { UsageStatsModal } from "./UsageStatsModal";
import { ChatGptUsagePanel } from "./ChatGptUsagePanel";
import { SubagentPanel } from "./SubagentPanel";
import { SettingsConfig } from "./SettingsConfig";
import { TrellisPanel } from "./TrellisPanel";
import { TrellisSessionWidget } from "./TrellisSessionWidget";
import { YpiStudioSessionWidget } from "./YpiStudioSessionWidget";
import { YpiStudioPanel } from "./YpiStudioPanel";
import { BranchNavigator } from "./BranchNavigator";
import { GitPanel } from "./GitPanel";
import { TerminalPanel } from "./TerminalPanel";
import { getRelativeFilePath } from "@/lib/file-paths";
import { formatWorkspaceTitle } from "@/lib/workspace-title";
import { useTheme } from "@/hooks/useTheme";
import type { GitInfo, SessionInfo, SessionTreeNode } from "@/lib/types";
import type { PiWebConfig } from "@/lib/pi-web-config";
import type { TrellisSessionTaskLinkResult, TrellisTaskDetail } from "@/lib/trellis-types";
import type { YpiStudioAgent, YpiStudioLiveRunOverlay, YpiStudioSessionTaskLinkResult } from "@/lib/ypi-studio-types";
import { trellisTaskDetailToChatContext, type TrellisTaskChatContext } from "@/lib/trellis-chat-context";
import type { ChatInputHandle } from "./ChatInput";

const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 520;
const SIDEBAR_WIDTH_STORAGE_KEY = "pi-web-sidebar-width";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getInitialSidebarWidth(): number {
  if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
  const stored = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
  if (!Number.isFinite(stored)) return DEFAULT_SIDEBAR_WIDTH;
  return clampNumber(stored, MIN_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH);
}

function studioContextIdForSession(sessionId: string | null | undefined): string | null {
  if (!sessionId) return null;
  const safe = sessionId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return `pi_${safe || sessionId}`;
}

export function AppShell() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDark, toggleTheme } = useTheme();
  const [selectedSession, setSelectedSession] = useState<SessionInfo | null>(null);
  // When user clicks +, we only store the cwd/project context — no fake session id
  const [newSessionCwd, setNewSessionCwd] = useState<string | null>(null);
  const [activeProjectContext, setActiveProjectContext] = useState<{ projectId: string; spaceId: string; cwd: string } | null>(null);
  const [newSessionProjectContext, setNewSessionProjectContext] = useState<{ projectId: string; spaceId: string } | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [sessionKey, setSessionKey] = useState(0);
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const [modelsConfigOpen, setModelsConfigOpen] = useState(false);
  const [modelsRefreshKey, setModelsRefreshKey] = useState(0);
  const [skillsConfigOpen, setSkillsConfigOpen] = useState(false);
  const [usageStatsOpen, setUsageStatsOpen] = useState(false);
  const [settingsConfigOpen, setSettingsConfigOpen] = useState(false);
  const [settingsStudioFocusMember, setSettingsStudioFocusMember] = useState<{ id: string; name?: string } | null>(null);
  const [webConfig, setWebConfig] = useState<PiWebConfig | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [terminalDockCwd, setTerminalDockCwd] = useState<string | null>(null);
  const [terminalInitialInput, setTerminalInitialInput] = useState<{ id: string; text: string } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(getInitialSidebarWidth);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const chatInputRef = useRef<ChatInputHandle | null>(null);
  const topBarRef = useRef<HTMLDivElement>(null);

  const loadWebConfig = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/web-config", { signal });
      const data = await res.json() as { config?: PiWebConfig; error?: string };
      if (res.ok && data.config && !data.error) setWebConfig(data.config);
      else setWebConfig(null);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setWebConfig(null);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWebConfig(controller.signal);
    return () => controller.abort();
  }, [loadWebConfig]);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  const handleSidebarResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!sidebarOpen) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const maxWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, Math.floor(window.innerWidth * 0.6)));
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setSidebarResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextWidth = clampNumber(startWidth + moveEvent.clientX - startX, MIN_SIDEBAR_WIDTH, maxWidth);
      setSidebarWidth(nextWidth);
    };

    const finishResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setSidebarResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }, [sidebarOpen, sidebarWidth]);

  // Branch navigator state — populated by ChatWindow via onBranchDataChange
  const [branchTree, setBranchTree] = useState<SessionTreeNode[]>([]);
  const [branchActiveLeafId, setBranchActiveLeafId] = useState<string | null>(null);
  const branchLeafChangeFnRef = useRef<((leafId: string | null) => void) | null>(null);

  const handleBranchDataChange = useCallback((tree: SessionTreeNode[], activeLeafId: string | null, onLeafChange: (leafId: string | null) => void) => {
    setBranchTree(tree);
    setBranchActiveLeafId(activeLeafId);
    branchLeafChangeFnRef.current = onLeafChange;
  }, []);

  const handleBranchLeafChange = useCallback((leafId: string | null) => {
    branchLeafChangeFnRef.current?.(leafId);
  }, []);

  const [systemPrompt, setSystemPrompt] = useState<string | null>(null);
  const systemBtnRef = useRef<HTMLButtonElement>(null);

  const handleSystemPromptChange = useCallback((prompt: string | null) => {
    setSystemPrompt(prompt);
  }, []);

  // Session stats (tokens + cost) — populated by ChatWindow, displayed in top bar
  const [sessionStats, setSessionStats] = useState<{ tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null>(null);
  const handleSessionStatsChange = useCallback((stats: { tokens: { input: number; output: number; cacheRead: number; cacheWrite: number }; cost?: number } | null) => {
    setSessionStats(stats);
  }, []);

  // Context usage — populated by ChatWindow, displayed in top bar
  const [contextUsage, setContextUsage] = useState<{ percent: number | null; contextWindow: number; tokens: number | null } | null>(null);
  const handleContextUsageChange = useCallback((usage: { percent: number | null; contextWindow: number; tokens: number | null } | null) => {
    setContextUsage(usage);
  }, []);

  // Subagent runs — populated by ChatWindow, displayed in top bar panel
  const [subagentRuns, setSubagentRuns] = useState<import("@/hooks/useAgentSession").SubagentRun[]>([]);
  const handleSubagentChange = useCallback((runs: import("@/hooks/useAgentSession").SubagentRun[]) => {
    setSubagentRuns(runs);
  }, []);

  // Git panel state
  const [gitDirty, setGitDirty] = useState(false);
  const [gitRefreshKey, setGitRefreshKey] = useState(0);

  // Single active panel — only one dropdown open at a time
  const [activeTopPanel, setActiveTopPanel] = useState<"branches" | "system" | "subagents" | "git" | null>(null);
  const [topPanelPos, setTopPanelPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const toggleTopPanel = useCallback((panel: "branches" | "system" | "subagents" | "git") => {
    setActiveTopPanel((cur) => cur === panel ? null : panel);
  }, []);

  useEffect(() => {
    if (!activeTopPanel || !topBarRef.current) return;
    const update = () => {
      const rect = topBarRef.current!.getBoundingClientRect();
      setTopPanelPos({ top: rect.bottom, left: rect.left, width: rect.width });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(topBarRef.current);
    return () => ro.disconnect();
  }, [activeTopPanel]);

  // Right panel — file tabs, Studio members, and optional Trellis task drawer
  const [fileTabs, setFileTabs] = useState<Tab[]>([]);
  const [activeFileTabId, setActiveFileTabId] = useState<string | null>(null);
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [rightPanelMode, setRightPanelMode] = useState<"files" | "studio" | "trellis">("files");
  const [focusedTrellisTaskKey, setFocusedTrellisTaskKey] = useState<string | null>(null);
  const [trellisSessionTask, setTrellisSessionTask] = useState<TrellisSessionTaskLinkResult | null>(null);
  const [trellisSessionTaskRefreshKey, setTrellisSessionTaskRefreshKey] = useState(0);
  const [focusedStudioTaskKey, setFocusedStudioTaskKey] = useState<string | null>(null);
  const [studioSessionTask, setStudioSessionTask] = useState<YpiStudioSessionTaskLinkResult | null>(null);
  const [studioSessionTaskRefreshKey, setStudioSessionTaskRefreshKey] = useState(0);
  const [studioLiveOverlays, setStudioLiveOverlays] = useState<YpiStudioLiveRunOverlay[]>([]);
  const [chatAgentRunning, setChatAgentRunning] = useState(false);
  const studioToolTaskSignatureRef = useRef("");
  const studioToolRefreshTimerRef = useRef<number | null>(null);
  const [pendingTrellisTaskContext, setPendingTrellisTaskContext] = useState<TrellisTaskChatContext | null>(null);

  const handleAtMention = useCallback((relativePath: string) => {
    chatInputRef.current?.addFileReference(relativePath);
  }, []);

  const [initialSessionId] = useState<string | null>(() => searchParams.get("session"));
  const [activeCwd, setActiveCwd] = useState<string | null>(null);
  const [activeCwdGit, setActiveCwdGit] = useState<GitInfo | undefined>(undefined);
  // True once the initial ?session= URL param has been resolved (or confirmed absent)
  const [initialSessionRestored, setInitialSessionRestored] = useState<boolean>(() => !searchParams.get("session"));
  // Suppresses sessionKey bump in handleCwdChange during the initial URL restore
  const suppressCwdBumpRef = useRef(false);

  const handleAddChat = useCallback((filePath: string, selection?: { startLine: number; endLine: number }) => {
    const relativePath = getRelativeFilePath(filePath, activeCwd ?? undefined);
    chatInputRef.current?.addFileReference(relativePath, selection);
  }, [activeCwd]);

  const handleCwdChange = useCallback((cwd: string | null) => {
    if (cwd !== activeCwd) {
      setFileTabs([]);
      setActiveFileTabId(null);
      if (rightPanelMode === "files") setRightPanelOpen(false);
    }
    setActiveCwd(cwd);
    // Keep an already-open terminal pinned to the cwd captured when it was opened;
    // terminal processes are ephemeral and should not be silently killed or retargeted
    // just because the selected chat/workspace changed.
    // Skip if cwd is null (initial mount) or during the initial URL restore.
    if (!cwd || suppressCwdBumpRef.current) return;
    // Close any session that belongs to a different cwd — it no longer
    // matches the selected project directory.
    setSelectedSession((prev) => {
      if (prev && prev.cwd !== cwd) return null;
      return prev;
    });
    setNewSessionCwd((prev) => {
      if (prev && prev !== cwd) return null;
      return prev;
    });
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    setGitRefreshKey((k) => k + 1);
    setGitDirty(false);
    router.replace("/", { scroll: false });
  }, [activeCwd, rightPanelMode, router]);

  const handleSelectSession = useCallback((session: SessionInfo, isRestore = false) => {
    setNewSessionCwd(null);
    setNewSessionProjectContext(null);
    setSelectedSession(session);
    setSessionKey((k) => k + 1);
    setSystemPrompt(null);
    setInitialSessionRestored(true);
    if (isRestore) {
      // Suppress the redundant sessionKey bump that would come from the
      // onCwdChange effect firing after setSelectedCwd in the sidebar
      suppressCwdBumpRef.current = true;
      setTimeout(() => { suppressCwdBumpRef.current = false; }, 0);
    }
    // Skip router.replace when restoring from URL — the param is already correct
    // and calling replace in production Next.js triggers a Suspense remount loop
    if (!isRestore) {
      router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
    }
  }, [router]);

  const handleNewSession = useCallback((_sessionId: string, cwd: string, projectId?: string, spaceId?: string) => {
    setSelectedSession(null);
    setNewSessionCwd(cwd);
    setNewSessionProjectContext(projectId && spaceId ? { projectId, spaceId } : activeProjectContext?.cwd === cwd ? { projectId: activeProjectContext.projectId, spaceId: activeProjectContext.spaceId } : null);
    setSessionKey((k) => k + 1);
    setBranchTree([]);
    setBranchActiveLeafId(null);
    setSystemPrompt(null);
    setActiveTopPanel(null);
    router.replace("/", { scroll: false });
  }, [activeProjectContext, router]);

  // Called by ChatWindow when a new session gets its real id from pi
  const handleSessionCreated = useCallback((session: SessionInfo) => {
    setNewSessionCwd(null);
    setNewSessionProjectContext(null);
    setSelectedSession((prev) => {
      if (prev?.id !== session.id) return session;
      return {
        ...prev,
        ...session,
        name: session.name ?? prev.name,
        firstMessage: session.firstMessage || prev.firstMessage,
        messageCount: Math.max(prev.messageCount ?? 0, session.messageCount ?? 0),
        modified: session.modified || prev.modified,
      };
    });
    setRefreshKey((k) => k + 1);
    router.replace(`?session=${encodeURIComponent(session.id)}`, { scroll: false });
  }, [router]);

  const handleAgentEnd = useCallback(() => {
    setRefreshKey((k) => k + 1);
    setExplorerRefreshKey((k) => k + 1);
    setGitRefreshKey((k) => k + 1);
    setTrellisSessionTaskRefreshKey((k) => k + 1);
    setStudioSessionTaskRefreshKey((k) => k + 1);
  }, []);

  const handleSessionForked = useCallback((newSessionId: string) => {
    setRefreshKey((k) => k + 1);
    setSessionKey((k) => k + 1);
    setNewSessionCwd(null);
    setNewSessionProjectContext(null);
    setSelectedSession((prev) => ({
      ...(prev ?? { path: "", cwd: "", created: "", modified: "", messageCount: 0, firstMessage: "" }),
      id: newSessionId,
    }));
    router.replace(`?session=${encodeURIComponent(newSessionId)}`, { scroll: false });
  }, [router]);

  const handleInitialRestoreDone = useCallback(() => {
    setInitialSessionRestored(true);
  }, []);

  const handleSessionDeleted = useCallback((sessionId: string) => {
    setRefreshKey((k) => k + 1);
    if (selectedSession?.id === sessionId) {
      const cwd = selectedSession.cwd;
      setSelectedSession(null);
      setNewSessionCwd(cwd ?? null);
      setSessionKey((k) => k + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [selectedSession, router]);

  const handleOpenFile = useCallback((filePath: string, fileName: string, line?: number) => {
    const tabId = `file:${filePath}`;
    setFileTabs((prev) => {
      const existing = prev.find((t) => t.id === tabId);
      if (existing) return prev.map((tab) => tab.id === tabId ? { ...tab, line } : tab);
      return [...prev, { id: tabId, label: fileName, filePath, line }];
    });
    setActiveFileTabId(tabId);
    setRightPanelMode("files");
    setRightPanelOpen(true);
  }, []);

  const handleCloseFileTab = useCallback((tabId: string) => {
    setFileTabs((prev) => {
      const next = prev.filter((t) => t.id !== tabId);
      if (next.length === 0 && rightPanelMode === "files") setRightPanelOpen(false);
      return next;
    });
    setActiveFileTabId((cur) => {
      if (cur !== tabId) return cur;
      const remaining = fileTabs.filter((t) => t.id !== tabId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [fileTabs, rightPanelMode]);

  const handleExportSession = useCallback(() => {
    if (!selectedSession) return;
    window.location.href = `/api/sessions/${encodeURIComponent(selectedSession.id)}/export`;
  }, [selectedSession]);

  // Show chat area if a session is selected, or if we have a cwd to start a new session in
  const effectiveNewSessionCwd = newSessionCwd ?? (selectedSession === null && activeCwd ? activeCwd : null);
  const showChat = selectedSession !== null || effectiveNewSessionCwd !== null;
  // While restoring initial session from URL, don't show the placeholder
  const showPlaceholder = initialSessionRestored && !showChat;

  const activeFileTab = fileTabs.find((t) => t.id === activeFileTabId) ?? null;
  const trellisEnabled = webConfig?.trellis.enabled ?? false;
  const terminalEnabled = webConfig?.terminal.enabled ?? false;
  const trellisIncludeArchivedDefault = webConfig?.trellis.includeArchived ?? false;
  const trellisCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
  const studioCwd = trellisCwd;
  const terminalCwd = activeCwd ?? selectedSession?.cwd ?? newSessionCwd;
  const rightPanelTogglePadding = rightPanelOpen ? 12 : 48 + 36 + (trellisEnabled ? 36 : 0);
  const browserTitleCwd = selectedSession?.cwd ?? newSessionCwd ?? activeCwd;
  const browserTitleGit = selectedSession?.cwd === browserTitleCwd ? selectedSession.git : activeCwdGit;

  const loadTrellisSessionTask = useCallback(async (signal?: AbortSignal) => {
    if (!trellisEnabled || !selectedSession || selectedSession.archived) {
      setTrellisSessionTask(null);
      return;
    }

    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}/trellis-task`, { signal });
      const data = await res.json() as TrellisSessionTaskLinkResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTrellisSessionTask(data.task ? data : null);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setTrellisSessionTask(null);
    }
  }, [selectedSession, trellisEnabled]);

  useEffect(() => {
    setFocusedTrellisTaskKey(null);
  }, [selectedSession?.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTrellisSessionTask(controller.signal);
    return () => controller.abort();
  }, [loadTrellisSessionTask, trellisSessionTaskRefreshKey]);

  const trellisSessionTaskKey = trellisSessionTask?.task?.key ?? null;

  useEffect(() => {
    if (!trellisSessionTaskKey) return;
    const interval = window.setInterval(() => {
      setTrellisSessionTaskRefreshKey((key) => key + 1);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [trellisSessionTaskKey]);

  const handleOpenTrellisSessionTask = useCallback(() => {
    if (!trellisSessionTask?.task) return;
    setFocusedTrellisTaskKey(trellisSessionTask.task.key);
    setRightPanelMode("trellis");
    setRightPanelOpen(true);
  }, [trellisSessionTask]);

  const loadStudioSessionTask = useCallback(async (signal?: AbortSignal) => {
    if (!selectedSession || selectedSession.archived) {
      setStudioSessionTask(null);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (branchActiveLeafId) params.set("leafId", branchActiveLeafId);
      const suffix = params.toString() ? `?${params.toString()}` : "";
      const res = await fetch(`/api/sessions/${encodeURIComponent(selectedSession.id)}/studio-task${suffix}`, { signal });
      const data = await res.json() as YpiStudioSessionTaskLinkResult & { error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStudioSessionTask(data.task ? data : null);
    } catch (error) {
      if ((error as { name?: string }).name !== "AbortError") setStudioSessionTask(null);
    }
  }, [branchActiveLeafId, selectedSession]);

  useEffect(() => {
    setFocusedStudioTaskKey(null);
    setStudioSessionTask(null);
    setStudioLiveOverlays([]);
    setChatAgentRunning(false);
    studioToolTaskSignatureRef.current = "";
  }, [selectedSession?.id]);

  useEffect(() => {
    const controller = new AbortController();
    void loadStudioSessionTask(controller.signal);
    return () => controller.abort();
  }, [loadStudioSessionTask, studioSessionTaskRefreshKey]);

  const studioSessionTaskKey = studioSessionTask?.task?.key ?? null;
  const studioRuntimeStatus = studioSessionTask?.task?.implementationProjection?.sessionRuntime?.status;
  const studioActiveRunCount =
    (studioSessionTask?.task?.subagents.filter((run) => run.status === "running" || run.status === "queued" || run.status === "waiting_for_user").length ?? 0)
    + studioLiveOverlays.filter((overlay) => overlay.running || overlay.status === "running" || overlay.status === "queued" || overlay.status === "waiting_for_user").length
    + (studioSessionTask?.task?.implementationProjection?.statusCounts.running ?? 0)
    + (studioSessionTask?.task?.implementationProjection?.statusCounts.queued ?? 0);
  const studioHasActiveRuns = studioActiveRunCount > 0;
  const studioNeedsAttention = studioRuntimeStatus === "needs_user";
  const studioWaitingForChildren = studioRuntimeStatus === "waiting_for_studio_children";

  useEffect(() => {
    if (!selectedSession || selectedSession.archived) return;
    if (!studioSessionTaskKey && !chatAgentRunning) return;
    const intervalMs = studioHasActiveRuns || chatAgentRunning || studioWaitingForChildren || studioNeedsAttention ? 4000 : 20000;
    const interval = window.setInterval(() => setStudioSessionTaskRefreshKey((key) => key + 1), intervalMs);
    return () => window.clearInterval(interval);
  }, [chatAgentRunning, selectedSession, studioHasActiveRuns, studioNeedsAttention, studioSessionTaskKey, studioWaitingForChildren]);

  useEffect(() => () => {
    if (studioToolRefreshTimerRef.current !== null) window.clearTimeout(studioToolRefreshTimerRef.current);
  }, []);

  const handleStudioToolProgressChange = useCallback((snapshot: { agentRunning: boolean; overlays: YpiStudioLiveRunOverlay[] }) => {
    setChatAgentRunning(snapshot.agentRunning);
    setStudioLiveOverlays(snapshot.overlays);
    const taskSignature = snapshot.overlays
      .filter((overlay) => !overlay.running && (overlay.taskKey || overlay.taskId))
      .map((overlay) => `${overlay.toolCallId}:${overlay.taskKey ?? overlay.taskId}:${overlay.status ?? ""}`)
      .sort()
      .join("|");
    if (taskSignature && taskSignature !== studioToolTaskSignatureRef.current) {
      studioToolTaskSignatureRef.current = taskSignature;
      if (studioToolRefreshTimerRef.current !== null) window.clearTimeout(studioToolRefreshTimerRef.current);
      studioToolRefreshTimerRef.current = window.setTimeout(() => {
        studioToolRefreshTimerRef.current = null;
        setStudioSessionTaskRefreshKey((key) => key + 1);
      }, 500);
    }
  }, []);

  const handleOpenStudioSessionTask = useCallback(() => {
    if (!studioSessionTask?.task) return;
    setFocusedStudioTaskKey(studioSessionTask.task.key);
    setRightPanelMode("studio");
    setRightPanelOpen(true);
  }, [studioSessionTask]);

  const handleOpenStudioMemberSettings = useCallback((agent: YpiStudioAgent) => {
    setSettingsStudioFocusMember({ id: agent.id, name: agent.name });
    setSettingsConfigOpen(true);
  }, []);

  const handleOpenTerminalCommand = useCallback((cwd: string, command: string) => {
    setTerminalDockCwd(cwd);
    setTerminalOpen(true);
    setTerminalCollapsed(false);
    setTerminalInitialInput({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, text: command });
  }, []);

  const handleJoinTrellisTaskChat = useCallback((task: TrellisTaskDetail) => {
    if (task.isArchived || !trellisCwd) return;

    const context = trellisTaskDetailToChatContext(task);
    setPendingTrellisTaskContext(context);

    if (!selectedSession || selectedSession.cwd !== trellisCwd || selectedSession.archived) {
      setSelectedSession(null);
      setNewSessionCwd(trellisCwd);
      setSessionKey((key) => key + 1);
      setBranchTree([]);
      setBranchActiveLeafId(null);
      setSystemPrompt(null);
      setActiveTopPanel(null);
      router.replace("/", { scroll: false });
    }
  }, [router, selectedSession, trellisCwd]);

  useEffect(() => {
    if (!pendingTrellisTaskContext || !showChat) return;

    let cancelled = false;
    let attempts = 0;
    const tryInsert = () => {
      if (cancelled) return;
      if (chatInputRef.current) {
        chatInputRef.current.addTrellisTaskContext(pendingTrellisTaskContext);
        setPendingTrellisTaskContext(null);
        return;
      }
      attempts += 1;
      if (attempts < 12) window.requestAnimationFrame(tryInsert);
    };

    window.requestAnimationFrame(tryInsert);
    return () => { cancelled = true; };
  }, [pendingTrellisTaskContext, sessionKey, showChat]);

  useEffect(() => {
    if (!trellisEnabled && rightPanelMode === "trellis") {
      setRightPanelMode("files");
      if (fileTabs.length === 0) setRightPanelOpen(false);
    }
  }, [trellisEnabled, rightPanelMode, fileTabs.length]);

  useEffect(() => {
    if (!terminalEnabled || (!terminalCwd && !terminalDockCwd)) {
      setTerminalOpen(false);
      setTerminalCollapsed(false);
      setTerminalDockCwd(null);
    }
  }, [terminalEnabled, terminalCwd, terminalDockCwd]);

  useEffect(() => {
    if (!activeCwd) {
      setActiveCwdGit(undefined);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/git/info?cwd=${encodeURIComponent(activeCwd)}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data: { git?: GitInfo } | null) => {
        if (!controller.signal.aborted) setActiveCwdGit(data?.git);
      })
      .catch(() => {
        if (!controller.signal.aborted) setActiveCwdGit(undefined);
      });

    return () => controller.abort();
  }, [activeCwd]);

  useEffect(() => {
    const title = formatWorkspaceTitle(browserTitleCwd, browserTitleGit);
    const applyTitle = () => {
      if (document.title !== title) document.title = title;
    };

    applyTitle();
    const animationFrame = requestAnimationFrame(applyTitle);
    const timeout = window.setTimeout(applyTitle, 0);
    const observer = new MutationObserver(applyTitle);
    observer.observe(document.head, { childList: true, subtree: true, characterData: true });

    return () => {
      cancelAnimationFrame(animationFrame);
      window.clearTimeout(timeout);
      observer.disconnect();
    };
  }, [browserTitleCwd, browserTitleGit]);

  const sidebarContainerStyle = {
    "--sidebar-width": `${sidebarWidth}px`,
    background: "var(--bg-panel)",
    borderRight: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    zIndex: 200,
  } as CSSProperties;

  const sidebarContent = (
    <>
      <SessionSidebar
        selectedSessionId={selectedSession?.id ?? null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
        onProjectSpaceChange={setActiveProjectContext}
        initialSessionId={initialSessionId}
        onInitialRestoreDone={handleInitialRestoreDone}
        refreshKey={refreshKey}
        onSessionDeleted={handleSessionDeleted}
        selectedCwd={selectedSession?.cwd ?? newSessionCwd ?? null}
        onCwdChange={handleCwdChange}
        onOpenFile={handleOpenFile}
        explorerRefreshKey={explorerRefreshKey}
        onAtMention={handleAtMention}
        trellisEnabled={trellisEnabled}
        terminalEnabled={terminalEnabled}
        onOpenTerminalCommand={handleOpenTerminalCommand}
      />
      <div style={{ padding: "8px", flexShrink: 0, display: "flex", justifyContent: "space-between", gap: 4 }}>
        {([
          {
            label: "Models",
            onClick: () => setModelsConfigOpen(true),
            disabled: false,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
              </svg>
            ),
          },
          {
            label: "Usage",
            onClick: () => setUsageStatsOpen(true),
            disabled: false,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="1" x2="12" y2="23" />
                <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7H14a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            ),
          },
          {
            label: "Skills",
            onClick: () => setSkillsConfigOpen(true),
            disabled: !activeCwd && !selectedSession?.cwd && !newSessionCwd,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
            ),
          },
          {
            label: "Settings",
            onClick: () => { setSettingsStudioFocusMember(null); setSettingsConfigOpen(true); },
            disabled: false,
            icon: (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.06V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.06-.33H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1.06V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.4.14.74.38 1 .6.31.23.68.35 1.06.33H21a2 2 0 1 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z" />
              </svg>
            ),
          },
        ] as { label: string; onClick: () => void; disabled: boolean; icon: React.ReactNode }[]).map(({ label, onClick, disabled, icon }) => (
          <button
            key={label}
            onClick={onClick}
            disabled={disabled}
            title={label}
            style={{
              flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
              height: 32, padding: 0, background: "none", border: "none",
              borderRadius: 9, color: "var(--text-muted)", cursor: disabled ? "default" : "pointer",
              fontSize: 12, opacity: disabled ? 0.35 : 1,
              transition: "background 0.12s, color 0.12s",
            }}
            onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; } }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <>
    <div className="app-shell-root" style={{ display: "flex", height: "100dvh", overflow: "hidden", background: "var(--bg)" }}>
      {/* Mobile overlay backdrop */}
      <div
        className="sidebar-overlay-backdrop"
        onClick={() => setSidebarOpen(false)}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 199,
          background: "rgba(0,0,0,0.4)",
          opacity: sidebarOpen ? 1 : 0,
          pointerEvents: sidebarOpen ? "auto" : "none",
          transition: "opacity 0.25s ease",
        }}
      />

      {/* Left sidebar */}
      <div
        className={`sidebar-container${sidebarOpen ? " sidebar-open" : " sidebar-closed"}${sidebarResizing ? " sidebar-resizing" : ""}`}
        style={sidebarContainerStyle}
      >
        {sidebarContent}
        {sidebarOpen && (
          <div
            className="sidebar-resize-handle"
            onPointerDown={handleSidebarResizePointerDown}
            title="Resize sidebar"
            aria-label="Resize sidebar"
            role="separator"
            aria-orientation="vertical"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 8,
              cursor: "col-resize",
              touchAction: "none",
              background: sidebarResizing ? "rgba(37,99,235,0.08)" : "transparent",
              zIndex: 25,
            }}
          />
        )}
      </div>

      {/* Center: chat */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>
        {/* Top bar with sidebar toggle */}
        <div ref={topBarRef} className="app-top-bar" style={{ display: "flex", alignItems: "center", flexShrink: 0, borderBottom: "1px solid var(--border)", height: 36, background: "var(--bg-panel)" }}>
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {sidebarOpen ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            )}
          </button>
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              toggleTheme({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
            }}
            title={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            aria-pressed={isDark}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, padding: 0,
              background: "none", border: "none", borderRight: "1px solid var(--border)",
              color: "var(--text-muted)", cursor: "pointer", flexShrink: 0, transition: "color 0.12s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            {isDark ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>
          {showChat && (
            <div className="app-top-actions" style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
              <button
                onClick={handleExportSession}
                disabled={!selectedSession}
                title={selectedSession ? "Export HTML" : "Export is available after the session is saved"}
                aria-label="Export HTML"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  height: "100%",
                  padding: "0 12px",
                  background: "none",
                  border: "none",
                  borderTop: "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: selectedSession ? "pointer" : "not-allowed",
                  opacity: selectedSession ? 1 : 0.45,
                  flexShrink: 0,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  transition: "color 0.1s, background 0.1s, opacity 0.1s",
                }}
                onMouseEnter={(e) => {
                  if (!selectedSession) return;
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = selectedSession ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.background = "none";
                }}
              >
                <span style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 18,
                  height: 18,
                  borderRadius: 5,
                  background: "transparent",
                  color: selectedSession ? "var(--text-muted)" : "var(--text-dim)",
                  flexShrink: 0,
                }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </span>
                <span className="app-top-label">Export</span>
              </button>
              <BranchNavigator
                tree={branchTree}
                activeLeafId={branchActiveLeafId}
                onLeafChange={handleBranchLeafChange}
                inline
                containerRef={topBarRef}
                open={activeTopPanel === "branches"}
                onToggle={() => toggleTopPanel("branches")}
                hasSession
              />
              <button
                ref={systemBtnRef}
                onClick={() => toggleTopPanel("system")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "system" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "system" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  color: activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "system" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: systemPrompt ? "var(--accent)" : "var(--text-dim)", flexShrink: 0 }}>
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="8" y1="13" x2="16" y2="13" />
                  <line x1="8" y1="17" x2="13" y2="17" />
                </svg>
                <span className="app-top-label">System</span>
              </button>
              <button
                onClick={() => toggleTopPanel("subagents")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "subagents" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "subagents" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  color: activeTopPanel === "subagents" ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                  position: "relative",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "subagents" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span className="app-top-label">Subagents</span>
                {(() => {
                  const running = subagentRuns.filter((r) => r.status === "running").length;
                  const completed = subagentRuns.filter((r) => r.status === "completed" || r.status === "failed").length;
                  if (running > 0) {
                    return (
                      <span style={{
                        position: "absolute", top: 4, right: 4,
                        width: 7, height: 7, borderRadius: "50%",
                        background: "#f59e0b",
                      }} />
                    );
                  }
                  if (completed > 0) {
                    return (
                      <span style={{
                        fontSize: 10, color: "#22c55e",
                        marginLeft: 2,
                      }}>✓</span>
                    );
                  }
                  return null;
                })()}
              </button>
              <button
                onClick={() => toggleTopPanel("git")}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  height: "100%", padding: "0 12px",
                  background: activeTopPanel === "git" ? "var(--bg-selected)" : "none",
                  border: "none",
                  borderTop: activeTopPanel === "git" ? "2px solid var(--accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--border)",
                  cursor: "pointer",
                  color: activeTopPanel === "git" ? "var(--text)" : "var(--text-muted)",
                  fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
                  position: "relative",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = activeTopPanel === "git" ? "var(--text)" : "var(--text-muted)"; }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <line x1="6" y1="3" x2="6" y2="15" />
                  <circle cx="18" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M18 9a9 9 0 0 1-9 9" />
                </svg>
                <span className="app-top-label">Git</span>
                {gitDirty && (
                  <span style={{
                    position: "absolute", top: 4, right: 4,
                    width: 7, height: 7, borderRadius: "50%",
                    background: "#f59e0b",
                  }} />
                )}
              </button>
            </div>
          )}
          {terminalEnabled && terminalCwd && (
            <button
              onClick={() => {
                if (!terminalOpen) {
                  setTerminalDockCwd(terminalCwd);
                  setTerminalOpen(true);
                  setTerminalCollapsed(false);
                  return;
                }
                if (terminalDockCwd && terminalDockCwd !== terminalCwd) {
                  if (!window.confirm("Close the current terminal dock and terminate its sessions before opening a terminal for the selected workspace?")) return;
                  setTerminalOpen(false);
                  setTerminalCollapsed(false);
                  window.setTimeout(() => {
                    setTerminalDockCwd(terminalCwd);
                    setTerminalOpen(true);
                  }, 0);
                  return;
                }
                setTerminalCollapsed((collapsed) => !collapsed);
              }}
              title={terminalOpen && terminalDockCwd && terminalDockCwd !== terminalCwd ? "Open terminal for selected workspace" : "Open web terminal"}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                height: "100%", padding: "0 12px",
                background: terminalOpen ? "var(--bg-selected)" : "none",
                border: "none",
                borderTop: terminalOpen ? "2px solid var(--accent)" : "2px solid transparent",
                borderRight: "1px solid var(--border)",
                cursor: "pointer",
                color: terminalOpen ? "var(--text)" : "var(--text-muted)",
                fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = terminalOpen ? "var(--text)" : "var(--text-muted)"; }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
              <span className="app-top-label">Terminal</span>
            </button>
          )}
          {/* Session stats — right-aligned in top bar */}
          {showChat && (sessionStats || contextUsage) && (() => {
            const t = sessionStats?.tokens;
            const c = sessionStats?.cost ?? 0;
            const fmt = (n: number) => n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
            const costStr = c > 0 ? (c >= 0.01 ? `$${c.toFixed(2)}` : `<$0.01`) : null;

            let ctxColor = "var(--text-muted)";
            let ctxStr: string | null = null;
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              if (pct !== null && pct > 90) ctxColor = "#ef4444";
              else if (pct !== null && pct > 70) ctxColor = "rgba(234,179,8,0.95)";
              ctxStr = pct !== null ? `${pct.toFixed(0)}% / ${fmt(contextUsage.contextWindow)}` : `? / ${fmt(contextUsage.contextWindow)}`;
            }

            const tooltipParts: string[] = [];
            if (t) {
              tooltipParts.push(`in: ${t.input.toLocaleString()}`);
              tooltipParts.push(`out: ${t.output.toLocaleString()}`);
              tooltipParts.push(`cache read: ${t.cacheRead.toLocaleString()}`);
              tooltipParts.push(`cache write: ${t.cacheWrite.toLocaleString()}`);
              if (c > 0) tooltipParts.push(`cost: $${c.toFixed(4)}`);
            }
            if (contextUsage?.contextWindow) {
              const pct = contextUsage.percent;
              tooltipParts.push(`context: ${pct !== null ? pct.toFixed(1) + "%" : "unknown"} of ${contextUsage.contextWindow.toLocaleString()} tokens`);
            }
            const tooltip = tooltipParts.join("  |  ");

            return (
              <div
                className="app-top-stats"
                title={tooltip}
                style={{
                  marginLeft: "auto",
                  display: "flex", alignItems: "center", gap: 10,
                  paddingLeft: 12,
                  paddingRight: webConfig?.chatgpt.usagePanelEnabled ? 12 : rightPanelTogglePadding,
                  height: "100%",
                  fontSize: 11, color: "var(--text-muted)",
                  whiteSpace: "nowrap", cursor: "default",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {t && t.input > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="8.5" x2="5" y2="1.5" /><polyline points="2 4 5 1.5 8 4" />
                    </svg>
                    {fmt(t.input)}
                  </span>
                )}
                {t && t.output > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="1.5" x2="5" y2="8.5" /><polyline points="2 6 5 8.5 8 6" />
                    </svg>
                    {fmt(t.output)}
                  </span>
                )}
                {t && t.cacheRead > 0 && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M8.5 5a3.5 3.5 0 1 1-1-2.45" /><polyline points="6.5 1.5 8.5 2.5 7.5 4.5" />
                    </svg>
                    {fmt(t.cacheRead)}
                  </span>
                )}
                {costStr && (
                  <span style={{ display: "flex", alignItems: "center", color: "var(--text)", fontWeight: 500 }}>
                    {costStr}
                  </span>
                )}
                {ctxStr && (
                  <span style={{ display: "flex", alignItems: "center", gap: 4, color: ctxColor }}>
                    <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 9 L1 5 Q1 1 5 1 Q9 1 9 5 L9 9" /><line x1="1" y1="9" x2="9" y2="9" />
                    </svg>
                    {ctxStr}
                  </span>
                )}
              </div>
            );
          })()}
          {webConfig?.chatgpt.usagePanelEnabled && (
            <div className="app-top-usage-panel" style={{ marginLeft: showChat && (sessionStats || contextUsage) ? 0 : "auto", paddingRight: rightPanelTogglePadding, height: "100%", display: "flex", alignItems: "center", flexShrink: 0 }}>
              <ChatGptUsagePanel />
            </div>
          )}
          {/* Top panel dropdown — shared, only one active at a time */}
          {activeTopPanel && topPanelPos && (
            <div style={{
              position: "fixed",
              top: topPanelPos.top,
              left: topPanelPos.left,
              width: topPanelPos.width,
              zIndex: 500,
            }}>
              {activeTopPanel === "system" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  {systemPrompt ? (
                    <div style={{
                      maxHeight: "min(600px, 75vh)",
                      overflowY: "auto",
                      padding: "12px 16px",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      lineHeight: 1.6,
                      whiteSpace: "pre-wrap",
                      fontFamily: "var(--font-mono)",
                    }}>
                      {systemPrompt}
                    </div>
                  ) : systemPrompt === "" ? (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      System prompt is empty (tools are disabled)
                    </div>
                  ) : (
                    <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
                      Send a message to load the system prompt
                    </div>
                  )}
                </div>
              )}
              {activeTopPanel === "subagents" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <SubagentPanel runs={subagentRuns} />
                </div>
              )}
              {activeTopPanel === "git" && (
                <div style={{
                  background: "var(--bg-panel)",
                  borderBottom: "1px solid var(--border)",
                }}>
                  <GitPanel cwd={trellisCwd} refreshKey={gitRefreshKey} onDirtyChange={setGitDirty} />
                </div>
              )}
            </div>
          )}

        </div>

        {/* Chat content + optional bottom terminal dock */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <div style={{ flex: 1, overflow: "hidden", position: "relative", minHeight: 0 }}>
          {showChat ? (
            <ChatWindow
              key={sessionKey}
              session={selectedSession}
              newSessionCwd={effectiveNewSessionCwd}
              newSessionProjectContext={newSessionProjectContext ?? (effectiveNewSessionCwd && activeProjectContext?.cwd === effectiveNewSessionCwd ? { projectId: activeProjectContext.projectId, spaceId: activeProjectContext.spaceId } : null)}
              onAgentEnd={handleAgentEnd}
              onSessionCreated={handleSessionCreated}
              onSessionForked={handleSessionForked}
              modelsRefreshKey={modelsRefreshKey}
              chatInputRef={chatInputRef}
              onBranchDataChange={handleBranchDataChange}
              onSystemPromptChange={handleSystemPromptChange}
              onSessionStatsChange={handleSessionStatsChange}
              onContextUsageChange={handleContextUsageChange}
              onSubagentChange={handleSubagentChange}
              onStudioToolProgressChange={handleStudioToolProgressChange}
              studioTask={studioSessionTask?.task ?? null}
              defaultToolPreset={webConfig?.yolk.defaultToolPreset}
              defaultThinkingLevel={webConfig?.yolk.defaultThinkingLevel}
            />
          ) : showPlaceholder ? (
            activeCwd ? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 15 }}>
                请从侧边栏选择会话
              </div>
            ) : (
              <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "flex-start", gap: 8, userSelect: "none", pointerEvents: "none" }}>
                <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7, flexShrink: 0 }}>
                  <line x1="20" y1="12" x2="4" y2="12" /><polyline points="10 6 4 12 10 18" />
                </svg>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: "var(--text)", marginBottom: 8 }}>Get Started</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>1.</span>Select a project directory from the sidebar<br />
                    <span style={{ color: "var(--text-dim)", marginRight: 6 }}>2.</span>Add models via the <strong style={{ color: "var(--text)" }}>Models</strong> button at the bottom
                  </div>
                </div>
              </div>
            )
          ) : null}
          {showChat && trellisSessionTask?.task && !(rightPanelOpen && rightPanelMode === "trellis" && focusedTrellisTaskKey === trellisSessionTask.task.key) && (
            <TrellisSessionWidget task={trellisSessionTask.task} onClick={handleOpenTrellisSessionTask} />
          )}
          {showChat && studioSessionTask?.task && !(rightPanelOpen && rightPanelMode === "studio" && focusedStudioTaskKey === studioSessionTask.task.key) && (
            <YpiStudioSessionWidget task={studioSessionTask.task} liveOverlays={studioLiveOverlays} onClick={handleOpenStudioSessionTask} />
          )}
          </div>
          {terminalOpen && terminalEnabled && terminalDockCwd && (
            <TerminalPanel
              cwd={terminalDockCwd}
              collapsed={terminalCollapsed}
              onToggleCollapsed={() => setTerminalCollapsed((collapsed) => !collapsed)}
              onClose={() => {
                setTerminalOpen(false);
                setTerminalDockCwd(null);
                setTerminalCollapsed(false);
                setTerminalInitialInput(null);
              }}
              initialInput={terminalInitialInput}
            />
          )}
        </div>
      </div>

      {/* Right panel: file viewer, Studio, or Trellis — always mounted, width animated via CSS */}
      <div
        className={`right-panel-container${rightPanelOpen ? " right-panel-open" : " right-panel-closed"}`}
        style={{
          display: "flex",
          flexDirection: "column",
          borderLeft: "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        {rightPanelMode === "files" ? (
          <>
            {/* Right panel tab bar */}
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36 }}>
              <div style={{ flex: 1, overflow: "hidden" }}>
                <TabBar
                  tabs={fileTabs}
                  activeTabId={activeFileTabId ?? ""}
                  onSelectTab={setActiveFileTabId}
                  onCloseTab={handleCloseFileTab}
                />
              </div>
            </div>

            {/* File content */}
            <div style={{ flex: 1, overflow: "hidden" }}>
              {activeFileTab?.filePath ? (
                <FileViewer filePath={activeFileTab.filePath} cwd={activeCwd ?? undefined} initialLine={activeFileTab.line} editorConfig={webConfig?.editor} onAddChat={handleAddChat} onOpenFile={handleOpenFile} />
              ) : (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  没有打开文件
                </div>
              )}
            </div>
          </>
        ) : rightPanelMode === "studio" ? (
          <>
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36, padding: "0 12px", gap: 8 }}>
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 700 }}>工作室</span>
              {studioCwd && <span title={studioCwd} style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{studioCwd}</span>}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <YpiStudioPanel cwd={studioCwd} onOpenFile={handleOpenFile} focusedTaskKey={focusedStudioTaskKey} initialTab="tasks" initialScope={focusedStudioTaskKey?.startsWith("archived:") ? "archived" : "active"} refreshKey={rightPanelOpen && rightPanelMode === "studio" ? studioSessionTaskRefreshKey : 0} currentSessionContextId={studioContextIdForSession(selectedSession?.id)} onTaskBound={() => setStudioSessionTaskRefreshKey((key) => key + 1)} studioConfig={webConfig?.studio ?? null} onOpenStudioMemberSettings={handleOpenStudioMemberSettings} />
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", flexShrink: 0, background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", height: 36, padding: "0 12px", gap: 8 }}>
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 700 }}>Trellis</span>
              {trellisCwd && <span title={trellisCwd} style={{ color: "var(--text-dim)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trellisCwd}</span>}
            </div>
            <div style={{ flex: 1, overflow: "hidden" }}>
              <TrellisPanel cwd={trellisCwd} includeArchivedDefault={trellisIncludeArchivedDefault} focusedTaskKey={focusedTrellisTaskKey} onOpenFile={handleOpenFile} onJoinTaskChat={handleJoinTrellisTaskChat} onOpenTerminalCommand={handleOpenTerminalCommand} terminalEnabled={terminalEnabled} />
            </div>
          </>
        )}
      </div>
    </div>
    {/* Right panel mode toggles — Preview, Studio, and optional Trellis. */}
    <div className="right-panel-toggle-strip" style={{ position: "fixed", top: 0, right: 0, zIndex: 300, display: "flex", flexDirection: "row" }}>
      <button
        onClick={() => {
          if (rightPanelOpen && rightPanelMode === "files") setRightPanelOpen(false);
          else {
            setRightPanelMode("files");
            setRightPanelOpen(true);
          }
        }}
        title={rightPanelOpen && rightPanelMode === "files" ? "隐藏预览面板" : "显示预览面板"}
        aria-label={rightPanelOpen && rightPanelMode === "files" ? "隐藏预览面板" : "显示预览面板"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, padding: 0,
          background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
          color: rightPanelOpen && rightPanelMode === "files" ? "var(--text)" : "var(--text-muted)",
          cursor: "pointer", transition: "color 0.12s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen && rightPanelMode === "files" ? "var(--text)" : "var(--text-muted)"; }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      </button>
      <button
        onClick={() => {
          if (rightPanelOpen && rightPanelMode === "studio") setRightPanelOpen(false);
          else {
            setRightPanelMode("studio");
            setRightPanelOpen(true);
          }
        }}
        title={rightPanelOpen && rightPanelMode === "studio" ? "隐藏工作室面板" : "显示工作室面板"}
        aria-label={rightPanelOpen && rightPanelMode === "studio" ? "隐藏工作室面板" : "显示工作室面板"}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          width: 36, height: 36, padding: 0,
          background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
          color: rightPanelOpen && rightPanelMode === "studio" ? "var(--accent)" : "var(--text-muted)",
          cursor: "pointer", transition: "color 0.12s",
          fontSize: 12, fontWeight: 800,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen && rightPanelMode === "studio" ? "var(--accent)" : "var(--text-muted)"; }}
      >
        工
      </button>
      {trellisEnabled && (
        <button
          onClick={() => {
            if (rightPanelOpen && rightPanelMode === "trellis") setRightPanelOpen(false);
            else {
              setRightPanelMode("trellis");
              setRightPanelOpen(true);
            }
          }}
          title={rightPanelOpen && rightPanelMode === "trellis" ? "隐藏 Trellis 面板" : "显示 Trellis 面板"}
          aria-label={rightPanelOpen && rightPanelMode === "trellis" ? "隐藏 Trellis 面板" : "显示 Trellis 面板"}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 36, height: 36, padding: 0,
            background: "var(--bg-panel)", border: "none", borderLeft: "1px solid var(--border)", borderBottom: "1px solid var(--border)",
            color: rightPanelOpen && rightPanelMode === "trellis" ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer", transition: "color 0.12s",
            fontSize: 12, fontWeight: 800,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = rightPanelOpen && rightPanelMode === "trellis" ? "var(--accent)" : "var(--text-muted)"; }}
        >
          T
        </button>
      )}
    </div>
    {modelsConfigOpen && <ModelsConfig onClose={() => { setModelsConfigOpen(false); setModelsRefreshKey((k) => k + 1); }} />}
    {skillsConfigOpen && (activeCwd ?? selectedSession?.cwd ?? newSessionCwd) && (
      <SkillsConfig cwd={(activeCwd ?? selectedSession?.cwd ?? newSessionCwd)!} onClose={() => setSkillsConfigOpen(false)} />
    )}
    {usageStatsOpen && (
      <UsageStatsModal cwd={activeCwd ?? selectedSession?.cwd ?? newSessionCwd} onClose={() => setUsageStatsOpen(false)} />
    )}
    {settingsConfigOpen && (
      <SettingsConfig
        cwd={trellisCwd}
        initialSection={settingsStudioFocusMember ? "studio" : undefined}
        studioFocusMember={settingsStudioFocusMember ?? undefined}
        studioFocusField={settingsStudioFocusMember ? "model" : undefined}
        onConfigChange={() => { void loadWebConfig(); }}
        onClose={() => { setSettingsConfigOpen(false); setSettingsStudioFocusMember(null); void loadWebConfig(); }}
        terminalEnabled={terminalEnabled}
        onOpenTerminalCommand={handleOpenTerminalCommand}
      />
    )}
    </>
  );
}
