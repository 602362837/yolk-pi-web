"use client";

import { useMemo, useState } from "react";
import type { PiWebTerminalSshConfig, TerminalCredentialSummary, TerminalSshEndpoint, TerminalSshKnownHostsPolicy, TerminalSshProfile, TerminalSshProxyConfig } from "@/lib/terminal-ssh-types";

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

function createId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyEndpoint(): TerminalSshEndpoint {
  return { host: "", port: 22, username: "", credentialId: "" };
}

function emptyProfile(policy: TerminalSshKnownHostsPolicy): TerminalSshProfile {
  const now = new Date().toISOString();
  return {
    id: createId("ssh-profile"),
    label: "",
    enabled: true,
    target: emptyEndpoint(),
    jumpHosts: [],
    proxy: { type: "none" },
    options: { knownHostsPolicy: policy, forwardAgent: false, requestTty: true },
    createdAt: now,
    updatedAt: now,
  };
}

function credentialLabel(credentials: TerminalCredentialSummary[], credentialId?: string): string {
  if (!credentialId) return "未选择";
  return credentials.find((credential) => credential.id === credentialId)?.label ?? `missing: ${credentialId}`;
}

function endpointSummary(endpoint: TerminalSshEndpoint): string {
  const user = endpoint.username ? `${endpoint.username}@` : "";
  return endpoint.host ? `${user}${endpoint.host}:${endpoint.port || 22}` : "未填写 host";
}

function containsControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function profileWarnings(profile: TerminalSshProfile, config: PiWebTerminalSshConfig, credentials: TerminalCredentialSummary[]): string[] {
  const warnings: string[] = [];
  if (!profile.enabled) warnings.push("profile 已禁用");
  if (!profile.target.host.trim()) warnings.push("target host 缺失");
  if (!Number.isInteger(profile.target.port) || profile.target.port < 1 || profile.target.port > 65535) warnings.push("target port 无效");
  const credentialIds = [profile.target.credentialId, ...profile.jumpHosts.map((jump) => jump.credentialId), profile.proxy?.type === "socks5" || profile.proxy?.type === "http" ? profile.proxy.credentialId : undefined].filter(Boolean) as string[];
  for (const credentialId of credentialIds) {
    if (!credentials.some((credential) => credential.id === credentialId)) warnings.push(`credential 缺失：${credentialId}`);
  }
  if (profile.proxy?.type === "custom") {
    if (!config.allowCustomProxyCommand) warnings.push("全局未允许 custom ProxyCommand");
    if (!profile.proxy.acknowledgedRisk) warnings.push("custom ProxyCommand 未确认风险");
    if (/\{\{\s*secret:/i.test(profile.proxy.commandTemplate)) warnings.push("custom ProxyCommand 包含 secret placeholder");
    if (containsControl(profile.proxy.commandTemplate)) warnings.push("custom ProxyCommand 包含控制字符/换行");
  }
  if (profile.options?.forwardAgent) warnings.push("已开启 agent forwarding，请确认远端可信");
  return Array.from(new Set(warnings));
}

function EndpointEditor({ label, value, credentials, onChange, onRemove }: { label: string; value: TerminalSshEndpoint; credentials: TerminalCredentialSummary[]; onChange: (next: TerminalSshEndpoint) => void; onRemove?: () => void }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 1fr 1fr max-content", gap: 8, alignItems: "center" }}>
      <input value={value.host} onChange={(event) => onChange({ ...value, host: event.target.value.trim() })} placeholder={`${label} host`} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
      <input type="number" min={1} max={65535} value={value.port || 22} onChange={(event) => onChange({ ...value, port: Number.parseInt(event.target.value || "22", 10) })} style={inputStyle} />
      <input value={value.username ?? ""} onChange={(event) => onChange({ ...value, username: event.target.value.trim() })} placeholder="username" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
      <select value={value.credentialId ?? ""} onChange={(event) => onChange({ ...value, credentialId: event.target.value || undefined })} style={inputStyle}>
        <option value="">Credential: default/agent</option>
        {credentials.map((credential) => <option key={credential.id} value={credential.id}>{credential.label} ({credential.type})</option>)}
      </select>
      {onRemove ? <button type="button" onClick={onRemove} style={{ padding: "7px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "#f87171", cursor: "pointer", fontSize: 12 }}>删除</button> : <span />}
    </div>
  );
}

export function TerminalSshProfileEditor({ ssh, credentials, onChange }: { ssh: PiWebTerminalSshConfig; credentials: TerminalCredentialSummary[]; onChange: (next: PiWebTerminalSshConfig) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TerminalSshProfile | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const profiles = ssh.profiles;
  const selected = useMemo(() => profiles.find((profile) => profile.id === editingId) ?? null, [editingId, profiles]);
  const current = draft ?? selected;

  const startEdit = (profile: TerminalSshProfile) => {
    setEditingId(profile.id);
    setDraft(JSON.parse(JSON.stringify(profile)) as TerminalSshProfile);
    setTestResult(null);
  };

  const startCreate = () => {
    const profile = emptyProfile(ssh.defaultKnownHostsPolicy);
    setEditingId(profile.id);
    setDraft(profile);
    setTestResult(null);
  };

  const saveDraft = () => {
    if (!draft) return;
    const now = new Date().toISOString();
    const nextProfile = { ...draft, label: draft.label.trim() || endpointSummary(draft.target), updatedAt: now };
    const exists = profiles.some((profile) => profile.id === nextProfile.id);
    onChange({ ...ssh, profiles: exists ? profiles.map((profile) => profile.id === nextProfile.id ? nextProfile : profile) : [...profiles, { ...nextProfile, createdAt: nextProfile.createdAt || now }] });
    setEditingId(null);
    setDraft(null);
  };

  const deleteProfile = (profileId: string) => {
    onChange({ ...ssh, profiles: profiles.filter((profile) => profile.id !== profileId) });
    if (editingId === profileId) {
      setEditingId(null);
      setDraft(null);
    }
  };

  const duplicateProfile = (profile: TerminalSshProfile) => {
    const now = new Date().toISOString();
    onChange({ ...ssh, profiles: [...profiles, { ...JSON.parse(JSON.stringify(profile)) as TerminalSshProfile, id: createId("ssh-profile"), label: `${profile.label} copy`, createdAt: now, updatedAt: now }] });
  };

  const updateDraft = (patch: Partial<TerminalSshProfile>) => setDraft((prev) => prev ? { ...prev, ...patch } : prev);
  const updateOptions = (patch: NonNullable<TerminalSshProfile["options"]>) => setDraft((prev) => prev ? { ...prev, options: { ...prev.options, ...patch } } : prev);

  const runTest = async (mode: "validate" | "resolve") => {
    if (!current) return;
    setTestLoading(true);
    setTestResult(null);
    try {
      const response = await fetch(`/api/terminal/ssh/profiles/${encodeURIComponent(current.id)}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setTestResult(JSON.stringify(data, null, 2));
    } catch (err) {
      setTestResult(err instanceof Error ? err.message : String(err));
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>SSH Profiles</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>Profile 是非 secret 配置，会随 Terminal 设置保存到 pi-web.json；credential 只保存引用 id。</div>
        </div>
        <button type="button" onClick={startCreate} style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 12 }}>新增 Profile</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {profiles.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>尚无 SSH profile。</div> : profiles.map((profile) => {
          const warnings = profileWarnings(profile, ssh, credentials);
          return (
            <div key={profile.id} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>{profile.label || endpointSummary(profile.target)} {!profile.enabled && <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>disabled</span>}</div>
                  <div style={{ color: "var(--text-dim)", fontSize: 11, overflowWrap: "anywhere" }}>{endpointSummary(profile.target)} · cred {credentialLabel(credentials, profile.target.credentialId)} · jumps {profile.jumpHosts.length} · proxy {profile.proxy?.type ?? "none"}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" onClick={() => startEdit(profile)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}>编辑</button>
                  <button type="button" onClick={() => duplicateProfile(profile)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>复制</button>
                  <button type="button" onClick={() => deleteProfile(profile.id)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "#f87171", cursor: "pointer", fontSize: 11 }}>删除</button>
                </div>
              </div>
              {warnings.length > 0 && <div style={{ color: "#f59e0b", fontSize: 11 }}>Warning: {warnings.join("；")}</div>}
            </div>
          );
        })}
      </div>

      {current && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
          <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>{selected ? "编辑 Profile" : "新增 Profile"}</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 150px", gap: 8 }}>
            <input value={current.label} onChange={(event) => updateDraft({ label: event.target.value })} placeholder="Profile label" style={inputStyle} />
            <label style={{ display: "flex", gap: 7, alignItems: "center", color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={current.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} /> Enabled</label>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>Target</div>
          <EndpointEditor label="target" value={current.target} credentials={credentials} onChange={(target) => updateDraft({ target })} />

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>Jump chain（按顺序 ProxyJump）</div>
            <button type="button" onClick={() => updateDraft({ jumpHosts: [...current.jumpHosts, { ...emptyEndpoint(), id: createId("jump") }] })} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}>添加 Jump</button>
          </div>
          {current.jumpHosts.map((jump, index) => (
            <EndpointEditor key={jump.id ?? index} label={`jump ${index + 1}`} value={jump} credentials={credentials} onChange={(next) => updateDraft({ jumpHosts: current.jumpHosts.map((item, itemIndex) => itemIndex === index ? next : item) })} onRemove={() => updateDraft({ jumpHosts: current.jumpHosts.filter((_, itemIndex) => itemIndex !== index) })} />
          ))}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <select value={current.options?.knownHostsPolicy ?? ssh.defaultKnownHostsPolicy} onChange={(event) => updateOptions({ knownHostsPolicy: event.target.value as TerminalSshKnownHostsPolicy })} style={inputStyle}>
              <option value="ask">known_hosts: ask/manual trust</option>
              <option value="strict">known_hosts: strict</option>
              <option value="accept-new">known_hosts: accept-new</option>
            </select>
            <input type="number" min={1} value={current.options?.connectTimeoutSeconds ?? ""} onChange={(event) => updateOptions({ connectTimeoutSeconds: event.target.value ? Number.parseInt(event.target.value, 10) : undefined })} placeholder="Connect timeout seconds" style={inputStyle} />
            <input type="number" min={0} value={current.options?.serverAliveIntervalSeconds ?? ""} onChange={(event) => updateOptions({ serverAliveIntervalSeconds: event.target.value ? Number.parseInt(event.target.value, 10) : undefined })} placeholder="ServerAliveInterval" style={inputStyle} />
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            <label style={{ display: "flex", gap: 7, alignItems: "center", color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={!!current.options?.forwardAgent} onChange={(event) => updateOptions({ forwardAgent: event.target.checked })} /> ForwardAgent（高风险）</label>
            <label style={{ display: "flex", gap: 7, alignItems: "center", color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={current.options?.requestTty !== false} onChange={(event) => updateOptions({ requestTty: event.target.checked })} /> Request TTY</label>
          </div>

          <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 700 }}>Proxy</div>
          <div style={{ display: "grid", gridTemplateColumns: "150px 1fr 80px 1fr", gap: 8 }}>
            <select value={current.proxy?.type ?? "none"} onChange={(event) => {
              const type = event.target.value as TerminalSshProxyConfig["type"];
              updateDraft({ proxy: type === "none" ? { type } : type === "custom" ? { type, commandTemplate: "", acknowledgedRisk: false } : { type, host: "", port: type === "socks5" ? 1080 : 8080 } });
            }} style={inputStyle}>
              <option value="none">none</option>
              <option value="socks5">SOCKS5</option>
              <option value="http">HTTP CONNECT</option>
              <option value="custom">Custom ProxyCommand</option>
            </select>
            {(current.proxy?.type === "socks5" || current.proxy?.type === "http") ? <input value={current.proxy.host} onChange={(event) => updateDraft({ proxy: { ...current.proxy as Extract<TerminalSshProxyConfig, { type: "socks5" | "http" }>, host: event.target.value.trim() } })} placeholder="proxy host" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} /> : <span />}
            {(current.proxy?.type === "socks5" || current.proxy?.type === "http") ? <input type="number" min={1} max={65535} value={current.proxy.port} onChange={(event) => updateDraft({ proxy: { ...current.proxy as Extract<TerminalSshProxyConfig, { type: "socks5" | "http" }>, port: Number.parseInt(event.target.value || "0", 10) } })} style={inputStyle} /> : <span />}
            {(current.proxy?.type === "socks5" || current.proxy?.type === "http") ? <select value={current.proxy.credentialId ?? ""} onChange={(event) => updateDraft({ proxy: { ...current.proxy as Extract<TerminalSshProxyConfig, { type: "socks5" | "http" }>, credentialId: event.target.value || undefined } })} style={inputStyle}><option value="">No proxy auth</option>{credentials.filter((credential) => credential.type === "proxyAuth").map((credential) => <option key={credential.id} value={credential.id}>{credential.label}</option>)}</select> : <span />}
          </div>
          {current.proxy?.type === "custom" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
              <textarea value={current.proxy.commandTemplate} onChange={(event) => updateDraft({ proxy: { ...current.proxy as Extract<TerminalSshProxyConfig, { type: "custom" }>, commandTemplate: event.target.value } })} placeholder="/usr/bin/nc -X 5 -x 127.0.0.1:1080 %h %p" rows={3} spellCheck={false} style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)" }} />
              <label style={{ display: "flex", gap: 7, alignItems: "center", color: "#f59e0b", fontSize: 11 }}><input type="checkbox" checked={current.proxy.acknowledgedRisk} onChange={(event) => updateDraft({ proxy: { ...current.proxy as Extract<TerminalSshProxyConfig, { type: "custom" }>, acknowledgedRisk: event.target.checked } })} /> 我理解此命令会在运行 ypi 的本机执行，且不得包含 secret 占位符。</label>
            </div>
          )}

          {profileWarnings(current, ssh, credentials).length > 0 && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(245,158,11,0.14)", color: "#f59e0b", fontSize: 11 }}>Warning: {profileWarnings(current, ssh, credentials).join("；")}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={saveDraft} style={{ padding: "7px 10px", borderRadius: 7, border: "none", background: "var(--accent)", color: "white", cursor: "pointer", fontSize: 12, fontWeight: 700 }}>保存到设置表单</button>
            <button type="button" onClick={() => { setEditingId(null); setDraft(null); }} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>取消</button>
            <button type="button" onClick={() => void runTest("validate")} disabled={testLoading || !selected} title={selected ? "调用 profile test validate API" : "先保存 profile 后再测试"} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: selected ? "var(--text)" : "var(--text-dim)", cursor: selected && !testLoading ? "pointer" : "not-allowed", fontSize: 12 }}>{testLoading ? "测试中…" : "Validate"}</button>
            <button type="button" onClick={() => void runTest("resolve")} disabled={testLoading || !selected} title={selected ? "调用 profile test resolve API" : "先保存 profile 后再测试"} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: selected ? "var(--text)" : "var(--text-dim)", cursor: selected && !testLoading ? "pointer" : "not-allowed", fontSize: 12 }}>Resolve</button>
          </div>
          {testResult && <pre style={{ margin: 0, maxHeight: 180, overflow: "auto", padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", fontSize: 11, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{testResult}</pre>}
        </div>
      )}
    </div>
  );
}
