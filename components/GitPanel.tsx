"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { GitStatusInfo, GitFileChange, GitGraphData } from "@/lib/types";
import { CommitGraph } from "./CommitGraph";

interface Props {
  cwd: string | null;
  refreshKey: number;
  onDirtyChange?: (dirty: boolean) => void;
}

function FileChangeRow({ change }: { change: GitFileChange }) {
  const statusColors: Record<string, string> = {
    M: "#22c55e",
    A: "#22c55e",
    D: "#ef4444",
    R: "#22c55e",
    C: "#22c55e",
    U: "#f59e0b",
    "?": "#9ca3af",
  };

  const statusLabels: Record<string, string> = {
    M: "modified",
    A: "added",
    D: "deleted",
    R: "renamed",
    C: "copied",
    U: "unmerged",
    "?": "untracked",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
      <span style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: statusColors[change.status] ?? "#9ca3af",
        flexShrink: 0,
      }} />
      <span style={{ fontSize: 11, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {change.oldFile ? `${change.oldFile} → ${change.file}` : change.file}
      </span>
      <span style={{ fontSize: 9, color: "var(--text-dim)", marginLeft: "auto", flexShrink: 0 }}>
        {statusLabels[change.status] ?? change.status}
      </span>
    </div>
  );
}

export function GitPanel({ cwd, refreshKey, onDirtyChange }: Props) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [graphData, setGraphData] = useState<GitGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchAll = useCallback(async () => {
    if (!cwd) return;
    const id = ++fetchIdRef.current;
    setLoading(true);
    try {
      const [statusRes, graphRes] = await Promise.all([
        fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`),
        fetch(`/api/git/graph?cwd=${encodeURIComponent(cwd)}&maxCount=50`),
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
  }, [cwd, onDirtyChange]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll, refreshKey]);

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

  return (
    <div style={{ maxHeight: "min(500px, 60vh)", overflowY: "auto" }}>
      {/* Refresh button */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", justifyContent: "flex-end", padding: "4px 8px", background: "var(--bg-panel)" }}>
        <button
          onClick={() => void fetchAll()}
          disabled={loading}
          title="Refresh git status"
          style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            width: 24, height: 24, padding: 0,
            background: "none", border: "none",
            borderRadius: 4, color: "var(--text-muted)", cursor: "pointer",
            fontSize: 11,
            opacity: loading ? 0.5 : 1,
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
        </div>
      </div>

      {/* Commit Graph — replaces flat Recent Commits */}
      <div style={{ padding: "0 8px 8px 8px" }}>
        <div style={{ ...sectionTitleStyle, padding: "0 8px", marginBottom: 6 }}>Commit Graph</div>
        {graphData && graphData.commits && graphData.commits.length > 0 ? (
          <CommitGraph
            commits={graphData.commits}
            currentBranch={status.branch}
            maxDisplay={30}
          />
        ) : status.recentCommits.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 8px" }}>
            {status.recentCommits.map((commit) => (
              <div key={commit.hash} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "3px 6px", borderRadius: 4,
                fontSize: 11, color: "var(--text-muted)",
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
              </div>
            ))}
          </div>
        ) : (
          <div style={{ ...emptyTextStyle, padding: "0 8px" }}>No commits</div>
        )}
      </div>

      {/* Staged Changes */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={sectionTitleStyle}>Staged Changes <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.staged.length})</span></div>
        {status.staged.length > 0 ? (
          <div>
            {status.staged.map((change, i) => (
              <FileChangeRow key={`staged-${i}`} change={change} />
            ))}
          </div>
        ) : (
          <div style={emptyTextStyle}>No staged changes</div>
        )}
      </div>

      {/* Unstaged Changes */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={sectionTitleStyle}>Unstaged Changes <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.unstaged.length})</span></div>
        {status.unstaged.length > 0 ? (
          <div>
            {status.unstaged.map((change, i) => (
              <FileChangeRow key={`unstaged-${i}`} change={change} />
            ))}
          </div>
        ) : (
          <div style={emptyTextStyle}>No unstaged changes</div>
        )}
      </div>

      {/* Untracked Files */}
      <div style={{ padding: "0 16px 8px 16px" }}>
        <div style={sectionTitleStyle}>Untracked Files <span style={{ fontWeight: 400, color: "var(--text-dim)", textTransform: "none" }}>({status.untracked.length})</span></div>
        {status.untracked.length > 0 ? (
          <div>
            {status.untracked.map((file, i) => (
              <div key={`untracked-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, padding: "1px 0" }}>
                <span style={{
                  display: "inline-block", width: 6, height: 6, borderRadius: "50%",
                  background: "#9ca3af", flexShrink: 0,
                }} />
                <span style={{ fontSize: 11, color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {file}
                </span>
              </div>
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
    </div>
  );
}
