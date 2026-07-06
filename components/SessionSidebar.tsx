"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TrellisSetupStatus } from "@/lib/trellis-setup-types";
import type { GitInfo, SessionInfo, WorktreeInfo } from "@/lib/types";
import { formatWorkspaceHeaderTitle, formatWorkspaceSubtitle, formatWorkspaceTitle } from "@/lib/workspace-title";
import { displayTitleForSession } from "@/lib/session-title";
import { Checkbox } from "./Checkbox";
import { FileExplorer } from "./FileExplorer";

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  explorerRefreshKey?: number;
  onAtMention?: (relativePath: string) => void;
  trellisEnabled?: boolean;
  terminalEnabled?: boolean;
  onOpenTerminalCommand?: (cwd: string, command: string) => void;
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

/** Return the 5 most recently active cwds across all sessions */
function getRecentCwds(sessions: SessionInfo[], extraCwds: string[] = []): string[] {
  const latestByCwd = new Map<string, string>(); // cwd -> most recent modified
  for (const s of sessions) {
    if (!s.cwd) continue;
    const prev = latestByCwd.get(s.cwd);
    if (!prev || s.modified > prev) {
      latestByCwd.set(s.cwd, s.modified);
    }
  }
  const recent = [...latestByCwd.entries()]
    .sort((a, b) => b[1].localeCompare(a[1]))
    .map(([cwd]) => cwd);
  return [...extraCwds, ...recent.filter((cwd) => !extraCwds.includes(cwd))].slice(0, 5);
}

function shortenCwd(cwd: string, homeDir?: string): string {
  const path = (homeDir && cwd.startsWith(homeDir)) ? "~" + cwd.slice(homeDir.length) : cwd;
  const sep = path.includes("/") ? "/" : "\\";
  const parts = path.split(sep).filter(Boolean);
  if (parts.length <= 2) return path;
  return "…/" + parts.slice(-2).join(sep);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildTrellisInitCommand(status: TrellisSetupStatus | null): string {
  const developerName = status?.suggestedDeveloperName?.trim();
  return developerName ? `trellis init -u ${shellQuote(developerName)} --pi` : "trellis init --pi";
}

function makeTempSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

const MIN_SESSION_LIST_HEIGHT = 80;
const MIN_EXPLORER_HEIGHT = 120;
const EXPLORER_HEIGHT_STORAGE_KEY = "pi-web-sidebar-explorer-height";

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getInitialExplorerHeight(): number | null {
  if (typeof window === "undefined") return null;
  const stored = Number(window.localStorage.getItem(EXPLORER_HEIGHT_STORAGE_KEY));
  if (!Number.isFinite(stored)) return null;
  return Math.max(MIN_EXPLORER_HEIGHT, stored);
}

function WorktreeBadge({ worktree }: { worktree?: WorktreeInfo }) {
  if (!worktree) return null;
  return (
    <span
      title={worktree.branch ? `Git 工作树: ${worktree.branch}` : "Git 工作树"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        maxWidth: 120,
        padding: "1px 5px",
        borderRadius: 999,
        background: "rgba(37,99,235,0.12)",
        border: "1px solid rgba(37,99,235,0.22)",
        color: "var(--accent)",
        fontSize: 10,
        fontWeight: 700,
        lineHeight: 1.35,
        flexShrink: 0,
      }}
    >
      <span>WT</span>
      {worktree.branch && (
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
          {worktree.branch}
        </span>
      )}
    </span>
  );
}

interface WorktreeCreateResponse {
  cwd?: string;
  error?: string;
  worktree?: WorktreeInfo;
  branchName?: string;
  mainWorktreePath?: string;
  mainWorktreeBranch?: string;
}

interface WorktreeActionResponse {
  success?: boolean;
  error?: string;
  cwd?: string;
  fallbackCwd?: string;
  deletedSessionIds?: string[];
  status?: {
    dirty?: boolean;
    dirtySummary?: string[];
  };
}

interface WorktreeContextMenuState {
  x: number;
  y: number;
  cwd: string;
  worktree: WorktreeInfo;
}

interface SessionContextMenuState {
  x: number;
  y: number;
  session: SessionInfo;
}

interface WorktreeActionState {
  kind: "delete" | "archive";
  cwd: string;
  worktree: WorktreeInfo;
  force: boolean;
  busy: boolean;
  error: string | null;
  dirtySummary?: string[];
}

interface CwdPickerRow {
  kind: "project" | "worktree";
  cwd: string;
  worktree?: WorktreeInfo;
  syntheticParent?: boolean;
}

function buildCwdPickerRows(recentCwds: string[], worktreeByCwd: Map<string, WorktreeInfo>): CwdPickerRow[] {
  const projectOrder: string[] = [];
  const syntheticParents = new Set<string>();
  const worktreesByParent = new Map<string, Array<{ cwd: string; worktree: WorktreeInfo }>>();
  const seenProjects = new Set<string>();
  const seenWorktrees = new Set<string>();
  const recentCwdSet = new Set(recentCwds);

  const pushProject = (cwd: string, syntheticParent = false) => {
    if (seenProjects.has(cwd)) {
      if (syntheticParent) syntheticParents.add(cwd);
      return;
    }
    seenProjects.add(cwd);
    projectOrder.push(cwd);
    if (syntheticParent) syntheticParents.add(cwd);
  };

  const pushWorktree = (parentCwd: string, cwd: string, worktree: WorktreeInfo) => {
    if (seenWorktrees.has(cwd)) return;
    seenWorktrees.add(cwd);
    const group = worktreesByParent.get(parentCwd) ?? [];
    group.push({ cwd, worktree });
    worktreesByParent.set(parentCwd, group);
  };

  for (const cwd of recentCwds) {
    const worktree = worktreeByCwd.get(cwd);
    const parentCwd = worktree?.mainWorktreePath && worktree.mainWorktreePath !== cwd
      ? worktree.mainWorktreePath
      : null;

    if (worktree && parentCwd) {
      pushProject(parentCwd, !recentCwdSet.has(parentCwd));
      pushWorktree(parentCwd, cwd, worktree);
    } else {
      pushProject(cwd);
    }
  }

  return projectOrder.flatMap((cwd) => [
    { kind: "project" as const, cwd, syntheticParent: syntheticParents.has(cwd) },
    ...(worktreesByParent.get(cwd) ?? []).map((entry) => ({ kind: "worktree" as const, ...entry })),
  ]);
}

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

function WorkspaceHeaderLine({
  text,
  detail,
  strong = false,
}: {
  text: string;
  detail: string;
  strong?: boolean;
}) {
  const [showTooltip, setShowTooltip] = useState(false);
  return (
    <div
      style={{ position: "relative", minWidth: 0 }}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div
        tabIndex={0}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        title={detail}
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: strong ? "var(--text)" : "var(--text-dim)",
          fontSize: strong ? 13 : 11,
          fontWeight: strong ? 800 : 400,
          lineHeight: 1.25,
          letterSpacing: strong ? "-0.02em" : undefined,
          outline: "none",
        }}
      >
        {text}
      </div>
      {showTooltip && (
        <div
          role="tooltip"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 150,
            maxWidth: 280,
            padding: "5px 7px",
            borderRadius: 6,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.14)",
            color: "var(--text)",
            fontSize: 11,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
            pointerEvents: "none",
          }}
        >
          {detail}
        </div>
      )}
    </div>
  );
}

