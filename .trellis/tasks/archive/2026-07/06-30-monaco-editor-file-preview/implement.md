# Implementation Plan: Monaco editor file preview

## Checklist

1. Add dependencies:
   - `monaco-editor`
   - `@monaco-editor/react`
2. Extend file API in `app/api/files/[...path]/route.ts`:
   - return `mtimeMs` from text reads/meta where useful
   - expand `EXT_TO_LANGUAGE` for mainstream language coverage
   - add `PUT` save endpoint for existing text/code files
   - validate allowed roots, regular file, payload shape, size limit, binary/preview-only rejection, optional `expectedMtimeMs` conflict check
3. Create `components/MonacoFileEditor.tsx`:
   - client component
   - local/offline Monaco loader configuration
   - language normalization
   - editable editor options
   - selection-to-line-range callback
   - content-change callback
   - basic completion provider registration
   - wrap and theme updates
4. Update `components/FileViewer.tsx`:
   - remove `react-syntax-highlighter` source-view imports and DOM selection handling
   - track saved content, editor content, dirty state, save status, conflict status, and baseline mtime
   - render `MonacoFileEditor` in source mode
   - add Save button/status and `Cmd/Ctrl+S`
   - preserve selected-lines Add Chat button and `Cmd/Ctrl+1`
   - preserve Markdown/HTML preview toggles, diff view, live watch, status bar, and specialized viewers
5. Update docs if the component/API map changes materially:
   - `docs/modules/frontend.md` Components table for `MonacoFileEditor`
   - `docs/modules/api.md` route purpose for file save behavior
   - `AGENTS.md` only if top-level navigation changes
6. Manual validation:
   - open/edit/save `.ts`, `.tsx`, `.json`, `.md`, `.html`, `.py`, `.go`, `.rs`, `.java`, `.yaml`, `.sh`
   - trigger suggestions in TypeScript/JSON/HTML/CSS and confirm basic suggestions in other mapped files
   - switch dark/light theme
   - toggle wrap
   - select lines and add to chat
   - `Cmd/Ctrl+1` and `Cmd/Ctrl+S`
   - edit a watched file externally while clean: confirm refresh + diff/source behavior
   - edit a watched file externally while dirty: confirm no silent overwrite and visible conflict/pending message
   - confirm image/audio/pdf/docx still preview
7. Run validation:
   - `npm run lint`
   - `node_modules/.bin/tsc --noEmit`

## Risky Files / Rollback Points

- `package.json` and lockfile: dependency changes.
- `app/api/files/[...path]/route.ts`: read/list/watch route plus new save mutation behavior; keep edits narrow and security-focused.
- `components/FileViewer.tsx`: central preview orchestration. Keep edits focused to source rendering, dirty/save state, and selection plumbing.
- `components/MonacoFileEditor.tsx`: isolated new integration point; delete it to roll back.
- Potential Next/worker issues: if build/typecheck breaks due to Monaco worker imports, adjust integration before changing unrelated UI behavior.

## Review Gate

Implementation can start after user confirms conflict behavior for dirty files or accepts the recommended MVP behavior: if the file changes on disk while dirty, keep local unsaved edits visible, show a conflict warning, and make save fail with a clear conflict until the user reloads or resolves manually.
