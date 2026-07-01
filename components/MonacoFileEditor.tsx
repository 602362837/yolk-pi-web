"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import Editor, { loader, type Monaco, type OnMount } from "@monaco-editor/react";
import * as monacoEditor from "monaco-editor";

loader.config({ monaco: monacoEditor });

interface MonacoEnvironmentConfig {
  getWorker?: (_workerId: string, label: string) => Worker;
}

const monacoGlobal = globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironmentConfig };
monacoGlobal.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === "json") {
      return new Worker(new URL("monaco-editor/esm/vs/language/json/json.worker.js", import.meta.url), { type: "module" });
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new Worker(new URL("monaco-editor/esm/vs/language/css/css.worker.js", import.meta.url), { type: "module" });
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new Worker(new URL("monaco-editor/esm/vs/language/html/html.worker.js", import.meta.url), { type: "module" });
    }
    if (label === "typescript" || label === "javascript") {
      return new Worker(new URL("monaco-editor/esm/vs/language/typescript/ts.worker.js", import.meta.url), { type: "module" });
    }
    return new Worker(new URL("monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" });
  },
};

type LineSelection = { startLine: number; endLine: number };

interface Props {
  value: string;
  language: string;
  filePath?: string;
  cwd?: string;
  initialLine?: number;
  isDark: boolean;
  wrapLines: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSave?: () => void;
  onFindReferences?: () => void;
  onFindImplementations?: () => void;
  onMetaClickSymbol?: (info: { symbol: string; lineText: string; lineNumber: number }) => void;
  onShiftClickSymbol?: (info: { symbol: string; lineText: string; lineNumber: number }) => void;
  onActiveSymbolChange?: (symbol: string | null) => void;
  onSelectedLinesChange?: (selection: LineSelection | null) => void;
}

const registeredCompletionLanguages = new Set<string>();

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: "shell",
  sh: "shell",
  zsh: "shell",
  plaintext: "plaintext",
  text: "plaintext",
  word: "plaintext",
  makefile: "makefile",
  proto: "protobuf",
};

const KEYWORDS_BY_LANGUAGE: Record<string, string[]> = {
  typescript: ["import", "export", "interface", "type", "const", "let", "function", "async", "await", "return"],
  javascript: ["import", "export", "const", "let", "function", "async", "await", "return", "class", "new"],
  python: ["def", "class", "import", "from", "async", "await", "return", "with", "try", "except"],
  go: ["package", "import", "func", "type", "struct", "interface", "defer", "go", "return", "range"],
  rust: ["fn", "let", "mut", "pub", "impl", "trait", "struct", "enum", "match", "use"],
  java: ["class", "interface", "public", "private", "protected", "static", "final", "return", "new", "throws"],
  kotlin: ["fun", "val", "var", "class", "object", "interface", "when", "return", "suspend", "data"],
  swift: ["func", "let", "var", "class", "struct", "enum", "protocol", "guard", "return", "import"],
  c: ["#include", "#define", "int", "char", "void", "struct", "return", "const", "static", "typedef"],
  cpp: ["#include", "namespace", "class", "template", "typename", "auto", "const", "return", "std", "using"],
  csharp: ["using", "namespace", "class", "interface", "public", "private", "async", "await", "return", "new"],
  php: ["function", "class", "namespace", "use", "public", "private", "protected", "return", "new", "echo"],
  ruby: ["def", "class", "module", "require", "include", "do", "end", "return", "yield", "attr_reader"],
  shell: ["if", "then", "else", "fi", "for", "do", "done", "case", "export", "function"],
  powershell: ["function", "param", "process", "begin", "end", "if", "else", "foreach", "Where-Object", "Select-Object"],
  sql: ["select", "from", "where", "join", "left join", "insert", "update", "delete", "group by", "order by"],
  yaml: ["name", "version", "services", "steps", "env", "image", "command", "script", "depends_on", "volumes"],
  json: ["true", "false", "null"],
  markdown: ["# ", "## ", "### ", "- ", "```", "[link](url)", "**bold**", "_italic_"],
};

