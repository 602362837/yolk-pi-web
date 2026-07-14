"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { MarkdownBody } from "@/components/MarkdownBody";
import {
  buildStudioTaskFileApiUrl,
  improvementRelativePath,
  openTaskRelativeLink,
  taskRelativeFilePath,
  type TaskRelativeLinkNotice,
} from "@/lib/ypi-studio-task-preview";

const PLAN_REVIEW_FILE = "plan-review.md";
const FOCUSABLE_SELECTOR = [
  "button:not([disabled]):not([tabindex='-1'])",
  "a[href]:not([tabindex='-1'])",
  "input:not([disabled]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export type YpiStudioPlanReviewTarget = {
  taskKey: string;
  taskTitle: string;
  /** Task directory label used by the existing file viewer path builder. */
  pathLabel: string;
  improvementId?: string;
  improvementDisplayId?: string;
  /** Defaults to plan-review.md. */
  fileName?: string;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "success"; content: string; truncated: boolean }
  | { kind: "empty"; content: string; truncated: boolean }
  | { kind: "error"; message: string; status: number | null };

export type YpiStudioPlanReviewModalProps = {
  open: boolean;
  cwd: string;
  target: YpiStudioPlanReviewTarget | null;
  onClose: () => void;
  onOpenFile?: (filePath: string, fileName: string) => void;
};

/** Match YpiStudioPanel artifactDocumentIsMeaningful for plan-review placeholders. */
function planReviewContentIsMeaningful(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return !/(^|\b)(?:_?TBD(?: by YPI Studio workflow)?_?|待填写|YPI Studio workflow)(\b|$)/i.test(trimmed);
}

