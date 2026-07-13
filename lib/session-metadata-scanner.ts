/**
 * Bounded streaming scanner for session JSONL inventory metadata.
 *
 * Reads files by chunk and extracts only list-relevant fields. It never builds
 * allMessages / allMessagesText and does not JSON.parse whole lines or read
 * entire files into memory. Large message content is skipped after a fixed
 * character budget so retained metadata stays O(sessions × bounded fields).
 */

import { createReadStream, existsSync } from "fs";
import { readdir, stat } from "fs/promises";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** List-path session metadata without any aggregated message body fields. */
export interface LightweightSessionMetadata {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: Date;
  modified: Date;
  messageCount: number;
  /** Bounded first user-message text (see firstMessageMaxChars). */
  firstMessage: string;
}

export interface ScanSessionMetadataOptions {
  /** Max decoded characters retained for firstMessage (API bound). Default 100. */
  firstMessageMaxChars?: number;
  /**
   * Optional forced chunk size for the file reader (tests). When omitted the
   * stream uses the default highWaterMark. Does not change parse results.
   */
  readChunkSize?: number;
}

export interface ScanSessionInventoryOptions extends ScanSessionMetadataOptions {
  /** Session root directory. Defaults to `~/.pi/agent/sessions`. */
  rootDir?: string;
  /** Max concurrent file scans. Default 8. */
  concurrency?: number;
}

export interface ScanSessionFilesOptions extends ScanSessionMetadataOptions {
  concurrency?: number;
}

export const DEFAULT_FIRST_MESSAGE_MAX_CHARS = 100;
export const DEFAULT_SCAN_CONCURRENCY = 8;

const MAX_KEY_CHARS = 256;
const MAX_META_STRING_CHARS = 8 * 1024;
const MAX_NAME_CHARS = 512;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;

interface RecordScratch {
  type?: string;
  id?: string;
  cwd?: string;
  parentSession?: string;
  entryTimestamp?: string;
  name?: string;
  nameSeen: boolean;
  role?: string;
  messageTimestamp?: number;
  hasContent: boolean;
  contentText: string;
  contentBlocks: string[];
  currentBlockType?: string;
  currentBlockText?: string;
  /** True while the active value path is inside message.content as an array. */
  contentIsArray: boolean;
}

interface FileScratch {
  sawAnyRecord: boolean;
  headerOk: boolean;
  orphan: boolean;
  malformed: boolean;
  id?: string;
  cwd: string;
  parentSessionPath?: string;
  created?: Date;
  name?: string;
  messageCount: number;
  firstMessage: string;
  lastActivityTime?: number;
  headerTimeMs?: number;
}

type ObjectPhase = "key" | "colon" | "value" | "comma";
type ArrayPhase = "value" | "comma";

interface ObjectFrame {
  kind: "object";
  phase: ObjectPhase;
  /** Key of the property currently being parsed (set after key string ends). */
  activeKey?: string;
}

interface ArrayFrame {
  kind: "array";
  phase: ArrayPhase;
}

type Frame = ObjectFrame | ArrayFrame;

type ReadMode =
  | { type: "normal" }
  | { type: "key"; buf: string; escape: boolean; unicodeLeft: number; unicodeHex: string }
  | {
      type: "string";
      purpose: "capture" | "skip";
      field: string;
      buf: string;
      full: boolean;
      escape: boolean;
      unicodeLeft: number;
      unicodeHex: string;
      maxChars: number;
    }
  | { type: "number"; purpose: "capture" | "skip"; field: string; buf: string }
  | { type: "literal"; purpose: "skip"; remaining: string }
  | {
      type: "skip-container";
      depth: number;
      inString: boolean;
      escape: boolean;
      unicodeLeft: number;
    };

/**
 * Incremental JSONL object scanner: captures selected primitives and skips all
 * other values (including huge content strings) without retaining them.
 */
class SessionMetadataStreamParser {
  private readonly firstMessageMaxChars: number;
  private readonly file: FileScratch = {
    sawAnyRecord: false,
    headerOk: false,
    orphan: false,
    malformed: false,
    cwd: "",
    messageCount: 0,
    firstMessage: "",
  };

  private record: RecordScratch = this.newRecord();
  private stack: Frame[] = [];
  private mode: ReadMode = { type: "normal" };
  private inRecord = false;
  private recordBytes = 0;

