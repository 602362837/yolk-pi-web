/**
 * Server-only bounded MP4 validation and poster production for appearance skins.
 *
 * P0 stores the original MP4 bytes (no re-encode). Poster/thumbnail is always a
 * metadata-free WebP owned by this module. Prefer strategy A (ffmpeg frame extract);
 * strategy B accepts an optional poster image field and routes it through the
 * existing image normalizer.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  APPEARANCE_MAX_PIXELS,
  APPEARANCE_MAX_VIDEO_UPLOAD_BYTES,
  APPEARANCE_THUMBNAIL_MAX_EDGE,
  sanitizeAppearanceName,
} from "./appearance-types";
import { getAppearanceTemporaryDirectoryForServer, type StagedAppearanceAssets } from "./appearance-store";
import {
  AppearanceImageError,
  discardNormalizedAppearanceImage,
  normalizeAppearanceImage,
} from "./appearance-image";

const FILE_MODE = 0o600;
const MAX_CONCURRENT_PROCESSING = 2;
/** A selected `moov` subtree must remain small even when media payloads are large. */
const MAX_METADATA_BYTES = 8 * 1024 * 1024;
const MAX_BOX_DEPTH = 6;
const MAX_BOX_COUNT = 2_048;
const FFMPEG_TIMEOUT_MS = 20_000;

const FTYP_BRAND_ALLOWLIST = new Set([
  "isom",
  "iso2",
  "iso3",
  "iso4",
  "iso5",
  "iso6",
  "iso7",
  "iso8",
  "iso9",
  "mp41",
  "mp42",
  "avc1",
  "dash",
  "msdh",
  "msix",
  "m4v ",
  "M4V ",
  "ndas",
  "ndsc",
  "ndsh",
  "ndsm",
  "ndsp",
  "ndss",
  "ndxc",
  "ndxh",
  "ndxm",
  "ndxp",
  "ndxs",
  "cmfc",
]);

let activeProcessing = 0;
// Anchor createRequire at the running package root so production bundles stay portable.
const require = createRequire(join(process.cwd(), "package.json"));

export type AppearanceVideoErrorCode =
  | "unsupported_media"
  | "file_too_large"
  | "oversize_confirmation_required"
  | "video_too_long"
  | "video_resolution_limit"
  | "invalid_media"
  | "decode_failed"
  | "poster_required"
  | "processing_busy";

export class AppearanceVideoError extends Error {
  readonly code: AppearanceVideoErrorCode;

  constructor(code: AppearanceVideoErrorCode) {
    super("Video processing failed");
    this.code = code;
    this.name = "AppearanceVideoError";
  }
}

export interface NormalizedAppearanceVideo {
  assets: StagedAppearanceAssets;
  width: number;
  height: number;
  bytes: number;
  thumbnailBytes: number;
  durationMs: number;
  sourceName?: string;
}

interface ParsedMp4Metadata {
  durationMs: number;
  width: number;
  height: number;
}

function sourceDisplayName(filename: string): string | undefined {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  return sanitizeAppearanceName(base) ?? undefined;
}

async function writePrivateFile(path: string, bytes: Buffer): Promise<void> {
  const handle = await open(path, "w", FILE_MODE);
  try {
    await handle.writeFile(bytes);
    await handle.sync().catch(() => {});
  } finally {
    await handle.close();
  }
  await chmod(path, FILE_MODE).catch(() => {});
}

async function withProcessingSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeProcessing >= MAX_CONCURRENT_PROCESSING) throw new AppearanceVideoError("processing_busy");
  activeProcessing += 1;
  try {
    return await fn();
  } finally {
    activeProcessing -= 1;
  }
}

function readU32(bytes: Buffer, offset: number): number {
  return bytes.readUInt32BE(offset);
}

function readU64(bytes: Buffer, offset: number): number {
  // Values that do not fit in a safe integer are rejected by callers via NaN checks.
  const high = bytes.readUInt32BE(offset);
  const low = bytes.readUInt32BE(offset + 4);
  return high * 0x1_0000_0000 + low;
}

function fourcc(bytes: Buffer, offset: number): string {
  return bytes.subarray(offset, offset + 4).toString("latin1");
}

