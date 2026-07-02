# Frontend Module Map

## Components

| File | Purpose |
| --- | --- |
| `components/AppShell.tsx` | Top-level layout, URL state, tab management, Web Terminal bottom-dock toggling, resizable left drawer, right drawer mode switching between files and optional Trellis tasks, and Trellis-task-to-chat context block insertion. |
| `components/SessionSidebar.tsx` | Session tree sidebar, workspace/WorkTree picker actions grouped by main workspace, Trellis-uninitialized workspace prompt that opens the Web Terminal with `trellis init` prefilled and polls setup status until initialization is detected, archive/unarchive actions, archived section, multi-select batch archive, and integrated file explorer with a resizable session/explorer split. |
| `components/Checkbox.tsx` | Shared theme-aware checkbox control with custom focus, hover, checked visuals, optional label text, and native input semantics. |
| `components/ChatWindow.tsx` | Message list, SSE streaming, fork/navigate logic. Shows archived banner and disables input for archived sessions. |
| `components/ChatInput.tsx` | Input bar, model dropdown, thinking level, tool preset, image upload, file-reference chips, slash-command autocomplete for extension commands/skills/prompt templates, and serialized Trellis task context blocks. New empty sessions receive the default tool preset from `pi-web.json` (`yolk.defaultToolPreset`) and can still be changed per session from the compact preset dropdown; default/full/subagent presets include the built-in YPI Studio task tool, and the subagent preset also includes Studio member delegation. |
| `components/ModelSelect.tsx` | Shared searchable model selector used by chat and settings model policy fields, with grouped options and fuzzy jump/subsequence search. |
| `components/SelectDropdown.tsx` | Shared non-search dropdown used by compact chat controls and settings fields such as thinking-level selectors. |
| `components/ChatGptUsagePanel.tsx` | Optional semi-transparent top-bar ChatGPT/Codex quota panel; reads and periodically revalidates cached active-account usage and reset-credit availability, reloads accounts on expand, lists saved accounts with quick activation, supports manual quota refresh and confirmed reset-credit consumption for the active account, and shows backend auto-refresh scheduler/lock maintenance state. |
| `components/ChatGptWarmupDialog.tsx` | ChatGPT/Codex warmup management dialog opened from the saved-account management area; supports manual multi-select warmup, scheduled warmup account/time settings, and recent manual/scheduled run history. |
| `components/MessageView.tsx` | Render user, assistant, tool-call, and tool-result messages; routes `ypi_studio_subagent` tool calls to the Studio transcript view while generic tools keep the compact JSON/result renderer. |
| `components/YpiStudioSubagentTranscript.tsx` | Chat-like transcript renderer for YPI Studio member delegation tool calls, combining live `tool_execution_update` progress, persisted transcript API data, delegated input, final output, resolved model/thinking/source chips, `waiting_for_user` prompts, and missing-transcript fallbacks. |
| `components/BranchNavigator.tsx` | In-session branch switcher. |
| `components/ChatMinimap.tsx` | Scroll minimap beside message list. |
| `components/ToolPanel.tsx` | Tool presets and preset inference helpers, including YPI Studio task/delegation tools in the appropriate presets so implicit workflow routing can create tasks and dispatch members. |
| `components/ModelsConfig.tsx` | Modal for editing `models.json`, OAuth/API-key auth, and ChatGPT Plus/Pro saved-account add/import, activation, temporary account selection for the subscription/usage panel, remarks, extra-info dialog, cached quota reset display with inline mini usage pies, manual quota refresh, inactive-account deletion, and raw/CPA/SUB2API account JSON import via shared converters. |
| `components/GitPanel.tsx` | Git status dropdown panel showing branch, previewable/selectable commit graph by selected local branch, selected-commit metadata and changed files, staged/unstaged changes, untracked files, stash, and local branch switching with an explicit Switch button. |
| `components/CommitGraph.tsx` | Git commit graph renderer with lane visualization, refs, hover tooltips, and optional selected-commit callbacks for the Git panel. |
| `components/GitCommitDiffModal.tsx` | Git commit file-diff adapter that fetches one selected commit file diff, formats commit/file metadata and fallback labels, and renders the shared diff modal. |
| `components/SkillsConfig.tsx` | Modal for browsing/installing skills. |
| `components/SettingsConfig.tsx` | Settings modal for Yolk Pi chat defaults such as the default new-session tool preset, WorkTree defaults, YPI Studio default/member model and thinking policy controls, Usage scan scope, Web Terminal enablement/shell/env settings including Unix and Windows shell choices plus raw/AI env parsing model controls, ChatGPT usage panel and backend auto-refresh settings, Editor implementation/shortcut settings, and optional Trellis panel settings in `pi-web.json`, including Trellis docs guidance, prerequisite/status inspection, CLI install, terminal-driven update command, proxy controls, Trellis workflow assistant primary/fallback model controls, and Trellis subagent model policy controls. ChatGPT warmup schedule is managed from `ChatGptWarmupDialog` and preserved by settings saves. |
| `components/SubagentPanel.tsx` | Top-bar subagent activity panel, including nested subagent inspection and compact model/thinking metadata chips when subagent routing or result metadata is available. |
| `components/TrellisPanel.tsx` | Read-only Trellis task drawer: top-level task list with expandable child task groups, filters, details, artifacts, hierarchy, manifest/context counts, recorded task metadata, optional check-run state, derived phase/progress, optional externally focused task selection, and a join-chat action that adds active tasks as chat context blocks without mutating Trellis files. If Trellis is enabled for an uninitialized workspace, it shows an initialization prompt that opens the Web Terminal with `trellis init` prefilled for user-driven interactive setup. |
| `components/TrellisWorkflowVisualizer.tsx` | Large read-only Settings → Trellis modal that visualizes `.trellis/workflow.md` phases, steps, workflow-state blocks, source line ranges, parser warnings, Markdown/raw guidance text, and model-assisted Chinese reading summaries as a foundation for future workflow editing. |
| `components/TrellisSessionWidget.tsx` | Floating session-scoped Trellis progress widget shown only when the current chat session has a high-confidence associated task; includes compact child-task progress when present, and clicking opens the Trellis drawer focused on that task. |
| `components/YpiStudioPanel.tsx` | Right-drawer YPI Studio panel with Members, Workflows, and Tasks tabs. It reads `.ypi/agents/`, `.ypi/workflows/`, and active/archived/all `.ypi/tasks/` scopes, initializes/backfills default members and workflow JSON, reports safe member-template updates and custom-member warnings without overwriting user edits, previews member Markdown, reminds users that member runtime model/thinking lives in Settings → Studio, shows workflow state-machine metadata, shows task progress/status, offers a confirmed archive action for completed active tasks, displays archived task knowledge paths, and opens member/workflow/task files in the file viewer using each record's `pathLabel`. |
| `components/SessionChangesFloatingPanel.tsx` | Floating chat-session file-change panel that lists tracked edit/write file changes and opens per-file diffs. |
| `components/FileDiffModal.tsx` | Session changed-file diff adapter that fetches one tracked file diff, formats session metadata and fallback labels, and renders the shared diff modal. |
| `components/DiffModal.tsx` | Shared read-only diff modal shell with close-on-Escape, overlay click close, source-specific header slot, loading/error/fallback handling, and Unified/Side-by-side mode controls defaulting to side-by-side. |
| `components/DiffView.tsx` | Shared diff renderer switch that renders unified diffs through `UnifiedDiffView` or parsed side-by-side diffs through `SideBySideDiffView`. |
| `components/SideBySideDiffView.tsx` | Theme-aware side-by-side unified diff parser/renderer with old/new line numbers, aligned modification rows, and metadata/hunk rows. |
| `components/UnifiedDiffView.tsx` | Theme-aware unified diff renderer for added, removed, hunk, header, and context lines. |
| `components/TerminalPanel.tsx` | Bottom-dock Web Terminal workspace using xterm; manages ephemeral multi-tab terminal sessions, one-shot prefilled input for setup flows, per-pane tab strips, tab renaming, nested drag-to-split panes, pane and dock resizing, minimize/restore, app-local fullscreen, and destructive close confirmation while reusing existing terminal session APIs per tab. |
| `components/UsageStatsModal.tsx` | Token/cost usage statistics modal with active/archive scan counts and rounded M-token conversions. |
| `components/FileExplorer.tsx` | File tree inside the sidebar, including per-folder loading/error states and large-directory truncation notices. |
| `components/FileViewer.tsx` | File content viewer/editor in a tab; routes media/document previews, orchestrates text editing state, and exposes Java implementation lookup results. |
| `components/MonacoFileEditor.tsx` | Monaco-backed source editor for text files, including language mapping, basic completions, word wrap, theme, and line-selection callbacks. |
| `components/FileIcons.tsx` | Monochrome SVG icons for files/folders. |
| `components/MarkdownBody.tsx` | Markdown, KaTeX, Mermaid, and syntax highlighting renderer. |
| `components/TabBar.tsx` | Chat and open-file tab bar. |

## Hooks

| File | Purpose |
| --- | --- |
| `hooks/useAgentSession.ts` | Central chat/session hook: data loading, SSE, streaming state, commands, tools, models, thinking levels, subagent run/routing metadata, and per-tool live progress keyed by `toolCallId` for accumulated `tool_execution_update` partial results. |
| `hooks/useTheme.ts` | Dark/light theme toggle with view-transition animation. |
| `hooks/useDragDrop.ts` | Drag-and-drop image attachment handler. |
| `hooks/useAudio.ts` | Sound toggle and completion chime playback. |
| `hooks/useAutoScroll.ts` | Persisted chat auto-stick-to-bottom preference used by the message list and input toggle. |

## Styles

Global CSS lives in `app/globals.css`. Components may reference these CSS variables directly:

```text
--bg --bg-panel --bg-hover --bg-selected --bg-subtle --border
--text --text-muted --text-dim --accent --accent-hover
--user-bg --assistant-bg --tool-bg --font-mono
```

They are also mapped to Tailwind `--color-*` utility aliases. The theme toggles by adding/removing `dark` on `document.documentElement`.
