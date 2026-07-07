import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const TERMINAL_DIR_MODE = 0o700;
const KNOWN_HOSTS_FILE_MODE = 0o600;
const SSH_KEYSCAN_TIMEOUT_MS = 10_000;
const MAX_HOST_LENGTH = 253;
const MAX_KEY_LENGTH = 32_768;
const VALID_KEY_TYPE = /^(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)$/;

export interface TerminalKnownHostEntry {
  index: number;
  host: string;
  port: number | null;
  hosts: string[];
  keyType: string;
  fingerprint: string;
  comment?: string;
  hashed: boolean;
}

export interface TerminalKnownHostTrustInput {
  host: string;
  port: number;
  keyType: string;
  publicKey: string;
  comment?: string;
}

export interface TerminalKnownHostsScanResult {
  ok: boolean;
  host: string;
  port: number;
  entries: TerminalKnownHostScannedEntry[];
  warning: string;
  error?: string;
}

export interface TerminalKnownHostScannedEntry {
  host: string;
  port: number;
  keyType: string;
  fingerprint: string;
  publicKey: string;
  comment?: string;
}

export class TerminalKnownHostsError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "TerminalKnownHostsError";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return false;
    throw error;
  }
}

export function getTerminalKnownHostsDirectory(): string {
  return join(getAgentDir(), "terminal");
}

export function getTerminalKnownHostsPath(): string {
  return join(getTerminalKnownHostsDirectory(), "known_hosts");
}

export async function ensureTerminalKnownHostsFile(): Promise<string> {
  const dir = getTerminalKnownHostsDirectory();
  const file = getTerminalKnownHostsPath();
  await mkdir(dir, { recursive: true, mode: TERMINAL_DIR_MODE });
  await chmod(dir, TERMINAL_DIR_MODE).catch(() => {});
  if (!(await pathExists(file))) await writeFile(file, "", { encoding: "utf8", mode: KNOWN_HOSTS_FILE_MODE });
  await chmod(file, KNOWN_HOSTS_FILE_MODE).catch(() => {});
  return file;
}

export function normalizeKnownHostHost(host: string): string {
  const normalized = host.trim().replace(/^\[(.*)\]$/, "$1").toLowerCase();
  if (!normalized) throw new TerminalKnownHostsError("host is required", 400);
  if (normalized.length > MAX_HOST_LENGTH) throw new TerminalKnownHostsError("host is too long", 400);
  if (/[\u0000-\u001f\u007f\s,*!?]/.test(normalized)) throw new TerminalKnownHostsError("host must not contain whitespace, control characters, or known_hosts pattern metacharacters", 400);
  return normalized;
}

export function normalizeKnownHostPort(port: unknown): number {
  const value = typeof port === "number" ? port : typeof port === "string" && port.trim() ? Number(port) : NaN;
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new TerminalKnownHostsError("port must be an integer between 1 and 65535", 400);
  return value;
}

export function buildTerminalHostKeyAlias(host: string, port: number): string {
  return `${normalizeKnownHostHost(host)}:${normalizeKnownHostPort(port)}`;
}

export function getTerminalUserKnownHostsFileOption(): string {
  return getTerminalKnownHostsPath();
}

function fingerprintForPublicKey(publicKey: string): string {
  const digest = createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("base64").replace(/=+$/, "");
  return `SHA256:${digest}`;
}

function validatePublicKey(publicKey: string): string {
  const normalized = publicKey.trim();
  if (!normalized) throw new TerminalKnownHostsError("publicKey is required", 400);
  if (normalized.length > MAX_KEY_LENGTH) throw new TerminalKnownHostsError("publicKey is too long", 400);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new TerminalKnownHostsError("publicKey must be base64", 400);
  try {
    const decoded = Buffer.from(normalized, "base64");
    if (decoded.length === 0) throw new Error("empty key");
  } catch {
    throw new TerminalKnownHostsError("publicKey must be valid base64", 400);
  }
  return normalized;
}

function normalizeKeyType(keyType: string): string {
  const normalized = keyType.trim();
  if (!VALID_KEY_TYPE.test(normalized)) throw new TerminalKnownHostsError("unsupported SSH host key type", 400);
  return normalized;
}

function normalizeComment(comment: unknown): string | undefined {
  if (typeof comment !== "string") return undefined;
  const normalized = comment.trim();
  if (!normalized) return undefined;
  if (normalized.length > 500) throw new TerminalKnownHostsError("comment is too long", 400);
  if (/[\u0000\r\n]/.test(normalized)) throw new TerminalKnownHostsError("comment must not contain newlines or NUL", 400);
  return normalized;
}

