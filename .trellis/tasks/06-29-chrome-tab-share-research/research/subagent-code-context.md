# Code Context

## Files Retrieved
1. `components/ChatInput.tsx` (lines 1-60, 637-790, 968-1000, 1400-1455) - input component contract, image/file attachment processing, message serialization, hidden file pickers, send button behavior.
2. `hooks/useAgentSession.ts` (lines 527-705) - main send/steer/follow-up flow to API routes and pi RPC command payload shape.
3. `app/api/agent/new/route.ts` (lines 1-52) - starts a new pi session and sends the first prompt command.
4. `app/api/agent/[id]/route.ts` (lines 1-55) - sends commands to an existing pi session, reviving RPC wrapper if needed.
5. `app/api/files/upload/route.ts` (lines 1-169) - multipart upload endpoint and storage/retention limits.
6. `components/ChatWindow.tsx` (lines 151-240) - wires drag/drop and `ChatInput` to `useAgentSession`; blocks input for archived sessions.
7. `hooks/useDragDrop.ts` (lines 1-40) - drop-zone file detection and forwarding.
8. `lib/agent-client.ts` (lines 1-25) - client helper for existing-session RPC POSTs.
9. `lib/types.ts` (lines 19-45) - core content block and attachment/reference types.

## Key Code

### Chat input public integration surface
`components/ChatInput.tsx` exposes both props and an imperative ref:

```ts
// components/ChatInput.tsx:20-51
interface Props {
  onSend: (message: string, images?: AttachedImage[]) => void;
  onSteer?: (message: string, images?: AttachedImage[]) => void;
  onFollowUp?: (message: string, images?: AttachedImage[]) => void;
  isStreaming: boolean;
  ...
}
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  addFiles: (files: File[]) => void;
  addFileReference: (relativePath: string, lines?: { startLine: number; endLine: number }) => void;
}
```

This is the easiest in-app UI integration point for a Chrome extension bridge if the extension can cause the web app to receive a `File` or text payload: call `chatInputRef.current?.insertText(...)`, `.addImages(...)`, `.addFiles(...)`, or `.addFileReference(...)`.

### Image attachments
Images are not uploaded to `/api/files/upload`. They are read in-browser as base64 and sent as `images` in the agent command:

```ts
// components/ChatInput.tsx:652-671
const imageFiles = files.filter((f) => f.type.startsWith("image/"));
reader.readAsDataURL(file); // stores { data: base64, mimeType, previewUrl }
setAttachedImages((prev) => [...prev, ...newImages]);
```

```ts
// hooks/useAgentSession.ts:531-545
const imageBlocks = images?.map((img) => ({ type: "image", source: { type: "base64", media_type: img.mimeType, data: img.data } }));
const piImages = images?.map((img) => ({ type: "image", data: img.data, mimeType: img.mimeType }));
```

### Non-image file attachments
Non-image files are uploaded immediately, then the final prompt contains a markdown-ish line with the absolute uploaded path:

```ts
// components/ChatInput.tsx:692-703
const formData = new FormData();
formData.append("file", file);
const res = await fetch("/api/files/upload", { method: "POST", body: formData });
return { name: data.name, size: data.size, path: data.path };
```

