"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type {
  YpiStudioAgent,
  YpiStudioAgentWarning,
  YpiStudioAgentsInitResponse,
  YpiStudioAgentsResponse,
  YpiStudioTaskSummary,
  YpiStudioTasksResponse,
  YpiStudioWorkflowFile,
  YpiStudioWorkflowsInitResponse,
  YpiStudioWorkflowsResponse,
} from "@/lib/ypi-studio-types";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  cwd: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type StudioTab = "members" | "workflows" | "tasks";

function agentFilePath(cwd: string, agent: YpiStudioAgent): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${agent.pathLabel.replace(/^\/+/, "")}`;
}

function workflowFilePath(cwd: string, workflow: YpiStudioWorkflowFile): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${workflow.pathLabel.replace(/^\/+/, "")}`;
}

function taskFilePath(cwd: string, task: YpiStudioTaskSummary): string {
  return `${cwd.replace(/[\\/]+$/, "")}/.ypi/tasks/${task.id}/task.json`;
}

function shortCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}

function needsAgentInit(data: YpiStudioAgentsResponse | null): boolean {
  return !data?.exists || (data.missingDefaultAgents?.length ?? 0) > 0 || (data.outdatedDefaultAgents?.length ?? 0) > 0;
}

function needsWorkflowInit(data: YpiStudioWorkflowsResponse | null): boolean {
  return !data?.exists || (data.missingDefaultWorkflows.length ?? 0) > 0;
}

function initButtonLabel(agents: YpiStudioAgentsResponse | null, workflows: YpiStudioWorkflowsResponse | null): string {
  if (!agents?.exists && !workflows?.exists) return "初始化工作室";
  if (needsAgentInit(agents) || needsWorkflowInit(workflows)) return "补齐默认配置";
  return "重新检查";
}

function initSuccessMessage(createdAgents: number, createdWorkflows: number, updatedAgents: number): string {
  if (createdAgents + createdWorkflows > 0 && updatedAgents > 0) {
    return `已创建 ${createdAgents} 个成员、${createdWorkflows} 个流程，已更新 ${updatedAgents} 个旧版默认成员；自定义成员未覆盖。`;
  }
  if (createdAgents + createdWorkflows > 0) {
    return `已创建 ${createdAgents} 个成员、${createdWorkflows} 个流程；已有自定义文件未覆盖。`;
  }
  if (updatedAgents > 0) {
    return `已更新 ${updatedAgents} 个旧版默认成员；自定义成员未覆盖。`;
  }
  return "默认成员和流程已是最新，没有覆盖自定义内容。";
}

function initWarningMessage(warnings: YpiStudioAgentWarning[]): string | null {
  if (warnings.length === 0) return null;
  const fileNames = warnings.map((warning) => warning.fileName || warning.pathLabel);
  const list = warnings.length > 3 ? `${fileNames.slice(0, 3).join("、")} 等 ${warnings.length} 个` : fileNames.join("、");
  return `发现 ${warnings.length} 个自定义成员仍含内部引用，已跳过覆盖：${list}。可打开文件手动清理。`;
}

function statusTone(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "completed" || status === "ready" || status === "archived") return "success";
  if (status === "blocked" || status === "changes_requested") return "warning";
  if (status === "cancelled") return "error";
  return "neutral";
}

