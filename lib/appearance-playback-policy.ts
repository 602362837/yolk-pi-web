/**
 * Pure playback policy for decorative MP4 background skins.
 *
 * Browser listeners and the single #appearance-bg-video element live in
 * hooks/useAppearance.ts; this module only decides whether motion is allowed
 * and which data-appearance-playback token to expose.
 */

export const APPEARANCE_POSTER_ONLY_STORAGE_KEY = "pi-appearance-poster-only";

export type AppearancePlaybackPolicy = {
  reducedMotion: boolean;
  documentVisible: boolean;
  /** Network Information API Save-Data; treat missing as false. */
  saveData: boolean;
  /** Browser-local preference; not part of server catalog. */
  userPosterOnly: boolean;
};

/** DOM/CSS playback tokens consumed by app/globals.css. */
export type AppearancePlaybackState =
  | "playing"
  | "poster"
  | "paused-hidden"
  | "error"
  | "loading";

export function shouldPlayVideo(policy: AppearancePlaybackPolicy): boolean {
  return (
    policy.documentVisible &&
    !policy.reducedMotion &&
    !policy.userPosterOnly &&
    !policy.saveData
  );
}

/**
 * Map policy (+ optional hard failure) to a CSS token without side effects.
 * Callers still own pause()/detach and autoplay catch → poster/error.
 */
export function resolveAppearancePlaybackState(
  policy: AppearancePlaybackPolicy,
  options: { error?: boolean; loading?: boolean } = {},
): AppearancePlaybackState {
  if (options.error) return "error";
  if (!policy.documentVisible) return "paused-hidden";
  if (policy.reducedMotion || policy.userPosterOnly || policy.saveData) return "poster";
  if (options.loading) return "loading";
  return "playing";
}

/** Read the browser-local "static cover only" preference. Safe for SSR (false). */
export function readUserPosterOnlyPreference(
  storage: Pick<Storage, "getItem"> | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(APPEARANCE_POSTER_ONLY_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeUserPosterOnlyPreference(
  value: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined = typeof localStorage === "undefined" ? null : localStorage,
): void {
  if (!storage) return;
  try {
    if (value) storage.setItem(APPEARANCE_POSTER_ONLY_STORAGE_KEY, "1");
    else storage.removeItem(APPEARANCE_POSTER_ONLY_STORAGE_KEY);
  } catch {
    // Private mode / blocked storage must not break catalog apply.
  }
}

/** Best-effort Save-Data flag; absent Network Information API → false. */
export function readSaveDataPreference(
  nav: { connection?: { saveData?: boolean } } | null | undefined = typeof navigator === "undefined"
    ? null
    : (navigator as { connection?: { saveData?: boolean } }),
): boolean {
  return Boolean(nav?.connection?.saveData);
}

export function readDocumentVisible(
  doc: Pick<Document, "visibilityState"> | null | undefined = typeof document === "undefined" ? null : document,
): boolean {
  if (!doc) return true;
  return doc.visibilityState === "visible";
}

export function readReducedMotionPreference(
  matchMediaFn: ((query: string) => { matches: boolean }) | null | undefined = typeof window === "undefined"
    ? null
    : window.matchMedia.bind(window),
): boolean {
  if (!matchMediaFn) return false;
  try {
    return matchMediaFn("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Snapshot current browser policy inputs for shouldPlayVideo / resolve state. */
export function readAppearancePlaybackPolicy(): AppearancePlaybackPolicy {
  return {
    reducedMotion: readReducedMotionPreference(),
    documentVisible: readDocumentVisible(),
    saveData: readSaveDataPreference(),
    userPosterOnly: readUserPosterOnlyPreference(),
  };
}
