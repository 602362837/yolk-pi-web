"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  buildStudioTaskFileApiUrl,
  describeStudioTaskDocumentError,
  openStudioTaskDocumentInNewTab,
  openStudioTaskHtmlPrototype,
  resolveTaskRelativeHref,
  studioTaskDocumentIsMeaningful,
  type TaskRelativeLinkNotice,
} from "@/lib/ypi-studio-task-preview";

export type YpiStudioTaskDocumentTarget = {
  path: string;
  fileName?: string;
  improvementId?: string;
};

export type YpiStudioTaskDocumentViewProps = {
  taskKey: string;
  cwd: string;
  path: string;
  improvementId?: string;
  /** Optional human task title shown in the chrome. */
  taskTitle?: string;
  /**
   * `page` — standalone browser tab chrome.
   * `embedded` — Studio task-detail internal document chrome with optional back.
   */
  presentation?: "page" | "embedded";
  /** Back control for embedded presentation. */
  onBack?: () => void;
  backLabel?: string;
  /**
   * Embedded-only: open the next non-HTML task-local document in-place.
   * When omitted, non-HTML links open another document page tab.
   */
  onOpenTaskDocument?: (target: YpiStudioTaskDocumentTarget) => void;
  /** Optional focus restore hook after back is pressed. */
  autoFocusBack?: boolean;
  className?: string;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; content: string; truncated: boolean }
  | { kind: "empty"; content: string; truncated: boolean }
  | { kind: "error"; message: string; status: number | null };

function fileNameFromPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] || path;
}