/** ISO BMFF ftyp brand check; does not trust filename or Content-Type. */
export function hasMp4FtypSignature(bytes: Buffer): boolean {
  if (bytes.length < 16) return false;
  if (fourcc(bytes, 4) !== "ftyp") return false;
  const size = readU32(bytes, 0);
  if (size < 16 || size > bytes.length || size > 256) return false;
  const major = fourcc(bytes, 8);
  const brands = new Set<string>([major]);
  for (let offset = 16; offset + 4 <= size; offset += 4) {
    brands.add(fourcc(bytes, offset));
  }
  for (const brand of brands) {
    if (FTYP_BRAND_ALLOWLIST.has(brand)) return true;
  }
  return false;
}

interface BoxVisit {
  type: string;
  start: number;
  headerSize: number;
  size: number;
}

interface BoxWalkBudget {
  remaining: number;
}

/**
 * Walk a declared box chain. This deliberately reads only headers at the top
 * level, so a large `mdat` is skipped rather than scanned. Returning false is
 * fail-closed for truncated, overflowing, or budget-exhausting containers.
 */
function visitBoxes(
  bytes: Buffer,
  start: number,
  end: number,
  depth: number,
  budget: BoxWalkBudget,
  visit: (box: BoxVisit) => boolean,
): boolean {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end > bytes.length) {
    return false;
  }
  if (depth > MAX_BOX_DEPTH) return false;

  let offset = start;
  while (offset < end) {
    if (end - offset < 8 || budget.remaining <= 0) return false;
    budget.remaining -= 1;

    let size = readU32(bytes, offset);
    const type = fourcc(bytes, offset + 4);
    let headerSize = 8;
    if (size === 1) {
      if (end - offset < 16) return false;
      size = readU64(bytes, offset + 8);
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || size > end - offset) return false;
    const box = { type, start: offset, headerSize, size };
    if (!visit(box)) return false;
    offset += size;
  }
  return true;
}

function parseMvhdDurationMs(payload: Buffer): number | null {
  if (payload.length < 20) return null;
  const version = payload[0];
  if (version === 1) {
    if (payload.length < 32) return null;
    const timescale = readU32(payload, 20);
    const duration = readU64(payload, 24);
    if (!timescale || !Number.isFinite(duration) || duration <= 0) return null;
    return Math.max(1, Math.round((duration / timescale) * 1000));
  }
  if (version === 0) {
    if (payload.length < 20) return null;
    const timescale = readU32(payload, 12);
    const duration = readU32(payload, 16);
    if (!timescale || duration <= 0) return null;
    return Math.max(1, Math.round((duration / timescale) * 1000));
  }
  return null;
}

