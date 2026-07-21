import { NextResponse } from "next/server";

import {
  AppearanceImageError,
  discardNormalizedAppearanceImage,
  normalizeAppearanceImage,
} from "@/lib/appearance-image";
import {
  createAppearanceSkin,
  createAppearanceSkinId,
  AppearanceStoreError,
  projectAppearanceCatalog,
  type StagedAppearanceAssets,
} from "@/lib/appearance-store";
import {
  APPEARANCE_MAX_UPLOAD_BYTES,
  APPEARANCE_MAX_VIDEO_UPLOAD_BYTES,
  APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES,
  DEFAULT_APPEARANCE_PRESENTATION,
  sanitizeAppearanceName,
} from "@/lib/appearance-types";
import {
  AppearanceVideoError,
  discardNormalizedAppearanceVideo,
  hasMp4FtypSignature,
  normalizeAppearanceVideo,
} from "@/lib/appearance-video";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" } as const;
const ALLOWED_FORM_KEYS = new Set(["file", "name", "revision", "poster", "confirmOversize"]);
/** Multipart envelope overhead above the largest accepted media body. */
const MULTIPART_ENVELOPE_SLACK = 256 * 1024;
const MAX_REQUEST_BYTES = Math.max(APPEARANCE_MAX_UPLOAD_BYTES, APPEARANCE_MAX_VIDEO_UPLOAD_BYTES) + MULTIPART_ENVELOPE_SLACK;

type MediaBranch = "image" | "video";

function errorResponse(error: unknown) {
  if (error instanceof AppearanceImageError) {
    const status = error.code === "file_too_large" ? 413 : error.code === "processing_busy" ? 429 : 422;
    return NextResponse.json({ error: "The media could not be processed", code: error.code }, { status, headers: NO_STORE });
  }
  if (error instanceof AppearanceVideoError) {
    const status =
      error.code === "file_too_large" || error.code === "oversize_confirmation_required" ? 413 :
      error.code === "processing_busy" ? 429 :
      error.code === "poster_required" ? 400 :
      422;
    return NextResponse.json({ error: "The media could not be processed", code: error.code }, { status, headers: NO_STORE });
  }
  if (error instanceof AppearanceStoreError) {
    const status =
      error.code === "revision_conflict" ? 409 :
      error.code === "catalog_limit" || error.code === "storage_limit" ? 413 :
      500;
    return NextResponse.json({ error: "The appearance catalog could not be updated", code: error.code }, { status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "The media could not be processed", code: "storage_error" }, { status: 500, headers: NO_STORE });
}

function parseRevision(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value) ? value : null;
}

function hasImageSignature(bytes: Buffer): boolean {
  if (bytes.length < 12) return false;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"));
  const webp = bytes.subarray(0, 4).equals(Buffer.from("RIFF")) && bytes.subarray(8, 12).equals(Buffer.from("WEBP"));
  return jpeg || png || webp;
}

/** Branch only on sniffed content; never trust filename or Content-Type. */
function sniffMediaBranch(bytes: Buffer): MediaBranch | null {
  if (hasImageSignature(bytes)) return "image";
  if (hasMp4FtypSignature(bytes)) return "video";
  return null;
}

function isFileEntry(value: FormDataEntryValue | null): value is File {
  return typeof File !== "undefined" && value instanceof File;
}

