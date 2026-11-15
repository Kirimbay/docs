#!/bin/bash
# Keep wg-tiger endpoint pinned; poke/bounce only when handshake is truly stale.
# Role is auto-detected from the local WG address (10.77.14.1=front, .2=exit).
# Override with ROLE=front|exit if needed.
set -euo pipefail

IF=wg-tiger
MAX_AGE="${MAX_AGE:-120}"
HARD_AGE="${HARD_AGE:-180}"

detect_role() {
  if [[ -n "${ROLE:-}" ]]; then
    echo "$ROLE"
    return
  fi
  local addr
  addr=$(ip -4 -o addr show dev "$IF" 2>/dev/null | awk '{print $4}' | head -1 || true)
  case "$addr" in
    10.77.14.1/*) echo front ;;
    10.77.14.2/*) echo exit ;;
    *)
      echo "tiger-wg-watchdog: cannot detect role from $IF addr='$addr'; set ROLE=front|exit" >&2
      exit 1
      ;;
  esac
}

ROLE="$(detect_role)"

if [[ "$ROLE" == "front" ]]; then
  PEER_PUB="${PEER_PUB:-kIPZFpFf1JLEqM1LIAnkmjLLPp55iLacM/2gCAHPpwQ=}"
  ENDPOINT="${ENDPOINT:-136.148.220.250:51814}"
  PEER_IP="${PEER_IP:-10.77.14.2}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/tiger-dnat.sh}"
else
  PEER_PUB="${PEER_PUB:-1eDNFXNTi+UG2FgoeBUksp8iKkQcoEu5zZy8Wz0yGDo=}"
  ENDPOINT="${ENDPOINT:-48.103.140.6:51814}"
  PEER_IP="${PEER_IP:-10.77.14.1}"
  RECOVERY_HOOK="${RECOVERY_HOOK:-/usr/local/sbin/tiger-exit-fw.sh}"
fi

if ! ip link show "$IF" >/dev/null 2>&1; then
  logger -t tiger-wg-watchdog "interface missing, wg-quick up (role=$ROLE)"
  wg-quick up "$IF" || true
  [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  exit 0
fi

hs=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
now=$(date +%s)
age=9999
if [[ -n "${hs:-}" && "$hs" != "0" ]]; then
  age=$((now - hs))
fi

wg set "$IF" peer "$PEER_PUB" endpoint "$ENDPOINT" persistent-keepalive 15

if [[ "$age" -gt "$MAX_AGE" ]]; then
  logger -t tiger-wg-watchdog "stale handshake age=${age}s role=$ROLE — poke"
  ping -c2 -W1 "$PEER_IP" >/dev/null 2>&1 || true
fi

if [[ "$age" -gt "$HARD_AGE" ]]; then
  hs2=$(wg show "$IF" latest-handshakes 2>/dev/null | awk -v p="$PEER_PUB" '$1==p {print $2}')
  now2=$(date +%s)
  age2=9999
  [[ -n "${hs2:-}" && "$hs2" != "0" ]] && age2=$((now2 - hs2))
  if [[ "$age2" -gt "$HARD_AGE" ]]; then
    logger -t tiger-wg-watchdog "hard bounce wg-quick age2=${age2}s role=$ROLE"
    wg-quick down "$IF" || true
    wg-quick up "$IF"
    [[ -x "$RECOVERY_HOOK" ]] && "$RECOVERY_HOOK" || true
  fi
fi
