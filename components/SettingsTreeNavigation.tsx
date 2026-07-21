"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

/**
 * Stable Settings leaf ids. External callers (AppShell deep-links, initialSection)
 * only accept these — never the virtual providerHub view.
 */
export type SettingsSection =
  | "yolk"
  | "worktree"
  | "studio"
  | "appearance"
  | "links"
  | "usage"
  | "modelPrices"
  | "terminal"
  | "chatgpt"
  | "opencodeGo"
  | "grok"
  | "kiro"
  | "antigravity"
  | "editor"
  | "trellis"
  | "diagnostics";

/** Frontend-only content view; includes the virtual provider strategy hub. */
export type SettingsView = SettingsSection | "providerHub";

/** Expandable tree groups. `providers` is nested under `modelsUsage`. */
export type SettingsGroupId =
  | "sessionWorkspace"
  | "modelsUsage"
  | "providers"
  | "tools"
  | "system";

export type SettingsExpandedGroups = ReadonlySet<SettingsGroupId>;

export type SettingsProviderSection = "chatgpt" | "opencodeGo" | "grok" | "kiro" | "antigravity";

const PROVIDER_SECTIONS: readonly SettingsProviderSection[] = [
  "chatgpt",
  "opencodeGo",
  "grok",
  "kiro",
  "antigravity",
];

const PROVIDER_SECTION_SET = new Set<string>(PROVIDER_SECTIONS);

/** Default expanded groups when Settings opens on the yolk leaf. */
export const DEFAULT_SETTINGS_EXPANDED_GROUPS: SettingsGroupId[] = ["sessionWorkspace"];

type TreeNodeKind = "group" | "view";

interface FocusableTreeNode {
  focusId: string;
  kind: TreeNodeKind;
  /** Group this control expands/collapses, when applicable. */
  groupId?: SettingsGroupId;
  /** View this control activates, when applicable. */
  view?: SettingsView;
  /** Parent group that owns this node as a child (for Left-arrow parent jump). */
  parentGroupId?: SettingsGroupId;
  /** Nesting level used for indent styling. */
  level: 0 | 1 | 2;
  label: string;
  description?: string;
  icon: string;
}

interface SettingsTreeNavigationProps {
  activeView: SettingsView;
  expandedGroups: SettingsExpandedGroups;
  onExpandedGroupsChange: (next: SettingsExpandedGroups) => void;
  onSelectView: (view: SettingsView) => void;
  className?: string;
  "aria-label"?: string;
}

function isGroupExpanded(expanded: SettingsExpandedGroups, groupId: SettingsGroupId): boolean {
  return expanded.has(groupId);
}

/**
 * Stable ancestor mapping for deep-link / selection auto-expand.
 * Uses group ids only — never display labels.
 */
export function ancestorGroupsForView(view: SettingsView): SettingsGroupId[] {
  switch (view) {
    case "yolk":
    case "worktree":
      return ["sessionWorkspace"];
    case "studio":
    case "appearance":
    case "links":
      return [];
    case "usage":
    case "modelPrices":
    case "providerHub":
      return ["modelsUsage"];
    case "chatgpt":
    case "opencodeGo":
    case "grok":
    case "kiro":
    case "antigravity":
      return ["modelsUsage", "providers"];
    case "terminal":
    case "editor":
    case "trellis":
      return ["tools"];
    case "diagnostics":
      return ["system"];
    default: {
      const _exhaustive: never = view;
      return _exhaustive;
    }
  }
}

/** Merge view ancestors into the current expanded set without collapsing others. */
export function expandAncestorsForView(
  expanded: SettingsExpandedGroups,
  view: SettingsView,
): Set<SettingsGroupId> {
  const next = new Set(expanded);
  for (const groupId of ancestorGroupsForView(view)) {
    next.add(groupId);
  }
  return next;
}

function toggleGroup(
  expanded: SettingsExpandedGroups,
  groupId: SettingsGroupId,
  force?: boolean,
): Set<SettingsGroupId> {
  const next = new Set(expanded);
  const open = force ?? !next.has(groupId);
  if (open) next.add(groupId);
  else next.delete(groupId);
  return next;
}

