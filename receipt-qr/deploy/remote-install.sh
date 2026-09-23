#!/usr/bin/env bash
# Deploy КвитQR on Hiddify VPS (HAProxy owns :80/:443).
# Usage:
#   QR_DOMAIN=qr.vele.uk ./deploy/remote-install.sh root@138.124.242.142
set -euo pipefail

TARGET="${1:?usage: $0 user@host}"
QR_DOMAIN="${QR_DOMAIN:?Set QR_DOMAIN, e.g. qr.vele.uk}"
SSH_KEY="${SSH_KEY:-/tmp/qr-ssh/id_ed25519}"
APP_DIR="${APP_DIR:-/opt/kvitqr}"
APP_PORT="${APP_PORT:-8787}"
PROXY_PORT="${PROXY_PORT:-8788}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$TARGET")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "==> packing app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/receipt-qr/deploy"
cp -a "$ROOT/app" "$ROOT/requirements.txt" "$ROOT/README.md" "$TMP/receipt-qr/"
cp -a "$ROOT/deploy/"*.service "$ROOT/deploy/"*.conf "$ROOT/deploy/"*.snippet \
  "$ROOT/deploy/remote-install.sh" "$ROOT/deploy/authorize-agent.sh" \
  "$TMP/receipt-qr/deploy/" 2>/dev/null || true
tar -C "$TMP" -czf "$TMP/receipt-qr.tgz" receipt-qr

echo "==> uploading to $TARGET"
"${SCP[@]}" "$TMP/receipt-qr.tgz" "$TARGET:/tmp/receipt-qr.tgz"
"${SCP[@]}" "$ROOT/deploy/kvitqr.service" "$TARGET:/tmp/kvitqr.service"
"${SCP[@]}" "$ROOT/deploy/kvitqr-nginx.conf" "$TARGET:/tmp/kvitqr-nginx.conf"
"${SCP[@]}" "$ROOT/deploy/haproxy-kvitqr.cfg.snippet" "$TARGET:/tmp/haproxy-kvitqr.cfg.snippet"

echo "==> installing remotely"
"${SSH[@]}" bash -s -- "$QR_DOMAIN" "$APP_DIR" "$APP_PORT" "$PROXY_PORT" <<'REMOTE'
set -euo pipefail
QR_DOMAIN="$1"
APP_DIR="$2"
APP_PORT="$3"
PROXY_PORT="$4"

export DEBIAN_FRONTEND=noninteractive
# Hiddify HAProxy PPA keys sometimes break apt update
mkdir -p /etc/apt/sources.list.d/disabled
mv /etc/apt/sources.list.d/*haproxy* /etc/apt/sources.list.d/disabled/ 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip \
  tesseract-ocr tesseract-ocr-rus nginx openssl

systemctl stop kvitqr 2>/dev/null || true
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
tar -C /opt -xzf /tmp/receipt-qr.tgz
# archive extracts as /opt/receipt-qr
rm -rf "$APP_DIR"
mv /opt/receipt-qr "$APP_DIR"

cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

CERT_DIR="/etc/ssl/kvitqr"
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_DIR/$QR_DOMAIN.crt" ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/$QR_DOMAIN.key" \
    -out "$CERT_DIR/$QR_DOMAIN.crt" \
    -subj "/CN=$QR_DOMAIN" \
    -addext "subjectAltName=DNS:$QR_DOMAIN"
fi

sed -e "s|__QR_DOMAIN__|$QR_DOMAIN|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
    /tmp/kvitqr-nginx.conf > /etc/nginx/sites-available/kvitqr.conf
ln -sfn /etc/nginx/sites-available/kvitqr.conf /etc/nginx/sites-enabled/kvitqr.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    /tmp/kvitqr.service > /etc/systemd/system/kvitqr.service
systemctl daemon-reload
systemctl enable --now kvitqr
systemctl restart kvitqr

# Wire into Hiddify HAProxy if present
if [[ -d /opt/hiddify-manager ]]; then
  SNIP="/opt/hiddify-manager/haproxy/kvitqr.cfg.snippet"
  mkdir -p "$(dirname "$SNIP")"
  sed -e "s|__QR_DOMAIN__|$QR_DOMAIN|g" \
      -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
      /tmp/haproxy-kvitqr.cfg.snippet > "$SNIP"

  # Prefer domain map used by many Hiddify builds
  for MAP in /opt/hiddify-manager/haproxy/*.map /opt/hiddify-manager/haproxy/http_domains.map; do
    [[ -f "$MAP" ]] || continue
    if ! grep -q "$QR_DOMAIN" "$MAP" 2>/dev/null; then
      echo "$QR_DOMAIN kvitqr" >> "$MAP" || true
      echo "Appended $QR_DOMAIN to $MAP"
    fi
  done

  # Ensure backend exists in a drop-in if configs are split
  BACKEND_FILE="/opt/hiddify-manager/haproxy/kvitqr-backend.cfg"
  cat > "$BACKEND_FILE" <<BEOF
backend kvitqr
    mode http
    option forwardfor
    http-request set-header X-Forwarded-Proto https
    server kvitqr1 127.0.0.1:${PROXY_PORT} ssl verify none
BEOF
  echo "Wrote $BACKEND_FILE — include it from HAProxy config if not auto-loaded"
  systemctl reload hiddify-haproxy 2>/dev/null || systemctl reload haproxy 2>/dev/null || true
fi

# Try Hiddify SSL issue for real LE cert
if [[ -x /opt/hiddify-manager/common/get_cert.sh ]]; then
  /opt/hiddify-manager/common/get_cert.sh "$QR_DOMAIN" || true
elif [[ -x /opt/hiddify-manager/ssl/get_cert.sh ]]; then
  /opt/hiddify-manager/ssl/get_cert.sh "$QR_DOMAIN" || true
fi

echo "QR_DOMAIN=$QR_DOMAIN"
echo "local app http://127.0.0.1:$APP_PORT"
echo "local proxy https://127.0.0.1:$PROXY_PORT"
systemctl --no-pager --full status kvitqr | head -25
curl -sS -o /dev/null -w "health:%{http_code}\\n" "http://127.0.0.1:$APP_PORT/api/health" || true
REMOTE

echo
echo "Deploy finished for https://$QR_DOMAIN"
echo "DNS A-record must point $QR_DOMAIN → VPS. Then open the URL."
