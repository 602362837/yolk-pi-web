# summary

Implemented the YPI Studio child-subagent stability fix.

## Code changes

- Added `lib/ypi-studio-subagent-runtime.ts` as an in-process registry for active Studio child member runs.
- Updated `lib/ypi-studio-extension.ts` so `runChildPi()` no longer stores full stdout/stderr or calls `Buffer.concat(...).toString()` for final extraction. It now:
  - parses stdout as bounded JSONL using `StringDecoder`;
  - caps stdout, stderr, single-line stdout, final output, live preview, tails, transcript, and API projections;
  - terminates child runs on output limit, idle timeout, max runtime, parent abort, or blocking child UI request;
  - registers/unregisters active child runs for cross-module cancellation;
  - uses POSIX process-group termination and Windows `taskkill` fallback.
- Updated `lib/rpc-manager.ts` so parent session abort/destroy cancels active Studio child runs; abort now waits at most 3s for `inner.abort()` before returning `{ abortTimedOut: true }`.
- Updated `app/api/agent/[id]/route.ts` so abort without a live session does not create a new AgentSession and still cancels matching Studio child runs.
- Updated `lib/ypi-studio-transcripts.ts` with a 5MiB transcript sidecar cap and a 2MiB hard cap for full transcript API responses.
- Updated `components/YpiStudioSubagentTranscript.tsx` and `components/YpiStudioSessionWidget.tsx` to surface truncated/cancelled/failed states and recovery guidance.
- Updated architecture/library docs.

## Validation

- `npm run lint` — pass
- `node_modules/.bin/tsc --noEmit` — pass
- `npm run test:studio-policy` — pass
- Checker review — pass after fixing abort timeout blocker

## Notes

The original `ERR_STRING_TOO_LONG` is addressed by removing unbounded stdout/stderr accumulation and final full-string conversion. Stop reliability is improved by cascading cancellation to Studio child processes and bounding HTTP abort latency.