function parseTkhdDimensions(payload: Buffer): { width: number; height: number } | null {
  if (payload.length < 4) return null;
  const version = payload[0];
  // Fixed-point 16.16 width/height sit at the end of the full header.
  let dimOffset: number;
  if (version === 0) {
    // version(1)+flags(3)+creation(4)+mod(4)+trackId(4)+reserved(4)+duration(4)+reserved(8)+layer(2)+alt(2)+volume(2)+reserved(2)+matrix(36)
    dimOffset = 76;
  } else if (version === 1) {
    dimOffset = 88;
  } else {
    return null;
  }
  if (payload.length < dimOffset + 8) return null;
  const width = Math.floor(readU32(payload, dimOffset) / 65536);
  const height = Math.floor(readU32(payload, dimOffset + 4) / 65536);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function walkForMetadata(bytes: Buffer): ParsedMp4Metadata {
  let durationMs: number | null = null;
  let width = 0;
  let height = 0;
  let foundMoov = false;
  let foundEncryptedSample = false;
  const budget: BoxWalkBudget = { remaining: MAX_BOX_COUNT };

  function visitContainer(start: number, end: number, depth: number): boolean {
    return visitBoxes(
      bytes,
      start,
      end,
      depth,
      budget,
      (box) => {
        const payloadStart = box.start + box.headerSize;
        const payloadEnd = box.start + box.size;
        if (box.type === "trak" || box.type === "mdia" || box.type === "minf" || box.type === "stbl") {
          return visitContainer(payloadStart, payloadEnd, depth + 1);
        }
        if (box.type === "mvhd" && durationMs === null) {
          durationMs = parseMvhdDurationMs(bytes.subarray(payloadStart, payloadEnd));
          return true;
        }
        if (box.type === "tkhd") {
          const dims = parseTkhdDimensions(bytes.subarray(payloadStart, payloadEnd));
          if (dims && dims.width * dims.height > width * height) {
            width = dims.width;
            height = dims.height;
          }
          return true;
        }
        if (box.type === "stsd") {
          // This is bounded by the selected moov metadata budget, not file size.
          const body = bytes.subarray(payloadStart, payloadEnd);
          if (body.includes(Buffer.from("encv")) || body.includes(Buffer.from("enca"))) {
            foundEncryptedSample = true;
          }
        }
        return true;
      },
    );
  }

  const topLevelValid = visitBoxes(bytes, 0, bytes.length, 0, budget, (box) => {
    if (box.type !== "moov") return true;
    // A real top-level moov can occur after arbitrary media payloads, but its
    // metadata tree itself remains strictly bounded.
    if (foundMoov || box.size > MAX_METADATA_BYTES) return false;
    foundMoov = true;
    return visitContainer(box.start + box.headerSize, box.start + box.size, 1);
  });

  if (!topLevelValid) throw new AppearanceVideoError("invalid_media");
  if (foundEncryptedSample) throw new AppearanceVideoError("unsupported_media");
  if (!foundMoov || durationMs === null || durationMs <= 0) throw new AppearanceVideoError("invalid_media");
  if (!width || !height) throw new AppearanceVideoError("invalid_media");
  return { durationMs, width, height };
}

/** Exported for focused unit tests; throws AppearanceVideoError on failure. */
export function inspectAppearanceMp4(bytes: Buffer): ParsedMp4Metadata {
  if (bytes.length === 0 || bytes.length > APPEARANCE_MAX_VIDEO_UPLOAD_BYTES) {
    throw new AppearanceVideoError("file_too_large");
  }
  if (!hasMp4FtypSignature(bytes)) throw new AppearanceVideoError("unsupported_media");
  const meta = walkForMetadata(bytes);
  return meta;
}

function resolveFfmpegBinary(): string | null {
  try {
    const path = require("ffmpeg-static") as string | null | undefined;
    if (typeof path === "string" && path.length > 0) return path;
  } catch {
    // optional dependency may be absent on some platforms
  }
  // Fall back to PATH so local/dev hosts with system ffmpeg still work.
  return process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
}

async function runFfmpeg(args: string[]): Promise<void> {
  const binary = resolveFfmpegBinary();
  if (!binary) throw new AppearanceVideoError("decode_failed");
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, PATH: process.env.PATH ?? "" },
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new AppearanceVideoError("decode_failed"));
    }, FFMPEG_TIMEOUT_MS);
    // Drain stderr without retaining probe text (never surface in public errors).
    child.stderr?.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new AppearanceVideoError("decode_failed"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolvePromise();
      else reject(new AppearanceVideoError("decode_failed"));
    });
  });
}

async function extractPosterFrame(mp4Bytes: Buffer): Promise<Buffer> {
  const dir = getAppearanceTemporaryDirectoryForServer();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const suffix = randomUUID();
  const inputPath = join(dir, `.appearance-video-${suffix}.mp4`);
  const framePath = join(dir, `.appearance-video-${suffix}.frame.png`);
  try {
    await writePrivateFile(inputPath, mp4Bytes);
    // Seek near the start; -ss before -i is fast enough for short wallpapers.
    await runFfmpeg([
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-ss",
      "0",
      "-i",
      inputPath,
      "-frames:v",
      "1",
      "-an",
      "-f",
      "image2",
      framePath,
    ]);
    const frame = await readFile(framePath);
    if (frame.length === 0) throw new AppearanceVideoError("decode_failed");
    return frame;
  } finally {
    await Promise.all([rm(inputPath, { force: true }), rm(framePath, { force: true })]);
  }
}

async function frameToOwnedWebp(frameBytes: Buffer): Promise<Buffer> {
  try {
    const webp = await sharp(frameBytes, {
      animated: false,
      limitInputPixels: APPEARANCE_MAX_PIXELS,
      failOn: "error",
    })
      .rotate()
      .resize({
        width: APPEARANCE_THUMBNAIL_MAX_EDGE,
        height: APPEARANCE_THUMBNAIL_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 82 })
      .toBuffer();
    const metadata = await sharp(webp, {
      animated: false,
      limitInputPixels: APPEARANCE_MAX_PIXELS,
      failOn: "error",
    }).metadata();
    if (metadata.format !== "webp" || !metadata.width || !metadata.height) {
      throw new AppearanceVideoError("decode_failed");
    }
    return webp;
  } catch (error) {
    if (error instanceof AppearanceVideoError) throw error;
    throw new AppearanceVideoError("decode_failed");
  }
}

