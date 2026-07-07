import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { SessionHeader } from "./types";

export function writeSessionHeader(filePath: string, patch: Partial<SessionHeader>, baseHeader?: SessionHeader): SessionHeader | null {
  const fileExists = existsSync(filePath);
  const content = fileExists ? readFileSync(filePath, "utf8") : "";
  const newlineIndex = content.indexOf("\n");
  const firstLine = newlineIndex >= 0 ? content.slice(0, newlineIndex) : content;
  const rest = fileExists ? (newlineIndex >= 0 ? content.slice(newlineIndex) : "\n") : "\n";
  const header = firstLine.trim() ? JSON.parse(firstLine) as SessionHeader : baseHeader;
  if (header?.type !== "session") return null;
  const next = { ...header, ...patch } as SessionHeader;
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next)}${rest}`, "utf8");
  return next;
}
