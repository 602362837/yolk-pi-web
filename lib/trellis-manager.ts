import { execFile } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { userInfo } from "os";
import path from "path";
import { execPath } from "process";
import { promisify } from "util";
import { canonicalizeCwd } from "./cwd";
import { runNpm } from "./npx";
import type { PiWebTrellisConfig } from "./pi-web-config";
import type { TrellisCommandResponse, TrellisRequirementStatus, TrellisSetupStatus } from "./trellis-setup-types";

const execFileAsync = promisify(execFile);
const ANSI_RE = /\x1B\[[0-9;]*m/g;
const STATUS_TIMEOUT_MS = 8_000;
const COMMAND_TIMEOUT_MS = 5 * 60_000;
const OUTPUT_MAX_CHARS = 16_000;
const TRELLIS_PACKAGE = "@mindfoldhq/trellis@latest";

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface CommandOptions {
  cwd?: string;
  timeout?: number;
  env?: NodeJS.ProcessEnv;
}

function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, "");
}

function capOutput(value: string): string {
  const clean = stripAnsi(value);
  if (clean.length <= OUTPUT_MAX_CHARS) return clean;
  return `… output truncated …\n${clean.slice(-OUTPUT_MAX_CHARS)}`;
}

function commandErrorOutput(error: unknown): string {
  const err = error as { stdout?: string | Buffer; stderr?: string | Buffer; message?: string };
  const output = `${err.stdout?.toString() ?? ""}${err.stderr?.toString() ?? ""}`;
  return capOutput(output || err.message || String(error));
}

async function runCommand(command: string, args: string[], opts: CommandOptions = {}): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: opts.cwd,
    timeout: opts.timeout,
    env: opts.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 4,
  });
  return { stdout, stderr };
}

function parseVersionParts(version: string | undefined): number[] {
  if (!version) return [];
  const match = version.match(/(\d+)\.(\d+)\.(\d+)/) ?? version.match(/(\d+)\.(\d+)/) ?? version.match(/(\d+)/);
  if (!match) return [];
  return match.slice(1).map((part) => Number(part));
}

function versionAtLeast(version: string | undefined, required: [number, number, number]): boolean {
  const parts = parseVersionParts(version);
  if (parts.length === 0) return false;
  for (let index = 0; index < required.length; index += 1) {
    const actual = parts[index] ?? 0;
    if (actual > required[index]) return true;
    if (actual < required[index]) return false;
  }
  return true;
}

async function readPythonStatus(): Promise<TrellisRequirementStatus> {
  for (const command of ["python3", "python"]) {
    try {
      const { stdout, stderr } = await runCommand(command, ["--version"], { timeout: STATUS_TIMEOUT_MS });
      const output = `${stdout}${stderr}`.trim();
      const version = output.match(/Python\s+([^\s]+)/)?.[1] ?? output;
      return {
        ok: versionAtLeast(version, [3, 9, 0]),
        required: "Python 3.9+",
        command,
        version,
      };
    } catch {
      // Try the next Python launcher name.
    }
  }
  return { ok: false, required: "Python 3.9+", error: "Python was not found on PATH" };
}

function readDeveloperName(trellisDir: string): string | undefined {
  const developerPath = path.join(trellisDir, ".developer");
  if (!existsSync(developerPath)) return undefined;
  try {
    const content = readFileSync(developerPath, "utf8");
    const nameLine = content.split(/\r?\n/).find((line) => line.startsWith("name="));
    const name = nameLine?.slice("name=".length).trim();
    return name || undefined;
  } catch {
    return undefined;
  }
}

function readTrimmedFile(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) return undefined;
    const value = readFileSync(filePath, "utf8").trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

function directoryExists(dirPath: string): boolean {
  try {
    return existsSync(dirPath) && statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function getOsUserName(): string {
  try {
    return userInfo().username || "developer";
  } catch {
    return "developer";
  }
}

async function getGlobalNodeModulesRoot(env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await runNpm(["root", "-g"], { timeout: STATUS_TIMEOUT_MS, env });
    const root = stdout.trim();
    return root || null;
  } catch {
    return null;
  }
}

async function findGlobalTrellisScript(env?: NodeJS.ProcessEnv): Promise<string | null> {
  const root = await getGlobalNodeModulesRoot(env);
  if (!root) return null;
  const candidates = [
    path.join(root, "@mindfoldhq", "trellis", "bin", "trellis.js"),
  ];
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    } catch {
      // Ignore stale npm roots.
    }
  }
  return null;
}

