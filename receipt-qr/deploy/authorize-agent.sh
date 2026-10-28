#!/usr/bin/env bash
# Run ON THE SERVER as root:
set -euo pipefail
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAID0vt5W8jZBaFE6ge1kvCcK2dJjI2/r8bZW5IXO6y/gD cursor-kvitqr-20260911'
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || echo "$PUB" >> /root/.ssh/authorized_keys
echo "OK: cursor-kvitqr agent authorized"
