/**
 * Focused IMP-001 video appearance matrix (VID-07).
 *
 * Complements scripts/test-appearance.mjs with additional MP4 security,
 * store/quota, playback policy helpers, and source-contract checks for the
 * dual media pipeline. Uses an isolated PI_CODING_AGENT_DIR only.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import process from "node:process";
import sharp from "sharp";

const agentDir = mkdtempSync(join(tmpdir(), "pi-appearance-video-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const types = await import("../lib/appearance-types.ts");
const store = await import("../lib/appearance-store.ts");
const video = await import("../lib/appearance-video.ts");
const policy = await import("../lib/appearance-playback-policy.ts");

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
  await assert.rejects(
    fn,
    (error) =>
      error instanceof store.AppearanceStoreError &&
      error.code === code &&
      !String(error.message).includes(agentDir),
  );
}

async function expectVideoError(fn, code) {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof video.AppearanceVideoError, `expected AppearanceVideoError, got ${error?.name || error}`);
    assert.equal(error.code, code);
    assert.equal(error.message, "Video processing failed");
    // Only the public message is wire-facing; stack frames may include local paths.
    assert.equal(error.message.includes(agentDir), false);
    assert.equal(error.message.includes("/tmp"), false);
    assert.equal(error.message.includes("/Users"), false);
    assert.equal(error.message.includes("/Volumes"), false);
    return;
  }
  assert.fail(`expected AppearanceVideoError(${code})`);
}

function writeU32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

/** Minimal ISO BMFF ftyp with allowlisted brands and no moov (invalid media). */
function makeFtypOnlyMp4() {
  const major = Buffer.from("isom");
  const minor = writeU32(0);
  const brand = Buffer.from("mp41");
  const payload = Buffer.concat([major, minor, brand]);
  const size = writeU32(8 + payload.length);
  return Buffer.concat([size, Buffer.from("ftyp"), payload]);
}

/** ftyp with only a non-allowlisted brand. */
function makeUnknownBrandMp4() {
  const major = Buffer.from("XXXX");
  const minor = writeU32(0);
  const brand = Buffer.from("YYYY");
  const payload = Buffer.concat([major, minor, brand]);
  const size = writeU32(8 + payload.length);
  return Buffer.concat([size, Buffer.from("ftyp"), payload]);
}

