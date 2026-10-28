#!/bin/bash
# Apply standard TMPL relay DNAT on this host (or document multi-IP pattern).
# Usage (on relay):
#   bash apply_relay_dnat.sh --exit EXIT_IP
#   bash apply_relay_dnat.sh --exit EXIT_IP --via-ip FRONT_IP
#     → IP-specific DNAT like karaforum17 (one host, many exits)
set -euo pipefail
EXIT=""; VIA=""; KEEP=22
while [ $# -gt 0 ]; do
  case $1 in
    --exit) EXIT=$2; shift 2;;
    --via-ip) VIA=$2; shift 2;;
    --keep) KEEP=$2; shift 2;;
    -h|--help) sed -n '2,7p' "$0"; exit 0;;
    *) echo "unknown $1"; exit 2;;
  esac
done
[[ $EXIT =~ ^[0-9.]+$ ]] || { echo "need --exit"; exit 2; }

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
RELAY_SH="$ROOT/relay.sh"
[ -f "$RELAY_SH" ] || RELAY_SH="$(cd "$(dirname "$0")/../../.." && pwd)/tmpl-install/relay.sh"

if [ -z "$VIA" ]; then
  # single-exit host: use stock relay.sh
  bash "$RELAY_SH" --exit "$EXIT" --keep "$KEEP"
  # MSS clamp
  iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
    || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu
  echo "single-IP relay → $EXIT"
  exit 0
fi

# multi-IP: destination-IP DNAT (do not flush other exits)
[[ $VIA =~ ^[0-9.]+$ ]] || { echo "bad --via-ip"; exit 2; }
ip -4 addr | grep -q "inet $VIA/" || echo "WARNING: $VIA not on local interfaces yet"

# ensure UDP443 reject
iptables -C INPUT -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable 2>/dev/null \
  || iptables -I INPUT 1 -p udp --dport 443 -j REJECT --reject-with icmp-port-unreachable

# remove previous rules for this VIA only (best-effort)
while iptables -t nat -D PREROUTING -d "$VIA/32" -p tcp -j DNAT --to-destination "$EXIT" 2>/dev/null; do :; done
while iptables -t nat -D PREROUTING -d "$VIA/32" -p udp -j DNAT --to-destination "$EXIT" 2>/dev/null; do :; done

iptables -t nat -I PREROUTING 1 -d "$VIA/32" -p udp --dport 443 -j RETURN
iptables -t nat -I PREROUTING 2 -d "$VIA/32" -p tcp --dport 22 -j RETURN
iptables -t nat -A PREROUTING -d "$VIA/32" -p tcp -j DNAT --to-destination "$EXIT"
iptables -t nat -A PREROUTING -d "$VIA/32" -p udp -j DNAT --to-destination "$EXIT"

iptables -t nat -C POSTROUTING -d "$EXIT/32" -m conntrack --ctstate DNAT -j MASQUERADE 2>/dev/null \
  || iptables -t nat -A POSTROUTING -d "$EXIT/32" -m conntrack --ctstate DNAT -j MASQUERADE

iptables -C FORWARD -d "$EXIT/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -d "$EXIT/32" -m conntrack --ctstate DNAT -j ACCEPT
iptables -C FORWARD -s "$EXIT/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
  || iptables -I FORWARD 1 -s "$EXIT/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT

sysctl -w net.ipv4.ip_forward=1 >/dev/null
iptables -t mangle -C FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu 2>/dev/null \
  || iptables -t mangle -A FORWARD -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --clamp-mss-to-pmtu

if command -v netfilter-persistent >/dev/null; then
  netfilter-persistent save >/dev/null 2>&1 || iptables-save > /etc/iptables/rules.v4
fi
echo "multi-IP: $VIA → $EXIT (SSH/udp443 local)"
