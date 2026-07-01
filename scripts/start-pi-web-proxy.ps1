# Start yolk pi web with proxy settings that Node/Next can actually use.
# Usage:
#   .\start-pi-web-proxy.ps1
# Optional overrides:
#   $env:PROXY_URL="http://127.0.0.1:7897"; .\start-pi-web-proxy.ps1
#   $env:SOCKS_PROXY_URL="socks5://127.0.0.1:7897"; .\start-pi-web-proxy.ps1
#   $env:PI_WEB_CMD="npm run dev"; .\start-pi-web-proxy.ps1

$PROXY_URL = if ($env:PROXY_URL) { $env:PROXY_URL } else { "http://127.0.0.1:20112" }
$SOCKS_PROXY_URL = if ($env:SOCKS_PROXY_URL) { $env:SOCKS_PROXY_URL } else { "socks5://127.0.0.1:20112" }
$PI_WEB_CMD = if ($env:PI_WEB_CMD) { $env:PI_WEB_CMD } else { "npm run start" }

# curl/git/etc. often read these.
$env:http_proxy = $PROXY_URL
$env:https_proxy = $PROXY_URL
$env:all_proxy = $SOCKS_PROXY_URL
$env:HTTP_PROXY = $PROXY_URL
$env:HTTPS_PROXY = $PROXY_URL
$env:ALL_PROXY = $SOCKS_PROXY_URL

# Node 24+/26+ fetch/undici does not necessarily honor *_proxy by default.
# This flag makes Node parse HTTP_PROXY/HTTPS_PROXY/NO_PROXY.
if ($env:NODE_OPTIONS -notmatch '(^|\s)--use-env-proxy(\s|$)') {
  $env:NODE_OPTIONS = ($env:NODE_OPTIONS + ' --use-env-proxy').Trim()
}

Write-Host @"
== yolk pi web proxy startup ==
HTTP_PROXY=$env:HTTP_PROXY
HTTPS_PROXY=$env:HTTPS_PROXY
ALL_PROXY=$env:ALL_PROXY
NODE_OPTIONS=$env:NODE_OPTIONS
Command: $PI_WEB_CMD
"@

Invoke-Expression $PI_WEB_CMD
