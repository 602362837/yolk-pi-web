"use client";

import { Fragment, useCallback, useMemo, useRef, type CSSProperties, type UIEvent } from "react";

interface Props {
  diff: string;
}

type SideKind = "context" | "add" | "delete" | "empty";
type PaneSide = "old" | "new";

type SectionKind = "file" | "hunk" | "meta" | "note";

interface DiffSide {
  lineNumber: number | null;
  content: string;
  kind: SideKind;
}

type DiffRow =
  | { kind: "section"; sectionKind: SectionKind; text: string }
  | { kind: "compare"; oldSide: DiffSide; newSide: DiffSide };

interface HunkHeader {
  oldStart: number;
  newStart: number;
}

const hunkHeaderPattern = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function parseHunkHeader(line: string): HunkHeader | null {
  const match = hunkHeaderPattern.exec(line);
  if (!match) return null;
  return {
    oldStart: Number(match[1]),
    newStart: Number(match[2]),
  };
}

function sectionKind(line: string): SectionKind {
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("---") || line.startsWith("+++") || line.startsWith("diff --git")) return "file";
  if (line.startsWith("\\")) return "note";
  return "meta";
}

function parseSideBySideRows(diff: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = diff ? diff.split("\n") : [];
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  let deleteRun: string[] = [];
  let addRun: string[] = [];

  const flushRuns = () => {
    if (deleteRun.length === 0 && addRun.length === 0) return;
    const rowCount = Math.max(deleteRun.length, addRun.length);
    for (let index = 0; index < rowCount; index += 1) {
      const oldContent = deleteRun[index];
      const newContent = addRun[index];
      rows.push({
        kind: "compare",
        oldSide: oldContent === undefined
          ? { lineNumber: null, content: "", kind: "empty" }
          : { lineNumber: oldLine++, content: oldContent, kind: "delete" },
        newSide: newContent === undefined
          ? { lineNumber: null, content: "", kind: "empty" }
          : { lineNumber: newLine++, content: newContent, kind: "add" },
      });
    }
    deleteRun = [];
    addRun = [];
  };

  lines.forEach((line, index) => {
    if (line === "" && index === lines.length - 1) return;

    const hunk = parseHunkHeader(line);
    if (hunk) {
      flushRuns();
      inHunk = true;
      oldLine = hunk.oldStart;
      newLine = hunk.newStart;
      rows.push({ kind: "section", sectionKind: "hunk", text: line });
      return;
    }

    if (!inHunk) {
      rows.push({ kind: "section", sectionKind: sectionKind(line), text: line });
      return;
    }

    if (line.startsWith("diff --git ")) {
      flushRuns();
      inHunk = false;
      rows.push({ kind: "section", sectionKind: sectionKind(line), text: line });
      return;
    }

    if (line.startsWith("-")) {
      if (addRun.length > 0 && deleteRun.length === 0) flushRuns();
      deleteRun.push(line.slice(1));
      return;
    }

    if (line.startsWith("+")) {
      addRun.push(line.slice(1));
      return;
    }

    flushRuns();

    if (line.startsWith(" ")) {
      const content = line.slice(1);
      rows.push({
        kind: "compare",
        oldSide: { lineNumber: oldLine++, content, kind: "context" },
        newSide: { lineNumber: newLine++, content, kind: "context" },
      });
      return;
    }

    rows.push({ kind: "section", sectionKind: sectionKind(line), text: line });
  });

  flushRuns();
  return rows;
}

function sideStyle(kind: SideKind): CSSProperties {
  switch (kind) {
    case "add":
      return { color: "#16a34a", background: "rgba(34,197,94,0.10)" };
    case "delete":
      return { color: "#dc2626", background: "rgba(239,68,68,0.10)" };
    case "empty":
      return { color: "var(--text-dim)", background: "var(--bg-subtle)" };
    case "context":
    default:
      return { color: "var(--text)", background: "var(--bg)" };
  }
}

