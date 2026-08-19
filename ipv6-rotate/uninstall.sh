#!/usr/bin/env bash
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "run as root" >&2; exit 1; }

systemctl disable --now ipv6-rotate.timer 2>/dev/null || true
systemctl disable --now ipv6-rotate-restore.service 2>/dev/null || true
rm -f /etc/systemd/system/ipv6-rotate.service \
      /etc/systemd/system/ipv6-rotate.timer \
      /etc/systemd/system/ipv6-rotate-restore.service
systemctl daemon-reload
rm -f /usr/local/sbin/rotate-ipv6.sh
rm -rf /usr/local/lib/ipv6-rotate

echo "Units removed. Config left in /etc/ipv6-rotate and state in /var/lib/ipv6-rotate"
echo "The extra IPv6 on the interface is not removed automatically."
echo "To drop it: ip -6 addr del <addr>/<len> dev <iface>"
