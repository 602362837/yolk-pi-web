# Deployment and Runtime Guide

## Local Development

```bash
npm install
npm run dev      # http://localhost:30141
```

Use `npm run dev` for development. Do not run `next build` directly during dev.

## Production

```bash
npm run build    # runs scripts/build-next.js
npm run start    # serves on port 30141
```

`npm run build` uses `scripts/build-next.js`, which sets `HOME` to `.next-build-home/` to avoid protected Windows home junction issues.

## PM2

`ecosystem.config.cjs` runs `node_modules/.bin/next start -p 30141` with:

- process name `pi-web`
- auto-restart enabled
- max memory restart at 1 GB
- logs under `logs/pi-web-out.log` and `logs/pi-web-error.log`

Start with:

```bash
pm2 start ecosystem.config.cjs
```

## Proxy Startup

- `scripts/start-pi-web-proxy.sh` starts pi-web with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NODE_OPTIONS=--use-env-proxy`.
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

## Source Build

- Clone the repository and install dependencies with `npm install`.
- Build locally with `npm run build`.
- Run the production server with `npm run start`.
- Use `npm run dev` during development.
- CLI options are passed through `npm run start -- --port 8080` and `npm run start -- --hostname 127.0.0.1`; `PORT` is also supported.

## Data and Configuration

Default data directory is `~/.pi/agent/`; override with `PI_CODING_AGENT_DIR`.

| File/dir | Purpose |
| --- | --- |
| `sessions/` | Session JSONL files. |
| `models.json` | Model provider/model configuration. |
| `settings.json` | pi settings, including default model. |
| `pi-web.json` | Web UI settings, including WorkTree defaults, Usage scope, ChatGPT panel/auto-refresh settings, and Trellis settings. |
| `chatgpt-usage-refresh.lock` | Backend ChatGPT usage auto-refresh lock file; stale locks can be repaired from the ChatGPT panel fault handler. |
