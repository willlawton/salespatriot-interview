#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 22.04/24.04 DigitalOcean droplet (run as root).
#
#   bash setup.sh https://github.com/YOU/REPO.git [hostname]
#
# Installs Node 22, runs the app as a systemd service (restarts on crash/reboot), and puts
# Caddy in front for HTTPS. With no hostname it uses <ip>.sslip.io, so no domain is needed.
# Re-running it pulls the latest code and restarts.
set -euo pipefail

REPO="${1:?Usage: bash setup.sh <git repo url> [hostname]}"
APP=/opt/rfq-radar
export DEBIAN_FRONTEND=noninteractive

echo "==> Packages"
apt-get update -y
apt-get install -y ca-certificates curl git gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "==> Node 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "==> App"
id -u rfq >/dev/null 2>&1 || useradd --system --home "$APP" --shell /usr/sbin/nologin rfq
if [ -d "$APP/.git" ]; then git -C "$APP" pull --ff-only; else git clone "$REPO" "$APP"; fi
mkdir -p "$APP/data"
chown -R rfq:rfq "$APP"

cat >/etc/systemd/system/rfq-radar.service <<EOF
[Unit]
Description=RFQ Radar
After=network-online.target
Wants=network-online.target

[Service]
User=rfq
WorkingDirectory=$APP
ExecStart=$(command -v node) server.mjs
Environment=PORT=3000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable rfq-radar
systemctl restart rfq-radar

echo "==> Caddy (HTTPS)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' >/etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi
IP=$(curl -fsS https://api.ipify.org)
HOST="${2:-$(echo "$IP" | tr . -).sslip.io}"
cat >/etc/caddy/Caddyfile <<EOF
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:3000
}
EOF
systemctl restart caddy

echo "==> Checking DIBBS from this server (30s)…"
sleep 30
journalctl -u rfq-radar -n 12 --no-pager || true
echo
if journalctl -u rfq-radar --no-pager | grep -q "Downloaded\|Up to date"; then
  echo "DIBBS is reachable from this server."
elif journalctl -u rfq-radar --no-pager | grep -q "Request Rejected\|Could not reach"; then
  echo "DIBBS is NOT reachable from this server's IP. Upload your local data folder instead:"
  echo "  scp -r data/* root@$IP:$APP/data/  &&  ssh root@$IP 'chown -R rfq:rfq $APP/data && systemctl restart rfq-radar'"
else
  echo "Still syncing. Watch with: journalctl -u rfq-radar -f"
fi
echo
echo "Live at: https://$HOST"
