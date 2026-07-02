"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { YpiStudioAgent, YpiStudioAgentsInitResponse, YpiStudioAgentsResponse } from "@/lib/ypi-studio-types";
import { MarkdownBody } from "./MarkdownBody";

interface Props {
  cwd: string | null;
  onOpenFile?: (filePath: string, fileName: string) => void;
}

type LoadState = "idle" | "loading" | "ready" | "error";

function agentFilePath(cwd: string, agent: YpiStudioAgent): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${agent.pathLabel.replace(/^\/+/, "")}`;
}

function shortCwd(cwd: string): string {
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return cwd;
  return `…/${parts.slice(-2).join("/")}`;
}

function initButtonLabel(data: YpiStudioAgentsResponse | null): string {
  if (!data?.exists) return "初始化工作室成员";
  if (data.missingDefaultAgents.length > 0) return "补齐默认成员";
  return "重新检查";
}

export function YpiStudioPanel({ cwd, onOpenFile }: Props) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [data, setData] = useState<YpiStudioAgentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [initBusy, setInitBusy] = useState(false);
  const [initMessage, setInitMessage] = useState<string | null>(null);

  const loadAgents = useCallback(async (signal?: AbortSignal) => {
    if (!cwd) {
      setData(null);
      setSelectedKey(null);
      setLoadState("idle");
      setError(null);
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

  useEffect(() => {
    const controller = new AbortController();
    void loadAgents(controller.signal);
    return () => controller.abort();
  }, [loadAgents]);

  const selectedAgent = useMemo(() => {
    if (!data?.agents.length) return null;
    return data.agents.find((agent) => agent.key === selectedKey) ?? data.agents[0] ?? null;
  }, [data, selectedKey]);

  const handleInit = useCallback(async () => {
    if (!cwd || initBusy) return;
    setInitBusy(true);
    setInitMessage(null);
    setError(null);
    try {
      const res = await fetch("/api/studio/agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd }),
      });
      const body = await res.json() as YpiStudioAgentsInitResponse & { error?: string };
      if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
      setData(body.agents);
      setSelectedKey((current) => {
        if (current && body.agents.agents.some((agent) => agent.key === current)) return current;
        return body.agents.agents[0]?.key ?? null;
      });
      setLoadState("ready");
      const createdCount = body.created.length;
      const skippedCount = body.skipped.length;
      setInitMessage(createdCount > 0
        ? `已创建 ${createdCount} 个成员，跳过 ${skippedCount} 个已存在文件。`
        : "默认成员文件已存在，没有覆盖用户内容。"
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoadState("error");
    } finally {
      setInitBusy(false);
    }
  }, [cwd, initBusy]);

  if (!cwd) {
    return <PanelEmpty title="请选择项目空间" description="选择一个会话或工作目录后，可在该项目根目录初始化 .ypi/agents/ 工作室成员。" />;
  }

  const canInitialize = !data?.exists || (data?.missingDefaultAgents.length ?? 0) > 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)" }}>
      <div style={{ padding: 14, borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)" }}>工作室成员</div>
            <div title={cwd} style={{ marginTop: 3, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {shortCwd(cwd)} · .ypi/agents/
            </div>
          </div>
          <button
            onClick={canInitialize ? handleInit : () => { void loadAgents(); }}
            disabled={initBusy || loadState === "loading"}
            style={{
              padding: "6px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: canInitialize ? "var(--accent)" : "var(--bg)",
              color: canInitialize ? "white" : "var(--text-muted)",
              cursor: initBusy || loadState === "loading" ? "wait" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              whiteSpace: "nowrap",
            }}
          >
            {initBusy ? "处理中…" : initButtonLabel(data)}
          </button>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
          这里只管理项目级成员描述，不引入任务状态机或 Trellis 流程。初始化只补齐缺失文件，不覆盖已有自定义内容。
        </div>
        {initMessage && <Notice tone="success" text={initMessage} />}
        {error && <Notice tone="error" text={error} />}
      </div>

      {loadState === "loading" ? (
        <PanelEmpty title="正在读取工作室成员" description="检查当前项目的 .ypi/agents/ 目录。" />
      ) : loadState === "error" && !data ? (
        <PanelEmpty title="读取失败" description="请检查上方错误信息，或确认当前工作目录已被授权访问。" />
      ) : !data?.exists ? (
        <PanelEmpty
          title="尚未初始化"
          description="点击“初始化工作室成员”会在项目根目录创建 architect、ui-designer、implementer、checker 四个默认成员文件。"
        />
      ) : data.agents.length === 0 ? (
        <PanelEmpty title="没有成员文件" description=".ypi/agents/ 已存在，但没有可读取的 Markdown 成员文件。可点击补齐默认成员。" />
      ) : (
        <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateRows: "minmax(130px, 35%) 1fr" }}>
          <div style={{ overflowY: "auto", borderBottom: "1px solid var(--border)", padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10, alignContent: "start" }}>
            {data.agents.map((agent) => (
              <AgentCard key={agent.key} agent={agent} active={selectedAgent?.key === agent.key} onClick={() => setSelectedKey(agent.key)} />
            ))}
          </div>
          <div style={{ minHeight: 0, overflowY: "auto" }}>
            {selectedAgent && (
              <AgentDetail cwd={data.cwd} agent={selectedAgent} onOpenFile={onOpenFile} />
            )}
          </div>
        </div>
      )}
    </div>
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

function AgentDetail({ cwd, agent, onOpenFile }: { cwd: string; agent: YpiStudioAgent; onOpenFile?: (filePath: string, fileName: string) => void }) {
  const filePath = agentFilePath(cwd, agent);
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ margin: 0, color: "var(--text)", fontSize: 18, lineHeight: 1.25 }}>{agent.name}</h3>
          <div style={{ marginTop: 5, color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{agent.pathLabel}</div>
        </div>
        <button
          onClick={() => onOpenFile?.(filePath, agent.fileName)}
          disabled={!onOpenFile}
          style={{
            padding: "6px 10px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-panel)",
            color: onOpenFile ? "var(--text-muted)" : "var(--text-dim)",
            cursor: onOpenFile ? "pointer" : "default",
            fontSize: 12,
            fontWeight: 700,
            whiteSpace: "nowrap",
          }}
        >
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

function Notice({ tone, text }: { tone: "success" | "warning" | "error"; text: string }) {
  const color = tone === "success" ? "#16a34a" : tone === "warning" ? "#f59e0b" : "#ef4444";
  const background = tone === "success" ? "rgba(22,163,74,0.10)" : tone === "warning" ? "rgba(245,158,11,0.10)" : "rgba(239,68,68,0.10)";
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
