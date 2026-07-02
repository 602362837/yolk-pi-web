"use client";

import { useCallback, useEffect, useState } from "react";
import type { SessionChangedFileSummary, SessionFileDiffResponse } from "@/lib/types";
import { DiffModal } from "./DiffModal";

interface Props {
  sessionId: string;
  file: SessionChangedFileSummary;
  onClose: () => void;
}

function statusLabel(status: SessionChangedFileSummary["status"]): string {
  switch (status) {
    case "added": return "Added";
    case "deleted": return "Deleted";
    case "metadata-only": return "Metadata only";
    case "modified":
    default:
      return "Modified";
  }
}

function reasonLabel(reason: SessionFileDiffResponse["reason"]): string {
  switch (reason) {
    case "binary": return "Binary file changes cannot be rendered as text.";
    case "too-large": return "This file is too large to render a safe inline diff.";
    case "outside-workspace": return "This file is outside the current workspace.";
    case "unreadable": return "The file could not be read safely.";
    case "unchanged": return "No cumulative text diff is currently available.";
    default: return "No text diff is available for this change.";
  }
}

export function FileDiffModal({ sessionId, file, onClose }: Props) {
  const [data, setData] = useState<SessionFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/changes/file?path=${encodeURIComponent(file.path)}`);
      const body = await res.json() as SessionFileDiffResponse | { error?: string };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setData(body as SessionFileDiffResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [file.path, sessionId]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const display = data ?? file;
  const diff = data?.diffAvailable && data.diff ? data.diff : undefined;

  return (
    <DiffModal
      ariaLabel={`Diff for ${file.path}`}
      loading={loading}
      error={error}
      diff={diff}
      fallback={reasonLabel(data?.reason ?? file.reason)}
      onClose={onClose}
      overlayStyle={{
        position: "absolute",
        inset: 0,
        zIndex: 220,
        alignItems: "center",
        padding: 24,
        background: "rgba(0,0,0,0.28)",
        borderRadius: 0,
      }}
      panelStyle={{
        width: "min(1180px, 96vw)",
        height: "auto",
        maxHeight: "min(760px, 90vh)",
        boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
      }}
      header={(
        <>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file.path}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
            <span>{statusLabel(display.status)}</span>
            <span style={{ color: "#16a34a" }}>+{display.additions}</span>
            <span style={{ color: "#dc2626" }}>-{display.deletions}</span>
            <span>via {display.toolNames.join(", ")}</span>
          </div>
        </>
      )}
    />
  );
}
