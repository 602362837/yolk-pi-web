"use client";

import type { CSSProperties, ReactNode } from "react";
import { buildYpiStudioWorkflowFlow } from "@/lib/ypi-studio-workflow-flow";
import type { YpiStudioTaskDetail, YpiStudioWorkflowFile, YpiStudioWorkflowState } from "@/lib/ypi-studio-types";

function workflowFilePath(cwd: string, workflow: YpiStudioWorkflowFile): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${workflow.pathLabel.replace(/^\/+/, "")}`;
}

function toneForStep(index: number, currentIndex: number, state: YpiStudioWorkflowState, progressPercent?: number): "done" | "active" | "pending" {
  if (currentIndex >= 0) return index < currentIndex ? "done" : index === currentIndex ? "active" : "pending";
  if (typeof progressPercent === "number") return state.progress < progressPercent ? "done" : "pending";
  return "pending";
}

function ownerText(state: YpiStudioWorkflowState): string {
  if (state.requiresSubagent) return `委派给 ${state.owner}`;
  if (state.owner === "main") return "主会话处理";
  return `负责人 ${state.owner}`;
}

export function WorkflowDetailPanel({ cwd, workflow, onBack, onOpenFile }: { cwd: string; workflow: YpiStudioWorkflowFile; onBack: () => void; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const flow = buildYpiStudioWorkflowFlow(workflow);
  return (
    <div style={shellStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button onClick={onBack} style={smallButtonStyle(true)}>← 返回流程列表</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: 16, lineHeight: 1.3 }}>{workflow.name}</h3>
          <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>{workflow.description}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 5, overflowWrap: "anywhere" }}>{workflow.pathLabel}</div>
        </div>
        <button onClick={() => onOpenFile?.(workflowFilePath(cwd, workflow), workflow.fileName)} disabled={!onOpenFile} style={smallButtonStyle(Boolean(onOpenFile))}>打开 JSON</button>
      </div>
      {workflow.readError && <Notice tone="error" text={workflow.readError} />}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 8 }}>
        <DetailRow label="ID" value={workflow.id} mono />
        <DetailRow label="初始状态" value={workflow.initialStatus} mono />
        <DetailRow label="终止状态" value={workflow.terminalStatuses.join("、") || "—"} mono />
        <DetailRow label="修改" value={formatDateTime(workflow.modifiedAt ?? "")} />
      </div>
      <WorkflowFlowView workflow={workflow} />
      <TriggersSection workflow={workflow} />
      <SectionCard title={`分支与例外流 ${flow.branchTransitions.length}`}>
        {flow.branchTransitions.length === 0 ? <EmptyText>没有额外分支。</EmptyText> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {flow.branchTransitions.map(({ transition, fromState, toState }, index) => (
              <div key={`${transition.from}-${transition.to}-${index}`} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 9, background: "var(--bg-panel)" }}>
                <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>{fromState?.label ?? transition.from} → {toState?.label ?? transition.to}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 3 }}>{transition.from} → {transition.to}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                  {transition.label && <Badge label={transition.label} tone="neutral" />}
                  {transition.requiresUserApproval && <Badge label="需用户确认" tone="warning" />}
                  {transition.overrideAllowed && <Badge label="override" tone="neutral" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
      <SectionCard title="状态清单 / 元数据">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 8 }}>
          <DetailRow label="状态数" value={Object.keys(workflow.states).length} />
          <DetailRow label="Transition 数" value={workflow.transitions.length} />
          <DetailRow label="Schema" value={workflow.schemaVersion} />
        </div>
        {flow.warnings.map((warning) => <Notice key={warning} tone="warning" text={warning} />)}
      </SectionCard>
    </div>
  );
}

export function TaskWorkflowFlowSection({ task, workflow }: { task: YpiStudioTaskDetail; workflow?: YpiStudioWorkflowFile | null }) {
  if (!workflow) {
    return <SectionCard title="当前任务流程"><Notice tone="warning" text={`未找到任务对应的流程 ${task.workflowId}；仍可查看任务产物和事件。`} /></SectionCard>;
  }
  if (workflow.readError) {
    return <SectionCard title="当前任务流程"><Notice tone="error" text={`流程读取异常：${workflow.readError}`} /></SectionCard>;
  }
  const currentState = workflow.states[task.status];
  const missing = task.progress.missingArtifacts;
  return (
    <SectionCard title={`当前任务流程 · ${workflow.name}`}>
      <WorkflowFlowView workflow={workflow} currentStatus={task.status} progressPercent={task.progress.percent} compact />
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
        <DetailRow label="当前节点" value={currentState ? `${currentState.label} (${currentState.id})` : task.status} />
        <DetailRow label="处理方式" value={currentState ? ownerText(currentState) : (task.currentMember ?? task.progress.owner)} />
        {currentState?.requiresUserApproval && <Notice tone="warning" text="当前节点需要用户确认后才能继续。" />}
        <DetailRow label="缺失产物" value={missing.length ? missing.join("、") : "无"} />
      </div>
    </SectionCard>
  );
}

function WorkflowFlowView({ workflow, currentStatus, progressPercent, compact = false }: { workflow: YpiStudioWorkflowFile; currentStatus?: string; progressPercent?: number; compact?: boolean }) {
  const flow = buildYpiStudioWorkflowFlow(workflow, currentStatus);
  const currentIndex = flow.steps.findIndex((step) => step.state.id === currentStatus);
  return (
    <SectionCard title={compact ? "流程路线" : `主路径流程图 ${flow.steps.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {flow.steps.map((step, index) => (
          <div key={step.state.id}>
            <WorkflowStateNode state={step.state} status={toneForStep(index, currentIndex, step.state, progressPercent)} compact={compact} />
            {index < flow.steps.length - 1 && <div style={{ marginLeft: 14, height: 16, borderLeft: "2px solid var(--border)" }} />}
          </div>
        ))}
      </div>
      {flow.warnings.length > 0 && <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>{flow.warnings.map((warning) => <Notice key={warning} tone="warning" text={warning} />)}</div>}
    </SectionCard>
  );
}

