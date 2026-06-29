"use client";

import { useState, useCallback } from "react";
import type { SubagentRun } from "@/hooks/useAgentSession";

interface Props {
  runs: SubagentRun[];
}

export function SubagentPanel({ runs }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [childrenCache, setChildrenCache] = useState<Record<string, SubagentRun[]>>({});

  const toggleExpand = useCallback(async (run: SubagentRun) => {
    const id = run.id;
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);

    // Lazy-load children if we have a sessionFile and haven't loaded yet
    if (run.sessionFile && !childrenCache[id]) {
      try {
        const res = await fetch(`/api/agent/subagent-children?sessionFile=${encodeURIComponent(run.sessionFile)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.children && data.children.length > 0) {
            setChildrenCache((prev) => ({ ...prev, [id]: data.children }));
          }
        }
      } catch {
        // Silently fail — children just won't show
      }
    }
  }, [expandedId, childrenCache]);

  const running = runs.filter((r) => r.status === "running");
  const completed = runs.filter((r) => r.status === "completed" || r.status === "failed");

  if (runs.length === 0) {
    return (
      <div style={{ padding: "16px 20px", fontSize: 12, color: "var(--text-muted)", fontStyle: "italic" }}>
        No subagent activity yet.
      </div>
    );
  }

  const renderRuns = (items: SubagentRun[], depth: number) => items.map((r) => (
    <RunItem
      key={r.id}
      run={r}
      isExpanded={expandedId === r.id}
      childrenRuns={childrenCache[r.id]}
      onToggle={() => toggleExpand(r)}
      depth={depth}
    />
  ));

  return (
    <div style={{
      maxHeight: "min(500px, 60vh)",
      overflowY: "auto",
      padding: "8px 0",
      fontSize: 12,
      color: "var(--text)",
    }}>
      {running.length > 0 && (
        <>
          <div style={{ padding: "6px 16px 4px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)" }}>
            Running ({running.length})
          </div>
          {renderRuns(running, 0)}
        </>
      )}
      {completed.length > 0 && (
        <>
          <div style={{ padding: "6px 16px 4px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-dim)", marginTop: running.length > 0 ? 8 : 0 }}>
            Completed ({completed.length})
          </div>
          {renderRuns(completed, 0)}
        </>
      )}
    </div>
  );
}

function RunItem({
  run, isExpanded, childrenRuns, onToggle, depth,
}: {
  run: SubagentRun;
  isExpanded: boolean;
  childrenRuns?: SubagentRun[];
  onToggle: () => void;
  depth: number;
}) {
  const indent = depth * 16;
  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const statusColor = isRunning ? "#f59e0b" : isFailed ? "#ef4444" : "#22c55e";
  const statusIcon = isRunning ? "○" : isFailed ? "✕" : "✓";
  const statusLabel = isRunning ? "Running" : isFailed ? "Failed" : "Done";

  const taskDisplay = run.task
    ? run.task.split("\n")[0].slice(0, 120)
    : "(no task)";

  const displayOutput = run.result ?? run.partialOutput;
  const routingLabel = formatRouting(run.routing);
  const hasSessionFile = !!run.sessionFile;
  const hasChildren = childrenRuns && childrenRuns.length > 0;

  return (
    <div>
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 16px 5px",
          paddingLeft: 16 + indent,
          cursor: "pointer",
          userSelect: "none",
          transition: "background 0.08s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
      >
        <span style={{ color: statusColor, width: 14, textAlign: "center", flexShrink: 0 }}>
          {statusIcon}
        </span>
        <span style={{ fontWeight: 600, color: "var(--text)", flexShrink: 0, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {run.agent}
        </span>
        <span style={{ color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {taskDisplay}
        </span>
        {routingLabel && (
          <span title={routingLabel} style={{ color: "var(--text-dim)", fontSize: 10, flexShrink: 0, maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {routingLabel}
          </span>
        )}
        {hasSessionFile && !hasChildren && isExpanded && (
          <span style={{ color: "var(--text-dim)", fontSize: 9, flexShrink: 0, fontStyle: "italic" }}>
            {childrenRuns === undefined ? "loading..." : "no children"}
          </span>
        )}
        <span style={{ color: statusColor, fontSize: 10, flexShrink: 0 }}>
          {statusLabel}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 10, flexShrink: 0, marginLeft: 4 }}>
          {isExpanded ? "▲" : "▼"}
        </span>
      </div>
      {isExpanded && (
        <div style={{
          padding: "2px 16px 8px",
          paddingLeft: 16 + indent + 22,
        }}>
          {/* Show children (nested subagents) first, then output */}
          {hasChildren && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: "var(--text-dim)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                Subagents ({childrenRuns!.length})
              </div>
              {childrenRuns!.map((child) => (
                <ChildRunItem key={child.id} run={child} depth={depth + 1} />
              ))}
            </div>
          )}
          {childrenRuns === undefined && hasSessionFile && (
            <div style={{ fontSize: 10, fontStyle: "italic", color: "var(--text-dim)", marginBottom: 4 }}>
              Loading nested subagents...
            </div>
          )}
          {/* Output */}
          {displayOutput && (
            <div style={{
              background: "var(--bg-subtle)",
              borderRadius: 6,
              padding: "8px 10px",
              fontSize: 11,
              fontFamily: "var(--font-mono)",
              color: "var(--text-muted)",
              lineHeight: 1.5,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              maxHeight: 300,
              overflowY: "auto",
            }}>
              {displayOutput}
            </div>
          )}
          {!displayOutput && !hasChildren && (
            <div style={{ fontStyle: "italic", color: "var(--text-dim)", fontSize: 11 }}>
              Waiting for output...
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A nested child run displayed within a parent's expanded section.
 * Clickable to show its own output via inline toggle.
 */
function formatRouting(routing: SubagentRun["routing"]): string | null {
  if (!routing?.source) return null;
  const target = routing.model ?? (routing.source === "piDefault" ? "Pi default" : null);
  const thinking = routing.thinking && routing.thinking !== "off" ? `:${routing.thinking}` : "";
  const base = target ? `${routing.source} → ${target}${thinking}` : routing.source;
  return routing.fallbackReason ? `${base} (${routing.fallbackReason})` : base;
}

function ChildRunItem({ run, depth }: { run: SubagentRun; depth: number }) {
  const [expanded, setExpanded] = useState(false);
  const indent = depth * 16;
  const isRunning = run.status === "running";
  const isFailed = run.status === "failed";
  const statusColor = isRunning ? "#f59e0b" : isFailed ? "#ef4444" : "#22c55e";
  const statusIcon = isRunning ? "○" : isFailed ? "✕" : "✓";
  const displayOutput = run.result ?? run.partialOutput;

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "3px 8px 3px",
          paddingLeft: 8 + indent,
          cursor: "pointer",
          userSelect: "none",
          borderRadius: 4,
          transition: "background 0.08s",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
      >
        <span style={{ color: statusColor, width: 12, textAlign: "center", flexShrink: 0, fontSize: 10 }}>
          {statusIcon}
        </span>
        <span style={{ fontWeight: 500, color: "var(--text)", flexShrink: 0, maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
          {run.agent}
        </span>
        <span style={{ color: "var(--text-muted)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
          {run.task ? run.task.split("\n")[0].slice(0, 80) : ""}
        </span>
        <span style={{ fontSize: 9, color: "var(--text-dim)", flexShrink: 0 }}>
          {expanded ? "▲" : "▼"}
        </span>
      </div>
      {expanded && displayOutput && (
        <div style={{
          padding: "2px 8px 6px",
          paddingLeft: 8 + indent + 16,
        }}>
          <div style={{
            background: "var(--bg-subtle)",
            borderRadius: 4,
            padding: "6px 8px",
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-muted)",
            lineHeight: 1.4,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 200,
            overflowY: "auto",
          }}>
            {displayOutput}
          </div>
        </div>
      )}
    </div>
  );
}
