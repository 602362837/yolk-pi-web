import crypto from "crypto";
import fs from "fs";
import path from "path";

const DIRECTORY_CREATE_ATTEMPTS = 8;
const FILE_CREATE_ATTEMPTS = 8;

export interface PersistFileUploadInput {
  uploadsRoot: string;
  originalName: string;
  bytes: Buffer;
}

export interface PersistedFileUpload {
  path: string;
  uploadDirectory: string;
}

export interface UploadCleanupOptions {
  retentionMs: number;
  maxTotalBytes: number;
}

interface FileRecord {
  filePath: string;
  dirPath: string;
  size: number;
  mtimeMs: number;
}

/** Only retain a harmless terminal extension; the client basename is never persisted. */
export function safeUploadExtension(originalName: string): string {
  const match = /\.([a-zA-Z0-9]{1,16})$/.exec(originalName);
  return match ? `.${match[1].toLowerCase()}` : "";
}

export function isStrictPathChild(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

function ensureUploadsRoot(uploadsRoot: string): string {
  fs.mkdirSync(uploadsRoot, { recursive: true, mode: 0o700 });
  const rootStat = fs.lstatSync(uploadsRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Invalid upload storage root");
  }
  fs.chmodSync(uploadsRoot, 0o700);
  return path.resolve(uploadsRoot);
}

function createUploadDirectory(uploadsRoot: string): string {
  for (let attempt = 0; attempt < DIRECTORY_CREATE_ATTEMPTS; attempt++) {
    const directory = path.resolve(uploadsRoot, crypto.randomUUID());
    if (!isStrictPathChild(uploadsRoot, directory)) throw new Error("Invalid upload directory");
    try {
      fs.mkdirSync(directory, { mode: 0o700 });
      return directory;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error("Unable to allocate upload directory");
}

export function persistFileUpload(input: PersistFileUploadInput): PersistedFileUpload {
  const uploadsRoot = ensureUploadsRoot(input.uploadsRoot);
  const uploadDirectory = createUploadDirectory(uploadsRoot);
  const extension = safeUploadExtension(input.originalName);

  try {
    for (let attempt = 0; attempt < FILE_CREATE_ATTEMPTS; attempt++) {
      const targetPath = path.resolve(uploadDirectory, `${crypto.randomUUID()}${extension}`);
      if (!isStrictPathChild(uploadDirectory, targetPath)) throw new Error("Invalid upload target");

      try {
        const descriptor = fs.openSync(targetPath, "wx", 0o600);
        try {
          fs.writeFileSync(descriptor, input.bytes);
        } finally {
          fs.closeSync(descriptor);
        }
        return { path: targetPath, uploadDirectory };
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
  } catch (error) {
    // Do not retain an empty failed upload directory.
    tryRemoveEmptyDirectory(uploadDirectory);
    throw error;
  }

  tryRemoveEmptyDirectory(uploadDirectory);
  throw new Error("Unable to allocate upload file");
}

function tryRemoveEmptyDirectory(directory: string): void {
  try {
    const stat = fs.lstatSync(directory);
    if (stat.isDirectory() && !stat.isSymbolicLink() && fs.readdirSync(directory).length === 0) {
      fs.rmdirSync(directory);
    }
  } catch {
    // Cleanup is best effort only.
  }
}

/**
 * Cleanup intentionally uses lstat and only handles direct, real upload directories.
 * This keeps a locally-created symlink from making retention follow outside uploadsRoot.
 */
export function lazyCleanupUploads(uploadsRoot: string, options: UploadCleanupOptions): void {
  let root: string;
  try {
    root = ensureUploadsRoot(uploadsRoot);
  } catch {
    return;
  }

  const now = Date.now();
  const allFiles: FileRecord[] = [];
  let totalSize = 0;

  for (const directoryName of fs.readdirSync(root)) {
    const directory = path.resolve(root, directoryName);
    if (!isStrictPathChild(root, directory)) continue;
    try {
      const directoryStat = fs.lstatSync(directory);
      if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) continue;
      for (const fileName of fs.readdirSync(directory)) {
        const filePath = path.resolve(directory, fileName);
        if (!isStrictPathChild(directory, filePath)) continue;
        try {
          const fileStat = fs.lstatSync(filePath);
          if (!fileStat.isFile() || fileStat.isSymbolicLink()) continue;
          totalSize += fileStat.size;
          allFiles.push({ filePath, dirPath: directory, size: fileStat.size, mtimeMs: fileStat.mtimeMs });
        } catch {
          // A concurrent cleanup/write may have removed this entry.
        }
      }
    } catch {
      // A concurrent cleanup/write may have removed this directory.
    }
  }

  let freed = 0;
  const retained: FileRecord[] = [];
  for (const file of allFiles) {
    if (now - file.mtimeMs > options.retentionMs) {
      try {
        fs.unlinkSync(file.filePath);
        freed += file.size;
        tryRemoveEmptyDirectory(file.dirPath);
      } catch {
        // Best effort cleanup must never affect the upload result.
      }
    } else {
      retained.push(file);
    }
  }

  let excess = totalSize - freed - options.maxTotalBytes;
  if (excess <= 0) return;
  retained.sort((a, b) => a.mtimeMs - b.mtimeMs);
  for (const file of retained) {
    if (excess <= 0) break;
    try {
      fs.unlinkSync(file.filePath);
      excess -= file.size;
      tryRemoveEmptyDirectory(file.dirPath);
    } catch {
      // Best effort cleanup must never affect the upload result.
    }
  }
}
