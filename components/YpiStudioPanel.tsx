"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PiWebStudioConfig, PiWebSubagentModelRef, PiWebSubagentRunPolicy } from "@/lib/pi-web-config";
import type {
  YpiStudioAgent,
  YpiStudioAgentWarning,
  YpiStudioAgentsInitResponse,
  YpiStudioAgentsResponse,
  YpiStudioImplementationCompactTimelineItem,
  YpiStudioImplementationRunProjection,
  YpiStudioImplementationSubtaskProjection,
  YpiStudioImplementationSubtaskStatus,
  YpiStudioSessionRuntimeProjection,
  YpiStudioTaskDetail,
  YpiStudioTaskScope,
  YpiStudioTaskSummary,
  YpiStudioTasksResponse,
  YpiStudioWorkflowFile,
  YpiStudioWorkflowsInitResponse,
  YpiStudioWorkflowsResponse,
} from "@/lib/ypi-studio-types";
import { MarkdownBody } from "./MarkdownBody";
import { TaskWorkflowFlowSection, WorkflowDetailPanel } from "./YpiStudioWorkflowDetail";

interface Props {
  cwd: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  focusedTaskKey?: string | null;
  initialTab?: StudioTab;
  initialScope?: YpiStudioTaskScope;
  refreshKey?: number;
  currentSessionContextId?: string | null;
  onTaskBound?: (task: YpiStudioTaskDetail) => void;
  studioConfig?: PiWebStudioConfig | null;
  onOpenStudioMemberSettings?: (agent: YpiStudioAgent) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";
type LoadOptions = { background?: boolean };
type StudioTab = "members" | "workflows" | "tasks";
type TaskDetailTab = "overview" | "implementation" | "artifacts" | "subagents" | "events" | "metadata";

function agentFilePath(cwd: string, agent: YpiStudioAgent): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${agent.pathLabel.replace(/^\/+/, "")}`;
}

function workflowFilePath(cwd: string, workflow: YpiStudioWorkflowFile): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${workflow.pathLabel.replace(/^\/+/, "")}`;
}

function taskFilePath(cwd: string, task: YpiStudioTaskSummary): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${task.pathLabel.replace(/^\/+/, "")}/task.json`;
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
  return !data?.exists || (data.missingDefaultWorkflows.length ?? 0) > 0 || (data.outdatedDefaultWorkflows?.length ?? 0) > 0;
}

function initButtonLabel(agents: YpiStudioAgentsResponse | null, workflows: YpiStudioWorkflowsResponse | null): string {
  if (!agents?.exists && !workflows?.exists) return "初始化工作室";
  if (needsAgentInit(agents) || needsWorkflowInit(workflows)) return "补齐默认配置";
  return "拉取最新默认配置";
}

function initSuccessMessage(createdAgents: number, createdWorkflows: number, updatedAgents: number, updatedWorkflows: number, overwriteDefaults: boolean): string {
  if (createdAgents + createdWorkflows > 0 || updatedAgents + updatedWorkflows > 0) {
    return `已创建 ${createdAgents} 个成员、${createdWorkflows} 个流程，已更新 ${updatedAgents} 个成员、${updatedWorkflows} 个流程；自定义命名文件未覆盖。`;
  }
  if (overwriteDefaults) return "默认成员和流程已经与内置模板一致，无需更新。";
  return "默认成员和流程已是最新，没有覆盖自定义内容。";
}

function initWarningMessage(warnings: YpiStudioAgentWarning[]): string | null {
  if (warnings.length === 0) return null;
  const fileNames = warnings.map((warning) => warning.fileName || warning.pathLabel);
  const list = warnings.length > 3 ? `${fileNames.slice(0, 3).join("、")} 等 ${warnings.length} 个` : fileNames.join("、");
  return `发现 ${warnings.length} 个自定义成员仍含内部引用，已跳过覆盖：${list}。可打开文件手动清理。`;
}

function formatModelRef(model: PiWebSubagentModelRef): string {
  if (model.mode === "specific") return `${model.provider ?? "unknown"}/${model.modelId ?? "unknown"}`;
  if (model.mode === "followMain") return "跟随主会话";
  if (model.mode === "piDefault") return "Pi 默认";
  return "使用默认策略";
}

function formatThinking(value: PiWebSubagentRunPolicy["thinking"]): string {
  if (value === "inherit") return "跟随主会话";
  if (value === "off") return "关闭";
  return value;
}

function memberPolicySummary(agent: YpiStudioAgent, studioConfig: PiWebStudioConfig | null | undefined): { model: string; thinking: string; source: string; detail: string } {
  if (!studioConfig) {
    return { model: "模型配置不可用", thinking: "—", source: "web-config 未加载", detail: "可打开 Settings → Studio 查看或修复本机配置。" };
  }
  const memberPolicy = studioConfig.members[agent.id];
  const policy = memberPolicy ?? studioConfig.defaultPolicy;
  const defaultModel = studioConfig.defaultPolicy.model.mode === "unset"
    ? "跟随主会话 → Pi 默认"
    : formatModelRef(studioConfig.defaultPolicy.model);
  const modelUsesDefault = !memberPolicy || memberPolicy.model.mode === "unset";
  const model = modelUsesDefault
    ? (memberPolicy ? `使用默认策略 · ${defaultModel}` : defaultModel)
    : formatModelRef(policy.model);
  const source = memberPolicy
    ? (memberPolicy.model.mode === "unset" ? "成员配置：模型落到默认策略" : "成员配置")
    : (studioConfig.defaultPolicy.model.mode === "unset" ? "默认策略（unset，运行时回退）" : "默认策略");
  const thinking = formatThinking(policy.thinking);
  return { model, thinking, source, detail: `解析链：工具入参 > 成员配置 > 默认策略 > 主会话 > Pi 默认。当前卡片展示 Settings 中的成员/默认策略，不改变运行时优先级。` };
}

function statusTone(status: string): "success" | "warning" | "error" | "neutral" {
  if (status === "completed" || status === "ready" || status === "archived" || status === "done" || status === "skipped") return "success";
  if (status === "blocked" || status === "changes_requested") return "warning";
  if (status === "cancelled" || status === "failed") return "error";
  return "neutral";
}

export function YpiStudioPanel({ cwd, onOpenFile, focusedTaskKey = null, initialTab, initialScope, refreshKey = 0, currentSessionContextId = null, onTaskBound, studioConfig, onOpenStudioMemberSettings }: Props) {
  const [activeTab, setActiveTab] = useState<StudioTab>(initialTab ?? "members");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [workflowLoadState, setWorkflowLoadState] = useState<LoadState>("idle");
  const [taskLoadState, setTaskLoadState] = useState<LoadState>("idle");
  const [data, setData] = useState<YpiStudioAgentsResponse | null>(null);
  const [workflowsData, setWorkflowsData] = useState<YpiStudioWorkflowsResponse | null>(null);
  const [tasksData, setTasksData] = useState<YpiStudioTasksResponse | null>(null);
  const tasksDataRef = useRef<YpiStudioTasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [taskScope, setTaskScope] = useState<YpiStudioTaskScope>(initialScope ?? "active");
  const [initMessage, setInitMessage] = useState<string | null>(null);
  const [initWarning, setInitWarning] = useState<string | null>(null);
  const initialLoadCwdRef = useRef<string | null>(null);
  const taskScopeLoadRef = useRef<{ cwd: string; scope: YpiStudioTaskScope } | null>(null);

  useEffect(() => { tasksDataRef.current = tasksData; }, [tasksData]);

  const loadAgents = useCallback(async (signal?: AbortSignal, options: LoadOptions = {}) => {
    if (!cwd) {
      setData(null);
      setSelectedKey(null);
      setLoadState("idle");
      setError(null);
      setInitWarning(null);
      return;
    }

    if (!options.background) setLoadState("loading");
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

  const loadWorkflows = useCallback(async (signal?: AbortSignal, options: LoadOptions = {}) => {
    if (!cwd) {
      setWorkflowsData(null);
      setWorkflowLoadState("idle");
      return;
    }

    if (!options.background) setWorkflowLoadState("loading");
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

  const loadTasks = useCallback(async (signal?: AbortSignal, options: LoadOptions = {}) => {
    if (!cwd) {
      setTasksData(null);
      setTaskLoadState("idle");
      return;
    }

    const canRefreshInBackground = options.background && !!tasksDataRef.current;
    if (!canRefreshInBackground) setTaskLoadState("loading");
    try {
      const res = await fetch(`/api/studio/tasks?cwd=${encodeURIComponent(cwd)}&scope=${taskScope}`, { signal });
      const body = await res.json() as YpiStudioTasksResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setTasksData(body);
      setTaskLoadState("ready");
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
      if (!canRefreshInBackground) setTaskLoadState("error");
    }
  }, [cwd, taskScope]);

  const loadInitialData = useCallback((signal?: AbortSignal) => {
    if (activeTab === "tasks") {
      void loadTasks(signal);
      void loadAgents(signal, { background: true });
      void loadWorkflows(signal, { background: true });
    } else if (activeTab === "workflows") {
      void loadWorkflows(signal);
      void loadAgents(signal, { background: true });
      void loadTasks(signal, { background: true });
    } else {
      void loadAgents(signal);
      void loadWorkflows(signal, { background: true });
      void loadTasks(signal, { background: true });
    }
  }, [activeTab, loadAgents, loadTasks, loadWorkflows]);

  const handleArchiveTask = useCallback(async (task: YpiStudioTaskSummary) => {
    if (!cwd || task.archived || task.status !== "completed") return;
    const ok = window.confirm("归档会移动任务目录并生成 .ypi/knowledge 知识条目。页面归档无法调用当前聊天模型，将使用任务产物生成兜底摘要；如需模型整理，请在聊天中执行 /studio-archive。仍要归档吗？");
    if (!ok) return;
    setError(null);
    try {
      const res = await fetch(`/api/studio/tasks/${encodeURIComponent(task.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "archive", reason: "Archived from Studio Panel", allowFallbackKnowledge: true }),
      });
      const body = await res.json() as { error?: string; warnings?: string[] };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (body.warnings?.length) setInitWarning(body.warnings.join("；"));
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [cwd, loadTasks]);

  useEffect(() => {
    if (!cwd) {
      initialLoadCwdRef.current = null;
      return;
    }
    if (initialLoadCwdRef.current === cwd) return;
    initialLoadCwdRef.current = cwd;
    taskScopeLoadRef.current = { cwd, scope: taskScope };
    const controller = new AbortController();
    loadInitialData(controller.signal);
    return () => controller.abort();
  }, [cwd, loadInitialData, taskScope]);

  useEffect(() => {
    const controller = new AbortController();
    if (activeTab === "members" && loadState === "idle") void loadAgents(controller.signal);
    if (activeTab === "workflows" && workflowLoadState === "idle") void loadWorkflows(controller.signal);
    if (activeTab === "tasks" && taskLoadState === "idle") void loadTasks(controller.signal);
    return () => controller.abort();
  }, [activeTab, loadAgents, loadState, loadTasks, taskLoadState, loadWorkflows, workflowLoadState]);

  useEffect(() => {
    if (!focusedTaskKey) return;
    setActiveTab("tasks");
    setTaskScope(focusedTaskKey.startsWith("archived:") ? "archived" : "active");
  }, [focusedTaskKey]);

  useEffect(() => {
    if (!cwd || initialLoadCwdRef.current !== cwd) return;
    if (taskScopeLoadRef.current?.cwd === cwd && taskScopeLoadRef.current.scope === taskScope) return;
    taskScopeLoadRef.current = { cwd, scope: taskScope };
    const controller = new AbortController();
    void loadTasks(controller.signal);
    return () => controller.abort();
  }, [cwd, loadTasks, taskScope]);

  useEffect(() => {
    if (refreshKey === 0) return;
    void loadTasks(undefined, { background: true });
  }, [loadTasks, refreshKey]);

  const selectedAgent = useMemo(() => {
    if (!data?.agents.length) return null;
    return data.agents.find((agent) => agent.key === selectedKey) ?? data.agents[0] ?? null;
  }, [data, selectedKey]);

  const handleInit = useCallback(async () => {
    if (!cwd || initBusy) return;
    const overwriteDefaults = !!data?.exists && !!workflowsData?.exists && !needsAgentInit(data) && !needsWorkflowInit(workflowsData);
    if (overwriteDefaults) {
      const ok = window.confirm("将用当前内置模板覆盖 .ypi/agents 和 .ypi/workflows 中同名默认成员/流程文件；自定义命名文件不会覆盖。继续吗？");
      if (!ok) return;
    }
    setInitBusy(true);
    setInitMessage(null);
    setInitWarning(null);
    setError(null);
    try {
      const [agentsRes, workflowsRes] = await Promise.all([
        fetch("/api/studio/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, overwriteDefaults }),
        }),
        fetch("/api/studio/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cwd, overwriteDefaults }),
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
      const updatedWorkflows = workflowsBody.updated.length;
      setInitMessage(initSuccessMessage(createdAgents, createdWorkflows, updatedAgents, updatedWorkflows, overwriteDefaults));
      setInitWarning(initWarningMessage(agentsBody.warnings));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoadState("error");
    } finally {
      setInitBusy(false);
    }
  }, [cwd, data, initBusy, loadTasks, workflowsData]);

  if (!cwd) {
    return <PanelEmpty title="请选择项目空间" description="选择一个会话或工作目录后，可在该项目根目录初始化 .ypi/agents/、.ypi/workflows/ 和工作室任务。" />;
  }

  const canInitialize = needsAgentInit(data) || needsWorkflowInit(workflowsData);
  const canPullDefaultTemplates = !!data?.exists && !!workflowsData?.exists && !canInitialize;

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
              background: canInitialize || canPullDefaultTemplates ? "var(--accent)" : "var(--bg)",
              color: canInitialize || canPullDefaultTemplates ? "white" : "var(--text-muted)",
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
          工作室包含成员、结构化流程和任务状态机。初始化会补齐缺失默认文件；配置已存在时可手动拉取最新内置默认模板，覆盖同名默认成员/流程文件但不覆盖自定义命名文件。
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
        <MembersTab loadState={loadState} data={data} selectedAgent={selectedAgent} selectedKey={selectedKey} setSelectedKey={setSelectedKey} onOpenFile={onOpenFile} studioConfig={studioConfig} onOpenStudioMemberSettings={onOpenStudioMemberSettings} />
      ) : activeTab === "workflows" ? (
        <WorkflowsTab cwd={cwd} loadState={workflowLoadState} data={workflowsData} onOpenFile={onOpenFile} />
      ) : (
        <TasksTab cwd={cwd} scope={taskScope} setScope={setTaskScope} loadState={taskLoadState} data={tasksData} workflowsData={workflowsData} onOpenFile={onOpenFile} onArchiveTask={handleArchiveTask} focusedTaskKey={focusedTaskKey} currentSessionContextId={currentSessionContextId} onTaskBound={onTaskBound} reloadTasks={loadTasks} />
      )}
    </div>
  );
}

