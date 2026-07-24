/**
 * github-validation-broker — operator-owned validation commands for unattended jobs (GHA-06).
 *
 * Rules:
 * - Commands come only from automation config (`unattended.validationCommands`).
 * - Issue / comment / plan text cannot set, append, or replace validation commands.
 * - Branch / remote / publish values are never taken from Issue text (publisher is GHA-07).
 * - Runs under the WorkTree cwd with automation-owned secrets scrubbed from env.
 * - Full agent residual risk remains: this broker is a publish gate input, not a sandbox.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS,
  type GithubAutomationUnattendedConfig,
} from "./github-automation-types";
import { scrubGithubAutomationOwnedSecretsFromEnv } from "./github-full-agent-profile";

const execFileAsync = promisify(execFile);

const DEFAULT_TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_CHARS = 32_000;

export interface GithubValidationCommandSpec {
  /** Display label only (safe; no secrets). */
  label: string;
  /** Fixed argv: [executable, ...args]. Never a shell string from Issue text. */
  argv: readonly string[];
}

export interface GithubValidationRunResult {
  ok: boolean;
  commandLabel: string;
  argv: readonly string[];
  exitCode: number | null;
  timedOut: boolean;
  stdoutPreview: string;
  stderrPreview: string;
  durationMs: number;
  /** Safe reason code when failed. */
  reasonCode: string | null;
}

export interface GithubValidationBrokerResult {
  ok: boolean;
  results: GithubValidationRunResult[];
  /** Operator-configured command count that ran (or would run). */
  commandCount: number;
  reasonCode: string | null;
}

/**
 * Parse a fixed operator command string into argv.
 * Only supports simple space-separated forms used by defaults
 * (`npm run lint`, `node_modules/.bin/tsc --noEmit`).
 * Rejects shell metacharacters so Issue-influenced strings cannot sneak in.
 */
