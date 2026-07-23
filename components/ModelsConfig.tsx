"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import type { DeepSeekBalanceResult } from "@/lib/deepseek-balance";
import { ACCOUNT_JSON_CONVERTERS, RAW_ACCOUNT_JSON_EXAMPLE, convertOAuthAccountCredentialWithWarnings, validateRawOAuthCredentialImport, type OAuthAccountImportMode, type OAuthAccountImportWarning } from "@/lib/oauth-account-converters";
import { earliestResetCreditExpiration, formatQuotaQueriedAt, formatResetCountdown, knownQuotaTiers, quotaColor, QUOTA_TIER_LABELS, type CodexResetCreditDisplay } from "@/lib/quota-display";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { ChatGptWarmupDialog } from "./ChatGptWarmupDialog";
import { AntigravityQuotaView } from "./AntigravityQuotaView";
import { GrokQuotaView } from "./GrokQuotaView";
import { KiroQuotaView } from "./KiroQuotaView";
import { iconFlowAttrs } from "./iconFlow";
import { SelectDropdown } from "./SelectDropdown";
import { usePrompt } from "./AppPromptProvider";
import {
  isOpenAICompatibleModelsSyncApi,
  type ModelsConfigSyncPreviewResponse,
  type ModelsSyncErrorCode,
  MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS,
} from "@/lib/models-config-sync-types";
// Color icons (have their own fill colors — no background needed)
import AnthropicIcon from "@lobehub/icons/es/Anthropic/components/Mono";
import OpenAIIcon from "@lobehub/icons/es/OpenAI/components/Mono";
import GoogleColorIcon from "@lobehub/icons/es/Google/components/Color";
import DeepSeekColorIcon from "@lobehub/icons/es/DeepSeek/components/Color";
import GroqIcon from "@lobehub/icons/es/Groq/components/Mono";
import MistralColorIcon from "@lobehub/icons/es/Mistral/components/Color";
import MoonshotIcon from "@lobehub/icons/es/Moonshot/components/Mono";
import MinimaxColorIcon from "@lobehub/icons/es/Minimax/components/Color";
import FireworksColorIcon from "@lobehub/icons/es/Fireworks/components/Color";
import HuggingFaceColorIcon from "@lobehub/icons/es/HuggingFace/components/Color";
import CerebrasColorIcon from "@lobehub/icons/es/Cerebras/components/Color";
import OpenRouterIcon from "@lobehub/icons/es/OpenRouter/components/Mono";
import XAIIcon from "@lobehub/icons/es/XAI/components/Mono";
import CloudflareColorIcon from "@lobehub/icons/es/Cloudflare/components/Color";
import VercelIcon from "@lobehub/icons/es/Vercel/components/Mono";
import GithubCopilotIcon from "@lobehub/icons/es/GithubCopilot/components/Mono";
import AwsColorIcon from "@lobehub/icons/es/Aws/components/Color";
import AzureColorIcon from "@lobehub/icons/es/Azure/components/Color";
import KimiColorIcon from "@lobehub/icons/es/Kimi/components/Color";
import QwenColorIcon from "@lobehub/icons/es/Qwen/components/Color";
import ZhipuColorIcon from "@lobehub/icons/es/Zhipu/components/Color";
import CohereColorIcon from "@lobehub/icons/es/Cohere/components/Color";
import PerplexityColorIcon from "@lobehub/icons/es/Perplexity/components/Color";
import TogetherColorIcon from "@lobehub/icons/es/Together/components/Color";
import GrokIcon from "@lobehub/icons/es/Grok/components/Mono";
import AntGroupColorIcon from "@lobehub/icons/es/AntGroup/components/Color";
import NvidiaColorIcon from "@lobehub/icons/es/Nvidia/components/Color";
import OpenCodeIcon from "@lobehub/icons/es/OpenCode/components/Mono";
import XiaomiMiMoIcon from "@lobehub/icons/es/XiaomiMiMo/components/Mono";
import ZAIIcon from "@lobehub/icons/es/ZAI/components/Mono";

type IconComponent = React.ComponentType<{ size?: number | string; style?: React.CSSProperties }>;

// hasColor=true → Color icon (self-colored SVG, no wrapper)
// hasColor=false → Mono icon (rendered with currentColor, inherits theme text color)
const PROVIDER_ICONS: Record<string, { Icon: IconComponent; hasColor: boolean }> = {
  "anthropic":              { Icon: AnthropicIcon,        hasColor: false },
  "openai":                 { Icon: OpenAIIcon,           hasColor: false },
  "openai-codex":           { Icon: OpenAIIcon,           hasColor: false },
  "google":                 { Icon: GoogleColorIcon,      hasColor: true },
  "google-vertex":          { Icon: GoogleColorIcon,      hasColor: true },
  "ant-ling":               { Icon: AntGroupColorIcon,    hasColor: true },
  "deepseek":               { Icon: DeepSeekColorIcon,    hasColor: true },
  "groq":                   { Icon: GroqIcon,             hasColor: false },
  "mistral":                { Icon: MistralColorIcon,     hasColor: true },
  "moonshotai":             { Icon: MoonshotIcon,         hasColor: false },
  "moonshotai-cn":          { Icon: MoonshotIcon,         hasColor: false },
  "moonshot":               { Icon: MoonshotIcon,         hasColor: false },
  "minimax":                { Icon: MinimaxColorIcon,     hasColor: true },
  "minimax-cn":             { Icon: MinimaxColorIcon,     hasColor: true },
  "fireworks":              { Icon: FireworksColorIcon,   hasColor: true },
  "huggingface":            { Icon: HuggingFaceColorIcon, hasColor: true },
  "cerebras":               { Icon: CerebrasColorIcon,    hasColor: true },
  "openrouter":             { Icon: OpenRouterIcon,       hasColor: false },
  "xai":                    { Icon: XAIIcon,              hasColor: false },
  "cloudflare-ai-gateway":  { Icon: CloudflareColorIcon,  hasColor: true },
  "cloudflare-workers-ai":  { Icon: CloudflareColorIcon,  hasColor: true },
  "vercel-ai-gateway":      { Icon: VercelIcon,           hasColor: false },
  "github-copilot":         { Icon: GithubCopilotIcon,    hasColor: false },
  "amazon-bedrock":         { Icon: AwsColorIcon,         hasColor: true },
  "azure-openai-responses": { Icon: AzureColorIcon,       hasColor: true },
  "kimi-coding":            { Icon: KimiColorIcon,        hasColor: true },
  "nvidia":                 { Icon: NvidiaColorIcon,      hasColor: true },
  "opencode":               { Icon: OpenCodeIcon,         hasColor: false },
  "opencode-go":            { Icon: OpenCodeIcon,         hasColor: false },
  "qwen":                   { Icon: QwenColorIcon,        hasColor: true },
  "xiaomi":                 { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-ams":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-cn":   { Icon: XiaomiMiMoIcon,       hasColor: false },
  "xiaomi-token-plan-sgp":  { Icon: XiaomiMiMoIcon,       hasColor: false },
  "zai":                    { Icon: ZAIIcon,              hasColor: false },
  "zai-coding-cn":          { Icon: ZAIIcon,              hasColor: false },
  "zhipu":                  { Icon: ZhipuColorIcon,       hasColor: true },
  "cohere":                 { Icon: CohereColorIcon,      hasColor: true },
  "perplexity":             { Icon: PerplexityColorIcon,  hasColor: true },
  "together":               { Icon: TogetherColorIcon,    hasColor: true },
  "grok":                   { Icon: GrokIcon,             hasColor: false },
  "grok-cli":               { Icon: GrokIcon,             hasColor: false },
  "kiro":                   { Icon: AwsColorIcon,         hasColor: true },
  "google-antigravity":     { Icon: GoogleColorIcon,      hasColor: true },
};

// ── Types ─────────────────────────────────────────────────────────────────────

interface OAuthProvider {
  id: string;
  name: string;
  usesCallbackServer: boolean;
  loggedIn: boolean;
  authMode?: "managed_accounts";
  accountCount?: number;
  activeAccountDisplayName?: string | null;
}

interface OAuthAccountQuotaCache {
  success: boolean;
  tiers: QuotaTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexResetCreditDisplay[];
  resetCreditsError: string | null;
}

interface OAuthAccountSummary {
  accountId: string;
  label?: string;
  extraInfo?: string;
  quotaCache?: OAuthAccountQuotaCache;
  displayName: string;
  maskedAccountId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string | null;
}

interface OAuthAccountsResponse {
  provider: string;
  activeAccountId: string | null;
  accounts: OAuthAccountSummary[];
}

interface ApiKeyProvider {
  id: string;
  displayName: string;
  configured: boolean;
  source?: string;
  modelCount: number;
  authMode?: "managed_accounts" | "single";
  accountCount?: number;
  activeAccountDisplayName?: string | null;
}


type OAuthLoginState =
  | { phase: "idle" }
  | { phase: "connecting" }
  | { phase: "auth"; url: string; instructions: string | null; token: string }
  | { phase: "device_code"; userCode: string; verificationUri: string; intervalSeconds: number | null; expiresInSeconds: number | null }
  | { phase: "prompt"; message: string; placeholder: string | null; token: string }
  | { phase: "select"; message: string; options: { id: string; label: string }[]; token: string }
  | { phase: "progress"; message: string }
  | { phase: "success"; message?: string }
  | { phase: "error"; message: string };

type CredentialStatus = "valid" | "expired" | "not_found" | "parse_error";

interface QuotaTier {
  name: string;
  utilization: number;
  resetsAt: string | null;
}

interface SubscriptionQuota {
  tool: string;
  credentialStatus: CredentialStatus;
  credentialMessage: string | null;
  success: boolean;
  tiers: QuotaTier[];
  error: string | null;
  queriedAt: number | null;
  resetCreditsAvailableCount: number | null;
  resetCredits: CodexResetCreditDisplay[];
  resetCreditsError: string | null;
}

interface ModelEntry {
  id: string;
  name?: string;
  api?: string;
  reasoning?: boolean;
  thinkingLevelMap?: Record<string, string | null>;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
  compat?: Record<string, unknown>;
}

interface ProviderEntry {
  baseUrl?: string;
  api?: string;
  apiKey?: string;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  models?: ModelEntry[];
  modelOverrides?: Record<string, unknown>;
}

interface ModelsJson {
  providers?: Record<string, ProviderEntry>;
}

type ModelTestState =
  | { phase: "idle" }
  | { phase: "testing" }
  | { phase: "success"; latencyMs?: number; status?: number; responseText?: string }
  | { phase: "error"; message: string; latencyMs?: number; status?: number };

type Selection =
  | { type: "provider"; name: string }
  | { type: "model"; providerName: string; index: number }
  | { type: "oauth"; providerId: string }
  | { type: "apikey"; providerId: string };

const API_OPTIONS = ["openai-completions", "openai-responses", "anthropic-messages", "google-generative-ai"] as const;

// ── Form field helpers ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 500 }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = {
  padding: "6px 9px",
  background: "var(--bg-panel)",
  border: "1px solid var(--border)",
  borderRadius: 5,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box" as const,
};

function TextInput({ value, onChange, placeholder, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    style={{ ...inputStyle, fontFamily: mono ? "var(--font-mono)" : "inherit" }} />;
}

function TextAreaInput({ value, onChange, placeholder, rows = 4, mono }: { value: string; onChange: (v: string) => void; placeholder?: string; rows?: number; mono?: boolean }) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{ ...inputStyle, resize: "vertical", minHeight: rows * 20, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
    />
  );
}

function SecretTextInput({
  value,
  onChange,
  placeholder,
  mono,
  onKeyDown,
  autoComplete = "off",
  spellCheck = false,
  style,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  autoComplete?: string;
  spellCheck?: boolean;
  style?: React.CSSProperties;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!value) setVisible(false);
  }, [value]);

  return (
    <div style={{ position: "relative", width: "100%", ...style }}>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        style={{ ...inputStyle, paddingRight: 34, fontFamily: mono ? "var(--font-mono)" : "inherit" }}
        autoComplete={autoComplete}
        spellCheck={spellCheck}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "隐藏 API Key" : "显示 API Key"}
        title={visible ? "隐藏 API Key" : "显示 API Key"}
        style={{
          position: "absolute",
          right: 5,
          top: "50%",
          transform: "translateY(-50%)",
          width: 24,
          height: 24,
          padding: 0,
          border: "none",
          background: "transparent",
          color: "var(--text-dim)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visible ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
            <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
            <path d="M1 1l22 22" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  );
}

function NumInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="number" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={inputStyle} />;
}

function Select({ value, onChange, options, required }: { value: string; onChange: (v: string) => void; options: readonly string[]; required?: boolean }) {
  return (
    <SelectDropdown
      value={value}
      options={[
        ...(!required ? [{ value: "", label: "— inherit / none —" }] : []),
        ...options.map((option) => ({ value: option, label: option })),
      ]}
      onChange={onChange}
      ariaLabel="选择 API 类型"
    />
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-muted)" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        style={{ width: 13, height: 13, accentColor: "var(--accent)", cursor: "pointer" }} />
      {label}
    </label>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 2 }}>{children}</div>;
}

// ── Model sync helpers ───────────────────────────────────────────────────────

const FIXED_EXTENSION_PROVIDER_IDS = ["grok-cli", "kiro", "google-antigravity"] as const;

/** Stable error code → user-facing Chinese message (no raw endpoint/raw body). */
const SYNC_ERROR_MESSAGES: Record<ModelsSyncErrorCode, string> = {
  invalid_request: "请求参数不合法。",
  provider_not_found: "未找到该提供商。",
  provider_not_custom: "该提供商不属于自定义 OpenAI 兼容提供商。",
  unsupported_protocol: "仅支持 OpenAI-compatible API（openai-completions / openai-responses）。",
  invalid_base_url: "请先填写并保存有效的 http(s) Base URL。",
  credential_unavailable: "无法解析该提供商的已保存凭据，请检查 API Key 配置后重试。",
  unsupported_auth: "该提供商的认证方式不支持模型列表同步。",
  auth_failed: "端点拒绝了凭据，请检查 API Key 或自定义认证 Header。",
  endpoint_not_found: "未在已保存 Base URL 下找到 /models 或 /v1/models。",
  rate_limited: "请求过于频繁，请稍后重试。",
  upstream_unavailable: "上游模型服务暂时不可用。",
  timeout: "读取模型列表超时，请检查服务状态后重试。",
  network_error: "无法连接到已配置的模型服务。",
  redirect_blocked: "模型端点发生了不允许的重定向。",
  response_too_large: "远端模型列表超过安全读取上限。",
  invalid_response: "端点返回的不是可识别的 OpenAI 模型列表。",
  too_many_models: "远端模型数量超过安全上限。",
  preview_expired: "预览已过期，请重新读取远端模型。",
  preview_mismatch: "预览数据与当前请求不匹配，请重新预览。",
  stale_revision: "Models 配置已发生变化，请重新预览后再写入。",
  models_config_invalid: "models.json 格式无效，请在修复后再试。",
  write_failed: "写入 models.json 失败。",
  verification_failed: "写后验证失败，文件已恢复。请重试。",
};

type SyncPhase =
  | { phase: "idle" }
  | { phase: "previewing" }
  | { phase: "preview"; data: ModelsConfigSyncPreviewResponse; search: string }
  | { phase: "applying"; data: ModelsConfigSyncPreviewResponse; selectedIds: string[] }
  | { phase: "success"; data: { added: string[]; skipped: string[]; providerId: string } }
  | { phase: "error"; code: ModelsSyncErrorCode };

type SyncSelectionState = Map<string, boolean>;

// ── Model sync preview modal ──────────────────────────────────────────────────

