import type { TrellisTaskDetail } from "./trellis-types";

export interface TrellisTaskChatContext {
  dirName: string;
  title: string;
  status: string;
  progressLabel: string;
}

function taskPath(dirName: string): string {
  return `.trellis/tasks/${dirName}`;
}

export function trellisTaskDetailToChatContext(task: TrellisTaskDetail): TrellisTaskChatContext {
  return {
    dirName: task.dirName,
    title: task.title,
    status: task.status,
    progressLabel: task.progress.label,
  };
}

export function buildTrellisTaskResumePrompt(context: TrellisTaskChatContext): string {
  const path = taskPath(context.dirName);
  return [
    "继续 Trellis 任务：",
    "",
    `Active task: ${path}`,
    "",
    `任务标题：${context.title}`,
    `当前状态：${context.status}`,
    `当前阶段：${context.progressLabel}`,
    `任务目录：${path}`,
    "",
    "请先读取并遵循该任务的 Trellis 上下文：",
    `- ${path}/prd.md`,
    `- ${path}/design.md（如果存在）`,
    `- ${path}/implement.md（如果存在）`,
    `- ${path}/implement.jsonl / check.jsonl（如果存在）`,
    "",
    "我接下来会补充新的要求。除非我明确要求开始实现，否则先帮我恢复任务背景、确认当前阶段，并给出下一步建议。",
  ].join("\n");
}
