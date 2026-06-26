import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";

const IGNORED_NAMES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "__pycache__",
  ".turbo", ".cache", "coverage", ".pytest_cache", ".mypy_cache",
  "target", "vendor", ".DS_Store",
]);

const IGNORED_SUFFIXES = [".pyc"];

const MAX_RESULTS = 24;

export async function GET(request: NextRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    const prefix = request.nextUrl.searchParams.get("prefix") ?? "";

    if (!cwd) {
      return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    }

    const allowedRoots = await getAllowedRoots();
    if (!isPathAllowed(cwd, allowedRoots)) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const results: { name: string; fullPath: string; relativePath: string }[] = [];
    const lowerPrefix = prefix.toLowerCase();
    const rootCwd = cwd;

    function walk(dir: string) {
      if (results.length >= MAX_RESULTS) return;

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      // Files first (sorted), then subdirectories
      const sorted = entries
        .filter((e) => !IGNORED_NAMES.has(e.name) && !IGNORED_SUFFIXES.some((s) => e.name.endsWith(s)))
        .sort((a, b) => {
          if (a.isFile() !== b.isFile()) return a.isFile() ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

      for (const entry of sorted) {
        if (results.length >= MAX_RESULTS) return;

        const fullPath = path.join(dir, entry.name);

        if (entry.isFile() && entry.name.toLowerCase().includes(lowerPrefix)) {
          const relativePath = path.relative(rootCwd, fullPath);
          results.push({ name: entry.name, fullPath, relativePath });
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        }
      }
    }

    walk(cwd);

    return NextResponse.json({ files: results, total: results.length });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
