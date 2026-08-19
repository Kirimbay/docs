#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "run as root: sudo $0" >&2; exit 1; }

CONF_DIR=/etc/ipv6-rotate
STATE_DIR=/var/lib/ipv6-rotate
BIN=/usr/local/sbin/rotate-ipv6.sh

install -d "$CONF_DIR" "$CONF_DIR/hooks" "$STATE_DIR" /usr/local/lib/ipv6-rotate
install -m 0755 "$ROOT/rotate-ipv6.sh" "$BIN"
install -m 0755 "$ROOT/pick.py" /usr/local/lib/ipv6-rotate/pick.py
install -m 0755 "$ROOT/hooks/cloudflare-aaaa.sh" "$CONF_DIR/hooks/cloudflare-aaaa.sh"
install -m 0644 "$ROOT/ipv6-rotate.service" /etc/systemd/system/ipv6-rotate.service
install -m 0644 "$ROOT/ipv6-rotate.timer" /etc/systemd/system/ipv6-rotate.timer
install -m 0644 "$ROOT/ipv6-rotate-restore.service" /etc/systemd/system/ipv6-rotate-restore.service
install -m 0644 "$ROOT/ipv6-rotate.logrotate" /etc/logrotate.d/ipv6-rotate

if [[ ! -f "$CONF_DIR/pool.txt" ]]; then
  install -m 0644 "$ROOT/pool.txt.example" "$CONF_DIR/pool.txt"
fi

iface="$(ip -6 route show default 2>/dev/null | awk '/default/ {print $5; exit}')"
gw="$(ip -6 route show default 2>/dev/null | awk '/default/ {print $3; exit}')"
primary="$(ip -6 addr show ${iface:+dev "$iface"} scope global 2>/dev/null | awk '/inet6/ && !/temporary/ {print $2; exit}')"

if [[ ! -f "$CONF_DIR/protected" ]]; then
  ip -6 addr show ${iface:+dev "$iface"} scope global 2>/dev/null \
    | awk '/inet6/ && !/temporary/ {split($2,a,"/"); print a[1]}' \
    >"$CONF_DIR/protected"
  chmod 0644 "$CONF_DIR/protected"
  echo "snapshotted protected IPv6 addresses:"
  cat "$CONF_DIR/protected"
fi

subnet=""
if [[ -n "$primary" ]]; then
  subnet="$(python3 - "$primary" <<'PY'
import ipaddress, sys
print(ipaddress.IPv6Interface(sys.argv[1]).network)
PY
)"
fi

if [[ -z "$iface" || -z "$gw" || -z "$primary" ]]; then
  echo "WARNING: could not auto-detect IPv6 interface/gateway/address."
  echo "Fill /etc/ipv6-rotate/ipv6-rotate.conf before the first rotate."
fi

if [[ ! -f "$CONF_DIR/ipv6-rotate.conf" ]]; then
  sed \
    -e "s|^SUBNET=.*|SUBNET=${subnet}|" \
    -e "s|^INTERFACE=.*|INTERFACE=${iface}|" \
    -e "s|^GATEWAY=.*|GATEWAY=${gw}|" \
    "$ROOT/ipv6-rotate.conf.example" >"$CONF_DIR/ipv6-rotate.conf"
  chmod 0644 "$CONF_DIR/ipv6-rotate.conf"
  echo "wrote $CONF_DIR/ipv6-rotate.conf"
else
  echo "keeping existing $CONF_DIR/ipv6-rotate.conf"
fi

systemctl daemon-reload
systemctl enable --now ipv6-rotate-restore.service
systemctl enable --now ipv6-rotate.timer

echo
echo "Installed."
echo "  1. Check config:  nano $CONF_DIR/ipv6-rotate.conf"
echo "  2. Dry-run:       $BIN --dry-run"
echo "  3. First rotate:  $BIN"
echo "  4. Status/logs:   $BIN --status && $BIN --log"
echo "  5. Manual set:    $BIN --set <ipv6>"
echo "  6. Rollback:      $BIN --rollback     (previous extra IP)"
echo "                     $BIN --off          (drop extra IP, primary only)"
echo "  7. Next run:      systemctl list-timers ipv6-rotate.timer"
echo
echo "Hiddify Manager is not restarted and its configs are not modified."
echo "Timezone for 03:00 is the system local time: timedatectl"
