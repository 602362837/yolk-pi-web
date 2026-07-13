"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { TerminalSshProfilePicker } from "./TerminalSshProfilePicker";
import { usePrompt } from "./AppPromptProvider";
import type { TerminalSshProfile } from "@/lib/terminal-ssh-types";

interface Props {
  cwd: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onClose: () => void;
  initialInput?: { id: string; text: string } | null;
}

type TerminalBackend = "pty" | "script" | "pipe";
type TerminalStatus = "starting" | "connected" | "error";
type TerminalKind = "local" | "ssh";
type SplitDirection = "horizontal" | "vertical";
type DropZone = "center" | "left" | "right" | "top" | "bottom";

interface DropTargetState {
  paneId: string;
  zone: DropZone;
  disabled?: boolean;
  message?: string;
}

interface CreateTerminalResponse {
  session?: {
    id: string;
    kind: TerminalKind;
    cwd: string;
    shell: string;
    backend: TerminalBackend;
    profileId?: string;
    profileLabel?: string;
    targetLabel?: string;
  };
  error?: string;
}

interface TerminalEvent {
  type?: string;
  chunk?: string;
  error?: string;
}

interface TerminalTabState {
  id: string;
  kind: TerminalKind;
  label: string;
  cwd: string;
  profileId?: string;
  profileLabel?: string;
  targetLabel?: string;
  sessionId: string | null;
  shell: string | null;
  backend: TerminalBackend | null;
  status: TerminalStatus;
  error: string | null;
}

interface TerminalPaneNode {
  kind: "pane";
  id: string;
  tabIds: string[];
  activeTabId: string | null;
}

interface TerminalSplitNode {
  kind: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  first: TerminalLayoutNode;
  second: TerminalLayoutNode;
}

type TerminalLayoutNode = TerminalPaneNode | TerminalSplitNode;

interface TerminalState {
  tabs: Record<string, TerminalTabState>;
  layout: TerminalLayoutNode;
  activePaneId: string;
  nextTabNumber: number;
}

type AddTerminalTabPayload =
  | { kind: "local"; cwd: string }
  | { kind: "ssh"; cwd: string; profileId: string; profileLabel: string; targetLabel: string };

type TerminalTabUpdates = Partial<Pick<TerminalTabState, "sessionId" | "shell" | "backend" | "status" | "error" | "profileId" | "profileLabel" | "targetLabel">>;

type TerminalAction =
  | { type: "add_tab"; tab: AddTerminalTabPayload }
  | { type: "update_tab"; tabId: string; updates: TerminalTabUpdates }
  | { type: "select_tab"; paneId: string; tabId: string }
  | { type: "rename_tab"; tabId: string; label: string }
  | { type: "close_tab"; tabId: string }
  | { type: "move_tab"; tabId: string; sourcePaneId: string; targetPaneId: string; zone: DropZone }
  | { type: "resize_split"; splitId: string; ratio: number };

interface TerminalSessionViewProps {
  tab: TerminalTabState;
  visible: boolean;
  layoutVersion: number;
  onTabUpdate: (tabId: string, updates: TerminalTabUpdates) => void;
  initialInput?: { id: string; text: string } | null;
}

const MIN_PANE_WIDTH = 220;
const MIN_PANE_HEIGHT = 140;
const MIN_DOCK_HEIGHT = 180;
const NORMAL_DOCK_HEIGHT = 300;
const HEADER_HEIGHT = 36;
const PANE_TAB_BAR_HEIGHT = 28;

function makeId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getTerminalTheme(): ITheme {
  const styles = getComputedStyle(document.documentElement);
  return {
    background: styles.getPropertyValue("--bg").trim() || "#0f172a",
    foreground: styles.getPropertyValue("--text").trim() || "#e5e7eb",
    cursor: styles.getPropertyValue("--accent").trim() || "#3b82f6",
    selectionBackground: styles.getPropertyValue("--bg-selected").trim() || "#1d4ed8",
  };
}

function createInitialState(cwd: string): TerminalState {
  const paneId = makeId("term-pane");
  const tabId = makeId("term-tab");
  return {
    tabs: {
      [tabId]: {
        id: tabId,
        kind: "local",
        label: "Terminal 1",
        cwd,
        sessionId: null,
        shell: null,
        backend: null,
        status: "starting",
        error: null,
      },
    },
    layout: { kind: "pane", id: paneId, tabIds: [tabId], activeTabId: tabId },
    activePaneId: paneId,
    nextTabNumber: 2,
  };
}

function findPane(node: TerminalLayoutNode, paneId: string): TerminalPaneNode | null {
  if (node.kind === "pane") return node.id === paneId ? node : null;
  return findPane(node.first, paneId) ?? findPane(node.second, paneId);
}

