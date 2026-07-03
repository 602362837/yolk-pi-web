import { readdirSync, statSync } from "fs";
import { homedir } from "os";
import path from "path";
import { canonicalizeCwd } from "./cwd";

const ALLOWED_ROOTS_TTL_MS = 5_000;
const WINDOWS_ABSOLUTE_RE = /^[a-zA-Z]:[\\/]/;

declare global {
  var __piAllowedRootsCache: { roots: Set<string>; expiresAt: number } | undefined;
  var __piAllowedRootsCachePromise: Promise<Set<string>> | undefined;
  var __piRegisteredAllowedRoots: Set<string> | undefined;
}

function isWindowsAbsolutePath(filePath: string): boolean {
  return WINDOWS_ABSOLUTE_RE.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("//");
}

function createRootVariants(root: string): string[] {
  const canonical = canonicalizeCwd(root);
  return [...new Set([root, canonical].filter(Boolean))];
}

export function registerAllowedRoot(cwd: string): void {
  if (!globalThis.__piRegisteredAllowedRoots) globalThis.__piRegisteredAllowedRoots = new Set();
  for (const root of createRootVariants(cwd)) {
    try {
      if (statSync(root).isDirectory()) globalThis.__piRegisteredAllowedRoots.add(root);
    } catch {
      // Ignore stale paths. They will not be included in future root sets.
    }
  }
  globalThis.__piAllowedRootsCache = undefined;
}

async function buildAllowedRoots(): Promise<Set<string>> {
  const { listSessionCwdsForAllowedRoots } = await import("@/lib/session-reader");
  const sessionCwds = await listSessionCwdsForAllowedRoots();
  const roots = new Set<string>();

  for (const cwd of sessionCwds) {
    for (const root of createRootVariants(cwd)) roots.add(root);
  }

  const home = homedir();
  try {
    for (const name of readdirSync(home)) {
      if (/^pi-cwd-\d{8}$/.test(name)) {
        for (const root of createRootVariants(path.join(home, name))) roots.add(root);
      }
    }
  } catch {
    // Home-directory discovery is best-effort; session roots still work.
  }

  for (const registered of globalThis.__piRegisteredAllowedRoots ?? []) {
    for (const root of createRootVariants(registered)) {
      try {
        if (statSync(root).isDirectory()) roots.add(root);
      } catch {
        // Drop stale registered roots from this cache snapshot.
      }
    }
  }

  return roots;
}

export async function getAllowedRoots(): Promise<Set<string>> {
  const now = Date.now();
  const cached = globalThis.__piAllowedRootsCache;
  if (cached && cached.expiresAt > now) return cached.roots;
  if (globalThis.__piAllowedRootsCachePromise) return globalThis.__piAllowedRootsCachePromise;

  const promise = buildAllowedRoots()
    .then((roots) => {
      globalThis.__piAllowedRootsCache = { roots, expiresAt: Date.now() + ALLOWED_ROOTS_TTL_MS };
      return roots;
    })
    .finally(() => {
      globalThis.__piAllowedRootsCachePromise = undefined;
    });
  globalThis.__piAllowedRootsCachePromise = promise;
  return promise;
}

export function isPathAllowed(target: string, allowedRoots: Set<string>): boolean {
  for (const root of allowedRoots) {
    const useWindowsRules = isWindowsAbsolutePath(target) || isWindowsAbsolutePath(root);
    const resolver = useWindowsRules ? path.win32 : path;
    const sep = useWindowsRules ? "\\" : path.sep;
    const normalized = resolver.resolve(target);
    const normalizedRoot = resolver.resolve(root);
    const comparable = useWindowsRules ? normalized.toLowerCase() : normalized;
    const comparableRoot = useWindowsRules ? normalizedRoot.toLowerCase() : normalizedRoot;
    const rootWithSep = comparableRoot.endsWith(sep) ? comparableRoot : comparableRoot + sep;
    if (comparable === comparableRoot || comparable.startsWith(rootWithSep)) {
      return true;
    }
  }
  return false;
}
