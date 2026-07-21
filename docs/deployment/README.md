# Deployment and Runtime Guide

This guide covers local runtime, npm installation, source builds, production deployment, and npm release operations for `yolk pi web`.

## Runtime Requirements

| Dependency | Requirement | Notes |
| --- | --- | --- |
| Node.js | Node.js 22+ recommended | Required by the Next.js 16 / React 19 runtime. Lower versions may fail to start. |
| npm | npm 10+ recommended | Used for `npx`, global installs, source installs, and publishing. |
| pi agent data directory | Defaults to `~/.pi/agent/` | Stores sessions, model config, settings, and pi-web settings. |
| Git | Optional, recommended | Required for Git status, branch switching, graph, and WorkTree features. |
| Local shell | Optional | Required only when Web Terminal is enabled. |

Web Terminal uses `@lydell/node-pty` as the server-side PTY dependency. If a target machine has native dependency issues, keep Web Terminal disabled; the session browser and chat flows do not require PTY support.

## npm Package Runtime

Published npm package name: `@alan-zhao/yolk-pi-web`

CLI commands: `ypi` (Web workspace) and `ypic` (terminal chat). Both ship in the same package under `bin/`; `bin/pi-web.js` is the Web entrypoint, `bin/ypic.js` is the terminal chat entrypoint, and `bin/server-runner.js` is the shared server-startup helper used by `ypi`.

Run without installing:

```bash
npx @alan-zhao/yolk-pi-web@latest
```

Install globally:

```bash
npm install -g @alan-zhao/yolk-pi-web
ypi
```

Default URL: `http://localhost:30141`. The CLI attempts to open the browser after the server is ready.

### CLI Options

```bash
ypi --port 8080              # custom port
ypi --hostname 127.0.0.1     # bind to localhost only
ypi -p 8080 -H 127.0.0.1     # short options
PORT=8080 ypi                # environment variable is also supported
ypi --proxy http://127.0.0.1:7897                 # HTTP_PROXY/HTTPS_PROXY
ypi --socks-proxy socks5://127.0.0.1:7897         # ALL_PROXY/SOCKS proxy
```

`npx` accepts the same options:

```bash
npx @alan-zhao/yolk-pi-web@latest --port 8080
```

