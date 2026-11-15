#!/bin/bash
set -euo pipefail
EXIT_WG="10.77.37.2"
EXIT_V6="2a13:7c82:116:7a::"
PORT="443"
FRONT_IP="144.31.13.79"
WG_PORT="51837"
STATE_DIR="/var/lib/krab-dnat"
FORWARD_STATE="$STATE_DIR/ip_forward.prev"

mkdir -p "$STATE_DIR"
if [[ ! -f "$FORWARD_STATE" ]]; then
  sysctl -n net.ipv4.ip_forward >"$FORWARD_STATE" || echo 0 >"$FORWARD_STATE"
fi
sysctl -w net.ipv4.ip_forward=1 >/dev/null
mkdir -p /etc/sysctl.d
echo 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-krab-forward.conf

iptables -t nat -C PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT" 2>/dev/null   || iptables -t nat -A PREROUTING -p tcp -d "$FRONT_IP" --dport "$PORT" -j DNAT --to-destination "$EXIT_WG:$PORT"
iptables -t nat -C POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j MASQUERADE 2>/dev/null   || iptables -t nat -A POSTROUTING -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j MASQUERADE
iptables -C FORWARD -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null   || iptables -I FORWARD 1 -d "$EXIT_WG/32" -m conntrack --ctstate DNAT -j ACCEPT
iptables -C FORWARD -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null   || iptables -I FORWARD 2 -s "$EXIT_WG/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT
iptables -C INPUT -i wg-krab -p tcp --dport 8446 -j ACCEPT 2>/dev/null   || iptables -I INPUT 1 -i wg-krab -p tcp --dport 8446 -j ACCEPT
# allow WG UDP from exit over IPv6
ip6tables -C INPUT -p udp -s "$EXIT_V6" --dport "$WG_PORT" -j ACCEPT 2>/dev/null   || ip6tables -I INPUT 1 -p udp -s "$EXIT_V6" --dport "$WG_PORT" -j ACCEPT
ip6tables -C INPUT -p ipv6-icmp -j ACCEPT 2>/dev/null || ip6tables -I INPUT 1 -p ipv6-icmp -j ACCEPT

iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
iptables -t mangle -C OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null   || iptables -t mangle -A OUTPUT -o wg-krab -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

echo "krab-dnat applied"
