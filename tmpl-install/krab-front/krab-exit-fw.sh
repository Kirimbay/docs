#!/bin/bash
set -euo pipefail
FRONT_V6="2a12:bec4:1ac0:116d::1"
FRONT_IP4="144.31.13.79"
PANEL_IP="136.148.212.221"
WG_PORT="51837"

iptables -C INPUT -i lo -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i lo -j ACCEPT
iptables -C INPUT -i wg-krab -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -i wg-krab -j ACCEPT
iptables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null   || iptables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT

# also ip6tables basics
ip6tables -C INPUT -i lo -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -i lo -j ACCEPT
ip6tables -C INPUT -i wg-krab -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -i wg-krab -j ACCEPT
ip6tables -C INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null   || ip6tables -I INPUT 1 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -C INPUT -p tcp --dport 22 -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p tcp --dport 22 -j ACCEPT
ip6tables -C INPUT -p ipv6-icmp -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p ipv6-icmp -j ACCEPT

# remnanode :2222 — panel allow (IPv4) + deny everyone else (v4 + v6).
# Panel has no IPv6 path, so drop all IPv6 :2222.
while iptables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while iptables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
iptables -I INPUT 1 -p tcp --dport 2222 -j DROP
iptables -I INPUT 1 -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT

while ip6tables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null; do :; done
while ip6tables -D INPUT -p tcp --dport 2222 -j DROP 2>/dev/null; do :; done
ip6tables -I INPUT 1 -p tcp --dport 2222 -j DROP

# WG UDP over IPv6 — only from front v6
while ip6tables -D INPUT -p udp --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while ip6tables -D INPUT -p udp -s "$FRONT_V6" --dport "$WG_PORT" -j ACCEPT 2>/dev/null; do :; done
while ip6tables -D INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null; do :; done
ip6tables -I INPUT 1 -p udp --dport "$WG_PORT" -j DROP
ip6tables -I INPUT 1 -p udp -s "$FRONT_V6" --dport "$WG_PORT" -j ACCEPT
# block WG on v4 entirely (we use v6 only)
iptables -C INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null || iptables -I INPUT 1 -p udp --dport "$WG_PORT" -j DROP

for IF in eth0 eth1 ens3 ens18; do
  ip link show "$IF" >/dev/null 2>&1 || continue
  for PROTO_PORT in tcp:80 tcp:443 udp:443 tcp:8443 tcp:8446 tcp:8447 tcp:47137 tcp:47764 tcp:10837; do
    proto=${PROTO_PORT%%:*}; port=${PROTO_PORT##*:}
    iptables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null       || iptables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
    ip6tables -t raw -C PREROUTING -i "$IF" -p "$proto" --dport "$port" -j DROP 2>/dev/null       || ip6tables -t raw -I PREROUTING 1 -i "$IF" -p "$proto" --dport "$port" -j DROP
  done
  for port in 80 443 8443 8446 8447 47137 47764 10837; do
    iptables -C INPUT -i "$IF" -p tcp --dport "$port" -j DROP 2>/dev/null       || iptables -A INPUT -i "$IF" -p tcp --dport "$port" -j DROP
    ip6tables -C INPUT -i "$IF" -p tcp --dport "$port" -j DROP 2>/dev/null       || ip6tables -A INPUT -i "$IF" -p tcp --dport "$port" -j DROP
  done
done

iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -t mangle -C OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || iptables -t mangle -A OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
ip6tables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || ip6tables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
ip6tables -t mangle -C OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || ip6tables -t mangle -A OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

echo "krab-exit-fw applied"
