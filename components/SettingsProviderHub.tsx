"use client";

import type { ReactNode } from "react";

/**
 * Provider strategy summary hub for Settings.
 *
 * Presentation-only: projects safe boolean draft fields from SettingsConfig.
 * Does not fetch accounts/quota, read secrets, or own editable config state.
 * Stable provider section ids stay aligned with SettingsSection.
 */

export type SettingsProviderSection = "chatgpt" | "opencodeGo" | "grok" | "kiro";

export interface SettingsProviderHubChatGptDraft {
  usagePanelEnabled: boolean;
  autoFailoverEnabled: boolean;
  autoRefreshEnabled: boolean;
}

export interface SettingsProviderHubOpencodeGoDraft {
  autoFailoverEnabled: boolean;
}

export interface SettingsProviderHubGrokDraft {
  usagePanelEnabled: boolean;
  autoFailoverEnabled: boolean;
}

export interface SettingsProviderHubKiroDraft {
  usagePanelEnabled: boolean;
  autoFailoverEnabled: boolean;
}

export interface SettingsProviderHubProps {
  chatgpt: SettingsProviderHubChatGptDraft;
  opencodeGo: SettingsProviderHubOpencodeGoDraft;
  grok: SettingsProviderHubGrokDraft;
  kiro: SettingsProviderHubKiroDraft;
  onOpenProvider: (section: SettingsProviderSection) => void;
}

type StatusTone = "on" | "off" | "na" | "models";

type StatusRow = {
  label: string;
  value: string;
  tone: StatusTone;
};

function booleanStatus(enabled: boolean): { value: string; tone: StatusTone } {
  return enabled
    ? { value: "开", tone: "on" }
    : { value: "关", tone: "off" };
}

function StatusList({ rows }: { rows: StatusRow[] }) {
  return (
    <div className="settings-provider-status-list">
      {rows.map((row) => (
        <div key={row.label} className="settings-provider-status-row">
          <span className="settings-provider-status-label">{row.label}</span>
          <span className={`settings-provider-pill settings-provider-pill--${row.tone}`}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProviderCard({
  section,
  mark,
  title,
  description,
  rows,
  onOpen,
}: {
  section: SettingsProviderSection;
  mark: string;
  title: string;
  description: string;
  rows: StatusRow[];
  onOpen: (section: SettingsProviderSection) => void;
}) {
  // Single interactive control per card: avoid nested buttons inside a clickable container.
  return (
    <article className="settings-provider-card">
      <div className="settings-provider-card-head">
        <div className="settings-provider-card-mark" aria-hidden="true">
          {mark}
        </div>
        <div className="settings-provider-card-copy">
          <h3 className="settings-provider-card-title">{title}</h3>
          <p className="settings-provider-card-desc">{description}</p>
        </div>
      </div>

      <StatusList rows={rows} />

      <button
        type="button"
        className="settings-provider-card-open"
        onClick={() => onOpen(section)}
      >
        {`查看 ${title} 详情 →`}
      </button>
    </article>
  );
}

function buildChatGptRows(draft: SettingsProviderHubChatGptDraft): StatusRow[] {
  const usage = booleanStatus(draft.usagePanelEnabled);
  const failover = booleanStatus(draft.autoFailoverEnabled);
  const refresh = booleanStatus(draft.autoRefreshEnabled);
  return [
    { label: "顶部用量面板", value: usage.value, tone: usage.tone },
    { label: "额度耗尽自动切换", value: failover.value, tone: failover.tone },
    { label: "后台自动刷新", value: refresh.value, tone: refresh.tone },
  ];
}

function buildOpencodeGoRows(draft: SettingsProviderHubOpencodeGoDraft): StatusRow[] {
  const failover = booleanStatus(draft.autoFailoverEnabled);
  return [
    // OpenCode Go has no top-bar usage panel setting; never invent a toggle.
    { label: "顶部用量面板", value: "未提供", tone: "na" },
    { label: "账号不可用自动切换", value: failover.value, tone: failover.tone },
    { label: "账号管理", value: "Models", tone: "models" },
  ];
}

function buildGrokRows(draft: SettingsProviderHubGrokDraft): StatusRow[] {
  const usage = booleanStatus(draft.usagePanelEnabled);
  const failover = booleanStatus(draft.autoFailoverEnabled);
  return [
    { label: "顶部用量面板", value: usage.value, tone: usage.tone },
    { label: "限额/限流自动切换", value: failover.value, tone: failover.tone },
    { label: "Global Active", value: "Models", tone: "models" },
  ];
}

function buildKiroRows(draft: SettingsProviderHubKiroDraft): StatusRow[] {
  const usage = booleanStatus(draft.usagePanelEnabled);
  const failover = booleanStatus(draft.autoFailoverEnabled);
  return [
    { label: "顶部用量面板", value: usage.value, tone: usage.tone },
    { label: "限额/限流自动切换", value: failover.value, tone: failover.tone },
    { label: "Global Active", value: "Models", tone: "models" },
  ];
}

export function SettingsProviderHub({
  chatgpt,
  opencodeGo,
  grok,
  kiro,
  onOpenProvider,
}: SettingsProviderHubProps): ReactNode {
  return (
    <div className="settings-provider-hub">
      <div className="settings-provider-hub-header">
        <div>
          <div className="settings-provider-hub-eyebrow">模型与用量</div>
          <h2 className="settings-provider-hub-title">提供商策略</h2>
          <p className="settings-provider-hub-lead">
            先查看当前 Settings 草稿中的关键策略，再进入详情调整。账号仍在 Models 管理。
          </p>
        </div>
        <div className="settings-provider-hub-note">
          摘要只读取当前表单草稿，不请求账号、额度或 secret 数据。
        </div>
      </div>

      <div className="settings-provider-grid">
        <ProviderCard
          section="chatgpt"
          mark="G"
          title="ChatGPT"
          description="Codex 用量展示、刷新与额度切换"
          rows={buildChatGptRows(chatgpt)}
          onOpen={onOpenProvider}
        />
        <ProviderCard
          section="opencodeGo"
          mark="O"
          title="OpenCode Go"
          description="托管 API Key 的被动 failover 策略"
          rows={buildOpencodeGoRows(opencodeGo)}
          onOpen={onOpenProvider}
        />
        <ProviderCard
          section="grok"
          mark="X"
          title="Grok"
          description="Global Active OAuth 账号策略"
          rows={buildGrokRows(grok)}
          onOpen={onOpenProvider}
        />
        <ProviderCard
          section="kiro"
          mark="K"
          title="Kiro"
          description="AWS GetUsageLimits 与账号轮换策略"
          rows={buildKiroRows(kiro)}
          onOpen={onOpenProvider}
        />
      </div>
    </div>
  );
}
