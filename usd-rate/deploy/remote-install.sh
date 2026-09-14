#!/usr/bin/env bash
# Deploy «курс» (USD ЦБ) on Hiddify VPS (HAProxy owns :80/:443).
# Usage:
#   USD_DOMAIN=dollar.vele.uk ./deploy/remote-install.sh root@138.124.242.142
set -euo pipefail

TARGET="${1:?usage: $0 user@host}"
USD_DOMAIN="${USD_DOMAIN:-dollar.vele.uk}"
SSH_KEY="${SSH_KEY:-/tmp/qr-ssh/id_ed25519}"
APP_DIR="${APP_DIR:-/opt/usd-rate}"
APP_PORT="${APP_PORT:-8790}"
PROXY_PORT="${PROXY_PORT:-8791}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$TARGET")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "==> packing app"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/usd-rate/deploy"
cp -a "$ROOT/app" "$ROOT/requirements.txt" "$ROOT/README.md" "$TMP/usd-rate/"
cp -a "$ROOT/deploy/"*.service "$ROOT/deploy/"*.conf "$ROOT/deploy/"*.snippet \
  "$ROOT/deploy/remote-install.sh" "$ROOT/deploy/authorize-agent.sh" \
  "$TMP/usd-rate/deploy/" 2>/dev/null || true
tar -C "$TMP" -czf "$TMP/usd-rate.tgz" usd-rate

echo "==> uploading to $TARGET"
"${SCP[@]}" "$TMP/usd-rate.tgz" "$TARGET:/tmp/usd-rate.tgz"
"${SCP[@]}" "$ROOT/deploy/usd-rate.service" "$TARGET:/tmp/usd-rate.service"
"${SCP[@]}" "$ROOT/deploy/usd-rate-nginx.conf" "$TARGET:/tmp/usd-rate-nginx.conf"
"${SCP[@]}" "$ROOT/deploy/haproxy-usd-rate.cfg.snippet" "$TARGET:/tmp/haproxy-usd-rate.cfg.snippet"

echo "==> installing remotely"
"${SSH[@]}" bash -s -- "$USD_DOMAIN" "$APP_DIR" "$APP_PORT" "$PROXY_PORT" <<'REMOTE'
set -euo pipefail
USD_DOMAIN="$1"
APP_DIR="$2"
APP_PORT="$3"
PROXY_PORT="$4"

export DEBIAN_FRONTEND=noninteractive
mkdir -p /etc/apt/sources.list.d/disabled
mv /etc/apt/sources.list.d/*haproxy* /etc/apt/sources.list.d/disabled/ 2>/dev/null || true
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx openssl

systemctl stop usd-rate 2>/dev/null || true
rm -rf "$APP_DIR"
mkdir -p "$APP_DIR"
tar -C /opt -xzf /tmp/usd-rate.tgz
rm -rf "$APP_DIR"
mv /opt/usd-rate "$APP_DIR"

cd "$APP_DIR"
python3 -m venv .venv
.venv/bin/pip install -q --upgrade pip
.venv/bin/pip install -q -r requirements.txt

CERT_DIR="/etc/ssl/usd-rate"
mkdir -p "$CERT_DIR"
if [[ ! -f "$CERT_DIR/$USD_DOMAIN.crt" ]]; then
  openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
    -keyout "$CERT_DIR/$USD_DOMAIN.key" \
    -out "$CERT_DIR/$USD_DOMAIN.crt" \
    -subj "/CN=$USD_DOMAIN" \
    -addext "subjectAltName=DNS:$USD_DOMAIN"
fi

sed -e "s|__USD_DOMAIN__|$USD_DOMAIN|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
    /tmp/usd-rate-nginx.conf > /etc/nginx/sites-available/usd-rate.conf
ln -sfn /etc/nginx/sites-available/usd-rate.conf /etc/nginx/sites-enabled/usd-rate.conf
nginx -t
systemctl enable --now nginx
systemctl reload nginx

sed -e "s|__APP_DIR__|$APP_DIR|g" \
    -e "s|__APP_PORT__|$APP_PORT|g" \
    /tmp/usd-rate.service > /etc/systemd/system/usd-rate.service
systemctl daemon-reload
systemctl enable --now usd-rate
systemctl restart usd-rate

if [[ -d /opt/hiddify-manager ]]; then
  SNIP="/opt/hiddify-manager/haproxy/usd-rate.cfg.snippet"
  mkdir -p "$(dirname "$SNIP")"
  sed -e "s|__USD_DOMAIN__|$USD_DOMAIN|g" \
      -e "s|__PROXY_PORT__|$PROXY_PORT|g" \
      /tmp/haproxy-usd-rate.cfg.snippet > "$SNIP"

  for MAP in /opt/hiddify-manager/haproxy/*.map /opt/hiddify-manager/haproxy/http_domains.map; do
    [[ -f "$MAP" ]] || continue
    if ! grep -q "$USD_DOMAIN" "$MAP" 2>/dev/null; then
      echo "$USD_DOMAIN usd_rate" >> "$MAP" || true
      echo "Appended $USD_DOMAIN to $MAP"
    fi
  done

  BACKEND_FILE="/opt/hiddify-manager/haproxy/usd-rate-backend.cfg"
  cat > "$BACKEND_FILE" <<BEOF
backend usd_rate
    mode http
    option forwardfor
    http-request set-header X-Forwarded-Proto https
    server usd_rate1 127.0.0.1:${PROXY_PORT} ssl verify none
BEOF
  echo "Wrote $BACKEND_FILE — include it from HAProxy config if not auto-loaded"
  systemctl reload hiddify-haproxy 2>/dev/null || systemctl reload haproxy 2>/dev/null || true
fi

if [[ -x /opt/hiddify-manager/common/get_cert.sh ]]; then
  /opt/hiddify-manager/common/get_cert.sh "$USD_DOMAIN" || true
elif [[ -x /opt/hiddify-manager/ssl/get_cert.sh ]]; then
  /opt/hiddify-manager/ssl/get_cert.sh "$USD_DOMAIN" || true
fi

echo "USD_DOMAIN=$USD_DOMAIN"
echo "local app http://127.0.0.1:$APP_PORT"
echo "local proxy https://127.0.0.1:$PROXY_PORT"
systemctl --no-pager --full status usd-rate | head -25
curl -sS -o /dev/null -w "health:%{http_code}\\n" "http://127.0.0.1:$APP_PORT/api/health" || true
REMOTE

echo
echo "Deploy finished for https://$USD_DOMAIN"
echo "DNS A-record must point $USD_DOMAIN → VPS. Then open the URL."