function findPaneForTab(node: TerminalLayoutNode, tabId: string): TerminalPaneNode | null {
  if (node.kind === "pane") return node.tabIds.includes(tabId) ? node : null;
  return findPaneForTab(node.first, tabId) ?? findPaneForTab(node.second, tabId);
}

function findFirstPane(node: TerminalLayoutNode): TerminalPaneNode {
  if (node.kind === "pane") return node;
  return findFirstPane(node.first);
}

function updatePane(node: TerminalLayoutNode, paneId: string, updater: (pane: TerminalPaneNode) => TerminalPaneNode): TerminalLayoutNode {
  if (node.kind === "pane") return node.id === paneId ? updater(node) : node;
  return { ...node, first: updatePane(node.first, paneId, updater), second: updatePane(node.second, paneId, updater) };
}

function updateSplitRatio(node: TerminalLayoutNode, splitId: string, ratio: number): TerminalLayoutNode {
  if (node.kind === "pane") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, first: updateSplitRatio(node.first, splitId, ratio), second: updateSplitRatio(node.second, splitId, ratio) };
}

function removeTabFromLayout(node: TerminalLayoutNode, tabId: string): TerminalLayoutNode | null {
  if (node.kind === "pane") {
    if (!node.tabIds.includes(tabId)) return node;
    const tabIds = node.tabIds.filter((id) => id !== tabId);
    if (tabIds.length === 0) return null;
    const activeTabId = node.activeTabId === tabId ? tabIds[Math.min(node.tabIds.indexOf(tabId), tabIds.length - 1)] : node.activeTabId;
    return { ...node, tabIds, activeTabId };
  }

  const first = removeTabFromLayout(node.first, tabId);
  const second = removeTabFromLayout(node.second, tabId);
  if (!first && !second) return null;
  if (!first) return second;
  if (!second) return first;
  return { ...node, first, second };
}

function replacePaneWithSplit(node: TerminalLayoutNode, paneId: string, tabId: string, zone: Exclude<DropZone, "center">): TerminalLayoutNode {
  if (node.kind === "pane") {
    if (node.id !== paneId) return node;
    const newPane: TerminalPaneNode = { kind: "pane", id: makeId("term-pane"), tabIds: [tabId], activeTabId: tabId };
    const direction: SplitDirection = zone === "left" || zone === "right" ? "horizontal" : "vertical";
    const newFirst = zone === "left" || zone === "top";
    return {
      kind: "split",
      id: makeId("term-split"),
      direction,
      ratio: 0.5,
      first: newFirst ? newPane : node,
      second: newFirst ? node : newPane,
    };
  }
  return { ...node, first: replacePaneWithSplit(node.first, paneId, tabId, zone), second: replacePaneWithSplit(node.second, paneId, tabId, zone) };
}