function MembersTab({ loadState, data, selectedAgent, selectedKey, setSelectedKey, onOpenFile, studioConfig, onOpenStudioMemberSettings }: {
  loadState: LoadState;
  data: YpiStudioAgentsResponse | null;
  selectedAgent: YpiStudioAgent | null;
  selectedKey: string | null;
  setSelectedKey: (key: string) => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  studioConfig?: PiWebStudioConfig | null;
  onOpenStudioMemberSettings?: (agent: YpiStudioAgent) => void;
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
            <AgentCard key={agent.key} agent={agent} active={selectedKey === agent.key} policy={memberPolicySummary(agent, studioConfig)} onClick={() => setSelectedKey(agent.key)} onOpenSettings={onOpenStudioMemberSettings ? () => onOpenStudioMemberSettings(agent) : undefined} />
          ))}
        </div>
      </div>
      <div style={{ minHeight: 0, overflowY: "auto" }}>
        {selectedAgent && <AgentDetail cwd={data.cwd} agent={selectedAgent} onOpenFile={onOpenFile} policy={memberPolicySummary(selectedAgent, studioConfig)} onOpenSettings={onOpenStudioMemberSettings ? () => onOpenStudioMemberSettings(selectedAgent) : undefined} />}
      </div>
    </div>
  );
}

function WorkflowsTab({ cwd, loadState, data, onOpenFile }: { cwd: string; loadState: LoadState; data: YpiStudioWorkflowsResponse | null; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const [detailWorkflowKey, setDetailWorkflowKey] = useState<string | null>(null);
  const detailWorkflow = detailWorkflowKey ? data?.workflows.find((workflow) => workflow.key === detailWorkflowKey || workflow.id === detailWorkflowKey) ?? null : null;

  useEffect(() => {
    setDetailWorkflowKey((current) => current && data?.workflows.some((workflow) => workflow.key === current || workflow.id === current) ? current : null);
  }, [data?.workflows]);

  if (loadState === "loading") return <PanelEmpty title="正在读取工作室流程" description="检查当前项目的 .ypi/workflows/ 目录。" />;
  if (loadState === "error" && !data) return <PanelEmpty title="读取失败" description="请检查上方错误信息。" />;
  if (!data?.exists) return <PanelEmpty title="尚未初始化流程" description="点击“初始化工作室”会创建默认工作流 JSON：功能开发、Bug 修复、UI 改动、只检查。" />;
  if (data.workflows.length === 0) return <PanelEmpty title="没有流程文件" description=".ypi/workflows/ 已存在，但没有可读取的 JSON 流程文件。" />;
  if (detailWorkflow) return <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12 }}><WorkflowDetailPanel cwd={cwd} workflow={detailWorkflow} onBack={() => setDetailWorkflowKey(null)} onOpenFile={onOpenFile} /></div>;

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {data.workflows.map((workflow) => <WorkflowCard key={workflow.key} cwd={cwd} workflow={workflow} onSelect={() => setDetailWorkflowKey(workflow.key)} onOpenFile={onOpenFile} />)}
    </div>
  );
}