export function YpiStudioPanel({ cwd, onOpenFile }: Props) {
  const [activeTab, setActiveTab] = useState<StudioTab>("members");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [workflowLoadState, setWorkflowLoadState] = useState<LoadState>("idle");
  const [taskLoadState, setTaskLoadState] = useState<LoadState>("idle");
  const [data, setData] = useState<YpiStudioAgentsResponse | null>(null);
  const [workflowsData, setWorkflowsData] = useState<YpiStudioWorkflowsResponse | null>(null);
  const [tasksData, setTasksData] = useState<YpiStudioTasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [initWarning, setInitWarning] = useState<string | null>(null);

  const loadAgents = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setData(null);
      setSelectedKey(null);
      setLoadState("idle");
      setError(null);
      setInitWarning(null);
      return;
    }

    setLoadState("loading");
    setError(null);
    try {
      const res = await fetch(`/api/studio/agents?cwd=${encodeURIComponent(cwd)}`, { signal });
      const body = await res.json() as YpiStudioAgentsResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body);
      setSelectedKey((current) => {
        if (current && body.agents.some((agent) => agent.key === current)) return current;
        return body.agents[0]?.key ?? null;
      });
      setLoadState("ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setLoadState("error");
    }
  }, [cwd]);

  const loadWorkflows = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setWorkflowsData(null);
      setWorkflowLoadState("idle");
      return;
    }

    setWorkflowLoadState("loading");
    try {
      const res = await fetch(`/api/studio/workflows?cwd=${encodeURIComponent(cwd)}`, { signal });
      const body = await res.json() as YpiStudioWorkflowsResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setWorkflowsData(body);
      setWorkflowLoadState("ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setWorkflowLoadState("error");
    }
  }, [cwd]);

  const loadTasks = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setTasksData(null);
      setTaskLoadState("idle");
      return;
    }

    setTaskLoadState("loading");
    try {
      const res = await fetch(`/api/studio/tasks?cwd=${encodeURIComponent(cwd)}`, { signal });
      const body = await res.json() as YpiStudioTasksResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTasksData(body);
      setTaskLoadState("ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      setTaskLoadState("error");
    }
  }, [cwd]);

  const reloadAll = useCallback((signal?: AbortSignal) => {
    void loadAgents(signal);
    void loadWorkflows(signal);
    void loadTasks(signal);
  }, [loadAgents, loadTasks, loadWorkflows]);

  useEffect(() => {
    const controller = new AbortController();
    reloadAll(controller.signal);
    return () => controller.abort();
  }, [reloadAll]);

  const selectedAgent = useMemo(() => {
    if (!data?.agents.length) return null;
    return data.agents.find((agent) => agent.key === selectedKey) ?? data.agents[0] ?? null;
  }, [data, selectedKey]);

  const handleInit = useCallback(async () => {
    if (!cwd || initBusy) return;
    setInitBusy(true);
    setInitMessage(null);
    setInitWarning(null);
    setError(null);
    try {
      const [agentsRes, workflowsRes] = await Promise.all([
        fetch("/api/studio/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
        }),
        fetch("/api/studio/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd }),
        }),
      ]);
      const agentsBody = await agentsRes.json() as YpiStudioAgentsInitResponse & { error?: string };
      const workflowsBody = await workflowsRes.json() as YpiStudioWorkflowsInitResponse & { error?: string };
      if (!agentsRes.ok || agentsBody.error) throw new Error(agentsBody.error ?? `HTTP ${agentsRes.status}`);
      if (!workflowsRes.ok || workflowsBody.error) throw new Error(workflowsBody.error ?? `HTTP ${workflowsRes.status}`);

      setData(agentsBody.agents);
      setWorkflowsData(workflowsBody.workflows);
      setSelectedKey((current) => {
        if (current && agentsBody.agents.agents.some((agent) => agent.key === current)) return current;
        return agentsBody.agents.agents[0]?.key ?? null;
      });
      setLoadState("ready");
      setWorkflowLoadState("ready");
      await loadTasks();
      setTaskLoadState("ready");
      const createdAgents = agentsBody.created.length;
      const createdWorkflows = workflowsBody.created.length;
      const updatedAgents = agentsBody.updated.length;
      setInitMessage(initSuccessMessage(createdAgents, createdWorkflows, updatedAgents));
      setInitWarning(initWarningMessage(agentsBody.warnings));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoadState("error");
    } finally {
      setInitBusy(false);
    }
  }, [cwd, initBusy, loadTasks]);

  if (!cwd) {
    return <PanelEmpty title="请选择项目空间" description="选择一个会话或工作目录后，可在该项目根目录初始化 .ypi/agents/、.ypi/workflows/ 和工作室任务。" />;
  }

  const canInitialize = needsAgentInit(data) || needsWorkflowInit(workflowsData);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>工作室</div>
            <div title={cwd} style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shortCwd(cwd)} · .ypi/
            </div>
          </div>
          <button
            onClick={handleInit}
            disabled={initBusy || loadState === "loading" || workflowLoadState === "loading"}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: canInitialize ? "var(--accent)" : "var(--bg)",
              color: canInitialize ? "white" : "var(--text-muted)",
              cursor: initBusy || loadState === "loading" || workflowLoadState === "loading" ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {initBusy ? "处理中…" : initButtonLabel(data, workflowsData)}
          </button>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
          工作室包含成员、结构化流程和任务状态机。初始化只补齐缺失默认文件，不覆盖已有自定义内容。
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <TabButton active={activeTab === "members"} label={`成员 ${data?.agents.length ?? 0}`} onClick={() => setActiveTab("members")} />
          <TabButton active={activeTab === "workflows"} label={`流程 ${workflowsData?.workflows.length ?? 0}`} onClick={() => setActiveTab("workflows")} />
          <TabButton active={activeTab === "tasks"} label={`任务 ${tasksData?.tasks.length ?? 0}`} onClick={() => setActiveTab("tasks")} />
        </div>
        {initMessage && <Notice tone="success" text={initMessage} />}
        {initWarning && <Notice tone="warning" text={initWarning} />}
        {error && <Notice tone="error" text={error} />}
      </div>

      {activeTab === "members" ? (
        <MembersTab loadState={loadState} data={data} selectedAgent={selectedAgent} selectedKey={selectedKey} setSelectedKey={setSelectedKey} onOpenFile={onOpenFile} />
      ) : activeTab === "workflows" ? (
        <WorkflowsTab cwd={cwd} loadState={workflowLoadState} data={workflowsData} onOpenFile={onOpenFile} />
      ) : (
        <TasksTab cwd={cwd} loadState={taskLoadState} data={tasksData} onOpenFile={onOpenFile} />
      )}
    </div>
  );
}

