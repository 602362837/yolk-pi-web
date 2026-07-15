/**
 * Client-safe helpers for YPI Studio task-local plan/artifact previews.
 *
 * These helpers only improve UX validation and path construction. The server
 * file resolver remains the security authority for scheme/absolute/`..`/
 * symlink escapes and directory targets.
 */

export type TaskRelativeHrefResult =
  | { ok: true; path: string; fileName: string; isHtml: boolean }
  | { ok: false; message: string };

export type TaskRelativePathSource = {
  pathLabel: string;
};

export type TaskRelativeLinkNotice = {
  tone: "info" | "warning" | "error" | "success";
  text: string;
};

export type StudioTaskDocumentOpenResult =
  | { ok: true; kind: "document" | "html"; url: string }
  | { ok: false; reason: "invalid" | "blocked" | "unsupported"; message: string };

/** Build an absolute workspace path under a task directory for the file viewer. */
export function taskRelativeFilePath(
  cwd: string,
  task: TaskRelativePathSource,
  relativePath: string,
): string {
  return `${cwd.replace(/[\\/]+$/, "")}/${task.pathLabel.replace(/^\/+/, "")}/${relativePath.replace(/^\/+/, "")}`;
}

/** Scope a task-relative path under an improvement instance root. */
export function improvementRelativePath(improvementId: string, relativePath: string): string {
  return `improvements/${improvementId}/${relativePath.replace(/^\/+/, "")}`;
}

/**
 * Validate and normalize a Markdown href for task-local opening.
 * Rejects schemes, protocol-relative/absolute paths, `..`, backslashes, and directories.
 */
