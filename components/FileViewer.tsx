"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import { useTheme } from "@/hooks/useTheme";
import { encodeFilePathForApi, getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { markdownPreviewRehypePlugins, markdownPreviewRemarkPlugins } from "@/lib/markdown";
import type { PiWebEditorConfig } from "@/lib/pi-web-config";
import type { MonacoFileEditorProps } from "./MonacoFileEditor";
import { ActionFlowIcon } from "./ActionFlowIcon";
import { iconFlowAttrs } from "./iconFlow";
import { usePrompt } from "./AppPromptProvider";

const MonacoFileEditor = dynamic<MonacoFileEditorProps>(
  () => import("./MonacoFileEditor").then((mod) => mod.MonacoFileEditor),
  {
    ssr: false,
    loading: () => (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
        Loading editor…
      </div>
    ),
  },
);

interface Props {
  filePath: string;
  cwd?: string;
  initialLine?: number;
  editorConfig?: PiWebEditorConfig;
  onAddChat?: (filePath: string, selection?: { startLine: number; endLine: number }) => void;
  onOpenFile?: (filePath: string, fileName: string, line?: number) => void;
}

interface FileData {
  content: string;
  language: string;
  size: number;
  mtimeMs?: number;
}

interface SaveFileResponse {
  ok?: boolean;
  size?: number;
  mtimeMs?: number;
  language?: string;
  error?: string;
}

interface ImplementationResult {
  filePath: string;
  relativePath: string;
  line: number;
  column?: number;
  kind: "implements" | "extends" | "method" | "reference" | "definition" | "interface" | "class";
  preview: string;
}

interface SymbolClickInfo {
  symbol: string;
  lineText: string;
  lineNumber: number;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "webm"]);
const DOCUMENT_PREVIEW_EXTS = new Set(["pdf", "docx"]);
const DOCX_PREVIEW_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_EDITOR_CONFIG: PiWebEditorConfig = {
  kind: "monaco",
  shortcuts: {
    saveFile: true,
    addSelectionToChat: true,
    findReferences: true,
    findJavaImplementations: true,
    cmdClickDrillDown: true,
    shiftClickHierarchy: true,
  },
};

function isImagePath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return IMAGE_EXTS.has(ext);
}

function isAudioPath(filePath: string): boolean {
  const base = getFileName(filePath);
  const ext = base.toLowerCase().split(".").pop() ?? "";
  return AUDIO_EXTS.has(ext);
}

function getFileExt(filePath: string): string {
  return getFileName(filePath).toLowerCase().split(".").pop() ?? "";
}

function isDocumentPreviewPath(filePath: string): boolean {
  return DOCUMENT_PREVIEW_EXTS.has(getFileExt(filePath));
}

function DownloadLink({ filePath, label = "Download" }: { filePath: string; label?: string }) {
  const encoded = encodeFilePathForApi(filePath);
  return (
    <a
      href={`/api/files/${encoded}?type=read`}
      download={getFileName(filePath)}
      style={{
        color: "var(--text-muted)",
        textDecoration: "none",
        border: "1px solid var(--border)",
        borderRadius: 5,
        padding: "2px 8px",
        fontSize: 11,
        lineHeight: 1.4,
        background: "var(--bg-hover)",
        flexShrink: 0,
      }}
    >
      {label}
    </a>
  );
}

type DiffLine =
  | { type: "unchanged"; text: string; lineNo: number }
  | { type: "removed"; text: string; lineNo: number }
  | { type: "added"; text: string; lineNo: number };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Myers diff — returns line-level unified diff
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const m = oldLines.length;
  const n = newLines.length;
  const max = m + n;
  const v: number[] = new Array(2 * max + 1).fill(0);
  const trace: number[][] = [];

  for (let d = 0; d <= max; d++) {
    trace.push([...v]);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max] < v[k + 1 + max])) {
        x = v[k + 1 + max];
      } else {
        x = v[k - 1 + max] + 1;
      }
      let y = x - k;
      while (x < m && y < n && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= m && y >= n) {
        // backtrack
        const result: DiffLine[] = [];
        let cx = m, cy = n;
        for (let dd = d; dd > 0; dd--) {
          const pv = trace[dd - 1];
          const pk = cx - cy;
          let prevK: number;
          if (pk === -dd || (pk !== dd && pv[pk - 1 + max] < pv[pk + 1 + max])) {
            prevK = pk + 1;
          } else {
            prevK = pk - 1;
          }
          const prevX = pv[prevK + max];
          const prevY = prevX - prevK;
          while (cx > prevX && cy > prevY) {
            cx--;
            cy--;
            result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
          }
          if (dd > 0) {
            if (cx > prevX) {
              cx--;
              result.unshift({ type: "removed", text: oldLines[cx], lineNo: cx + 1 });
            } else {
              cy--;
              result.unshift({ type: "added", text: newLines[cy], lineNo: cy + 1 });
            }
          }
        }
        while (cx > 0 && cy > 0) {
          cx--;
          cy--;
          result.unshift({ type: "unchanged", text: oldLines[cx], lineNo: cx + 1 });
        }
        return result;
      }
    }
  }
  // Fallback: treat all as replaced
  return [
    ...oldLines.map((t, i) => ({ type: "removed" as const, text: t, lineNo: i + 1 })),
    ...newLines.map((t, i) => ({ type: "added" as const, text: t, lineNo: i + 1 })),
  ];
}

