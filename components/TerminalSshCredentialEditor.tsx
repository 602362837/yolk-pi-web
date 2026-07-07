"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TerminalCredentialSummary, TerminalCredentialType } from "@/lib/terminal-ssh-types";

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

const credentialTypes: { value: TerminalCredentialType; label: string }[] = [
  { value: "agent", label: "ssh-agent / OpenSSH default" },
  { value: "identityFile", label: "Identity file path" },
  { value: "privateKey", label: "Imported private key" },
  { value: "password", label: "SSH password" },
  { value: "proxyAuth", label: "Proxy auth" },
];

interface CredentialFormState {
  id?: string;
  label: string;
  type: TerminalCredentialType;
  username: string;
  identityFilePath: string;
  privateKeyPem: string;
  passphrase: string;
  password: string;
  proxyUsername: string;
  proxyPassword: string;
  fingerprint: string;
}

const emptyForm: CredentialFormState = {
  label: "",
  type: "agent",
  username: "",
  identityFilePath: "",
  privateKeyPem: "",
  passphrase: "",
  password: "",
  proxyUsername: "",
  proxyPassword: "",
  fingerprint: "",
};

function textInput(value: string, onChange: (value: string) => void, placeholder?: string, multiline = false) {
  if (multiline) {
    return <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} rows={4} style={{ ...inputStyle, resize: "vertical", fontFamily: "var(--font-mono)", lineHeight: 1.45 }} />;
  }
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} spellCheck={false} style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />;
}

function SecretBadge({ present, label }: { present: boolean; label: string }) {
  return (
    <span style={{ padding: "2px 6px", borderRadius: 999, background: present ? "rgba(34,197,94,0.14)" : "var(--bg)", color: present ? "#22c55e" : "var(--text-dim)", border: "1px solid var(--border)", fontSize: 10, fontWeight: 700 }}>
      {label}: {present ? "yes" : "no"}
    </span>
  );
}

