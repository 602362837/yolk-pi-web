"use client";

import { useMemo, useState, useCallback, useRef } from "react";
import type { GitGraphCommit } from "@/lib/types";

// ─── Types ─────────────────────────────────────────────────────────

interface LaneInfo {
  index: number;
  color: string;
  branchName: string;
  isMain: boolean;
  isCurrentBranch: boolean;
}

interface GraphLayout {
  commitLane: Map<string, number>;
  lanes: LaneInfo[];
  forkParent: Map<string, { parentHash: string; parentLane: number }>;
  claimedCommits: Set<string>;
}

interface TooltipInfo {
  x: number;
  y: number;
  text: string;
}

interface OverlayLine {
  x1: number; y1: number; x2: number; y2: number;
  color: string;
  tip: string;
  markerId: string;
}

// ─── Constants ─────────────────────────────────────────────────────

const MAIN_COLOR = "#2563eb";
const LANE_COLORS_PALETTE = [
  "#f472b6", "#34d399", "#fbbf24", "#a78bfa",
  "#fb923c", "#2dd4bf", "#e879f9", "#f87171", "#38bdf8",
];
const MAIN_BRANCH_NAMES = new Set(["main", "master"]);

function isMainBranchName(name: string | null | undefined): boolean {
  return Boolean(name && MAIN_BRANCH_NAMES.has(name));
}

function getTipBranchName(
  refs: GitGraphCommit["refs"],
  currentBranch: string | null,
): string | undefined {
  const branchRefs = refs.filter((r) => r.type === "head" || r.type === "branch");
  const defaultBranchName =
    branchRefs.find((r) => r.type === "head")?.name ??
    branchRefs.find((r) => r.type === "branch")?.name;

  if (isMainBranchName(currentBranch)) {
    return (
      branchRefs.find((r) => r.name === currentBranch)?.name ??
      branchRefs.find((r) => isMainBranchName(r.name))?.name ??
      defaultBranchName
    );
  }

  return defaultBranchName;
}

// ─── Layout algorithm ─────────────────────────────────────────────

