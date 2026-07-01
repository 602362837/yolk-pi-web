import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";

const IGNORED_NAMES = new Set(["node_modules", ".git", ".next", "dist", "build", "__pycache__", ".turbo", ".cache", "coverage", "target", "vendor", ".DS_Store"]);
const MAX_RESULTS = 80;
const MAX_FILE_BYTES = 512 * 1024;
const SYMBOL_RE = /^[A-Za-z_$][\w$.-]{0,120}$/;
const SEARCH_EXTS = new Set(["ts", "tsx", "js", "jsx", "java", "kt", "py", "go", "rs", "rb", "php", "c", "h", "cpp", "hpp", "cs", "swift"]);

interface DefinitionResult {
  filePath: string;
  relativePath: string;
  line: number;
  column: number;
  kind: "definition" | "interface" | "class" | "method";
  preview: string;
  documentation?: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSearchable(filePath: string): boolean {
  return SEARCH_EXTS.has(path.basename(filePath).toLowerCase().split(".").pop() ?? "");
}

function kindForLine(line: string): DefinitionResult["kind"] {
  if (/\binterface\s+/.test(line)) return "interface";
  if (/\b(class|record|enum|struct)\s+/.test(line)) return "class";
  if (/\w+\s*\(/.test(line)) return "method";
  return "definition";
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

function extractLeadingComment(lines: string[], declarationIndex: number): string | undefined {
  const docs: string[] = [];
  let index = declarationIndex - 1;
  while (index >= 0 && !lines[index].trim()) index--;
  if (index < 0) return undefined;

  let line = lines[index].trim();
  if (line.endsWith("*/")) {
    while (index >= 0) {
      line = lines[index].trim();
      docs.unshift(cleanCommentLine(line));
      if (line.startsWith("/*") || line.startsWith("/**")) break;
      index--;
    }
  } else if (line.startsWith("//") || line.startsWith("#")) {
    while (index >= 0) {
      line = lines[index].trim();
      if (!line.startsWith("//") && !line.startsWith("#")) break;
      docs.unshift(cleanCommentLine(line));
      index--;
    }
  }

  const normalized = docs.map((doc) => doc.trim()).filter(Boolean).join("\n");
  return normalized || undefined;
}

function collectDefinitions(cwd: string, filePath: string, symbol: string): DefinitionResult[] {
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return []; }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];

  let content: string;
  try { content = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  if (content.includes("\0")) return [];

  const escaped = escapeRegExp(symbol);
  const patterns = [
    new RegExp(`\\b(?:interface|class|record|enum|struct)\\s+${escaped}\\b`),
    new RegExp(`\\b(?:function|def|func|fn)\\s+${escaped}\\s*\\(`),
    new RegExp(`\\b${escaped}\\s*[:=]\\s*(?:function|async\\s*\\(|\\(|[A-Za-z_$])`),
    new RegExp(`(?:public|protected|private|static|final|synchronized|abstract|native|default|\\s)+[\\w<>\\[\\], ?]+\\s+${escaped}\\s*\\(`),
  ];

  const results: DefinitionResult[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!patterns.some((pattern) => pattern.test(line))) continue;
    const column = Math.max(line.indexOf(symbol) + 1, 1);
    results.push({
      filePath,
      relativePath: path.relative(cwd, filePath),
      line: index + 1,
      column,
      kind: kindForLine(line),
      preview: line.trim().slice(0, 240),
      documentation: extractLeadingComment(lines, index),
    });
    if (results.length >= 5) break;
  }
  return results;
}

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    const symbol = request.nextUrl.searchParams.get("symbol")?.trim() ?? "";
    if (!cwd) return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    if (!SYMBOL_RE.test(symbol)) return NextResponse.json({ error: "Invalid symbol" }, { status: 400 });

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });
    const realCwd = fs.realpathSync(cwd);
    if (!isPathAllowed(realCwd, allowedRoots)) return NextResponse.json({ error: "Access denied" }, { status: 403 });

    const results: DefinitionResult[] = [];
    function walk(dir: string) {
      if (results.length >= MAX_RESULTS) return;
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS || IGNORED_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        let realFull: string;
        try { realFull = fs.realpathSync(full); } catch { continue; }
        if (!isPathAllowed(realFull, allowedRoots) || (realFull !== realCwd && !realFull.startsWith(realCwd + path.sep))) continue;
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && isSearchable(full)) results.push(...collectDefinitions(realCwd, full, symbol));
      }
    }
    walk(realCwd);
    results.sort((a, b) => {
      if (Boolean(a.documentation) !== Boolean(b.documentation)) return a.documentation ? -1 : 1;
      if (a.kind !== b.kind) {
        const rank = { interface: 0, class: 1, method: 2, definition: 3 } as const;
        return rank[a.kind] - rank[b.kind];
      }
      return a.relativePath.localeCompare(b.relativePath) || a.line - b.line;
    });
    return NextResponse.json({ symbol, results: results.slice(0, MAX_RESULTS) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
