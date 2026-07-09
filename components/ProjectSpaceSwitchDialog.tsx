"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { PiWebProjectRecord, PiWebProjectSpaceRecord } from "@/lib/project-registry-types";
import type { GitInfo } from "@/lib/types";
import { displayProjectName, displaySpaceName, activeProjectSpaces, sortProjectsForSidebar, worktreeInfoFromSpace, shortenCwd } from "@/lib/project-display";

export interface ProjectSpaceSwitchDialogProps {
  open: boolean;
  projects: PiWebProjectRecord[];
  selectedProjectId: string | null;
  selectedSpaceId: string | null;
  homeDir?: string;

  // Add-project form state
  customPathValue: string;
  customPathError: string | null;
  customPathValidating: boolean;
  directoryPickerBusy: boolean;
  gitParentPathValue: string;
  gitRemoteRepositoryValue: string;
  gitAddError: string | null;
  gitParentPickerBusy: boolean;
  gitCloneBusy: boolean;

  // Form mutation callbacks
  onCustomPathValueChange(value: string): void;
  onGitParentPathValueChange(value: string): void;
  onGitRemoteRepositoryValueChange(value: string): void;

  // Add-project actions
  onUseDefaultDirectory(): void;
  onPickProjectFolder(): void;
  onSubmitCustomPath(): void;
  onPickGitParent(): void;
  onSubmitGitClone(): void;
  onResetAddForms(): void;

  onSelectSpace(project: PiWebProjectRecord, space: PiWebProjectSpaceRecord): void;
  onProjectContextMenu?(event: React.MouseEvent, project: PiWebProjectRecord): void;
  onSpaceContextMenu?(event: React.MouseEvent, project: PiWebProjectRecord, space: PiWebProjectSpaceRecord): void;
  onToggleProjectStar?(project: PiWebProjectRecord): void;
  onToggleSpaceStar?(project: PiWebProjectRecord, space: PiWebProjectSpaceRecord): void;
  onReorderProjects?(orderedProjectIds: string[]): void;
  onReorderSpaces?(projectId: string, orderedSpaceIds: string[]): void;
  onClose(): void;
}

function formatWorktreeTooltip(worktree: ReturnType<typeof worktreeInfoFromSpace>): string {
  if (!worktree) return "";
  const branch = worktree.branch || "未知分支";
  const base = worktree.baseRef || "未知";
  return `WorkTree：${branch} / 基准：${base}`;
}

