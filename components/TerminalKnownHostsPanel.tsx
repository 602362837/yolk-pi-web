"use client";

import { useCallback, useEffect, useState } from "react";

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

interface KnownHostEntry {
  index: number;
  host: string;
  port: number | null;
  hosts: string[];
  keyType: string;
  fingerprint: string;
  comment?: string;
  hashed: boolean;
}

interface ScannedEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  publicKey: string;
  comment?: string;
}

export function TerminalKnownHostsPanel() {
  const [entries, setEntries] = useState<KnownHostEntry[]>([]);
  const [host, setHost] = useState("");
  const [port, setPort] = useState(22);
  const [scanEntries, setScanEntries] = useState<ScannedEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/terminal/ssh/known-hosts");
      const data = await response.json() as { entries?: KnownHostEntry[]; error?: string } | KnownHostEntry[];
      if (!response.ok || (typeof data === "object" && !Array.isArray(data) && data.error)) throw new Error(Array.isArray(data) ? `HTTP ${response.status}` : data.error ?? `HTTP ${response.status}`);
      setEntries(Array.isArray(data) ? data : data.entries ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadEntries(); }, [loadEntries]);

  const scan = async () => {
    setScanLoading(true);
    setError(null);
    setNotice(null);
    setScanEntries([]);
    try {
      const response = await fetch("/api/terminal/ssh/known-hosts/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host, port }),
      });
      const data = await response.json() as { ok?: boolean; entries?: ScannedEntry[]; warning?: string; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setScanEntries(data.entries ?? []);
      setNotice(data.warning ?? "扫描完成。ssh-keyscan 结果只用于展示，请从可信渠道核对 fingerprint 后再信任。 ");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanLoading(false);
    }
  };

  const trust = async (entry: ScannedEntry) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/terminal/ssh/known-hosts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      const data = await response.json() as { entries?: KnownHostEntry[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setNotice("Host key 已写入 dedicated known_hosts。 ");
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const remove = async (entry: KnownHostEntry) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/terminal/ssh/known-hosts", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ index: entry.index }),
      });
      const data = await response.json() as { entries?: KnownHostEntry[]; error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
      setNotice("Known host 已删除。 ");
      await loadEntries();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12, borderRadius: 10, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
        <div>
          <div style={{ color: "var(--text)", fontSize: 13, fontWeight: 800 }}>Known Hosts</div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3, lineHeight: 1.45 }}>Web Terminal SSH 使用独立 known_hosts：~/.pi/agent/terminal/known_hosts。扫描结果不等于可信认证。</div>
        </div>
        <button type="button" onClick={() => void loadEntries()} disabled={loading} style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: loading ? "not-allowed" : "pointer", fontSize: 12 }}>{loading ? "加载中…" : "刷新"}</button>
      </div>
      {error && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 11, overflowWrap: "anywhere" }}>{error}</div>}
      {notice && <div style={{ padding: "7px 9px", borderRadius: 7, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 11, overflowWrap: "anywhere" }}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 90px max-content", gap: 8, alignItems: "center" }}>
        <input value={host} onChange={(event) => setHost(event.target.value.trim())} placeholder="host.example.com" style={{ ...inputStyle, fontFamily: "var(--font-mono)" }} />
        <input type="number" min={1} max={65535} value={port} onChange={(event) => setPort(Number.parseInt(event.target.value || "22", 10))} style={inputStyle} />
        <button type="button" onClick={() => void scan()} disabled={!host || scanLoading} style={{ padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: host && !scanLoading ? "var(--bg)" : "var(--border)", color: host && !scanLoading ? "var(--text)" : "var(--text-dim)", cursor: host && !scanLoading ? "pointer" : "not-allowed", fontSize: 12 }}>{scanLoading ? "扫描中…" : "Scan fingerprint"}</button>
      </div>

      {scanEntries.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {scanEntries.map((entry) => (
            <div key={`${entry.keyType}-${entry.fingerprint}`} style={{ display: "grid", gridTemplateColumns: "1fr max-content", gap: 8, alignItems: "center", padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{entry.keyType}</div>
                <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{entry.fingerprint}</div>
              </div>
              <button type="button" onClick={() => void trust(entry)} disabled={loading} style={{ padding: "6px 9px", borderRadius: 7, border: "none", background: "var(--accent)", color: "white", cursor: loading ? "not-allowed" : "pointer", fontSize: 12 }}>Trust</button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {entries.length === 0 ? <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{loading ? "正在读取 known_hosts…" : "尚无 trusted host key。"}</div> : entries.map((entry) => (
          <div key={entry.index} style={{ display: "grid", gridTemplateColumns: "1fr max-content", gap: 8, alignItems: "center", padding: 9, borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg)" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{entry.host}{entry.port ? `:${entry.port}` : ""} <span style={{ color: "var(--text-dim)", fontWeight: 600 }}>{entry.keyType}</span></div>
              <div style={{ color: "var(--text-dim)", fontSize: 11, fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>{entry.fingerprint}</div>
              {entry.hashed && <div style={{ color: "#f59e0b", fontSize: 10 }}>hashed known_hosts entry；只能按 index 删除。</div>}
            </div>
            <button type="button" onClick={() => void remove(entry)} disabled={loading} style={{ padding: "6px 9px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg-subtle)", color: "#f87171", cursor: loading ? "not-allowed" : "pointer", fontSize: 12 }}>删除</button>
          </div>
        ))}
      </div>
    </div>
  );
}