function TasksTab({ cwd, scope, setScope, loadState, data, workflowsData, onOpenFile, onArchiveTask, focusedTaskKey, currentSessionContextId, onTaskBound, reloadTasks }: {
  cwd: string;
  scope: YpiStudioTaskScope;
  setScope: (scope: YpiStudioTaskScope) => void;
  loadState: LoadState;
  data: YpiStudioTasksResponse | null;
  workflowsData: YpiStudioWorkflowsResponse | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
  onArchiveTask: (task: YpiStudioTaskSummary) => void;
  focusedTaskKey?: string | null;
  currentSessionContextId?: string | null;
  onTaskBound?: (task: YpiStudioTaskDetail) => void;
  reloadTasks: (signal?: AbortSignal, options?: LoadOptions) => Promise<void>;
}) {
  const focusedRef = useRef<HTMLDivElement | null>(null);
  const [detailTaskKey, setDetailTaskKey] = useState<string | null>(focusedTaskKey ?? null);
  const [taskDetail, setTaskDetail] = useState<YpiStudioTaskDetail | null>(null);
  const taskDetailRef = useRef<YpiStudioTaskDetail | null>(null);
  const [detailLoadState, setDetailLoadState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<TaskDetailTab>("overview");
  const [bindBusyKey, setBindBusyKey] = useState<string | null>(null);
  const [bindMessage, setBindMessage] = useState<string | null>(null);

  useEffect(() => { taskDetailRef.current = taskDetail; }, [taskDetail]);

  useEffect(() => {
    if (!focusedTaskKey || !focusedRef.current) return;
    focusedRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [focusedTaskKey, data?.tasks]);

  useEffect(() => {
    if (!data?.tasks.length) {
      setDetailTaskKey(null);
      return;
    }
    if (focusedTaskKey && data.tasks.some((task) => task.key === focusedTaskKey)) {
      setDetailTaskKey(focusedTaskKey);
      return;
    }
    setDetailTaskKey((current) => current && data.tasks.some((task) => task.key === current) ? current : null);
  }, [data?.tasks, focusedTaskKey]);

  useEffect(() => {
    if (!detailTaskKey) {
      setTaskDetail(null);
      setDetailLoadState("idle");
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    const hasExistingDetail = !!taskDetailRef.current;
    if (!hasExistingDetail) setDetailLoadState("loading");
    setDetailError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/studio/tasks/${encodeURIComponent(detailTaskKey)}?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal });
        const body = await res.json() as { task?: YpiStudioTaskDetail; error?: string };
        if (!res.ok || body.error || !body.task) throw new Error(body.error ?? `HTTP ${res.status}`);
        setTaskDetail(body.task);
        setDetailLoadState("ready");
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!hasExistingDetail) setTaskDetail(null);
        setDetailError(err instanceof Error ? err.message : String(err));
        setDetailLoadState(hasExistingDetail ? "ready" : "error");
      }
    })();
    return () => controller.abort();
  }, [cwd, detailTaskKey, data?.tasks]);

  const handleBindTask = useCallback(async (task: YpiStudioTaskSummary | YpiStudioTaskDetail) => {
    if (!currentSessionContextId || task.archived || bindBusyKey) return;
    setBindBusyKey(task.key);
    setBindMessage(null);
    setDetailError(null);
    try {
      const res = await fetch(`/api/studio/tasks/${encodeURIComponent(task.key)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd, action: "bind", contextId: currentSessionContextId }),
      });
      const body = await res.json() as { task?: YpiStudioTaskDetail; error?: string };
      if (!res.ok || body.error || !body.task) throw new Error(body.error ?? `HTTP ${res.status}`);
      setBindMessage("已绑定到当前聊天。后续确认/继续会在当前聊天上下文中生效。");
      if (detailTaskKey === task.key) setTaskDetail(body.task);
      onTaskBound?.(body.task);
      await reloadTasks(undefined, { background: true });
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err));
      setBindMessage(null);
    } finally {
      setBindBusyKey(null);
    }
  }, [bindBusyKey, currentSessionContextId, cwd, detailTaskKey, onTaskBound, reloadTasks]);

  const scopeControls = (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <TabButton active={scope === "active"} label="活跃" onClick={() => setScope("active")} />
      <TabButton active={scope === "archived"} label="已归档" onClick={() => setScope("archived")} />
      <TabButton active={scope === "all"} label="全部" onClick={() => setScope("all")} />
    </div>
  );

  let content: ReactNode;
  if (loadState === "loading" && !data) content = <PanelEmpty title="正在读取工作室任务" description="检查当前项目的 .ypi/tasks/ 目录。" />;
  else if (loadState === "error" && !data) content = <PanelEmpty title="读取失败" description="请检查上方错误信息。" />;
  else if (!data?.exists) content = <PanelEmpty title="还没有工作室任务" description="通过 /studio-start，或直接说“用工作室做这个功能”，会创建结构化任务并在这里显示进度。" />;
  else if (data.tasks.length === 0) content = <PanelEmpty title="任务列表为空" description={scope === "archived" ? "当前没有已归档任务。" : "当前筛选范围没有任务目录。"} />;
  else if (detailTaskKey) content = (
    <TaskDetailPanel
      cwd={cwd}
      task={taskDetail}
      loadState={detailLoadState}
      error={detailError}
      activeTab={detailTab}
      setActiveTab={setDetailTab}
      onBack={() => setDetailTaskKey(null)}
      onOpenFile={onOpenFile}
      workflow={taskDetail ? workflowsData?.workflows.find((workflow) => workflow.id === taskDetail.workflowId || workflow.key === taskDetail.workflowId) ?? null : null}
      currentSessionContextId={currentSessionContextId}
      bindBusy={bindBusyKey === detailTaskKey}
      bindMessage={bindMessage}
      onBindTask={handleBindTask}
    />
  );
  else content = (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.tasks.map((task) => (
        <div key={task.key} ref={task.key === focusedTaskKey ? focusedRef : undefined}>
          <TaskCard
            focused={task.key === focusedTaskKey}
            selected={false}
            cwd={cwd}
            task={task}
            onSelect={() => setDetailTaskKey(task.key)}
            onOpenFile={onOpenFile}
            onArchiveTask={onArchiveTask}
            currentSessionContextId={currentSessionContextId}
            bindBusy={bindBusyKey === task.key}
            onBindTask={handleBindTask}
          />
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      {!detailTaskKey && scopeControls}
      {!detailTaskKey && bindMessage && <Notice tone="success" text={bindMessage} />}
      {content}
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

function AgentCard({ agent, active, policy, onClick, onOpenSettings }: { agent: YpiStudioAgent; active: boolean; policy: ReturnType<typeof memberPolicySummary>; onClick: () => void; onOpenSettings?: () => void }) {
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
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
      <div title={policy.detail} style={{ display: "flex", flexDirection: "column", gap: 3, padding: 8, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
        <div style={{ color: "var(--text)", fontSize: 11, fontWeight: 700, overflowWrap: "anywhere" }}>模型：{policy.model}</div>
        <div style={{ color: "var(--text-muted)", fontSize: 11 }}>thinking：{policy.thinking}</div>
        <div style={{ color: "var(--text-dim)", fontSize: 10 }}>来源：{policy.source}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{agent.pathLabel}</div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onOpenSettings?.(); }}
          onKeyDown={(event) => event.stopPropagation()}
          disabled={!onOpenSettings}
          style={smallButtonStyle(Boolean(onOpenSettings))}
        >
          修改模型
        </button>
      </div>
      {agent.readError && <div style={{ color: "#ef4444", fontSize: 11 }}>{agent.readError}</div>}
    </div>
  );
}

function WorkflowCard({ cwd, workflow, onSelect, onOpenFile }: { cwd: string; workflow: YpiStudioWorkflowFile; onSelect: () => void; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const states = Object.values(workflow.states).sort((a, b) => a.progress - b.progress);
  return (
    <div onClick={onSelect} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onSelect(); }} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10, cursor: "pointer" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 14, fontWeight: 800 }}>{workflow.name}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4, lineHeight: 1.45 }}>{workflow.description}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 5 }}>{workflow.pathLabel}</div>
        </div>
        <button
          onClick={(event) => { event.stopPropagation(); onOpenFile?.(workflowFilePath(cwd, workflow), workflow.fileName); }}
          onKeyDown={(event) => event.stopPropagation()}
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

function TaskCard({ cwd, task, focused = false, selected = false, onSelect, onOpenFile, onArchiveTask, currentSessionContextId, bindBusy = false, onBindTask }: { cwd: string; task: YpiStudioTaskSummary; focused?: boolean; selected?: boolean; onSelect?: () => void; onOpenFile?: (filePath: string, fileName: string) => void; onArchiveTask: (task: YpiStudioTaskSummary) => void; currentSessionContextId?: string | null; bindBusy?: boolean; onBindTask?: (task: YpiStudioTaskSummary) => void }) {
  const canArchive = !task.archived && task.status === "completed";
  const canBind = !task.archived && !!currentSessionContextId;
  const alreadyBound = !!currentSessionContextId && task.contextIds.includes(currentSessionContextId);
  const highlighted = focused || selected || alreadyBound;
  return (
    <div onClick={onSelect} role={onSelect ? "button" : undefined} tabIndex={onSelect ? 0 : undefined} onKeyDown={(event) => { if (onSelect && (event.key === "Enter" || event.key === " ")) onSelect(); }} style={{ border: `1px solid ${highlighted ? "var(--accent)" : "var(--border)"}`, borderRadius: 12, background: highlighted ? "var(--bg-selected)" : "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10, boxShadow: highlighted ? "0 0 0 1px rgba(37,99,235,0.18) inset" : "none", cursor: onSelect ? "pointer" : "default" }}>
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
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          {canBind && (
            <button
              onClick={(event) => { event.stopPropagation(); onBindTask?.(task); }}
              onKeyDown={(event) => event.stopPropagation()}
              disabled={bindBusy || alreadyBound}
              title={alreadyBound ? "该任务已绑定到当前聊天" : "把这个任务绑定到当前聊天，便于继续审批和实现"}
              style={smallButtonStyle(!bindBusy && !alreadyBound)}
            >
              {bindBusy ? "绑定中…" : alreadyBound ? "已绑定" : "绑定/继续"}
            </button>
          )}
          {canArchive && (
            <button
              onClick={(event) => { event.stopPropagation(); onArchiveTask(task); }}
              onKeyDown={(event) => event.stopPropagation()}
              style={smallButtonStyle(true)}
            >
              归档
            </button>
          )}
          <button
            onClick={(event) => { event.stopPropagation(); onOpenFile?.(taskFilePath(cwd, task), "task.json"); }}
            onKeyDown={(event) => event.stopPropagation()}
            disabled={!onOpenFile}
            style={smallButtonStyle(Boolean(onOpenFile))}
          >
            打开
          </button>
        </div>
      </div>
      {task.readError && <Notice tone="error" text={task.readError} />}
      {task.archived && (
        <Notice tone="info" text={`归档于 ${formatDate(task.archivedAt ?? task.updatedAt)}${task.knowledgePath ? ` · 知识：${task.knowledgePath}` : ""}`} />
      )}
      <div style={{ height: 6, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}>
        <div style={{ width: `${Math.max(0, Math.min(100, task.progress.percent))}%`, height: "100%", background: "var(--accent)", borderRadius: 999 }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, color: "var(--text-muted)", fontSize: 11 }}>
        <div>进度：{task.progress.percent}%</div>
        <div>缺失：{task.progress.missingArtifacts.length || 0}</div>
        <div>更新：{formatDate(task.updatedAt)}</div>
      </div>
      {task.implementation && task.implementation.total > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", color: "var(--text-dim)", fontSize: 11 }}>
          <span>子任务：{task.implementation.done + task.implementation.skipped}/{task.implementation.total}</span>
          {task.implementation.activeTitle && <span>当前：{task.implementation.activeTitle}</span>}
          {!task.implementation.activeTitle && task.implementation.nextTitle && <span>下一个：{task.implementation.nextTitle}</span>}
          {task.implementation.blocked > 0 && <span style={{ color: "#f59e0b" }}>阻塞：{task.implementation.blocked}</span>}
        </div>
      )}
      {task.progress.missingArtifacts.length > 0 && (
        <div style={{ color: "var(--text-dim)", fontSize: 11 }}>
          待产物：{task.progress.missingArtifacts.join("、")}
        </div>
      )}
    </div>
  );
}

function TaskDetailPanel({ cwd, task, workflow, loadState, error, activeTab, setActiveTab, onBack, onOpenFile, currentSessionContextId, bindBusy = false, bindMessage, onBindTask }: {
  cwd: string;
  task: YpiStudioTaskDetail | null;
  workflow: YpiStudioWorkflowFile | null;
  loadState: LoadState;
  error: string | null;
  activeTab: TaskDetailTab;
  setActiveTab: (tab: TaskDetailTab) => void;
  onBack: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
  currentSessionContextId?: string | null;
  bindBusy?: boolean;
  bindMessage?: string | null;
  onBindTask?: (task: YpiStudioTaskDetail) => void;
}) {
  if (loadState === "loading") return <TaskDetailShell onBack={onBack}><PanelEmpty title="正在读取任务详情" description="加载任务产物、成员运行、事件和元数据。" /></TaskDetailShell>;
  if (loadState === "error") return <TaskDetailShell onBack={onBack}><PanelEmpty title="详情读取失败" description={error ?? "请稍后重试。"} /></TaskDetailShell>;
  if (!task) return <TaskDetailShell onBack={onBack}><PanelEmpty title="选择一个任务" description="点击任务卡片查看完整详情。" /></TaskDetailShell>;
  const canBind = !task.archived && !!currentSessionContextId;
  const alreadyBound = !!currentSessionContextId && task.contextIds.includes(currentSessionContextId);
  const detailMachinePhase = task.implementationProjection
    ? implementationMachinePhase(task, implementationStatusCounts(task, task.implementationProjection.subtasksWithStatus), task.implementationProjection.sessionRuntime)
    : null;

  return (
    <TaskDetailShell onBack={onBack}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <h3 style={{ margin: 0, color: "var(--text)", fontSize: 16, lineHeight: 1.3 }}>{task.title}</h3>
            <Badge label={task.status} tone={statusTone(task.status)} />
            {detailMachinePhase && <Badge label={detailMachinePhase.label} tone={detailMachinePhase.tone} />}
          </div>
          <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{task.key}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {canBind && (
            <button
              onClick={() => onBindTask?.(task)}
              disabled={bindBusy || alreadyBound}
              title={alreadyBound ? "该任务已绑定到当前聊天" : "把这个任务绑定到当前聊天，便于继续审批和实现"}
              style={smallButtonStyle(!bindBusy && !alreadyBound)}
            >
              {bindBusy ? "绑定中…" : alreadyBound ? "已绑定当前聊天" : "绑定/继续到当前聊天"}
            </button>
          )}
          <button onClick={() => onOpenFile?.(taskFilePath(cwd, task), "task.json")} disabled={!onOpenFile} style={smallButtonStyle(Boolean(onOpenFile))}>打开 task.json</button>
        </div>
      </div>
      {bindMessage && <Notice tone="success" text={bindMessage} />}
      {canBind && !alreadyBound && <Notice tone="info" text="绑定只会关联当前聊天上下文，方便后续继续/审批；不会跳过 awaiting_approval 门禁，也不会自动进入实现。" />}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <TabButton active={activeTab === "overview"} label="概览" onClick={() => setActiveTab("overview")} />
        <TabButton active={activeTab === "implementation"} label={`实现 ${task.implementation?.done ?? 0}/${task.implementation?.total ?? 0}`} onClick={() => setActiveTab("implementation")} />
        <TabButton active={activeTab === "artifacts"} label={`产物 ${Object.keys(task.artifacts).length}`} onClick={() => setActiveTab("artifacts")} />
        <TabButton active={activeTab === "subagents"} label={`成员运行 ${task.subagents.length}`} onClick={() => setActiveTab("subagents")} />
        <TabButton active={activeTab === "events"} label={`事件 ${task.events.length}`} onClick={() => setActiveTab("events")} />
        <TabButton active={activeTab === "metadata"} label="元数据" onClick={() => setActiveTab("metadata")} />
      </div>
      {activeTab === "overview" ? <TaskOverviewTab task={task} workflow={workflow} />
        : activeTab === "implementation" ? <TaskImplementationTab task={task} />
        : activeTab === "artifacts" ? <TaskArtifactsTab cwd={cwd} task={task} onOpenFile={onOpenFile} />
        : activeTab === "subagents" ? <TaskSubagentsTab task={task} />
        : activeTab === "events" ? <TaskEventsTab task={task} />
        : <TaskMetadataTab task={task} />}
    </TaskDetailShell>
  );
}

function TaskDetailShell({ onBack, children }: { onBack: () => void; children: ReactNode }) {
  return (
    <div style={{ minHeight: 0, flex: 1, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={smallButtonStyle(true)}>← 返回任务列表</button>
      </div>
      {children}
    </div>
  );
}

function TaskOverviewTab({ task, workflow }: { task: YpiStudioTaskDetail; workflow: YpiStudioWorkflowFile | null }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ height: 8, borderRadius: 999, background: "var(--border)", overflow: "hidden" }}><div style={{ width: `${Math.max(0, Math.min(100, task.progress.percent))}%`, height: "100%", background: "var(--accent)" }} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
        <DetailRow label="进度" value={`${task.progress.label} · ${task.progress.percent}%`} />
        <DetailRow label="流程" value={task.workflowName ? `${task.workflowName} (${task.workflowId})` : task.workflowId} />
        <DetailRow label="负责人" value={task.currentMember ?? task.progress.owner} />
        <DetailRow label="创建" value={formatDateTime(task.createdAt)} />
        <DetailRow label="更新" value={formatDateTime(task.updatedAt)} />
        <DetailRow label="完成" value={task.completedAt ? formatDateTime(task.completedAt) : "—"} />
      </div>
      <TaskWorkflowFlowSection task={task} workflow={workflow} />
      <TaskExecutionFlowSection task={task} />
      <SectionCard title="路径与上下文">
        <DetailRow label="目录" value={task.pathLabel} mono />
        <DetailRow label="CWD" value={task.cwd} mono />
        <DetailRow label="上下文" value={task.contextIds.length ? task.contextIds.join("、") : "—"} mono />
      </SectionCard>
      {task.implementation && <SectionCard title="实现拆解摘要">
        <DetailRow label="完成" value={`${task.implementation.done + task.implementation.skipped}/${task.implementation.total}`} />
        <DetailRow label="当前" value={task.implementation.activeTitle ?? task.implementation.activeSubtaskId ?? "—"} />
        <DetailRow label="下一个" value={task.implementation.nextTitle ?? task.implementation.nextSubtaskId ?? "—"} />
        <DetailRow label="阻塞" value={task.implementation.blockedTitles.length ? task.implementation.blockedTitles.join("、") : String(task.implementation.blocked)} />
      </SectionCard>}
      {task.archived && <SectionCard title="归档信息">
        <DetailRow label="归档月份" value={task.archiveMonth ?? "—"} />
        <DetailRow label="归档时间" value={formatDateTime(task.archivedAt ?? "")} />
        <DetailRow label="原因" value={task.archiveReason ?? "—"} />
        <DetailRow label="知识路径" value={task.knowledgePath ?? "—"} mono />
      </SectionCard>}
      {task.readError && <Notice tone="error" text={task.readError} />}
    </div>
  );
}



const IMPLEMENTATION_STATUS_ORDER: YpiStudioImplementationSubtaskStatus[] = ["running", "queued", "failed", "blocked", "ready", "waiting", "pending", "done", "skipped"];
const IMPLEMENTATION_TERMINAL_STATUSES = new Set<YpiStudioImplementationSubtaskStatus>(["done", "skipped"]);

type ImplementationMachineTone = "success" | "warning" | "error" | "neutral";
type ImplementationMachinePhase = {
  label: string;
  tone: ImplementationMachineTone;
  nextAction: string;
  waitingLabel: string;
};

function displayImplementationStatus(status: YpiStudioImplementationSubtaskStatus | undefined): string {
  return status === "pending" ? "waiting" : status ?? "waiting";
}

function implementationStatusLabel(status: YpiStudioImplementationSubtaskStatus): string {
  const labels: Record<YpiStudioImplementationSubtaskStatus, string> = {
    pending: "waiting (legacy)",
    waiting: "waiting",
    ready: "ready",
    queued: "queued",
    running: "running",
    blocked: "blocked",
    failed: "failed",
    done: "done",
    skipped: "skipped",
  };
  return labels[status];
}

function implementationStatusCounts(task: YpiStudioTaskDetail, subtasks: YpiStudioImplementationSubtaskProjection[]): Record<YpiStudioImplementationSubtaskStatus, number> {
  const counts = Object.fromEntries(IMPLEMENTATION_STATUS_ORDER.map((status) => [status, 0])) as Record<YpiStudioImplementationSubtaskStatus, number>;
  const projectionCounts = task.implementationProjection?.statusCounts;
  if (projectionCounts) {
    for (const status of IMPLEMENTATION_STATUS_ORDER) counts[status] = projectionCounts[status] ?? 0;
    return counts;
  }
  for (const subtask of subtasks) counts[subtask.status] = (counts[subtask.status] ?? 0) + 1;
  return counts;
}

function implementationMachinePhase(task: YpiStudioTaskDetail, counts: Record<YpiStudioImplementationSubtaskStatus, number>, runtime?: YpiStudioSessionRuntimeProjection): ImplementationMachinePhase {
  const active = counts.running + counts.queued;
  const unfinished = counts.running + counts.queued + counts.ready + counts.waiting + counts.pending + counts.blocked + counts.failed;
  if (runtime?.status === "needs_user" || counts.failed > 0 || counts.blocked > 0 || task.status === "blocked" || task.status === "changes_requested") {
    return { label: "需要处理", tone: "error", waitingLabel: "需要用户处理", nextAction: runtime?.message ?? "请先查看失败、阻塞或等待用户输入的子任务，再决定重试、修复或调整计划。" };
  }
  if (task.status === "checking") return { label: "正在检查", tone: "warning", waitingLabel: "检查中", nextAction: "实现子任务已完成，主会话下一步会收集检查结果并决定完成或请求修改。" };
  if (runtime?.status === "completed" || task.status === "completed" || (unfinished === 0 && counts.done + counts.skipped > 0)) {
    return { label: "已完成", tone: "success", waitingLabel: "已完成", nextAction: "实现拆解已完成；如任务已归档，这里仅保留只读记录。" };
  }
  if (runtime?.status === "waiting_for_studio_children" || active > 0) {
    return { label: "等待子任务", tone: "warning", waitingLabel: "正在等待并行子任务", nextAction: runtime?.message ?? "主会话正在等待运行中/队列中的子任务完成；完成后会继续收集结果并推进下一步。" };
  }
  if (counts.ready > 0 || task.implementationProjection?.nextSubtaskIds.length) {
    return { label: "继续派发", tone: "neutral", waitingLabel: "有就绪子任务", nextAction: "依赖已满足；主会话下一步应 claim 并派发就绪子任务。" };
  }
  if (counts.waiting + counts.pending > 0) return { label: "等待子任务", tone: "neutral", waitingLabel: "等待依赖满足", nextAction: "仍有子任务在等待依赖完成；面板下方显示 waitingOn / blockedBy 摘要。" };
  return { label: "等待子任务", tone: "neutral", waitingLabel: "等待状态刷新", nextAction: "暂无运行或就绪子任务；如长时间不变，请让主会话查看进度。" };
}

function buildImplementationSubtasks(task: YpiStudioTaskDetail): YpiStudioImplementationSubtaskProjection[] {
  if (task.implementationProjection?.subtasksWithStatus.length) return task.implementationProjection.subtasksWithStatus;
  const plan = task.implementationPlan;
  const progress = task.implementationProgress;
  if (!plan) return [];
  return plan.subtasks.map((subtask) => {
    const item = progress?.subtasks[subtask.id];
    const status = item?.status ?? "pending";
    const runs = task.subagents.filter((run) => run.subtaskId === subtask.id).map(projectTaskRunForImplementation);
    return {
      ...subtask,
      status,
      displayStatus: status === "pending" ? "waiting" : status,
      updatedAt: item?.updatedAt ?? progress?.updatedAt ?? plan.updatedAt,
      startedAt: item?.startedAt,
      finishedAt: item?.finishedAt,
      attempts: item?.attempts ?? 0,
      runIds: item?.runIds ?? [],
      lastRunId: item?.lastRunId,
      currentRunId: item?.currentRunId,
      queuedAt: item?.queuedAt,
      claimedAt: item?.claimedAt,
      claimedByContextId: item?.claimedByContextId,
      member: item?.member ?? subtask.member,
      waitingOn: item?.waitingOn,
      blockedBy: item?.blockedBy,
      blockedReason: item?.blockedReason,
      skippedReason: item?.skippedReason,
      terminationReason: item?.terminationReason,
      summary: item?.summary,
      validation: item?.validation,
      runs,
    };
  });
}

function projectTaskRunForImplementation(run: YpiStudioTaskDetail["subagents"][number]): YpiStudioImplementationRunProjection {
  return {
    id: run.id,
    member: run.member,
    subtaskId: run.subtaskId,
    status: run.status,
    registryActive: run.status === "queued" || run.status === "running",
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    error: run.error,
    terminationReason: run.terminationReason,
    phase: run.progress?.phase,
    tokens: run.progress?.tokens,
    tps: run.progress?.tps,
    currentTool: run.progress?.currentTool,
    transcriptMeta: run.transcript,
  };
}

function TaskExecutionFlowSection({ task }: { task: YpiStudioTaskDetail }) {
  const plan = task.implementationPlan;
  if (!plan?.subtasks.length) return null;
  const subtasks = buildImplementationSubtasks(task);
  const byId = new Map(subtasks.map((subtask) => [subtask.id, subtask]));
  const groups = plan.execution?.groups?.length
    ? plan.execution.groups
    : plan.subtasks.map((subtask) => ({ id: subtask.id, title: subtask.phase ?? subtask.title, relation: subtask.relation ?? "serial", dependencies: subtask.dependsOn, subtaskIds: [subtask.id] }));
  return <SectionCard title="实现执行路线">
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Badge label={`模式 ${plan.execution?.mode ?? "serial"}`} tone="neutral" />
        <Badge label={`DAG 真源 dependsOn`} tone="neutral" />
        <Badge label={`并发 ${plan.execution?.maxParallel ?? plan.maxConcurrency ?? task.implementationProjection?.maxConcurrency ?? 1}`} tone="neutral" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 360, overflowY: "auto", paddingRight: 2 }}>
        {groups.map((group, index) => {
          const groupSubtasks = group.subtaskIds.map((id) => byId.get(id)).filter(Boolean) as YpiStudioImplementationSubtaskProjection[];
          return <div key={`${group.id}-${index}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <Badge label={group.relation === "parallel" ? "并行组" : group.relation === "barrier" ? "汇合" : "串行"} tone={group.relation === "parallel" ? "warning" : "neutral"} />
              <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>{index + 1}. {group.title}</span>
              {group.dependencies?.length ? <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>分组依赖 {group.dependencies.join("、")}</span> : null}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {groupSubtasks.map((subtask) => <Badge key={subtask.id} label={`${subtask.id} · ${displayImplementationStatus(subtask.status)}`} tone={statusTone(subtask.status)} />)}
            </div>
          </div>;
        })}
      </div>
    </div>
  </SectionCard>;
}

