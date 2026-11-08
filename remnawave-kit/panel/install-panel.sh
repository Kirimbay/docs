#!/usr/bin/env bash
# Ставит Remnawave Panel + Caddy на ОТДЕЛЬНЫЙ сервер (не тот, что вход для клиентов).
# Использование: PANEL_DOMAIN=panel.example.com SUB_DOMAIN=sub.example.com bash install-panel.sh
set -euo pipefail

: "${PANEL_DOMAIN:?задай PANEL_DOMAIN (домен панели, A-запись на этот сервер)}"
: "${SUB_DOMAIN:?задай SUB_DOMAIN (домен подписок, A-запись на этот сервер)}"

HERE="$(dirname "$(readlink -f "$0")")"

[ "$(id -u)" = 0 ] || { echo "запусти от root"; exit 1; }

command -v docker >/dev/null || curl -fsSL https://get.docker.com | sh

DIR=/opt/remnawave
mkdir -p "$DIR/caddy" && cd "$DIR"

curl -fsSL -o docker-compose.yml https://raw.githubusercontent.com/remnawave/backend/refs/heads/main/docker-compose-prod.yml
[ -f .env ] || curl -fsSL -o .env https://raw.githubusercontent.com/remnawave/backend/refs/heads/main/.env.sample

if [ ! -f .secrets-generated ]; then
  sed -i "s/^APP_SECRET=.*/APP_SECRET=$(openssl rand -hex 64)/" .env
  sed -i "s/^METRICS_PASS=.*/METRICS_PASS=$(openssl rand -hex 64)/" .env
  sed -i "s/^WEBHOOK_SECRET_HEADER=.*/WEBHOOK_SECRET_HEADER=$(openssl rand -hex 64)/" .env
  pw=$(openssl rand -hex 24)
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$pw/" .env
  sed -i "s|^\(DATABASE_URL=\"postgresql://postgres:\)[^\@]*\(@.*\)|\1$pw\2|" .env
  touch .secrets-generated
fi
sed -i "s|^FRONT_END_DOMAIN=.*|FRONT_END_DOMAIN=$PANEL_DOMAIN|" .env
sed -i "s|^SUB_PUBLIC_DOMAIN=.*|SUB_PUBLIC_DOMAIN=$SUB_DOMAIN|" .env

docker compose up -d

sed -e "s/__PANEL_DOMAIN__/$PANEL_DOMAIN/g" -e "s/__SUB_DOMAIN__/$SUB_DOMAIN/g" \
  "$HERE/Caddyfile.tmpl" > "$DIR/caddy/Caddyfile"
cp "$HERE/caddy-compose.yml" "$DIR/caddy/docker-compose.yml"
(cd "$DIR/caddy" && docker compose up -d)

echo
echo "Готово. Открой https://$PANEL_DOMAIN и создай админа."
echo "Проверь, что в $DIR/.env нет значений по умолчанию (grep -E 'SECRET|PASS' $DIR/.env)."
