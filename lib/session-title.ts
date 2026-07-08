import type { AgentMessage, SessionInfo, TextContent } from "@/lib/types";

export const PENDING_SESSION_TITLE = "待首条消息命名";
export const SESSION_TITLE_MAX_LENGTH = 50;

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function truncateSessionTitle(value: string, maxLength = SESSION_TITLE_MAX_LENGTH): string {
  const normalized = collapseWhitespace(value);
  return normalized.length > maxLength ? normalized.slice(0, maxLength) : normalized;
}

export function firstTextFromMessageContent(content: AgentMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => block.type === "text" ? (block as TextContent).text : "")
    .filter(Boolean)
    .join(" ");
}

export function sessionTitleSeedFromUserMessage(message: string): string {
  return truncateSessionTitle(message) || PENDING_SESSION_TITLE;
}

function taskIdTitleFallback(taskId?: string): string {
  const value = taskId?.trim();
  if (!value) return "";
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

function memberPrefixedStudioChildTitle(member: string | undefined, value: string | undefined): string {
  const normalized = collapseWhitespace(value ?? "");
  if (!normalized) return "";
  const normalizedMember = collapseWhitespace(member ?? "");
  return truncateSessionTitle(normalizedMember ? `${normalizedMember} · ${normalized}` : normalized);
}

export function displayTitleForSession(session: Pick<SessionInfo, "id" | "name" | "firstMessage" | "messageCount" | "studioChild" | "studioChildDisplay">): string {
  if (session.studioChild) {
    const subtaskTitle = truncateSessionTitle(session.studioChildDisplay?.subtaskTitle ?? "");
    if (subtaskTitle) return subtaskTitle;
    const taskTitle = memberPrefixedStudioChildTitle(session.studioChild.member, session.studioChildDisplay?.taskTitle);
    if (taskTitle) return taskTitle;
    const runSummary = memberPrefixedStudioChildTitle(session.studioChild.member, session.studioChildDisplay?.runSummary);
    if (runSummary) return runSummary;
    const taskId = memberPrefixedStudioChildTitle(session.studioChild.member, taskIdTitleFallback(session.studioChild.taskId));
    if (taskId) return taskId;
  }
  if (session.name?.trim()) return session.name.trim();
  const firstMessage = truncateSessionTitle(session.firstMessage ?? "");
  if (firstMessage) return firstMessage;
  if (session.messageCount === 0) return PENDING_SESSION_TITLE;
  return session.id.slice(0, 12);
}
