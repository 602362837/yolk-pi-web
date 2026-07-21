import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { NextResponse } from "next/server";
import { Readable } from "node:stream";

import { getAppearanceSkinAssetPathForServer, readAppearanceCatalog } from "@/lib/appearance-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }>; }

const BASE_HEADERS = {
  "Cache-Control": "private, max-age=31536000, immutable",
  "X-Content-Type-Options": "nosniff",
} as const;

const NOT_FOUND = {
  error: "The requested asset was not found",
  code: "not_found",
} as const;

function notFoundResponse() {
  return NextResponse.json(NOT_FOUND, { status: 404, headers: { "Cache-Control": "no-store" } });
}

function contentTypeFor(kind: "image" | "video", variant: "full" | "thumbnail"): string {
  if (variant === "thumbnail" || kind === "image") return "image/webp";
  return "video/mp4";
}

function nodeStreamToWeb(stream: ReturnType<typeof createReadStream>): ReadableStream<Uint8Array> {
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

function parseByteRange(header: string | null, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return "invalid";
  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : size - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    return "invalid";
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const variant = new URL(request.url).searchParams.get("variant");
    if (variant !== "full" && variant !== "thumbnail") return notFoundResponse();

    const catalog = await readAppearanceCatalog();
    // Fail closed on a malformed catalog: never serve assets from an untrusted index.
    const skin = catalog.warnings ? null : catalog.index.skins.find((item) => item.id === id) ?? null;
    if (!skin) return notFoundResponse();

    const path = getAppearanceSkinAssetPathForServer(id, variant, skin.kind);
    if (!path) return notFoundResponse();

    const fileStat = await stat(path);
    if (!fileStat.isFile()) return notFoundResponse();

    const contentType = contentTypeFor(skin.kind, variant);
    // Prefer a stable ETag derived from size+mtime so large videos avoid full reads on 304.
    const etag = `"${createHash("sha256").update(`${fileStat.size}:${fileStat.mtimeMs}`).digest("hex").slice(0, 24)}"`;
    const common = {
      ...BASE_HEADERS,
      "Content-Type": contentType,
      ETag: etag,
      "Accept-Ranges": "bytes" as const,
    };

    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, { status: 304, headers: common });
    }

    // Thumbnails and image full assets stay small; keep the simple whole-body path.
    const useRange = skin.kind === "video" && variant === "full";
    if (!useRange) {
      const bytes = await readFile(path);
      // Keep content-hash ETag for small assets so existing clients remain stable.
      const bodyEtag = `"${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}"`;
      const headers = { ...common, ETag: bodyEtag, "Content-Length": String(bytes.length) };
      if (request.headers.get("if-none-match") === bodyEtag) {
        return new NextResponse(null, { status: 304, headers });
      }
      return new NextResponse(bytes, { headers });
    }

    const range = parseByteRange(request.headers.get("range"), fileStat.size);
    if (range === "invalid") {
      return new NextResponse(null, {
        status: 416,
        headers: {
          ...common,
          "Content-Range": `bytes */${fileStat.size}`,
        },
      });
    }

    if (range) {
      const { start, end } = range;
      const chunkSize = end - start + 1;
      const stream = createReadStream(path, { start, end });
      return new NextResponse(nodeStreamToWeb(stream), {
        status: 206,
        headers: {
          ...common,
          "Content-Length": String(chunkSize),
          "Content-Range": `bytes ${start}-${end}/${fileStat.size}`,
        },
      });
    }

    const stream = createReadStream(path);
    return new NextResponse(nodeStreamToWeb(stream), {
      headers: {
        ...common,
        "Content-Length": String(fileStat.size),
      },
    });
  } catch {
    return notFoundResponse();
  }
}