function WorkflowStateNode({ state, status, compact }: { state: YpiStudioWorkflowState; status: "done" | "active" | "pending"; compact: boolean }) {
  const border = status === "active" ? "var(--accent)" : status === "done" ? "#16a34a" : "var(--border)";
  return (
    <div style={{ border: `1px solid ${border}`, borderRadius: 12, background: status === "active" ? "var(--bg-selected)" : "var(--bg-panel)", padding: compact ? 9 : 11, boxShadow: status === "active" ? "0 0 0 1px rgba(37,99,235,0.18) inset" : "none" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>{state.label}</div>
          <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 2 }}>{state.id}</div>
        </div>
        <Badge label={`${state.progress}%`} tone={status === "done" ? "success" : status === "active" ? "warning" : "neutral"} />
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 7 }}>
        <Badge label={ownerText(state)} tone={state.requiresSubagent ? "success" : "neutral"} />
        {state.requiresUserApproval && <Badge label="需用户确认" tone="warning" />}
        {status === "active" && <Badge label="当前" tone="warning" />}
      </div>
      {!compact && state.instruction && <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5, marginTop: 7 }}>{state.instruction}</div>}
      <ArtifactLine label="必需" items={state.requiredArtifacts} />
      <ArtifactLine label="可选" items={state.optionalArtifacts ?? []} />
    </div>
  );
}

function ArtifactLine({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 6 }}>{label}产物：{items.join("、")}</div>;
}

function TriggersSection({ workflow }: { workflow: YpiStudioWorkflowFile }) {
  return <SectionCard title="触发方式">
    <DetailRow label="Slash" value={workflow.triggers.slash?.length ? workflow.triggers.slash.map((item) => `/${item}`).join("、") : "—"} mono />
    <DetailRow label="自然语言" value={workflow.triggers.natural?.length ? workflow.triggers.natural.join(" / ") : "—"} />
  </SectionCard>;
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

function EmptyText({ children }: { children: ReactNode }) {
  return <div style={{ color: "var(--text-dim)", fontSize: 12, lineHeight: 1.5 }}>{children}</div>;
}

function Badge({ label, tone }: { label: string; tone: "success" | "warning" | "error" | "neutral" }) {
  const color = tone === "success" ? "#16a34a" : tone === "warning" ? "#f59e0b" : tone === "error" ? "#ef4444" : "var(--text-dim)";
  return <span style={{ border: `1px solid ${color}55`, color, borderRadius: 999, padding: "2px 6px", fontSize: 10, fontWeight: 800 }}>{label}</span>;
}

function Notice({ tone, text }: { tone: "success" | "warning" | "error" | "info"; text: string }) {
  const color = tone === "success" ? "#16a34a" : tone === "warning" ? "#f59e0b" : tone === "error" ? "#ef4444" : "var(--accent)";
  const background = tone === "success" ? "rgba(22,163,74,0.10)" : tone === "warning" ? "rgba(245,158,11,0.10)" : tone === "error" ? "rgba(239,68,68,0.10)" : "rgba(37,99,235,0.10)";
  return <div style={{ border: `1px solid ${color}33`, color, background, borderRadius: 8, padding: "7px 9px", fontSize: 12, lineHeight: 1.45 }}>{text}</div>;
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

function formatDateTime(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

const shellStyle: CSSProperties = {
  minHeight: 0,
  flex: 1,
  overflowY: "auto",
  border: "1px solid var(--border)",
  borderRadius: 12,
  background: "var(--bg-panel)",
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
