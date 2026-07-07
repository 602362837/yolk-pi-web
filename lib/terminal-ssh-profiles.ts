import { randomUUID } from "node:crypto";
import {
  PiWebConfigValidationError,
  readPiWebConfig,
  writePiWebConfigPatch,
} from "./pi-web-config";
import type {
  PiWebTerminalConfig,
  PiWebTerminalSshConfig,
  TerminalSshEndpoint,
  TerminalSshKnownHostsPolicy,
  TerminalSshProfile,
  TerminalSshProfileOptions,
  TerminalSshProxyConfig,
} from "./pi-web-config";

const FORBIDDEN_SECRET_FIELDS = new Set(["privateKey", "privateKeyPem", "password", "passphrase", "proxyPassword"]);
const ID_PREFIX = "ssh-profile-";

export class TerminalSshProfileError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
    this.name = "TerminalSshProfileError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectSecretFields(value: unknown, field: string): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecretFields(item, `${field}[${index}]`));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_FIELDS.has(key)) {
      throw new TerminalSshProfileError(`${field}.${key} must be stored in the SSH credential vault, not SSH profiles`);
    }
    rejectSecretFields(nestedValue, `${field}.${key}`);
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new TerminalSshProfileError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new TerminalSshProfileError(`${field} must be a non-empty string`);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new TerminalSshProfileError(`${field} must not contain control characters`);
  return trimmed;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new TerminalSshProfileError(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new TerminalSshProfileError(`${field} must not contain control characters`);
  return trimmed;
}

function optionalBoolean(value: unknown, fallback: boolean, field: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new TerminalSshProfileError(`${field} must be a boolean`);
  return value;
}

