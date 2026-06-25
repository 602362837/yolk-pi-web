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

## Proxy Startup and Update

- `start-pi-web-proxy.sh` starts pi-web with `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, and `NODE_OPTIONS=--use-env-proxy`.
- `update-pi-web.sh` fetches/pulls with rebase/autostash, runs `npm run build`, then starts through `start-pi-web-proxy.sh`.

Default proxy is `http://127.0.0.1:7897`; override with `PROXY_URL` or `SOCKS_PROXY_URL` where supported.

## npm Package

- Package: `@agegr/pi-web`
- Binary: `pi-web` from `bin/pi-web.js`
- Run without install: `npx @agegr/pi-web@latest`
- CLI supports `--port`, `--hostname`, and `PORT` env var.
- Package files are controlled by `package.json` `files`.

## Data and Configuration

Default data directory is `~/.pi/agent/`; override with `PI_CODING_AGENT_DIR`.

| File/dir | Purpose |
| --- | --- |
| `sessions/` | Session JSONL files. |
| `models.json` | Model provider/model configuration. |
| `settings.json` | pi settings, including default model. |
| `pi-web.json` | Web UI settings, including WorkTree defaults. |
