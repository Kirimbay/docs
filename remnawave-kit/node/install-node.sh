#!/usr/bin/env bash
# Ставит Remnawave Node + Caddy (self-steal сайт-заглушка) на сервер-ВХОД.
# Использование:
#   NODE_DOMAIN=cdn.example.com SECRET_KEY='<из панели>' [NODE_PORT=2222] [PANEL_IP=1.2.3.4] bash install-node.sh
set -euo pipefail

: "${NODE_DOMAIN:?задай NODE_DOMAIN (A-запись на IP этого сервера, нейтральное имя без vpn/proxy/xray)}"
: "${SECRET_KEY:?задай SECRET_KEY из карточки ноды в панели}"
NODE_PORT="${NODE_PORT:-2222}"
HERE="$(dirname "$(readlink -f "$0")")"

[ "$(id -u)" = 0 ] || { echo "запусти от root"; exit 1; }

case "$NODE_DOMAIN" in
  *vpn*|*proxy*|*node*|*xray*|*reality*|*tunnel*) echo "Плохое имя домена: $NODE_DOMAIN (не используй vpn/proxy/node/xray/reality)"; exit 1;;
esac

resolved=$(getent ahostsv4 "$NODE_DOMAIN" | awk '{print $1; exit}' || true)
mine=$(curl -4fsS https://api.ipify.org || true)
if [ -n "$mine" ] && [ "$resolved" != "$mine" ]; then
  echo "DNS $NODE_DOMAIN -> '$resolved', а IP сервера '$mine'. Исправь A-запись и повтори (нужно для выпуска сертификата и self-steal)."
  exit 1
fi

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

mkdir -p /opt/remnanode/site /var/log/remnanode
cp -r "$HERE/site/." /opt/remnanode/site/
find /opt/remnanode/site -type f \( -name "*.html" -o -name "*.xml" -o -name "*.txt" \) -exec sed -i "s/__NODE_DOMAIN__/$NODE_DOMAIN/g" {} +
sed "s/__NODE_DOMAIN__/$NODE_DOMAIN/g" "$HERE/Caddyfile.tmpl" > /opt/remnanode/Caddyfile

cat > /opt/remnanode/docker-compose.yml <<EOF
services:
  remnanode:
    image: remnawave/node:latest
    container_name: remnanode
    hostname: remnanode
    restart: always
    network_mode: host
    environment:
      - NODE_PORT=$NODE_PORT
      - SECRET_KEY=$SECRET_KEY
    volumes:
      - /var/log/remnanode:/var/log/remnanode
    logging:
      driver: json-file
      options:
        max-size: 20m
        max-file: "3"

  selfsteal:
    image: caddy:2.9
    container_name: selfsteal
    restart: always
    network_mode: host
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./site:/var/www/html:ro
      - caddy-data:/data
    logging:
      driver: json-file
      options:
        max-size: 10m
        max-file: "3"

volumes:
  caddy-data:
EOF

cat > /etc/logrotate.d/remnanode <<'EOF'
/var/log/remnanode/*.log {
  size 50M
  rotate 5
  compress
  missingok
  notifempty
  copytruncate
}
EOF

cd /opt/remnanode && docker compose up -d

echo
echo "Подожди ~30 секунд (выпуск сертификата), затем: NODE_DOMAIN=$NODE_DOMAIN bash scripts/check-node.sh"
echo "Дальше: scripts/firewall.sh (NODE_PORT=$NODE_PORT только для IP панели), затем профиль и хост в панели."
