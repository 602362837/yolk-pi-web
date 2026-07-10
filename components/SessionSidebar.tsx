"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { TrellisSetupStatus } from "@/lib/trellis-setup-types";
import type { GitInfo, SessionInfo, WorktreeInfo } from "@/lib/types";
import type { PiWebProjectRecord, PiWebProjectSpaceRecord } from "@/lib/project-registry-types";
import { displayProjectName, displaySpaceName, activeProjectSpaces, sortProjectsForSidebar, worktreeInfoFromSpace, shortenCwd } from "@/lib/project-display";
import { formatWorkspaceHeaderTitle, formatWorkspaceSubtitle, formatWorkspaceTitle } from "@/lib/workspace-title";
import { displayTitleForSession } from "@/lib/session-title";
import { Checkbox } from "./Checkbox";

import { ProjectSpaceSwitchDialog } from "./ProjectSpaceSwitchDialog";

export interface ProjectSpaceSelectionContext {
  projectId: string;
  projectName: string;
  spaceId: string;
  spaceName: string;
  cwd: string;
}

interface Props {
  selectedSessionId: string | null;
  onSelectSession: (session: SessionInfo, isRestore?: boolean) => void;
  onNewSession?: (sessionId: string, cwd: string, projectId?: string, spaceId?: string) => void;
  onProjectSpaceChange?: (context: ProjectSpaceSelectionContext | null) => void;
  initialSessionId?: string | null;
  onInitialRestoreDone?: () => void;
  refreshKey?: number;
  onSessionDeleted?: (sessionId: string) => void;
  selectedCwd?: string | null;
  onCwdChange?: (cwd: string | null) => void;
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

function formatWorktreeTooltip(worktree: WorktreeInfo): string {
  const branch = worktree.branch || "未知分支";
  const base = resolveWorktreeBase(worktree) || "未知";
  return `WorkTree：${branch} / 基准：${base}`;
}

function WorktreeBadge({ worktree }: { worktree?: WorktreeInfo }) {
  if (!worktree) return null;
  return (
    <span
      title={formatWorktreeTooltip(worktree)}
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
        overflow: "hidden",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ flexShrink: 0 }}>WT</span>
      {worktree.branch && (
        <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 500 }}>
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
  registryLink?: {
    project?: PiWebProjectRecord;
    space?: PiWebProjectSpaceRecord;
    created?: boolean;
  } | null;
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

interface MetadataEditTarget {
  kind: "project" | "space";
  project: PiWebProjectRecord;
  space?: PiWebProjectSpaceRecord;
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

interface SessionTreeNode {
  session: SessionInfo;
  children: SessionTreeNode[];
}

interface ProjectSpaceContextMenuState {
  x: number;
  y: number;
  project: PiWebProjectRecord;
  space?: PiWebProjectSpaceRecord;
}

function formatUnknownGitBranch(): string {
  return "未检测到 Git 分支";
}

function formatWorktreeBranch(worktree?: WorktreeInfo, git?: GitInfo): string {
  return worktree?.branch || git?.branch || "未知分支";
}

function resolveWorktreeBase(worktree?: WorktreeInfo, git?: GitInfo): string | undefined {
  return worktree?.baseRef || git?.baseRef || worktree?.mainWorktreeBranch || git?.mainWorktreeBranch;
}

function formatProjectSpaceSubtitle(space: PiWebProjectSpaceRecord, git: GitInfo | undefined): string {
  const spaceName = displaySpaceName(space);
  const pathMissingSuffix = space.missing ? " · 路径缺失" : "";
  if (space.kind === "worktree") {
    const worktree = worktreeInfoFromSpace(space);
    const base = resolveWorktreeBase(worktree, git);
    const baseText = base ? `基准：${base}` : "基准未知";
    return `空间：${spaceName} · WorkTree：${formatWorktreeBranch(worktree, git)} · ${baseText}${pathMissingSuffix}`;
  }
  const branchText = git?.branch ? `分支：${git.branch}` : formatUnknownGitBranch();
  return `空间：${spaceName} · ${branchText}${pathMissingSuffix}`;
}

function formatProjectSpaceDetail(space: PiWebProjectSpaceRecord, git: GitInfo | undefined, homeDir?: string): string {
  const worktree = worktreeInfoFromSpace(space);
  const lines = [
    `空间：${displaySpaceName(space)}`,
    `路径：${space.path}${space.missing ? "（路径缺失）" : ""}`,
  ];
  if (space.kind === "worktree") {
    lines.push(`分支：${formatWorktreeBranch(worktree, git)}`);
    lines.push("WorkTree：是");
    lines.push(`基准：${resolveWorktreeBase(worktree, git) || "未知"}`);
  } else {
    lines.push(`分支：${git?.branch || "未检测到"}`);
    lines.push("WorkTree：否");
  }
  const shortPath = shortenCwd(space.path, homeDir);
  if (shortPath !== space.path) lines.push(`短路径：${shortPath}`);
  return lines.join("\n");
}

function findProjectSpace(projects: PiWebProjectRecord[], projectId: string | null, spaceId: string | null): { project: PiWebProjectRecord; space: PiWebProjectSpaceRecord } | null {
  if (!projectId || !spaceId) return null;
  const project = projects.find((item) => item.id === projectId);
  const space = project?.spaces[spaceId];
  return project && space ? { project, space } : null;
}

function WorkspaceMenuButton({ children, danger = false, onClick }: { children: React.ReactNode; danger?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "9px 14px",
        background: "none",
        border: "none",
        color: danger ? "#dc2626" : "var(--text)",
        cursor: "pointer",
        fontSize: 12,
        textAlign: "left",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = danger ? "rgba(239,68,68,0.08)" : "var(--bg-hover)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      {children}
    </button>
  );
}

function studioChildBadgeText(session: SessionInfo): string | null {
  const child = session.studioChild;
  if (!child) return null;
  return `${child.member} · ${child.status ?? "audit"}`;
}

function studioChildDetailText(session: SessionInfo): string | null {
  const child = session.studioChild;
  if (!child) return null;
  const run = child.runId ? child.runId.slice(0, 8) : undefined;
  return [session.studioChildDisplay?.subtaskTitle ?? child.subtaskId, run ? `run ${run}` : undefined].filter(Boolean).join(" · ") || null;
}

function studioChildTitleTooltip(session: SessionInfo, title: string): string {
  const child = session.studioChild;
  if (!child) return title;
  return [
    title,
    session.studioChildDisplay?.subtaskTitle ? `Subtask: ${session.studioChildDisplay.subtaskTitle}` : child.subtaskId ? `Subtask: ${child.subtaskId}` : undefined,
    `Member: ${child.member}`,
    `Status: ${child.status ?? "audit"}`,
    child.runId ? `Run: ${child.runId}` : undefined,
  ].filter(Boolean).join("\n");
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

export function SessionSidebar({ selectedSessionId, onSelectSession, onNewSession, onProjectSpaceChange, initialSessionId, onInitialRestoreDone, refreshKey, onSessionDeleted, selectedCwd: selectedCwdProp, onCwdChange, trellisEnabled = false, terminalEnabled = false, onOpenTerminalCommand }: Props) {
  const [projects, setProjects] = useState<PiWebProjectRecord[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCwd, setSelectedCwd] = useState<string | null>(null);
  const [homeDir, setHomeDir] = useState<string>("");
  const [projectSwitchOpen, setProjectSwitchOpen] = useState(false);
  const [customPathValue, setCustomPathValue] = useState("");
  const [customPathError, setCustomPathError] = useState<string | null>(null);
  const [customPathValidating, setCustomPathValidating] = useState(false);
  const [directoryPickerBusy, setDirectoryPickerBusy] = useState(false);
  // Git add-project form state — toggled/rendered inside ProjectSpaceSwitchDialog.
  const [gitParentPathValue, setGitParentPathValue] = useState("");
  const [gitRemoteRepositoryValue, setGitRemoteRepositoryValue] = useState("");
  const [gitAddError, setGitAddError] = useState<string | null>(null);
  const [gitParentPickerBusy, setGitParentPickerBusy] = useState(false);
  const [gitCloneBusy, setGitCloneBusy] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const [selectedForArchive, setSelectedForArchive] = useState<Set<string>>(new Set());
  const [archiveAllConfirming, setArchiveAllConfirming] = useState(false);
  const [archiveAllBusy, setArchiveAllBusy] = useState(false);
  const [projectsRefreshDone, setProjectsRefreshDone] = useState(false);
  const [sessionRefreshDone, setSessionRefreshDone] = useState(false);
  const [creatingWorktree, setCreatingWorktree] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [, setEphemeralWorktrees] = useState<Record<string, WorktreeInfo>>({});
  const [worktreeContextMenu, setWorktreeContextMenu] = useState<WorktreeContextMenuState | null>(null);
  const [sessionContextMenu, setSessionContextMenu] = useState<SessionContextMenuState | null>(null);
  const [metadataEditTarget, setMetadataEditTarget] = useState<MetadataEditTarget | null>(null);
  const [metadataBusy, setMetadataBusy] = useState(false);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [worktreeAction, setWorktreeAction] = useState<WorktreeActionState | null>(null);
  const [projectSpaceContextMenu, setProjectSpaceContextMenu] = useState<ProjectSpaceContextMenuState | null>(null);
  const [removedWorktreeCwds, setRemovedWorktreeCwds] = useState<string[]>([]);
  const [selectedCwdGit, setSelectedCwdGit] = useState<GitInfo | undefined>(undefined);
  const [archivedCounts, setArchivedCounts] = useState<Record<string, number>>({});
  const [, setArchivedCwds] = useState<string[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<SessionInfo[]>([]);
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  const [trellisSetupStatus, setTrellisSetupStatus] = useState<TrellisSetupStatus | null>(null);
  const [trellisStatusRefreshKey, setTrellisStatusRefreshKey] = useState(0);
  const [sessionsSwitching, setSessionsSwitching] = useState(false);
  const loadSessionsTokenRef = useRef(0);
  const prevSpaceKeyRef = useRef<string | null>(null);
  const sessionRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionListRef = useRef<HTMLDivElement>(null);

  const loadProjects = useCallback(async (showLoading = false) => {
    try {
      if (showLoading) setLoading(true);
      const res = await fetch("/api/projects?sync=missing");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { projects?: PiWebProjectRecord[]; error?: string };
      if (data.error) throw new Error(data.error);
      setProjects(data.projects ?? []);
      setError(null);
      if (!showLoading) {
        setProjectsRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setProjectsRefreshDone(false), 2000);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async (showLoading = false) => {
    const token = ++loadSessionsTokenRef.current;
    const selected = findProjectSpace(projects, selectedProjectId, selectedSpaceId);
    if (!selected) {
      if (token === loadSessionsTokenRef.current) {
        setAllSessions([]);
        setSessionsSwitching(false);
      }
      return;
    }
    try {
      if (showLoading) {
        if (token === loadSessionsTokenRef.current) {
          setSessionsSwitching(true);
          setLoading(true);
          setAllSessions([]);
          setSelectedForArchive(new Set());
          setArchivedExpanded(false);
          setArchivedSessions([]);
        }
      }
      const res = await fetch(`/api/projects/${encodeURIComponent(selected.project.id)}/spaces/${encodeURIComponent(selected.space.id)}/sessions`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { sessions?: SessionInfo[]; archivedCounts?: Record<string, number>; error?: string };
      if (data.error) throw new Error(data.error);
      if (token !== loadSessionsTokenRef.current) return;
      setAllSessions(data.sessions ?? []);
      setArchivedCwds([]);
      setArchivedCounts(data.archivedCounts ?? {});
      setError(null);
      if (!showLoading) {
        setSessionRefreshDone(true);
        if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current);
        sessionRefreshTimerRef.current = setTimeout(() => setSessionRefreshDone(false), 2000);
      }
    } catch (e) {
      if (token !== loadSessionsTokenRef.current) return;
      setError(String(e));
    } finally {
      if (token === loadSessionsTokenRef.current) {
        if (showLoading) setLoading(false);
        setSessionsSwitching(false);
      }
    }
  }, [projects, selectedProjectId, selectedSpaceId]);

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
    void loadProjects(isFirst);
  }, [loadProjects, refreshKey]);

  useEffect(() => {
    const spaceKey = `${selectedProjectId ?? ""}/${selectedSpaceId ?? ""}`;
    const isSpaceChange = prevSpaceKeyRef.current !== null && prevSpaceKeyRef.current !== spaceKey;
    prevSpaceKeyRef.current = spaceKey;
    void loadSessions(isSpaceChange);
  }, [loadSessions, selectedProjectId, selectedSpaceId]);

  useEffect(() => {
    if (!archivedExpanded || !selectedCwd || (archivedCounts[selectedCwd] ?? 0) === 0) return;
    void loadArchivedSessions(selectedCwd);
  }, [archivedExpanded, selectedCwd, archivedCounts, loadArchivedSessions]);

  useEffect(() => {
    fetch("/api/home").then((r) => r.json()).then((d: { home?: string }) => {
      if (d.home) setHomeDir(d.home);
    }).catch(() => {});
  }, []);

  const restoredRef = useRef(false);
  const lastNotifiedCwdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const cwdForApp = selectedCwdProp ?? selectedCwd;
    if (lastNotifiedCwdRef.current === cwdForApp) return;
    lastNotifiedCwdRef.current = cwdForApp;
    onCwdChange?.(cwdForApp ?? null);
  }, [selectedCwd, selectedCwdProp, onCwdChange]);

  useEffect(() => {
    const selected = findProjectSpace(projects, selectedProjectId, selectedSpaceId);
    onProjectSpaceChange?.(selected ? {
      projectId: selected.project.id,
      projectName: displayProjectName(selected.project),
      spaceId: selected.space.id,
      spaceName: displaySpaceName(selected.space),
      cwd: selected.space.path,
    } : null);
  }, [onProjectSpaceChange, projects, selectedProjectId, selectedSpaceId]);

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

  // Restore session from URL without using sessions as the project list source.
  useEffect(() => {
    if (!initialSessionId || restoredRef.current) return;
    restoredRef.current = true;
    fetch(`/api/sessions/${encodeURIComponent(initialSessionId)}`)
      .then(async (res) => {
        if (!res.ok) return null;
        return await res.json() as SessionInfo & { session?: SessionInfo; info?: SessionInfo };
      })
      .then((data) => {
        const target = data && ("info" in data && data.info ? data.info : "session" in data && data.session ? data.session : data);
        if (target?.id) {
          setSelectedCwd(target.cwd);
          if (target.projectId && target.spaceId) {
            setSelectedProjectId(target.projectId);
            setSelectedSpaceId(target.spaceId);
          }
          onSelectSession(target, true);
        } else {
          onInitialRestoreDone?.();
        }
      })
      .catch(() => onInitialRestoreDone?.());
  }, [initialSessionId, onInitialRestoreDone, onSelectSession]);

  useEffect(() => {
    if (selectedCwd !== null || selectedProjectId || selectedSpaceId) return;
    const firstProject = sortProjectsForSidebar(projects)[0];
    const firstSpace = firstProject ? activeProjectSpaces(firstProject)[0] : undefined;
    if (firstProject && firstSpace) {
      setSelectedProjectId(firstProject.id);
      setSelectedSpaceId(firstSpace.id);
      setSelectedCwd(firstSpace.path);
    }
  }, [projects, selectedCwd, selectedProjectId, selectedSpaceId]);

  useEffect(() => {
    if (!selectedCwd) return;
    const current = findProjectSpace(projects, selectedProjectId, selectedSpaceId);
    if (current?.space.path === selectedCwd) return;
    for (const project of projects) {
      const match = activeProjectSpaces(project).find((space) => space.path === selectedCwd);
      if (match) {
        setSelectedProjectId(project.id);
        setSelectedSpaceId(match.id);
        return;
      }
    }
  }, [projects, selectedCwd, selectedProjectId, selectedSpaceId]);

  // Upsert a project into the local list and select its main space. Shared by
  // the normal /api/projects registration flow and the Git clone flow so both
  // select the backend-returned main space (including created=false re-registers).
  const upsertProjectAndSelectMainSpace = useCallback((project: PiWebProjectRecord) => {
    setProjects((prev) => {
      const exists = prev.some((item) => item.id === project.id);
      const updated = prev.map((item) => item.id === project.id ? project : item);
      return exists ? updated : [project, ...updated];
    });
    const mainSpace = project.spaces.main;
    setSelectedProjectId(project.id);
    setSelectedSpaceId(mainSpace.id);
    setSelectedCwd(mainSpace.path);
  }, []);

  const registerAndSelectProjectPath = useCallback(async (path: string) => {
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    const data = await res.json().catch(() => ({})) as { project?: PiWebProjectRecord; created?: boolean; error?: string };
    if (!res.ok || data.error || !data.project) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    upsertProjectAndSelectMainSpace(data.project);
    setCustomPathValue("");
    setCustomPathError(null);
    setProjectSwitchOpen(false);
  }, [upsertProjectAndSelectMainSpace]);

  const commitCustomPath = useCallback(async () => {
    const path = customPathValue.trim();
    if (!path || customPathValidating) return;

    setCustomPathValidating(true);
    setCustomPathError(null);
    try {
      await registerAndSelectProjectPath(path);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setCustomPathValidating(false);
    }
  }, [customPathValue, customPathValidating, registerAndSelectProjectPath]);

  const handleDefaultCwd = useCallback(async () => {
    try {
      const res = await fetch("/api/default-cwd", { method: "POST" });
      const data = await res.json() as { cwd?: string; error?: string };
      if (data.cwd) {
        await registerAndSelectProjectPath(data.cwd);
      }
    } catch {
      // ignore
    }
  }, [registerAndSelectProjectPath]);

  const handleDirectoryPicker = useCallback(async () => {
    if (directoryPickerBusy) return;
    setDirectoryPickerBusy(true);
    setCustomPathError(null);
    try {
      const res = await fetch("/api/projects/select-directory", { method: "POST" });
      const data = await res.json().catch(() => ({})) as { path?: string; canceled?: boolean; error?: string };
      if (data.canceled) return;
      if (!res.ok || data.error || !data.path) {
        setCustomPathError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      await registerAndSelectProjectPath(data.path);
    } catch (e) {
      setCustomPathError(e instanceof Error ? e.message : String(e));
    } finally {
      setDirectoryPickerBusy(false);
    }
  }, [directoryPickerBusy, registerAndSelectProjectPath]);

  // Clear all Git add-form temporary state (inputs, errors, busy flags).
  const resetGitAddForm = useCallback(() => {
    setGitParentPathValue("");
    setGitRemoteRepositoryValue("");
    setGitAddError(null);
    setGitParentPickerBusy(false);
    setGitCloneBusy(false);
  }, []);

  // Reset all add-form state (called by dialog on close/cancel).
  const resetAllAddForms = useCallback(() => {
    setCustomPathValue("");
    setCustomPathError(null);
    setCustomPathValidating(false);
    resetGitAddForm();
  }, [resetGitAddForm]);

  // Git parent directory picker: calls the shared directory picker with
  // purpose "git-parent" and ONLY backfills the Local parent path input. It must
  // not register the parent as a project and must not switch the current
  // project/space/cwd — only Clone and add triggers registration.
  const handleGitParentDirectoryPicker = useCallback(async () => {
    if (gitParentPickerBusy || gitCloneBusy) return;
    setGitParentPickerBusy(true);
    setGitAddError(null);
    try {
      const res = await fetch("/api/projects/select-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "git-parent" }),
      });
      const data = await res.json().catch(() => ({})) as { path?: string; canceled?: boolean; error?: string };
      if (data.canceled) return;
      if (!res.ok || data.error || !data.path) {
        setGitAddError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setGitParentPathValue(data.path);
    } catch (e) {
      setGitAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitParentPickerBusy(false);
    }
  }, [gitParentPickerBusy, gitCloneBusy]);

  // Git clone submit: POST /api/projects/git-clone with the parent path and
  // remote repository. On success the backend has already registered the cloned
  // target path (not the parent), so we upsert the returned project and select
  // its main space. On failure we surface the error and keep the form open so the
  // user can fix inputs; the current project/space/cwd must NOT change. If the
  // clone succeeded but registration failed, the error includes a clonedPath so
  // the user can recover via Add project path…
  const handleGitCloneSubmit = useCallback(async () => {
    if (gitCloneBusy || gitParentPickerBusy) return;
    const parentPath = gitParentPathValue.trim();
    const remoteRepository = gitRemoteRepositoryValue.trim();
    if (!parentPath || !remoteRepository) {
      setGitAddError("请填写 Local parent path 与 Remote repository。");
      return;
    }
    setGitCloneBusy(true);
    setGitAddError(null);
    try {
      const res = await fetch("/api/projects/git-clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentPath, remoteRepository }),
      });
      const data = await res.json().catch(() => ({})) as {
        project?: PiWebProjectRecord;
        created?: boolean;
        clone?: { targetPath?: string };
        error?: string;
        code?: string;
        clonedPath?: string;
      };
      if (!res.ok || data.error || !data.project) {
        const recoveredPath = data.clonedPath || data.clone?.targetPath;
        const suffix = recoveredPath
          ? `（已克隆到 ${recoveredPath}，可使用 Add project path… 手动注册）`
          : "";
        setGitAddError(`${data.error ?? `HTTP ${res.status}`}${suffix}`);
        return;
      }
      upsertProjectAndSelectMainSpace(data.project);
      setProjectSwitchOpen(false);
      resetGitAddForm();
    } catch (e) {
      setGitAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setGitCloneBusy(false);
    }
  }, [
    gitCloneBusy,
    gitParentPickerBusy,
    gitParentPathValue,
    gitRemoteRepositoryValue,
    upsertProjectAndSelectMainSpace,
    resetGitAddForm,
  ]);

  // Close context menus on outside click
  useEffect(() => {
    const handler = () => {
      setWorktreeContextMenu(null);
      setSessionContextMenu(null);
      setProjectSpaceContextMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleNewSession = useCallback(() => {
    if (!selectedCwd) return;
    // Generate a temporary UUID client-side — no backend call needed.
    // Pi will be spawned lazily when the user sends the first message.
    onNewSession?.(makeTempSessionId(), selectedCwd, selectedProjectId ?? undefined, selectedSpaceId ?? undefined);
  }, [selectedCwd, selectedProjectId, selectedSpaceId, onNewSession]);

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
      await loadProjects(false);
      const linkedProjectId = data.registryLink?.project?.id ?? selectedProjectId ?? undefined;
      const linkedSpaceId = data.registryLink?.space?.id;
      if (linkedProjectId && linkedSpaceId) {
        setSelectedProjectId(linkedProjectId);
        setSelectedSpaceId(linkedSpaceId);
      }
      setSelectedCwd(data.cwd);
      setProjectSwitchOpen(false);
      setCustomPathValue("");
      setCustomPathError(null);
      onNewSession?.(makeTempSessionId(), data.cwd, linkedProjectId, linkedSpaceId);
    } catch (e) {
      setWorktreeError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingWorktree(false);
    }
  }, [selectedCwd, creatingWorktree, onNewSession, selectedProjectId, loadProjects]);

  const openWorktreeAction = useCallback((kind: "delete" | "archive", cwd: string, worktree: WorktreeInfo) => {
    setWorktreeContextMenu(null);
    setWorktreeAction({ kind, cwd, worktree, force: false, busy: false, error: null });
  }, []);

  const handleDialogProjectContextMenu = useCallback((event: React.MouseEvent, project: PiWebProjectRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectSpaceContextMenu({ x: event.clientX, y: event.clientY, project });
  }, []);

  const handleDialogSpaceContextMenu = useCallback((event: React.MouseEvent, project: PiWebProjectRecord, space: PiWebProjectSpaceRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setProjectSpaceContextMenu({ x: event.clientX, y: event.clientY, project, space });
  }, []);

  // Rollback snapshot for drag-reorder optimistic updates
  const projectsBeforeReorder = useRef<PiWebProjectRecord[] | null>(null);

  const handleReorderProjects = useCallback(async (orderedProjectIds: string[]) => {
    setProjects((prev) => {
      projectsBeforeReorder.current = prev;
      return prev.map((project, index) => {
        const nextIndex = orderedProjectIds.indexOf(project.id);
        return nextIndex >= 0
          ? { ...project, sortOrder: (nextIndex + 1) * 1024, updatedAt: new Date().toISOString() }
          : { ...project, sortOrder: (orderedProjectIds.length + index + 1) * 1024, updatedAt: new Date().toISOString() };
      });
    });

    try {
      const res = await fetch(`/api/projects`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedProjectIds }),
      });
      const data = await res.json().catch(() => ({})) as { projects?: PiWebProjectRecord[]; error?: string };
      if (!res.ok || data.error || !data.projects) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProjects(data.projects);
      projectsBeforeReorder.current = null;
    } catch {
      if (projectsBeforeReorder.current) {
        setProjects(projectsBeforeReorder.current);
        projectsBeforeReorder.current = null;
      }
    }
  }, []);

  const handleReorderSpaces = useCallback(async (projectId: string, orderedSpaceIds: string[]) => {
    // Optimistically update local state with temporary sortOrders
    setProjects((prev) => {
      projectsBeforeReorder.current = prev;
      return prev.map((p) => {
        if (p.id !== projectId) return p;
        const updatedSpaces = { ...p.spaces };
        orderedSpaceIds.forEach((id, i) => {
          if (updatedSpaces[id]) {
            updatedSpaces[id] = { ...updatedSpaces[id], sortOrder: (i + 1) * 1024 };
          }
        });
        return { ...p, spaces: updatedSpaces, updatedAt: new Date().toISOString() };
      });
    });

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/spaces`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderedSpaceIds }),
      });
      const data = await res.json().catch(() => ({})) as { project?: PiWebProjectRecord; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      // Apply authoritative server response so sortOrder values converge
      if (data.project) {
        setProjects((prev) => prev.map((p) => (p.id === data.project!.id ? data.project! : p)));
      }
      projectsBeforeReorder.current = null;
    } catch {
      // Rollback to pre-drag state on failure
      if (projectsBeforeReorder.current) {
        setProjects(projectsBeforeReorder.current);
        projectsBeforeReorder.current = null;
      }
    }
  }, []);

  const patchProjectMetadata = useCallback(async (projectId: string, patch: Record<string, unknown>) => {
    setMetadataBusy(true);
    setMetadataError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({})) as { project?: PiWebProjectRecord; error?: string };
      if (!res.ok || data.error || !data.project) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProjects((prev) => prev.map((project) => project.id === data.project!.id ? data.project! : project));
      setMetadataEditTarget(null);
      if (data.project.archived && selectedProjectId === data.project.id) {
        setSelectedProjectId(null);
        setSelectedSpaceId(null);
        setSelectedCwd(null);
      }
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : String(error));
    } finally {
      setMetadataBusy(false);
    }
  }, [selectedProjectId]);

  const patchSpaceMetadata = useCallback(async (projectId: string, spaceId: string, patch: Record<string, unknown>) => {
    setMetadataBusy(true);
    setMetadataError(null);
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/spaces/${encodeURIComponent(spaceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({})) as { space?: PiWebProjectSpaceRecord; error?: string };
      if (!res.ok || data.error || !data.space) throw new Error(data.error ?? `HTTP ${res.status}`);
      setProjects((prev) => prev.map((project) => project.id === projectId ? { ...project, spaces: { ...project.spaces, [spaceId]: data.space! } } : project));
      setMetadataEditTarget(null);
      if (data.space.archived && selectedProjectId === projectId && selectedSpaceId === spaceId) {
        const project = projects.find((item) => item.id === projectId);
        const fallback = project ? activeProjectSpaces({ ...project, spaces: { ...project.spaces, [spaceId]: data.space } }).find((space) => space.id !== spaceId && !space.missing) : undefined;
        setSelectedSpaceId(fallback?.id ?? null);
        setSelectedCwd(fallback?.path ?? null);
      }
    } catch (error) {
      setMetadataError(error instanceof Error ? error.message : String(error));
    } finally {
      setMetadataBusy(false);
    }
  }, [projects, selectedProjectId, selectedSpaceId]);

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
      const data = await res.json().catch(() => ({})) as WorktreeActionResponse & { dirtySummary?: string | string[]; archivedSpaces?: PiWebProjectSpaceRecord[] };
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

      const removedCwd = worktreeAction.cwd;
      const archivedSpacesArr = data.archivedSpaces ?? [];

      // 1. Optimistically merge archived spaces into local projects so the
      //    sidebar immediately hides the worktree space before loadProjects.
      if (archivedSpacesArr.length > 0) {
        setProjects((prev) => {
          const byKey = new Map<string, PiWebProjectSpaceRecord>();
          for (const s of archivedSpacesArr) {
            byKey.set(`${s.projectId}:${s.id}`, s);
          }
          return prev.map((project) => {
            let changed = false;
            const updatedSpaces = { ...project.spaces };
            for (const [, archivedSpace] of byKey) {
              if (archivedSpace.projectId === project.id && updatedSpaces[archivedSpace.id]) {
                updatedSpaces[archivedSpace.id] = archivedSpace;
                changed = true;
              }
            }
            return changed ? { ...project, spaces: updatedSpaces } : project;
          });
        });
      }

      // 2. Clean ephemeral worktrees and removed cwds.
      setEphemeralWorktrees((prev) => {
        const next = { ...prev };
        delete next[removedCwd];
        return next;
      });
      setRemovedWorktreeCwds((prev) => prev.includes(removedCwd) ? prev : [...prev, removedCwd]);

      // 3. Handle selected-space fallback when the current worktree space
      //    was archived/deleted. Prefer main space, then any active space
      //    within the same project, then the API fallbackCwd.
      if (selectedCwd === removedCwd) {
        const archivedSpace = archivedSpacesArr.find((s) => s.path === removedCwd);
        if (archivedSpace) {
          const project = projects.find((p) => p.id === archivedSpace.projectId);
          if (project) {
            const updatedProjectSpaces = { ...project.spaces };
            for (const s of archivedSpacesArr) {
              if (s.projectId === project.id) updatedProjectSpaces[s.id] = s;
            }
            const activeSpaces = Object.values(updatedProjectSpaces).filter((s) => !s.archived);
            const fallback = activeSpaces.find((s) => s.id === "main" && !s.missing) ?? activeSpaces.find((s) => !s.missing) ?? activeSpaces[0];
            if (fallback) {
              setSelectedProjectId(project.id);
              setSelectedSpaceId(fallback.id);
              setSelectedCwd(fallback.path);
            } else {
              setSelectedCwd(data.fallbackCwd ?? null);
            }
          } else {
            setSelectedCwd(data.fallbackCwd ?? null);
          }
        } else {
          setSelectedCwd(data.fallbackCwd ?? null);
        }
      }

      // 4. Refresh sessions for the (possibly new) current space.
      void loadSessions(false);

      // 5. Notify parent about deleted session files.
      for (const sessionId of data.deletedSessionIds ?? []) {
        onSessionDeleted?.(sessionId);
      }

      // 6. Background-refresh projects so the authoritative registry state
      //    eventually converges with the optimistic update above.
      void loadProjects(false);

      setWorktreeAction(null);
    } catch (e) {
      setWorktreeAction((prev) => prev ? { ...prev, busy: false, error: e instanceof Error ? e.message : String(e) } : prev);
    }
  }, [onSessionDeleted, worktreeAction, selectedCwd, projects, loadProjects, loadSessions]);

  const activeProjects = sortProjectsForSidebar(projects);
  const selectedProjectSpace = findProjectSpace(projects, selectedProjectId, selectedSpaceId);
  const selectedSpace = selectedProjectSpace?.space ?? null;
  const selectedWorktree = selectedSpace ? worktreeInfoFromSpace(selectedSpace) : undefined;
  const sessionGit = selectedCwd ? allSessions.find((s) => s.cwd === selectedCwd)?.git : undefined;
  const currentGit: GitInfo | undefined = sessionGit ?? selectedCwdGit ?? (selectedWorktree ? {
    isWorktree: true,
    branch: selectedWorktree.branch,
    repoRoot: selectedWorktree.repoRoot,
    mainWorktreePath: selectedWorktree.mainWorktreePath,
    mainWorktreeBranch: selectedWorktree.mainWorktreeBranch,
  } : undefined);
  const workspaceTitle = selectedProjectSpace ? displayProjectName(selectedProjectSpace.project) : formatWorkspaceHeaderTitle(selectedCwd, currentGit);
  const workspaceTitleDetail = selectedProjectSpace ? selectedProjectSpace.project.rootPath : formatWorkspaceTitle(selectedCwd, currentGit);
  const workspaceSubtitle = selectedSpace ? formatProjectSpaceSubtitle(selectedSpace, currentGit) : formatWorkspaceSubtitle(selectedCwd, currentGit);
  const workspaceSubtitleDetail = selectedSpace ? formatProjectSpaceDetail(selectedSpace, currentGit, homeDir) : workspaceSubtitle;
  const filteredSessions = allSessions.filter((session) => !removedWorktreeCwds.includes(session.cwd));
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
        {/* Project-space switch button */}
        <div style={{ position: "relative", marginBottom: 10 }}>
          <button
            onClick={() => setProjectSwitchOpen(true)}
            onContextMenu={(e) => {
              const worktree = selectedWorktree;
              if (!selectedCwd || !worktree) return;
              e.preventDefault();
              e.stopPropagation();
              setWorktreeContextMenu({ x: e.clientX, y: e.clientY, cwd: selectedCwd, worktree });
            }}
            style={{
              width: "100%",
              border: "1px solid var(--border)",
              background: selectedCwd ? "var(--bg)" : "var(--bg-hover)",
              borderRadius: 7,
              padding: "6px 10px",
              cursor: "pointer",
              textAlign: "left",
              display: "flex",
              alignItems: "center",
              gap: 10,
              color: "var(--text)",
              transition: "border-color 0.15s, background 0.15s",
            }}
            title={selectedProjectSpace
              ? `${workspaceTitleDetail}\n${workspaceSubtitleDetail}`
              : selectedCwd ?? undefined}
          >
            <span
              style={{
                width: 24,
                height: 24,
                borderRadius: 6,
                background: "var(--accent)",
                color: "#fff",
                display: "grid",
                placeItems: "center",
                flex: "0 0 auto",
                fontWeight: 700,
                fontSize: 13,
              }}
            >
              ⌘
            </span>
            <span style={{ minWidth: 0, flex: 1 }}>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  color: selectedCwd ? "var(--text)" : "var(--text-dim)",
                }}
              >
                {selectedProjectSpace ? workspaceTitle : (selectedCwd ? shortenCwd(selectedCwd, homeDir) : "切换项目空间")}
              </span>
              <span
                style={{
                  display: "block",
                  marginTop: 1,
                  fontSize: 10,
                  color: "var(--text-muted)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {selectedProjectSpace ? workspaceSubtitle : (selectedCwd ? shortenCwd(selectedCwd, homeDir) : "选择项目后即可在这里切换空间")}
              </span>
            </span>
            <WorktreeBadge worktree={selectedWorktree} />
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="var(--text-dim)"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ flexShrink: 0 }}
            >
              <polyline points="2 3.5 5 6.5 8 3.5" />
            </svg>
          </button>
        </div>
        <div className="session-sidebar-actions" style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            <button
              onClick={handleNewSession}
              disabled={!selectedCwd || !!selectedSpace?.missing}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                background: "var(--bg-hover)",
                border: "1px solid var(--border)",
                color: selectedCwd && !selectedSpace?.missing ? "var(--text-muted)" : "var(--text-dim)",
                cursor: selectedCwd && !selectedSpace?.missing ? "pointer" : "not-allowed",
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
              title={selectedSpace?.missing ? "该项目空间缺失，不能新建会话" : selectedCwd ? `在 ${selectedCwd} 新建会话` : "请先选择一个项目"}
              onMouseEnter={(e) => {
                if (!selectedCwd || selectedSpace?.missing) return;
                e.currentTarget.style.background = "var(--bg-selected)";
                e.currentTarget.style.color = "var(--accent)";
                e.currentTarget.style.borderColor = "rgba(37,99,235,0.35)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = selectedCwd && !selectedSpace?.missing ? "var(--text-muted)" : "var(--text-dim)";
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
              onClick={() => { void loadProjects(false); void loadSessions(false); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center",
                background: (sessionRefreshDone || projectsRefreshDone) ? "rgba(74,222,128,0.18)" : "var(--bg-hover)",
                border: `1px solid ${(sessionRefreshDone || projectsRefreshDone) ? "rgba(74,222,128,0.4)" : "var(--border)"}`,
                color: (sessionRefreshDone || projectsRefreshDone) ? "#4ade80" : "var(--text-muted)",
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
              {(sessionRefreshDone || projectsRefreshDone) ? (
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
                      minWidth: 190,
                      padding: "4px 0",
                      overflow: "hidden",
                    }}>
                      {selectedProjectSpace && (
                        <>
                          <WorkspaceMenuButton onClick={() => { setWorkspaceMenuOpen(false); setMetadataError(null); setMetadataEditTarget({ kind: "project", project: selectedProjectSpace.project }); }}>
                            编辑项目元数据…
                          </WorkspaceMenuButton>
                          <WorkspaceMenuButton onClick={() => { setWorkspaceMenuOpen(false); setMetadataError(null); setMetadataEditTarget({ kind: "space", project: selectedProjectSpace.project, space: selectedProjectSpace.space }); }}>
                            编辑空间元数据…
                          </WorkspaceMenuButton>
                          <WorkspaceMenuButton onClick={() => { setWorkspaceMenuOpen(false); void patchProjectMetadata(selectedProjectSpace.project.id, { pinned: !selectedProjectSpace.project.pinned }); }}>
                            {selectedProjectSpace.project.pinned ? "取消星标项目" : "星标项目"}
                          </WorkspaceMenuButton>
                          <WorkspaceMenuButton onClick={() => { setWorkspaceMenuOpen(false); void patchSpaceMetadata(selectedProjectSpace.project.id, selectedProjectSpace.space.id, { pinned: !selectedProjectSpace.space.pinned }); }}>
                            {selectedProjectSpace.space.pinned ? "取消星标空间" : "星标空间"}
                          </WorkspaceMenuButton>
                        </>
                      )}
                      <WorkspaceMenuButton onClick={() => { setWorkspaceMenuOpen(false); setArchiveAllConfirming(true); }}>
                        归档所有会话
                      </WorkspaceMenuButton>
                      {selectedProjectSpace && (
                        <>
                          <WorkspaceMenuButton danger onClick={() => { setWorkspaceMenuOpen(false); void patchSpaceMetadata(selectedProjectSpace.project.id, selectedProjectSpace.space.id, { archived: true }); }}>
                            归档当前空间
                          </WorkspaceMenuButton>
                          <WorkspaceMenuButton danger onClick={() => {
                            if (!window.confirm(`归档项目 “${displayProjectName(selectedProjectSpace.project)}”？项目会从侧边栏隐藏，sessions 不会被删除。`)) return;
                            setWorkspaceMenuOpen(false);
                            void patchProjectMetadata(selectedProjectSpace.project.id, { archived: true });
                          }}>
                            归档项目
                          </WorkspaceMenuButton>
                        </>
                      )}
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

        <ProjectSpaceSwitchDialog
          open={projectSwitchOpen}
          projects={projects}
          selectedProjectId={selectedProjectId}
          selectedSpaceId={selectedSpaceId}
          homeDir={homeDir}
          customPathValue={customPathValue}
          customPathError={customPathError}
          customPathValidating={customPathValidating}
          directoryPickerBusy={directoryPickerBusy}
          gitParentPathValue={gitParentPathValue}
          gitRemoteRepositoryValue={gitRemoteRepositoryValue}
          gitAddError={gitAddError}
          gitParentPickerBusy={gitParentPickerBusy}
          gitCloneBusy={gitCloneBusy}
          onCustomPathValueChange={setCustomPathValue}
          onGitParentPathValueChange={setGitParentPathValue}
          onGitRemoteRepositoryValueChange={setGitRemoteRepositoryValue}
          onUseDefaultDirectory={() => void handleDefaultCwd()}
          onPickProjectFolder={() => void handleDirectoryPicker()}
          onSubmitCustomPath={() => void commitCustomPath()}
          onPickGitParent={() => void handleGitParentDirectoryPicker()}
          onSubmitGitClone={() => void handleGitCloneSubmit()}
          onResetAddForms={resetAllAddForms}
          onSelectSpace={(project, space) => {
            setSelectedProjectId(project.id);
            setSelectedSpaceId(space.id);
            setSelectedCwd(space.path);
            setWorktreeError(null);
          }}
          onProjectContextMenu={handleDialogProjectContextMenu}
          onSpaceContextMenu={handleDialogSpaceContextMenu}
          onToggleProjectStar={(project) => void patchProjectMetadata(project.id, { pinned: !project.pinned })}
          onToggleSpaceStar={(project, space) => void patchSpaceMetadata(project.id, space.id, { pinned: !space.pinned })}
          onReorderProjects={handleReorderProjects}
          onReorderSpaces={handleReorderSpaces}
          onClose={() => setProjectSwitchOpen(false)}
        />
      </div>

      {metadataEditTarget && (
        <ProjectMetadataDialog
          target={metadataEditTarget}
          busy={metadataBusy}
          error={metadataError}
          onClose={() => {
            if (metadataBusy) return;
            setMetadataEditTarget(null);
            setMetadataError(null);
          }}
          onSave={(patch) => {
            if (metadataEditTarget.kind === "project") {
              void patchProjectMetadata(metadataEditTarget.project.id, patch);
            } else if (metadataEditTarget.space) {
              void patchSpaceMetadata(metadataEditTarget.project.id, metadataEditTarget.space.id, patch);
            }
          }}
        />
      )}

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

      {projectSpaceContextMenu && (() => {
        const { project, space } = projectSpaceContextMenu;
        const isProjectMenu = !space;
        const targetSpace = space ?? project.spaces.main;
        const canSwitch = targetSpace && !targetSpace.missing;
        const menuZIndex = 1250;

        const closeMenu = () => setProjectSpaceContextMenu(null);

        const handleSwitchSpace = () => {
          closeMenu();
          setSelectedProjectId(project.id);
          setSelectedSpaceId(targetSpace.id);
          setSelectedCwd(targetSpace.path);
          setProjectSwitchOpen(false);
          setWorktreeError(null);
        };

        const btnStyle: React.CSSProperties = {
          width: "100%",
          padding: "8px 10px",
          background: "none",
          border: "none",
          color: "var(--text)",
          textAlign: "left",
          cursor: "pointer",
          fontSize: 12,
          borderRadius: 6,
        };

        return (
          <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: projectSpaceContextMenu.x,
              top: projectSpaceContextMenu.y,
              zIndex: menuZIndex,
              minWidth: 190,
              padding: 4,
              borderRadius: 8,
              background: "var(--bg)",
              border: "1px solid var(--border)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
            }}
          >
            {isProjectMenu ? (
              <>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); handleSwitchSpace(); }}
                  style={{ ...btnStyle, color: targetSpace?.missing ? "var(--text-dim)" : "var(--text)", cursor: targetSpace?.missing ? "not-allowed" : "pointer" }}
                  disabled={!!targetSpace?.missing}
                >
                  切换到主空间
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); setMetadataError(null); setMetadataEditTarget({ kind: "project", project }); }}
                  style={btnStyle}
                >
                  编辑项目元数据…
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); void patchProjectMetadata(project.id, { pinned: !project.pinned }); }}
                  style={btnStyle}
                >
                  {project.pinned ? "取消星标项目" : "星标项目"}
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (!window.confirm(`归档项目 "${displayProjectName(project)}"？项目会从侧边栏隐藏，sessions 不会被删除。`)) return;
                    closeMenu();
                    void patchProjectMetadata(project.id, { archived: true });
                  }}
                  style={{ ...btnStyle, color: "#dc2626" }}
                >
                  归档项目
                </button>
              </>
            ) : (
              <>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); if (canSwitch) handleSwitchSpace(); }}
                  style={{ ...btnStyle, color: canSwitch ? "var(--text)" : "var(--text-dim)", cursor: canSwitch ? "pointer" : "not-allowed" }}
                >
                  切换到此空间
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); setMetadataError(null); setMetadataEditTarget({ kind: "space", project, space }); }}
                  style={btnStyle}
                >
                  编辑空间元数据…
                </button>
                <button
                  onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); void patchSpaceMetadata(project.id, space.id, { pinned: !space.pinned }); }}
                  style={btnStyle}
                >
                  {space.pinned ? "取消星标空间" : "星标空间"}
                </button>
                {space.kind === "worktree" ? (() => {
                  const wt = worktreeInfoFromSpace(space);
                  if (!wt) {
                    return (
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); void patchSpaceMetadata(project.id, space.id, { archived: true }); }}
                        style={btnStyle}
                      >
                        归档当前空间
                      </button>
                    );
                  }
                  return (
                    <>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); openWorktreeAction("archive", space.path, wt); }}
                        style={btnStyle}
                      >
                        归档 WorkTree…
                      </button>
                      <button
                        onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); openWorktreeAction("delete", space.path, wt); }}
                        style={{ ...btnStyle, color: "#dc2626" }}
                      >
                        删除 WorkTree…
                      </button>
                    </>
                  );
                })() : (
                  <button
                    onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); void patchSpaceMetadata(project.id, space.id, { archived: true }); }}
                    style={btnStyle}
                  >
                    归档当前空间
                  </button>
                )}
              </>
            )}
          </div>
        );
      })()}

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
      <div ref={sessionListRef} style={{ flex: "1 1 auto", overflowY: "auto", padding: "0", minHeight: MIN_SESSION_LIST_HEIGHT }}>
        {error && !sessionsSwitching && (
          <div style={{ padding: "12px 14px", color: "#f87171", fontSize: 12 }}>
            {error}
          </div>
        )}
        {sessionsSwitching && (
          <div style={{ padding: "4px 8px", pointerEvents: "none" }} aria-busy="true">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 6px", borderRadius: 8, marginBottom: 2 }}>
                <div style={{
                  width: 18, height: 18, borderRadius: 5, background: "var(--border)", flexShrink: 0,
                  animation: "pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s`,
                }} />
                <div style={{
                  flex: 1, height: 14, borderRadius: 4, background: "var(--border)",
                  animation: "pulse 1.5s ease-in-out infinite", animationDelay: `${i * 0.1}s`,
                }} />
              </div>
            ))}
          </div>
        )}
        {!sessionsSwitching && loading && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            Loading...
          </div>
        )}
        {!sessionsSwitching && !loading && !error && activeProjects.length === 0 && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
            No registered projects yet. Add a project path from the selector above to start.
          </div>
        )}
        {!sessionsSwitching && !loading && !error && activeProjects.length > 0 && filteredSessions.length === 0 && (!selectedCwd || (archivedCounts[selectedCwd] ?? 0) === 0) && (
          <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
            No sessions found in this space
          </div>
        )}
        {!sessionsSwitching && sessionTree.map((node) => (
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


    </div>
  );
}

function ProjectMetadataDialog({
  target,
  busy,
  error,
  onClose,
  onSave,
}: {
  target: MetadataEditTarget;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (patch: { displayName?: string; tags: string[]; pinned: boolean; archived: boolean }) => void;
}) {
  const record = target.kind === "project" ? target.project : target.space!;
  const title = target.kind === "project" ? "编辑项目元数据" : "编辑空间元数据";
  const [displayName, setDisplayName] = useState(record.displayName ?? "");
  const [tagsText, setTagsText] = useState(record.tags.join(", "));
  const [pinned, setPinned] = useState(record.pinned);
  const [archived, setArchived] = useState(record.archived);

  const tags = tagsText.split(",").map((tag) => tag.trim()).filter(Boolean);

  return (
    <div
      onMouseDown={(e) => e.stopPropagation()}
      style={{ position: "fixed", inset: 0, zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.28)", padding: 16 }}
    >
      <div style={{ width: "min(460px, 100%)", borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", boxShadow: "0 18px 50px rgba(0,0,0,0.25)", padding: 16 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 12, overflowWrap: "anywhere" }}>
          {target.kind === "project" ? target.project.rootPath : target.space?.path}
        </div>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          昵称/显示名
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={target.kind === "project" ? displayProjectName(target.project) : target.space ? displaySpaceName(target.space) : ""}
            style={{ marginTop: 5, width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
          />
        </label>
        <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Tags（逗号分隔）
          <input
            value={tagsText}
            onChange={(event) => setTagsText(event.target.value)}
            placeholder="frontend, pinned, client-a"
            style={{ marginTop: 5, width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none" }}
          />
        </label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          <Checkbox checked={pinned} label={target.kind === "project" ? "星标（仅用于标记，不影响项目排序）" : "星标（仅用于标记，不影响空间排序）"} onChange={(event) => setPinned(event.currentTarget.checked)} rootStyle={{ fontSize: 12 }} />
          <Checkbox checked={archived} label="归档（从活动侧边栏隐藏，不删除 sessions）" onChange={(event) => setArchived(event.currentTarget.checked)} rootStyle={{ fontSize: 12 }} />
        </div>
        {target.kind === "space" && target.space?.missing && (
          <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(245,158,11,0.10)", border: "1px solid rgba(245,158,11,0.25)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45, marginBottom: 10 }}>
            该空间路径缺失，不能新建会话；元数据仍可保存。
          </div>
        )}
        {error && (
          <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", color: "#dc2626", fontSize: 12, lineHeight: 1.4, overflowWrap: "anywhere", marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: busy ? "not-allowed" : "pointer", fontSize: 12 }}>
            取消
          </button>
          <button
            onClick={() => onSave({ displayName: displayName.trim(), tags, pinned, archived })}
            disabled={busy}
            style={{ padding: "7px 12px", borderRadius: 7, border: "none", background: "var(--accent)", color: "#fff", cursor: busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 800, opacity: busy ? 0.65 : 1 }}
          >
            {busy ? "保存中…" : "保存"}
          </button>
        </div>
      </div>
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
  const studioBadge = studioChildBadgeText(session);
  const studioDetail = studioChildDetailText(session);
  const titleTooltip = studioChildTitleTooltip(session, title);

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
        minWidth: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
        flexWrap: "nowrap",
      }}
    >
      {confirmDelete ? (
        /* ── Delete confirmation: same height, two flat buttons ── */
        <>
          <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Delete <span style={{ fontWeight: 600 }}>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
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
            flex: "1 1 auto",
            minWidth: 0,
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
          <div style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexWrap: "nowrap" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: isSelected ? 500 : 400,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text)",
                  flex: "1 1 auto",
                  minWidth: 0,
                }}
                title={titleTooltip}
              >
                {title}
              </div>
              <WorktreeBadge worktree={session.worktree} />
              {studioBadge && (
                <span title="YPI Studio child audit session" style={{ flexShrink: 0, maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", padding: "1px 5px", borderRadius: 999, background: "rgba(37,99,235,0.10)", border: "1px solid rgba(37,99,235,0.22)", color: "var(--accent)", fontSize: 9, fontWeight: 800 }}>
                  {studioBadge}
                </span>
              )}
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexWrap: "nowrap", color: "var(--text-dim)", fontSize: 11 }}>
              <span title={session.modified} style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatRelativeTime(session.modified)}</span>
              <span style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.messageCount} msgs</span>
              {session.legacyUnassigned && <span title="缺少 projectId/spaceId，按 cwd 匹配显示，不会自动回写" style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>未关联</span>}
              {studioDetail && <span title={studioDetail} style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{studioDetail}</span>}
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
            <div style={{ display: "flex", gap: 4, flexShrink: 0, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
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
        minWidth: 0,
        overflow: "hidden",
        whiteSpace: "nowrap",
        flexWrap: "nowrap",
      }}
    >
      {confirmDelete ? (
        <>
          <div style={{ flex: "1 1 auto", minWidth: 0, fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Delete <span style={{ fontWeight: 600 }}>&ldquo;{title.slice(0, 22)}{title.length > 22 ? "…" : ""}&rdquo;</span>?
          </div>
          <div style={{ display: "flex", gap: 5, flexShrink: 0, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
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
          <div style={{ flex: "1 1 auto", minWidth: 0, overflow: "hidden", fontStyle: "italic" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexWrap: "nowrap" }}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 400,
                  lineHeight: 1.4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "var(--text-dim)",
                  flex: "1 1 auto",
                  minWidth: 0,
                }}
                title={title}
              >
                {title}
              </div>
            </div>
            <div style={{ marginTop: 2, display: "flex", alignItems: "center", gap: 8, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", flexWrap: "nowrap", color: "var(--text-dim)", fontSize: 11 }}>
              <span title={session.modified} style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{formatRelativeTime(session.modified)}</span>
              <span style={{ flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.messageCount} msgs</span>
            </div>
          </div>
          {hovered && (
            <div style={{ display: "flex", gap: 4, flexShrink: 0, minWidth: 0, overflow: "hidden", whiteSpace: "nowrap" }}>
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
