#!/usr/bin/env bash
# Transparent TCP(+UDP) DNAT on RO tiger front → exit WG.
# Idempotent. No TLS inspect.
set -euo pipefail

EXIT_WG="${EXIT_WG:-10.77.14.2}"
PORT="${PORT:-443}"
FRONT_IP="${FRONT_IP:-103.102.229.156}"

apply() {
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  mkdir -p /etc/sysctl.d
  echo 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-tiger-forward.conf

  iptables -t nat -C PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" \
    -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null \
    || iptables -t nat -A PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" \
      -j DNAT --to-destination "$EXIT_WG:$PORT"

  iptables -t nat -C PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" \
    -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null \
    || iptables -t nat -A PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" \
      -j DNAT --to-destination "$EXIT_WG:$PORT"

  iptables -t nat -C POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT \
    -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT \
      -j MASQUERADE

  iptables -C FORWARD -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT
  iptables -C FORWARD -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 2 -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

  iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
    || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

  echo "DNAT $FRONT_IP:$PORT → $EXIT_WG:$PORT OK"
}

rollback() {
  while iptables -t nat -D PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" \
    -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" \
    -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT \
    -j MASQUERADE 2>/dev/null; do :; done
  while iptables -D FORWARD -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null; do :; done
  while iptables -D FORWARD -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; do :; done
  while iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null; do :; done
  rm -f /etc/sysctl.d/99-tiger-forward.conf
  # Only clear runtime forward if nothing else owns a persist file.
  if ! ls /etc/sysctl.d/*forward* >/dev/null 2>&1; then
    sysctl -w net.ipv4.ip_forward=0 >/dev/null || true
  fi
  echo "DNAT rolled back"
}

case "${1:-apply}" in
  apply) apply ;;
  --rollback|rollback) rollback ;;
  *) echo "usage: $0 [apply|--rollback]"; exit 1 ;;
esac