export function TerminalSshCredentialEditor({ onCredentialsChange }: { onCredentialsChange?: (credentials: TerminalCredentialSummary[]) => void }) {
  const [credentials, setCredentials] = useState<TerminalCredentialSummary[]>([]);
  const [form, setForm] = useState<CredentialFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replaceSecret, setReplaceSecret] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [deleteBlock, setDeleteBlock] = useState<{ id: string; references: string[] } | null>(null);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/terminal/ssh/credentials");
      const data = await response.json() as { credentials?: TerminalCredentialSummary[]; error?: string } | TerminalCredentialSummary[];
      if (!response.ok || (typeof data === "object" && !Array.isArray(data) && data.error)) throw new Error(Array.isArray(data) ? `HTTP ${response.status}` : data.error ?? `HTTP ${response.status}`);
      const next = Array.isArray(data) ? data : data.credentials ?? [];
      setCredentials(next);
      onCredentialsChange?.(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [onCredentialsChange]);

  useEffect(() => { void loadCredentials(); }, [loadCredentials]);

  const selectedSummary = useMemo(() => credentials.find((credential) => credential.id === editingId) ?? null, [credentials, editingId]);

  const startEdit = (credential: TerminalCredentialSummary) => {
    setEditingId(credential.id);
    setReplaceSecret(false);
    setForm({
      id: credential.id,
      label: credential.label,
      type: credential.type,
      username: credential.username ?? "",
      identityFilePath: credential.identityFilePath ?? "",
      privateKeyPem: "",
      passphrase: "",
      password: "",
      proxyUsername: credential.proxyUsername ?? "",
      proxyPassword: "",
      fingerprint: credential.fingerprint ?? "",
    });
    setNotice("Secret 输入框不会回填；需要替换时请开启 Replace secret。 ");
    setError(null);
  };

  const resetForm = () => {
    setEditingId(null);
    setReplaceSecret(false);
    setForm(emptyForm);
    setDeleteBlock(null);
    setError(null);
  };

  const submitCredential = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        label: form.label,
        type: form.type,
        username: form.username || undefined,
        identityFilePath: form.identityFilePath || undefined,
        proxyUsername: form.proxyUsername || undefined,
        fingerprint: form.fingerprint || undefined,
      };
      if (!editingId || replaceSecret) {
        body.privateKeyPem = form.privateKeyPem || undefined;
        body.passphrase = form.passphrase || undefined;
        body.password = form.password || undefined;
        body.proxyPassword = form.proxyPassword || undefined;
      }
      const response = await fetch(editingId ? `/api/terminal/ssh/credentials/${encodeURIComponent(editingId)}` : "/api/terminal/ssh/credentials", {
        method: editingId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      resetForm();
      await loadCredentials();
      setNotice("Credential 已保存；secret 不会在 UI/API 中回显。 ");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteCredential = async (credential: TerminalCredentialSummary) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    setDeleteBlock(null);
    try {
      const response = await fetch(`/api/terminal/ssh/credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" });
      const data = await response.json() as { error?: string; references?: string[] };
      if (response.status === 409) {
        setDeleteBlock({ id: credential.id, references: data.references ?? credential.usedByProfileIds });
        return;
      }
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      await loadCredentials();
      setNotice("Credential 已删除。 ");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const secretFieldsVisible = !editingId || replaceSecret;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>SSH Credentials</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>密码、私钥和代理密码进入独立 vault；列表只展示脱敏 summary。</div>
        </div>
        <button type="button" onClick={() => void loadCredentials()} disabled={loading || saving} style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: loading || saving ? "not-allowed" : "pointer", fontSize: 12 }}>{loading ? "加载中…" : "刷新"}</button>
      </div>
      {error && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11, overflowWrap: "anywhere" }}>{error}</div>}
      {notice && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 11 }}>{notice}</div>}
      {deleteBlock && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(245,158,11,0.14)", color: "#f59e0b", fontSize: 11 }}>Credential {deleteBlock.id} 正被 profile 引用，已阻止删除：{deleteBlock.references.join(", ") || "unknown"}</div>}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {credentials.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{loading ? "正在读取 credentials…" : "尚无 credential。"}</div> : credentials.map((credential) => (
          <div key={credential.id} style={{ padding: 10, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column", gap: 7 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>{credential.label} <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>({credential.type})</span></div>
                <div style={{ color: "var(--text-dim)", fontSize: 11, overflowWrap: "anywhere" }}>{credential.username ? `${credential.username} · ` : credential.proxyUsername ? `${credential.proxyUsername} · ` : ""}{credential.identityFilePath ?? credential.fingerprint ?? credential.id}</div>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => startEdit(credential)} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "var(--text)", cursor: "pointer", fontSize: 11 }}>编辑</button>
                <button type="button" onClick={() => void deleteCredential(credential)} disabled={saving} style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "#f87171", cursor: saving ? "not-allowed" : "pointer", fontSize: 11 }}>删除</button>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <SecretBadge present={credential.hasPrivateKey} label="key" />
              <SecretBadge present={credential.hasPassword} label="password" />
              <SecretBadge present={credential.hasPassphrase} label="passphrase" />
              <SecretBadge present={credential.hasProxyPassword} label="proxy password" />
              {credential.usedByProfileIds.length > 0 && <span style={{ color: "var(--text-dim)", fontSize: 10 }}>used by {credential.usedByProfileIds.length} profile(s)</span>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
        <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 800 }}>{editingId ? `编辑 ${selectedSummary?.label ?? editingId}` : "新增 credential"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {textInput(form.label, (label) => setForm((prev) => ({ ...prev, label })), "Label")}
          <select value={form.type} onChange={(event) => setForm((prev) => ({ ...prev, type: event.target.value as TerminalCredentialType }))} disabled={!!editingId} style={inputStyle}>{credentialTypes.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select>
          {textInput(form.username, (username) => setForm((prev) => ({ ...prev, username })), "Default username")}
          {textInput(form.identityFilePath, (identityFilePath) => setForm((prev) => ({ ...prev, identityFilePath })), "/Users/me/.ssh/id_ed25519")}
        </div>
        {editingId && <label style={{ display: "flex", gap: 7, alignItems: "center", color: "var(--text-muted)", fontSize: 11 }}><input type="checkbox" checked={replaceSecret} onChange={(event) => setReplaceSecret(event.target.checked)} /> Replace secret（不勾选则保留原 secret，输入框保持空白）</label>}
        {secretFieldsVisible && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {textInput(form.privateKeyPem, (privateKeyPem) => setForm((prev) => ({ ...prev, privateKeyPem })), "Private key PEM（不会回显）", true)}
            {textInput(form.password, (password) => setForm((prev) => ({ ...prev, password })), "SSH password（不会回显）")}
            {textInput(form.passphrase, (passphrase) => setForm((prev) => ({ ...prev, passphrase })), "Key passphrase（不会回显）")}
            {textInput(form.proxyPassword, (proxyPassword) => setForm((prev) => ({ ...prev, proxyPassword })), "Proxy password（不会回显）")}
            {textInput(form.proxyUsername, (proxyUsername) => setForm((prev) => ({ ...prev, proxyUsername })), "Proxy username")}
            {textInput(form.fingerprint, (fingerprint) => setForm((prev) => ({ ...prev, fingerprint })), "Fingerprint summary")}
          </div>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" onClick={() => void submitCredential()} disabled={saving || !form.label.trim()} style={{ padding: "7px 10px", borderRadius: 7, border: "none", background: !saving && form.label.trim() ? "var(--accent)" : "var(--border)", color: "white", cursor: !saving && form.label.trim() ? "pointer" : "not-allowed", fontSize: 12, fontWeight: 700 }}>{saving ? "保存中…" : editingId ? "保存 credential" : "创建 credential"}</button>
          {editingId && <button type="button" onClick={resetForm} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>取消编辑</button>}
        </div>
      </div>
    </div>
  );
}
