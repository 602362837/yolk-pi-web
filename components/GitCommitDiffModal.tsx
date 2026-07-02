"use client";

import { useCallback, useEffect, useState } from "react";
import type { GitCommitChangedFile, GitCommitFileDiffResponse } from "@/lib/types";
import { DiffModal } from "./DiffModal";

interface Props {
  cwd: string;
  hash: string;
  shortHash?: string;
  file: GitCommitChangedFile;
  onClose: () => void;
}

function statusLabel(status: GitCommitChangedFile["status"]): string {
  switch (status) {
    case "A": return "Added";
    case "D": return "Deleted";
    case "R": return "Renamed";
    case "C": return "Copied";
    case "T": return "Type changed";
    case "U": return "Unmerged";
    case "M": return "Modified";
    default: return "Changed";
  }
}

function reasonLabel(reason: GitCommitFileDiffResponse["reason"]): string {
  switch (reason) {
    case "binary": return "Binary file changes cannot be rendered as text.";
    case "too-large": return "This diff is too large to render safely in the browser.";
    case "unavailable":
    default:
      return "No text diff is available for this file in the selected commit.";
  }
}

export function GitCommitDiffModal({ cwd, hash, shortHash, file, onClose }: Props) {
  const [data, setData] = useState<GitCommitFileDiffResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ cwd, hash, path: file.file });
      if (file.oldFile) params.set("oldPath", file.oldFile);
      const res = await fetch(`/api/git/diff?${params.toString()}`);
      const body = await res.json() as GitCommitFileDiffResponse | { error?: string };
      if (!res.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      setData(body as GitCommitFileDiffResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd, file.file, file.oldFile, hash]);

  useEffect(() => {
    void loadDiff();
  }, [loadDiff]);

  const displayPath = file.oldFile ? `${file.oldFile} → ${file.file}` : file.file;
  const diff = data?.diffAvailable && data.diff ? data.diff : undefined;

  return (
    <DiffModal
      ariaLabel={`Diff for ${file.file}`}
      loading={loading}
      error={error}
      diff={diff}
      fallback={reasonLabel(data?.reason)}
      onClose={onClose}
      header={(
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)", flexShrink: 0 }}>
              {shortHash ?? hash.slice(0, 8)}
            </span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {displayPath}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4, fontSize: 12, color: "var(--text-muted)" }}>
            <span>{statusLabel(file.status)}</span>
            {typeof file.additions === "number" && <span style={{ color: "#16a34a" }}>+{file.additions}</span>}
            {typeof file.deletions === "number" && <span style={{ color: "#dc2626" }}>-{file.deletions}</span>}
            {file.binary && <span>binary</span>}
          </div>
        </>
      )}
    />
  );
}
