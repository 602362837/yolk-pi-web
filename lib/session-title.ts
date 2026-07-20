import type { AgentMessage, SessionInfo, TextContent } from "@/lib/types";
import { stripYpiStudioInjections } from "@/lib/ypi-studio-message-display";

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

/** Title seed from user text; strip historical Studio injection blocks before truncate (SCI-04). */
export function sessionTitleSeedFromUserMessage(message: string): string {
  const cleaned = stripYpiStudioInjections(message);
  return truncateSessionTitle(cleaned) || PENDING_SESSION_TITLE;
}

function taskIdTitleFallback(taskId?: string): string {
  const value = taskId?.trim();
  if (!value) return "";
  const parts = value.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? value;
}

export interface StudioChildSessionTitleInput {
  subtaskId?: string;
  subtaskTitle?: string;
  member?: string;
  taskTitle?: string;
  runSummary?: string;
  taskId?: string;
  maxLength?: number;
}

/** Prefer stable step id, then title; drop member from the main title when a subtask is bound. */
function formatSubtaskSessionTitle(subtaskId: string, subtaskTitle: string, maxLength: number): string {
  if (subtaskId.length >= maxLength) return subtaskId.slice(0, maxLength);
  if (!subtaskTitle) return subtaskId;
  const separator = " · ";
  const remaining = maxLength - subtaskId.length - separator.length;
  if (remaining <= 0) return subtaskId;
  const titlePart = subtaskTitle.length > remaining ? subtaskTitle.slice(0, remaining) : subtaskTitle;
  return titlePart ? `${subtaskId}${separator}${titlePart}` : subtaskId;
}

/** Prefer full `member · taskTitle`; when over budget keep the task title (title > member). */
function formatMemberTaskTitle(member: string, taskTitle: string, maxLength: number): string {
  if (member) {
    const full = `${member} · ${taskTitle}`;
    if (full.length <= maxLength) return full;
  }
  return truncateSessionTitle(taskTitle, maxLength);
}

function memberPrefixedStudioChildTitle(member: string, value: string, maxLength: number): string {
  if (!value) return "";
  if (!member) return truncateSessionTitle(value, maxLength);
  return truncateSessionTitle(`${member} · ${value}`, maxLength);
}

/**
 * Canonical Studio child session title for sidebar display and new session_info names.
 * Priority: subtaskId+title > subtaskId > member+taskTitle > member+runSummary > member+taskId.
 */
export function studioChildSessionTitle(input: StudioChildSessionTitleInput): string {
  const maxLength = input.maxLength ?? SESSION_TITLE_MAX_LENGTH;
  const subtaskId = collapseWhitespace(input.subtaskId ?? "");
  const subtaskTitle = collapseWhitespace(input.subtaskTitle ?? "");
  const member = collapseWhitespace(input.member ?? "");
  const taskTitle = collapseWhitespace(input.taskTitle ?? "");
  const runSummary = collapseWhitespace(input.runSummary ?? "");
  const taskId = taskIdTitleFallback(input.taskId);

  if (subtaskId) {
    return formatSubtaskSessionTitle(subtaskId, subtaskTitle, maxLength);
  }
  if (taskTitle) {
    return formatMemberTaskTitle(member, taskTitle, maxLength);
  }
  if (runSummary) {
    return memberPrefixedStudioChildTitle(member, runSummary, maxLength);
  }
  if (taskId) {
    return memberPrefixedStudioChildTitle(member, taskId, maxLength);
  }
  return "";
}

export function displayTitleForSession(session: Pick<SessionInfo, "id" | "name" | "firstMessage" | "messageCount" | "studioChild" | "studioChildDisplay">): string {
  if (session.studioChild) {
    const title = studioChildSessionTitle({
      subtaskId: session.studioChildDisplay?.subtaskId ?? session.studioChild.subtaskId,
      subtaskTitle: session.studioChildDisplay?.subtaskTitle,
      member: session.studioChild.member,
      taskTitle: session.studioChildDisplay?.taskTitle,
      runSummary: session.studioChildDisplay?.runSummary,
      taskId: session.studioChild.taskId,
    });
    if (title) return title;
  }
  if (session.name?.trim()) return session.name.trim();
  // Sidebar display: strip Studio injection noise from firstMessage without rewriting stored metadata.
  const firstMessage = truncateSessionTitle(stripYpiStudioInjections(session.firstMessage ?? ""));
  if (firstMessage) return firstMessage;
  if (session.messageCount === 0) return PENDING_SESSION_TITLE;
  return session.id.slice(0, 12);
}