/** Build the currently visible focusable controls in visual order. */
export function flattenVisibleTreeNodes(expanded: SettingsExpandedGroups): FocusableTreeNode[] {
  const nodes: FocusableTreeNode[] = [];

  nodes.push({
    focusId: "group:sessionWorkspace",
    kind: "group",
    groupId: "sessionWorkspace",
    level: 0,
    label: "会话与工作区",
    description: "蛋黄𝝅 与 WorkTree",
    icon: isGroupExpanded(expanded, "sessionWorkspace") ? "⌄" : "›",
  });
  if (isGroupExpanded(expanded, "sessionWorkspace")) {
    nodes.push({
      focusId: "view:yolk",
      kind: "view",
      view: "yolk",
      parentGroupId: "sessionWorkspace",
      level: 1,
      label: "蛋黄𝝅",
      description: "新会话默认聊天行为",
      icon: "π",
    });
    nodes.push({
      focusId: "view:worktree",
      kind: "view",
      view: "worktree",
      parentGroupId: "sessionWorkspace",
      level: 1,
      label: "WorkTree",
      description: "New WorkTree 默认配置",
      icon: "⑂",
    });
  }

  // Root leaves before 模型与用量: 外观, then Studio, then Links (approved product order).
  nodes.push({
    focusId: "view:appearance",
    kind: "view",
    view: "appearance",
    level: 0,
    label: "外观",
    description: "主题与网页背景皮肤",
    icon: "◐",
  });

  nodes.push({
    focusId: "view:studio",
    kind: "view",
    view: "studio",
    level: 0,
    label: "Studio",
    description: "YPI Studio 成员模型",
    icon: "✦",
  });

  nodes.push({
    focusId: "view:links",
    kind: "view",
    view: "links",
    level: 0,
    label: "Links",
    description: "GitHub 多账号身份连接管理",
    icon: "↗",
  });

  nodes.push({
    focusId: "group:modelsUsage",
    kind: "group",
    groupId: "modelsUsage",
    level: 0,
    label: "模型与用量",
    description: "Usage、模型价格与提供商策略",
    icon: isGroupExpanded(expanded, "modelsUsage") ? "⌄" : "›",
  });
  if (isGroupExpanded(expanded, "modelsUsage")) {
    nodes.push({
      focusId: "view:usage",
      kind: "view",
      view: "usage",
      parentGroupId: "modelsUsage",
      level: 1,
      label: "Usage",
      description: "Usage 统计范围",
      icon: "◫",
    });
    nodes.push({
      focusId: "view:modelPrices",
      kind: "view",
      view: "modelPrices",
      parentGroupId: "modelsUsage",
      level: 1,
      label: "模型价格",
      description: "模型价格配置与智能填写",
      icon: "$",
    });
    nodes.push({
      focusId: "view:providerHub",
      kind: "view",
      view: "providerHub",
      parentGroupId: "modelsUsage",
      // Expandable hub: same whole-row expand/collapse affordance as groups.
      groupId: "providers",
      level: 1,
      label: "提供商策略",
      description: "ChatGPT / OpenCode Go / Grok / Kiro 策略摘要",
      icon: isGroupExpanded(expanded, "providers") ? "⌄" : "›",
    });
    if (isGroupExpanded(expanded, "providers")) {
      const providerMeta: Record<SettingsProviderSection, { label: string; description: string; icon: string }> = {
        chatgpt: { label: "ChatGPT", description: "ChatGPT 用量与自动切换", icon: "G" },
        opencodeGo: { label: "OpenCode Go", description: "OpenCode Go 自动切换与账号管理", icon: "O" },
        grok: { label: "Grok", description: "Grok 全局 Active 与自动切号", icon: "X" },
        kiro: { label: "Kiro", description: "Kiro 全局 Active 与自动切号", icon: "K" },
        antigravity: { label: "Antigravity", description: "Antigravity 全局 Active 与自动切号", icon: "A" },
      };
      for (const section of PROVIDER_SECTIONS) {
        const meta = providerMeta[section];
        nodes.push({
          focusId: `view:${section}`,
          kind: "view",
          view: section,
          parentGroupId: "providers",
          level: 2,
          label: meta.label,
          description: meta.description,
          icon: meta.icon,
        });
      }
    }
  }

  nodes.push({
    focusId: "group:tools",
    kind: "group",
    groupId: "tools",
    level: 0,
    label: "工具",
    description: "Terminal、Editor 与 Trellis",
    icon: isGroupExpanded(expanded, "tools") ? "⌄" : "›",
  });
  if (isGroupExpanded(expanded, "tools")) {
    nodes.push({
      focusId: "view:terminal",
      kind: "view",
      view: "terminal",
      parentGroupId: "tools",
      level: 1,
      label: "Terminal",
      description: "Web 终端设置",
      icon: "›_",
    });
    nodes.push({
      focusId: "view:editor",
      kind: "view",
      view: "editor",
      parentGroupId: "tools",
      level: 1,
      label: "Editor",
      description: "文件编辑器和快捷键",
      icon: "⌁",
    });
    nodes.push({
      focusId: "view:trellis",
      kind: "view",
      view: "trellis",
      parentGroupId: "tools",
      level: 1,
      label: "Trellis",
      description: "Trellis 面板开关",
      icon: "T",
    });
  }

  nodes.push({
    focusId: "group:system",
    kind: "group",
    groupId: "system",
    level: 0,
    label: "系统",
    description: "诊断与本地工具",
    icon: isGroupExpanded(expanded, "system") ? "⌄" : "›",
  });
  if (isGroupExpanded(expanded, "system")) {
    nodes.push({
      focusId: "view:diagnostics",
      kind: "view",
      view: "diagnostics",
      parentGroupId: "system",
      level: 1,
      label: "诊断",
      description: "内存诊断快照",
      icon: "⌁",
    });
  }

  return nodes;
}

