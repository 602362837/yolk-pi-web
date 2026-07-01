import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", "target", "vendor", ".DS_Store",
]);

const MAX_RESULTS = 50;
const MAX_FILE_BYTES = 512 * 1024;
const SYMBOL_RE = /^[A-Za-z_$][\w$]{0,120}$/;

interface ImplementationResult {
  filePath: string;
  relativePath: string;
  line: number;
  kind: "implements" | "extends" | "method" | "reference";
  preview: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isJavaFile(filePath: string): boolean {
  return filePath.toLowerCase().endsWith(".java");
}

function resultKind(line: string, symbol: string): ImplementationResult["kind"] {
  if (new RegExp(`\\bimplements\\b[^{};]*\\b${escapeRegExp(symbol)}\\b`).test(line)) return "implements";
  if (new RegExp(`\\bextends\\b[^{};]*\\b${escapeRegExp(symbol)}\\b`).test(line)) return "extends";
  if (new RegExp(`\\b${escapeRegExp(symbol)}\\s*\\(`).test(line)) return "method";
  return "reference";
}

function scoreKind(kind: ImplementationResult["kind"]): number {
  if (kind === "implements") return 0;
  if (kind === "extends") return 1;
  if (kind === "method") return 2;
  return 3;
}

function collectJavaImplementationMatches(cwd: string, filePath: string, symbol: string): ImplementationResult[] {
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

  const escaped = escapeRegExp(symbol);
  const isInterfaceContent = /\binterface\s+\w+/.test(content) && !/\bclass\s+\w+/.test(content);
  const strongPattern = new RegExp(`\\b(?:class|record|enum)\\s+\\w+[^{};]*(?:implements|extends)\\s+[^{};]*\\b${escaped}\\b`);
  const methodPattern = new RegExp(`(?:@Override\\s*)?(?:public|protected|private|static|final|synchronized|abstract|native|default|\\s)+[\\w<>\\[\\], ?]+\\s+${escaped}\\s*\\(`);
  const referencePattern = new RegExp(`\\b${escaped}\\b`);

  const results: ImplementationResult[] = [];
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!strongPattern.test(line) && !methodPattern.test(line) && !referencePattern.test(line)) continue;
    const kind = resultKind(line, symbol);
    if (isInterfaceContent && kind === "method") continue;
    if (kind === "reference" && results.some((item) => item.kind !== "reference")) continue;
    results.push({
      filePath,
      relativePath: path.relative(cwd, filePath),
      line: index + 1,
      kind,
      preview: line.trim().slice(0, 240),
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
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const realCwd = fs.realpathSync(cwd);
    if (!isPathAllowed(realCwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const results: ImplementationResult[] = [];

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
        if (!isPathAllowed(realFull, allowedRoots) || !realFull.startsWith(realCwd + path.sep)) continue;
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && isJavaFile(full)) {
          results.push(...collectJavaImplementationMatches(realCwd, full, symbol));
        }
      }
    }

    walk(realCwd);
    results.sort((a, b) => scoreKind(a.kind) - scoreKind(b.kind) || a.relativePath.localeCompare(b.relativePath) || a.line - b.line);
    return NextResponse.json({ symbol, results: results.slice(0, MAX_RESULTS) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
