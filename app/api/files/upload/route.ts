import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";

const UPLOAD_DIR = path.join(os.homedir(), ".pi", "agent", "uploads");
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const MAX_TOTAL_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure upload directory exists
function ensureUploadDir(): string {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }
  return UPLOAD_DIR;
}

// Generate a unique storage ID for each upload session
function generateUploadId(): string {
  return crypto.randomUUID().slice(0, 8);
}

interface FileRecord {
  filePath: string;
  dirPath: string;
  size: number;
  mtimeMs: number;
}

/**
 * Lazy cleanup: scan uploads dir, delete files older than 7 days,
 * then if total size still exceeds 1 GB, delete oldest files until under limit.
 * Cleans up empty subdirectories after deletion.
 */
function lazyCleanup(): void {
  if (!fs.existsSync(UPLOAD_DIR)) return;

  const now = Date.now();
  const allFiles: FileRecord[] = [];
  let totalSize = 0;

  // Collect all files recursively under UPLOAD_DIR
  for (const dirEntry of fs.readdirSync(UPLOAD_DIR)) {
    const dirPath = path.join(UPLOAD_DIR, dirEntry);
    const dirStat = fs.statSync(dirPath);
    if (!dirStat.isDirectory()) continue; // skip stray files

    for (const fileEntry of fs.readdirSync(dirPath)) {
      const filePath = path.join(dirPath, fileEntry);
      try {
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        totalSize += stat.size;
        allFiles.push({ filePath, dirPath, size: stat.size, mtimeMs: stat.mtimeMs });
      } catch {
        // race — file vanished, ignore
      }
    }
  }

  // Phase 1: delete files older than 7 days
  let freed = 0;
  const kept: FileRecord[] = [];
  for (const rec of allFiles) {
    if (now - rec.mtimeMs > RETENTION_MS) {
      try {
        fs.unlinkSync(rec.filePath);
        freed += rec.size;
        deleteEmptyDir(rec.dirPath);
      } catch {
        // ignore
      }
    } else {
      kept.push(rec);
    }
  }

  // Phase 2: if still over 1 GB, delete oldest files
  if (totalSize - freed > MAX_TOTAL_BYTES) {
    kept.sort((a, b) => a.mtimeMs - b.mtimeMs); // oldest first
    let over = totalSize - freed - MAX_TOTAL_BYTES;
    for (const rec of kept) {
      if (over <= 0) break;
      try {
        fs.unlinkSync(rec.filePath);
        over -= rec.size;
        deleteEmptyDir(rec.dirPath);
      } catch {
        // ignore
      }
    }
  }
}

/** Remove a directory if it's empty (only called after deleting a file within). */
function deleteEmptyDir(dirPath: string): void {
  try {
    const remaining = fs.readdirSync(dirPath);
    if (remaining.length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {
    // ignore
  }
}

/**
 * POST /api/files/upload
 * Accepts multipart/form-data with a "file" field.
 * Runs lazy cleanup before saving.
 * Returns { name, path, size } where path is the absolute path to the saved file.
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fileField = formData.get("file");

    if (!fileField || !(fileField instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const file = fileField as File;
    const originalName = file.name;

    // Validate file size
    if (file.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `File too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB)` },
        { status: 413 }
      );
    }

    // Lazy cleanup before writing new file
    lazyCleanup();

    // Ensure upload dir exists
    const baseDir = ensureUploadDir();
    const uploadId = generateUploadId();
    const targetDir = path.join(baseDir, uploadId);
    fs.mkdirSync(targetDir, { recursive: true });

    // Handle filename collisions
    let targetPath = path.join(targetDir, originalName);
    if (fs.existsSync(targetPath)) {
      const ext = path.extname(originalName);
      const base = path.basename(originalName, ext);
      let counter = 1;
      while (fs.existsSync(targetPath)) {
        targetPath = path.join(targetDir, `${base}_${counter}${ext}`);
        counter++;
      }
    }

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(targetPath, buffer);

    return NextResponse.json({
      name: originalName,
      path: targetPath,
      size: file.size,
    });
  } catch (error) {
    console.error("File upload failed:", error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