  constructor(firstMessageMaxChars: number) {
    this.firstMessageMaxChars = Math.max(1, firstMessageMaxChars);
  }

  push(chunk: string): void {
    for (let i = 0; i < chunk.length; i++) {
      if (this.file.malformed || this.file.orphan) return;
      this.consume(chunk[i]!);
    }
  }

  end(): void {
    if (this.file.malformed || this.file.orphan) return;
    if (this.mode.type === "number" && this.mode.purpose === "capture") {
      this.finishNumber(this.mode.field, this.mode.buf);
      this.mode = { type: "normal" };
    }
    if (this.inRecord && !this.file.headerOk) this.file.malformed = true;
  }

  result(filePath: string, mtime: Date): LightweightSessionMetadata | null {
    if (this.file.malformed || this.file.orphan) return null;
    if (!this.file.headerOk || !this.file.id) return null;

    const modified =
      typeof this.file.lastActivityTime === "number" && this.file.lastActivityTime > 0
        ? new Date(this.file.lastActivityTime)
        : typeof this.file.headerTimeMs === "number" && !Number.isNaN(this.file.headerTimeMs)
          ? new Date(this.file.headerTimeMs)
          : mtime;

    const created =
      this.file.created && !Number.isNaN(this.file.created.getTime())
        ? this.file.created
        : mtime;

    return {
      path: filePath,
      id: this.file.id,
      cwd: this.file.cwd,
      name: this.file.name,
      parentSessionPath: this.file.parentSessionPath,
      created,
      modified,
      messageCount: this.file.messageCount,
      firstMessage: this.file.firstMessage || "(no messages)",
    };
  }

  private newRecord(): RecordScratch {
    return {
      nameSeen: false,
      hasContent: false,
      contentText: "",
      contentBlocks: [],
      contentIsArray: false,
    };
  }

  private pathKeys(): string[] {
    const keys: string[] = [];
    for (const frame of this.stack) {
      if (frame.kind === "object" && frame.activeKey !== undefined && frame.phase === "value") {
        keys.push(frame.activeKey);
      }
    }
    return keys;
  }

  private pathString(): string {
    return this.pathKeys().join(".");
  }

  private top(): Frame | undefined {
    return this.stack[this.stack.length - 1];
  }

  private consume(ch: string): void {
    if (!this.inRecord) {
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") return;
      if (ch !== "{") {
        this.file.malformed = true;
        return;
      }
      this.beginRecord();
      this.stack.push({ kind: "object", phase: "key" });
      return;
    }

    this.recordBytes++;
    if (this.recordBytes > MAX_RECORD_BYTES) {
      this.file.malformed = true;
      return;
    }

    switch (this.mode.type) {
      case "key":
        this.consumeKeyChar(ch);
        return;
      case "string":
        this.consumeStringChar(ch);
        return;
      case "number":
        this.consumeNumberChar(ch);
        return;
      case "literal":
        this.consumeLiteralChar(ch);
        return;
      case "skip-container":
        this.consumeSkipContainer(ch);
        return;
      default:
        break;
    }

    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") return;

    const top = this.top();
    if (!top) {
      this.file.malformed = true;
      return;
    }

    if (top.kind === "object") {
      this.consumeObject(top, ch);
      return;
    }
    this.consumeArray(top, ch);
  }

  private beginRecord(): void {
    this.inRecord = true;
    this.recordBytes = 0;
    this.record = this.newRecord();
    this.stack = [];
    this.mode = { type: "normal" };
  }

  private consumeObject(top: ObjectFrame, ch: string): void {
    switch (top.phase) {
      case "key":
        if (ch === "}") {
          this.closeObject();
          return;
        }
        if (ch === "\"") {
          this.mode = {
            type: "key",
            buf: "",
            escape: false,
            unicodeLeft: 0,
            unicodeHex: "",
          };
          return;
        }
        this.file.malformed = true;
        return;

      case "colon":
        if (ch === ":") {
          top.phase = "value";
          return;
        }
        this.file.malformed = true;
        return;

      case "value":
        this.startValue(ch);
        return;

      case "comma":
        if (ch === ",") {
          top.phase = "key";
          top.activeKey = undefined;
          return;
        }
        if (ch === "}") {
          this.closeObject();
          return;
        }
        this.file.malformed = true;
        return;
    }
  }