function WorktreeBadge({ worktree }: { worktree?: ReturnType<typeof worktreeInfoFromSpace> }) {
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

export function ProjectSpaceSwitchDialog({
  open,
  projects,
  selectedProjectId,
  selectedSpaceId,
  homeDir,
  customPathValue,
  customPathError,
  customPathValidating,
  directoryPickerBusy,
  gitParentPathValue,
  gitRemoteRepositoryValue,
  gitAddError,
  gitParentPickerBusy,
  gitCloneBusy,
  onCustomPathValueChange,
  onGitParentPathValueChange,
  onGitRemoteRepositoryValueChange,
  onUseDefaultDirectory,
  onPickProjectFolder,
  onSubmitCustomPath,
  onPickGitParent,
  onSubmitGitClone,
  onResetAddForms,
  onSelectSpace,
  onProjectContextMenu,
  onSpaceContextMenu,
  onToggleProjectStar,
  onToggleSpaceStar,
  onReorderProjects,
  onReorderSpaces,
  onClose,
}: ProjectSpaceSwitchDialogProps) {
  const [pendingProjectId, setPendingProjectId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [addFormKind, setAddFormKind] = useState<null | "path" | "git">(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [hoveredSpaceId, setHoveredSpaceId] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<Element | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const customPathInputRef = useRef<HTMLInputElement>(null);
  const gitParentPathInputRef = useRef<HTMLInputElement>(null);
  const gitRemoteRepositoryInputRef = useRef<HTMLInputElement>(null);

  // Compute aggregate busy state for close guard and add-form disabling
  const addBusy = directoryPickerBusy || customPathValidating || gitCloneBusy || gitParentPickerBusy;
  const cloneActive = gitCloneBusy;

  // When dialog opens, capture the previously-focused element for restore on close.
  useEffect(() => {
    if (!open) return;
    prevFocusRef.current = document.activeElement;
    return () => {
      // Restore focus to trigger element when dialog unmounts/closes.
      if (prevFocusRef.current instanceof HTMLElement) {
        prevFocusRef.current.focus();
      }
    };
  }, [open]);

  // When dialog opens, initialize pending project from the current selection or first available.
  // After open, keep the user's pending project stable across project metadata refreshes
  // (for example star/unstar) so the dialog does not jump back to the current workspace.
  useEffect(() => {
    if (!open) return;
    const sorted = sortProjectsForSidebar(projects);
    setPendingProjectId((current) => {
      if (current && sorted.some((p) => p.id === current)) return current;
      if (selectedProjectId && sorted.some((p) => p.id === selectedProjectId)) return selectedProjectId;
      return sorted[0]?.id ?? null;
    });
    setSearchQuery("");
    setAddFormKind(null);
    setHoveredProjectId(null);
    setHoveredSpaceId(null);
    // Focus appropriate element after open: search input when projects exist,
    // first onboarding button when empty registry.
    if (sorted.length === 0) {
      setTimeout(() => {
        dialogRef.current?.querySelector<HTMLElement>(
          '.project-switch-onboarding button:not([disabled])'
        )?.focus();
      }, 50);
    } else {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [open, projects, selectedProjectId]);

  // Reset drag state when the pending project changes or dialog closes
  useEffect(() => {
    setDragId(null);
    setDropTargetId(null);
  }, [pendingProjectId, open]);

  const handleDialogClose = useCallback(() => {
    if (cloneActive) return;
    setAddFormKind(null);
    onResetAddForms();
    onClose();
  }, [cloneActive, onResetAddForms, onClose]);

  // Keyboard: Escape close, Tab/Shift+Tab focus trap
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cloneActive) {
        handleDialogClose();
        return;
      }
      // Focus trap: keep Tab navigation within the dialog
      if (e.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, handleDialogClose, cloneActive]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !cloneActive) handleDialogClose();
  }, [handleDialogClose, cloneActive]);

  // Focus the appropriate input when a form opens
  useEffect(() => {
    if (addFormKind === "path") {
      setTimeout(() => customPathInputRef.current?.focus(), 50);
    } else if (addFormKind === "git") {
      setTimeout(() => gitParentPathInputRef.current?.focus(), 50);
    }
  }, [addFormKind]);

  // Toggle forms mutually exclusive
  const handleToggleAddForm = useCallback((kind: "path" | "git") => {
    setAddFormKind((prev) => (prev === kind ? null : kind));
  }, []);

  const sortedProjects = useMemo(() => sortProjectsForSidebar(projects), [projects]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return sortedProjects;
    return sortedProjects.filter((p) => {
      if (displayProjectName(p).toLowerCase().includes(q)) return true;
      if (p.rootPath.toLowerCase().includes(q)) return true;
      // Also match by space names/paths
      return activeProjectSpaces(p).some(
        (s) =>
          displaySpaceName(s).toLowerCase().includes(q) ||
          s.path.toLowerCase().includes(q) ||
          (s.worktree?.branch && s.worktree.branch.toLowerCase().includes(q))
      );
    });
  }, [sortedProjects, searchQuery]);

  const pendingProject = useMemo(
    () => projects.find((p) => p.id === pendingProjectId) ?? null,
    [projects, pendingProjectId]
  );

  const pendingSpaces = useMemo(() => {
    if (!pendingProject) return [];
    const spaces = activeProjectSpaces(pendingProject);
    const q = searchQuery.trim().toLowerCase();
    if (!q) return spaces;
    return spaces.filter(
      (s) =>
        displaySpaceName(s).toLowerCase().includes(q) ||
        s.path.toLowerCase().includes(q) ||
        (s.worktree?.branch && s.worktree.branch.toLowerCase().includes(q))
    );
  }, [pendingProject, searchQuery]);

  const [gitInfoByPath, setGitInfoByPath] = useState<Record<string, GitInfo | undefined>>({});

  // Drag-and-drop state for project sorting
  const [dragProjectId, setDragProjectId] = useState<string | null>(null);
  const [dropProjectId, setDropProjectId] = useState<string | null>(null);

  // Drag-and-drop state for non-main space sorting
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setDragProjectId(null);
      setDropProjectId(null);
      setDragId(null);
      setDropTargetId(null);
    }
  }, [open, searchQuery, pendingProjectId]);

  useEffect(() => {
    if (!open || !pendingProject) {
      setGitInfoByPath({});
      return;
    }
    const controller = new AbortController();
    const spaces = activeProjectSpaces(pendingProject);
    void Promise.all(
      spaces.map(async (space) => {
        try {
          const res = await fetch(`/api/git/info?cwd=${encodeURIComponent(space.path)}`, { signal: controller.signal });
          if (!res.ok) return [space.path, undefined] as const;
          const data = await res.json() as { git?: GitInfo };
          return [space.path, data.git] as const;
        } catch {
          return [space.path, undefined] as const;
        }
      })
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setGitInfoByPath(Object.fromEntries(entries));
    });
    return () => controller.abort();
  }, [open, pendingProject]);

  const handleSelectSpace = useCallback(
    (space: PiWebProjectSpaceRecord) => {
      if (space.missing || !pendingProject) return;
      onSelectSpace(pendingProject, space);
      handleDialogClose();
    },
    [pendingProject, onSelectSpace, handleDialogClose]
  );

  const projectDragEnabled = !searchQuery.trim();

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="切换项目空间"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.28)",
        padding: 16,
      }}
      onClick={handleBackdropClick}
    >
      <div
        ref={dialogRef}
        style={{
          width: "min(920px, calc(100vw - 24px))",
          maxHeight: "min(680px, calc(100vh - 48px))",
          borderRadius: 12,
          background: "var(--bg)",
          border: "1px solid var(--border)",
          boxShadow: "0 18px 50px rgba(0,0,0,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 18px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text)" }}>切换项目空间</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>
              项目列表来自 Project Registry，不扫描历史会话。选择项目空间后将立即切换当前工作区。
            </div>
          </div>
          <button
            onClick={handleDialogClose}
            disabled={cloneActive}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg-hover)",
              color: cloneActive ? "var(--text-dim)" : "var(--text-muted)",
              cursor: cloneActive ? "not-allowed" : "pointer",
              opacity: cloneActive ? 0.5 : 1,
              flexShrink: 0,
            }}
            title={cloneActive ? "Git clone 进行中，请等待完成" : "关闭 (Esc)"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body: two-pane layout */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: "grid",
            gridTemplateColumns: "minmax(280px, 320px) minmax(0, 1fr)",
          }}
          className="project-switch-dialog-body"
        >
          {/* Left pane: project list */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              borderRight: "1px solid var(--border)",
              background: "var(--bg-panel)",
            }}
          >
            {/* Search */}
            <div style={{ padding: "12px 12px 8px", flexShrink: 0 }}>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索项目或空间..."
                aria-label="搜索项目或空间"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  padding: "8px 10px",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  background: "var(--bg)",
                  color: "var(--text)",
                  fontSize: 12,
                  outline: "none",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
              />
            </div>

            {/* Add-project toolbar */}
            <div
              style={{
                display: "flex",
                gap: 6,
                padding: "0 12px 8px",
                flexShrink: 0,
                overflowX: "auto",
              }}
            >
              <button
                onClick={onPickProjectFolder}
                disabled={directoryPickerBusy || addBusy}
                title="选择本地文件夹作为项目目录"
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  color: directoryPickerBusy ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  cursor: directoryPickerBusy || addBusy ? "not-allowed" : "pointer",
                  opacity: directoryPickerBusy || addBusy ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                {directoryPickerBusy ? "选择中…" : "Add project folder…"}
              </button>
              <button
                onClick={() => handleToggleAddForm("path")}
                disabled={addBusy}
                title="手动输入项目路径注册"
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: addFormKind === "path" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: addFormKind === "path" ? "var(--bg-selected)" : "var(--bg)",
                  color: addFormKind === "path" ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  cursor: addBusy ? "not-allowed" : "pointer",
                  opacity: addBusy ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                Add path…
              </button>
              <button
                onClick={() => handleToggleAddForm("git")}
                disabled={addBusy}
                title="从远程 Git 仓库克隆项目"
                style={{
                  padding: "5px 8px",
                  borderRadius: 6,
                  border: addFormKind === "git" ? "1px solid var(--accent)" : "1px solid var(--border)",
                  background: addFormKind === "git" ? "var(--bg-selected)" : "var(--bg)",
                  color: addFormKind === "git" ? "var(--accent)" : "var(--text-muted)",
                  fontSize: 10,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  cursor: addBusy ? "not-allowed" : "pointer",
                  opacity: addBusy ? 0.6 : 1,
                  flexShrink: 0,
                }}
              >
                From Git…
              </button>
            </div>

            {/* Inline add-project forms (mutually exclusive) */}
            {addFormKind === "path" && (
              <div
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-subtle, var(--bg))",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
                  Add project path — 输入本地项目路径后点击注册
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "stretch", marginBottom: customPathError ? 6 : 0 }}>
                  <input
                    ref={customPathInputRef}
                    type="text"
                    value={customPathValue}
                    onChange={(e) => onCustomPathValueChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); onSubmitCustomPath(); }
                      if (e.key === "Escape") setAddFormKind(null);
                    }}
                    placeholder="/absolute/path/to/project"
                    disabled={customPathValidating}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={onSubmitCustomPath}
                    disabled={customPathValidating || !customPathValue.trim()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: customPathValidating || !customPathValue.trim() ? "var(--border)" : "var(--accent)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {customPathValidating ? "注册中…" : "注册"}
                  </button>
                </div>
                {customPathError && (
                  <div style={{
                    padding: "5px 8px",
                    borderRadius: 5,
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "#dc2626",
                    fontSize: 10,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                  }}>
                    {customPathError}
                  </div>
                )}
              </div>
            )}

            {addFormKind === "git" && (
              <div
                style={{
                  padding: "8px 12px",
                  borderBottom: "1px solid var(--border)",
                  background: "var(--bg-subtle, var(--bg))",
                  flexShrink: 0,
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
                  Add project from Git — 选择本地父目录，填入远程仓库地址后克隆
                </div>
                {/* Local parent path */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                    <input
                      ref={gitParentPathInputRef}
                      type="text"
                      value={gitParentPathValue}
                      onChange={(e) => onGitParentPathValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setAddFormKind(null);
                      }}
                      placeholder="Local parent path…"
                      disabled={gitCloneBusy}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: "6px 8px",
                        border: "1px solid var(--border)",
                        borderRadius: 6,
                        background: "var(--bg)",
                        color: "var(--text)",
                        fontSize: 11,
                        fontFamily: "var(--font-mono)",
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={onPickGitParent}
                      disabled={gitParentPickerBusy || gitCloneBusy}
                      style={{
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border)",
                        background: "var(--bg)",
                        color: gitParentPickerBusy ? "var(--accent)" : "var(--text-muted)",
                        fontSize: 11,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        cursor: gitParentPickerBusy || gitCloneBusy ? "not-allowed" : "pointer",
                        flexShrink: 0,
                      }}
                    >
                      {gitParentPickerBusy ? "选择中…" : "选择…"}
                    </button>
                  </div>
                </div>
                {/* Remote repository */}
                <div style={{ display: "flex", gap: 6, alignItems: "stretch", marginBottom: gitAddError ? 6 : 0 }}>
                  <input
                    ref={gitRemoteRepositoryInputRef}
                    type="text"
                    value={gitRemoteRepositoryValue}
                    onChange={(e) => onGitRemoteRepositoryValueChange(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); onSubmitGitClone(); }
                      if (e.key === "Escape") setAddFormKind(null);
                    }}
                    placeholder="Remote repository (https://... or git@...)"
                    disabled={gitCloneBusy}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 8px",
                      border: "1px solid var(--border)",
                      borderRadius: 6,
                      background: "var(--bg)",
                      color: "var(--text)",
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={onSubmitGitClone}
                    disabled={gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim()}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "none",
                      background: gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim() ? "var(--border)" : "var(--accent)",
                      color: "#fff",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      cursor: gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim() ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    {gitCloneBusy ? "克隆中…" : "Clone"}
                  </button>
                </div>
                {gitAddError && (
                  <div style={{
                    padding: "5px 8px",
                    borderRadius: 5,
                    background: "rgba(239,68,68,0.08)",
                    border: "1px solid rgba(239,68,68,0.2)",
                    color: "#dc2626",
                    fontSize: 10,
                    lineHeight: 1.35,
                    overflowWrap: "anywhere",
                    whiteSpace: "pre-wrap",
                  }}>
                    {gitAddError}
                  </div>
                )}
              </div>
            )}

            {/* Project list */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "4px 8px 8px",
              }}
            >
              {filteredProjects.length === 0 ? (
                <div style={{ padding: "20px 12px", color: "var(--text-dim)", fontSize: 11, textAlign: "center" }}>
                  {searchQuery ? "无匹配的项目" : "暂无项目"}
                </div>
              ) : (
                filteredProjects.map((project) => {
                  const isActive = project.id === pendingProjectId;
                  const spaces = activeProjectSpaces(project);
                  const canDragProject = projectDragEnabled;
                  const isDraggingProject = dragProjectId === project.id;
                  const isProjectDropTarget = dropProjectId === project.id && dragProjectId !== project.id;

                  const handleProjectDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
                    if (!canDragProject) return;
                    e.dataTransfer.setData("text/plain", project.id);
                    e.dataTransfer.effectAllowed = "move";
                    setDragProjectId(project.id);
                  };

                  const handleProjectDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
                    if (!canDragProject) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (!dragProjectId || dragProjectId === project.id) return;
                    setDropProjectId(project.id);
                  };

                  const handleProjectDragLeave = () => {
                    if (dropProjectId === project.id) setDropProjectId(null);
                  };

                  const handleProjectDrop = (e: React.DragEvent<HTMLButtonElement>) => {
                    if (!canDragProject) return;
                    e.preventDefault();
                    const draggedId = e.dataTransfer.getData("text/plain");
                    if (!draggedId || draggedId === project.id) {
                      setDragProjectId(null);
                      setDropProjectId(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const dropBefore = e.clientY < rect.top + rect.height / 2;
                    const projectIds = sortedProjects.map((p) => p.id);
                    const draggedProjectId = draggedId as PiWebProjectRecord["id"];
                    const fromIndex = projectIds.indexOf(draggedProjectId);
                    if (fromIndex < 0) {
                      setDragProjectId(null);
                      setDropProjectId(null);
                      return;
                    }
                    const nextIds = [...projectIds];
                    nextIds.splice(fromIndex, 1);
                    let toIndex = nextIds.indexOf(project.id);
                    if (toIndex < 0) toIndex = nextIds.length;
                    if (!dropBefore) toIndex += 1;
                    nextIds.splice(toIndex, 0, draggedProjectId);
                    onReorderProjects?.(nextIds);
                    setDragProjectId(null);
                    setDropProjectId(null);
                  };

                  const handleProjectDragEnd = () => {
                    setDragProjectId(null);
                    setDropProjectId(null);
                  };

                  return (
                    <button
                      key={project.id}
                      draggable={canDragProject}
                      onClick={() => setPendingProjectId(project.id)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        onProjectContextMenu?.(event, project);
                      }}
                      onDragStart={handleProjectDragStart}
                      onDragOver={handleProjectDragOver}
                      onDragLeave={handleProjectDragLeave}
                      onDrop={handleProjectDrop}
                      onDragEnd={handleProjectDragEnd}
                      style={{
                        width: "100%",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                        padding: "10px",
                        marginBottom: 4,
                        borderRadius: 8,
                        border: isDraggingProject
                          ? "2px dashed var(--accent)"
                          : isProjectDropTarget
                            ? "1px solid var(--accent)"
                            : isActive
                              ? "1px solid rgba(37,99,235,0.2)"
                              : "1px solid transparent",
                        background: isDraggingProject
                          ? "rgba(37,99,235,0.05)"
                          : isProjectDropTarget
                            ? "rgba(37,99,235,0.06)"
                            : isActive ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)",
                        cursor: isDraggingProject ? "grabbing" : "pointer",
                        textAlign: "left",
                        transition: "background 0.15s, border-color 0.15s",
                        opacity: isDraggingProject ? 0.5 : 1,
                      }}
                      onMouseEnter={(e) => {
                        setHoveredProjectId(project.id);
                        if (!isActive && !isDraggingProject && !isProjectDropTarget) e.currentTarget.style.background = "var(--bg-hover)";
                      }}
                      onMouseLeave={(e) => {
                        setHoveredProjectId((current) => (current === project.id ? null : current));
                        if (!isActive && !isDraggingProject && !isProjectDropTarget) e.currentTarget.style.background = "transparent";
                      }}
                      title={projectDragEnabled ? `切换项目到: ${project.rootPath}（右键可打开菜单${canDragProject ? "，⋮⋮ 拖动排序" : ""}）` : `切换项目到: ${project.rootPath}（搜索中，清空搜索后可拖动排序）`}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                        {canDragProject && (
                          <span
                            style={{
                              flexShrink: 0,
                              cursor: "grab",
                              color: "var(--text-dim)",
                              fontSize: 14,
                              lineHeight: 1,
                              userSelect: "none",
                              letterSpacing: "-2px",
                              opacity: hoveredProjectId === project.id || isDraggingProject ? 1 : 0,
                            }}
                            title="拖动排序"
                          >
                            ⋮⋮
                          </span>
                        )}
                        <span
                          role="button"
                          aria-label={project.pinned ? "取消星标项目" : "星标项目"}
                          title={project.pinned ? "取消星标项目" : "星标项目"}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                          }}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            onToggleProjectStar?.(project);
                          }}
                          style={{
                            flexShrink: 0,
                            width: 20,
                            height: 20,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: project.pinned ? "#ca8a04" : "var(--text-dim)",
                            opacity: project.pinned || hoveredProjectId === project.id ? 1 : 0,
                            cursor: "pointer",
                            fontSize: 14,
                            lineHeight: 1,
                          }}
                        >
                          {project.pinned ? "★" : "☆"}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                          title={displayProjectName(project)}
                        >
                          {displayProjectName(project)}
                        </span>
                        <span
                          style={{
                            flexShrink: 0,
                            borderRadius: 999,
                            fontSize: 9,
                            fontWeight: 700,
                            padding: "1px 5px",
                            background: "var(--bg-hover)",
                            color: "var(--text-muted)",
                            border: "1px solid var(--border)",
                          }}
                        >
                          {spaces.length} space{spaces.length > 1 ? "s" : ""}
                        </span>
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--text-muted)",
                          fontFamily: "var(--font-mono)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          minWidth: 0,
                        }}
                        title={project.rootPath}
                      >
                        {shortenCwd(project.rootPath, homeDir)}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right pane: space list or empty/onboarding */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              background: "var(--bg)",
            }}
          >
            {sortedProjects.length === 0 ? (
              /* Empty registry onboarding (add-project forms come in FE-003) */
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  textAlign: "center",
                  padding: "32px 16px",
                  color: "var(--text-muted)",
                }}
              >
                <div style={{ fontSize: 28, marginBottom: 12, opacity: 0.8 }}>📁</div>
                <div style={{ fontSize: 14, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>
                  尚未注册工作项目
                </div>
                <div style={{ fontSize: 11, maxWidth: 320, lineHeight: 1.5, marginBottom: 16 }}>
                  Yolk Pi 不会主动扫描历史 session 合成项目。请添加第一个项目来开始使用。
                </div>
                {/* Empty registry onboarding buttons */}
                <div className="project-switch-onboarding" style={{ display: "flex", flexDirection: "column", gap: 8, width: "min(280px, 100%)" }}>
                  <button
                    onClick={onPickProjectFolder}
                    disabled={addBusy}
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--accent)",
                      background: "var(--accent)",
                      color: "#fff",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: addBusy ? "not-allowed" : "pointer",
                      opacity: addBusy ? 0.6 : 1,
                    }}
                  >
                    📁 Add project folder…
                  </button>
                  <button
                    onClick={() => handleToggleAddForm("path")}
                    disabled={addBusy}
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: addBusy ? "not-allowed" : "pointer",
                      opacity: addBusy ? 0.6 : 1,
                    }}
                  >
                    📝 Add project path…
                  </button>
                  <button
                    onClick={() => handleToggleAddForm("git")}
                    disabled={addBusy}
                    style={{
                      width: "100%",
                      padding: "9px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--bg)",
                      color: "var(--text-muted)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: addBusy ? "not-allowed" : "pointer",
                      opacity: addBusy ? 0.6 : 1,
                    }}
                  >
                    🔀 Add project from Git…
                  </button>
                  <button
                    onClick={onUseDefaultDirectory}
                    disabled={addBusy}
                    style={{
                      width: "100%",
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "transparent",
                      color: "var(--text-dim)",
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: addBusy ? "not-allowed" : "pointer",
                      opacity: addBusy ? 0.6 : 1,
                    }}
                  >
                    Use default directory
                  </button>
                </div>
                {/* Inline forms in empty state — rendered below onboarding */}
                {addFormKind && (
                  <div style={{ marginTop: 12, width: "min(340px, 100%)" }}>
                    {addFormKind === "path" && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
                          Add project path
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: customPathError ? 6 : 0 }}>
                          <input
                            ref={customPathInputRef}
                            type="text"
                            value={customPathValue}
                            onChange={(e) => onCustomPathValueChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); onSubmitCustomPath(); }
                              if (e.key === "Escape") setAddFormKind(null);
                            }}
                            placeholder="/absolute/path/to/project"
                            disabled={customPathValidating}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: "6px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={onSubmitCustomPath}
                            disabled={customPathValidating || !customPathValue.trim()}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 6,
                              border: "none",
                              background: customPathValidating || !customPathValue.trim() ? "var(--border)" : "var(--accent)",
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              cursor: customPathValidating || !customPathValue.trim() ? "not-allowed" : "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {customPathValidating ? "注册中…" : "注册"}
                          </button>
                        </div>
                        {customPathError && (
                          <div style={{
                            padding: "5px 8px",
                            borderRadius: 5,
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            color: "#dc2626",
                            fontSize: 10,
                            lineHeight: 1.35,
                            overflowWrap: "anywhere",
                          }}>
                            {customPathError}
                          </div>
                        )}
                      </div>
                    )}
                    {addFormKind === "git" && (
                      <div
                        style={{
                          padding: "10px 12px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--bg-panel)",
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6 }}>
                          Add project from Git
                        </div>
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ display: "flex", gap: 6 }}>
                            <input
                              ref={gitParentPathInputRef}
                              type="text"
                              value={gitParentPathValue}
                              onChange={(e) => onGitParentPathValueChange(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Escape") setAddFormKind(null); }}
                              placeholder="Local parent path…"
                              disabled={gitCloneBusy}
                              style={{
                                flex: 1,
                                minWidth: 0,
                                padding: "6px 8px",
                                border: "1px solid var(--border)",
                                borderRadius: 6,
                                background: "var(--bg)",
                                color: "var(--text)",
                                fontSize: 11,
                                fontFamily: "var(--font-mono)",
                                outline: "none",
                              }}
                            />
                            <button
                              onClick={onPickGitParent}
                              disabled={gitParentPickerBusy || gitCloneBusy}
                              style={{
                                padding: "6px 10px",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "var(--bg)",
                                color: gitParentPickerBusy ? "var(--accent)" : "var(--text-muted)",
                                fontSize: 11,
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                cursor: gitParentPickerBusy || gitCloneBusy ? "not-allowed" : "pointer",
                                flexShrink: 0,
                              }}
                            >
                              {gitParentPickerBusy ? "选择中…" : "选择…"}
                            </button>
                          </div>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: gitAddError ? 6 : 0 }}>
                          <input
                            ref={gitRemoteRepositoryInputRef}
                            type="text"
                            value={gitRemoteRepositoryValue}
                            onChange={(e) => onGitRemoteRepositoryValueChange(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") { e.preventDefault(); onSubmitGitClone(); }
                              if (e.key === "Escape") setAddFormKind(null);
                            }}
                            placeholder="Remote repository URL"
                            disabled={gitCloneBusy}
                            style={{
                              flex: 1,
                              minWidth: 0,
                              padding: "6px 8px",
                              border: "1px solid var(--border)",
                              borderRadius: 6,
                              background: "var(--bg)",
                              color: "var(--text)",
                              fontSize: 11,
                              fontFamily: "var(--font-mono)",
                              outline: "none",
                            }}
                          />
                          <button
                            onClick={onSubmitGitClone}
                            disabled={gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim()}
                            style={{
                              padding: "6px 12px",
                              borderRadius: 6,
                              border: "none",
                              background: gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim() ? "var(--border)" : "var(--accent)",
                              color: "#fff",
                              fontSize: 11,
                              fontWeight: 700,
                              whiteSpace: "nowrap",
                              cursor: gitCloneBusy || !gitParentPathValue.trim() || !gitRemoteRepositoryValue.trim() ? "not-allowed" : "pointer",
                              flexShrink: 0,
                            }}
                          >
                            {gitCloneBusy ? "克隆中…" : "Clone"}
                          </button>
                        </div>
                        {gitAddError && (
                          <div style={{
                            padding: "5px 8px",
                            borderRadius: 5,
                            background: "rgba(239,68,68,0.08)",
                            border: "1px solid rgba(239,68,68,0.2)",
                            color: "#dc2626",
                            fontSize: 10,
                            lineHeight: 1.35,
                            overflowWrap: "anywhere",
                            whiteSpace: "pre-wrap",
                          }}>
                            {gitAddError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : !pendingProject ? (
              <div
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--text-dim)",
                  fontSize: 13,
                }}
              >
                请从左侧选择一个项目
              </div>
            ) : (
              <>
                {/* Selected project header */}
                <div
                  style={{
                    padding: "12px 16px",
                    borderBottom: "1px solid var(--border)",
                    background: "var(--bg-subtle)",
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 800,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                    title={displayProjectName(pendingProject)}
                  >
                    {displayProjectName(pendingProject)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontFamily: "var(--font-mono)",
                      marginTop: 2,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                    title={pendingProject.rootPath}
                  >
                    {shortenCwd(pendingProject.rootPath, homeDir)}
                  </div>
                  <div style={{ marginTop: 4, fontSize: 10, color: "var(--text-dim)" }}>
                    点击可用空间立即切换分支/目录。⋮⋮ 拖动排序非主空间。右键任意空间打开菜单。缺失路径保持禁用。
                  </div>
                </div>

                {/* Space list */}
                <div
                  style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: 12,
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  {pendingSpaces.length === 0 ? (
                    <div
                      style={{
                        padding: 24,
                        textAlign: "center",
                        color: "var(--text-muted)",
                        fontSize: 12,
                      }}
                    >
                      {searchQuery ? "当前项目下无匹配空间" : "当前项目无可用空间"}
                    </div>
                  ) : (
                    pendingSpaces.map((space) => {
                      const isCurrent =
                        pendingProject.id === selectedProjectId && space.id === selectedSpaceId;
                      const isMissing = space.missing;
                      const worktree = worktreeInfoFromSpace(space);
                      const gitInfo = gitInfoByPath[space.path];
                      const isWorktree = space.kind === "worktree";
                      const isMain = space.id === "main";
                      const branchName = worktree?.branch || gitInfo?.branch;
                      const baseRef = worktree?.baseRef || worktree?.mainWorktreeBranch || gitInfo?.baseRef || gitInfo?.mainWorktreeBranch;
                      const canDrag = !isMain && !isMissing;
                      const isDragging = dragId === space.id;
                      const isDropTarget = dropTargetId === space.id && dragId !== space.id;

                      const metaParts: string[] = [];
                      if (branchName) {
                        metaParts.push(`分支: ${branchName}`);
                      } else if (!isWorktree) {
                        metaParts.push("分支: 未检测到");
                      }
                      if (isWorktree && baseRef) {
                        metaParts.push(`基准: ${baseRef}`);
                      }
                      metaParts.push(shortenCwd(space.path, homeDir));
                      const metaText = metaParts.join(" · ");

                      const handleDragStart = (e: React.DragEvent<HTMLButtonElement>) => {
                        if (!canDrag) return;
                        e.dataTransfer.setData("text/plain", space.id);
                        e.dataTransfer.effectAllowed = "move";
                        setDragId(space.id);
                      };

                      const handleDragOver = (e: React.DragEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (!dragId || dragId === space.id) return;
                        setDropTargetId(space.id);
                      };

                      const handleDragLeave = () => {
                        if (dropTargetId === space.id) {
                          setDropTargetId(null);
                        }
                      };

                      const handleDrop = (e: React.DragEvent<HTMLButtonElement>) => {
                        e.preventDefault();
                        const draggedId = e.dataTransfer.getData("text/plain");
                        if (!draggedId || draggedId === space.id) {
                          setDragId(null);
                          setDropTargetId(null);
                          return;
                        }
                        // Compute drop position from event (avoid stale closure on dropBefore state)
                        const rect = e.currentTarget.getBoundingClientRect();
                        const computedDropBefore = e.clientY < rect.top + rect.height / 2;
                        // Compute new order of non-main space ids
                        const nonMainIds = pendingSpaces
                          .filter((s) => s.id !== "main")
                          .map((s) => s.id);
                        const fromIndex = nonMainIds.indexOf(draggedId);
                        if (fromIndex < 0) {
                          setDragId(null);
                          setDropTargetId(null);
                          return;
                        }
                        const newIds = [...nonMainIds];
                        newIds.splice(fromIndex, 1);
                        // Target position after removing the dragged item
                        let toIndex = isMain ? 0 : newIds.indexOf(space.id);
                        if (toIndex < 0) toIndex = newIds.length;
                        if (!computedDropBefore && !isMain) toIndex += 1;
                        newIds.splice(toIndex, 0, draggedId);
                        onReorderSpaces?.(pendingProject!.id, newIds);
                        setDragId(null);
                        setDropTargetId(null);
                      };

                      const handleDragEnd = () => {
                        setDragId(null);
                        setDropTargetId(null);
                      };

                      return (
                        <button
                          key={space.id}
                          draggable={canDrag}
                          onClick={() => { if (!isMissing) handleSelectSpace(space); }}
                          onContextMenu={(event) => {
                            if (!pendingProject) return;
                            event.preventDefault();
                            event.stopPropagation();
                            onSpaceContextMenu?.(event, pendingProject, space);
                          }}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDragLeave={handleDragLeave}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          title={
                            isMissing
                              ? `路径不存在: ${space.path}（右键可打开菜单）`
                              : canDrag
                                ? `切换工作区到: ${space.path}（右键可打开菜单，⋮⋮ 拖动排序）`
                                : `切换工作区到: ${space.path}（右键可打开菜单）`
                          }
                          style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                            padding: "10px 12px",
                            borderRadius: 8,
                            border: isDragging
                              ? "2px dashed var(--accent)"
                              : isDropTarget
                                ? "1px solid var(--accent)"
                                : isCurrent
                                  ? "1px solid var(--accent)"
                                  : "1px solid var(--border)",
                            background: isDragging
                              ? "rgba(37,99,235,0.05)"
                              : isDropTarget
                                ? "rgba(37,99,235,0.06)"
                                : isCurrent
                                  ? "var(--bg-selected)"
                                  : "var(--bg)",
                            color: "var(--text)",
                            cursor: isDragging ? "grabbing" : isMissing ? "default" : "pointer",
                            textAlign: "left" as const,
                            opacity: isDragging ? 0.5 : isMissing ? 0.55 : 1,
                            transition: "border-color 0.15s, background 0.15s, opacity 0.15s",
                          }}
                          onMouseEnter={(e) => {
                            setHoveredSpaceId(space.id);
                            if (isMissing || isDragging) return;
                            if (!isCurrent && !isDropTarget) {
                              e.currentTarget.style.borderColor = "var(--accent)";
                              e.currentTarget.style.background = "var(--bg-subtle)";
                            }
                          }}
                          onMouseLeave={(e) => {
                            setHoveredSpaceId((current) => (current === space.id ? null : current));
                            if (isMissing || isDragging) return;
                            if (!isCurrent && !isDropTarget) {
                              e.currentTarget.style.borderColor = "var(--border)";
                              e.currentTarget.style.background = "var(--bg)";
                            }
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                            {canDrag && (
                              <span
                                style={{
                                  flexShrink: 0,
                                  cursor: "grab",
                                  color: "var(--text-dim)",
                                  fontSize: 14,
                                  lineHeight: 1,
                                  userSelect: "none",
                                  letterSpacing: "-2px",
                                }}
                                title="拖动排序"
                              >
                                ⋮⋮
                              </span>
                            )}
                            <span
                              role="button"
                              aria-label={space.pinned ? "取消星标空间" : "星标空间"}
                              title={space.pinned ? "取消星标空间" : "星标空间"}
                              onMouseDown={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                              }}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                if (!pendingProject) return;
                                onToggleSpaceStar?.(pendingProject, space);
                              }}
                              style={{
                                flexShrink: 0,
                                width: 20,
                                height: 20,
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                color: space.pinned ? "#ca8a04" : "var(--text-dim)",
                                opacity: space.pinned || hoveredSpaceId === space.id ? 1 : 0,
                                cursor: "pointer",
                                fontSize: 14,
                                lineHeight: 1,
                              }}
                            >
                              {space.pinned ? "★" : "☆"}
                            </span>
                            {isCurrent && (
                              <span style={{ color: "var(--accent)", fontWeight: 700, fontSize: 12, flexShrink: 0 }}>
                                ✓
                              </span>
                            )}
                            <span
                              style={{
                                flexShrink: 0,
                                display: "inline-flex",
                                alignItems: "center",
                                padding: "1px 5px",
                                borderRadius: 999,
                                fontSize: 9,
                                fontWeight: 700,
                                background: isWorktree
                                  ? "rgba(37,99,235,0.10)"
                                  : "var(--bg-panel)",
                                color: isWorktree ? "var(--accent)" : "var(--text-muted)",
                                border: isWorktree
                                  ? "1px solid rgba(37,99,235,0.22)"
                                  : "1px solid var(--border)",
                              }}
                            >
                              {isWorktree ? "WT" : "Main"}
                            </span>
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {displaySpaceName(space)}
                            </span>
                            {isMissing && (
                              <span
                                style={{
                                  flexShrink: 0,
                                  borderRadius: 999,
                                  fontSize: 9,
                                  fontWeight: 700,
                                  padding: "1px 5px",
                                  background: "rgba(220,38,38,0.08)",
                                  color: "var(--danger, #dc2626)",
                                  border: "1px solid rgba(220,38,38,0.2)",
                                }}
                              >
                                路径缺失
                              </span>
                            )}
                            {isWorktree && !isMissing && (
                              <WorktreeBadge worktree={worktree} />
                            )}
                          </div>
                          <div
                            style={{
                              fontSize: 10,
                              color: "var(--text-muted)",
                              fontFamily: "var(--font-mono)",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              minWidth: 0,
                            }}
                            title={metaText}
                          >
                            {metaText}
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 10,
            color: "var(--text-dim)",
            flexShrink: 0,
          }}
        >
          <span>
            <strong style={{ color: "var(--text-muted)" }}>提示：</strong>{" "}
            支持 <code>Esc</code> 键关闭。项目很多时左右区域独立滚动，搜索时保持分层结构。
          </span>
          <button
            onClick={onUseDefaultDirectory}
            disabled={addBusy}
            title="使用默认目录作为项目并注册"
            style={{
              padding: "5px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: addBusy ? "var(--text-dim)" : "var(--text-muted)",
              fontSize: 10,
              fontWeight: 700,
              whiteSpace: "nowrap",
              cursor: addBusy ? "not-allowed" : "pointer",
              opacity: addBusy ? 0.6 : 1,
            }}
          >
            Use default directory
          </button>
        </div>
      </div>

    </div>
  );
}
