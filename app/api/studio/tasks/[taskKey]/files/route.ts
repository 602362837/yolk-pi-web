import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getAllowedRoots, isPathAllowed } from "@/lib/allowed-roots";
import { canonicalizeCwd } from "@/lib/cwd";
import {
  resolveYpiStudioTaskRelativeFile,
  YpiStudioTaskSecurityError,
} from "@/lib/ypi-studio-tasks";

export const dynamic = "force-dynamic";

const TEXT_READ_MAX_BYTES = 256 * 1024;
const HTML_PREVIEW_MAX_BYTES = 2 * 1024 * 1024;

const TEXT_EXT_TO_LANGUAGE: Record<string, string> = {
  md: "markdown",
  mdx: "markdown",
  txt: "plaintext",
  text: "plaintext",
  json: "json",
  jsonc: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  html: "html",
  htm: "html",
  css: "css",
  js: "javascript",
  jsx: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  xml: "xml",
  svg: "xml",
};

function isValidTaskKey(taskKey: string): boolean {
  return /^active:[^/\\:]+$/.test(taskKey) || /^archived:\d{4}-\d{2}:[^/\\:]+$/.test(taskKey) || /^[^/\\:]+$/.test(taskKey);
}

async function resolveAuthorizedCwd(cwd: string): Promise<string | NextResponse> {
  const allowedRoots = await getAllowedRoots();
  const canonicalCwd = canonicalizeCwd(cwd);
  if (!isPathAllowed(cwd, allowedRoots) || !isPathAllowed(canonicalCwd, allowedRoots)) {
    return NextResponse.json({ error: "Access denied" }, { status: 403 });
  }
  return canonicalCwd;
}

function getExtension(filePath: string): string {
  return path.basename(filePath).toLowerCase().split(".").pop() ?? "";
}

function getLanguage(filePath: string): string {
  return TEXT_EXT_TO_LANGUAGE[getExtension(filePath)] ?? "plaintext";
}

function getTextMime(filePath: string): string {
  const ext = getExtension(filePath);
  if (ext === "html" || ext === "htm") return "text/html; charset=utf-8";
  if (ext === "css") return "text/css; charset=utf-8";
  if (ext === "js" || ext === "mjs" || ext === "cjs") return "text/javascript; charset=utf-8";
  if (ext === "json" || ext === "jsonc" || ext === "jsonl") return "application/json; charset=utf-8";
  if (ext === "svg") return "image/svg+xml; charset=utf-8";
  return "text/plain; charset=utf-8";
}

function isHtmlFile(filePath: string): boolean {
  const ext = getExtension(filePath);
  return ext === "html" || ext === "htm";
}

function errorStatus(error: unknown): number {
  if (error instanceof YpiStudioTaskSecurityError) return 400;
  if (error instanceof Error && /not found/i.test(error.message)) return 404;
  if (error instanceof Error && /not a file/i.test(error.message)) return 400;
  return 500;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskKey: string }> },
) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd");
    const relativePath = request.nextUrl.searchParams.get("path");
    const mode = request.nextUrl.searchParams.get("mode") ?? "meta";
    if (!cwd) return NextResponse.json({ error: "Missing cwd parameter" }, { status: 400 });
    if (!relativePath) return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
    if (mode !== "meta" && mode !== "read" && mode !== "preview") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }

    const { taskKey } = await params;
    if (!isValidTaskKey(taskKey)) return NextResponse.json({ error: "Invalid task key" }, { status: 400 });

    const authorizedCwd = await resolveAuthorizedCwd(cwd);
    if (authorizedCwd instanceof NextResponse) return authorizedCwd;

    const resolved = resolveYpiStudioTaskRelativeFile(authorizedCwd, taskKey, relativePath);
    const mime = getTextMime(resolved.realPath);

    if (mode === "meta") {
      return NextResponse.json({
        path: resolved.relativePath,
        fileName: path.basename(resolved.realPath),
        size: resolved.stat.size,
        mtimeMs: resolved.stat.mtimeMs,
        language: getLanguage(resolved.realPath),
        mime,
        preview: isHtmlFile(resolved.realPath) ? "html" : null,
      });
    }

    if (mode === "read") {
      if (resolved.stat.size > TEXT_READ_MAX_BYTES) {
        return NextResponse.json({ error: "File too large to read (>256KB)" }, { status: 413 });
      }
      const content = fs.readFileSync(resolved.realPath, "utf8");
      return NextResponse.json({
        path: resolved.relativePath,
        content,
        language: getLanguage(resolved.realPath),
        size: resolved.stat.size,
        mtimeMs: resolved.stat.mtimeMs,
        mime,
      });
    }

    if (!isHtmlFile(resolved.realPath)) {
      return NextResponse.json({ error: "Preview is only available for HTML files" }, { status: 400 });
    }
    if (resolved.stat.size > HTML_PREVIEW_MAX_BYTES) {
      return NextResponse.json({ error: "HTML preview too large (>2MB)" }, { status: 413 });
    }
    const html = fs.readFileSync(resolved.realPath, "utf8");
    return new Response(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache",
        "Content-Security-Policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: errorStatus(error) });
  }
}