async function makeShortMp4({ width = 320, height = 180, seconds = 1 } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "pi-appearance-video-fixture-"));
  const out = join(dir, "clip.mp4");
  const result = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=green:s=${width}x${height}:d=${seconds}`,
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-t",
      String(seconds),
      out,
    ],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`fixture ffmpeg failed: ${result.stderr || result.stdout || result.status}`);
  }
  const bytes = await readFile(out);
  rmSync(dir, { recursive: true, force: true });
  return bytes;
}

function topLevelBoxes(bytes) {
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= bytes.length) {
    let size = bytes.readUInt32BE(offset);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > bytes.length) throw new Error("truncated fixture box");
      const high = bytes.readUInt32BE(offset + 8);
      const low = bytes.readUInt32BE(offset + 12);
      size = high * 0x1_0000_0000 + low;
      headerSize = 16;
    } else if (size === 0) {
      size = bytes.length - offset;
    }
    if (!Number.isSafeInteger(size) || size < headerSize || offset + size > bytes.length) {
      throw new Error("malformed fixture box");
    }
    boxes.push({ type: bytes.subarray(offset + 4, offset + 8).toString("latin1"), offset, size });
    offset += size;
  }
  if (offset !== bytes.length) throw new Error("truncated fixture tail");
  return boxes;
}

function insertFreeBeforeMoov(bytes, paddingBytes) {
  const moov = topLevelBoxes(bytes).find((box) => box.type === "moov");
  if (!moov) throw new Error("fixture has no top-level moov");
  const free = Buffer.alloc(8 + paddingBytes);
  free.writeUInt32BE(free.length, 0);
  free.write("free", 4, "latin1");
  return Buffer.concat([bytes.subarray(0, moov.offset), free, bytes.subarray(moov.offset)]);
}

async function stageNamed(fullBytes, thumbBytes, suffix, fullExt = "mp4") {
  const dir = store.getAppearanceTemporaryDirectoryForServer();
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, `.test-${suffix}.${fullExt}`);
  const thumbnailPath = join(dir, `.test-${suffix}.thumb.webp`);
  writeFileSync(fullPath, fullBytes);
  writeFileSync(thumbnailPath, thumbBytes);
  return { fullPath, thumbnailPath };
}

function videoSkin(id, fullBytes, thumbBytes, overrides = {}) {
  const now = "2026-02-01T00:00:00.000Z";
  return {
    id,
    name: overrides.name ?? "Video skin",
    kind: "video",
    sourceName: overrides.sourceName ?? "../../APPEARANCE-PATH-SENTINEL.mp4",
    createdAt: now,
    updatedAt: now,
    asset: {
      mimeType: "video/mp4",
      width: overrides.width ?? 320,
      height: overrides.height ?? 180,
      bytes: fullBytes.length,
      thumbnailBytes: thumbBytes.length,
      durationMs: overrides.durationMs ?? 1_000,
    },
    presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
    ...overrides.skin,
  };
}

function imageSkin(id, bytes, name = "Image skin") {
  const now = "2026-02-01T00:00:00.000Z";
  return {
    id,
    name,
    kind: "image",
    sourceName: "safe.webp",
    createdAt: now,
    updatedAt: now,
    asset: {
      mimeType: "image/webp",
      width: 24,
      height: 16,
      bytes: bytes.length,
      thumbnailBytes: bytes.length,
    },
    presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
  };
}

console.log("\nappearance-video security matrix");

test("rejects HTML/SVG/JPEG/unknown-brand/moov-less containers with stable codes", async () => {
  await expectVideoError(
    () => video.normalizeAppearanceVideo({
      bytes: Buffer.from("<!DOCTYPE html><html><body>not video</body></html>"),
      filename: "page.mp4",
    }),
    "unsupported_media",
  );
  await expectVideoError(
    () => video.normalizeAppearanceVideo({
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'),
      filename: "vector.mp4",
    }),
    "unsupported_media",
  );
  const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#111" } }).jpeg().toBuffer();
  await expectVideoError(
    () => video.normalizeAppearanceVideo({ bytes: jpeg, filename: "photo.mp4" }),
    "unsupported_media",
  );
  await expectVideoError(
    () => Promise.resolve().then(() => video.inspectAppearanceMp4(makeUnknownBrandMp4())),
    "unsupported_media",
  );
  await expectVideoError(
    () => Promise.resolve().then(() => video.inspectAppearanceMp4(makeFtypOnlyMp4())),
    "invalid_media",
  );
});

test("inspectAppearanceMp4 accepts short real clips and never returns remote URL data", async () => {
  const bytes = await makeShortMp4({ width: 160, height: 90, seconds: 1 });
  const meta = video.inspectAppearanceMp4(bytes);
  assert.ok(meta.durationMs > 0 && meta.durationMs <= types.APPEARANCE_MAX_VIDEO_DURATION_MS);
  assert.equal(meta.width, 160);
  assert.equal(meta.height, 90);
  assert.ok(video.hasMp4FtypSignature(bytes));
  // Wire-safe: meta is numbers only.
  assert.equal(typeof meta.durationMs, "number");
  assert.equal(JSON.stringify(meta).includes("http"), false);
  assert.equal(JSON.stringify(meta).includes("file:"), false);
});

test("parses a real top-level tail moov by skipping large free payloads", async () => {
  const bytes = await makeShortMp4({ width: 160, height: 90, seconds: 1 });
  const tailMoov = insertFreeBeforeMoov(bytes, 9 * 1024 * 1024);
  const moov = topLevelBoxes(tailMoov).find((box) => box.type === "moov");
  assert.ok(moov && moov.offset > 8 * 1024 * 1024);

  const meta = video.inspectAppearanceMp4(tailMoov);
  assert.ok(meta.durationMs > 0);
  assert.equal(meta.width, 160);
  assert.equal(meta.height, 90);
});

test("does not mistake moov text in mdat payload for a top-level metadata box", () => {
  const ftyp = makeFtypOnlyMp4();
  const mdatPayload = Buffer.from("not a box: moov");
  const mdat = Buffer.concat([writeU32(8 + mdatPayload.length), Buffer.from("mdat"), mdatPayload]);
  assert.throws(
    () => video.inspectAppearanceMp4(Buffer.concat([ftyp, mdat])),
    (error) => error instanceof video.AppearanceVideoError && error.code === "invalid_media",
  );
});

test("normalizeAppearanceVideo stages opaque paths and strips source path segments", async () => {
  const bytes = await makeShortMp4({ width: 240, height: 136, seconds: 1 });
  const normalized = await video.normalizeAppearanceVideo({
    bytes,
    filename: "/Volumes/secret/APPEARANCE-PATH-SENTINEL/../clip.mp4",
  });
  try {
    assert.equal(normalized.sourceName, "clip");
    assert.equal(normalized.assets.fullPath.includes("secret"), false);
    assert.equal(normalized.assets.fullPath.includes("APPEARANCE-PATH-SENTINEL"), false);
    assert.ok(normalized.assets.fullPath.startsWith(store.getAppearanceTemporaryDirectoryForServer()));
    assert.ok(normalized.assets.fullPath.endsWith(".mp4"));
    assert.ok(normalized.assets.thumbnailPath.endsWith(".webp") || normalized.assets.thumbnailPath.includes(".thumb"));
    const full = await readFile(normalized.assets.fullPath);
    assert.equal(Buffer.compare(full, bytes), 0);
  } finally {
    await video.discardNormalizedAppearanceVideo(normalized.assets);
    assert.equal(existsSync(normalized.assets.fullPath), false);
    assert.equal(existsSync(normalized.assets.thumbnailPath), false);
  }
});

console.log("\nappearance-video store / projection");

test("mixed image+video catalog projects kind/duration and never leaks paths or data URLs", async () => {
  const imageId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const videoId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const imageBytes = await sharp({ create: { width: 24, height: 16, channels: 3, background: "#246" } }).webp().toBuffer();
  const videoBytes = Buffer.from("ftyp-placeholder-bytes-for-store-only");
  const thumbBytes = await sharp({ create: { width: 32, height: 18, channels: 3, background: "#864" } }).webp().toBuffer();

  const imageStaged = await stageNamed(imageBytes, imageBytes, "mix-image", "webp");
  const baseline = await store.readAppearanceCatalog();
  const withImage = await store.createAppearanceSkin({
    expectedRevision: baseline.revision,
    activate: false,
    stagedAssets: imageStaged,
    skin: imageSkin(imageId, imageBytes),
  });

  const videoStaged = await stageNamed(videoBytes, thumbBytes, "mix-video", "mp4");
  const mixed = await store.createAppearanceSkin({
    expectedRevision: withImage.revision,
    activate: true,
    stagedAssets: videoStaged,
    skin: videoSkin(videoId, videoBytes, thumbBytes, { durationMs: 2_500, width: 640, height: 360 }),
  });

  const projection = store.projectAppearanceCatalog(mixed);
  const wire = JSON.stringify(projection);
  assert.equal(projection.activeSkinId, videoId);
  assert.equal(projection.skins.length, 2);
  const imageProj = projection.skins.find((s) => s.id === imageId);
  const videoProj = projection.skins.find((s) => s.id === videoId);
  assert.equal(imageProj?.kind, "image");
  assert.equal(imageProj?.mimeType, "image/webp");
  assert.equal(imageProj?.durationMs, undefined);
  assert.equal(videoProj?.kind, "video");
  assert.equal(videoProj?.mimeType, "video/mp4");
  assert.equal(videoProj?.durationMs, 2_500);
  assert.equal(videoProj?.assetUrl, `/api/appearance/skins/${videoId}/asset?variant=full`);
  assert.equal(videoProj?.thumbnailUrl, `/api/appearance/skins/${videoId}/asset?variant=thumbnail`);
  assert.equal(wire.includes(agentDir), false);
  assert.equal(wire.includes(".mp4"), false);
  assert.equal(wire.includes(".webp"), false);
  assert.equal(wire.includes("data:"), false);
  assert.equal(wire.includes("file://"), false);
  assert.equal(wire.includes("APPEARANCE-PATH-SENTINEL"), false);
  assert.equal(wire.includes("/Volumes/"), false);

  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "full", "video")), true);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(imageId, "full", "image")), true);

  // Active video delete is atomic for mp4 + thumb and clears active.
  const deleted = await store.deleteAppearanceSkin({
    expectedRevision: mixed.revision,
    id: videoId,
    deactivateActive: true,
  });
  assert.equal(deleted.index.activeSkinId, null);
  assert.equal(deleted.index.skins.length, 1);
  assert.equal(deleted.index.skins[0].id, imageId);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "full", "video")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(videoId, "thumbnail", "video")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(imageId, "full", "image")), true);

  await store.deleteAppearanceSkin({
    expectedRevision: deleted.revision,
    id: imageId,
    deactivateActive: true,
  });
});

test("over-quota and non-opaque ids fail closed without inventing paths", async () => {
  assert.equal(store.getAppearanceSkinAssetPathForServer("../etc/passwd", "full", "video"), null);
  assert.equal(store.getAppearanceSkinAssetPathForServer("not-a-uuid", "thumbnail", "image"), null);
  assert.equal(store.getAppearanceSkinAssetPathForServer("", "full", "video"), null);

  const badId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const indexPath = store.getAppearanceIndexPathForServer();
  await mkdir(join(agentDir, "appearance"), { recursive: true });
  writeFileSync(indexPath, JSON.stringify({
    schemaVersion: 1,
    activeSkinId: badId,
    updatedAt: "2026-02-02T00:00:00.000Z",
    skins: [{
      id: badId,
      name: "Quota buster",
      kind: "video",
      createdAt: "2026-02-02T00:00:00.000Z",
      updatedAt: "2026-02-02T00:00:00.000Z",
      asset: {
        mimeType: "video/mp4",
        width: 640,
        height: 360,
        bytes: types.APPEARANCE_MAX_TOTAL_BYTES + 1,
        thumbnailBytes: 100,
        durationMs: 1_000,
      },
      presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
    }],
  }));
  const read = await store.readAppearanceCatalog();
  assert.deepEqual(read.warnings, ["appearance_catalog_invalid"]);
  assert.equal(read.index.activeSkinId, null);
  assert.deepEqual(read.index.skins, []);
  // Original corrupt index is retained (fail closed, no rewrite).
  assert.ok(readFileSync(indexPath, "utf8").includes(String(types.APPEARANCE_MAX_TOTAL_BYTES + 1)));
  // Restore a clean empty catalog so later mutation tests are not poisoned.
  rmSync(indexPath, { force: true });
});

test("inconsistent kind/mime in on-disk index fails closed without rewrite", async () => {
  const id = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const indexPath = store.getAppearanceIndexPathForServer();
  await mkdir(join(agentDir, "appearance"), { recursive: true });
  writeFileSync(indexPath, JSON.stringify({
    schemaVersion: 1,
    activeSkinId: id,
    updatedAt: "2026-02-03T00:00:00.000Z",
    skins: [{
      id,
      name: "Bad pair",
      kind: "video",
      createdAt: "2026-02-03T00:00:00.000Z",
      updatedAt: "2026-02-03T00:00:00.000Z",
      asset: {
        mimeType: "image/webp",
        width: 10,
        height: 10,
        bytes: 12,
        thumbnailBytes: 12,
      },
      presentation: { ...types.DEFAULT_APPEARANCE_PRESENTATION },
    }],
  }));
  const before = readFileSync(indexPath, "utf8");
  const read = await store.readAppearanceCatalog();
  assert.deepEqual(read.warnings, ["appearance_catalog_invalid"]);
  assert.equal(readFileSync(indexPath, "utf8"), before);
  rmSync(indexPath, { force: true });
});

console.log("\nappearance-video playback policy helpers");

test("browser policy readers are SSR-safe and map Save-Data / visibility / reduced-motion", () => {
  assert.equal(policy.readDocumentVisible(null), true);
  assert.equal(policy.readDocumentVisible({ visibilityState: "visible" }), true);
  assert.equal(policy.readDocumentVisible({ visibilityState: "hidden" }), false);

  assert.equal(policy.readSaveDataPreference(null), false);
  assert.equal(policy.readSaveDataPreference({}), false);
  assert.equal(policy.readSaveDataPreference({ connection: { saveData: true } }), true);
  assert.equal(policy.readSaveDataPreference({ connection: { saveData: false } }), false);

  assert.equal(policy.readReducedMotionPreference(null), false);
  assert.equal(policy.readReducedMotionPreference(() => { throw new Error("no matchMedia"); }), false);
  assert.equal(
    policy.readReducedMotionPreference((query) => {
      assert.equal(query, "(prefers-reduced-motion: reduce)");
      return { matches: true };
    }),
    true,
  );
  assert.equal(
    policy.readReducedMotionPreference(() => ({ matches: false })),
    false,
  );

  // Full matrix priority already covered in test-appearance; pin error > hidden > poster > loading > playing once more.
  const base = { reducedMotion: false, documentVisible: true, saveData: false, userPosterOnly: false };
  assert.equal(policy.shouldPlayVideo(base), true);
  assert.equal(policy.resolveAppearancePlaybackState({ ...base, saveData: true }, { loading: true }), "poster");
  assert.equal(policy.resolveAppearancePlaybackState(base, { loading: true }), "loading");
});

console.log("\nappearance-video source contracts (client/CSS/API)");

test("layout host is single inert muted video without SSR src or controls", () => {
  const layout = readFileSync(join(process.cwd(), "app/layout.tsx"), "utf8");
  assert.ok(layout.includes('id="appearance-bg-video"'));
  assert.ok(layout.includes("muted"));
  assert.ok(layout.includes("playsInline"));
  assert.ok(layout.includes("loop"));
  assert.ok(layout.includes('aria-hidden="true"'));
  assert.ok(layout.includes("disablePictureInPicture"));
  assert.ok(layout.includes("disableRemotePlayback"));
  assert.ok(layout.includes('preload="none"'));
  assert.ok(layout.includes('data-appearance-playback": "poster"') || layout.includes("data-appearance-playback\": \"poster\"") || layout.includes('"data-appearance-playback": "poster"'));
  // Must not hardcode a full asset src in SSR markup.
  assert.equal(layout.includes('src={`/api/appearance'), false);
  assert.equal(layout.includes('src="/api/appearance'), false);
  assert.equal(/controls\s*=\s*\{?true\}?/.test(layout), false);
  // Exactly one decorative host id declaration.
  assert.equal((layout.match(/id="appearance-bg-video"/g) || []).length, 1);
});

