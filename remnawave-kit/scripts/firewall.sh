#!/usr/bin/env bash
# Фаервол для сервера-входа. Открыто: SSH (твой порт), 80, 443. NODE_PORT только для IP панели.
# Использование: PANEL_IP=1.2.3.4 SSH_PORT=22 ADMIN_IP=5.6.7.8 [NODE_PORT=2222] bash firewall.sh
set -euo pipefail
: "${PANEL_IP:?}"
: "${SSH_PORT:?}"
NODE_PORT="${NODE_PORT:-2222}"

apt-get install -y ufw >/dev/null
ufw --force reset
ufw default deny incoming
ufw default allow outgoing

if [ -n "${ADMIN_IP:-}" ]; then
  ufw allow from "$ADMIN_IP" to any port "$SSH_PORT" proto tcp
else
  echo "ADMIN_IP не задан: SSH будет открыт всем. Лучше ограничь по IP."
  ufw allow "$SSH_PORT"/tcp
fi
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from "$PANEL_IP" to any port "$NODE_PORT" proto tcp
ufw --force enable
ufw status verbose
