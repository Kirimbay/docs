#!/usr/bin/env bash
# Install КвитQR + курс on a clean VPS (nginx owns :80/:443).
# Usage:
#   SSH_KEY=/tmp/migrate-ssh/id_ed25519 ./deploy/migrate-clean-vps.sh root@150.241.101.112
set -euo pipefail

TARGET="${1:?usage: $0 user@host}"
SSH_KEY="${SSH_KEY:-/tmp/migrate-ssh/id_ed25519}"
QR_DOMAIN="${QR_DOMAIN:-qr.vele.uk}"
USD_DOMAIN="${USD_DOMAIN:-dollar.vele.uk}"
QR_PORT="${QR_PORT:-8787}"
USD_PORT="${USD_PORT:-8790}"

WS="$(cd "$(dirname "$0")/.." && pwd)"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20 "$TARGET")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new -o ConnectTimeout=20)

echo "==> packing"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/pack/receipt-qr" "$TMP/pack/usd-rate"
cp -a "$WS/receipt-qr/app" "$WS/receipt-qr/requirements.txt" "$WS/receipt-qr/README.md" "$TMP/pack/receipt-qr/"
cp -a "$WS/usd-rate/app" "$WS/usd-rate/requirements.txt" "$WS/usd-rate/README.md" "$TMP/pack/usd-rate/"
# service templates
cp "$WS/receipt-qr/deploy/kvitqr.service" "$TMP/pack/kvitqr.service"
cp "$WS/usd-rate/deploy/usd-rate.service" "$TMP/pack/usd-rate.service"
tar -C "$TMP/pack" -czf "$TMP/apps.tgz" receipt-qr usd-rate kvitqr.service usd-rate.service

echo "==> upload to $TARGET"
"${SCP[@]}" "$TMP/apps.tgz" "$TARGET:/tmp/apps.tgz"

echo "==> remote install"
"${SSH[@]}" bash -s -- "$QR_DOMAIN" "$USD_DOMAIN" "$QR_PORT" "$USD_PORT" <<'REMOTE'
set -euo pipefail
QR_DOMAIN="$1"
USD_DOMAIN="$2"
QR_PORT="$3"
USD_PORT="$4"

export DEBIAN_FRONTEND=noninteractive
export LC_ALL=C.UTF-8
apt-get update -qq
apt-get install -y -qq python3 python3-venv python3-pip nginx openssl certbot \
  tesseract-ocr tesseract-ocr-rus

# --- unpack ---
rm -rf /tmp/apps-unpack
mkdir -p /tmp/apps-unpack
tar -C /tmp/apps-unpack -xzf /tmp/apps.tgz

install_app() {
  local name="$1" src="$2" dir="$3" port="$4" unit_src="$5"
  systemctl stop "$name" 2>/dev/null || true
  rm -rf "$dir"
  mv "$src" "$dir"
  cd "$dir"
  python3 -m venv .venv
  .venv/bin/pip install -q --upgrade pip
  .venv/bin/pip install -q -r requirements.txt
  sed -e "s|__APP_DIR__|$dir|g" -e "s|__APP_PORT__|$port|g" \
    "$unit_src" > "/etc/systemd/system/${name}.service"
}

install_app kvitqr /tmp/apps-unpack/receipt-qr /opt/kvitqr "$QR_PORT" /tmp/apps-unpack/kvitqr.service
install_app usd-rate /tmp/apps-unpack/usd-rate /opt/usd-rate "$USD_PORT" /tmp/apps-unpack/usd-rate.service

systemctl daemon-reload
systemctl enable --now kvitqr usd-rate
systemctl restart kvitqr usd-rate

# --- TLS certs (self-signed bootstrap; LE below if DNS ready) ---
ensure_self_signed() {
  local domain="$1" certdir="$2"
  mkdir -p "$certdir"
  if [[ ! -f "$certdir/$domain.crt" ]]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
      -keyout "$certdir/$domain.key" \
      -out "$certdir/$domain.crt" \
      -subj "/CN=$domain" \
      -addext "subjectAltName=DNS:$domain"
  fi
}
ensure_self_signed "$QR_DOMAIN" /etc/ssl/kvitqr
ensure_self_signed "$USD_DOMAIN" /etc/ssl/usd-rate

