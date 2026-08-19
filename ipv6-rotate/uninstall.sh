#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

if [[ -x /usr/local/sbin/rotate-ipv6.sh ]]; then
  /usr/local/sbin/rotate-ipv6.sh --off || true
fi

systemctl disable --now ipv6-rotate.timer 2>/dev/null || true
systemctl disable --now ipv6-rotate-restore.service 2>/dev/null || true
rm -f /etc/systemd/system/ipv6-rotate.service \
      /etc/systemd/system/ipv6-rotate.timer \
      /etc/systemd/system/ipv6-rotate-restore.service \
      /etc/logrotate.d/ipv6-rotate
systemctl daemon-reload
rm -f /usr/local/sbin/rotate-ipv6.sh
rm -rf /usr/local/lib/ipv6-rotate

echo "Rotation removed. Primary IPv4/IPv6 were not changed."
echo "Config/logs left in /etc/ipv6-rotate, /var/lib/ipv6-rotate, /var/log/ipv6-rotate.log"
