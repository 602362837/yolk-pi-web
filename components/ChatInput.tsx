"use client";

import React, { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef, useMemo } from "react";
import type { SlashCommandEntry } from "@/app/api/commands/route";
import type { AttachedFile, FileReference } from "@/lib/types";
import { encodeFilePathForApi, getFileName, getRelativeFilePath, joinFilePath } from "@/lib/file-paths";

export interface AttachedImage {
  data: string;   // base64, no prefix
  mimeType: string;
  previewUrl: string; // object URL for display
}

interface ModelOption {
  provider: string;
  modelId: string;
  name: string;
}

interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  cwd?: string | null;
  onAbort: () => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  model?: { provider: string; modelId: string } | null;
  modelNames?: Record<string, string>;
  modelList?: { id: string; name: string; provider: string }[];
  onModelChange?: (provider: string, modelId: string) => void;
  onCompact?: () => void;
  onAbortCompaction?: () => void;
  isCompacting?: boolean;
  compactError?: string | null;
  toolPreset?: "none" | "default" | "full" | "subagent";
  onToolPresetChange?: (preset: "none" | "default" | "full" | "subagent") => void;
  thinkingLevel?: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  onThinkingLevelChange?: (level: "auto" | "off" | "minimal" | "low" | "medium" | "high" | "xhigh") => void;
  availableThinkingLevels?: string[] | null;
  thinkingLevelMap?: Record<string, string | null> | null;
  retryInfo?: { attempt: number; maxAttempts: number; errorMessage?: string } | null;
  soundEnabled?: boolean;
  onSoundToggle?: () => void;
}

export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  addFileReference: (relativePath: string, lines?: { startLine: number; endLine: number }) => void;
}

const TOOL_PRESETS = ["off", "default", "full", "subagent"] as const;
const TOOL_PRESET_MAP: Record<"off" | "default" | "full" | "subagent", "none" | "default" | "full" | "subagent"> = { off: "none", default: "default", full: "full", subagent: "subagent" };
const COMPOSITION_END_ENTER_GRACE_MS = 100;

const THINKING_LEVELS = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"] as const;
const MAX_SLASH_COMMANDS = 8;

interface SlashCommandMatch {
  start: number;
  query: string;
}

interface SlashCommandOption extends SlashCommandEntry {
  priority: number;
}

interface AtMatch {
  start: number;
  query: string;
}

interface FileSuggestion {
  name: string;
  fullPath: string;
  isDir: boolean;
}

/**
 * 解析光标前是否处于斜杠命令输入状态。
 *
 * @param value - 输入框完整文本。
 * @param caretIndex - 当前光标位置。
 * @returns 匹配到的命令起点与查询文本；否则返回 null。
 */
function getSlashCommandMatch(value: string, caretIndex: number): SlashCommandMatch | null {
  const beforeCursor = value.slice(0, caretIndex);
  const lineStart = Math.max(beforeCursor.lastIndexOf("\n") + 1, 0);
  const currentLineBeforeCursor = beforeCursor.slice(lineStart);
  const match = currentLineBeforeCursor.match(/^(\s*)\/([^\s]*)$/);
  if (!match) return null;
  return { start: lineStart + match[1].length, query: match[2] };
}

/**
 * 解析光标前是否处于 @ 文件引用输入状态。
 *
 * @param value - 输入框完整文本。
 * @param caretIndex - 当前光标位置。
 * @returns 匹配到的命令起点与查询文本；否则返回 null。
 */
function getAtMatch(value: string, caretIndex: number): AtMatch | null {
  const beforeCursor = value.slice(0, caretIndex);
  const atIndex = beforeCursor.lastIndexOf("@");
  if (atIndex === -1) return null;

  // Only trigger when @ is at word boundary (after space, newline, etc.)
  if (atIndex > 0) {
    const prev = beforeCursor[atIndex - 1];
    if (prev !== " " && prev !== "\n" && prev !== "\t" && prev !== "(" && prev !== "[" && prev !== "{" && prev !== ">" && prev !== ":" && prev !== "`") {
      return null;
    }
  }

  const afterAt = beforeCursor.slice(atIndex + 1);
  const spaceMatch = afterAt.match(/^([^\s\n]*)/);
  const query = spaceMatch ? spaceMatch[1] : "";

  return { start: atIndex, query };
}

/**
 * 按当前查询过滤文件建议：解析 query 中的目录路径与文件名前缀，过滤出匹配的文件。
 */
function filterAtSuggestions(entries: FileSuggestion[], query: string): FileSuggestion[] {
  const lastSlash = query.lastIndexOf("/");
  const prefix = lastSlash === -1 ? query : query.slice(lastSlash + 1);
  if (!prefix) return entries;
  const lowerPrefix = prefix.toLowerCase();
  return entries.filter((e) => e.name.toLowerCase().includes(lowerPrefix));
}

/**
 * 按当前查询过滤并排序斜杠命令。
 *
 * @param commands - 服务端发现的 skills 与 prompt templates。
 * @param query - 用户在斜杠后输入的查询文本。
 * @returns 已排序的候选命令，优先精确前缀，同时保留模板可见性。
 */
function filterSlashCommands(commands: SlashCommandEntry[], query: string): SlashCommandOption[] {
  const normalizedQuery = query.toLowerCase();
  const skillPrefixQuery = normalizedQuery.startsWith("skill:");

  return commands
    .map((command): SlashCommandOption | null => {
      const name = command.name.toLowerCase();
      const bareSkillName = command.source === "skill" ? name.replace(/^skill:/, "") : name;

      if (!normalizedQuery) return { ...command, priority: command.source === "prompt" ? 0 : 1 };
      if (skillPrefixQuery) {
        return name.startsWith(normalizedQuery) ? { ...command, priority: 0 } : null;
      }
      if (command.source === "prompt" && name.startsWith(normalizedQuery)) return { ...command, priority: 0 };
      if (command.source === "skill" && bareSkillName.startsWith(normalizedQuery)) return { ...command, priority: 1 };
      if (command.source === "prompt" && name.includes(normalizedQuery)) return { ...command, priority: 2 };
      if (command.source === "skill" && bareSkillName.includes(normalizedQuery)) return { ...command, priority: 3 };
      return null;
    })
    .filter((command): command is SlashCommandOption => command !== null)
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.source !== b.source) return a.source === "prompt" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SLASH_COMMANDS);
}

const THINKING_LEVEL_DESC: Record<typeof THINKING_LEVELS[number], string> = {
  auto: "沿用 pi 默认设置",
  off: "关闭推理",
  minimal: "最少推理",
  low: "低强度推理",
  medium: "中等推理",
  high: "高强度推理",
  xhigh: "最高强度推理",
};