function TaskImplementationTab({ task }: { task: YpiStudioTaskDetail }) {
  const plan = task.implementationPlan;
  const progress = task.implementationProgress;
  const subtasks = useMemo(() => buildImplementationSubtasks(task), [task]);
  const preferredSubtaskId = progress?.activeSubtaskIds?.[0] ?? progress?.activeSubtaskId ?? progress?.nextSubtaskIds?.[0] ?? progress?.nextSubtaskId ?? subtasks[0]?.id ?? null;
  const [activeSubtaskId, setActiveSubtaskId] = useState<string | null>(preferredSubtaskId);
  const [statusFilter, setStatusFilter] = useState<YpiStudioImplementationSubtaskStatus | "all">("all");

  useEffect(() => {
    setActiveSubtaskId((current) => current && subtasks.some((subtask) => subtask.id === current) ? current : preferredSubtaskId);
  }, [preferredSubtaskId, subtasks]);

  if (!plan) return <PanelEmpty title="尚未保存实现拆解" description="旧任务或尚在规划中的任务可能没有 implementationPlan。请在架构师规划完成后保存结构化 Implementation Plan。" />;

  const counts = implementationStatusCounts(task, subtasks);
  const runtime = task.implementationProjection?.sessionRuntime;
  const machinePhase = implementationMachinePhase(task, counts, runtime);
  const activeSubtask = subtasks.find((subtask) => subtask.id === activeSubtaskId) ?? subtasks[0];
  const visibleSubtasks = statusFilter === "all" ? subtasks : subtasks.filter((subtask) => subtask.status === statusFilter);
  const waitingOrBlocked = subtasks.filter((subtask) => ["waiting", "pending", "blocked", "failed"].includes(subtask.status));
  const runningOrQueued = subtasks.filter((subtask) => subtask.status === "running" || subtask.status === "queued");
  const readySubtasks = subtasks.filter((subtask) => subtask.status === "ready");
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === "done" || subtask.status === "skipped");
  const timeline = task.implementationProjection?.compactTimeline ?? runtime?.timeline ?? [];

  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <SectionCard title="状态机推进">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <Badge label={machinePhase.label} tone={machinePhase.tone} />
          <Badge label={machinePhase.waitingLabel} tone="neutral" />
          <Badge label={`运行 ${counts.running}`} tone={counts.running ? "warning" : "neutral"} />
          <Badge label={`队列 ${counts.queued}`} tone={counts.queued ? "warning" : "neutral"} />
          <Badge label={`就绪 ${counts.ready}`} tone={counts.ready ? "success" : "neutral"} />
          <Badge label={`阻塞 ${counts.blocked}`} tone={counts.blocked ? "warning" : "neutral"} />
          <Badge label={`完成 ${counts.done + counts.skipped}/${subtasks.length}`} tone="success" />
        </div>
        <Notice tone={machinePhase.tone === "error" ? "error" : machinePhase.tone === "warning" ? "warning" : "info"} text={`下一步：${machinePhase.nextAction}`} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8 }}>
          <DetailRow label="等待中的子任务" value={runningOrQueued.length ? runningOrQueued.map((subtask) => subtask.id).join("、") : "—"} mono />
          <DetailRow label="下一批就绪" value={readySubtasks.length ? readySubtasks.map((subtask) => subtask.id).join("、") : task.implementationProjection?.nextSubtaskIds.join("、") || "—"} mono />
          <DetailRow label="失败/阻塞" value={waitingOrBlocked.filter((subtask) => subtask.status === "failed" || subtask.status === "blocked").map((subtask) => subtask.id).join("、") || "—"} mono />
          <DetailRow label="最近完成" value={doneSubtasks.slice(-3).map((subtask) => subtask.id).join("、") || "—"} mono />
        </div>
        {timeline.length > 0 && <ImplementationTimelinePreview timeline={timeline} />}
      </div>
    </SectionCard>
    <SectionCard title="实现拆解总览">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 }}>
        <DetailRow label="完成" value={`${counts.done + counts.skipped}/${subtasks.length}`} />
        <DetailRow label="运行" value={String(counts.running)} />
        <DetailRow label="队列" value={String(counts.queued)} />
        <DetailRow label="就绪" value={String(counts.ready)} />
        <DetailRow label="等待" value={String(counts.waiting + counts.pending)} />
        <DetailRow label="失败/阻塞" value={`${counts.failed}/${counts.blocked}`} />
        <DetailRow label="并发上限" value={String(task.implementationProjection?.maxConcurrency ?? plan.execution?.maxParallel ?? plan.maxConcurrency ?? 1)} />
        <DetailRow label="更新时间" value={formatDateTime(progress?.updatedAt || plan.updatedAt)} />
      </div>
      {task.archived && <Notice tone="info" text="该任务已归档，只读展示实现拆解。" />}
    </SectionCard>
    <TaskExecutionFlowSection task={task} />
    {waitingOrBlocked.length > 0 && <SectionCard title="等待 / 阻塞原因摘要">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {waitingOrBlocked.slice(0, 8).map((subtask) => <ImplementationReasonLine key={subtask.id} subtask={subtask} />)}
        {waitingOrBlocked.length > 8 && <div style={{ color: "var(--text-dim)", fontSize: 11 }}>还有 {waitingOrBlocked.length - 8} 个条目，请在下方表格过滤查看。</div>}
      </div>
    </SectionCard>}
    <SectionCard title="子任务状态泳道 / 表格">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        <TabButton active={statusFilter === "all"} label={`全部 ${subtasks.length}`} onClick={() => setStatusFilter("all")} />
        {IMPLEMENTATION_STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => <TabButton key={status} active={statusFilter === status} label={`${implementationStatusLabel(status)} ${counts[status]}`} onClick={() => setStatusFilter(status)} />)}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 520, overflowY: "auto", paddingRight: 2 }}>
        {visibleSubtasks.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>当前过滤条件下没有子任务。</div> : visibleSubtasks.map((subtask) => (
          <button key={subtask.id} onClick={() => setActiveSubtaskId(subtask.id)} style={{ textAlign: "left", border: activeSubtask?.id === subtask.id ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 10, background: activeSubtask?.id === subtask.id ? "var(--bg-selected)" : "var(--bg)", padding: 10, cursor: "pointer", color: "var(--text)" }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <Badge label={displayImplementationStatus(subtask.status)} tone={statusTone(subtask.status)} />
              <span style={{ fontSize: 13, fontWeight: 800 }}>{subtask.id} · {subtask.title}</span>
              {subtask.member && <Badge label={subtask.member} tone="neutral" />}
              {subtask.runs.length > 0 && <span style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)" }}>run {subtask.currentRunId ?? subtask.lastRunId ?? subtask.runs[0]?.id}</span>}
            </div>
            <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 6 }}>
              <CompactDetail label="依赖" value={subtask.dependsOn.length ? subtask.dependsOn.join("、") : "无"} mono />
              <CompactDetail label="等待" value={formatWaitingOn(subtask)} />
              <CompactDetail label="阻塞/失败" value={formatBlockedOrFailed(subtask)} />
              <CompactDetail label="更新" value={formatDateTime(subtask.updatedAt)} />
            </div>
          </button>
        ))}
      </div>
    </SectionCard>
    {runningOrQueued.length > 0 && <SectionCard title="运行中 / 队列中的子任务">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {runningOrQueued.map((subtask) => <ImplementationRunRow key={subtask.id} subtask={subtask} />)}
      </div>
    </SectionCard>}
    {activeSubtask ? <ImplementationSubtaskDetail subtask={activeSubtask} /> : <PanelEmpty title="没有可显示的子任务" description="implementationPlan 中没有有效子任务。" />}
  </div>;
}

