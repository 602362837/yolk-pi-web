# Isolated Performance Baseline — 2026-07-28

## Environment

- Dev server: `http://127.0.0.1:30142`
- Data directory: a fresh temporary `PI_CODING_AGENT_DIR` (removed after this run; no operator data used).
- Method: five `curl` samples per endpoint. “Cold” is the first endpoint round after the dev server became ready; its readiness probe had already requested `/api/models-config`, so that endpoint is not a strict cold sample. The isolated directory contained no configured credentials, so verify measures route overhead rather than a real third-party `checkAuth()` latency.

## Endpoint timings

| Endpoint | First-round first request | First-round remaining range | Warm range |
| --- | ---: | ---: | ---: |
| `/api/models-config` | 8.284 ms | 3.397–4.348 ms | 2.887–3.745 ms |
| `/api/auth/providers?mode=summary` | 1292.515 ms | 15.133–25.538 ms | 13.674–23.948 ms |
| `/api/auth/providers?mode=verify` | 16.881 ms | 13.333–26.590 ms | 13.754–23.550 ms |
| `/api/auth/all-providers` | 98.234 ms | 12.953–21.626 ms | 13.592–21.927 ms |

The isolated `summary` warm samples are all far below the 500 ms target. The first summary request includes dev/runtime cold initialization and is not a credential-network result.

## Browser observation

Using Playwright against the same isolated server, the initial page contained the `Models` button. Clicking it immediately produced the modal shell (`模型`, path label, `+ 添加提供商`, `取消`, and `保存`) in the next accessibility snapshot. This proves the shell is not conditional on completion of catalog data.

A frame-accurate click-to-paint number was not recorded: Playwright CLI command wall time includes its process/transport overhead and must not be presented as browser paint latency. No authenticated provider and no intentionally delayed `checkAuth()` were available for a real credential/network UI timing run.