  private consumeArray(top: ArrayFrame, ch: string): void {
    switch (top.phase) {
      case "value":
        if (ch === "]") {
          this.closeArray();
          return;
        }
        this.startValue(ch);
        return;
      case "comma":
        if (ch === ",") {
          top.phase = "value";
          return;
        }
        if (ch === "]") {
          this.closeArray();
          return;
        }
        this.file.malformed = true;
        return;
    }
  }

  private startValue(ch: string): void {
    const path = this.pathString();
    const field = this.classifyField(path);

    if (ch === "{") {
      if (this.shouldEnterObject(path)) {
        this.stack.push({ kind: "object", phase: "key" });
        return;
      }
      this.mode = {
        type: "skip-container",
        depth: 1,
        inString: false,
        escape: false,
        unicodeLeft: 0,
      };
      return;
    }

    if (ch === "[") {
      if (path === "message.content") {
        this.record.hasContent = true;
        this.record.contentIsArray = true;
        this.record.contentBlocks = [];
        this.stack.push({ kind: "array", phase: "value" });
        return;
      }
      this.mode = {
        type: "skip-container",
        depth: 1,
        inString: false,
        escape: false,
        unicodeLeft: 0,
      };
      return;
    }

    if (ch === "\"") {
      if (field) {
        this.mode = {
          type: "string",
          purpose: "capture",
          field,
          buf: "",
          full: false,
          escape: false,
          unicodeLeft: 0,
          unicodeHex: "",
          maxChars: this.maxForField(field),
        };
        if (field === "content" || field === "blockText") this.record.hasContent = true;
        return;
      }
      this.mode = {
        type: "string",
        purpose: "skip",
        field: "",
        buf: "",
        full: true,
        escape: false,
        unicodeLeft: 0,
        unicodeHex: "",
        maxChars: 0,
      };
      return;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      if (field === "messageTimestamp") {
        this.mode = { type: "number", purpose: "capture", field, buf: ch };
        return;
      }
      this.mode = { type: "number", purpose: "skip", field: "", buf: ch };
      return;
    }

    if (ch === "t") {
      this.mode = { type: "literal", purpose: "skip", remaining: "rue" };
      return;
    }
    if (ch === "f") {
      this.mode = { type: "literal", purpose: "skip", remaining: "alse" };
      return;
    }
    if (ch === "n") {
      this.mode = { type: "literal", purpose: "skip", remaining: "ull" };
      return;
    }

    this.file.malformed = true;
  }

  private shouldEnterObject(path: string): boolean {
    // Root object is already entered. Nested objects we walk:
    // - message
    // - message.content[] elements (text blocks)
    if (path === "message") return true;
    if (path === "message.content" && this.record.contentIsArray) return true;
    // Empty path cannot happen for values; property path for nested under content array
    // when activeKey is undefined on array frame - path is still message.content
    if (this.record.contentIsArray && path === "message.content") return true;
    return false;
  }

  private classifyField(path: string): string | null {
    switch (path) {
      case "type":
        return "type";
      case "id":
        return "id";
      case "cwd":
        return "cwd";
      case "parentSession":
        return "parentSession";
      case "timestamp":
        return "entryTimestamp";
      case "name":
        return "name";
      case "message.role":
        return "role";
      case "message.timestamp":
        return "messageTimestamp";
      case "message.content":
        return "content";
      default:
        break;
    }
    // Content block fields: path is message.content.<key> while inside a block object.
    // Our pathKeys only includes object activeKeys in value phase; inside a block object
    // under content array, keys look like message.content.type / message.content.text
    // because the array frame contributes no key.
    if (this.record.contentIsArray) {
      if (path === "message.content.type") return "blockType";
      if (path === "message.content.text") return "blockText";
    }
    return null;
  }

  private maxForField(field: string): number {
    if (field === "content" || field === "blockText") return this.firstMessageMaxChars;
    if (field === "name") return MAX_NAME_CHARS;
    return MAX_META_STRING_CHARS;
  }

