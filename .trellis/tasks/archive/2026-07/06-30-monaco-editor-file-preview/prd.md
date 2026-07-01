# Monaco editor file preview

## Goal

Upgrade the file preview surface into a Monaco Editor-based real editing experience so users can open mainstream source/config files, edit them with syntax highlighting and basic suggestions, and save changes back to disk safely.

## User Value

- Code files opened from the file explorer should feel like a real editor rather than a rendered code block.
- Users should be able to make small edits directly from pi-web without switching to an external IDE.
- Users should get language-aware highlighting and lightweight completion hints for common code/config files.
- Existing preview affordances should remain available where they still make sense: live file metadata, Markdown/HTML preview toggles, diff view after external changes, line selection for “Add to chat”, and word wrap.

## Confirmed Facts

- `components/FileViewer.tsx` owns file preview routing and text preview rendering.
- Text preview currently uses `react-syntax-highlighter` for source view, `ReactMarkdown` for Markdown preview, and iframe `srcDoc` for HTML preview.
- Text file content is read from `GET /api/files/[...path]?type=read` and file changes are watched with `GET /api/files/[...path]?type=watch`.
- `app/api/files/[...path]/route.ts` returns `{ content, language, size }` for text reads and caps text preview at 256 KB.
- There is no existing file save API for workspace files; `app/api/files/upload/route.ts` only writes uploaded attachments under `~/.pi/agent/uploads`.
- Image, audio, PDF, and DOCX preview paths are separate and should not be converted to Monaco.
- Current project does not include `monaco-editor` or `@monaco-editor/react`.
- `@monaco-editor/react@4.7.0` supports React 19 and depends on `@monaco-editor/loader`; it is a React integration wrapper, not the language-support package itself.
- `monaco-editor@0.55.1` is the actual browser editor package. It provides the editor UI, tokenization/syntax highlighting, and built-in language services for supported languages. It is large, so it should be lazy-loaded.

## Requirements

- Use Monaco Editor for the source view of text/code files.
- Support real editing and saving for text/code files under allowed workspace roots.
- Add a save API that validates allowed roots, requires the target to be an existing regular file, rejects non-text/binary targets, and writes content safely.
- Track dirty state in the file viewer after local edits.
- Provide explicit Save UI and keyboard shortcut (`Cmd/Ctrl+S`) for dirty files.
- Preserve selected-line Add-to-chat behavior with Monaco selections.
- Handle external file changes while the editor is dirty without silently overwriting either side.
- Preserve Markdown preview as the default for Markdown files, with a Monaco-backed Raw/source mode.
- Preserve HTML Code/Preview toggle; Code mode should use Monaco and Preview mode should keep sandboxed iframe behavior.
- Preserve current specialized viewers for image, audio, PDF, and DOCX files.
- Preserve file watch/live refresh behavior for clean files; dirty files should not auto-replace unsaved editor content.
- Preserve diff/source toggle after external changes where feasible.
- Preserve word-wrap toggle by mapping it to Monaco editor options.
- Provide syntax highlighting for mainstream programming/config languages through Monaco language mapping.
- Provide basic suggestions using Monaco built-in language services where available plus lightweight local completions/snippets where appropriate.
- Keep dependency loading local/offline-friendly, not CDN-only.

## Mainstream Language Coverage Target

At minimum, recognize and map common extensions/names for:

- Web: JavaScript, TypeScript, JSX/TSX, HTML, CSS, SCSS, Less, JSON, JSONL, Markdown/MDX.
- Backend/general: Python, Go, Rust, Java, Kotlin, Swift, C, C++, C#, Ruby, PHP, Scala, Lua, Perl, R.
- Shell/config/data: Bash/sh/zsh/fish, PowerShell, Dockerfile, Makefile, SQL, GraphQL, YAML, TOML, XML, INI/properties/env, HCL/Terraform, protobuf.

Language-service depth may differ by language: Monaco provides rich built-ins for JavaScript/TypeScript/JSON/CSS/HTML and tokenization/basic editor features for many others.

## Acceptance Criteria

- [ ] Opening a TypeScript/JavaScript/JSON/CSS/HTML/Markdown file source view shows Monaco Editor instead of `react-syntax-highlighter`.
- [ ] Opening mainstream source/config file types maps to an appropriate Monaco language where Monaco supports one, otherwise falls back gracefully to plaintext.
- [ ] Monaco follows the app dark/light theme closely enough for normal use.
- [ ] Editing a text/code file marks it dirty.
- [ ] Save button and `Cmd/Ctrl+S` persist dirty content to disk through a workspace-root-validated API.
- [ ] Save failures are visible and do not clear dirty state.
- [ ] External file changes do not silently overwrite unsaved local edits.
- [ ] Typing/navigation in the Monaco surface can trigger basic suggestions for supported languages.
- [ ] Selecting lines in Monaco and clicking Chat passes the correct line range to `onAddChat`.
- [ ] `Cmd/Ctrl+1` still adds the whole file or selected line range to chat.
- [ ] Word wrap toggle updates Monaco wrapping.
- [ ] Markdown preview mode and HTML preview mode still work.
- [ ] External file changes still refresh clean editor content and expose diff/source information where applicable.
- [ ] Images, audio, PDF, DOCX previews are unaffected.
- [ ] `npm run lint` and `node_modules/.bin/tsc --noEmit` pass.

## Out of Scope for MVP

- Project-wide language-server indexing.
- Full VS Code keybinding/settings compatibility.
- New file creation, rename, delete, or refactor actions.
- Multi-tab dirty-state badges in `TabBar` unless time permits; dirty state may initially be shown inside the file viewer status bar.

## Conflict Policy

If the disk file changes while there are unsaved editor edits, keep local unsaved edits visible, show a conflict warning, and make save fail with a clear conflict until the user reloads or otherwise resolves manually. Never silently overwrite user edits or external disk changes.

## Notes

- Research notes: `research/monaco-editor-findings.md`.