function terminalReducer(state: TerminalState, action: TerminalAction): TerminalState {
  switch (action.type) {
    case "add_tab": {
      const pane = findPane(state.layout, state.activePaneId) ?? findFirstPane(state.layout);
      const tabId = makeId("term-tab");
      const label = action.tab.kind === "ssh" ? `SSH: ${action.tab.profileLabel}` : `Terminal ${state.nextTabNumber}`;
      const tab: TerminalTabState = {
        id: tabId,
        kind: action.tab.kind,
        label,
        cwd: action.tab.cwd,
        profileId: action.tab.kind === "ssh" ? action.tab.profileId : undefined,
        profileLabel: action.tab.kind === "ssh" ? action.tab.profileLabel : undefined,
        targetLabel: action.tab.kind === "ssh" ? action.tab.targetLabel : undefined,
        sessionId: null,
        shell: null,
        backend: null,
        status: "starting",
        error: null,
      };
      return {
        ...state,
        tabs: { ...state.tabs, [tabId]: tab },
        layout: updatePane(state.layout, pane.id, (node) => ({ ...node, tabIds: [...node.tabIds, tabId], activeTabId: tabId })),
        activePaneId: pane.id,
        nextTabNumber: action.tab.kind === "ssh" ? state.nextTabNumber : state.nextTabNumber + 1,
      };
    }
    case "update_tab": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      return { ...state, tabs: { ...state.tabs, [action.tabId]: { ...tab, ...action.updates } } };
    }
    case "select_tab": {
      if (!state.tabs[action.tabId]) return state;
      return {
        ...state,
        activePaneId: action.paneId,
        layout: updatePane(state.layout, action.paneId, (pane) => pane.tabIds.includes(action.tabId) ? { ...pane, activeTabId: action.tabId } : pane),
      };
    }
    case "rename_tab": {
      const tab = state.tabs[action.tabId];
      const label = action.label.trim();
      if (!tab || !label) return state;
      return { ...state, tabs: { ...state.tabs, [action.tabId]: { ...tab, label } } };
    }
    case "close_tab": {
      const tab = state.tabs[action.tabId];
      if (!tab) return state;
      const tabs = { ...state.tabs };
      delete tabs[action.tabId];
      const layout = removeTabFromLayout(state.layout, action.tabId);
      if (!layout) return state;
      const activePane = findPane(layout, state.activePaneId) ?? findFirstPane(layout);
      return { ...state, tabs, layout, activePaneId: activePane.id };
    }
    case "move_tab": {
      if (!state.tabs[action.tabId]) return state;
      const sourcePane = findPane(state.layout, action.sourcePaneId);
      const targetPane = findPane(state.layout, action.targetPaneId);
      if (!sourcePane || !targetPane) return state;
      if (action.zone === "center" && sourcePane.id === targetPane.id) return state;
      if (action.zone !== "center" && sourcePane.id === targetPane.id && sourcePane.tabIds.length <= 1) return state;

      const withoutTab = removeTabFromLayout(state.layout, action.tabId);
      if (!withoutTab) return state;
      const targetStillExists = findPane(withoutTab, action.targetPaneId);
      if (!targetStillExists) return state;

      const layout = action.zone === "center"
        ? updatePane(withoutTab, action.targetPaneId, (pane) => ({ ...pane, tabIds: [...pane.tabIds, action.tabId], activeTabId: action.tabId }))
        : replacePaneWithSplit(withoutTab, action.targetPaneId, action.tabId, action.zone);
      const activePane = findPaneForTab(layout, action.tabId) ?? findFirstPane(layout);
      return { ...state, layout, activePaneId: activePane.id };
    }
    case "resize_split":
      return { ...state, layout: updateSplitRatio(state.layout, action.splitId, action.ratio) };
    default:
      return state;
  }
}

function getContentDropIntent(event: React.DragEvent<HTMLDivElement>, rect: DOMRect): Omit<DropTargetState, "paneId"> {
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const canSplitX = rect.width >= MIN_PANE_WIDTH * 2;
  const canSplitY = rect.height >= MIN_PANE_HEIGHT * 2;
  const horizontalIntent = Math.abs(x / rect.width - 0.5);
  const verticalIntent = Math.abs(y / rect.height - 0.5);
  const zone: Exclude<DropZone, "center"> = horizontalIntent >= verticalIntent
    ? (x < rect.width / 2 ? "left" : "right")
    : (y < rect.height / 2 ? "top" : "bottom");
  const needsHorizontalSpace = zone === "left" || zone === "right";
  const disabled = needsHorizontalSpace ? !canSplitX : !canSplitY;
  return {
    zone,
    disabled,
    message: disabled ? `空间不足，无法${needsHorizontalSpace ? "左右" : "上下"}切割` : undefined,
  };
}

function parseDraggedTerminalTab(raw: string, fallback: { tabId: string; sourcePaneId: string } | null): { tabId: string; sourcePaneId: string } | null {
  if (fallback) return fallback;
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<{ tabId: string; sourcePaneId: string }>;
    if (typeof value.tabId === "string" && typeof value.sourcePaneId === "string") {
      return { tabId: value.tabId, sourcePaneId: value.sourcePaneId };
    }
  } catch {
    return null;
  }
  return null;
}

function deleteTerminalSession(sessionId: string | null): void {
  if (!sessionId) return;
  void fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
}

function endpointLabel(profile: TerminalSshProfile): string {
  const user = profile.target.username ? `${profile.target.username}@` : "";
  return `${user}${profile.target.host}:${profile.target.port}`;
}

function getTabTooltip(tab: TerminalTabState): string {
  if (tab.kind === "ssh") {
    return [
      tab.label,
      tab.targetLabel ?? tab.profileLabel ?? tab.profileId,
      `workspace: ${tab.cwd}`,
    ].filter(Boolean).join(" · ");
  }
  return `${tab.label} · ${tab.cwd}`;
}

function getTabContextLabel(tab: TerminalTabState): string {
  return tab.kind === "ssh" ? (tab.targetLabel ?? tab.profileLabel ?? "SSH") : tab.cwd;
}