function buildGraphLayout(
  commits: GitGraphCommit[],
  currentBranch: string | null
): GraphLayout {
  const commitByHash = new Map(commits.map((c) => [c.hash, c]));

  // 1. Collect branch tips
  const tips = commits.filter((c) =>
    c.refs.some((r) => r.type === "head" || r.type === "branch")
  );

  // Sort tips: branch-type (refs/heads/xxx) first, then HEAD-only, then current branch first within each group
  const tipOrder = [...tips].sort((a, b) => {
    const aBranch = a.refs.some((r) => r.type === "branch");
    const bBranch = b.refs.some((r) => r.type === "branch");
    if (aBranch && !bBranch) return -1; // branch-type walks first
    if (!aBranch && bBranch) return 1;
    // Within branch-type, put current branch first
    const aCur = currentBranch && a.refs.some((r) => r.name === currentBranch);
    const bCur = currentBranch && b.refs.some((r) => r.name === currentBranch);
    if (aCur && !bCur) return -1;
    if (!aCur && bCur) return 1;
    return commits.indexOf(a) - commits.indexOf(b);
  });

  const commitBranch = new Map<string, string>();

  for (const tip of tipOrder) {
    const branchName = getTipBranchName(tip.refs, currentBranch);
    if (!branchName) continue;

    for (
      let cur: GitGraphCommit | undefined = tip;
      cur && !commitBranch.has(cur.hash);
      cur = cur.parents[0] ? commitByHash.get(cur.parents[0]) : undefined
    ) {
      // If this commit is the tip of ANOTHER branch, it's a fork point.
      // Stop here so the other branch's walk can claim it.
      const isOtherTip = tips.some(
        (t) =>
          t !== tip &&
          t.hash === cur.hash &&
          t.refs.some((r) => r.type === "head" || r.type === "branch")
      );
      if (isOtherTip) break;

      commitBranch.set(cur.hash, branchName);
    }
  }

  // 2. Assign lanes
  const uniqueBranches = [...new Set(commitBranch.values())];
  const branchLane = new Map<string, number>();
  const lanes: LaneInfo[] = [];
  let hasMain = false;

  for (const name of uniqueBranches) {
    const idx = lanes.length;
    const isMain = MAIN_BRANCH_NAMES.has(name);
    let color: string;
    if (isMain) {
      color = MAIN_COLOR;
      hasMain = true;
    } else {
      const pool = hasMain ? LANE_COLORS_PALETTE : [MAIN_COLOR, ...LANE_COLORS_PALETTE];
      color = pool[(hasMain ? idx - 1 : idx) % pool.length];
    }
    branchLane.set(name, idx);
    lanes.push({
      index: idx,
      color,
      branchName: name,
      isMain,
      isCurrentBranch: name === currentBranch,
    });
  }

  // 3. Build commit→lane (two passes: claimed first, then unclaimed oldest→newest)
  const commitLane = new Map<string, number>();
  for (const c of commits) {
    const branch = commitBranch.get(c.hash);
    if (branch !== undefined) {
      commitLane.set(c.hash, branchLane.get(branch)!);
    }
  }
  // Find main lane for default fallback (unclaimed commits with unknown parent)
  const mainLaneIdx = lanes.find((l) => l.isMain)?.index ?? 0;
  // Reverse pass: unclaimed commits inherit parent lane (parent is older, already processed)
  for (let i = commits.length - 1; i >= 0; i--) {
    const c = commits[i];
    if (commitLane.has(c.hash)) continue;
    if (c.parents.length > 0) {
      commitLane.set(c.hash, commitLane.get(c.parents[0]) ?? mainLaneIdx);
    } else {
      commitLane.set(c.hash, mainLaneIdx);
    }
  }

  // 4. Fork detection (all lanes known)
  const forkParent = new Map<string, { parentHash: string; parentLane: number }>();
  for (const c of commits) {
    if (c.parents.length > 0) {
      const parentHash = c.parents[0];
      const parentLane = commitLane.get(parentHash);
      const myLane = commitLane.get(c.hash)!;
      if (parentLane !== undefined && parentLane !== myLane) {
        forkParent.set(c.hash, { parentHash, parentLane });
      }
    }
  }

  return { commitLane, lanes, forkParent, claimedCommits: new Set(commitBranch.keys()) };
}

// ─── Row data helper ──────────────────────────────────────────────

interface RowData {
  commit: GitGraphCommit;
  idx: number;
  commitLane: number;
  dotCX: number;
  myColor: string;
  isHead: boolean;
  /** For each lane, whether this row is WITHIN the lane's commit span */
  laneInSpan: Set<number>;
  /** Whether this row is ABOVE the first commit on this lane */
  hasAbove: Set<number>;
  /** Whether this row is BELOW the last commit on this lane */
  hasBelow: Set<number>;
  forkInfo: { parentHash: string; parentLane: number; parentIdx: number } | null;
}

