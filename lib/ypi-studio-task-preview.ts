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
    const opened = typeof window !== "undefined"
      ? window.open(url, "_blank", "noopener,noreferrer")
      : null;
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
 * Returns false when the popup is blocked; callers may fall back to the file viewer.
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
  const opened = typeof window !== "undefined"
    ? window.open(url, "_blank", "noopener,noreferrer")
    : null;
  if (!opened) {
    options.onBlocked?.();
    return false;
  }
  return true;
}
