import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", "target", "vendor", ".DS_Store",
]);

const SEARCH_EXTS = new Set([
  "ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs", "java", "kt", "kts", "py", "go", "rs", "rb", "php",
  "c", "h", "cpp", "cc", "cxx", "hpp", "cs", "swift", "scala", "lua", "sh", "bash", "zsh", "fish", "ps1",
  "sql", "graphql", "gql", "json", "jsonl", "yaml", "yml", "toml", "xml", "html", "css", "scss", "less", "md", "mdx",
  "tf", "hcl", "proto", "properties", "ini", "cfg", "conf", "env", "txt",
]);

const SEARCH_FILENAMES = new Set(["dockerfile", "makefile", "gnumakefile", ".env", ".gitignore"]);
const MAX_RESULTS = 120;
const MAX_FILE_BYTES = 512 * 1024;
const SYMBOL_RE = /^[A-Za-z_$][\w$.-]{0,120}$/;

interface ReferenceResult {
  filePath: string;
  relativePath: string;
  line: number;
  column: number;
  kind: "reference";
  preview: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isSearchableFile(filePath: string): boolean {
  const base = path.basename(filePath).toLowerCase();
  if (SEARCH_FILENAMES.has(base) || base.startsWith(".env.")) return true;
  const ext = base.split(".").pop() ?? "";
  return SEARCH_EXTS.has(ext);
}

function collectReferences(cwd: string, filePath: string, symbol: string): ReferenceResult[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return [];

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  if (content.includes("\0")) return [];

  const pattern = new RegExp(`(?<![A-Za-z0-9_$])${escapeRegExp(symbol)}(?![A-Za-z0-9_$])`, "g");
  const results: ReferenceResult[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    pattern.lastIndex = 0;
    const match = pattern.exec(line);
    if (!match) continue;
    results.push({
      filePath,
      relativePath: path.relative(cwd, filePath),
      line: index + 1,
      column: match.index + 1,
      kind: "reference",
      preview: line.trim().slice(0, 240),
    });
    if (results.length >= 10) break;
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
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }
    const realCwd = fs.realpathSync(cwd);
    if (!isPathAllowed(realCwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const results: ReferenceResult[] = [];

    function walk(dir: string) {
      if (results.length >= MAX_RESULTS) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (results.length >= MAX_RESULTS) return;
        if (IGNORED_NAMES.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        let realFull: string;
        try {
          realFull = fs.realpathSync(full);
        } catch {
          continue;
        }
        if (!isPathAllowed(realFull, allowedRoots) || (realFull !== realCwd && !realFull.startsWith(realCwd + path.sep))) continue;
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile() && isSearchableFile(full)) results.push(...collectReferences(realCwd, full, symbol));
      }
    }

    walk(realCwd);
    results.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.line - b.line || a.column - b.column);
    return NextResponse.json({ symbol, results: results.slice(0, MAX_RESULTS) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