function buildRowData(
  commits: GitGraphCommit[],
  layout: GraphLayout,
  laneOrder: number[],
  laneWidth: number,
  paddingL: number,
): RowData[] {
  const rows: RowData[] = [];

  // First pass: compute firstRow / lastRow for each lane (CLAIMED commits only)
  const laneFirstRow = new Map<number, number>();
  const laneLastRow = new Map<number, number>();
  for (let i = 0; i < commits.length; i++) {
    const c = commits[i];
    if (!layout.claimedCommits.has(c.hash)) continue;
    const l = layout.commitLane.get(c.hash);
    if (l === undefined) continue;
    if (!laneFirstRow.has(l)) laneFirstRow.set(l, i);
    laneLastRow.set(l, i);
  }

  // Second pass: build rows
  for (let idx = 0; idx < commits.length; idx++) {
    const commit = commits[idx];
    const commitLane = layout.commitLane.get(commit.hash) ?? 0;
    const myColor = layout.lanes[commitLane]?.color ?? "#9ca3af";
    const isHead = commit.refs.some((r) => r.type === "head");
    const dotCX = laneOrder.indexOf(commitLane) * laneWidth + 7 + paddingL;

    // Determine which lanes are "in span" (between first and last commit on that lane)
    const laneInSpan = new Set<number>();
    const hasAbove = new Set<number>();
    const hasBelow = new Set<number>();
    for (const l of laneOrder) {
      const fr = laneFirstRow.get(l);
      const lr = laneLastRow.get(l);
      if (fr === undefined || lr === undefined) continue;
      if (idx >= fr && idx <= lr) {
        laneInSpan.add(l);
        if (idx > fr) hasAbove.add(l);
        if (idx < lr) hasBelow.add(l);
      }
    }

    const fk = layout.forkParent.get(commit.hash);
    let forkInfo: RowData["forkInfo"] = null;
    if (fk) {
      const parentIdx = commits.findIndex((c) => c.hash === fk.parentHash);
      if (parentIdx >= 0) {
        forkInfo = { parentHash: fk.parentHash, parentLane: fk.parentLane, parentIdx };
      }
    }

    rows.push({
      commit, idx, commitLane, dotCX, myColor, isHead,
      laneInSpan, hasAbove, hasBelow, forkInfo,
    });
  }

  return rows;
}

// ─── Component ────────────────────────────────────────────────────

interface Props {
  commits: GitGraphCommit[];
  currentBranch: string | null;
  maxDisplay?: number;
}