function describePlanReviewError(
  status: number | null,
  raw: string | null,
  labels: { shortName: string; fileName: string },
): string {
  if (status === 404) return `找不到 ${labels.fileName}，文件可能尚未创建。`;
  if (status === 403) return "无权访问该任务文件。";
  if (status === 400) return "安全规则拒绝了该文件访问。";
  if (status === 413) return `${labels.shortName}过大，无法在预览中读取。`;
  if (status == null) return "网络连接失败，请稍后重试。";

  const cleaned = (raw ?? "")
    .replace(/(?:[A-Za-z]:)?[\\/][^\s"'`]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (cleaned && cleaned.length > 0 && cleaned.length < 140 && !cleaned.includes("/")) {
    return cleaned;
  }
  return `${labels.shortName}读取失败。`;
}

function sourceRelativePath(target: YpiStudioPlanReviewTarget): string {
  const fileName = target.fileName?.trim() || PLAN_REVIEW_FILE;
  if (!target.improvementId) return fileName;
  return improvementRelativePath(target.improvementId, fileName);
}

export function YpiStudioPlanReviewModal({
  open,
  cwd,
  target,
  onClose,
  onOpenFile,
}: YpiStudioPlanReviewModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [linkNotice, setLinkNotice] = useState<TaskRelativeLinkNotice | null>(null);

  const targetTaskKey = target?.taskKey ?? "";
  const targetImprovementId = target?.improvementId ?? "";
  const targetFileName = target?.fileName?.trim() || PLAN_REVIEW_FILE;
  const isImprovement = Boolean(target?.improvementId);
  const shortName = isImprovement ? "改进计划" : "计划审批书";
  const canFetch = open && Boolean(target) && Boolean(cwd.trim());

  useEffect(() => {
    setMounted(true);
  }, []);

  // Capture the original trigger once per open cycle; re-focus close on target switch.
  useEffect(() => {
    if (!open || !targetTaskKey) return;
    if (!restoreFocusRef.current) {
      const active = document.activeElement;
      restoreFocusRef.current = active instanceof HTMLElement ? active : null;
    }
    const frame = window.requestAnimationFrame(() => {
      closeButtonRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, targetTaskKey, targetImprovementId]);

  // Restore focus when the dialog closes or unmounts while open.
  useEffect(() => {
    if (!open) {
      const previous = restoreFocusRef.current;
      if (previous?.isConnected) previous.focus();
      restoreFocusRef.current = null;
    }
    return () => {
      if (!open) return;
      const previous = restoreFocusRef.current;
      if (previous?.isConnected) previous.focus();
      restoreFocusRef.current = null;
    };
  }, [open]);

  // Reset transient UI when the target changes or the dialog closes.
  useEffect(() => {
    setLinkNotice(null);
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
    if (!open || !targetTaskKey) {
      setLoadState({ kind: "idle" });
    }
  }, [open, targetTaskKey, targetImprovementId, targetFileName]);

  // Fetch plan-review.md only while open. Abort on target/retry/session change.
  useEffect(() => {
    if (!canFetch || !targetTaskKey) return;

    const controller = new AbortController();
    const improvementId = targetImprovementId || undefined;
    let active = true;

    setLoadState({ kind: "loading" });
    setLinkNotice(null);

    void (async () => {
      try {
        const url = buildStudioTaskFileApiUrl({
          taskKey: targetTaskKey,
          cwd,
          path: targetFileName,
          mode: "read",
          improvementId,
        });
        const res = await fetch(url, { signal: controller.signal });
        const body = await res.json().catch(() => ({})) as { content?: string; error?: string; truncated?: boolean };
        if (!active) return;

        if (!res.ok || body.error) {
          setLoadState({
            kind: "error",
            status: res.status || null,
            message: describePlanReviewError(res.status || null, body.error ?? null, {
              shortName,
              fileName: targetFileName,
            }),
          });
          return;
        }

        const content = body.content ?? "";
        const truncated = Boolean(body.truncated);
        if (!planReviewContentIsMeaningful(content)) {
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
          message: describePlanReviewError(null, err instanceof Error ? err.message : String(err), {
            shortName,
            fileName: targetFileName,
          }),
        });
      }
    })();

    return () => {
      active = false;
      controller.abort();
    };
  }, [canFetch, cwd, targetTaskKey, targetImprovementId, targetFileName, shortName, retryToken]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open || !target) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialogRef.current.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [open, target, handleClose]);

  const handleRetry = useCallback(() => {
    setRetryToken((value) => value + 1);
  }, []);

  const handleOpenSource = useCallback(() => {
    if (!target || !onOpenFile) return;
    const fileName = target.fileName?.trim() || PLAN_REVIEW_FILE;
    onOpenFile(
      taskRelativeFilePath(cwd, { pathLabel: target.pathLabel }, sourceRelativePath(target)),
      fileName,
    );
  }, [cwd, onOpenFile, target]);

  const handleLinkClick = useCallback((href: string, label: string, event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (!target) return false;
    return openTaskRelativeLink({
      cwd,
      task: { key: target.taskKey, pathLabel: target.pathLabel },
      href,
      label,
      onOpenFile,
      setNotice: setLinkNotice,
      improvementId: target.improvementId,
    });
  }, [cwd, onOpenFile, target]);

  if (!mounted || !open || !target) return null;

  const fileName = target.fileName?.trim() || PLAN_REVIEW_FILE;
  const displayId = target.improvementDisplayId || target.improvementId;
  const planKindLabel = isImprovement
    ? `只读 · 改进计划${displayId ? ` · ${displayId}` : ""}`
    : "只读 · 主计划";
  const planMetaLabel = isImprovement
    ? `${shortName} · improvements/${target.improvementId}/${fileName}`
    : `${shortName} · ${fileName}`;
  const closeAriaLabel = isImprovement ? "关闭改进计划预览" : "关闭计划审批书预览";
  const loadingTitle = isImprovement ? "正在读取改进计划…" : "正在读取计划审批书…";
  const errorTitle = isImprovement ? "改进计划读取失败" : "计划审批书读取失败";
  const emptyTitle = isImprovement ? "改进计划尚未准备好" : "计划审批书尚未准备好";
  const emptyBody = isImprovement
    ? `${fileName} 为空或仍为 TBD，暂不能作为可审批材料。`
    : `${fileName} 为空或仍为 TBD，暂不能作为可审批材料。`;
  const readonlyBody = isImprovement
    ? "预览不会修改或批准改进计划；修改请在绑定聊天中进行，批准仍需在聊天中明确回复。"
    : "预览不会自动批准计划，仍需在绑定聊天中明确回复确认或提出修改。";

  const dialog = (
    <div
      className="ypi-studio-plan-review-modal-layer"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="ypi-studio-plan-review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="ypi-studio-plan-review-dialog-head">
          <div className="ypi-studio-plan-review-dialog-title-wrap">
            <div className="ypi-studio-plan-review-eyebrow">{planKindLabel}</div>
            <h2 id={titleId} className="ypi-studio-plan-review-dialog-title">
              {target.taskTitle || target.taskKey}
            </h2>
            <div className="ypi-studio-plan-review-subtitle">{planMetaLabel}</div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="ypi-studio-plan-review-icon-btn"
            aria-label={closeAriaLabel}
            title="关闭（Esc）"
            onClick={handleClose}
          >
            ×
          </button>
        </header>

        <div className="ypi-studio-plan-review-readonly" role="note">
          <strong>只读预览：</strong>
          {readonlyBody}
        </div>

        {linkNotice && (
          <div
            className={`ypi-studio-plan-review-link-notice is-${linkNotice.tone}`}
            role="status"
            aria-live="polite"
          >
            {linkNotice.text}
          </div>
        )}

        <div
          ref={bodyRef}
          className="ypi-studio-plan-review-dialog-body"
          aria-live="polite"
        >
          {loadState.kind === "loading" || loadState.kind === "idle" ? (
            <div className="ypi-studio-plan-review-state-center">
              <div className="ypi-studio-plan-review-state-card">
                <div className="ypi-studio-plan-review-state-icon" aria-hidden="true">
                  <span className="ypi-studio-plan-review-spinner" />
                </div>
                <h3>{loadingTitle}</h3>
                <p>正文仅在你打开预览后按需读取。预览不会批准或写入状态。</p>
              </div>
            </div>
          ) : loadState.kind === "error" ? (
            <div className="ypi-studio-plan-review-state-center is-error">
              <div className="ypi-studio-plan-review-state-card">
                <div className="ypi-studio-plan-review-state-icon" aria-hidden="true">!</div>
                <h3>{errorTitle}</h3>
                <p>{loadState.message}</p>
                <button type="button" className="ypi-studio-plan-review-retry" onClick={handleRetry}>
                  重试
                </button>
              </div>
            </div>
          ) : loadState.kind === "empty" ? (
            <div className="ypi-studio-plan-review-state-center">
              <div className="ypi-studio-plan-review-state-card">
                <div className="ypi-studio-plan-review-state-icon" aria-hidden="true">▤</div>
                <h3>{emptyTitle}</h3>
                <p>{emptyBody}</p>
                <button type="button" className="ypi-studio-plan-review-secondary-btn" onClick={handleRetry}>
                  重新读取
                </button>
              </div>
            </div>
          ) : (
            <div className="ypi-studio-plan-review-markdown-wrap">
              {loadState.truncated && (
                <div className="ypi-studio-plan-review-truncated-note" role="status">
                  文件内容已截断，完整正文请通过源文件查看。
                </div>
              )}
              <MarkdownBody onLinkClick={handleLinkClick}>{loadState.content}</MarkdownBody>
            </div>
          )}
        </div>

        <footer className="ypi-studio-plan-review-dialog-foot">
          <span>安全读取 · 任务目录内相对链接 · 无批准控件</span>
          <button
            type="button"
            className="ypi-studio-plan-review-source-link"
            onClick={handleOpenSource}
            disabled={!onOpenFile}
          >
            打开源文件 ↗
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
