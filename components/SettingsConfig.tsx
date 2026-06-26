"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PiWebConfig, PiWebTrellisConfig, PiWebWorktreeConfig } from "@/lib/pi-web-config";

interface WebConfigResponse {
  config: PiWebConfig;
  defaults: PiWebConfig;
  path: string;
  exists: boolean;
  parseError?: string;
  error?: string;
}

const inputStyle: React.CSSProperties = {
  padding: "7px 9px",
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
};

const TEMPLATE_VARIABLES = [
  { token: "{repoRoot}", description: "当前 Git 仓库根目录的绝对路径" },
  { token: "{repoParent}", description: "仓库根目录的父目录" },
  { token: "{repoName}", description: "仓库目录名" },
  { token: "{baseDir}", description: "由“基础目录模板”计算出的目录" },
  { token: "{branchName}", description: "最终创建的分支名" },
  { token: "{branchSlug}", description: "适合文件路径使用的分支名，会替换特殊字符" },
  { token: "{yyyyMMdd-HHmmss}", description: "创建时刻，格式如 20260625-153012" },
];

type SettingsSection = "worktree" | "trellis";

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontSize: 12, color: "var(--text)", fontWeight: 600 }}>{label}</span>
      {children}
      {description && <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{description}</span>}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck={false}
      style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
    />
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: 12,
        borderRadius: 10,
        border: "1px solid var(--border)",
        background: "var(--bg-subtle)",
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45 }}>{description}</span>
      </span>
      <span
        aria-hidden
        style={{
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked ? "var(--accent)" : "var(--border)",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.12s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: checked ? 21 : 3,
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "white",
            transition: "left 0.12s",
            boxShadow: "0 1px 4px rgba(0,0,0,0.25)",
          }}
        />
      </span>
    </button>
  );
}

function worktreeConfigsEqual(a: PiWebWorktreeConfig | null, b: PiWebWorktreeConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.baseRef === b.baseRef
    && a.branchNameTemplate === b.branchNameTemplate
    && a.baseDirTemplate === b.baseDirTemplate
    && a.pathTemplate === b.pathTemplate
    && a.sessionDisplay === b.sessionDisplay;
}

function trellisConfigsEqual(a: PiWebTrellisConfig | null, b: PiWebTrellisConfig | null): boolean {
  if (!a || !b) return a === b;
  return a.enabled === b.enabled && a.includeArchived === b.includeArchived;
}