async function runTrellis(args: string[], opts: CommandOptions = {}): Promise<CommandResult> {
  const script = await findGlobalTrellisScript(opts.env);
  if (script) return runCommand(execPath, [script, ...args], opts);
  return runCommand("trellis", args, opts);
}

async function readCliStatus(env?: NodeJS.ProcessEnv): Promise<TrellisSetupStatus["cli"]> {
  try {
    const { stdout, stderr } = await runTrellis(["--version"], { timeout: STATUS_TIMEOUT_MS, env });
    const output = `${stdout}${stderr}`.trim();
    const version = output.match(/(\d+\.\d+\.\d+(?:[-\w.]+)?)/)?.[1] ?? output;
    return {
      installed: true,
      version,
      upgradeCommandAvailable: versionAtLeast(version, [0, 6, 0]),
    };
  } catch (error) {
    return { installed: false, error: commandErrorOutput(error) };
  }
}

function applyProxyEnv(config: PiWebTrellisConfig): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, FORCE_COLOR: "0", CI: "1" };
  if (config.proxyEnabled && config.proxyUrl.trim()) {
    const proxyUrl = config.proxyUrl.trim();
    env.HTTP_PROXY = proxyUrl;
    env.HTTPS_PROXY = proxyUrl;
    env.http_proxy = proxyUrl;
    env.https_proxy = proxyUrl;
    env.npm_config_proxy = proxyUrl;
    env.npm_config_https_proxy = proxyUrl;
  }
  return env;
}

export function validateTrellisDeveloperName(value: unknown): string {
  if (typeof value !== "string") throw new Error("developerName must be a string");
  const developerName = value.trim();
  if (!developerName) throw new Error("developerName is required");
  if (developerName.length > 80) throw new Error("developerName must be 80 characters or fewer");
  if (/[\\/\r\n]/.test(developerName)) throw new Error("developerName must not contain slashes or newlines");
  return developerName;
}

export async function getTrellisSetupStatus(cwd: string, env?: NodeJS.ProcessEnv): Promise<TrellisSetupStatus> {
  const canonicalCwd = canonicalizeCwd(cwd);
  const platform = process.platform;
  const supportedOs = platform === "darwin" || platform === "linux" || platform === "win32";
  const workspaceExists = directoryExists(canonicalCwd);
  const nodeVersion = process.versions.node;
  const node: TrellisRequirementStatus = {
    ok: versionAtLeast(nodeVersion, [18, 0, 0]),
    required: "Node.js 18+",
    version: nodeVersion,
  };
  const [python, cli] = await Promise.all([readPythonStatus(), readCliStatus(env)]);

  const trellisDir = path.join(canonicalCwd, ".trellis");
  const developerName = readDeveloperName(trellisDir);
  const project = {
    hasTrellisDir: directoryExists(trellisDir),
    hasTasksDir: directoryExists(path.join(trellisDir, "tasks")),
    version: readTrimmedFile(path.join(trellisDir, ".version")),
    hasDeveloperIdentity: !!developerName,
    developerName,
  };
  const suggestedDeveloperName = developerName ?? getOsUserName();

  const blockingReasons: string[] = [];
  if (!workspaceExists) blockingReasons.push(`Workspace does not exist or is not a directory: ${canonicalCwd}.`);
  if (!supportedOs) blockingReasons.push("Trellis supports macOS, Linux, and Windows.");
  if (!node.ok) blockingReasons.push(`Node.js 18+ is required. Current version: ${node.version ?? "not found"}.`);
  if (!python.ok) blockingReasons.push(`Python 3.9+ is required. ${python.version ? `Current version: ${python.version}.` : python.error ?? "Python was not found."}`);

  const prerequisitesOk = blockingReasons.length === 0;
  const canInitialize = prerequisitesOk && !project.hasTrellisDir;
  const canUpdate = prerequisitesOk && project.hasTrellisDir;
  const recommendedAction = !prerequisitesOk
    ? "fix-prerequisites"
    : !project.hasTrellisDir
      ? "initialize"
      : project.hasTasksDir && project.hasDeveloperIdentity
        ? "ready"
        : "update";

  return {
    cwd: canonicalCwd,
    supportedOs,
    platform,
    node,
    python,
    cli,
    project,
    suggestedDeveloperName,
    canInitialize,
    canUpdate,
    blockingReasons,
    recommendedAction,
  };
}

