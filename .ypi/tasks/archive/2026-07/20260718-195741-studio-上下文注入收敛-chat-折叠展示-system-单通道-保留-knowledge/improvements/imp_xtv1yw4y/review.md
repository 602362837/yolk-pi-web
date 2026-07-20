# Review — IMP-001 Studio tag injection popover

**Improvement:** `imp_xtv1yw4y` / IMP-001  
**Reviewer:** main session (gate review; child checker could not start after all subtasks done)  
**Verdict:** **Pass**

## Summary

IMP1-01…03 deliver historical dirty-message injection preview via interactive Studio tag + read-only popover. SCI L1 system single-channel and child paths unchanged. Automated matrix green.

## Automated

| Check | Result |
| --- | --- |
| `npm run test:studio-message-display` | **Pass** (31) |
| `npm run test:studio-extension-sci` | **Pass** (13) |
| `tsc --noEmit` | **Pass** |

## Static

| Area | Result |
| --- | --- |
| `injectionBlocks` / `injectionText` / `formatYpiStudioInjectionPreview` | Present; B1–B10 covered |
| Interactive tag + popover Copy injection/raw | Present in MessageView + CSS |
| Bubble Copy/Edit still `displayText` | Present |
| Extension: no user transform; `buildStudioState(..., prompt)` | Unchanged L1 |
| Docs boundary historical ≠ live system | library.md / frontend.md |

## Residual

- Human UAT: click tag on dirty session, Esc/outside, copy buttons, clean messages no tag
- Live systemPrompt injection viewer still out of scope

## Next

`waiting_user_acceptance` for user re-UAT of IMP-001 on port 30142 (or current dev server).
