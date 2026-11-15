#!/bin/bash
# Lockdown for tiger exit: only SSH, panel:2222, front WG UDP; drop public services.
set -euo pipefail
FRONT_IP="${FRONT_IP:-48.103.140.6}"
PANEL_IP="${PANEL_IP:-136.148.212.221}"
WG_PORT="${WG_PORT:-51814}"

iptables -C INPUT -i lo -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i lo -j ACCEPT
iptables -C INPUT -i wg-tiger -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i wg-tiger -j ACCEPT
iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT

# remnanode :2222 — panel allow + deny everyone else, both near the top of INPUT
# (before any broad ACCEPT that may already exist further down the chain).
while iptables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
# Insert deny first at position 1, then panel allow at position 1 (so allow is above deny).
iptables -I INPUT 1 -p tcp --dport 2222 -j DROP
iptables -I INPUT 1 -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT

# WG UDP — front allow + deny everyone else, same top-of-chain pattern.
while iptables -D INPUT -p udp --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null; do :; done
iptables -I INPUT 1 -p udp --dport "$WG_PORT" -j DROP
iptables -I INPUT 1 -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT

for IF in eth0 eth1 ens3 ens18; do
  ip link show "$IF" >/dev/null 2>&1 || continue
  for PROTO_PORT in tcp:80 tcp:443 udp:443 tcp:8443 tcp:8446 tcp:47136 tcp:49740 tcp:10836; do
    proto=${PROTO_PORT%%:*}; port=${PROTO_PORT##*:}
    iptables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null \
      || iptables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
  done
  for port in 80 443 8443 8446 47136 49740 10836; do
    iptables -C INPUT -i "$IF" -p tcp --dport "$port" -j DROP 2>/dev/null \
      || iptables -A INPUT -i "$IF" -p tcp --dport "$port" -j DROP
  done
  iptables -C INPUT -i "$IF" -p udp --dport 443 -j DROP 2>/dev/null \
    || iptables -A INPUT -i "$IF" -p udp --dport 443 -j DROP
done

iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -t mangle -C OUTPUT -o wg-tiger -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -A OUTPUT -o wg-tiger -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

echo "tiger-exit-fw applied"