function DiffView({ oldContent, newContent }: { oldContent: string; newContent: string; language: string }) {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const diff = diffLines(oldLines, newLines);

  const hasChanges = diff.some((l) => l.type !== "unchanged");
  if (!hasChanges) {
    return (
      <div style={{ padding: "12px 16px", fontSize: 12, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        No changes
      </div>
    );
  }

  // Render with context: show 3 lines around each change, collapse the rest
  const CONTEXT = 3;
  const changed = new Set(diff.flatMap((l, i) => (l.type !== "unchanged" ? [i] : [])));
  const visible = new Set<number>();
  for (const ci of changed) {
    for (let j = Math.max(0, ci - CONTEXT); j <= Math.min(diff.length - 1, ci + CONTEXT); j++) {
      visible.add(j);
    }
  }

  const segments: Array<{ hidden: true; count: number } | { hidden: false; lines: DiffLine[] }> = [];
  let i = 0;
  while (i < diff.length) {
    if (visible.has(i)) {
      const block: DiffLine[] = [];
      while (i < diff.length && visible.has(i)) {
        block.push(diff[i]);
        i++;
      }
      segments.push({ hidden: false, lines: block });
    } else {
      let count = 0;
      while (i < diff.length && !visible.has(i)) {
        count++;
        i++;
      }
      segments.push({ hidden: true, count });
    }
  }

  // Track running line number for added/unchanged lines
  const newLineNos: number[] = [];
  let nlo = 1;
  for (const line of diff) {
    if (line.type === "removed") {
      newLineNos.push(0);
    } else {
      newLineNos.push(nlo++);
    }
  }

  let diffIdx = 0;

  return (
    <div style={{ fontFamily: "var(--font-mono)", fontSize: 13, lineHeight: 1.6 }}>
      {segments.map((seg, si) => {
        if (seg.hidden) {
          const result = (
            <div
              key={si}
              style={{
                padding: "2px 16px",
                color: "var(--text-dim)",
                background: "var(--bg-panel)",
                fontSize: 11,
                borderTop: "1px solid var(--border)",
                borderBottom: "1px solid var(--border)",
              }}
            >
              ... {seg.count} unchanged lines ...
            </div>
          );
          diffIdx += seg.count;
          return result;
        }
        const lines = seg.lines.map((line, li) => {
          const idx = diffIdx + li;
          const newLno = newLineNos[idx];
          const bg =
            line.type === "added"
              ? "rgba(0,200,80,0.12)"
              : line.type === "removed"
              ? "rgba(240,60,60,0.14)"
              : "transparent";
          const prefix =
            line.type === "added" ? "+" : line.type === "removed" ? "-" : " ";
          const prefixColor =
            line.type === "added" ? "#4ade80" : line.type === "removed" ? "#f87171" : "var(--text-dim)";

          return (
            <div
              key={li}
              style={{
                display: "flex",
                background: bg,
                borderLeft: line.type === "added"
                  ? "3px solid #4ade80"
                  : line.type === "removed"
                  ? "3px solid #f87171"
                  : "3px solid transparent",
              }}
            >
              <span
                style={{
                  minWidth: 44,
                  padding: "0 8px 0 16px",
                  textAlign: "right",
                  color: "var(--text-dim)",
                  userSelect: "none",
                  fontSize: 11,
                  lineHeight: 1.6,
                  borderRight: "1px solid var(--border)",
                  background: "var(--bg-panel)",
                  flexShrink: 0,
                }}
              >
                {line.type === "removed" ? line.lineNo : newLno || ""}
              </span>
              <span
                style={{
                  minWidth: 16,
                  padding: "0 6px",
                  color: prefixColor,
                  userSelect: "none",
                  flexShrink: 0,
                  fontWeight: 600,
                }}
              >
                {prefix}
              </span>
              <span
                style={{
                  flex: 1,
                  padding: "0 8px 0 0",
                  whiteSpace: "pre",
                  color: "var(--text)",
                  overflowX: "auto",
                }}
              >
                {line.text || "\u00a0"}
              </span>
            </div>
          );
        });
        diffIdx += seg.lines.length;
        return <div key={si}>{lines}</div>;
      })}
    </div>
  );
}

function ImageViewer({ filePath, cwd, onAddChat }: { filePath: string; cwd?: string; onAddChat?: Props["onAddChat"] }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setNaturalSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath]);

  const encoded = encodeFilePathForApi(filePath);
  const src = `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`;

  const formatSizeStr = size != null ? formatSize(size) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "image"}</span>
        {naturalSize && <span>{naturalSize.w} × {naturalSize.h}</span>}
        {formatSizeStr && <span>{formatSizeStr}</span>}
        {onAddChat && (
          <button
            onClick={() => onAddChat(filePath)}
            title="Add to chat (⌘1)"
            {...iconFlowAttrs("interactive")}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
              display: "flex", alignItems: "center", gap: 4,
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <ActionFlowIcon width={10} height={10} strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ActionFlowIcon>
            Chat
          </button>
        )}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--bg-panel)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 16,
          backgroundImage:
            "linear-gradient(45deg, var(--bg) 25%, transparent 25%), linear-gradient(-45deg, var(--bg) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--bg) 75%), linear-gradient(-45deg, transparent 75%, var(--bg) 75%)",
          backgroundSize: "16px 16px",
          backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0px",
        }}
      >
        {error ? (
          <div style={{ color: "#f87171", fontSize: 13 }}>{error}</div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={filePath}
            onLoad={(e) => {
              const img = e.currentTarget;
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }}
            onError={() => setError("Failed to load image")}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              objectFit: "contain",
              boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}
          />
        )}
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return "";
  const totalSeconds = Math.round(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function AudioViewer({ filePath, cwd, onAddChat }: { filePath: string; cwd?: string; onAddChat?: Props["onAddChat"] }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileName(filePath).toLowerCase().split(".").pop() ?? "";

  useEffect(() => {
    setBust(0);
    setSize(null);
    setDuration(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") setSize(d.size);
      } catch { /* ignore */ }
      setDuration(null);
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath]);

  const encoded = encodeFilePathForApi(filePath);
  const src = `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext || "audio"}</span>
        {duration != null && <span>{formatDuration(duration)}</span>}
        {size != null && <span>{formatSize(size)}</span>}
        {onAddChat && (
          <button
            onClick={() => onAddChat(filePath)}
            title="Add to chat (⌘1)"
            {...iconFlowAttrs("interactive")}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
              display: "flex", alignItems: "center", gap: 4,
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <ActionFlowIcon width={10} height={10} strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ActionFlowIcon>
            Chat
          </button>
        )}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          background: "var(--bg-panel)",
        }}
      >
        <div style={{ width: "min(680px, 100%)" }}>
          {error && (
            <div style={{ color: "#f87171", fontSize: 13, marginBottom: 12, textAlign: "center" }}>
              {error}
            </div>
          )}
          <audio
            key={src}
            controls
            preload="metadata"
            src={src}
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
            onError={() => setError("Failed to load audio")}
            style={{ width: "100%" }}
          />
        </div>
      </div>
    </div>
  );
}

function DocumentViewer({ filePath, cwd, onAddChat }: { filePath: string; cwd?: string; onAddChat?: Props["onAddChat"] }) {
  const [watching, setWatching] = useState(false);
  const [bust, setBust] = useState(0);
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const ext = getFileExt(filePath);
  const encoded = encodeFilePathForApi(filePath);
  const isPdf = ext === "pdf";
  const previewUrl = isPdf
    ? `/api/files/${encoded}?type=read${bust ? `&v=${bust}` : ""}`
    : `/api/files/${encoded}?type=preview${bust ? `&v=${bust}` : ""}`;

  useEffect(() => {
    setBust(0);
    setSize(null);
    setError(null);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetch(`/api/files/${encoded}?type=meta`)
      .then((r) => r.json())
      .then((d: { size?: number; error?: string }) => {
        if (d.error) setError(d.error);
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
          }
        }
      })
      .catch((e) => setError(String(e)));

    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => setWatching(true));
    es.addEventListener("change", (e) => {
      try {
        const d = JSON.parse((e as MessageEvent).data) as { size?: number };
        if (typeof d.size === "number") {
          setSize(d.size);
          if (!isPdf && d.size > DOCX_PREVIEW_MAX_BYTES) {
            setError("DOCX too large for preview (>10MB)");
            return;
          }
        }
      } catch { /* ignore */ }
      setError(null);
      setBust((b) => b + 1);
    });
    es.addEventListener("error", () => setWatching(false));
    es.onerror = () => setWatching(false);

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [encoded, isPdf]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{ext === "docx" ? "docx preview" : "pdf"}</span>
        {size != null && <span>{formatSize(size)}</span>}
        {onAddChat && (
          <button
            onClick={() => onAddChat(filePath)}
            title="Add to chat (⌘1)"
            {...iconFlowAttrs("interactive")}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: "var(--bg-hover)",
              color: "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
              display: "flex", alignItems: "center", gap: 4,
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--bg-hover)"; e.currentTarget.style.color = "var(--text-muted)"; }}
          >
            <ActionFlowIcon width={10} height={10} strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ActionFlowIcon>
            Chat
          </button>
        )}
        <DownloadLink filePath={filePath} />
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)", flexShrink: 0 }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>
      </div>
      <div style={{ flex: 1, minHeight: 0, background: "var(--bg-panel)" }}>
        {error ? (
          <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#f87171", fontSize: 13, textAlign: "center" }}>
            {error}
          </div>
        ) : (
          <iframe
            key={previewUrl}
            src={previewUrl}
            sandbox={isPdf ? undefined : ""}
            title={`Preview ${getFileName(filePath)}`}
            style={{ width: "100%", height: "100%", border: "none", background: isPdf ? "var(--bg)" : "#eef1f5" }}
          />
        )}
      </div>
    </div>
  );
}

export function FileViewer({ filePath, cwd, initialLine, editorConfig, onAddChat, onOpenFile }: Props) {
  if (isImagePath(filePath)) {
    return <ImageViewer filePath={filePath} cwd={cwd} onAddChat={onAddChat} />;
  }
  if (isAudioPath(filePath)) {
    return <AudioViewer filePath={filePath} cwd={cwd} onAddChat={onAddChat} />;
  }
  if (isDocumentPreviewPath(filePath)) {
    return <DocumentViewer filePath={filePath} cwd={cwd} onAddChat={onAddChat} />;
  }
  return <TextFileViewer filePath={filePath} cwd={cwd} initialLine={initialLine} editorConfig={editorConfig} onAddChat={onAddChat} onOpenFile={onOpenFile} />;
}

function TextFileViewer({ filePath, cwd, initialLine, editorConfig, onAddChat, onOpenFile }: Props) {
  const { confirm } = usePrompt();
  const { isDark } = useTheme();
  const effectiveEditorConfig = editorConfig ?? DEFAULT_EDITOR_CONFIG;
  const [data, setData] = useState<FileData | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [prevContent, setPrevContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [externalChangePending, setExternalChangePending] = useState(false);
  const [activeSymbol, setActiveSymbol] = useState<string | null>(null);
  const [implementationResults, setImplementationResults] = useState<ImplementationResult[] | null>(null);
  const [implementationLoading, setImplementationLoading] = useState(false);
  const [implementationError, setImplementationError] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewMode, setViewMode] = useState<"source" | "diff">("source");
  const [wrapLines, setWrapLines] = useState(false);
  const [watching, setWatching] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);
  const [selectedLines, setSelectedLines] = useState<{ startLine: number; endLine: number } | null>(null);
  const selectedLinesRef = useRef(selectedLines);
  selectedLinesRef.current = selectedLines;
  const dirty = data !== null && editorContent !== data.content;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;

  const fetchContent = useCallback((filePath: string, isRefresh = false) => {
    if (isRefresh && dirtyRef.current) {
      setExternalChangePending(true);
      setSaveError("File changed on disk while you have unsaved edits. Reload or resolve before saving.");
      return Promise.resolve(null);
    }

    const encoded = encodeFilePathForApi(filePath);
    return fetch(`/api/files/${encoded}?type=read`)
      .then((r) => r.json())
      .then((d: FileData & { error?: string }) => {
        if (d.error) {
          setError(d.error);
          return null;
        }
        setSaveError(null);
        setExternalChangePending(false);
        setImplementationResults(null);
        setImplementationError(null);
        setSelectedLines(null);
        if (isRefresh) {
          setData((prev) => {
            if (prev) setPrevContent(prev.content);
            return d;
          });
          setChangeCount((c) => c + 1);
        } else {
          setData(d);
          setPrevContent(null);
        }
        editorContentRef.current = d.content;
        dirtyRef.current = false;
        setEditorContent(d.content);
        return d;
      })
      .catch((e) => {
        setError(String(e));
        return null;
      });
  }, []);

  const handleSave = useCallback(() => {
    if (!data || saving || !dirtyRef.current) return;

    setSaving(true);
    setSaveError(null);
    const encoded = encodeFilePathForApi(filePath);
    fetch(`/api/files/${encoded}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: editorContentRef.current,
        expectedMtimeMs: data.mtimeMs,
      }),
    })
      .then(async (res) => {
        const body = await res.json() as SaveFileResponse;
        if (!res.ok || body.error) {
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        dirtyRef.current = false;
        setData({
          content: editorContentRef.current,
          language: body.language ?? data.language,
          size: typeof body.size === "number" ? body.size : data.size,
          mtimeMs: typeof body.mtimeMs === "number" ? body.mtimeMs : data.mtimeMs,
        });
        setPrevContent(null);
        setExternalChangePending(false);
        setSaveError(null);
      })
      .catch((e) => {
        setSaveError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => setSaving(false));
  }, [data, filePath, saving]);

  const handleReloadFromDisk = useCallback(async () => {
    if (dirtyRef.current) {
      const confirmed = await confirm({
        title: "Discard unsaved edits?",
        message: "Discard unsaved edits and reload the file from disk?",
        confirmLabel: "Discard and reload",
        intent: "danger",
      });
      if (!confirmed) return;
    }
    setLoading(true);
    fetchContent(filePath).finally(() => setLoading(false));
  }, [confirm, fetchContent, filePath]);

  const handleEditorChange = useCallback((value: string) => {
    editorContentRef.current = value;
    dirtyRef.current = data !== null && value !== data.content;
    setEditorContent(value);
    if (!externalChangePending) setSaveError(null);
  }, [data, externalChangePending]);

  const openResult = useCallback((item: ImplementationResult) => {
    onOpenFile?.(item.filePath, getFileName(item.filePath), item.line);
  }, [onOpenFile]);

  const runSymbolSearch = useCallback((endpoint: "definitions" | "implementations" | "references", autoOpenSingle = false, symbolOverride?: string) => {
    const symbol = symbolOverride ?? activeSymbol;
    if (!cwd || !symbol) return;
    setImplementationLoading(true);
    setImplementationError(null);
    fetch(`/api/files/${endpoint}?cwd=${encodeURIComponent(cwd)}&symbol=${encodeURIComponent(symbol)}`)
      .then((res) => res.json().then((body: { results?: ImplementationResult[]; error?: string }) => ({ res, body })))
      .then(({ res, body }) => {
        if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
        const results = body.results ?? [];
        setImplementationResults(results);
        if (autoOpenSingle && results.length > 0) openResult(results[0]);
      })
      .catch((e) => {
        setImplementationError(String(e instanceof Error ? e.message : e));
        setImplementationResults(null);
      })
      .finally(() => setImplementationLoading(false));
  }, [activeSymbol, cwd, openResult]);

  const handleFindDefinitions = useCallback(() => runSymbolSearch("definitions", true), [runSymbolSearch]);
  const handleFindImplementations = useCallback(() => runSymbolSearch("implementations"), [runSymbolSearch]);
  const handleFindReferences = useCallback(() => runSymbolSearch("references"), [runSymbolSearch]);

  const isTypeDefinitionLine = useCallback((lineText: string, symbol: string) => {
    const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b(interface|class|record|enum|struct)\\s+${escaped}\\b`).test(lineText);
  }, []);

  const isInterfaceSource = useCallback(() => /\binterface\s+\w+/.test(editorContentRef.current) && !/\bclass\s+\w+/.test(editorContentRef.current), []);

  const handleMetaClickSymbol = useCallback((info: SymbolClickInfo) => {
    setActiveSymbol(info.symbol);
    if (isTypeDefinitionLine(info.lineText, info.symbol)) {
      runSymbolSearch("references", false, info.symbol);
      return;
    }
    runSymbolSearch("definitions", true, info.symbol);
  }, [isTypeDefinitionLine, runSymbolSearch]);

  const handleShiftClickSymbol = useCallback((info: SymbolClickInfo) => {
    setActiveSymbol(info.symbol);
    if (isTypeDefinitionLine(info.lineText, info.symbol) || isInterfaceSource()) runSymbolSearch("implementations", true, info.symbol);
    else runSymbolSearch("definitions", true, info.symbol);
  }, [isInterfaceSource, isTypeDefinitionLine, runSymbolSearch]);

  // Keyboard shortcuts: Cmd/Ctrl+1 adds file to chat, Cmd/Ctrl+S saves edits.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (effectiveEditorConfig.shortcuts.addSelectionToChat && (e.metaKey || e.ctrlKey) && e.key === "1") {
        if (!onAddChat) return;
        e.preventDefault();
        onAddChat(filePath, selectedLinesRef.current ?? undefined);
        setSelectedLines(null);
        window.getSelection()?.removeAllRanges();
      }
      if (effectiveEditorConfig.shortcuts.saveFile && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [effectiveEditorConfig.shortcuts.addSelectionToChat, effectiveEditorConfig.shortcuts.saveFile, filePath, handleSave, onAddChat]);

  // Initial load + SSE watch setup
  useEffect(() => {
    setLoading(true);
    setError(null);
    setData(null);
    dirtyRef.current = false;
    editorContentRef.current = "";
    setEditorContent("");
    setPrevContent(null);
    setSaveError(null);
    setSaving(false);
    setExternalChangePending(false);
    setActiveSymbol(null);
    setImplementationResults(null);
    setImplementationLoading(false);
    setImplementationError(null);
    setSelectedLines(null);
    setPreviewMode(false);
    setViewMode("source");
    setWrapLines(false);
    setChangeCount(0);
    setWatching(false);

    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    fetchContent(filePath).then((d) => {
      if (d?.language === "markdown") setPreviewMode(true);
    }).finally(() => setLoading(false));

    // Set up SSE watch
    const encoded = encodeFilePathForApi(filePath);
    const es = new EventSource(`/api/files/${encoded}?type=watch`);
    esRef.current = es;

    es.addEventListener("connected", () => {
      setWatching(true);
    });

    es.addEventListener("change", () => {
      fetchContent(filePath, true);
    });

    es.addEventListener("error", () => {
      setWatching(false);
    });

    es.onerror = () => {
      setWatching(false);
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [filePath, fetchContent]);

  if (loading) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 13 }}>
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#f87171", fontSize: 13 }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const isHtml = data.language === "html";
  const isMarkdown = data.language === "markdown";
  const isJava = data.language === "java" || getFileExt(filePath) === "java";
  const lines = editorContent.split("\n");
  const hasDiff = prevContent !== null && prevContent !== data.content;

  return (
    <div className="file-viewer-root" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Status bar */}
      <div
        className="file-viewer-status-bar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "4px 16px",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--text-dim)",
          background: "var(--bg)",
          flexShrink: 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)" }} title={filePath}>
          {getRelativeFilePath(filePath, cwd)}
        </span>
        <span style={{ marginLeft: "auto" }}>{data.language}</span>
        {viewMode === "source" && <span>{lines.length} lines</span>}
        <span>{formatSize(data.size)}</span>
        {dirty && <span style={{ color: externalChangePending ? "#f59e0b" : "var(--accent)", fontWeight: 600 }}>unsaved</span>}
        {saveError && (
          <span
            title={saveError}
            style={{ color: externalChangePending ? "#f59e0b" : "#f87171", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
          >
            {saveError}
          </span>
        )}
        {externalChangePending && (
          <button
            onClick={handleReloadFromDisk}
            title="Discard local edits and reload from disk"
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: "rgba(245,158,11,0.10)", color: "#f59e0b",
              border: "1px solid rgba(245,158,11,0.55)", borderRadius: 5,
              fontWeight: 600,
            }}
          >
            Reload disk
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          title="Save file (⌘S)"
          style={{
            padding: "2px 8px", fontSize: 11,
            cursor: !dirty || saving ? "default" : "pointer",
            background: dirty ? "var(--accent)" : "var(--bg-hover)",
            color: dirty ? "white" : "var(--text-dim)",
            border: dirty ? "1px solid var(--accent)" : "1px solid var(--border)",
            borderRadius: 5,
            fontWeight: dirty ? 700 : 400,
            opacity: saving ? 0.75 : 1,
          }}
        >
          {saving ? "Saving..." : dirty ? "Save" : "Saved"}
        </button>

        {viewMode === "source" && !previewMode && (
          <button
            onClick={handleFindDefinitions}
            disabled={!activeSymbol || implementationLoading}
            title={activeSymbol ? `Go to definition for ${activeSymbol}` : "Place cursor on a symbol"}
            style={{
              padding: "2px 8px", fontSize: 11,
              cursor: !activeSymbol || implementationLoading ? "default" : "pointer",
              background: "var(--bg-hover)",
              color: activeSymbol ? "var(--text-muted)" : "var(--text-dim)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
            }}
          >
            Def
          </button>
        )}

        {viewMode === "source" && !previewMode && (
          <button
            onClick={handleFindReferences}
            disabled={!activeSymbol || implementationLoading}
            title={activeSymbol ? `Find references for ${activeSymbol} (⇧F12)` : "Place cursor on a symbol"}
            style={{
              padding: "2px 8px", fontSize: 11,
              cursor: !activeSymbol || implementationLoading ? "default" : "pointer",
              background: "var(--bg-hover)",
              color: activeSymbol ? "var(--text-muted)" : "var(--text-dim)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
            }}
          >
            {implementationLoading ? "Finding..." : `Refs${activeSymbol ? `: ${activeSymbol}` : ""}`}
          </button>
        )}

        {isJava && viewMode === "source" && !previewMode && (
          <button
            onClick={handleFindImplementations}
            disabled={!activeSymbol || implementationLoading}
            title={activeSymbol ? `Find Java implementations for ${activeSymbol} (⌘/Ctrl+F12)` : "Place cursor on a Java symbol"}
            style={{
              padding: "2px 8px", fontSize: 11,
              cursor: !activeSymbol || implementationLoading ? "default" : "pointer",
              background: "var(--bg-hover)",
              color: activeSymbol ? "var(--text-muted)" : "var(--text-dim)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: 400,
            }}
          >
            {implementationLoading ? "Finding..." : `Impl${activeSymbol ? `: ${activeSymbol}` : ""}`}
          </button>
        )}

        {/* Add Chat button */}
        {onAddChat && (
          <button
            onClick={() => {
              onAddChat(filePath, selectedLines ?? undefined);
              setSelectedLines(null);
              window.getSelection()?.removeAllRanges();
            }}
            title="Add to chat (⌘1)"
            {...iconFlowAttrs("interactive")}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: selectedLines ? "rgba(37,99,235,0.10)" : "var(--bg-hover)",
              color: selectedLines ? "var(--accent)" : "var(--text-muted)",
              border: selectedLines ? "1px solid var(--accent)" : "1px solid var(--border)",
              borderRadius: 5,
              fontWeight: selectedLines ? 600 : 400,
              display: "flex", alignItems: "center", gap: 4,
              lineHeight: 1.4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--bg-selected)"; e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = selectedLines ? "rgba(37,99,235,0.10)" : "var(--bg-hover)"; e.currentTarget.style.color = selectedLines ? "var(--accent)" : "var(--text-muted)"; }}
          >
            <ActionFlowIcon width={10} height={10} strokeWidth={2.5}>
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </ActionFlowIcon>
            <span>{selectedLines ? `lines ${selectedLines.startLine}-${selectedLines.endLine}` : "Chat"}</span>
          </button>
        )}

        {/* Live watch indicator */}
        <span
          title={watching ? "Live sync active" : "Not watching"}
          style={{ display: "flex", alignItems: "center", gap: 4, color: watching ? "#4ade80" : "var(--text-dim)" }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: watching ? "#4ade80" : "var(--border)",
              display: "inline-block",
              boxShadow: watching ? "0 0 4px #4ade80" : "none",
            }}
          />
          {watching ? "live" : "static"}
        </span>

        {/* Diff / Source toggle — shown only when there are changes */}
        {hasDiff && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setViewMode("source")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: viewMode === "source" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "source" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "source" ? 600 : 400,
              }}
            >
              Source
            </button>
            <button
              onClick={() => setViewMode("diff")}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: viewMode === "diff" ? "var(--bg-selected)" : "var(--bg-hover)",
                color: viewMode === "diff" ? "var(--text)" : "var(--text-muted)",
                fontWeight: viewMode === "diff" ? 600 : 400,
              }}
            >
              Diff {changeCount > 0 && <span style={{ color: "#4ade80", marginLeft: 2 }}>+{changeCount}</span>}
            </button>
          </div>
        )}

        {/* Word wrap toggle */}
        {viewMode === "source" && !previewMode && (
          <button
            onClick={() => setWrapLines((v) => !v)}
            title={wrapLines ? "Disable word wrap" : "Enable word wrap"}
            style={{
              padding: "2px 8px", fontSize: 11, cursor: "pointer",
              background: wrapLines ? "var(--bg-selected)" : "var(--bg-hover)",
              color: wrapLines ? "var(--text)" : "var(--text-muted)",
              border: "1px solid var(--border)", borderRadius: 5,
              fontWeight: wrapLines ? 600 : 400,
            }}
          >
            wrap
          </button>
        )}

        {/* HTML source/preview toggle */}
        {isHtml && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Code
            </button>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
          </div>
        )}

        {/* Markdown preview/raw toggle */}
        {isMarkdown && viewMode === "source" && (
          <div style={{ display: "flex", borderRadius: 5, overflow: "hidden", border: "1px solid var(--border)" }}>
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", cursor: "pointer",
                background: previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: previewMode ? 600 : 400,
              }}
            >
              Preview
            </button>
            <button
              onClick={() => setPreviewMode(false)}
              style={{
                padding: "2px 8px", fontSize: 11, border: "none", borderLeft: "1px solid var(--border)", cursor: "pointer",
                background: !previewMode ? "var(--bg-selected)" : "var(--bg-hover)",
                color: !previewMode ? "var(--text)" : "var(--text-muted)",
                fontWeight: !previewMode ? 600 : 400,
              }}
            >
              Raw
            </button>
          </div>
        )}
      </div>

      {(implementationError || implementationResults) && (
        <div
          style={{
            flexShrink: 0,
            maxHeight: 120,
            overflow: "auto",
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-panel)",
            fontSize: 11,
          }}
        >
          {implementationError ? (
            <div style={{ padding: "8px 16px", color: "#f87171" }}>{implementationError}</div>
          ) : implementationResults && implementationResults.length === 0 ? (
            <div style={{ padding: "8px 16px", color: "var(--text-dim)" }}>No matches for {activeSymbol}</div>
          ) : implementationResults?.map((item, index) => (
            <button
              key={`${item.filePath}:${item.line}:${index}`}
              onClick={() => openResult(item)}
              style={{
                display: "flex",
                gap: 8,
                width: "100%",
                padding: "5px 16px",
                border: "none",
                borderBottom: "1px solid var(--border)",
                background: "transparent",
                color: "var(--text-muted)",
                textAlign: "left",
                cursor: onOpenFile ? "pointer" : "default",
                fontFamily: "var(--font-mono)",
                fontSize: 11,
              }}
              title={item.filePath}
            >
              <span style={{ color: item.kind === "implements" ? "#4ade80" : item.kind === "extends" ? "#60a5fa" : "var(--text-dim)", minWidth: 72 }}>{item.kind}</span>
              <span style={{ color: "var(--text)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.relativePath}:{item.line}</span>
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.preview}</span>
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div style={{ flex: 1, overflow: "hidden", background: "var(--bg)" }}>
        {viewMode === "diff" && hasDiff ? (
          <div style={{ height: "100%", overflow: "auto" }}>
            <DiffView oldContent={prevContent!} newContent={data.content} language={data.language} />
          </div>
        ) : isHtml && previewMode ? (
          <iframe
            srcDoc={editorContent}
            sandbox="allow-scripts"
            style={{ width: "100%", height: "100%", border: "none", background: "var(--bg)" }}
            title="HTML preview"
          />
        ) : isMarkdown && previewMode ? (
          <div
            className="markdown-body markdown-file-preview"
            style={{ height: "100%", overflow: "auto", boxSizing: "border-box", padding: "24px 32px", maxWidth: 800 }}
          >
            <ReactMarkdown
              remarkPlugins={markdownPreviewRemarkPlugins}
              rehypePlugins={markdownPreviewRehypePlugins}
            >
              {editorContent}
            </ReactMarkdown>
          </div>
        ) : (
          <MonacoFileEditor
            value={editorContent}
            language={data.language}
            filePath={filePath}
            cwd={cwd}
            initialLine={initialLine}
            isDark={isDark}
            wrapLines={wrapLines}
            onChange={handleEditorChange}
            onSave={effectiveEditorConfig.shortcuts.saveFile ? handleSave : undefined}
            onFindReferences={effectiveEditorConfig.shortcuts.findReferences ? handleFindReferences : undefined}
            onFindImplementations={effectiveEditorConfig.shortcuts.findJavaImplementations ? handleFindImplementations : undefined}
            onMetaClickSymbol={effectiveEditorConfig.shortcuts.cmdClickDrillDown ? handleMetaClickSymbol : undefined}
            onShiftClickSymbol={effectiveEditorConfig.shortcuts.shiftClickHierarchy ? handleShiftClickSymbol : undefined}
            onActiveSymbolChange={setActiveSymbol}
            onSelectedLinesChange={setSelectedLines}
          />
        )}
      </div>
    </div>
  );
}
