# Monaco Editor research

## Package facts

- `monaco-editor` latest npm version checked on 2026-06-30: `0.55.1`.
- `@monaco-editor/react` latest npm version checked on 2026-06-30: `4.7.0`.
- `@monaco-editor/react` peer dependencies include React `^16.8.0 || ^17.0.0 || ^18.0.0 || ^19.0.0` and `monaco-editor >=0.25.0 <1`, so it is compatible with this project&apos;s React 19 range.
- `@monaco-editor/react` is a React lifecycle/loader wrapper, not the language-support engine. `monaco-editor` provides the actual editor, syntax highlighting, and built-in language services.
- Current project does not depend on Monaco packages. Current text preview uses `react-syntax-highlighter` in `components/FileViewer.tsx`.
- `monaco-editor` unpacked npm size is about 72.6 MB; bundle/lazy-loading matters.

## Integration implications for this codebase

- Monaco is browser-only and should be loaded from a client component. Keep it out of server routes and avoid top-level server imports.
- Use `next/dynamic` or an isolated client component to keep Monaco out of initial server render and reduce the main app bundle impact.
- Prefer local package loading over CDN so the published `pi-web` package works offline/local-network and does not require external scripts.
- Monaco has built-in syntax highlighting and language services for common web languages (TypeScript/JavaScript, JSON, CSS, HTML) and tokenization for many others. For unsupported languages it still provides editor basics.
- Basic suggestions can come from Monaco&apos;s built-in language providers where available. Custom lightweight completion providers can add file/workspace-agnostic snippets/words without requiring server indexing.

## Current file preview behavior to preserve

- `FileViewer` routes images, audio, PDF/DOCX, and text-like files to specialized viewers.
- `TextFileViewer` reads `/api/files/[...path]?type=read`, watches changes with `/api/files/[...path]?type=watch`, and keeps previous content for a diff view.
- Markdown defaults to preview mode and has raw/preview toggle.
- HTML has code/preview toggle.
- The text source view supports line selection and an `Add to chat` button/shortcut that passes `{ startLine, endLine }`.
- Word wrap is toggleable.
- File API caps text preview reads at 256 KB.

## Recommended implementation shape

1. Add `monaco-editor` and `@monaco-editor/react` dependencies.
2. Create a small `components/MonacoFileEditor.tsx` client component responsible for Monaco rendering, theme mapping, read-only/editable state, selection-to-line-range reporting, and completion registration.
3. Replace only the text source rendering path in `FileViewer.tsx`; keep image/audio/document/markdown preview/html preview/diff behavior intact.
4. Add a workspace-root-validated save API for existing text files, with dirty-state tracking and conflict detection based on the file mtime captured at read/save time.
5. Use Monaco&apos;s `wordWrap` option to preserve the existing wrap toggle.
6. Use `onMount` to wire selection changes and `editor.getSelection()` to preserve Add-to-chat line ranges.
7. Configure a dark/light Monaco theme based on `useTheme()` and project CSS variables.
8. Add a basic completion provider for a limited set of languages that offers common snippets plus document-word suggestions, while relying on Monaco built-ins where available.

## Product decisions

- The editor must support real editing and saving, not just read-only preview.
- Dirty-file external changes use the safest behavior: keep local unsaved edits visible, show a conflict warning, and block saving with a conflict response until the user reloads or resolves manually.