function chipInsertAtCursor(container: HTMLElement, relativePath: string, lines?: { startLine: number; endLine: number }): void {
  const chip = document.createElement("span");
  chip.contentEditable = "false";
  chip.dataset.chip = "file-ref";
  chip.dataset.relativePath = relativePath;
  if (lines) {
    chip.dataset.startLine = String(lines.startLine);
    chip.dataset.endLine = String(lines.endLine);
  }
  const displayText = `${getFileName(relativePath)}${lines ? `:${lines.startLine}-${lines.endLine}` : ""}`;
  chip.textContent = displayText;
  chip.style.cssText = [
    "display: inline-block",
    "padding: 0 6px",
    "border-radius: 4px",
    "background: var(--accent)",
    "color: #fff",
    "font-size: 12px",
    "font-family: var(--font-mono)",
    "line-height: 1.6",
    "cursor: default",
    "user-select: none",
    "vertical-align: baseline",
  ].join("; ");

  const wasFocused = document.activeElement === container;
  container.focus();
  const sel = window.getSelection();

  if (!wasFocused || !sel || !sel.rangeCount) {
    // Container wasn't focused (e.g. Add Chat from file viewer): append to end
    const spaceBefore = container.lastChild?.nodeType === Node.TEXT_NODE &&
      (container.lastChild.textContent ?? "").length > 0 &&
      !(container.lastChild.textContent ?? "").endsWith(" ");
    if (spaceBefore) container.appendChild(document.createTextNode(" "));
    container.appendChild(chip);
    container.appendChild(document.createTextNode(" "));
    // Move cursor after the newly appended content
    const r = document.createRange();
    r.selectNodeContents(container);
    r.collapse(false);
    sel?.removeAllRanges();
    sel?.addRange(r);
  } else {
    // Already had focus: insert at current cursor position
    const range = sel.getRangeAt(0);

    // If the cursor is on a text node, check for a space separator before inserting
    if (range.startContainer.nodeType === Node.TEXT_NODE) {
      const beforeText = (range.startContainer.textContent ?? "").slice(0, range.startOffset);
      if (beforeText.length > 0 && !beforeText.endsWith(" ")) {
        const space = document.createTextNode(" ");
        range.insertNode(space);
        range.setStartAfter(space);
        range.collapse(true);
      }
    }

    range.deleteContents();
    range.insertNode(chip);
    range.setStartAfter(chip);
    range.collapse(true);

    sel.removeAllRanges();
    sel.addRange(range);
  }
}

function getTextBeforeCursor(container: Node): string {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return "";
  const range = sel.getRangeAt(0);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
  let text = "";
  let node: Node | null;
  while ((node = walker.nextNode()) !== null) {
    if (node === range.startContainer) {
      text += (node.textContent ?? "").slice(0, range.startOffset);
      break;
    }
    text += node.textContent ?? "";
  }
  return text;
}

function serializeNodes(nodes: NodeListOf<ChildNode>): string {
  let text = "";
  for (const node of nodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node instanceof HTMLElement && node.dataset.chip === "file-ref") {
      const path = node.dataset.relativePath ?? "";
      const start = node.dataset.startLine;
      const end = node.dataset.endLine;
      if (start && end) {
        text += `\`${path} [line ${start}-${end}]\``;
      } else {
        text += `\`${path}\``;
      }
    } else if (node instanceof HTMLElement) {
      text += serializeNodes(node.childNodes);
    }
  }
  return text;
}

function hasContent(el: HTMLElement): boolean {
  const text = el.textContent ?? "";
  if (text.trim().length > 0) return true;
  return el.querySelector('[data-chip]') !== null;
}