test("useAppearance forces mute, single host, safe asset URLs, and generation-guarded play", () => {
  const source = readFileSync(join(process.cwd(), "hooks/useAppearance.ts"), "utf8");
  assert.ok(source.includes('APPEARANCE_VIDEO_ELEMENT_ID = "appearance-bg-video"'));
  assert.ok(source.includes("video.muted = true"));
  assert.ok(source.includes("video.defaultMuted = true"));
  assert.ok(source.includes("video.controls = false"));
  assert.ok(source.includes("video.playsInline = true"));
  assert.ok(source.includes("video.loop = true"));
  assert.ok(source.includes("removeAttribute(\"src\")") || source.includes("removeAttribute('src')"));
  assert.ok(source.includes("shouldPlayVideo"));
  assert.ok(source.includes("applyGeneration"));
  assert.ok(source.includes("videoReadyAbort"));
  assert.ok(source.includes("BroadcastChannel"));
  assert.ok(source.includes("pi-web-appearance-v1") || source.includes("appearance"));
  assert.ok(source.includes("isSafeAssetUrl"));
  assert.ok(source.includes("`/api/appearance/skins/${id}/asset?variant=${variant}`") || source.includes('/api/appearance/skins/'));
  // No remote / data URL allowance in the safe URL helper.
  assert.equal(source.includes("data:"), false);
  assert.equal(source.includes("blob:"), false);
  assert.equal(source.includes("http://"), false);
  assert.equal(source.includes("https://"), false);
});

