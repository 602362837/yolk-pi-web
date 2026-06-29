# Frontend Module Map

## Components

| File | Purpose |
| --- | --- |
| `components/AppShell.tsx` | Top-level layout, URL state, tab management, and right drawer mode switching between files and optional Trellis tasks. |
| `components/SessionSidebar.tsx` | Session tree sidebar, workspace/WorkTree picker actions grouped by main workspace, archive/unarchive actions, archived section, multi-select batch archive, and integrated file explorer. |
| `components/ChatWindow.tsx` | Message list, SSE streaming, fork/navigate logic. Shows archived banner and disables input for archived sessions. |
| `components/ChatInput.tsx` | Input bar, model dropdown, thinking level, tool preset, image upload. |
| `components/ChatGptUsagePanel.tsx` | Optional semi-transparent top-bar ChatGPT/Codex quota panel; reads cached active-account usage, expands to account details, and supports manual quota refresh. |
| `components/MessageView.tsx` | Render user, assistant, tool-call, and tool-result messages. |
| `components/BranchNavigator.tsx` | In-session branch switcher. |
| `components/ChatMinimap.tsx` | Scroll minimap beside message list. |
| `components/ToolPanel.tsx` | Tool presets and preset inference helpers. |
| `components/ModelsConfig.tsx` | Modal for editing `models.json`, OAuth/API-key auth, and ChatGPT Plus/Pro saved-account add/import, activation, remarks, extra-info dialog, cached quota reset display with inline mini usage pies, manual quota refresh, inactive-account deletion, and raw/CPA/SUB2API account JSON import via shared converters. |
| `components/GitPanel.tsx` | Git status dropdown panel showing branch, previewable commit graph by selected local branch, staged/unstaged changes, untracked files, stash, and local branch switching with an explicit Switch button. |
| `components/SkillsConfig.tsx` | Modal for browsing/installing skills. |
| `components/SettingsConfig.tsx` | Settings modal for WorkTree defaults, Usage scan scope, ChatGPT usage panel settings, and optional Trellis panel settings in `pi-web.json`, including Trellis docs guidance, prerequisite/status inspection, install/init, update, proxy controls, and Trellis subagent model policy controls. |
| `components/SubagentPanel.tsx` | Top-bar subagent activity panel, including nested subagent inspection and compact model/thinking metadata chips when subagent routing or result metadata is available. |
| `components/TrellisPanel.tsx` | Read-only Trellis task drawer: task list, filters, details, artifacts, hierarchy, manifest/context counts, recorded task metadata, optional check-run state, derived phase/progress, and optional externally focused task selection. |
| `components/TrellisSessionWidget.tsx` | Floating session-scoped Trellis progress widget shown only when the current chat session has a high-confidence associated task; clicking opens the Trellis drawer focused on that task. |
| `components/UsageStatsModal.tsx` | Token/cost usage statistics modal with active/archive scan counts and rounded M-token conversions. |
| `components/FileExplorer.tsx` | File tree inside the sidebar. |
| `components/FileViewer.tsx` | File content viewer in a tab. |
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