export function resolveTaskRelativeHref(href: string): TaskRelativeHrefResult {
  const rawHref = href.trim();
  if (!rawHref) return { ok: false, message: "❌ 安全阻止：链接路径为空" };
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(rawHref) || rawHref.startsWith("//") || rawHref.startsWith("/")) {
    return { ok: false, message: "❌ 安全阻止：拒绝访问外部或绝对路径" };
  }
  if (/^[A-Za-z]:[\\/]/.test(rawHref)) return { ok: false, message: "❌ 安全阻止：拒绝访问外部或绝对路径" };

  const withoutQueryHash = rawHref.split(/[?#]/, 1)[0];
  let decodedPath = withoutQueryHash;
  try {
    decodedPath = decodeURIComponent(withoutQueryHash);
  } catch {
    return { ok: false, message: "❌ 安全阻止：链接路径编码无效" };
  }

  if (!decodedPath || decodedPath.includes("\0")) return { ok: false, message: "❌ 安全阻止：链接路径无效" };
  if (decodedPath.includes("\\") || decodedPath.includes("..")) return { ok: false, message: "❌ 安全阻止：路径包含 \"..\" 越权逃逸风险" };
  if (decodedPath.startsWith("/")) return { ok: false, message: "❌ 安全阻止：拒绝访问外部或绝对路径" };

  const segments = decodedPath.split("/").filter((segment) => segment && segment !== ".");
  if (segments.length === 0) return { ok: false, message: "❌ 安全阻止：链接路径为空" };
  if (decodedPath.endsWith("/")) return { ok: false, message: "❌ 安全阻止：目录链接不可直接打开" };
  const normalizedPath = segments.join("/");
  const fileName = segments[segments.length - 1];
  return { ok: true, path: normalizedPath, fileName, isHtml: /\.html?$/i.test(fileName) };
}

/** Build the existing task-local files API URL for read or HTML preview. */
export function buildStudioTaskFileApiUrl(options: {
  taskKey: string;
  cwd: string;
  path: string;
  mode: "read" | "preview";
  improvementId?: string;
}): string {
  const base = `/api/studio/tasks/${encodeURIComponent(options.taskKey)}/files`
    + `?cwd=${encodeURIComponent(options.cwd)}`
    + `&path=${encodeURIComponent(options.path)}`
    + `&mode=${encodeURIComponent(options.mode)}`;
  if (!options.improvementId) return base;
  return `${base}&improvementId=${encodeURIComponent(options.improvementId)}`;
}

/**
 * Build the app-local read-only Studio task document page URL for browser new tabs.
 * Query params are a client navigation contract only; the files API re-authorizes
 * cwd/task scope and the server resolver remains the path security authority.
 */
export function buildStudioTaskDocumentPageUrl(options: {
  taskKey: string;
  cwd: string;
  path: string;
  improvementId?: string;
  title?: string;
}): string {
  const params = new URLSearchParams();
  params.set("taskKey", options.taskKey);
  params.set("cwd", options.cwd);
  params.set("path", options.path);
  if (options.improvementId) params.set("improvementId", options.improvementId);
  if (options.title?.trim()) params.set("title", options.title.trim());
  return `/studio/task-document?${params.toString()}`;
}

function openBlankUrl(url: string): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Open a non-HTML Studio task document in a new browser tab.
 * Never falls back to the main file viewer / right-side preview.
 */
export function openStudioTaskDocumentInNewTab(options: {
  taskKey: string;
  cwd: string;
  path: string;
  improvementId?: string;
  title?: string;
}): StudioTaskDocumentOpenResult {
  const taskKey = options.taskKey.trim();
  const cwd = options.cwd.trim();
  const path = options.path.trim();
  if (!taskKey || !cwd || !path) {
    return { ok: false, reason: "invalid", message: "❌ 无法打开资料：缺少任务、工作区或路径" };
  }
  if (/\.html?$/i.test(path)) {
    return { ok: false, reason: "unsupported", message: "❌ HTML 原型请使用安全预览入口" };
  }

  const url = buildStudioTaskDocumentPageUrl({
    taskKey,
    cwd,
    path,
    improvementId: options.improvementId,
    title: options.title,
  });
  const opened = openBlankUrl(url);
  if (!opened) {
    return {
      ok: false,
      reason: "blocked",
      message: "浏览器阻止了新标签，请允许此站点弹窗后重试",
    };
  }
  return { ok: true, kind: "document", url };
}

/**
 * Resolve a task-local href and open it with the document-page / HTML-preview policy.
 * Non-HTML opens the shared document page; HTML uses files API mode=preview.
 * Popup blocked and invalid paths return a failure result without any onOpenFile fallback.
 */
export function openStudioTaskRelativeInNewTab(options: {
  taskKey: string;
  cwd: string;
  href: string;
  label?: string;
  improvementId?: string;
  title?: string;
}): StudioTaskDocumentOpenResult {
  const resolved = resolveTaskRelativeHref(options.href);
  if (!resolved.ok) {
    return { ok: false, reason: "invalid", message: resolved.message };
  }

  if (resolved.isHtml) {
    const opened = openStudioTaskHtmlPrototype({
      taskKey: options.taskKey,
      cwd: options.cwd,
      fileName: resolved.path,
      improvementId: options.improvementId,
    });
    if (!opened) {
      return {
        ok: false,
        reason: "blocked",
        message: "浏览器阻止了新标签，请允许此站点弹窗后重试",
      };
    }
    return {
      ok: true,
      kind: "html",
      url: buildStudioTaskFileApiUrl({
        taskKey: options.taskKey,
        cwd: options.cwd,
        path: resolved.path,
        mode: "preview",
        improvementId: options.improvementId,
      }),
    };
  }

  return openStudioTaskDocumentInNewTab({
    taskKey: options.taskKey,
    cwd: options.cwd,
    path: resolved.path,
    improvementId: options.improvementId,
    title: options.title || options.label || resolved.fileName,
  });
}

/**
 * Legacy helper retained for YpiStudioPlanReviewModal compatibility.
 * Prefer openStudioTaskRelativeInNewTab / openStudioTaskDocumentInNewTab for
 * Studio material entry points (no right-side preview fallback).
 */
export function openTaskRelativeLink(options: {
  cwd: string;
  task: TaskRelativePathSource & { key: string };
  href: string;
  label: string;
  onOpenFile?: (filePath: string, fileName: string) => void;
  setNotice: (notice: TaskRelativeLinkNotice) => void;
  improvementId?: string;
}): boolean {
  const { cwd, task, href, label, onOpenFile, setNotice, improvementId } = options;
  const resolved = resolveTaskRelativeHref(href);
  if (!resolved.ok) {
    setNotice({ tone: "error", text: resolved.message });
    return false;
  }

  setNotice({ tone: "info", text: `正在打开：${label || resolved.fileName}` });
  const scopedPath = improvementId
    ? improvementRelativePath(improvementId, resolved.path)
    : resolved.path;

  if (resolved.isHtml) {
    const url = buildStudioTaskFileApiUrl({
      taskKey: task.key,
      cwd,
      path: resolved.path,
      mode: "preview",
      improvementId,
    });
    const opened = openBlankUrl(url);
    if (!opened) onOpenFile?.(taskRelativeFilePath(cwd, task, scopedPath), resolved.fileName);
    return false;
  }

  onOpenFile?.(taskRelativeFilePath(cwd, task, scopedPath), resolved.fileName);
  return false;
}

export function openImprovementRelativeLink(options: {
  cwd: string;
  task: TaskRelativePathSource & { key: string };
  instance: { id: string };
  href: string;
  label: string;
  onOpenFile?: (filePath: string, fileName: string) => void;
  setNotice: (notice: TaskRelativeLinkNotice) => void;
}): boolean {
  return openTaskRelativeLink({
    cwd: options.cwd,
    task: options.task,
    href: options.href,
    label: options.label,
    onOpenFile: options.onOpenFile,
    setNotice: options.setNotice,
    improvementId: options.instance.id,
  });
}

/**
 * Open a task/improvement-scoped HTML prototype via the existing files API
 * (`mode=preview`) in a new tab. Never injects HTML into the app DOM.
 * Returns false when the popup is blocked; callers should toast and must not
 * fall back to the main file viewer / right-side preview for Studio materials.
 */
export function openStudioTaskHtmlPrototype(options: {
  taskKey: string;
  cwd: string;
  fileName: string;
  improvementId?: string;
  onBlocked?: () => void;
}): boolean {
  const fileName = options.fileName.trim();
  if (!fileName || !options.cwd.trim() || !options.taskKey.trim()) {
    options.onBlocked?.();
    return false;
  }
  const url = buildStudioTaskFileApiUrl({
    taskKey: options.taskKey,
    cwd: options.cwd,
    path: fileName,
    mode: "preview",
    improvementId: options.improvementId,
  });
  const opened = openBlankUrl(url);
  if (!opened) {
    options.onBlocked?.();
    return false;
  }
  return true;
}

/** Shared empty/placeholder detection for Studio task documents. */
export function studioTaskDocumentIsMeaningful(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !/(^|\b)(?:_?TBD(?: by YPI Studio workflow)?_?|待填写|YPI Studio workflow)(\b|$)/i.test(trimmed);
}

/** Sanitize API/network error text so absolute filesystem paths never reach the UI. */
export function describeStudioTaskDocumentError(
  status: number | null,
  raw: string | null,
  labels: { shortName?: string; fileName: string },
): string {
  const shortName = labels.shortName || "资料";
  if (status === 404) return `找不到 ${labels.fileName}，文件可能尚未创建。`;
  if (status === 403) return "无权访问该任务文件。";
  if (status === 400) return "安全规则拒绝了该文件访问。";
  if (status === 413) return `${shortName}过大，无法在预览中读取。`;
  if (status == null) return "网络连接失败，请稍后重试。";

  const cleaned = (raw ?? "")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'`]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned && cleaned.length > 0 && cleaned.length < 140 && !cleaned.includes("/")) {
    return cleaned;
  }
  return `${shortName}读取失败。`;
}