test("CSS maps object-fit tokens and hides video outside playing state", () => {
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  assert.ok(css.includes("#appearance-bg-video"));
  assert.ok(css.includes("pointer-events: none"));
  assert.ok(css.includes("object-fit: var(--appearance-video-fit"));
  assert.ok(css.includes('data-appearance-kind="video"'));
  assert.ok(css.includes('data-appearance-playback="playing"'));
  assert.ok(css.includes('data-appearance-playback="poster"'));
  assert.ok(css.includes('data-appearance-playback="paused-hidden"'));
  assert.ok(css.includes('data-appearance-playback="error"'));
});

test("AppearanceConfig accepts MP4, shows kind labels, and exposes poster-only control", () => {
  const ui = readFileSync(join(process.cwd(), "components/AppearanceConfig.tsx"), "utf8");
  assert.ok(ui.includes("image/jpeg,image/png,image/webp,video/mp4"));
  assert.ok(ui.includes("video/mp4"));
  assert.ok(ui.includes("视频") && ui.includes("图片"));
  assert.ok(ui.includes("仅静态封面") || ui.includes("poster"));
  assert.ok(ui.includes("writeUserPosterOnlyPreference") || ui.includes("userPosterOnly") || ui.includes("setUserPosterOnly"));
  assert.ok(ui.includes("durationMs") || ui.includes("formatDuration"));
});

