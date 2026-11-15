#!/usr/bin/env bash
set -euo pipefail
EXIT_WG="${EXIT_WG:-10.77.58.2}"
EXIT_PUBLIC_IP="${EXIT_PUBLIC_IP:-136.148.223.200}"
PORT="${PORT:-443}"
FRONT_IP="${FRONT_IP:-136.148.213.105}"
WG_PORT="${WG_PORT:-51858}"
STATE_DIR="${STATE_DIR:-/var/lib/slon-dnat}"
FORWARD_STATE="$STATE_DIR/ip_forward.prev"
# Legacy HostUp DNAT (054) — remove on apply so only WG path remains.
OLD_EXIT_LAN="${OLD_EXIT_LAN:-10.202.120.54}"
OLD_FRONT_LAN="${OLD_FRONT_LAN:-10.202.120.2}"

apply() {
  mkdir -p "$STATE_DIR"
  if [[ ! -f "$FORWARD_STATE" ]]; then
    sysctl -n net.ipv4.ip_forward >"$FORWARD_STATE" || echo 0 >"$FORWARD_STATE"
  fi
  sysctl -w net.ipv4.ip_forward=1 >/dev/null
  mkdir -p /etc/sysctl.d
  echo 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-slon-forward.conf

  # Drop legacy LAN DNAT/SNAT to 054 if still present.
  while iptables -t nat -D PREROUTING -d "$FRONT_IP/32" -p tcp --dport "$PORT" -j DNAT --to-destination "$OLD_EXIT_LAN:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D PREROUTING -d "$FRONT_IP/32" -p udp --dport "$PORT" -j DNAT --to-destination "$OLD_EXIT_LAN:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D POSTROUTING -d "$OLD_EXIT_LAN/32" -p tcp --dport "$PORT" -j SNAT --to-source "$OLD_FRONT_LAN" 2>/dev/null; do :; done
  while iptables -t nat -D POSTROUTING -d "$OLD_EXIT_LAN/32" -p udp --dport "$PORT" -j SNAT --to-source "$OLD_FRONT_LAN" 2>/dev/null; do :; done
  while iptables -D FORWARD -d "$OLD_EXIT_LAN/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null; do :; done
  while iptables -D FORWARD -s "$OLD_EXIT_LAN/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; do :; done

  iptables -t nat -C PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null \
    || iptables -t nat -A PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT"
  iptables -t nat -C PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null \
    || iptables -t nat -A PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT"
  iptables -t nat -C POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j MASQUERADE 2>/dev/null \
    || iptables -t nat -A POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j MASQUERADE
  iptables -C FORWARD -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 1 -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT
  iptables -C FORWARD -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
    || iptables -I FORWARD 2 -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
  # Append-only on INPUT so we never jump ahead of unrelated pins.
  iptables -C INPUT -i wg-slon -p tcp --dport 8446 -j ACCEPT 2>/dev/null \
    || iptables -A INPUT -i wg-slon -p tcp --dport 8446 -j ACCEPT
  iptables -C INPUT -p udp -s "$EXIT_PUBLIC_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null \
    || iptables -A INPUT -p udp -s "$EXIT_PUBLIC_IP" --dport "$WG_PORT" -j ACCEPT
  iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
    || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  iptables -t mangle -C OUTPUT -o wg-slon -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
    || iptables -t mangle -A OUTPUT -o wg-slon -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  echo "slon-dnat applied"
}
rollback() {
  while iptables -t nat -D PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D PREROUTING -p udp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null; do :; done
  while iptables -t nat -D POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j MASQUERADE 2>/dev/null; do :; done
  while iptables -D FORWARD -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null; do :; done
  while iptables -D FORWARD -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i wg-slon -p tcp --dport 8446 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -p udp -s "$EXIT_PUBLIC_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
  while iptables -t mangle -D FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null; do :; done
  while iptables -t mangle -D OUTPUT -o wg-slon -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null; do :; done
  rm -f /etc/sysctl.d/99-slon-forward.conf
  if [[ -f "$FORWARD_STATE" ]]; then
    prev=$(tr -d '[:space:]' <"$FORWARD_STATE" || true)
    [[ "$prev" == "0" || "$prev" == "1" ]] || prev=1
    sysctl -w "net.ipv4.ip_forward=$prev" >/dev/null || true
    rm -f "$FORWARD_STATE"
  fi
  echo "slon-dnat rolled back"
}
case "${1:-apply}" in apply) apply ;; --rollback|rollback) rollback ;; *) echo "usage: $0 [apply|--rollback]"; exit 1 ;; esac
