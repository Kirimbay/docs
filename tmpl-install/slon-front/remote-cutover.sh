#!/bin/bash
# Apply Слон transparent DNAT from the agent VM over SSH.
#
# Requires one of:
#   HANDOFF_SSH_PRIVATE_KEY_FILE=/path/to/id_ed25519
#   HANDOFF_SSH_PRIVATE_KEY='-----BEGIN OPENSSH PRIVATE KEY-----...'
#
#   bash remote-cutover.sh
#   bash remote-cutover.sh --rollback
set -euo pipefail

FRONT="${FRONT:-136.148.213.105}"
EXIT_PUB="${EXIT_PUB:-143.14.50.32}"
EXIT_LAN="${EXIT_LAN:-10.202.120.54}"
FRONT_LAN="${FRONT_LAN:-10.202.120.2}"
ROOT=$(cd "$(dirname "$0")" && pwd)
MODE=apply
[ "${1:-}" = "--rollback" ] || [ "${1:-}" = "-r" ] && MODE=rollback

KEY_FILE=
cleanup(){ [ -n "${KEY_FILE:-}" ] && [ -f "${KEY_FILE}.generated" ] && rm -f "$KEY_FILE" "${KEY_FILE}.generated"; }
trap cleanup EXIT

if [ -n "${HANDOFF_SSH_PRIVATE_KEY_FILE:-}" ]; then
  KEY_FILE=$HANDOFF_SSH_PRIVATE_KEY_FILE
elif [ -n "${HANDOFF_SSH_PRIVATE_KEY:-}" ]; then
  KEY_FILE=$(mktemp)
  touch "${KEY_FILE}.generated"
  printf '%s\n' "$HANDOFF_SSH_PRIVATE_KEY" >"$KEY_FILE"
  # fix missing trailing newline / literal \n from secret stores
  if grep -q '\\n' "$KEY_FILE"; then
    python3 -c 'import pathlib;p=pathlib.Path("'"$KEY_FILE"'");p.write_text(p.read_text().replace("\\n","\n"))'
  fi
  chmod 600 "$KEY_FILE"
elif [ -f /tmp/handoff/handoff-cursor/secrets/ssh/id_ed25519 ]; then
  KEY_FILE=/tmp/handoff/handoff-cursor/secrets/ssh/id_ed25519
else
  echo "Need HANDOFF_SSH_PRIVATE_KEY or HANDOFF_SSH_PRIVATE_KEY_FILE" >&2
  exit 2
fi

SSH=(ssh -i "$KEY_FILE" -o IdentitiesOnly=yes -o BatchMode=yes
     -o StrictHostKeyChecking=accept-new -o ConnectTimeout=12
     -o UserKnownHostsFile=/tmp/slon-front-known-hosts)

log(){ printf '[remote-cutover] %s\n' "$*"; }

log "preflight front $FRONT"
"${SSH[@]}" "root@$FRONT" "hostname; ip -4 addr show eth1 | head -5; ping -c1 -W2 $EXIT_LAN"

log "preflight exit $EXIT_PUB (LAN $EXIT_LAN)"
"${SSH[@]}" "root@$EXIT_PUB" "hostname; ip -4 addr show eth1 | head -5; ping -c1 -W2 $FRONT_LAN; ss -lnt | awk '/:443 /' || true"

if [ "$MODE" = rollback ]; then
  log "rollback on front"
  scp -i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile=/tmp/slon-front-known-hosts \
    "$ROOT/apply-tcp-dnat.sh" "root@$FRONT:/tmp/apply-tcp-dnat.sh"
  "${SSH[@]}" "root@$FRONT" "bash /tmp/apply-tcp-dnat.sh --rollback"
else
  log "apply DNAT cutover on front"
  scp -i "$KEY_FILE" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile=/tmp/slon-front-known-hosts \
    "$ROOT/apply-tcp-dnat.sh" "root@$FRONT:/tmp/apply-tcp-dnat.sh"
  "${SSH[@]}" "root@$FRONT" "bash /tmp/apply-tcp-dnat.sh"
fi

log "post-check front nat + haproxy bind"
"${SSH[@]}" "root@$FRONT" '
  iptables -t nat -S | grep -E "136.148.213.105|10.202.120.54" || true
  ss -lntp | grep -E ":443\b" || echo "no local :443 listener"
  systemctl is-active slon-dnat.service 2>/dev/null || true
  grep -nE "^(frontend|backend) " /etc/haproxy/haproxy.cfg | head -40 || true
'

log "done ($MODE)"