function parseHostAndPort(pattern: string): { host: string; port: number | null } {
  const bracketMatch = /^\[(.+)]:(\d+)$/.exec(pattern);
  if (bracketMatch) return { host: bracketMatch[1].toLowerCase(), port: Number(bracketMatch[2]) };
  const hostPortMatch = /^(.+):(\d+)$/.exec(pattern);
  if (hostPortMatch && !pattern.includes("|")) return { host: hostPortMatch[1].toLowerCase(), port: Number(hostPortMatch[2]) };
  return { host: pattern.toLowerCase(), port: null };
}

function splitKnownHostsFields(line: string): { hosts: string; keyType: string; publicKey: string; comment?: string } | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const parts = trimmed.split(/\s+/);
  const offset = parts[0]?.startsWith("@") ? 1 : 0;
  if (parts.length < offset + 3) return null;
  const hosts = parts[offset];
  const keyType = parts[offset + 1];
  const publicKey = parts[offset + 2];
  const comment = parts.slice(offset + 3).join(" ") || undefined;
  if (!hosts || !keyType || !publicKey) return null;
  return { hosts, keyType, publicKey, comment };
}

function parseKnownHostLine(line: string, index: number): TerminalKnownHostEntry | null {
  const fields = splitKnownHostsFields(line);
  if (!fields) return null;
  const hosts = fields.hosts.split(",").filter(Boolean);
  const hashed = hosts.some((item) => item.startsWith("|"));
  const firstPlainHost = hosts.find((item) => !item.startsWith("|"));
  const parsed = firstPlainHost ? parseHostAndPort(firstPlainHost) : { host: "<hashed>", port: null };
  let fingerprint = "";
  try {
    fingerprint = fingerprintForPublicKey(fields.publicKey);
  } catch {
    return null;
  }
  return {
    index,
    host: parsed.host,
    port: parsed.port,
    hosts: hosts.map((item) => (item.startsWith("|") ? "<hashed>" : item)),
    keyType: fields.keyType,
    fingerprint,
    comment: fields.comment,
    hashed,
  };
}

export async function listTerminalKnownHosts(): Promise<{ path: string; entries: TerminalKnownHostEntry[] }> {
  const path = await ensureTerminalKnownHostsFile();
  const content = await readFile(path, "utf8");
  const entries = content.split(/\r?\n/).map((line, index) => parseKnownHostLine(line, index)).filter((entry): entry is TerminalKnownHostEntry => Boolean(entry));
  return { path, entries };
}

function buildKnownHostsLine(input: TerminalKnownHostTrustInput): string {
  const hostAlias = buildTerminalHostKeyAlias(input.host, input.port);
  const keyType = normalizeKeyType(input.keyType);
  const publicKey = validatePublicKey(input.publicKey);
  const comment = normalizeComment(input.comment);
  return [hostAlias, keyType, publicKey, comment].filter(Boolean).join(" ");
}

function sameHostKeyLine(a: string, b: string): boolean {
  const parsedA = splitKnownHostsFields(a);
  const parsedB = splitKnownHostsFields(b);
  return Boolean(parsedA && parsedB && parsedA.hosts === parsedB.hosts && parsedA.keyType === parsedB.keyType && parsedA.publicKey === parsedB.publicKey);
}

export async function trustTerminalKnownHost(input: TerminalKnownHostTrustInput): Promise<{ path: string; entry: TerminalKnownHostEntry; added: boolean }> {
  const path = await ensureTerminalKnownHostsFile();
  const line = buildKnownHostsLine(input);
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/).filter((item) => item.trim().length > 0);
  const existingIndex = lines.findIndex((item) => sameHostKeyLine(item, line));
  const nextLines = existingIndex === -1 ? [...lines, line] : lines;
  if (existingIndex === -1) {
    await writeFile(path, `${nextLines.join("\n")}\n`, { encoding: "utf8", mode: KNOWN_HOSTS_FILE_MODE });
    await chmod(path, KNOWN_HOSTS_FILE_MODE).catch(() => {});
  }
  const entry = parseKnownHostLine(line, existingIndex === -1 ? nextLines.length - 1 : existingIndex);
  if (!entry) throw new TerminalKnownHostsError("failed to parse trusted host key", 500);
  return { path, entry, added: existingIndex === -1 };
}