# --- nginx public sites ---
cat > /etc/nginx/sites-available/kvitqr.conf <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${QR_DOMAIN} www.${QR_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${QR_DOMAIN} www.${QR_DOMAIN};

    ssl_certificate     /etc/ssl/kvitqr/${QR_DOMAIN}.crt;
    ssl_certificate_key /etc/ssl/kvitqr/${QR_DOMAIN}.key;

    client_max_body_size 15m;

    location / {
        proxy_pass http://127.0.0.1:${QR_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}
NGX

cat > /etc/nginx/sites-available/usd-rate.conf <<NGX
server {
    listen 80;
    listen [::]:80;
    server_name ${USD_DOMAIN} www.${USD_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${USD_DOMAIN} www.${USD_DOMAIN};

    ssl_certificate     /etc/ssl/usd-rate/${USD_DOMAIN}.crt;
    ssl_certificate_key /etc/ssl/usd-rate/${USD_DOMAIN}.key;

    location / {
        proxy_pass http://127.0.0.1:${USD_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
NGX

rm -f /etc/nginx/sites-enabled/default
ln -sfn /etc/nginx/sites-available/kvitqr.conf /etc/nginx/sites-enabled/kvitqr.conf
ln -sfn /etc/nginx/sites-available/usd-rate.conf /etc/nginx/sites-enabled/usd-rate.conf
mkdir -p /var/www/html
nginx -t
systemctl enable --now nginx
systemctl reload nginx

# Try Let's Encrypt if DNS already points here
try_le() {
  local domain="$1"
  shift
  local live="/etc/letsencrypt/live/$domain"
  local args=(-d "$domain")
  for extra in "$@"; do
    args+=(-d "$extra")
  done
  if certbot certonly --webroot -w /var/www/html "${args[@]}" \
      --non-interactive --agree-tos --register-unsafely-without-email 2>&1 | tee "/tmp/le-$domain.log" | tail -20
  then
    if [[ -f "$live/fullchain.pem" ]]; then
      echo "LE OK for $domain"
      return 0
    fi
  fi
  echo "LE not ready for $domain (DNS may still be propagating)"
  return 1
}

swap_to_le() {
  local domain="$1"
  local conf="$2"
  local live="/etc/letsencrypt/live/$domain"
  [[ -f "$live/fullchain.pem" ]] || return 1
  sed -i \
    -e "s|ssl_certificate     .*|ssl_certificate     $live/fullchain.pem;|" \
    -e "s|ssl_certificate_key .*|ssl_certificate_key $live/privkey.pem;|" \
    "$conf"
}

try_le "$QR_DOMAIN" "www.$QR_DOMAIN" && swap_to_le "$QR_DOMAIN" /etc/nginx/sites-available/kvitqr.conf || true
try_le "$USD_DOMAIN" "www.$USD_DOMAIN" && swap_to_le "$USD_DOMAIN" /etc/nginx/sites-available/usd-rate.conf || true
nginx -t && systemctl reload nginx

echo
echo "=== status ==="
systemctl --no-pager --full status kvitqr | head -12
systemctl --no-pager --full status usd-rate | head -12
sleep 2
curl -sS "http://127.0.0.1:${QR_PORT}/api/health" || true
echo
curl -sS "http://127.0.0.1:${USD_PORT}/api/health" || true
echo
REMOTE

echo
echo "Done. Domains: https://$QR_DOMAIN  https://$USD_DOMAIN"
echo "Point DNS A-records to the new IP, then re-run LE if needed:"
echo "  ssh -i $SSH_KEY $TARGET 'certbot certonly --webroot -w /var/www/html -d $QR_DOMAIN -d $USD_DOMAIN --non-interactive --agree-tos --register-unsafely-without-email'"
