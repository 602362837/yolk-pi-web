# Research: OpenClaw browser extension and pi agent web UI reuse

## Summary
I could not perform live web research because this subagent runtime did not expose a `web_search` or browser-fetch tool. Based on unverified prior knowledge, OpenClaw appears relevant only if it exposes Chrome tab/page state through a documented local protocol such as WebSocket, native messaging, MCP, or HTTP; I found no verified evidence in this run that it is pi-compatible or pi-based. Treat the integration as unconfirmed until the repository and extension manifest/runtime bridge are inspected.

## Findings
1. **Repository/package names are not verified in this run** — I could not confirm the canonical GitHub repository, Chrome Web Store listing, or npm package names for “OpenClaw.” Do not rely on guessed names; first verify by searching GitHub, npm, and the Chrome Web Store for exact matches such as `OpenClaw`, `open-claw`, and `openclaw`.
2. **Architecture cannot be confirmed without source inspection** — For the requested use case, the decisive files would be the Chrome extension `manifest.json`, background/service worker, content scripts, and any local runtime/server package. Look specifically for permissions such as `activeTab`, `tabs`, `scripting`, `debugger`, `nativeMessaging`, and host permissions; these determine whether it can access the current tab, inject scripts, read DOM/text, capture screenshots, or talk to localhost.
3. **Extension-to-runtime protocol is the key reuse boundary** — If OpenClaw uses a simple local protocol, e.g. localhost HTTP/SSE/WebSocket, Chrome native messaging, or MCP, its tab-context bridge may be reusable by another UI. If the extension is tightly coupled to its own runtime message schema, auth token, or hosted backend, reuse would require either adapting its runtime or implementing a protocol-compatible shim.
4. **No verified evidence that OpenClaw is pi-compatible or pi-based** — I found no confirmed source in this run showing that OpenClaw uses `@earendil-works/pi-coding-agent`, pi JSONL session files, pi RPC/SSE events, or pi model/session configuration. For a separate pi agent web UI, assume it is not pi-native unless source inspection proves otherwise.
5. **Likely reusable pieces, if source license permits** — The most reusable components would be: the extension’s current-tab discovery, content-script DOM/page extraction, screenshot/accessibility capture, and local transport layer. The least reusable pieces would be its agent loop, prompt format, runtime state, and UI if they assume a non-pi orchestration model.

## Sources
- Kept: None — live web/source search was not available from this subagent runtime, so no external links could be verified.
- Dropped: Unverified guessed GitHub/npm/Chrome Web Store targets — excluded to avoid fabricating source links.

## Gaps
- Need canonical OpenClaw repository and/or package URLs.
- Need source review of `manifest.json`, background/service worker, content scripts, and runtime server.
- Need protocol capture or docs for extension ↔ runtime messages.
- Need license review before reuse.
- Suggested next steps: run web searches for `OpenClaw browser extension GitHub`, `OpenClaw Chrome extension`, `OpenClaw MCP`, `OpenClaw npm`, then inspect the top repository’s README, manifest, package files, and transport/server code.

## Concise assessment
OpenClaw may be useful as a browser-context bridge if its extension can send active-tab page context to a local runtime over an open protocol. There is no verified basis from this run to call it pi-compatible or pi-based. For pi agent web UI reuse, plan for an adapter: extension → normalized page-context event/API → pi web route/SSE/session integration, rather than direct drop-in runtime reuse.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Created the requested research brief at the authoritative output path without modifying project code or widening scope; limitations are explicitly documented."
    }
  ],
  "changedFiles": [
    "research.md",
    "/Users/zyj/.pi/agent/sessions/--Volumes-01-ExternalStorage-Projects-gitProjects-pi-agnet-web.worktrees-pi-20260629-162657--/subagent-artifacts/progress/9ba4139d/progress.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [],
  "validationOutput": [
    "No validation commands were run; research-only task and no code changes."
  ],
  "residualRisks": [
    "Live web research tools were unavailable, so repository/package names and source links could not be verified."
  ],
  "noStagedFiles": true,
  "diffSummary": "Added a research brief and progress update only.",
  "reviewFindings": [
    "no blockers for file-writing requirement; substantive research remains source-verification-limited"
  ],
  "manualNotes": "A follow-up worker with web_search/browser access should verify canonical OpenClaw links and inspect source files."
}
```
