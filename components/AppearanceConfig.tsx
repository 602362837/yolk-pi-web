"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppearance } from "@/hooks/useAppearance";
import type {
  AppearanceCatalogProjection,
  AppearanceFit,
  AppearanceOverlayTone,
  AppearancePresentation,
  AppearanceSkinProjection,
} from "@/lib/appearance-types";
import type { AppearancePlaybackState } from "@/lib/appearance-playback-policy";
import { usePrompt } from "./AppPromptProvider";

const FITS: Array<{ value: AppearanceFit; label: string; note: string }> = [
  { value: "cover", label: "覆盖裁剪", note: "保持比例并铺满视口" },
  { value: "contain", label: "完整显示", note: "完整保留画面，可能留白" },
  { value: "stretch", label: "拉伸", note: "铺满视口，可能改变比例" },
  { value: "original", label: "原始尺寸", note: "不放大，按原始尺寸定位" },
];
const TONES: Array<{ value: AppearanceOverlayTone; label: string }> = [
  { value: "auto", label: "自动" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
];
const ANCHORS = [
  { x: 0, y: 0, label: "左上" },
  { x: 50, y: 0, label: "上方居中" },
  { x: 100, y: 0, label: "右上" },
  { x: 0, y: 50, label: "左侧居中" },
  { x: 50, y: 50, label: "居中" },
  { x: 100, y: 50, label: "右侧居中" },
  { x: 0, y: 100, label: "左下" },
  { x: 50, y: 100, label: "下方居中" },
  { x: 100, y: 100, label: "右下" },
];

const ACCEPT_ATTR = "image/jpeg,image/png,image/webp,video/mp4";

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MiB`
    : `${Math.max(0, Math.round(bytes / 1024))} KiB`;
}

function formatDuration(durationMs: number | undefined): string | null {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs <= 0) return null;
  const seconds = Math.max(1, Math.round(durationMs / 1000));
  return `${seconds}s`;
}

function isVideoFile(file: File): boolean {
  if (file.type === "video/mp4") return true;
  // Some browsers leave type empty for local picks; extension is only a soft hint.
  return !file.type && /\.mp4$/i.test(file.name);
}

function safeError(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && typeof (payload as { code?: unknown }).code === "string") {
    const code = (payload as { code: string }).code;
    const copy: Record<string, string> = {
      revision_conflict: "配置已在其他标签页变化，已刷新，请重新调整。",
      file_too_large: "文件超过服务器安全上限。",
      oversize_confirmation_required: "视频较大，需要确认后才能继续上传。",
      unsupported_media: "只支持 JPEG、PNG、静态 WebP 或 MP4。",
      animated_image: "不支持动画图片。",
      pixel_limit: "图片像素超过限制。",
      invalid_media: "无法解析该媒体文件。",
      decode_failed: "媒体处理失败，请换一个文件重试。",
      poster_required: "视频需要可用封面，请重试或更换文件。",
      catalog_limit: "皮肤数量已达上限。",
      storage_limit: "皮肤存储空间已达上限。",
      skin_active: "当前皮肤需要确认后才能删除。",
      appearance_decode_failed: "媒体无法在浏览器中显示，已保留原背景。",
      processing_busy: "外观处理繁忙，请稍后再试。",
    };
    return copy[code] ?? fallback;
  }
  return fallback;
}

function playbackStatusLabel(
  playback: AppearancePlaybackState | null,
  userPosterOnly: boolean,
  isActiveVideo: boolean,
): string | null {
  if (!isActiveVideo) return null;
  if (userPosterOnly) return "用户选择仅静态封面 · 动态背景已暂停";
  switch (playback) {
    case "playing":
      return "动态背景播放中（静音循环）";
    case "paused-hidden":
      return "标签页不可见 · 已暂停解码";
    case "loading":
      return "正在准备动态背景…";
    case "error":
      return "视频解码失败 · 已显示封面";
    case "poster":
      return "已按策略显示静态封面（减少动态效果 / 省流 / 自动播放受限）";
    default:
      return "动态背景状态未知";
  }
}

export function AppearanceConfig() {
  const { catalog, loading, error, refresh, publish, playback, userPosterOnly, setPosterOnly } = useAppearance();
  const { confirm, prompt } = usePrompt();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draftPresentation, setDraftPresentation] = useState<AppearancePresentation | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const presentationSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = useMemo(
    () => catalog?.skins.find((skin) => skin.id === selectedId) ?? null,
    [catalog, selectedId],
  );
  const activeSkin = useMemo(
    () => catalog?.skins.find((skin) => skin.id === catalog.activeSkinId) ?? null,
    [catalog],
  );
  const selectedIsVideo = selected?.kind === "video";
  const activeIsVideo = activeSkin?.kind === "video";

  useEffect(() => {
    if (!catalog) return;
    setSelectedId((current) =>
      current !== null && catalog.skins.some((skin) => skin.id === current)
        ? current
        : catalog.activeSkinId,
    );
  }, [catalog]);

  // Resync only when the server catalog identity/version changes, not on every draft keystroke.
  useEffect(() => {
    if (presentationSaveTimer.current) {
      clearTimeout(presentationSaveTimer.current);
      presentationSaveTimer.current = null;
    }
    setDraftPresentation(selected?.presentation ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional selected identity/version keys
  }, [selected?.id, selected?.updatedAt]);

  useEffect(
    () => () => {
      if (presentationSaveTimer.current) clearTimeout(presentationSaveTimer.current);
    },
    [],
  );

  const consumeCatalog = useCallback(
    async (response: Response): Promise<AppearanceCatalogProjection | null> => {
      const body: unknown = await response.json().catch(() => null);
      if (
        !response.ok ||
        typeof body !== "object" ||
        body === null ||
        (body as { kind?: unknown }).kind !== "appearance_catalog"
      ) {
        setMessage(safeError(body, "外观操作失败，请稍后重试。"));
        if (response.status === 409) void refresh();
        return null;
      }
      return body as AppearanceCatalogProjection;
    },
    [refresh],
  );

  const applyCatalog = useCallback(
    async (next: AppearanceCatalogProjection, success?: string) => {
      const applied = await publish(next);
      if (!applied && next.activeSkinId) {
        setMessage("媒体无法在浏览器中显示，已保留原背景。");
      } else if (success) {
        setMessage(success);
      }
    },
    [publish],
  );

  const switchActive = useCallback(
    async (id: string | null) => {
      if (!catalog || catalog.activeSkinId === id) return;
      setSelectedId(id);
      setBusy(`switch:${id ?? "default"}`);
      setMessage(null);
      try {
        const response = await fetch("/api/appearance", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": catalog.revision },
          body: JSON.stringify({ activeSkinId: id }),
        });
        const next = await consumeCatalog(response);
        if (next) {
          const nextActive = next.skins.find((skin) => skin.id === next.activeSkinId) ?? null;
          const success = id
            ? nextActive?.kind === "video"
              ? "已应用视频皮肤。"
              : "已应用皮肤。"
            : "已恢复默认外观。";
          await applyCatalog(next, success);
        }
      } catch {
        setMessage("网络错误，未更改当前外观。");
      } finally {
        setBusy(null);
      }
    },
    [applyCatalog, catalog, consumeCatalog],
  );

  const upload = useCallback(
    async (file: File) => {
      if (!catalog) return;

      const video = isVideoFile(file);
      // Empty browser MIME still reaches the server content-signature check; only reject known bad types client-side.
      if (file.type) {
        if (!catalog.limits.acceptedMimeTypes.includes(file.type as (typeof catalog.limits.acceptedMimeTypes)[number])) {
          setMessage("只支持 JPEG、PNG、静态 WebP 或 MP4。");
          return;
        }
      } else if (!video && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
        setMessage("只支持 JPEG、PNG、静态 WebP 或 MP4。");
        return;
      }

      const maxBytes = video ? catalog.limits.maxVideoUploadBytes : catalog.limits.maxUploadBytes;
      if (file.size > maxBytes) {
        setMessage(video ? "视频超过服务器安全上限。" : "图片超过上传大小限制。");
        return;
      }
      let oversizeConfirmed = false;
      if (video && file.size > catalog.limits.recommendedVideoUploadBytes) {
        oversizeConfirmed = await confirm({
          title: "视频文件较大，继续上传？",
          message: `该 MP4 大小为 ${formatBytes(file.size)}，超过推荐值 ${formatBytes(catalog.limits.recommendedVideoUploadBytes)}。上传和处理可能较慢，也会占用更多存储与播放资源。确认继续吗？`,
          confirmLabel: "继续上传",
          intent: "default",
        });
        if (!oversizeConfirmed) {
          setMessage("已取消大文件上传。");
          return;
        }
      }

      setBusy("upload");
      setMessage(video ? "正在校验视频并生成封面…" : "正在安全处理图片…");
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("revision", catalog.revision);
        if (oversizeConfirmed) form.append("confirmOversize", "true");
        const response = await fetch("/api/appearance/skins", { method: "POST", body: form });
        const next = await consumeCatalog(response);
        if (next) {
          setSelectedId(next.activeSkinId);
          const nextActive = next.skins.find((skin) => skin.id === next.activeSkinId) ?? null;
          const success =
            nextActive?.kind === "video" ? "视频皮肤已上传并应用。" : "皮肤已上传并应用。";
          await applyCatalog(next, success);
        }
      } catch {
        setMessage("上传失败，请检查网络后重试。");
      } finally {
        setBusy(null);
        if (uploadRef.current) uploadRef.current.value = "";
      }
    },
    [applyCatalog, catalog, confirm, consumeCatalog],
  );

  const patchSkin = useCallback(
    async (skin: AppearanceSkinProjection, patch: { name?: string; presentation?: AppearancePresentation }) => {
      if (!catalog) return;
      setBusy(`patch:${skin.id}`);
      setMessage(null);
      try {
        const response = await fetch(`/api/appearance/skins/${skin.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "If-Match": catalog.revision },
          body: JSON.stringify(patch),
        });
        const next = await consumeCatalog(response);
        if (next) await applyCatalog(next, "已即时保存。");
      } catch {
        setMessage("网络错误，未保存此修改。");
      } finally {
        setBusy(null);
      }
    },
    [applyCatalog, catalog, consumeCatalog],
  );

  const rename = useCallback(
    async (skin: AppearanceSkinProjection) => {
      const name = await prompt({
        title: "重命名皮肤",
        message: "名称会立即保存。",
        initialValue: skin.name,
        confirmLabel: "保存",
        validate: (value) => (value.trim() ? null : "请输入名称"),
      });
      if (name === null || name.trim() === skin.name) return;
      await patchSkin(skin, { name: name.trim() });
    },
    [patchSkin, prompt],
  );

  const remove = useCallback(
    async (skin: AppearanceSkinProjection) => {
      if (!catalog) return;
      const active = catalog.activeSkinId === skin.id;
      const isVideo = skin.kind === "video";
      const ok = await confirm({
        title: active ? (isVideo ? "删除当前动态皮肤？" : "删除当前皮肤？") : "删除皮肤？",
        message: active
          ? isVideo
            ? `“${skin.name}” 删除后会立即切回默认外观，并移除 MP4 与封面，此操作无法撤销。`
            : `“${skin.name}” 删除后会立即切回默认外观，此操作无法撤销。`
          : `确定删除“${skin.name}”吗？此操作无法撤销。`,
        confirmLabel: active ? "切回默认并删除" : "删除",
        intent: "danger",
      });
      if (!ok) return;
      setBusy(`delete:${skin.id}`);
      setMessage(null);
      try {
        const response = await fetch(`/api/appearance/skins/${skin.id}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json", "If-Match": catalog.revision },
          body: JSON.stringify(active ? { deactivateActive: true } : {}),
        });
        const next = await consumeCatalog(response);
        if (next) {
          setSelectedId(next.activeSkinId);
          await applyCatalog(
            next,
            active ? "已恢复默认外观并删除皮肤。" : "皮肤已删除。",
          );
        }
      } catch {
        setMessage("网络错误，未删除皮肤。");
      } finally {
        setBusy(null);
      }
    },
    [applyCatalog, catalog, confirm, consumeCatalog],
  );

  const updatePresentation = useCallback(
    (patch: Partial<AppearancePresentation>) => {
      if (!selected) return;
      setDraftPresentation((current) => {
        const next = { ...(current ?? selected.presentation), ...patch };
        if (presentationSaveTimer.current) clearTimeout(presentationSaveTimer.current);
        // Continuous slider/anchor edits share one revision CAS; debounce avoids 409 storms.
        presentationSaveTimer.current = setTimeout(() => {
          void patchSkin(selected, { presentation: next });
        }, 280);
        return next;
      });
    },
    [patchSkin, selected],
  );

  const drop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const files = event.dataTransfer.files;
      if (files.length !== 1) {
        setMessage("请一次拖入一张图片或一个 MP4 视频。");
        return;
      }
      void upload(files[0]);
    },
    [upload],
  );

  const onPosterOnlyChange = useCallback(
    (checked: boolean) => {
      void setPosterOnly(checked);
      setMessage(
        checked
          ? "已开启仅静态封面（仅本浏览器，不写入服务器）。"
          : "已恢复动态背景播放策略。",
      );
    },
    [setPosterOnly],
  );

  const statusLine = useMemo(() => {
    if (message) return message;
    if (error === "appearance_decode_failed") return "媒体无法在浏览器中显示，已保留原背景。";
    if (error) return error;
    if (catalog?.warnings?.[0]) return catalog.warnings[0];
    return playbackStatusLabel(playback, userPosterOnly, activeIsVideo);
  }, [activeIsVideo, catalog?.warnings, error, message, playback, userPosterOnly]);

  const imageLimitMiB = catalog ? Math.round(catalog.limits.maxUploadBytes / 1024 / 1024) : 20;
  const videoLimitMiB = catalog ? Math.round(catalog.limits.maxVideoUploadBytes / 1024 / 1024) : 1024;
  const videoRecommendedMiB = catalog ? Math.round(catalog.limits.recommendedVideoUploadBytes / 1024 / 1024) : 50;

  if (!catalog && loading) {
    return <div className="appearance-config__empty">正在加载外观…</div>;
  }

  return (
    <div className="appearance-config">
      <header className="appearance-config__header">
        <div>
          <h3>外观与网页背景</h3>
          <p>背景皮肤操作会即时保存，不会写入通用 Settings 草稿。视频将静音循环播放。</p>
        </div>
        <button type="button" onClick={() => void refresh()} disabled={loading || busy !== null}>
          刷新
        </button>
      </header>

      {statusLine && (
        <div className="appearance-config__notice" role="status" aria-live="polite">
          {statusLine}
        </div>
      )}

      {!catalog ? (
        <div className="appearance-config__empty">
          无法加载外观。
          <button type="button" onClick={() => void refresh()}>
            重试
          </button>
        </div>
      ) : (
        <div className="appearance-config__grid">
          <section className="appearance-library" aria-label="背景皮肤库">
            <button
              type="button"
              className={`appearance-skin-card ${catalog.activeSkinId === null ? "is-active" : ""}`}
              aria-pressed={catalog.activeSkinId === null}
              onClick={() => void switchActive(null)}
              disabled={busy !== null}
            >
              <span className="appearance-default-swatch" aria-hidden="true" />
              <span>
                <strong>默认外观</strong>
                <small>恢复现有纯色界面</small>
              </span>
              {catalog.activeSkinId === null && <b>当前使用</b>}
            </button>

            <div
              className="appearance-upload"
              onDragOver={(event) => event.preventDefault()}
              onDrop={drop}
            >
              <input
                ref={uploadRef}
                type="file"
                accept={ACCEPT_ATTR}
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy !== null}>
                {busy === "upload" ? "正在处理…" : "上传背景图片或 MP4"}
              </button>
              <span>
                JPEG / PNG / 静态 WebP / MP4（单文件）。
                <br />
                图片：≤{imageLimitMiB} MiB。
                <br />
                视频：推荐≤{videoRecommendedMiB} MiB，超过后需确认；安全上限≤{videoLimitMiB} MiB · 静音循环。
              </span>
            </div>

            <div className="appearance-skin-list">
              {catalog.skins.map((skin) => {
                const duration = skin.kind === "video" ? formatDuration(skin.durationMs) : null;
                const meta = duration
                  ? `${skin.width} × ${skin.height} · ${duration} · ${formatBytes(skin.bytes)}`
                  : `${skin.width} × ${skin.height} · ${formatBytes(skin.bytes)}`;
                return (
                  <div
                    key={skin.id}
                    className={`appearance-skin-card ${catalog.activeSkinId === skin.id ? "is-active" : ""} ${selectedId === skin.id ? "is-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="appearance-skin-card__select"
                      aria-pressed={catalog.activeSkinId === skin.id}
                      onClick={() => {
                        setSelectedId(skin.id);
                        void switchActive(skin.id);
                      }}
                      disabled={busy !== null}
                    >
                      <span className="appearance-skin-thumb" aria-hidden="true">
                        {/* Skin assets are opaque, private API URLs; next/image cannot optimize them without changing cache semantics. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={skin.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                        <span className="appearance-skin-kind">
                          {skin.kind === "video" ? "视频" : "图片"}
                        </span>
                      </span>
                      <span>
                        <strong>{skin.name}</strong>
                        <small>{meta}</small>
                      </span>
                      {catalog.activeSkinId === skin.id && <b>当前使用</b>}
                    </button>
                    <div className="appearance-skin-card__actions">
                      <button type="button" onClick={() => void rename(skin)} disabled={busy !== null}>
                        重命名
                      </button>
                      <button type="button" onClick={() => void remove(skin)} disabled={busy !== null}>
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <small className="appearance-library__limit">
              {catalog.skins.length} / {catalog.limits.maxSkins} 皮肤 · 图片≤{imageLimitMiB} MiB · 视频推荐≤{videoRecommendedMiB} MiB，安全上限≤{videoLimitMiB} MiB
            </small>
          </section>

          <section className="appearance-editor" aria-label="皮肤显示设置">
            {selected && draftPresentation ? (
              <>
                <div
                  className={`appearance-preview ${selectedIsVideo ? "is-video" : ""}`}
                  style={{
                    // Preview uses poster/thumbnail only — never a second full MP4 decoder.
                    backgroundImage: `url(${JSON.stringify(selected.thumbnailUrl)})`,
                    backgroundSize:
                      draftPresentation.fit === "stretch"
                        ? "100% 100%"
                        : draftPresentation.fit === "original"
                          ? "auto"
                          : draftPresentation.fit,
                    backgroundPosition: `${draftPresentation.positionX}% ${draftPresentation.positionY}%`,
                  }}
                >
                  <span>
                    预览 · {selected.name}
                    {selectedIsVideo ? " · 实际背景将静音播放视频" : ""}
                  </span>
                </div>

                {selectedIsVideo && (
                  <fieldset className="appearance-policy" disabled={busy !== null}>
                    <legend>动态背景</legend>
                    <label className="appearance-policy__toggle">
                      <input
                        type="checkbox"
                        checked={userPosterOnly}
                        onChange={(event) => onPosterOnlyChange(event.target.checked)}
                      />
                      仅使用静态封面（暂停视频）
                    </label>
                    <p className="appearance-help">
                      {activeIsVideo && selected.id === activeSkin?.id
                        ? playbackStatusLabel(playback, userPosterOnly, true) ??
                          "默认：可见标签且未开启减少动态效果时自动静音播放。"
                        : "策略仅影响本浏览器，不写入 appearance index；跨标签仅前台播放。"}
                    </p>
                  </fieldset>
                )}

                <fieldset disabled={busy === `patch:${selected.id}`}>
                  <legend>显示方式</legend>
                  <div className="appearance-segments">
                    {FITS.map((fit) => (
                      <button
                        key={fit.value}
                        type="button"
                        aria-pressed={draftPresentation.fit === fit.value}
                        title={fit.note}
                        onClick={() => updatePresentation({ fit: fit.value })}
                      >
                        {fit.label}
                      </button>
                    ))}
                  </div>
                  <p className="appearance-help">
                    {(FITS.find((fit) => fit.value === draftPresentation.fit) ?? FITS[0]).note}
                  </p>
                </fieldset>

                <fieldset
                  disabled={draftPresentation.fit === "stretch" || busy === `patch:${selected.id}`}
                >
                  <legend>{selectedIsVideo ? "视频定位" : "图片定位"}</legend>
                  <p className="appearance-help">
                    {draftPresentation.fit === "stretch"
                      ? "拉伸已占满整个视口，无法定位。"
                      : selectedIsVideo
                        ? "选择视频在视口中的锚点（object-position）。"
                        : "选择图片在视口中的锚点。"}
                  </p>
                  <div
                    className="appearance-anchor-grid"
                    role="radiogroup"
                    aria-label={selectedIsVideo ? "视频定位" : "图片定位"}
                  >
                    {ANCHORS.map((anchor) => (
                      <button
                        key={anchor.label}
                        type="button"
                        role="radio"
                        aria-label={anchor.label}
                        aria-checked={
                          draftPresentation.positionX === anchor.x &&
                          draftPresentation.positionY === anchor.y
                        }
                        onClick={() =>
                          updatePresentation({ positionX: anchor.x, positionY: anchor.y })
                        }
                      >
                        <span>{anchor.label}</span>
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset disabled={busy === `patch:${selected.id}`}>
                  <legend>可读性</legend>
                  <label>
                    遮罩色{" "}
                    <span className="appearance-segments">
                      {TONES.map((tone) => (
                        <button
                          key={tone.value}
                          type="button"
                          aria-pressed={draftPresentation.overlayTone === tone.value}
                          onClick={() => updatePresentation({ overlayTone: tone.value })}
                        >
                          {tone.label}
                        </button>
                      ))}
                    </span>
                  </label>
                  <label>
                    背景遮罩强度 <output>{draftPresentation.overlayOpacity}%</output>
                    <input
                      type="range"
                      min="0"
                      max="80"
                      value={draftPresentation.overlayOpacity}
                      onChange={(event) =>
                        updatePresentation({ overlayOpacity: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    主要面板不透明度 <output>{draftPresentation.panelOpacity}%</output>
                    <input
                      type="range"
                      min="70"
                      max="100"
                      value={draftPresentation.panelOpacity}
                      onChange={(event) =>
                        updatePresentation({ panelOpacity: Number(event.target.value) })
                      }
                    />
                  </label>
                </fieldset>
              </>
            ) : (
              <div className="appearance-config__empty">
                <strong>选择一张皮肤以调整显示方式</strong>
                <span>上传图片或短 MP4 后会自动应用；也可以从左侧选择已有皮肤。</span>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
