/**
 * Focused appearance-domain regression tests.
 *
 * The isolated agent dir is configured before importing the store/image modules,
 * so this never reads or writes a user's real appearance catalog.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import sharp from "sharp";

const agentDir = mkdtempSync(join(tmpdir(), "pi-appearance-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const types = await import("../lib/appearance-types.ts");
const store = await import("../lib/appearance-store.ts");
const image = await import("../lib/appearance-image.ts");
const video = await import("../lib/appearance-video.ts");
const policy = await import("../lib/appearance-playback-policy.ts");
const { spawnSync } = await import("node:child_process");
const { mkdtemp } = await import("node:fs/promises");

let passed = 0;
let failed = 0;
let chain = Promise.resolve();

function test(name, fn) {
  chain = chain.then(async () => {
    try {
      await fn();
      passed += 1;
      console.log(`  ✓ ${name}`);
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${name}`);
      console.error(error instanceof Error ? error.stack : error);
    }
  });
  return chain;
}

async function expectStoreError(fn, code) {
  await assert.rejects(fn, (error) => error instanceof store.AppearanceStoreError && error.code === code);
}

async function makeJpeg() {
  return sharp({ create: { width: 24, height: 16, channels: 3, background: "#245" } })
    .withMetadata({ exif: { IFD0: { Artist: "APPEARANCE-EXIF-SENTINEL" } } })
    .jpeg()
    .toBuffer();
}

async function stage(bytes, suffix) {
  const dir = store.getAppearanceTemporaryDirectoryForServer();
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, `.test-${suffix}.webp`);
  const thumbnailPath = join(dir, `.test-${suffix}.thumb.webp`);
  await Promise.all([writeFileSync(fullPath, bytes), writeFileSync(thumbnailPath, bytes)]);
  return { fullPath, thumbnailPath };
}

function skin(id, bytes, name = "Safe skin", overrides = {}) {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    id,
    name,
    kind: "image",
    sourceName: "../../APPEARANCE-PATH-SENTINEL.jpg",
    createdAt: now,
    updatedAt: now,
    asset: { mimeType: "image/webp", width: 24, height: 16, bytes: bytes.length, thumbnailBytes: bytes.length },
    presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
    ...overrides,
  };
}

function videoSkin(id, fullBytes, thumbBytes, name = "Video skin") {
  return skin(id, fullBytes, name, {
    kind: "video",
    sourceName: "../../APPEARANCE-PATH-SENTINEL.mp4",
    asset: {
      mimeType: "video/mp4",
      width: 640,
      height: 360,
      bytes: fullBytes.length,
      thumbnailBytes: thumbBytes.length,
      durationMs: 12_000,
    },
  });
}

async function stageNamed(fullBytes, thumbBytes, suffix, fullExt = "webp") {
  const dir = store.getAppearanceTemporaryDirectoryForServer();
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, `.test-${suffix}.${fullExt}`);
  const thumbnailPath = join(dir, `.test-${suffix}.thumb.webp`);
  writeFileSync(fullPath, fullBytes);
  writeFileSync(thumbnailPath, thumbBytes);
  return { fullPath, thumbnailPath };
}

console.log("\nappearance contracts");

test("validates presentation bounds and CSS fit mappings", () => {
  assert.equal(types.validateAppearancePresentation(types.DEFAULT_APPEARANCE_PRESENTATION)?.fit, "cover");
  assert.equal(types.validateAppearancePresentation({ ...types.DEFAULT_APPEARANCE_PRESENTATION, panelOpacity: 69 }), null);
  assert.equal(types.validateAppearancePresentation({ ...types.DEFAULT_APPEARANCE_PRESENTATION, positionX: 12.5 }), null);
  assert.deepEqual(
    ["cover", "contain", "stretch", "original"].map((fit) => types.appearanceBackgroundSize(fit)),
    ["cover", "contain", "100% 100%", "auto"],
  );
  assert.deepEqual(
    ["cover", "contain", "stretch", "original"].map((fit) => types.appearanceVideoObjectFit(fit)),
    ["cover", "contain", "fill", "none"],
  );
  assert.equal(types.resolveAppearanceSkinKind(undefined), "image");
  assert.equal(types.resolveAppearanceSkinKind("video"), "video");
  assert.equal(types.resolveAppearanceSkinKind("gif"), null);
});

console.log("\nappearance playback policy");

test("shouldPlayVideo and resolveAppearancePlaybackState cover policy matrix", () => {
  const base = {
    reducedMotion: false,
    documentVisible: true,
    saveData: false,
    userPosterOnly: false,
  };
  assert.equal(policy.shouldPlayVideo(base), true);
  assert.equal(policy.resolveAppearancePlaybackState(base), "playing");
  assert.equal(policy.resolveAppearancePlaybackState(base, { loading: true }), "loading");
  assert.equal(policy.resolveAppearancePlaybackState(base, { error: true }), "error");

  assert.equal(policy.shouldPlayVideo({ ...base, documentVisible: false }), false);
  assert.equal(policy.resolveAppearancePlaybackState({ ...base, documentVisible: false }), "paused-hidden");

  assert.equal(policy.shouldPlayVideo({ ...base, reducedMotion: true }), false);
  assert.equal(policy.resolveAppearancePlaybackState({ ...base, reducedMotion: true }), "poster");

  assert.equal(policy.shouldPlayVideo({ ...base, userPosterOnly: true }), false);
  assert.equal(policy.resolveAppearancePlaybackState({ ...base, userPosterOnly: true }), "poster");

  assert.equal(policy.shouldPlayVideo({ ...base, saveData: true }), false);
  assert.equal(policy.resolveAppearancePlaybackState({ ...base, saveData: true }), "poster");

  // Hidden wins over reduced-motion for the CSS token (still non-playing).
  assert.equal(
    policy.resolveAppearancePlaybackState({ ...base, documentVisible: false, reducedMotion: true }),
    "paused-hidden",
  );
  // Hard error wins over every policy branch.
  assert.equal(
    policy.resolveAppearancePlaybackState({ ...base, documentVisible: false }, { error: true }),
    "error",
  );
});

test("poster-only preference reads and writes localStorage without throwing", () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: (key, value) => { mem.set(key, String(value)); },
    removeItem: (key) => { mem.delete(key); },
  };
  assert.equal(policy.readUserPosterOnlyPreference(storage), false);
  policy.writeUserPosterOnlyPreference(true, storage);
  assert.equal(storage.getItem(policy.APPEARANCE_POSTER_ONLY_STORAGE_KEY), "1");
  assert.equal(policy.readUserPosterOnlyPreference(storage), true);
  policy.writeUserPosterOnlyPreference(false, storage);
  assert.equal(policy.readUserPosterOnlyPreference(storage), false);

  // Broken storage must not throw.
  const broken = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
  assert.equal(policy.readUserPosterOnlyPreference(broken), false);
  policy.writeUserPosterOnlyPreference(true, broken);
});

test("sanitizes display names without accepting path data as a storage path", () => {
  assert.equal(types.sanitizeAppearanceName("  fullwidth　name\n"), "fullwidth name");
  assert.equal(types.sanitizeAppearanceName("\u0000\u0001"), null);
  assert.equal(types.sanitizeAppearanceName("x".repeat(81)), null);
});

console.log("\nappearance image normalization");

test("rejects SVG/signature spoofing before decoding", async () => {
  await assert.rejects(
    () => image.normalizeAppearanceImage({ bytes: Buffer.from('<svg><image href="https://evil.invalid/a"/></svg>'), filename: "spoof.jpg" }),
    (error) => error instanceof image.AppearanceImageError && error.code === "unsupported_media",
  );
});

test("normalizes JPEG to metadata-free bounded WebP assets", async () => {
  const normalized = await image.normalizeAppearanceImage({ bytes: await makeJpeg(), filename: "../../APPEARANCE-PATH-SENTINEL.jpg" });
  try {
    assert.equal(normalized.width, 24);
    assert.equal(normalized.height, 16);
    const metadata = await sharp(await readFile(normalized.assets.fullPath)).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(normalized.sourceName, "APPEARANCE-PATH-SENTINEL");
  } finally {
    await image.discardNormalizedAppearanceImage(normalized.assets);
  }
});

console.log("\nappearance store and routes");

const firstId = "11111111-1111-4111-8111-111111111111";
let created;

test("missing catalog is default-only and creates no migration files", async () => {
  const read = await store.readAppearanceCatalog();
  assert.equal(read.revision, store.EMPTY_APPEARANCE_REVISION);
  assert.deepEqual(read.index.skins, []);
  assert.equal(existsSync(store.getAppearanceIndexPathForServer()), false);
});

test("commits staged assets atomically and omits source/path sentinels from catalog wire data", async () => {
  const bytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#456" } }).webp().toBuffer();
  const staged = await stage(bytes, "first");
  created = await store.createAppearanceSkin({
    expectedRevision: store.EMPTY_APPEARANCE_REVISION,
    activate: true,
    stagedAssets: staged,
    skin: skin(firstId, bytes),
  });
  const projection = store.projectAppearanceCatalog(created);
  const wire = JSON.stringify(projection);
  assert.equal(projection.activeSkinId, firstId);
  assert.equal(created.index.skins[0].kind, "image");
  assert.equal(created.index.skins[0].sourceName, "APPEARANCE-PATH-SENTINEL.jpg");
  assert.equal(projection.skins[0].kind, "image");
  assert.equal(projection.skins[0].mimeType, "image/webp");
  assert.equal(projection.skins[0].assetUrl, `/api/appearance/skins/${firstId}/asset?variant=full`);
  assert.equal(projection.limits.maxVideoUploadBytes, types.APPEARANCE_MAX_VIDEO_UPLOAD_BYTES);
  assert.equal(projection.limits.maxTotalBytes, types.APPEARANCE_MAX_TOTAL_BYTES);
  assert.ok(projection.limits.acceptedMimeTypes.includes("video/mp4"));
  assert.equal(wire.includes("APPEARANCE-PATH-SENTINEL"), false);
  assert.equal(wire.includes(agentDir), false);
  assert.equal(wire.includes(`${firstId}.webp`), false);
  assert.equal(wire.includes("file://"), false);
  assert.equal(existsSync(staged.fullPath), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(firstId, "full", "image")), true);
});

test("rejects stale revisions rather than silently overwriting the catalog", async () => {
  await expectStoreError(
    () => store.updateAppearanceIndex(store.EMPTY_APPEARANCE_REVISION, (index) => ({ ...index, activeSkinId: null })),
    "revision_conflict",
  );
});

test("route source keeps mutation allowlists and no-store/private cache policies", () => {
  const routeSource = readFileSync(join(process.cwd(), "app/api/appearance/route.ts"), "utf8");
  const skinsSource = readFileSync(join(process.cwd(), "app/api/appearance/skins/route.ts"), "utf8");
  const assetSource = readFileSync(join(process.cwd(), "app/api/appearance/skins/[id]/asset/route.ts"), "utf8");
  assert.ok(routeSource.includes('Object.keys(value).length === 1'));
  assert.ok(routeSource.includes('"Cache-Control": "no-store"'));
  assert.ok(skinsSource.includes('hasMp4FtypSignature'));
  assert.ok(skinsSource.includes('normalizeAppearanceVideo'));
  assert.ok(skinsSource.includes('normalizeAppearanceImage'));
  assert.ok(skinsSource.includes('activate: true'));
  assert.ok(skinsSource.includes('"poster"'));
  assert.ok(skinsSource.includes('AppearanceVideoError'));
  assert.ok(skinsSource.includes('sniffMediaBranch'));
  assert.ok(assetSource.includes('"Cache-Control": "private, max-age=31536000, immutable"'));
  assert.ok(assetSource.includes('"X-Content-Type-Options": "nosniff"'));
  assert.ok(assetSource.includes('if-none-match'));
  assert.ok(assetSource.includes('video/mp4'));
  assert.ok(assetSource.includes('Accept-Ranges'));
});

test("active delete requires explicit deactivation and removes both assets with its catalog entry", async () => {
  await expectStoreError(
    () => store.deleteAppearanceSkin({ expectedRevision: created.revision, id: firstId }),
    "skin_active",
  );
  const deleted = await store.deleteAppearanceSkin({ expectedRevision: created.revision, id: firstId, deactivateActive: true });
  assert.equal(deleted.index.activeSkinId, null);
  assert.deepEqual(deleted.index.skins, []);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(firstId, "full", "image")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(firstId, "thumbnail", "image")), false);
});

test("loads legacy image-only indexes without kind and never mixes video full paths", async () => {
  const legacyId = "22222222-2222-4222-8222-222222222222";
  const bytes = await sharp({ create: { width: 20, height: 12, channels: 3, background: "#789" } }).webp().toBuffer();
  const skinsDir = join(agentDir, "appearance", "skins");
  await mkdir(skinsDir, { recursive: true });
  writeFileSync(join(skinsDir, `${legacyId}.webp`), bytes);
  writeFileSync(join(skinsDir, `${legacyId}.thumb.webp`), bytes);
  const indexPath = store.getAppearanceIndexPathForServer();
  writeFileSync(indexPath, JSON.stringify({
    schemaVersion: 1,
    activeSkinId: legacyId,
    updatedAt: "2026-01-02T00:00:00.000Z",
    skins: [{
      id: legacyId,
      name: "Legacy image",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      asset: { mimeType: "image/webp", width: 20, height: 12, bytes: bytes.length, thumbnailBytes: bytes.length },
      presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
    }],
  }));
  const read = await store.readAppearanceCatalog();
  assert.equal(read.warnings, undefined);
  assert.equal(read.index.skins[0].kind, "image");
  assert.equal(read.index.skins[0].asset.mimeType, "image/webp");
  assert.equal(store.getAppearanceSkinAssetPathForServer(legacyId, "full", "image")?.endsWith(`${legacyId}.webp`), true);
  assert.equal(store.getAppearanceSkinAssetPathForServer(legacyId, "full", "video")?.endsWith(`${legacyId}.mp4`), true);
  assert.notEqual(
    store.getAppearanceSkinAssetPathForServer(legacyId, "full", "image"),
    store.getAppearanceSkinAssetPathForServer(legacyId, "full", "video"),
  );
  await store.deleteAppearanceSkin({ expectedRevision: read.revision, id: legacyId, deactivateActive: true });
});

test("commits video skins to .mp4 + thumb and projects kind/duration without paths", async () => {
  const videoId = "33333333-3333-4333-8333-333333333333";
  const fullBytes = Buffer.from("ftyp-mp4-fixture-not-real-but-bytes");
  const thumbBytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: "#135" } }).webp().toBuffer();
  const staged = await stageNamed(fullBytes, thumbBytes, "video", "mp4");
  const baseline = await store.readAppearanceCatalog();
  const createdVideo = await store.createAppearanceSkin({
    expectedRevision: baseline.revision,
    activate: true,
    stagedAssets: staged,
    skin: videoSkin(videoId, fullBytes, thumbBytes),
  });
  const projection = store.projectAppearanceCatalog(createdVideo);
  const wire = JSON.stringify(projection);
  assert.equal(createdVideo.index.skins[0].kind, "video");
  assert.equal(createdVideo.index.skins[0].asset.durationMs, 12_000);
  assert.equal(projection.skins[0].kind, "video");
  assert.equal(projection.skins[0].mimeType, "video/mp4");
  assert.equal(projection.skins[0].durationMs, 12_000);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "full", "video")), true);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "full", "image")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "thumbnail", "video")), true);
  assert.equal(wire.includes(agentDir), false);
  assert.equal(wire.includes(".mp4"), false);
  assert.equal(wire.includes("APPEARANCE-PATH-SENTINEL"), false);

  // Reject missing duration, inconsistent mime/kind, and out-of-range duration.
  const missingDuration = videoSkin("44444444-4444-4444-8444-444444444444", fullBytes, thumbBytes);
  delete missingDuration.asset.durationMs;
  const missingDurationAssets = await stageNamed(fullBytes, thumbBytes, "missing-duration", "mp4");
  await expectStoreError(
    () => store.createAppearanceSkin({
      expectedRevision: createdVideo.revision,
      stagedAssets: missingDurationAssets,
      skin: missingDuration,
    }),
    "storage_error",
  );
  const badMimeAssets = await stageNamed(fullBytes, thumbBytes, "bad-mime", "mp4");
  await expectStoreError(
    () => store.createAppearanceSkin({
      expectedRevision: createdVideo.revision,
      stagedAssets: badMimeAssets,
      skin: skin("55555555-5555-4555-8555-555555555555", fullBytes, "Bad mime", {
        kind: "video",
        asset: {
          mimeType: "image/webp",
          width: 640,
          height: 360,
          bytes: fullBytes.length,
          thumbnailBytes: thumbBytes.length,
          durationMs: 1000,
        },
      }),
    }),
    "storage_error",
  );
  const deletedVideo = await store.deleteAppearanceSkin({
    expectedRevision: createdVideo.revision,
    id: videoId,
    deactivateActive: true,
  });
  assert.equal(deletedVideo.index.activeSkinId, null);
  assert.deepEqual(deletedVideo.index.skins, []);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "full", "video")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "thumbnail", "video")), false);
});

test("malformed catalogs fail closed without being overwritten", async () => {
  const indexPath = store.getAppearanceIndexPathForServer();
  writeFileSync(indexPath, '{"schemaVersion":999,"secret":"APPEARANCE-PATH-SENTINEL"}');
  const result = await store.readAppearanceCatalog();
  assert.deepEqual(result.warnings, ["appearance_catalog_invalid"]);
  assert.equal(result.index.activeSkinId, null);
  assert.ok(readFileSync(indexPath, "utf8").includes("APPEARANCE-PATH-SENTINEL"));
});

console.log("\nappearance video normalization");

async function makeShortMp4({ width = 320, height = 180, seconds = 1, extraArgs = [] } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-appearance-mp4-"));
  const out = join(dir, "clip.mp4");
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=blue:s=${width}x${height}:d=${seconds}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-t",
    String(seconds),
    ...extraArgs,
    out,
  ];
  const result = spawnSync("ffmpeg", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${result.stderr || result.stdout || result.status}`);
  }
  const bytes = await readFile(out);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

async function expectVideoError(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof video.AppearanceVideoError, `expected AppearanceVideoError, got ${error?.name || error}`);
    assert.equal(error.code, code);
    assert.equal(error.message, "Video processing failed");
    assert.equal(String(error.message).includes("/"), false);
    return;
  }
  assert.fail(`expected AppearanceVideoError(${code})`);
}

test("rejects empty, spoofed, and oversized MP4s while allowing duration/resolution", async () => {
  await expectVideoError(
    () => video.normalizeAppearanceVideo({ bytes: Buffer.alloc(0), filename: "empty.mp4" }),
    "file_too_large",
  );
  await expectVideoError(
    () => video.normalizeAppearanceVideo({ bytes: Buffer.from("not-an-mp4"), filename: "spoof.mp4" }),
    "unsupported_media",
  );
  const jpeg = await makeJpeg();
  await expectVideoError(
    () => video.normalizeAppearanceVideo({ bytes: jpeg, filename: "image.mp4" }),
    "unsupported_media",
  );
  // Avoid allocating a full 50MiB+ buffer; a slightly oversized length is enough.
  const oversized = Buffer.alloc(16);
  Object.defineProperty(oversized, "length", { value: types.APPEARANCE_MAX_VIDEO_UPLOAD_BYTES + 1 });
  await expectVideoError(() => Promise.resolve().then(() => video.inspectAppearanceMp4(oversized)), "file_too_large");

  const longBytes = await makeShortMp4({ width: 160, height: 90, seconds: 31 });
  assert.ok(video.inspectAppearanceMp4(longBytes).durationMs > 30_000);

  const overRes = await makeShortMp4({ width: 1936, height: 1080, seconds: 1 });
  assert.equal(video.inspectAppearanceMp4(overRes).width, 1936);
});

test("normalizes short MP4 to staged .mp4 + metadata-free WebP poster without path leakage", async () => {
  const bytes = await makeShortMp4({ width: 320, height: 180, seconds: 1 });
  const normalized = await video.normalizeAppearanceVideo({
    bytes,
    filename: "../../APPEARANCE-PATH-SENTINEL.mp4",
  });
  try {
    assert.equal(normalized.width, 320);
    assert.equal(normalized.height, 180);
    assert.ok(normalized.durationMs > 0 && normalized.durationMs <= types.APPEARANCE_MAX_VIDEO_DURATION_MS);
    assert.equal(normalized.bytes, bytes.length);
    assert.equal(normalized.sourceName, "APPEARANCE-PATH-SENTINEL");
    const full = await readFile(normalized.assets.fullPath);
    assert.equal(Buffer.compare(full, bytes), 0);
    assert.ok(video.hasMp4FtypSignature(full));
    const poster = await readFile(normalized.assets.thumbnailPath);
    const metadata = await sharp(poster).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.ok((metadata.width ?? 0) <= types.APPEARANCE_THUMBNAIL_MAX_EDGE);
    assert.ok((metadata.height ?? 0) <= types.APPEARANCE_THUMBNAIL_MAX_EDGE);
    assert.equal(normalized.assets.fullPath.includes("APPEARANCE-PATH-SENTINEL"), false);
    assert.equal(String(normalized.sourceName ?? "").includes("../"), false);
  } finally {
    await video.discardNormalizedAppearanceVideo(normalized.assets);
  }
});

test("strategy B required poster path rejects missing poster and accepts dual-file upload", async () => {
  const bytes = await makeShortMp4({ width: 160, height: 90, seconds: 1 });
  await assert.rejects(
    () => video.normalizeAppearanceVideoWithRequiredPoster({
      bytes,
      filename: "clip.mp4",
      poster: undefined,
    }),
    (error) => error instanceof video.AppearanceVideoError && error.code === "poster_required",
  );
  const posterJpeg = await makeJpeg();
  const normalized = await video.normalizeAppearanceVideoWithRequiredPoster({
    bytes,
    filename: "clip.mp4",
    poster: { bytes: posterJpeg, filename: "cover.jpg" },
  });
  try {
    const poster = await readFile(normalized.assets.thumbnailPath);
    const metadata = await sharp(poster).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok(normalized.thumbnailBytes > 0);
  } finally {
    await video.discardNormalizedAppearanceVideo(normalized.assets);
  }
});

test("public video errors never embed absolute paths or probe stderr", async () => {
  try {
    await video.normalizeAppearanceVideo({ bytes: Buffer.from("RIFF....WEBP"), filename: "/tmp/secret-path.mp4" });
    assert.fail("expected rejection");
  } catch (error) {
    assert.ok(error instanceof video.AppearanceVideoError);
    assert.equal(error.message.includes("/tmp"), false);
    assert.equal(error.message.includes("secret-path"), false);
    assert.equal(error.message, "Video processing failed");
  }
});

await chain;
rmSync(agentDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
