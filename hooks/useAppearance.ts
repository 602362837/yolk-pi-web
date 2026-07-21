"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  appearanceBackgroundSize,
  appearanceVideoObjectFit,
  isAppearanceSkinKind,
  type AppearanceCatalogProjection,
  type AppearancePresentation,
  type AppearanceSkinKind,
  type AppearanceSkinProjection,
  type AppearanceStoredAssetMimeType,
} from "@/lib/appearance-types";
import {
  APPEARANCE_POSTER_ONLY_STORAGE_KEY,
  readAppearancePlaybackPolicy,
  resolveAppearancePlaybackState,
  shouldPlayVideo,
  writeUserPosterOnlyPreference,
  type AppearancePlaybackPolicy,
  type AppearancePlaybackState,
} from "@/lib/appearance-playback-policy";

type AppearanceSnapshot = {
  catalog: AppearanceCatalogProjection | null;
  error: string | null;
  loading: boolean;
  /** Last resolved playback token for Settings status copy (video only). */
  playback: AppearancePlaybackState | null;
  userPosterOnly: boolean;
};

const EMPTY_SNAPSHOT: AppearanceSnapshot = {
  catalog: null,
  error: null,
  loading: false,
  playback: null,
  userPosterOnly: false,
};
const listeners = new Set<() => void>();
let snapshot = EMPTY_SNAPSHOT;
let refreshController: AbortController | null = null;
let applyGeneration = 0;
/** Aborts in-flight video readiness waits when a newer catalog apply starts. */
let videoReadyAbort: AbortController | null = null;
let channel: BroadcastChannel | null = null;
let channelRefCount = 0;
/** Latest catalog skin id we applied (including video poster path). */
let appliedSkinId: string | null = null;
let policyListenersAttached = false;
let reducedMotionMql: MediaQueryList | null = null;

const APPEARANCE_VIDEO_ELEMENT_ID = "appearance-bg-video";

function emit(next: AppearanceSnapshot): void {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function isPresentation(value: unknown): value is AppearancePresentation {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (item.fit === "cover" || item.fit === "contain" || item.fit === "stretch" || item.fit === "original") &&
    Number.isInteger(item.positionX) && (item.positionX as number) >= 0 && (item.positionX as number) <= 100 &&
    Number.isInteger(item.positionY) && (item.positionY as number) >= 0 && (item.positionY as number) <= 100 &&
    (item.overlayTone === "auto" || item.overlayTone === "light" || item.overlayTone === "dark") &&
    Number.isInteger(item.overlayOpacity) && (item.overlayOpacity as number) >= 0 && (item.overlayOpacity as number) <= 80 &&
    Number.isInteger(item.panelOpacity) && (item.panelOpacity as number) >= 70 && (item.panelOpacity as number) <= 100;
}

function isStoredMimeType(value: unknown): value is AppearanceStoredAssetMimeType {
  return value === "image/webp" || value === "video/mp4";
}

function isSkin(value: unknown): value is AppearanceSkinProjection {
  if (typeof value !== "object" || value === null) return false;
  const skin = value as Record<string, unknown>;
  if (!(
    typeof skin.id === "string" && /^[0-9a-f-]{36}$/i.test(skin.id) &&
    typeof skin.name === "string" && typeof skin.assetUrl === "string" &&
    typeof skin.thumbnailUrl === "string" && typeof skin.width === "number" &&
    typeof skin.height === "number" && typeof skin.bytes === "number" &&
    typeof skin.createdAt === "string" && typeof skin.updatedAt === "string" &&
    isPresentation(skin.presentation)
  )) return false;

  // Missing kind defaults to image for older wire payloads mid-rollout.
  const kind: AppearanceSkinKind = skin.kind === undefined ? "image" : skin.kind as AppearanceSkinKind;
  if (!isAppearanceSkinKind(kind)) return false;
  if (skin.mimeType !== undefined && !isStoredMimeType(skin.mimeType)) return false;
  if (kind === "video") {
    if (skin.mimeType !== undefined && skin.mimeType !== "video/mp4") return false;
    if (skin.durationMs !== undefined) {
      if (typeof skin.durationMs !== "number" || !Number.isInteger(skin.durationMs) || skin.durationMs <= 0) {
        return false;
      }
    }
  } else if (skin.mimeType !== undefined && skin.mimeType !== "image/webp") {
    return false;
  }

  return true;
}

function normalizeSkin(skin: AppearanceSkinProjection): AppearanceSkinProjection {
  const kind: AppearanceSkinKind = skin.kind ?? "image";
  return {
    ...skin,
    kind,
    mimeType: skin.mimeType ?? (kind === "video" ? "video/mp4" : "image/webp"),
  };
}

function isCatalog(value: unknown): value is AppearanceCatalogProjection {
  return typeof value === "object" && value !== null &&
    (value as { kind?: unknown }).kind === "appearance_catalog" &&
    typeof (value as { revision?: unknown }).revision === "string" &&
    Array.isArray((value as { skins?: unknown }).skins) &&
    ((value as { skins: unknown[] }).skins).every(isSkin) &&
    ((value as { activeSkinId?: unknown }).activeSkinId === null || typeof (value as { activeSkinId?: unknown }).activeSkinId === "string");
}

function activeSkin(catalog: AppearanceCatalogProjection): AppearanceSkinProjection | null {
  if (!catalog.activeSkinId) return null;
  const found = catalog.skins.find((skin) => skin.id === catalog.activeSkinId) ?? null;
  return found ? normalizeSkin(found) : null;
}

function isSafeAssetUrl(url: string, id: string, variant: "full" | "thumbnail"): boolean {
  return url === `/api/appearance/skins/${id}/asset?variant=${variant}`;
}

function getBackgroundVideoElement(): HTMLVideoElement | null {
  if (typeof document === "undefined") return null;
  const el = document.getElementById(APPEARANCE_VIDEO_ELEMENT_ID);
  return el instanceof HTMLVideoElement ? el : null;
}

/** Hard-release media resources so only one background decoder can stay warm. */
export function detachAppearanceBackgroundVideo(): void {
  const video = getBackgroundVideoElement();
  if (!video) return;
  try {
    video.pause();
  } catch {
    // ignore
  }
  video.removeAttribute("src");
  video.removeAttribute("poster");
  try {
    video.load();
  } catch {
    // ignore
  }
}

function setPlaybackDataset(state: AppearancePlaybackState | null): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!state) {
    delete root.dataset.appearancePlayback;
    return;
  }
  root.dataset.appearancePlayback = state;
}

