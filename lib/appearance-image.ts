/** Server-only bounded image decoding and normalization for appearance skins. */

import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

import {
  APPEARANCE_MAX_LONG_EDGE,
  APPEARANCE_MAX_PIXELS,
  APPEARANCE_MAX_UPLOAD_BYTES,
  APPEARANCE_THUMBNAIL_MAX_EDGE,
  sanitizeAppearanceName,
} from "./appearance-types";
import { getAppearanceTemporaryDirectoryForServer, type StagedAppearanceAssets } from "./appearance-store";

const FILE_MODE = 0o600;
const MAX_CONCURRENT_PROCESSING = 2;
let activeProcessing = 0;

export type AppearanceImageErrorCode =
  | "unsupported_media"
  | "animated_image"
  | "file_too_large"
  | "pixel_limit"
  | "decode_failed"
  | "processing_busy";

export class AppearanceImageError extends Error {
  readonly code: AppearanceImageErrorCode;

  constructor(code: AppearanceImageErrorCode) {
    super("Image processing failed");
    this.code = code;
    this.name = "AppearanceImageError";
  }
}

export interface NormalizedAppearanceImage {
  assets: StagedAppearanceAssets;
  width: number;
  height: number;
  bytes: number;
  thumbnailBytes: number;
  sourceName?: string;
}

function hasAllowedSignature(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const webp = bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  return jpeg || png || webp;
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
  if (activeProcessing >= MAX_CONCURRENT_PROCESSING) throw new AppearanceImageError("processing_busy");
  activeProcessing += 1;
  try {
    return await fn();
  } finally {
    activeProcessing -= 1;
  }
}

function sourceDisplayName(filename: string): string | undefined {
  const base = filename.replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "");
  return sanitizeAppearanceName(base) ?? undefined;
}

/**
 * Decode only locally supplied JPEG/PNG/static WebP, then emit metadata-free
 * WebP files into the store-owned staging directory. Source bytes never reach
 * the catalog or a durable path.
 */
export async function normalizeAppearanceImage(input: { bytes: Buffer; filename: string }): Promise<NormalizedAppearanceImage> {
  if (input.bytes.length === 0 || input.bytes.length > APPEARANCE_MAX_UPLOAD_BYTES) {
    throw new AppearanceImageError("file_too_large");
  }
  if (!hasAllowedSignature(input.bytes)) throw new AppearanceImageError("unsupported_media");

  return withProcessingSlot(async () => {
    let metadata: sharp.Metadata;
    try {
      metadata = await sharp(input.bytes, { animated: false, limitInputPixels: APPEARANCE_MAX_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new AppearanceImageError("decode_failed");
    }

    if (metadata.format !== "jpeg" && metadata.format !== "png" && metadata.format !== "webp") {
      throw new AppearanceImageError("unsupported_media");
    }
    if ((metadata.pages ?? 1) > 1 || metadata.pageHeight !== undefined) throw new AppearanceImageError("animated_image");
    if (!metadata.width || !metadata.height) throw new AppearanceImageError("decode_failed");
    if (metadata.width * metadata.height > APPEARANCE_MAX_PIXELS) throw new AppearanceImageError("pixel_limit");

    let full: Buffer;
    let thumbnail: Buffer;
    try {
      const base = sharp(input.bytes, { animated: false, limitInputPixels: APPEARANCE_MAX_PIXELS, failOn: "error" }).rotate();
      full = await base.clone()
        .resize({ width: APPEARANCE_MAX_LONG_EDGE, height: APPEARANCE_MAX_LONG_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 84 })
        .toBuffer();
      thumbnail = await base
        .resize({ width: APPEARANCE_THUMBNAIL_MAX_EDGE, height: APPEARANCE_THUMBNAIL_MAX_EDGE, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
    } catch {
      throw new AppearanceImageError("decode_failed");
    }

    let outputMetadata: sharp.Metadata;
    try {
      outputMetadata = await sharp(full, { animated: false, limitInputPixels: APPEARANCE_MAX_PIXELS, failOn: "error" }).metadata();
    } catch {
      throw new AppearanceImageError("decode_failed");
    }
    if (outputMetadata.format !== "webp" || !outputMetadata.width || !outputMetadata.height || outputMetadata.width > APPEARANCE_MAX_LONG_EDGE || outputMetadata.height > APPEARANCE_MAX_LONG_EDGE) {
      throw new AppearanceImageError("decode_failed");
    }

    const dir = getAppearanceTemporaryDirectoryForServer();
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700).catch(() => {});
    const suffix = randomUUID();
    const assets = {
      fullPath: join(dir, `.appearance-${suffix}.webp`),
      thumbnailPath: join(dir, `.appearance-${suffix}.thumb.webp`),
    };
    try {
      await writePrivateFile(assets.fullPath, full);
      await writePrivateFile(assets.thumbnailPath, thumbnail);
      return {
        assets,
        width: outputMetadata.width,
        height: outputMetadata.height,
        bytes: full.length,
        thumbnailBytes: thumbnail.length,
        ...(sourceDisplayName(input.filename) ? { sourceName: sourceDisplayName(input.filename) } : {}),
      };
    } catch {
      await discardNormalizedAppearanceImage(assets);
      throw new AppearanceImageError("decode_failed");
    }
  });
}

export async function discardNormalizedAppearanceImage(assets: StagedAppearanceAssets): Promise<void> {
  await Promise.all([rm(assets.fullPath, { force: true }), rm(assets.thumbnailPath, { force: true })]);
}