test("upload and asset routes branch by content, serve video/mp4, and keep safe headers", () => {
  const skins = readFileSync(join(process.cwd(), "app/api/appearance/skins/route.ts"), "utf8");
  const asset = readFileSync(join(process.cwd(), "app/api/appearance/skins/[id]/asset/route.ts"), "utf8");
  assert.ok(skins.includes("sniffMediaBranch"));
  assert.ok(skins.includes("hasMp4FtypSignature"));
  assert.ok(skins.includes("normalizeAppearanceVideo"));
  assert.ok(skins.includes("normalizeAppearanceImage"));
  assert.ok(skins.includes('ALLOWED_FORM_KEYS = new Set(["file", "name", "revision", "poster", "confirmOversize"])'));
  assert.ok(skins.includes("activate: true"));
  assert.ok(skins.includes("video_too_long") || skins.includes("AppearanceVideoError"));
  // Public error bodies must not interpolate filesystem paths.
  assert.equal(skins.includes("error.message"), false);
  assert.equal(skins.includes("error.stack"), false);

  assert.ok(asset.includes('"video/mp4"') || asset.includes("video/mp4"));
  assert.ok(asset.includes("image/webp"));
  assert.ok(asset.includes("Accept-Ranges"));
  assert.ok(asset.includes("private, max-age=31536000, immutable"));
  assert.ok(asset.includes("nosniff"));
  assert.ok(asset.includes("if-none-match"));
  assert.ok(asset.includes("parseByteRange") || asset.includes("range"));
  // Asset path comes only from store helper + catalog id, never query path.
  assert.ok(asset.includes("getAppearanceSkinAssetPathForServer"));
  assert.equal(asset.includes("searchParams.get(\"path\")"), false);
  assert.equal(asset.includes("searchParams.get('path')"), false);
});