async function ensureTrellisCli(env: NodeJS.ProcessEnv, output: string[]): Promise<TrellisSetupStatus["cli"]> {
  const current = await readCliStatus(env);
  if (current.installed) return current;
  output.push("Installing Trellis CLI with npm install -g @mindfoldhq/trellis@latest …");
  try {
    const { stdout, stderr } = await runNpm(["install", "-g", TRELLIS_PACKAGE], { timeout: COMMAND_TIMEOUT_MS, env });
    output.push(capOutput(`${stdout}${stderr}`));
  } catch (error) {
    throw new Error(commandErrorOutput(error));
  }
  return readCliStatus(env);
}

function assertPrerequisites(status: TrellisSetupStatus): void {
  if (status.blockingReasons.length > 0) {
    throw new Error(status.blockingReasons.join(" "));
  }
}

export async function initializeTrellisProject({
  cwd,
  developerName,
  config,
}: {
  cwd: string;
  developerName: string;
  config: PiWebTrellisConfig;
}): Promise<TrellisCommandResponse> {
  const env = applyProxyEnv(config);
  const name = validateTrellisDeveloperName(developerName);
  const output: string[] = [];
  const before = await getTrellisSetupStatus(cwd, env);
  assertPrerequisites(before);
  if (before.project.hasTrellisDir) {
    throw new Error("This workspace already has .trellis. Use update instead of initialization.");
  }

  await ensureTrellisCli(env, output);
  output.push(`Running trellis init -u ${name} --pi …`);
  try {
    const { stdout, stderr } = await runTrellis(["init", "-u", name, "--pi"], {
      cwd: before.cwd,
      timeout: COMMAND_TIMEOUT_MS,
      env,
    });
    output.push(capOutput(`${stdout}${stderr}`));
  } catch (error) {
    throw new Error(commandErrorOutput(error));
  }

  return {
    success: true,
    output: capOutput(output.join("\n")),
    status: await getTrellisSetupStatus(before.cwd, env),
  };
}

export async function updateTrellisProject({
  cwd,
  config,
}: {
  cwd: string;
  config: PiWebTrellisConfig;
}): Promise<TrellisCommandResponse> {
  const env = applyProxyEnv(config);
  const output: string[] = [];
  const before = await getTrellisSetupStatus(cwd, env);
  assertPrerequisites(before);
  if (!before.project.hasTrellisDir) {
    throw new Error("This workspace does not have .trellis yet. Initialize Trellis first.");
  }

  const cli = await ensureTrellisCli(env, output);
  if (cli.installed && cli.upgradeCommandAvailable) {
    output.push("Running trellis upgrade …");
    try {
      const { stdout, stderr } = await runTrellis(["upgrade"], { cwd: before.cwd, timeout: COMMAND_TIMEOUT_MS, env });
      output.push(capOutput(`${stdout}${stderr}`));
    } catch (error) {
      throw new Error(commandErrorOutput(error));
    }
  } else {
    output.push("Updating Trellis CLI with npm install -g @mindfoldhq/trellis@latest …");
    try {
      const { stdout, stderr } = await runNpm(["install", "-g", TRELLIS_PACKAGE], { timeout: COMMAND_TIMEOUT_MS, env });
      output.push(capOutput(`${stdout}${stderr}`));
    } catch (error) {
      throw new Error(commandErrorOutput(error));
    }
  }

  output.push("Running trellis update …");
  try {
    const { stdout, stderr } = await runTrellis(["update"], { cwd: before.cwd, timeout: COMMAND_TIMEOUT_MS, env });
    output.push(capOutput(`${stdout}${stderr}`));
  } catch (error) {
    throw new Error(commandErrorOutput(error));
  }

  return {
    success: true,
    output: capOutput(output.join("\n")),
    status: await getTrellisSetupStatus(before.cwd, env),
  };
}
