#!/usr/bin/env bash
# Install the monitor on a Linux server (systemd, no Docker).
# Usage (on the server):
#   sudo bash deploy/install-systemd.sh /opt/uno-mas-monitor
set -euo pipefail

TARGET="${1:-/opt/uno-mas-monitor}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_NAME="uno-mas-monitor"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-systemd.sh $TARGET"
  exit 1
fi

RUN_USER="${SUDO_USER:-ubuntu}"
mkdir -p "$TARGET/data"
rsync -a --delete \
  --exclude '.venv' \
  --exclude 'data' \
  --exclude '.env' \
  --exclude '__pycache__' \
  "$ROOT/" "$TARGET/"

if [[ ! -f "$TARGET/.env" ]]; then
  cp "$TARGET/.env.example" "$TARGET/.env"
  echo "Created $TARGET/.env — fill TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID, then re-run."
  chown -R "$RUN_USER:$RUN_USER" "$TARGET"
  exit 2
fi

python3 -m venv "$TARGET/.venv"
"$TARGET/.venv/bin/pip" install --upgrade pip
"$TARGET/.venv/bin/pip" install -r "$TARGET/requirements.txt"
chown -R "$RUN_USER:$RUN_USER" "$TARGET"

sed \
  -e "s|User=ubuntu|User=$RUN_USER|" \
  -e "s|/opt/uno-mas-monitor|$TARGET|g" \
  "$TARGET/deploy/uno-mas-monitor.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable --now "$SERVICE_NAME"
systemctl --no-pager --full status "$SERVICE_NAME" || true

echo
echo "Installed. Useful commands:"
echo "  sudo systemctl status $SERVICE_NAME"
echo "  sudo journalctl -u $SERVICE_NAME -f"
echo "  sudo systemctl restart $SERVICE_NAME"
