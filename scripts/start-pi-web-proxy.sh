#!/usr/bin/env bash
set -euo pipefail

# Start yolk pi web with proxy settings that Node/Next can actually use.
# Usage:
#   ./start-pi-web-proxy.sh
# Optional overrides:
#   PROXY_URL=http://127.0.0.1:7897 ./start-pi-web-proxy.sh
#   SOCKS_PROXY_URL=socks5://127.0.0.1:7897 ./start-pi-web-proxy.sh
#   PI_WEB_CMD="npm run dev" ./start-pi-web-proxy.sh

PROXY_URL="${PROXY_URL:-http://127.0.0.1:7897}"
SOCKS_PROXY_URL="${SOCKS_PROXY_URL:-socks5://127.0.0.1:7897}"
PI_WEB_CMD="${PI_WEB_CMD:-npm run start}"

# curl/git/etc. often read these.
export http_proxy="$PROXY_URL"
export https_proxy="$PROXY_URL"
export all_proxy="$SOCKS_PROXY_URL"
export HTTP_PROXY="$PROXY_URL"
export HTTPS_PROXY="$PROXY_URL"
export ALL_PROXY="$SOCKS_PROXY_URL"

# Node 24+/26+ fetch/undici does not necessarily honor *_proxy by default.
# This flag makes Node parse HTTP_PROXY/HTTPS_PROXY/NO_PROXY.
case " ${NODE_OPTIONS:-} " in
  *" --use-env-proxy "*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:-} --use-env-proxy" ;;
esac

cat <<EOF
== yolk pi web proxy startup ==
HTTP_PROXY=$HTTP_PROXY
HTTPS_PROXY=$HTTPS_PROXY
ALL_PROXY=$ALL_PROXY
NODE_OPTIONS=$NODE_OPTIONS
Command: $PI_WEB_CMD
EOF

exec bash -lc "$PI_WEB_CMD"