  private consumeKeyChar(ch: string): void {
    const mode = this.mode;
    if (mode.type !== "key") return;

    if (mode.unicodeLeft > 0) {
      mode.unicodeHex += ch;
      mode.unicodeLeft--;
      if (mode.unicodeLeft === 0) {
        const code = parseInt(mode.unicodeHex, 16);
        if (!Number.isNaN(code) && mode.buf.length < MAX_KEY_CHARS) {
          mode.buf += String.fromCharCode(code);
        }
        mode.unicodeHex = "";
      }
      return;
    }
    if (mode.escape) {
      mode.escape = false;
      if (ch === "u") {
        mode.unicodeLeft = 4;
        mode.unicodeHex = "";
        return;
      }
      if (mode.buf.length < MAX_KEY_CHARS) mode.buf += decodeSimpleEscape(ch);
      return;
    }
    if (ch === "\\") {
      mode.escape = true;
      return;
    }
    if (ch === "\"") {
      const top = this.top();
      if (!top || top.kind !== "object") {
        this.file.malformed = true;
        return;
      }
      top.activeKey = mode.buf;
      top.phase = "colon";
      this.mode = { type: "normal" };
      return;
    }
    if (mode.buf.length < MAX_KEY_CHARS) mode.buf += ch;
  }

  private consumeStringChar(ch: string): void {
    const mode = this.mode;
    if (mode.type !== "string") return;

    if (mode.unicodeLeft > 0) {
      mode.unicodeHex += ch;
      mode.unicodeLeft--;
      if (mode.unicodeLeft === 0) {
        const code = parseInt(mode.unicodeHex, 16);
        if (!Number.isNaN(code) && mode.purpose === "capture") {
          this.appendStringCapture(mode, String.fromCharCode(code));
        }
        mode.unicodeHex = "";
      }
      return;
    }
    if (mode.escape) {
      mode.escape = false;
      if (ch === "u") {
        mode.unicodeLeft = 4;
        mode.unicodeHex = "";
        return;
      }
      if (mode.purpose === "capture") this.appendStringCapture(mode, decodeSimpleEscape(ch));
      return;
    }
    if (ch === "\\") {
      mode.escape = true;
      return;
    }
    if (ch === "\"") {
      if (mode.purpose === "capture") this.applyCapturedString(mode.field, mode.buf);
      this.mode = { type: "normal" };
      this.finishValue();
      return;
    }
    if (mode.purpose === "capture") this.appendStringCapture(mode, ch);
  }

  private appendStringCapture(
    mode: Extract<ReadMode, { type: "string" }>,
    decoded: string,
  ): void {
    if (mode.full) return;
    if (mode.buf.length >= mode.maxChars) {
      mode.full = true;
      return;
    }
    const room = mode.maxChars - mode.buf.length;
    mode.buf += decoded.length > room ? decoded.slice(0, room) : decoded;
    if (mode.buf.length >= mode.maxChars) mode.full = true;
  }

  private applyCapturedString(field: string, value: string): void {
    switch (field) {
      case "type":
        this.record.type = value;
        break;
      case "id":
        this.record.id = value;
        break;
      case "cwd":
        this.record.cwd = value;
        break;
      case "parentSession":
        this.record.parentSession = value;
        break;
      case "entryTimestamp":
        this.record.entryTimestamp = value;
        break;
      case "name":
        this.record.name = value;
        this.record.nameSeen = true;
        break;
      case "role":
        this.record.role = value;
        break;
      case "content":
        this.record.contentText = value;
        this.record.hasContent = true;
        break;
      case "blockType":
        this.record.currentBlockType = value;
        break;
      case "blockText":
        this.record.currentBlockText = value;
        break;
      default:
        break;
    }
  }

  private consumeNumberChar(ch: string): void {
    const mode = this.mode;
    if (mode.type !== "number") return;

    if ((ch >= "0" && ch <= "9") || ch === "." || ch === "e" || ch === "E" || ch === "+" || ch === "-") {
      if (mode.purpose === "capture" && mode.buf.length < 64) mode.buf += ch;
      return;
    }

    if (mode.purpose === "capture") this.finishNumber(mode.field, mode.buf);
    this.mode = { type: "normal" };
    this.finishValue();
    this.consume(ch);
  }

  private finishNumber(field: string, buf: string): void {
    if (field === "messageTimestamp") {
      const n = Number(buf);
      if (!Number.isNaN(n)) this.record.messageTimestamp = n;
    }
  }