function ImplementationReasonLine({ subtask }: { subtask: YpiStudioImplementationSubtaskProjection }) {
  const text = subtask.status === "failed"
    ? (subtask.terminationReason ?? subtask.runs.find((run) => run.error)?.error ?? "运行失败，等待人工处理或重试。")
    : subtask.status === "blocked"
      ? formatBlockedOrFailed(subtask)
      : formatWaitingOn(subtask);
  return <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", color: "var(--text-muted)", fontSize: 12 }}>
    <Badge label={displayImplementationStatus(subtask.status)} tone={statusTone(subtask.status)} />
    <span style={{ color: "var(--text)", fontWeight: 700 }}>{subtask.id}</span>
    <span>{text}</span>
  </div>;
}

function ImplementationRunRow({ subtask }: { subtask: YpiStudioImplementationSubtaskProjection }) {
  const run = subtask.runs.find((item) => item.id === subtask.currentRunId) ?? subtask.runs[0];
  return <div style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg)", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
    <DetailRow label="子任务" value={`${subtask.id} · ${subtask.title}`} />
    <DetailRow label="状态" value={displayImplementationStatus(subtask.status)} />
    <DetailRow label="成员" value={run?.member ?? subtask.member ?? "—"} />
    <DetailRow label="Run" value={run?.id ?? subtask.currentRunId ?? subtask.lastRunId ?? "—"} mono />
    <DetailRow label="阶段" value={run?.phase ?? "—"} />
    <DetailRow label="工具" value={run?.currentTool?.toolName ?? "—"} />
    <DetailRow label="开始/排队" value={formatDateTime(subtask.startedAt ?? subtask.queuedAt ?? run?.startedAt ?? "")} />
  </div>;
}

