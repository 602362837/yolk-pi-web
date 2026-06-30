"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { MarkdownBody } from "./MarkdownBody";
import type { TrellisTaskDetail, TrellisTaskProgressStage, TrellisTaskSummary, TrellisTasksResponse } from "@/lib/trellis-types";

interface TrellisPanelProps {
  cwd: string | null;
  includeArchivedDefault: boolean;
  focusedTaskKey?: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

type ArtifactTab = "overview" | "prd" | "design" | "implement";

interface TasksResponse extends TrellisTasksResponse {
  error?: string;
}

interface DetailResponse {
  task?: TrellisTaskDetail;
  error?: string;
}

const statusLabel: Record<string, string> = {
  planning: "规划中",
  in_progress: "执行中",
  review: "检查中",
  completed: "已完成",
  done: "已完成",
};

function formatStatus(status: string): string {
  return statusLabel[status.toLowerCase()] ?? status;
}

function statusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "in_progress":
      return "#60a5fa";
    case "review":
      return "#a78bfa";
    case "completed":
    case "done":
    case "complete":
      return "#22c55e";
    case "planning":
      return "#f59e0b";
    default:
      return "var(--text-dim)";
  }
}

function formatDateTime(value?: string | null): string {
  if (!value) return "—";

  const dateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day)).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function shortPath(path: string): string {
  return path.length > 44 ? `…${path.slice(-43)}` : path;
}

interface TaskTreeNode {
  task: TrellisTaskSummary;
  children: TaskTreeNode[];
  selfMatches: boolean;
  descendantMatches: boolean;
}

function taskMatchesFilters(task: TrellisTaskSummary, query: string, statusFilter: string): boolean {
  if (statusFilter !== "all" && task.status !== statusFilter) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [task.title, task.dirName, task.assignee, task.priority, task.status]
    .filter(Boolean)
    .some((value) => value!.toLowerCase().includes(q));
}

function buildChildrenMap(tasks: TrellisTaskSummary[]): Map<string, string[]> {
  const byDir = new Map(tasks.map((task) => [task.dirName, task]));
  const childrenByDir = new Map<string, string[]>();
  const addChild = (parent: string, child: string) => {
    if (parent === child || !byDir.has(parent) || !byDir.has(child)) return;
    const children = childrenByDir.get(parent) ?? [];
    if (!children.includes(child)) children.push(child);
    childrenByDir.set(parent, children);
  };

  for (const task of tasks) {
    for (const child of task.children) addChild(task.dirName, child);
  }
  for (const task of tasks) {
    if (task.parent) addChild(task.parent, task.dirName);
  }

  return childrenByDir;
}

function hasParentCycle(task: TrellisTaskSummary, byDir: Map<string, TrellisTaskSummary>): boolean {
  const seen = new Set<string>([task.dirName]);
  let parent = task.parent;
  while (parent && byDir.has(parent)) {
    if (seen.has(parent)) return true;
    seen.add(parent);
    parent = byDir.get(parent)?.parent ?? null;
  }
  return false;
}

function createTaskTree(tasks: TrellisTaskSummary[], query: string, statusFilter: string): TaskTreeNode[] {
  const byDir = new Map(tasks.map((task) => [task.dirName, task]));
  const childrenByDir = buildChildrenMap(tasks);
  const filtersActive = query.trim().length > 0 || statusFilter !== "all";

  const buildNode = (task: TrellisTaskSummary, ancestors: Set<string>): TaskTreeNode => {
    const selfMatches = taskMatchesFilters(task, query, statusFilter);
    const nextAncestors = new Set(ancestors).add(task.dirName);
    const allChildren = (childrenByDir.get(task.dirName) ?? [])
      .filter((dirName) => !nextAncestors.has(dirName))
      .map((dirName) => byDir.get(dirName))
      .filter((child): child is TrellisTaskSummary => !!child)
      .map((child) => buildNode(child, nextAncestors));
    const children = filtersActive
      ? allChildren.filter((child) => child.selfMatches || child.descendantMatches)
      : allChildren;
    return {
      task,
      children,
      selfMatches,
      descendantMatches: children.some((child) => child.selfMatches || child.descendantMatches),
    };
  };

  return tasks
    .filter((task) => !task.parent || !byDir.has(task.parent) || hasParentCycle(task, byDir))
    .map((task) => buildNode(task, new Set()))
    .filter((node) => !filtersActive || node.selfMatches || node.descendantMatches);
}