  private consumeLiteralChar(ch: string): void {
    const mode = this.mode;
    if (mode.type !== "literal") return;
    if (!mode.remaining.startsWith(ch)) {
      // Allow finishing early only when remaining is empty — otherwise malformed.
      this.file.malformed = true;
      return;
    }
    mode.remaining = mode.remaining.slice(1);
    if (mode.remaining.length === 0) {
      this.mode = { type: "normal" };
      this.finishValue();
    }
  }

  private consumeSkipContainer(ch: string): void {
    const mode = this.mode;
    if (mode.type !== "skip-container") return;

    if (mode.inString) {
      if (mode.unicodeLeft > 0) {
        mode.unicodeLeft--;
        return;
      }
      if (mode.escape) {
        mode.escape = false;
        if (ch === "u") mode.unicodeLeft = 4;
        return;
      }
      if (ch === "\\") {
        mode.escape = true;
        return;
      }
      if (ch === "\"") mode.inString = false;
      return;
    }

    if (ch === "\"") {
      mode.inString = true;
      return;
    }
    if (ch === "{" || ch === "[") {
      mode.depth++;
      return;
    }
    if (ch === "}" || ch === "]") {
      mode.depth--;
      if (mode.depth === 0) {
        this.mode = { type: "normal" };
        this.finishValue();
      }
    }
  }

  private finishValue(): void {
    const top = this.top();
    if (!top) return;

    if (top.kind === "object") {
      // Property value finished; clear active key from path and wait for comma/end.
      top.activeKey = undefined;
      top.phase = "comma";
      return;
    }
    // Array element finished.
    top.phase = "comma";
  }

  private closeObject(): void {
    const closed = this.stack.pop();
    if (!closed || closed.kind !== "object") {
      this.file.malformed = true;
      return;
    }

    // If this object was a content text block, fold it into contentBlocks.
    if (this.record.contentIsArray && this.pathString() === "message.content") {
      if (this.record.currentBlockType === "text") {
        this.record.contentBlocks.push(this.record.currentBlockText ?? "");
      }
      this.record.currentBlockType = undefined;
      this.record.currentBlockText = undefined;
    }

    if (this.stack.length === 0) {
      this.finishRecord();
      return;
    }

    this.finishValue();
  }

  private closeArray(): void {
    const closed = this.stack.pop();
    if (!closed || closed.kind !== "array") {
      this.file.malformed = true;
      return;
    }

    if (this.pathString() === "message.content") {
      // Join text blocks like SDK extractTextContent.
      const joined = this.record.contentBlocks.join(" ");
      this.record.contentText = joined.slice(0, this.firstMessageMaxChars);
      this.record.contentIsArray = false;
    }

    this.finishValue();
  }

  private finishRecord(): void {
    this.inRecord = false;
    this.stack = [];
    this.mode = { type: "normal" };

    const rec = this.record;
    if (!this.file.sawAnyRecord) {
      this.file.sawAnyRecord = true;
      if (rec.type !== "session" || !rec.id) {
        this.file.orphan = true;
        return;
      }
      this.file.headerOk = true;
      this.file.id = rec.id;
      this.file.cwd = typeof rec.cwd === "string" ? rec.cwd : "";
      this.file.parentSessionPath = rec.parentSession;
      if (rec.entryTimestamp) {
        const created = new Date(rec.entryTimestamp);
        this.file.created = created;
        const ms = created.getTime();
        if (!Number.isNaN(ms)) this.file.headerTimeMs = ms;
      }
      return;
    }

    if (!this.file.headerOk) return;

    if (rec.type === "session_info") {
      if (rec.nameSeen) {
        this.file.name = rec.name?.trim() || undefined;
      }
      return;
    }

    if (rec.type !== "message") return;

    this.file.messageCount++;

    const role = rec.role;
    if (rec.hasContent && (role === "user" || role === "assistant")) {
      let activity: number | undefined;
      if (typeof rec.messageTimestamp === "number") {
        activity = rec.messageTimestamp;
      } else if (rec.entryTimestamp) {
        const t = new Date(rec.entryTimestamp).getTime();
        if (!Number.isNaN(t)) activity = t;
      }
      if (typeof activity === "number") {
        this.file.lastActivityTime = Math.max(this.file.lastActivityTime ?? 0, activity);
      }
    }

    if (!this.file.firstMessage && role === "user" && rec.contentText) {
      this.file.firstMessage = rec.contentText.slice(0, this.firstMessageMaxChars);
    }
  }
}