function requirePort(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    throw new TerminalSshProfileError(`${field} must be an integer between 1 and 65535`);
  }
  return value;
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new TerminalSshProfileError(`${field} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function knownHostsPolicy(value: unknown, field: string): TerminalSshKnownHostsPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "ask" || value === "strict" || value === "accept-new") return value;
  throw new TerminalSshProfileError(`${field} must be ask, strict, or accept-new`);
}

function parseEndpoint(value: unknown, field: string): TerminalSshEndpoint {
  if (!isRecord(value)) throw new TerminalSshProfileError(`${field} must be an object`);
  return {
    id: optionalString(value.id, `${field}.id`),
    label: optionalString(value.label, `${field}.label`),
    host: requireString(value.host, `${field}.host`),
    port: requirePort(value.port, `${field}.port`),
    username: optionalString(value.username, `${field}.username`),
    credentialId: optionalString(value.credentialId, `${field}.credentialId`),
  };
}

function parseOptions(value: unknown, field: string): TerminalSshProfileOptions | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TerminalSshProfileError(`${field} must be an object`);
  const options: TerminalSshProfileOptions = {
    connectTimeoutSeconds: optionalInteger(value.connectTimeoutSeconds, `${field}.connectTimeoutSeconds`, 1, 3600),
    serverAliveIntervalSeconds: optionalInteger(value.serverAliveIntervalSeconds, `${field}.serverAliveIntervalSeconds`, 1, 3600),
    forwardAgent: value.forwardAgent === undefined ? undefined : optionalBoolean(value.forwardAgent, false, `${field}.forwardAgent`),
    knownHostsPolicy: knownHostsPolicy(value.knownHostsPolicy, `${field}.knownHostsPolicy`),
    requestTty: value.requestTty === undefined ? undefined : optionalBoolean(value.requestTty, false, `${field}.requestTty`),
  };
  return Object.fromEntries(Object.entries(options).filter(([, optionValue]) => optionValue !== undefined)) as TerminalSshProfileOptions;
}

function parseProxy(value: unknown, field: string, ssh: PiWebTerminalSshConfig): TerminalSshProxyConfig | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TerminalSshProfileError(`${field} must be an object`);
  if (value.type === "none") return { type: "none" };
  if (value.type === "socks5" || value.type === "http") {
    return {
      type: value.type,
      host: requireString(value.host, `${field}.host`),
      port: requirePort(value.port, `${field}.port`),
      credentialId: optionalString(value.credentialId, `${field}.credentialId`),
    };
  }
  if (value.type === "custom") {
    if (!ssh.allowCustomProxyCommand) throw new TerminalSshProfileError("Custom ProxyCommand is disabled globally");
    const commandTemplate = requireString(value.commandTemplate, `${field}.commandTemplate`);
    if (/\{\{\s*secret\s*:/i.test(commandTemplate)) {
      throw new TerminalSshProfileError(`${field}.commandTemplate must not reference secret placeholders`);
    }
    const acknowledgedRisk = optionalBoolean(value.acknowledgedRisk, false, `${field}.acknowledgedRisk`);
    if (!acknowledgedRisk) throw new TerminalSshProfileError(`${field}.acknowledgedRisk must be true for custom ProxyCommand`);
    return { type: "custom", commandTemplate, acknowledgedRisk };
  }
  throw new TerminalSshProfileError(`${field}.type must be none, socks5, http, or custom`);
}

function parseProfileInput(input: unknown, ssh: PiWebTerminalSshConfig, existing?: TerminalSshProfile): TerminalSshProfile {
  rejectSecretFields(input, "profile");
  const value = isRecord(input) && isRecord(input.profile) ? input.profile : input;
  if (!isRecord(value)) throw new TerminalSshProfileError("profile must be an object");
  const now = new Date().toISOString();
  const id = existing?.id ?? optionalString(value.id, "profile.id") ?? `${ID_PREFIX}${randomUUID()}`;
  const createdAt = existing?.createdAt ?? optionalString(value.createdAt, "profile.createdAt") ?? now;
  const jumpHostsRaw = value.jumpHosts ?? existing?.jumpHosts ?? [];
  if (!Array.isArray(jumpHostsRaw)) throw new TerminalSshProfileError("profile.jumpHosts must be an array");
  return {
    id,
    label: value.label === undefined && existing ? existing.label : requireString(value.label, "profile.label"),
    enabled: optionalBoolean(value.enabled, existing?.enabled ?? true, "profile.enabled"),
    target: value.target === undefined && existing ? existing.target : parseEndpoint(value.target, "profile.target"),
    jumpHosts: jumpHostsRaw.map((jumpHost, index) => parseEndpoint(jumpHost, `profile.jumpHosts[${index}]`)),
    proxy: value.proxy === undefined && existing ? existing.proxy : parseProxy(value.proxy, "profile.proxy", ssh),
    options: value.options === undefined && existing ? existing.options : parseOptions(value.options, "profile.options"),
    createdAt,
    updatedAt: now,
  };
}

function saveProfiles(terminal: PiWebTerminalConfig, profiles: TerminalSshProfile[]) {
  return writePiWebConfigPatch({ terminal: { ...terminal, ssh: { ...terminal.ssh, profiles } } });
}

function mapValidationError(error: unknown): never {
  if (error instanceof PiWebConfigValidationError) throw new TerminalSshProfileError(error.message, 400);
  throw error;
}

export function listTerminalSshProfiles(): { profiles: TerminalSshProfile[]; ssh: PiWebTerminalSshConfig } {
  const ssh = readPiWebConfig().terminal.ssh;
  return { profiles: ssh.profiles, ssh };
}

export function getTerminalSshProfile(id: string): TerminalSshProfile {
  const profile = readPiWebConfig().terminal.ssh.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw new TerminalSshProfileError("SSH profile not found", 404);
  return profile;
}

export function createTerminalSshProfile(input: unknown): TerminalSshProfile {
  const { terminal } = readPiWebConfig();
  const profile = parseProfileInput(input, terminal.ssh);
  if (terminal.ssh.profiles.some((candidate) => candidate.id === profile.id)) {
    throw new TerminalSshProfileError("SSH profile id already exists", 409);
  }
  try {
    return saveProfiles(terminal, [...terminal.ssh.profiles, profile]).config.terminal.ssh.profiles.find((candidate) => candidate.id === profile.id) ?? profile;
  } catch (error) {
    mapValidationError(error);
  }
}

export function updateTerminalSshProfile(id: string, input: unknown): TerminalSshProfile {
  const { terminal } = readPiWebConfig();
  const index = terminal.ssh.profiles.findIndex((candidate) => candidate.id === id);
  if (index < 0) throw new TerminalSshProfileError("SSH profile not found", 404);
  const profile = parseProfileInput(input, terminal.ssh, terminal.ssh.profiles[index]);
  if (profile.id !== id && terminal.ssh.profiles.some((candidate) => candidate.id === profile.id)) {
    throw new TerminalSshProfileError("SSH profile id already exists", 409);
  }
  const profiles = terminal.ssh.profiles.slice();
  profiles[index] = { ...profile, id };
  try {
    return saveProfiles(terminal, profiles).config.terminal.ssh.profiles[index] ?? profiles[index];
  } catch (error) {
    mapValidationError(error);
  }
}

export function deleteTerminalSshProfile(id: string): TerminalSshProfile[] {
  const { terminal } = readPiWebConfig();
  const profiles = terminal.ssh.profiles.filter((candidate) => candidate.id !== id);
  if (profiles.length === terminal.ssh.profiles.length) throw new TerminalSshProfileError("SSH profile not found", 404);
  try {
    return saveProfiles(terminal, profiles).config.terminal.ssh.profiles;
  } catch (error) {
    mapValidationError(error);
  }
}
