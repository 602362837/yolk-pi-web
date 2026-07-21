/**
 * Transactional metadata and normalized-asset storage for appearance skins.
 *
 * Asset bytes arrive only as server-created staged files in `.tmp`. This store
 * never accepts user filenames or paths and never exposes its filesystem layout.
 */

import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

import {
  APPEARANCE_ACCEPTED_MIME_TYPES,
  APPEARANCE_MAX_LONG_EDGE,
  APPEARANCE_MAX_PIXELS,
  APPEARANCE_MAX_SKINS,
  APPEARANCE_MAX_TOTAL_BYTES,
  APPEARANCE_MAX_UPLOAD_BYTES,
  APPEARANCE_MAX_VIDEO_UPLOAD_BYTES,
  APPEARANCE_MAX_VIDEO_DURATION_MS,
  APPEARANCE_MAX_VIDEO_LONG_EDGE,
  APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES,
  APPEARANCE_SCHEMA_VERSION,
  isAppearancePresentation,
  resolveAppearanceSkinKind,
  sanitizeAppearanceName,
  type AppearanceCatalogProjection,
  type AppearanceIndexV1,
  type AppearanceSkinKind,
  type AppearanceSkinRecordV1,
} from "./appearance-types";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const LOCK_STALE_MS = 30_000;
const LOCK_MAX_WAIT_MS = 15_000;
const LOCK_RETRY_MIN_MS = 40;
const LOCK_RETRY_MAX_MS = 120;
const INDEX_FILE = "index.json";
const SKINS_DIR = "skins";
const TMP_DIR = ".tmp";
const TRASH_DIR = ".trash";
const LOCK_DIR = ".mutation.lock";
const LOCK_OWNER = "owner.json";

export const EMPTY_APPEARANCE_REVISION = revisionForIndex(emptyIndex());

export type AppearanceStoreErrorCode =
  | "revision_conflict"
  | "catalog_invalid"
  | "skin_not_found"
  | "skin_active"
  | "catalog_limit"
  | "storage_limit"
  | "storage_error";

export class AppearanceStoreError extends Error {
  readonly code: AppearanceStoreErrorCode;

  constructor(code: AppearanceStoreErrorCode, message = "Appearance storage operation failed") {
    super(message);
    this.code = code;
    this.name = "AppearanceStoreError";
  }
}

export interface AppearanceReadResult {
  index: AppearanceIndexV1;
  revision: string;
  warnings?: string[];
}

export interface StagedAppearanceAssets {
  fullPath: string;
  thumbnailPath: string;
}

export interface CreateAppearanceSkinInput {
  expectedRevision: string;
  skin: AppearanceSkinRecordV1;
  stagedAssets: StagedAppearanceAssets;
  /** Upload behavior is a product decision, injected by the API layer. */
  activate?: boolean;
}

const processQueues = new Map<string, Promise<unknown>>();

function appearanceDir(): string {
  return join(getAgentDir(), "appearance");
}

export function getAppearanceDirectoryForServer(): string {
  return appearanceDir();
}

export function getAppearanceIndexPathForServer(): string {
  return join(appearanceDir(), INDEX_FILE);
}

/** Server-only staging directory for normalized encoder output. */
export function getAppearanceTemporaryDirectoryForServer(): string {
  return tmpDir();
}

/** Server-only fixed asset resolver; callers must still verify catalog membership. */
export function getAppearanceSkinAssetPathForServer(
  id: string,
  variant: "full" | "thumbnail",
  kind: AppearanceSkinKind = "image",
): string | null {
  if (!isOpaqueSkinId(id)) return null;
  const paths = skinAssetPaths(id, kind);
  return variant === "full" ? paths.full : paths.thumbnail;
}

function skinsDir(): string {
  return join(appearanceDir(), SKINS_DIR);
}

function tmpDir(): string {
  return join(appearanceDir(), TMP_DIR);
}

function trashDir(): string {
  return join(appearanceDir(), TRASH_DIR);
}

function lockDir(): string {
  return join(appearanceDir(), LOCK_DIR);
}