function decodeSimpleEscape(ch: string): string {
  switch (ch) {
    case "n":
      return "\n";
    case "r":
      return "\r";
    case "t":
      return "\t";
    case "b":
      return "\b";
    case "f":
      return "\f";
    case "\"":
      return "\"";
    case "\\":
      return "\\";
    case "/":
      return "/";
    default:
      return ch;
  }
}

/**
 * Parse session metadata from pre-split UTF-8 string chunks (tests + custom streams).
 * Does not retain chunk contents beyond the parser's bounded capture buffers.
 */
export function scanSessionMetadataFromChunks(
  chunks: Iterable<string>,
  fileMeta: { path: string; mtime: Date },
  options: ScanSessionMetadataOptions = {},
): LightweightSessionMetadata | null {
  const maxChars = options.firstMessageMaxChars ?? DEFAULT_FIRST_MESSAGE_MAX_CHARS;
  const parser = new SessionMetadataStreamParser(maxChars);
  try {
    for (const chunk of chunks) parser.push(chunk);
    parser.end();
    return parser.result(fileMeta.path, fileMeta.mtime);
  } catch {
    return null;
  }
}

/**
 * Stream-scan a single session JSONL file for list metadata.
 * Returns null for orphan, malformed, or unreadable files.
 */
export async function scanSessionMetadata(
  filePath: string,
  options: ScanSessionMetadataOptions = {},
): Promise<LightweightSessionMetadata | null> {
  try {
    const st = await stat(filePath);
    if (!st.isFile()) return null;

    const maxChars = options.firstMessageMaxChars ?? DEFAULT_FIRST_MESSAGE_MAX_CHARS;
    const parser = new SessionMetadataStreamParser(maxChars);
    const decoder = new TextDecoder("utf8");
    const highWaterMark = options.readChunkSize && options.readChunkSize > 0
      ? options.readChunkSize
      : 64 * 1024;

    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath, { highWaterMark });
      stream.on("data", (buf: string | Buffer) => {
        try {
          const bytes = typeof buf === "string" ? Buffer.from(buf) : buf;
          parser.push(decoder.decode(bytes, { stream: true }));
        } catch (error) {
          stream.destroy();
          reject(error);
        }
      });
      stream.on("error", reject);
      stream.on("end", () => {
        try {
          parser.push(decoder.decode());
          parser.end();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });

    return parser.result(filePath, st.mtime);
  } catch {
    return null;
  }
}

/**
 * Scan an explicit list of session files with fixed concurrency.
 * Null results (malformed/orphan) are omitted; sorted by modified desc.
 */
export async function scanSessionFiles(
  files: string[],
  options: ScanSessionFilesOptions = {},
): Promise<LightweightSessionMetadata[]> {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_SCAN_CONCURRENCY);
  const results = await mapWithConcurrency(files, concurrency, (file) =>
    scanSessionMetadata(file, options),
  );
  const sessions = results.filter((item): item is LightweightSessionMetadata => item !== null);
  sessions.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  return sessions;
}

/**
 * Enumerate session JSONL files under rootDir (nested cwd dirs or flat).
 * Mirrors SDK listAll directory layout: sessions/<encoded-cwd>/<file>.jsonl.
 */
export async function scanSessionInventory(
  options: ScanSessionInventoryOptions = {},
): Promise<LightweightSessionMetadata[]> {
  const rootDir = options.rootDir ?? join(getAgentDir(), "sessions");
  if (!existsSync(rootDir)) return [];

  const files = await enumerateSessionJsonlFiles(rootDir);
  return scanSessionFiles(files, options);
}

async function enumerateSessionJsonlFiles(rootDir: string): Promise<string[]> {
  const files: string[] = [];
  let entries;
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const dir = join(rootDir, entry.name);
      try {
        const nested = await readdir(dir);
        for (const name of nested) {
          if (name.endsWith(".jsonl")) files.push(join(dir, name));
        }
      } catch {
        // ignore unreadable cwd dirs
      }
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      files.push(join(rootDir, entry.name));
    }
  }
  return files;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker(),
  );
  await Promise.all(workers);
  return results;
}