function clearDocumentAppearance(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  delete root.dataset.appearance;
  delete root.dataset.appearanceId;
  delete root.dataset.appearanceKind;
  delete root.dataset.appearancePlayback;
  for (const property of [
    "--appearance-image",
    "--appearance-size",
    "--appearance-position-x",
    "--appearance-position-y",
    "--appearance-overlay-opacity",
    "--appearance-panel-opacity",
    "--appearance-overlay-color",
    "--appearance-video-fit",
  ]) root.style.removeProperty(property);
  detachAppearanceBackgroundVideo();
  appliedSkinId = null;
}

function applyPresentationVars(skin: AppearanceSkinProjection, imageUrl: string): void {
  const root = document.documentElement;
  const presentation = skin.presentation;
  root.dataset.appearance = "skin";
  root.dataset.appearanceId = skin.id;
  root.dataset.appearanceKind = skin.kind;
  root.style.setProperty("--appearance-image", `url(${JSON.stringify(imageUrl)})`);
  root.style.setProperty("--appearance-size", appearanceBackgroundSize(presentation.fit));
  root.style.setProperty("--appearance-position-x", `${presentation.positionX}%`);
  root.style.setProperty("--appearance-position-y", `${presentation.positionY}%`);
  root.style.setProperty("--appearance-overlay-opacity", String(presentation.overlayOpacity / 100));
  root.style.setProperty("--appearance-panel-opacity", `${presentation.panelOpacity}%`);
  if (skin.kind === "video") {
    root.style.setProperty("--appearance-video-fit", appearanceVideoObjectFit(presentation.fit));
  } else {
    root.style.removeProperty("--appearance-video-fit");
  }
  if (presentation.overlayTone === "auto") root.style.removeProperty("--appearance-overlay-color");
  else root.style.setProperty("--appearance-overlay-color", presentation.overlayTone === "light" ? "#ffffff" : "#000000");
}

async function decodeImageUrl(url: string, signal: AbortSignal): Promise<void> {
  if (typeof Image === "undefined") throw new Error("appearance_decode_failed");
  const image = new Image();
  image.src = url;
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (typeof image.decode === "function") {
    await image.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("appearance_decode_failed"));
    });
  }
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
}

