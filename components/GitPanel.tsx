"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatusInfo, GitFileChange, GitGraphData, GitGraphCommit, GitCommitDetail, GitCommitChangedFile, GitFileActionTarget, GitCommitCreateResponse } from "@/lib/types";
import { CommitGraph } from "./CommitGraph";
import { SelectDropdown } from "./SelectDropdown";
import { GitCommitDiffModal } from "./GitCommitDiffModal";

interface Props {
  cwd: string | null;
  refreshKey: number;
  onDirtyChange?: (dirty: boolean) => void;
}

const gitStatusColors: Record<string, string> = {
  M: "#22c55e",
  A: "#22c55e",
  D: "#ef4444",
  R: "#22c55e",
  C: "#22c55e",
  T: "#f59e0b",
  U: "#f59e0b",
  "?": "#9ca3af",
};

const gitStatusLabels: Record<string, string> = {
  M: "modified",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
  "?": "untracked",
};

function fileActionKey(target: GitFileActionTarget): string {
  return `${target.oldFile ?? ""}\0${target.file}`;
}

function SmallActionButton({
  label,
  title,
  disabled,
  pending,
  onClick,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  pending?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || pending}
      title={title ?? label}
      aria-label={title ?? label}
      style={{
        flexShrink: 0,
        minWidth: 52,
        height: 22,
        padding: "0 7px",
        border: "1px solid var(--border)",
        borderRadius: 4,
        background: disabled || pending ? "var(--bg-hover)" : "var(--bg-panel)",
        color: disabled || pending ? "var(--text-dim)" : "var(--text)",
        cursor: disabled || pending ? "not-allowed" : "pointer",
        fontSize: 10,
        fontWeight: 600,
      }}
    >
      {pending ? "..." : label}
    </button>
  );
}

function FileChangeRow({
  change,
  actionLabel,
  actionTitle,
  onAction,
  disabled,
  pending,
}: {
  change: GitFileChange;
  actionLabel?: string;
  actionTitle?: string;
  onAction?: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
      <span style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: gitStatusColors[change.status] ?? "#9ca3af",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {change.oldFile ? `${change.oldFile} → ${change.file}` : change.file}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-dim)", marginLeft: "auto", flexShrink: 0 }}>
        {gitStatusLabels[change.status] ?? change.status}
      </span>
      {actionLabel && onAction && (
        <SmallActionButton label={actionLabel} title={actionTitle} disabled={disabled} pending={pending} onClick={onAction} />
      )}
    </div>
  );
}

function UntrackedFileRow({
  file,
  onTrack,
  disabled,
  pending,
}: {
  file: string;
  onTrack: () => void;
  disabled?: boolean;
  pending?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
      <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#9ca3af", flexShrink: 0 }} />
      <span style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
        {file}
      </span>
      <SmallActionButton label="Track" title={`Track ${file}`} disabled={disabled} pending={pending} onClick={onTrack} />
    </div>
  );
}

function CommitChangedFileRow({ file, onOpenDiff }: { file: GitCommitChangedFile; onOpenDiff: (file: GitCommitChangedFile) => void }) {
  return (
    <button
      type="button"
      onDoubleClick={() => onOpenDiff(file)}
      title="Double-click to open diff"
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: 7,
        padding: "3px 6px",
        border: "none",
        borderRadius: 4,
        background: "transparent",
        color: "var(--text)",
        cursor: "default",
        textAlign: "left",
      }}
      onMouseEnter={(event) => { event.currentTarget.style.background = "var(--bg-hover)"; }}
      onMouseLeave={(event) => { event.currentTarget.style.background = "transparent"; }}
    >
      <span style={{
        width: 18,
        flexShrink: 0,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 700,
        color: gitStatusColors[file.status] ?? "var(--text-dim)",
      }}>
        {file.status}
      </span>
      <span style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
        {file.oldFile ? `${file.oldFile} → ${file.file}` : file.file}
      </span>
      {file.binary ? (
        <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>binary</span>
      ) : (typeof file.additions === "number" || typeof file.deletions === "number") ? (
        <span style={{ display: "flex", gap: 4, fontSize: 10, fontFamily: "var(--font-mono)", flexShrink: 0 }}>
          {typeof file.additions === "number" && <span style={{ color: "#16a34a" }}>+{file.additions}</span>}
          {typeof file.deletions === "number" && <span style={{ color: "#dc2626" }}>-{file.deletions}</span>}
        </span>
      ) : null}
      <span style={{ fontSize: 9, color: "var(--text-dim)", flexShrink: 0 }}>
        {gitStatusLabels[file.status] ?? file.status}
      </span>
    </button>
  );
}

