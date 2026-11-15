#!/bin/bash
set -euo pipefail
FRONT_IP="${FRONT_IP:-185.113.11.52}"
PANEL_IP="${PANEL_IP:-136.148.212.221}"
WG_PORT="${WG_PORT:-51857}"
EXIT_PUBLIC_IP="${EXIT_PUBLIC_IP:-185.113.11.79}"
# Optional public IPv6 of this exit (empty = skip dest-based ip6 drops).
EXIT_PUBLIC_IP6="${EXIT_PUBLIC_IP6:-}"

# Broad accepts must APPEND. Inserting them at INPUT 1 would shadow panel/WG pins.
iptables -C INPUT -i lo -j ACCEPT 2>/dev/null || iptables -A INPUT -i lo -j ACCEPT
iptables -C INPUT -i wg-utka -j ACCEPT 2>/dev/null || iptables -A INPUT -i wg-utka -j ACCEPT
iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || iptables -A INPUT -p tcp --dport 22 -j ACCEPT

ip6tables -C INPUT -i lo -j ACCEPT 2>/dev/null || ip6tables -A INPUT -i lo -j ACCEPT
ip6tables -C INPUT -i wg-utka -j ACCEPT 2>/dev/null || ip6tables -A INPUT -i wg-utka -j ACCEPT
ip6tables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || ip6tables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || ip6tables -A INPUT -p tcp --dport 22 -j ACCEPT
ip6tables -C INPUT -p ipv6-icmp -j ACCEPT 2>/dev/null || ip6tables -A INPUT -p ipv6-icmp -j ACCEPT

# True when panel DROP appears before any broad iface ACCEPT (so pins win).
v4_pin_order_ok() {
  local rules pos_drop pos_broad
  rules=$(iptables -S INPUT)
  pos_drop=$(printf '%s\n' "$rules" | grep -n -- '--dport 2222 -j DROP' | head -1 | cut -d: -f1 || true)
  [[ -n "${pos_drop:-}" ]] || return 1
  pos_broad=$(printf '%s\n' "$rules" | grep -nE -- '-i (lo|wg-utka) -j ACCEPT' | head -1 | cut -d: -f1 || true)
  [[ -z "${pos_broad:-}" || "$pos_drop" -lt "$pos_broad" ]]
}

v6_pin_order_ok() {
  local rules pos_drop pos_broad
  rules=$(ip6tables -S INPUT)
  pos_drop=$(printf '%s\n' "$rules" | grep -n -- '--dport 2222 -j DROP' | head -1 | cut -d: -f1 || true)
  [[ -n "${pos_drop:-}" ]] || return 1
  pos_broad=$(printf '%s\n' "$rules" | grep -nE -- '-i (lo|wg-utka) -j ACCEPT' | head -1 | cut -d: -f1 || true)
  [[ -z "${pos_broad:-}" || "$pos_drop" -lt "$pos_broad" ]]
}

pin_v4_2222() {
  while iptables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
  iptables -I INPUT 1 -p tcp --dport 2222 -j DROP
  iptables -I INPUT 1 -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT
}

pin_v6_2222() {
  while ip6tables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
  while ip6tables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
  ip6tables -I INPUT 1 -p tcp --dport 2222 -j DROP
}

pin_v4_wg() {
  while iptables -D INPUT -p udp --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null; do :; done
  iptables -I INPUT 1 -p udp --dport "$WG_PORT" -j DROP
  iptables -I INPUT 1 -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT
}

if ! iptables -C INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null \
  || ! iptables -C INPUT -p tcp --dport 2222 -j DROP 2>/dev/null \
  || ! v4_pin_order_ok; then
  pin_v4_2222
fi

if ! ip6tables -C INPUT -p tcp --dport 2222 -j DROP 2>/dev/null || ! v6_pin_order_ok; then
  pin_v6_2222
fi

if ! iptables -C INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null \
  || ! iptables -C INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null; then
  pin_v4_wg
fi

LOCK_TCP_PORTS=(80 443 8443 8446 47157 47764 10857)

# Dest-based drops work even if the public NIC is not eth0/ens*.
for port in "${LOCK_TCP_PORTS[@]}"; do
  iptables -t raw -C PREROUTING -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP 2>/dev/null \
    || iptables -t raw -I PREROUTING 1 -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP
  iptables -C INPUT -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP 2>/dev/null \
    || iptables -A INPUT -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP
done
iptables -t raw -C PREROUTING -d "$EXIT_PUBLIC_IP" -p udp --dport 443 -j DROP 2>/dev/null \
  || iptables -t raw -I PREROUTING 1 -d "$EXIT_PUBLIC_IP" -p udp --dport 443 -j DROP
iptables -C INPUT -d "$EXIT_PUBLIC_IP" -p udp --dport 443 -j DROP 2>/dev/null \
  || iptables -A INPUT -d "$EXIT_PUBLIC_IP" -p udp --dport 443 -j DROP

if [[ -n "$EXIT_PUBLIC_IP6" ]]; then
  for port in "${LOCK_TCP_PORTS[@]}"; do
    ip6tables -t raw -C PREROUTING -d "$EXIT_PUBLIC_IP6" -p tcp --dport "$port" -j DROP 2>/dev/null \
      || ip6tables -t raw -I PREROUTING 1 -d "$EXIT_PUBLIC_IP6" -p tcp --dport "$port" -j DROP
    ip6tables -C INPUT -d "$EXIT_PUBLIC_IP6" -p tcp --dport "$port" -j DROP 2>/dev/null \
      || ip6tables -A INPUT -d "$EXIT_PUBLIC_IP6" -p tcp --dport "$port" -j DROP
  done
  ip6tables -t raw -C PREROUTING -d "$EXIT_PUBLIC_IP6" -p udp --dport 443 -j DROP 2>/dev/null \
    || ip6tables -t raw -I PREROUTING 1 -d "$EXIT_PUBLIC_IP6" -p udp --dport 443 -j DROP
fi

for IF in eth0 eth1 ens3 ens18; do
  ip link show "$IF" >/dev/null 2>&1 || continue
  for PROTO_PORT in tcp:80 tcp:443 udp:443 tcp:8443 tcp:8446 tcp:47157 tcp:47764 tcp:10857; do
    proto=${PROTO_PORT%%:*}; port=${PROTO_PORT##*:}
    iptables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null \
      || iptables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
    ip6tables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null \
      || ip6tables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
  done
  for port in "${LOCK_TCP_PORTS[@]}"; do
    iptables -C INPUT -i "$IF" -p tcp --dport "$port" -j DROP 2>/dev/null \
      || iptables -A INPUT -i "$IF" -p tcp --dport "$port" -j DROP
    ip6tables -C INPUT -i "$IF" -p tcp --dport "$port" -j DROP 2>/dev/null \
      || ip6tables -A INPUT -i "$IF" -p tcp --dport "$port" -j DROP
  done
  iptables -C INPUT -i "$IF" -p udp --dport 443 -j DROP 2>/dev/null \
    || iptables -A INPUT -i "$IF" -p udp --dport 443 -j DROP
done

iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -t mangle -C OUTPUT -o wg-utka -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -A OUTPUT -o wg-utka -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
echo "utka-exit-fw applied"
