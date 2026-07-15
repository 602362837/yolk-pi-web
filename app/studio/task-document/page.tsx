"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { YpiStudioTaskDocumentView } from "@/components/YpiStudioTaskDocumentView";

function TaskDocumentPageInner() {
  const searchParams = useSearchParams();

  const query = useMemo(() => {
    const taskKey = searchParams.get("taskKey")?.trim() ?? "";
    const cwd = searchParams.get("cwd")?.trim() ?? "";
    const path = searchParams.get("path")?.trim() ?? "";
    const improvementId = searchParams.get("improvementId")?.trim() || undefined;
    const title = searchParams.get("title")?.trim() || undefined;
    return { taskKey, cwd, path, improvementId, title };
  }, [searchParams]);

  if (!query.taskKey || !query.cwd || !query.path) {
    return (
      <main className="ypi-studio-task-document-page">
        <div className="ypi-studio-task-document is-page">
          <div className="ypi-studio-task-document-state-center is-error">
            <div className="ypi-studio-task-document-state-card">
              <div className="ypi-studio-task-document-state-icon" aria-hidden="true">!</div>
              <h2>无法打开任务资料</h2>
              <p>链接缺少 taskKey、cwd 或 path。请从 YPI Studio 浮窗或任务详情重新打开。</p>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="ypi-studio-task-document-page">
      <YpiStudioTaskDocumentView
        presentation="page"
        taskKey={query.taskKey}
        cwd={query.cwd}
        path={query.path}
        improvementId={query.improvementId}
        taskTitle={query.title}
      />
    </main>
  );
}

export default function StudioTaskDocumentPage() {
  return (
    <Suspense
      fallback={(
        <main className="ypi-studio-task-document-page">
          <div className="ypi-studio-task-document is-page">
            <div className="ypi-studio-task-document-state-center">
              <div className="ypi-studio-task-document-state-card">
                <div className="ypi-studio-task-document-state-icon" aria-hidden="true">
                  <span className="ypi-studio-task-document-spinner" />
                </div>
                <h2>正在打开资料…</h2>
                <p>只读页面加载中。</p>
              </div>
            </div>
          </div>
        </main>
      )}
    >
      <TaskDocumentPageInner />
    </Suspense>
  );
}