function normalizeMonacoLanguage(language: string): string {
  const normalized = (language || "plaintext").toLowerCase();
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function getWordSuggestions(monaco: Monaco, model: monacoEditor.editor.ITextModel, language: string, range: Monaco["IRange"]) {
  const words = model.getValue().match(/[A-Za-z_$][\w$-]{2,}/g) ?? [];
  return [...new Set(words)].slice(0, 200).map((word) => ({
    label: word,
    kind: monaco.languages.CompletionItemKind.Text,
    insertText: word,
    range,
    sortText: `z-${language}-${word}`,
  }));
}

interface LocalDeclarationCandidate {
  lineNumber: number;
  line: string;
  documentation: string | null;
}

function cleanCommentLine(line: string): string {
  return line
    .trim()
    .replace(/^\/\*\*?/, "")
    .replace(/\*\/$/, "")
    .replace(/^\*/, "")
    .replace(/^\/\//, "")
    .replace(/^#/, "")
    .trim();
}

function extractLeadingComment(model: monacoEditor.editor.ITextModel, declarationLine: number): string | null {
  const docs: string[] = [];
  let lineNumber = declarationLine - 1;

  while (lineNumber >= 1 && !model.getLineContent(lineNumber).trim()) lineNumber--;
  if (lineNumber < 1) return null;

  let line = model.getLineContent(lineNumber).trim();
  if (line.endsWith("*/")) {
    while (lineNumber >= 1) {
      line = model.getLineContent(lineNumber).trim();
      docs.unshift(cleanCommentLine(line));
      if (line.startsWith("/*") || line.startsWith("/**")) break;
      lineNumber--;
    }
  } else if (line.startsWith("//") || line.startsWith("#")) {
    while (lineNumber >= 1) {
      line = model.getLineContent(lineNumber).trim();
      if (!line.startsWith("//") && !line.startsWith("#")) break;
      docs.unshift(cleanCommentLine(line));
      lineNumber--;
    }
  }

  const normalized = docs.map((doc) => doc.trim()).filter(Boolean).join("\n");
  return normalized || null;
}

function findLocalDeclarationLine(model: monacoEditor.editor.ITextModel, symbol: string, currentLine: number): LocalDeclarationCandidate | null {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\b(?:const|let|var|final|val|var|private|protected|public|static|readonly)\\s+${escaped}\\b`),
    new RegExp(`\\b(?:function|def|func|fn)\\s+${escaped}\\s*\\(`),
    new RegExp(`\\b(?:class|interface|record|enum|struct)\\s+${escaped}\\b`),
    new RegExp(`\\b${escaped}\\s*[:=]`),
    new RegExp(`\\b${escaped}\\s*\\(`),
  ];
  const maxLookAround = 300;
  const start = Math.max(1, currentLine - maxLookAround);
  const end = Math.min(model.getLineCount(), currentLine + maxLookAround);
  for (let lineNumber = currentLine; lineNumber >= start; lineNumber--) {
    const line = model.getLineContent(lineNumber).trim();
    if (patterns.some((pattern) => pattern.test(line))) {
      return { lineNumber, line, documentation: extractLeadingComment(model, lineNumber) };
    }
  }
  for (let lineNumber = currentLine + 1; lineNumber <= end; lineNumber++) {
    const line = model.getLineContent(lineNumber).trim();
    if (patterns.some((pattern) => pattern.test(line))) {
      return { lineNumber, line, documentation: extractLeadingComment(model, lineNumber) };
    }
  }
  return null;
}

function registerBasicHoverProvider(monaco: Monaco, language: string, cwd?: string): monacoEditor.IDisposable {
  return monaco.languages.registerHoverProvider(language, {
    async provideHover(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position) {
      const word = model.getWordAtPosition(position);
      if (!word?.word) return null;
      const symbol = word.word;
      const lineText = model.getLineContent(position.lineNumber).trim();
      const declaration = findLocalDeclarationLine(model, symbol, position.lineNumber);
      let definitionDoc: { documentation?: string; preview?: string; relativePath?: string; line?: number } | null = null;
      if (cwd) {
        try {
          const res = await fetch(`/api/files/definitions?cwd=${encodeURIComponent(cwd)}&symbol=${encodeURIComponent(symbol)}`);
          const body = await res.json() as { results?: Array<{ documentation?: string; preview?: string; relativePath?: string; line?: number }> };
          definitionDoc = body.results?.find((item) => item.documentation) ?? body.results?.[0] ?? null;
        } catch {
          definitionDoc = null;
        }
      }
      const contents: monacoEditor.IMarkdownString[] = [
        { value: `**${symbol}**` },
        { value: `\`${lineText || "current line"}\`` },
      ];
      const documentation = definitionDoc?.documentation ?? declaration?.documentation;
      if (documentation) {
        contents.push({ value: `Documentation:\n\n${documentation}` });
      }
      if (definitionDoc?.preview) {
        contents.push({ value: `Definition candidate:\n\`${definitionDoc.relativePath ?? ""}${definitionDoc.line ? `:${definitionDoc.line}` : ""} ${definitionDoc.preview}\`` });
      } else if (declaration && (declaration.lineNumber !== position.lineNumber || declaration.line !== lineText)) {
        contents.push({ value: `Local declaration candidate:\n\`${declaration.lineNumber}: ${declaration.line}\`` });
      }
      contents.push({
        value: [
          "Actions:",
          "- `Cmd/Ctrl + Click`: drill down to definition, or find usages when on a definition/interface",
          "- `Shift + Click`: find implementations from a definition, or jump upward to definition from a usage",
          "- `Shift+F12`: find references/usages",
        ].join("\n"),
      });
      return {
        range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
        contents,
      };
    },
  });
}