```ts
// components/ChatInput.tsx:754-760
return `📎 ${f.name} (${sizeStr}) — \`${f.path}\``;
```

There is no structured `files` array in the prompt RPC command; uploaded file paths are text in `message`.

### Sending messages
`ChatInput` builds text from the contentEditable editor plus attached files, then calls `onSend(finalMsg, images)`:

```ts
// components/ChatInput.tsx:785-790
const finalMsg = buildFinalMessage();
onSend(finalMsg, attachedImages.length ? attachedImages : undefined);
clearEditor();
```

`useAgentSession.handleSend` posts either to `/api/agent/new` for a new chat or `/api/agent/[id]` for an existing chat:

```ts
// hooks/useAgentSession.ts:553-564
fetch("/api/agent/new", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ cwd: newSessionCwd, type: "prompt", message, toolNames, images, provider, modelId, thinkingLevel }),
});
```

```ts
// hooks/useAgentSession.ts:581-587
await sendAgentCommand(session.id, {
  type: "prompt",
  message,
  ...(piImages?.length ? { images: piImages } : {}),
});
```

During streaming, the same input can send queued control messages:

```ts
// hooks/useAgentSession.ts:681-700
sendAgentCommand(sid, { type: "steer", message, images });
sendAgentCommand(sid, { type: "follow_up", message, images });
```

### API routes
- `POST /api/agent/new` validates `cwd`, starts a new RPC session, optionally sets model/thinking/tools, then `session.send(promptCommand)` (`app/api/agent/new/route.ts:10-48`).
- `POST /api/agent/[id]` accepts arbitrary JSON command with `type`, sends to live wrapper or resolves JSONL path and restarts wrapper (`app/api/agent/[id]/route.ts:13-33`).
- `POST /api/files/upload` accepts multipart `file`, stores to `~/.pi/agent/uploads/<8-char-id>/<originalName>`, max 200 MB per file, lazy cleanup >7 days and >1 GB total (`app/api/files/upload/route.ts:7-10, 109-164`).

### Types
```ts
// lib/types.ts:19-39
export interface TextContent { type: "text"; text: string; }
export interface ImageContent { type: "image"; source: { type: "base64" | "url"; media_type?: string; data?: string; url?: string; }; }
export interface AttachedFile { name: string; size: number; path: string; }
```

## Architecture

`ChatWindow` owns the active chat surface and passes `handleSend`, `handleSteer`, and `handleFollowUp` from `useAgentSession` into `ChatInput` (`components/ChatWindow.tsx:203-228`). It also wires drag/drop through `useDragDrop`; dropped image files call `chatInputRef.current?.addImages`, other files call `.addFiles` (`components/ChatWindow.tsx:152-159`; `hooks/useDragDrop.ts:31-37`).

`ChatInput` is mostly presentation plus local attachment staging. Images remain client-side until send as base64. Non-image files are uploaded immediately to server storage and represented in the final message only by absolute path text.

`useAgentSession` is the send coordinator. It optimistically appends the user message locally, starts streaming state, connects SSE events, and calls the server API. Existing-session sends use `lib/agent-client.ts` to POST JSON to `/api/agent/[id]`. New-session sends POST directly to `/api/agent/new` because they need cwd/tool/model/thinking setup.

Server routes are thin wrappers around `lib/rpc-manager.ts` / pi SDK session wrappers. They do not validate command schemas beyond requiring `cwd` for new sessions and resolving an existing session id for old sessions.

## Chrome extension integration options

1. **In-app bridge (lowest-risk UI integration)**: add a browser message/window event listener in `AppShell` or `ChatWindow` that receives tab data from an extension content script and uses the existing `chatInputRef` methods. Suggested mapping:
   - selected text/URL/title -> `insertText(...)` or `insertIfEmpty(...)`
   - screenshot/image blob -> convert to `File` and call `addImages([file])`
   - HTML/PDF/text blob -> convert to `File` and call `addFiles([file])`
   - optional auto-send -> call existing `handleSend` only through a new explicit method/prop; currently `ChatInputHandle` has no `send()` method.

2. **Direct API integration (possible but needs session discovery/auth story)**: extension can `fetch`:
   - `POST /api/files/upload` with multipart `file` for non-images, then include returned `path` in prompt text.
   - `POST /api/agent/[id]` with `{ type: "prompt", message, images? }` if it knows the active session id.
   - `POST /api/agent/new` with `{ cwd, type: "prompt", message, ... }` if it knows/chooses a cwd.

3. **Browser-tab “share into current chat” gap**: there is no existing route or global API to ask the web app “what is the currently selected session?” from outside React. The active session is held in `AppShell`/`ChatWindow` state, and existing API routes address sessions by id. A proper extension integration likely needs a small web-app bridge endpoint or page-level event listener tied to current React state.

## Constraints, Risks, Findings

- medium: `app/api/files/upload/route.ts:115-164` accepts uploads without auth/CSRF checks in this inspected code. If a Chrome extension will call it cross-origin or from localhost, define an explicit trust/auth model before exposing it.
- medium: `app/api/agent/[id]/route.ts:13-33` forwards arbitrary JSON command bodies to pi RPC. Extension direct access should not be exposed broadly without validating allowed command types (`prompt`, maybe `steer`/`follow_up`) and session ownership.
- medium: `components/ChatInput.tsx:754-760` serializes non-image attachments as text paths, not structured metadata. Agents must read the file from that path; if upload cleanup deletes it after 7 days or space pressure, old transcript attachment paths can become stale.
- medium: `app/api/files/upload/route.ts:7-10` stores uploads under `os.homedir()` and ignores `PI_CODING_AGENT_DIR`, unlike project docs for default data dir override. Confirm intended behavior before relying on upload paths across deployments.
- low: `components/ChatInput.tsx:692-722` sets `uploadingFiles(false)` only after the loop; if an unexpected exception escapes `uploadFile` in future changes, the UI could stay disabled. Current `uploadFile` catches errors and returns null.
- low: `components/ChatInput.tsx:652-671` has no explicit image size/count limit before base64 encoding, so large screenshots could bloat JSON payloads to `/api/agent/*`.
- low: archived sessions block `ChatInput` rendering (`components/ChatWindow.tsx:174-203`); extension UI bridge must respect this or route errors/disabled state back to the user.
- info: `ChatInputHandle` already supports file/text injection (`components/ChatInput.tsx:46-51, 637-649`) but does not expose current message value, send action, or attachment status. Additions here would be a natural small extension point.

## Start Here
Open `hooks/useAgentSession.ts` first, especially lines 527-705, because it defines the canonical command payloads for prompt/steer/follow-up and decides whether the send targets `/api/agent/new` or `/api/agent/[id]`. Then open `components/ChatInput.tsx` lines 637-790 for how attachments become those payloads.

## Supervisor coordination
No supervisor decision needed; inspection completed without modifying code.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Concrete findings include file paths, line ranges, and severity-labeled constraints for upload and agent routes."
    }
  ],
  "changedFiles": [],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "find/grep/read targeted source inspection plus nl -ba line-number extraction",
      "result": "passed",
      "summary": "Mapped chat send flow, attachment upload flow, drag/drop, types, and API routes."
    }
  ],
  "validationOutput": [
    "No code changes; validation not run."
  ],
  "residualRisks": [
    "No runtime verification performed; findings are based on static inspection.",
    "Current active-session state and auth model for a Chrome extension remain product/design decisions."
  ],
  "noStagedFiles": true,
  "diffSummary": "No code diff; wrote scouting context only.",
  "reviewFindings": [
    "medium: app/api/files/upload/route.ts:115 - upload endpoint has no visible auth/CSRF guard; define trust model before extension exposure.",
    "medium: app/api/agent/[id]/route.ts:13 - arbitrary command JSON is forwarded to pi RPC; direct extension integration should validate allowed command types.",
    "medium: components/ChatInput.tsx:754 - non-image attachments are serialized as text absolute paths, so cleanup can stale old attachment references.",
    "low: components/ChatInput.tsx:652 - images are base64 encoded with no explicit size/count limit before JSON send."
  ],
  "manualNotes": "Findings written to /Volumes/01/ExternalStorage/Projects/gitProjects/pi-agnet-web.worktrees/pi-20260629-162657/context.md"
}
```