function MembersTab({ loadState, data, selectedAgent, selectedKey, setSelectedKey, onOpenFile }: {
  loadState: LoadState;
  data: YpiStudioAgentsResponse | null;
  selectedAgent: YpiStudioAgent | null;
  selectedKey: string | null;
  setSelectedKey: (key: string) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
}) {
  if (loadState === "loading") return <PanelEmpty title="正在读取工作室成员" description="检查当前项目的 .ypi/agents/ 目录。" />;
  if (loadState === "error" && !data) return <PanelEmpty title="读取失败" description="请检查上方错误信息，或确认当前工作目录已被授权访问。" />;
  if (!data?.exists) {
    return <PanelEmpty title="尚未初始化成员" description="点击“初始化工作室”会在项目根目录创建 architect、ui-designer、implementer、checker 四个默认成员文件。" />;
  }
  if (data.agents.length === 0) return <PanelEmpty title="没有成员文件" description=".ypi/agents/ 已存在，但没有可读取的 Markdown 成员文件。可点击补齐默认配置。" />;

  return (
    <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "minmax(130px, 35%) 1fr" }}>
      <div style={{ overflowY: "auto", borderBottom: "1px solid var(--border)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <Notice tone="info" text="成员职责定义保存在 .ypi/agents；运行模型和 thinking 在 Settings → Studio 配置。" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignContent: "start" }}>
          {data.agents.map((agent) => (
            <AgentCard key={agent.key} agent={agent} active={selectedKey === agent.key} onClick={() => setSelectedKey(agent.key)} />
          ))}
        </div>
      </div>
      <div style={{ minHeight: 0, overflowY: "auto" }}>
        {selectedAgent && <AgentDetail cwd={data.cwd} agent={selectedAgent} onOpenFile={onOpenFile} />}
      </div>
    </div>
  );
}