function waitForVideoCanPlay(video: HTMLVideoElement, signal: AbortSignal): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("appearance_decode_failed"));
    };
    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    const cleanup = () => {
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
      signal.removeEventListener("abort", onAbort);
    };
    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Attach or release the single background video according to current policy.
 * Generation guards prevent stale async play()/canplay from overriding a newer skin.
 */
async function syncBackgroundVideo(
  skin: AppearanceSkinProjection | null,
  generation: number,
  policy: AppearancePlaybackPolicy,
): Promise<AppearancePlaybackState | null> {
  if (typeof document === "undefined") return null;
  if (!skin || skin.kind !== "video") {
    detachAppearanceBackgroundVideo();
    setPlaybackDataset(null);
    return null;
  }

  if (!isSafeAssetUrl(skin.assetUrl, skin.id, "full") || !isSafeAssetUrl(skin.thumbnailUrl, skin.id, "thumbnail")) {
    detachAppearanceBackgroundVideo();
    setPlaybackDataset("error");
    return "error";
  }

  const video = getBackgroundVideoElement();
  if (!video) {
    // Host missing (unexpected): keep poster fallback on ::before.
    setPlaybackDataset("poster");
    return "poster";
  }

  // Always force muted autoplay-friendly attributes (even if markup drifts).
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.loop = true;
  video.controls = false;
  video.disablePictureInPicture = true;
  try {
    video.disableRemotePlayback = true;
  } catch {
    // Older engines may not expose the property.
  }
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("loop", "");
  video.setAttribute("aria-hidden", "true");
  video.tabIndex = -1;
  video.poster = skin.thumbnailUrl;

  if (!shouldPlayVideo(policy)) {
    // Policy poster / hidden: do not keep a decoding pipeline warm.
    detachAppearanceBackgroundVideo();
    // Re-apply poster attr after detach (detach clears attributes).
    const again = getBackgroundVideoElement();
    if (again) again.poster = skin.thumbnailUrl;
    const state = resolveAppearancePlaybackState(policy);
    setPlaybackDataset(state);
    return state;
  }

  // Keep CSS on poster while the decoder warms so an empty video frame never paints.
  setPlaybackDataset("poster");

  const needsSrc = video.getAttribute("src") !== skin.assetUrl;
  if (needsSrc) {
    // Drop any previous decoder before attaching the next full asset.
    try {
      video.pause();
    } catch {
      // ignore
    }
    video.src = skin.assetUrl;
    try {
      video.load();
    } catch {
      // ignore
    }
  }

  // Ready waits abort via videoReadyAbort when publish bumps applyGeneration.
  const controller = new AbortController();
  if (videoReadyAbort) videoReadyAbort.abort();
  videoReadyAbort = controller;
  try {
    await waitForVideoCanPlay(video, controller.signal);
    if (generation !== applyGeneration) return null;
    const playResult = video.play();
    if (playResult !== undefined) await playResult;
    if (generation !== applyGeneration) return null;
    setPlaybackDataset("playing");
    return "playing";
  } catch (error) {
    if (generation !== applyGeneration) return null;
    if ((error as { name?: string }).name === "AbortError") return null;
    // Autoplay blocked or decode failure → keep poster layer, release decoder.
    detachAppearanceBackgroundVideo();
    const host = getBackgroundVideoElement();
    if (host) host.poster = skin.thumbnailUrl;
    // Distinguish hard media error vs autoplay block: both use poster paint;
    // surface "error" only when the element reported a media error.
    const state: AppearancePlaybackState = video.error ? "error" : "poster";
    setPlaybackDataset(state);
    return state;
  } finally {
    if (videoReadyAbort === controller) videoReadyAbort = null;
  }
}

/**
 * Applies a server-confirmed catalog only after a newly active full asset is ready.
 * Image path still decodes before paint; video path paints poster first then attaches src.
 * Exported for immediate-save Settings mutations; also notifies peers.
 */