function ImplementationTimelinePreview({ timeline }: { timeline: YpiStudioImplementationCompactTimelineItem[] }) {
  const items = timeline.slice(0, 6);
  return <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--bg)", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
    <div style={{ color: "var(--text-dim)", fontSize: 11, fontWeight: 800 }}>关键子任务状态</div>
    {items.map((item) => (
      <div key={item.id} style={{ display: "grid", gridTemplateColumns: "minmax(90px, 1fr) minmax(70px, auto) minmax(120px, 2fr)", gap: 8, alignItems: "center", color: "var(--text-muted)", fontSize: 12 }}>
        <span style={{ color: "var(--text)", fontWeight: 700, overflowWrap: "anywhere" }}>{item.id} · {item.title}</span>
        <Badge label={displayImplementationStatus(item.status)} tone={statusTone(item.status)} />
        <span style={{ color: item.status === "failed" || item.status === "blocked" ? "#f59e0b" : "var(--text-dim)", overflowWrap: "anywhere" }}>{item.reason ?? item.summary ?? item.runId ?? formatDateTime(item.updatedAt)}</span>
      </div>
    ))}
  </div>;
}

function ImplementationSubtaskDetail({ subtask }: { subtask: YpiStudioImplementationSubtaskProjection }) {
  return <SectionCard title={`${subtask.id} · ${subtask.title}`}>
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Badge label={displayImplementationStatus(subtask.status)} tone={statusTone(subtask.status)} />
        <Badge label={subtask.relation === "parallel" ? "并行" : subtask.relation === "barrier" ? "汇合" : "串行"} tone={subtask.relation === "parallel" ? "warning" : "neutral"} />
        {subtask.phase && <Badge label={subtask.phase} tone="neutral" />}
        <span style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>#{subtask.order}</span>
      </div>
      {subtask.description && <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>{subtask.description}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6 }}>
        <DetailRow label="依赖" value={subtask.dependsOn.length ? subtask.dependsOn.join("、") : "无"} mono />
        <DetailRow label="等待" value={formatWaitingOn(subtask)} />
        <DetailRow label="阻塞" value={formatBlockedOrFailed(subtask)} />
        <DetailRow label="并行组" value={subtask.parallelGroup ?? "—"} mono />
        <DetailRow label="文件" value={subtask.files?.join("、") ?? "—"} />
        <DetailRow label="尝试" value={String(subtask.attempts ?? 0)} />
        <DetailRow label="Run" value={subtask.currentRunId ?? subtask.lastRunId ?? subtask.runIds.join("、") ?? "—"} mono />
        <DetailRow label="局部检查" value={subtask.localReview?.required ? `required${subtask.localReview.reviewer ? ` · ${subtask.localReview.reviewer}` : ""}` : "—"} />
      </div>
      {subtask.instructions?.length ? <Bullets title="执行说明" items={subtask.instructions} /> : null}
      {subtask.acceptance?.length ? <Bullets title="验收" items={subtask.acceptance} /> : null}
      {subtask.validation?.length ? <Bullets title="验证" items={subtask.validation} /> : null}
      {subtask.blockedReason && <Notice tone="warning" text={`阻塞：${subtask.blockedReason}`} />}
      {subtask.terminationReason && <Notice tone={subtask.status === "failed" ? "error" : "warning"} text={`终止原因：${subtask.terminationReason}`} />}
      {subtask.skippedReason && <Notice tone="info" text={`跳过：${subtask.skippedReason}`} />}
      {subtask.summary && <DetailRow label="摘要" value={subtask.summary} />}
      {subtask.runs.length > 0 && <Bullets title="Run IDs" items={subtask.runs.map((run) => `${run.id} · ${run.member} · ${run.status}${run.phase ? ` · ${run.phase}` : ""}${run.error ? ` · ${run.error}` : ""}`)} />}
    </div>
  </SectionCard>;
}