function WorkflowsTab({ cwd, loadState, data, onOpenFile }: { cwd: string; loadState: LoadState; data: YpiStudioWorkflowsResponse | null; onOpenFile?: (filePath: string, fileName: string) => void }) {
  if (loadState === "loading") return <PanelEmpty title="正在读取工作室流程" description="检查当前项目的 .ypi/workflows/ 目录。" />;
  if (loadState === "error" && !data) return <PanelEmpty title="读取失败" description="请检查上方错误信息。" />;
  if (!data?.exists) return <PanelEmpty title="尚未初始化流程" description="点击“初始化工作室”会创建默认工作流 JSON：功能开发、Bug 修复、UI 改动、只检查。" />;
  if (data.workflows.length === 0) return <PanelEmpty title="没有流程文件" description=".ypi/workflows/ 已存在，但没有可读取的 JSON 流程文件。" />;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {data.workflows.map((workflow) => <WorkflowCard key={workflow.key} cwd={cwd} workflow={workflow} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function TasksTab({ cwd, loadState, data, onOpenFile }: { cwd: string; loadState: LoadState; data: YpiStudioTasksResponse | null; onOpenFile?: (filePath: string, fileName: string) => void }) {
  if (loadState === "loading") return <PanelEmpty title="正在读取工作室任务" description="检查当前项目的 .ypi/tasks/ 目录。" />;
  if (loadState === "error" && !data) return <PanelEmpty title="读取失败" description="请检查上方错误信息。" />;
  if (!data?.exists) return <PanelEmpty title="还没有工作室任务" description="通过 /studio-start，或直接说“用工作室做这个功能”，会创建结构化任务并在这里显示进度。" />;
  if (data.tasks.length === 0) return <PanelEmpty title="任务列表为空" description="当前 .ypi/tasks/ 没有任务目录。" />;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {data.tasks.map((task) => <TaskCard key={task.key} cwd={cwd} task={task} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function TabButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 9px",
        borderRadius: 999,
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--bg-selected)" : "var(--bg)",
        color: active ? "var(--accent)" : "var(--text-muted)",
        cursor: "pointer",
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {label}
    </button>
  );
}

function AgentCard({ agent, active, onClick }: { agent: YpiStudioAgent; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left",
        border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
        background: active ? "var(--bg-selected)" : "var(--bg-panel)",
        color: "var(--text)",
        borderRadius: 12,
        padding: 12,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
        boxShadow: active ? "0 0 0 1px rgba(37,99,235,0.18) inset" : "none",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.name}</span>
        <span style={{ color: agent.isDefault ? "var(--accent)" : "var(--text-dim)", fontSize: 10, fontWeight: 800, flexShrink: 0 }}>
          {agent.isDefault ? "默认" : "自定义"}
        </span>
      </div>
      <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.45 }}>{agent.description}</div>
      <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.pathLabel}</div>
      {agent.readError && <div style={{ color: "#ef4444", fontSize: 11 }}>{agent.readError}</div>}
    </button>
  );
}

function WorkflowCard({ cwd, workflow, onOpenFile }: { cwd: string; workflow: YpiStudioWorkflowFile; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const states = Object.values(workflow.states).sort((a, b) => a.progress - b.progress);
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 800 }}>{workflow.name}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{workflow.description}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 5 }}>{workflow.pathLabel}</div>
        </div>
        <button
          onClick={() => onOpenFile?.(workflowFilePath(cwd, workflow), workflow.fileName)}
          disabled={!onOpenFile}
          style={smallButtonStyle(Boolean(onOpenFile))}
        >
          打开
        </button>
      </div>
      {workflow.readError && <Notice tone="error" text={workflow.readError} />}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {states.map((state) => (
          <span key={state.id} title={state.instruction} style={{ border: "1px solid var(--border)", borderRadius: 999, padding: "3px 7px", color: "var(--text-muted)", fontSize: 11 }}>
            {state.label} · {state.owner} · {state.progress}%
          </span>
        ))}
      </div>
      <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
        触发词：{workflow.triggers.natural?.slice(0, 4).join(" / ") || "—"}
      </div>
    </div>
  );
}