function ModelsSyncPreviewModal({
  providerName,
  syncState,
  selectedNew,
  onToggle,
  onSelectAllNew,
  onClearSelection,
  onSearchChange,
  onPreview,
  onApply,
  onApplyAll,
  onClose,
  onDismiss,
}: {
  providerId: string;
  providerName: string;
  syncState: SyncPhase;
  selectedNew: SyncSelectionState;
  onToggle: (modelId: string) => void;
  onSelectAllNew: () => void;
  onClearSelection: () => void;
  onSearchChange: (q: string) => void;
  onPreview: () => void;
  onApply: () => void;
  onApplyAll: () => void;
  onClose: () => void;
  onDismiss: () => void;
}) {
  const { confirm } = usePrompt();
  const searchRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const [applyBusy, setApplyBusy] = useState(false);
  const busy = syncState.phase === "previewing" || syncState.phase === "applying" || applyBusy;

  // Focus search on preview ready
  useEffect(() => {
    if (syncState.phase === "preview") {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [syncState.phase]);

  // Focus trap + Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (busy) return;
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [busy, onClose]);

  const selectedCount = useMemo(() => {
    let n = 0;
    for (const v of selectedNew.values()) { if (v) n++; }
    return n;
  }, [selectedNew]);

  const handleWriteSelected = useCallback(async () => {
    if (selectedCount === 0) return;
    const ok = await confirm({
      title: `确认写入 ${selectedCount} 个模型？`,
      message: (
        <>
          将向 <strong style={{ fontFamily: "var(--font-mono)" }}>{providerName}</strong>{" "}
          追加 <strong>{selectedCount}</strong> 个模型 ID。{" "}
          只追加 model ID；已有模型、价格、手工字段和{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.95em" }}>modelOverrides</code>{" "}
          不会被覆盖；远端缺失的本地模型不会删除。
        </>
      ),
      confirmLabel: "确认写入",
      cancelLabel: "返回预览",
    });
    if (!ok) return;
    setApplyBusy(true);
    try {
      await onApply();
    } finally {
      setApplyBusy(false);
    }
  }, [selectedCount, confirm, providerName, onApply]);

  const handleWriteAll = useCallback(async () => {
    const newCount = selectedNew.size;
    if (newCount === 0) return;
    const ok = await confirm({
      title: `写入全部 ${newCount} 个新增模型？`,
      message: (
        <>
          将向 <strong style={{ fontFamily: "var(--font-mono)" }}>{providerName}</strong>{" "}
          追加全部 <strong>{newCount}</strong> 个新增模型 ID。{" "}
          只追加 model ID；已有模型、价格、手工字段和{" "}
          <code style={{ fontFamily: "var(--font-mono)", fontSize: "0.95em" }}>modelOverrides</code>{" "}
          不会被覆盖；远端缺失的本地模型不会删除。
        </>
      ),
      confirmLabel: "全部写入",
      cancelLabel: "取消",
    });
    if (!ok) return;
    setApplyBusy(true);
    try {
      await onApplyAll();
    } finally {
      setApplyBusy(false);
    }
  }, [selectedNew.size, confirm, providerName, onApplyAll]);

  const renderContent = () => {
    if (syncState.phase === "previewing") {
      return (
        <div className="models-sync-center">
          <div className="models-sync-box">
            <div className="models-sync-spinner" />
            <h3>正在读取远端模型列表…</h3>
            <p>使用已保存的提供商配置请求模型目录。不会展示凭据、Headers 或上游原始响应。</p>
            <div className="models-sync-actions">
              <button className="btn" onClick={onClose} disabled={busy}>取消</button>
            </div>
          </div>
        </div>
      );
    }

    if (syncState.phase === "error") {
      const message = SYNC_ERROR_MESSAGES[syncState.code] ?? "未知错误，请重试。";
      const isStale = syncState.code === "stale_revision" || syncState.code === "preview_expired";
      return (
        <div className="models-sync-center">
          <div className="models-sync-box">
            <div className="models-sync-error-panel" role="alert">
              <strong>{message}</strong>
            </div>
            <div className="models-sync-actions">
              <button className="btn primary" onClick={isStale ? onPreview : onPreview}>
                {isStale ? "重新预览" : "重试"}
              </button>
              <button className="btn" onClick={onClose}>取消</button>
            </div>
          </div>
        </div>
      );
    }

    if (syncState.phase === "success") {
      const { added, skipped } = syncState.data;
      return (
        <div className="models-sync-center">
          <div className="models-sync-box">
            <div className="models-sync-success-mark">✓</div>
            <h3>{added.length > 0 ? `已新增 ${added.length} 个模型` : "没有新增模型"}</h3>
            <p>Models 配置已重新载入，当前提供商保持选中。</p>
            <div className="models-sync-result-grid">
              <div className="models-sync-result-item"><b>{added.length}</b><span>已新增</span></div>
              <div className="models-sync-result-item"><b>{skipped.length}</b><span>已跳过已存在</span></div>
            </div>
            <p className="models-sync-result-safe">✓ 没有覆盖已有配置，也没有删除本地模型</p>
            <div className="models-sync-actions">
              <button className="btn primary" onClick={onDismiss}>完成</button>
            </div>
          </div>
        </div>
      );
    }

    // phase === "preview" or "applying"
    const data = (syncState.phase === "preview" || syncState.phase === "applying") ? syncState.data : null;
    if (!data) return null;

    const { totals, models } = data;
    const query = (syncState.phase === "preview" ? syncState.search : "").toLowerCase();
    const newCount = models.filter((m) => m.status === "new").length;

    const filtered = query
      ? models.filter((m) => m.id.toLowerCase().includes(query))
      : models;

    const isApplying = syncState.phase === "applying" || applyBusy;

    return (
      <>
        {isApplying && (
          <div className="models-sync-busy-strip">
            <div className="models-sync-spinner" style={{ width: 16, height: 16, borderWidth: 2 }} />
            正在安全合并并验证配置，请勿重复提交…
          </div>
        )}

        {totals.existing > 0 && newCount === 0 ? (
          <div className="models-sync-center">
            <div className="models-sync-box">
              <div className="models-sync-icon">✓</div>
              <h3>所有远端模型都已存在</h3>
              <p>本地配置已经包含远端返回的 {totals.existing} 个模型。已有价格、手工字段与 modelOverrides 保持不变。</p>
              <div className="models-sync-actions">
                <button className="btn" onClick={onPreview}>重新读取</button>
              </div>
            </div>
          </div>
        ) : totals.remote === 0 ? (
          <div className="models-sync-center">
            <div className="models-sync-box">
              <div className="models-sync-icon">∅</div>
              <h3>远端没有返回模型</h3>
              <p>端点返回了可识别的 OpenAI 模型列表，但列表为空。没有发生任何写入。</p>
              <div className="models-sync-actions">
                <button className="btn primary" onClick={onPreview}>重新读取</button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="models-sync-summary">
              <div className="models-sync-metric"><span>远端</span><b>{totals.remote}</b></div>
              <div className="models-sync-metric"><span>新增</span><b>{newCount}</b></div>
              <div className="models-sync-metric"><span>已存在</span><b>{totals.existing}</b></div>
              <div className="models-sync-safe-line">✓ 只会写入新增模型 ID</div>
            </div>

            {/* Toolbar */}
            <div className="models-sync-toolbar">
              <input
                ref={searchRef}
                className="input mono models-sync-search"
                placeholder="搜索模型 ID…"
                aria-label="搜索模型 ID"
                value={syncState.phase === "preview" ? syncState.search : ""}
                onChange={(e) => onSearchChange(e.target.value)}
                disabled={isApplying}
              />
              <button type="button" className="btn" onClick={onSelectAllNew} disabled={isApplying}>全选新增</button>
              <button type="button" className="btn" onClick={onClearSelection} disabled={isApplying}>清空选择</button>
              <span className="models-sync-selected-count">已选 {selectedCount}</span>
            </div>

            {/* Model rows */}
            <div className="models-sync-list">
              {filtered.map((row) => (
                <label
                  key={row.id}
                  className="models-sync-row"
                  style={{ opacity: isApplying ? 0.6 : 1 }}
                >
                  <input
                    type="checkbox"
                    className="models-sync-check"
                    checked={row.status === "new" ? (selectedNew.get(row.id) ?? true) : false}
                    disabled={row.status === "existing" || isApplying}
                    onChange={() => row.status === "new" && onToggle(row.id)}
                    aria-label={row.status === "new" ? `选择 ${row.id}` : `已存在 ${row.id}，不能重复选择`}
                  />
                  <code className="models-sync-id" title={row.id}>{row.id}</code>
                  <span className="models-sync-owned">{row.ownedBy ?? ""}</span>
                  <span className={`models-sync-chip ${row.status}`}>
                    {row.status === "new" ? "新增" : "已存在"}
                  </span>
                </label>
              ))}
              {filtered.length === 0 && query && (
                <div className="models-sync-center" style={{ minHeight: 120 }}>
                  <p>没有匹配的模型。</p>
                </div>
              )}
            </div>
          </>
        )}

        {/* Footer */}
        {totals.remote > 0 && newCount > 0 && (
          <footer className="models-sync-footer">
            <button type="button" className="btn" onClick={onClose} disabled={isApplying}>取消</button>
            <button
              type="button"
              className="btn primary"
              disabled={selectedCount === 0 || isApplying}
              onClick={handleWriteSelected}
            >
              {isApplying ? "写入中…" : `写入所选（${selectedCount}）`}
            </button>
            <button
              type="button"
              className="btn success models-sync-btn-success"
              disabled={newCount === 0 || isApplying}
              onClick={handleWriteAll}
            >
              {isApplying ? "写入中…" : `全部新增并写入（${newCount}）`}
            </button>
          </footer>
        )}
      </>
    );
  };

  // Phase-independent footer for empty/all-existing
  const showFooter = (() => {
    if (syncState.phase === "previewing" || syncState.phase === "error") return false;
    if (syncState.phase === "success") return false;
    const data = (syncState.phase === "preview" || syncState.phase === "applying") ? syncState.data : null;
    if (!data) return false;
    if (data.totals.remote === 0) return true;
    const newCount = data.models.filter((m) => m.status === "new").length;
    if (newCount === 0) return true;
    return false;
  })();

  return (
    <div className="models-sync-overlay" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <section
        ref={dialogRef}
        className="models-sync-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="models-sync-title"
      >
        <header className="models-sync-header">
          <div className="models-sync-title">
            <strong id="models-sync-title">从端点同步模型</strong>
            <code>{providerName}</code>
          </div>
          <button
            className="models-sync-close"
            aria-label="关闭预览"
            onClick={onClose}
            disabled={busy}
          >
            ×
          </button>
        </header>

        <div className="models-sync-body">
          {renderContent()}
        </div>

        {showFooter && (
          <footer className="models-sync-footer">
            <button className="btn" onClick={onClose}>取消</button>
          </footer>
        )}
      </section>
    </div>
  );
}

// ── Provider detail ───────────────────────────────────────────────────────────

function ProviderDetail({ name, provider, onChange, onRename, onDelete, dirty, isCustomDistinct, onSyncPreview }: {
  name: string; provider: ProviderEntry;
  onChange: (p: ProviderEntry) => void; onRename: (n: string) => void; onDelete: () => void;
  /** True when the whole models.json has unsaved local edits. */
  dirty: boolean;
  /** True when this is a custom provider NOT in builtin or fixed extension set. */
  isCustomDistinct: boolean;
  /** Start sync preview flow for this provider. */
  onSyncPreview: () => void;
}) {
  const [editingName, setEditingName] = useState(name);
  useEffect(() => setEditingName(name), [name]);
  const set = <K extends keyof ProviderEntry>(k: K, v: ProviderEntry[K]) => onChange({ ...provider, [k]: v });

  useEffect(() => {
    if (!provider.api) onChange({ ...provider, api: "openai-completions" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider.api]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>提供商</SectionTitle>
        <button onClick={onDelete}
          style={{ padding: "3px 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11 }}>
          删除
        </button>
      </div>

      <Field label="提供商名称">
        <TextInput value={editingName} onChange={setEditingName} placeholder="provider-name" mono />
        {editingName !== name && editingName.trim() && (
          <button onClick={() => onRename(editingName.trim())}
            style={{ marginTop: 4, padding: "3px 10px", background: "var(--accent)", border: "none", borderRadius: 4, color: "#fff", cursor: "pointer", fontSize: 11, alignSelf: "flex-start" }}>
            重命名
          </button>
        )}
      </Field>

      <Field label="Base URL">
        <TextInput value={provider.baseUrl ?? ""} onChange={(v) => set("baseUrl", v || undefined)}
          placeholder="https://api.example.com/v1" mono />
      </Field>

      <Field label="API Key">
        <SecretTextInput value={provider.apiKey ?? ""} onChange={(v) => set("apiKey", v || undefined)}
          placeholder="环境变量名、!shell 命令或明文密钥" mono />
        <span style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>
          以 <code style={{ fontFamily: "var(--font-mono)" }}>!</code> 开头可执行 shell 命令，也可直接填写环境变量名
        </span>
      </Field>

      <Field label="API">
        <Select value={provider.api ?? "openai-completions"} onChange={(v) => set("api", v)} options={API_OPTIONS} required />
      </Field>

      {/* ── Model sync discovery block ── */}
      {isCustomDistinct && <ModelSyncDiscovery
        providerName={name}
        provider={provider}
        dirty={dirty}
        onSyncPreview={onSyncPreview}
      />}
    </div>
  );
}

// ── Model sync discovery block ───────────────────────────────────────────────

function ModelSyncDiscovery({
  providerName,
  provider,
  dirty,
  onSyncPreview,
}: {
  providerName: string;
  provider: ProviderEntry;
  dirty: boolean;
  onSyncPreview: () => void;
}) {
  const api = provider.api ?? "";
  const baseUrl = (provider.baseUrl ?? "").trim();

  // Eligibility
  const isOpenAI = isOpenAICompatibleModelsSyncApi(api);
  let hasValidBaseUrl = false;
  if (baseUrl) {
    try {
      const u = new URL(baseUrl);
      hasValidBaseUrl = u.protocol === "http:" || u.protocol === "https:";
    } catch { /* invalid */ }
  }

  const eligible = isOpenAI && hasValidBaseUrl && !dirty;

  // Disabled reason
  let reason = "";
  if (dirty) reason = "请先保存当前 Models 更改，再从已保存的端点读取模型。";
  else if (!isOpenAI) reason = "仅支持 OpenAI-compatible API（openai-completions / openai-responses）。";
  else if (!hasValidBaseUrl) reason = "请先填写并保存有效的 http(s) Base URL。";

  return (
    <section className="models-sync-discovery">
      <div className="models-sync-discovery-head">
        <div style={{ minWidth: 0 }}>
          <div className="models-sync-discovery-title">从端点同步模型</div>
          <div className="models-sync-discovery-copy">
            读取 <code>{providerName}</code> 已保存 Base URL 的 OpenAI-compatible{" "}
            <code>/models</code>{" "}
            列表。只新增模型 ID，不覆盖已有价格和手工配置。
          </div>
        </div>
        <div className="models-sync-discovery-tags">
          <span className="models-sync-tag models-sync-tag-safe">仅新增</span>
          <span className="models-sync-tag models-sync-tag-confirm">需确认</span>
        </div>
      </div>

      {reason && (
        <div className="models-sync-discovery-reason">
          <span>ⓘ</span>
          <span>{reason}</span>
        </div>
      )}

      <div className="models-sync-discovery-actions">
        <button
          type="button"
          className="btn primary"
          disabled={!eligible}
          onClick={eligible ? onSyncPreview : undefined}
        >
          预览远端模型
        </button>
        <span className="models-sync-discovery-help">
          不会删除本地模型，也不会写入远端返回的能力或价格字段。
        </span>
      </div>
    </section>
  );
}

// ── ThinkingLevelMap editor ───────────────────────────────────────────────────

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevel = typeof THINKING_LEVELS[number];

const LEVEL_COLORS: Record<ThinkingLevel, string> = {
  off:     "var(--text-dim)",
  minimal: "#6b7280",
  low:     "#60a5fa",
  medium:  "#a78bfa",
  high:    "#f472b6",
  xhigh:   "#fb923c",
};

function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null> | undefined;
  onChange: (v: Record<string, string | null> | undefined) => void;
}) {
  const map = value ?? {};

  const setLevel = (level: ThinkingLevel, entry: string | null | "omit") => {
    const next = { ...map };
    if (entry === "omit") {
      delete next[level];
    } else {
      next[level] = entry;
    }
    onChange(Object.keys(next).length ? next : undefined);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {THINKING_LEVELS.map((level) => {
        const raw = map[level];
        const state: "omit" | "null" | "string" =
          !(level in map) ? "omit" : raw === null ? "null" : "string";
        const strVal = typeof raw === "string" ? raw : "";
        const color = LEVEL_COLORS[level];

        const btnBase: React.CSSProperties = {
          padding: "4px 10px",
          fontSize: 10,
          border: "none",
          cursor: "pointer",
          fontWeight: 400,
          transition: "background 0.1s, color 0.1s",
          whiteSpace: "nowrap",
          background: "var(--bg-panel)",
          color: "var(--text-dim)",
        };
        const btnActive: React.CSSProperties = {
          background: "var(--accent)",
          color: "#fff",
          fontWeight: 600,
        };
        const btnActiveDisabled: React.CSSProperties = {
          background: "#ef4444",
          color: "#fff",
          fontWeight: 600,
        };

        return (
          <div
            key={level}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "5px 4px",
              borderRadius: 6,
              background: "transparent",
              border: "1px solid transparent",
            }}
          >
            {/* Level badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 5, width: 68, flexShrink: 0 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0, opacity: state === "null" ? 0.3 : 1 }} />
              <span style={{
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: state === "null" ? "var(--text-dim)" : "var(--text-muted)",
                textDecoration: state === "null" ? "line-through" : "none",
              }}>
                {level}
              </span>
            </div>

            {/* Default + Disabled buttons */}
            <div style={{ display: "flex", borderRadius: 5, border: "1px solid var(--border)", overflow: "hidden", flexShrink: 0 }}>
              <button
                onClick={() => setLevel(level, "omit")}
                style={{ ...btnBase, ...(state === "omit" ? btnActive : {}) }}
              >
                默认
              </button>
              <button
                onClick={() => setLevel(level, null)}
                style={{ ...btnBase, borderLeft: "1px solid var(--border)", ...(state === "null" ? btnActiveDisabled : {}) }}
              >
                禁用
              </button>
            </div>

            {/* Custom button + input fused */}
            <div style={{ display: "flex", borderRadius: 5, border: `1px solid ${state === "string" ? "var(--accent)" : "var(--border)"}`, overflow: "hidden", transition: "border-color 0.1s" }}>
              <button
                onClick={() => setLevel(level, strVal || level)}
                style={{ ...btnBase, ...(state === "string" ? btnActive : {}), borderRight: "1px solid var(--border)", flexShrink: 0 }}
              >
                自定义
              </button>
              <input
                value={strVal}
                onChange={(e) => setLevel(level, e.target.value)}
                onFocus={() => { if (state !== "string") setLevel(level, strVal || level); }}
                placeholder={level}
                maxLength={10}
                style={{
                  width: "12ch",
                  background: state === "string" ? "var(--bg)" : "var(--bg-panel)",
                  border: "none",
                  outline: "none",
                  color: state === "string" ? "var(--text)" : "var(--text-dim)",
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  padding: "4px 7px",
                  transition: "background 0.1s, color 0.1s",
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Model detail ──────────────────────────────────────────────────────────────

const DEEPSEEK_COMPAT = {
  thinkingFormat: "deepseek",
  requiresReasoningContentOnAssistantMessages: true,
} as const;

function hasDeepseekCompat(model: ModelEntry): boolean {
  return model.compat?.thinkingFormat === "deepseek";
}

function setDeepseekCompat(model: ModelEntry, enabled: boolean): ModelEntry {
  if (enabled) {
    return { ...model, compat: { ...(model.compat ?? {}), ...DEEPSEEK_COMPAT } };
  }
  if (!model.compat) return model;
  const rest = { ...model.compat };
  delete rest.thinkingFormat;
  delete rest.requiresReasoningContentOnAssistantMessages;
  return { ...model, compat: Object.keys(rest).length ? rest : undefined };
}

function ModelDetail({
  providerName,
  provider,
  model,
  onChange,
  onDelete,
}: {
  providerName: string;
  provider: ProviderEntry;
  model: ModelEntry;
  onChange: (m: ModelEntry) => void;
  onDelete: () => void;
}) {
  const [testState, setTestState] = useState<ModelTestState>({ phase: "idle" });
  const set = <K extends keyof ModelEntry>(k: K, v: ModelEntry[K]) => onChange({ ...model, [k]: v });
  const costVal = (k: keyof NonNullable<ModelEntry["cost"]>) => model.cost?.[k] !== undefined ? String(model.cost[k]) : "";
  const setCost = (k: keyof NonNullable<ModelEntry["cost"]>, v: string) => {
    const n = parseFloat(v);
    onChange({ ...model, cost: { ...(model.cost ?? {}), [k]: isNaN(n) ? undefined : n } });
  };
  const testSummary = (() => {
    if (testState.phase === "idle") return null;
    if (testState.phase === "testing") return "正在测试模型连接…";
    const meta = [
      testState.latencyMs !== undefined ? `${testState.latencyMs}ms` : null,
      testState.status !== undefined ? `HTTP ${testState.status}` : null,
    ].filter(Boolean);
    if (testState.phase === "success") {
      return ["连接成功", ...meta, testState.responseText || null].filter(Boolean).join(" · ");
    }
    return ["连接失败", ...meta, testState.message].filter(Boolean).join(" · ");
  })();

  useEffect(() => {
    setTestState({ phase: "idle" });
  }, [providerName, provider.baseUrl, provider.api, provider.apiKey, model.id, model.api]);

  const handleTest = useCallback(async () => {
    if (!model.id.trim() || testState.phase === "testing") return;
    setTestState({ phase: "testing" });
    try {
      const res = await fetch("/api/models-config/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerName, provider, model }),
      });
      const d = await res.json() as {
        ok?: boolean;
        error?: string;
        latencyMs?: number;
        status?: number;
        responseText?: string;
      };
      if (!res.ok || !d.ok) {
        setTestState({
          phase: "error",
          message: d.error ?? `HTTP ${res.status}`,
          latencyMs: d.latencyMs,
          status: d.status,
        });
        return;
      }
      setTestState({
        phase: "success",
        latencyMs: d.latencyMs,
        status: d.status,
        responseText: d.responseText,
      });
    } catch (e) {
      setTestState({ phase: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [model, provider, providerName, testState.phase]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>模型</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {testSummary && (
            <span
              title={testSummary}
              style={{
                maxWidth: 260,
                height: 24,
                padding: "0 8px",
                border: `1px solid ${testState.phase === "error" ? "#fecaca" : testState.phase === "success" ? "#bbf7d0" : "var(--border)"}`,
                borderRadius: 4,
                background: testState.phase === "error" ? "#fee2e2" : testState.phase === "success" ? "#dcfce7" : "#e5e7eb",
                color: "#111827",
                fontSize: 11,
                display: "inline-flex",
                alignItems: "center",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                boxSizing: "border-box",
              }}
            >
              {testSummary}
            </span>
          )}
          <button
            onClick={handleTest}
            disabled={!model.id.trim() || testState.phase === "testing"}
            title="测试模型连接"
            style={{
              height: 24,
              padding: "0 8px",
              background: testState.phase === "success" ? "#16a34a" : "none",
              border: `1px solid ${testState.phase === "success" ? "#16a34a" : "var(--border)"}`,
              borderRadius: 4,
              color: testState.phase === "success" ? "#fff" : (!model.id.trim() || testState.phase === "testing") ? "var(--text-dim)" : "var(--text-muted)",
              cursor: (!model.id.trim() || testState.phase === "testing") ? "not-allowed" : "pointer",
              fontSize: 11,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              boxSizing: "border-box",
              gap: 5,
            }}
          >
            {testState.phase === "success" && (
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {testState.phase === "testing" ? "测试中…" : testState.phase === "success" ? "通过" : "测试"}
          </button>
          <button onClick={onDelete}
            style={{ height: 24, padding: "0 8px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: "#ef4444", cursor: "pointer", fontSize: 11, boxSizing: "border-box" }}>
            移除
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="ID *"><TextInput value={model.id} onChange={(v) => set("id", v)} placeholder="model-id" mono /></Field>
        <Field label="名称"><TextInput value={model.name ?? ""} onChange={(v) => set("name", v || undefined)} placeholder="显示名称" /></Field>
      </div>

      <Field label="API 覆盖">
        <Select value={model.api ?? ""} onChange={(v) => set("api", v || undefined)} options={API_OPTIONS} />
      </Field>

      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <Check label="推理 / Thinking" checked={model.reasoning ?? false} onChange={(v) => set("reasoning", v || undefined)} />
        <Check label="支持图片输入" checked={model.input?.includes("image") ?? false}
          onChange={(v) => set("input", v ? ["text", "image"] : undefined)} />
      </div>

      {model.reasoning && (
        <>
          <Check
            label="DeepSeek Thinking 兼容"
            checked={hasDeepseekCompat(model)}
            onChange={(v) => onChange(setDeepseekCompat(model, v))}
          />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <SectionTitle>Thinking 级别映射</SectionTitle>
              {model.thinkingLevelMap && (
                <button
                  onClick={() => set("thinkingLevelMap", undefined)}
                  style={{ fontSize: 10, padding: "2px 7px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-dim)", cursor: "pointer" }}
                >
                  全部清除
                </button>
              )}
            </div>
            <ThinkingLevelMapEditor
              value={model.thinkingLevelMap}
              onChange={(v) => set("thinkingLevelMap", v)}
            />
          </div>
        </>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="上下文窗口（tokens）">
          <NumInput value={model.contextWindow !== undefined ? String(model.contextWindow) : ""}
            onChange={(v) => set("contextWindow", v ? parseInt(v) : undefined)} placeholder="128000" />
        </Field>
        <Field label="最大输出 tokens">
          <NumInput value={model.maxTokens !== undefined ? String(model.maxTokens) : ""}
            onChange={(v) => set("maxTokens", v ? parseInt(v) : undefined)} placeholder="16384" />
        </Field>
      </div>

      <div>
        <SectionTitle>费用（每百万 tokens）</SectionTitle>
        <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
          {([
            ["input", "输入"],
            ["output", "输出"],
            ["cacheRead", "缓存读取"],
            ["cacheWrite", "缓存写入"],
          ] as const).map(([k, label]) => (
            <Field key={k} label={label}>
              <NumInput value={costVal(k)} onChange={(v) => setCost(k, v)} placeholder="0" />
            </Field>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── OAuth detail ──────────────────────────────────────────────────────────────

/**
 * 渲染 OAuth 订阅额度查询结果。
 *
 * @param props.quota 当前订阅额度结果。
 * @param props.loading 是否正在刷新额度。
 * @param props.onRefresh 手动刷新额度的回调。
 * @returns 订阅额度展示内容。
 */
function OAuthQuotaView({
  quota,
  loading,
  account,
  resetting,
  onRefresh,
  onReset,
}: {
  quota: SubscriptionQuota | null;
  loading: boolean;
  account: OAuthAccountSummary | null;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
}) {
  if (!quota && !loading && !account) return null;

  const displayedQuota = quota?.success ? quota : account?.quotaCache;
  const knownTiers = knownQuotaTiers(displayedQuota?.tiers ?? []);
  const resetCreditsAvailableCount = displayedQuota?.resetCreditsAvailableCount ?? null;
  const resetCredits = displayedQuota?.resetCredits ?? [];
  const resetCreditsError = displayedQuota?.resetCreditsError ?? null;
  const resetExpiresAt = earliestResetCreditExpiration(resetCredits);
  const resetExpiresCountdown = formatResetCountdown(resetExpiresAt);
  const canReset = Boolean(account) && (resetCreditsAvailableCount ?? 0) > 0;

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>用量</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {loading ? "刷新中…" : `更新于 ${formatQuotaQueriedAt(displayedQuota?.queriedAt ?? null)}`}
          </span>
        </div>
        <button
          onClick={() => onRefresh()}
          disabled={loading || resetting}
          {...iconFlowAttrs(loading || resetting ? "off" : "interactive")}
          title="刷新用量"
          aria-label="刷新用量"
          style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: loading || resetting ? "var(--text-dim)" : "var(--text-muted)", cursor: loading || resetting ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
        >
          <ActionFlowIcon width={14} height={14} strokeWidth={2}>
            <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
            <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
            <path d="M3 4v8h8" />
            <path d="M21 20v-8h-8" />
          </ActionFlowIcon>
        </button>
      </div>

      {account && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, minWidth: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: account.active ? "#4ade80" : "var(--border)", flexShrink: 0 }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.maskedAccountId}</span>
            {account.extraInfo && <span style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.extraInfo}</span>}
          </div>
          <span style={{ fontSize: 11, color: account.active ? "#4ade80" : "var(--text-dim)", fontWeight: 600, flexShrink: 0 }}>
            {account.active ? "当前账号" : "临时查看"}
          </span>
        </div>
      )}

      {resetCreditsAvailableCount !== null && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>重置额度：{resetCreditsAvailableCount}</span>
            <span style={{ fontSize: 10, color: resetCreditsError ? "#fb923c" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {resetCreditsError ? resetCreditsError : resetExpiresCountdown ? `最早将于 ${resetExpiresCountdown} 后过期` : resetExpiresAt ? `最早过期：${new Date(resetExpiresAt).toLocaleDateString()}` : "暂无额度过期信息"}
            </span>
          </div>
          {canReset && (
            <button
              type="button"
              onClick={() => onReset()}
              disabled={loading || resetting}
              title={resetExpiresCountdown ? `将消耗 1 次重置额度。最早将于 ${resetExpiresCountdown} 后过期` : "将消耗 1 次 Codex 重置额度"}
              style={{ padding: "5px 10px", border: "1px solid rgba(34,197,94,0.45)", borderRadius: 5, background: "transparent", color: loading || resetting ? "var(--text-dim)" : "#22c55e", cursor: loading || resetting ? "default" : "pointer", fontSize: 11, fontWeight: 700, flexShrink: 0 }}
            >
              {resetting ? "重置中…" : "重置限额"}
            </button>
          )}
        </div>
      )}

      {quota && quota.credentialStatus === "expired" && !quota.success && (
        <div style={{ fontSize: 12, color: "#fb923c", lineHeight: 1.5 }}>{quota.error ?? "Token 已过期，请重新登录。"}</div>
      )}

      {quota && quota.credentialStatus === "parse_error" && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{quota.error ?? "读取 OAuth 凭证失败。"}</div>
      )}

      {quota && quota.credentialStatus === "not_found" && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>未找到 OAuth 凭证。</div>
      )}

      {quota && quota.credentialStatus === "valid" && !quota.success && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{quota.error ?? "用量查询失败。"}</div>
      )}

      {quota?.success && knownTiers.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>未返回任何配额窗口。</div>
      )}

      {knownTiers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {knownTiers.map((tier) => {
            const color = quotaColor(tier.utilization);
            const countdown = formatResetCountdown(tier.resetsAt);
            return (
              <div key={tier.name} style={{ display: "grid", gridTemplateColumns: "46px 1fr 84px", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{QUOTA_TIER_LABELS[tier.name]}</span>
                <div style={{ height: 6, borderRadius: 99, background: "var(--bg)", border: "1px solid var(--border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${Math.min(Math.max(tier.utilization, 0), 100)}%`, background: color }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{Math.round(tier.utilization)}%</span>
                  {countdown && <span style={{ fontSize: 10, color: "var(--text-dim)", whiteSpace: "nowrap" }}>{countdown}</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function accountQuotaResetText(account: OAuthAccountSummary): string {
  const resetCreditsAvailableCount = account.quotaCache?.resetCreditsAvailableCount;
  const resetCreditsText = typeof resetCreditsAvailableCount === "number" ? `重置额度 ${resetCreditsAvailableCount}` : null;
  const tiers = knownQuotaTiers(account.quotaCache?.tiers ?? []).filter((tier) => tier.resetsAt);
  if (tiers.length === 0) return resetCreditsText ?? (account.quotaCache?.queriedAt ? "无重置时间" : "无配额缓存");
  const windowsText = tiers.map((tier) => {
    const countdown = formatResetCountdown(tier.resetsAt);
    return `${QUOTA_TIER_LABELS[tier.name]} ${countdown ?? "已到期"}`;
  }).join(" · ");
  return resetCreditsText ? `${windowsText} · ${resetCreditsText}` : windowsText;
}

function AccountQuotaMiniCharts({ account }: { account: OAuthAccountSummary }) {
  const tiers = knownQuotaTiers(account.quotaCache?.tiers ?? []);
  if (tiers.length === 0) return null;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 6, verticalAlign: "middle" }}>
      {tiers.map((tier) => {
        const utilization = Math.min(Math.max(tier.utilization, 0), 100);
        const color = quotaColor(utilization);
        const label = QUOTA_TIER_LABELS[tier.name];
        return (
          <span key={tier.name} title={`${label} 已使用 ${Math.round(utilization)}%`} style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
            <span style={{ width: 16, height: 16, borderRadius: "50%", background: `conic-gradient(${color} ${utilization * 3.6}deg, var(--bg-panel) 0deg)`, border: "1px solid var(--border)", display: "inline-flex", alignItems: "center", justifyContent: "center", boxSizing: "border-box" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--bg)" }} />
            </span>
            <span style={{ fontSize: 9, color: "var(--text-dim)", fontWeight: 600 }}>{label}</span>
          </span>
        );
      })}
    </span>
  );
}

function OAuthAccountsView({
  accounts,
  loading,
  error,
  activatingAccountId,
  savingLabelAccountId,
  savingExtraInfoAccountId,
  refreshingQuotaAccountId,
  quotaResetting,
  deletingAccountId,
  selectedAccountId,
  hideCodexQuotaSummary = false,
  onRefresh,
  onSelect,
  onActivate,
  onEditLabel,
  onEditExtraInfo,
  onRefreshQuota,
  onDelete,
  onWarmup,
  onReauthenticate,
  actionsDisabled,
}: {
  accounts: OAuthAccountSummary[];
  loading: boolean;
  error: string | null;
  activatingAccountId: string | null;
  savingLabelAccountId: string | null;
  savingExtraInfoAccountId: string | null;
  refreshingQuotaAccountId: string | null;
  quotaResetting: boolean;
  deletingAccountId: string | null;
  selectedAccountId: string | null;
  /** Hide Codex-only reset-credit / mini pie summary (Grok/Kiro). */
  hideCodexQuotaSummary?: boolean;
  onRefresh: () => void;
  onSelect: (account: OAuthAccountSummary) => void;
  onActivate: (accountId: string) => void;
  onEditLabel: (account: OAuthAccountSummary) => void;
  onEditExtraInfo: (account: OAuthAccountSummary) => void;
  onRefreshQuota: (account: OAuthAccountSummary) => void;
  onDelete: (account: OAuthAccountSummary) => void;
  onWarmup?: () => void;
  /** Grok-only: opens reauth confirm dialog for the given account. */
  onReauthenticate?: (account: OAuthAccountSummary) => void;
  /** When true, all action buttons (Activate, Delete, edit, quota refresh) are disabled. */
  actionsDisabled?: boolean;
}) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>账号</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{loading ? "加载中…" : `已保存 ${accounts.length} 个`}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {onWarmup && (
            <button
              onClick={onWarmup}
              disabled={loading || accounts.length === 0}
              style={{ padding: "5px 10px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: loading || accounts.length === 0 ? "var(--text-dim)" : "var(--accent)", cursor: loading || accounts.length === 0 ? "not-allowed" : "pointer", fontSize: 11, fontWeight: 700 }}
            >
              预热
            </button>
          )}
          <button
            onClick={onRefresh}
            disabled={loading}
            {...iconFlowAttrs(loading ? "off" : "interactive")}
            title="刷新账号"
            aria-label="刷新账号"
            style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: loading ? "var(--text-dim)" : "var(--text-muted)", cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
          >
            <ActionFlowIcon width={14} height={14} strokeWidth={2}>
              <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
              <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
              <path d="M3 4v8h8" />
              <path d="M21 20v-8h-8" />
            </ActionFlowIcon>
          </button>
        </div>
      </div>

      {error && <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{error}</div>}
      {!loading && !error && accounts.length === 0 && (
        <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>暂无已保存账号。</div>
      )}

      {accounts.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {accounts.map((account) => {
            const quotaRefreshing = refreshingQuotaAccountId === account.accountId;
            const selected = selectedAccountId === account.accountId;
            return (
              <div key={account.accountId} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "8px 9px", background: selected ? "var(--bg-selected)" : "var(--bg)", border: selected ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 5, rowGap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: account.active ? "#4ade80" : "var(--border)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <span title={account.displayName} style={{ fontSize: 12, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</span>
                  <span title={account.maskedAccountId} style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.maskedAccountId}</span>
                  {account.extraInfo && <span title={account.extraInfo} style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.extraInfo}</span>}
                  {!hideCodexQuotaSummary && (
                    <div style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0, fontSize: 10, color: account.quotaCache?.error ? "#fb923c" : "var(--text-dim)" }}>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                        重置：{accountQuotaResetText(account)}{account.quotaCache?.queriedAt ? ` · ${formatQuotaQueriedAt(account.quotaCache.queriedAt)}` : ""}
                      </span>
                      <AccountQuotaMiniCharts account={account} />
                    </div>
                  )}
                </div>
                <button
                  onClick={() => onSelect(account)}
                  disabled={selected || Boolean(refreshingQuotaAccountId) || quotaResetting || actionsDisabled}
                  style={{ padding: "4px 9px", background: selected ? "var(--accent)" : "none", border: selected ? "1px solid var(--accent)" : "1px solid var(--border)", borderRadius: 4, color: selected ? "#fff" : (quotaResetting || actionsDisabled) ? "var(--text-dim)" : "var(--accent)", cursor: selected || refreshingQuotaAccountId || quotaResetting || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  {selected ? "查看中" : "查看"}
                </button>
                <button
                  onClick={() => onEditLabel(account)}
                  disabled={savingLabelAccountId === account.accountId || actionsDisabled}
                  style={{ padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: savingLabelAccountId === account.accountId || actionsDisabled ? "var(--text-dim)" : "var(--text-muted)", cursor: savingLabelAccountId === account.accountId || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  {savingLabelAccountId === account.accountId ? "保存中…" : "备注"}
                </button>
                <button
                  onClick={() => onEditExtraInfo(account)}
                  disabled={savingExtraInfoAccountId === account.accountId || actionsDisabled}
                  style={{ padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: savingExtraInfoAccountId === account.accountId || actionsDisabled ? "var(--text-dim)" : "var(--text-muted)", cursor: savingExtraInfoAccountId === account.accountId || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                >
                  {savingExtraInfoAccountId === account.accountId ? "保存中…" : "详情"}
                </button>
                {account.active ? (
                  <span style={{ fontSize: 11, color: "#4ade80", fontWeight: 600 }}>当前</span>
                ) : (
                  <>
                    <button
                      onClick={() => onActivate(account.accountId)}
                      disabled={Boolean(activatingAccountId) || deletingAccountId === account.accountId || actionsDisabled}
                      style={{ padding: "4px 9px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: activatingAccountId === account.accountId || actionsDisabled ? "var(--text-dim)" : "var(--accent)", cursor: activatingAccountId || deletingAccountId === account.accountId || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      {activatingAccountId === account.accountId ? "启用中…" : "启用"}
                    </button>
                    <button
                      onClick={() => onDelete(account)}
                      disabled={Boolean(deletingAccountId) || Boolean(activatingAccountId) || actionsDisabled}
                      style={{ padding: "4px 9px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: deletingAccountId === account.accountId || actionsDisabled ? "var(--text-dim)" : "#ef4444", cursor: deletingAccountId || activatingAccountId || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                    >
                      {deletingAccountId === account.accountId ? "删除中…" : "删除"}
                    </button>
                  </>
                )}
                {onReauthenticate && (
                  <button
                    onClick={() => onReauthenticate(account)}
                    disabled={Boolean(refreshingQuotaAccountId) || quotaResetting || Boolean(activatingAccountId) || Boolean(deletingAccountId) || actionsDisabled}
                    title="重新登录此账号"
                    aria-label={`重新登录 ${account.displayName}`}
                    style={{ padding: "4px 9px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 4, color: refreshingQuotaAccountId || quotaResetting || activatingAccountId || deletingAccountId || actionsDisabled ? "var(--text-dim)" : "#ef4444", cursor: refreshingQuotaAccountId || quotaResetting || activatingAccountId || deletingAccountId || actionsDisabled ? "default" : "pointer", fontSize: 11, fontWeight: 600 }}
                  >
                    重新登录
                  </button>
                )}
                <button
                  onClick={() => onRefreshQuota(account)}
                  disabled={Boolean(refreshingQuotaAccountId) || quotaResetting || actionsDisabled}
                  title="刷新该账号配额重置时间"
                  aria-label="刷新该账号配额重置时间"
                  style={{ width: 28, height: 28, padding: 0, background: "none", border: "1px solid var(--border)", borderRadius: 4, color: quotaRefreshing || quotaResetting || actionsDisabled ? "var(--text-dim)" : "var(--accent)", cursor: refreshingQuotaAccountId || quotaResetting || actionsDisabled ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
                    <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
                    <path d="M3 4v8h8" />
                    <path d="M21 20v-8h-8" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ExtraInfoDialog({
  account,
  saving,
  onSave,
  onClose,
}: {
  account: OAuthAccountSummary;
  saving: boolean;
  onSave: (account: OAuthAccountSummary, extraInfo: string) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(account.extraInfo ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(account.extraInfo ?? "");
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, [account]);

  return (
    <div
      className="pi-modal-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div className="pi-modal-panel pi-modal-panel-compact" style={{ width: 520, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>账号详情</div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{account.displayName}</div>
          </div>
          <button type="button" disabled={saving} onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: saving ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>补充信息</label>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={saving}
            placeholder="可填写订阅归属、续费说明、使用提示等…"
            style={{ minHeight: 120, resize: "vertical", padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12, outline: "none", boxSizing: "border-box", lineHeight: 1.5 }}
          />
          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>留空将清除该账号的补充信息。</div>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={saving} onClick={onClose} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: saving ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
          <button type="button" disabled={saving} onClick={() => onSave(account, value)} style={{ padding: "6px 14px", background: saving ? "var(--bg-panel)" : "var(--accent)", border: "none", borderRadius: 6, color: saving ? "var(--text-dim)" : "#fff", cursor: saving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>{saving ? "保存中…" : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

function AddAccountDialog({
  provider,
  view,
  onViewChange,
  onCodexAuth,
  onImported,
  onClose,
}: {
  provider: OAuthProvider;
  view: "method" | "json";
  onViewChange: (view: "method" | "json") => void;
  onCodexAuth: () => void;
  onImported: (accounts: OAuthAccountSummary[]) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<OAuthAccountImportMode>("raw");
  const [jsonText, setJsonText] = useState("");
  const [convertedJsonText, setConvertedJsonText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversionWarnings, setConversionWarnings] = useState<OAuthAccountImportWarning[]>([]);
  const [validationMessage, setValidationMessage] = useState<{ type: "success" | "warning" | "error"; text: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const converter = mode === "raw" ? undefined : ACCOUNT_JSON_CONVERTERS[mode];
  const finalJsonText = converter ? convertedJsonText : jsonText;

  useEffect(() => {
    if (view === "json") setTimeout(() => textareaRef.current?.focus(), 50);
  }, [view]);

  const parseFinalCredential = useCallback((): unknown | null => {
    try {
      return JSON.parse(finalJsonText);
    } catch (parseError) {
      setValidationMessage({ type: "error", text: parseError instanceof Error ? `最终 JSON 格式无效：${parseError.message}` : "最终 JSON 格式无效" });
      return null;
    }
  }, [finalJsonText]);

  const validateFinalJson = useCallback((): unknown | null => {
    setError(null);
    const credential = parseFinalCredential();
    if (!credential) return null;
    const validationError = validateRawOAuthCredentialImport(credential);
    if (validationError) {
      setValidationMessage({ type: "error", text: validationError });
      return null;
    }
    if (conversionWarnings.length > 0) {
      setValidationMessage({ type: "warning", text: conversionWarnings[0].message });
    } else {
      setValidationMessage({ type: "success", text: Array.isArray(credential) ? `验证通过：最终 JSON 可以保存 ${credential.length} 个账号。` : "验证通过：最终 JSON 可以保存为账号。" });
    }
    return credential;
  }, [conversionWarnings, parseFinalCredential]);

  const convertSourceJson = useCallback(() => {
    if (!converter) return;
    setError(null);
    setConversionWarnings([]);
    setValidationMessage(null);

    let source: unknown;
    try {
      source = JSON.parse(jsonText);
    } catch (parseError) {
      setError(parseError instanceof Error ? `源 JSON 格式无效：${parseError.message}` : "源 JSON 格式无效");
      return;
    }

    try {
      const converted = convertOAuthAccountCredentialWithWarnings(mode, source);
      const finalCredential = converted.credentials.length === 1 ? converted.credentials[0] : converted.credentials;
      setConvertedJsonText(JSON.stringify(finalCredential, null, 2));
      setConversionWarnings(converted.warnings);
      setValidationMessage(converted.warnings.length > 0
        ? { type: "warning", text: converted.warnings[0].message }
        : { type: "success", text: "转换完成，请检查下方最终 JSON 后保存。" });
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : "转换失败");
    }
  }, [converter, jsonText, mode]);

  const submitRawJson = useCallback(async () => {
    if (submitting) return;
    const credential = validateFinalJson();
    if (!credential) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "raw", credential }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onImported(data.accounts ?? []);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "导入账号失败");
    } finally {
      setSubmitting(false);
    }
  }, [onClose, onImported, provider.id, submitting, validateFinalJson]);

  const modeButton = (value: OAuthAccountImportMode, label: string, disabled = false) => {
    const active = mode === value;
    return (
      <button
        type="button"
        disabled={disabled || submitting}
        onClick={() => {
          if (disabled) return;
          setMode(value);
          setError(null);
          setConversionWarnings([]);
          setValidationMessage(null);
        }}
        style={{
          padding: "6px 9px",
          borderRadius: 6,
          border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
          background: active ? "rgba(59,130,246,0.12)" : "var(--bg-panel)",
          color: disabled ? "var(--text-dim)" : active ? "var(--accent)" : "var(--text-muted)",
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 12,
          fontWeight: active ? 600 : 500,
          opacity: disabled ? 0.55 : 1,
        }}
      >
        {label}{disabled ? " · 后续支持" : ""}
      </button>
    );
  };

  return (
    <div
      className="pi-modal-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="pi-modal-panel" style={{ width: view === "json" ? 920 : 560, maxWidth: "calc(100vw - 32px)", maxHeight: "min(82vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <ProviderIcon id={provider.id} size={18} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>添加 {provider.name} 账号</div>
              <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>选择一种账号添加方式。</div>
            </div>
          </div>
          <button type="button" disabled={submitting} onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: submitting ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {view === "method" ? (
          <div style={{ padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 10 }}>
            <button type="button" onClick={onCodexAuth} style={{ padding: 14, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>Codex 授权</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>打开现有浏览器登录授权流程，并保存授权后的账号。</div>
            </button>
            <button type="button" onClick={() => onViewChange("json")} style={{ padding: 14, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "left" }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 5 }}>输入授权 JSON</div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>粘贴与账号原始保存文件一致的 OAuth credential JSON。</div>
            </button>
          </div>
        ) : (
          <>
            <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  请粘贴原始 credential 对象，或由 CPA/SUB2API 转换得到的 credential 数组。{mode === "cpa" ? <>CPA 至少需要有效的 <code style={{ fontFamily: "var(--font-mono)" }}>access_token</code> 和过期时间；<code style={{ fontFamily: "var(--font-mono)" }}>refresh_token</code> 可省略，但过期后无法自动刷新。</> : <>必填字段为 <code style={{ fontFamily: "var(--font-mono)" }}>type</code>、<code style={{ fontFamily: "var(--font-mono)" }}>access</code>、<code style={{ fontFamily: "var(--font-mono)" }}>refresh</code> 和 <code style={{ fontFamily: "var(--font-mono)" }}>expires</code>。</>}账号会被保存，但不会自动切换为当前激活账号。
                </div>
                <pre style={{ margin: 0, padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 11, lineHeight: 1.5, overflow: "auto", fontFamily: "var(--font-mono)" }}>{RAW_ACCOUNT_JSON_EXAMPLE}</pre>
                <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                  如果省略 <code style={{ fontFamily: "var(--font-mono)" }}>accountId</code>，yolk pi web 会尝试从 access token 中解析，失败时使用稳定 fallback。账号显示名会按邮箱、手机号、accountId 的顺序自动补全。
                </div>
                {mode === "cpa" && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5, padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8 }}>
                    多账号支持：每条 CPA 凭据都会独立保存，即使真实 ChatGPT account id 相同也不会覆盖已有账号。
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {modeButton("raw", "原文 JSON")}
                  {modeButton("cpa", "CPA 格式")}
                  {modeButton("sub2api", "SUB2API 格式")}
                </div>
                {converter ? (
                  <>
                    <textarea
                      ref={textareaRef}
                      value={jsonText}
                      onChange={(e) => { setJsonText(e.target.value); setError(null); setConversionWarnings([]); setValidationMessage(null); }}
                      placeholder={converter.sourcePlaceholder}
                      spellCheck={false}
                      style={{ minHeight: 150, resize: "vertical", padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box", lineHeight: 1.5 }}
                    />
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                      <button type="button" disabled={submitting || !jsonText.trim()} onClick={convertSourceJson} style={{ padding: "6px 12px", background: !submitting && jsonText.trim() ? "var(--accent)" : "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 6, color: !submitting && jsonText.trim() ? "#fff" : "var(--text-dim)", cursor: !submitting && jsonText.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}>转换 ↓</button>
                      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{converter.label} → 原文 OAuth JSON</span>
                    </div>
                    <textarea
                      value={convertedJsonText}
                      onChange={(e) => { setConvertedJsonText(e.target.value); setError(null); setConversionWarnings([]); setValidationMessage(null); }}
                      placeholder={RAW_ACCOUNT_JSON_EXAMPLE}
                      spellCheck={false}
                      style={{ minHeight: 150, resize: "vertical", padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box", lineHeight: 1.5 }}
                    />
                  </>
                ) : (
                  <textarea
                    ref={textareaRef}
                    value={jsonText}
                    onChange={(e) => { setJsonText(e.target.value); setError(null); setConversionWarnings([]); setValidationMessage(null); }}
                    placeholder={RAW_ACCOUNT_JSON_EXAMPLE}
                    spellCheck={false}
                    style={{ minHeight: 260, resize: "vertical", padding: "9px 10px", background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box", lineHeight: 1.5 }}
                  />
                )}
                {error && <div role="alert" aria-live="assertive" style={{ display: "flex", gap: 8, padding: "10px 12px", background: "rgba(248,113,113,0.15)", border: "1px solid #f87171", borderRadius: 6, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>转换失败：{error}</div>}
                {validationMessage && (
                  <div
                    role={validationMessage.type === "error" ? "alert" : "status"}
                    aria-live={validationMessage.type === "error" ? "assertive" : "polite"}
                    style={{ display: "flex", gap: 8, padding: "10px 12px", background: validationMessage.type === "warning" ? "rgba(245,158,11,0.12)" : validationMessage.type === "success" ? "rgba(52,211,153,0.15)" : "rgba(248,113,113,0.15)", border: `1px solid ${validationMessage.type === "warning" ? "rgba(245,158,11,0.45)" : validationMessage.type === "success" ? "#34d399" : "#f87171"}`, borderRadius: 6, fontSize: 12, color: validationMessage.type === "warning" ? "#f59e0b" : validationMessage.type === "success" ? "#34d399" : "#f87171", lineHeight: 1.5 }}
                  >
                    <span aria-hidden="true">{validationMessage.type === "warning" ? "⚠" : validationMessage.type === "success" ? "✓" : "!"}</span>
                    <span>{validationMessage.text}</span>
                  </div>
                )}
              </div>
            </div>

            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 8 }}>
              <button type="button" disabled={submitting} onClick={() => onViewChange("method")} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: submitting ? "not-allowed" : "pointer", fontSize: 12 }}>返回</button>
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" disabled={submitting} onClick={onClose} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: submitting ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
                <button type="button" disabled={submitting || !finalJsonText.trim()} onClick={validateFinalJson} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: !submitting && finalJsonText.trim() ? "var(--text-muted)" : "var(--text-dim)", cursor: !submitting && finalJsonText.trim() ? "pointer" : "not-allowed", fontSize: 12 }}>验证</button>
                <button type="button" disabled={submitting || !finalJsonText.trim()} onClick={submitRawJson} style={{ padding: "6px 14px", background: !submitting && finalJsonText.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 6, color: !submitting && finalJsonText.trim() ? "#fff" : "var(--text-dim)", cursor: !submitting && finalJsonText.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}>{submitting ? "保存中…" : "保存账号"}</button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Grok Delete Confirmation Dialog ──────────────────────────────────────────

function ManagedOAuthDeleteConfirmDialog({
  providerLabel,
  account,
  allAccounts,
  deleting,
  onConfirm,
  onClose,
}: {
  providerLabel: string;
  account: OAuthAccountSummary;
  allAccounts: OAuthAccountSummary[];
  deleting: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isActive = account.active;
  const replacement = allAccounts.find((a) => a.accountId !== account.accountId);

  let title: string;
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (isActive) {
    title = "⚠️ 无法直接删除当前账号";
    body = (
      <>
        <p style={{ marginBottom: 12, color: "var(--danger)", fontWeight: 600 }}>
          账号「{account.label || account.displayName}」当前处于活动激活状态。
        </p>
        <p style={{ lineHeight: 1.6 }}>
          删除此账号前，系统将自动激活另一个可用账号作为默认。
          {replacement ? (
            <> 将激活「{replacement.label || replacement.displayName}」。</>
          ) : (
            <> 但当前没有其他可用账号，删除后将恢复为未连接状态。</>
          )}
        </p>
      </>
    );
    footer = (
      <>
        <button onClick={onClose} disabled={deleting} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: deleting ? "not-allowed" : "pointer", fontSize: 12 }}>关闭</button>
        <button onClick={onConfirm} disabled={deleting} style={{ padding: "6px 14px", background: deleting ? "var(--bg-panel)" : "var(--accent)", border: "none", borderRadius: 6, color: deleting ? "var(--text-dim)" : "#fff", cursor: deleting ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
          {deleting ? "删除中…" : "自动切号并删除"}
        </button>
      </>
    );
  } else {
    title = "⚠️ 确定删除此账号？";
    body = (
      <>
        <p style={{ marginBottom: 12, lineHeight: 1.6 }}>
          确定要永久删除账号「{account.label || account.displayName}」（{account.maskedAccountId}）吗？此操作无法撤销。
        </p>
        <div style={{ background: "var(--bg-panel)", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 11 }}>
          <strong style={{ display: "block", marginBottom: 6, color: "var(--text)" }}>系统提示：</strong>
          <p style={{ margin: 0, color: "var(--text-muted)", lineHeight: 1.5 }}>
            删除后，{providerLabel} 请求会继续使用当前全局 Active 账号的凭证。
            不会导致会话数据丢失。
          </p>
        </div>
      </>
    );
    footer = (
      <>
        <button onClick={onClose} disabled={deleting} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: deleting ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
        <button onClick={onConfirm} disabled={deleting} style={{ padding: "6px 14px", background: deleting ? "var(--bg-panel)" : "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 6, color: deleting ? "var(--text-dim)" : "#ef4444", cursor: deleting ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
          {deleting ? "删除中…" : "确认删除"}
        </button>
      </>
    );
  }

  return (
    <div
      className="pi-modal-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !deleting) onClose(); }}
    >
      <div className="pi-modal-panel pi-modal-panel-compact" style={{ width: 460, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: isActive ? "var(--danger)" : "var(--text)" }}>{title}</div>
          <button type="button" disabled={deleting} onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: deleting ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
        <div style={{ padding: 14, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {body}
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

// ── Grok Reauth Confirm Dialog ───────────────────────────────────────────

function GrokReauthConfirmDialog({
  account,
  busy,
  onConfirm,
  onClose,
}: {
  account: OAuthAccountSummary;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const isActive = account.active;
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const headingId = `grok-reauth-dialog-heading-${account.accountId}`;

  // Focus trap: save previous focus, focus confirm button on mount, restore on unmount.
  const previousFocusRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const timer = setTimeout(() => confirmBtnRef.current?.focus(), 50);
    return () => {
      clearTimeout(timer);
      previousFocusRef.current?.focus();
    };
  }, []);

  // Escape to close (only when not busy).
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [busy, onClose]);

  // Focus trap — keep Tab focus within the dialog.
  useEffect(() => {
    const handleTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const el = dialogRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleTab);
    return () => document.removeEventListener("keydown", handleTab);
  }, []);

  return (
    <div
      className="pi-modal-overlay"
      role="presentation"
      style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        className="pi-modal-panel pi-modal-panel-compact"
        style={{ width: 480, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}
      >
        <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div id={headingId} style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>⚠️ 重新登录账号槽位确认</div>
          <button type="button" disabled={busy} onClick={onClose} aria-label="关闭" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: busy ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>
        <div style={{ padding: 14, fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Target account info */}
          <div style={{ background: "var(--bg-panel)", padding: "10px 12px", borderRadius: 6, border: "1px solid var(--border)" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "var(--text)" }}>{account.label || account.displayName}</div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>{account.maskedAccountId}</div>
          </div>

          {/* Active / non-Active notice */}
          {isActive ? (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", display: "flex", gap: 8 }}>
              <span style={{ flexShrink: 0 }}>⚠️</span>
              <div>
                <strong>此账号当前为活动账号 (Active)</strong>
                <div style={{ marginTop: 4 }}>重新授权成功后，该账号仍将保持全局 Active，并影响当前和所有新会话的后续 Grok 调用凭据。</div>
              </div>
            </div>
          ) : (
            <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.2)", display: "flex", gap: 8 }}>
              <span style={{ flexShrink: 0 }}>ℹ️</span>
              <div>
                <strong>此账号为非活动账号 (Inactive)</strong>
                <div style={{ marginTop: 4 }}>重新授权仅更新该账号槽位的凭据，不会改变全局当前 Active 账号（当前 Active 账号不受影响）。</div>
              </div>
            </div>
          )}

          {/* Identity verification warning */}
          <div style={{ padding: "10px 12px", borderRadius: 6, background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.2)", display: "flex", gap: 8 }}>
            <span style={{ flexShrink: 0 }}>💡</span>
            <div>
              <strong>无法强校验远端身份</strong>
              <div style={{ marginTop: 4 }}>xAI 凭据未提供稳定公开的账号 ID，系统无法可靠验证浏览器里登录的账号是否为原账号。请在浏览器授权时确认使用正确账号。</div>
            </div>
          </div>

          <p style={{ margin: 0, color: "var(--text-dim)" }}>继续后，我们将发起安全 OAuth 会话以重新授权此账号。原有的备注和补充信息将保留，失败或取消时原凭据不作修改。</p>
        </div>
        <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" disabled={busy} onClick={onClose} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: busy ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
          <button type="button" ref={confirmBtnRef} disabled={busy} onClick={onConfirm} style={{ padding: "6px 14px", background: busy ? "var(--bg-panel)" : "var(--accent)", border: "none", borderRadius: 6, color: busy ? "var(--text-dim)" : "#fff", cursor: busy ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>
            {busy ? "处理中…" : "确认并继续"}
          </button>
        </div>
      </div>
    </div>
  );
}

function OAuthDetail({ provider, onRefresh, initialAccountId, onInitialAccountConsumed }: { provider: OAuthProvider; onRefresh: () => void; initialAccountId?: string | null; onInitialAccountConsumed?: () => void }) {
  const { confirm, prompt } = usePrompt();
  const isManagedAccounts = provider.authMode === "managed_accounts";
  const isGrok = provider.id === "grok-cli";
  const isKiro = provider.id === "kiro";
  const isAntigravity = provider.id === "google-antigravity";
  const isCodex = provider.id === "openai-codex";
  // Capability-driven OAuth branches (avoid cloning disconnected trees per provider).
  const supportsGlobalActiveSemantics = isGrok || isKiro || isAntigravity;
  const supportsOAuthMethodPicker = isGrok || isKiro;
  const supportsProtectedDelete = isGrok || isKiro || isAntigravity;
  const hideCodexQuotaSummary = isGrok || isKiro || isAntigravity;

  const [loginState, setLoginState] = useState<OAuthLoginState>({ phase: "idle" });
  const [inputValue, setInputValue] = useState("");
  // Shared quota state — Codex uses SubscriptionQuota; Grok/Kiro/Antigravity use provider-specific V1 results
  const [quota, setQuota] = useState<SubscriptionQuota | null>(null);
  const [grokQuota, setGrokQuota] = useState<import("@/lib/grok-subscription-quota").GrokQuotaResultV1 | null>(null);
  const [kiroQuota, setKiroQuota] = useState<import("@/lib/kiro-subscription-quota").KiroQuotaResultV1 | null>(null);
  const [antigravityQuota, setAntigravityQuota] = useState<import("@/lib/antigravity-subscription-quota").AntigravityQuotaResultV1 | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [quotaResetting, setQuotaResetting] = useState(false);
  const [accounts, setAccounts] = useState<OAuthAccountSummary[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountsError, setAccountsError] = useState<string | null>(null);
  const [selectedQuotaAccountId, setSelectedQuotaAccountId] = useState<string | null>(null);
  const [activatingAccountId, setActivatingAccountId] = useState<string | null>(null);
  const [savingLabelAccountId, setSavingLabelAccountId] = useState<string | null>(null);
  const [savingExtraInfoAccountId, setSavingExtraInfoAccountId] = useState<string | null>(null);
  const [editingExtraInfoAccount, setEditingExtraInfoAccount] = useState<OAuthAccountSummary | null>(null);
  const [refreshingQuotaAccountId, setRefreshingQuotaAccountId] = useState<string | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);
  const [addAccountDialogView, setAddAccountDialogView] = useState<"method" | "json" | null>(null);
  const [warmupDialogOpen, setWarmupDialogOpen] = useState(false);
  // Provider-capability login method selection (Grok local methods / Kiro Builder ID·Google·GitHub)
  const [showLoginMethods, setShowLoginMethods] = useState(false);
  // Preferred Kiro method id to auto-answer the provider's onSelect prompt
  const preferredKiroMethodRef = useRef<"builder-id" | "google" | "github" | null>(null);
  // Preferred Grok method id to auto-answer the provider's onSelect prompt.
  // UI-local methods map to upstream ids: browser→browser, device→device, grok_build→existing.
  const preferredGrokMethodRef = useRef<"browser" | "device" | "existing" | null>(null);
  // Protected delete dialog states (Grok / Kiro / Antigravity Active protection)
  const [protectedDeleteAccount, setProtectedDeleteAccount] = useState<OAuthAccountSummary | null>(null);
  const [protectedDeleteDeleting, setProtectedDeleteDeleting] = useState(false);
  // Reauth target account (Grok only); set before confirm dialog, consumed by reauth flow.
  const [reauthTarget, setReauthTarget] = useState<OAuthAccountSummary | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Antigravity quota race guards — clear old data and reject stale responses on account switch.
  const antigravityQuotaAbortRef = useRef<AbortController | null>(null);
  const antigravityQuotaGenerationRef = useRef(0);

  useEffect(() => {
    if (loginState.phase === "auth" || loginState.phase === "prompt") {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [loginState.phase]);

  // Reset state when provider changes
  useEffect(() => {
    setLoginState({ phase: "idle" });
    setInputValue("");
    setQuota(null);
    setGrokQuota(null);
    setKiroQuota(null);
    setAntigravityQuota(null);
    setQuotaLoading(false);
    setQuotaResetting(false);
    setAccounts([]);
    setAccountsLoading(false);
    setAccountsError(null);
    setSelectedQuotaAccountId(null);
    setActivatingAccountId(null);
    setSavingLabelAccountId(null);
    setSavingExtraInfoAccountId(null);
    setEditingExtraInfoAccount(null);
    setRefreshingQuotaAccountId(null);
    setDeletingAccountId(null);
    setAddAccountDialogView(null);
    setWarmupDialogOpen(false);
    setShowLoginMethods(false);
    preferredKiroMethodRef.current = null;
    preferredGrokMethodRef.current = null;
    setProtectedDeleteAccount(null);
    setProtectedDeleteDeleting(false);
    setReauthTarget(null);
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    antigravityQuotaAbortRef.current?.abort();
    antigravityQuotaAbortRef.current = null;
    antigravityQuotaGenerationRef.current += 1;
  }, [provider.id]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
      antigravityQuotaAbortRef.current?.abort();
    };
  }, []);

  const loadAccounts = useCallback(async () => {
    if (!isManagedAccounts) return;
    setAccountsLoading(true);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`);
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
    } catch (error) {
      setAccountsError(error instanceof Error ? error.message : "加载账号失败");
    } finally {
      setAccountsLoading(false);
    }
  }, [provider.id, isManagedAccounts]);

  useEffect(() => {
    if (isManagedAccounts) {
      void loadAccounts();
    }
  }, [provider.id, provider.loggedIn, loadAccounts, isManagedAccounts]);

  useEffect(() => {
    if (!isManagedAccounts) return;
    setSelectedQuotaAccountId((current) => {
      if (accounts.length === 0) return null;
      if (current && accounts.some((account) => account.accountId === current)) return current;
      return accounts.find((account) => account.active)?.accountId ?? null;
    });
  }, [accounts, provider.id, isManagedAccounts]);

  // Consume initialAccountId from top-bar deep-link focus. Auto-select the
  // target account once and then clear, so subsequent provider switches don't re-apply.
  const initialAccountConsumedRef = useRef(false);
  useEffect(() => {
    if (!initialAccountId || accounts.length === 0 || initialAccountConsumedRef.current) return;
    if (accounts.some((a) => a.accountId === initialAccountId)) {
      setSelectedQuotaAccountId(initialAccountId);
      initialAccountConsumedRef.current = true;
      onInitialAccountConsumed?.();
    }
  }, [initialAccountId, accounts, onInitialAccountConsumed]);

  // Codex quota loader
  const loadQuota = useCallback(async (force = false, accountIdOverride?: string | null) => {
    if (provider.id !== "openai-codex" || (!provider.loggedIn && !force)) return;
    const quotaAccountId = accountIdOverride !== undefined ? accountIdOverride : selectedQuotaAccountId;
    setQuotaLoading(true);
    try {
      const accountQuery = quotaAccountId ? `?accountId=${encodeURIComponent(quotaAccountId)}` : "";
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}${accountQuery}`);
      const data = await res.json() as SubscriptionQuota;
      setQuota(data);
      void loadAccounts();
    } catch (error) {
      setQuota({
        tool: provider.id,
        credentialStatus: "valid",
        credentialMessage: error instanceof Error ? error.message : String(error),
        success: false,
        tiers: [],
        error: error instanceof Error ? error.message : "用量查询失败",
        queriedAt: Date.now(),
        resetCreditsAvailableCount: null,
        resetCredits: [],
        resetCreditsError: null,
      });
    } finally {
      setQuotaLoading(false);
    }
  }, [provider.id, provider.loggedIn, selectedQuotaAccountId, loadAccounts]);

  // Grok quota loader
  const loadGrokQuota = useCallback(async (force = false, accountIdOverride?: string | null) => {
    if (!isGrok || (!provider.loggedIn && !force && accounts.length === 0)) return;
    const quotaAccountId = accountIdOverride !== undefined ? accountIdOverride : selectedQuotaAccountId;
    setQuotaLoading(true);
    try {
      const refreshParam = force ? "&refresh=1" : "";
      const accountQuery = quotaAccountId ? `?accountId=${encodeURIComponent(quotaAccountId)}${refreshParam}` : refreshParam ? `?refresh=1` : "";
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}${accountQuery}`);
      const data = await res.json() as import("@/lib/grok-subscription-quota").GrokQuotaResultV1;
      setGrokQuota(data);
      void loadAccounts();
    } catch (error) {
      setGrokQuota(null);
      setAccountsError(error instanceof Error ? error.message : "加载 Grok 配额失败");
    } finally {
      setQuotaLoading(false);
    }
  }, [provider.id, provider.loggedIn, selectedQuotaAccountId, accounts.length, loadAccounts, isGrok]);

  // Kiro quota loader — GetUsageLimits wire projection only (no secrets/raw body)
  const loadKiroQuota = useCallback(async (force = false, accountIdOverride?: string | null) => {
    if (!isKiro || (!provider.loggedIn && !force && accounts.length === 0)) return;
    const quotaAccountId = accountIdOverride !== undefined ? accountIdOverride : selectedQuotaAccountId;
    setQuotaLoading(true);
    try {
      const refreshParam = force ? "&refresh=1" : "";
      const accountQuery = quotaAccountId ? `?accountId=${encodeURIComponent(quotaAccountId)}${refreshParam}` : refreshParam ? `?refresh=1` : "";
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}${accountQuery}`);
      const data = await res.json() as import("@/lib/kiro-subscription-quota").KiroQuotaResultV1;
      setKiroQuota(data);
      void loadAccounts();
    } catch (error) {
      setKiroQuota(null);
      setAccountsError(error instanceof Error ? error.message : "加载 Kiro 配额失败");
    } finally {
      setQuotaLoading(false);
    }
  }, [provider.id, provider.loggedIn, selectedQuotaAccountId, loadAccounts, isKiro, accounts.length]);

  // Antigravity quota loader — fetchAvailableModels projection only (no secrets/raw body/projectId)
  const loadAntigravityQuota = useCallback(async (force = false, accountIdOverride?: string | null) => {
    if (!isAntigravity || (!provider.loggedIn && !force && accounts.length === 0)) return;
    const quotaAccountId = accountIdOverride !== undefined ? accountIdOverride : selectedQuotaAccountId;
    const generation = ++antigravityQuotaGenerationRef.current;
    antigravityQuotaAbortRef.current?.abort();
    const controller = new AbortController();
    antigravityQuotaAbortRef.current = controller;
    // Immediately clear previous-account quota so stale values cannot flash.
    setAntigravityQuota(null);
    setQuotaLoading(true);
    try {
      const refreshParam = force ? "&refresh=1" : "";
      const accountQuery = quotaAccountId
        ? `?accountId=${encodeURIComponent(quotaAccountId)}${refreshParam}`
        : refreshParam
          ? `?refresh=1`
          : "";
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}${accountQuery}`, {
        signal: controller.signal,
      });
      const data = await res.json() as import("@/lib/antigravity-subscription-quota").AntigravityQuotaResultV1;
      if (generation !== antigravityQuotaGenerationRef.current) return;
      if (quotaAccountId && data.accountId && data.accountId !== quotaAccountId) return;
      setAntigravityQuota(data);
      void loadAccounts();
    } catch (error) {
      if (controller.signal.aborted || generation !== antigravityQuotaGenerationRef.current) return;
      setAntigravityQuota(null);
      setAccountsError(error instanceof Error ? error.message : "加载 Antigravity 配额失败");
    } finally {
      if (generation === antigravityQuotaGenerationRef.current) {
        setQuotaLoading(false);
      }
    }
  }, [provider.id, provider.loggedIn, selectedQuotaAccountId, loadAccounts, isAntigravity, accounts.length]);

  useEffect(() => {
    if (provider.id === "openai-codex" && provider.loggedIn) {
      void loadQuota();
    }
  }, [provider.id, provider.loggedIn, loadQuota]);

  useEffect(() => {
    if (isGrok && (provider.loggedIn || accounts.length > 0)) {
      void loadGrokQuota();
    }
  }, [provider.id, provider.loggedIn, isGrok, loadGrokQuota, accounts.length]);

  useEffect(() => {
    if (isKiro && (provider.loggedIn || accounts.length > 0)) {
      void loadKiroQuota();
    }
  }, [provider.id, provider.loggedIn, isKiro, loadKiroQuota, accounts.length]);

  useEffect(() => {
    if (isAntigravity && (provider.loggedIn || accounts.length > 0)) {
      void loadAntigravityQuota();
    }
  }, [provider.id, provider.loggedIn, isAntigravity, loadAntigravityQuota, accounts.length]);

  const handleLogin = useCallback((options?: { mode?: "login" | "add" | "reauth"; accountId?: string }) => {
    const mode = options?.mode ?? "login";
    const accountId = options?.accountId;
    eventSourceRef.current?.close();
    setLoginState({ phase: "connecting" });
    setInputValue("");

    const params = new URLSearchParams();
    if (mode === "add") params.set("accountMode", "add");
    else if (mode === "reauth") {
      params.set("accountMode", "reauth");
      if (accountId) params.set("accountId", accountId);
    }
    const query = params.toString();
    const loginUrl = `/api/auth/login/${encodeURIComponent(provider.id)}${query ? `?${query}` : ""}`;
    const es = new EventSource(loginUrl);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      const data = JSON.parse(e.data) as {
        type: string; url?: string; instructions?: string | null;
        token?: string; message?: string; placeholder?: string | null;
        userCode?: string; verificationUri?: string; intervalSeconds?: number | null; expiresInSeconds?: number | null;
        options?: { id: string; label: string }[];
        account?: OAuthAccountSummary; activeAccountId?: string | null;
      };
      if (data.type === "auth") {
        setLoginState({ phase: "auth", url: data.url!, instructions: data.instructions ?? null, token: data.token! });
        window.open(data.url!, "_blank", "noopener,noreferrer");
      } else if (data.type === "device_code") {
        setLoginState({
          phase: "device_code",
          userCode: data.userCode!,
          verificationUri: data.verificationUri!,
          intervalSeconds: data.intervalSeconds ?? null,
          expiresInSeconds: data.expiresInSeconds ?? null,
        });
        window.open(data.verificationUri!, "_blank", "noopener,noreferrer");
      } else if (data.type === "prompt_request") {
        setLoginState({ phase: "prompt", message: data.message!, placeholder: data.placeholder ?? null, token: data.token! });
      } else if (data.type === "select_request") {
        const options = data.options ?? [];
        // Check Grok preferred method first (grok-cli uses upstream ids: browser|device|existing).
        const preferredGrok = preferredGrokMethodRef.current;
        if (isGrok && preferredGrok && options.some((option) => option.id === preferredGrok)) {
          preferredGrokMethodRef.current = null;
          setLoginState({ phase: "progress", message: "继续中…" });
          void fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.token!, code: preferredGrok }),
          }).then(async (res) => {
            if (!res.ok) {
              const d = await res.json().catch(() => ({})) as { error?: string };
              setLoginState({ phase: "error", message: d.error ?? `服务器错误 ${res.status}` });
            }
          }).catch((e) => {
            setLoginState({ phase: "error", message: e instanceof Error ? e.message : "网络错误" });
          });
          return;
        }
        // Then check Kiro preferred method.
        const preferredKiro = preferredKiroMethodRef.current;
        if (preferredKiro && options.some((option) => option.id === preferredKiro)) {
          preferredKiroMethodRef.current = null;
          setLoginState({ phase: "progress", message: "继续中…" });
          void fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.token!, code: preferredKiro }),
          }).then(async (res) => {
            if (!res.ok) {
              const d = await res.json().catch(() => ({})) as { error?: string };
              setLoginState({ phase: "error", message: d.error ?? `服务器错误 ${res.status}` });
            }
          }).catch((e) => {
            setLoginState({ phase: "error", message: e instanceof Error ? e.message : "网络错误" });
          });
        } else {
          preferredKiroMethodRef.current = null;
          preferredGrokMethodRef.current = null;
          setLoginState({ phase: "select", message: data.message!, options, token: data.token! });
        }
      } else if (data.type === "progress") {
        setLoginState({ phase: "progress", message: data.message! });
      } else if (data.type === "success") {
        es.close();
        const reauthenticated = (data as { reauthenticated?: boolean }).reauthenticated === true;
        const targetActive = (data as { active?: boolean }).active === true;
        let successMessage: string;
        if (reauthenticated) {
          successMessage = targetActive
            ? "已更新全局 Active 凭据。当前与新会话的后续请求将使用新凭据。"
            : "账号凭据已更新，未改变全局 Active。";
        } else {
          successMessage = data.message ?? (mode === "add" ? "账号保存成功。" : "连接成功。");
        }
        setLoginState({ phase: "success", message: successMessage });
        setReauthTarget(null);
        onRefresh();
        void loadAccounts();
        if (isGrok) void loadGrokQuota(true);
        else if (isKiro) void loadKiroQuota(true);
        else if (isAntigravity) void loadAntigravityQuota(true);
        else if (provider.loggedIn) void loadQuota();
      } else if (data.type === "error") {
        es.close();
        setLoginState({ phase: "error", message: data.message! });
      } else if (data.type === "cancelled") {
        es.close();
        setLoginState({ phase: "idle" });
      }
    };
    es.onerror = () => {
      es.close();
      setLoginState((prev) => prev.phase === "success" ? prev : { phase: "error", message: "连接已断开" });
    };
  }, [provider.id, provider.loggedIn, onRefresh, loadAccounts, loadQuota, loadGrokQuota, loadKiroQuota, loadAntigravityQuota, isGrok, isKiro, isAntigravity]);

  const handleLogout = useCallback(async () => {
    await fetch(`/api/auth/logout/${encodeURIComponent(provider.id)}`, { method: "POST" });
    setLoginState({ phase: "idle" });
    setQuota(null);
    setGrokQuota(null);
    setKiroQuota(null);
    setAntigravityQuota(null);
    antigravityQuotaAbortRef.current?.abort();
    antigravityQuotaGenerationRef.current += 1;
    setSelectedQuotaAccountId(null);
    onRefresh();
    void loadAccounts();
  }, [provider.id, onRefresh, loadAccounts]);

  const submitCode = useCallback(async (token: string, code: string) => {
    if (!code.trim()) return;
    setLoginState({ phase: "progress", message: "验证中…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: code.trim() }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `服务器错误 ${res.status}` });
        return;
      }
      setInputValue("");
      // Success path: SSE stream will emit "success" and update state
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "网络错误" });
    }
  }, [provider.id]);

  const submitSelection = useCallback(async (token: string, value: string) => {
    setLoginState({ phase: "progress", message: "继续中…" });
    try {
      const res = await fetch(`/api/auth/login/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, code: value }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string };
        setLoginState({ phase: "error", message: d.error ?? `服务器错误 ${res.status}` });
      }
    } catch (e) {
      setLoginState({ phase: "error", message: e instanceof Error ? e.message : "网络错误" });
    }
  }, [provider.id]);

  const handleSelectQuotaAccount = useCallback((account: OAuthAccountSummary) => {
    setSelectedQuotaAccountId(account.accountId);
    if (isGrok) void loadGrokQuota(true, account.accountId);
    else if (isKiro) void loadKiroQuota(true, account.accountId);
    else if (isAntigravity) void loadAntigravityQuota(true, account.accountId);
    else void loadQuota(true, account.accountId);
  }, [loadQuota, loadGrokQuota, loadKiroQuota, loadAntigravityQuota, isGrok, isKiro, isAntigravity]);

  const handleActivateAccount = useCallback(async (accountId: string) => {
    setActivatingAccountId(accountId);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setSelectedQuotaAccountId(accountId);
      setLoginState({ phase: "success", message: "账号已启用。" });
      onRefresh();
      if (isGrok) await loadGrokQuota(true, accountId);
      else if (isKiro) await loadKiroQuota(true, accountId);
      else if (isAntigravity) await loadAntigravityQuota(true, accountId);
      else await loadQuota(true, accountId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "启用账号失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setActivatingAccountId(null);
    }
  }, [provider.id, onRefresh, loadQuota, loadGrokQuota, loadKiroQuota, loadAntigravityQuota, isGrok, isKiro, isAntigravity]);

  const handleEditAccountLabel = useCallback(async (account: OAuthAccountSummary) => {
    const nextLabel = await prompt({
      title: "账号备注",
      message: "留空将清除备注。",
      initialValue: account.label ?? "",
      confirmLabel: "保存备注",
    });
    if (nextLabel === null) return;

    setSavingLabelAccountId(account.accountId);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.accountId, label: nextLabel }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setLoginState({ phase: "success", message: nextLabel.trim() ? "账号备注已保存。" : "账号备注已清除。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存账号备注失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setSavingLabelAccountId(null);
    }
  }, [prompt, provider.id]);

  const handleEditAccountExtraInfo = useCallback((account: OAuthAccountSummary) => {
    setEditingExtraInfoAccount(account);
  }, []);

  const handleSaveAccountExtraInfo = useCallback(async (account: OAuthAccountSummary, nextExtraInfo: string) => {
    setSavingExtraInfoAccountId(account.accountId);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.accountId, extraInfo: nextExtraInfo }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setEditingExtraInfoAccount(null);
      setLoginState({ phase: "success", message: nextExtraInfo.trim() ? "账号补充信息已保存。" : "账号补充信息已清除。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存账号补充信息失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setSavingExtraInfoAccountId(null);
    }
  }, [provider.id]);

  const handleRefreshAccountQuota = useCallback(async (account: OAuthAccountSummary) => {
    if (quotaResetting) return;
    setRefreshingQuotaAccountId(account.accountId);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}?accountId=${encodeURIComponent(account.accountId)}&refresh=1`);
      if (isGrok) {
        const data = await res.json().catch(() => ({})) as import("@/lib/grok-subscription-quota").GrokQuotaResultV1;
        if (!res.ok && !data.success) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
        if (selectedQuotaAccountId ? account.accountId === selectedQuotaAccountId : account.active) setGrokQuota(data);
        await loadAccounts();
        setLoginState({ phase: data.success ? "success" : "error", message: data.success ? "账号配额已刷新。" : (data.error?.message ?? "配额查询失败。") });
      } else if (isKiro) {
        const data = await res.json().catch(() => ({})) as import("@/lib/kiro-subscription-quota").KiroQuotaResultV1;
        // Prefer fixed allowlisted codes over raw upstream messages.
        const safeMessage = data.error
          ? (data.error.code === "unauthorized"
            ? "Kiro 登录已失效，需要重新登录。"
            : data.error.code === "unsupported_region"
              ? "当前账号 Region 不受支持，无法查询额度。"
              : data.error.code === "rate_limited"
                ? "额度服务暂时限流。请稍后重试。"
                : data.error.code === "access_denied"
                  ? "当前账号无权查询额度。"
                  : data.error.code === "invalid_payload"
                    ? "额度服务返回了无法识别的数据。"
                    : data.success
                      ? "额度刷新失败，正在展示上次成功数据。"
                      : "额度暂不可用。请稍后重试。")
          : null;
        if (!res.ok && !data.success && !data.buckets?.length) {
          throw new Error(safeMessage ?? `HTTP ${res.status}`);
        }
        if (selectedQuotaAccountId ? account.accountId === selectedQuotaAccountId : account.active) setKiroQuota(data);
        await loadAccounts();
        setLoginState({
          phase: data.success ? "success" : "error",
          message: data.success ? "账号配额已刷新。" : (safeMessage ?? "配额查询失败。"),
        });
      } else if (isAntigravity) {
        const data = await res.json().catch(() => ({})) as import("@/lib/antigravity-subscription-quota").AntigravityQuotaResultV1;
        // Prefer fixed allowlisted codes over raw upstream messages / projectId.
        const safeMessage = data.error
          ? (data.error.code === "unauthorized"
            ? "Antigravity 登录已失效，需要重新登录。"
            : data.error.code === "invalid_project"
              ? "当前账号的 Google Cloud Code 项目不可用或无访问权限。"
              : data.error.code === "access_denied"
                ? "当前账号无权查询额度。"
                : data.error.code === "rate_limited"
                  ? "额度服务暂时限流。请稍后重试。"
                  : data.error.code === "invalid_payload"
                    ? "额度服务返回了无法识别的数据。"
                    : data.success
                      ? "额度刷新失败，正在展示上次成功数据。"
                      : "额度暂不可用。请稍后重试。")
          : null;
        if (!res.ok && !data.success && !data.models?.length) {
          throw new Error(safeMessage ?? `HTTP ${res.status}`);
        }
        if (selectedQuotaAccountId ? account.accountId === selectedQuotaAccountId : account.active) {
          if (!data.accountId || data.accountId === account.accountId) setAntigravityQuota(data);
        }
        await loadAccounts();
        setLoginState({
          phase: data.success ? "success" : "error",
          message: data.success ? "账号配额已刷新。" : (safeMessage ?? "配额查询失败。"),
        });
      } else {
        const data = await res.json().catch(() => ({})) as SubscriptionQuota & { error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (selectedQuotaAccountId ? account.accountId === selectedQuotaAccountId : account.active) setQuota(data);
        await loadAccounts();
        setLoginState({ phase: data.success ? "success" : "error", message: data.success ? "账号配额已刷新。" : (data.error ?? "配额查询失败。") });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "刷新账号配额失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setRefreshingQuotaAccountId(null);
    }
  }, [loadAccounts, provider.id, quotaResetting, selectedQuotaAccountId, isGrok, isKiro, isAntigravity]);

  const handleResetQuota = useCallback(async () => {
    const quotaAccountId = selectedQuotaAccountId;
    if (!quotaAccountId || quotaResetting) return;
    const ok = await confirm({
      title: "确认重置额度？",
      message: "将消耗一次 Codex 重置机会，确认继续？",
      confirmLabel: "确认继续",
    });
    if (!ok) return;

    setQuotaResetting(true);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/quota/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: quotaAccountId }),
      });
      const data = await res.json().catch(() => ({})) as SubscriptionQuota & { error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? data.credentialMessage ?? `HTTP ${res.status}`);
      setQuota(data);
      await loadAccounts();
      setLoginState({ phase: "success", message: "Codex 速率限制已重置。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "重置 Codex 速率限制失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setQuotaResetting(false);
    }
  }, [confirm, loadAccounts, provider.id, quotaResetting, selectedQuotaAccountId]);

  // Protected delete flow (Grok / Kiro): custom dialog with Active-account protection
  const handleProtectedDeleteClick = useCallback((account: OAuthAccountSummary) => {
    setProtectedDeleteAccount(account);
    setProtectedDeleteDeleting(false);
  }, []);

  const handleProtectedDeleteConfirm = useCallback(async () => {
    if (!protectedDeleteAccount) return;
    setProtectedDeleteDeleting(true);
    setAccountsError(null);
    try {
      if (protectedDeleteAccount.active) {
        // Must activate another account first so Active is never silently dropped.
        const replacement = accounts.find((a) => a.accountId !== protectedDeleteAccount.accountId);
        if (replacement) {
          const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}/activate`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ accountId: replacement.accountId }),
          });
          const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
          if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
          setAccounts(data.accounts ?? []);
        }
      }
      // Now delete
      const deleteRes = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: protectedDeleteAccount.accountId }),
      });
      const deleteData = await deleteRes.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!deleteRes.ok) throw new Error(deleteData.error ?? `HTTP ${deleteRes.status}`);
      setAccounts(deleteData.accounts ?? []);
      if (deleteData.activeAccountId) setSelectedQuotaAccountId(deleteData.activeAccountId);
      else if (selectedQuotaAccountId === protectedDeleteAccount.accountId) setSelectedQuotaAccountId(null);
      if (isKiro && selectedQuotaAccountId === protectedDeleteAccount.accountId) setKiroQuota(null);
      if (isGrok && selectedQuotaAccountId === protectedDeleteAccount.accountId) setGrokQuota(null);
      if (isAntigravity && selectedQuotaAccountId === protectedDeleteAccount.accountId) {
        setAntigravityQuota(null);
        antigravityQuotaAbortRef.current?.abort();
        antigravityQuotaGenerationRef.current += 1;
      }
      setLoginState({ phase: "success", message: "账号已删除。" });
      setProtectedDeleteAccount(null);
      onRefresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除账号失败";
      setAccountsError(message);
    } finally {
      setProtectedDeleteDeleting(false);
    }
  }, [protectedDeleteAccount, accounts, provider.id, selectedQuotaAccountId, isGrok, isKiro, isAntigravity, onRefresh]);

  const handleDeleteAccount = useCallback(async (account: OAuthAccountSummary) => {
    if (supportsProtectedDelete) {
      handleProtectedDeleteClick(account);
      return;
    }
    const confirmed = await confirm({
      title: "删除已保存凭证？",
      message: <>确定删除 {account.displayName} 的已保存凭证吗？<br /><br />恢复后需要重新添加该账号。</>,
      confirmLabel: "删除凭证",
      intent: "danger",
    });
    if (!confirmed) return;

    setDeletingAccountId(account.accountId);
    setAccountsError(null);
    try {
      const res = await fetch(`/api/auth/accounts/${encodeURIComponent(provider.id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.accountId }),
      });
      const data = await res.json().catch(() => ({})) as OAuthAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setLoginState({ phase: "success", message: "账号已删除。" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除账号失败";
      setAccountsError(message);
      setLoginState({ phase: "error", message });
    } finally {
      setDeletingAccountId(null);
    }
  }, [confirm, provider.id, supportsProtectedDelete, handleProtectedDeleteClick]);

  const selectedQuotaAccount = accounts.find((account) => account.accountId === selectedQuotaAccountId)
    ?? accounts.find((account) => account.active)
    ?? null;

  const isWorking = loginState.phase === "connecting" || loginState.phase === "progress" ||
    loginState.phase === "auth" || loginState.phase === "device_code" ||
    loginState.phase === "prompt" || loginState.phase === "select";

  // Capability-driven login: method picker for Grok/Kiro, then SSE OAuth flow
  const handleManagedLoginStart = useCallback(() => {
    setShowLoginMethods(true);
  }, []);

  const handleGrokLoginMethod = useCallback((method: "browser" | "device" | "grok_build") => {
    setShowLoginMethods(false);
    // Map UI-local method to upstream id: browser→browser, device→device, grok_build→existing.
    const upstreamMethod: "browser" | "device" | "existing" = method === "grok_build" ? "existing" : method;
    preferredGrokMethodRef.current = upstreamMethod;
    const target = reauthTarget;
    if (target) {
      // Reauth flow: use the target account's id
      handleLogin({ mode: "reauth", accountId: target.accountId });
    } else {
      handleLogin({ mode: "add" });
    }
  }, [handleLogin, reauthTarget]);

  const handleKiroLoginMethod = useCallback((method: "builder-id" | "google" | "github") => {
    setShowLoginMethods(false);
    // Remember the chosen method so the SSE select_request can be auto-answered
    // without a second click. Falls back to the select UI if options differ.
    preferredKiroMethodRef.current = method;
    handleLogin({ mode: "add" });
  }, [handleLogin]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>订阅</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.loggedIn ? "#4ade80" : accounts.length > 0 ? "#f59e0b" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.loggedIn ? "#4ade80" : accounts.length > 0 ? "#f59e0b" : "var(--text-dim)" }}>
            {provider.loggedIn
              ? `已连接${provider.accountCount ? `（${provider.accountCount}）` : ""}`
              : accounts.length > 0
                ? `已保存 ${accounts.length} 个账号，当前凭据需恢复`
                : "未连接"}
          </span>
        </div>
      </div>

      {/* Active semantics for Grok / Kiro / Antigravity */}
      {supportsGlobalActiveSemantics && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", background: "var(--bg-panel)", padding: "8px 12px", borderRadius: 6, border: "1px solid var(--border)", lineHeight: 1.5 }}>
          <strong style={{ color: "var(--text)" }}>账号激活说明：</strong>
          {isKiro
            ? <>
                「启用」只设置 Kiro 的<strong>全局当前账号</strong>，不属于锁定。切换将作用于所有进行中/新建会话的后续请求，进行中的请求不会更换 Token。若已开启设置中的自动切号，额度不足时会自动切换到其他有效备用账号。
              </>
            : isAntigravity
              ? <>
                  「启用」只设置 Antigravity 的<strong>全局当前账号</strong>，不是锁定账号。切换后作用于所有进行中/新建会话的后续请求；已经发出的请求不会中途更换 token。自动切号默认关闭，且必须对当前请求模型具备可用额度，否则会失败关闭。
                </>
              : <>
                  「启用」只设置 Grok 的<strong>全局当前账号</strong>，不是锁定账号。切换后，所有普通运行中会话和新会话的<strong>后续请求</strong>都会使用该账号；已经发出的请求不会中途更换 token。手动启用的账号若返回明确限额或限流，且设置中开启了自动切号，仍会自动轮换到可用账号并重试。
                </>}
        </div>
      )}

      {/* Antigravity non-official channel / wide-scope disclosure (approved prototype) */}
      {isAntigravity && (
        <div style={{ fontSize: 11, color: "var(--text-muted)", background: "rgba(234,179,8,0.06)", padding: "10px 12px", borderRadius: 6, border: "1px solid rgba(234,179,8,0.25)", lineHeight: 1.55 }}>
          <strong style={{ color: "var(--text)" }}>⚠️ 安全与非官方通道提示 (Antigravity Scope)</strong>
          <div style={{ marginTop: 4 }}>
            本组件使用非官方 Google Cloud Code 通道进行模型调用与额度刷新。OAuth 授权将获得 <strong>cloud-platform (GCP 完整资源读写)</strong> 等宽 scope 权限。请确保已知悉非官方 SLA 限制与官方 IDE 客户端模拟风险。本系统绝对不会收集或上报您的 client_secret、token 凭证或 projectId。
          </div>
        </div>
      )}

      {/* Status */}
      <div style={{ minHeight: 48 }}>
        {loginState.phase === "idle" && !showLoginMethods && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {provider.loggedIn || accounts.length > 0
              ? (isGrok
                ? (provider.loggedIn
                    ? `已连接 ${accounts.length} 个 Grok 账号。当前活动账号：${accounts.find((a) => a.active)?.displayName ?? "无"}`
                    : `已保存 ${accounts.length} 个 Grok 账号，当前凭据需恢复。活动账号：${accounts.find((a) => a.active)?.displayName ?? "无"}`)
                : isKiro
                  ? `已连接 ${accounts.length} 个 Kiro 账号。当前活动账号：${accounts.find((a) => a.active)?.displayName ?? "无"}`
                  : isAntigravity
                    ? `已连接 ${accounts.length} 个 Antigravity 账号。当前活动账号：${accounts.find((a) => a.active)?.displayName ?? "无"}`
                    : "已连接。你可以重新登录或断开连接。")
              : isKiro
                ? "连接 AWS Kiro 账号（Builder ID / Google / GitHub）。"
                : isAntigravity
                  ? "通过 Google OAuth 添加 Antigravity 账号。callback 强制绑定 127.0.0.1；远程访问可在授权后手工粘贴 Redirect URL。不支持 Credential JSON 导入。"
                  : `连接你的 ${provider.name} 账号。`}
          </p>
        )}

        {/* Grok login method selection */}
        {isGrok && showLoginMethods && loginState.phase === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 2 }}>选择连接方式</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 8 }}>
              <button
                onClick={() => handleGrokLoginMethod("browser")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>🌐 浏览器登录 (推荐)</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>OAuth PKCE 安全回调授权</span>
              </button>
              <button
                onClick={() => handleGrokLoginMethod("device")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>📺 设备验证码登录</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>无浏览器或远程服务器环境</span>
              </button>
              <button
                onClick={() => handleGrokLoginMethod("grok_build")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>📂 复用本地 Grok Build</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>读取 ~/.grok/auth.json</span>
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", background: "rgba(234,179,8,0.05)", borderLeft: "3px solid var(--warning)", padding: "6px 10px", borderRadius: "0 4px 4px 0", lineHeight: 1.5 }}>
              若设置了 <code style={{ fontFamily: "var(--font-mono)" }}>GROK_CLI_OAUTH_TOKEN</code> 环境变量，系统将使用只读凭证，但不支持多账号隔离管理及自动 Token 刷新。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button onClick={() => { setShowLoginMethods(false); setReauthTarget(null); }} style={{ padding: "4px 10px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>取消</button>
            </div>
          </div>
        )}

        {/* Kiro login method selection — Builder ID / Google / GitHub */}
        {isKiro && showLoginMethods && loginState.phase === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", marginBottom: 2 }}>选择 Kiro 登录方式</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(180px, 100%), 1fr))", gap: 8 }}>
              <button
                type="button"
                onClick={() => handleKiroLoginMethod("builder-id")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>🪪 AWS Builder ID</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>官方 Builder ID 设备/浏览器授权</span>
              </button>
              <button
                type="button"
                onClick={() => handleKiroLoginMethod("google")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>🔵 Google</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>社交登录 · OAuth 回调</span>
              </button>
              <button
                type="button"
                onClick={() => handleKiroLoginMethod("github")}
                style={{ padding: 12, background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", cursor: "pointer", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
              >
                <span style={{ fontSize: 13, fontWeight: 700 }}>🐙 GitHub</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}>社交登录 · OAuth 回调</span>
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-dim)", background: "rgba(234,179,8,0.05)", borderLeft: "3px solid var(--warning)", padding: "6px 10px", borderRadius: "0 4px 4px 0", lineHeight: 1.5 }}>
              不支持 JSON 凭据导入。登录后系统仅保存 opaque 账号元数据；access / refresh / clientSecret / profileArn 不会出现在浏览器。
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={() => setShowLoginMethods(false)} style={{ padding: "4px 10px", background: "none", border: "1px solid var(--border)", borderRadius: 4, color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>取消</button>
            </div>
          </div>
        )}

        {loginState.phase === "connecting" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>正在打开浏览器…</p>
        )}
        {loginState.phase === "select" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.message}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {loginState.options.map((option) => (
                <button
                  key={option.id}
                  onClick={() => submitSelection(loginState.token, option.id)}
                  style={{ padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", cursor: "pointer", fontSize: 12, textAlign: "left" }}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}
        {(loginState.phase === "auth" || loginState.phase === "prompt") && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {loginState.phase === "auth"
                ? "请在浏览器中完成登录，然后将地址栏中的跳转 URL 复制并粘贴到下方。"
                : loginState.message}
            </p>
            {loginState.phase === "auth" && (
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
                如果浏览器窗口未打开，{" "}
                <a href={loginState.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                  点击这里打开登录页
                </a>
                .
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <input
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submitCode(loginState.token, inputValue); }}
                placeholder={loginState.phase === "auth"
                  ? (isAntigravity
                    ? "http://localhost:51121/oauth-callback?state=…&code=…"
                    : "http://localhost:1455/auth/callback?code=…")
                  : (loginState.placeholder ?? "请输入…")}
                style={{ flex: 1, padding: "6px 9px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 12, outline: "none", fontFamily: "var(--font-mono)", boxSizing: "border-box" }}
              />
              <button
                onClick={() => submitCode(loginState.token, inputValue)}
                disabled={!inputValue.trim()}
                style={{ padding: "6px 12px", background: inputValue.trim() ? "var(--accent)" : "var(--bg-panel)", border: "none", borderRadius: 5, color: inputValue.trim() ? "#fff" : "var(--text-dim)", cursor: inputValue.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 600, flexShrink: 0 }}
              >
                提交
              </button>
            </div>
          </div>
        )}
        {loginState.phase === "device_code" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
              打开验证页面并输入以下验证码：
            </p>
            <div style={{ padding: "8px 10px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-mono)", letterSpacing: 0 }}>
              {loginState.userCode}
            </div>
            <p style={{ margin: 0, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
              <a href={loginState.verificationUri} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", wordBreak: "break-all" }}>
                {loginState.verificationUri}
              </a>
              {loginState.expiresInSeconds ? ` 将在 ${Math.ceil(loginState.expiresInSeconds / 60)} 分钟后过期。` : ""}
            </p>
          </div>
        )}
        {loginState.phase === "progress" && (
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)" }}>{loginState.message}</p>
        )}
        {loginState.phase === "success" && (
          <p style={{ margin: 0, fontSize: 12, color: "#4ade80" }}>{loginState.message ?? "连接成功。"}</p>
        )}
        {loginState.phase === "error" && (
          <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{loginState.message}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {isWorking ? (
          <button
            onClick={() => { eventSourceRef.current?.close(); preferredKiroMethodRef.current = null; preferredGrokMethodRef.current = null; setLoginState({ phase: "idle" }); }}
            style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
          >
            取消
          </button>
        ) : (
          <>
            {/* Capability-driven: Grok/Kiro use method picker + add mode; Antigravity single OAuth add; Codex keeps Login/Add Account */}
            {supportsOAuthMethodPicker ? (
              <button
                type="button"
                onClick={handleManagedLoginStart}
                style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                {isKiro ? "➕ 添加 Kiro 账号" : "➕ 添加账号"}
              </button>
            ) : isAntigravity ? (
              <button
                type="button"
                onClick={() => handleLogin({ mode: "add" })}
                style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
              >
                ➕ 添加 Antigravity 账号 (OAuth 登录)
              </button>
            ) : (
              <>
                <button
                  onClick={() => handleLogin({ mode: "login" })}
                  style={{ padding: "5px 14px", background: "var(--accent)", border: "none", borderRadius: 5, color: "#fff", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                >
                  {provider.loggedIn ? "重新登录" : "登录"}
                </button>
                {provider.id === "openai-codex" && provider.loggedIn && (
                  <button
                    onClick={() => setAddAccountDialogView("method")}
                    style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--accent)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}
                  >
                    添加账号
                  </button>
                )}
              </>
            )}
            {isKiro && (provider.loggedIn || accounts.length > 0) && selectedQuotaAccount && (
              <button
                type="button"
                onClick={() => void loadKiroQuota(true)}
                disabled={quotaLoading}
                style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: quotaLoading ? "var(--text-dim)" : "var(--accent)", cursor: quotaLoading ? "default" : "pointer", fontSize: 12, fontWeight: 600 }}
              >
                {quotaLoading ? "刷新中…" : "🔄 刷新当前 Kiro 额度"}
              </button>
            )}
            {isAntigravity && (provider.loggedIn || accounts.length > 0) && selectedQuotaAccount && (
              <button
                type="button"
                onClick={() => void loadAntigravityQuota(true)}
                disabled={quotaLoading}
                style={{ padding: "5px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: quotaLoading ? "var(--text-dim)" : "var(--accent)", cursor: quotaLoading ? "default" : "pointer", fontSize: 12, fontWeight: 600 }}
              >
                {quotaLoading ? "刷新中…" : "🔄 刷新当前 Antigravity 额度"}
              </button>
            )}
            {provider.loggedIn && (
              <button
                onClick={handleLogout}
                style={{ padding: "5px 12px", background: "none", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 5, color: "#ef4444", cursor: "pointer", fontSize: 12 }}
              >
                断开连接
              </button>
            )}
          </>
        )}
      </div>

      {/* Quota display */}
      {isGrok && (provider.loggedIn || accounts.length > 0) && (
        <GrokQuotaView
          quota={grokQuota}
          loading={quotaLoading}
          account={selectedQuotaAccount}
          onRefresh={() => loadGrokQuota(true)}
          onReauthenticate={selectedQuotaAccount ? () => { setReauthTarget(selectedQuotaAccount); } : undefined}
        />
      )}

      {isKiro && (provider.loggedIn || accounts.length > 0) && (
        <KiroQuotaView
          quota={kiroQuota}
          loading={quotaLoading}
          account={selectedQuotaAccount}
          onRefresh={() => loadKiroQuota(true)}
        />
      )}

      {isAntigravity && (provider.loggedIn || accounts.length > 0) && (
        <AntigravityQuotaView
          quota={antigravityQuota}
          loading={quotaLoading}
          account={selectedQuotaAccount}
          onRefresh={() => loadAntigravityQuota(true)}
        />
      )}

      {provider.id === "openai-codex" && provider.loggedIn && (
        <OAuthQuotaView quota={quota} loading={quotaLoading} account={selectedQuotaAccount} resetting={quotaResetting} onRefresh={loadQuota} onReset={handleResetQuota} />
      )}

      {/* Accounts — shared for managed-account OAuth providers */}
      {isManagedAccounts && (
        <OAuthAccountsView
          accounts={accounts}
          loading={accountsLoading}
          error={accountsError}
          activatingAccountId={activatingAccountId}
          savingLabelAccountId={savingLabelAccountId}
          savingExtraInfoAccountId={savingExtraInfoAccountId}
          refreshingQuotaAccountId={refreshingQuotaAccountId}
          quotaResetting={quotaResetting}
          deletingAccountId={deletingAccountId}
          selectedAccountId={selectedQuotaAccount?.accountId ?? null}
          hideCodexQuotaSummary={hideCodexQuotaSummary}
          actionsDisabled={reauthTarget !== null || isWorking || showLoginMethods}
          onRefresh={loadAccounts}
          onSelect={handleSelectQuotaAccount}
          onActivate={handleActivateAccount}
          onEditLabel={handleEditAccountLabel}
          onEditExtraInfo={handleEditAccountExtraInfo}
          onRefreshQuota={handleRefreshAccountQuota}
          onDelete={handleDeleteAccount}
          onWarmup={isCodex ? (() => setWarmupDialogOpen(true)) : undefined}
          onReauthenticate={isGrok ? (account) => setReauthTarget(account) : undefined}
        />
      )}

      {/* Grok reauth confirm dialog */}
      {isGrok && reauthTarget && loginState.phase === "idle" && !showLoginMethods && (
        <GrokReauthConfirmDialog
          account={reauthTarget}
          busy={false}
          onConfirm={() => {
            setShowLoginMethods(true);
          }}
          onClose={() => setReauthTarget(null)}
        />
      )}

      {/* Codex-specific dialogs */}
      {provider.id === "openai-codex" && warmupDialogOpen && (
        <ChatGptWarmupDialog
          accounts={accounts}
          onComplete={loadAccounts}
          onClose={() => setWarmupDialogOpen(false)}
        />
      )}

      {isManagedAccounts && editingExtraInfoAccount && (
        <ExtraInfoDialog
          account={editingExtraInfoAccount}
          saving={savingExtraInfoAccountId === editingExtraInfoAccount.accountId}
          onSave={handleSaveAccountExtraInfo}
          onClose={() => { if (!savingExtraInfoAccountId) setEditingExtraInfoAccount(null); }}
        />
      )}

      {provider.id === "openai-codex" && addAccountDialogView && (
        <AddAccountDialog
          provider={provider}
          view={addAccountDialogView}
          onViewChange={setAddAccountDialogView}
          onCodexAuth={() => { setAddAccountDialogView(null); handleLogin({ mode: "add" }); }}
          onImported={(nextAccounts) => {
            setAccounts(nextAccounts);
            setLoginState({ phase: "success", message: "账号保存成功。" });
            onRefresh();
            if (provider.loggedIn) void loadQuota();
          }}
          onClose={() => setAddAccountDialogView(null)}
        />
      )}

      {/* Protected delete confirmation dialog (Grok / Kiro / Antigravity Active protection) */}
      {supportsProtectedDelete && protectedDeleteAccount && (
        <ManagedOAuthDeleteConfirmDialog
          providerLabel={isAntigravity ? "Antigravity" : isKiro ? "Kiro" : "Grok"}
          account={protectedDeleteAccount}
          allAccounts={accounts}
          deleting={protectedDeleteDeleting}
          onConfirm={handleProtectedDeleteConfirm}
          onClose={() => { if (!protectedDeleteDeleting) setProtectedDeleteAccount(null); }}
        />
      )}
    </div>
  );
}

// ── API Key managed accounts types ───────────────────────────────────────────

interface ApiKeyAccountEntry {
  accountId: string;
  displayName: string;
  description: string;
  maskedKeyPreview: string;
  active: boolean;
  disabled?: boolean;
  disabledReason?: string;
  disabledBy?: string;
  autoDisabledReason?: string;
  enabledAt?: string;
  createdAt: string;
  updatedAt: string;
  lastActivatedAt: string | null;
  importedFromLegacyAt: string | null;
  /** AnyRouter optional account-level Base URL override (never a secret). */
  baseUrlOverride?: string;
}

interface ApiKeyAccountsResponse {
  provider: string;
  authMode: "managed_accounts" | "single";
  activeAccountId: string | null;
  accountCount: number;
  accounts: ApiKeyAccountEntry[];
}

interface ApiKeyRevealResponse {
  accountId: string;
  apiKey: string;
}

type AnyRouterConfigFieldSource = "env" | "config" | "default";

interface AnyRouterRetryPolicyView {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterMs: number;
  retryAfterCapMs: number;
}

interface AnyRouterSafeConfigResponse {
  provider: "anyrouter";
  revision: string;
  globalBaseUrl: string | null;
  globalBaseUrlSource: AnyRouterConfigFieldSource;
  globalBaseUrlEditable: boolean;
  modelsConfigured: boolean;
  modelCount: number;
  retry: {
    effective: AnyRouterRetryPolicyView;
    source: Record<keyof AnyRouterRetryPolicyView, AnyRouterConfigFieldSource>;
    editable: Record<keyof AnyRouterRetryPolicyView, boolean>;
  };
}

/** Managed-account providers that require explicit Active replacement/disconnect. */
const EXPLICIT_ACTIVE_DISPOSITION_PROVIDERS = new Set(["anyrouter"]);

const ANYROUTER_RETRY_FIELD_META: Array<{
  key: keyof AnyRouterRetryPolicyView;
  label: string;
  min: number;
  max: number;
}> = [
  { key: "maxRetries", label: "最大重试次数 (maxRetries)", min: 0, max: 20 },
  { key: "baseDelayMs", label: "退避 Base Delay (ms)", min: 100, max: 10000 },
  { key: "maxDelayMs", label: "退避 Max Delay (ms)", min: 100, max: 60000 },
  { key: "jitterMs", label: "Jitter (ms)", min: 0, max: 5000 },
  { key: "retryAfterCapMs", label: "Retry-After 上限 (ms)", min: 0, max: 120000 },
];

function anyRouterSourceBadgeLabel(source: AnyRouterConfigFieldSource): string {
  if (source === "env") return "ENV";
  if (source === "config") return "anyrouter.json";
  return "默认";
}

/** Client-side Base URL check aligned with design (no userinfo/query/hash). */
function validateClientBaseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return "Base URL 不能为空";
  if (trimmed.length > 2048) return "Base URL 最多 2048 字符";
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return "请输入合法的绝对 URL";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "仅支持 http 或 https";
  }
  if (url.username || url.password) {
    return "不允许包含用户名或密码";
  }
  if (url.search || url.hash) {
    return "不允许包含查询参数或 hash";
  }
  return null;
}

// ── API Key managed accounts detail ───────────────────────────────────────────

function formatAccountTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ApiKeyAccountsDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const { toast } = usePrompt();
  const requiresExplicitActiveDisposition = EXPLICIT_ACTIVE_DISPOSITION_PROVIDERS.has(provider.id);
  const supportsBaseUrlOverride = provider.id === "anyrouter";
  const supportsProviderConfig = provider.id === "anyrouter";

  const [accounts, setAccounts] = useState<ApiKeyAccountEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Per-account action states
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [revealingId, setRevealingId] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Map<string, string>>(new Map());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Add form
  const [addOpen, setAddOpen] = useState(false);
  const [addDisplayName, setAddDisplayName] = useState("");
  const [addDescription, setAddDescription] = useState("");
  const [addApiKey, setAddApiKey] = useState("");
  const [addActivate, setAddActivate] = useState(true);
  const [addUseBaseUrlOverride, setAddUseBaseUrlOverride] = useState(false);
  const [addBaseUrlOverride, setAddBaseUrlOverride] = useState("");
  const [addBaseUrlError, setAddBaseUrlError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  // Edit dialog
  const [editAccount, setEditAccount] = useState<ApiKeyAccountEntry | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [editUseBaseUrlOverride, setEditUseBaseUrlOverride] = useState(false);
  const [editBaseUrlOverride, setEditBaseUrlOverride] = useState("");
  const [editBaseUrlError, setEditBaseUrlError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Delete confirmation (explicit disposition for AnyRouter Active)
  const [deleteConfirm, setDeleteConfirm] = useState<ApiKeyAccountEntry | null>(null);
  const [deleteDeleting, setDeleteDeleting] = useState(false);
  const [deleteMode, setDeleteMode] = useState<"replace" | "disconnect">("disconnect");
  const [deleteReplacementId, setDeleteReplacementId] = useState<string | null>(null);

  // Enable/disable states
  const [disablingId, setDisablingId] = useState<string | null>(null);
  const [enablingId, setEnablingId] = useState<string | null>(null);

  // Disable confirmation
  const [disableConfirm, setDisableConfirm] = useState<ApiKeyAccountEntry | null>(null);
  const [disableSaving, setDisableSaving] = useState(false);
  const [disableMode, setDisableMode] = useState<"replace" | "disconnect">("disconnect");
  const [disableReplacementId, setDisableReplacementId] = useState<string | null>(null);

  // AnyRouter provider-wide config
  const [providerConfig, setProviderConfig] = useState<AnyRouterSafeConfigResponse | null>(null);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [configBaseUrl, setConfigBaseUrl] = useState("");
  const [configRetry, setConfigRetry] = useState<AnyRouterRetryPolicyView | null>(null);
  const [configSaving, setConfigSaving] = useState(false);
  const [configFieldError, setConfigFieldError] = useState<string | null>(null);

  // Reset all state when provider changes; clear revealed keys immediately.
  useEffect(() => {
    setAccounts([]);
    setLoading(false);
    setError(null);
    setActivatingId(null);
    setDeletingId(null);
    setRevealingId(null);
    setRevealedKeys(new Map());
    setCopiedId(null);
    setDisablingId(null);
    setEnablingId(null);
    setDisableConfirm(null);
    setDisableSaving(false);
    setDisableMode("disconnect");
    setDisableReplacementId(null);
    setAddOpen(false);
    setAddDisplayName("");
    setAddDescription("");
    setAddApiKey("");
    setAddActivate(true);
    setAddUseBaseUrlOverride(false);
    setAddBaseUrlOverride("");
    setAddBaseUrlError(null);
    setAddSaving(false);
    setEditAccount(null);
    setEditDisplayName("");
    setEditDescription("");
    setEditApiKey("");
    setEditUseBaseUrlOverride(false);
    setEditBaseUrlOverride("");
    setEditBaseUrlError(null);
    setEditSaving(false);
    setEditError(null);
    setDeleteConfirm(null);
    setDeleteDeleting(false);
    setDeleteMode("disconnect");
    setDeleteReplacementId(null);
    setProviderConfig(null);
    setConfigLoading(false);
    setConfigError(null);
    setConfigBaseUrl("");
    setConfigRetry(null);
    setConfigSaving(false);
    setConfigFieldError(null);
  }, [provider.id]);

  // Clear revealed keys on unmount (Models close / navigate away).
  useEffect(() => {
    return () => {
      setRevealedKeys(new Map());
    };
  }, []);

  const applyConfigProjection = useCallback((data: AnyRouterSafeConfigResponse) => {
    setProviderConfig(data);
    setConfigBaseUrl(data.globalBaseUrl ?? "");
    setConfigRetry({ ...data.retry.effective });
    setConfigFieldError(null);
  }, []);

  const loadProviderConfig = useCallback(async () => {
    if (!supportsProviderConfig) return;
    setConfigLoading(true);
    setConfigError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}/config`, {
        cache: "no-store",
      });
      const data = await res.json() as AnyRouterSafeConfigResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      applyConfigProjection(data);
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "加载全局配置失败");
      setProviderConfig(null);
    } finally {
      setConfigLoading(false);
    }
  }, [provider.id, supportsProviderConfig, applyConfigProjection]);

  const loadAccounts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts`, {
        cache: "no-store",
      });
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载账号失败");
    } finally {
      setLoading(false);
    }
  }, [provider.id]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    void loadProviderConfig();
  }, [loadProviderConfig]);

  const showToast = useCallback((message: string, tone: "success" | "error" = "success") => {
    toast({ message, tone });
  }, [toast]);

  // Reveal
  const handleReveal = useCallback(async (accountId: string) => {
    if (revealedKeys.has(accountId)) {
      const next = new Map(revealedKeys);
      next.delete(accountId);
      setRevealedKeys(next);
      return;
    }
    setRevealingId(accountId);
    try {
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(accountId)}/reveal`,
        { method: "POST", cache: "no-store" },
      );
      const data = await res.json() as ApiKeyRevealResponse & { error?: string };
      if (!res.ok || !data.apiKey) throw new Error(data.error ?? "显示失败");
      const next = new Map(revealedKeys);
      next.set(accountId, data.apiKey);
      setRevealedKeys(next);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "显示失败", "error");
    } finally {
      setRevealingId(null);
    }
  }, [provider.id, revealedKeys, showToast]);

  // Copy
  const handleCopy = useCallback(async (accountId: string) => {
    let key = revealedKeys.get(accountId);
    if (!key) {
      setRevealingId(accountId);
      try {
        const res = await fetch(
          `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(accountId)}/reveal`,
          { method: "POST", cache: "no-store" },
        );
        const data = await res.json() as ApiKeyRevealResponse & { error?: string };
        if (!res.ok || !data.apiKey) throw new Error(data.error ?? "显示失败");
        key = data.apiKey;
        const next = new Map(revealedKeys);
        next.set(accountId, data.apiKey);
        setRevealedKeys(next);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "复制失败", "error");
        setRevealingId(null);
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(key);
      setCopiedId(accountId);
      setTimeout(() => setCopiedId(null), 2000);
      showToast("API Key 已复制到剪贴板");
    } catch {
      showToast("复制到剪贴板失败", "error");
    } finally {
      setRevealingId(null);
    }
  }, [provider.id, revealedKeys, showToast]);

  // Activate → "设为 Active"
  const handleActivate = useCallback(async (accountId: string) => {
    setActivatingId(accountId);
    setError(null);
    try {
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(accountId)}/activate`,
        { method: "POST" },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      showToast(requiresExplicitActiveDisposition ? "已设为 Active" : "账号已启用");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : (requiresExplicitActiveDisposition ? "设为 Active 失败" : "启用账号失败"));
    } finally {
      setActivatingId(null);
    }
  }, [provider.id, onRefresh, showToast, requiresExplicitActiveDisposition]);

  // Enable (re-enable disabled account)
  const handleEnable = useCallback(async (accountId: string) => {
    setEnablingId(accountId);
    setError(null);
    try {
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(accountId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "enable" }),
        },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      showToast("账号已启用");
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "启用账号失败");
    } finally {
      setEnablingId(null);
    }
  }, [provider.id, onRefresh, showToast]);

  const openDisableConfirm = useCallback((account: ApiKeyAccountEntry) => {
    setDisableConfirm(account);
    setDisableSaving(false);
    const candidates = accounts.filter((a) => a.accountId !== account.accountId && !a.disabled);
    if (account.active && requiresExplicitActiveDisposition) {
      if (candidates.length > 0) {
        setDisableMode("replace");
        setDisableReplacementId(candidates[0].accountId);
      } else {
        setDisableMode("disconnect");
        setDisableReplacementId(null);
      }
    } else {
      setDisableMode("disconnect");
      setDisableReplacementId(null);
    }
  }, [accounts, requiresExplicitActiveDisposition]);

  const handleDisableConfirm = useCallback(async () => {
    if (!disableConfirm) return;
    if (
      disableConfirm.active &&
      requiresExplicitActiveDisposition &&
      disableMode === "replace" &&
      !disableReplacementId
    ) {
      setError("请选择要切换到的 Active 账号");
      return;
    }
    setDisableSaving(true);
    setDisablingId(disableConfirm.accountId);
    setError(null);
    try {
      const body: Record<string, unknown> = { action: "disable", disabledBy: "user" };
      if (disableConfirm.active) {
        if (requiresExplicitActiveDisposition) {
          if (disableMode === "replace" && disableReplacementId) {
            body.replacementAccountId = disableReplacementId;
          } else {
            body.clearActive = true;
          }
        } else if (disableReplacementId) {
          body.replacementAccountId = disableReplacementId;
        } else {
          body.clearActive = true;
        }
      }
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(disableConfirm.accountId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setDisableConfirm(null);
      if (disableConfirm.active && requiresExplicitActiveDisposition) {
        showToast(disableMode === "replace" ? "账号已禁用，Active 已切换" : "账号已禁用，AnyRouter 已断开 Active");
      } else {
        showToast(disableConfirm.active ? "账号已禁用，并已更新当前密钥" : "账号已禁用");
      }
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "禁用账号失败");
    } finally {
      setDisableSaving(false);
      setDisablingId(null);
    }
  }, [
    provider.id,
    disableConfirm,
    disableMode,
    disableReplacementId,
    requiresExplicitActiveDisposition,
    onRefresh,
    showToast,
  ]);

  const handleAdd = useCallback(async () => {
    if (!addApiKey.trim()) return;
    if (supportsBaseUrlOverride && addUseBaseUrlOverride) {
      const err = validateClientBaseUrl(addBaseUrlOverride);
      if (err) {
        setAddBaseUrlError(err);
        return;
      }
    }
    setAddSaving(true);
    setError(null);
    setAddBaseUrlError(null);
    try {
      const body: Record<string, unknown> = {
        displayName: addDisplayName.trim() || "未命名账号",
        description: addDescription.trim(),
        apiKey: addApiKey.trim(),
        activate: addActivate,
      };
      if (supportsBaseUrlOverride) {
        body.baseUrlOverride = addUseBaseUrlOverride ? addBaseUrlOverride.trim() : null;
      }
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setAddOpen(false);
      setAddDisplayName("");
      setAddDescription("");
      setAddApiKey("");
      setAddActivate(true);
      setAddUseBaseUrlOverride(false);
      setAddBaseUrlOverride("");
      showToast(
        "账号已添加" +
          (addActivate
            ? (requiresExplicitActiveDisposition ? "并已设为 Active" : "并已启用")
            : ""),
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加账号失败");
    } finally {
      setAddSaving(false);
    }
  }, [
    provider.id,
    addDisplayName,
    addDescription,
    addApiKey,
    addActivate,
    addUseBaseUrlOverride,
    addBaseUrlOverride,
    supportsBaseUrlOverride,
    requiresExplicitActiveDisposition,
    onRefresh,
    showToast,
  ]);

  const openEdit = useCallback((account: ApiKeyAccountEntry) => {
    setEditAccount(account);
    setEditDisplayName(account.displayName);
    setEditDescription(account.description);
    setEditApiKey("");
    setEditUseBaseUrlOverride(Boolean(account.baseUrlOverride));
    setEditBaseUrlOverride(account.baseUrlOverride ?? "");
    setEditBaseUrlError(null);
    setEditError(null);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!editAccount) return;
    if (supportsBaseUrlOverride && editUseBaseUrlOverride) {
      const err = validateClientBaseUrl(editBaseUrlOverride);
      if (err) {
        setEditBaseUrlError(err);
        return;
      }
    }
    setEditSaving(true);
    setEditError(null);
    setEditBaseUrlError(null);
    try {
      const body: Record<string, unknown> = {
        displayName: editDisplayName.trim() || "未命名账号",
        description: editDescription.trim(),
      };
      if (editApiKey.trim()) {
        body.apiKey = editApiKey.trim();
      }
      if (supportsBaseUrlOverride) {
        body.baseUrlOverride = editUseBaseUrlOverride ? editBaseUrlOverride.trim() : null;
      }
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(editAccount.accountId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      setEditAccount(null);
      if (editApiKey.trim()) {
        const next = new Map(revealedKeys);
        next.delete(editAccount.accountId);
        setRevealedKeys(next);
      }
      showToast("账号已更新");
      if (editApiKey.trim() || supportsBaseUrlOverride) onRefresh();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "更新账号失败");
    } finally {
      setEditSaving(false);
    }
  }, [
    provider.id,
    editAccount,
    editDisplayName,
    editDescription,
    editApiKey,
    editUseBaseUrlOverride,
    editBaseUrlOverride,
    supportsBaseUrlOverride,
    revealedKeys,
    onRefresh,
    showToast,
  ]);

  const openDeleteConfirm = useCallback((account: ApiKeyAccountEntry) => {
    setDeleteConfirm(account);
    setDeleteDeleting(false);
    const candidates = accounts.filter((a) => a.accountId !== account.accountId && !a.disabled);
    if (account.active && requiresExplicitActiveDisposition) {
      if (candidates.length > 0) {
        setDeleteMode("replace");
        setDeleteReplacementId(candidates[0].accountId);
      } else {
        setDeleteMode("disconnect");
        setDeleteReplacementId(null);
      }
    } else {
      setDeleteMode("disconnect");
      setDeleteReplacementId(null);
    }
  }, [accounts, requiresExplicitActiveDisposition]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    if (
      deleteConfirm.active &&
      requiresExplicitActiveDisposition &&
      accounts.length > 1 &&
      deleteMode === "replace" &&
      !deleteReplacementId
    ) {
      setError("请选择要切换到的 Active 账号");
      return;
    }
    setDeleteDeleting(true);
    setDeletingId(deleteConfirm.accountId);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (deleteConfirm.active && requiresExplicitActiveDisposition && accounts.length > 1) {
        if (deleteMode === "replace" && deleteReplacementId) {
          body.replacementAccountId = deleteReplacementId;
        } else {
          body.clearActive = true;
        }
      }
      const res = await fetch(
        `/api/auth/api-key/${encodeURIComponent(provider.id)}/accounts/${encodeURIComponent(deleteConfirm.accountId)}`,
        {
          method: "DELETE",
          headers: Object.keys(body).length > 0 ? { "Content-Type": "application/json" } : undefined,
          body: Object.keys(body).length > 0 ? JSON.stringify(body) : undefined,
        },
      );
      const data = await res.json() as ApiKeyAccountsResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setAccounts(data.accounts ?? []);
      const next = new Map(revealedKeys);
      next.delete(deleteConfirm.accountId);
      setRevealedKeys(next);
      setDeleteConfirm(null);
      showToast(
        deleteConfirm.active && requiresExplicitActiveDisposition && deleteMode === "disconnect"
          ? "账号已删除，AnyRouter 已断开 Active"
          : "账号已删除",
      );
      onRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除账号失败");
      setDeleteConfirm(null);
    } finally {
      setDeleteDeleting(false);
      setDeletingId(null);
    }
  }, [
    provider.id,
    deleteConfirm,
    deleteMode,
    deleteReplacementId,
    accounts.length,
    requiresExplicitActiveDisposition,
    revealedKeys,
    onRefresh,
    showToast,
  ]);

  const handleSaveProviderConfig = useCallback(async () => {
    if (!supportsProviderConfig || !providerConfig || !configRetry) return;
    setConfigFieldError(null);
    if (providerConfig.globalBaseUrlEditable) {
      const trimmed = configBaseUrl.trim();
      if (trimmed) {
        const err = validateClientBaseUrl(trimmed);
        if (err) {
          setConfigFieldError(err);
          return;
        }
      }
    }
    if (configRetry.baseDelayMs > configRetry.maxDelayMs) {
      setConfigFieldError("baseDelayMs 不能大于 maxDelayMs");
      return;
    }
    setConfigSaving(true);
    setConfigError(null);
    try {
      const body: Record<string, unknown> = {
        revision: providerConfig.revision,
      };
      if (providerConfig.globalBaseUrlEditable) {
        const trimmed = configBaseUrl.trim();
        body.baseUrl = trimmed ? trimmed : null;
      }
      const retryPatch: Partial<AnyRouterRetryPolicyView> = {};
      let hasRetryPatch = false;
      for (const field of ANYROUTER_RETRY_FIELD_META) {
        if (providerConfig.retry.editable[field.key]) {
          retryPatch[field.key] = configRetry[field.key];
          hasRetryPatch = true;
        }
      }
      if (hasRetryPatch) body.retry = retryPatch;

      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}/config`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
      });
      const data = await res.json() as AnyRouterSafeConfigResponse & { error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "stale_revision" || res.status === 409) {
          throw new Error("保存失败：配置有冲突 (Stale Revision)，请刷新后重试，确保 models 字段不被覆盖。");
        }
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      applyConfigProjection(data);
      showToast("全局运行配置已保存");
      onRefresh();
    } catch (e) {
      setConfigError(e instanceof Error ? e.message : "保存配置失败");
    } finally {
      setConfigSaving(false);
    }
  }, [
    supportsProviderConfig,
    providerConfig,
    configRetry,
    configBaseUrl,
    provider.id,
    applyConfigProjection,
    showToast,
    onRefresh,
  ]);

  const hasLegacyImport = accounts.some((a) => a.importedFromLegacyAt);
  const isConfigured = accounts.length > 0 && accounts.some((a) => a.active);
  const activeAccount = accounts.find((a) => a.active);

  // Legacy auto-fallback name (xAI / OpenCode Go only)
  const deleteFallbackName = (() => {
    if (!deleteConfirm || !deleteConfirm.active || requiresExplicitActiveDisposition) return null;
    const others = accounts.filter((a) => a.accountId !== deleteConfirm.accountId);
    if (others.length === 0) return null;
    const sorted = [...others].sort((a, b) => {
      const aTime = a.lastActivatedAt ?? a.updatedAt;
      const bTime = b.lastActivatedAt ?? b.updatedAt;
      return bTime.localeCompare(aTime);
    });
    return sorted[0].displayName;
  })();

  const actionBtnBase: React.CSSProperties = {
    padding: "4px 9px",
    background: "none",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
  };

  const sourceBadgeStyle = (source: AnyRouterConfigFieldSource): React.CSSProperties => ({
    fontSize: 10,
    fontWeight: 600,
    padding: "1px 6px",
    borderRadius: 4,
    border: "1px solid var(--border)",
    background: source === "env" ? "rgba(96,165,250,0.12)" : "var(--bg-panel)",
    color: source === "env" ? "#60a5fa" : "var(--text-dim)",
    flexShrink: 0,
  });

  const configDirty = (() => {
    if (!providerConfig || !configRetry) return false;
    const baseChanged =
      providerConfig.globalBaseUrlEditable &&
      (configBaseUrl.trim() || "") !== (providerConfig.globalBaseUrl ?? "");
    if (baseChanged) return true;
    return ANYROUTER_RETRY_FIELD_META.some(
      (f) =>
        providerConfig.retry.editable[f.key] &&
        configRetry[f.key] !== providerConfig.retry.effective[f.key],
    );
  })();

  return (
    <div className="api-key-accounts-detail" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
          <SectionTitle>{supportsProviderConfig ? "AnyRouter" : "API Key 账号"}</SectionTitle>
          {supportsProviderConfig && (
            <>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                background: provider.modelCount > 0 ? "rgba(74,222,128,0.12)" : "var(--bg-panel)",
                color: provider.modelCount > 0 ? "#4ade80" : "var(--text-dim)",
                border: "1px solid var(--border)",
              }}>
                {provider.modelCount > 0 ? `${provider.modelCount} 模型` : (providerConfig?.modelsConfigured ? `${providerConfig.modelCount} 模型` : "未配置模型")}
              </span>
              <span style={{
                fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 4,
                background: "rgba(245,158,11,0.12)", color: "#f59e0b",
                border: "1px solid rgba(245,158,11,0.3)",
              }}>
                非官方第三方
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: isConfigured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: isConfigured ? "#4ade80" : "var(--text-dim)" }}>
            {isConfigured ? "已配置" : "未配置"}
          </span>
        </div>
      </div>

      {/* Description */}
      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {supportsProviderConfig ? (
          <>
            AnyRouter 提供安全的 API Key 多账号管理。
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>无自动切号</strong>
            ：429 或瞬时网络错误只在当前 Active 账号内重试，不会隐式轮换账号。
            <strong style={{ color: "var(--text)", fontWeight: 600 }}>无公开用量查询</strong>
            ，顶部面板不展示 AnyRouter quota。
            {activeAccount ? ` 当前 Active：${activeAccount.displayName}。` : accounts.length > 0 ? " 已有账号但尚未设为 Active。" : ""}
          </>
        ) : activeAccount ? (
          `当前账号：${activeAccount.displayName}。你可以保存多个 API Key 并在它们之间切换。`
        ) : accounts.length > 0 ? (
          `已保存 ${accounts.length} 个账号，但尚未启用任何一个。`
        ) : (
          `添加你的 ${provider.displayName} API Key${provider.modelCount > 0 ? `，以启用 ${provider.modelCount} 个模型` : ""}。`
        )}
      </p>

      {/* Error banner */}
      {error && (
        <div role="alert" className="api-key-accounts-alert" style={{ padding: "10px 14px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>
          {error}
        </div>
      )}

      {/* AnyRouter global config card */}
      {supportsProviderConfig && (
        <div className="anyrouter-config-card" style={{ background: "var(--bg-panel)", border: "1px solid var(--border)", borderRadius: 8, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>全局运行配置</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                type="button"
                onClick={() => void loadProviderConfig()}
                disabled={configLoading || configSaving}
                style={{ ...actionBtnBase, color: "var(--text-muted)", cursor: configLoading || configSaving ? "not-allowed" : "pointer" }}
              >
                刷新
              </button>
              <button
                type="button"
                onClick={() => void handleSaveProviderConfig()}
                disabled={configLoading || configSaving || !providerConfig || !configDirty}
                style={{
                  ...actionBtnBase,
                  color: configLoading || configSaving || !providerConfig || !configDirty ? "var(--text-dim)" : "#fff",
                  background: configLoading || configSaving || !providerConfig || !configDirty ? "var(--bg-panel)" : "var(--accent)",
                  borderColor: configLoading || configSaving || !providerConfig || !configDirty ? "var(--border)" : "var(--accent)",
                  cursor: configLoading || configSaving || !providerConfig || !configDirty ? "not-allowed" : "pointer",
                }}
              >
                {configSaving ? "保存中…" : "保存配置"}
              </button>
            </div>
          </div>

          {configError && (
            <div role="alert" style={{ padding: "8px 10px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)", borderRadius: 6, fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>
              {configError}
              <div style={{ marginTop: 4, color: "var(--text-dim)", fontSize: 11 }}>账号管理仍可用；协议扩展可能暂不可用。</div>
            </div>
          )}
          {configFieldError && (
            <div role="alert" style={{ fontSize: 12, color: "#f87171" }}>{configFieldError}</div>
          )}

          {configLoading && !providerConfig ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)" }}>正在加载配置…</div>
          ) : providerConfig && configRetry ? (
            <div className="anyrouter-config-grid" style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>全局默认 Base URL</span>
                  <span style={sourceBadgeStyle(providerConfig.globalBaseUrlSource)}>
                    {anyRouterSourceBadgeLabel(providerConfig.globalBaseUrlSource)}
                  </span>
                </div>
                <input
                  value={configBaseUrl}
                  onChange={(e) => setConfigBaseUrl(e.target.value)}
                  disabled={!providerConfig.globalBaseUrlEditable || configSaving}
                  placeholder="https://…"
                  style={{
                    ...inputStyle,
                    fontFamily: "var(--font-mono)",
                    opacity: providerConfig.globalBaseUrlEditable ? 1 : 0.75,
                    cursor: providerConfig.globalBaseUrlEditable ? "text" : "not-allowed",
                  }}
                  title={providerConfig.globalBaseUrlEditable ? "写入 anyrouter.json" : "由环境变量覆盖，只读"}
                />
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)" }}>
                  <span>模型配置来源</span>
                  <span style={sourceBadgeStyle("config")}>anyrouter.json</span>
                </div>
                <div style={{ fontSize: 12, color: "var(--text)", padding: "6px 0" }}>
                  {providerConfig.modelsConfigured
                    ? `共 ${providerConfig.modelCount} 个模型（只读）`
                    : "未配置模型目录（只读）"}
                </div>
              </div>

              {ANYROUTER_RETRY_FIELD_META.map((field) => {
                const editable = providerConfig.retry.editable[field.key];
                const source = providerConfig.retry.source[field.key];
                return (
                  <div key={field.key} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-muted)", flexWrap: "wrap" }}>
                      <span>{field.label}</span>
                      <span style={sourceBadgeStyle(source)}>{anyRouterSourceBadgeLabel(source)}</span>
                    </div>
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={configRetry[field.key]}
                      disabled={!editable || configSaving}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        if (!Number.isFinite(n)) return;
                        setConfigRetry((prev) => prev ? { ...prev, [field.key]: Math.trunc(n) } : prev);
                      }}
                      style={{
                        ...inputStyle,
                        maxWidth: 160,
                        opacity: editable ? 1 : 0.75,
                        cursor: editable ? "text" : "not-allowed",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          ) : null}

          <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.5 }}>
            重试为 provider-wide 设置，不按账号保存；优先级：环境变量 &gt; anyrouter.json &gt; 默认。
          </div>
        </div>
      )}

      {/* Accounts section header */}
      {supportsProviderConfig && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>API Key 账号</div>
        </div>
      )}

      {/* Legacy import banner */}
      {hasLegacyImport && (
        <div style={{ padding: "10px 14px", background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.25)", borderRadius: 6, fontSize: 12, lineHeight: 1.5, color: "var(--text-muted)", display: "flex", alignItems: "flex-start", gap: 8 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#60a5fa", flexShrink: 0, marginTop: 1 }}>
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          <span>
            {supportsProviderConfig
              ? "已导入 legacy anyrouter.json apiKey（源配置字段保留，不会自动删除）。可在下方重命名或继续添加更多密钥。"
              : "已导入你之前的 API Key。可在下方重命名或继续添加更多密钥。"}
          </span>
        </div>
      )}

      {/* Account list */}
      {loading ? (
        <div style={{ padding: "20px 0", textAlign: "center", fontSize: 12, color: "var(--text-dim)" }}>正在加载账号…</div>
      ) : accounts.length === 0 && !error ? (
        <div style={{
          padding: "28px 16px", textAlign: "center", border: "1px dashed var(--border)",
          borderRadius: 8, color: "var(--text-dim)", fontSize: 12, lineHeight: 1.6,
        }}>
          <div style={{ marginBottom: 8, fontWeight: 600 }}>暂无 API Key</div>
          <div>添加你的第一个 {provider.displayName} API Key 以开始使用。</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {accounts.map((account) => {
            const isRevealed = revealedKeys.has(account.accountId);
            const isRevealing = revealingId === account.accountId;
            const isCopied = copiedId === account.accountId;
            const isActive = account.active;
            const isDisabled = account.disabled === true;
            const isBusy =
              activatingId === account.accountId ||
              disablingId === account.accountId ||
              enablingId === account.accountId ||
              deletingId === account.accountId;

            return (
              <div
                key={account.accountId}
                className={`api-key-account-card${isBusy ? " is-busy" : ""}${isActive ? " is-active" : ""}`}
                style={{
                  background: isActive ? "rgba(96,165,250,0.04)" : isDisabled ? "rgba(239,68,68,0.03)" : "var(--bg-panel)",
                  border: `1px solid ${isActive ? "rgba(96,165,250,0.45)" : isDisabled ? "rgba(239,68,68,0.25)" : "var(--border)"}`,
                  borderRadius: 6,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  opacity: isBusy ? 0.65 : isDisabled ? 0.85 : 1,
                  position: "relative",
                  pointerEvents: isBusy ? "none" : "auto",
                }}
              >
                {isBusy && (
                  <div style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, fontWeight: 600, color: "var(--text)", background: "rgba(0,0,0,0.04)", borderRadius: 6, zIndex: 1,
                  }}>
                    处理中…
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {account.displayName}
                    </span>
                    {isActive && (
                      <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(74,222,128,0.15)", color: "#4ade80", padding: "1px 6px", borderRadius: 4, border: "1px solid rgba(74,222,128,0.3)", flexShrink: 0 }}>
                        {requiresExplicitActiveDisposition ? "Active" : "当前"}
                      </span>
                    )}
                    {isDisabled && (
                      <span style={{ fontSize: 10, fontWeight: 600, background: "rgba(239,68,68,0.12)", color: "#f87171", padding: "1px 6px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.3)", flexShrink: 0 }}>
                        已禁用
                      </span>
                    )}
                    {account.importedFromLegacyAt && (
                      <span style={{ fontSize: 10, fontWeight: 500, background: "rgba(245,158,11,0.15)", color: "#f59e0b", padding: "1px 6px", borderRadius: 4, border: "1px solid rgba(245,158,11,0.3)", flexShrink: 0 }}>
                        已导入
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0, whiteSpace: "nowrap" }}>
                    {formatAccountTime(account.lastActivatedAt)}
                  </span>
                </div>

                {account.description && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
                    {account.description}
                  </div>
                )}

                {supportsBaseUrlOverride && (
                  <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={account.baseUrlOverride || undefined}>
                    {account.baseUrlOverride
                      ? `Override: ${account.baseUrlOverride}`
                      : "使用默认端点"}
                  </div>
                )}

                {isDisabled && account.disabledReason && (
                  <div style={{ fontSize: 11, color: "#f87171", lineHeight: 1.4, padding: "6px 10px", background: "rgba(239,68,68,0.06)", borderRadius: 5, border: "1px solid rgba(239,68,68,0.15)" }}>
                    {account.disabledReason}
                    {account.disabledBy === "system" && <span style={{ color: "var(--text-dim)", marginLeft: 6 }}>（系统自动禁用）</span>}
                  </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <code
                    aria-label={isRevealed ? "API Key 明文" : "API Key 掩码"}
                    style={{
                      fontSize: 11,
                      fontFamily: "var(--font-mono)",
                      color: isRevealed ? "#fbbf24" : "var(--text-dim)",
                      background: "var(--bg)",
                      padding: "3px 8px",
                      borderRadius: 4,
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    {isRevealed ? revealedKeys.get(account.accountId) : account.maskedKeyPreview}
                  </code>
                </div>

                <div className="api-key-account-actions" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {isActive ? (
                    <span style={{ ...actionBtnBase, color: "#4ade80", borderColor: "rgba(74,222,128,0.3)", cursor: "default" }}>
                      {requiresExplicitActiveDisposition ? "Active" : "当前"}
                    </span>
                  ) : isDisabled ? (
                    <button
                      disabled={true}
                      title={account.disabledReason || "账号已禁用。请先启用后再设为 Active。"}
                      style={{ ...actionBtnBase, color: "var(--text-dim)", cursor: "not-allowed", opacity: 0.5 }}
                    >
                      {requiresExplicitActiveDisposition ? "设为 Active" : "启用"}
                    </button>
                  ) : (
                    <button
                      onClick={() => handleActivate(account.accountId)}
                      disabled={isBusy}
                      style={{ ...actionBtnBase, color: isBusy ? "var(--text-dim)" : "var(--accent)", cursor: isBusy ? "not-allowed" : "pointer" }}
                    >
                      {activatingId === account.accountId
                        ? (requiresExplicitActiveDisposition ? "设置中…" : "启用中…")
                        : (requiresExplicitActiveDisposition ? "设为 Active" : "启用")}
                    </button>
                  )}

                  {isDisabled ? (
                    <button
                      onClick={() => handleEnable(account.accountId)}
                      disabled={isBusy}
                      style={{
                        ...actionBtnBase,
                        color: isBusy ? "var(--text-dim)" : "#4ade80",
                        borderColor: isBusy ? "var(--border)" : "rgba(74,222,128,0.3)",
                        cursor: isBusy ? "not-allowed" : "pointer",
                      }}
                      title="重新启用该账号"
                    >
                      {enablingId === account.accountId ? "启用中…" : "启用"}
                    </button>
                  ) : (
                    <button
                      onClick={() => openDisableConfirm(account)}
                      disabled={isBusy}
                      style={{
                        ...actionBtnBase,
                        color: isBusy ? "var(--text-dim)" : "#f59e0b",
                        borderColor: isBusy ? "var(--border)" : "rgba(245,158,11,0.3)",
                        cursor: isBusy ? "not-allowed" : "pointer",
                      }}
                      title={
                        isActive && requiresExplicitActiveDisposition
                          ? "禁用 Active 账号——必须显式选择替换或断开"
                          : isActive
                            ? "禁用该账号——你需要选择替代账号，或确认清空当前密钥"
                            : "禁用该账号"
                      }
                    >
                      禁用
                    </button>
                  )}

                  <button
                    onClick={() => handleReveal(account.accountId)}
                    disabled={isRevealing}
                    aria-label={isRevealed ? "隐藏 API Key" : "显示 API Key"}
                    {...iconFlowAttrs(isRevealing ? "off" : "interactive")}
                    style={{
                      ...actionBtnBase,
                      color: isRevealing ? "var(--text-dim)" : (isRevealed ? "#f59e0b" : "var(--text-muted)"),
                      cursor: isRevealing ? "not-allowed" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                    title={isRevealed ? "隐藏 API Key" : "显示 API Key"}
                  >
                    {isRevealing ? (
                      "加载中…"
                    ) : isRevealed ? (
                      <>
                        <ActionFlowIcon width={12} height={12} strokeWidth={2}>
                          <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20C7 20 2.73 16.89 1 12a18.45 18.45 0 0 1 5.06-6.94" />
                          <path d="M9.9 4.24A10.94 10.94 0 0 1 12 4c5 0 9.27 3.11 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12A3 3 0 0 1 9.88 9.88" />
                          <path d="M1 1l22 22" />
                        </ActionFlowIcon>
                        隐藏
                      </>
                    ) : (
                      <>
                        <ActionFlowIcon width={12} height={12} strokeWidth={2}>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12Z" />
                          <circle cx="12" cy="12" r="3" />
                        </ActionFlowIcon>
                        显示
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => handleCopy(account.accountId)}
                    disabled={isRevealing || isBusy}
                    {...iconFlowAttrs(isRevealing || isBusy || isCopied ? "off" : "interactive")}
                    style={{
                      ...actionBtnBase,
                      color: isCopied ? "#4ade80" : "var(--text-muted)",
                      borderColor: isCopied ? "rgba(74,222,128,0.3)" : "var(--border)",
                      cursor: isRevealing || isBusy ? "not-allowed" : "pointer",
                      display: "inline-flex", alignItems: "center", gap: 4,
                    }}
                    title="复制 API Key"
                  >
                    {isCopied ? (
                      <>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        已复制
                      </>
                    ) : (
                      <>
                        <ActionFlowIcon width={11} height={11} strokeWidth={2}>
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </ActionFlowIcon>
                        复制
                      </>
                    )}
                  </button>

                  <button
                    onClick={() => openEdit(account)}
                    disabled={isBusy}
                    style={{ ...actionBtnBase, color: "var(--text-muted)", cursor: isBusy ? "not-allowed" : "pointer" }}
                  >
                    编辑
                  </button>

                  <button
                    onClick={() => openDeleteConfirm(account)}
                    disabled={isBusy}
                    style={{ ...actionBtnBase, color: "#ef4444", borderColor: "rgba(239,68,68,0.3)", cursor: isBusy ? "not-allowed" : "pointer" }}
                  >
                    {isActive && requiresExplicitActiveDisposition ? "断开" : "删除"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add account section */}
      {!addOpen ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              padding: "7px 16px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 5,
              color: "#fff",
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            + 添加 API Key
          </button>
          {isConfigured && activeAccount && (
            <button
              onClick={() => openDeleteConfirm(activeAccount)}
              style={{
                padding: "7px 14px",
                background: "none",
                border: "1px solid rgba(239,68,68,0.3)",
                borderRadius: 5,
                color: "#ef4444",
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {requiresExplicitActiveDisposition ? "断开 Active" : "断开连接"}
            </button>
          )}
        </div>
      ) : (
        <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 16, background: "var(--bg-panel)", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>添加 API Key</div>

          <Field label="显示名称">
            <TextInput value={addDisplayName} onChange={setAddDisplayName} placeholder="例如：团队账号" />
          </Field>

          <Field label="描述（可选）">
            <TextAreaInput value={addDescription} onChange={setAddDescription} placeholder="关于此密钥的备注…" rows={5} />
          </Field>

          <Field label="API Key">
            <SecretTextInput
              value={addApiKey}
              onChange={setAddApiKey}
              placeholder={supportsProviderConfig ? "sk-…" : "op_zen_…"}
              mono
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          {supportsBaseUrlOverride && (
            <>
              <Check
                label="使用独立的 Base URL 覆盖"
                checked={addUseBaseUrlOverride}
                onChange={(v) => {
                  setAddUseBaseUrlOverride(v);
                  setAddBaseUrlError(null);
                  if (!v) setAddBaseUrlOverride("");
                }}
              />
              {addUseBaseUrlOverride && (
                <Field label="账号级 Base URL">
                  <TextInput
                    value={addBaseUrlOverride}
                    onChange={(v) => {
                      setAddBaseUrlOverride(v);
                      setAddBaseUrlError(null);
                    }}
                    placeholder="https://api.custom.example/v1"
                    mono
                  />
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                    留空则继承全局默认 Base URL；不允许 userinfo / query / hash。
                  </div>
                  {addBaseUrlError && <div role="alert" style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{addBaseUrlError}</div>}
                </Field>
              )}
            </>
          )}

          <Check
            label={requiresExplicitActiveDisposition ? "保存并设为 Active 账号" : "保存并设为当前密钥"}
            checked={addActivate}
            onChange={setAddActivate}
          />

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              onClick={() => {
                setAddOpen(false);
                setAddApiKey("");
                setAddDisplayName("");
                setAddDescription("");
                setAddUseBaseUrlOverride(false);
                setAddBaseUrlOverride("");
                setAddBaseUrlError(null);
              }}
              disabled={addSaving}
              style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 5, color: "var(--text-muted)", cursor: addSaving ? "not-allowed" : "pointer", fontSize: 12 }}
            >
              取消
            </button>
            <button
              onClick={handleAdd}
              disabled={addSaving || !addApiKey.trim()}
              style={{
                padding: "6px 16px",
                background: addSaving || !addApiKey.trim() ? "var(--bg-panel)" : "var(--accent)",
                border: "none", borderRadius: 5,
                color: addSaving || !addApiKey.trim() ? "var(--text-dim)" : "#fff",
                cursor: addSaving || !addApiKey.trim() ? "not-allowed" : "pointer",
                fontSize: 12, fontWeight: 600,
              }}
            >
              {addSaving ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      )}

      {/* Edit dialog */}
      {editAccount && (
        <div
          className="pi-modal-overlay"
          role="presentation"
          style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={(e) => { if (e.target === e.currentTarget && !editSaving) setEditAccount(null); }}
          onKeyDown={(e) => { if (e.key === "Escape" && !editSaving) setEditAccount(null); }}
        >
          <div className="pi-modal-panel pi-modal-panel-compact" role="dialog" aria-modal="true" aria-label="编辑账号" style={{ width: 480, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
            <div style={{ padding: "12px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>编辑账号</div>
                <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{editAccount.displayName}</div>
              </div>
              <button type="button" disabled={editSaving} onClick={() => setEditAccount(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: editSaving ? "not-allowed" : "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
            </div>
            <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
              <Field label="显示名称">
                <TextInput value={editDisplayName} onChange={setEditDisplayName} placeholder="账号名称" />
              </Field>
              <Field label="描述">
                <TextAreaInput value={editDescription} onChange={setEditDescription} placeholder="备注…" rows={5} />
              </Field>
              <Field label="替换 API Key（留空则保持不变）">
                <SecretTextInput
                  value={editApiKey}
                  onChange={setEditApiKey}
                  placeholder="输入新密钥以替换…"
                  mono
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>
              {supportsBaseUrlOverride && (
                <>
                  <Check
                    label="使用独立的 Base URL 覆盖"
                    checked={editUseBaseUrlOverride}
                    onChange={(v) => {
                      setEditUseBaseUrlOverride(v);
                      setEditBaseUrlError(null);
                      if (!v) setEditBaseUrlOverride("");
                    }}
                  />
                  {editUseBaseUrlOverride && (
                    <Field label="账号级 Base URL">
                      <TextInput
                        value={editBaseUrlOverride}
                        onChange={(v) => {
                          setEditBaseUrlOverride(v);
                          setEditBaseUrlError(null);
                        }}
                        placeholder="https://api.custom.example/v1"
                        mono
                      />
                      {editBaseUrlError && <div role="alert" style={{ fontSize: 11, color: "#f87171", marginTop: 4 }}>{editBaseUrlError}</div>}
                    </Field>
                  )}
                </>
              )}
              {editError && <div role="alert" style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{editError}</div>}
            </div>
            <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button type="button" disabled={editSaving} onClick={() => setEditAccount(null)} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: editSaving ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
              <button type="button" disabled={editSaving} onClick={handleEditSave} style={{ padding: "6px 14px", background: editSaving ? "var(--bg-panel)" : "var(--accent)", border: "none", borderRadius: 6, color: editSaving ? "var(--text-dim)" : "#fff", cursor: editSaving ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}>{editSaving ? "保存中…" : "保存"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (() => {
        const isDeletingActive = deleteConfirm.active;
        const enabledCandidates = accounts.filter(
          (a) => a.accountId !== deleteConfirm.accountId && !a.disabled,
        );
        const needsExplicit = isDeletingActive && requiresExplicitActiveDisposition && accounts.length > 1;

        return (
          <div
            className="pi-modal-overlay"
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { if (e.target === e.currentTarget && !deleteDeleting) setDeleteConfirm(null); }}
            onKeyDown={(e) => { if (e.key === "Escape" && !deleteDeleting) setDeleteConfirm(null); }}
          >
            <div className="pi-modal-panel pi-modal-panel-compact" role="dialog" aria-modal="true" aria-label="删除账号" style={{ width: 480, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
              <div style={{ padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  {needsExplicit ? "断开 Active 账号" : "删除账号？"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {needsExplicit ? (
                    <>
                      您正在删除当前全局 Active 的 {provider.displayName} 账号
                      <strong style={{ color: "var(--text)" }}> {deleteConfirm.displayName}</strong>。
                      {provider.displayName} 不会自动回退到“最近使用”的账号，请显式选择处理方式：
                    </>
                  ) : isDeletingActive && requiresExplicitActiveDisposition && accounts.length === 1 ? (
                    <>
                      这是最后一个已保存账号。删除后将 <strong style={{ color: "#ef4444" }}>断开</strong> {provider.displayName} 连接（无 Active 账号）。
                    </>
                  ) : isDeletingActive && deleteFallbackName && accounts.length > 2 ? (
                    <>
                      这是当前 <strong style={{ color: "#4ade80" }}>正在使用</strong> 的账号。
                      删除后，系统将自动启用 <strong style={{ color: "var(--text)" }}>{deleteFallbackName}</strong> 作为新的当前账号。
                    </>
                  ) : isDeletingActive && accounts.length === 2 && deleteFallbackName ? (
                    <>
                      这是当前 <strong style={{ color: "#4ade80" }}>正在使用</strong> 的账号。
                      删除后，将自动启用 <strong style={{ color: "var(--text)" }}>{deleteFallbackName}</strong>。
                    </>
                  ) : isDeletingActive && accounts.length === 1 ? (
                    <>
                      这是最后一个已保存账号。删除后将 <strong style={{ color: "#ef4444" }}>断开</strong> {provider.displayName} 提供商。
                    </>
                  ) : (
                    <>确定删除「{deleteConfirm.displayName}」？</>
                  )}
                </div>

                {needsExplicit && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {enabledCandidates.length > 0 && (
                      <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text)" }}>
                        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <input
                            type="radio"
                            name="deleteDisposition"
                            checked={deleteMode === "replace"}
                            onChange={() => {
                              setDeleteMode("replace");
                              if (!deleteReplacementId) setDeleteReplacementId(enabledCandidates[0].accountId);
                            }}
                            style={{ accentColor: "var(--accent)" }}
                          />
                          将 Active 切换至其他账号
                        </span>
                        {deleteMode === "replace" && (
                          <select
                            value={deleteReplacementId ?? ""}
                            onChange={(e) => setDeleteReplacementId(e.target.value || null)}
                            style={{ ...inputStyle, marginLeft: 24, width: "calc(100% - 24px)" }}
                          >
                            {enabledCandidates.map((c) => (
                              <option key={c.accountId} value={c.accountId}>
                                {c.displayName} ({c.maskedKeyPreview})
                              </option>
                            ))}
                          </select>
                        )}
                      </label>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#f87171", fontWeight: 600 }}>
                      <input
                        type="radio"
                        name="deleteDisposition"
                        checked={deleteMode === "disconnect" || enabledCandidates.length === 0}
                        onChange={() => {
                          setDeleteMode("disconnect");
                          setDeleteReplacementId(null);
                        }}
                        style={{ accentColor: "var(--accent)" }}
                      />
                      断开 {provider.displayName} 连接（无 Active 账号）
                    </label>
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button type="button" disabled={deleteDeleting} onClick={() => setDeleteConfirm(null)} style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: deleteDeleting ? "not-allowed" : "pointer", fontSize: 12 }}>取消</button>
                <button
                  type="button"
                  disabled={deleteDeleting || (needsExplicit && deleteMode === "replace" && !deleteReplacementId)}
                  onClick={handleDeleteConfirm}
                  style={{ padding: "6px 14px", background: deleteDeleting ? "var(--bg-panel)" : "#ef4444", border: "none", borderRadius: 6, color: "#fff", cursor: deleteDeleting ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 700 }}
                >
                  {deleteDeleting
                    ? "处理中…"
                    : needsExplicit && deleteMode === "disconnect"
                      ? "确认断开"
                      : "删除"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Disable confirmation dialog */}
      {disableConfirm && (() => {
        const isDisablingActive = disableConfirm.active;
        const enabledCandidates = accounts.filter(
          (a) => a.accountId !== disableConfirm.accountId && !a.disabled,
        );
        const hasCandidates = enabledCandidates.length > 0;
        const needsExplicit = isDisablingActive && requiresExplicitActiveDisposition;

        return (
          <div
            className="pi-modal-overlay"
            role="presentation"
            style={{ position: "fixed", inset: 0, zIndex: 1210, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center" }}
            onClick={(e) => { if (e.target === e.currentTarget && !disableSaving) setDisableConfirm(null); }}
            onKeyDown={(e) => { if (e.key === "Escape" && !disableSaving) setDisableConfirm(null); }}
          >
            <div className="pi-modal-panel pi-modal-panel-compact" role="dialog" aria-modal="true" aria-label="禁用账号" style={{ width: 480, maxWidth: "calc(100vw - 32px)", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, boxShadow: "0 10px 36px rgba(0,0,0,0.28)", overflow: "hidden" }}>
              <div style={{ padding: "16px 16px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>
                  {needsExplicit ? "断开 Active 账号" : isDisablingActive ? "禁用当前激活账号" : "禁用账号"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                  {needsExplicit ? (
                    <>
                      您正在禁用当前全局 Active 的 {provider.displayName} 账号
                      <strong style={{ color: "var(--text)" }}> {disableConfirm.displayName}</strong>。
                      不会自动回退到“最近使用”的账号，请显式选择处理方式：
                    </>
                  ) : isDisablingActive ? (
                    <>
                      你正在禁用当前激活的 {provider.displayName} 账号 <strong style={{ color: "var(--text)" }}>{disableConfirm.displayName}</strong>。
                      禁用后该账号不能被激活，直到重新启用。
                    </>
                  ) : (
                    <>
                      确定要禁用 &ldquo;{disableConfirm.displayName}&rdquo;？
                      禁用后该账号不能被激活，直到重新启用。
                    </>
                  )}
                </div>

                {isDisablingActive && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {hasCandidates ? (
                      needsExplicit ? (
                        <>
                          <label style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text)" }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <input
                                type="radio"
                                name="disableDisposition"
                                checked={disableMode === "replace"}
                                onChange={() => {
                                  setDisableMode("replace");
                                  if (!disableReplacementId) setDisableReplacementId(enabledCandidates[0].accountId);
                                }}
                                style={{ accentColor: "var(--accent)" }}
                              />
                              将 Active 切换至其他账号
                            </span>
                            {disableMode === "replace" && (
                              <select
                                value={disableReplacementId ?? ""}
                                onChange={(e) => setDisableReplacementId(e.target.value || null)}
                                style={{ ...inputStyle, marginLeft: 24, width: "calc(100% - 24px)" }}
                              >
                                {enabledCandidates.map((c) => (
                                  <option key={c.accountId} value={c.accountId}>
                                    {c.displayName} ({c.maskedKeyPreview})
                                  </option>
                                ))}
                              </select>
                            )}
                          </label>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#f87171", fontWeight: 600 }}>
                            <input
                              type="radio"
                              name="disableDisposition"
                              checked={disableMode === "disconnect"}
                              onChange={() => {
                                setDisableMode("disconnect");
                                setDisableReplacementId(null);
                              }}
                              style={{ accentColor: "var(--accent)" }}
                            />
                            断开 {provider.displayName} 连接（无 Active 账号）
                          </label>
                        </>
                      ) : (
                        <>
                          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
                            选择一个替代账号激活，或清空 active key：
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto" }}>
                            {enabledCandidates.map((candidate) => (
                              <label
                                key={candidate.accountId}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  padding: "8px 10px", borderRadius: 6,
                                  border: `1px solid ${disableReplacementId === candidate.accountId ? "rgba(96,165,250,0.45)" : "var(--border)"}`,
                                  background: disableReplacementId === candidate.accountId ? "rgba(96,165,250,0.06)" : "var(--bg-panel)",
                                  cursor: "pointer", fontSize: 12,
                                }}
                                onClick={() => setDisableReplacementId(candidate.accountId)}
                              >
                                <input
                                  type="radio"
                                  name="disableReplacement"
                                  checked={disableReplacementId === candidate.accountId}
                                  onChange={() => setDisableReplacementId(candidate.accountId)}
                                  style={{ accentColor: "var(--accent)" }}
                                />
                                <span style={{ color: "var(--text)", fontWeight: 600 }}>{candidate.displayName}</span>
                                <span style={{ color: "var(--text-dim)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{candidate.maskedKeyPreview}</span>
                              </label>
                            ))}
                          </div>
                          <label
                            style={{
                              display: "flex", alignItems: "center", gap: 8,
                              padding: "8px 10px", borderRadius: 6,
                              border: `1px solid ${disableReplacementId === null ? "rgba(239,68,68,0.35)" : "var(--border)"}`,
                              background: disableReplacementId === null ? "rgba(239,68,68,0.04)" : "var(--bg-panel)",
                              cursor: "pointer", fontSize: 12,
                            }}
                            onClick={() => setDisableReplacementId(null)}
                          >
                            <input
                              type="radio"
                              name="disableReplacement"
                              checked={disableReplacementId === null}
                              onChange={() => setDisableReplacementId(null)}
                              style={{ accentColor: "var(--accent)" }}
                            />
                            <span style={{ color: "#f87171", fontWeight: 600 }}>清空 active key</span>
                            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>（后续没有可用 managed key 时将无法调用）</span>
                          </label>
                        </>
                      )
                    ) : (
                      <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)", fontSize: 11, color: "#f87171", lineHeight: 1.5 }}>
                        {needsExplicit
                          ? "没有其他可用账号。继续将断开 Active 连接，不会自动选择最近账号。"
                          : <>没有其他 enabled 账号可用。禁用后 <strong>active key 将被清空</strong>，后续无法使用 managed key 进行模型调用。确定要继续吗？</>}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
                <button
                  type="button"
                  disabled={disableSaving}
                  onClick={() => setDisableConfirm(null)}
                  style={{ padding: "6px 12px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: disableSaving ? "not-allowed" : "pointer", fontSize: 12 }}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={disableSaving || (needsExplicit && disableMode === "replace" && !disableReplacementId)}
                  onClick={handleDisableConfirm}
                  style={{
                    padding: "6px 14px",
                    background: disableSaving ? "var(--bg-panel)" : needsExplicit && disableMode === "disconnect" ? "#ef4444" : "#f59e0b",
                    border: "none", borderRadius: 6,
                    color: "#fff",
                    cursor: disableSaving ? "not-allowed" : "pointer",
                    fontSize: 12, fontWeight: 700,
                  }}
                >
                  {disableSaving
                    ? "处理中…"
                    : needsExplicit && disableMode === "disconnect"
                      ? "确认断开"
                      : needsExplicit
                        ? "确认切换并禁用"
                        : isDisablingActive && disableReplacementId === null
                          ? "禁用并清空 active"
                          : "确认禁用"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── API Key detail (single-key legacy) ───────────────────────────────────────

/**
 * 格式化余额查询的相对更新时间。
 *
 * @param timestamp 查询完成的毫秒时间戳。
 * @returns 简短相对时间文本。
 */
function formatBalanceQueriedAt(timestamp: number | null): string {
  if (!timestamp) return "从未";
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return "刚刚";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)} 分钟前`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)} 小时前`;
  return `${Math.floor(diffSeconds / 86400)} 天前`;
}

/**
 * 将 DeepSeek 币种转换为展示前缀。
 *
 * @param currency DeepSeek 返回的币种代码。
 * @returns 展示余额时使用的货币前缀。
 */
function deepSeekCurrencyPrefix(currency: string): string {
  if (currency === "CNY") return "¥";
  if (currency === "USD") return "$";
  return "";
}

/**
 * 渲染 DeepSeek 官方余额查询结果。
 *
 * @param props.balance 当前余额查询结果。
 * @param props.loading 是否正在刷新余额。
 * @param props.onRefresh 手动刷新余额的回调。
 * @returns DeepSeek 余额展示内容。
 */
function DeepSeekBalanceView({
  balance,
  loading,
  onRefresh,
}: {
  balance: DeepSeekBalanceResult | null;
  loading: boolean;
  onRefresh: () => void;
}) {
  const availableColor = balance?.isAvailable === false ? "#f87171" : "#4ade80";

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg-panel)", padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0 }}>余额</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {loading ? "刷新中…" : `更新于 ${formatBalanceQueriedAt(balance?.queriedAt ?? null)}`}
          </span>
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          {...iconFlowAttrs(loading ? "off" : "interactive")}
          title="刷新余额"
          aria-label="刷新余额"
          style={{ width: 28, height: 28, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", color: loading ? "var(--text-dim)" : "var(--text-muted)", cursor: loading ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
        >
          <ActionFlowIcon width={14} height={14} strokeWidth={2}>
            <path d="M21 12a9 9 0 0 1-9 9 8.8 8.8 0 0 1-6.36-2.64" />
            <path d="M3 12a9 9 0 0 1 9-9 8.8 8.8 0 0 1 6.36 2.64" />
            <path d="M3 4v8h8" />
            <path d="M21 20v-8h-8" />
          </ActionFlowIcon>
        </button>
      </div>

      {balance?.error && (
        <div style={{ fontSize: 12, color: "#f87171", lineHeight: 1.5 }}>{balance.error}</div>
      )}

      {balance?.success && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>API 调用</span>
            <span style={{ fontSize: 12, color: availableColor, fontWeight: 700 }}>
              {balance.isAvailable === false ? "不可用" : "可用"}
            </span>
          </div>

          {balance.balanceInfos.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>未返回余额详情。</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {balance.balanceInfos.map((info) => {
                const prefix = deepSeekCurrencyPrefix(info.currency);
                return (
                  <div key={info.currency} style={{ border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg)", padding: 10, display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600 }}>{info.currency}</span>
                      <span style={{ fontSize: 18, color: "var(--text)", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{prefix}{info.totalBalance}</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", justifyContent: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>赠送 {prefix}{info.grantedBalance}</span>
                      <span style={{ fontSize: 11, color: "var(--text-dim)", fontVariantNumeric: "tabular-nums" }}>充值 {prefix}{info.toppedUpBalance}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ApiKeyDetail({ provider, onRefresh }: { provider: ApiKeyProvider; onRefresh: () => void }) {
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [balance, setBalance] = useState<DeepSeekBalanceResult | null>(null);
  const [balanceLoading, setBalanceLoading] = useState(false);

  // Reset state when provider changes
  useEffect(() => {
    setApiKey("");
    setError(null);
    setSavedOk(false);
    setBalance(null);
    setBalanceLoading(false);
  }, [provider.id, provider.configured]);

  /**
   * 从服务端刷新 DeepSeek 官方余额。
   *
   * @returns 无返回值，查询结果写入组件状态。
   */
  const loadDeepSeekBalance = useCallback(async () => {
    if (provider.id !== "deepseek" || !provider.configured) return;
    setBalanceLoading(true);
    try {
      const res = await fetch(`/api/auth/balance/${encodeURIComponent(provider.id)}`);
      const data = await res.json() as DeepSeekBalanceResult;
      setBalance(data);
    } catch (e) {
      setBalance({
        provider: provider.id,
        configured: provider.configured,
        success: false,
        isAvailable: null,
        balanceInfos: [],
        error: e instanceof Error ? e.message : String(e),
        queriedAt: Date.now(),
      });
    } finally {
      setBalanceLoading(false);
    }
  }, [provider.id, provider.configured]);

  useEffect(() => {
    if (provider.id === "deepseek" && provider.configured) {
      void loadDeepSeekBalance();
    }
  }, [provider.id, provider.configured, loadDeepSeekBalance]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    setSavedOk(false);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: apiKey.trim() }),
      });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) {
        setError(d.error ?? `HTTP ${res.status}`);
      } else {
        setApiKey("");
        setBalance(null);
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [apiKey, provider.id, onRefresh]);

  const handleRemove = useCallback(async () => {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/api-key/${encodeURIComponent(provider.id)}`, { method: "DELETE" });
      const d = await res.json() as { success?: boolean; error?: string };
      if (!res.ok || d.error) setError(d.error ?? `HTTP ${res.status}`);
      else {
        setBalance(null);
        onRefresh();
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setRemoving(false);
    }
  }, [provider.id, onRefresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <SectionTitle>API Key</SectionTitle>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: provider.configured ? "#4ade80" : "var(--border)", display: "inline-block" }} />
          <span style={{ fontSize: 11, color: provider.configured ? "#4ade80" : "var(--text-dim)" }}>
            {provider.configured ? "已配置" : "未配置"}
          </span>
        </div>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {provider.configured
          ? `API Key 已保存。在下方输入新密钥可替换，或断开连接以移除。`
          : `输入你的 ${provider.displayName} API Key，以启用 ${provider.modelCount} 个模型。`}
      </p>

      <Field label="API Key">
        <div style={{ display: "flex", gap: 6 }}>
          <SecretTextInput
            value={apiKey}
            onChange={setApiKey}
            onKeyDown={(e) => { if (e.key === "Enter" && apiKey.trim()) handleSave(); }}
            placeholder={provider.configured ? "输入新密钥以替换…" : "sk-…"}
            style={{ flex: 1 }}
            autoComplete="off"
            spellCheck={false}
            mono
          />
          <button
            onClick={handleSave}
            disabled={saving || !apiKey.trim() || savedOk}
            style={{
              padding: "6px 12px",
              background: savedOk ? "#16a34a" : apiKey.trim() ? "var(--accent)" : "var(--bg-panel)",
              border: "none", borderRadius: 5,
              color: (apiKey.trim() || savedOk) ? "#fff" : "var(--text-dim)",
              cursor: (saving || !apiKey.trim() || savedOk) ? "not-allowed" : "pointer",
              fontSize: 12, fontWeight: 600, flexShrink: 0,
              display: "flex", alignItems: "center", gap: 5,
            }}
          >
            {savedOk && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            {savedOk ? "已保存" : saving ? "保存中…" : "保存"}
          </button>
        </div>
      </Field>

      {error && <p style={{ margin: 0, fontSize: 12, color: "#f87171" }}>{error}</p>}

      {provider.id === "deepseek" && provider.configured && (
        <DeepSeekBalanceView balance={balance} loading={balanceLoading} onRefresh={loadDeepSeekBalance} />
      )}

      {provider.configured && (
        <button
          onClick={handleRemove}
          disabled={removing}
          style={{
            alignSelf: "flex-start", padding: "5px 12px",
            background: "none", border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 5, color: "#ef4444",
            cursor: removing ? "not-allowed" : "pointer", fontSize: 12,
          }}
        >
          {removing ? "断开中…" : "断开连接"}
        </button>
      )}
    </div>
  );
}

// ── Provider icon ─────────────────────────────────────────────────────────────

function ProviderIcon({ id, size }: { id: string; size: number }) {
  const pi = PROVIDER_ICONS[id];
  if (!pi) {
    const label = id
      .split(/[-_]/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?";
    return (
      <span
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          border: "1px solid var(--border)",
          borderRadius: 4,
          color: "var(--text-dim)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: Math.max(8, Math.floor(size * 0.42)),
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        {label}
      </span>
    );
  }
  // Color icons: self-colored SVG, no wrapper needed
  if (pi.hasColor) return <pi.Icon size={size} />;
  // Mono icons: use currentColor so they adapt to light/dark theme
  return <pi.Icon size={size} style={{ color: "var(--text-muted)" }} />;
}

// ── Add provider picker ───────────────────────────────────────────────────────

interface AddProviderPickerProps {
  oauthProviders: OAuthProvider[];
  apiKeyProviders: ApiKeyProvider[];
  onSelectOAuth: (id: string) => void;
  onSelectApiKey: (id: string) => void;
  onAddCustom: () => void;
  onClose: () => void;
}

function AddProviderPicker({
  oauthProviders, apiKeyProviders,
  onSelectOAuth, onSelectApiKey, onAddCustom, onClose,
}: AddProviderPickerProps) {
  const [search, setSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 30); }, []);

  const q = search.trim().toLowerCase();

  const availableOAuth = oauthProviders.filter((p) => !p.loggedIn && (!q || p.name.toLowerCase().includes(q)));
  const availableApiKey = apiKeyProviders.filter((p) => !p.configured && (!q || p.displayName.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)));
  const showCustom = !q || "custom".includes(q) || "openai-compatible".includes(q) || "anthropic-compatible".includes(q);

  const totalCount = availableOAuth.length + availableApiKey.length + (showCustom ? 1 : 0);

  const cardStyle: React.CSSProperties = {
    display: "flex", flexDirection: "row", alignItems: "center", gap: 8,
    padding: "10px 12px",
    background: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: 7,
    boxSizing: "border-box",
    cursor: "pointer",
    minWidth: 0,
    textAlign: "left",
    transition: "border-color 0.12s, background 0.12s",
    width: "100%",
  };



  return (
    <div
      className="pi-modal-overlay"
      style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="pi-modal-panel" style={{ width: 820, maxWidth: "calc(100vw - 32px)", maxHeight: "min(72vh, calc(100vh - 32px))", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.22)", overflow: "hidden" }}>
        {/* Search */}
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
            placeholder="搜索提供商…"
            style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--text)", fontSize: 13, boxSizing: "border-box" }}
          />
        </div>

        {/* Card grid */}
        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {totalCount === 0 ? (
            <div style={{ padding: "20px 0", fontSize: 12, color: "var(--text-dim)", textAlign: "center" }}>没有匹配的提供商</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
              {showCustom && (
                <div style={{ gridColumn: "1 / -1", fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>自定义</div>
              )}
              {showCustom && (
                <button
                  onClick={() => { onAddCustom(); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>OpenAI / Anthropic 兼容</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>自定义端点格式</div>
                  </div>
                  <span style={{ width: 26, height: 26, borderRadius: 5, background: "var(--bg-hover)", border: "1px dashed var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)" }}>
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                  </span>
                </button>
              )}

              {availableOAuth.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: showCustom ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>订阅</div>
              )}
              {availableOAuth.map((p) => (
                <button key={p.id} onClick={() => { onSelectOAuth(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>OAuth</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

              {availableApiKey.length > 0 && (
                <div style={{ gridColumn: "1 / -1", paddingTop: availableOAuth.length > 0 ? 6 : 0, fontSize: 10, fontWeight: 600, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>API Key</div>
              )}
              {availableApiKey.map((p) => (
                <button key={p.id} onClick={() => { onSelectApiKey(p.id); onClose(); }}
                  style={cardStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-panel)"; }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</div>
                    <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{p.modelCount} 个模型</div>
                  </div>
                  <ProviderIcon id={p.id} size={28} />
                </button>
              ))}

            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

// ── Deep equality helper for dirty detection ─────────────────────────

function jsonStableEqual(a: unknown, b: unknown): boolean {
  // Fast path: same reference or both primitively equal
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (typeof a !== "object") return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (!jsonStableEqual(aObj[aKeys[i]], bObj[bKeys[i]])) return false;
  }
  return true;
}

export function ModelsConfig({
  onClose,
  initialProviderId,
  initialAccountId,
  onConsumedFocus,
}: {
  onClose: () => void;
  /** Top-bar deep-link focus: provider id to auto-select. */
  initialProviderId?: string | null;
  /** Top-bar deep-link focus: account id within the provider to auto-select. */
  initialAccountId?: string | null;
  /** Called after the focus context has been consumed. */
  onConsumedFocus?: () => void;
}) {
  const [config, setConfig] = useState<ModelsJson>({ providers: {} });
  const [persistedConfig, setPersistedConfig] = useState<ModelsJson>({ providers: {} });
  const [configRevision, setConfigRevision] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [oauthProviders, setOauthProviders] = useState<OAuthProvider[]>([]);
  const [apiKeyProviders, setApiKeyProviders] = useState<ApiKeyProvider[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  // ── Sync state ──
  const [syncState, setSyncState] = useState<SyncPhase>({ phase: "idle" });
  const [syncStateMap, setSyncStateMap] = useState<SyncSelectionState>(new Map());
  // Cache last preview response to survive re-renders
  const syncPreviewRef = useRef<ModelsConfigSyncPreviewResponse | null>(null);

  const dirty = useMemo(() => !jsonStableEqual(config, persistedConfig), [config, persistedConfig]);

  const loadOAuthProviders = useCallback(() => {
    fetch("/api/auth/providers")
      .then((r) => r.json())
      .then((d: { providers: OAuthProvider[] }) => setOauthProviders(d.providers))
      .catch(() => {});
  }, []);

  const loadApiKeyProviders = useCallback(() => {
    fetch("/api/auth/all-providers")
      .then((r) => r.json())
      .then((d: { providers: ApiKeyProvider[] }) => setApiKeyProviders(d.providers))
      .catch(() => {});
  }, []);

  // Reload full config from server (used after sync apply)
  const reloadConfigFromServer = useCallback(() => {
    fetch("/api/models-config")
      .then((r) => {
        const rev = r.headers.get("X-Models-Config-Revision") ?? r.headers.get("ETag")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? null;
        return r.json().then((d: ModelsJson) => ({ data: d, revision: rev }));
      })
      .then(({ data: d, revision: rev }) => {
        const normalized: ModelsJson = d.providers ? d : { ...(d as Record<string, unknown>), providers: {} as Record<string, ProviderEntry> };
        setConfig(normalized);
        setPersistedConfig(normalized);
        if (rev) setConfigRevision(rev);
        const keys = Object.keys(normalized.providers ?? {});
        if (keys.length > 0) setSelection({ type: "provider", name: keys[0] });
      })
      .catch(() => { setConfig({ providers: {} }); setPersistedConfig({ providers: {} }); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reloadConfigFromServer();
    loadOAuthProviders();
    loadApiKeyProviders();
  }, [loadOAuthProviders, loadApiKeyProviders, reloadConfigFromServer]);

  // Consume top-bar deep-link focus context: auto-select provider when oauthProviders are loaded.
  // We save initialAccountId in a ref before calling onConsumedFocus() so that the parent clearing
  // the prop does not race with OAuthDetail mounting and consuming the target account.
  const deepLinkAccountIdRef = useRef<string | null>(null);
  const initialFocusConsumedRef = useRef(false);
  useEffect(() => {
    if (!initialProviderId || oauthProviders.length === 0 || initialFocusConsumedRef.current) return;
    const target = oauthProviders.find((p) => p.id === initialProviderId);
    if (!target) return;
    // Capture accountId in a local ref before the parent clears it via onConsumedFocus.
    if (initialAccountId) {
      deepLinkAccountIdRef.current = initialAccountId;
    }
    // For OAuth providers, select the OAuth detail view.
    setSelection({ type: "oauth", providerId: target.id });
    initialFocusConsumedRef.current = true;
    onConsumedFocus?.();
  }, [initialProviderId, initialAccountId, oauthProviders, onConsumedFocus]);

  // Called by OAuthDetail after it successfully auto-selects the target account.
  const handleOAuthAccountFocusConsumed = useCallback(() => {
    deepLinkAccountIdRef.current = null;
  }, []);

  const addCustomProvider = useCallback(() => {
    let finalName = "new-provider";
    let n = 1;
    while (config.providers?.[finalName]) finalName = `new-provider-${n++}`;
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [finalName]: { api: "openai-completions" } } }));
    setSelection({ type: "provider", name: finalName });
  }, [config.providers]);

  const updateProvider = useCallback((name: string, p: ProviderEntry) => {
    setConfig((prev) => ({ ...prev, providers: { ...(prev.providers ?? {}), [name]: p } }));
  }, []);

  const renameProvider = useCallback((oldName: string, newName: string) => {
    setConfig((prev) => {
      const entries = Object.entries(prev.providers ?? {});
      const idx = entries.findIndex(([k]) => k === oldName);
      if (idx === -1) return prev;
      entries[idx] = [newName, entries[idx][1]];
      return { ...prev, providers: Object.fromEntries(entries) };
    });
    setSelection((prev) => {
      if (!prev) return prev;
      if (prev.type === "provider" && prev.name === oldName) return { type: "provider", name: newName };
      if (prev.type === "model" && prev.providerName === oldName) return { ...prev, providerName: newName };
      return prev;
    });
  }, []);

  const deleteProvider = useCallback((name: string) => {
    setConfig((prev) => {
      const providers = { ...(prev.providers ?? {}) };
      delete providers[name];
      return { ...prev, providers };
    });
    setConfig((prev) => {
      const remaining = Object.keys(prev.providers ?? {});
      setSelection(remaining.length > 0 ? { type: "provider", name: remaining[0] } : null);
      return prev;
    });
  }, []);

  const addModel = useCallback((providerName: string) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? []), { id: "" }];
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
    setConfig((prev) => {
      const idx = (prev.providers?.[providerName]?.models?.length ?? 1) - 1;
      setSelection({ type: "model", providerName, index: idx });
      return prev;
    });
  }, []);

  const updateModel = useCallback((providerName: string, index: number, m: ModelEntry) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models[index] = m;
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models } } };
    });
  }, []);

  const removeModel = useCallback((providerName: string, index: number) => {
    setConfig((prev) => {
      const provider = prev.providers?.[providerName] ?? {};
      const models = [...(provider.models ?? [])];
      models.splice(index, 1);
      return { ...prev, providers: { ...(prev.providers ?? {}), [providerName]: { ...provider, models: models.length ? models : undefined } } };
    });
    setSelection({ type: "provider", name: providerName });
  }, []);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveError(null);
    setSavedOk(false);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (configRevision) headers["If-Match"] = `"${configRevision}"`;
      const res = await fetch("/api/models-config", {
        method: "PUT",
        headers,
        body: JSON.stringify(config),
      });
      const rev = res.headers.get("X-Models-Config-Revision") ?? res.headers.get("ETag")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? null;
      const d = await res.json() as { success?: boolean; error?: string; revision?: string; code?: string };
      if (!res.ok || d.error) {
        if (d.code === "stale_revision") {
          setSaveError("配置已被其他操作修改，请重新载入后再保存。");
        } else {
          setSaveError(d.error ?? `HTTP ${res.status}`);
        }
      } else {
        setSavedOk(true);
        setTimeout(() => setSavedOk(false), 2000);
        setPersistedConfig(config);
        if (rev ?? d.revision) setConfigRevision(rev ?? d.revision ?? null);
      }
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }, [config, configRevision]);

  // ── Model sync handlers ──

  const handleSyncPreview = useCallback(async (providerId: string) => {
    setSyncState({ phase: "previewing" });
    try {
      const res = await fetch("/api/models-config/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", providerId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { code?: ModelsSyncErrorCode } };
        setSyncState({ phase: "error", code: d.error?.code ?? "invalid_response" });
        return;
      }
      const data = await res.json() as ModelsConfigSyncPreviewResponse;
      syncPreviewRef.current = data;
      // Default select all new
      const nextMap = new Map<string, boolean>();
      for (const row of data.models) {
        if (row.status === "new") nextMap.set(row.id, true);
      }
      setSyncStateMap(nextMap);
      setSyncState({ phase: "preview", data, search: "" });
    } catch {
      setSyncState({ phase: "error", code: "network_error" });
    }
  }, []);

  const handleSyncApply = useCallback(async () => {
    const preview = syncPreviewRef.current;
    if (!preview) return;
    const selected = [...syncStateMap.entries()].filter(([, v]) => v).map(([k]) => k);
    if (selected.length === 0 || selected.length > MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS) return;
    setSyncState({ phase: "applying", data: preview, selectedIds: selected });
    try {
      const res = await fetch("/api/models-config/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          providerId: preview.providerId,
          previewId: preview.previewId,
          revision: preview.revision,
          modelIds: selected,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { code?: ModelsSyncErrorCode } };
        setSyncState({ phase: "error", code: d.error?.code ?? "write_failed" });
        return;
      }
      const result = await res.json() as { addedIds?: string[]; skippedExistingIds?: string[]; providerId?: string };
      // Reload config from server to get fresh revision
      const reloadRes = await fetch("/api/models-config");
      const rev = reloadRes.headers.get("X-Models-Config-Revision") ?? reloadRes.headers.get("ETag")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? null;
      const reloadData = await reloadRes.json() as ModelsJson;
      const normalized: ModelsJson = reloadData.providers ? reloadData : { ...(reloadData as Record<string, unknown>), providers: {} as Record<string, ProviderEntry> };
      setConfig(normalized);
      setPersistedConfig(normalized);
      if (rev) setConfigRevision(rev);
      syncPreviewRef.current = null;
      setSyncState({
        phase: "success",
        data: {
          added: result.addedIds ?? [],
          skipped: result.skippedExistingIds ?? [],
          providerId: result.providerId ?? preview.providerId,
        },
      });
    } catch {
      setSyncState({ phase: "error", code: "network_error" });
    }
  }, [syncStateMap]);

  const handleSyncApplyAll = useCallback(async () => {
    const preview = syncPreviewRef.current;
    if (!preview) return;
    const allNew = preview.models.filter((m) => m.status === "new").map((m) => m.id);
    if (allNew.length === 0 || allNew.length > MODELS_CONFIG_SYNC_APPLY_MAX_MODEL_IDS) return;
    // Select all and apply
    const nextMap = new Map<string, boolean>();
    for (const id of allNew) nextMap.set(id, true);
    setSyncStateMap(nextMap);
    // Use a small delay so state settles, then apply
    setSyncState({ phase: "applying", data: preview, selectedIds: allNew });
    try {
      const res = await fetch("/api/models-config/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          providerId: preview.providerId,
          previewId: preview.previewId,
          revision: preview.revision,
          modelIds: allNew,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { code?: ModelsSyncErrorCode } };
        setSyncState({ phase: "error", code: d.error?.code ?? "write_failed" });
        return;
      }
      const result = await res.json() as { addedIds?: string[]; skippedExistingIds?: string[]; providerId?: string };
      const reloadRes = await fetch("/api/models-config");
      const rev = reloadRes.headers.get("X-Models-Config-Revision") ?? reloadRes.headers.get("ETag")?.replace(/^W\//, "").replace(/^"|"$/g, "") ?? null;
      const reloadData = await reloadRes.json() as ModelsJson;
      const normalized: ModelsJson = reloadData.providers ? reloadData : { ...(reloadData as Record<string, unknown>), providers: {} as Record<string, ProviderEntry> };
      setConfig(normalized);
      setPersistedConfig(normalized);
      if (rev) setConfigRevision(rev);
      syncPreviewRef.current = null;
      setSyncState({
        phase: "success",
        data: {
          added: result.addedIds ?? [],
          skipped: result.skippedExistingIds ?? [],
          providerId: result.providerId ?? preview.providerId,
        },
      });
    } catch {
      setSyncState({ phase: "error", code: "network_error" });
    }
  }, []);

  const handleSyncClose = useCallback(() => {
    if (syncState.phase === "applying") return;
    setSyncState({ phase: "idle" });
    syncPreviewRef.current = null;
    setSyncStateMap(new Map());
  }, [syncState.phase]);

  const handleSyncDismiss = useCallback(() => {
    setSyncState({ phase: "idle" });
    syncPreviewRef.current = null;
    setSyncStateMap(new Map());
  }, []);

  const handleSyncToggle = useCallback((modelId: string) => {
    setSyncStateMap((prev) => {
      const next = new Map(prev);
      next.set(modelId, !next.get(modelId));
      return next;
    });
  }, []);

  const handleSyncSelectAllNew = useCallback(() => {
    setSyncStateMap((prev) => {
      const next = new Map(prev);
      for (const [k] of next) next.set(k, true);
      return next;
    });
  }, []);

  const handleSyncClearSelection = useCallback(() => {
    setSyncStateMap((prev) => {
      const next = new Map(prev);
      for (const [k] of next) next.set(k, false);
      return next;
    });
  }, []);

  const handleSyncSearchChange = useCallback((q: string) => {
    setSyncState((prev) => {
      if (prev.phase !== "preview") return prev;
      return { ...prev, search: q };
    });
  }, []);

  const providers = Object.entries(config.providers ?? {});
  const activeOAuth = oauthProviders.filter((p) => p.loggedIn || (p.authMode === "managed_accounts" && (p.accountCount ?? 0) > 0));
  // A ModelRuntime OAuth credential also makes `/api/auth/all-providers` report
  // `configured`. Show that provider in its OAuth section only; a logged-out
  // OAuth provider with a separately configured API key remains visible here.
  const activeOAuthIds = new Set(activeOAuth.map((p) => p.id));
  const activeApiKey = apiKeyProviders.filter(
    (p) => p.configured && !activeOAuthIds.has(p.id),
  );

  // Resolve current detail
  const detailContent = (() => {
    if (!selection) return null;
    if (selection.type === "oauth") {
      const p = oauthProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      return <OAuthDetail key={p.id} provider={p} onRefresh={loadOAuthProviders} initialAccountId={deepLinkAccountIdRef.current} onInitialAccountConsumed={handleOAuthAccountFocusConsumed} />;
    }
    if (selection.type === "apikey") {
      const p = apiKeyProviders.find((p) => p.id === selection.providerId);
      if (!p) return null;
      if (p.authMode === "managed_accounts") {
        return <ApiKeyAccountsDetail key={p.id} provider={p} onRefresh={loadApiKeyProviders} />;
      }
      return <ApiKeyDetail key={p.id} provider={p} onRefresh={loadApiKeyProviders} />;
    }
    if (selection.type === "provider") {
      const provider = config.providers?.[selection.name];
      if (!provider) return null;
      // Determine if this provider is a custom (non-builtin, non-fixed) provider
      const knownPiProviderIds = new Set([
        ...Object.keys(PROVIDER_ICONS),
        ...FIXED_EXTENSION_PROVIDER_IDS,
      ]);
      const isCustomDistinct = !knownPiProviderIds.has(selection.name);
      return (
        <ProviderDetail
          key={selection.name}
          name={selection.name}
          provider={provider}
          onChange={(p) => updateProvider(selection.name, p)}
          onRename={(n) => renameProvider(selection.name, n)}
          onDelete={() => deleteProvider(selection.name)}
          dirty={dirty}
          isCustomDistinct={isCustomDistinct}
          onSyncPreview={() => handleSyncPreview(selection.name)}
        />
      );
    }
    const provider = config.providers?.[selection.providerName];
    const model = provider?.models?.[selection.index];
    if (!model) return null;
    return (
      <ModelDetail
        key={`${selection.providerName}-${selection.index}`}
        providerName={selection.providerName}
        provider={provider}
        model={model}
        onChange={(m) => updateModel(selection.providerName, selection.index, m)}
        onDelete={() => removeModel(selection.providerName, selection.index)}
      />
    );
  })();

  return (
    <>
    <div className="pi-modal-overlay" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pi-modal-panel pi-modal-panel-large" style={{ width: 860, height: "78vh", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, display: "flex", flexDirection: "column", boxShadow: "0 8px 32px rgba(0,0,0,0.18)", overflow: "hidden" }}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>模型</span>
            <code style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>~/.pi/agent/models.json</code>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 20, lineHeight: 1, padding: "2px 6px" }}>×</button>
        </div>

        {/* Body */}
        <div className="pi-modal-split-body" style={{ flex: 1, display: "flex", overflow: "hidden" }}>

          {/* Left: tree */}
          <div style={{ width: 210, borderRight: "1px solid var(--border)", display: "flex", flexDirection: "column", flexShrink: 0, background: "var(--bg-panel)" }}>
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 6px" }}>
              {/* Active OAuth subscriptions */}
              {activeOAuth.map((p) => {
                const isSelected = selection?.type === "oauth" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "oauth", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                  </div>
                );
              })}

              {/* Active API key providers */}
              {activeApiKey.map((p) => {
                const isSelected = selection?.type === "apikey" && selection.providerId === p.id;
                return (
                  <div
                    key={p.id}
                    onClick={() => setSelection({ type: "apikey", providerId: p.id })}
                    style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 8px", borderRadius: 5, cursor: "pointer", background: isSelected ? "var(--bg-selected)" : "none" }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = "none"; }}
                  >
                    <ProviderIcon id={p.id} size={16} />
                    <span style={{ fontSize: 12, color: "var(--text)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.displayName}</span>
                  </div>
                );
              })}

              {/* Divider before custom providers, only when there are active managed providers */}
              {(activeOAuth.length > 0 || activeApiKey.length > 0) && providers.length > 0 && (
                <div style={{ margin: "4px 8px", borderTop: "1px solid var(--border)" }} />
              )}

              {/* Custom providers */}
              {loading ? (
                <div style={{ padding: "10px 8px", fontSize: 12, color: "var(--text-muted)" }}>加载中…</div>
              ) : providers.map(([pName, pData]) => {
                const isProviderSelected = selection?.type === "provider" && selection.name === pName;
                const models = pData.models ?? [];
                return (
                  <div key={pName} style={{ marginBottom: 2 }}>
                    {/* Provider row */}
                    <div
                      onClick={() => setSelection({ type: "provider", name: pName })}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 5, cursor: "pointer", background: isProviderSelected ? "var(--bg-selected)" : "none" }}
                      onMouseEnter={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { if (!isProviderSelected) e.currentTarget.style.background = "none"; }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "var(--text-dim)", flexShrink: 0 }}>
                        <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
                        <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                        <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                        <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                        <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                      </svg>
                      <span style={{ fontSize: 12, fontWeight: isProviderSelected ? 600 : 400, color: "var(--text)", fontFamily: "var(--font-mono)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {pName}
                      </span>
                    </div>

                    {/* Model rows */}
                    {models.map((m, i) => {
                      const isModelSelected = selection?.type === "model" && selection.providerName === pName && selection.index === i;
                      return (
                        <div
                          key={i}
                          onClick={() => setSelection({ type: "model", providerName: pName, index: i })}
                          style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 8px 5px 26px", borderRadius: 5, cursor: "pointer", background: isModelSelected ? "var(--bg-selected)" : "none" }}
                          onMouseEnter={(e) => { if (!isModelSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isModelSelected) e.currentTarget.style.background = "none"; }}
                        >
                          <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: m.id ? "var(--text-muted)" : "var(--text-dim)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {m.id || "新模型"}
                          </span>
                          {m.reasoning && (
                            <span style={{ fontSize: 9, padding: "1px 4px", background: "rgba(99,102,241,0.12)", color: "rgba(99,102,241,0.8)", borderRadius: 3, flexShrink: 0 }}>T</span>
                          )}
                        </div>
                      );
                    })}

                    {/* Add model button */}
                    <div
                      onClick={(e) => { e.stopPropagation(); addModel(pName); }}
                      style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 8px 4px 26px", borderRadius: 5, cursor: "pointer", color: "var(--text-dim)" }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = "var(--accent)"; e.currentTarget.style.background = "var(--bg-hover)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = "var(--text-dim)"; e.currentTarget.style.background = "none"; }}
                    >
                      <span style={{ fontSize: 11 }}>+ 模型</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Add provider */}
            <div style={{ borderTop: "1px solid var(--border)", padding: "8px 6px" }}>
              <button onClick={() => setPickerOpen(true)} style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
                width: "100%", padding: "6px 0", background: "none", border: "1px dashed var(--border)", borderRadius: 5,
                color: "var(--text-muted)", cursor: "pointer", fontSize: 12,
              }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.color = "var(--accent)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.color = "var(--text-muted)"; }}
              >
                + 添加提供商
              </button>
            </div>
          </div>

          {/* Right: detail */}
          <div style={{ flex: 1, overflowY: "auto", padding: 20 }}>
            {loading ? null : detailContent ?? (
              <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 13 }}>
                请选择提供商或模型
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 10, padding: "10px 18px", borderTop: "1px solid var(--border)", flexShrink: 0 }}>
          {dirty && <span style={{ fontSize: 11, color: "var(--warning)", marginRight: "auto" }}>● 有未保存更改</span>}
          {saveError && <span style={{ fontSize: 12, color: "#f87171", flex: 1 }}>{saveError}</span>}
          <button onClick={onClose} style={{ padding: "6px 14px", background: "none", border: "1px solid var(--border)", borderRadius: 6, color: "var(--text-muted)", cursor: "pointer", fontSize: 13 }}>
            取消
          </button>
          <button onClick={handleSave} disabled={saving || savedOk} style={{
            position: "relative",
            padding: "6px 16px",
            minWidth: 92,
            background: savedOk ? "#16a34a" : saving ? "var(--bg-panel)" : "var(--accent)",
            border: "none", borderRadius: 6,
            color: savedOk ? "#fff" : saving ? "var(--text-muted)" : "#fff",
            cursor: (saving || savedOk) ? "default" : "pointer", fontSize: 13, fontWeight: 600,
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
            transition: "background-color 0.2s ease, color 0.2s ease",
            animation: savedOk ? "saved-pop 0.45s ease" : undefined,
          }}>
            {savedOk && (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                style={{ strokeDasharray: 18, animation: "saved-check-draw 0.35s ease forwards", flexShrink: 0 }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
            <span>{savedOk ? "已保存" : saving ? "保存中…" : "保存"}</span>
          </button>
        </div>
      </div>
    </div>
    {pickerOpen && (
      <AddProviderPicker
        oauthProviders={oauthProviders}
        apiKeyProviders={apiKeyProviders}
        onSelectOAuth={(id) => setSelection({ type: "oauth", providerId: id })}
        onSelectApiKey={(id) => setSelection({ type: "apikey", providerId: id })}
        onAddCustom={addCustomProvider}
        onClose={() => setPickerOpen(false)}
      />
    )}

    {/* ── Model sync preview modal ── */}
    {syncState.phase !== "idle" && (() => {
      const providerId = (() => {
        if (syncState.phase === "preview" || syncState.phase === "applying") return syncState.data.providerId;
        if (syncState.phase === "success") return syncState.data.providerId;
        return "";
      })();
      return (
        <ModelsSyncPreviewModal
          providerId={providerId}
          providerName={selection?.type === "provider" ? selection.name : providerId}
          syncState={syncState}
          selectedNew={syncStateMap}
          onToggle={handleSyncToggle}
          onSelectAllNew={handleSyncSelectAllNew}
          onClearSelection={handleSyncClearSelection}
          onSearchChange={handleSyncSearchChange}
          onPreview={() => {
            const id = selection?.type === "provider" ? selection.name : providerId;
            if (id) handleSyncPreview(id);
          }}
          onApply={handleSyncApply}
          onApplyAll={handleSyncApplyAll}
          onClose={handleSyncClose}
          onDismiss={handleSyncDismiss}
        />
      );
    })()}
    </>
  );
}
