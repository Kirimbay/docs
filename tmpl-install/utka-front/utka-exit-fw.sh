#!/bin/bash
set -euo pipefail
FRONT_IP="${FRONT_IP:-185.113.11.52}"
PANEL_IP="${PANEL_IP:-136.148.212.221}"
WG_PORT="${WG_PORT:-51857}"
iptables -C INPUT -i lo -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i lo -j ACCEPT
iptables -C INPUT -i wg-utka -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i wg-utka -j ACCEPT
iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT

while iptables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
iptables -I INPUT 1 -p tcp --dport 2222 -j DROP
iptables -I INPUT 1 -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT

# General IPv6 accepts first, then pin :2222 DROP at the top so tunnel/lo
# ACCEPT cannot shadow the panel-port block (Codex P2).
ip6tables -C INPUT -i lo -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -i lo -j ACCEPT
ip6tables -C INPUT -i wg-utka -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -i wg-utka -j ACCEPT
ip6tables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null \
  || ip6tables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p tcp --dport 22 -j ACCEPT
ip6tables -C INPUT -p ipv6-icmp -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p ipv6-icmp -j ACCEPT
while ip6tables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while ip6tables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
ip6tables -I INPUT 1 -p tcp --dport 2222 -j DROP

while iptables -D INPUT -p udp --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null; do :; done
iptables -I INPUT 1 -p udp --dport "$WG_PORT" -j DROP
iptables -I INPUT 1 -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT

EXIT_PUBLIC_IP="${EXIT_PUBLIC_IP:-185.113.11.79}"
# belt-and-suspenders: drop by destination even if iface name differs
for port in 80 443; do
  iptables -t raw -C PREROUTING -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP 2>/dev/null \
    || iptables -t raw -I PREROUTING 1 -d "$EXIT_PUBLIC_IP" -p tcp --dport "$port" -j DROP
done

for IF in eth0 eth1 ens3 ens18; do
  ip link show "$IF" >/dev/null 2>&1 || continue
  for PROTO_PORT in tcp:80 tcp:443 udp:443 tcp:8443 tcp:8446 tcp:47157 tcp:47764 tcp:10857; do
    proto=${PROTO_PORT%%:*}; port=${PROTO_PORT##*:}
    iptables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null \
      || iptables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
    ip6tables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null \
      || ip6tables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
  done
  for port in 80 443 8443 8446 47157 47764 10857; do
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