test("types keep image limits separate from video limits and map all four fits", () => {
  assert.equal(types.APPEARANCE_MAX_UPLOAD_BYTES, 20 * 1024 * 1024);
  assert.equal(types.APPEARANCE_MAX_VIDEO_UPLOAD_BYTES, 1024 * 1024 * 1024);
  assert.equal(types.APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES, 50 * 1024 * 1024);
  assert.equal(types.APPEARANCE_MAX_VIDEO_DURATION_MS, Number.MAX_SAFE_INTEGER);
  assert.equal(types.APPEARANCE_MAX_VIDEO_LONG_EDGE, Number.MAX_SAFE_INTEGER);
  assert.equal(types.APPEARANCE_MAX_TOTAL_BYTES, 1024 * 1024 * 1024);
  assert.ok(types.APPEARANCE_ACCEPTED_MIME_TYPES.includes("video/mp4"));
  assert.ok(types.APPEARANCE_IMAGE_ACCEPTED_MIME_TYPES.every((m) => m.startsWith("image/")));
  assert.deepEqual(
    ["cover", "contain", "stretch", "original"].map((fit) => types.appearanceVideoObjectFit(fit)),
    ["cover", "contain", "fill", "none"],
  );
});

test("failed video create leaves no public orphan assets", async () => {
  const id = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  const fullBytes = Buffer.from("ftyp-orphan-check");
  const thumbBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#000" } }).webp().toBuffer();
  const staged = await stageNamed(fullBytes, thumbBytes, "orphan", "mp4");
  const before = await store.readAppearanceCatalog();
  // Force storage_error via mismatched thumbnailBytes.
  const badSkin = videoSkin(id, fullBytes, thumbBytes, { durationMs: 1_000 });
  badSkin.asset.thumbnailBytes = thumbBytes.length + 99;
  await expectStoreError(
    () => store.createAppearanceSkin({
      expectedRevision: before.revision,
      activate: true,
      stagedAssets: staged,
      skin: badSkin,
    }),
    "storage_error",
  );
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(id, "full", "video")), false);
  assert.equal(existsSync(store.getAppearanceSkinAssetPathForServer(id, "thumbnail", "video")), false);
  const after = await store.readAppearanceCatalog();
  assert.equal(after.index.skins.some((s) => s.id === id), false);
});

await chain;
rmSync(agentDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