export function parseFixedValidationCommand(
  command: string,
): GithubValidationCommandSpec | null {
  const trimmed = command.trim();
  if (!trimmed) return null;
  if (/[;&|`$<>\n\r]/.test(trimmed)) return null;
  if (trimmed.includes("&&") || trimmed.includes("||")) return null;
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  // Absolute or relative path first token only from config — never from Issue.
  return {
    label: trimmed,
    argv: parts,
  };
}

/**
 * Resolve validation argv list strictly from unattended config.
 * Falls back to product defaults when config list is empty.
 * Issue text is never consulted.
 */
export function resolveGithubValidationCommands(
  unattended: Pick<GithubAutomationUnattendedConfig, "validationCommands"> | null | undefined,
): GithubValidationCommandSpec[] {
  const configured = Array.isArray(unattended?.validationCommands)
    ? unattended!.validationCommands
    : [];
  const source =
    configured.length > 0
      ? configured
      : [...GITHUB_AUTOMATION_DEFAULT_VALIDATION_COMMANDS];
  const out: GithubValidationCommandSpec[] = [];
  for (const raw of source) {
    if (typeof raw !== "string") continue;
    const parsed = parseFixedValidationCommand(raw);
    if (parsed) out.push(parsed);
  }
  return out;
}

function previewOutput(value: string): string {
  if (!value) return "";
  const normalized = value.replace(/\u0000/g, "");
  if (normalized.length <= MAX_OUTPUT_CHARS) return normalized;
  return `${normalized.slice(0, MAX_OUTPUT_CHARS)}…`;
}

export interface RunGithubValidationBrokerOptions {
  cwd: string;
  unattended: Pick<GithubAutomationUnattendedConfig, "validationCommands">;
  /**
   * Optional override for tests. Production callers must omit this so only
   * config-derived commands run.
   */
  commands?: GithubValidationCommandSpec[];
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  /**
   * Test hook: custom runner. When provided, real execFile is skipped.
   */
  runCommand?: (spec: GithubValidationCommandSpec) => Promise<{
    exitCode: number;
    stdout?: string;
    stderr?: string;
    timedOut?: boolean;
  }>;
}

/**
 * Execute operator validation commands in order. Stops on first failure.
 * Never accepts Issue-provided command lists.
 */
export async function runGithubValidationBroker(
  options: RunGithubValidationBrokerOptions,
): Promise<GithubValidationBrokerResult> {
  const commands =
    options.commands ?? resolveGithubValidationCommands(options.unattended);
  if (commands.length === 0) {
    return {
      ok: false,
      results: [],
      commandCount: 0,
      reasonCode: "no_validation_commands",
    };
  }

  const env = scrubGithubAutomationOwnedSecretsFromEnv(options.env ?? process.env);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const results: GithubValidationRunResult[] = [];

  for (const spec of commands) {
    const started = Date.now();
    try {
      let exitCode = 0;
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      if (options.runCommand) {
        const custom = await options.runCommand(spec);
        exitCode = custom.exitCode;
        stdout = custom.stdout ?? "";
        stderr = custom.stderr ?? "";
        timedOut = custom.timedOut === true;
      } else {
        const [file, ...args] = spec.argv;
        try {
          const result = await execFileAsync(file, args, {
            cwd: options.cwd,
            env: env as NodeJS.ProcessEnv,
            timeout: timeoutMs,
            maxBuffer: 2 * 1024 * 1024,
            // Do not use shell — Issue text must never become shell input.
            shell: false,
          });
          stdout = typeof result.stdout === "string" ? result.stdout : String(result.stdout ?? "");
          stderr = typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? "");
          exitCode = 0;
        } catch (err) {
          const e = err as NodeJS.ErrnoException & {
            killed?: boolean;
            code?: string | number | null;
            stdout?: string | Buffer;
            stderr?: string | Buffer;
          };
          timedOut = e.killed === true || e.code === "ETIMEDOUT";
          exitCode =
            typeof e.code === "number"
              ? e.code
              : timedOut
                ? 124
                : 1;
          stdout =
            typeof e.stdout === "string"
              ? e.stdout
              : e.stdout
                ? String(e.stdout)
                : "";
          stderr =
            typeof e.stderr === "string"
              ? e.stderr
              : e.stderr
                ? String(e.stderr)
                : e.message || "validation_command_failed";
        }
      }

      const ok = !timedOut && exitCode === 0;
      const item: GithubValidationRunResult = {
        ok,
        commandLabel: spec.label,
        argv: spec.argv,
        exitCode,
        timedOut,
        stdoutPreview: previewOutput(stdout),
        stderrPreview: previewOutput(stderr),
        durationMs: Date.now() - started,
        reasonCode: ok
          ? null
          : timedOut
            ? "validation_timeout"
            : "validation_failed",
      };
      results.push(item);
      if (!ok) {
        return {
          ok: false,
          results,
          commandCount: commands.length,
          reasonCode: item.reasonCode,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({
        ok: false,
        commandLabel: spec.label,
        argv: spec.argv,
        exitCode: null,
        timedOut: false,
        stdoutPreview: "",
        stderrPreview: previewOutput(message),
        durationMs: Date.now() - started,
        reasonCode: "validation_error",
      });
      return {
        ok: false,
        results,
        commandCount: commands.length,
        reasonCode: "validation_error",
      };
    }
  }

  return {
    ok: true,
    results,
    commandCount: commands.length,
    reasonCode: null,
  };
}

/**
 * Reject attempts to override validation from untrusted Issue-like payloads.
 * Used by runner preflight / tests.
 */
export function assertValidationCommandsNotFromIssue(input: {
  issueProvidedCommands?: unknown;
  issueBody?: unknown;
  commentBody?: unknown;
}): void {
  if (input.issueProvidedCommands !== undefined && input.issueProvidedCommands !== null) {
    throw new Error(
      "Issue text cannot set validationCommands; only operator config may define them.",
    );
  }
  // Soft check: if a body tries to smuggle "validationCommands:", runner must ignore it.
  // This function does not parse Issue text into commands — it only documents the gate.
  void input.issueBody;
  void input.commentBody;
}
