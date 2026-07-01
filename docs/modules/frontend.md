# Frontend Module Map

## Components

| File | Purpose |
| --- | --- |
| `components/AppShell.tsx` | Top-level layout, URL state, tab management, Web Terminal bottom-dock toggling, right drawer mode switching between files and optional Trellis tasks, and Trellis-task-to-chat context block insertion. |
| `components/SessionSidebar.tsx` | Session tree sidebar, workspace/WorkTree picker actions grouped by main workspace, archive/unarchive actions, archived section, multi-select batch archive, and integrated file explorer. |
| `components/ChatWindow.tsx` | Message list, SSE streaming, fork/navigate logic. Shows archived banner and disables input for archived sessions. |
| `components/ChatInput.tsx` | Input bar, model dropdown, thinking level, tool preset, image upload, file-reference chips, and serialized Trellis task context blocks. |
| `components/ChatGptUsagePanel.tsx` | Optional semi-transparent top-bar ChatGPT/Codex quota panel; reads and periodically revalidates cached active-account usage and reset-credit availability, reloads accounts on expand, lists saved accounts with quick activation, supports manual quota refresh and confirmed reset-credit consumption for the active account, and shows backend auto-refresh scheduler/lock maintenance state. |
| `components/ChatGptWarmupDialog.tsx` | ChatGPT/Codex warmup management dialog opened from the saved-account management area; supports manual multi-select warmup, scheduled warmup account/time settings, and recent manual/scheduled run history. |
| `components/MessageView.tsx` | Render user, assistant, tool-call, and tool-result messages. |
| `components/BranchNavigator.tsx` | In-session branch switcher. |
| `components/ChatMinimap.tsx` | Scroll minimap beside message list. |
| `components/ToolPanel.tsx` | Tool presets and preset inference helpers. |
| `components/ModelsConfig.tsx` | Modal for editing `models.json`, OAuth/API-key auth, and ChatGPT Plus/Pro saved-account add/import, activation, temporary account selection for the subscription/usage panel, remarks, extra-info dialog, cached quota reset display with inline mini usage pies, manual quota refresh, inactive-account deletion, and raw/CPA/SUB2API account JSON import via shared converters. |
| `components/GitPanel.tsx` | Git status dropdown panel showing branch, previewable commit graph by selected local branch, staged/unstaged changes, untracked files, stash, and local branch switching with an explicit Switch button. |
| `components/SkillsConfig.tsx` | Modal for browsing/installing skills. |
| `components/SettingsConfig.tsx` | Settings modal for WorkTree defaults, Usage scan scope, Web Terminal enablement/shell/env settings plus raw/AI env parsing model controls, ChatGPT usage panel and backend auto-refresh settings, Editor implementation/shortcut settings, and optional Trellis panel settings in `pi-web.json`, including Trellis docs guidance, prerequisite/status inspection, install/init, update, proxy controls, Trellis workflow assistant primary/fallback model controls, and Trellis subagent model policy controls. ChatGPT warmup schedule is managed from `ChatGptWarmupDialog` and preserved by settings saves. |
| `components/SubagentPanel.tsx` | Top-bar subagent activity panel, including nested subagent inspection and compact model/thinking metadata chips when subagent routing or result metadata is available. |
| `components/TrellisPanel.tsx` | Read-only Trellis task drawer: top-level task list with expandable child task groups, filters, details, artifacts, hierarchy, manifest/context counts, recorded task metadata, optional check-run state, derived phase/progress, optional externally focused task selection, and a join-chat action that adds active tasks as chat context blocks without mutating Trellis files. |
| `components/TrellisWorkflowVisualizer.tsx` | Large read-only Settings → Trellis modal that visualizes `.trellis/workflow.md` phases, steps, workflow-state blocks, source line ranges, parser warnings, Markdown/raw guidance text, and model-assisted Chinese reading summaries as a foundation for future workflow editing. |
| `components/TrellisSessionWidget.tsx` | Floating session-scoped Trellis progress widget shown only when the current chat session has a high-confidence associated task; includes compact child-task progress when present, and clicking opens the Trellis drawer focused on that task. |
| `components/TerminalPanel.tsx` | Bottom-dock Web Terminal workspace using xterm; manages ephemeral multi-tab terminal sessions, per-pane tab strips, tab renaming, nested drag-to-split panes, pane and dock resizing, minimize/restore, app-local fullscreen, and destructive close confirmation while reusing existing terminal session APIs per tab. |
| `components/UsageStatsModal.tsx` | Token/cost usage statistics modal with active/archive scan counts and rounded M-token conversions. |
| `components/FileExplorer.tsx` | File tree inside the sidebar. |
| `components/FileViewer.tsx` | File content viewer/editor in a tab; routes media/document previews, orchestrates text editing state, and exposes Java implementation lookup results. |
| `components/MonacoFileEditor.tsx` | Monaco-backed source editor for text files, including language mapping, basic completions, word wrap, theme, and line-selection callbacks. |
| `components/FileIcons.tsx` | Monochrome SVG icons for files/folders. |
| `components/MarkdownBody.tsx` | Markdown, KaTeX, Mermaid, and syntax highlighting renderer. |
| `components/TabBar.tsx` | Chat and open-file tab bar. |

## Hooks

| File | Purpose |
| --- | --- |
| `hooks/useAgentSession.ts` | Central chat/session hook: data loading, SSE, streaming state, commands, tools, models, thinking levels, and subagent run/routing metadata. |
| `hooks/useTheme.ts` | Dark/light theme toggle with view-transition animation. |
| `hooks/useDragDrop.ts` | Drag-and-drop image attachment handler. |
| `hooks/useAudio.ts` | Sound toggle and completion chime playback. |

## Styles

Global CSS lives in `app/globals.css`. Components may reference these CSS variables directly:

```text
--bg --bg-panel --bg-hover --bg-selected --bg-subtle --border
--text --text-muted --text-dim --accent --accent-hover
--user-bg --assistant-bg --tool-bg --font-mono
```

They are also mapped to Tailwind `--color-*` utility aliases. The theme toggles by adding/removing `dark` on `document.documentElement`.