export async function publishAppearanceCatalog(catalog: AppearanceCatalogProjection, notifyPeers = true): Promise<boolean> {
  if (!isCatalog(catalog)) return false;
  const nextSkin = activeSkin(catalog);
  const generation = ++applyGeneration;
  // Cancel any in-flight video canplay/play so a stale generation cannot win.
  videoReadyAbort?.abort();
  videoReadyAbort = null;
  const policy = readAppearancePlaybackPolicy();
  const currentId = appliedSkinId ??
    (typeof document === "undefined" ? null : document.documentElement.dataset.appearanceId ?? null);

  try {
    if (!nextSkin) {
      if (generation !== applyGeneration) return false;
      clearDocumentAppearance();
      emit({
        catalog,
        error: null,
        loading: false,
        playback: null,
        userPosterOnly: policy.userPosterOnly,
      });
      if (notifyPeers) channel?.postMessage({ kind: "appearance_changed" });
      return true;
    }

    if (nextSkin.kind === "image") {
      if (!isSafeAssetUrl(nextSkin.assetUrl, nextSkin.id, "full")) {
        throw new Error("appearance_decode_failed");
      }
      if (currentId !== nextSkin.id) {
        const controller = new AbortController();
        await decodeImageUrl(nextSkin.assetUrl, controller.signal);
      }
      if (generation !== applyGeneration) return false;
      detachAppearanceBackgroundVideo();
      applyPresentationVars(nextSkin, nextSkin.assetUrl);
      setPlaybackDataset(null);
      appliedSkinId = nextSkin.id;
      emit({
        catalog,
        error: null,
        loading: false,
        playback: null,
        userPosterOnly: policy.userPosterOnly,
      });
      if (notifyPeers) channel?.postMessage({ kind: "appearance_changed" });
      return true;
    }

    // Video: always ensure poster is on ::before before attempting motion.
    if (!isSafeAssetUrl(nextSkin.thumbnailUrl, nextSkin.id, "thumbnail") ||
      !isSafeAssetUrl(nextSkin.assetUrl, nextSkin.id, "full")) {
      throw new Error("appearance_decode_failed");
    }

    if (currentId !== nextSkin.id) {
      const controller = new AbortController();
      // Decode poster first so we never black-flash on switch.
      await decodeImageUrl(nextSkin.thumbnailUrl, controller.signal);
    }
    if (generation !== applyGeneration) return false;

    applyPresentationVars(nextSkin, nextSkin.thumbnailUrl);
    appliedSkinId = nextSkin.id;
    const playback = await syncBackgroundVideo(nextSkin, generation, policy);
    if (generation !== applyGeneration) return false;

    emit({
      catalog,
      error: playback === "error" ? "appearance_decode_failed" : null,
      loading: false,
      playback,
      userPosterOnly: policy.userPosterOnly,
    });
    if (notifyPeers) channel?.postMessage({ kind: "appearance_changed" });
    return playback !== "error";
  } catch (error) {
    if ((error as { name?: string }).name === "AbortError") return false;
    if (generation === applyGeneration) {
      // Keep previous painted layer if decode of a *new* skin failed; still store catalog.
      emit({
        ...snapshot,
        catalog,
        error: "appearance_decode_failed",
        loading: false,
        userPosterOnly: policy.userPosterOnly,
      });
    }
    return false;
  }
}

/**
 * Re-evaluate policy against the already-published active video without refetch.
 * Used for visibility / reduced-motion / poster-only / save-data changes.
 */
async function reapplyActiveVideoPolicy(): Promise<void> {
  const catalog = snapshot.catalog;
  if (!catalog) return;
  const skin = activeSkin(catalog);
  const policy = readAppearancePlaybackPolicy();
  if (!skin || skin.kind !== "video") {
    emit({ ...snapshot, playback: null, userPosterOnly: policy.userPosterOnly });
    return;
  }
  // Cancel any in-flight attach from a previous policy/publish pass.
  videoReadyAbort?.abort();
  videoReadyAbort = null;
  const generation = applyGeneration;
  const playback = await syncBackgroundVideo(skin, generation, policy);
  if (generation !== applyGeneration) return;
  let nextError = snapshot.error;
  if (playback === "error") nextError = "appearance_decode_failed";
  else if (snapshot.error === "appearance_decode_failed") nextError = null;
  emit({
    ...snapshot,
    playback,
    userPosterOnly: policy.userPosterOnly,
    error: nextError,
  });
}

/** Toggle browser-local static-cover preference and reapply policy immediately. */
export async function setAppearancePosterOnly(value: boolean): Promise<void> {
  writeUserPosterOnlyPreference(value);
  await reapplyActiveVideoPolicy();
}

