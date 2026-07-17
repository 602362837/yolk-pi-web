/**
 * web-auth-config-value — resolve auth.json API-key config values
 *
 * Compatible with pi coding-agent 0.80.x `resolveConfigValue` semantics:
 * - leading `!command` executes a shell command (stdout, cached)
 * - `$ENV` / `${ENV}` interpolate environment / credential-env values
 * - `$$` / `$!` escape a literal `$` / `!` in non-command values
 * - otherwise treat the string as a literal
 *
 * `list()` callers must never invoke these helpers so configured commands are
 * not executed while enumerating credential metadata.
 */

import { execSync, spawnSync } from "node:child_process";

const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ENV_VAR_NAME_PREFIX_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

type TemplatePart =
  | { type: "literal"; value: string }
  | { type: "env"; name: string };

type ConfigValueReference =
  | { type: "command"; config: string }
  | { type: "template"; parts: TemplatePart[] };

const commandResultCache = new Map<string, string | undefined>();

function appendLiteral(parts: TemplatePart[], value: string): void {
  if (!value) return;
  const previous = parts[parts.length - 1];
  if (previous?.type === "literal") {
    previous.value += value;
    return;
  }
  parts.push({ type: "literal", value });
}

function parseConfigValueTemplate(config: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let index = 0;
  while (index < config.length) {
    const dollarIndex = config.indexOf("$", index);
    if (dollarIndex < 0) {
      appendLiteral(parts, config.slice(index));
      break;
    }
    appendLiteral(parts, config.slice(index, dollarIndex));
    const nextChar = config[dollarIndex + 1];
    if (nextChar === "$" || nextChar === "!") {
      appendLiteral(parts, nextChar);
      index = dollarIndex + 2;
      continue;
    }
    if (nextChar === "{") {
      const endIndex = config.indexOf("}", dollarIndex + 2);
      if (endIndex < 0) {
        appendLiteral(parts, "$");
        index = dollarIndex + 1;
        continue;
      }
      const name = config.slice(dollarIndex + 2, endIndex);
      if (ENV_VAR_NAME_RE.test(name)) {
        parts.push({ type: "env", name });
      } else {
        appendLiteral(parts, config.slice(dollarIndex, endIndex + 1));
      }
      index = endIndex + 1;
      continue;
    }
    const match = config.slice(dollarIndex + 1).match(ENV_VAR_NAME_PREFIX_RE);
    if (match) {
      parts.push({ type: "env", name: match[0] });
      index = dollarIndex + 1 + match[0].length;
      continue;
    }
    appendLiteral(parts, "$");
    index = dollarIndex + 1;
  }
  return parts;
}

function parseConfigValueReference(config: string): ConfigValueReference {
  if (config.startsWith("!")) {
    return { type: "command", config };
  }
  return { type: "template", parts: parseConfigValueTemplate(config) };
}

function resolveEnvConfigValue(
  name: string,
  env?: Record<string, string>,
): string | undefined {
  return env?.[name] || process.env[name] || undefined;
}

function resolveTemplate(
  parts: TemplatePart[],
  env?: Record<string, string>,
): string | undefined {
  let resolved = "";
  for (const part of parts) {
    if (part.type === "literal") {
      resolved += part.value;
      continue;
    }
    const envValue = resolveEnvConfigValue(part.name, env);
    if (envValue === undefined) return undefined;
    resolved += envValue;
  }
  return resolved;
}

export function isCommandConfigValue(config: string): boolean {
  return parseConfigValueReference(config).type === "command";
}

export function getConfigValueEnvVarNames(config: string): string[] {
  const reference = parseConfigValueReference(config);
  if (reference.type !== "template") return [];
  const names: string[] = [];
  for (const part of reference.parts) {
    if (part.type !== "env" || names.includes(part.name)) continue;
    names.push(part.name);
  }
  return names;
}

function executeWithDefaultShell(command: string): string | undefined {
  try {
    const output = execSync(command, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.trim() || undefined;
  } catch {
    return undefined;
  }
}

function executeWithConfiguredShell(command: string): {
  executed: boolean;
  value: string | undefined;
} {
  try {
    // Prefer /bin/sh when available; fall back to Node's default shell path.
    const shell = process.env.SHELL && process.env.SHELL.length > 0 ? process.env.SHELL : "/bin/sh";
    const result = spawnSync(shell, ["-c", command], {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      shell: false,
      windowsHide: true,
    });
    if (result.error) {
      const error = result.error as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        return { executed: false, value: undefined };
      }
      return { executed: true, value: undefined };
    }
    if (result.status !== 0) {
      return { executed: true, value: undefined };
    }
    const value = (result.stdout ?? "").trim();
    return { executed: true, value: value || undefined };
  } catch {
    return { executed: false, value: undefined };
  }
}

function executeCommandUncached(commandConfig: string): string | undefined {
  const command = commandConfig.slice(1);
  if (process.platform === "win32") {
    const configured = executeWithConfiguredShell(command);
    return configured.executed ? configured.value : executeWithDefaultShell(command);
  }
  return executeWithDefaultShell(command);
}

function executeCommand(commandConfig: string): string | undefined {
  if (commandResultCache.has(commandConfig)) {
    return commandResultCache.get(commandConfig);
  }
  const result = executeCommandUncached(commandConfig);
  commandResultCache.set(commandConfig, result);
  return result;
}

/**
 * Resolve a config value (API key, header value, etc.) to an actual value.
 * - If starts with "!", executes the rest as a shell command and uses stdout (cached)
 * - Interpolates "$ENV_VAR" or "${ENV_VAR}" references with the named environment variable
 * - In non-command values, "$$" escapes a literal "$" and "$!" escapes a literal "!"
 * - Otherwise treats the value as a literal
 */
export function resolveConfigValue(
  config: string,
  env?: Record<string, string>,
): string | undefined {
  const reference = parseConfigValueReference(config);
  if (reference.type === "command") {
    return executeCommand(reference.config);
  }
  return resolveTemplate(reference.parts, env);
}

/** Clear the config value command cache. Exported for testing. */
export function clearConfigValueCache(): void {
  commandResultCache.clear();
}