export function CommitGraph({ commits, currentBranch, maxDisplay = 50 }: Props) {
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback((e: React.MouseEvent, text: string) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left + 10,
      y: e.clientY - rect.top - 10,
      text,
    });
  }, []);

  const hideTooltip = useCallback(() => setTooltip(null), []);

  const MEMO = useMemo(() => {
    const display = commits.slice(0, maxDisplay);
    if (display.length === 0) return null;

    const layout = buildGraphLayout(display, currentBranch);

    const currentLaneIdx = currentBranch && !isMainBranchName(currentBranch)
      ? layout.lanes.findIndex((l) => l.branchName === currentBranch)
      : -1;
    const mainLaneIdx = layout.lanes.findIndex((l) => l.isMain);

    const ordered = layout.lanes
      .map((l) => l.index)
      .sort((a, b) => {
        if (a === currentLaneIdx) return -1;
        if (b === currentLaneIdx) return 1;
        if (a === mainLaneIdx) return -1;
        if (b === mainLaneIdx) return 1;
        return a - b;
      });

    const laneWidth = 20;
    const paddingL = 6;
    const graphWidth = ordered.length * laneWidth + paddingL;
    const rowHeight = 20;

    const rows = buildRowData(display, layout, ordered, laneWidth, paddingL);

    // Build overlay connection data (fork & merge lines)
    const overlays: OverlayLine[] = [];
    for (const rd of rows) {
      // Fork line: from parent commit to this commit
      if (rd.forkInfo) {
        const { parentLane, parentIdx } = rd.forkInfo;
        const pCX = ordered.indexOf(parentLane) * laneWidth + 7 + paddingL;
        const dCX = rd.dotCX;
        const pY = parentIdx * rowHeight + rowHeight / 2;
        const dY = rd.idx * rowHeight + rowHeight / 2;
        const dx = dCX - pCX;
        const dy = dY - pY;
        if (Math.sqrt(dx * dx + dy * dy) >= 2) {
          const parentBranch = layout.lanes[parentLane]?.branchName ?? "?";
          const thisBranch = layout.lanes[rd.commitLane]?.branchName ?? "?";
          overlays.push({
            x1: pCX, y1: pY, x2: dCX, y2: dY,
            color: rd.myColor,
            tip: `forked from ${parentBranch} \u2192 ${thisBranch}`,
            markerId: `af-${rd.commit.hash}`,
          });
        }
      }
      // Merge lines: from secondary parents to this commit
      for (let pi = 1; pi < rd.commit.parents.length; pi++) {
        const pl = layout.commitLane.get(rd.commit.parents[pi]);
        if (pl === undefined || pl === rd.commitLane) continue;
        const pRow = rows.findIndex((r) => r.commit.hash === rd.commit.parents[pi]);
        if (pRow < 0) continue;
        const pCX = ordered.indexOf(pl) * laneWidth + 7 + paddingL;
        const dCX = rd.dotCX;
        const pY = pRow * rowHeight + rowHeight / 2;
        const yPos = rd.idx * rowHeight + rowHeight / 2;
        const mergeColor = layout.lanes[pl]?.color ?? "#9ca3af";
        const srcBranch = layout.lanes[pl]?.branchName ?? "?";
        const dstBranch = layout.lanes[rd.commitLane]?.branchName ?? "?";
        overlays.push({
          x1: pCX, y1: pY, x2: dCX, y2: yPos,
          color: mergeColor,
          tip: `merged ${srcBranch} \u2192 ${dstBranch}`,
          markerId: `am-${rd.commit.hash}-${pl}`,
        });
      }
    }

    return { rows, layout, laneOrder: ordered, laneWidth, paddingL, graphWidth, rowHeight, overlays, hasMore: commits.length > maxDisplay };
  }, [commits, currentBranch, maxDisplay]);

  const handleRowEnter = useCallback((idx: number) => setHoveredIdx(idx), []);
  const handleRowLeave = useCallback(() => setHoveredIdx(null), []);

  if (!MEMO) return null;

  const { rows, layout, laneOrder, laneWidth, paddingL, graphWidth, rowHeight, overlays, hasMore } = MEMO;

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {rows.map((rd) => (
          <CommitRow
            key={rd.commit.hash}
            rd={rd}
            layout={layout}
            laneOrder={laneOrder}
            graphWidth={graphWidth}
            laneWidth={laneWidth}
            paddingL={paddingL}
            rowHeight={rowHeight}
            currentBranch={currentBranch}
            showTooltip={showTooltip}
            hideTooltip={hideTooltip}
            isHovered={hoveredIdx === rd.idx}
            onRowEnter={handleRowEnter}
            onRowLeave={handleRowLeave}
          />
        ))}
        {hasMore && (
          <div style={{
            fontSize: 10, color: "var(--text-dim)",
            textAlign: "center", padding: "2px 0", fontStyle: "italic",
          }}>
            +{commits.length - maxDisplay} more
          </div>
        )}
      </div>

      {/* Overlay SVG for fork/merge connection lines (direct child of positioned container) */}
      <svg
        width={graphWidth}
        height={rows.length * rowHeight}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: 5,
          pointerEvents: "none",
          overflow: "visible",
        }}
      >
        <defs>
          {overlays.map((ol) => (
            <marker
              key={ol.markerId}
              id={ol.markerId}
              viewBox="0 0 8 8" refX="7" refY="4"
              markerWidth="5" markerHeight="5" orient="auto"
            >
              <path d="M 0 0 L 8 4 L 0 8 Z" fill={ol.color} opacity={0.7} />
            </marker>
          ))}
        </defs>
        {overlays.map((ol, oi) => (
          <g key={oi}>
            {/* Invisible wide hit area */}
            <line
              x1={ol.x1} y1={ol.y1} x2={ol.x2} y2={ol.y2}
              stroke="transparent" strokeWidth={14}
              style={{ cursor: "pointer", pointerEvents: "all" }}
              onMouseMove={(e) => {
                const rect = containerRef.current?.getBoundingClientRect();
                if (rect) setTooltip({ x: e.clientX - rect.left + 10, y: e.clientY - rect.top - 10, text: ol.tip });
              }}
              onMouseOut={() => setTooltip(null)}
            />
            {/* Visible line */}
            <line
              x1={ol.x1} y1={ol.y1} x2={ol.x2} y2={ol.y2}
              stroke={ol.color}
              strokeWidth={1.5}
              strokeOpacity={0.65}
              markerEnd={`url(#${ol.markerId})`}
              style={{ pointerEvents: "none" }}
            />
          </g>
        ))}
      </svg>

      {/* Floating tooltip */}
      {tooltip && (
        <div style={{
          position: "absolute",
          left: tooltip.x,
          top: tooltip.y,
          zIndex: 1000,
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: "6px 10px",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--text)",
          whiteSpace: "pre",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
          pointerEvents: "none",
          maxWidth: 300,
          fontFamily: "var(--font-mono)",
        }}>
          {tooltip.text}
        </div>
      )}
    </div>
  );
}

