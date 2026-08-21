#!/usr/bin/env bash
# Add this agent's temporary SSH public key for deploy access.
# Run ON THE SERVER as root (console / existing SSH session):
#
#   bash anon-chat/deploy/authorize-agent.sh
#
set -euo pipefail
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHHIISfb1+e+RDrSXded6p+sf+oHU+a9/PSaBJHgF4nr cursor-people-frame-20260821'
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || echo "$PUB" >> /root/.ssh/authorized_keys
echo "OK: cursor-people-frame-20260821 authorized"
