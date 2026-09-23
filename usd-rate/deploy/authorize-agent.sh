#!/usr/bin/env bash
# Run ON THE SERVER as root (paste into hoster console or existing SSH):
set -euo pipefail
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINRNSqGqxlpcISxN7xXPe/arc10/z1mB8WmvrvCrpe2W cursor-usd-rate-20260914'
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || echo "$PUB" >> /root/.ssh/authorized_keys
echo "OK: cursor agent authorized for usd-rate deploy"
