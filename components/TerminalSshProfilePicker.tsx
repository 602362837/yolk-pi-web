"use client";

import { useEffect, useMemo, useState } from "react";
import type { PiWebTerminalSshConfig, TerminalSshProfile } from "@/lib/terminal-ssh-types";

interface WebConfigResponse {
  config?: {
    terminal?: {
      ssh?: PiWebTerminalSshConfig;
    };
  };
  error?: string;
}

interface TerminalSshProfilePickerProps {
  open: boolean;
  onClose: () => void;
  onOpenProfile: (profile: TerminalSshProfile) => void;
}

function endpointLabel(profile: TerminalSshProfile): string {
  const user = profile.target.username ? `${profile.target.username}@` : "";
  return `${user}${profile.target.host}:${profile.target.port}`;
}

function profileWarnings(profile: TerminalSshProfile, ssh: PiWebTerminalSshConfig): { blocking: string[]; warnings: string[] } {
  const blocking: string[] = [];
  const warnings: string[] = [];
  if (!ssh.enabled) blocking.push("SSH terminal is disabled in Settings.");
  if (!profile.enabled) blocking.push("Profile is disabled.");
  if (!profile.target.host.trim()) blocking.push("Target host is missing.");
  if (!Number.isInteger(profile.target.port) || profile.target.port <= 0) blocking.push("Target port is invalid.");
  if (profile.proxy?.type === "custom") {
    if (!ssh.allowCustomProxyCommand) blocking.push("Custom ProxyCommand is disabled globally.");
    if (!profile.proxy.acknowledgedRisk) blocking.push("Custom ProxyCommand risk has not been acknowledged.");
    warnings.push("Custom ProxyCommand runs on this machine.");
  }
  if (profile.jumpHosts.length > 0) warnings.push(`${profile.jumpHosts.length} jump host${profile.jumpHosts.length === 1 ? "" : "s"}.`);
  if (profile.target.credentialId) warnings.push("Uses saved credential reference.");
  return { blocking, warnings };
}

export function TerminalSshProfilePicker({ open, onClose, onOpenProfile }: TerminalSshProfilePickerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ssh, setSsh] = useState<PiWebTerminalSshConfig | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetch("/api/web-config")
      .then(async (response) => {
        const data = await response.json() as WebConfigResponse;
        if (!response.ok || data.error) throw new Error(data.error ?? `HTTP ${response.status}`);
        const nextSsh = data.config?.terminal?.ssh;
        if (!nextSsh) throw new Error("Terminal SSH config is unavailable.");
        if (!cancelled) setSsh(nextSsh);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const profiles = useMemo(() => {
    const all = ssh?.profiles ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return all;
    return all.filter((profile) => {
      const haystack = [profile.label, profile.target.host, profile.target.username, endpointLabel(profile)].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [query, ssh?.profiles]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Open SSH profile"
      style={{
        position: "absolute",
        top: 34,
        left: 214,
        width: 360,
        maxWidth: "calc(100vw - 24px)",
        zIndex: 700,
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--bg-panel)",
        boxShadow: "0 18px 40px rgba(0,0,0,0.32)",
        padding: 10,
        color: "var(--text)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Open SSH profile</strong>
        <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}>×</button>
      </div>
      <input
        autoFocus
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search profile, host, user..."
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", color: "var(--text)", padding: "6px 8px", fontSize: 12, marginBottom: 8 }}
      />
      {loading && <div style={{ fontSize: 12, color: "var(--text-muted)", padding: 8 }}>Loading profiles...</div>}
      {error && <div style={{ fontSize: 12, color: "#f87171", padding: 8, overflowWrap: "anywhere" }}>{error}</div>}
      {!loading && !error && ssh && profiles.length === 0 && <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 8 }}>No SSH profiles match.</div>}
      {!loading && !error && ssh && profiles.map((profile) => {
        const { blocking, warnings } = profileWarnings(profile, ssh);
        const disabled = blocking.length > 0;
        const proxyLabel = profile.proxy && profile.proxy.type !== "none" ? profile.proxy.type : "no proxy";
        return (
          <button
            key={profile.id}
            type="button"
            disabled={disabled}
            onClick={() => {
              onOpenProfile(profile);
              onClose();
            }}
            title={[endpointLabel(profile), ...blocking, ...warnings].join("\n")}
            style={{
              width: "100%",
              textAlign: "left",
              border: "1px solid var(--border)",
              borderRadius: 8,
              background: disabled ? "var(--bg-subtle)" : "var(--bg)",
              color: disabled ? "var(--text-dim)" : "var(--text)",
              cursor: disabled ? "not-allowed" : "pointer",
              padding: 8,
              marginBottom: 6,
              opacity: disabled ? 0.72 : 1,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span style={{ fontSize: 12, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{profile.label}</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>{proxyLabel}</span>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 3 }}>{endpointLabel(profile)}</div>
            {(blocking.length > 0 || warnings.length > 0) && (
              <div style={{ fontSize: 11, color: blocking.length > 0 ? "#f87171" : "#fbbf24", marginTop: 4, overflowWrap: "anywhere" }}>
                {[...blocking, ...warnings].join(" · ")}
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