function TaskCard({ cwd, task, onOpenFile }: { cwd: string; task: YpiStudioTaskSummary; onOpenFile?: (filePath: string, fileName: string) => void }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--text)", fontSize: 14, fontWeight: 800 }}>{task.title}</span>
            <Badge label={task.status} tone={statusTone(task.status)} />
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 5 }}>
            {task.workflowName ?? task.workflowId} · 当前：{task.progress.label} · 负责人：{task.currentMember ?? task.progress.owner}
          </div>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 5 }}>{task.pathLabel}</div>
        </div>
        <button
          onClick={() => onOpenFile?.(taskFilePath(cwd, task), "task.json")}
          disabled={!onOpenFile}
          style={smallButtonStyle(Boolean(onOpenFile))}
        >
          打开
        </button>
      </div>
      {task.readError && <Notice tone="error" text={task.readError} />}
      <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, task.progress.percent))}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, color: "var(--text-muted)", fontSize: 11 }}>
        <div>进度：{task.progress.percent}%</div>
        <div>缺失：{task.progress.missingArtifacts.length || 0}</div>
        <div>更新：{formatDate(task.updatedAt)}</div>
      </div>
      {task.progress.missingArtifacts.length > 0 && (
        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
          待产物：{task.progress.missingArtifacts.join("、")}
        </div>
      )}
    </div>
  );
}

function AgentDetail({ cwd, agent, onOpenFile }: { cwd: string; agent: YpiStudioAgent; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const filePath = agentFilePath(cwd, agent);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: 18, lineHeight: 1.25 }}>{agent.name}</h3>
          <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{agent.pathLabel}</div>
        </div>
        <button onClick={() => onOpenFile?.(filePath, agent.fileName)} disabled={!onOpenFile} style={smallButtonStyle(Boolean(onOpenFile))}>
          打开文件
        </button>
      </div>
      {agent.truncated && <Notice tone="warning" text="成员描述预览已在 256 KB 处截断。" />}
      {agent.readError ? (
        <Notice tone="error" text={agent.readError} />
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", padding: 14 }}>
          <MarkdownBody>{agent.content}</MarkdownBody>
        </div>
      )}
    </div>
  );
}

function smallButtonStyle(enabled: boolean): CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-panel)",
    color: enabled ? "var(--text-muted)" : "var(--text-dim)",
    cursor: enabled ? "pointer" : "default",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  };
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "error" | "neutral" }) {
  const color = tone === "success" ? "#16a34a" : tone === "warning" ? "#f59e0b" : tone === "error" ? "#ef4444" : "var(--text-dim)";
  return (
    <span style={{ border: `1px solid ${color}55`, color, borderRadius: 999, padding: "2px 6px", fontSize: 10, fontWeight: 800 }}>
      {label}
    </span>
  );
}

function Notice({ tone, text }: { tone: "success" | "warning" | "error" | "info"; text: string }) {
  const color = tone === "success" ? "#16a34a" : tone === "warning" ? "#f59e0b" : tone === "error" ? "#ef4444" : "var(--accent)";
  const background = tone === "success" ? "rgba(22,163,74,0.10)" : tone === "warning" ? "rgba(245,158,11,0.10)" : tone === "error" ? "rgba(239,68,68,0.10)" : "rgba(37,99,235,0.10)";
  return (
    <div style={{ border: `1px solid ${color}33`, color, background, borderRadius: 8, padding: "7px 9px", fontSize: 12, lineHeight: 1.45 }}>
      {text}
    </div>
  );
}

function PanelEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div style={{ flex: 1, height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center" }}>
      <div style={{ maxWidth: 360 }}>
        <div style={{ color: "var(--text)", fontSize: 15, fontWeight: 800, marginBottom: 8 }}>{title}</div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>{description}</div>
      </div>
    </div>
  );
}
