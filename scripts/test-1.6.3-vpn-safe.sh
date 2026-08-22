#!/usr/bin/env bash
# 1.6.3 must keep inbound VPN replies and IPv6 NDP; 1.6.2 dropped them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/hiddify-block-torrents.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

grep -q 'VERSION="1.6.3"' "$SCRIPT" || fail "version"

# nft: after conntrack, never drop leftovers / untracked
grep -q 'priority 10' "$SCRIPT" || fail "nft priority must be after conntrack (not -150)"
if grep -nE 'leftover / untracked' "$SCRIPT" | grep -q .; then
  fail "comment about leftover drop still present"
fi
if awk '/^emit_nft_table/,/^}$/' "$SCRIPT" | grep -qE '^\s+counter drop$'; then
  fail "nft still has leftover counter drop (kills SYN-ACK to clients)"
fi
grep -q 'ipv6-icmp' "$SCRIPT" || fail "need ipv6-icmp for NDP"
grep -q 'ipv6-icmp' "$SCRIPT" || fail "need ipv6-icmp"
grep -q 'tcp dport != { 80, 443 }' "$SCRIPT" || fail "nft must accept non-web established first"

# iptables: both established replies, NEW-only final drop
grep -q 'multiport ! --dports 80,443' "$SCRIPT" || fail "iptables must accept non-web established before L7"
grep -q '! -p tcp -j RETURN' "$SCRIPT" || fail "iptables must accept non-tcp established"
grep -q -- '--ctstate NEW -j DROP' "$SCRIPT" || fail "iptables final drop must be NEW only"
if grep -qE 'HIDDIFY_NOTORRENT -j DROP \|\| true' "$SCRIPT"; then
  fail "iptables still has catch-all DROP (kills UNTRACKED SYN-ACK)"
fi
if awk '/^emit_nft_table/,/^}$/' "$SCRIPT" | grep -q 'tcp flags ack accept'; then
  fail "inspect_web tcp flags ack accept lets torrent PSH+ACK through"
fi
grep -q 'cmd_recover' "$SCRIPT" || fail "recover command missing"

echo "test-1.6.3-vpn-safe: ok"
