# Design: Monaco editor file preview

## Scope

Replace the text source preview renderer with a Monaco Editor component and add safe save-to-disk editing for existing text/code files. Preserve the existing file viewer shell, file-type routing, previews, live refresh behavior for clean files, diff behavior, and chat line-selection flow.

## Architecture

### Existing boundary

- `app/api/files/[...path]/route.ts` remains the workspace-file route for content, language, size, metadata, watch SSE events, and directory listing.
- `components/FileViewer.tsx` remains the feature orchestrator and status bar owner.
- Image/audio/document viewers remain unchanged.

### Save API

Extend `app/api/files/[...path]/route.ts` with `PUT` for text saves.

Request body:

```ts
interface SaveFileRequest {
  content: string;
  expectedMtimeMs?: number;
}
```

Success response:

```ts
interface SaveFileResponse {
  ok: true;
  size: number;
  mtimeMs: number;
  language: string;
}
```

Error behavior:

- `403` when target is outside allowed roots.
- `404` when target does not exist.
- `400` when target is not a regular file or payload is invalid.
- `409` when `expectedMtimeMs` is provided and the file changed on disk since load/save baseline.
- `413` when content exceeds the text editing limit.
- Reject known binary/preview-only types and content containing NUL bytes.

Implementation notes:

- Keep writes scoped to existing files only in the MVP.
- Use `fs.writeFileSync(filePath, content, "utf-8")` after validation, then stat the file and return fresh metadata.
- Keep the read limit at 256 KB initially unless product feedback asks for larger editable files.
- Existing `type=read` stays unchanged except optional inclusion of `mtimeMs` would help conflict detection.

### New component

Add `components/MonacoFileEditor.tsx`:

- Client component only.
- Renders Monaco through `@monaco-editor/react`.
- Configures loader to use the locally installed `monaco-editor` package rather than a CDN.
- Receives content, language, theme mode, editable/read-only state, wrap flag, and callbacks.
- Owns Monaco language normalization and editor options.
- Registers lightweight completion providers once per Monaco instance.
- Emits selected line ranges from Monaco selection changes.
- Emits content changes to `TextFileViewer`.

Proposed props:

```ts
interface Props {
  value: string;
  language: string;
  isDark: boolean;
  wrapLines: boolean;
  readOnly?: boolean;
  onChange?: (value: string) => void;
  onSelectedLinesChange?: (selection: { startLine: number; endLine: number } | null) => void;
}
```

### FileViewer state changes

`TextFileViewer` should track:

- `savedContent`: last content known to be on disk.
- `editorContent`: current Monaco content.
- `dirty`: derived from `editorContent !== savedContent`.
- `mtimeMs`: save/read baseline when available.
- `saving`: save request in flight.
- `saveError`: last save error.
- `externalChangePending`: disk changed while dirty.

Behavior:

- On initial read: set both `savedContent` and `editorContent`.
- On Monaco edit: update `editorContent`; dirty becomes true.
- On clean watch change: refresh content into both saved/editor states and set `prevContent` for diff.
- On dirty watch change: do not replace `editorContent`; set `externalChangePending` and keep user edits visible.
- On save: send `editorContent` plus `expectedMtimeMs`; on success update saved baseline and clear dirty/error/pending state.
- On `409`: keep dirty state and show a conflict message. A follow-up iteration can add a merge UI; MVP can instruct the user to reload/diff manually.

### FileViewer rendering changes

- Replace the `<SyntaxHighlighter>` source branch with `<MonacoFileEditor />`.
- Remove source-view mouse selection logic that depends on `pre > code` DOM shape.
- Keep `selectedLines` state in `TextFileViewer`, updated by Monaco.
- Add Save button/status in the existing file status bar.
- Add `Cmd/Ctrl+S` handler scoped to text file viewer.
- Keep Markdown/HTML preview toggles, diff toggle, live watch, fetch, and Add Chat shortcut logic.
- Keep `DiffView` unchanged for now; Monaco diff editor can be a future enhancement.

## Language Support Strategy

- `@monaco-editor/react` is only the React wrapper that mounts Monaco in React and handles lifecycle/loader integration.
- `monaco-editor` is the actual editor and language package.
- Expand server-side `EXT_TO_LANGUAGE` in `app/api/files/[...path]/route.ts` so API language names align with Monaco IDs for mainstream extensions.
- In the client, normalize any existing API language aliases to Monaco IDs.
- Rely on Monaco&apos;s built-in rich providers for JavaScript/TypeScript, JSON, CSS, and HTML.
- Rely on Monaco tokenizers/basic language definitions for many other mainstream languages.
- Add a small local completion provider for common language keywords/snippets plus document-word suggestions. This satisfies basic hints without a language server.

## Data Flow

1. User opens a file tab.
2. `TextFileViewer` fetches `/api/files/[...path]?type=read` and receives `{ content, language, size, mtimeMs? }`.
3. Source mode passes `editorContent` and `language` to `MonacoFileEditor`.
4. Monaco renders syntax highlighting and suggestions.
5. Monaco content changes update local editor state and dirty status.
6. Monaco selection changes emit line ranges to `TextFileViewer`.
7. Add Chat button/shortcut calls existing `onAddChat(filePath, selectedLines ?? undefined)`.
8. Save button/shortcut calls `PUT /api/files/[...path]`.
9. File watch SSE changes refresh clean editor content or flag a dirty-file external-change conflict.

## Theme Strategy

- Use Monaco built-in `vs` and `vs-dark` initially for robust compatibility.
- Optionally define custom themes later using project CSS variables if built-ins are visually too different.

## Compatibility and Risk

- Monaco is large; isolate it in `components/MonacoFileEditor.tsx` and load it only when source view is used.
- Monaco is browser-only; keep imports in client-only component code.
- Local package loading should be used instead of CDN defaults to support local/offline pi-web usage.
- Worker bundling can be the hardest Next integration point. If `@monaco-editor/react` with local loader config does not work under Next, fallback to explicit worker setup or a lighter dynamic-import boundary.
- Save introduces real filesystem mutation. Validation must use the existing `getAllowedRoots()` / `isPathAllowed()` route pattern and must reject binary/preview-only files.

## Rollback

- Restore the `react-syntax-highlighter` source branch in `FileViewer.tsx` and remove Monaco dependencies/component.
- Remove the `PUT` route branch from `app/api/files/[...path]/route.ts`.
- Non-text preview paths should not need rollback because they should remain unchanged.
