#!/usr/bin/env bash
# Deploy «Сарафан» on a Hiddify VPS behind HAProxy (ports 80/443 already taken).
# Usage (from this repo, with SSH access):
#   CHAT_DOMAIN=chat.one.vele.uk ./anon-chat/deploy/remote-install.sh root@138.124.242.142
set -euo pipefail

TARGET="${1:?usage: $0 user@host}"
CHAT_DOMAIN="${CHAT_DOMAIN:?Set CHAT_DOMAIN, e.g. chat.one.vele.uk}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(openssl rand -hex 12)}"
SSH_KEY="${SSH_KEY:-/tmp/chat-ssh/id_ed25519}"
APP_DIR="${APP_DIR:-/opt/komnata}"
APP_PORT="${APP_PORT:-3847}"
PROXY_PORT="${PROXY_PORT:-3848}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$TARGET")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "==> packing app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/anon-chat/deploy"
cp -a "$ROOT/package.json" "$ROOT/package-lock.json" "$ROOT/server.js" "$ROOT/public" "$TMP/anon-chat/"
cp -a "$ROOT/deploy/backup.sh" "$ROOT/deploy/restore.sh" "$ROOT/deploy/migrate-export.sh" \
  "$ROOT/deploy/recompress-uploads.js" "$ROOT/deploy/sarafan-backup.service" \
  "$ROOT/deploy/sarafan-backup.timer" "$ROOT/deploy/README.md" "$TMP/anon-chat/deploy/" 2>/dev/null || true
cp -a "$ROOT/uploads/.gitkeep" "$TMP/anon-chat/" 2>/dev/null || true
tar -C "$TMP" -czf "$TMP/anon-chat.tgz" anon-chat

echo "==> uploading to $TARGET"
"${SCP[@]}" "$TMP/anon-chat.tgz" "$TARGET:/tmp/anon-chat.tgz"
"${SCP[@]}" "$ROOT/deploy/komnata.service" "$TARGET:/tmp/komnata.service"
"${SCP[@]}" "$ROOT/deploy/komnata-nginx.conf" "$TARGET:/tmp/komnata-nginx.conf"
"${SCP[@]}" "$ROOT/deploy/haproxy-komnata.cfg.snippet" "$TARGET:/tmp/haproxy-komnata.cfg.snippet"

echo "==> installing remotely"
"${SSH[@]}" bash -s -- "$CHAT_DOMAIN" "$ADMIN_PASSWORD" "$APP_DIR" "$APP_PORT" "$PROXY_PORT" <<'REMOTE'
set -euo pipefail
CHAT_DOMAIN="$1"
ADMIN_PASSWORD="$2"
APP_DIR="$3"
APP_PORT="$4"
PROXY_PORT="$5"

export DEBIAN_FRONTEND=noninteractive
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
apt-get install -y nginx openssl

systemctl stop komnata 2>/dev/null || true
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR" /var/lib/komnata /var/lib/komnata/uploads
tar -C /opt -xzf /tmp/anon-chat.tgz
mv /opt/anon-chat "$APP_DIR"
ln -sfn /var/lib/komnata/uploads "$APP_DIR/uploads"
ln -sfn /var/lib/komnata "$APP_DIR/data"

cd "$APP_DIR"
npm ci --omit=dev

# TLS cert for nginx (local terminator); HAProxy can pass-through or terminate later
CERT_DIR="/etc/ssl/komnata"
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_DIR/$CHAT_DOMAIN.crt" ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/$CHAT_DOMAIN.key" \
    -out "$CERT_DIR/$CHAT_DOMAIN.crt" \
    -subj "/CN=$CHAT_DOMAIN" \
    -addext "subjectAltName=DNS:$CHAT_DOMAIN"
fi

sed -e "s|__CHAT_DOMAIN__|$CHAT_DOMAIN|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
    /tmp/komnata-nginx.conf > /etc/nginx/sites-available/komnata.conf
ln -sfn /etc/nginx/sites-available/komnata.conf /etc/nginx/sites-enabled/komnata.conf
# avoid default site stealing
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__ADMIN_PASSWORD__|$ADMIN_PASSWORD|g" \
    /tmp/komnata.service > /etc/systemd/system/komnata.service
systemctl daemon-reload
systemctl enable --now komnata
systemctl restart komnata

# HAProxy snippet path for Hiddify (manual include if present)
SNIP="/opt/hiddify-manager/haproxy/komnata.cfg.snippet"
if [[ -d /opt/hiddify-manager ]]; then
  mkdir -p "$(dirname "$SNIP")"
  sed -e "s|__CHAT_DOMAIN__|$CHAT_DOMAIN|g" \
      -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
      /tmp/haproxy-komnata.cfg.snippet > "$SNIP"
  echo "Wrote HAProxy snippet: $SNIP"
fi

echo "ADMIN_PASSWORD=$ADMIN_PASSWORD"
echo "CHAT_DOMAIN=$CHAT_DOMAIN"
echo "local proxy https://127.0.0.1:$PROXY_PORT"
systemctl --no-pager --full status komnata | head -20
REMOTE

echo
echo "Deploy finished."
echo "Next: point DNS A/AAAA for $CHAT_DOMAIN to the VPS, then wire HAProxy Host ACL (see deploy/README.md)."
echo "Admin password was set via ADMIN_PASSWORD env (printed on remote log)."