When proxy options or proxy environment variables are present, `ypi` forwards
`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and appends
`--use-env-proxy` to `NODE_OPTIONS` so Node/Next server-side fetch calls use the
proxy. It also accepts the same environment aliases as the proxy startup scripts:
`PROXY_URL` for HTTP/HTTPS proxy and `SOCKS_PROXY_URL` for `ALL_PROXY`.

### `ypic` terminal chat

`ypic` is an additive terminal chat entry that reuses a running ypi Web server over HTTP/SSE; it does **not** self-start a server. Start `ypi` (or the Web server) first, then run `ypic` in the project directory you want to chat in.

```bash
ypic                       # chat in the current directory (first message creates the session)
ypic "explain this repo"   # send an initial prompt, then continue the chat loop
ypic -c, --continue        # continue the most recent session for this cwd
ypic --resume <sessionId>  # resume a specific session directly
ypic -p 8080               # ypi server port (default: 30141; env: PI_WEB_PORT/PORT)
ypic -H 127.0.0.1          # ypi server host (default: 127.0.0.1; env: PI_WEB_HOST/HOSTNAME)
ypic -h, --help            # show CLI usage
```

On launch `ypic` performs `GET /api/cli/health`; if the responder is not
`yolk-pi-web` or the check fails, it prints guidance to start `ypi` first and
exits. It binds `process.cwd()` as the workspace, auto-registers the directory
through the Project Registry API when it is not already a known project/space
(idempotent by canonical `pathKey`), then drives chat via `POST /api/agent/draft`,
`GET /api/agent/[id]/events`, and `POST /api/agent/[id]`. No new session format
is introduced.

#### Startup display

In TTY mode, the startup banner shows the YPI CLI identity, current working
directory (`cwd`), ypi server URL and version, session id, current
model/thinking level, and hints for `/help`, `/model`, `/config`, `/oweb`,
and `/quit`.

#### `/model` command

| Command | Action |
| --- | --- |
| `/model` | Show help and current model/thinking. |
| `/model current` | Display current provider, model id, thinking level, and supported thinking range. |
| `/model list [provider]` | List all available models (optionally filtered by provider); current model marked `*`. |
| `/model <provider>/<modelId>` | Switch to the specified model (agent must be idle). |
| `/model <provider>/<modelId> <thinking>` | Switch model and set thinking level in one command. |
| `/model thinking <level>` | Set thinking level only (`off`/`auto`/`low`/`medium`/`high`/`xhigh`). |

Switching a model sends `set_model` and `set_thinking_level` commands via
`POST /api/agent/[id]`, updating server-side session state (runtime model +
JSONL `model_change`). Chat `set_model` is session-scoped and does not rewrite
`~/.pi/agent/settings.json` global `defaultProvider`/`defaultModel`. The Web UI
sees the same change when opening the session. Model switching is blocked while
the agent is running (`/abort` first).

#### TTY bottom input area and status bar

When `stdout.isTTY`, `stdin.isTTY`, `NO_COLOR` is unset, and `YPIC_PLAIN` is
unset, `ypic` uses the terminal's alternate screen buffer to render a persistent
bottom-bar UI:

- **History area**: Upper region scrolls assistant output, tool-call lines, and
  Studio summaries.
- **Separator**: A gray horizontal rule splits history from the bottom control
  rows.
- **Status bar**: Left side shows an idle / RUNNING / ERROR dot with status
  text; right side shows the current model and thinking level.
- **Input line**: Pinned at the bottom with a green `> ` prompt. When the agent
  is running, a dim placeholder reminds "Enter to steer, Ctrl-C to abort".

The frame redraws automatically on terminal resize.

In-session commands: `/help`, `/model`, `/config` (or `/open`) to open the Web
page in a browser, `/oweb` to open the current session's fixed Web URL,
`/status`, `/abort`, `/steer <text>`, `/follow <text>`, and `/quit`. Regular
`/studio-*` slash commands are forwarded as chat prompts so the existing YPI
Studio extension handles them; the CLI shows compact task/run status and the
`plan-review.md` path, but full task details, artifacts, and member config stay
in the Web Studio panel. Studio approval is never auto-granted by the CLI. On
exit, `ypic` prints a `--resume <sessionId>` command plus the fixed Web URL for
the current session.

#### Plain fallback

When `stdout` or `stdin` is not a TTY, or `NO_COLOR` / `YPIC_PLAIN` is set,
`ypic` falls back to a plain readline REPL: output writes directly to `stdout`,
status messages use `[YPIC:info]` on `stderr`, and no ANSI escape sequences are
emitted — safe for pipes, CI logs, and non-TTY environments. With a positional
message in non-TTY mode, `ypic` sends the message and exits automatically after
`agent_end`, making it suitable for script/pipe use.


## Data and Configuration

Default data directory is `~/.pi/agent/`; override it with `PI_CODING_AGENT_DIR`:

```bash
PI_CODING_AGENT_DIR=/path/to/pi-agent-data ypi
```

| File/dir | Purpose |
| --- | --- |
| `sessions/` | Session JSONL files, grouped by encoded workspace path. |
| `models.json` | Model provider/model configuration. |
| `settings.json` | pi settings, including default model. |
| `pi-web.json` | Web UI settings, including Yolk Pi chat defaults, WorkTree defaults, YPI Studio member policies and subagent runner rollout (`studio.subagents.runner`), Usage scope, Web Terminal settings, ChatGPT panel/auto-refresh settings, default-off OpenCode Go auto-failover settings (`opencodeGo.autoFailover`), and Trellis settings. |
| `chatgpt-usage-refresh.lock` | Backend ChatGPT usage auto-refresh lock file; stale locks can be repaired from the ChatGPT panel fault handler. |
| `auth-api-key-accounts/` | Managed API-key account storage for multi-account providers (`opencode-go/`, `xai/`). Contains per-provider `accounts.json` (metadata with active account, disabled state, masked previews) and per-account `<accountId>.json` secret files (mode 0600). Old metadata without `disabled` fields is treated as enabled — no migration required. Automatic failover remains OpenCode Go–only; xAI uses manual key activation only. |
| `links/` | Links GitHub OAuth connection storage. Contains `registry.json` (metadata only — connected + disconnected), `.locks/` (cross-process mkdir locks), and `github/<id>.json` (OAuth secret, mode 0600). `device_code` never reaches disk; access tokens only in secret files. Fully isolated from LLM auth (`auth.json`, `auth-accounts/`, `auth-api-key-accounts/`). |
| `appearance/` | Background-skin domain only (not `pi-web.json`). Contains `index.json` (schema-v1 metadata/revision, mode 0600; optional `kind`, missing ⇒ image), `skins/<opaque-id>.webp` (image full), `skins/<opaque-id>.mp4` (video full, original validated bytes), shared `skins/<opaque-id>.thumb.webp` (image thumb or video poster), plus `.tmp/`, `.trash/`, and `.mutation.lock/`. Video posters may require packaged `ffmpeg-static` at runtime. Missing directory equals default pure-color UI; do not treat generic `/api/files/upload` as the skin store. Backup this whole tree (including `.mp4`) if users rely on custom backgrounds; never rewrite session/models/auth data when restoring appearance. |

Session path format:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

## OpenCode Go Auto Failover (default-off)

The `opencodeGo.autoFailover` feature is **disabled by default**. When enabled, it automatically switches the global active managed API-key account on quota/billing errors or permanent `Invalid/Missing API key` errors. It does not trigger on transient 429/rate-limit, network errors, or 5xx.

### Deployment checklist

- **No startup migration**: Existing managed account metadata (created before this feature) treats missing `disabled` as enabled. No data migration, no downtime, and no manual intervention required.
- **Data path**: OpenCode Go auto-failover reads managed account metadata and secrets under `~/.pi/agent/auth-api-key-accounts/opencode-go/`. Other managed providers (currently `xai/`) use the same layout under their own provider directory for manual multi-key management only. The feature never writes plaintext API keys to metadata; only masked previews and SHA-256 fingerprints are stored there.
- **Single-process safe**: The failover lock is process-level (`globalThis.__piOpencodeGoFailover`). Single-process deployments (default `next start`, `ypi`) are fully safe. Multi-process deployments (PM2 cluster mode, load-balanced instances) may experience cross-process race conditions; see `docs/operations/troubleshooting.md` for mitigation.

### Rollback

Disable the feature without data changes or restarts:
1. **Settings UI**: Open Settings → OpenCode Go managed API keys → turn off **OpenCode Go auto failover**.
2. **Config file**: Set `opencodeGo.autoFailover.enabled` to `false` in `~/.pi/agent/pi-web.json`.

The change takes effect for the next agent turn. Disabling does not affect existing account metadata, active account selection, or the ability to manually enable/disable accounts.

### Recovering auto-disabled accounts

Accounts disabled by the system (`disabledBy: "system"`, `autoDisabledReason: "account_unusable"`) can be recovered:
1. Go to Settings → Models → OpenCode Go.
2. **Edit** the disabled account to replace the broken API key with a valid one.
3. Click **Enable** to restore eligibility (does not auto-activate).
4. Click **Activate** to make it the active account if desired.

Full recovery steps are covered in `docs/operations/troubleshooting.md`.

## Local Development

```bash
npm install
npm run dev      # http://localhost:30141
```

Use `npm run dev` for development. Do not run `next build` directly during dev.

Minimum validation:

```bash
npm run lint
node_modules/.bin/tsc --noEmit
```

## Source Production Build

```bash
npm run build    # runs scripts/build-next.js
npm run start    # serves on port 30141
```

`npm run build` uses `scripts/build-next.js`, which sets `HOME` and `USERPROFILE` to `.next-build-home/` to avoid protected Windows home junction issues. Do not run `next build` directly for project validation.

Runtime options are passed through Next.js:

```bash
npm run start -- --port 8080
npm run start -- --hostname 127.0.0.1
PORT=8080 npm run start
```

## PM2

`ecosystem.config.cjs` runs `node_modules/.bin/next start -p 30141` with:

- process name `yolk-pi-web` (or legacy `pi-web` for existing PM2 setups)
- auto-restart enabled
- max memory restart at 1 GB
- logs under `logs/pi-web-out.log` and `logs/pi-web-error.log`

Start with:

```bash
pm2 start ecosystem.config.cjs
```

## Proxy Startup

- `scripts/start-pi-web-proxy.sh` starts yolk pi web with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NODE_OPTIONS=--use-env-proxy`.
- `scripts/start-pi-web-proxy.ps1` provides the same proxy startup flow for PowerShell.
- The proxy scripts default to the production command `npm run start`; use `PI_WEB_CMD="npm run dev"` for development.