function countRenderedTreeNodes(nodes: TaskTreeNode[], expandedKeys: Set<string>, filtersActive: boolean): number {
  return nodes.reduce((total, node) => {
    const expanded = node.children.length > 0 && (expandedKeys.has(node.task.key) || (filtersActive && node.descendantMatches));
    return total + 1 + (expanded ? countRenderedTreeNodes(node.children, expandedKeys, filtersActive) : 0);
  }, 0);
}

export function TrellisPanel({ cwd, includeArchivedDefault, focusedTaskKey, onOpenFile }: TrellisPanelProps) {
  const [includeArchived, setIncludeArchived] = useState(includeArchivedDefault);
  const [refreshKey, setRefreshKey] = useState(0);
  const [tasks, setTasks] = useState<TrellisTaskSummary[]>([]);
  const [exists, setExists] = useState(true);
  const [archivedCount, setArchivedCount] = useState(0);
  const [readErrors, setReadErrors] = useState<TasksResponse["errors"]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<TrellisTaskDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>("overview");
  const [expandedTaskKeys, setExpandedTaskKeys] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    setIncludeArchived(includeArchivedDefault);
  }, [includeArchivedDefault]);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setTasks([]);
      setExists(false);
      setArchivedCount(0);
      setReadErrors([]);
      setSelectedKey(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cwd, includeArchived: includeArchived ? "true" : "false" });
      const res = await fetch(`/api/trellis/tasks?${params.toString()}`, { signal });
      const data = await res.json() as TasksResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setTasks(data.tasks);
      setExists(data.exists);
      setArchivedCount(data.archivedCount);
      setReadErrors(data.errors);
      setSelectedKey((current) => {
        if (focusedTaskKey && data.tasks.some((task) => task.key === focusedTaskKey)) return focusedTaskKey;
        return current && data.tasks.some((task) => task.key === current)
          ? current
          : data.tasks[0]?.key ?? null;
      });
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setTasks([]);
      setReadErrors([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd, includeArchived, focusedTaskKey]);

  useEffect(() => {
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [loadTasks, refreshKey]);

  useEffect(() => {
    setArtifactTab("overview");
  }, [selectedKey]);

  useEffect(() => {
    if (!focusedTaskKey) return;
    if (!tasks.some((task) => task.key === focusedTaskKey)) return;
    setSelectedKey((current) => current === focusedTaskKey ? current : focusedTaskKey);
  }, [focusedTaskKey, tasks]);

  useEffect(() => {
    if (!cwd || !selectedKey) {
      setDetail(null);
      setDetailError(null);
      return;
    }

    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    fetch(`/api/trellis/tasks/${encodeURIComponent(selectedKey)}?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as DetailResponse;
        if (!res.ok || data.error || !data.task) throw new Error(data.error ?? `HTTP ${res.status}`);
        setDetail(data.task);
      })
      .catch((err) => {
        if ((err as { name?: string }).name === "AbortError") return;
        setDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });

    return () => controller.abort();
  }, [cwd, selectedKey]);

  const statusOptions = useMemo(() => {
    const statuses = [...new Set(tasks.map((task) => task.status))].sort();
    return ["all", ...statuses];
  }, [tasks]);

  const taskTree = useMemo(() => createTaskTree(tasks, query, statusFilter), [tasks, query, statusFilter]);
  const filtersActive = query.trim().length > 0 || statusFilter !== "all";
  const visibleTaskCount = useMemo(() => countRenderedTreeNodes(taskTree, expandedTaskKeys, filtersActive), [expandedTaskKeys, filtersActive, taskTree]);
  const selectedSummary = selectedKey ? tasks.find((task) => task.key === selectedKey) ?? null : null;

  const toggleExpandedTask = useCallback((taskKey: string) => {
    setExpandedTaskKeys((current) => {
      const next = new Set(current);
      if (next.has(taskKey)) next.delete(taskKey);
      else next.add(taskKey);
      return next;
    });
  }, []);

  if (!cwd) {
    return <EmptyState title="未选择工作区" description="请先在侧边栏选择项目目录，再查看 Trellis 任务。" />;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text)", fontSize: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索任务..."
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            height: 28,
            padding: "0 9px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--text)",
            fontSize: 12,
            outline: "none",
          }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ height: 28, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 11 }}
        >
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status === "all" ? "全部" : formatStatus(status)}</option>
          ))}
        </select>
        <button
          onClick={() => setIncludeArchived((value) => !value)}
          title="包含已归档任务"
          style={{
            height: 28,
            padding: "0 9px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: includeArchived ? "var(--bg-selected)" : "var(--bg)",
            color: includeArchived ? "var(--accent)" : "var(--text-muted)",
            cursor: "pointer",
            fontSize: 11,
            whiteSpace: "nowrap",
          }}
        >
          归档 {includeArchived ? "✓" : "□"}
        </button>
        <button
          onClick={() => setRefreshKey((key) => key + 1)}
          title="刷新 Trellis 任务"
          style={{ height: 28, padding: "0 9px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
        >
          ↻
        </button>
      </div>

      {error ? (
        <EmptyState title="无法加载 Trellis 任务" description={error} tone="error" />
      ) : !exists ? (
        <EmptyState title="当前工作区未启用 Trellis" description="这个工作区里没有 .trellis/tasks。" />
      ) : loading && tasks.length === 0 ? (
        <EmptyState title="正在加载 Trellis 任务…" description="正在读取当前工作区的任务元数据。" />
      ) : tasks.length === 0 ? (
        <EmptyState title="没有找到 Trellis 任务" description={archivedCount > 0 ? "当前只有已归档任务，打开“归档”即可显示。" : "创建 Trellis 任务后，这里会显示任务列表。"} />
      ) : (
        <div className="trellis-panel-body">
          <div className="trellis-task-list-pane">
            <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", display: "flex", justifyContent: "space-between" }}>
              <span>任务 ({visibleTaskCount})</span>
              {loading && <span>加载中…</span>}
            </div>
            <div style={{ overflowY: "auto", minHeight: 0, flex: 1 }}>
              {taskTree.map((node) => (
                <TaskTreeItem
                  key={node.task.key}
                  node={node}
                  selectedKey={selectedKey}
                  expandedKeys={expandedTaskKeys}
                  filtersActive={filtersActive}
                  onSelect={setSelectedKey}
                  onToggle={toggleExpandedTask}
                />
              ))}
              {taskTree.length === 0 && (
                <div style={{ padding: 14, color: "var(--text-muted)", fontStyle: "italic" }}>没有任务匹配当前筛选条件。</div>
              )}
            </div>
            {readErrors.length > 0 && (
              <div style={{ borderTop: "1px solid var(--border)", padding: 8, color: "#f87171", fontSize: 10, lineHeight: 1.45 }}>
                有 {readErrors.length} 个任务读取问题，请打开详情或检查任务文件。
              </div>
            )}
          </div>

          <div className="trellis-task-detail-pane">
            {detailLoading && !detail ? (
              <EmptyState title="正在加载任务详情…" description="正在读取任务文档和 context manifests。" />
            ) : detailError ? (
              <TaskDetailError summary={selectedSummary} error={detailError} />
            ) : detail ? (
              <TaskDetail task={detail} artifactTab={artifactTab} onArtifactTabChange={setArtifactTab} cwd={cwd} onOpenFile={onOpenFile} />
            ) : (
              <EmptyState title="请选择任务" description="从左侧任务列表选择一个任务查看详情。" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ title, description, tone = "muted" }: { title: string; description: string; tone?: "muted" | "error" }) {
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", color: tone === "error" ? "#f87171" : "var(--text-muted)", gap: 8 }}>
      <div style={{ color: tone === "error" ? "#f87171" : "var(--text)", fontSize: 15, fontWeight: 700 }}>{title}</div>
      <div style={{ fontSize: 12, lineHeight: 1.5, maxWidth: 320 }}>{description}</div>
    </div>
  );
}

function TaskTreeItem({
  node,
  selectedKey,
  expandedKeys,
  filtersActive,
  onSelect,
  onToggle,
  level = 0,
}: {
  node: TaskTreeNode;
  selectedKey: string | null;
  expandedKeys: Set<string>;
  filtersActive: boolean;
  onSelect: (key: string) => void;
  onToggle: (key: string) => void;
  level?: number;
}) {
  const hasChildren = node.children.length > 0;
  const expanded = hasChildren && (expandedKeys.has(node.task.key) || (filtersActive && node.descendantMatches));
  return (
    <div style={{ borderBottom: level === 0 ? "1px solid var(--border)" : "none" }}>
      <TaskRow
        task={node.task}
        level={level}
        selected={node.task.key === selectedKey}
        hasChildren={hasChildren}
        expanded={expanded}
        onClick={() => onSelect(node.task.key)}
        onToggle={() => onToggle(node.task.key)}
      />
      {expanded && (
        <div style={{ margin: "0 8px 8px 22px", borderLeft: "1px solid var(--border)", borderRadius: 8, background: "color-mix(in srgb, var(--bg-subtle) 55%, transparent)", overflow: "hidden" }}>
          {node.children.map((child) => (
            <TaskTreeItem
              key={child.task.key}
              node={child}
              selectedKey={selectedKey}
              expandedKeys={expandedKeys}
              filtersActive={filtersActive}
              onSelect={onSelect}
              onToggle={onToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskRow({ task, level, selected, hasChildren, expanded, onClick, onToggle }: { task: TrellisTaskSummary; level: number; selected: boolean; hasChildren: boolean; expanded: boolean; onClick: () => void; onToggle: () => void }) {
  const childText = task.childProgress.total > 0 ? `子任务 ${task.childProgress.completed}/${task.childProgress.total}` : null;
  return (
    <div style={{ display: "flex", alignItems: "stretch", background: selected ? "var(--bg-selected)" : "transparent" }}>
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasChildren}
        aria-label={expanded ? "折叠子任务" : "展开子任务"}
        style={{
          width: 26,
          border: "none",
          background: "transparent",
          color: hasChildren ? "var(--text-muted)" : "transparent",
          cursor: hasChildren ? "pointer" : "default",
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {hasChildren ? (expanded ? "▾" : "▸") : "·"}
      </button>
      <button
        type="button"
        onClick={onClick}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          padding: level === 0 ? "8px 10px 8px 0" : "7px 10px 7px 0",
          border: "none",
          background: "transparent",
          color: "var(--text)",
          cursor: "pointer",
          textAlign: "left",
          minWidth: 0,
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: statusColor(task.status), marginTop: 5, flexShrink: 0 }} />
        <span style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: 1 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            <span style={{ fontSize: level === 0 ? 12 : 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
            {level > 0 && <Badge label="子任务" tone="muted" />}
            {task.isArchived && <Badge label="已归档" tone="muted" />}
          </span>
          <span style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.dirName}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", color: "var(--text-muted)", fontSize: 10 }}>
            <span>{formatStatus(task.status)}</span>
            {task.priority && <span>· {task.priority}</span>}
            {task.assignee && <span>· {task.assignee}</span>}
            {childText && <span>· {childText}</span>}
          </span>
          {task.readError && <span style={{ color: "#f87171", fontSize: 10 }}>{task.readError}</span>}
        </span>
        <span style={{ color: "var(--text-dim)", fontSize: 10, flexShrink: 0 }}>{task.progress.percent}%</span>
      </button>
    </div>
  );
}

function Badge({ label, tone = "default" }: { label: string; tone?: "default" | "accent" | "muted" | "error" }) {
  const color = tone === "accent" ? "var(--accent)" : tone === "error" ? "#f87171" : tone === "muted" ? "var(--text-muted)" : "var(--text)";
  const bg = tone === "accent" ? "rgba(37,99,235,0.13)" : tone === "error" ? "rgba(239,68,68,0.13)" : "var(--bg-subtle)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 6px", borderRadius: 999, border: "1px solid var(--border)", background: bg, color, fontSize: 10, lineHeight: 1.2, whiteSpace: "nowrap" }}>
      {label}
    </span>
  );
}

function TaskDetailError({ summary, error }: { summary: TrellisTaskSummary | null; error: string }) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
      {summary && <TaskHeader task={summary} />}
      <div style={{ padding: 12, borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12 }}>{error}</div>
    </div>
  );
}

function TaskHeader({ task }: { task: TrellisTaskSummary | TrellisTaskDetail }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: 17, lineHeight: 1.25 }}>{task.title}</h3>
          <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{"pathLabel" in task ? task.pathLabel : task.dirName}</div>
        </div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Badge label={formatStatus(task.status)} tone="accent" />
          {task.priority && <Badge label={task.priority} />}
          {task.isArchived && <Badge label="已归档" tone="muted" />}
        </div>
      </div>
      {task.description && <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{task.description}</div>}
      {task.readError && <div style={{ padding: 8, borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11 }}>{task.readError}</div>}
    </div>
  );
}

function formatManifestCounts(manifests: TrellisTaskDetail["manifests"]): string {
  if (manifests.implementCount === 0 && manifests.checkCount === 0) return "未配置";
  return `${manifests.implementCount} implement · ${manifests.checkCount} check`;
}

function TaskDetail({ task, artifactTab, onArtifactTabChange, cwd, onOpenFile }: { task: TrellisTaskDetail; artifactTab: ArtifactTab; onArtifactTabChange: (tab: ArtifactTab) => void; cwd: string; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const docs = task.documents;
  const activeDocument = artifactTab === "prd" ? docs.prd : artifactTab === "design" ? docs.design : artifactTab === "implement" ? docs.implement : undefined;
  return (
    <div style={{ height: "100%", overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <TaskHeader task={task} />
      <ProgressTimeline task={task} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        <MetaCard label="负责人" value={task.assignee ?? "—"} />
        <MetaCard label="创建时间" value={formatDateTime(task.createdAt)} title="包含时分秒的时间戳会显示到秒；历史 date-only 任务只显示日期。" />
        <MetaCard label="Trellis 子任务" value={`${task.childProgress.completed}/${task.childProgress.total}`} title="统计 task.json.children 与 parent 归属推导的任务树子任务，不代表 subagent 委派次数。" />
        <MetaCard label="上下文" value={formatManifestCounts(task.manifests)} title="统计 implement.jsonl / check.jsonl 的真实 context 条目；_example seed 行会被忽略。" />
      </div>
      <div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          <ArtifactButton label="概览" active={artifactTab === "overview"} onClick={() => onArtifactTabChange("overview")} />
          <ArtifactButton label="PRD" active={artifactTab === "prd"} disabled={!docs.prd} onClick={() => onArtifactTabChange("prd")} />
          <ArtifactButton label="Design" active={artifactTab === "design"} disabled={!docs.design} onClick={() => onArtifactTabChange("design")} />
          <ArtifactButton label="Implement" active={artifactTab === "implement"} disabled={!docs.implement} onClick={() => onArtifactTabChange("implement")} />
        </div>
        {artifactTab === "overview" ? (
          <Overview task={task} cwd={cwd} onOpenFile={onOpenFile} />
        ) : activeDocument ? (
          <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 12 }}>
            {activeDocument.truncated && <div style={{ marginBottom: 8, color: "#f59e0b", fontSize: 11 }}>文档预览已在 256 KB 处截断。</div>}
            <MarkdownBody>{activeDocument.content}</MarkdownBody>
          </div>
        ) : (
          <div style={{ color: "var(--text-muted)", fontStyle: "italic" }}>这个任务文档不存在。</div>
        )}
      </div>
    </div>
  );
}

function ProgressTimeline({ task }: { task: TrellisTaskDetail }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 12, background: "var(--bg-subtle)", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div>
          <div style={{ color: "var(--text)", fontWeight: 700 }}>进度</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11 }}>{task.progress.label} · 根据任务文档推断</div>
        </div>
        <Badge label={`${task.progress.percent}%`} tone="accent" />
      </div>
      <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${task.progress.percent}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {task.progress.stages.map((stage) => <ProgressStage key={stage.id} stage={stage} />)}
      </div>
    </div>
  );
}

function ProgressStage({ stage }: { stage: TrellisTaskProgressStage }) {
  const color = stage.status === "done" ? "#22c55e" : stage.status === "active" ? "var(--accent)" : "var(--text-dim)";
  const icon = stage.status === "done" ? "✓" : stage.status === "active" ? "●" : "○";
  return (
    <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, color, fontWeight: 700, fontSize: 11 }}>
        <span>{icon}</span>
        <span>{stage.label}</span>
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 10, lineHeight: 1.35, display: "flex", flexDirection: "column", gap: 2 }}>
        {stage.details.map((detail, index) => <span key={`${index}-${detail}`}>{detail}</span>)}
      </div>
    </div>
  );
}

function MetaCard({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title} style={{ border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg-subtle)", padding: 9, minWidth: 0 }}>
      <div style={{ color: "var(--text-dim)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>{label}</div>
      <div style={{ color: "var(--text)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function ArtifactButton({ label, active, disabled, onClick }: { label: string; active: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 9px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: active ? "var(--bg-selected)" : "var(--bg)",
        color: disabled ? "var(--text-dim)" : active ? "var(--accent)" : "var(--text-muted)",
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 11,
        fontWeight: active ? 700 : 500,
      }}
    >
      {label}
    </button>
  );
}

function Overview({ task, cwd, onOpenFile }: { task: TrellisTaskDetail; cwd: string; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const relatedFiles = task.relatedFiles.filter(Boolean);
  const optionalMetadata = [
    { label: "基准分支", value: task.baseBranch },
    { label: "分支", value: task.branch },
    { label: "Worktree", value: task.worktreePath ? shortPath(task.worktreePath) : null },
    { label: "Commit", value: task.commit },
    { label: "PR", value: task.prUrl },
  ];
  const missingMetadata = optionalMetadata.filter((item) => !item.value).map((item) => item.label);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 12 }}>
        <div style={{ color: "var(--text)", fontWeight: 700, marginBottom: 8 }}>任务元数据</div>
        <div style={{ color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45, marginBottom: 8 }}>
          Git / Worktree 信息来自 task.json；未记录的历史字段不会自动推断。
        </div>
        <MetadataLine label="目录" value={task.dirName} mono />
        {task.baseBranch && <MetadataLine label="记录基准" value={task.baseBranch} />}
        {task.branch && <MetadataLine label="分支" value={task.branch} />}
        {task.worktreePath && <MetadataLine label="Worktree" value={shortPath(task.worktreePath)} />}
        {task.commit && <MetadataLine label="Commit" value={task.commit} />}
        {task.prUrl && <MetadataLine label="PR" value={task.prUrl} />}
        {missingMetadata.length > 0 && (
          <div style={{ marginTop: 6, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.45 }}>
            未记录：{missingMetadata.join("、")}。
          </div>
        )}
      </div>

      {task.subtasks.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 12 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, marginBottom: 8 }}>子任务</div>
          <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-muted)", lineHeight: 1.6 }}>
            {task.subtasks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {relatedFiles.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 12 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, marginBottom: 8 }}>相关文件</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {relatedFiles.map((file) => {
              const filePath = file.startsWith("/") ? file : `${cwd.replace(/\/$/, "")}/${file.replace(/^\/+/, "")}`;
              const fileName = file.split(/[\\/]/).pop() ?? file;
              return (
                <button
                  key={file}
                  onClick={() => onOpenFile?.(filePath, fileName)}
                  disabled={!onOpenFile}
                  style={{ textAlign: "left", padding: "5px 7px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", cursor: onOpenFile ? "pointer" : "default", fontFamily: "var(--font-mono)", fontSize: 11, overflowWrap: "anywhere" }}
                >
                  {file}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {task.notes && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 12 }}>
          <div style={{ color: "var(--text)", fontWeight: 700, marginBottom: 8 }}>备注</div>
          <div style={{ color: "var(--text-muted)", whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{task.notes}</div>
        </div>
      )}
    </div>
  );
}

function MetadataLine({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, padding: "3px 0", color: "var(--text-muted)", fontSize: 12 }}>
      <span style={{ color: "var(--text-dim)" }}>{label}</span>
      <span style={{ fontFamily: mono ? "var(--font-mono)" : undefined, overflowWrap: "anywhere" }}>{value}</span>
    </div>
  );
}
