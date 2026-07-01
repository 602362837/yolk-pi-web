import type { CSSProperties } from "react";

interface Props {
  diff: string;
}

function lineStyle(line: string): CSSProperties {
  if (line.startsWith("@@")) {
    return { color: "var(--accent)", background: "rgba(37,99,235,0.08)" };
  }
  if (line.startsWith("+++") || line.startsWith("---")) {
    return { color: "var(--text-muted)", background: "var(--bg-subtle)", fontWeight: 700 };
  }
  if (line.startsWith("+")) {
    return { color: "#16a34a", background: "rgba(34,197,94,0.10)" };
  }
  if (line.startsWith("-")) {
    return { color: "#dc2626", background: "rgba(239,68,68,0.10)" };
  }
  return { color: "var(--text)" };
}

export function UnifiedDiffView({ diff }: Props) {
  const lines = diff ? diff.split("\n") : [];
  return (
    <pre
      style={{
        margin: 0,
        padding: 0,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.55,
        whiteSpace: "pre",
        overflow: "auto",
      }}
    >
      {lines.map((line, index) => (
        <div
          key={index}
          style={{
            display: "flex",
            minWidth: "max-content",
            ...lineStyle(line),
          }}
        >
          <span
            style={{
              width: 52,
              flexShrink: 0,
              padding: "0 10px",
              color: "var(--text-dim)",
              textAlign: "right",
              userSelect: "none",
              borderRight: "1px solid var(--border)",
            }}
          >
            {index + 1}
          </span>
          <span style={{ padding: "0 12px" }}>{line || " "}</span>
        </div>
      ))}
    </pre>
  );
}