function registerBasicCompletionProvider(monaco: Monaco, language: string): void {
  if (registeredCompletionLanguages.has(language)) return;
  registeredCompletionLanguages.add(language);

  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: [".", "_", "-", "#", "<", "@"],
    provideCompletionItems(model: monacoEditor.editor.ITextModel, position: monacoEditor.Position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const keywords = KEYWORDS_BY_LANGUAGE[language] ?? [];
      const keywordSuggestions = keywords.map((keyword) => ({
        label: keyword,
        kind: keyword.includes(" ") || keyword.includes("(")
          ? monaco.languages.CompletionItemKind.Snippet
          : monaco.languages.CompletionItemKind.Keyword,
        insertText: keyword,
        range,
        sortText: `a-${keyword}`,
      }));
      return {
        suggestions: [
          ...keywordSuggestions,
          ...getWordSuggestions(monaco, model, language, range),
        ],
      };
    },
  });
}

export function MonacoFileEditor({
  value,
  language,
  filePath,
  cwd,
  initialLine,
  isDark,
  wrapLines,
  readOnly = false,
  onChange,
  onSave,
  onFindReferences,
  onFindImplementations,
  onMetaClickSymbol,
  onShiftClickSymbol,
  onActiveSymbolChange,
  onSelectedLinesChange,
}: Props) {
  const monacoLanguage = normalizeMonacoLanguage(language);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const targetLineDecorationsRef = useRef<monacoEditor.editor.IEditorDecorationsCollection | null>(null);

  const options = useMemo<monacoEditor.editor.IStandaloneEditorConstructionOptions>(() => ({
    readOnly,
    minimap: { enabled: false },
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    lineHeight: 21,
    automaticLayout: true,
    scrollBeyondLastLine: false,
    wordWrap: wrapLines ? "on" : "off",
    tabSize: 2,
    insertSpaces: true,
    renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    suggest: { showWords: true, snippetsPreventQuickSuggestions: false },
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: true },
    parameterHints: { enabled: true, cycle: true },
    hover: { enabled: true, delay: 250, sticky: true },
  }), [readOnly, wrapLines]);

  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !initialLine || initialLine <= 0) {
      targetLineDecorationsRef.current?.clear();
      return;
    }

    const lineNumber = Math.min(Math.max(initialLine, 1), model.getLineCount());
    editor.revealLineInCenter(lineNumber);
    editor.setPosition({ lineNumber, column: 1 });
    const decorations = [{
      range: new monacoEditor.Range(lineNumber, 1, lineNumber, 1),
      options: {
        isWholeLine: true,
        className: "pi-monaco-target-line",
        linesDecorationsClassName: "pi-monaco-target-line-gutter",
      },
    }];
    if (targetLineDecorationsRef.current) targetLineDecorationsRef.current.set(decorations);
    else targetLineDecorationsRef.current = editor.createDecorationsCollection(decorations);
  }, [initialLine, value]);

  const handleMount = useCallback<OnMount>((editor, monaco) => {
    editorRef.current = editor;
    registerBasicCompletionProvider(monaco, monacoLanguage);
    const hoverDisposable = registerBasicHoverProvider(monaco, monacoLanguage, cwd);

    const updateSelection = () => {
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) {
        onSelectedLinesChange?.(null);
        return;
      }
      const startLine = Math.min(selection.startLineNumber, selection.endLineNumber);
      const endLine = Math.max(selection.startLineNumber, selection.endLineNumber);
      onSelectedLinesChange?.({ startLine, endLine });
    };

    const updateActiveSymbol = () => {
      const model = editor.getModel();
      const position = editor.getPosition();
      if (!model || !position) {
        onActiveSymbolChange?.(null);
        return;
      }
      const selection = editor.getSelection();
      const selectedText = selection && !selection.isEmpty() ? model.getValueInRange(selection).trim() : "";
      const word = selectedText && /^[A-Za-z_$][\w$]*$/.test(selectedText)
        ? selectedText
        : model.getWordAtPosition(position)?.word ?? "";
      onActiveSymbolChange?.(word || null);
    };

    if (initialLine && initialLine > 0) {
      editor.revealLineInCenter(initialLine);
      editor.setPosition({ lineNumber: initialLine, column: 1 });
    }

    updateSelection();
    updateActiveSymbol();
    const selectionDisposable = editor.onDidChangeCursorSelection(() => {
      updateSelection();
      updateActiveSymbol();
    });
    const mouseDisposable = editor.onMouseDown((event) => {
      const position = event.target.position;
      const model = editor.getModel();
      if (!position || !model) return;
      const symbol = model.getWordAtPosition(position)?.word;
      if (!symbol) return;
      const info = { symbol, lineText: model.getLineContent(position.lineNumber), lineNumber: position.lineNumber };
      if (event.event.shiftKey) {
        event.event.preventDefault();
        event.event.stopPropagation();
        onShiftClickSymbol?.(info);
        return;
      }
      if (event.event.metaKey || event.event.ctrlKey) {
        event.event.preventDefault();
        event.event.stopPropagation();
        onMetaClickSymbol?.(info);
      }
    });

    if (onSave) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        onSave();
      });
    }
    if (onFindReferences) {
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F12, () => {
        onFindReferences();
      });
    }
    if (onFindImplementations) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F12, () => {
        onFindImplementations();
      });
    }

    return () => {
      selectionDisposable.dispose();
      mouseDisposable.dispose();
      hoverDisposable.dispose();
      targetLineDecorationsRef.current?.clear();
      targetLineDecorationsRef.current = null;
      editorRef.current = null;
    };
  }, [cwd, initialLine, monacoLanguage, onActiveSymbolChange, onFindImplementations, onFindReferences, onMetaClickSymbol, onSave, onSelectedLinesChange, onShiftClickSymbol]);

  return (
    <div
      style={{ height: "100%", width: "100%" }}
      onKeyDownCapture={(event) => {
        if (onSave && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          event.stopPropagation();
          onSave();
        }
        if (onFindReferences && event.shiftKey && event.key === "F12") {
          event.preventDefault();
          event.stopPropagation();
          onFindReferences();
        }
        if (onFindImplementations && (event.metaKey || event.ctrlKey) && event.key === "F12") {
          event.preventDefault();
          event.stopPropagation();
          onFindImplementations();
        }
      }}
    >
      <style>{`
        .pi-monaco-target-line {
          background: rgba(37, 99, 235, 0.20) !important;
          outline: 1px solid rgba(37, 99, 235, 0.45);
          outline-offset: -1px;
        }
        .pi-monaco-target-line-gutter {
          background: var(--accent) !important;
          width: 4px !important;
          margin-left: 3px;
        }
      `}</style>
      <Editor
        key={`${filePath ?? "untitled"}:${monacoLanguage}`}
        height="100%"
        width="100%"
        value={value}
        language={monacoLanguage}
        path={filePath}
        line={initialLine}
        theme={isDark ? "vs-dark" : "light"}
        options={options}
        loading={(
          <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 12 }}>
            Loading editor...
          </div>
        )}
        onMount={handleMount}
        onChange={(nextValue) => onChange?.(nextValue ?? "")}
      />
    </div>
  );
}
