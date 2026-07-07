import { createHash, randomUUID } from "node:crypto";
import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readPiWebConfig } from "@/lib/pi-web-config";
import type { TerminalCredentialSummary, TerminalCredentialType, TerminalSshProfile } from "@/lib/terminal-ssh-types";

const VAULT_DIR_NAME = "terminal-secrets";
const CREDENTIALS_FILE = "credentials.json";
const DELETED_DIR_NAME = "deleted";
const VAULT_DIR_MODE = 0o700;
const CREDENTIALS_FILE_MODE = 0o600;

interface TerminalCredentialVaultFile {
  version: 1;
  credentials: TerminalCredentialRecord[];
}

export interface TerminalCredentialRecord {
  id: string;
  label: string;
  type: TerminalCredentialType;
  username?: string;
  identityFilePath?: string;
  privateKeyPem?: string;
  passphrase?: string;
  password?: string;
  proxyUsername?: string;
  proxyPassword?: string;
  fingerprint?: string;
  createdAt: string;
  updatedAt: string;
}

interface CredentialSecretInput {
  privateKeyPem?: unknown;
  passphrase?: unknown;
  password?: unknown;
  proxyPassword?: unknown;
}

interface CredentialMetadataInput extends CredentialSecretInput {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  username?: unknown;
  identityFilePath?: unknown;
  proxyUsername?: unknown;
  fingerprint?: unknown;
}