export function SettingsConfig({ onClose }: { onClose: () => void }) {
  const [section, setSection] = useState<SettingsSection>("worktree");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configPath, setConfigPath] = useState("");
  const [exists, setExists] = useState(false);
  const [defaults, setDefaults] = useState<PiWebConfig | null>(null);
  const [worktree, setWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [savedWorktree, setSavedWorktree] = useState<PiWebWorktreeConfig | null>(null);
  const [trellis, setTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [savedTrellis, setSavedTrellis] = useState<PiWebTrellisConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = useMemo(
    () => !worktreeConfigsEqual(worktree, savedWorktree) || !trellisConfigsEqual(trellis, savedTrellis),
    [worktree, savedWorktree, trellis, savedTrellis],
  );

  const loadConfig = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/web-config", { signal });
      const data = await res.json() as WebConfigResponse;
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDefaults(data.defaults);
      setWorktree(data.config.worktree);
      setSavedWorktree(data.config.worktree);
      setTrellis(data.config.trellis);
      setSavedTrellis(data.config.trellis);
      setConfigPath(data.path);
      setExists(data.exists);
      if (data.parseError) {
        setNotice(`配置文件无法解析，当前显示默认值；保存后会用合法 JSON 覆盖它。${data.parseError}`);
      }
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadConfig(controller.signal);
    return () => controller.abort();
  }, [loadConfig]);

  const updateWorktree = useCallback((patch: Partial<PiWebWorktreeConfig>) => {
    setWorktree((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const updateTrellis = useCallback((patch: Partial<PiWebTrellisConfig>) => {
    setTrellis((prev) => prev ? { ...prev, ...patch } : prev);
    setNotice(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!worktree || !trellis) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/web-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktree, trellis }),
      });
      const data = await res.json() as WebConfigResponse & { success?: boolean };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDefaults(data.defaults);
      setWorktree(data.config.worktree);
      setSavedWorktree(data.config.worktree);
      setTrellis(data.config.trellis);
      setSavedTrellis(data.config.trellis);
      setConfigPath(data.path);
      setExists(data.exists);
      setNotice("设置已保存。Trellis 面板开关会立即生效，WorkTree 设置会用于下一次创建 New WorkTree。");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [worktree, trellis]);

  const resetToDefaults = useCallback(() => {
    if (!defaults) return;
    setWorktree(defaults.worktree);
    setTrellis(defaults.trellis);
    setNotice("已在表单中恢复默认值，点击保存后会写入 pi-web.json。");
  }, [defaults]);

  const renderSectionButton = (id: SettingsSection, label: string, description: string) => {
    const active = section === id;
    return (
      <button
        key={id}
        onClick={() => setSection(id)}
        style={{
          width: "100%",
          textAlign: "left",
          padding: "8px 10px",
          borderRadius: 8,
          border: active ? "1px solid rgba(37,99,235,0.25)" : "1px solid transparent",
          background: active ? "var(--bg-selected)" : "transparent",
          color: active ? "var(--accent)" : "var(--text-muted)",
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
        }}
        title={description}
      >
        {label}
      </button>
    );
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(0,0,0,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(760px, calc(100vw - 40px))",
          maxHeight: "calc(100vh - 40px)",
          overflow: "hidden",
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 18, color: "var(--text)" }}>设置</h2>
            <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>配置 pi-web 行为。保存后动态生效，无需重启。</p>
          </div>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 24, lineHeight: 1, padding: 4 }}
            title="关闭"
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", minHeight: 0 }}>
          <div style={{ width: 150, borderRight: "1px solid var(--border)", padding: 10, background: "var(--bg-subtle)", flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {renderSectionButton("worktree", "WorkTree", "New WorkTree 默认配置")}
            {renderSectionButton("trellis", "Trellis", "Trellis 面板开关")}
          </div>

          <div style={{ padding: 18, overflow: "auto", flex: 1 }}>
            {loading ? (
              <div style={{ color: "var(--text-muted)", fontSize: 13 }}>正在加载设置…</div>
            ) : worktree && trellis ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {error && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(239,68,68,0.12)", color: "#f87171", fontSize: 12, overflowWrap: "anywhere" }}>{error}</div>}
                {notice && <div style={{ padding: "8px 10px", borderRadius: 8, background: "rgba(37,99,235,0.12)", color: "var(--accent)", fontSize: 12, overflowWrap: "anywhere" }}>{notice}</div>}

                {section === "worktree" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>New WorkTree 默认配置</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        保存到 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)", overflowWrap: "anywhere" }}>{configPath}</code>
                        {exists ? "" : "（保存时会自动创建）"}
                      </p>
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                      <Field label="基础引用" description="作为 git worktree add 起点的 Git 引用，例如 HEAD、main、origin/main 或某个 commit。">
                        <TextInput value={worktree.baseRef} onChange={(baseRef) => updateWorktree({ baseRef })} placeholder="HEAD" />
                      </Field>
                      <Field label="会话展示方式" description="控制 WorkTree 会话在支持的位置如何分组/展示。当前侧边栏会优先按独立工作目录展示。">
                        <select
                          value={worktree.sessionDisplay}
                          onChange={(e) => updateWorktree({ sessionDisplay: e.target.value as PiWebWorktreeConfig["sessionDisplay"] })}
                          style={inputStyle}
                        >
                          <option value="separate">独立项目条目</option>
                          <option value="tag">在项目内标记</option>
                        </select>
                      </Field>
                    </div>

                    <Field label="分支名模板" description="未手动指定分支名时，用这个模板生成新分支名。默认会生成类似 pi/20260625-153012 的分支。">
                      <TextInput value={worktree.branchNameTemplate} onChange={(branchNameTemplate) => updateWorktree({ branchNameTemplate })} placeholder="pi/{yyyyMMdd-HHmmss}" />
                    </Field>
                    <Field label="基础目录模板" description="先计算 WorkTree 的基础目录。相对路径会基于仓库根目录解析，绝对路径会直接使用。">
                      <TextInput value={worktree.baseDirTemplate} onChange={(baseDirTemplate) => updateWorktree({ baseDirTemplate })} placeholder="{repoParent}/{repoName}.worktrees" />
                    </Field>
                    <Field label="WorkTree 路径模板" description="最终创建 WorkTree 的目标路径。可以引用基础目录、分支名和时间等变量。">
                      <TextInput value={worktree.pathTemplate} onChange={(pathTemplate) => updateWorktree({ pathTemplate })} placeholder="{baseDir}/{branchSlug}" />
                    </Field>

                    <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)" }}>
                      <div style={{ fontSize: 12, color: "var(--text)", fontWeight: 600, marginBottom: 8 }}>可用模板变量</div>
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(150px, max-content) 1fr", gap: "7px 12px", alignItems: "baseline" }}>
                        {TEMPLATE_VARIABLES.map((variable) => (
                          <div key={variable.token} style={{ display: "contents" }}>
                            <code style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 6px", borderRadius: 5, background: "var(--bg)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                              {variable.token}
                            </code>
                            <span style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.45 }}>{variable.description}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                    <div>
                      <h3 style={{ margin: 0, color: "var(--text)", fontSize: 15 }}>Trellis 面板</h3>
                      <p style={{ margin: "5px 0 0", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                        从当前工作区的 <code style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>.trellis/tasks</code> 读取任务，只读展示任务列表、详情和阶段进度。
                      </p>
                    </div>

                    <ToggleField
                      label="启用 Trellis 右侧抽屉"
                      description="开启后，主界面右上角会显示 Trellis 按钮；关闭时 UI 入口和 Trellis API 都不可用。"
                      checked={trellis.enabled}
                      onChange={(enabled) => updateTrellis({ enabled })}
                    />
                    <ToggleField
                      label="默认包含已归档任务"
                      description="开启后，Trellis 面板初次打开会同时读取 .trellis/tasks/archive 下的任务；面板内仍可临时切换。"
                      checked={trellis.includeArchived}
                      onChange={(includeArchived) => updateTrellis({ includeArchived })}
                    />

                    <div style={{ padding: 12, borderRadius: 8, background: "var(--bg-subtle)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                      <strong style={{ color: "var(--text)" }}>首版范围：</strong>只读查看，不创建、启动、完成或归档任务；阶段进度根据 task.json、PRD/Design/Implement 文档和 context manifests 保守推断。
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: "#f87171", fontSize: 13 }}>{error ?? "无法加载设置"}</div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 10 }}>
          <button
            onClick={resetToDefaults}
            disabled={!defaults || loading || saving}
            style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: !defaults || loading || saving ? "not-allowed" : "pointer", fontSize: 12 }}
          >
            恢复默认值
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {dirty && <span style={{ fontSize: 12, color: "var(--text-dim)" }}>有未保存更改</span>}
            <button
              onClick={onClose}
              style={{ padding: "7px 12px", borderRadius: 7, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
            >
              取消
            </button>
            <button
              onClick={() => void handleSave()}
              disabled={!worktree || !trellis || loading || saving || !dirty}
              style={{ padding: "7px 14px", borderRadius: 7, border: "none", background: !worktree || !trellis || loading || saving || !dirty ? "var(--border)" : "var(--accent)", color: "white", cursor: !worktree || !trellis || loading || saving || !dirty ? "not-allowed" : "pointer", fontSize: 12, fontWeight: 600 }}
            >
              {saving ? "正在保存…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
