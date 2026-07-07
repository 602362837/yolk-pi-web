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

CLI command: `ypi`

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
| `pi-web.json` | Web UI settings, including Yolk Pi chat defaults, WorkTree defaults, YPI Studio member policies and subagent runner rollout (`studio.subagents.runner`), Usage scope, Web Terminal settings, ChatGPT panel/auto-refresh settings, and Trellis settings. |
| `chatgpt-usage-refresh.lock` | Backend ChatGPT usage auto-refresh lock file; stale locks can be repaired from the ChatGPT panel fault handler. |

Session path format:

```text
~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl
```

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

Before publishing, authenticate and validate the release bundle:

```bash
npm whoami
npm run lint
node_modules/.bin/tsc --noEmit
npm run build
npm pack --dry-run
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
```