export class TerminalSshVaultError extends Error {
  constructor(message: string, public readonly status = 400, public readonly references?: string[]) {
    super(message);
    this.name = "TerminalSshVaultError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function vaultDir(): string {
  return join(getAgentDir(), VAULT_DIR_NAME);
}

function vaultPath(): string {
  return join(vaultDir(), CREDENTIALS_FILE);
}

function deletedVaultDir(): string {
  return join(vaultDir(), DELETED_DIR_NAME);
}

function deletedCredentialPath(id: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(deletedVaultDir(), `${timestamp}_${encodeURIComponent(id)}.json`);
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

async function ensureVaultDir(): Promise<void> {
  const dir = vaultDir();
  await mkdir(dir, { recursive: true, mode: VAULT_DIR_MODE });
  await chmod(dir, VAULT_DIR_MODE).catch(() => {});
}

async function ensureDeletedVaultDir(): Promise<void> {
  const dir = deletedVaultDir();
  await mkdir(dir, { recursive: true, mode: VAULT_DIR_MODE });
  await chmod(dir, VAULT_DIR_MODE).catch(() => {});
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeSecretString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function normalizeCredentialType(value: unknown): TerminalCredentialType | null {
  return value === "agent" || value === "identityFile" || value === "privateKey" || value === "password" || value === "proxyAuth" ? value : null;
}

function normalizeRecord(value: unknown): TerminalCredentialRecord | null {
  if (!isRecord(value)) return null;
  const type = normalizeCredentialType(value.type);
  if (!type) return null;
  const id = normalizeString(value.id);
  const label = normalizeString(value.label);
  const createdAt = normalizeString(value.createdAt);
  const updatedAt = normalizeString(value.updatedAt);
  if (!id || !label || !createdAt || !updatedAt) return null;
  return {
    id,
    label,
    type,
    username: normalizeString(value.username),
    identityFilePath: normalizeString(value.identityFilePath),
    privateKeyPem: normalizeSecretString(value.privateKeyPem),
    passphrase: normalizeSecretString(value.passphrase),
    password: normalizeSecretString(value.password),
    proxyUsername: normalizeString(value.proxyUsername),
    proxyPassword: normalizeSecretString(value.proxyPassword),
    fingerprint: normalizeString(value.fingerprint),
    createdAt,
    updatedAt,
  };
}

function normalizeVault(value: unknown): TerminalCredentialVaultFile {
  if (!isRecord(value)) return { version: 1, credentials: [] };
  const credentials = Array.isArray(value.credentials)
    ? value.credentials.map(normalizeRecord).filter((record): record is TerminalCredentialRecord => Boolean(record))
    : [];
  const seen = new Set<string>();
  return {
    version: 1,
    credentials: credentials.filter((credential) => {
      if (seen.has(credential.id)) return false;
      seen.add(credential.id);
      return true;
    }),
  };
}

async function readVault(): Promise<TerminalCredentialVaultFile> {
  try {
    const parsed = JSON.parse(await readFile(vaultPath(), "utf8")) as unknown;
    return normalizeVault(parsed);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return { version: 1, credentials: [] };
    throw new TerminalSshVaultError("Failed to read SSH credential vault", 500);
  }
}

async function writeVault(vault: TerminalCredentialVaultFile): Promise<void> {
  await ensureVaultDir();
  await writeFile(vaultPath(), `${JSON.stringify(vault, null, 2)}\n`, { encoding: "utf8", mode: CREDENTIALS_FILE_MODE });
  await chmod(vaultPath(), CREDENTIALS_FILE_MODE).catch(() => {});
}

function deriveFingerprint(input: Pick<TerminalCredentialRecord, "privateKeyPem" | "fingerprint">): string | undefined {
  if (input.fingerprint) return input.fingerprint;
  if (!input.privateKeyPem) return undefined;
  const digest = createHash("sha256").update(input.privateKeyPem).digest("base64").replace(/=+$/g, "");
  return `SHA256:${digest}`;
}

function usedByProfileIds(credentialId: string, profiles = readPiWebConfig().terminal.ssh.profiles): string[] {
  const used = new Set<string>();
  for (const profile of profiles) {
    if (profile.target.credentialId === credentialId) used.add(profile.id);
    if (profile.proxy?.type === "socks5" || profile.proxy?.type === "http") {
      if (profile.proxy.credentialId === credentialId) used.add(profile.id);
    }
    for (const jumpHost of profile.jumpHosts) {
      if (jumpHost.credentialId === credentialId) used.add(profile.id);
    }
  }
  return [...used];
}

function toSummary(record: TerminalCredentialRecord, profiles?: TerminalSshProfile[]): TerminalCredentialSummary {
  return {
    id: record.id,
    label: record.label,
    type: record.type,
    username: record.username,
    proxyUsername: record.proxyUsername,
    identityFilePath: record.identityFilePath,
    hasPrivateKey: Boolean(record.privateKeyPem),
    hasPassword: Boolean(record.password),
    hasPassphrase: Boolean(record.passphrase),
    hasProxyPassword: Boolean(record.proxyPassword),
    fingerprint: record.fingerprint,
    usedByProfileIds: usedByProfileIds(record.id, profiles),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function requireCredentialType(value: unknown): TerminalCredentialType {
  const type = normalizeCredentialType(value);
  if (!type) throw new TerminalSshVaultError("type must be agent, identityFile, privateKey, password, or proxyAuth", 400);
  return type;
}

function requireLabel(value: unknown): string {
  const label = normalizeString(value);
  if (!label) throw new TerminalSshVaultError("label is required", 400);
  return label;
}

function validateCredentialForCreate(record: TerminalCredentialRecord): void {
  if (record.type === "identityFile" && !record.identityFilePath) {
    throw new TerminalSshVaultError("identityFilePath is required for identityFile credentials", 400);
  }
  if (record.type === "privateKey" && !record.privateKeyPem) {
    throw new TerminalSshVaultError("privateKeyPem is required for privateKey credentials", 400);
  }
  if (record.type === "password" && !record.password) {
    throw new TerminalSshVaultError("password is required for password credentials", 400);
  }
  if (record.type === "proxyAuth" && (!record.proxyUsername || !record.proxyPassword)) {
    throw new TerminalSshVaultError("proxyUsername and proxyPassword are required for proxyAuth credentials", 400);
  }
}

function createRecord(input: CredentialMetadataInput): TerminalCredentialRecord {
  const now = new Date().toISOString();
  const privateKeyPem = normalizeSecretString(input.privateKeyPem);
  const fingerprint = normalizeString(input.fingerprint);
  const record: TerminalCredentialRecord = {
    id: normalizeString(input.id) ?? randomUUID(),
    label: requireLabel(input.label),
    type: requireCredentialType(input.type),
    username: normalizeString(input.username),
    identityFilePath: normalizeString(input.identityFilePath),
    privateKeyPem,
    passphrase: normalizeSecretString(input.passphrase),
    password: normalizeSecretString(input.password),
    proxyUsername: normalizeString(input.proxyUsername),
    proxyPassword: normalizeSecretString(input.proxyPassword),
    fingerprint: deriveFingerprint({ privateKeyPem, fingerprint }),
    createdAt: now,
    updatedAt: now,
  };
  validateCredentialForCreate(record);
  return record;
}

function applyUpdates(existing: TerminalCredentialRecord, input: CredentialMetadataInput): TerminalCredentialRecord {
  const next: TerminalCredentialRecord = { ...existing, updatedAt: new Date().toISOString() };
  if ("label" in input) next.label = requireLabel(input.label);
  if ("username" in input) next.username = normalizeString(input.username);
  if ("identityFilePath" in input) next.identityFilePath = normalizeString(input.identityFilePath);
  if ("proxyUsername" in input) next.proxyUsername = normalizeString(input.proxyUsername);
  if ("fingerprint" in input) next.fingerprint = normalizeString(input.fingerprint);

  const privateKeyPem = normalizeSecretString(input.privateKeyPem);
  if (privateKeyPem !== undefined) {
    next.privateKeyPem = privateKeyPem;
    next.fingerprint = deriveFingerprint({ privateKeyPem, fingerprint: normalizeString(input.fingerprint) });
  }
  const passphrase = normalizeSecretString(input.passphrase);
  if (passphrase !== undefined) next.passphrase = passphrase;
  const password = normalizeSecretString(input.password);
  if (password !== undefined) next.password = password;
  const proxyPassword = normalizeSecretString(input.proxyPassword);
  if (proxyPassword !== undefined) next.proxyPassword = proxyPassword;

  validateCredentialForCreate(next);
  return next;
}

export async function listTerminalCredentials(): Promise<TerminalCredentialSummary[]> {
  const [vault, config] = await Promise.all([readVault(), Promise.resolve(readPiWebConfig())]);
  return vault.credentials.map((record) => toSummary(record, config.terminal.ssh.profiles));
}

export async function createTerminalCredential(input: unknown): Promise<TerminalCredentialSummary> {
  if (!isRecord(input)) throw new TerminalSshVaultError("credential body must be an object", 400);
  const record = createRecord(input);
  const vault = await readVault();
  if (vault.credentials.some((credential) => credential.id === record.id)) {
    throw new TerminalSshVaultError("credential id already exists", 409);
  }
  const nextVault = { version: 1 as const, credentials: [...vault.credentials, record] };
  await writeVault(nextVault);
  return toSummary(record);
}

export async function readTerminalCredentialSecret(id: string): Promise<TerminalCredentialRecord> {
  const normalizedId = id.trim();
  if (!normalizedId) throw new TerminalSshVaultError("credential id is required", 400);
  const vault = await readVault();
  const record = vault.credentials.find((credential) => credential.id === normalizedId);
  if (!record) throw new TerminalSshVaultError("SSH credential not found", 404);
  return record;
}

export async function getTerminalCredentialSummary(id: string): Promise<TerminalCredentialSummary> {
  return toSummary(await readTerminalCredentialSecret(id));
}

export async function updateTerminalCredential(id: string, input: unknown): Promise<TerminalCredentialSummary> {
  const normalizedId = id.trim();
  if (!normalizedId) throw new TerminalSshVaultError("credential id is required", 400);
  if (!isRecord(input)) throw new TerminalSshVaultError("credential body must be an object", 400);
  const vault = await readVault();
  let updated: TerminalCredentialRecord | null = null;
  const credentials = vault.credentials.map((credential) => {
    if (credential.id !== normalizedId) return credential;
    updated = applyUpdates(credential, input);
    return updated;
  });
  if (!updated) throw new TerminalSshVaultError("SSH credential not found", 404);
  await writeVault({ version: 1, credentials });
  return toSummary(updated);
}

export async function deleteTerminalCredential(id: string, options: { force?: boolean } = {}): Promise<TerminalCredentialSummary[]> {
  const normalizedId = id.trim();
  if (!normalizedId) throw new TerminalSshVaultError("credential id is required", 400);
  const references = usedByProfileIds(normalizedId);
  if (references.length > 0 && !options.force) {
    throw new TerminalSshVaultError("SSH credential is referenced by profiles", 409, references);
  }

  const vault = await readVault();
  const record = vault.credentials.find((credential) => credential.id === normalizedId);
  if (!record) throw new TerminalSshVaultError("SSH credential not found", 404);

  await ensureVaultDir();
  await ensureDeletedVaultDir();
  if (await pathExists(vaultPath())) {
    await writeFile(deletedCredentialPath(normalizedId), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: CREDENTIALS_FILE_MODE });
  }
  await writeVault({ version: 1, credentials: vault.credentials.filter((credential) => credential.id !== normalizedId) });
  return listTerminalCredentials();
}