function TerminalSessionView({ tab, visible, layoutVersion, onTabUpdate, initialInput }: TerminalSessionViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const sessionIdRef = useRef<string | null>(tab.sessionId);
  const localEchoRef = useRef(false);
  const localInputLengthRef = useRef(0);
  const injectedInputIdRef = useRef<string | null>(null);
  const backendRef = useRef<TerminalBackend | null>(tab.backend);
  const tabContextLabelRef = useRef(getTabContextLabel(tab));
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const postResize = useCallback((cols: number, rows: number) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    void fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/resize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cols, rows }),
    });
  }, []);

  const fitTerminal = useCallback(() => {
    const term = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!term || !fitAddon || !visibleRef.current) return;
    try {
      fitAddon.fit();
      postResize(term.cols, term.rows);
    } catch {
      // Fitting can fail while the pane is hidden or mid-layout.
    }
  }, [postResize]);

  useEffect(() => {
    sessionIdRef.current = tab.sessionId;
  }, [tab.sessionId]);

  useEffect(() => {
    backendRef.current = tab.backend;
  }, [tab.backend]);

  useEffect(() => {
    const term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      scrollback: 5000,
      theme: getTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    if (containerRef.current) term.open(containerRef.current);
    window.setTimeout(() => {
      fitTerminal();
      if (visibleRef.current) term.focus();
    }, 0);

    const dataDisposable = term.onData((data) => {
      if (localEchoRef.current) {
        if (data === "\r") {
          localInputLengthRef.current = 0;
          term.write("\r\n");
        } else if (data === "\u007f") {
          if (localInputLengthRef.current > 0) {
            localInputLengthRef.current -= 1;
            term.write("\b \b");
          }
        } else if (data !== "\t") {
          localInputLengthRef.current += Array.from(data).length;
          term.write(data);
        }
      }
      const sessionId = sessionIdRef.current;
      if (!sessionId) return;
      void fetch(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
    });

    const resizeDisposable = term.onResize(({ cols, rows }) => postResize(cols, rows));
    const eventSourceRef = { current: null as EventSource | null };
    let disposed = false;

    const connectEvents = (sessionId: string) => {
      const events = new EventSource(`/api/terminal/sessions/${encodeURIComponent(sessionId)}/events`);
      events.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as TerminalEvent;
        if (parsed.type === "output" && typeof parsed.chunk === "string") term.write(parsed.chunk);
        if (parsed.type === "error") {
          const message = parsed.error ?? "Terminal stream error";
          onTabUpdate(tab.id, { error: message, status: "error" });
          term.writeln(`\r\n${message}`);
        }
      };
      events.onerror = () => {
        onTabUpdate(tab.id, { error: "Terminal stream disconnected", status: "error" });
        events.close();
      };
      eventSourceRef.current = events;
    };

    const start = async () => {
      try {
        onTabUpdate(tab.id, { status: "starting", error: null });
        const existingSessionId = sessionIdRef.current;
        if (existingSessionId) {
          term.writeln(tab.kind === "ssh" ? `Reconnecting SSH terminal ${tabContextLabelRef.current} ...` : `Reconnecting terminal in ${tab.cwd} ...`);
          localEchoRef.current = backendRef.current === "pipe";
          connectEvents(existingSessionId);
          onTabUpdate(tab.id, { status: "connected", error: null });
          return;
        }

        term.writeln(tab.kind === "ssh" ? `Starting SSH terminal ${tabContextLabelRef.current} ...` : `Starting terminal in ${tab.cwd} ...`);
        const createBody = tab.kind === "ssh"
          ? { kind: "ssh", cwd: tab.cwd, profileId: tab.profileId, cols: term.cols, rows: term.rows }
          : { cwd: tab.cwd, cols: term.cols, rows: term.rows };
        const res = await fetch("/api/terminal/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(createBody),
        });
        const data = await res.json() as CreateTerminalResponse;
        if (!res.ok || data.error || !data.session) throw new Error(data.error ?? `HTTP ${res.status}`);
        if (disposed) {
          deleteTerminalSession(data.session.id);
          return;
        }
        sessionIdRef.current = data.session.id;
        localEchoRef.current = data.session.backend === "pipe";
        onTabUpdate(tab.id, {
          sessionId: data.session.id,
          shell: data.session.shell,
          backend: data.session.backend,
          profileId: data.session.profileId,
          profileLabel: data.session.profileLabel,
          targetLabel: data.session.targetLabel,
          status: "connected",
          error: null,
        });
        connectEvents(data.session.id);
        if (visibleRef.current) term.focus();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        onTabUpdate(tab.id, { error: message, status: "error" });
        term.writeln(`\r\n${message}`);
      }
    };

    void start();

    const resizeObserver = new ResizeObserver(() => fitTerminal());
    if (containerRef.current) resizeObserver.observe(containerRef.current);

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      eventSourceRef.current?.close();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      localEchoRef.current = false;
      localInputLengthRef.current = 0;
      term.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [fitTerminal, onTabUpdate, postResize, tab.cwd, tab.id, tab.kind, tab.profileId]);

  useEffect(() => {
    if (!visible) return;
    window.setTimeout(() => {
      fitTerminal();
      terminalRef.current?.focus();
    }, 0);
  }, [fitTerminal, layoutVersion, visible]);

  useEffect(() => {
    if (!visible || !initialInput || injectedInputIdRef.current === initialInput.id || tab.status !== "connected" || !tab.sessionId) return;
    injectedInputIdRef.current = initialInput.id;
    void fetch(`/api/terminal/sessions/${encodeURIComponent(tab.sessionId)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: initialInput.text }),
    });
    terminalRef.current?.focus();
  }, [initialInput, tab.sessionId, tab.status, visible]);

  return (
    <div
      ref={containerRef}
      onClick={() => terminalRef.current?.focus()}
      style={{
        flex: 1,
        minHeight: 0,
        padding: 8,
        display: visible ? "block" : "none",
        background: "var(--bg)",
      }}
    />
  );
}

export function TerminalPanel({ cwd, collapsed, onToggleCollapsed, onClose, initialInput }: Props) {
  const { confirm } = usePrompt();
  const [state, dispatch] = useReducer(terminalReducer, cwd, createInitialState);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [dragPayload, setDragPayload] = useState<{ tabId: string; sourcePaneId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTargetState | null>(null);
  const [dockHeight, setDockHeight] = useState(NORMAL_DOCK_HEIGHT);
  const [fullscreen, setFullscreen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const [sshPickerOpen, setSshPickerOpen] = useState(false);
  const sessionIdsRef = useRef<string[]>([]);
  const closedExplicitlyRef = useRef(false);

  const allTabs = useMemo(() => Object.values(state.tabs), [state.tabs]);
  const activePane = findPane(state.layout, state.activePaneId) ?? findFirstPane(state.layout);
  const activeTabId = activePane.activeTabId ?? activePane.tabIds[0] ?? null;
  const activeTab = activeTabId ? state.tabs[activeTabId] : null;
  const tabCount = allTabs.length;

  useEffect(() => {
    sessionIdsRef.current = allTabs.map((tab) => tab.sessionId).filter((id): id is string => Boolean(id));
  }, [allTabs]);

  useEffect(() => {
    return () => {
      if (closedExplicitlyRef.current) return;
      for (const sessionId of sessionIdsRef.current) deleteTerminalSession(sessionId);
    };
  }, []);

  const updateTab = useCallback((tabId: string, updates: TerminalTabUpdates) => {
    dispatch({ type: "update_tab", tabId, updates });
  }, []);

  const requestLayoutFit = useCallback(() => {
    setLayoutVersion((version) => version + 1);
  }, []);

  const closeAllSessions = useCallback(() => {
    closedExplicitlyRef.current = true;
    for (const tab of Object.values(state.tabs)) deleteTerminalSession(tab.sessionId);
  }, [state.tabs]);

  const handleCloseDock = useCallback(async () => {
    const confirmed = await confirm({
      title: "Close terminal dock?",
      message: "Close the terminal dock and terminate all running terminal sessions? This cannot be restored.",
      confirmLabel: "Close dock",
      intent: "danger",
    });
    if (!confirmed) return;
    closeAllSessions();
    onClose();
  }, [closeAllSessions, confirm, onClose]);

  const addLocalTab = useCallback(() => {
    dispatch({ type: "add_tab", tab: { kind: "local", cwd } });
    setSshPickerOpen(false);
    requestLayoutFit();
  }, [cwd, requestLayoutFit]);

  const addSshTab = useCallback((profile: TerminalSshProfile) => {
    dispatch({
      type: "add_tab",
      tab: {
        kind: "ssh",
        cwd,
        profileId: profile.id,
        profileLabel: profile.label,
        targetLabel: endpointLabel(profile),
      },
    });
    requestLayoutFit();
  }, [cwd, requestLayoutFit]);

  const handleCloseTab = useCallback(async (tabId: string) => {
    const tab = state.tabs[tabId];
    if (!tab) return;
    if (tabCount <= 1) {
      const confirmed = await confirm({
        title: "Close last terminal tab?",
        message: "Close the last terminal tab and terminate its process? This will close the terminal dock.",
        confirmLabel: "Close terminal",
        intent: "danger",
      });
      if (!confirmed) return;
      closeAllSessions();
      onClose();
      return;
    }
    deleteTerminalSession(tab.sessionId);
    dispatch({ type: "close_tab", tabId });
    requestLayoutFit();
  }, [closeAllSessions, confirm, onClose, requestLayoutFit, state.tabs, tabCount]);

  const handleStartRename = useCallback((tab: TerminalTabState) => {
    setEditingTabId(tab.id);
    setEditingLabel(tab.label);
  }, []);

  const commitRename = useCallback(() => {
    if (editingTabId) dispatch({ type: "rename_tab", tabId: editingTabId, label: editingLabel });
    setEditingTabId(null);
    setEditingLabel("");
  }, [editingLabel, editingTabId]);

  const handleDockResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (fullscreen || collapsed) return;
    event.preventDefault();
    const maxHeight = Math.max(MIN_DOCK_HEIGHT, Math.floor(window.innerHeight * 0.7));
    const handlePointerMove = (moveEvent: PointerEvent) => {
      const next = clamp(window.innerHeight - moveEvent.clientY, MIN_DOCK_HEIGHT, maxHeight);
      setDockHeight(next);
      requestLayoutFit();
    };
    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }, [collapsed, fullscreen, requestLayoutFit]);

  const renderTabButton = (tabId: string, pane: TerminalPaneNode) => {
    const tab = state.tabs[tabId];
    if (!tab) return null;
    const active = pane.activeTabId === tabId;
    return (
      <div
        key={tabId}
        draggable={editingTabId !== tabId}
        onDragStart={(event) => {
          const payload = JSON.stringify({ tabId, sourcePaneId: pane.id });
          event.dataTransfer.setData("application/x-pi-terminal-tab", payload);
          event.dataTransfer.effectAllowed = "move";
          setDragPayload({ tabId, sourcePaneId: pane.id });
        }}
        onDragEnd={() => {
          setDragPayload(null);
          setDropTarget(null);
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          minWidth: 0,
          maxWidth: 180,
          height: 28,
          padding: "0 8px",
          borderRight: "1px solid var(--border)",
          borderTop: active ? "2px solid var(--accent)" : "2px solid transparent",
          background: active ? "var(--bg-selected)" : "transparent",
          color: active ? "var(--text)" : "var(--text-muted)",
          cursor: editingTabId === tabId ? "text" : "grab",
          flexShrink: 0,
        }}
        title={getTabTooltip(tab)}
        onClick={() => {
          dispatch({ type: "select_tab", paneId: pane.id, tabId });
          requestLayoutFit();
        }}
        onDoubleClick={() => handleStartRename(tab)}
      >
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: tab.status === "error" ? "#f87171" : tab.status === "connected" ? "#22c55e" : "var(--text-dim)", flexShrink: 0 }} />
        {editingTabId === tabId ? (
          <input
            autoFocus
            value={editingLabel}
            onChange={(event) => setEditingLabel(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") {
                setEditingTabId(null);
                setEditingLabel("");
              }
            }}
            style={{
              minWidth: 60,
              width: 110,
              background: "var(--bg)",
              border: "1px solid var(--accent)",
              borderRadius: 4,
              color: "var(--text)",
              fontSize: 11,
              padding: "2px 4px",
            }}
          />
        ) : (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>{tab.label}</span>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleCloseTab(tabId);
          }}
          aria-label={`Close ${tab.label}`}
          title="Close tab"
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, flexShrink: 0 }}
        >
          ×
        </button>
      </div>
    );
  };

  const renderPane = (pane: TerminalPaneNode) => {
    const paneDropTarget = dropTarget?.paneId === pane.id ? dropTarget.zone : null;
    return (
      <div
        key={pane.id}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
        }}
        onClick={() => dispatch({ type: "select_tab", paneId: pane.id, tabId: pane.activeTabId ?? pane.tabIds[0] })}
        style={{
          position: "relative",
          flex: 1,
          minWidth: MIN_PANE_WIDTH,
          minHeight: MIN_PANE_HEIGHT,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          border: state.activePaneId === pane.id ? "1px solid var(--accent)" : "1px solid var(--border)",
          background: "var(--bg)",
        }}
      >
        <div
          onDragOver={(event) => {
            if (!dragPayload) return;
            event.preventDefault();
            event.stopPropagation();
            setDropTarget({ paneId: pane.id, zone: "center" });
            event.dataTransfer.dropEffect = "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const parsed = parseDraggedTerminalTab(event.dataTransfer.getData("application/x-pi-terminal-tab"), dragPayload);
            if (!parsed) return;
            dispatch({ type: "move_tab", tabId: parsed.tabId, sourcePaneId: parsed.sourcePaneId, targetPaneId: pane.id, zone: "center" });
            setDragPayload(null);
            setDropTarget(null);
            requestLayoutFit();
          }}
          style={{ height: PANE_TAB_BAR_HEIGHT, display: "flex", alignItems: "center", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", overflowX: "auto", overflowY: "hidden", flexShrink: 0 }}
        >
          {pane.tabIds.map((tabId) => renderTabButton(tabId, pane))}
        </div>
        <div
          onDragOver={(event) => {
            if (!dragPayload) return;
            event.preventDefault();
            const intent = getContentDropIntent(event, event.currentTarget.getBoundingClientRect());
            setDropTarget({ paneId: pane.id, ...intent });
            event.dataTransfer.dropEffect = intent.disabled ? "none" : "move";
          }}
          onDrop={(event) => {
            event.preventDefault();
            const parsed = parseDraggedTerminalTab(event.dataTransfer.getData("application/x-pi-terminal-tab"), dragPayload);
            if (!parsed) return;
            const intent = getContentDropIntent(event, event.currentTarget.getBoundingClientRect());
            if (intent.disabled) {
              setDropTarget({ paneId: pane.id, ...intent });
              return;
            }
            dispatch({ type: "move_tab", tabId: parsed.tabId, sourcePaneId: parsed.sourcePaneId, targetPaneId: pane.id, zone: intent.zone });
            setDragPayload(null);
            setDropTarget(null);
            requestLayoutFit();
          }}
          style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}
        >
          {pane.tabIds.map((tabId) => {
            const tab = state.tabs[tabId];
            if (!tab) return null;
            return (
              <TerminalSessionView
                key={tabId}
                tab={tab}
                visible={!collapsed && pane.activeTabId === tabId}
                layoutVersion={layoutVersion}
                onTabUpdate={updateTab}
                initialInput={pane.activeTabId === tabId ? initialInput : null}
              />
            );
          })}
        </div>
        {paneDropTarget && (
          <div style={{
            position: "absolute",
            inset: paneDropTarget === "center" ? 18 : undefined,
            left: paneDropTarget === "left" ? 0 : paneDropTarget === "right" ? "50%" : 0,
            right: paneDropTarget === "right" ? 0 : paneDropTarget === "left" ? "50%" : 0,
            top: paneDropTarget === "center" ? undefined : paneDropTarget === "bottom" ? "50%" : PANE_TAB_BAR_HEIGHT,
            bottom: paneDropTarget === "center" ? undefined : paneDropTarget === "top" ? "50%" : 0,
            border: `2px solid ${dropTarget?.disabled ? "#f59e0b" : "var(--accent)"}`,
            background: dropTarget?.disabled ? "rgba(245,158,11,0.16)" : "rgba(59,130,246,0.12)",
            pointerEvents: "none",
            zIndex: 5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: dropTarget?.disabled ? "#fbbf24" : "var(--accent)",
            fontSize: 12,
            fontWeight: 700,
            textShadow: "0 1px 2px rgba(0,0,0,0.35)",
          }}>{dropTarget?.disabled ? dropTarget.message : null}</div>
        )}
      </div>
    );
  };

  const renderLayout = (node: TerminalLayoutNode): React.ReactNode => {
    if (node.kind === "pane") return renderPane(node);

    const direction = node.direction;
    return (
      <div key={node.id} style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: direction === "horizontal" ? "row" : "column", overflow: "hidden" }}>
        <div style={{ flex: `0 0 ${node.ratio * 100}%`, minWidth: 0, minHeight: 0, display: "flex", overflow: "hidden" }}>{renderLayout(node.first)}</div>
        <div
          onPointerDown={(event) => {
            event.preventDefault();
            const container = event.currentTarget.parentElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const handlePointerMove = (moveEvent: PointerEvent) => {
              const size = direction === "horizontal" ? rect.width : rect.height;
              const pointer = direction === "horizontal" ? moveEvent.clientX - rect.left : moveEvent.clientY - rect.top;
              const minPx = direction === "horizontal" ? MIN_PANE_WIDTH : MIN_PANE_HEIGHT;
              const minRatio = clamp(minPx / Math.max(size, 1), 0.05, 0.45);
              dispatch({ type: "resize_split", splitId: node.id, ratio: clamp(pointer / Math.max(size, 1), minRatio, 1 - minRatio) });
              requestLayoutFit();
            };
            const handlePointerUp = () => {
              window.removeEventListener("pointermove", handlePointerMove);
              window.removeEventListener("pointerup", handlePointerUp);
            };
            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", handlePointerUp);
          }}
          style={{
            flex: "0 0 8px",
            cursor: direction === "horizontal" ? "col-resize" : "row-resize",
            background: "var(--bg-panel)",
            borderLeft: direction === "horizontal" ? "1px solid var(--border)" : "none",
            borderRight: direction === "horizontal" ? "1px solid var(--border)" : "none",
            borderTop: direction === "vertical" ? "1px solid var(--border)" : "none",
            borderBottom: direction === "vertical" ? "1px solid var(--border)" : "none",
            zIndex: 4,
          }}
          title="Resize panes"
        />
        <div style={{ flex: `0 0 ${(1 - node.ratio) * 100}%`, minWidth: 0, minHeight: 0, display: "flex", overflow: "hidden" }}>{renderLayout(node.second)}</div>
      </div>
    );
  };

  const shellLabel = activeTab?.shell ? `${activeTab.shell}${activeTab.backend && activeTab.backend !== "pty" ? ` · ${activeTab.backend}` : ""}` : null;
  const activeContextLabel = activeTab ? getTabContextLabel(activeTab) : cwd;
  const rootStyle: React.CSSProperties = fullscreen
    ? { position: "fixed", inset: 0, zIndex: 650, height: "100dvh" }
    : { height: collapsed ? HEADER_HEIGHT : dockHeight, minHeight: collapsed ? HEADER_HEIGHT : MIN_DOCK_HEIGHT };

  return (
    <div className={`terminal-panel-root${fullscreen ? " terminal-panel-fullscreen" : ""}${collapsed ? " terminal-panel-collapsed" : ""}`} style={{ ...rootStyle, position: "relative", borderTop: "1px solid var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
      {!collapsed && !fullscreen && (
        <div
          onPointerDown={handleDockResizePointerDown}
          title="Resize terminal dock"
          style={{ height: 6, marginTop: -3, cursor: "row-resize", flexShrink: 0, background: "transparent" }}
        />
      )}
      <div style={{ height: HEADER_HEIGHT, display: "flex", alignItems: "center", gap: 10, padding: "0 10px", borderBottom: collapsed ? "none" : "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        <button
          type="button"
          onClick={() => {
            onToggleCollapsed();
            window.setTimeout(requestLayoutFit, 0);
          }}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12, padding: "4px 6px" }}
          title={collapsed ? "展开终端" : "折叠终端"}
        >
          {collapsed ? "▴" : "▾"}
        </button>
        <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 700 }}>Terminal</span>
        <span title={activeContextLabel} style={{ minWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>{activeContextLabel}</span>
        <button
          type="button"
          onClick={addLocalTab}
          style={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer", borderRadius: 6, fontSize: 12, lineHeight: 1, padding: "5px 8px" }}
          title="New local terminal tab"
        >
          + Local
        </button>
        <button
          type="button"
          onClick={() => setSshPickerOpen((value) => !value)}
          style={{ background: sshPickerOpen ? "var(--bg-selected)" : "var(--bg)", border: "1px solid var(--border)", color: "var(--text)", cursor: "pointer", borderRadius: 6, fontSize: 12, lineHeight: 1, padding: "5px 8px" }}
          title="Open SSH profile"
        >
          SSH ▾
        </button>
        {shellLabel && <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto", fontFamily: "var(--font-mono)" }}>{shellLabel}</span>}
        <span style={{ fontSize: 11, color: activeTab?.status === "error" ? "#f87171" : activeTab?.status === "connected" ? "#22c55e" : "var(--text-dim)", marginLeft: shellLabel ? 0 : "auto" }}>{activeTab?.status ?? "starting"}</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{tabCount} tab{tabCount === 1 ? "" : "s"}</span>
        <button
          type="button"
          onClick={() => {
            setFullscreen((value) => !value);
            window.setTimeout(requestLayoutFit, 0);
          }}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "2px 6px" }}
          title={fullscreen ? "Exit terminal fullscreen" : "Maximize terminal in app"}
        >
          {fullscreen ? "🗗" : "🗖"}
        </button>
        <button
          type="button"
          onClick={handleCloseDock}
          style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: "2px 6px" }}
          title="关闭终端并结束所有进程"
        >
          ×
        </button>
      </div>
      <TerminalSshProfilePicker open={!collapsed && sshPickerOpen} onClose={() => setSshPickerOpen(false)} onOpenProfile={addSshTab} />
      {!collapsed && activeTab?.error && <div style={{ padding: "6px 10px", background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, borderBottom: "1px solid var(--border)", overflowWrap: "anywhere" }}>{activeTab.error}</div>}
      {!collapsed && (
        <div style={{ flex: 1, minHeight: 0, padding: 8, display: "flex", overflow: "hidden", background: "var(--bg-subtle)" }}>
          {renderLayout(state.layout)}
        </div>
      )}
    </div>
  );
}
