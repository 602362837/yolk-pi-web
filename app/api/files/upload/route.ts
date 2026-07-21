import { NextRequest, NextResponse } from "next/server";
import os from "os";
import path from "path";
import { lazyCleanupUploads, persistFileUpload } from "@/lib/file-upload-storage";

const UPLOAD_DIR = path.join(os.homedir(), ".pi", "agent", "uploads");
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_TOTAL_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * POST /api/files/upload
 * Accepts multipart/form-data with a "file" field.
 * Returns { name, path, size } where name is display metadata and path is server-generated storage.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fileField = formData.get("file");

    if (!fileField || !(fileField instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const file = fileField as File;
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    lazyCleanupUploads(UPLOAD_DIR, { retentionMs: RETENTION_MS, maxTotalBytes: MAX_TOTAL_BYTES });
    const persisted = persistFileUpload({
      uploadsRoot: UPLOAD_DIR,
      originalName: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });

    return NextResponse.json({ name: file.name, path: persisted.path, size: file.size });
  } catch {
    console.error("File upload failed");
    return NextResponse.json({ error: "File upload failed", code: "upload_failed" }, { status: 500 });
  }
}