export async function removeTerminalKnownHost(input: { host?: unknown; port?: unknown; fingerprint?: unknown; index?: unknown }): Promise<{ path: string; removed: number; entries: TerminalKnownHostEntry[] }> {
  const path = await ensureTerminalKnownHostsFile();
  const content = await readFile(path, "utf8");
  const lines = content.split(/\r?\n/);
  const host = typeof input.host === "string" && input.host.trim() ? normalizeKnownHostHost(input.host) : null;
  const port = input.port === undefined || input.port === null || input.port === "" ? null : normalizeKnownHostPort(input.port);
  const fingerprint = typeof input.fingerprint === "string" && input.fingerprint.trim() ? input.fingerprint.trim() : null;
  const index = typeof input.index === "number" && Number.isInteger(input.index) ? input.index : null;
  if (index === null && !host && !fingerprint) throw new TerminalKnownHostsError("host, fingerprint, or index is required", 400);

  let removed = 0;
  const kept = lines.filter((line, lineIndex) => {
    const entry = parseKnownHostLine(line, lineIndex);
    if (!entry) return true;
    const matchesIndex = index !== null && lineIndex === index;
    const matchesHost = host ? entry.host === host && (port === null || entry.port === port) : true;
    const matchesFingerprint = fingerprint ? entry.fingerprint === fingerprint : true;
    const shouldRemove = matchesIndex || ((host || fingerprint) && matchesHost && matchesFingerprint);
    if (shouldRemove) removed += 1;
    return !shouldRemove;
  });

  await writeFile(path, kept.join("\n").replace(/\n*$/, "") + (kept.some((line) => line.trim()) ? "\n" : ""), { encoding: "utf8", mode: KNOWN_HOSTS_FILE_MODE });
  await chmod(path, KNOWN_HOSTS_FILE_MODE).catch(() => {});
  const entries = kept.map((line, lineIndex) => parseKnownHostLine(line, lineIndex)).filter((entry): entry is TerminalKnownHostEntry => Boolean(entry));
  return { path, removed, entries };
}

function parseScannedLine(line: string, fallbackHost: string, fallbackPort: number): TerminalKnownHostScannedEntry | null {
  const fields = splitKnownHostsFields(line);
  if (!fields) return null;
  try {
    return {
      host: fallbackHost,
      port: fallbackPort,
      keyType: normalizeKeyType(fields.keyType),
      fingerprint: fingerprintForPublicKey(fields.publicKey),
      publicKey: validatePublicKey(fields.publicKey),
      comment: fields.comment,
    };
  } catch {
    return null;
  }
}

export async function scanTerminalKnownHost(input: { host?: unknown; port?: unknown; timeoutMs?: unknown }): Promise<TerminalKnownHostsScanResult> {
  const host = normalizeKnownHostHost(typeof input.host === "string" ? input.host : "");
  const port = normalizeKnownHostPort(input.port);
  const timeoutMs = typeof input.timeoutMs === "number" && Number.isFinite(input.timeoutMs) ? Math.min(Math.max(input.timeoutMs, 1000), 30_000) : SSH_KEYSCAN_TIMEOUT_MS;
  const warning = "ssh-keyscan can display a host key fingerprint, but it does not prove the host is trusted. Verify the fingerprint through a trusted channel before trusting it.";

  return await new Promise<TerminalKnownHostsScanResult>((resolve) => {
    const child = spawn("ssh-keyscan", ["-p", String(port), "-T", String(Math.ceil(timeoutMs / 1000)), host], { stdio: ["ignore", "pipe", "pipe"] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const finish = (result: TerminalKnownHostsScanResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish({ ok: false, host, port, entries: [], warning, error: "ssh-keyscan timed out" });
    }, timeoutMs + 500);
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error: NodeJS.ErrnoException) => {
      finish({ ok: false, host, port, entries: [], warning, error: error.code === "ENOENT" ? "ssh-keyscan executable not found" : error.message });
    });
    child.on("close", (code) => {
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      const entries = stdout.split(/\r?\n/).map((line) => parseScannedLine(line, host, port)).filter((entry): entry is TerminalKnownHostScannedEntry => Boolean(entry));
      if (entries.length > 0) finish({ ok: true, host, port, entries, warning });
      else finish({ ok: false, host, port, entries: [], warning, error: stderr || `ssh-keyscan exited with code ${code ?? "unknown"}` });
    });
  });
}

export function parseTerminalKnownHostTrustBody(body: unknown): TerminalKnownHostTrustInput {
  if (!isRecord(body)) throw new TerminalKnownHostsError("request body must be an object", 400);
  return {
    host: normalizeKnownHostHost(typeof body.host === "string" ? body.host : ""),
    port: normalizeKnownHostPort(body.port),
    keyType: normalizeKeyType(typeof body.keyType === "string" ? body.keyType : ""),
    publicKey: validatePublicKey(typeof body.publicKey === "string" ? body.publicKey : ""),
    comment: normalizeComment(body.comment),
  };
}