// ─── Single row ──────────────────────────────────────────────────

function CommitRow({
  rd, layout, laneOrder, graphWidth, laneWidth, paddingL, rowHeight,
  currentBranch, showTooltip, hideTooltip,
  isHovered, onRowEnter, onRowLeave,
}: {
  rd: RowData;
  layout: GraphLayout;
  laneOrder: number[];
  graphWidth: number;
  laneWidth: number;
  paddingL: number;
  rowHeight: number;
  currentBranch: string | null;
  showTooltip: (e: React.MouseEvent, text: string) => void;
  hideTooltip: () => void;
  isHovered: boolean;
  onRowEnter: (idx: number) => void;
  onRowLeave: () => void;
}) {
  const { commit, idx, commitLane, dotCX, myColor, isHead, laneInSpan, hasAbove, hasBelow, forkInfo } = rd;
  const yDot = rowHeight / 2;
  const dotR = 3.5;

  // Collect all parent lanes that need to render for connection lines
  const lanesToRender = new Set(laneInSpan);
  if (forkInfo) lanesToRender.add(forkInfo.parentLane);
  for (let pi = 1; pi < commit.parents.length; pi++) {
    const pl = layout.commitLane.get(commit.parents[pi]);
    if (pl !== undefined && pl !== commitLane) lanesToRender.add(pl);
  }

  const branchLabels = commit.refs.filter(
    (r) => r.type === "branch" || r.type === "remote"
  );
  const tagLabels = commit.refs.filter((r) => r.type === "tag");

  const tipText = formatCommitTooltip(commit);

  return (
    <div
      onMouseEnter={() => onRowEnter(idx)}
      onMouseLeave={onRowLeave}
      style={{
        display: "flex",
        alignItems: "stretch",
        minHeight: rowHeight,
        height: rowHeight,
        background: isHovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.08s",
      }}
    >
      {/* SVG graph */}
      <div style={{ width: graphWidth, minWidth: graphWidth, flexShrink: 0 }}>
        <svg
          width={graphWidth}
          height={rowHeight}
          style={{ display: "block", overflow: "visible" }}
        >
          <defs />

          {/* ── Lane lines ── */}
          {laneOrder.filter((l) => lanesToRender.has(l)).map((laneIdx) => {
            const lane = layout.lanes[laneIdx];
            if (!lane) return null;
            const cx = laneOrder.indexOf(laneIdx) * laneWidth + 7 + paddingL;
            const strokeW = lane.isMain ? 2.5 : 1.5;
            const opacity = lane.isCurrentBranch ? 0.7 : 0.4;
            const hAbove = hasAbove.has(laneIdx);
            const hBelow = hasBelow.has(laneIdx);

            return (
              <g key={laneIdx}>
                {/* Invisible wide hit area for hover tooltip */}
                {(hAbove || hBelow) && (
                  <line
                    x1={cx} y1={hAbove ? 0 : yDot + dotR}
                    x2={cx} y2={hBelow ? rowHeight : yDot - dotR}
                    stroke="transparent"
                    strokeWidth={12}
                    style={{ cursor: "default" }}
                    onMouseMove={(e) => showTooltip(e, lane.branchName)}
                    onMouseOut={hideTooltip}
                  />
                )}

                {/* Visible line above dot */}
                {hAbove && (
                  <line
                    x1={cx} y1={0} x2={cx} y2={yDot - dotR}
                    stroke={lane.color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {/* Visible line below dot */}
                {hBelow && (
                  <line
                    x1={cx} y1={yDot + dotR} x2={cx} y2={rowHeight}
                    stroke={lane.color}
                    strokeWidth={strokeW}
                    strokeOpacity={opacity}
                    style={{ pointerEvents: "none" }}
                  />
                )}

              </g>
            );
          })}

          {/* Fork and merge lines rendered in overlay SVG */}

          {/* ── Commit dot ── */}
          <g>
            {/* Invisible wide hit area — guaranteed hit-testable */}
            <circle
              cx={dotCX} cy={yDot} r={12}
              fill="rgba(0,0,0,0.001)"
              style={{ cursor: "pointer", pointerEvents: "all" }}
              onMouseMove={(e) => showTooltip(e, tipText)}
              onMouseOut={hideTooltip}
            />
            {/* Visible dot — larger when hovered */}
            <circle
              cx={dotCX} cy={yDot} r={isHovered ? dotR + 2 : dotR}
              fill={myColor}
              stroke={isHovered ? "var(--bg)" : "var(--bg-panel)"}
              strokeWidth={isHovered ? 2.5 : 1.5}
              style={{
                pointerEvents: "none",
                transition: "r 0.08s, stroke-width 0.08s",
              }}
            />
            {/* Hover glow ring */}
            {isHovered && (
              <circle
                cx={dotCX} cy={yDot}
                r={dotR + 5}
                fill="none"
                stroke={myColor}
                strokeWidth={3}
                strokeOpacity={0.2}
                style={{ pointerEvents: "none" }}
              />
            )}
            {isHead && (
              <circle
                cx={dotCX} cy={yDot}
                r={isHovered ? dotR + 4 : dotR + 2}
                fill="none"
                stroke={myColor}
                strokeWidth={isHovered ? 2 : 1.5}
                strokeOpacity={0.6}
                style={{ pointerEvents: "none" }}
              />
            )}
          </g>
        </svg>
      </div>

      {/* Commit info — highlight background when row is hovered */}
      <div style={{
        flex: 1, minWidth: 0,
        display: "flex", alignItems: "center", gap: 3,
        overflow: "hidden", paddingRight: 4,
        borderRadius: 4,
        background: isHovered ? "var(--bg-hover)" : "transparent",
        transition: "background 0.08s",
      }}>
        <span style={{
          fontSize: 10.5,
          color: "var(--text)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          flex: 1, minWidth: 0,
        }}>
          {commit.message}
        </span>

        {branchLabels.map((ref) => (
          <RefBadge
            key={ref.name}
            label={ref.name}
            isCurrent={ref.name === currentBranch}
            color={myColor}
          />
        ))}
        {tagLabels.length > 0 && (
          <RefBadge
            key={`t-${tagLabels[0].name}`}
            label={tagLabels[0].name}
            isCurrent={false}
            color="#9ca3af"
          />
        )}

        <span style={{
          fontSize: 9, color: "var(--text-dim)",
          whiteSpace: "nowrap", flexShrink: 0,
        }}>
          {commit.relativeDate}
        </span>
      </div>
    </div>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────

function formatCommitTooltip(c: GitGraphCommit): string {
  const lines = [
    `Commit  ${c.hash.slice(0, 8)}`,
    `Author  ${c.author}`,
    `Date    ${c.date}`,
  ];
  if (c.refs.length > 0) {
    lines.push(`Refs    ${c.refs.map((r) => r.name).join(", ")}`);
  }
  lines.push(`─`.repeat(30));
  lines.push(c.message);
  return lines.join("\n");
}

// ─── Ref badge ────────────────────────────────────────────────────

function RefBadge({ label, isCurrent, color }: { label: string; color: string; isCurrent: boolean }) {
  return (
    <span
      title={label}
      style={{
        fontSize: 8.5,
        fontFamily: "var(--font-mono)",
        color: isCurrent ? color : "var(--text-dim)",
        background: isCurrent ? `${color}22` : "var(--bg-hover)",
        border: `1px solid ${isCurrent ? `${color}44` : "var(--border)"}`,
        borderRadius: 3,
        padding: "0 4px",
        lineHeight: "15px",
        whiteSpace: "nowrap",
        flexShrink: 0,
        fontWeight: isCurrent ? 600 : 400,
        maxWidth: 70,
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {label}
    </span>
  );
}