export async function POST(request: Request) {
  let stagedAssets: StagedAppearanceAssets | undefined;
  let stagedKind: MediaBranch | undefined;
  try {
    const contentLength = Number(request.headers.get("content-length"));
    // Reject obviously oversized multipart envelopes before buffering the body.
    if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: "The media is too large", code: "file_too_large" }, { status: 413, headers: NO_STORE });
    }

    const form = await request.formData();
    const keys = [...form.keys()];
    if (keys.some((key) => !ALLOWED_FORM_KEYS.has(key)) || keys.filter((key) => key === "file").length !== 1) {
      return NextResponse.json({ error: "Only one media file is accepted", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    if (keys.filter((key) => key === "poster").length > 1) {
      return NextResponse.json({ error: "Only one optional poster file is accepted", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }

    const file = form.get("file");
    const posterEntry = form.get("poster");
    const expectedRevision = parseRevision(form.get("revision"));
    const requestedName = form.get("name");
    const confirmOversize = form.get("confirmOversize") === "true";
    if (!isFileEntry(file) || !expectedRevision || (requestedName !== null && typeof requestedName !== "string")) {
      return NextResponse.json({ error: "A file and revision are required", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }
    if (posterEntry !== null && !isFileEntry(posterEntry)) {
      return NextResponse.json({ error: "Poster must be an image file", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }

    const name = requestedName === null ? undefined : sanitizeAppearanceName(requestedName);
    if (requestedName !== null && !name) {
      return NextResponse.json({ error: "The skin name is invalid", code: "invalid_request" }, { status: 400, headers: NO_STORE });
    }

    if (file.size === 0) {
      return NextResponse.json({ error: "The media could not be processed", code: "unsupported_media" }, { status: 422, headers: NO_STORE });
    }
    // Hard ceiling before reading bytes; kind-specific caps apply after sniffing.
    if (file.size > Math.max(APPEARANCE_MAX_UPLOAD_BYTES, APPEARANCE_MAX_VIDEO_UPLOAD_BYTES)) {
      return NextResponse.json({ error: "The media is too large", code: "file_too_large" }, { status: 413, headers: NO_STORE });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const branch = sniffMediaBranch(bytes);
    if (!branch) {
      return NextResponse.json({ error: "The media could not be processed", code: "unsupported_media" }, { status: 422, headers: NO_STORE });
    }

    if (branch === "image") {
      if (posterEntry) {
        return NextResponse.json({ error: "Poster is only accepted for video uploads", code: "invalid_request" }, { status: 400, headers: NO_STORE });
      }
      if (bytes.length > APPEARANCE_MAX_UPLOAD_BYTES) {
        throw new AppearanceImageError("file_too_large");
      }
      const staged = await normalizeAppearanceImage({ bytes, filename: file.name });
      stagedAssets = staged.assets;
      stagedKind = "image";
      const now = new Date().toISOString();
      const result = await createAppearanceSkin({
        expectedRevision,
        activate: true,
        stagedAssets: staged.assets,
        skin: {
          id: createAppearanceSkinId(),
          name: name ?? staged.sourceName ?? "Untitled skin",
          kind: "image",
          sourceName: staged.sourceName,
          createdAt: now,
          updatedAt: now,
          asset: {
            mimeType: "image/webp",
            width: staged.width,
            height: staged.height,
            bytes: staged.bytes,
            thumbnailBytes: staged.thumbnailBytes,
          },
          presentation: { ...DEFAULT_APPEARANCE_PRESENTATION },
        },
      });
      stagedAssets = undefined;
      return NextResponse.json(projectAppearanceCatalog(result), { status: 201, headers: NO_STORE });
    }

    // Video branch: sizes above the recommended threshold require an explicit user confirmation;
    // the larger hard ceiling remains a server-side safety boundary.
    if (bytes.length > APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES && !confirmOversize) {
      return NextResponse.json({ error: "The video requires confirmation because it is larger than recommended", code: "oversize_confirmation_required" }, { status: 413, headers: NO_STORE });
    }
    // Optional strategy-B poster field; pipeline prefers ffmpeg when poster is omitted.
    if (bytes.length > APPEARANCE_MAX_VIDEO_UPLOAD_BYTES) {
      throw new AppearanceVideoError("file_too_large");
    }
    let posterInput: { bytes: Buffer; filename: string } | undefined;
    if (posterEntry) {
      if (posterEntry.size === 0 || posterEntry.size > APPEARANCE_MAX_UPLOAD_BYTES) {
        throw new AppearanceVideoError("file_too_large");
      }
      posterInput = { bytes: Buffer.from(await posterEntry.arrayBuffer()), filename: posterEntry.name };
    }
    const staged = await normalizeAppearanceVideo({
      bytes,
      filename: file.name,
      ...(posterInput ? { poster: posterInput } : {}),
    });
    stagedAssets = staged.assets;
    stagedKind = "video";
    const now = new Date().toISOString();
    const result = await createAppearanceSkin({
      expectedRevision,
      activate: true,
      stagedAssets: staged.assets,
      skin: {
        id: createAppearanceSkinId(),
        name: name ?? staged.sourceName ?? "Untitled skin",
        kind: "video",
        sourceName: staged.sourceName,
        createdAt: now,
        updatedAt: now,
        asset: {
          mimeType: "video/mp4",
          width: staged.width,
          height: staged.height,
          bytes: staged.bytes,
          thumbnailBytes: staged.thumbnailBytes,
          durationMs: staged.durationMs,
        },
        presentation: { ...DEFAULT_APPEARANCE_PRESENTATION },
      },
    });
    stagedAssets = undefined;
    return NextResponse.json(projectAppearanceCatalog(result), { status: 201, headers: NO_STORE });
  } catch (error) {
    return errorResponse(error);
  } finally {
    if (stagedAssets) {
      if (stagedKind === "video") await discardNormalizedAppearanceVideo(stagedAssets);
      else await discardNormalizedAppearanceImage(stagedAssets);
    }
  }
}