function formatRefLabel(ref: GitCommitDetail["refs"][number]): string {
  if (ref.type === "tag") return `tag:${ref.name}`;
  if (ref.type === "remote") return ref.name;
  if (ref.type === "head") return `HEAD:${ref.name}`;
  return ref.name;
}

type PendingAction = { type: "stage" | "unstage" | "commit" | "push"; key?: string } | null;

function CommitDetailPanel({
  detail,
  loading,
  error,
  onOpenDiff,
}: {
  detail: GitCommitDetail | null;
  loading: boolean;
  error: string | null;
  onOpenDiff: (file: GitCommitChangedFile) => void;
}) {
  if (loading) {
    return <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>Loading commit details...</div>;
  }
  if (error) {
    return <div style={{ padding: "8px 10px", fontSize: 11, color: "#ef4444", whiteSpace: "pre-wrap" }}>{error}</div>;
  }
  if (!detail) {
    return <div style={{ padding: "8px 10px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>Select a commit to inspect its files.</div>;
  }

  return (
    <div style={{ padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-subtle)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {detail.subject || "(no subject)"}
      </div>
      {detail.body && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "pre-wrap", marginBottom: 8, maxHeight: 96, overflow: "auto" }}>
          {detail.body}
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "4px 8px", fontSize: 10.5, color: "var(--text-muted)", marginBottom: 8 }}>
        <span style={{ color: "var(--text-dim)" }}>Hash</span>
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{detail.hash}</span>
        <span style={{ color: "var(--text-dim)" }}>Author</span>
        <span>{detail.author.name} &lt;{detail.author.email}&gt; · {detail.author.date}</span>
        <span style={{ color: "var(--text-dim)" }}>Committer</span>
        <span>{detail.committer.name} &lt;{detail.committer.email}&gt; · {detail.committer.date}</span>
        {detail.parents.length > 0 && (
          <>
            <span style={{ color: "var(--text-dim)" }}>Parents</span>
            <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{detail.parents.map((parent) => parent.slice(0, 8)).join(", ")}</span>
          </>
        )}
      </div>
      {detail.refs.length > 0 && (
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
          {detail.refs.map((ref) => (
            <span key={`${ref.type}-${ref.name}`} style={{ fontSize: 9, fontFamily: "var(--font-mono)", color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px", background: "var(--bg-panel)" }}>
              {formatRefLabel(ref)}
            </span>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 4 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          Changed Files <span style={{ fontWeight: 400, textTransform: "none" }}>({detail.files.length})</span>
        </div>
        <div style={{ fontSize: 9, color: "var(--text-dim)" }}>Double-click a file to open diff</div>
      </div>
      {detail.files.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 1, maxHeight: 190, overflow: "auto" }}>
          {detail.files.map((file) => (
            <CommitChangedFileRow key={`${file.status}-${file.oldFile ?? ""}-${file.file}`} file={file} onOpenDiff={onOpenDiff} />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>
          No first-parent file changes for this commit.
        </div>
      )}
    </div>
  );
}

export function GitPanel({ cwd, refreshKey, onDirtyChange }: Props) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [graphData, setGraphData] = useState<GitGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState("");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [gitActionError, setGitActionError] = useState<string | null>(null);
  const [gitActionSuccess, setGitActionSuccess] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [commitDetail, setCommitDetail] = useState<GitCommitDetail | null>(null);
  const [commitDetailLoading, setCommitDetailLoading] = useState(false);
  const [commitDetailError, setCommitDetailError] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<GitCommitChangedFile | null>(null);
  const fetchIdRef = useRef(0);
  const commitDetailFetchIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!cwd) return;
    const id = ++fetchIdRef.current;
    const graphParams = new URLSearchParams({ cwd, maxCount: "50" });
    if (selectedBranch) graphParams.set("branch", selectedBranch);
    setLoading(true);
    try {
      const [statusRes, graphRes] = await Promise.all([
        fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`),
        fetch(`/api/git/graph?${graphParams.toString()}`),
      ]);
      const statusData = await statusRes.json() as { status: GitStatusInfo | null; error?: string };
      const graphData_ = await graphRes.json() as { data: GitGraphData | null; error?: string };

      if (id !== fetchIdRef.current) return;

      if (!statusRes.ok) {
        setStatus(null);
        setGraphData(null);
        setLoaded(true);
        onDirtyChange?.(false);
        return;
      }

      setStatus(statusData.status);
      setGraphData(graphData_.data);
      setLoaded(true);
      onDirtyChange?.(statusData.status?.isDirty ?? false);
    } catch {
      if (id !== fetchIdRef.current) return;
      setStatus(null);
      setGraphData(null);
      setLoaded(true);
      onDirtyChange?.(false);
    } finally {
      if (id === fetchIdRef.current) setLoading(false);
    }
  }, [cwd, onDirtyChange, selectedBranch]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll, refreshKey]);

  useEffect(() => {
    setSelectedBranch("");
    setSwitchError(null);
    setSelectedCommitHash(null);
    setCommitDetail(null);
    setCommitDetailError(null);
    setDiffFile(null);
    setPendingAction(null);
    setGitActionError(null);
    setGitActionSuccess(null);
    setCommitMessage("");
  }, [cwd]);

  useEffect(() => {
    const branches = graphData?.branches ?? [];
    if (branches.length === 0) {
      setSelectedBranch("");
      return;
    }

    setSelectedBranch((current) => {
      if (current && branches.some((branch) => branch.name === current)) return current;
      const currentBranch = status?.branch
        ? branches.find((branch) => branch.name === status.branch)
        : branches.find((branch) => branch.isCurrent);
      return currentBranch?.name ?? branches[0]?.name ?? "";
    });
  }, [graphData?.branches, status?.branch]);

  useEffect(() => {
    const graphCommits = graphData?.commits ?? [];
    const fallbackCommits = status?.recentCommits ?? [];
    setSelectedCommitHash((current) => {
      if (graphCommits.length > 0) {
        if (current && graphCommits.some((commit) => commit.hash === current)) return current;
        return graphCommits[0]?.hash ?? null;
      }
      if (fallbackCommits.length > 0) {
        if (current && fallbackCommits.some((commit) => commit.hash === current)) return current;
        return fallbackCommits[0]?.hash ?? null;
      }
      return null;
    });
  }, [graphData?.commits, status?.recentCommits]);

  useEffect(() => {
    if (!cwd || !selectedCommitHash) {
      setCommitDetail(null);
      setCommitDetailError(null);
      setCommitDetailLoading(false);
      return;
    }

    const id = ++commitDetailFetchIdRef.current;
    setCommitDetailLoading(true);
    setCommitDetailError(null);
    const params = new URLSearchParams({ cwd, hash: selectedCommitHash });

    fetch(`/api/git/commit?${params.toString()}`)
      .then(async (res) => {
        const body = await res.json() as { detail?: GitCommitDetail | null; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body.detail ?? null;
      })
      .then((detail) => {
        if (id !== commitDetailFetchIdRef.current) return;
        setCommitDetail(detail);
      })
      .catch((error) => {
        if (id !== commitDetailFetchIdRef.current) return;
        setCommitDetail(null);
        setCommitDetailError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (id === commitDetailFetchIdRef.current) setCommitDetailLoading(false);
      });
  }, [cwd, selectedCommitHash]);

  const handleSelectCommit = useCallback((commit: GitGraphCommit) => {
    setSelectedCommitHash(commit.hash);
  }, []);

  const handleOpenDiff = useCallback((file: GitCommitChangedFile) => {
    setDiffFile(file);
  }, []);

  const handleSwitchBranch = useCallback(async () => {
    if (!cwd || !selectedBranch || status?.isDirty || switching || pendingAction) return;

    setSwitching(true);
    setSwitchError(null);
    try {
      const res = await fetch("/api/git/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, branch: selectedBranch }),
      });
      const body = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok || body.error) {
        throw new Error(body.error ?? `Switch failed with HTTP ${res.status}`);
      }
      await fetchAll();
    } catch (error) {
      setSwitchError(error instanceof Error ? error.message : String(error));
    } finally {
      setSwitching(false);
    }
  }, [cwd, fetchAll, pendingAction, selectedBranch, status?.isDirty, switching]);

  const postGitAction = useCallback(async <T,>(endpoint: string, body: unknown): Promise<T> => {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({})) as T & { error?: string };
    if (!res.ok || data.error) {
      throw new Error(data.error ?? `Git action failed with HTTP ${res.status}`);
    }
    return data;
  }, []);

  const runFileMutation = useCallback(async (
    type: "stage" | "unstage",
    files: GitFileActionTarget[],
    successMessage: string,
    key?: string,
  ) => {
    if (!cwd || pendingAction) return;
    setPendingAction({ type, key });
    setGitActionError(null);
    setGitActionSuccess(null);
    try {
      await postGitAction(type === "stage" ? "/api/git/stage" : "/api/git/unstage", { cwd, files });
      setGitActionSuccess(successMessage);
      await fetchAll();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }, [cwd, fetchAll, pendingAction, postGitAction]);

  const handleCommit = useCallback(async () => {
    if (!cwd || !status || pendingAction || status.isDetached || status.staged.length === 0 || !commitMessage.trim()) return;
    setPendingAction({ type: "commit" });
    setGitActionError(null);
    setGitActionSuccess(null);
    try {
      const result = await postGitAction<GitCommitCreateResponse>("/api/git/commit", { cwd, message: commitMessage });
      setCommitMessage("");
      setGitActionSuccess(`Committed ${result.shortHash}`);
      setSelectedCommitHash(result.hash);
      await fetchAll();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }, [commitMessage, cwd, fetchAll, pendingAction, postGitAction, status]);

  const handlePush = useCallback(async () => {
    if (!cwd || !status || pendingAction || status.isDetached || status.behind > 0) return;
    const publish = !status.upstream;
    if (publish) {
      const confirmed = window.confirm(`Publish branch "${status.branch}" to origin/${status.branch}?`);
      if (!confirmed) return;
    }

    setPendingAction({ type: "push" });
    setGitActionError(null);
    setGitActionSuccess(null);
    try {
      await postGitAction("/api/git/push", { cwd, setUpstream: publish });
      setGitActionSuccess(publish ? "Branch published" : "Push complete");
      await fetchAll();
    } catch (error) {
      setGitActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPendingAction(null);
    }
  }, [cwd, fetchAll, pendingAction, postGitAction, status]);

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 600,
    color: "var(--text-dim)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 4,
  };

  const emptyTextStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--text-dim)",
    fontStyle: "italic",
  };

  // Not a git repo
  if (loaded && status === null && !loading) {
    return (
      <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        Not a Git repository
      </div>
    );
  }

  // Loading (not yet loaded)
  if (!loaded && loading) {
    return (
      <div style={{ padding: "10px 16px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        Loading...
      </div>
    );
  }

  if (!status) return null;

  const branchOptions = graphData?.branches ?? [];
  const previewBranch = selectedBranch || status.branch;
  const selectedIsCurrent = selectedBranch === status.branch || branchOptions.some((branch) => branch.name === selectedBranch && branch.isCurrent);
  const mutationPending = Boolean(pendingAction);
  const canSwitchBranch = Boolean(selectedBranch) && branchOptions.length > 0 && !loading && !switching && !mutationPending && !status.isDirty && !selectedIsCurrent;
  const switchDisabledReason = status.isDirty
    ? "Commit, stash, or discard local changes before switching branches."
    : branchOptions.length === 0
      ? "Branch list is unavailable."
      : selectedIsCurrent
        ? "Select a different local branch to switch."
        : null;
  const pushLabel = status.upstream ? "Push" : "Publish branch";
  const pushDisabledReason = status.isDetached
    ? "Detached HEAD cannot be pushed. Switch to a local branch first."
    : status.behind > 0
      ? "Branch is behind upstream. Pull or rebase before pushing."
      : status.upstream && status.ahead === 0
        ? "Nothing to push."
        : !status.branch
          ? "No local branch is checked out."
          : null;
  const canPush = !loading && !mutationPending && !pushDisabledReason;

  return (
    <div className="git-panel-root" style={{ maxHeight: "min(720px, 75vh)", overflowY: "auto" }}>
      {/* Refresh button */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "flex-end", padding: "4px 8px", background: "var(--bg-panel)" }}>
        <button
          onClick={() => void fetchAll()}
          disabled={loading || mutationPending}
          title="Refresh git status and selected branch graph"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, padding: 0,
            background: "none", border: "none",
            borderRadius: 4, color: "var(--text-muted)", cursor: "pointer",
            fontSize: 11,
            opacity: loading || mutationPending ? 0.5 : 1,
            transition: "background 0.12s, color 0.12s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "none"; e.currentTarget.style.color = "var(--text-muted)"; }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={loading ? { animation: "spin 0.8s linear infinite" } : undefined}>
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>
      </div>

      {(gitActionError || gitActionSuccess) && (
        <div style={{ padding: "0 16px 8px 16px" }}>
          <div style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: `1px solid ${gitActionError ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)"}`,
            background: gitActionError ? "rgba(239,68,68,0.08)" : "rgba(34,197,94,0.08)",
            color: gitActionError ? "#ef4444" : "#22c55e",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}>
            {gitActionError ?? gitActionSuccess}
          </div>
        </div>
      )}

      {/* Branch Status */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={sectionTitleStyle}>Branch</div>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
          padding: "6px 10px", background: "var(--bg-hover)", borderRadius: 6,
        }}>
          {/* Branch name */}
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", fontFamily: "var(--font-mono)" }}>
            {status.isDetached ? "(detached)" : status.branch}
          </span>

          {/* Dirty indicator */}
          {status.isDirty && (
            <span style={{
              fontSize: 10, color: "#f59e0b", background: "rgba(245,158,11,0.12)",
              padding: "0 6px", borderRadius: 4, lineHeight: "18px",
              fontWeight: 500, whiteSpace: "nowrap",
            }}>
              dirty
            </span>
          )}

          {/* Worktree indicator */}
          {status.isWorktree && (
            <span style={{
              fontSize: 10, color: "#60a5fa", background: "rgba(96,165,250,0.12)",
              padding: "0 6px", borderRadius: 4, lineHeight: "18px",
              fontWeight: 500, whiteSpace: "nowrap",
            }}>
              worktree
            </span>
          )}

          {/* Upstream & ahead/behind */}
          {status.upstream && (
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
              {status.upstream}
              {(status.ahead > 0 || status.behind > 0) && (
                <span style={{ marginLeft: 4 }}>
                  {status.ahead > 0 && <span style={{ color: "#22c55e" }}>+{status.ahead}</span>}
                  {status.ahead > 0 && status.behind > 0 && <span> </span>}
                  {status.behind > 0 && <span style={{ color: "#ef4444" }}>-{status.behind}</span>}
                </span>
              )}
            </span>
          )}

          <button
            type="button"
            onClick={() => void handlePush()}
            disabled={!canPush}
            title={pushDisabledReason ?? (status.upstream ? `Push ${status.branch}` : `Publish ${status.branch} to origin/${status.branch}`)}
            style={{
              marginLeft: "auto",
              height: 24,
              padding: "0 9px",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: canPush ? "var(--accent)" : "var(--bg-panel)",
              color: canPush ? "white" : "var(--text-dim)",
              cursor: canPush ? "pointer" : "not-allowed",
              fontSize: 10,
              fontWeight: 700,
              opacity: pendingAction?.type === "push" ? 0.7 : 1,
            }}
          >
            {pendingAction?.type === "push" ? "Pushing..." : pushLabel}
          </button>
        </div>

        <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6 }}>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 6 }}>
            Preview / switch local branch
          </div>
          <div className="git-branch-switch-row" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <SelectDropdown
                value={selectedBranch}
                options={branchOptions.length === 0
                  ? [{ value: "", label: "No local branches", disabled: true }]
                  : branchOptions.map((branch) => ({ value: branch.name, label: branch.name, meta: branch.isCurrent ? "current" : undefined }))}
                onChange={(branch) => {
                  setSelectedBranch(branch);
                  setSwitchError(null);
                }}
                disabled={loading || switching || mutationPending || branchOptions.length === 0}
                ariaLabel="Select local Git branch"
                size="field"
                minWidth={220}
              />
            </div>
            <button
              type="button"
              onClick={() => void handleSwitchBranch()}
              disabled={!canSwitchBranch}
              title={switchDisabledReason ?? `Switch to ${selectedBranch}`}
              style={{
                height: 28,
                padding: "0 10px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: canSwitchBranch ? "var(--accent)" : "var(--bg-hover)",
                color: canSwitchBranch ? "white" : "var(--text-dim)",
                cursor: canSwitchBranch ? "pointer" : "not-allowed",
                fontSize: 11,
                fontWeight: 600,
                opacity: switching ? 0.7 : 1,
              }}
            >
              {switching ? "Switching..." : "Switch"}
            </button>
          </div>
          <div style={{ marginTop: 5, fontSize: 10, color: "var(--text-dim)" }}>
            Selecting a branch previews its commit graph. Switch changes the checkout.
          </div>
          {switchDisabledReason && (
            <div style={{ marginTop: 5, fontSize: 10, color: status.isDirty ? "#f59e0b" : "var(--text-dim)" }}>
              {switchDisabledReason}
            </div>
          )}
          {switchError && (
            <div style={{ marginTop: 5, fontSize: 10, color: "#ef4444", whiteSpace: "pre-wrap" }}>
              {switchError}
            </div>
          )}
        </div>
      </div>

      {/* Commit graph and selected commit detail */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(360px, 1.15fr) minmax(280px, 0.85fr)", gap: 12, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ ...sectionTitleStyle, marginBottom: 6 }}>
              Commit Graph
              {previewBranch && (
                <span style={{ marginLeft: 6, fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>
                  preview: {previewBranch}
                </span>
              )}
            </div>
            <div style={{ maxHeight: "min(420px, 48vh)", overflow: "auto", paddingRight: 4 }}>
              {graphData && graphData.commits && graphData.commits.length > 0 ? (
                <CommitGraph
                  commits={graphData.commits}
                  currentBranch={previewBranch}
                  maxDisplay={30}
                  selectedHash={selectedCommitHash}
                  onSelectCommit={handleSelectCommit}
                />
              ) : status.recentCommits.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {status.recentCommits.map((commit) => (
                    <button key={commit.hash} type="button" onClick={() => setSelectedCommitHash(commit.hash)} style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "3px 6px", borderRadius: 4,
                      border: "none",
                      background: selectedCommitHash === commit.hash ? "var(--bg-selected)" : "transparent",
                      fontSize: 11, color: "var(--text-muted)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}>
                      <span style={{
                        fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-dim)",
                        flexShrink: 0, width: 44,
                      }}>
                        {commit.hash.slice(0, 7)}
                      </span>
                      <span style={{
                        flex: 1, overflow: "hidden", textOverflow: "ellipsis",
                        whiteSpace: "nowrap", color: "var(--text)",
                      }}>
                        {commit.message}
                      </span>
                      <span style={{
                        flexShrink: 0, fontSize: 10, color: "var(--text-dim)",
                        whiteSpace: "nowrap",
                      }}>
                        {commit.relativeDate}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div style={emptyTextStyle}>No commits</div>
              )}
            </div>
          </div>

          <div style={{ minWidth: 0 }}>
            <div style={sectionTitleStyle}>Commit Details</div>
            <CommitDetailPanel
              detail={commitDetail}
              loading={commitDetailLoading}
              error={commitDetailError}
              onOpenDiff={handleOpenDiff}
            />
          </div>
        </div>
      </div>

      {/* Staged Changes */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Staged Changes <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.staged.length})</span></div>
          <SmallActionButton
            label="Unstage all"
            title="Unstage all staged changes"
            disabled={mutationPending || status.staged.length === 0}
            pending={pendingAction?.type === "unstage" && pendingAction.key === "all-staged"}
            onClick={() => void runFileMutation("unstage", status.staged, "Unstaged all staged changes", "all-staged")}
          />
        </div>
        {status.staged.length > 0 ? (
          <div>
            {status.staged.map((change, i) => {
              const key = fileActionKey(change);
              return (
                <FileChangeRow
                  key={`staged-${i}`}
                  change={change}
                  actionLabel="Unstage"
                  actionTitle={`Unstage ${change.file}`}
                  disabled={mutationPending}
                  pending={pendingAction?.type === "unstage" && pendingAction.key === key}
                  onAction={() => void runFileMutation("unstage", [change], `Unstaged ${change.file}`, key)}
                />
              );
            })}
          </div>
        ) : (
          <div style={emptyTextStyle}>No staged changes</div>
        )}
        <div style={{ marginTop: 8, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-subtle)" }}>
          <textarea
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Commit message"
            disabled={mutationPending}
            aria-label="Commit message"
            style={{
              width: "100%",
              minHeight: 58,
              resize: "vertical",
              border: "1px solid var(--border)",
              borderRadius: 4,
              padding: "6px 8px",
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 11,
              outline: "none",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-dim)" }}>Only staged changes will be committed.</span>
            <button
              type="button"
              onClick={() => void handleCommit()}
              disabled={mutationPending || status.isDetached || status.staged.length === 0 || !commitMessage.trim()}
              title={status.isDetached ? "Detached HEAD cannot be committed. Switch to a local branch first." : status.staged.length === 0 ? "Stage changes before committing" : "Commit staged changes"}
              style={{
                height: 26,
                padding: "0 10px",
                border: "1px solid var(--border)",
                borderRadius: 4,
                background: !mutationPending && !status.isDetached && status.staged.length > 0 && commitMessage.trim() ? "var(--accent)" : "var(--bg-hover)",
                color: !mutationPending && !status.isDetached && status.staged.length > 0 && commitMessage.trim() ? "white" : "var(--text-dim)",
                cursor: !mutationPending && !status.isDetached && status.staged.length > 0 && commitMessage.trim() ? "pointer" : "not-allowed",
                fontSize: 11,
                fontWeight: 700,
              }}
            >
              {pendingAction?.type === "commit" ? "Committing..." : "Commit staged changes"}
            </button>
          </div>
        </div>
      </div>

      {/* Unstaged Changes */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Unstaged Changes <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.unstaged.length})</span></div>
          <SmallActionButton
            label="Stage all"
            title="Stage all tracked unstaged changes"
            disabled={mutationPending || status.unstaged.length === 0}
            pending={pendingAction?.type === "stage" && pendingAction.key === "all-unstaged"}
            onClick={() => void runFileMutation("stage", status.unstaged, "Staged all unstaged changes", "all-unstaged")}
          />
        </div>
        {status.unstaged.length > 0 ? (
          <div>
            {status.unstaged.map((change, i) => {
              const key = fileActionKey(change);
              return (
                <FileChangeRow
                  key={`unstaged-${i}`}
                  change={change}
                  actionLabel="Stage"
                  actionTitle={`Stage ${change.file}`}
                  disabled={mutationPending}
                  pending={pendingAction?.type === "stage" && pendingAction.key === key}
                  onAction={() => void runFileMutation("stage", [change], `Staged ${change.file}`, key)}
                />
              );
            })}
          </div>
        ) : (
          <div style={emptyTextStyle}>No unstaged changes</div>
        )}
      </div>

      {/* Untracked Files */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          <div style={{ ...sectionTitleStyle, marginBottom: 0 }}>Untracked Files <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.untracked.length})</span></div>
          <SmallActionButton
            label="Track all"
            title="Track all untracked files"
            disabled={mutationPending || status.untracked.length === 0}
            pending={pendingAction?.type === "stage" && pendingAction.key === "all-untracked"}
            onClick={() => void runFileMutation("stage", status.untracked.map((file) => ({ file })), "Tracked all untracked files", "all-untracked")}
          />
        </div>
        {status.untracked.length > 0 ? (
          <div>
            {status.untracked.map((file, i) => (
              <UntrackedFileRow
                key={`untracked-${i}`}
                file={file}
                disabled={mutationPending}
                pending={pendingAction?.type === "stage" && pendingAction.key === fileActionKey({ file })}
                onTrack={() => void runFileMutation("stage", [{ file }], `Tracked ${file}`, fileActionKey({ file }))}
              />
            ))}
          </div>
        ) : (
          <div style={emptyTextStyle}>No untracked files</div>
        )}
      </div>

      {/* Stash */}
      <div style={{ padding: "0 16px 12px 16px" }}>
        <div style={sectionTitleStyle}>Stash</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {status.stashCount > 0
            ? <span>{status.stashCount} stash {status.stashCount === 1 ? "entry" : "entries"}</span>
            : <span style={emptyTextStyle}>No stash entries</span>
          }
        </div>
      </div>

      {diffFile && cwd && selectedCommitHash && (
        <GitCommitDiffModal
          cwd={cwd}
          hash={selectedCommitHash}
          shortHash={commitDetail?.shortHash}
          file={diffFile}
          onClose={() => setDiffFile(null)}
        />
      )}
    </div>
  );
}