function formatWaitingOn(subtask: YpiStudioImplementationSubtaskProjection): string {
  if (!subtask.waitingOn?.length) return subtask.dependsOn.length && !IMPLEMENTATION_TERMINAL_STATUSES.has(subtask.status) ? "等待依赖投影刷新" : "—";
  return subtask.waitingOn.map((item) => `${item.id}${item.title ? ` ${item.title}` : ""}(${displayImplementationStatus(item.status)})`).join("、");
}

function formatBlockedOrFailed(subtask: YpiStudioImplementationSubtaskProjection): string {
  const parts = [
    subtask.blockedBy?.length ? `blockedBy ${subtask.blockedBy.join("、")}` : "",
    subtask.blockedReason,
    subtask.terminationReason,
    subtask.runs.find((run) => run.error)?.error,
  ].filter(Boolean);
  return parts.length ? parts.join("；") : "—";
}

function CompactDetail({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div style={{ minWidth: 0, color: "var(--text-dim)", fontSize: 11, lineHeight: 1.4 }}><span>{label}：</span><span style={{ color: "var(--text-muted)", fontFamily: mono ? "var(--font-mono)" : undefined, overflowWrap: "anywhere" }}>{value || "—"}</span></div>;
}

function Bullets({ title, items }: { title: string; items: string[] }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
    <div style={{ color: "var(--text-dim)", fontWeight: 800 }}>{title}</div>
    <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{items.slice(0, 6).map((item, index) => <li key={index}>{item}</li>)}</ul>
  </div>;
}

function resolveArtifactKey(task: YpiStudioTaskDetail, value: string): string {
  if (task.documents[value] || task.artifacts[value]) return value;
  return Object.entries(task.artifacts).find(([, fileName]) => fileName === value)?.[0] ?? value;
}

function artifactFileName(task: YpiStudioTaskDetail, artifactKey: string, displayName: string): string {
  const fromDocument = task.documents[artifactKey]?.fileName;
  const fromMapping = task.artifacts[artifactKey];
  if (fromDocument) return fromDocument;
  if (fromMapping) return fromMapping;
  return /\.[A-Za-z0-9]+$/.test(displayName) ? displayName : `${displayName}.md`;
}

function TaskArtifactsTab({ cwd, task, onOpenFile }: { cwd: string; task: YpiStudioTaskDetail; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const artifacts = useMemo(() => Array.from(new Set([
    ...Object.values(task.artifacts),
    ...task.progress.requiredArtifacts,
    ...task.progress.optionalArtifacts,
    ...Object.keys(task.artifacts),
    ...Object.values(task.documents).map((document) => document.fileName),
  ])), [task.artifacts, task.documents, task.progress.optionalArtifacts, task.progress.requiredArtifacts]);
  const [activeArtifact, setActiveArtifact] = useState<string | null>(artifacts[0] ?? null);

  useEffect(() => {
    setActiveArtifact((current) => current && artifacts.includes(current) ? current : artifacts[0] ?? null);
  }, [artifacts]);

  if (artifacts.length === 0) return <PanelEmpty title="没有定义产物" description="当前任务还没有产物映射或文档内容。" />;

  const artifact = activeArtifact && artifacts.includes(activeArtifact) ? activeArtifact : artifacts[0];
  const artifactKey = resolveArtifactKey(task, artifact);
  const document = task.documents[artifactKey];
  const fileName = artifactFileName(task, artifactKey, artifact);
  const required = task.progress.requiredArtifacts.includes(artifact) || task.progress.requiredArtifacts.includes(fileName) || task.progress.requiredArtifacts.includes(artifactKey);
  const completed = task.progress.completedArtifacts.includes(artifact) || task.progress.completedArtifacts.includes(fileName) || task.progress.completedArtifacts.includes(artifactKey) || Boolean(document && !document.content.includes("_TBD by YPI Studio workflow._"));
  const filePath = `${cwd.replace(/[\\/]+$/, "")}/${task.pathLabel.replace(/^\/+/, "")}/${fileName}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {artifacts.map((item) => {
          const itemKey = resolveArtifactKey(task, item);
          const itemDocument = task.documents[itemKey];
          const itemFileName = artifactFileName(task, itemKey, item);
          const itemCompleted = task.progress.completedArtifacts.includes(item) || task.progress.completedArtifacts.includes(itemKey) || task.progress.completedArtifacts.includes(itemFileName) || Boolean(itemDocument && !itemDocument.content.includes("_TBD by YPI Studio workflow._"));
          return <TabButton key={item} active={item === artifact} label={`${item}${itemCompleted ? " ✓" : ""}`} onClick={() => setActiveArtifact(item)} />;
        })}
      </div>
      <SectionCard title={`${artifact}${required ? " · 必需" : " · 可选"}`} action={<button onClick={() => onOpenFile?.(filePath, fileName)} disabled={!onOpenFile} style={smallButtonStyle(Boolean(onOpenFile))}>打开</button>}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          <Badge label={completed ? "已完成" : "缺失"} tone={completed ? "success" : "warning"} />
          {document?.truncated && <Badge label="已截断" tone="warning" />}
        </div>
        <DetailRow label="文件" value={fileName} mono />
        {document ? <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg)" }}><MarkdownBody>{document.content || "（空文件）"}</MarkdownBody></div> : <Notice tone="warning" text="产物文件不存在或尚未写入。" />}
      </SectionCard>
    </div>
  );
}

function TaskSubagentsTab({ task }: { task: YpiStudioTaskDetail }) {
  if (task.subagents.length === 0) return <PanelEmpty title="没有成员运行记录" description="该任务尚未调度工作室成员。" />;
  const statusOrder = ["running", "queued", "waiting_for_user", "failed", "cancelled", "succeeded"];
  const grouped = new Map<string, typeof task.subagents>();
  for (const run of task.subagents) {
    const key = run.status;
    grouped.set(key, [...(grouped.get(key) ?? []), run]);
  }
  const orderedStatuses = [...statusOrder.filter((status) => grouped.has(status)), ...Array.from(grouped.keys()).filter((status) => !statusOrder.includes(status))];
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <SectionCard title="成员运行状态总览">
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {orderedStatuses.map((status) => <Badge key={status} label={`${status} ${grouped.get(status)?.length ?? 0}`} tone={statusTone(status)} />)}
      </div>
    </SectionCard>
    {orderedStatuses.map((status) => (
      <SectionCard key={status} title={`${status} · ${grouped.get(status)?.length ?? 0}`}>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 460, overflowY: "auto", paddingRight: 2 }}>
          {(grouped.get(status) ?? []).map((run) => (
            <div key={run.id} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 10, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <Badge label={run.status} tone={statusTone(run.status)} />
                <span style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>{run.member}</span>
                {run.subtaskId && <Badge label={`subtask ${run.subtaskId}`} tone="neutral" />}
                {run.progress?.phase && <Badge label={run.progress.phase} tone="neutral" />}
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }}>
                <DetailRow label="Run ID" value={run.id} mono />
                <DetailRow label="Subtask" value={run.subtaskId ?? "—"} mono />
                <DetailRow label="模型" value={run.model ? `${run.model}${run.modelSource ? ` (${run.modelSource})` : ""}` : "—"} />
                <DetailRow label="Thinking" value={run.thinking ? `${run.thinking}${run.thinkingSource ? ` (${run.thinkingSource})` : ""}` : "—"} />
                <DetailRow label="开始" value={formatDateTime(run.startedAt)} />
                <DetailRow label="结束" value={formatDateTime(run.finishedAt ?? "")} />
                <DetailRow label="阶段/工具" value={`${run.progress?.phase ?? "—"}${run.progress?.currentTool?.toolName ? ` · ${run.progress.currentTool.toolName}` : ""}`} />
                <DetailRow label="Tokens/tps" value={run.progress?.tokens ? `${run.progress.tokens}${run.progress.tps ? ` · ${run.progress.tps.toFixed(1)} t/s` : ""}` : "—"} />
                <DetailRow label="Transcript" value={run.transcript ? `${run.transcript.itemCount} items / ${run.transcript.messageCount} messages / ${run.transcript.toolCallCount} tools${run.transcript.truncated ? " · truncated" : ""}` : "—"} />
              </div>
              {run.progress?.lastTextPreview && <DetailRow label="最近进展" value={run.progress.lastTextPreview} />}
              {run.prompt && <DetailRow label="Prompt" value={run.prompt} />}
              {run.summary && <DetailRow label="Summary" value={run.summary} />}
              {run.terminationReason && <Notice tone={run.status === "failed" ? "error" : "warning"} text={`终止原因：${run.terminationReason}`} />}
              {run.error && <Notice tone="error" text={run.error} />}
              {run.transcript?.pathLabel && <DetailRow label="Transcript path" value={run.transcript.pathLabel} mono />}
            </div>
          ))}
        </div>
      </SectionCard>
    ))}
  </div>;
}

function TaskEventsTab({ task }: { task: YpiStudioTaskDetail }) {
  if (task.events.length === 0) return <PanelEmpty title="没有事件" description="任务事件 JSONL 暂无记录。" />;
  return <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[...task.events].reverse().map((event, index) => (
    <SectionCard key={`${event.at}-${index}`} title={`${event.type} · ${formatDateTime(event.at)}`}>
      {event.message && <div style={{ color: "var(--text)", fontSize: 12, lineHeight: 1.5 }}>{event.message}</div>}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
        {event.from && event.to && <Badge label={`${event.from} → ${event.to}`} tone="neutral" />}
        {event.member && <Badge label={event.member} tone="neutral" />}
        {event.artifact && <Badge label={event.artifact} tone="neutral" />}
      </div>
      {event.data && <JsonBlock value={event.data} />}
    </SectionCard>
  ))}</div>;
}

function TaskMetadataTab({ task }: { task: YpiStudioTaskDetail }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    <SectionCard title="Meta"><JsonBlock value={task.meta} /></SectionCard>
    <SectionCard title="Artifacts mapping"><JsonBlock value={task.artifacts} /></SectionCard>
    <SectionCard title="Implementation"><JsonBlock value={{ implementationPlan: task.implementationPlan, implementationProgress: task.implementationProgress, implementation: task.implementation }} /></SectionCard>
    <SectionCard title="完整摘要 JSON"><JsonBlock value={{ id: task.id, key: task.key, status: task.status, archived: task.archived, archiveMonth: task.archiveMonth, archiveReason: task.archiveReason, knowledgePath: task.knowledgePath, readError: task.readError }} /></SectionCard>
  </div>;
}

function SectionCard({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg)", padding: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center", marginBottom: 8 }}>
      <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>{title}</div>
      {action}
    </div>
    {children}
  </div>;
}

function DetailRow({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div style={{ minWidth: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}><span style={{ color: "var(--text-dim)" }}>{label}：</span><span style={{ fontFamily: mono ? "var(--font-mono)" : undefined, overflowWrap: "anywhere" }}>{value || "—"}</span></div>;
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre style={{ margin: "8px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere", color: "var(--text-muted)", fontSize: 11, lineHeight: 1.5, fontFamily: "var(--font-mono)" }}>{JSON.stringify(value, null, 2)}</pre>;
}

function AgentDetail({ cwd, agent, onOpenFile, policy, onOpenSettings }: { cwd: string; agent: YpiStudioAgent; onOpenFile?: (filePath: string, fileName: string) => void; policy: ReturnType<typeof memberPolicySummary>; onOpenSettings?: () => void }) {
  const filePath = agentFilePath(cwd, agent);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: 18, lineHeight: 1.25 }}>{agent.name}</h3>
          <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{agent.pathLabel}</div>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button onClick={onOpenSettings} disabled={!onOpenSettings} style={smallButtonStyle(Boolean(onOpenSettings))}>
            修改模型
          </button>
          <button onClick={() => onOpenFile?.(filePath, agent.fileName)} disabled={!onOpenFile} style={smallButtonStyle(Boolean(onOpenFile))}>
            打开文件
          </button>
        </div>
      </div>
      <div title={policy.detail} style={{ border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-subtle)", padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
        <DetailRow label="运行模型" value={policy.model} />
        <DetailRow label="thinking" value={policy.thinking} />
        <DetailRow label="策略来源" value={policy.source} />
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

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
