#!/bin/bash
set -euo pipefail
IF=wg-slon
MAX_AGE="${MAX_AGE:-120}"
HARD_AGE="${HARD_AGE:-180}"
FRONT_IP="${FRONT_IP:-136.148.213.105}"
EXIT_WG="${EXIT_WG:-10.77.58.2}"
PANEL_IP="${PANEL_IP:-136.148.212.221}"
WG_PORT="${WG_PORT:-51858}"
EXIT_PUBLIC_IP="${EXIT_PUBLIC_IP:-136.148.223.200}"

detect_role() {
  if [[ -n "${ROLE:-}" ]]; then echo "$ROLE"; return; fi
  local addr; addr=$(ip -4 -o addr show dev "$IF" 2>/dev/null | awk '{print $4}' | head -1 || true)
  case "$addr" in
    10.77.58.1/*) echo front ;;
    10.77.58.2/*) echo exit ;;
    *)
      if [[ -x /usr/local/sbin/slon-dnat.sh ]]; then echo front
      elif [[ -x /usr/local/sbin/slon-exit-fw.sh ]]; then echo exit
      else echo "slon-wg-watchdog: cannot detect role" >&2; exit 1; fi
      ;;
  esac
}
ROLE="$(detect_role)"
if [[ "$ROLE" == "front" ]]; then
  PEER_PUB="${PEER_PUB:-ndTzDKg5q9Nx0MntlfjeDS/uwIldsmrBqpytwQKEcGw=}"
  ENDPOINT="${ENDPOINT:-136.148.223.200:51858}"
  PEER_IP="${PEER_IP:-10.77.58.2}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/slon-dnat.sh}"
else
  PEER_PUB="${PEER_PUB:-JSy5thgBWAfJFB1V7l7+/pd5PaNkb1gdpyPHrwUNejw=}"
  ENDPOINT="${ENDPOINT:-136.148.213.105:51858}"
  PEER_IP="${PEER_IP:-10.77.58.1}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/slon-exit-fw.sh}"
fi
if ! ip link show "$IF" >/dev/null 2>&1; then
  logger -t slon-wg-watchdog "interface missing, wg-quick up role=$ROLE"
  wg-quick up "$IF" || true
  [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  exit 0
fi

# Recover only when canaries fail — never flap healthy rules every 20s.
need_hook=0
if [[ "$ROLE" == "front" ]]; then
  iptables -t nat -C PREROUTING -p tcp -d "$FRONT_IP" --dport 443 \
    -j DNAT --to-destination "${EXIT_WG}:443" 2>/dev/null || need_hook=1
  iptables -t nat -C PREROUTING -p udp -d "$FRONT_IP" --dport 443 \
    -j DNAT --to-destination "${EXIT_WG}:443" 2>/dev/null || need_hook=1
  iptables -t nat -C POSTROUTING -d "${EXIT_WG}/32" -m conntrack --ctstate DNAT \
    -j MASQUERADE 2>/dev/null || need_hook=1
  iptables -C FORWARD -d "${EXIT_WG}/32" -m conntrack --ctstate DNAT -j ACCEPT 2>/dev/null || need_hook=1
  iptables -C FORWARD -s "${EXIT_WG}/32" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || need_hook=1
  iptables -C INPUT -i wg-slon -p tcp --dport 8446 -j ACCEPT 2>/dev/null || need_hook=1
else
  iptables -C INPUT -p tcp -s "$PANEL_IP" --dport 2222 -j ACCEPT 2>/dev/null || need_hook=1
  iptables -C INPUT -p tcp --dport 2222 -j DROP 2>/dev/null || need_hook=1
  iptables -C INPUT -p udp -s "$FRONT_IP" --dport "$WG_PORT" -j ACCEPT 2>/dev/null || need_hook=1
  iptables -C INPUT -p udp --dport "$WG_PORT" -j DROP 2>/dev/null || need_hook=1
  ip6tables -C INPUT -p tcp --dport 2222 -j DROP 2>/dev/null || need_hook=1
  # Panel/WG pins must sit above broad lo/wg ACCEPT.
  rules=$(iptables -S INPUT)
  pos_drop=$(printf '%s\n' "$rules" | grep -n -- '--dport 2222 -j DROP' | head -1 | cut -d: -f1 || true)
  pos_broad=$(printf '%s\n' "$rules" | grep -nE -- '-i (lo|wg-slon) -j ACCEPT' | head -1 | cut -d: -f1 || true)
  if [[ -z "${pos_drop:-}" || ( -n "${pos_broad:-}" && "$pos_drop" -gt "$pos_broad" ) ]]; then
    need_hook=1
  fi
  rules6=$(ip6tables -S INPUT)
  pos_drop6=$(printf '%s\n' "$rules6" | grep -n -- '--dport 2222 -j DROP' | head -1 | cut -d: -f1 || true)
  pos_broad6=$(printf '%s\n' "$rules6" | grep -nE -- '-i (lo|wg-slon) -j ACCEPT' | head -1 | cut -d: -f1 || true)
  if [[ -z "${pos_drop6:-}" || ( -n "${pos_broad6:-}" && "$pos_drop6" -gt "$pos_broad6" ) ]]; then
    need_hook=1
  fi
fi
if [[ "$need_hook" -eq 1 && -x "$RECOVERY_HOOK" ]]; then
  logger -t slon-wg-watchdog "critical rules missing/misordered role=$ROLE — recover"
  "$RECOVERY_HOOK" || true
fi

hs=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
now=$(date +%s); age=9999
[[ -n "${hs:-}" && "$hs" != "0" ]] && age=$((now - hs))
wg set "$IF" peer "$PEER_PUB" endpoint "$ENDPOINT" persistent-keepalive 15
if [[ "$age" -gt "$MAX_AGE" ]]; then
  logger -t slon-wg-watchdog "stale age=${age}s role=$ROLE — poke"
  ping -c2 -W1 "$PEER_IP" >/dev/null 2>&1 || true
fi
if [[ "$age" -gt "$HARD_AGE" ]]; then
  hs2=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
  now2=$(date +%s); age2=9999
  [[ -n "${hs2:-}" && "$hs2" != "0" ]] && age2=$((now2 - hs2))
  if [[ "$age2" -gt "$HARD_AGE" ]]; then
    logger -t slon-wg-watchdog "hard bounce age2=${age2}s role=$ROLE"
    wg-quick down "$IF" || true
    wg-quick up "$IF"
    [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  fi
fi
