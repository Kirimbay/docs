#!/bin/bash
set -euo pipefail
IF=wg-krab
MAX_AGE=120
HARD_AGE=180
FRONT_PUB="N+De3NjW8AUCinIyFzvm9HpiICfQss5TOAcGXEILUj0="
EXIT_PUB="jIEH1ZZPge4nQLwZFJenX8pQkChiEDSwg+ayMxvM7jQ="
FRONT_V6="2a12:bec4:1ac0:116d::1"
EXIT_V6="2a13:7c82:116:7a::"
WG_PORT="51837"

detect_role() {
  if [[ -n "${ROLE:-}" ]]; then echo "$ROLE"; return; fi
  local addr
  addr=$(ip -4 -o addr show dev "$IF" 2>/dev/null | awk '{print $4}' | head -1 || true)
  case "$addr" in
    10.77.37.1/*) echo front ;;
    10.77.37.2/*) echo exit ;;
    *)
      # interface missing — try bring-up via known hooks later; default by hostname files
      if [[ -x /usr/local/sbin/krab-dnat.sh ]]; then echo front
      elif [[ -x /usr/local/sbin/krab-exit-fw.sh ]]; then echo exit
      else echo "krab-wg-watchdog: cannot detect role" >&2; exit 1
      fi ;;
  esac
}

ROLE="$(detect_role)"
if [[ "$ROLE" == "front" ]]; then
  PEER_PUB="$EXIT_PUB"; ENDPOINT="[${EXIT_V6}]:${WG_PORT}"; PEER_IP=10.77.37.2
  RECOVERY_HOOK=/usr/local/sbin/krab-dnat.sh
else
  PEER_PUB="$FRONT_PUB"; ENDPOINT="[${FRONT_V6}]:${WG_PORT}"; PEER_IP=10.77.37.1
  RECOVERY_HOOK=/usr/local/sbin/krab-exit-fw.sh
fi

if ! ip link show "$IF" >/dev/null 2>&1; then
  logger -t krab-wg-watchdog "interface missing, wg-quick up role=$ROLE"
  wg-quick up "$IF" || true
  [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  exit 0
fi

hs=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
now=$(date +%s); age=9999
[[ -n "${hs:-}" && "$hs" != "0" ]] && age=$((now - hs))
wg set "$IF" peer "$PEER_PUB" endpoint "$ENDPOINT" persistent-keepalive 15

if [[ "$age" -gt "$MAX_AGE" ]]; then
  logger -t krab-wg-watchdog "stale age=${age}s role=$ROLE — poke"
  ping -c2 -W1 "$PEER_IP" >/dev/null 2>&1 || true
fi
if [[ "$age" -gt "$HARD_AGE" ]]; then
  hs2=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
  now2=$(date +%s); age2=9999
  [[ -n "${hs2:-}" && "$hs2" != "0" ]] && age2=$((now2 - hs2))
  if [[ "$age2" -gt "$HARD_AGE" ]]; then
    logger -t krab-wg-watchdog "hard bounce age2=${age2}s role=$ROLE"
    wg-quick down "$IF" || true
    wg-quick up "$IF"
    [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  fi
fi