function focusIdForActiveView(view: SettingsView): string {
  return `view:${view}`;
}

function isProviderSection(view: SettingsView): view is SettingsProviderSection {
  return PROVIDER_SECTION_SET.has(view);
}

/**
 * Presentation-only Settings tree navigation.
 * Owns keyboard/roving focus for visible nodes; configuration state stays in SettingsConfig.
 */
export function SettingsTreeNavigation({
  activeView,
  expandedGroups,
  onExpandedGroupsChange,
  onSelectView,
  className,
  "aria-label": ariaLabel = "设置导航",
}: SettingsTreeNavigationProps) {
  const reactId = useId();
  const groupDomIds = useMemo(
    () =>
      ({
        sessionWorkspace: `${reactId}-group-sessionWorkspace`,
        modelsUsage: `${reactId}-group-modelsUsage`,
        providers: `${reactId}-group-providers`,
        tools: `${reactId}-group-tools`,
        system: `${reactId}-group-system`,
      }) satisfies Record<SettingsGroupId, string>,
    [reactId],
  );

  const visibleNodes = useMemo(
    () => flattenVisibleTreeNodes(expandedGroups),
    [expandedGroups],
  );

  const buttonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string>(() => focusIdForActiveView(activeView));

  // Keep roving focus on a still-visible node; prefer the active view when available.
  useEffect(() => {
    const visibleIds = new Set(visibleNodes.map((node) => node.focusId));
    const activeFocusId = focusIdForActiveView(activeView);
    if (visibleIds.has(focusedId)) return;
    if (visibleIds.has(activeFocusId)) {
      setFocusedId(activeFocusId);
      return;
    }
    setFocusedId(visibleNodes[0]?.focusId ?? activeFocusId);
  }, [activeView, focusedId, visibleNodes]);

  const setButtonRef = useCallback((focusId: string, el: HTMLButtonElement | null) => {
    if (el) buttonRefs.current.set(focusId, el);
    else buttonRefs.current.delete(focusId);
  }, []);

  const moveFocusTo = useCallback((focusId: string) => {
    setFocusedId(focusId);
    // Defer focus so newly expanded nodes exist in the DOM.
    requestAnimationFrame(() => {
      buttonRefs.current.get(focusId)?.focus();
    });
  }, []);

  const setGroupOpen = useCallback(
    (groupId: SettingsGroupId, open: boolean) => {
      onExpandedGroupsChange(toggleGroup(expandedGroups, groupId, open));
    },
    [expandedGroups, onExpandedGroupsChange],
  );

  const toggleGroupOpen = useCallback(
    (groupId: SettingsGroupId) => {
      onExpandedGroupsChange(toggleGroup(expandedGroups, groupId));
    },
    [expandedGroups, onExpandedGroupsChange],
  );

  const handleSelectView = useCallback(
    (view: SettingsView) => {
      // Selection never collapses other groups; only unions stable ancestors.
      // Provider hub uses the same whole-row expand control as groups (no side chevron):
      // - first open / navigate from another leaf: expand providers
      // - click again while already on hub: toggle collapse like other groups
      let nextExpanded = expandAncestorsForView(expandedGroups, view);
      if (view === "providerHub") {
        if (activeView === "providerHub") {
          nextExpanded = toggleGroup(nextExpanded, "providers");
        } else {
          nextExpanded = toggleGroup(nextExpanded, "providers", true);
        }
      }
      if (nextExpanded.size !== expandedGroups.size || [...nextExpanded].some((id) => !expandedGroups.has(id))) {
        onExpandedGroupsChange(nextExpanded);
      }
      onSelectView(view);
      moveFocusTo(focusIdForActiveView(view));
    },
    [activeView, expandedGroups, moveFocusTo, onExpandedGroupsChange, onSelectView],
  );

  const handleTreeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const nodes = flattenVisibleTreeNodes(expandedGroups);
      const index = nodes.findIndex((node) => node.focusId === focusedId);
      if (index < 0) return;

      const current = nodes[index];
      const focusAt = (nextIndex: number) => {
        const target = nodes[nextIndex];
        if (!target) return;
        event.preventDefault();
        moveFocusTo(target.focusId);
      };

      switch (event.key) {
        case "ArrowDown":
          focusAt(Math.min(nodes.length - 1, index + 1));
          return;
        case "ArrowUp":
          focusAt(Math.max(0, index - 1));
          return;
        case "Home":
          focusAt(0);
          return;
        case "End":
          focusAt(nodes.length - 1);
          return;
        case "ArrowRight": {
          if (current.kind === "group" && current.groupId) {
            event.preventDefault();
            if (!isGroupExpanded(expandedGroups, current.groupId)) {
              setGroupOpen(current.groupId, true);
            } else {
              // Enter first child when already expanded.
              const child = nodes[index + 1];
              if (child && child.parentGroupId === current.groupId) {
                moveFocusTo(child.focusId);
              }
            }
            return;
          }
          if (current.kind === "view" && current.view === "providerHub") {
            event.preventDefault();
            if (!isGroupExpanded(expandedGroups, "providers")) {
              setGroupOpen("providers", true);
            } else {
              // Move to the first provider leaf when providers are already open.
              const firstProvider = nodes.find((node) => node.view && isProviderSection(node.view));
              if (firstProvider) moveFocusTo(firstProvider.focusId);
            }
            return;
          }
          return;
        }
        case "ArrowLeft": {
          if (current.kind === "group" && current.groupId) {
            if (isGroupExpanded(expandedGroups, current.groupId)) {
              event.preventDefault();
              setGroupOpen(current.groupId, false);
            }
            return;
          }
          if (current.kind === "view" && current.view === "providerHub") {
            if (isGroupExpanded(expandedGroups, "providers")) {
              event.preventDefault();
              setGroupOpen("providers", false);
              return;
            }
          }
          if (current.parentGroupId) {
            event.preventDefault();
            // Prefer the group header / provider toggle that owns this child.
            const parentFocusId =
              current.parentGroupId === "providers"
                ? "view:providerHub"
                : `group:${current.parentGroupId}`;
            if (nodes.some((node) => node.focusId === parentFocusId)) {
              moveFocusTo(parentFocusId);
            } else {
              moveFocusTo(`group:${current.parentGroupId}`);
            }
          }
          return;
        }
        case "Enter":
        case " ": {
          // All focusable tree controls are native buttons; let them activate.
          // Do not preventDefault on Space here — that blocks button activation when the
          // event bubbles from the focused control to the tree container.
          return;
        }
        default:
          return;
      }
    },
    [expandedGroups, focusedId, moveFocusTo, setGroupOpen],
  );

  const renderViewButton = (node: FocusableTreeNode): ReactNode => {
    if (node.kind !== "view" || !node.view) return null;
    const active = activeView === node.view;
    const isRootLeaf = node.view === "studio";
    const isProviderHub = node.view === "providerHub";
    const providersOpen = isGroupExpanded(expandedGroups, "providers");

    return (
      <div
        key={node.focusId}
        className={[
          "settings-tree-node",
          "settings-tree-node--view",
          active ? "settings-tree-node--active" : "",
          isRootLeaf ? "settings-tree-node--root-leaf" : "",
          isProviderHub ? "settings-tree-node--provider-parent" : "",
        ]
          .filter(Boolean)
          .join(" ")}
        data-level={node.level}
        data-view={node.view}
      >
        <button
          ref={(el) => setButtonRef(node.focusId, el)}
          type="button"
          className={[
            "settings-tree-node__main",
            isProviderHub ? "settings-tree-node__main--group" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          role="treeitem"
          tabIndex={focusedId === node.focusId ? 0 : -1}
          aria-selected={active}
          aria-current={active ? "page" : undefined}
          aria-expanded={isProviderHub ? providersOpen : undefined}
          aria-controls={isProviderHub ? groupDomIds.providers : undefined}
          title={node.description}
          onClick={() => handleSelectView(node.view!)}
          onFocus={() => setFocusedId(node.focusId)}
        >
          <span className="settings-tree-node__icon" aria-hidden="true">
            {isProviderHub ? (providersOpen ? "⌄" : "›") : node.icon}
          </span>
          <span className="settings-tree-node__label">{node.label}</span>
        </button>
      </div>
    );
  };

  const renderGroup = (
    groupId: SettingsGroupId,
    label: string,
    description: string,
    children: ReactNode,
  ): ReactNode => {
    const open = isGroupExpanded(expandedGroups, groupId);
    const focusId = `group:${groupId}`;
    return (
      <div key={groupId} className="settings-tree-group">
        <div
          className="settings-tree-node settings-tree-node--group"
          data-level={0}
          data-group={groupId}
        >
          <button
            ref={(el) => setButtonRef(focusId, el)}
            type="button"
            className="settings-tree-node__main settings-tree-node__main--group"
            role="treeitem"
            tabIndex={focusedId === focusId ? 0 : -1}
            aria-selected={false}
            aria-expanded={open}
            aria-controls={groupDomIds[groupId]}
            title={description}
            onClick={() => toggleGroupOpen(groupId)}
            onFocus={() => setFocusedId(focusId)}
          >
            <span className="settings-tree-node__icon" aria-hidden="true">
              {open ? "⌄" : "›"}
            </span>
            <span className="settings-tree-node__label">{label}</span>
          </button>
        </div>
        <div
          id={groupDomIds[groupId]}
          className="settings-tree-group__children"
          role="group"
          hidden={!open}
        >
          {open ? children : null}
        </div>
      </div>
    );
  };

  return (
    <nav
      className={["settings-tree-nav", className].filter(Boolean).join(" ")}
      aria-label={ariaLabel}
    >
      <div className="settings-tree-nav__label">Settings</div>
      <div
        className="settings-tree"
        role="tree"
        aria-label={ariaLabel}
        onKeyDown={handleTreeKeyDown}
      >
        {renderGroup(
          "sessionWorkspace",
          "会话与工作区",
          "蛋黄𝝅 与 WorkTree",
          <>
            {renderViewButton({
              focusId: "view:yolk",
              kind: "view",
              view: "yolk",
              parentGroupId: "sessionWorkspace",
              level: 1,
              label: "蛋黄𝝅",
              description: "新会话默认聊天行为",
              icon: "π",
            })}
            {renderViewButton({
              focusId: "view:worktree",
              kind: "view",
              view: "worktree",
              parentGroupId: "sessionWorkspace",
              level: 1,
              label: "WorkTree",
              description: "New WorkTree 默认配置",
              icon: "⑂",
            })}
          </>,
        )}

        {renderViewButton({
          focusId: "view:appearance",
          kind: "view",
          view: "appearance",
          level: 0,
          label: "外观",
          description: "主题与网页背景皮肤",
          icon: "◐",
        })}

        {renderViewButton({
          focusId: "view:studio",
          kind: "view",
          view: "studio",
          level: 0,
          label: "Studio",
          description: "YPI Studio 成员模型",
          icon: "✦",
        })}

        {renderViewButton({
          focusId: "view:links",
          kind: "view",
          view: "links",
          level: 0,
          label: "Links",
          description: "GitHub 多账号身份连接管理",
          icon: "↗",
        })}

        {renderGroup(
          "modelsUsage",
          "模型与用量",
          "Usage、模型价格与提供商策略",
          <>
            {renderViewButton({
              focusId: "view:usage",
              kind: "view",
              view: "usage",
              parentGroupId: "modelsUsage",
              level: 1,
              label: "Usage",
              description: "Usage 统计范围",
              icon: "◫",
            })}
            {renderViewButton({
              focusId: "view:modelPrices",
              kind: "view",
              view: "modelPrices",
              parentGroupId: "modelsUsage",
              level: 1,
              label: "模型价格",
              description: "模型价格配置与智能填写",
              icon: "$",
            })}
            {renderViewButton({
              focusId: "view:providerHub",
              kind: "view",
              view: "providerHub",
              parentGroupId: "modelsUsage",
              level: 1,
              label: "提供商策略",
              description: "ChatGPT / OpenCode Go / Grok / Kiro 策略摘要",
              icon: "◇",
            })}
            <div
              id={groupDomIds.providers}
              className="settings-tree-group__children settings-tree-group__children--providers"
              role="group"
              hidden={!isGroupExpanded(expandedGroups, "providers")}
            >
              {isGroupExpanded(expandedGroups, "providers")
                ? PROVIDER_SECTIONS.map((section) => {
                    const meta: Record<
                      SettingsProviderSection,
                      { label: string; description: string; icon: string }
                    > = {
                      chatgpt: {
                        label: "ChatGPT",
                        description: "ChatGPT 用量与自动切换",
                        icon: "G",
                      },
                      opencodeGo: {
                        label: "OpenCode Go",
                        description: "OpenCode Go 自动切换与账号管理",
                        icon: "O",
                      },
                      grok: {
                        label: "Grok",
                        description: "Grok 全局 Active 与自动切号",
                        icon: "X",
                      },
                      antigravity: {
                        label: "Antigravity",
                        description: "Antigravity 全局 Active 与自动切号",
                        icon: "A",
                      },
                      kiro: {
                        label: "Kiro",
                        description: "Kiro 全局 Active 与自动切号",
                        icon: "K",
                      },
                    };
                    const item = meta[section];
                    return renderViewButton({
                      focusId: `view:${section}`,
                      kind: "view",
                      view: section,
                      parentGroupId: "providers",
                      level: 2,
                      label: item.label,
                      description: item.description,
                      icon: item.icon,
                    });
                  })
                : null}
            </div>
          </>,
        )}

        {renderGroup(
          "tools",
          "工具",
          "Terminal、Editor 与 Trellis",
          <>
            {renderViewButton({
              focusId: "view:terminal",
              kind: "view",
              view: "terminal",
              parentGroupId: "tools",
              level: 1,
              label: "Terminal",
              description: "Web 终端设置",
              icon: "›_",
            })}
            {renderViewButton({
              focusId: "view:editor",
              kind: "view",
              view: "editor",
              parentGroupId: "tools",
              level: 1,
              label: "Editor",
              description: "文件编辑器和快捷键",
              icon: "⌁",
            })}
            {renderViewButton({
              focusId: "view:trellis",
              kind: "view",
              view: "trellis",
              parentGroupId: "tools",
              level: 1,
              label: "Trellis",
              description: "Trellis 面板开关",
              icon: "T",
            })}
          </>,
        )}

        {renderGroup(
          "system",
          "系统",
          "诊断与本地工具",
          renderViewButton({
            focusId: "view:diagnostics",
            kind: "view",
            view: "diagnostics",
            parentGroupId: "system",
            level: 1,
            label: "诊断",
            description: "内存诊断快照",
            icon: "⌁",
          }),
        )}
      </div>
    </nav>
  );
}