Default proxy is `http://127.0.0.1:7897`; override with `PROXY_URL` or `SOCKS_PROXY_URL` where supported.

## Links / GitHub OAuth Device Flow Configuration

The Links module enables GitHub identity connections through GitHub OAuth Device Flow using a **product-owned OAuth App**.

### Prerequisites

- A GitHub OAuth App with **Device Flow enabled** (no callback URL needed).
- The OAuth App client id must be provided via server-only env var `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID`.
- **No client secret** is required or configured.

### Official build / deployment

```bash
export YPI_LINKS_GITHUB_OAUTH_CLIENT_ID=<product-client-id>
ypi
```

This value is server-only and never exposed to the browser or `NEXT_PUBLIC_*`.

### Source developers

Developers can obtain their own GitHub OAuth App client id (Device Flow enabled) for local testing:

```bash
YPI_LINKS_GITHUB_OAUTH_CLIENT_ID=your-dev-client-id npm run dev
```

### Missing configuration

When `YPI_LINKS_GITHUB_OAUTH_CLIENT_ID` is not set, the Links UI shows a safe "GitHub authorization is not configured" state. The authorization start API returns `503 github_authorization_not_configured`. There is **no PAT fallback** — the configuration must be provided to enable Links.

## Repository Remotes

The shared upstream repository is `git@github.com:twofive1203/pi-agnet-web.git`. Configure it once with:

```bash
git remote add upstream git@github.com:twofive1203/pi-agnet-web.git
# or, if upstream already exists:
git remote set-url upstream git@github.com:twofive1203/pi-agnet-web.git
```

Fetch upstream `main` with:

```bash
git fetch upstream main
```

## npm Package Release

Project-level release guidance is also available as the Pi skill `.pi/skills/yolk-release-publish/SKILL.md`; use it when bumping versions, tagging, pushing, or publishing `@alan-zhao/yolk-pi-web` / `ypi`.

### Dependency pinning (required for published installs)

Local development is protected by `package-lock.json`. **Published npm installs do not use the repo lockfile** unless the package ships an `npm-shrinkwrap.json`.

This package therefore:

1. Pins critical runtime deps to **exact versions** in `package.json` (no `^` / `~` for `@earendil-works/pi-*`, `pi-grok-cli`, `pi-kiro-provider`, `jiti`).
2. Ships `npm-shrinkwrap.json` in the published `files` list so `npm install -g` / `npx` resolve the same tree as the release machine.
3. Rewrites `.next/required-server-files.{json,js}` `appDir` to the install directory at `ypi` startup (`bin/server-runner.js`), because Next bakes the build-host absolute path into that manifest.
4. Loads provider TypeScript packages (`pi-grok-cli`, `pi-kiro-provider`, `@yofriadi/pi-antigravity-oauth`) through jiti anchored at `process.cwd()/package.json` — **never** `import.meta.url` alone — so production bundles do not embed the build machine path.

After changing those pins, regenerate shrinkwrap before publish:

```bash
npm install
npm shrinkwrap
# confirm package.json, package-lock.json, and npm-shrinkwrap.json agree on pi-* versions
```

Before publishing, authenticate and validate the release bundle:

```bash
npm whoami
npm run lint
node_modules/.bin/tsc --noEmit
npm run build
npm pack --dry-run   # must list npm-shrinkwrap.json + bin/ + .next/
```

Publish the current version:

```bash
npm publish --access public
```

For later patch releases, use the release script, which bumps the version, runs `prepublishOnly`, and publishes publicly:

```bash
npm run release:patch
```

If publishing with a token, configure npm carefully and never commit tokens:

```bash
npm config set registry https://registry.npmjs.org/
npm config set @alan-zhao:registry https://registry.npmjs.org/
npm config set //registry.npmjs.org/:_authToken "<token>"
```

After publishing, verify the package:

```bash
npm view @alan-zhao/yolk-pi-web version --prefer-online
npx @alan-zhao/yolk-pi-web@latest --port 30141
npx -p @alan-zhao/yolk-pi-web@latest ypic --help   # or: ypic --help once installed globally
```

`npm pack --dry-run` should include `bin/pi-web.js`, `bin/ypic.js`, and `bin/server-runner.js` (the whole `bin/` directory is published).