export const ChatInput = forwardRef<ChatInputHandle, Props>(function ChatInput({
  onSend, cwd, onAbort, onSteer, onFollowUp, isStreaming, model, modelNames, modelList, onModelChange,
  onCompact, onAbortCompaction, isCompacting, compactError, toolPreset, onToolPresetChange,
  thinkingLevel, onThinkingLevelChange, availableThinkingLevels, thinkingLevelMap,
  retryInfo,
  soundEnabled, onSoundToggle,
}: Props, ref) {
  const [slashCommands, setSlashCommands] = useState<SlashCommandEntry[]>([]);
  const [slashCommandsLoading, setSlashCommandsLoading] = useState(false);
  const [slashCommandsError, setSlashCommandsError] = useState<string | null>(null);
  const [slashSelectedIndex, setSlashSelectedIndex] = useState(0);
  const [slashDismissedKey, setSlashDismissedKey] = useState<string | null>(null);
  const [atSuggestions, setAtSuggestions] = useState<FileSuggestion[]>([]);
  const [atSuggestionsLoading, setAtSuggestionsLoading] = useState(false);
  const [atSuggestionsError, setAtSuggestionsError] = useState<string | null>(null);
  const [atSelectedIndex, setAtSelectedIndex] = useState(0);
  const [atDismissedKey, setAtDismissedKey] = useState<string | null>(null);
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [modelDropdownRect, setModelDropdownRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const [toolDropdownOpen, setToolDropdownOpen] = useState(false);
  const [thinkingDropdownOpen, setThinkingDropdownOpen] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);

  const inputRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const modelDropdownPanelRef = useRef<HTMLDivElement>(null);
  const toolDropdownRef = useRef<HTMLDivElement>(null);
  const thinkingDropdownRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);

  // DOM-based: text before cursor, synced on every input/selection change
  const [beforeCursorText, setBeforeCursorText] = useState("");
  const [hasEditorContent, setHasEditorContent] = useState(false);

  const syncFromDom = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const beforeText = getTextBeforeCursor(el);
    setBeforeCursorText(beforeText);
    setHasEditorContent(hasContent(el));
  }, []);

  const slashMatch = useMemo(() => getSlashCommandMatch(beforeCursorText, beforeCursorText.length), [beforeCursorText]);
  const slashMatchKey = slashMatch ? `${slashMatch.start}:${slashMatch.query}` : null;
  const filteredSlashCommands = useMemo(() => {
    if (!slashMatch) return [];
    return filterSlashCommands(slashCommands, slashMatch.query);
  }, [slashCommands, slashMatch]);
  const slashMenuVisible = Boolean(
    slashMatch &&
    slashMatchKey !== slashDismissedKey &&
    (filteredSlashCommands.length > 0 || slashCommandsLoading || slashCommandsError)
  );

  const atMatch = useMemo(() => getAtMatch(beforeCursorText, beforeCursorText.length), [beforeCursorText]);
  const atMatchKey = atMatch ? `${atMatch.start}:${atMatch.query}` : null;
  const atMenuVisible = Boolean(
    atMatch &&
    atMatchKey !== atDismissedKey &&
    cwd &&
    (atSuggestions.length > 0 || atSuggestionsLoading || atSuggestionsError)
  );

  useEffect(() => {
    setSlashSelectedIndex(0);
  }, [slashMatch?.query, filteredSlashCommands.length]);

  useEffect(() => {
    setAtSelectedIndex(0);
  }, [atMatch?.query, atSuggestions.length]);

  useEffect(() => {
    if (!cwd) {
      setSlashCommands([]);
      setSlashCommandsLoading(false);
      setSlashCommandsError(null);
      return;
    }

    const controller = new AbortController();
    setSlashCommandsLoading(true);
    setSlashCommandsError(null);
    fetch(`/api/commands?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal })
      .then(async (res) => {
        const data = await res.json() as { commands?: SlashCommandEntry[]; error?: string };
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setSlashCommands(data.commands ?? []);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setSlashCommands([]);
        setSlashCommandsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setSlashCommandsLoading(false);
      });

    return () => controller.abort();
  }, [cwd]);

  // @-mention：当 atMatch 变化时获取文件列表
  // - 查询含 "/" → 目录浏览模式，只列当前目录内容
  // - 查询为空    → 显示根目录文件
  // - 查询无 "/"  → 递归搜索整个项目（文件名前缀匹配）
  useEffect(() => {
    if (!atMatch || !cwd) {
      setAtSuggestions([]);
      setAtSuggestionsLoading(false);
      setAtSuggestionsError(null);
      return;
    }

    setAtSuggestions([]);
    const query = atMatch.query;
    const hasSlash = query.includes("/");

    const controller = new AbortController();
    setAtSuggestionsLoading(true);
    setAtSuggestionsError(null);

    if (hasSlash) {
      // ── 目录浏览模式 ──
      const lastSlash = query.lastIndexOf("/");
      const targetDir = joinFilePath(cwd, query.slice(0, lastSlash));
      const encoded = encodeFilePathForApi(targetDir);
      fetch(`/api/files/${encoded}?type=list`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as { entries?: { name: string; isDir: boolean; size: number; modified: string }[] };
          if (controller.signal.aborted) return;
          const entries = (data.entries ?? []).map((e) => ({
            name: e.name,
            fullPath: joinFilePath(targetDir, e.name),
            isDir: e.isDir,
          }));
          const filtered = filterAtSuggestions(entries, query);
          setAtSuggestions(filtered);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setAtSuggestions([]);
          setAtSuggestionsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setAtSuggestionsLoading(false);
        });
    } else if (!query) {
      // ── 空查询：显示根目录文件 + 文件夹 ──
      const encoded = encodeFilePathForApi(cwd);
      fetch(`/api/files/${encoded}?type=list`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as { entries?: { name: string; isDir: boolean; size: number; modified: string }[] };
          if (controller.signal.aborted) return;
          const entries = (data.entries ?? []).map((e) => ({
            name: e.name,
            fullPath: joinFilePath(cwd, e.name),
            isDir: e.isDir,
          }));
          setAtSuggestions(entries);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setAtSuggestions([]);
          setAtSuggestionsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setAtSuggestionsLoading(false);
        });
    } else {
      // ── 递归搜索模式：跨目录查找文件名匹配的文件 ──
      fetch(`/api/files/search?cwd=${encodeURIComponent(cwd)}&prefix=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json() as { files: { name: string; fullPath: string; relativePath: string }[]; total: number };
          if (controller.signal.aborted) return;
          const suggestions = data.files.map((f) => ({
            name: f.relativePath,  // 显示相对路径，帮助区分同名文件
            fullPath: f.fullPath,
            isDir: false,
          }));
          setAtSuggestions(suggestions);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setAtSuggestions([]);
          setAtSuggestionsError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setAtSuggestionsLoading(false);
        });
    }

    return () => controller.abort();
  }, [atMatch, cwd]);

  const resizeInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, []);

  /** Insert text into the contentEditable div at the current cursor position. */
  const insertTextAtCursor = useCallback((text: string, addSpaceSep = true) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) {
      el.appendChild(document.createTextNode(text));
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
      syncFromDom();
      return;
    }
    const range = sel.getRangeAt(0);
    if (addSpaceSep && range.startContainer.nodeType === Node.TEXT_NODE) {
      const beforeText = (range.startContainer.textContent ?? "").slice(0, range.startOffset);
      if (beforeText.length > 0 && !beforeText.endsWith(" ")) {
        range.insertNode(document.createTextNode(" "));
        range.setStartAfter(range.endContainer);
        range.collapse(true);
      }
    }
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    syncFromDom();
    resizeInput();
  }, [syncFromDom]);

  const insertSlashCommand = useCallback((command: SlashCommandEntry) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    const slashIdx = text.lastIndexOf("/", offset - 1);
    if (slashIdx === -1) return;

    const insertion = `/${command.name} `;
    node.textContent = text.slice(0, slashIdx) + insertion + text.slice(offset);
    const newOffset = slashIdx + insertion.length;
    range.setStart(node, newOffset);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    setSlashDismissedKey(null);
    syncFromDom();
    resizeInput();
  }, [syncFromDom]);

  const insertAtMention = useCallback((suggestion: FileSuggestion) => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();

    if (suggestion.isDir) {
      // Navigate into directory: replace @query with @dirname/
      const sel = window.getSelection();
      if (!sel || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const node = range.startContainer;
      if (node.nodeType !== Node.TEXT_NODE) return;
      const text = node.textContent ?? "";
      const offset = range.startOffset;
      const atIdx = text.lastIndexOf("@", offset - 1);
      if (atIdx === -1) return;

      const insertion = `@${suggestion.name}/`;
      node.textContent = text.slice(0, atIdx) + insertion + text.slice(offset);
      const newOffset = atIdx + insertion.length;
      range.setStart(node, newOffset);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      setAtDismissedKey(null);
      syncFromDom();
      resizeInput();
      return;
    }

    // Insert as a file reference chip — first remove the @query text
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    const node = range.startContainer;
    if (node.nodeType !== Node.TEXT_NODE) return;
    const text = node.textContent ?? "";
    const offset = range.startOffset;
    const atIdx = text.lastIndexOf("@", offset - 1);
    if (atIdx === -1) {
      // Fallback: just insert at cursor without removing @
      const relativePath = getRelativeFilePath(suggestion.fullPath, cwd ?? undefined);
      chipInsertAtCursor(el, relativePath);
    } else {
      // Remove the @query text first, then insert chip
      node.textContent = text.slice(0, atIdx) + text.slice(offset);
      const relativePath = getRelativeFilePath(suggestion.fullPath, cwd ?? undefined);
      // Set cursor at the @ position and use chipInsertAtCursor
      range.setStart(node, atIdx);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      chipInsertAtCursor(el, relativePath);
    }
    setAtDismissedKey(null);
    syncFromDom();
    resizeInput();
  }, [syncFromDom, cwd]);

  useImperativeHandle(ref, () => ({
    insertIfEmpty(text: string) {
      const el = inputRef.current;
      if (!el) return;
      if (hasContent(el)) return;
      el.textContent = text;
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      syncFromDom();
      resizeInput();
    },
    insertText(text: string) {
      insertTextAtCursor(text);
    },
    addImages(files: File[]) {
      processImageFiles(files);
    },
    addFiles(files: File[]) {
      processFileUploads(files);
    },
    addFileReference(relativePath: string, lines?: { startLine: number; endLine: number }) {
      const el = inputRef.current;
      if (!el) return;
      chipInsertAtCursor(el, relativePath, lines);
      syncFromDom();
      resizeInput();
    },
  }));

  const processImageFiles = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith("image/"));
    if (!imageFiles.length) return;
    const newImages = await Promise.all(
      imageFiles.map(
        (file) =>
          new Promise<AttachedImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              // result is "data:<mime>;base64,<data>"
              const base64 = result.split(",")[1];
              resolve({ data: base64, mimeType: file.type, previewUrl: URL.createObjectURL(file) });
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
          })
      )
    );
    setAttachedImages((prev) => [...prev, ...newImages]);
  }, []);

  const removeImage = useCallback((index: number) => {
    setAttachedImages((prev) => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].previewUrl);
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearImages = useCallback(() => {
    setAttachedImages((prev) => {
      prev.forEach((img) => URL.revokeObjectURL(img.previewUrl));
      return [];
    });
  }, []);

    // ── File attachment ──

  const uploadFile = useCallback(async (file: File): Promise<AttachedFile | null> => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/files/upload", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        console.error("File upload failed:", err.error);
        return null;
      }
      const data = await res.json() as { name: string; path: string; size: number };
      return { name: data.name, size: data.size, path: data.path };
    } catch (e) {
      console.error("File upload error:", e);
      return null;
    }
  }, []);

  const processFileUploads = useCallback(async (files: File[]) => {
    const textFiles = files.filter((f) => !f.type.startsWith("image/"));
    if (!textFiles.length) return;
    setUploadingFiles(true);
    const results: AttachedFile[] = [];
    for (const file of textFiles) {
      const result = await uploadFile(file);
      if (result) results.push(result);
    }
    if (results.length > 0) {
      setAttachedFiles((prev) => [...prev, ...results]);
    }
    setUploadingFiles(false);
  }, [uploadFile]);

  const removeFile = useCallback((index: number) => {
    setAttachedFiles((prev) => {
      const next = [...prev];
      next.splice(index, 1);
      return next;
    });
  }, []);

  const clearFiles = useCallback(() => {
    setAttachedFiles([]);
  }, []);

  const clearInput = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.textContent = "";
  }, []);

  /** Build the final message: serialize the contentEditable div + append attached files/images. */
  const buildFinalMessage = useCallback((): string => {
    const parts: string[] = [];

    // Content from the contentEditable div (text + inline file chips)
    const el = inputRef.current;
    if (el) {
      const inputText = serializeNodes(el.childNodes);
      if (inputText) parts.push(inputText);
    }

    // Attached files: name + size + path
    if (attachedFiles.length > 0) {
      const fileText = attachedFiles.map((f) => {
        const sizeStr = f.size < 1024 ? `${f.size} B` : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`;
        return `📎 ${f.name} (${sizeStr}) — \`${f.path}\``;
      }).join("\n");
      parts.push(fileText);
    }

    return parts.join("\n\n");
  }, [attachedFiles]);

  const sendActive = useCallback((): boolean => {
    if (attachedImages.length > 0 || attachedFiles.length > 0) return true;
    const el = inputRef.current;
    if (!el) return false;
    return hasContent(el);
  }, [attachedImages, attachedFiles]);

  const clearEditor = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.textContent = "";
    el.style.height = "auto";
    setSlashDismissedKey(null);
    setAtDismissedKey(null);
    clearImages();
    clearFiles();
    syncFromDom();
  }, [clearImages, clearFiles, syncFromDom]);

  const handleSend = useCallback(() => {
    if (!sendActive()) return;
    if (isStreaming) return;
    const finalMsg = buildFinalMessage();
    onSend(finalMsg, attachedImages.length ? attachedImages : undefined);
    clearEditor();
  }, [sendActive, isStreaming, onSend, attachedImages, buildFinalMessage, clearEditor]);

  const sendQueued = useCallback((mode: "steer" | "followup") => {
    if (!sendActive()) return;
    const finalMsg = buildFinalMessage();
    if (mode === "steer" && onSteer) {
      onSteer(finalMsg, attachedImages.length ? attachedImages : undefined);
    } else if (mode === "followup" && onFollowUp) {
      onFollowUp(finalMsg, attachedImages.length ? attachedImages : undefined);
    }
    clearEditor();
  }, [syncFromDom, onSteer, onFollowUp, attachedImages, attachedFiles, buildFinalMessage, clearEditor]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const nativeEvent = e.nativeEvent;
      const recentlyComposed = Date.now() - lastCompositionEndAtRef.current < COMPOSITION_END_ENTER_GRACE_MS;
      const isComposing =
        isComposingRef.current ||
        nativeEvent.isComposing ||
        nativeEvent.keyCode === 229;

      if (e.key === "Enter" && !e.shiftKey && (isComposing || recentlyComposed)) {
        if (recentlyComposed) e.preventDefault();
        return;
      }

      // @-mention menu
      if (atMenuVisible && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setAtSelectedIndex((i) => Math.min(i + 1, Math.max(atSuggestions.length - 1, 0)));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setAtSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          const selected = atSuggestions[Math.min(atSelectedIndex, atSuggestions.length - 1)];
          if (selected?.isDir) {
            insertAtMention(selected);
          }
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          const selected = atSuggestions[Math.min(atSelectedIndex, atSuggestions.length - 1)];
          if (selected) {
            insertAtMention(selected);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setAtDismissedKey(atMatchKey);
          return;
        }
      }

      if (slashMenuVisible && !isComposing) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSlashSelectedIndex((i) => Math.min(i + 1, Math.max(filteredSlashCommands.length - 1, 0)));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSlashSelectedIndex((i) => Math.max(i - 1, 0));
          return;
        }
        if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
          e.preventDefault();
          const selected = filteredSlashCommands[Math.min(slashSelectedIndex, filteredSlashCommands.length - 1)];
          if (selected) {
            insertSlashCommand(selected);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSlashDismissedKey(slashMatchKey);
          return;
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (isStreaming && (onSteer || onFollowUp)) {
          // Default Enter sends as steer if available, else followup
          sendQueued(onSteer ? "steer" : "followup");
        } else {
          handleSend();
        }
      }
    },
    [isStreaming, onSteer, onFollowUp, sendQueued, handleSend, atMenuVisible, atSuggestions, atSelectedIndex, insertAtMention, atMatchKey, slashMenuVisible, filteredSlashCommands, slashSelectedIndex, insertSlashCommand, slashMatchKey]
  );

  const handleInput = useCallback(() => {
    syncFromDom();
    resizeInput();
  }, [syncFromDom, resizeInput]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = Array.from(e.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.type.startsWith("image/"));
    if (imageItems.length > 0) {
      e.preventDefault();
      const files = imageItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      processImageFiles(files);
    }
    // Handle non-image file pastes (e.g. files copied from Finder)
    const fileItems = items.filter((item) => item.kind === "file" && !item.type.startsWith("image/"));
    if (fileItems.length > 0) {
      e.preventDefault();
      const files = fileItems.map((item) => item.getAsFile()).filter((f): f is File => f !== null);
      processFileUploads(files);
    }
  }, [processImageFiles, processFileUploads]);



  // Build model options: prefer modelList (has provider info), fallback to modelNames
  const modelOptions: ModelOption[] = (() => {
    if (modelList && modelList.length > 0) {
      return modelList.map((m) => ({ provider: m.provider, modelId: m.id, name: m.name }));
    }
    return Object.entries(modelNames ?? {}).map(([modelId, name]) => ({
      provider: model?.provider ?? "unknown",
      modelId,
      name,
    }));
  })();

  // Group options by provider, preserving insertion order
  const modelsByProvider: { provider: string; options: ModelOption[] }[] = [];
  for (const opt of modelOptions) {
    const group = modelsByProvider.find((g) => g.provider === opt.provider);
    if (group) group.options.push(opt);
    else modelsByProvider.push({ provider: opt.provider, options: [opt] });
  }

  const currentName = model
    ? (modelOptions.find((o) => o.modelId === model.modelId && o.provider === model.provider)?.name ?? model.modelId)
    : modelOptions.length > 0 ? modelOptions[0].name : null;

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        modelDropdownPanelRef.current && !modelDropdownPanelRef.current.contains(e.target as Node)
      ) {
        setModelDropdownOpen(false);
      }
      if (toolDropdownRef.current && !toolDropdownRef.current.contains(e.target as Node)) {
        setToolDropdownOpen(false);
      }
      if (thinkingDropdownRef.current && !thinkingDropdownRef.current.contains(e.target as Node)) {
        setThinkingDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);



  return (
    <div
      style={{
        flexShrink: 0,
        background: "transparent",
        padding: "0 16px 8px",
        paddingRight: 52, // 16px base + 36px for ChatMinimap alignment
      }}
    >
      {/* Hidden file inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processImageFiles(files);
          e.target.value = "";
        }}
      />
      <input
        ref={filePickerRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          processFileUploads(files);
          e.target.value = "";
        }}
      />
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        {/* Retry banner */}
        {retryInfo && (
          <div style={{
            marginBottom: 8, padding: "5px 10px",
            background: "rgba(234,179,8,0.08)", border: "1px solid rgba(234,179,8,0.25)",
            borderRadius: 6, fontSize: 12, color: "rgba(180,130,0,0.9)",
            display: "flex", alignItems: "center", gap: 6,
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            Retrying ({retryInfo.attempt}/{retryInfo.maxAttempts})…{retryInfo.errorMessage && <span style={{ opacity: 0.7, marginLeft: 4 }}>— {retryInfo.errorMessage}</span>}
          </div>
        )}
        {/* Image previews */}
        {attachedImages.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedImages.map((img, i) => (
              <div key={i} style={{ position: "relative", flexShrink: 0 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.previewUrl}
                  alt=""
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)", display: "block" }}
                />
                <button
                  onClick={() => removeImage(i)}
                  style={{
                    position: "absolute", top: -4, right: -4,
                    width: 16, height: 16, borderRadius: "50%",
                    background: "var(--bg-panel)", border: "1px solid var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)",
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* File chips */}
        {attachedFiles.length > 0 && (
          <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
            {attachedFiles.map((f, i) => (
              <div
                key={i}
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "4px 8px 4px 6px",
                  background: "var(--bg-panel)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                  lineHeight: 1.3,
                }}
              >
                {/* Unified file icon */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                <span style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 180 }}>
                  {f.name}
                </span>
                <span style={{ color: "var(--text-dim)", whiteSpace: "nowrap", flexShrink: 0 }}>
                  {f.size < 1024 ? `${f.size} B` : f.size < 1024 * 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${(f.size / (1024 * 1024)).toFixed(1)} MB`}
                </span>
                <button
                  onClick={() => removeFile(i)}
                  style={{
                    width: 14, height: 14, borderRadius: "50%",
                    background: "none", border: "none",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    cursor: "pointer", padding: 0, color: "var(--text-muted)", flexShrink: 0,
                  }}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <line x1="1" y1="1" x2="7" y2="7" /><line x1="7" y1="1" x2="1" y2="7" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Main input */}
        <div
          style={{
            position: "relative",
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "var(--bg)",
            border: `1px solid ${isStreaming && (onSteer || onFollowUp)
              ? "rgba(234,179,8,0.4)"
              : "color-mix(in srgb, var(--border) 70%, transparent)"}`,
            borderRadius: 14,
            padding: "10px 10px 10px 14px",
            boxShadow: "0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -12px rgba(15,23,42,0.10)",
            transition: "border-color 0.15s, background 0.15s, box-shadow 0.15s",
          } as React.CSSProperties}
        >
          {slashMenuVisible && slashMatch && (
            <div
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                bottom: "calc(100% + 8px)",
                zIndex: 450,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "0 -4px 18px rgba(15,23,42,0.14)",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>
                Slash commands · skills and prompt templates
              </div>
              {slashCommandsLoading ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>Loading commands…</div>
              ) : slashCommandsError ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "#ef4444" }}>Failed to load commands: {slashCommandsError}</div>
              ) : filteredSlashCommands.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>No matching skill or template commands</div>
              ) : (
                filteredSlashCommands.map((command, index) => {
                  const selected = index === slashSelectedIndex;
                  return (
                    <button
                      key={`${command.source}:${command.name}:${command.path ?? ""}`}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertSlashCommand(command);
                      }}
                      onMouseEnter={() => setSlashSelectedIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 10,
                        padding: "8px 10px",
                        border: "none",
                        borderTop: index > 0 ? "1px solid color-mix(in srgb, var(--border) 55%, transparent)" : "none",
                        background: selected ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                      }}
                    >
                      <span style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" }}>
                        /{command.name}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {command.argumentHint && (
                            <span style={{ color: "var(--text)", fontFamily: "var(--font-mono)", marginRight: 8 }}>{command.argumentHint}</span>
                          )}
                          {command.description || (command.source === "skill" ? "Pi skill" : "Prompt template")}
                        </span>
                        <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                          {command.source === "skill" ? "skill" : "template"}{command.location ? ` · ${command.location}` : ""}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {atMenuVisible && atMatch && (
            <div
              style={{
                position: "absolute",
                left: 12,
                right: 12,
                bottom: "calc(100% + 8px)",
                zIndex: 450,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 10,
                boxShadow: "0 -4px 18px rgba(15,23,42,0.14)",
                overflow: "hidden",
                maxHeight: 280,
                overflowY: "auto",
              }}
            >
              <div style={{ padding: "7px 10px", fontSize: 11, color: "var(--text-dim)", borderBottom: "1px solid var(--border)" }}>
                @ Files · select to reference in chat
              </div>
              {atSuggestionsLoading ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>Loading files…</div>
              ) : atSuggestionsError ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "#ef4444" }}>Failed to load files: {atSuggestionsError}</div>
              ) : atSuggestions.length === 0 ? (
                <div style={{ padding: "10px 12px", fontSize: 12, color: "var(--text-muted)" }}>No matching files</div>
              ) : (
                atSuggestions.map((suggestion, index) => {
                  const selected = index === atSelectedIndex;
                  return (
                    <button
                      key={suggestion.fullPath}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        insertAtMention(suggestion);
                      }}
                      onMouseEnter={() => setAtSelectedIndex(index)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "6px 10px",
                        border: "none",
                        borderTop: index > 0 ? "1px solid color-mix(in srgb, var(--border) 55%, transparent)" : "none",
                        background: selected ? "var(--bg-selected)" : "transparent",
                        color: "var(--text)",
                        cursor: "pointer",
                        textAlign: "left",
                        fontSize: 12,
                      }}
                    >
                      {suggestion.isDir ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                          <polyline points="13 2 13 9 20 9" />
                        </svg>
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {suggestion.name}
                      </span>
                      {suggestion.isDir && (
                        <span style={{ fontSize: 10, color: "var(--text-dim)", flexShrink: 0 }}>
                          dir
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}

          <div
            ref={inputRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            onKeyUp={syncFromDom}
            onMouseUp={syncFromDom}
            onPaste={handlePaste}
            onCompositionStart={() => {
              isComposingRef.current = true;
            }}
            onCompositionEnd={() => {
              isComposingRef.current = false;
              lastCompositionEndAtRef.current = Date.now();
            }}
            className="ce-input"
            data-placeholder={
              isStreaming && (onSteer || onFollowUp)
                ? "Steer 立即注入 / Follow-up 排队…"
                : isStreaming ? "Agent is running…"
                : "Message…"
            }
            style={{
              flex: 1,
              outline: "none",
              resize: "none",
              color: "var(--text)",
              fontSize: 14,
              lineHeight: 1.6,
              fontFamily: "inherit",
              minHeight: 24,
              maxHeight: 200,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              caretColor: "var(--text)",
            }}
          />

          {isStreaming ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, alignSelf: "flex-end" }}>
              {onSteer && (
                <button
                  onClick={() => sendQueued("steer")}
                  disabled={!hasEditorContent && !attachedImages.length && !attachedFiles.length}
                  title="打断 Agent 当前运行，立即注入消息"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "rgba(234,179,8,0.12)" : "none",
                    border: "1px solid rgba(234,179,8,0.35)",
                    borderRadius: 8,
                    color: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "rgba(180,130,0,1)" : "var(--text-dim)",
                    cursor: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 1 L9 5 L5 9" /><line x1="1" y1="5" x2="9" y2="5" />
                  </svg>
                  Steer
                </button>
              )}
              {onFollowUp && (
                <button
                  onClick={() => sendQueued("followup")}
                  disabled={!hasEditorContent && !attachedImages.length && !attachedFiles.length}
                  title="在 Agent 完成后排队发送"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "7px 12px",
                    background: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "rgba(129,140,248,0.12)" : "none",
                    border: "1px solid rgba(129,140,248,0.35)",
                    borderRadius: 8,
                    color: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "rgba(99,102,241,1)" : "var(--text-dim)",
                    cursor: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "pointer" : "not-allowed",
                    fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em",
                    transition: "background 0.12s",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="5" y1="1" x2="5" y2="6" /><polyline points="2.5 3.5 5 1 7.5 3.5" />
                    <line x1="2" y1="9" x2="8" y2="9" />
                  </svg>
                  Follow-up
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={handleSend}
              disabled={!hasEditorContent && !attachedImages.length && !attachedFiles.length}
              style={{
                flexShrink: 0,
                alignSelf: "flex-end",
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px",
                background: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "var(--accent)" : "var(--bg-panel)",
                border: "none",
                borderRadius: 8,
                color: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "#fff" : "var(--text-dim)",
                cursor: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "pointer" : "not-allowed",
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                boxShadow: (hasEditorContent || attachedImages.length || attachedFiles.length) ? "0 1px 3px rgba(37,99,235,0.25)" : "none",
                transition: "background 0.15s, box-shadow 0.15s",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="2" y1="7" x2="11" y2="7" />
                <polyline points="7.5 3 12 7 7.5 11" />
              </svg>
              Send
            </button>
          )}
        </div>

        {/* Bottom bar: left | center (context) | right */}
        <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>

          {/* LEFT: attach + model selector (idle) or steer/followup toggle (streaming) */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2 }}>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              title="Attach image"
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0,
                background: "none", border: "none",
                borderRadius: 9,
                color: attachedImages.length ? "var(--accent)" : "var(--text-muted)",
                cursor: isStreaming ? "not-allowed" : "pointer",
                opacity: isStreaming ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedImages.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
            </button>
            <button
              onClick={() => filePickerRef.current?.click()}
              disabled={isStreaming || uploadingFiles}
              title={uploadingFiles ? "Uploading…" : "Attach file"}
              style={{
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
                width: 32, height: 32, padding: 0,
                background: "none", border: "none",
                borderRadius: 9,
                color: attachedFiles.length ? "var(--accent)" : "var(--text-muted)",
                cursor: (isStreaming || uploadingFiles) ? "not-allowed" : "pointer",
                opacity: (isStreaming || uploadingFiles) ? 0.5 : 1,
                transition: "background 0.12s, color 0.12s",
              }}
              onMouseEnter={(e) => {
                if (isStreaming || uploadingFiles) return;
                e.currentTarget.style.background = "var(--bg-hover)";
                e.currentTarget.style.color = attachedFiles.length ? "var(--accent)" : "var(--text)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "none";
                e.currentTarget.style.color = attachedFiles.length ? "var(--accent)" : "var(--text-muted)";
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
                <polyline points="13 2 13 9 20 9" />
              </svg>
            </button>
            {/* Model selector — visible always, disabled during streaming */}
            {modelOptions.length > 0 && currentName && onModelChange && (
                <div ref={dropdownRef} style={{ position: "relative" }}>
                  <button
                    onClick={(e) => {
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setModelDropdownRect({ top: rect.top, left: rect.left, width: rect.width });
                      setModelDropdownOpen((v) => !v);
                    }}
                    disabled={isStreaming}
                    style={{
                      display: "flex", alignItems: "center", gap: 6,
                      padding: "8px 12px",
                      height: 32,
                      maxWidth: 220, overflow: "hidden",
                      background: modelDropdownOpen ? "var(--bg-hover)" : "none",
                      border: "none",
                      borderRadius: 9,
                      color: "var(--text-muted)",
                      cursor: isStreaming ? "not-allowed" : "pointer",
                      fontSize: 12,
                      opacity: isStreaming ? 0.5 : 1,
                      transition: "background 0.12s, color 0.12s",
                    }}
                    onMouseEnter={(e) => {
                      if (isStreaming) return;
                      e.currentTarget.style.background = "var(--bg-hover)";
                      e.currentTarget.style.color = "var(--text)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = modelDropdownOpen ? "var(--bg-hover)" : "none";
                      e.currentTarget.style.color = "var(--text-muted)";
                    }}
                  >
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="4" y="4" width="16" height="16" rx="2" />
                      <rect x="9" y="9" width="6" height="6" />
                      <line x1="9" y1="1" x2="9" y2="4" /><line x1="15" y1="1" x2="15" y2="4" />
                      <line x1="9" y1="20" x2="9" y2="23" /><line x1="15" y1="20" x2="15" y2="23" />
                      <line x1="20" y1="9" x2="23" y2="9" /><line x1="20" y1="14" x2="23" y2="14" />
                      <line x1="1" y1="9" x2="4" y2="9" /><line x1="1" y1="14" x2="4" y2="14" />
                    </svg>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{currentName}</span>
                  </button>
                  {modelDropdownOpen && modelDropdownRect && (() => {
                    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
                    const bottom = viewportHeight - modelDropdownRect.top + 6;
                    const maxH = Math.max(120, Math.min(modelDropdownRect.top - 8, viewportHeight * 0.6));
                    return (
                    <div ref={modelDropdownPanelRef} style={{
                      position: "fixed",
                      bottom, left: modelDropdownRect.left,
                      zIndex: 500, background: "var(--bg)", border: "1px solid var(--border)",
                      borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                      overflow: "hidden", width: "max-content", minWidth: modelDropdownRect.width, maxHeight: maxH, overflowY: "auto",
                    }}>
                      {modelsByProvider.map((group, gi) => (
                        <div key={group.provider}>
                          {(modelsByProvider.length > 1) && (
                            <div style={{
                              padding: "6px 12px 4px",
                              fontSize: 10, fontWeight: 600, color: "var(--text-dim)",
                              textTransform: "uppercase", letterSpacing: "0.07em",
                              borderTop: gi > 0 ? "1px solid var(--border)" : "none",
                            }}>
                              {group.provider}
                            </div>
                          )}
                          {group.options.map((opt) => {
                            const isActive = opt.modelId === model?.modelId && opt.provider === model?.provider;
                            return (
                              <button
                                key={`${opt.provider}:${opt.modelId}`}
                                onClick={() => { setModelDropdownOpen(false); if (!isActive) onModelChange(opt.provider, opt.modelId); }}
                                style={{
                                  display: "flex", alignItems: "center", gap: 8,
                                  width: "100%", padding: "7px 12px",
                                  background: isActive ? "var(--bg-selected)" : "none",
                                  border: "none",
                                  color: isActive ? "var(--text)" : "var(--text-muted)",
                                  cursor: "pointer", fontSize: 12, textAlign: "left",
                                  fontWeight: isActive ? 600 : 400,
                                  whiteSpace: "nowrap",
                                }}
                                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                              >
                                {isActive
                                  ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                                  : <span style={{ width: 10, flexShrink: 0 }} />}
                                {opt.name}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                    );
                  })()}
                </div>
            )}
          </div>

          {/* spacer */}
          <div style={{ flex: 1 }} />

          {/* RIGHT: thinking + tools preset + compact + sound (idle) | Stop + sound (streaming) */}
          <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 2, marginLeft: "auto" }}>
            {!isStreaming && onThinkingLevelChange && (
              <div ref={thinkingDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setThinkingDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title="切换推理强度"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: thinkingDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = thinkingDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9.5 2A5.5 5.5 0 0 0 4 7.5c0 1.7.78 3.21 2 4.21V14a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-2.29c1.22-1 2-2.51 2-4.21A5.5 5.5 0 0 0 9.5 2z" />
                    <line x1="7" y1="18" x2="12" y2="18" />
                    <line x1="8" y1="21" x2="11" y2="21" />
                  </svg>
                  <span>{(() => {
                    const lvl = thinkingLevel ?? "auto";
                    if (lvl === "auto" || !thinkingLevelMap) return lvl;
                    const mapped = thinkingLevelMap[lvl];
                    return mapped != null ? mapped : lvl;
                  })()}</span>
                </button>
                {thinkingDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 180,
                  }}>
                    {THINKING_LEVELS.filter((lvl) => {
                      if (!availableThinkingLevels) return true;
                      if (lvl === "auto") return true;
                      return availableThinkingLevels.includes(lvl);
                    }).map((lvl) => {
                      const isActive = (thinkingLevel ?? "auto") === lvl;
                      const desc = THINKING_LEVEL_DESC[lvl];
                      const mappedVal = (lvl !== "auto" && thinkingLevelMap) ? thinkingLevelMap[lvl] : undefined;
                      const displayLabel = (mappedVal != null && mappedVal !== lvl) ? mappedVal : lvl;
                      const showOriginal = mappedVal != null && mappedVal !== lvl;
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setThinkingDropdownOpen(false); if (!isActive) onThinkingLevelChange(lvl); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>
                            {displayLabel}
                            {showOriginal && <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "var(--font-mono)", marginLeft: 5 }}>({lvl})</span>}
                          </span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
            {!isStreaming && onToolPresetChange && (
              <div ref={toolDropdownRef} style={{ position: "relative" }}>
                <button
                  onClick={() => !isStreaming && setToolDropdownOpen((v) => !v)}
                  disabled={isStreaming}
                  title="切换工具预设"
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: toolDropdownOpen ? "var(--bg-hover)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: "var(--text-muted)",
                    cursor: isStreaming ? "not-allowed" : "pointer",
                    fontSize: 12,
                    opacity: isStreaming ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming) return;
                    e.currentTarget.style.background = "var(--bg-hover)";
                    e.currentTarget.style.color = "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = toolDropdownOpen ? "var(--bg-hover)" : "none";
                    e.currentTarget.style.color = "var(--text-muted)";
                  }}
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                  </svg>
                  <span>{Object.entries(TOOL_PRESET_MAP).find(([, v]) => v === (toolPreset ?? "default"))?.[0] ?? "default"}</span>
                </button>
                {toolDropdownOpen && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    zIndex: 100, background: "var(--bg)", border: "1px solid var(--border)",
                    borderRadius: 8, boxShadow: "0 -4px 16px rgba(0,0,0,0.10)",
                    overflow: "hidden", minWidth: 120,
                  }}>
                    {TOOL_PRESETS.map((lvl) => {
                      const preset = TOOL_PRESET_MAP[lvl];
                      const isActive = (toolPreset ?? "default") === preset;
                      const desc = lvl === "off" ? "无工具，纯聊天" : lvl === "default" ? "4 项内置工具" : lvl === "subagent" ? "全部工具 + subagent 委派" : "全部内置工具";
                      return (
                        <button
                          key={lvl}
                          onClick={() => { setToolDropdownOpen(false); if (!isActive) onToolPresetChange(preset); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8,
                            width: "100%", padding: "7px 12px",
                            background: isActive ? "var(--bg-selected)" : "none",
                            border: "none",
                            color: isActive ? "var(--text)" : "var(--text-muted)",
                            cursor: "pointer", fontSize: 12, textAlign: "left",
                            fontWeight: isActive ? 600 : 400,
                            whiteSpace: "nowrap",
                          }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-hover)"; }}
                          onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "none"; }}
                        >
                          {isActive
                            ? <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="1.5 5 4 7.5 8.5 2.5" /></svg>
                            : <span style={{ width: 10, flexShrink: 0 }} />}
                          <span style={{ flex: 1 }}>{lvl}</span>
                          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 8 }}>{desc}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {!isStreaming && onCompact && (
              <div style={{ position: "relative" }}>
                {compactError && (
                  <div style={{
                    position: "absolute", bottom: "calc(100% + 6px)", right: 0,
                    background: "#1f2937", color: "#f87171",
                    fontSize: 11, padding: "4px 8px", borderRadius: 5,
                    whiteSpace: "nowrap", pointerEvents: "none",
                    boxShadow: "0 2px 8px rgba(0,0,0,0.2)", zIndex: 50,
                  }}>
                    {compactError}
                  </div>
                )}
                <button
                  onClick={isCompacting ? onAbortCompaction : onCompact}
                  disabled={isStreaming && !isCompacting}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    padding: "8px 12px",
                    height: 32,
                    background: isCompacting ? "rgba(239,68,68,0.08)" : "none",
                    border: "none",
                    borderRadius: 9,
                    color: isCompacting ? "#ef4444" : "var(--text-muted)",
                    cursor: (isStreaming && !isCompacting) ? "not-allowed" : "pointer",
                    fontSize: 12, opacity: (isStreaming && !isCompacting) ? 0.5 : 1,
                    transition: "background 0.12s, color 0.12s",
                  }}
                  onMouseEnter={(e) => {
                    if (isStreaming && !isCompacting) return;
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.16)" : "var(--bg-hover)";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isCompacting ? "rgba(239,68,68,0.08)" : "none";
                    e.currentTarget.style.color = isCompacting ? "#ef4444" : "var(--text-muted)";
                  }}
                  title={isCompacting ? "停止压缩" : "压缩上下文"}
                >
                  {isCompacting ? (
                    <><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect x="2" y="2" width="6" height="6" rx="1" fill="currentColor" /></svg>Compacting…</>
                  ) : (
                    <><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                      <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                    </svg>Compact</>
                  )}
                </button>
              </div>
            )}

            {isStreaming && (
              <button
                onClick={onAbort}
                title="停止 Agent"
                style={{
                  display: "flex", alignItems: "center", gap: 6,
                  padding: "8px 14px",
                  height: 32,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.3)",
                  borderRadius: 9,
                  color: "#ef4444",
                  cursor: "pointer",
                  fontSize: 12, fontWeight: 600,
                  whiteSpace: "nowrap", letterSpacing: "-0.01em",
                  transition: "background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.16)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(239,68,68,0.08)"; }}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <rect x="1.5" y="1.5" width="7" height="7" rx="1.5" fill="currentColor" />
                </svg>
                Stop
              </button>
            )}

            {onSoundToggle !== undefined && (
              <button
                onClick={onSoundToggle}
                title={soundEnabled ? "关闭完成提示音" : "开启完成提示音"}
                style={{
                  display: "flex", alignItems: "center", justifyContent: "center",
                  width: 32, height: 32, padding: 0,
                  background: "none",
                  border: "none",
                  borderRadius: 9,
                  color: soundEnabled ? "var(--text-muted)" : "var(--text-dim)",
                  cursor: "pointer",
                  opacity: soundEnabled ? 1 : 0.55,
                  transition: "background 0.12s, color 0.12s, opacity 0.12s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "var(--bg-hover)";
                  e.currentTarget.style.color = "var(--text)";
                  e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "none";
                  e.currentTarget.style.color = soundEnabled ? "var(--text-muted)" : "var(--text-dim)";
                  e.currentTarget.style.opacity = soundEnabled ? "1" : "0.55";
                }}
              >
                {soundEnabled ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                ) : (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                )}
              </button>
            )}
          </div>

        </div>
      </div>
    </div>
  );
});