async function refreshAppearance(): Promise<void> {
  refreshController?.abort();
  const controller = new AbortController();
  refreshController = controller;
  emit({ ...snapshot, loading: true, error: null });
  try {
    const response = await fetch("/api/appearance", { cache: "no-store", signal: controller.signal });
    const payload: unknown = await response.json();
    if (!response.ok || !isCatalog(payload)) throw new Error("appearance_unavailable");
    await publishAppearanceCatalog(payload, false);
  } catch (error) {
    if ((error as { name?: string }).name !== "AbortError") {
      emit({ ...snapshot, loading: false, error: "appearance_unavailable" });
    }
  } finally {
    if (refreshController === controller) refreshController = null;
  }
}

function onPolicyEnvironmentChange(): void {
  void reapplyActiveVideoPolicy();
}

function attachPolicyListeners(): void {
  if (typeof window === "undefined" || policyListenersAttached) return;
  policyListenersAttached = true;
  document.addEventListener("visibilitychange", onPolicyEnvironmentChange);
  window.addEventListener("focus", onPolicyEnvironmentChange);
  try {
    reducedMotionMql = window.matchMedia("(prefers-reduced-motion: reduce)");
    // Safari < 14 uses addListener.
    if (typeof reducedMotionMql.addEventListener === "function") {
      reducedMotionMql.addEventListener("change", onPolicyEnvironmentChange);
    } else if (typeof reducedMotionMql.addListener === "function") {
      reducedMotionMql.addListener(onPolicyEnvironmentChange);
    }
  } catch {
    reducedMotionMql = null;
  }
  // Best-effort Save-Data change (Chromium Network Information API).
  try {
    const connection = (navigator as { connection?: EventTarget & { saveData?: boolean } }).connection;
    connection?.addEventListener?.("change", onPolicyEnvironmentChange);
  } catch {
    // ignore
  }
  window.addEventListener("storage", (event: StorageEvent) => {
    if (event.key === null || event.key === APPEARANCE_POSTER_ONLY_STORAGE_KEY) {
      onPolicyEnvironmentChange();
    }
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window !== "undefined") {
    channelRefCount += 1;
    if (!channel && typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel("pi-web-appearance-v1");
      channel.onmessage = (event: MessageEvent<{ kind?: unknown }>) => {
        if (event.data?.kind === "appearance_changed") void refreshAppearance();
      };
    }
    if (channelRefCount === 1) attachPolicyListeners();
  }
  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined") {
      channelRefCount -= 1;
      if (channelRefCount === 0) {
        channel?.close();
        channel = null;
        // Leave policy listeners attached for the SPA lifetime; reattach is idempotent
        // only when channelRefCount hits 1 again — reset flag so a future mount rebinds.
        if (policyListenersAttached) {
          document.removeEventListener("visibilitychange", onPolicyEnvironmentChange);
          window.removeEventListener("focus", onPolicyEnvironmentChange);
          if (reducedMotionMql) {
            if (typeof reducedMotionMql.removeEventListener === "function") {
              reducedMotionMql.removeEventListener("change", onPolicyEnvironmentChange);
            } else if (typeof reducedMotionMql.removeListener === "function") {
              reducedMotionMql.removeListener(onPolicyEnvironmentChange);
            }
            reducedMotionMql = null;
          }
          try {
            const connection = (navigator as { connection?: EventTarget }).connection;
            connection?.removeEventListener?.("change", onPolicyEnvironmentChange);
          } catch {
            // ignore
          }
          policyListenersAttached = false;
        }
      }
    }
  };
}

function getSnapshot(): AppearanceSnapshot { return snapshot; }
function getServerSnapshot(): AppearanceSnapshot { return EMPTY_SNAPSHOT; }

/** Client appearance domain: bootstrap is server-rendered; refresh is focus-driven, never polled. */
export function useAppearance() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const refresh = useCallback(() => refreshAppearance(), []);
  const setPosterOnly = useCallback((value: boolean) => setAppearancePosterOnly(value), []);

  useEffect(() => {
    void refreshAppearance();
    const revalidate = () => {
      if (document.visibilityState === "visible") void refreshAppearance();
    };
    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidate);
    };
  }, []);

  return {
    ...state,
    refresh,
    publish: publishAppearanceCatalog,
    setPosterOnly,
  };
}

export type { AppearancePresentation, AppearancePlaybackState, AppearancePlaybackPolicy };
export { shouldPlayVideo, resolveAppearancePlaybackState };