async function posterFromOptionalImage(poster: { bytes: Buffer; filename: string }): Promise<Buffer> {
  let normalized;
  try {
    normalized = await normalizeAppearanceImage(poster);
  } catch (error) {
    if (error instanceof AppearanceImageError) {
      if (error.code === "file_too_large") throw new AppearanceVideoError("file_too_large");
      if (error.code === "processing_busy") throw new AppearanceVideoError("processing_busy");
      if (error.code === "unsupported_media" || error.code === "animated_image") {
        throw new AppearanceVideoError("unsupported_media");
      }
      throw new AppearanceVideoError("decode_failed");
    }
    throw new AppearanceVideoError("decode_failed");
  }
  try {
    // Re-encode the image pipeline full asset into the thumbnail budget so video
    // posters share one size contract with image thumbs.
    const full = await readFile(normalized.assets.fullPath);
    return await frameToOwnedWebp(full);
  } finally {
    await discardNormalizedAppearanceImage(normalized.assets);
  }
}

/**
 * Validate a local MP4 upload and stage `<id>.mp4` + metadata-free poster WebP.
 *
 * @param input.bytes Original MP4 bytes (not re-encoded).
 * @param input.filename Display-only source name; never used as a storage path.
 * @param input.poster Optional strategy-B poster image (JPEG/PNG/static WebP).
 *                     When ffmpeg frame extract fails and no poster is supplied,
 *                     the call fails with `decode_failed` (or `poster_required`
 *                     only if extract is disabled by the caller pattern).
 */
export async function normalizeAppearanceVideo(input: {
  bytes: Buffer;
  filename: string;
  poster?: { bytes: Buffer; filename: string };
}): Promise<NormalizedAppearanceVideo> {
  const meta = inspectAppearanceMp4(input.bytes);

  return withProcessingSlot(async () => {
    let posterWebp: Buffer;
    if (input.poster) {
      posterWebp = await posterFromOptionalImage(input.poster);
    } else {
      try {
        const frame = await extractPosterFrame(input.bytes);
        posterWebp = await frameToOwnedWebp(frame);
      } catch (error) {
        if (error instanceof AppearanceVideoError) throw error;
        throw new AppearanceVideoError("decode_failed");
      }
    }

    const dir = getAppearanceTemporaryDirectoryForServer();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
    const suffix = randomUUID();
    const assets: StagedAppearanceAssets = {
      fullPath: join(dir, `.appearance-${suffix}.mp4`),
      thumbnailPath: join(dir, `.appearance-${suffix}.thumb.webp`),
    };

    try {
      // Store original validated bytes; P0 never re-encodes the video stream.
      await writePrivateFile(assets.fullPath, input.bytes);
      await writePrivateFile(assets.thumbnailPath, posterWebp);
      return {
        assets,
        width: meta.width,
        height: meta.height,
        bytes: input.bytes.length,
        thumbnailBytes: posterWebp.length,
        durationMs: meta.durationMs,
        ...(sourceDisplayName(input.filename) ? { sourceName: sourceDisplayName(input.filename) } : {}),
      };
    } catch {
      await discardNormalizedAppearanceVideo(assets);
      throw new AppearanceVideoError("decode_failed");
    }
  });
}

/**
 * Strategy-B helper: require an explicit poster image when callers choose not to
 * rely on ffmpeg. Useful for API branches that freeze dual-file upload.
 */
export async function normalizeAppearanceVideoWithRequiredPoster(input: {
  bytes: Buffer;
  filename: string;
  poster: { bytes: Buffer; filename: string } | undefined;
}): Promise<NormalizedAppearanceVideo> {
  if (!input.poster || input.poster.bytes.length === 0) {
    throw new AppearanceVideoError("poster_required");
  }
  return normalizeAppearanceVideo({
    bytes: input.bytes,
    filename: input.filename,
    poster: input.poster,
  });
}

export async function discardNormalizedAppearanceVideo(assets: StagedAppearanceAssets): Promise<void> {
  await Promise.all([rm(assets.fullPath, { force: true }), rm(assets.thumbnailPath, { force: true })]);
}