function buildSessionTree(sessions: SessionInfo[]): SessionTreeNode[] {
  const byId = new Map<string, SessionTreeNode>();
  for (const s of sessions) {
    byId.set(s.id, { session: s, children: [] });
  }

  // Build a map of parentSessionId chains so we can resolve missing ancestors
  const parentOf = new Map<string, string>();
  for (const s of sessions) {
    if (s.parentSessionId) parentOf.set(s.id, s.parentSessionId);
  }

  // Walk up the parentSessionId chain to find the nearest ancestor that exists in byId
  function resolveAncestor(id: string): string | null {
    let cur = parentOf.get(id);
    const visited = new Set<string>();
    while (cur) {
      if (visited.has(cur)) return null; // cycle guard
      visited.add(cur);
      if (byId.has(cur)) return cur;
      cur = parentOf.get(cur);
    }
    return null;
  }

  const roots: SessionTreeNode[] = [];
  for (const node of byId.values()) {
    const ancestor = resolveAncestor(node.session.id);
    if (ancestor) {
      byId.get(ancestor)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort each level by modified desc
  const sort = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => b.session.modified.localeCompare(a.session.modified));
    nodes.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, onOpenFile, explorerRefreshKey, onAtMention, trellisEnabled = false, terminalEnabled = false, onOpenTerminalCommand }: Props) {
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [customPathOpen, setCustomPathOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [selectedForArchive, setSelectedForArchive] = useState<Set<string>>(new Set());
  const [archiveAllConfirming, setArchiveAllConfirming] = useState(false);
  const [archiveAllBusy, setArchiveAllBusy] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(true);
  const [explorerKey, setExplorerKey] = useState(0);
  const [explorerHeight, setExplorerHeight] = useState<number | null>(getInitialExplorerHeight);
  const [explorerResizing, setExplorerResizing] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [explorerRefreshDone, setExplorerRefreshDone] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [ephemeralWorktrees, setEphemeralWorktrees] = useState<Record<string, WorktreeInfo>>({});
  const [worktreeContextMenu, setWorktreeContextMenu] = useState<WorktreeContextMenuState | null>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null);
  const [worktreeAction, setWorktreeAction] = useState<WorktreeActionState | null>(null);
  const [removedWorktreeCwds, setRemovedWorktreeCwds] = useState<string[]>([]);
  const [selectedCwdGit, setSelectedCwdGit] = useState<GitInfo | undefined>(undefined);
  const [archivedCounts, setArchivedCounts] = useState<Record<string, number>>({});
  const [archivedCwds, setArchivedCwds] = useState<string[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [trellisSetupStatus, setTrellisSetupStatus] = useState<TrellisSetupStatus | null>(null);
  const [trellisStatusRefreshKey, setTrellisStatusRefreshKey] = useState(0);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const explorerRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);
  const explorerSectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (explorerHeight === null) return;
    window.localStorage.setItem(EXPLORER_HEIGHT_STORAGE_KEY, String(Math.round(explorerHeight)));
  }, [explorerHeight]);

  const handleExplorerResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!explorerOpen) return;
    const explorerEl = explorerSectionRef.current;
    const sessionListEl = sessionListRef.current;
    if (!explorerEl || !sessionListEl) return;

    event.preventDefault();
    const startY = event.clientY;
    const startHeight = explorerEl.getBoundingClientRect().height;
    const sessionListHeight = sessionListEl.getBoundingClientRect().height;
    const maxHeight = Math.max(MIN_EXPLORER_HEIGHT, startHeight + sessionListHeight - MIN_SESSION_LIST_HEIGHT);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    setExplorerResizing(true);
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const nextHeight = clampNumber(startHeight - (moveEvent.clientY - startY), MIN_EXPLORER_HEIGHT, maxHeight);
      setExplorerHeight(nextHeight);
    };

    const finishResize = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishResize);
      window.removeEventListener("pointercancel", finishResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setExplorerResizing(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishResize);
    window.addEventListener("pointercancel", finishResize);
  }, [explorerOpen]);

  const loadSessions = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/sessions");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[]; archivedCwds?: string[]; archivedCounts?: Record<string, number> };
      setAllSessions(data.sessions);
      if (data.archivedCwds) setArchivedCwds(data.archivedCwds);
      if (data.archivedCounts) setArchivedCounts(data.archivedCounts);
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadArchivedSessions = useCallback(async (cwd: string) => {
    try {
      const res = await fetch(`/api/sessions/archived?cwd=${encodeURIComponent(cwd)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions: SessionInfo[] };
      setArchivedSessions(data.sessions);
    } catch {
      // ignore
    }
  }, []);

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/sessions/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: [sessionId] }),
      });
      if (res.ok) {
        setSelectedForArchive((prev) => {
          const next = new Set(prev);
          next.delete(sessionId);
          return next;
        });
        void loadSessions(false);
        setArchivedExpanded(false);
        setArchivedSessions([]);
      }
    } catch {
      // ignore
    }
  }, [loadSessions]);

  const handleUnarchiveSession = useCallback(async (sessionId: string) => {
    try {
      const res = await fetch("/api/sessions/unarchive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: [sessionId] }),
      });
      if (res.ok) {
        void loadSessions(false);
        setArchivedSessions((prev) => prev.filter((s) => s.id !== sessionId));
      }
    } catch {
      // ignore
    }
  }, [loadSessions]);

  const handleBatchArchive = useCallback(async () => {
    const ids = [...selectedForArchive];
    if (ids.length === 0) return;
    try {
      const res = await fetch("/api/sessions/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionIds: ids }),
      });
      if (res.ok) {
        setSelectedForArchive(new Set());
        void loadSessions(false);
      }
    } catch {
      // ignore
    }
  }, [selectedForArchive, loadSessions]);

  const handleArchiveAll = useCallback(async () => {
    if (!selectedCwd) return;
    setArchiveAllBusy(true);
    try {
      const res = await fetch("/api/sessions/archive-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: selectedCwd }),
      });
      if (res.ok) {
        setArchiveAllConfirming(false);
        void loadSessions(false);
      }
    } catch {
      // ignore
    } finally {
      setArchiveAllBusy(false);
    }
  }, [selectedCwd, loadSessions]);

  const handleDeleteSession = useCallback(async (session: SessionInfo) => {
    const title = displayTitleForSession(session);
    if (!window.confirm(`删除会话 “${title}”？此操作不可恢复。`)) return;
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      if (res.ok) {
        onSessionDeleted?.(session.id);
        setSelectedForArchive((prev) => {
          const next = new Set(prev);
          next.delete(session.id);
          return next;
        });
        setArchivedSessions((prev) => prev.filter((s) => s.id !== session.id));
        void loadSessions(false);
      }
    } catch {
      // ignore
    }
  }, [loadSessions, onSessionDeleted]);

  const initialLoadDone = useRef(false);
  useEffect(() => {
    const isFirst = !initialLoadDone.current;
    initialLoadDone.current = true;
    loadSessions(isFirst);
  }, [loadSessions, refreshKey]);

  useEffect(() => {
    if (!archivedExpanded || !selectedCwd || (archivedCounts[selectedCwd] ?? 0) === 0) return;
    void loadArchivedSessions(selectedCwd);
  }, [archivedExpanded, selectedCwd, archivedCounts, loadArchivedSessions]);

  useEffect(() => {
    if (explorerRefreshKey !== undefined) setExplorerKey((k) => k + 1);
  }, [explorerRefreshKey]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);

  useEffect(() => {
    onCwdChange?.(selectedCwd);
  }, [selectedCwd, onCwdChange]);

  useEffect(() => {
    if (!selectedCwd) {
      setSelectedCwdGit(undefined);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/git/info?cwd=${encodeURIComponent(selectedCwd)}`, { signal: controller.signal })
      .then((res) => res.ok ? res.json() : null)
      .then((data: { git?: GitInfo } | null) => {
        if (!controller.signal.aborted) setSelectedCwdGit(data?.git);
      })
      .catch(() => {
        if (!controller.signal.aborted) setSelectedCwdGit(undefined);
      });

    return () => controller.abort();
  }, [selectedCwd]);

  useEffect(() => {
    if (!trellisEnabled || !selectedCwd) {
      setTrellisSetupStatus(null);
      return;
    }

    const controller = new AbortController();
    fetch(`/api/trellis/setup/status?cwd=${encodeURIComponent(selectedCwd)}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as { status?: TrellisSetupStatus; error?: string };
        if (!res.ok || data.error || !data.status) throw new Error(data.error ?? `HTTP ${res.status}`);
        setTrellisSetupStatus(data.status);
      })
      .catch((err) => {
        if ((err as { name?: string }).name !== "AbortError") setTrellisSetupStatus(null);
      });

    return () => controller.abort();
  }, [selectedCwd, trellisEnabled, trellisStatusRefreshKey]);

  // Auto-select cwd and restore session from URL on first load
  useEffect(() => {
    if (allSessions.length === 0) return;

    if (selectedCwd === null) {
      // If restoring a session, set cwd to match that session
      if (initialSessionId && !restoredRef.current) {
        restoredRef.current = true;
        const target = allSessions.find((s) => s.id === initialSessionId);
        if (target) {
          setSelectedCwd(target.cwd);
          onSelectSession(target, true);
          return;
        }
        // Session not found — notify parent so it can show the placeholder
        onInitialRestoreDone?.();
      }
      const cwds = getRecentCwds(allSessions);
      if (cwds.length > 0) setSelectedCwd(cwds[0]);
    }
  }, [allSessions, selectedCwd, initialSessionId, onSelectSession, onInitialRestoreDone]);

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/cwd/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: path }),
      });
      const data = await res.json().catch(() => ({})) as { cwd?: string; error?: string };
      if (!res.ok || data.error) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSelectedCwd(data.cwd ?? path);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setDropdownOpen(false);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        setSelectedCwd(data.cwd);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
        setDropdownOpen(false);
      }
    } catch {
      // ignore
    }
  }, []);

  // Close dropdown/context menu on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      setWorktreeContextMenu(null);
      setSessionContextMenu(null);
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setCustomPathOpen(false);
        setCustomPathValue("");
        setCustomPathError(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    onNewSession?.(makeTempSessionId(), selectedCwd);
  }, [selectedCwd, onNewSession]);

  const handleNewWorktree = useCallback(async () => {
    if (!selectedCwd || creatingWorktree) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      const res = await fetch("/api/git/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: selectedCwd }),
      });
      const data = await res.json().catch(() => ({})) as WorktreeCreateResponse;
      if (!res.ok || data.error || !data.cwd) {
        setWorktreeError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      const worktree: WorktreeInfo = data.worktree ?? {
        isWorktree: true,
        branch: data.branchName,
        mainWorktreePath: data.mainWorktreePath,
        mainWorktreeBranch: data.mainWorktreeBranch,
        repoRoot: data.cwd,
      };
      setEphemeralWorktrees((prev) => ({ ...prev, [data.cwd!]: worktree }));
      setRemovedWorktreeCwds((prev) => prev.filter((cwd) => cwd !== data.cwd));
      setSelectedCwd(data.cwd);
      setDropdownOpen(false);
      setCustomPathOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      onNewSession?.(makeTempSessionId(), data.cwd);
      setExplorerKey((k) => k + 1);
    } catch (e) {
      setWorktreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingWorktree(false);
    }
  }, [selectedCwd, creatingWorktree, onNewSession]);

  const openWorktreeAction = useCallback((kind: "delete" | "archive", cwd: string, worktree: WorktreeInfo) => {
    setWorktreeContextMenu(null);
    setDropdownOpen(false);
    setWorktreeAction({ kind, cwd, worktree, force: false, busy: false, error: null });
  }, []);

  const applyWorktreeFallback = useCallback((removedCwd: string, fallbackCwd?: string) => {
    setEphemeralWorktrees((prev) => {
      const next = { ...prev };
      delete next[removedCwd];
      return next;
    });
    setRemovedWorktreeCwds((prev) => prev.includes(removedCwd) ? prev : [...prev, removedCwd]);
    if (selectedCwd === removedCwd) {
      setSelectedCwd(fallbackCwd ?? null);
    }
    setExplorerKey((k) => k + 1);
    void loadSessions(false);
  }, [loadSessions, selectedCwd]);

  const confirmWorktreeAction = useCallback(async () => {
    if (!worktreeAction || worktreeAction.busy) return;
    setWorktreeAction((prev) => prev ? { ...prev, busy: true, error: null, dirtySummary: undefined } : prev);
    try {
      const endpoint = worktreeAction.kind === "archive"
        ? "/api/git/worktrees/archive"
        : `/api/git/worktrees?cwd=${encodeURIComponent(worktreeAction.cwd)}&force=${worktreeAction.force ? "true" : "false"}`;
      const res = await fetch(endpoint, {
        method: worktreeAction.kind === "archive" ? "POST" : "DELETE",
        headers: worktreeAction.kind === "archive" ? { "Content-Type": "application/json" } : undefined,
        body: worktreeAction.kind === "archive"
          ? JSON.stringify({ cwd: worktreeAction.cwd, confirmedRisk: true })
          : undefined,
      });
      const data = await res.json().catch(() => ({})) as WorktreeActionResponse & { dirtySummary?: string | string[] };
      if (!res.ok || data.error) {
        const dirtySummary = data.status?.dirtySummary ?? (Array.isArray(data.dirtySummary) ? data.dirtySummary : typeof data.dirtySummary === "string" ? data.dirtySummary.split(/\r?\n/).filter(Boolean) : undefined);
        setWorktreeAction((prev) => prev ? {
          ...prev,
          busy: false,
          error: data.error ?? `HTTP ${res.status}`,
          dirtySummary,
        } : prev);
        return;
      }
      applyWorktreeFallback(worktreeAction.cwd, data.fallbackCwd);
      for (const sessionId of data.deletedSessionIds ?? []) {
        onSessionDeleted?.(sessionId);
      }
      setWorktreeAction(null);
    } catch (e) {
      setWorktreeAction((prev) => prev ? { ...prev, busy: false, error: e instanceof Error ? e.message : String(e) } : prev);
    }
  }, [applyWorktreeFallback, onSessionDeleted, worktreeAction]);

  const visibleSessions = allSessions.filter((session) => !removedWorktreeCwds.includes(session.cwd));
  const worktreeByCwd = new Map<string, WorktreeInfo>();
  for (const session of visibleSessions) {
    if (session.cwd && session.worktree && !worktreeByCwd.has(session.cwd)) {
      worktreeByCwd.set(session.cwd, session.worktree);
    }
  }
  for (const [cwd, worktree] of Object.entries(ephemeralWorktrees)) {
    if (!removedWorktreeCwds.includes(cwd)) worktreeByCwd.set(cwd, worktree);
  }
  const extraCwds: string[] = [];
  const pinCwd = (cwd: string | null | undefined) => {
    if (!cwd || removedWorktreeCwds.includes(cwd) || extraCwds.includes(cwd)) return;
    extraCwds.push(cwd);
  };
  pinCwd(selectedCwd);
  for (const worktree of worktreeByCwd.values()) pinCwd(worktree.mainWorktreePath);
  for (const cwd of Object.keys(ephemeralWorktrees)) pinCwd(cwd);
  // Add archived-only cwds (no active sessions) so projects remain visible
  for (const acwd of archivedCwds) {
    if (!acwd || extraCwds.includes(acwd)) continue;
    if (!visibleSessions.some((s) => s.cwd === acwd)) {
      extraCwds.push(acwd);
    }
  }
  const recentCwds = getRecentCwds(visibleSessions, extraCwds);
  const selectedWorktree = selectedCwd ? worktreeByCwd.get(selectedCwd) : undefined;
  const sessionGit = selectedCwd ? visibleSessions.find((s) => s.cwd === selectedCwd)?.git : undefined;
  const currentGit: GitInfo | undefined = sessionGit ?? selectedCwdGit ?? (selectedWorktree ? {
    isWorktree: true,
    branch: selectedWorktree.branch,
    repoRoot: selectedWorktree.repoRoot,
    mainWorktreePath: selectedWorktree.mainWorktreePath,
    mainWorktreeBranch: selectedWorktree.mainWorktreeBranch,
  } : undefined);
  const workspaceTitle = formatWorkspaceHeaderTitle(selectedCwd, currentGit);
  const workspaceTitleDetail = formatWorkspaceTitle(selectedCwd, currentGit);
  const workspaceSubtitle = formatWorkspaceSubtitle(selectedCwd, currentGit);
  const archivedOnlyCwds = new Set(archivedCwds.filter((acwd) => !visibleSessions.some((s) => s.cwd === acwd)));
  const cwdRows = buildCwdPickerRows(recentCwds, worktreeByCwd);
  const filteredSessions = selectedCwd
    ? visibleSessions.filter((s) => s.cwd === selectedCwd)
    : visibleSessions;

  // Build parent-child tree within the filtered set
  const sessionTree = buildSessionTree(filteredSessions);
  const showTrellisInitializePrompt = trellisEnabled && !!selectedCwd && !!trellisSetupStatus?.canInitialize && !trellisSetupStatus.project.hasTrellisDir;
  const trellisInitCommand = buildTrellisInitCommand(trellisSetupStatus);
  const canOpenTrellisInitTerminal = showTrellisInitializePrompt && terminalEnabled && !!onOpenTerminalCommand;

  useEffect(() => {
    if (!showTrellisInitializePrompt) return;
    const interval = window.setInterval(() => {
      setTrellisStatusRefreshKey((key) => key + 1);
    }, 5_000);
    return () => window.clearInterval(interval);
  }, [showTrellisInitializePrompt]);

  return (
    <div className="session-sidebar-root" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 10px 10px",
          borderBottom: "1px solid var(--border)",
          flexShrink: 0,
        }}
      >
        <div style={{ marginBottom: 10, minWidth: 0 }}>
          <WorkspaceHeaderLine text={workspaceTitle} detail={workspaceTitleDetail} strong />
          <div style={{ marginTop: 2 }}>
            <WorkspaceHeaderLine text={workspaceSubtitle} detail={workspaceSubtitle} />
          </div>
        </div>
        <div className="session-sidebar-actions" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd ? "pointer" : "not-allowed",
                height: 32,
                paddingLeft: 10,
                paddingRight: 12,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              title={selectedCwd ? `在 ${selectedCwd} 新建会话` : "请先选择一个项目"}
              onMouseEnter={(e) => {
                if (!selectedCwd) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd ? "var(--text-muted)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <line x1="6" y1="1" x2="6" y2="11" />
                <line x1="1" y1="6" x2="11" y2="6" />
              </svg>
              New
            </button>
            <button
              onClick={() => void handleNewWorktree()}
              disabled={!selectedCwd || creatingWorktree}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd && !creatingWorktree ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd && !creatingWorktree ? "pointer" : "not-allowed",
                height: 32,
                paddingLeft: 9,
                paddingRight: 10,
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 500,
                letterSpacing: "-0.01em",
                flexShrink: 0,
                transition: "background 0.12s, color 0.12s, border-color 0.12s",
              }}
              title={selectedCwd ? `从 ${selectedCwd} 创建 Git 工作树` : "请先选择一个项目"}
              onMouseEnter={(e) => {
                if (!selectedCwd || creatingWorktree) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd && !creatingWorktree ? "var(--text-muted)" : "var(--text-dim)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="6" r="3" />
                <path d="M6 15V9a3 3 0 0 1 3-3h6" />
                <path d="M9 18h6a3 3 0 0 0 3-3V9" />
              </svg>
              {creatingWorktree ? "创建中…" : "WorkTree"}
            </button>
            <button
              onClick={() => loadSessions(false)}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: sessionRefreshDone ? "rgba(74,222,128,0.18)" : "var(--bg-hover)",
                border: `1px solid ${sessionRefreshDone ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                color: sessionRefreshDone ? "#4ade80" : "var(--text-muted)",
                cursor: "pointer",
                width: 32, height: 32,
                borderRadius: 7,
                padding: 0,
                flexShrink: 0,
                transition: "background 0.3s, color 0.3s, border-color 0.3s",
              }}
              onMouseEnter={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                if (sessionRefreshDone) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = "var(--text-muted)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
              title="刷新"
            >
              {sessionRefreshDone ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
            {/* Workspace actions menu */}
            {selectedCwd && (
              <div ref={workspaceMenuRef} style={{ position: "relative" }}>
                <button
                  onClick={() => setWorkspaceMenuOpen((v) => !v)}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "var(--bg-hover)",
                    border: "1px solid var(--border)",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    width: 32, height: 32,
                    borderRadius: 7,
                    padding: 0,
                    flexShrink: 0,
                  }}
                  title="Workspace actions"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="5" r="1" />
                    <circle cx="12" cy="12" r="1" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>
                </button>
                {workspaceMenuOpen && (
                  <>
                    <div
                      onClick={() => setWorkspaceMenuOpen(false)}
                      style={{ position: "fixed", inset: 0, zIndex: 999 }}
                    />
                    <div className="session-sidebar-floating-menu" style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      marginTop: 4,
                      background: "var(--bg)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
                      zIndex: 1000,
                      minWidth: 180,
                      padding: "4px 0",
                      overflow: "hidden",
                    }}>
                      <button
                        onClick={() => {
                          setWorkspaceMenuOpen(false);
                          setArchiveAllConfirming(true);
                        }}
                        style={{
                          display: "flex", alignItems: "center", gap: 8,
                          width: "100%",
                          padding: "9px 14px",
                          background: "none",
                          border: "none",
                          color: "var(--text)",
                          cursor: "pointer",
                          fontSize: 12,
                          textAlign: "left",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                          <polyline points="7 10 12 15 17 10" />
                          <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        归档所有会话
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
        </div>

        {worktreeError && (
          <div style={{
            marginBottom: 8,
            padding: "6px 8px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.22)",
            color: "#dc2626",
            fontSize: 11,
            lineHeight: 1.35,
            overflowWrap: "anywhere",
          }}>
            {worktreeError}
          </div>
        )}

        {/* CWD picker */}
        <div ref={dropdownRef} style={{ position: "relative" }}>
          <button
            onClick={() => setDropdownOpen((v) => !v)}
            onContextMenu={(e) => {
              const worktree = selectedCwd ? worktreeByCwd.get(selectedCwd) : undefined;
              if (!selectedCwd || !worktree) return;
              e.preventDefault();
              e.stopPropagation();
              setWorktreeContextMenu({ x: e.clientX, y: e.clientY, cwd: selectedCwd, worktree });
            }}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              padding: "6px 10px",
              background: selectedCwd ? "var(--bg-hover)" : "rgba(37,99,235,0.06)",
              border: selectedCwd ? "1px solid var(--border)" : "1px solid rgba(37,99,235,0.4)",
              borderRadius: 7,
              cursor: "pointer",
              fontSize: 12,
              color: "var(--text)",
              textAlign: "left",
              transition: "border-color 0.15s, background 0.15s",
            }}
          >
            <span
              style={{
                flex: 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: selectedCwd ? "var(--text)" : "var(--text-dim)",
              }}
              title={selectedWorktree ? `${selectedCwd ?? ""}\n右键点击查看更多 WorkTree 操作` : selectedCwd ?? ""}
            >
              {selectedCwd ? shortenCwd(selectedCwd, homeDir) : (initialSessionId && !restoredRef.current ? "" : "Select project…")}
            </span>
            <WorktreeBadge worktree={selectedCwd ? worktreeByCwd.get(selectedCwd) : undefined} />
          </button>

          {dropdownOpen && (
            <div
              className="session-sidebar-cwd-menu"
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                right: 0,
                zIndex: 100,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                boxShadow: "0 6px 20px rgba(0,0,0,0.10)",
                overflow: "hidden",
              }}
            >
              {cwdRows.map((row) => {
                const selected = row.cwd === selectedCwd;
                const isWorktree = row.kind === "worktree";
                return (
                  <button
                    key={`${row.kind}:${row.cwd}`}
                    onClick={() => {
                      setSelectedCwd(row.cwd);
                      setWorktreeError(null);
                      setCustomPathOpen(false);
                      setCustomPathValue("");
                      setCustomPathError(null);
                      setDropdownOpen(false);
                    }}
                    onContextMenu={(e) => {
                      if (!row.worktree) return;
                      e.preventDefault();
                      e.stopPropagation();
                      setWorktreeContextMenu({ x: e.clientX, y: e.clientY, cwd: row.cwd, worktree: row.worktree });
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      width: "100%",
                      padding: isWorktree ? "7px 10px 7px 28px" : "8px 10px",
                      background: selected ? "var(--bg-selected)" : isWorktree ? "var(--bg-subtle)" : "none",
                      border: "none",
                      borderBottom: "1px solid var(--border)",
                      color: selected ? "var(--text)" : "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={row.worktree ? `${row.cwd}\n右键点击查看更多 WorkTree 操作` : row.cwd}
                  >
                    {selected && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <polyline points="1.5 5 4 7.5 8.5 2.5" />
                      </svg>
                    )}
                    {!selected && isWorktree && (
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--text-dim)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                        <path d="M2 1.5v4A2.5 2.5 0 0 0 4.5 8H8" />
                      </svg>
                    )}
                    {!selected && !isWorktree && <span style={{ width: 10, flexShrink: 0 }} />}
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {shortenCwd(row.cwd, homeDir)}
                      {row.syntheticParent && <span style={{ color: "var(--text-dim)", marginLeft: 5 }}>(main)</span>}
                      {archivedOnlyCwds.has(row.cwd) && <span style={{ color: "var(--text-dim)", fontStyle: "italic", marginLeft: 5 }}>(archived)</span>}
                    </span>
                    <WorktreeBadge worktree={row.worktree} />
                  </button>
                );
              })}

              {/* Default cwd shortcut */}
              {!customPathOpen && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDefaultCwd(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    borderTop: cwdRows.length > 0 ? "1px solid var(--border)" : "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M1 3A1 1 0 0 1 2 2H4L5 3.5H8.5a.5.5 0 0 1 .5.5v4a.5.5 0 0 1-.5.5h-7A.5.5 0 0 1 1 8V3Z" />
                  </svg>
                  <span>Use default directory</span>
                </button>
              )}

              {/* Custom path entry */}
              {!customPathOpen ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setCustomPathOpen(true);
                    setCustomPathError(null);
                    setTimeout(() => customPathInputRef.current?.focus(), 0);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    width: "100%",
                    padding: "8px 10px",
                    background: "none",
                    border: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    textAlign: "left",
                    fontSize: 11,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" style={{ flexShrink: 0 }}>
                    <line x1="5" y1="1" x2="5" y2="9" />
                    <line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  <span>Custom path…</span>
                </button>
              ) : (
                <div style={{ padding: "6px 8px", borderTop: cwdRows.length > 0 ? "none" : undefined }}>
                  <input
                    ref={customPathInputRef}
                    value={customPathValue}
                    onChange={(e) => {
                      setCustomPathValue(e.target.value);
                      setCustomPathError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void commitCustomPath();
                      }
                      if (e.key === "Escape") {
                        setCustomPathOpen(false);
                        setCustomPathValue("");
                        setCustomPathError(null);
                      }
                    }}
                    placeholder="/path/to/project"
                    style={{
                      width: "100%",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      padding: "5px 8px",
                      border: "1px solid var(--accent)",
                      borderRadius: 5,
                      outline: "none",
                      background: "var(--bg)",
                      color: "var(--text)",
                      boxSizing: "border-box",
                    }}
                  />
                  {customPathError && (
                    <div style={{
                      marginTop: 5,
                      color: "#dc2626",
                      fontSize: 11,
                      lineHeight: 1.35,
                      overflowWrap: "anywhere",
                    }}>
                      {customPathError}
                    </div>
                  )}
                  <div style={{ display: "flex", gap: 5, marginTop: 5 }}>
                    <button
                      onClick={() => void commitCustomPath()}
                      disabled={customPathValidating || !customPathValue.trim()}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--accent)",
                        border: "none",
                        borderRadius: 5,
                        color: "#fff",
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                        opacity: customPathValidating || !customPathValue.trim() ? 0.65 : 1,
                      }}
                    >
                      {customPathValidating ? "Checking…" : "Open"}
                    </button>
                    <button
                      onClick={() => { setCustomPathOpen(false); setCustomPathValue(""); setCustomPathError(null); }}
                      style={{
                        flex: 1,
                        padding: "4px 0",
                        background: "var(--bg-hover)",
                        border: "1px solid var(--border)",
                        borderRadius: 5,
                        color: "var(--text-muted)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {worktreeContextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: worktreeContextMenu.x,
            top: worktreeContextMenu.y,
            zIndex: 1000,
            minWidth: 190,
            padding: 4,
            borderRadius: 8,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
          }}
        >
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openWorktreeAction("archive", worktreeContextMenu.cwd, worktreeContextMenu.worktree); }}
            style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text)", textAlign: "left", cursor: "pointer", fontSize: 12, borderRadius: 6 }}
          >
            归档 WorkTree…
          </button>
          <button
            onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); openWorktreeAction("delete", worktreeContextMenu.cwd, worktreeContextMenu.worktree); }}
            style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "#dc2626", textAlign: "left", cursor: "pointer", fontSize: 12, borderRadius: 6 }}
          >
            删除 WorkTree…
          </button>
        </div>
      )}

      {sessionContextMenu && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            left: sessionContextMenu.x,
            top: sessionContextMenu.y,
            zIndex: 1000,
            minWidth: 150,
            padding: 4,
            borderRadius: 8,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
          }}
        >
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const session = sessionContextMenu.session;
              setSessionContextMenu(null);
              void handleArchiveSession(session.id);
            }}
            style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "var(--text)", textAlign: "left", cursor: "pointer", fontSize: 12, borderRadius: 6 }}
          >
            归档
          </button>
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const session = sessionContextMenu.session;
              setSessionContextMenu(null);
              void handleDeleteSession(session);
            }}
            style={{ width: "100%", padding: "8px 10px", background: "none", border: "none", color: "#dc2626", textAlign: "left", cursor: "pointer", fontSize: 12, borderRadius: 6 }}
          >
            删除
          </button>
        </div>
      )}

      {worktreeAction && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.28)", padding: 16 }}
        >
          <div style={{ width: "min(520px, 100%)", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "0 18px 50px rgba(0,0,0,0.25)", padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              {worktreeAction.kind === "archive" ? "归档 WorkTree" : "删除 WorkTree"}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 12 }}>
              <div><strong style={{ color: "var(--text)" }}>分支：</strong> {worktreeAction.worktree.branch ?? "(未知)"}</div>
              <div style={{ overflowWrap: "anywhere" }}><strong style={{ color: "var(--text)" }}>路径：</strong> {worktreeAction.cwd}</div>
              {worktreeAction.worktree.mainWorktreePath && (
                <div style={{ overflowWrap: "anywhere" }}><strong style={{ color: "var(--text)" }}>回退空间：</strong> {worktreeAction.worktree.mainWorktreePath}</div>
              )}
            </div>
            {worktreeAction.kind === "archive" ? (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)", color: "var(--text)", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
                请确认没有未保存或未完成的工作。归档操作会 squash 该 WorkTree 分支、推送、合并到主工作树分支，然后删除本地 WorkTree。请在继续前自行运行 finish-work 等工具。
              </div>
            ) : (
              <div style={{ padding: "10px 12px", borderRadius: 8, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "var(--text)", fontSize: 12, lineHeight: 1.5, marginBottom: 12 }}>
                删除将移除本地 WorkTree。未提交的更改和未合并的提交可能会丢失。
              </div>
            )}
            {worktreeAction.dirtySummary?.length ? (
              <div style={{ maxHeight: 120, overflow: "auto", padding: 8, borderRadius: 7, background: "var(--bg-subtle)", border: "1px solid var(--border)", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                {worktreeAction.dirtySummary.map((line) => <div key={line}>{line}</div>)}
              </div>
            ) : null}
            {worktreeAction.error && (
              <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere", marginBottom: 10 }}>
                {worktreeAction.error}
              </div>
            )}
            {worktreeAction.kind === "delete" && worktreeAction.dirtySummary?.length ? (
              <Checkbox
                checked={worktreeAction.force}
                label="Git 报告有本地修改，仍然强制删除"
                onChange={(e) => setWorktreeAction((prev) => prev ? { ...prev, force: e.currentTarget.checked } : prev)}
                rootStyle={{ fontSize: 12, marginBottom: 12 }}
              />
            ) : null}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setWorktreeAction(null)}
                disabled={worktreeAction.busy}
                style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: worktreeAction.busy ? "not-allowed" : "pointer", fontSize: 12 }}
              >
                取消
              </button>
              <button
                onClick={() => void confirmWorktreeAction()}
                disabled={worktreeAction.busy || (worktreeAction.kind === "delete" && Boolean(worktreeAction.dirtySummary?.length) && !worktreeAction.force)}
                style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: worktreeAction.kind === "archive" ? "var(--accent)" : "#ef4444", color: "#fff", cursor: worktreeAction.busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, opacity: worktreeAction.busy || (worktreeAction.kind === "delete" && Boolean(worktreeAction.dirtySummary?.length) && !worktreeAction.force) ? 0.65 : 1 }}
              >
                {worktreeAction.busy ? (worktreeAction.kind === "archive" ? "归档中…" : "删除中…") : (worktreeAction.kind === "archive" ? "归档" : "删除")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archive-all confirmation */}
      {archiveAllConfirming && selectedCwd && (
        <div
          onMouseDown={(e) => e.stopPropagation()}
          style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.28)", padding: 16 }}
        >
          <div style={{ width: "min(420px, 100%)", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "0 18px 50px rgba(0,0,0,0.25)", padding: 16 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", marginBottom: 8 }}>
              归档所有会话
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginBottom: 16 }}>
              确认归档 <strong>{(archivedCounts[selectedCwd] ?? 0) + filteredSessions.length}</strong> 个会话？
              归档后可随时取消归档恢复。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setArchiveAllConfirming(false)}
                disabled={archiveAllBusy}
                style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: archiveAllBusy ? "not-allowed" : "pointer", fontSize: 12 }}
              >
                取消
              </button>
              <button
                onClick={() => void handleArchiveAll()}
                disabled={archiveAllBusy}
                style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "var(--accent)", color: "#fff", cursor: archiveAllBusy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700, opacity: archiveAllBusy ? 0.65 : 1 }}
              >
                {archiveAllBusy ? "归档中…" : "确认归档"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTrellisInitializePrompt && selectedCwd && (
        <div style={{ margin: "8px 10px", padding: 9, borderRadius: 8, border: "1px solid rgba(37,99,235,0.24)", background: "rgba(37,99,235,0.08)", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.45, flexShrink: 0 }}>
          <div style={{ color: "var(--text)", fontWeight: 800, marginBottom: 4 }}>Trellis 未初始化</div>
          <div style={{ marginBottom: 7 }}>点击按钮会打开底部终端并填入初始化命令，请在终端中按回车并完成交互问询。</div>
          <code style={{ display: "block", padding: "5px 6px", marginBottom: 7, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 10, overflowWrap: "anywhere" }}>{trellisInitCommand}</code>
          <button
            type="button"
            disabled={!canOpenTrellisInitTerminal}
            onClick={() => {
              if (!canOpenTrellisInitTerminal) return;
              onOpenTerminalCommand?.(selectedCwd, trellisInitCommand);
              setTrellisStatusRefreshKey((key) => key + 1);
            }}
            title={terminalEnabled ? "在终端中填入 Trellis 初始化命令" : "请先在设置中启用 Web Terminal"}
            style={{ width: "100%", padding: "6px 8px", borderRadius: 7, border: "none", background: canOpenTrellisInitTerminal ? "var(--accent)" : "var(--border)", color: "white", cursor: canOpenTrellisInitTerminal ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 800 }}
          >
            在终端中初始化
          </button>
        </div>
      )}

      {/* Session list */}
      <div ref={sessionListRef} style={{ flex: explorerOpen && (selectedCwdProp || selectedCwd) ? "1 1 0" : "1 1 auto", overflowY: "auto", padding: "0", minHeight: MIN_SESSION_LIST_HEIGHT }}>
        {loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            Loading...
          </div>
        )}
        {error && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {!loading && !error && filteredSessions.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            No sessions found
          </div>
        )}
        {sessionTree.map((node) => (
          <SessionTreeItem
            key={node.session.id}
            node={node}
            selectedSessionId={selectedSessionId}
            onSelectSession={onSelectSession}
            onRenamed={loadSessions}
            onSessionDeleted={(id) => {
              onSessionDeleted?.(id);
              loadSessions();
            }}
            onArchive={handleArchiveSession}
            onContextMenu={(event, session) => setSessionContextMenu({ x: event.clientX, y: event.clientY, session })}
            depth={0}
            selectedForArchive={selectedForArchive}
            onToggleSelect={(id) => {
              setSelectedForArchive((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            }}
          />
        ))}

        {/* Archived sessions section */}
        {/* Batch archive action bar — appears as soon as any sessions are checked */}
        {selectedForArchive.size > 0 && (
          <div style={{
            borderTop: "1px solid var(--border)",
            padding: "8px 14px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
              已选择 {selectedForArchive.size} 个会话
            </span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => {
                  setSelectedForArchive(new Set());
                }}
                style={{ padding: "6px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11, fontWeight: 500 }}
              >
                取消
              </button>
              <button
                onClick={() => void handleBatchArchive()}
                disabled={selectedForArchive.size === 0}
                style={{
                  padding: "6px 12px", borderRadius: 7, border: "none",
                  background: selectedForArchive.size === 0 ? "var(--border)" : "var(--accent)",
                  color: selectedForArchive.size === 0 ? "var(--text-dim)" : "#fff",
                  cursor: selectedForArchive.size === 0 ? "not-allowed" : "pointer",
                  fontSize: 11, fontWeight: 600,
                }}
              >
                归档 {selectedForArchive.size > 0 ? `(${selectedForArchive.size})` : ""}
              </button>
            </div>
          </div>
        )}

        {selectedCwd && !loading && !error && (archivedCounts[selectedCwd] ?? 0) > 0 && (
          <div style={{ borderTop: "1px solid var(--border)", marginTop: 4 }}>
            <button
              onClick={() => {
                if (!archivedExpanded) {
                  setArchivedExpanded(true);
                  loadArchivedSessions(selectedCwd);
                } else {
                  setArchivedExpanded(false);
                }
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                width: "100%",
                padding: "10px 14px",
                background: "none",
                border: "none",
                color: "var(--text-dim)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ transform: archivedExpanded ? "none" : "rotate(-90deg)", transition: "transform 0.15s" }}
              >
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
              <span>已归档 ({archivedCounts[selectedCwd]})</span>
            </button>
            {archivedExpanded && archivedSessions.length > 0 && (
              <div>
                {archivedSessions.map((archivedSession) => (
                  <ArchivedSessionItem
                    key={archivedSession.id}
                    session={archivedSession}
                    onSelect={() => onSelectSession(archivedSession)}
                    onUnarchive={handleUnarchiveSession}
                    onDelete={(id) => onSessionDeleted?.(id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* File Explorer section */}
      {(selectedCwdProp || selectedCwd) && (
        <div
          ref={explorerSectionRef}
          style={{
            borderTop: explorerOpen ? "none" : "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            flex: explorerOpen ? (explorerHeight === null ? "1 1 0" : `0 1 ${explorerHeight}px`) : "0 0 auto",
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          {explorerOpen && (
            <div
              onPointerDown={handleExplorerResizePointerDown}
              title="Resize sessions and explorer"
              aria-label="Resize sessions and explorer"
              role="separator"
              aria-orientation="horizontal"
              style={{
                height: 7,
                borderTop: "1px solid var(--border)",
                background: explorerResizing ? "rgba(37,99,235,0.08)" : "transparent",
                cursor: "row-resize",
                flexShrink: 0,
                touchAction: "none",
              }}
            />
          )}
          <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <button
              onClick={() => setExplorerOpen((v) => !v)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                flex: 1,
                padding: "6px 10px",
                background: "none",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
                textAlign: "left",
              }}
            >
              <svg
                width="9" height="9" viewBox="0 0 10 10" fill="none"
                stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                style={{ transform: explorerOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
              >
                <polyline points="3 2 7 5 3 8" />
              </svg>
              项目空间信息
            </button>
            <button
              onClick={() => {
                setExplorerKey((k) => k + 1);
                setExplorerRefreshDone(true);
                if (explorerRefreshTimerRef.current) clearTimeout(explorerRefreshTimerRef.current);
                explorerRefreshTimerRef.current = setTimeout(() => setExplorerRefreshDone(false), 2000);
              }}
              title="刷新项目空间信息"
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 26, height: 26, padding: 0, marginRight: 6,
                background: explorerRefreshDone ? "rgba(74,222,128,0.18)" : "none",
                border: "none",
                color: explorerRefreshDone ? "#4ade80" : "var(--text-dim)",
                cursor: "pointer",
                borderRadius: 5,
                flexShrink: 0,
                transition: "color 0.3s, background 0.3s",
              }}
              onMouseEnter={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-muted)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (explorerRefreshDone) return; e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
            >
              {explorerRefreshDone ? (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              )}
            </button>
          </div>
          {explorerOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
              <FileExplorer
                cwd={selectedCwdProp ?? selectedCwd!}
                onOpenFile={onOpenFile ?? (() => {})}
                refreshKey={explorerKey}
                onAtMention={onAtMention}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionTreeItem({
  node,
  selectedSessionId,
  onSelectSession,
  onRenamed,
  onSessionDeleted,
  onArchive,
  onContextMenu,
  depth,
  selectedForArchive,
  onToggleSelect,
}: {
  node: SessionTreeNode;
  selectedSessionId: string | null;
  onSelectSession: (s: SessionInfo) => void;
  onRenamed?: () => void;
  onSessionDeleted?: (id: string) => void;
  onArchive?: (id: string) => void;
  onContextMenu?: (event: React.MouseEvent, session: SessionInfo) => void;
  depth: number;
  selectedForArchive?: Set<string>;
  onToggleSelect?: (id: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const hasChildren = node.children.length > 0;

  return (
    <div>
      <div style={{ position: "relative" }}>
        {/* Indent line for child sessions */}
        {depth > 0 && (
          <div style={{
            position: "absolute",
            left: depth * 12 + 6,
            top: 0, bottom: 0,
            width: 1,
            background: "var(--border)",
            pointerEvents: "none",
          }} />
        )}
        <SessionItem
          session={node.session}
          isSelected={node.session.id === selectedSessionId}
          onClick={() => onSelectSession(node.session)}
          onRenamed={onRenamed}
          onDeleted={(id) => onSessionDeleted?.(id)}
          onArchive={onArchive}
          onContextMenu={onContextMenu}
          depth={depth}
          hasChildren={hasChildren}
          selectedForArchive={selectedForArchive?.has(node.session.id)}
          onToggleSelect={onToggleSelect}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((v) => !v)}
        />
      </div>
      {hasChildren && !collapsed && (
        <div>
          {node.children.map((child) => (
            <SessionTreeItem
              key={child.session.id}
              node={child}
              selectedSessionId={selectedSessionId}
              onSelectSession={onSelectSession}
              onRenamed={onRenamed}
              onSessionDeleted={onSessionDeleted}
              onArchive={onArchive}
              onContextMenu={onContextMenu}
              depth={depth + 1}
              selectedForArchive={selectedForArchive}
              onToggleSelect={onToggleSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SessionItem({
  session,
  isSelected,
  onClick,
  onRenamed,
  onDeleted,
  onArchive,
  onContextMenu,
  depth = 0,
  hasChildren = false,
  collapsed = false,
  onToggleCollapse,
  selectedForArchive,
  onToggleSelect,
}: {
  session: SessionInfo;
  isSelected: boolean;
  onClick: () => void;
  onRenamed?: () => void;
  onDeleted?: (id: string) => void;
  onArchive?: (id: string) => void;
  onContextMenu?: (event: React.MouseEvent, session: SessionInfo) => void;
  depth?: number;
  hasChildren?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  selectedForArchive?: boolean;
  onToggleSelect?: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const title = displayTitleForSession(session);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameValue(session.name ?? "");
    setRenaming(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(async () => {
    const name = renameValue.trim();
    setRenaming(false);
    if (name === (session.name ?? "")) return;
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onRenamed?.();
    } catch {
      // ignore
    }
  }, [renameValue, session.id, session.name, onRenamed]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" });
      onDeleted?.(session.id);
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDeleted]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const handleArchiveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onArchive?.(session.id);
  }, [session.id, onArchive]);

  // Fixed-height outer wrapper — content swaps in place so the list never reflows
  const ITEM_HEIGHT = 54;

  return (
    <div
      onClick={confirmDelete || renaming ? undefined : onClick}
      onContextMenu={(event) => {
        if (confirmDelete || renaming) return;
        event.preventDefault();
        event.stopPropagation();
        onContextMenu?.(event, session);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); }}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: depth > 0 ? depth * 12 + 14 : 14,
        paddingRight: 8,
        cursor: confirmDelete || renaming ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : isSelected ? "var(--bg-selected)" : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete
          ? "2px solid #ef4444"
          : isSelected ? "2px solid var(--accent)" : "2px solid transparent",
        transition: "background 0.1s",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Delete <span style={{ fontWeight: 600 }}>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button
              onClick={handleDeleteConfirm}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                height: 30, padding: "0 11px",
                background: "#ef4444", border: "none",
                borderRadius: 6, color: "#fff",
                cursor: "pointer", fontSize: 12, fontWeight: 600,
                whiteSpace: "nowrap",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
            <button
              onClick={handleDeleteCancel}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                height: 30, padding: "0 11px",
                background: "var(--bg)", border: "1px solid var(--border)",
                borderRadius: 6, color: "var(--text-muted)",
                cursor: "pointer", fontSize: 12, fontWeight: 500,
                whiteSpace: "nowrap",
              }}
            >
              Cancel
            </button>
          </div>
        </>
      ) : renaming ? (
        /* ── Rename: input fills the same row ── */
        <input
          ref={inputRef}
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") setRenaming(false);
          }}
          autoFocus
          style={{
            flex: 1,
            fontSize: 12,
            padding: "5px 8px",
            border: "1px solid var(--accent)",
            borderRadius: 5,
            outline: "none",
            background: "var(--bg)",
            color: "var(--text)",
            height: 30,
          }}
        />
      ) : (
        /* ── Normal view ── */
        <>
          {/* Multi-select checkbox */}
          {onToggleSelect && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "flex", alignItems: "center", flexShrink: 0 }}
            >
              <Checkbox
                aria-label={`选择会话 ${title}`}
                checked={!!selectedForArchive}
                onChange={() => onToggleSelect(session.id)}
                size={14}
              />
            </div>
          )}
          {/* Fork indicator for child sessions */}
          {depth > 0 && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: isSelected ? 500 : 400,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text)",
                  minWidth: 0,
                }}
                title={title}
              >
                {title}
              </div>
              <WorktreeBadge worktree={session.worktree} />
            </div>
            <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11 }}>
              <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
              <span>{session.messageCount} msgs</span>
            </div>
          </div>

          {/* Collapse toggle — always visible when has children */}
          {hasChildren && (
            <button
              onClick={(e) => { e.stopPropagation(); onToggleCollapse?.(); }}
              title={collapsed ? "Expand forks" : "Collapse forks"}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                width: 20, height: 20, padding: 0, flexShrink: 0,
                background: "none", border: "none",
                color: "var(--text-dim)", cursor: "pointer",
                transform: collapsed ? "rotate(-90deg)" : "none",
                transition: "transform 0.15s",
              }}
            >
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="2 3.5 5 6.5 8 3.5" />
              </svg>
            </button>
          )}

          {/* Action buttons — shown on hover */}
          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={startRename}
                title="Rename"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-selected)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
              {/* Archive button — only for active (non-archived) sessions */}
              {!session.archived && (
                <button
                  onClick={handleArchiveClick}
                  title="Archive"
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "center",
                    width: 32, height: 32, padding: 0,
                    background: "var(--bg-hover)", border: "1px solid var(--border)",
                    borderRadius: 7, color: "var(--text-muted)",
                    cursor: "pointer", flexShrink: 0,
                    transition: "background 0.12s, color 0.12s, border-color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--bg-selected)";
                    e.currentTarget.style.color = "var(--accent)";
                    e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text-muted)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              )}
              <button
                onClick={handleDeleteClick}
                title="Delete"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                  transition: "background 0.12s, color 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * ArchivedSessionItem — renders a muted archived session row
 * with Unarchive and Delete actions on hover.
 */
function ArchivedSessionItem({
  session,
  onSelect,
  onUnarchive,
  onDelete,
}: {
  session: SessionInfo;
  onSelect: () => void;
  onUnarchive: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const title = displayTitleForSession(session);

  const handleUnarchiveClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onUnarchive(session.id);
  }, [session.id, onUnarchive]);

  const handleDeleteClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(true);
  }, []);

  const handleDeleteConfirm = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
    setDeleting(true);
    try {
      fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: "DELETE" })
        .then(() => onDelete(session.id))
        .catch(() => setDeleting(false));
    } catch {
      setDeleting(false);
    }
  }, [session.id, onDelete]);

  const handleDeleteCancel = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  }, []);

  const ITEM_HEIGHT = 54;

  return (
    <div
      onClick={confirmDelete ? undefined : onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        height: ITEM_HEIGHT,
        display: "flex",
        alignItems: "center",
        paddingLeft: 14,
        paddingRight: 8,
        cursor: confirmDelete ? "default" : "pointer",
        background: confirmDelete
          ? "rgba(239,68,68,0.06)"
          : hovered ? "var(--bg-hover)" : "transparent",
        borderLeft: confirmDelete ? "2px solid #ef4444" : "2px solid transparent",
        opacity: deleting ? 0.5 : 1,
        gap: 6,
        overflow: "hidden",
      }}
    >
      {confirmDelete ? (
        <>
          <div style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Delete <span style={{ fontWeight: 600 }}>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
            <button onClick={handleDeleteConfirm} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 4, height: 30, padding: "0 11px", background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                <path d="M10 11v6M14 11v6" />
                <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
              </svg>
              Delete
            </button>
            <button onClick={handleDeleteCancel} style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 30, padding: "0 11px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 12, fontWeight: 500, whiteSpace: "nowrap" }}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          <div style={{ flex: 1, minWidth: 0, fontStyle: "italic" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text-dim)",
                  minWidth: 0,
                }}
                title={title}
              >
                {title}
              </div>
            </div>
            <div style={{ marginTop: 2, display: "flex", gap: 8, color: "var(--text-dim)", fontSize: 11 }}>
              <span title={session.modified}>{formatRelativeTime(session.modified)}</span>
              <span>{session.messageCount} msgs</span>
            </div>
          </div>
          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              <button
                onClick={handleUnarchiveClick}
                title="Unarchive"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  gap: 4, height: 30, padding: "0 10px",
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(37,99,235,0.08)";
                  e.currentTarget.style.color = "var(--accent)";
                  e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                恢复
              </button>
              <button
                onClick={handleDeleteClick}
                title="Delete"
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "var(--bg-hover)", border: "1px solid var(--border)",
                  borderRadius: 7, color: "var(--text-muted)",
                  cursor: "pointer", flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239,68,68,0.08)";
                  e.currentTarget.style.color = "#ef4444";
                  e.currentTarget.style.borderColor = "rgba(239,68,68,0.35)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text-muted)";
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                  <path d="M10 11v6M14 11v6" />
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                </svg>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
