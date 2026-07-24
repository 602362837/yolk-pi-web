/**
 * github-automation-store — durable filesystem store for GitHub App automation (GHA-02).
 *
 * Layout under getAgentDir()/github-automation:
 *   deliveries/YYYY-MM-DD/<deliveryId>.json
 *   jobs/<jobId>.json
 *   repositories/<repoId>/state.json
 *   repositories/<repoId>/issues/<n>.json
 *   events/YYYY-MM-DD.jsonl
 *   .locks/issues/<repoId>-<n>.lock/
 *   .locks/jobs/<jobId>.lock/
 *
 * Invariants:
 * - 0700 directories, 0600 files, tmp+fsync+rename atomic writes.
 * - Delivery records are created with exclusive open ("wx") — duplicate delivery id is a no-op.
 * - Never persists raw webhook body, signatures, credentials, Issue/comment full text.
 * - Safe event projections only (codes, ids, truncated titles).
 */

import { createHash, randomUUID } from "node:crypto";
import {
  appendFile,
  chmod,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { getGithubAutomationRootDir } from "./github-automation-config";
import { GithubAutomationError } from "./github-automation-errors";

// ─── Constants ───────────────────────────────────────────────────────────────

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_STALE_MS = 60_000;
const LOCK_RETRY_MIN_MS = 20;
const LOCK_RETRY_MAX_MS = 80;
const LOCK_MAX_WAIT_MS = 10_000;
const TITLE_MAX_CHARS = 120;
const TRACE_ID_BYTES = 8;

export const GITHUB_AUTOMATION_STORE_SCHEMA_VERSION = 1 as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export type GithubAutomationDeliveryDisposition =
  | "enqueued"
  | "duplicate"
  | "ignored"
  | "paused";

export type GithubAutomationDeliveryIgnoreReason =
  | "unknown_event"
  | "repository_not_allowlisted"
  | "automation_disabled"
  | "mode_off"
  | "missing_issue"
  | "malformed_envelope"
  | "installation_mismatch";

/** Allowlisted webhook event names we may act on (P0). */
export type GithubAutomationWebhookEventName =
  | "issues"
  | "issue_comment"
  | "installation"
  | "installation_repositories"
  | "pull_request"
  | "ping"
  | "other";

export type GithubAutomationJobPhase =
  | "received"
  | "claim_readiness"
  | "triaging"
  | "awaiting_owner"
  | "accepted_waiting_automation"
  | "implementation_queued"
  | "planning"
  | "policy_check"
  | "implementing"
  | "checking"
  | "final_policy"
  | "publishing"
  | "pr_open"
  | "completed"
  | "blocked_claim_assignee"
  | "blocked"
  | "cancelled"
  | "not_adopted"
  | "retry_due"
  | "paused";

export type GithubAutomationJobStatus =
  | "queued"
  | "running"
  | "retry_due"
  | "paused"
  | "blocked"
  | "completed"
  | "cancelled"
  | "ignored";

export type GithubAutomationEffectName =
  | "claim_assignee"
  | "claim_label"
  | "triage_comment"
  | "blocked_comment"
  | "worktree"
  | "branch"
  | "pull_request";

export type GithubAutomationEffectStatus =
  | "intended"
  | "remote_confirmed"
  | "local_committed"
  | "failed"
  | "reconcile_needed";

export interface GithubAutomationDeliveryRecord {
  schemaVersion: typeof GITHUB_AUTOMATION_STORE_SCHEMA_VERSION;
  deliveryId: string;
  eventName: GithubAutomationWebhookEventName | string;
  action: string | null;
  repositoryId: number | null;
  repositoryFullName: string | null;
  installationId: number | null;
  issueNumber: number | null;
  /** Truncated safe title only — never body. */
  issueTitlePreview: string | null;
  senderLogin: string | null;
  senderId: number | null;
  disposition: GithubAutomationDeliveryDisposition;
  ignoreReason: GithubAutomationDeliveryIgnoreReason | null;
  jobId: string | null;
  receivedAt: string;
  /** Opaque hash of raw body for diagnostics — not the body itself. */
  bodySha256Prefix: string;
}

export interface GithubAutomationEffectMarker {
  name: GithubAutomationEffectName;
  status: GithubAutomationEffectStatus;
  remoteId: string | null;
  generation: number;
  updatedAt: string;
  /** Safe reason code only. */
  reasonCode: string | null;
}

export interface GithubAutomationJobRecord {
  schemaVersion: typeof GITHUB_AUTOMATION_STORE_SCHEMA_VERSION;
  jobId: string;
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  installationId: number | null;
  phase: GithubAutomationJobPhase;
  status: GithubAutomationJobStatus;
  generation: number;
  attempt: number;
  deliveryId: string | null;
  /** Safe truncated title. */
  issueTitlePreview: string | null;
  traceId: string;
  createdAt: string;
  updatedAt: string;
  nextRetryAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  /** Safe reason code for blocked/retry. */
  reasonCode: string | null;
  effects: GithubAutomationEffectMarker[];
  /** Checkpoint name for restart resume (first incomplete). */
  checkpoint: string | null;
}

export interface GithubAutomationIssueStateRecord {
  schemaVersion: typeof GITHUB_AUTOMATION_STORE_SCHEMA_VERSION;
  repositoryId: number;
  issueNumber: number;
  generation: number;
  activeJobId: string | null;
  claimStatus: "incomplete" | "complete" | "blocked_claim_assignee" | null;
  updatedAt: string;
  lastDeliveryId: string | null;
  effects: GithubAutomationEffectMarker[];
}

export interface GithubAutomationSafeEvent {
  at: string;
  kind: string;
  repositoryId: number | null;
  issueNumber: number | null;
  jobId: string | null;
  deliveryId: string | null;
  phase: GithubAutomationJobPhase | null;
  reasonCode: string | null;
  traceId: string | null;
  /** Extra non-secret scalar fields only. */
  meta?: Record<string, string | number | boolean | null>;
}

export interface GithubWebhookEnvelope {
  eventName: GithubAutomationWebhookEventName | string;
  action: string | null;
  deliveryId: string;
  repositoryId: number | null;
  repositoryFullName: string | null;
  installationId: number | null;
  issueNumber: number | null;
  issueTitlePreview: string | null;
  issueState: string | null;
  senderLogin: string | null;
  senderId: number | null;
  /** Whether this event name is in the allowlisted set for automation. */
  knownEvent: boolean;
}

// ─── Path helpers ────────────────────────────────────────────────────────────

function rootDir(): string {
  return getGithubAutomationRootDir();
}

export function getGithubAutomationDeliveriesDir(day: string): string {
  return join(rootDir(), "deliveries", day);
}

export function getGithubAutomationDeliveryPath(
  deliveryId: string,
  receivedAt: string = new Date().toISOString(),
): string {
  const day = receivedAt.slice(0, 10);
  const safeId = sanitizePathSegment(deliveryId);
  return join(getGithubAutomationDeliveriesDir(day), `${safeId}.json`);
}

export function getGithubAutomationJobPath(jobId: string): string {
  return join(rootDir(), "jobs", `${sanitizePathSegment(jobId)}.json`);
}

export function getGithubAutomationJobsDir(): string {
  return join(rootDir(), "jobs");
}

export function getGithubAutomationIssueStatePath(
  repositoryId: number,
  issueNumber: number,
): string {
  return join(
    rootDir(),
    "repositories",
    String(repositoryId),
    "issues",
    `${issueNumber}.json`,
  );
}

export function getGithubAutomationEventsPath(day: string): string {
  return join(rootDir(), "events", `${day}.jsonl`);
}

export function getGithubAutomationIssueLockDir(
  repositoryId: number,
  issueNumber: number,
): string {
  return join(
    rootDir(),
    ".locks",
    "issues",
    `${repositoryId}-${issueNumber}.lock`,
  );
}

export function getGithubAutomationJobLockDir(jobId: string): string {
  return join(rootDir(), ".locks", "jobs", `${sanitizePathSegment(jobId)}.lock`);
}

function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 200);
  return cleaned.length > 0 ? cleaned : "unknown";
}

