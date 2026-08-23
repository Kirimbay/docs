#!/usr/bin/env bash
# 1.6.3 must keep inbound VPN replies and IPv6 NDP; 1.6.2 dropped them.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/hiddify-block-torrents.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

grep -qE 'VERSION="1\.(6\.[345]|7\.[0-9]+)"' "$SCRIPT" || fail "version"
if grep -qE 'chain fwd \{' "$SCRIPT"; then
  fail "nft chain name 'fwd' is reserved — inspect_web never loads"
fi
grep -qE 'chain fw \{' "$SCRIPT" || fail "forward chain must be named fw"
grep -q 'inbound_test_setup' "$SCRIPT" || fail "inbound veth setup missing"
grep -q 'inbound_baseline' "$SCRIPT" || fail "must baseline inbound test before applying rules"
grep -q 'iifname' "$SCRIPT" || fail "inbound test must punch INPUT for the veth"
grep -q 'persist_live_firewall' "$SCRIPT" || fail "must persist only after selftest / on uninstall"

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
grep -q 'udp53_ok' "$SCRIPT" || fail "must not install NEW DROP if UDP/53 allow failed"
if grep -q 'multiport --dports "${HOST_UDP_PORTS}"' "$SCRIPT"; then
  fail "UDP allowlist must not depend on xt_multiport"
fi
if grep -qE 'HIDDIFY_NOTORRENT -j DROP \|\| true' "$SCRIPT"; then
  fail "iptables still has catch-all DROP (kills UNTRACKED SYN-ACK)"
fi
if awk '/^emit_nft_table/,/^}$/' "$SCRIPT" | grep -q 'tcp flags ack accept'; then
  fail "inspect_web tcp flags ack accept lets torrent PSH+ACK through"
fi
grep -q 'ExecStartPost=-' "$SCRIPT" || fail "must re-apply firewall after hiddify-xray start"
# firewall must come after restart_proxy_cores in cmd_install
install_order="$(awk '/^cmd_install\(\)/,/^cmd_status\(\)/' "$SCRIPT" | grep -nE 'restart_proxy_cores|apply_firewall')"
echo "${install_order}" | tr '\n' ' ' | grep -q 'restart_proxy_cores.*apply_firewall' || fail "install must apply firewall AFTER hiddify restart"

echo "test-1.6.3-vpn-safe: ok"
