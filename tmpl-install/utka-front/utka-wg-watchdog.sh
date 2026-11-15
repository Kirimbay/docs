#!/bin/bash
set -euo pipefail
IF=wg-utka
MAX_AGE="${MAX_AGE:-120}"
HARD_AGE="${HARD_AGE:-180}"
detect_role() {
  if [[ -n "${ROLE:-}" ]]; then echo "$ROLE"; return; fi
  local addr; addr=$(ip -4 -o addr show dev "$IF" 2>/dev/null | awk '{print $4}' | head -1 || true)
  case "$addr" in
    10.77.57.1/*) echo front ;;
    10.77.57.2/*) echo exit ;;
    *)
      if [[ -x /usr/local/sbin/utka-dnat.sh ]]; then echo front
      elif [[ -x /usr/local/sbin/utka-exit-fw.sh ]]; then echo exit
      else echo "utka-wg-watchdog: cannot detect role" >&2; exit 1; fi
      ;;
  esac
}
ROLE="$(detect_role)"
if [[ "$ROLE" == "front" ]]; then
  PEER_PUB="${PEER_PUB:-sdGgS/izvq7ZG0IML10UPC+J+XpWMaQd4qcutbgJJmY=}"
  ENDPOINT="${ENDPOINT:-185.113.11.79:51857}"
  PEER_IP="${PEER_IP:-10.77.57.2}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/utka-dnat.sh}"
else
  PEER_PUB="${PEER_PUB:-4IcZ3g59riO+wb2x0alRp+gF1L5igvAH7OdKOFnwvkA=}"
  ENDPOINT="${ENDPOINT:-185.113.11.52:51857}"
  PEER_IP="${PEER_IP:-10.77.57.1}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/utka-exit-fw.sh}"
fi
if ! ip link show "$IF" >/dev/null 2>&1; then
  logger -t utka-wg-watchdog "interface missing, wg-quick up role=$ROLE"
  wg-quick up "$IF" || true
  [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  exit 0
fi

# Re-apply DNAT/lockdown only if critical rules are missing — never flap
# delete/reinsert every 20s (that briefly blackholes panel/WG).
FRONT_IP="${FRONT_IP:-185.113.11.52}"
PANEL_IP="${PANEL_IP:-136.148.212.221}"
WG_PORT="${WG_PORT:-51857}"
need_hook=0
if [[ "$ROLE" == "front" ]]; then
  iptables -t nat -C PREROUTING -p tcp -d "$FRONT_IP" --dport 443 \
    -j DNAT --to-destination 10.77.57.2:443 2>/dev/null || need_hook=1
else
  iptables -C INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null || need_hook=1
  iptables -C INPUT -p tcp --dport 2222 -j DROP 2>/dev/null || need_hook=1
  iptables -C INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null || need_hook=1
fi
if [[ "$need_hook" -eq 1 && -x "$RECOVERY_HOOK" ]]; then
  logger -t utka-wg-watchdog "critical rules missing role=$ROLE — recover"
  "$RECOVERY_HOOK" || true
fi

hs=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
now=$(date +%s); age=9999
[[ -n "${hs:-}" && "$hs" != "0" ]] && age=$((now - hs))
wg set "$IF" peer "$PEER_PUB" endpoint "$ENDPOINT" persistent-keepalive 15
if [[ "$age" -gt "$MAX_AGE" ]]; then
  logger -t utka-wg-watchdog "stale age=${age}s role=$ROLE — poke"
  ping -c2 -W1 "$PEER_IP" >/dev/null 2>&1 || true
fi
if [[ "$age" -gt "$HARD_AGE" ]]; then
  hs2=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
  now2=$(date +%s); age2=9999
  [[ -n "${hs2:-}" && "$hs2" != "0" ]] && age2=$((now2 - hs2))
  if [[ "$age2" -gt "$HARD_AGE" ]]; then
    logger -t utka-wg-watchdog "hard bounce age2=${age2}s role=$ROLE"
    wg-quick down "$IF" || true
    wg-quick up "$IF"
    [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  fi
fi