function emptyIndex(): AppearanceIndexV1 {
  return { schemaVersion: APPEARANCE_SCHEMA_VERSION, activeSkinId: null, skins: [], updatedAt: new Date(0).toISOString() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOpaqueSkinId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isAssetForKind(value: unknown, kind: AppearanceSkinKind): value is AppearanceSkinRecordV1["asset"] {
  if (!isRecord(value)) return false;
  if (!isPositiveInteger(value.width) || !isPositiveInteger(value.height)) return false;
  if (!isPositiveInteger(value.bytes) || !isPositiveInteger(value.thumbnailBytes)) return false;
  if (kind === "image") {
    return value.mimeType === "image/webp" && value.durationMs === undefined;
  }
  return value.mimeType === "video/mp4" && isPositiveInteger(value.durationMs);
}

function normalizeSkin(value: unknown): AppearanceSkinRecordV1 | null {
  if (!isRecord(value) || !isOpaqueSkinId(value.id) || !isIsoDate(value.createdAt) || !isIsoDate(value.updatedAt)) return null;
  const kind = resolveAppearanceSkinKind(value.kind);
  if (!kind) return null;
  const name = sanitizeAppearanceName(value.name);
  if (!name || !isAssetForKind(value.asset, kind) || !isAppearancePresentation(value.presentation)) return null;
  // sourceName is display-only metadata; retain only its basename even if a
  // server caller accidentally supplies a path-like value.
  const sourceName = value.sourceName === undefined
    ? undefined
    : typeof value.sourceName === "string"
      ? sanitizeAppearanceName(value.sourceName.replace(/^.*[\\/]/, ""))
      : null;
  if (value.sourceName !== undefined && !sourceName) return null;
  const asset = value.asset as AppearanceSkinRecordV1["asset"];
  const presentation = value.presentation as AppearanceSkinRecordV1["presentation"];
  return {
    id: value.id,
    name,
    kind,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(sourceName ? { sourceName } : {}),
    asset: {
      mimeType: kind === "video" ? "video/mp4" : "image/webp",
      width: asset.width,
      height: asset.height,
      bytes: asset.bytes,
      thumbnailBytes: asset.thumbnailBytes,
      ...(kind === "video" ? { durationMs: asset.durationMs } : {}),
    },
    presentation: {
      fit: presentation.fit,
      positionX: presentation.positionX,
      positionY: presentation.positionY,
      overlayTone: presentation.overlayTone,
      overlayOpacity: presentation.overlayOpacity,
      panelOpacity: presentation.panelOpacity,
    },
  };
}

function normalizeIndex(value: unknown): AppearanceIndexV1 | null {
  if (!isRecord(value) || value.schemaVersion !== APPEARANCE_SCHEMA_VERSION || !Array.isArray(value.skins) || !isIsoDate(value.updatedAt)) return null;
  if (value.activeSkinId !== null && !isOpaqueSkinId(value.activeSkinId)) return null;
  const skins: AppearanceSkinRecordV1[] = [];
  const ids = new Set<string>();
  for (const rawSkin of value.skins) {
    const skin = normalizeSkin(rawSkin);
    if (!skin || ids.has(skin.id)) return null;
    ids.add(skin.id);
    skins.push(skin);
  }
  if (skins.length > APPEARANCE_MAX_SKINS || totalAssetBytes(skins) > APPEARANCE_MAX_TOTAL_BYTES) return null;
  if (value.activeSkinId !== null && !ids.has(value.activeSkinId)) return null;
  return { schemaVersion: APPEARANCE_SCHEMA_VERSION, activeSkinId: value.activeSkinId, skins, updatedAt: value.updatedAt };
}

function canonicalIndex(index: AppearanceIndexV1): string {
  // All records are normalized before this point, so the serialization is a
  // stable opaque revision input and never includes filesystem paths.
  return JSON.stringify(index);
}

function revisionForIndex(index: AppearanceIndexV1): string {
  return createHash("sha256").update(canonicalIndex(index)).digest("hex").slice(0, 24);
}

function cloneIndex(index: AppearanceIndexV1): AppearanceIndexV1 {
  return JSON.parse(JSON.stringify(index)) as AppearanceIndexV1;
}

function skinAssetPaths(id: string, kind: AppearanceSkinKind): { full: string; thumbnail: string } {
  const fullName = kind === "video" ? `${id}.mp4` : `${id}.webp`;
  return { full: join(skinsDir(), fullName), thumbnail: join(skinsDir(), `${id}.thumb.webp`) };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

async function chmodBestEffort(path: string, mode: number): Promise<void> {
  try { await chmod(path, mode); } catch { /* platform dependent */ }
}

async function ensureDirectories(): Promise<void> {
  for (const dir of [appearanceDir(), skinsDir(), tmpDir(), trashDir()]) {
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    await chmodBestEffort(dir, DIR_MODE);
  }
}

async function atomicWriteIndex(index: AppearanceIndexV1): Promise<void> {
  await ensureDirectories();
  const target = getAppearanceIndexPathForServer();
  const temp = join(dirname(target), `.index.${process.pid}.${randomUUID()}.tmp`);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, "w", FILE_MODE);
    await handle.writeFile(`${canonicalIndex(index)}\n`, "utf8");
    try { await handle.sync(); } catch { /* best effort */ }
    await handle.close();
    handle = undefined;
    await chmodBestEffort(temp, FILE_MODE);
    await rename(temp, target);
    await chmodBestEffort(target, FILE_MODE);
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function readIndexInternal(): Promise<AppearanceReadResult> {
  const path = getAppearanceIndexPathForServer();
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      const index = emptyIndex();
      return { index, revision: EMPTY_APPEARANCE_REVISION };
    }
    throw new AppearanceStoreError("storage_error");
  }
  try {
    const index = normalizeIndex(JSON.parse(raw) as unknown);
    if (!index) return { index: emptyIndex(), revision: EMPTY_APPEARANCE_REVISION, warnings: ["appearance_catalog_invalid"] };
    return { index, revision: revisionForIndex(index) };
  } catch {
    // Do not repair or overwrite a malformed/future index during a read.
    return { index: emptyIndex(), revision: EMPTY_APPEARANCE_REVISION, warnings: ["appearance_catalog_invalid"] };
  }
}

export async function readAppearanceCatalog(): Promise<AppearanceReadResult> {
  return readIndexInternal();
}

function retryMs(): number {
  return LOCK_RETRY_MIN_MS + Math.floor(Math.random() * (LOCK_RETRY_MAX_MS - LOCK_RETRY_MIN_MS + 1));
}

function sleep(ms: number): Promise<void> { return new Promise((resolveSleep) => setTimeout(resolveSleep, ms)); }

async function staleLock(): Promise<boolean> {
  try {
    const owner = JSON.parse(await readFile(join(lockDir(), LOCK_OWNER), "utf8")) as unknown;
    if (isRecord(owner) && typeof owner.createdAt === "number" && Number.isFinite(owner.createdAt)) {
      return Date.now() - owner.createdAt >= LOCK_STALE_MS;
    }
  } catch {
    // A concurrent owner may still be writing owner.json; use directory mtime.
  }
  try { return Date.now() - (await stat(lockDir())).mtimeMs >= LOCK_STALE_MS; } catch { return false; }
}

async function acquireLock(): Promise<() => Promise<void>> {
  await ensureDirectories();
  const started = Date.now();
  while (true) {
    try {
      await mkdir(lockDir(), { recursive: false, mode: DIR_MODE });
      const owner = { pid: process.pid, createdAt: Date.now() };
      try {
        const handle = await open(join(lockDir(), LOCK_OWNER), "w", FILE_MODE);
        try {
          await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
          await handle.sync().catch(() => {});
        } finally {
          await handle.close();
        }
      } catch {
        await rm(lockDir(), { recursive: true, force: true }).catch(() => {});
        throw new AppearanceStoreError("storage_error");
      }
      return async () => {
        try {
          const current = JSON.parse(await readFile(join(lockDir(), LOCK_OWNER), "utf8")) as unknown;
          if (isRecord(current) && current.pid === owner.pid && current.createdAt === owner.createdAt) {
            await rm(lockDir(), { recursive: true, force: true });
          }
        } catch {
          // Best-effort unlock; never remove an unowned replacement lock.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw new AppearanceStoreError("storage_error");
      if (await staleLock()) await rm(lockDir(), { recursive: true, force: true }).catch(() => {});
      if (Date.now() - started > LOCK_MAX_WAIT_MS) throw new AppearanceStoreError("storage_error");
      await sleep(retryMs());
    }
  }
}

async function withProcessQueue<T>(fn: () => Promise<T>): Promise<T> {
  const key = resolve(getAppearanceIndexPathForServer());
  const previous = processQueues.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolveGate) => { release = resolveGate; });
  const chain = previous.catch(() => {}).then(() => gate);
  processQueues.set(key, chain);
  await previous.catch(() => {});
  try { return await fn(); } finally { release(); if (processQueues.get(key) === chain) processQueues.delete(key); }
}

async function withMutationLock<T>(fn: () => Promise<T>): Promise<T> {
  return withProcessQueue(async () => {
    const release = await acquireLock();
    try { return await fn(); } finally { await release(); }
  });
}

function assertExpectedRevision(current: AppearanceReadResult, expectedRevision: string): void {
  if (current.warnings) throw new AppearanceStoreError("catalog_invalid");
  if (!expectedRevision || expectedRevision !== current.revision) throw new AppearanceStoreError("revision_conflict");
}

function validateStoreSkin(skin: AppearanceSkinRecordV1): AppearanceSkinRecordV1 {
  const normalized = normalizeSkin(skin);
  if (!normalized) throw new AppearanceStoreError("storage_error");
  return normalized;
}

function assertStagedPath(path: string): void {
  const expectedParent = resolve(tmpDir());
  if (resolve(dirname(path)) !== expectedParent || !basename(path).startsWith(".")) {
    throw new AppearanceStoreError("storage_error");
  }
}

function totalAssetBytes(skins: readonly AppearanceSkinRecordV1[]): number {
  return skins.reduce((total, skin) => total + skin.asset.bytes + skin.asset.thumbnailBytes, 0);
}

/** Only create/delete may change the asset set; metadata mutations cannot invent paths. */
function hasSameAssetSet(current: AppearanceIndexV1, next: AppearanceIndexV1): boolean {
  if (current.skins.length !== next.skins.length) return false;
  return current.skins.every((skin) => {
    const candidate = next.skins.find((item) => item.id === skin.id);
    return candidate !== undefined && JSON.stringify(candidate.asset) === JSON.stringify(skin.asset);
  });
}

/** Commit normalized staged assets and metadata as one rollback-capable transaction. */
export async function createAppearanceSkin(input: CreateAppearanceSkinInput): Promise<AppearanceReadResult> {
  const skin = validateStoreSkin(input.skin);
  assertStagedPath(input.stagedAssets.fullPath);
  assertStagedPath(input.stagedAssets.thumbnailPath);
  return withMutationLock(async () => {
    const current = await readIndexInternal();
    assertExpectedRevision(current, input.expectedRevision);
    if (current.index.skins.length >= APPEARANCE_MAX_SKINS) throw new AppearanceStoreError("catalog_limit");
    if (current.index.skins.some((item) => item.id === skin.id)) throw new AppearanceStoreError("storage_error");
    if (totalAssetBytes([...current.index.skins, skin]) > APPEARANCE_MAX_TOTAL_BYTES) throw new AppearanceStoreError("storage_limit");
    let fullStat: Awaited<ReturnType<typeof stat>>;
    let thumbnailStat: Awaited<ReturnType<typeof stat>>;
    try {
      [fullStat, thumbnailStat] = await Promise.all([
        stat(input.stagedAssets.fullPath),
        stat(input.stagedAssets.thumbnailPath),
      ]);
    } catch {
      throw new AppearanceStoreError("storage_error");
    }
    if (!fullStat.isFile() || !thumbnailStat.isFile() || fullStat.size !== skin.asset.bytes || thumbnailStat.size !== skin.asset.thumbnailBytes) {
      throw new AppearanceStoreError("storage_error");
    }

    const destination = skinAssetPaths(skin.id, skin.kind);
    let fullMoved = false;
    let thumbnailMoved = false;
    try {
      await rename(input.stagedAssets.fullPath, destination.full); fullMoved = true;
      await rename(input.stagedAssets.thumbnailPath, destination.thumbnail); thumbnailMoved = true;
      await chmodBestEffort(destination.full, FILE_MODE);
      await chmodBestEffort(destination.thumbnail, FILE_MODE);
      const next: AppearanceIndexV1 = {
        schemaVersion: APPEARANCE_SCHEMA_VERSION,
        activeSkinId: input.activate ? skin.id : current.index.activeSkinId,
        skins: [...current.index.skins, skin],
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteIndex(next);
      return { index: next, revision: revisionForIndex(next) };
    } catch {
      // A failed index write must not leave new assets referenced or orphaned.
      if (fullMoved) await rm(destination.full, { force: true }).catch(() => {});
      if (thumbnailMoved) await rm(destination.thumbnail, { force: true }).catch(() => {});
      throw new AppearanceStoreError("storage_error");
    }
  });
}

export async function updateAppearanceIndex(
  expectedRevision: string,
  mutate: (index: AppearanceIndexV1) => AppearanceIndexV1,
): Promise<AppearanceReadResult> {
  return withMutationLock(async () => {
    const current = await readIndexInternal();
    assertExpectedRevision(current, expectedRevision);
    const next = normalizeIndex(mutate(cloneIndex(current.index)));
    if (!next || !hasSameAssetSet(current.index, next)) throw new AppearanceStoreError("storage_error");
    next.updatedAt = new Date().toISOString();
    await atomicWriteIndex(next);
    return { index: next, revision: revisionForIndex(next) };
  });
}

/** Delete an asset via quarantine so an index-write failure can restore it. */
export async function deleteAppearanceSkin(input: { expectedRevision: string; id: string; deactivateActive?: boolean }): Promise<AppearanceReadResult> {
  if (!isOpaqueSkinId(input.id)) throw new AppearanceStoreError("skin_not_found");
  return withMutationLock(async () => {
    const current = await readIndexInternal();
    assertExpectedRevision(current, input.expectedRevision);
    const skin = current.index.skins.find((item) => item.id === input.id);
    if (!skin) throw new AppearanceStoreError("skin_not_found");
    const active = current.index.activeSkinId === skin.id;
    if (active && input.deactivateActive !== true) throw new AppearanceStoreError("skin_active");

    const source = skinAssetPaths(skin.id, skin.kind);
    const transactionDir = join(trashDir(), randomUUID());
    await mkdir(transactionDir, { recursive: false, mode: DIR_MODE });
    const quarantined = { full: join(transactionDir, basename(source.full)), thumbnail: join(transactionDir, basename(source.thumbnail)) };
    let fullMoved = false;
    let thumbnailMoved = false;
    try {
      if (await exists(source.full)) { await rename(source.full, quarantined.full); fullMoved = true; }
      if (await exists(source.thumbnail)) { await rename(source.thumbnail, quarantined.thumbnail); thumbnailMoved = true; }
      // Missing referenced assets are a corruption signal: do not turn it into a successful delete.
      if (!fullMoved || !thumbnailMoved) throw new Error("asset missing");
      const next: AppearanceIndexV1 = {
        schemaVersion: APPEARANCE_SCHEMA_VERSION,
        activeSkinId: active ? null : current.index.activeSkinId,
        skins: current.index.skins.filter((item) => item.id !== skin.id),
        updatedAt: new Date().toISOString(),
      };
      await atomicWriteIndex(next);
      await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
      return { index: next, revision: revisionForIndex(next) };
    } catch {
      if (fullMoved) await rename(quarantined.full, source.full).catch(() => {});
      if (thumbnailMoved) await rename(quarantined.thumbnail, source.thumbnail).catch(() => {});
      await rm(transactionDir, { recursive: true, force: true }).catch(() => {});
      throw new AppearanceStoreError("storage_error");
    }
  });
}

export function projectAppearanceCatalog(read: AppearanceReadResult): AppearanceCatalogProjection {
  const skins = [...read.index.skins]
    .sort((left, right) => (left.id === read.index.activeSkinId ? -1 : right.id === read.index.activeSkinId ? 1 : right.updatedAt.localeCompare(left.updatedAt)))
    .map((skin) => ({
      id: skin.id,
      name: skin.name,
      kind: skin.kind,
      width: skin.asset.width,
      height: skin.asset.height,
      bytes: skin.asset.bytes,
      mimeType: skin.asset.mimeType,
      ...(skin.kind === "video" && skin.asset.durationMs !== undefined ? { durationMs: skin.asset.durationMs } : {}),
      createdAt: skin.createdAt,
      updatedAt: skin.updatedAt,
      presentation: { ...skin.presentation },
      assetUrl: `/api/appearance/skins/${skin.id}/asset?variant=full`,
      thumbnailUrl: `/api/appearance/skins/${skin.id}/asset?variant=thumbnail`,
    }));
  return {
    kind: "appearance_catalog",
    revision: read.revision,
    activeSkinId: read.index.activeSkinId,
    skins,
    limits: {
      maxUploadBytes: APPEARANCE_MAX_UPLOAD_BYTES,
      maxVideoUploadBytes: APPEARANCE_MAX_VIDEO_UPLOAD_BYTES,
      recommendedVideoUploadBytes: APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES,
      maxVideoDurationMs: APPEARANCE_MAX_VIDEO_DURATION_MS,
      maxVideoLongEdge: APPEARANCE_MAX_VIDEO_LONG_EDGE,
      maxPixels: APPEARANCE_MAX_PIXELS,
      maxLongEdge: APPEARANCE_MAX_LONG_EDGE,
      maxSkins: APPEARANCE_MAX_SKINS,
      maxTotalBytes: APPEARANCE_MAX_TOTAL_BYTES,
      acceptedMimeTypes: [...APPEARANCE_ACCEPTED_MIME_TYPES],
    },
    ...(read.warnings ? { warnings: read.warnings } : {}),
  };
}

export function createAppearanceSkinId(): string { return randomUUID(); }

/** Test-only queue reset; never affects on-disk data. */
export function __resetAppearanceStoreForTests(): void { processQueues.clear(); }
