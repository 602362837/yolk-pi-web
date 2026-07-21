/**
 * Browser-safe contracts for the background-skin domain.
 *
 * This module intentionally contains no filesystem paths or image/video bytes.
 * The server store keeps its internal schema separate from these wire projections.
 */

export const APPEARANCE_SCHEMA_VERSION = 1;
export const APPEARANCE_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Soft threshold: larger videos require explicit user confirmation, not an immediate rejection. */
export const APPEARANCE_RECOMMENDED_VIDEO_UPLOAD_BYTES = 50 * 1024 * 1024;
/** Hard safety ceiling; storage quota and server resource limits still apply. */
export const APPEARANCE_MAX_VIDEO_UPLOAD_BYTES = 1024 * 1024 * 1024;
// Kept in the wire contract for compatibility; MP4 duration/resolution are not policy limits.
export const APPEARANCE_MAX_VIDEO_DURATION_MS = Number.MAX_SAFE_INTEGER;
export const APPEARANCE_MAX_VIDEO_LONG_EDGE = Number.MAX_SAFE_INTEGER;
export const APPEARANCE_MAX_PIXELS = 40_000_000;
export const APPEARANCE_MAX_LONG_EDGE = 4096;
export const APPEARANCE_THUMBNAIL_MAX_EDGE = 360;
export const APPEARANCE_MAX_SKINS = 30;
/** Shared catalog budget for image full/thumb plus video full/poster bytes. */
export const APPEARANCE_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const APPEARANCE_NAME_MAX_LENGTH = 80;

export const APPEARANCE_IMAGE_ACCEPTED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const APPEARANCE_VIDEO_ACCEPTED_MIME_TYPES = ["video/mp4"] as const;
export const APPEARANCE_ACCEPTED_MIME_TYPES = [
  ...APPEARANCE_IMAGE_ACCEPTED_MIME_TYPES,
  ...APPEARANCE_VIDEO_ACCEPTED_MIME_TYPES,
] as const;

export type AppearanceSkinKind = "image" | "video";
export type AppearanceStoredAssetMimeType = "image/webp" | "video/mp4";
export type AppearanceFit = "cover" | "contain" | "stretch" | "original";
export type AppearanceOverlayTone = "auto" | "light" | "dark";

export interface AppearancePresentation {
  fit: AppearanceFit;
  positionX: number;
  positionY: number;
  overlayTone: AppearanceOverlayTone;
  overlayOpacity: number;
  panelOpacity: number;
}

export const DEFAULT_APPEARANCE_PRESENTATION: Readonly<AppearancePresentation> = {
  fit: "cover",
  positionX: 50,
  positionY: 50,
  overlayTone: "auto",
  overlayOpacity: 18,
  panelOpacity: 90,
};

export interface AppearanceAssetMetadata {
  mimeType: AppearanceStoredAssetMimeType;
  width: number;
  height: number;
  bytes: number;
  thumbnailBytes: number;
  /** Present only for video skins; integer milliseconds in (0, max]. */
  durationMs?: number;
}

/** Server-only persisted metadata. Never return it as an API response directly. */
export interface AppearanceSkinRecordV1 {
  id: string;
  name: string;
  /** Missing on disk is treated as image by the store reader. */
  kind: AppearanceSkinKind;
  createdAt: string;
  updatedAt: string;
  sourceName?: string;
  asset: AppearanceAssetMetadata;
  presentation: AppearancePresentation;
}

export interface AppearanceIndexV1 {
  schemaVersion: 1;
  activeSkinId: string | null;
  skins: AppearanceSkinRecordV1[];
  updatedAt: string;
}

export interface AppearanceSkinProjection {
  id: string;
  name: string;
  kind: AppearanceSkinKind;
  width: number;
  height: number;
  bytes: number;
  mimeType: AppearanceStoredAssetMimeType;
  durationMs?: number;
  createdAt: string;
  updatedAt: string;
  presentation: AppearancePresentation;
  assetUrl: string;
  thumbnailUrl: string;
}

export interface AppearanceCatalogProjection {
  kind: "appearance_catalog";
  revision: string;
  activeSkinId: string | null;
  skins: AppearanceSkinProjection[];
  limits: {
    maxUploadBytes: number;
    maxVideoUploadBytes: number;
    recommendedVideoUploadBytes: number;
    maxVideoDurationMs: number;
    maxVideoLongEdge: number;
    maxPixels: number;
    maxLongEdge: number;
    maxSkins: number;
    maxTotalBytes: number;
    acceptedMimeTypes: readonly (typeof APPEARANCE_ACCEPTED_MIME_TYPES)[number][];
  };
  warnings?: string[];
}

export function isAppearanceSkinKind(value: unknown): value is AppearanceSkinKind {
  return value === "image" || value === "video";
}

/** Resolve on-disk optional kind; unknown values fail closed at the caller. */
export function resolveAppearanceSkinKind(value: unknown): AppearanceSkinKind | null {
  if (value === undefined) return "image";
  return isAppearanceSkinKind(value) ? value : null;
}

export function isAppearanceFit(value: unknown): value is AppearanceFit {
  return value === "cover" || value === "contain" || value === "stretch" || value === "original";
}

export function isAppearanceOverlayTone(value: unknown): value is AppearanceOverlayTone {
  return value === "auto" || value === "light" || value === "dark";
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function isAppearancePresentation(value: unknown): value is AppearancePresentation {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const presentation = value as Record<string, unknown>;
  return (
    isAppearanceFit(presentation.fit) &&
    isIntegerInRange(presentation.positionX, 0, 100) &&
    isIntegerInRange(presentation.positionY, 0, 100) &&
    isAppearanceOverlayTone(presentation.overlayTone) &&
    isIntegerInRange(presentation.overlayOpacity, 0, 80) &&
    isIntegerInRange(presentation.panelOpacity, 70, 100)
  );
}

export function validateAppearancePresentation(value: unknown): AppearancePresentation | null {
  if (!isAppearancePresentation(value)) return null;
  return {
    fit: value.fit,
    positionX: value.positionX,
    positionY: value.positionY,
    overlayTone: value.overlayTone,
    overlayOpacity: value.overlayOpacity,
    panelOpacity: value.panelOpacity,
  };
}

/** Clean a display name without using it as a filename or path. */
export function sanitizeAppearanceName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name || Array.from(name).length > APPEARANCE_NAME_MAX_LENGTH) return null;
  return name;
}

export function appearanceBackgroundSize(fit: AppearanceFit): "cover" | "contain" | "100% 100%" | "auto" {
  switch (fit) {
    case "cover": return "cover";
    case "contain": return "contain";
    case "stretch": return "100% 100%";
    case "original": return "auto";
  }
}

/** Map presentation fit to HTML video object-fit values. */
export function appearanceVideoObjectFit(fit: AppearanceFit): "cover" | "contain" | "fill" | "none" {
  switch (fit) {
    case "cover": return "cover";
    case "contain": return "contain";
    case "stretch": return "fill";
    case "original": return "none";
  }
}
