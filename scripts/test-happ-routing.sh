#!/usr/bin/env bash
# Happ routing URI + Hiddify user.py insert.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/scripts/hiddify-block-torrents.sh"

fail() { echo "FAIL: $*" >&2; exit 1; }

grep -q 'VERSION="1.6.6"' "$SCRIPT" || fail "version"
grep -q 'happ://routing/onadd/' "$SCRIPT" || fail "happ onadd"
grep -q 'patch_happ_subscription' "$SCRIPT" || fail "patch_happ_subscription"

uri="$(SKIP_ROOT=1 SKIP_FIREWALL=1 SKIP_SYSTEMD=1 bash "$SCRIPT" happ-uri)"
[[ "${uri}" == happ://routing/onadd/* ]] || fail "uri prefix: ${uri}"
b64="${uri#happ://routing/onadd/}"
python3 - "${b64}" <<'PY'
import base64, json, sys
p = json.loads(base64.b64decode(sys.argv[1]))
assert p["Name"] == "hiddify-notorrent"
assert p["GlobalProxy"] in ("true", True)
assert "opentrackr.org" in p["BlockSites"], p["BlockSites"][:5]
print("happ json ok", len(p["BlockSites"]), "sites")
PY

TEST="$(mktemp -d)"
trap 'rm -rf "$TEST"' EXIT
mkdir -p "$TEST/hiddifypanel/panel/user" "$TEST/inst/backups"
cat > "$TEST/hiddifypanel/panel/user/user.py" <<'PY'
def links_imp(self, base64=False):
    mode = "new"
    c = get_common_data(g.account.uuid, mode)
    if request.method == "HEAD":
        resp = ""
    else:
        resp = self._render_core_config("sublink", c, pretty=False)

        if base64:
            resp = hutils.encode.do_base_64(resp)
    return add_headers(resp, c)

def add_headers(res, c, mimetype="text/plain"):
    resp = Response(res)
    resp.headers["profile-title"] = "base64:" + title

    return resp
PY

HIDDIFY_DIR="$TEST" NOTORRENT_INSTALL_DIR="$TEST/inst" \
  SKIP_ROOT=1 SKIP_FIREWALL=1 SKIP_SYSTEMD=1 \
  bash "$SCRIPT" happ-patch

grep -q 'HIDDIFY_NOTORRENT_HAPP' "$TEST/hiddifypanel/panel/user/user.py" || fail "marker not in user.py"
grep -q 'resp.headers\["routing"\] = "happ://routing/onadd/' "$TEST/hiddifypanel/panel/user/user.py" || fail "header missing"
grep -q '_happ = "happ://routing/onadd/' "$TEST/hiddifypanel/panel/user/user.py" || fail "body prepend missing"

# idempotent
HIDDIFY_DIR="$TEST" NOTORRENT_INSTALL_DIR="$TEST/inst" \
  SKIP_ROOT=1 SKIP_FIREWALL=1 SKIP_SYSTEMD=1 \
  bash "$SCRIPT" happ-patch
test "$(grep -c HIDDIFY_NOTORRENT_HAPP "$TEST/hiddifypanel/panel/user/user.py")" -eq 2

echo "test-happ-routing: ok"
