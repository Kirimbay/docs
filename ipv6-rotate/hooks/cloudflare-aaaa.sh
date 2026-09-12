#!/usr/bin/env bash
# Optional hook: update a dedicated AAAA record after rotation.
# Does not change Hiddify panel domain — only the hostname you set here.
#
# Usage:
#   chmod +x /etc/ipv6-rotate/hooks/cloudflare-aaaa.sh
#   POST_ROTATE_HOOK=/etc/ipv6-rotate/hooks/cloudflare-aaaa.sh
#
# Required env (put in /etc/ipv6-rotate/hooks/cloudflare.env and source it):
#   CF_API_TOKEN
#   CF_ZONE_ID
#   CF_RECORD_NAME   e.g. v6.example.com
set -euo pipefail

NEW_IP="${1:-}"
[[ -n "$NEW_IP" ]] || exit 0

ENV_FILE="/etc/ipv6-rotate/hooks/cloudflare.env"
if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${CF_ZONE_ID:?CF_ZONE_ID is required}"
: "${CF_RECORD_NAME:?CF_RECORD_NAME is required}"

CF_TTL="${CF_TTL:-120}"
AUTH_HEADER="Authorization: Bearer ${CF_API_TOKEN}"

RECORD_ID="$(
  curl -fsS -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records?type=AAAA&name=${CF_RECORD_NAME}" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); recs=d.get('result') or []; print(recs[0]['id'] if recs else '')"
)"

PAYLOAD="$(python3 - "$CF_RECORD_NAME" "$NEW_IP" "$CF_TTL" <<'PY'
import json, sys
print(json.dumps({
    "type": "AAAA",
    "name": sys.argv[1],
    "content": sys.argv[2],
    "ttl": int(sys.argv[3]),
    "proxied": False,
}))
PY
)"

if [[ -n "$RECORD_ID" ]]; then
  curl -fsS -X PUT -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    --data "$PAYLOAD" \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records/${RECORD_ID}" \
    >/dev/null
else
  curl -fsS -X POST -H "$AUTH_HEADER" -H "Content-Type: application/json" \
    --data "$PAYLOAD" \
    "https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records" \
    >/dev/null
fi

echo "Cloudflare AAAA ${CF_RECORD_NAME} -> ${NEW_IP}"