// ─── FS helpers ──────────────────────────────────────────────────────────────

async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: DIR_MODE });
  try {
    await chmod(path, DIR_MODE);
  } catch {
    // best-effort
  }
}

async function ensureParentDir(filePath: string): Promise<void> {
  await ensureDir(dirname(filePath));
}

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err;
}

async function atomicWriteJson(filePath: string, value: unknown): Promise<void> {
  await ensureParentDir(filePath);
  const tmpPath = join(
    dirname(filePath),
    `.tmp.${process.pid}.${randomUUID().slice(0, 10)}.tmp`,
  );
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await open(tmpPath, "w", FILE_MODE);
    try {
      await handle.writeFile(contents, "utf8");
      try {
        await handle.sync();
      } catch {
        // best-effort fsync
      }
    } finally {
      await handle.close();
    }
    try {
      await chmod(tmpPath, FILE_MODE);
    } catch {
      // best-effort
    }
    await rename(tmpPath, filePath);
    try {
      await chmod(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
  } catch (err) {
    try {
      await rm(tmpPath, { force: true });
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Exclusive create of a JSON file (open "wx").
 * Returns true when created, false when already exists.
 */
async function exclusiveWriteJson(
  filePath: string,
  value: unknown,
): Promise<boolean> {
  await ensureParentDir(filePath);
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const handle = await open(filePath, "wx", FILE_MODE);
    try {
      await handle.writeFile(contents, "utf8");
      try {
        await handle.sync();
      } catch {
        // best-effort
      }
    } finally {
      await handle.close();
    }
    try {
      await chmod(filePath, FILE_MODE);
    } catch {
      // best-effort
    }
    return true;
  } catch (err) {
    if (isNodeError(err) && err.code === "EEXIST") {
      return false;
    }
    throw err;
  }
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    if (!raw.trim()) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return null;
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitteredRetryMs(): number {
  return (
    LOCK_RETRY_MIN_MS +
    Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1))
  );
}

// ─── Truncation / ids ────────────────────────────────────────────────────────

export function truncateIssueTitlePreview(
  title: unknown,
  maxChars: number = TITLE_MAX_CHARS,
): string | null {
  if (typeof title !== "string") return null;
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxChars) return collapsed;
  return `${collapsed.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function createGithubAutomationTraceId(): string {
  return createHash("sha256")
    .update(`${randomUUID()}:${Date.now()}:${process.pid}`)
    .digest("hex")
    .slice(0, TRACE_ID_BYTES * 2);
}

export function createGithubAutomationJobId(parts: {
  repositoryId: number;
  issueNumber: number;
  generation?: number;
}): string {
  const gen = parts.generation ?? 1;
  return `job_${parts.repositoryId}_${parts.issueNumber}_g${gen}_${randomUUID().slice(0, 8)}`;
}

export function hashWebhookBodyPrefix(rawBody: Buffer | Uint8Array): string {
  return createHash("sha256").update(rawBody).digest("hex").slice(0, 16);
}

// ─── Envelope parsing (safe; no body/comment text retained) ──────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPositiveInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && /^\d+$/.test(value)) {
    const n = Number(value);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return null;
}

const KNOWN_EVENTS = new Set<string>([
  "issues",
  "issue_comment",
  "installation",
  "installation_repositories",
  "pull_request",
  "ping",
]);

/**
 * Parse allowlisted envelope fields from already-verified JSON.
 * Never retains issue body, comment body, or diff text.
 */
export function parseGithubWebhookEnvelope(options: {
  eventName: string | null | undefined;
  deliveryId: string | null | undefined;
  payload: unknown;
}): GithubWebhookEnvelope {
  const eventNameRaw =
    typeof options.eventName === "string" && options.eventName.trim()
      ? options.eventName.trim()
      : "other";
  const knownEvent = KNOWN_EVENTS.has(eventNameRaw);
  const eventName: GithubAutomationWebhookEventName | string = knownEvent
    ? (eventNameRaw as GithubAutomationWebhookEventName)
    : eventNameRaw === "other"
      ? "other"
      : eventNameRaw;

  const deliveryId =
    typeof options.deliveryId === "string" && options.deliveryId.trim()
      ? options.deliveryId.trim()
      : "";

  if (!deliveryId) {
    throw new GithubAutomationError(
      "invalid_config",
      "Missing X-GitHub-Delivery",
      { status: 400, details: { reason: "missing_delivery_id" } },
    );
  }

  const payload = isRecord(options.payload) ? options.payload : {};
  const action =
    typeof payload.action === "string" && payload.action.trim()
      ? payload.action.trim()
      : null;

  let repositoryId: number | null = null;
  let repositoryFullName: string | null = null;
  if (isRecord(payload.repository)) {
    repositoryId = asPositiveInt(payload.repository.id);
    if (typeof payload.repository.full_name === "string") {
      repositoryFullName = payload.repository.full_name.trim() || null;
    }
  }

  let installationId: number | null = null;
  if (isRecord(payload.installation)) {
    installationId = asPositiveInt(payload.installation.id);
  }

  let issueNumber: number | null = null;
  let issueTitlePreview: string | null = null;
  let issueState: string | null = null;
  if (isRecord(payload.issue)) {
    issueNumber = asPositiveInt(payload.issue.number);
    issueTitlePreview = truncateIssueTitlePreview(payload.issue.title);
    if (typeof payload.issue.state === "string") {
      issueState = payload.issue.state;
    }
  }

  let senderLogin: string | null = null;
  let senderId: number | null = null;
  if (isRecord(payload.sender)) {
    if (typeof payload.sender.login === "string") {
      senderLogin = payload.sender.login.trim() || null;
    }
    senderId = asPositiveInt(payload.sender.id);
  }

  return {
    eventName,
    action,
    deliveryId,
    repositoryId,
    repositoryFullName,
    installationId,
    issueNumber,
    issueTitlePreview,
    issueState,
    senderLogin,
    senderId,
    knownEvent,
  };
}

// ─── Delivery exclusive create ───────────────────────────────────────────────

export interface CreateDeliveryInput {
  envelope: GithubWebhookEnvelope;
  disposition: GithubAutomationDeliveryDisposition;
  ignoreReason?: GithubAutomationDeliveryIgnoreReason | null;
  jobId?: string | null;
  bodySha256Prefix: string;
  receivedAt?: string;
}

export interface CreateDeliveryResult {
  created: boolean;
  record: GithubAutomationDeliveryRecord;
}

/**
 * Exclusive delivery create. Duplicate deliveryId returns created=false with existing record when readable.
 * Never stores raw body/signature.
 */
export async function createGithubAutomationDelivery(
  input: CreateDeliveryInput,
): Promise<CreateDeliveryResult> {
  const receivedAt = input.receivedAt ?? new Date().toISOString();
  const record: GithubAutomationDeliveryRecord = {
    schemaVersion: GITHUB_AUTOMATION_STORE_SCHEMA_VERSION,
    deliveryId: input.envelope.deliveryId,
    eventName: input.envelope.eventName,
    action: input.envelope.action,
    repositoryId: input.envelope.repositoryId,
    repositoryFullName: input.envelope.repositoryFullName,
    installationId: input.envelope.installationId,
    issueNumber: input.envelope.issueNumber,
    issueTitlePreview: input.envelope.issueTitlePreview,
    senderLogin: input.envelope.senderLogin,
    senderId: input.envelope.senderId,
    disposition: input.disposition,
    ignoreReason: input.ignoreReason ?? null,
    jobId: input.jobId ?? null,
    receivedAt,
    bodySha256Prefix: input.bodySha256Prefix,
  };

  const path = getGithubAutomationDeliveryPath(record.deliveryId, receivedAt);
  const created = await exclusiveWriteJson(path, record);
  if (created) {
    return { created: true, record };
  }

  // Duplicate — try to load existing (may be same day path only).
  const existing = await readGithubAutomationDelivery(record.deliveryId, receivedAt);
  return {
    created: false,
    record: existing ?? record,
  };
}

/**
 * Rewrite an already-created delivery record (e.g. attach jobId after exclusive create).
 * Path is derived from the record's receivedAt + deliveryId.
 */
export async function writeGithubAutomationDelivery(
  record: GithubAutomationDeliveryRecord,
): Promise<GithubAutomationDeliveryRecord> {
  const path = getGithubAutomationDeliveryPath(record.deliveryId, record.receivedAt);
  await atomicWriteJson(path, record);
  return record;
}

export async function readGithubAutomationDelivery(
  deliveryId: string,
  receivedAtHint?: string,
): Promise<GithubAutomationDeliveryRecord | null> {
  if (receivedAtHint) {
    const direct = await readJsonFile<GithubAutomationDeliveryRecord>(
      getGithubAutomationDeliveryPath(deliveryId, receivedAtHint),
    );
    if (direct) return direct;
  }

  // Scan recent delivery day dirs (today and yesterday) for exclusive-create path variance.
  const now = Date.now();
  for (const offset of [0, 1, 2]) {
    const day = new Date(now - offset * 86_400_000).toISOString().slice(0, 10);
    const path = join(
      getGithubAutomationDeliveriesDir(day),
      `${sanitizePathSegment(deliveryId)}.json`,
    );
    const record = await readJsonFile<GithubAutomationDeliveryRecord>(path);
    if (record) return record;
  }
  return null;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function writeGithubAutomationJob(
  job: GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord> {
  const next: GithubAutomationJobRecord = {
    ...job,
    schemaVersion: GITHUB_AUTOMATION_STORE_SCHEMA_VERSION,
    updatedAt: job.updatedAt || new Date().toISOString(),
  };
  await atomicWriteJson(getGithubAutomationJobPath(next.jobId), next);
  return next;
}

export async function readGithubAutomationJob(
  jobId: string,
): Promise<GithubAutomationJobRecord | null> {
  return readJsonFile<GithubAutomationJobRecord>(getGithubAutomationJobPath(jobId));
}

export async function listGithubAutomationJobs(): Promise<GithubAutomationJobRecord[]> {
  const dir = getGithubAutomationJobsDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (err) {
    if (isNodeError(err) && err.code === "ENOENT") return [];
    throw err;
  }
  const jobs: GithubAutomationJobRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json") || name.startsWith(".")) continue;
    const job = await readJsonFile<GithubAutomationJobRecord>(join(dir, name));
    if (job && typeof job.jobId === "string") jobs.push(job);
  }
  return jobs;
}

export async function createQueuedGithubAutomationJob(input: {
  repositoryId: number;
  repositoryFullName: string;
  issueNumber: number;
  installationId: number | null;
  deliveryId: string | null;
  issueTitlePreview: string | null;
  generation?: number;
  phase?: GithubAutomationJobPhase;
}): Promise<GithubAutomationJobRecord> {
  const now = new Date().toISOString();
  const generation = input.generation ?? 1;
  const job: GithubAutomationJobRecord = {
    schemaVersion: GITHUB_AUTOMATION_STORE_SCHEMA_VERSION,
    jobId: createGithubAutomationJobId({
      repositoryId: input.repositoryId,
      issueNumber: input.issueNumber,
      generation,
    }),
    repositoryId: input.repositoryId,
    repositoryFullName: input.repositoryFullName,
    issueNumber: input.issueNumber,
    installationId: input.installationId,
    phase: input.phase ?? "received",
    status: "queued",
    generation,
    attempt: 0,
    deliveryId: input.deliveryId,
    issueTitlePreview: input.issueTitlePreview,
    traceId: createGithubAutomationTraceId(),
    createdAt: now,
    updatedAt: now,
    nextRetryAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
    reasonCode: null,
    effects: [],
    checkpoint: "received",
  };
  await writeGithubAutomationJob(job);
  return job;
}

/**
 * CAS-ish generation guard: refuse to write if disk generation is newer.
 */
export async function updateGithubAutomationJobIfGeneration(
  jobId: string,
  expectedGeneration: number,
  updater: (current: GithubAutomationJobRecord) => GithubAutomationJobRecord,
): Promise<GithubAutomationJobRecord | null> {
  const current = await readGithubAutomationJob(jobId);
  if (!current) return null;
  if (current.generation !== expectedGeneration) return null;
  if (current.generation > expectedGeneration) return null;
  const next = updater({
    ...current,
    effects: current.effects.map((e) => ({ ...e })),
  });
  if (next.generation < current.generation) {
    return null;
  }
  next.updatedAt = new Date().toISOString();
  await writeGithubAutomationJob(next);
  return next;
}

// ─── Issue state ─────────────────────────────────────────────────────────────

export async function readGithubAutomationIssueState(
  repositoryId: number,
  issueNumber: number,
): Promise<GithubAutomationIssueStateRecord | null> {
  return readJsonFile<GithubAutomationIssueStateRecord>(
    getGithubAutomationIssueStatePath(repositoryId, issueNumber),
  );
}

export async function writeGithubAutomationIssueState(
  state: GithubAutomationIssueStateRecord,
): Promise<GithubAutomationIssueStateRecord> {
  const next: GithubAutomationIssueStateRecord = {
    ...state,
    schemaVersion: GITHUB_AUTOMATION_STORE_SCHEMA_VERSION,
    updatedAt: state.updatedAt || new Date().toISOString(),
  };
  await atomicWriteJson(
    getGithubAutomationIssueStatePath(next.repositoryId, next.issueNumber),
    next,
  );
  return next;
}

export async function upsertGithubAutomationIssueState(input: {
  repositoryId: number;
  issueNumber: number;
  activeJobId?: string | null;
  lastDeliveryId?: string | null;
  claimStatus?: GithubAutomationIssueStateRecord["claimStatus"];
  generation?: number;
  effects?: GithubAutomationEffectMarker[];
}): Promise<GithubAutomationIssueStateRecord> {
  const existing = await readGithubAutomationIssueState(
    input.repositoryId,
    input.issueNumber,
  );
  const now = new Date().toISOString();
  const next: GithubAutomationIssueStateRecord = {
    schemaVersion: GITHUB_AUTOMATION_STORE_SCHEMA_VERSION,
    repositoryId: input.repositoryId,
    issueNumber: input.issueNumber,
    generation:
      input.generation ??
      existing?.generation ??
      1,
    activeJobId:
      input.activeJobId !== undefined
        ? input.activeJobId
        : (existing?.activeJobId ?? null),
    claimStatus:
      input.claimStatus !== undefined
        ? input.claimStatus
        : (existing?.claimStatus ?? null),
    updatedAt: now,
    lastDeliveryId:
      input.lastDeliveryId !== undefined
        ? input.lastDeliveryId
        : (existing?.lastDeliveryId ?? null),
    effects: input.effects ?? existing?.effects ?? [],
  };
  // Generation CAS: never let an older generation overwrite a newer one.
  if (existing && next.generation < existing.generation) {
    return existing;
  }
  return writeGithubAutomationIssueState(next);
}

// ─── Effect markers ──────────────────────────────────────────────────────────

export function upsertEffectMarker(
  effects: GithubAutomationEffectMarker[],
  marker: Omit<GithubAutomationEffectMarker, "updatedAt"> & { updatedAt?: string },
): GithubAutomationEffectMarker[] {
  const updatedAt = marker.updatedAt ?? new Date().toISOString();
  const next = effects.filter((e) => e.name !== marker.name);
  next.push({
    name: marker.name,
    status: marker.status,
    remoteId: marker.remoteId,
    generation: marker.generation,
    reasonCode: marker.reasonCode,
    updatedAt,
  });
  return next;
}

// ─── Safe events ─────────────────────────────────────────────────────────────

export async function appendGithubAutomationSafeEvent(
  event: GithubAutomationSafeEvent,
): Promise<void> {
  const at = event.at || new Date().toISOString();
  const day = at.slice(0, 10);
  const path = getGithubAutomationEventsPath(day);
  await ensureParentDir(path);
  const line = `${JSON.stringify({ ...event, at })}\n`;
  await appendFile(path, line, { encoding: "utf8", mode: FILE_MODE });
  try {
    await chmod(path, FILE_MODE);
  } catch {
    // best-effort
  }
}

// ─── Filesystem leases (mkdir exclusive) ─────────────────────────────────────

interface LeaseOwner {
  ownerId: string;
  pid: number;
  createdAt: number;
}

async function readLeaseOwner(lockDir: string): Promise<LeaseOwner | null> {
  try {
    const raw = JSON.parse(
      await readFile(join(lockDir, "owner.json"), "utf8"),
    ) as unknown;
    if (!isRecord(raw)) return null;
    const ownerId =
      typeof raw.ownerId === "string" && raw.ownerId.trim()
        ? raw.ownerId.trim()
        : null;
    const pid =
      typeof raw.pid === "number" && Number.isFinite(raw.pid) ? raw.pid : null;
    const createdAt =
      typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
        ? raw.createdAt
        : null;
    if (!ownerId || pid === null || createdAt === null) return null;
    return { ownerId, pid, createdAt };
  } catch {
    return null;
  }
}

async function leaseAgeMs(lockDir: string): Promise<number | null> {
  const owner = await readLeaseOwner(lockDir);
  if (owner) return Date.now() - owner.createdAt;
  try {
    const st = await stat(lockDir);
    return Date.now() - st.mtimeMs;
  } catch {
    return null;
  }
}

async function tryRemoveStaleLease(lockDir: string): Promise<boolean> {
  const age = await leaseAgeMs(lockDir);
  if (age === null || age < LOCK_STALE_MS) return false;
  try {
    await rm(lockDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export interface GithubAutomationLeaseHandle {
  ownerId: string;
  lockDir: string;
  release: () => Promise<void>;
}

async function acquireDirLease(
  lockDir: string,
  ownerId: string,
  options?: { maxWaitMs?: number; staleMs?: number },
): Promise<GithubAutomationLeaseHandle> {
  const maxWaitMs = options?.maxWaitMs ?? LOCK_MAX_WAIT_MS;
  const staleMs = options?.staleMs ?? LOCK_STALE_MS;
  await ensureDir(dirname(lockDir));

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockDir, { recursive: false, mode: DIR_MODE });
      const owner: LeaseOwner = {
        ownerId,
        pid: process.pid,
        createdAt: Date.now(),
      };
      await writeFile(
        join(lockDir, "owner.json"),
        `${JSON.stringify(owner)}\n`,
        { encoding: "utf8", mode: FILE_MODE },
      );

      let released = false;
      return {
        ownerId,
        lockDir,
        release: async () => {
          if (released) return;
          released = true;
          try {
            const current = await readLeaseOwner(lockDir);
            if (
              current &&
              current.ownerId === owner.ownerId &&
              current.createdAt === owner.createdAt
            ) {
              await rm(lockDir, { recursive: true, force: true });
            }
          } catch {
            // best-effort
          }
        },
      };
    } catch (err) {
      if (!isNodeError(err) || err.code !== "EEXIST") throw err;

      // Stale recovery with configured threshold.
      const age = await leaseAgeMs(lockDir);
      if (age !== null && age >= staleMs) {
        await tryRemoveStaleLease(lockDir);
      }

      if (Date.now() - startedAt > maxWaitMs) {
        throw new GithubAutomationError(
          "internal_error",
          "Failed to acquire automation lease",
          { status: 503, details: { reason: "lease_timeout" } },
        );
      }
      await sleep(jitteredRetryMs());
    }
  }
}

export async function withGithubAutomationIssueLease<T>(
  repositoryId: number,
  issueNumber: number,
  fn: (lease: GithubAutomationLeaseHandle) => Promise<T>,
  options?: { ownerId?: string; maxWaitMs?: number; staleMs?: number },
): Promise<T> {
  const ownerId =
    options?.ownerId ??
    `issue-${repositoryId}-${issueNumber}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const lease = await acquireDirLease(
    getGithubAutomationIssueLockDir(repositoryId, issueNumber),
    ownerId,
    options,
  );
  try {
    return await fn(lease);
  } finally {
    await lease.release();
  }
}

export async function withGithubAutomationJobLease<T>(
  jobId: string,
  fn: (lease: GithubAutomationLeaseHandle) => Promise<T>,
  options?: { ownerId?: string; maxWaitMs?: number; staleMs?: number },
): Promise<T> {
  const ownerId =
    options?.ownerId ?? `job-${jobId}-${process.pid}-${randomUUID().slice(0, 8)}`;
  const lease = await acquireDirLease(
    getGithubAutomationJobLockDir(jobId),
    ownerId,
    options,
  );
  try {
    return await fn(lease);
  } finally {
    await lease.release();
  }
}

/** Test helper: force-remove a lease dir (does not check ownership). */
export async function _testForceRemoveLeaseDir(lockDir: string): Promise<void> {
  await rm(lockDir, { recursive: true, force: true });
}

/**
 * Ensure store root skeleton exists (0700).
 * Safe to call repeatedly; does not start scheduler work.
 */
export async function ensureGithubAutomationStoreLayout(): Promise<void> {
  await ensureDir(rootDir());
  await ensureDir(join(rootDir(), "deliveries"));
  await ensureDir(join(rootDir(), "jobs"));
  await ensureDir(join(rootDir(), "repositories"));
  await ensureDir(join(rootDir(), "events"));
  await ensureDir(join(rootDir(), ".locks"));
  await ensureDir(join(rootDir(), ".locks", "issues"));
  await ensureDir(join(rootDir(), ".locks", "jobs"));
}
