#!/usr/bin/env bash
# Add this agent's temporary SSH public key for deploy access.
# Run ON THE SERVER as root (console / existing SSH session):
#
#   bash -c "$(curl -fsSL …)"   # or paste the block below
#
set -euo pipefail
PUB='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMZd6u1b1kzuJVb3lHzqsVW5RHsrrdsUdyKhdNTE3nyw cursor-temp-20260820-chat'
mkdir -p /root/.ssh
chmod 700 /root/.ssh
touch /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
grep -qxF "$PUB" /root/.ssh/authorized_keys || echo "$PUB" >> /root/.ssh/authorized_keys
echo "OK: cursor-temp-20260820-chat authorized"