export function YpiStudioTaskDocumentView({
  taskKey,
  cwd,
  path,
  improvementId,
  taskTitle,
  presentation = "page",
  onBack,
  backLabel = "返回",
  onOpenTaskDocument,
  autoFocusBack = true,
  className,
}: YpiStudioTaskDocumentViewProps) {
  const titleId = useId();
  const backButtonRef = useRef<HTMLButtonElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [linkNotice, setLinkNotice] = useState<TaskRelativeLinkNotice | null>(null);

  const normalizedPath = path.trim();
  const fileName = fileNameFromPath(normalizedPath);
  const isImprovement = Boolean(improvementId);
  const shortName = isImprovement ? "改进资料" : "任务资料";
  const canFetch = Boolean(taskKey.trim() && cwd.trim() && normalizedPath);

  useEffect(() => {
    setLinkNotice(null);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [taskKey, cwd, normalizedPath, improvementId]);

  useEffect(() => {
    if (!autoFocusBack || presentation !== "embedded" || !onBack) return;
    const frame = window.requestAnimationFrame(() => {
      backButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [autoFocusBack, presentation, onBack, taskKey, normalizedPath, improvementId]);

  useEffect(() => {
    if (!canFetch) {
      setLoadState({
        kind: "error",
        status: null,
        message: "缺少任务、工作区或资料路径，无法读取。",
      });
      return;
    }

    const controller = new AbortController();
    let active = true;
    setLoadState({ kind: "loading" });
    setLinkNotice(null);

    void (async () => {
      try {
        const url = buildStudioTaskFileApiUrl({
          taskKey,
          cwd,
          path: normalizedPath,
          mode: "read",
          improvementId,
        });
        const res = await fetch(url, { signal: controller.signal });
        const body = await res.json().catch(() => ({})) as {
          content?: string;
          error?: string;
          truncated?: boolean;
        };
        if (!active) return;

        if (!res.ok || body.error) {
          setLoadState({
            kind: "error",
            status: res.status || null,
            message: describeStudioTaskDocumentError(res.status || null, body.error ?? null, {
              shortName,
              fileName,
            }),
          });
          return;
        }

        const content = body.content ?? "";
        const truncated = Boolean(body.truncated);
        if (!studioTaskDocumentIsMeaningful(content)) {
          setLoadState({ kind: "empty", content, truncated });
          return;
        }
        setLoadState({ kind: "success", content, truncated });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        if (!active) return;
        setLoadState({
          kind: "error",
          status: null,
          message: describeStudioTaskDocumentError(
            null,
            err instanceof Error ? err.message : String(err),
            { shortName, fileName },
          ),
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [canFetch, cwd, taskKey, normalizedPath, improvementId, shortName, fileName, retryToken]);

  const handleRetry = useCallback(() => {
    setRetryToken((value) => value + 1);
  }, []);

  const publishNotice = useCallback((notice: TaskRelativeLinkNotice) => {
    setLinkNotice(notice);
  }, []);

  const handleLinkClick = useCallback((
    href: string,
    label: string,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ) => {
    event.preventDefault();
    const resolved = resolveTaskRelativeHref(href);
    if (!resolved.ok) {
      publishNotice({ tone: "error", text: resolved.message });
      return false;
    }

    if (resolved.isHtml) {
      const opened = openStudioTaskHtmlPrototype({
        taskKey,
        cwd,
        fileName: resolved.path,
        improvementId,
        onBlocked: () => {
          publishNotice({
            tone: "warning",
            text: "浏览器阻止了新标签，请允许此站点弹窗后重试",
          });
        },
      });
      if (opened) {
        publishNotice({
          tone: "info",
          text: `已在新标签打开安全原型：${label || resolved.fileName}`,
        });
      }
      return false;
    }

    if (presentation === "embedded" && onOpenTaskDocument) {
      publishNotice({
        tone: "info",
        text: `正在打开：${label || resolved.fileName}`,
      });
      onOpenTaskDocument({
        path: resolved.path,
        fileName: resolved.fileName,
        improvementId,
      });
      return false;
    }

    const result = openStudioTaskDocumentInNewTab({
      taskKey,
      cwd,
      path: resolved.path,
      improvementId,
      title: taskTitle || label || resolved.fileName,
    });
    if (!result.ok) {
      publishNotice({
        tone: result.reason === "blocked" ? "warning" : "error",
        text: result.message,
      });
      return false;
    }
    publishNotice({
      tone: "info",
      text: `已在新标签打开：${label || resolved.fileName}`,
    });
    return false;
  }, [cwd, improvementId, onOpenTaskDocument, presentation, publishNotice, taskKey, taskTitle]);

  const metaPath = improvementId
    ? `improvements/${improvementId}/${normalizedPath}`
    : normalizedPath;
  const kindLabel = isImprovement
    ? `只读 · 改进资料 · ${improvementId}`
    : "只读 · 任务资料";
  const rootClass = [
    "ypi-studio-task-document",
    presentation === "page" ? "is-page" : "is-embedded",
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={rootClass}>
      <header className="ypi-studio-task-document-head">
        {presentation === "embedded" && onBack ? (
          <button
            ref={backButtonRef}
            type="button"
            className="ypi-studio-task-document-back"
            onClick={onBack}
          >
            {backLabel.startsWith("←") ? backLabel : `← ${backLabel}`}
          </button>
        ) : null}

        <div className="ypi-studio-task-document-title-wrap">
          <div className="ypi-studio-task-document-eyebrow">{kindLabel}</div>
          <h1 id={titleId} className="ypi-studio-task-document-title">
            {taskTitle?.trim() || taskKey}
          </h1>
          <div className="ypi-studio-task-document-subtitle" title={metaPath}>
            {fileName}
            <span className="ypi-studio-task-document-path"> · {metaPath}</span>
          </div>
        </div>

        <span className="ypi-studio-task-document-readonly-badge" role="status">
          只读
        </span>
      </header>

      <div className="ypi-studio-task-document-readonly" role="note">
        <strong>只读查看：</strong>
        按需读取任务目录内资料，不会批准计划、写入 grant 或触发工作流 transition。
      </div>

      {linkNotice && (
        <div
          className={`ypi-studio-task-document-notice is-${linkNotice.tone}`}
          role="status"
          aria-live="polite"
        >
          {linkNotice.text}
        </div>
      )}

      <div
        ref={bodyRef}
        className="ypi-studio-task-document-body"
        aria-labelledby={titleId}
        aria-live="polite"
        tabIndex={0}
      >
        {loadState.kind === "loading" || loadState.kind === "idle" ? (
          <div className="ypi-studio-task-document-state-center">
            <div className="ypi-studio-task-document-state-card">
              <div className="ypi-studio-task-document-state-icon" aria-hidden="true">
                <span className="ypi-studio-task-document-spinner" />
              </div>
              <h2>正在读取资料…</h2>
              <p>正文仅在打开后按需加载，不会写入任务状态。</p>
            </div>
          </div>
        ) : loadState.kind === "error" ? (
          <div className="ypi-studio-task-document-state-center is-error">
            <div className="ypi-studio-task-document-state-card">
              <div className="ypi-studio-task-document-state-icon" aria-hidden="true">!</div>
              <h2>资料读取失败</h2>
              <p>{loadState.message}</p>
              <button
                type="button"
                className="ypi-studio-task-document-retry"
                onClick={handleRetry}
              >
                重试
              </button>
            </div>
          </div>
        ) : loadState.kind === "empty" ? (
          <div className="ypi-studio-task-document-state-center">
            <div className="ypi-studio-task-document-state-card">
              <div className="ypi-studio-task-document-state-icon" aria-hidden="true">▤</div>
              <h2>资料尚未准备好</h2>
              <p>{fileName} 为空或仍为占位内容，暂无可读正文。</p>
              <button
                type="button"
                className="ypi-studio-task-document-secondary-btn"
                onClick={handleRetry}
              >
                重新读取
              </button>
            </div>
          </div>
        ) : (
          <div className="ypi-studio-task-document-markdown-wrap">
            {loadState.truncated && (
              <div className="ypi-studio-task-document-truncated-note" role="status">
                文件内容已截断，完整正文请通过源文件查看。
              </div>
            )}
            <MarkdownBody onLinkClick={handleLinkClick}>{loadState.content}</MarkdownBody>
          </div>
        )}
      </div>
    </div>
  );
}
