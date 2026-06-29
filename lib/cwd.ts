import { existsSync, realpathSync } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";

export function expandCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

export function canonicalizeCwd(cwd: string): string {
  const expanded = expandCwd(cwd);
  try {
    return realpathSync.native(expanded);
  } catch {
    return expanded;
  }
}

export function existingCanonicalCwd(cwd: string): string | null {
  const canonical = canonicalizeCwd(cwd);
  return existsSync(canonical) ? canonical : null;
}
