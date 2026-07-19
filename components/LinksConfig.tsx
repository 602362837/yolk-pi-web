"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePrompt } from "./AppPromptProvider";
import type {
  LinkAuthorizationSnapshot,
  LinkConnectionListItem,
  LinkProviderCatalogEntry,
  LinksCatalogResponse,
  LinkAuthorizationStartResponse,
  LinksConnectionsResponse,
  LinkDisconnectResponse,
  LinkErrorResponse,
  LinkAuthorizationErrorCode,
  LinkAuthorizationStatus,
} from "@/lib/links-types";
import {
  GITHUB_DEVICE_VERIFICATION_URI,
  LINKS_P0_REQUESTED_SCOPES,
} from "@/lib/links-types";

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatTimeRemaining(expiresAt: string): string {
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) return "已过期";
  const totalSeconds = Math.max(0, Math.floor(remaining / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatIsoDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

// ─── types ───────────────────────────────────────────────────────────────────

type LinksViewState =
  | "loading"
  | "load-error"
  | "not-configured"
  | "empty"
  | "starting"
  | "awaiting_user"
  | "connected";

interface LinksError {
  code?: LinkAuthorizationErrorCode | string;
  message: string;
}

// ─── component ───────────────────────────────────────────────────────────────

export function LinksConfig() {
  const prompt = usePrompt();

  // Catalog / connections
  const [catalog, setCatalog] = useState<LinkProviderCatalogEntry | null>(null);
  const [connections, setConnections] = useState<LinkConnectionListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Authorization
  const [authSnapshot, setAuthSnapshot] = useState<LinkAuthorizationSnapshot | null>(null);
  const [authError, setAuthError] = useState<LinksError | null>(null);
  const authAbortRef = useRef<AbortController | null>(null);
  const sseRef = useRef<EventSource | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  // Disconnect
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [disconnectError, setDisconnectError] = useState<LinksError | null>(null);
  const disconnectAbortRef = useRef<AbortController | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      authAbortRef.current?.abort();
      sseRef.current?.close();
      disconnectAbortRef.current?.abort();
    };
  }, []);

  // ─── derived state ───────────────────────────────────────────────────────

  const authStatus: LinkAuthorizationStatus | null = authSnapshot?.status ?? null;

  const derivedView: LinksViewState = useMemo(() => {
    if (loading) return "loading";
    if (loadError) return "load-error";
    if (catalog && !catalog.authorizationConfigured) return "not-configured";
    if (authStatus === "starting") return "starting";
    if (
      authStatus === "awaiting_user" ||
      authStatus === "polling" ||
      authStatus === "validating_identity" ||
      authStatus === "persisting"
    )
      return "awaiting_user";
    if (connections.length > 0) return "connected";
    return "empty";
  }, [loading, loadError, catalog, authStatus, connections.length]);

  // ─── load catalog & connections ──────────────────────────────────────────

  const refreshConnections = useCallback(async (signal?: AbortSignal) => {
    try {
      const connRes = await fetch("/api/links/github/connections", { signal });
      if (connRes.ok) {
        const connData = await connRes.json() as LinksConnectionsResponse;
        setConnections(connData.connections ?? []);
      }
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) return;
      // non-fatal
    }
  }, []);

  const loadData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      // Load catalog
      const catalogRes = await fetch("/api/links", { signal });
      if (!catalogRes.ok) {
        const errBody = await catalogRes.json().catch(() => null) as LinkErrorResponse | null;
        throw new Error(errBody?.error?.message ?? `HTTP ${catalogRes.status}`);
      }
      const catalogData = await catalogRes.json() as LinksCatalogResponse;
      const github = catalogData.providers?.find((p) => p.id === "github") ?? null;
      setCatalog(github);

      // Load connections if configured
      if (github?.authorizationConfigured) {
        await refreshConnections(signal);
      }
    } catch (err) {
      if (isAbortError(err) || (err as { name?: string }).name === "AbortError") return;
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [refreshConnections]);

  useEffect(() => {
    const controller = new AbortController();
    void loadData(controller.signal);
    return () => controller.abort();
  }, [loadData]);

  // ─── SSE subscription ────────────────────────────────────────────────────

  const subscribeSSE = useCallback((authorizationId: string) => {
    // Close previous SSE
    sseRef.current?.close();

    const es = new EventSource(
      `/api/links/github/authorizations/${encodeURIComponent(authorizationId)}/events`,
    );
    sseRef.current = es;

    es.onmessage = (event) => {
      try {
        const snapshot = JSON.parse(event.data) as LinkAuthorizationSnapshot;
        if (snapshot.authorizationId !== authorizationId) return;
        setAuthSnapshot(snapshot);

        // Terminal states
        const terminal = new Set([
          "connected",
          "duplicate",
          "denied",
          "expired",
          "cancelled",
          "failed",
        ]);
        if (terminal.has(snapshot.status)) {
          es.close();
          sseRef.current = null;

          if (snapshot.status === "connected") {
            // Refresh connections list without triggering loading state
            void refreshConnections();
          } else if (
            snapshot.status === "denied" ||
            snapshot.status === "expired" ||
            snapshot.status === "failed"
          ) {
            // Project terminal failures into the dedicated error UI.
            // Clear the live auth card so device code / countdown are gone.
            setAuthError({
              code: snapshot.errorCode,
              message:
                snapshot.errorMessage ??
                (snapshot.status === "denied"
                  ? "GitHub authorization was denied"
                  : snapshot.status === "expired"
                    ? "Device authorization expired"
                    : "Authorization failed"),
            });
            setAuthSnapshot(null);
            setPopupBlocked(false);
          } else if (snapshot.status === "cancelled") {
            setAuthSnapshot(null);
            setAuthError(null);
            setPopupBlocked(false);
          }
          // "duplicate" keeps the snapshot so the warning + highlight can render.
        }
      } catch {
        // Ignore parse errors on SSE frames
      }
    };

    es.onerror = () => {
      // SSE connection error — don't cancel the authorization
      // The server continues polling in background
    };
  }, [refreshConnections]);

  // ─── connect / start authorization ───────────────────────────────────────

  const handleConnect = useCallback(async () => {
    authAbortRef.current?.abort();
    setAuthError(null);
    setAuthSnapshot(null);
    setPopupBlocked(false);

    const controller = new AbortController();
    authAbortRef.current = controller;

    // Set starting state immediately
    setAuthSnapshot({
      authorizationId: "",
      provider: "github",
      status: "starting",
      requestedScopes: [...LINKS_P0_REQUESTED_SCOPES],
    });

    try {
      const res = await fetch("/api/links/github/authorizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
      });

      if (!res.ok) {
        const errBody = await res.json().catch(() => null) as LinkErrorResponse | null;
        const code = errBody?.error?.code;
        const message = errBody?.error?.message ?? `HTTP ${res.status}`;

        // Not configured is special — update catalog to show not-configured UI
        if (code === "github_authorization_not_configured") {
          setCatalog((prev) => prev ? { ...prev, authorizationConfigured: false } : prev);
          setAuthSnapshot(null);
          // Don't set authError; the not-configured UI handles this state.
          return;
        }

        setAuthSnapshot(null);
        setAuthError({ code, message });
        return;
      }

      const data = await res.json() as LinkAuthorizationStartResponse;
      const { authorization } = data;

      // Transition to awaiting_user
      const snapshot: LinkAuthorizationSnapshot = {
        authorizationId: authorization.id,
        provider: "github",
        status: "awaiting_user",
        userCode: authorization.userCode,
        verificationUri: authorization.verificationUri,
        expiresAt: authorization.expiresAt,
        intervalSeconds: authorization.intervalSeconds,
        requestedScopes: authorization.requestedScopes,
      };
      setAuthSnapshot(snapshot);

      // Open GitHub verification page
      try {
        const win = window.open(authorization.verificationUri, "_blank", "noopener,noreferrer");
        if (!win || win.closed) {
          setPopupBlocked(true);
        }
      } catch {
        setPopupBlocked(true);
      }

      // Subscribe to SSE
      subscribeSSE(authorization.id);
    } catch (err) {
      if (isAbortError(err)) return;
      setAuthSnapshot(null);
      setAuthError({
        message: err instanceof Error ? err.message : "Failed to start authorization",
      });
    }
  }, [subscribeSSE]);

  // ─── cancel authorization ─────────────────────────────────────────────────

  const handleCancel = useCallback(async () => {
    const authId = authSnapshot?.authorizationId;

    // Always clear local starting/pending UI. During the pre-POST "starting"
    // phase authorizationId is still empty — only abort the in-flight start.
    authAbortRef.current?.abort();
    sseRef.current?.close();
    sseRef.current = null;

    if (authId) {
      try {
        await fetch(
          `/api/links/github/authorizations/${encodeURIComponent(authId)}`,
          { method: "DELETE" },
        );
      } catch {
        // Best-effort cancel of server-side polling.
      }
    }

    setAuthSnapshot(null);
    setAuthError(null);
    setPopupBlocked(false);
  }, [authSnapshot?.authorizationId]);

  // ─── disconnect ───────────────────────────────────────────────────────────

  const handleDisconnect = useCallback(
    async (connection: LinkConnectionListItem) => {
      setDisconnectError(null);

      const confirmed = await prompt.confirm({
        title: `断开 GitHub 连接「${connection.label}」？`,
        message: (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <span>
              将删除 <strong>@{connection.login}</strong> 的本机 OAuth 凭据并从活动列表移除。
            </span>
            <span
              style={{
                padding: "8px 10px",
                borderRadius: 7,
                borderLeft: "3px solid var(--warning, #b45309)",
                background: "var(--warning-bg, rgba(180,83,9,.09))",
                color: "var(--warning, #b45309)",
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              此操作<strong>不会</strong>撤销 GitHub 远端 OAuth 授权。如需完全断开，请前往
              GitHub Settings → Applications → Authorized OAuth Apps 手动撤销。
            </span>
          </div>
        ),
        confirmLabel: "断开本机连接",
        cancelLabel: "保留",
        intent: "danger",
      });

      if (!confirmed) return;

      disconnectAbortRef.current?.abort();
      const controller = new AbortController();
      disconnectAbortRef.current = controller;

      setDisconnectingId(connection.id);

      try {
        const res = await fetch(
          `/api/links/github/connections/${encodeURIComponent(connection.id)}`,
          { method: "DELETE", signal: controller.signal },
        );

        if (!res.ok) {
          const errBody = await res.json().catch(() => null) as LinkErrorResponse | null;
          throw new Error(errBody?.error?.message ?? `HTTP ${res.status}`);
        }

        const data = await res.json() as LinkDisconnectResponse;
        if (data.disconnectedId) {
          setConnections((prev) => prev.filter((c) => c.id !== data.disconnectedId));
        }
      } catch (err) {
        if (isAbortError(err)) return;
        setDisconnectError({
          connectionId: connection.id,
          message: err instanceof Error ? err.message : "断开失败",
        } as LinksError & { connectionId: string });
      } finally {
        setDisconnectingId(null);
      }
    },
    [prompt],
  );

  // ─── clear auth state (for "connect another" flow) ───────────────────────

  const handleClearAuth = useCallback(() => {
    setAuthSnapshot(null);
    setAuthError(null);
    setPopupBlocked(false);
  }, []);

  // ─── retry load ──────────────────────────────────────────────────────────

  const handleRetryLoad = useCallback(() => {
    void loadData();
  }, [loadData]);

  // ─── user code copy ───────────────────────────────────────────────────────

  const [codeCopied, setCodeCopied] = useState(false);
  const handleCopyCode = useCallback(async () => {
    const userCode = authSnapshot?.userCode;
    if (!userCode) return;
    try {
      await navigator.clipboard.writeText(userCode);
      setCodeCopied(true);
      window.setTimeout(() => setCodeCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }, [authSnapshot]);

  // ─── expiry countdown ─────────────────────────────────────────────────────

  const [timeRemaining, setTimeRemaining] = useState<string>("");
  useEffect(() => {
    if (!authSnapshot?.expiresAt || derivedView !== "awaiting_user") {
      setTimeRemaining("");
      return;
    }
    const tick = () => setTimeRemaining(formatTimeRemaining(authSnapshot.expiresAt!));
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [authSnapshot?.expiresAt, derivedView]);

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Heading */}
      <header className="links-page-heading">
        <div>
          <div className="links-eyebrow">External connections</div>
          <h3 style={{ margin: "3px 0 0", color: "var(--text)", fontSize: 19 }}>Links</h3>
          <p style={{ margin: "6px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55, maxWidth: 620 }}>
            通过 GitHub 官方授权连接多个 GitHub 身份。点击连接后在 GitHub 页面批准；服务端自动保存凭据。操作即时生效，不进入{" "}
            <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>pi-web.json</code>，也不受设置底部全局「保存 / 恢复默认值」控制。
          </p>
        </div>
        <span className="links-instant-badge">
          即时保存 · 独立于全局设置
        </span>
      </header>

      {/* Provider card */}
      <section
        className="links-provider"
        aria-labelledby="links-github-heading"
      >
        {/* Provider head */}
        <header className="links-provider-head">
          <div className="links-provider-identity">
            <div className="links-provider-mark" aria-hidden="true">
              GH
            </div>
            <div>
              <h3 id="links-github-heading" style={{ margin: 0, fontSize: 15 }}>
                GitHub
              </h3>
              <div style={{ marginTop: 3, color: "var(--text-muted)", fontSize: 11 }}>
                <span className="links-count">
                  {connections.length}
                </span>{" "}
                个活动连接 · OAuth Device Flow
              </div>
            </div>
          </div>
          {derivedView !== "loading" &&
            derivedView !== "load-error" &&
            connections.length > 0 && (
              <button
                className="links-button links-button--secondary"
                type="button"
                onClick={() => {
                  handleClearAuth();
                  void handleConnect();
                }}
                disabled={derivedView === "starting" || derivedView === "awaiting_user"}
              >
                连接另一个 GitHub 账号
              </button>
            )}
          {(derivedView === "empty" || derivedView === "not-configured") && (
            <button
              className="links-button links-button--primary"
              type="button"
              onClick={() => void handleConnect()}
              disabled={derivedView === "not-configured"}
              title={
                derivedView === "not-configured"
                  ? "GitHub 授权尚未配置"
                  : "连接 GitHub"
              }
            >
              连接 GitHub
            </button>
          )}
        </header>

        {/* Provider body */}
        <div className="links-provider-body">
          {/* Loading */}
          {derivedView === "loading" && (
            <div className="links-loading-stack" aria-busy="true" aria-label="正在加载 GitHub 连接">
              <div className="links-loading-copy">
                <span className="links-spinner" aria-hidden="true" />
                正在读取本机 GitHub 连接…
              </div>
              <div className="links-skeleton" />
              <div className="links-skeleton" />
            </div>
          )}

          {/* Load error */}
          {derivedView === "load-error" && (
            <>
              <div className="links-alert links-alert--error" role="alert">
                <span aria-hidden="true">!</span>
                <div>
                  <strong>无法读取本机 GitHub 连接</strong>
                  <div>
                    Links 存储暂时不可用。未向 GitHub 发起网络请求；请重试。错误文案不含绝对路径或凭据。
                  </div>
                </div>
              </div>
              {loadError && (
                <div style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                  {loadError}
                </div>
              )}
              <div className="links-inline-actions">
                <button
                  className="links-button links-button--primary"
                  type="button"
                  onClick={handleRetryLoad}
                >
                  重新加载
                </button>
              </div>
            </>
          )}

          {/* Not configured */}
          {derivedView === "not-configured" && (
            <>
              <div className="links-alert links-alert--warning" role="alert">
                <span aria-hidden="true">!</span>
                <div>
                  <strong>GitHub 授权尚未配置</strong>
                  <div>
                    服务端缺少产品方 OAuth App client id（<code style={{ fontFamily: "var(--font-mono)" }}>YPI_LINKS_GITHUB_OAUTH_CLIENT_ID</code>）。部署方需要注入已启用 Device Flow 的 client id 后才能连接。此状态不会退回 token 输入。
                  </div>
                </div>
              </div>
              <div className="links-safe-note">
                <span aria-hidden="true">i</span>
                <span>
                  终端用户无需创建 OAuth App。源码开发者可在 server 环境覆盖自己的 client id；官方构建由产品注入。详情见部署文档。
                </span>
              </div>
            </>
          )}

          {/* Empty */}
          {derivedView === "empty" && !authSnapshot && !authError && (
            <div className="links-empty">
              <div className="links-empty-inner">
                <div className="links-empty-icon" aria-hidden="true">
                  GH
                </div>
                <h3 style={{ margin: 0, fontSize: 15 }}>尚未连接 GitHub</h3>
                <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55, maxWidth: 420 }}>
                  点击「连接 GitHub」，在 GitHub 官方页面输入设备码并批准授权。本机只保存身份摘要与 OAuth 凭据；浏览器不会显示 access token。
                </p>
                <button
                  className="links-button links-button--primary"
                  type="button"
                  onClick={() => void handleConnect()}
                >
                  连接 GitHub
                </button>
                <div className="links-safe-note">
                  <span aria-hidden="true">🔒</span>
                  <span>
                    <strong>无需创建或粘贴 token。</strong>产品使用自有 GitHub OAuth App 发起 Device Flow；P0 仅请求{" "}
                    <code style={{ fontFamily: "var(--font-mono)" }}>read:user</code>，不申请仓库权限。
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Starting */}
          {derivedView === "starting" && (
            <div className="links-auth-card" aria-busy="true" aria-live="polite">
              <div className="links-auth-head">
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>正在启动 GitHub 授权…</h3>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
                    向 GitHub 请求设备码。不会要求你输入任何 secret。
                  </p>
                </div>
                <button
                  className="links-icon-button"
                  type="button"
                  aria-label="取消授权"
                  title="取消"
                  onClick={handleCancel}
                >
                  ×
                </button>
              </div>
              <div className="links-loading-copy">
                <span className="links-spinner" aria-hidden="true" />
                联系 GitHub Device Flow…
              </div>
            </div>
          )}

          {/* Awaiting user (device code) */}
          {derivedView === "awaiting_user" && authSnapshot && (
            <div className="links-auth-card" aria-live="polite">
              <div className="links-auth-head">
                <div>
                  <h3 style={{ margin: 0, fontSize: 15 }}>
                    {authSnapshot.status === "polling"
                      ? popupBlocked
                        ? "在 GitHub 完成授权"
                        : "仍在等待 GitHub 授权"
                      : "在 GitHub 完成授权"}
                  </h3>
                  <p style={{ margin: 0, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.55 }}>
                    {popupBlocked
                      ? "浏览器拦截了自动打开。请手动打开 GitHub 验证页并输入设备码。"
                      : "在官方验证页输入下方短期设备码并批准。服务端会自动轮询结果。"}
                  </p>
                </div>
                <button
                  className="links-icon-button"
                  type="button"
                  aria-label="取消授权"
                  title="取消"
                  onClick={handleCancel}
                >
                  ×
                </button>
              </div>

              {/* Popup blocked warning */}
              {popupBlocked && (
                <div className="links-alert links-alert--warning" role="status">
                  <span aria-hidden="true">!</span>
                  <div>
                    <strong>弹窗被拦截</strong>
                    <div>
                      请点击下方「打开 GitHub 验证页」。验证地址固定为 GitHub 官方 HTTPS 页面。
                    </div>
                  </div>
                </div>
              )}

              {/* Slow down info */}
              {authSnapshot.status === "polling" &&
                authSnapshot.intervalSeconds &&
                authSnapshot.intervalSeconds > 5 && (
                  <div className="links-alert links-alert--info" role="status">
                    <span aria-hidden="true">i</span>
                    <div>
                      <strong>GitHub 请求 slow_down</strong>
                      <div>
                        服务端已按官方 interval 放慢轮询，不会 busy-loop。请保持此页或稍后回来查看结果。
                      </div>
                    </div>
                  </div>
                )}

              {/* Code panel */}
              {authSnapshot.userCode && (
                <div className="links-code-panel">
                  <div>
                    <div className="links-eyebrow">User code</div>
                    <div
                      className="links-user-code"
                      tabIndex={0}
                      aria-label={`GitHub 用户设备码 ${authSnapshot.userCode}`}
                    >
                      {authSnapshot.userCode}
                    </div>
                    <div className="links-code-meta">
                      {timeRemaining && (
                        <>
                          剩余约 <strong>{timeRemaining}</strong>{" "}
                        </>
                      )}
                      {authSnapshot.intervalSeconds && authSnapshot.intervalSeconds > 5
                        ? "· 轮询间隔已增加"
                        : "· 请勿把此短期码发送给他人"}
                    </div>
                  </div>
                  <div className="links-code-actions">
                    <button
                      className={`links-button ${codeCopied ? "links-button--copied" : ""}`}
                      type="button"
                      onClick={() => void handleCopyCode()}
                    >
                      {codeCopied ? "已复制" : "复制设备码"}
                    </button>
                    <a
                      className="links-button links-button--primary"
                      href={authSnapshot.verificationUri ?? GITHUB_DEVICE_VERIFICATION_URI}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      打开 GitHub 验证页
                    </a>
                  </div>
                </div>
              )}

              {/* Steps */}
              <ol className="links-steps">
                <li className="done">
                  <span className="links-step-num">1</span>
                  <span>已获取设备码</span>
                </li>
                <li className="current">
                  <span className="links-step-num">2</span>
                  <span>
                    在 <strong>github.com/login/device</strong> 输入码并批准
                  </span>
                </li>
                <li>
                  <span className="links-step-num">3</span>
                  <span>服务端验证身份并保存连接</span>
                </li>
              </ol>

              {/* Progress */}
              <div className="links-progress-wrap">
                <div className="links-loading-copy">
                  <span className="links-spinner" aria-hidden="true" />
                  <span>
                    {authSnapshot.status === "polling"
                      ? "polling · 等待批准…"
                      : authSnapshot.status === "validating_identity"
                        ? "验证身份中…"
                        : authSnapshot.status === "persisting"
                          ? "正在保存连接…"
                          : "等待你在 GitHub 批准授权…"}
                  </span>
                </div>
                <div className="links-progress-bar" aria-hidden="true">
                  <span />
                </div>
              </div>

              {/* Safety note */}
              <div className="links-safe-note">
                <span aria-hidden="true">🔒</span>
                <span>
                  <strong>安全边界：</strong>浏览器只显示 GitHub 为你生成的短期 user code。服务端持有的{" "}
                  <code style={{ fontFamily: "var(--font-mono)" }}>device_code</code>{" "}
                  与最终 access token 永不进入页面、日志或设置文件。
                </span>
              </div>
              <div className="links-auth-actions">
                <button
                  className="links-button links-button--ghost"
                  type="button"
                  onClick={handleCancel}
                >
                  取消授权
                </button>
              </div>
            </div>
          )}

          {/* Terminal errors (denied, expired, cancelled, network, etc.) */}
          {authError && !authSnapshot && derivedView !== "not-configured" && (
            <LinksTerminalError
              error={authError}
              onRetry={() => {
                setAuthError(null);
                void handleConnect();
              }}
              onDismiss={() => setAuthError(null)}
            />
          )}

          {/* Connected: show list */}
          {derivedView === "connected" && connections.length > 0 && (
            <LinksConnectionList
              connections={connections}
              disconnectingId={disconnectingId}
              disconnectError={disconnectError}
              duplicateTargetId={
                authSnapshot?.status === "duplicate"
                  ? authSnapshot.existingConnectionId
                  : undefined
              }
              onDisconnect={handleDisconnect}
              onDismissDisconnectError={() => setDisconnectError(null)}
            />
          )}

          {/* Success banner */}
          {authSnapshot?.status === "connected" && authSnapshot.connection && (
            <div className="links-alert links-alert--success" role="status" style={{ marginTop: 4 }}>
              <span aria-hidden="true">✓</span>
              <div>
                <strong>已连接 GitHub 账号 @{authSnapshot.connection.login}</strong>
                <div>身份已验证并保存到本机 Links 存储。浏览器未接收 access token。</div>
              </div>
            </div>
          )}

          {/* Duplicate banner */}
          {authSnapshot?.status === "duplicate" && (
            <div className="links-alert links-alert--warning" role="alert" style={{ marginTop: 4 }}>
              <span aria-hidden="true">!</span>
              <div>
                <strong>该 GitHub 账号已连接</strong>
                <div>
                  为避免静默替换本机凭据，重复 identity 被拒绝（409）。请先断开现有连接再重新授权。新 access token 未写入本机；如需清理远端授权，请前往 GitHub → Settings → Applications → Authorized OAuth Apps。
                </div>
              </div>
            </div>
          )}

          {/* Connect another (below list, when connected) */}
          {derivedView === "connected" && connections.length > 0 && !authSnapshot && (
            <div className="links-inline-actions">
              <button
                className="links-button"
                type="button"
                onClick={() => void handleConnect()}
              >
                连接另一个 GitHub 账号
              </button>
            </div>
          )}

          {/* Footnote */}
          {derivedView !== "loading" && derivedView !== "load-error" && (
            <div className="links-safe-note">
              <span aria-hidden="true">i</span>
              <span>
                <strong>安全边界：</strong>Links 与 LLM 认证完全隔离。列表只显示身份摘要、验证时间与 scopes；access token、device_code 与 client secret 永不进入 DOM、toast、错误或{" "}
                <code style={{ fontFamily: "var(--font-mono)" }}>pi-web.json</code>。
              </span>
            </div>
          )}

          {/* Connected footnote */}
          {derivedView === "connected" && (
            <div className="links-list-footnote">
              「已连接」表示上次验证成功，不代表实时在线。P0 仅请求{" "}
              <code style={{ fontFamily: "var(--font-mono)" }}>read:user</code>
              ，页面不会声称拥有 repo 权限。
              {connections.length > 1 &&
                " 不同 GitHub numeric user id 可同时连接。同一 identity 重复授权会返回 409，不会静默替换现有本机凭据。"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function LinksTerminalError({
  error,
  onRetry,
  onDismiss,
}: {
  error: LinksError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const isWarning =
    error.code === "github_authorization_expired" ||
    error.code === "github_authorization_not_configured";

  const title =
    error.code === "github_access_denied"
      ? "GitHub 授权被拒绝"
      : error.code === "github_authorization_expired"
        ? "设备码已过期"
        : "无法完成 GitHub 授权";

  const description =
    error.code === "github_access_denied"
      ? "你在 GitHub 页面取消或拒绝了授权。本机未保存任何凭据。可重新开始连接。"
      : error.code === "github_authorization_expired"
        ? "请重新开始连接以获取新的短期设备码。过期码与对应授权会话已从本机清除。"
        : error.message || "网络超时或 GitHub 暂时不可用。本机未保存凭据；页面不会展示上游原始错误。";

  const buttonLabel =
    error.code === "github_access_denied"
      ? "重新连接 GitHub"
      : error.code === "github_authorization_expired"
        ? "重新连接 GitHub"
        : "重试连接";

  return (
    <>
      <div
        className={`links-alert ${isWarning ? "links-alert--warning" : "links-alert--error"}`}
        role="alert"
      >
        <span aria-hidden="true">!</span>
        <div>
          <strong>{title}</strong>
          <div>{description}</div>
        </div>
      </div>
      <div className="links-inline-actions">
        <button
          className="links-button links-button--primary"
          type="button"
          onClick={onRetry}
        >
          {buttonLabel}
        </button>
        {error.code === "github_authorization_not_configured" ? null : (
          <button className="links-button" type="button" onClick={onDismiss}>
            关闭
          </button>
        )}
      </div>
    </>
  );
}

function LinksConnectionList({
  connections,
  disconnectingId,
  disconnectError,
  duplicateTargetId,
  onDisconnect,
  onDismissDisconnectError,
}: {
  connections: LinkConnectionListItem[];
  disconnectingId: string | null;
  disconnectError: LinksError | null;
  duplicateTargetId?: string;
  onDisconnect: (connection: LinkConnectionListItem) => void;
  onDismissDisconnectError: () => void;
}) {
  return (
    <>
      {/* Disconnect error */}
      {disconnectError && (
        <div className="links-alert links-alert--error" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>断开失败</strong>
            <div>本机凭据未能安全删除，连接仍保留在活动列表。不会伪造成功；请重试。</div>
          </div>
          <button
            className="links-icon-button"
            type="button"
            aria-label="关闭错误提示"
            onClick={onDismissDisconnectError}
            style={{ alignSelf: "flex-start" }}
          >
            ×
          </button>
        </div>
      )}

      {/* Connection cards */}
      <div className="links-connection-list" aria-label="活动 GitHub 连接">
        {connections.map((conn) => {
          const isDisconnecting = disconnectingId === conn.id;
          const isHighlighted = duplicateTargetId === conn.id;

          return (
            <article
              key={conn.id}
              className={`links-connection-card${isDisconnecting ? " links-connection-card--busy" : ""}${isHighlighted ? " links-connection-card--highlight" : ""}`}
              data-connection-id={conn.id}
              aria-busy={isDisconnecting}
            >
              <div className="links-connection-detail">
                <div className="links-connection-title">
                  <h4 style={{ margin: 0, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
                    {conn.label}
                  </h4>
                  <span className="links-login-chip">@{conn.login}</span>
                </div>
                <div className="links-loading-copy" style={{ fontSize: 12 }}>
                  {isDisconnecting ? (
                    <>
                      <span className="links-spinner" aria-hidden="true" />
                      <span>正在断开本机连接…</span>
                    </>
                  ) : (
                    <>
                      <span className="links-status-dot" aria-hidden="true" />
                      <span className="links-status-label">已连接</span>
                      <span>· 上次验证成功于 {formatIsoDate(conn.lastValidatedAt)}</span>
                    </>
                  )}
                </div>
                <div className="links-meta-line">
                  GitHub user id · {conn.providerUserId}
                  {isHighlighted && " · 现有连接保持不变"}
                </div>
                <div className="links-scope-row">
                  <span className="links-scope-label">请求范围</span>
                  {(conn.requestedScopes ?? ["read:user"]).map((s) => (
                    <span key={s} className="links-scope-chip links-scope-chip--requested">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="links-scope-row">
                  <span className="links-scope-label">已授予</span>
                  {conn.grantedScopes.length > 0
                    ? conn.grantedScopes.map((s) => (
                        <span key={s} className="links-scope-chip">
                          {s}
                        </span>
                      ))
                    : (
                      <span className="links-scope-chip" style={{ color: "var(--text-dim)", fontStyle: "italic" }}>
                        GitHub 未返回 scope 明细
                      </span>
                    )}
                </div>
              </div>
              <div className="links-card-actions">
                <button
                  className="links-button links-button--danger"
                  type="button"
                  onClick={() => onDisconnect(conn)}
                  disabled={isDisconnecting}
                >
                  {isDisconnecting ? "断开中…" : isHighlighted ? "断开后重连" : "断开"}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