function sectionStyle(kind: SectionKind): CSSProperties {
  if (kind === "hunk") return { color: "var(--accent)", background: "rgba(37,99,235,0.08)" };
  if (kind === "file") return { color: "var(--text-muted)", background: "var(--bg-subtle)", fontWeight: 700 };
  if (kind === "note") return { color: "var(--text-dim)", background: "var(--bg-subtle)", fontStyle: "italic" };
  return { color: "var(--text-muted)", background: "var(--bg-subtle)" };
}

function LineNumber({ value }: { value: number | null }) {
  return (
    <span
      style={{
        display: "block",
        position: "sticky",
        left: 0,
        zIndex: 1,
        padding: "0 10px",
        color: "var(--text-dim)",
        textAlign: "right",
        userSelect: "none",
        borderRight: "1px solid var(--border)",
        background: "var(--bg-subtle)",
      }}
    >
      {value ?? ""}
    </span>
  );
}

function DiffCell({ side }: { side: DiffSide }) {
  return (
    <span
      style={{
        display: "block",
        padding: "0 12px",
        whiteSpace: "pre",
        ...sideStyle(side.kind),
      }}
    >
      {side.content || " "}
    </span>
  );
}

function DiffPane({ rows, side }: { rows: DiffRow[]; side: PaneSide }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "64px minmax(420px, max-content)",
        minWidth: "100%",
        width: "max-content",
      }}
    >
      {rows.map((row, index) => {
        if (row.kind === "section") {
          return (
            <span
              key={index}
              style={{
                gridColumn: "1 / -1",
                padding: "0 12px",
                whiteSpace: "pre",
                ...sectionStyle(row.sectionKind),
              }}
            >
              {row.text || " "}
            </span>
          );
        }

        const paneSide = side === "old" ? row.oldSide : row.newSide;
        return (
          <Fragment key={index}>
            <LineNumber value={paneSide.lineNumber} />
            <DiffCell side={paneSide} />
          </Fragment>
        );
      })}
    </div>
  );
}

export function SideBySideDiffView({ diff }: Props) {
  const rows = useMemo(() => parseSideBySideRows(diff), [diff]);
  const oldPaneRef = useRef<HTMLDivElement | null>(null);
  const newPaneRef = useRef<HTMLDivElement | null>(null);
  const programmaticScrollPaneRef = useRef<PaneSide | null>(null);

  const syncScroll = useCallback((event: UIEvent<HTMLDivElement>, sourcePane: PaneSide, targetRef: typeof oldPaneRef, targetPane: PaneSide) => {
    if (programmaticScrollPaneRef.current === sourcePane) {
      programmaticScrollPaneRef.current = null;
      return;
    }

    const target = targetRef.current;
    if (!target) return;

    const source = event.currentTarget;
    programmaticScrollPaneRef.current = targetPane;
    target.scrollLeft = source.scrollLeft;
    target.scrollTop = source.scrollTop;
    window.requestAnimationFrame(() => {
      if (programmaticScrollPaneRef.current === targetPane) {
        programmaticScrollPaneRef.current = null;
      }
    });
  }, []);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
        height: "100%",
        minHeight: 0,
        margin: 0,
        padding: 0,
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.55,
        background: "var(--bg)",
      }}
    >
      <div
        ref={oldPaneRef}
        onScroll={(event) => syncScroll(event, "old", newPaneRef, "new")}
        style={{
          minWidth: 0,
          overflow: "auto",
          borderRight: "1px solid var(--border)",
        }}
      >
        <DiffPane rows={rows} side="old" />
      </div>
      <div
        ref={newPaneRef}
        onScroll={(event) => syncScroll(event, "new", oldPaneRef, "old")}
        style={{
          minWidth: 0,
          overflow: "auto",
        }}
      >
        <DiffPane rows={rows} side="new" />
      </div>
    </div>
  );
}
