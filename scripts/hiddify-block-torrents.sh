#!/usr/bin/env bash
# Hiddify: block BitTorrent for VPN users, keep the rest of the proxy working.
#
# One-shot (as root, on the Hiddify server):
#   rm -f /tmp/hiddify-block-torrents.sh
#   curl -fsSL -H 'Cache-Control: no-cache' \
#     "https://raw.githubusercontent.com/Kirimbay/docs/cursor/hiddify-block-torrents-0aec/scripts/hiddify-block-torrents.sh?$(date +%s)" \
#     -o /tmp/hiddify-block-torrents.sh
#   grep -m1 '^VERSION=' /tmp/hiddify-block-torrents.sh   # must be 1.6.5+
#   sudo bash /tmp/hiddify-block-torrents.sh
#
# Later:
#   hiddify-block-torrents status
#   hiddify-block-torrents doctor
#   hiddify-block-torrents uninstall
#
# Why the hoster's iptables snippet is not enough:
#   * modern torrent clients use random ports, not 6881-6889
#   * Hiddify is a proxy: user traffic leaves via OUTPUT (xray/sing-box),
#     not FORWARD, so FORWARD-only rules never see it
#   * Hysteria2/TUIC/SSH go through sing-box, where the BT rule is commented out
set -euo pipefail

VERSION="1.6.5"
# 80/443 are NOT in the blanket allowlist: peers often listen there.
# Handshake SYN is allowed; first payload must be TLS (443) or HTTP (80).
WEB_TCP_PORTS="853,2052,2053,2082,2083,2086,2087,2095,2096,8080,8443,8880,5222,5228,465,587,993,995,3478"
WEB_UDP_PORTS="53,123,853,3478"
HOST_TCP_PORTS="22,${WEB_TCP_PORTS}"
HOST_UDP_PORTS="${WEB_UDP_PORTS},2408,500,4500"
HTTP_PORTS="80,443"
# Xray still routes 80/443 to freedom (sites). Kernel checks the first payload.
XRAY_TCP_PORTS="80,443,${WEB_TCP_PORTS}"
XRAY_UDP_PORTS="53,123,443,853,3478"
TORRENT_TAG="blocked_torrent"
INSTALL_DIR="${NOTORRENT_INSTALL_DIR:-/opt/hiddify-notorrent}"
SELF_PATH="${INSTALL_DIR}/hiddify-block-torrents.sh"
MARKER_BEGIN="HIDDIFY_NOTORRENT_BEGIN"
MARKER_END="HIDDIFY_NOTORRENT_END"

CMD="${1:-install}"

log()  { printf '[hiddify-notorrent] %s\n' "$*"; }
warn() { printf '[hiddify-notorrent] WARN: %s\n' "$*" >&2; }
die()  { printf '[hiddify-notorrent] ERROR: %s\n' "$*" >&2; exit 1; }

need_root() {
  [[ "${SKIP_ROOT:-0}" == "1" ]] && return 0
  [[ ${EUID:-$(id -u)} -eq 0 ]] || die "Run as root (sudo)."
}

detect_hiddify() {
  if [[ -n "${HIDDIFY_DIR:-}" && -d "${HIDDIFY_DIR}" ]]; then
    return 0
  fi
  local d
  for d in /opt/hiddify-manager /opt/hiddify-config; do
    if [[ -d "${d}/xray/configs" || -d "${d}/singbox/configs" ]]; then
      HIDDIFY_DIR="${d}"
      return 0
    fi
  done
  die "Hiddify Manager not found in /opt/hiddify-manager or /opt/hiddify-config"
}

save_self() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  mkdir -p "${INSTALL_DIR}/backups"
  local src="${BASH_SOURCE[0]:-}"
  if [[ -n "${src}" && -r "${src}" && "${src}" != "bash" ]]; then
    cat "${src}" > "${SELF_PATH}.tmp"
    mv -f "${SELF_PATH}.tmp" "${SELF_PATH}"
    chmod 755 "${SELF_PATH}"
    ln -sfn "${SELF_PATH}" /usr/local/sbin/hiddify-block-torrents
    [[ -s "${SELF_PATH}" ]] || die "Failed to install ${SELF_PATH}"
    return 0
  fi
  die "Could not copy installer onto disk (${src:-empty}). Save the script to a file and run: sudo bash hiddify-block-torrents.sh"
}

# Public trackers + DHT bootstraps. Domain suffix match (subdomains included).
# Intentionally NOT torrent index websites (thepiratebay, 1337x, ...) — only P2P infra.
TRACKER_DOMAINS=(
  opentrackr.org open.stealth.si open.demonii.com explodie.org
  exodus.desync.com tracker.torrent.eu.org tracker.dler.org tracker.dler.com
  tracker.filemail.com tracker.qu.ax tracker.opentrackr.org tracker.bt4g.com
  tracker.moeking.me tracker.tiny-vps.com tracker.srv00.com tracker.dump.cl
  tracker.gbitt.info tracker-udp.gbitt.info tracker.ololosh.space
  tracker.bittor.pw tracker.internetwarriors.net tracker.coppersurfer.tk
  tracker.openbittorrent.com tracker.leechers-paradise.org
  tracker.cyberia.is tracker.ds.is tracker.iamhansen.xyz tracker.loligirl.cn
  tracker.moeking.me tracker.monitorit4.me tracker.nexa.v6.rocks
  tracker.skyts.net tracker.tfile.co tracker.tfile.me tracker.trackerfix.com
  tracker.zer0day.to tracker.zemoj.com tracker.uw0.xyz tracker.v6speed.org
  publictracker.xyz p4p.arenabg.com open.acgtracker.com open.dstud.io
  open.trackerlist.xyz opentracker.io retracker.lanta.me
  wikilenko.com demo.starcast.org bt.t-ru.org
  router.bittorrent.com dht.transmissionbt.com router.utorrent.com
  dht.libtorrent.org dht.aelitis.com bootstrap.ring.nctu.edu.tw
  bittorrent-tracker.e-n-c-r-y-p-t.net ipv4announce.sktorrent.eu
  tracker.auctor.tv tracker.yemekyedim.com tracker.zhuqiy.com
  t.overflow.biz zer0day.ch concen.org seeders-paradise.org
  tracker1.bt.moack.co.kr tracker1.itzmx.com tracker2.itzmx.com
  tracker3.itzmx.com tracker4.itzmx.com open.stealth.si
  packetsoverdtls.com tracker.breizh.bar tracker.tamersunion.org
  tracker.bitsearch.to tracker.foreverpirates.co tracker.ghostchu-services.top
  sparkle.ghostchu-services.top bt.ktrackers.com bt.poletracker.org
  tracker.renfei.net tracker.lilithraws.org tracker.ipfsscan.io
)

python_patch() {
  python3 - "$@" <<'PY'
import os, re, sys
from pathlib import Path

MARKER_BEGIN = "HIDDIFY_NOTORRENT_BEGIN"
MARKER_END = "HIDDIFY_NOTORRENT_END"
domains = [d.strip() for d in os.environ.get("NOTORRENT_DOMAINS", "").split(",") if d.strip()]
# de-dupe, keep order
seen = set()
uniq = []
for d in domains:
    if d not in seen:
        seen.add(d)
        uniq.append(d)
domains = uniq

TCP_PORTS = os.environ.get("NOTORRENT_WEB_TCP", "80,443,853,2052,2053,2082,2083,2086,2087,2095,2096,8080,8443,8880,5222,5228,465,587,993,995,3478")
UDP_PORTS = os.environ.get("NOTORRENT_WEB_UDP", "53,123,443,853,3478")
TCP_LIST = ", ".join(p.strip() for p in TCP_PORTS.split(",") if p.strip())
UDP_LIST = ", ".join(p.strip() for p in UDP_PORTS.split(",") if p.strip())

def web_outbound(text):
    """Where Instagram/YouTube should still go: freedom, or WARP if the panel sends everything there."""
    m = re.search(
        r"HIDDIFY_NOTORRENT_BEGIN[\s\S]{0,4000}?"
        r'"network":\s*"tcp"[\s\S]{0,250}?"outboundTag":\s*'
        r'(\{%[\s\S]*?%\}|"WARP"|"freedom")',
        text,
    )
    if m:
        return m.group(1).strip()
    if "{% if hconfigs['warp_mode'] == 'all' %}" in text:
        return '{% if hconfigs[\'warp_mode\'] == \'all\' %}"WARP"{% else %}"freedom"{% endif %}'
    m = re.search(
        r'"port":\s*"0-65535"[\s\S]{0,120}?"outboundTag":\s*("WARP"|"freedom")',
        text,
    )
    if m:
        return m.group(1)
    m = re.search(r'"final":\s*("WARP"|"freedom")', text)
    if m:
        return m.group(1)
    return '"freedom"'

def xray_block(text):
    listed = ",\n                ".join(f'"domain:{d}"' for d in domains)
    dest = web_outbound(text)
    return f'''            {{ // {MARKER_BEGIN}
              "type": "field",
              "outboundTag": "blocked_torrent",
              "protocol": ["bittorrent"]
            }},
            {{
              "type": "field",
              "network": "tcp,udp",
              "port": "6881-6889,6969,51413",
              "outboundTag": "blocked_torrent"
            }},
            {{
              "type": "field",
              "outboundTag": "blocked_torrent",
              "domain": [
                {listed}
              ]
            }},
            {{
              "type": "field",
              "network": "tcp",
              "port": "{TCP_PORTS}",
              "outboundTag": {dest}
            }},
            {{
              "type": "field",
              "network": "udp",
              "port": "{UDP_PORTS}",
              "outboundTag": {dest}
            }},
            // {MARKER_END}
'''

def singbox_block(text):
    listed = ",\n                ".join(f'"{d}"' for d in domains)
    dest = web_outbound(text)
    return f'''            // {MARKER_BEGIN}
            {{
              "protocol": "bittorrent",
              "action": "reject",
              "method": "default"
            }},
            {{
              "port": "6881:6889",
              "action": "reject",
              "method": "default"
            }},
            {{
              "port": [6969, 51413],
              "action": "reject",
              "method": "default"
            }},
            {{
              "domain_suffix": [
                {listed}
              ],
              "action": "reject",
              "method": "default"
            }},
            {{
              "port": [{TCP_LIST}],
              "network": "tcp",
              "outbound": {dest}
            }},
            {{
              "port": [{UDP_LIST}],
              "network": "udp",
              "outbound": {dest}
            }},
            {{
              "action": "reject",
              "method": "default"
            }},
            // {MARKER_END}
'''

def upsert(text, block):
    lines = text.splitlines(keepends=True)
    start = end = None
    for i, line in enumerate(lines):
        if MARKER_BEGIN in line and start is None:
            start = i
        if MARKER_END in line and start is not None:
            end = i
            break
    if start is None or end is None:
        return text, False, "missing"
    blk = block if block.endswith("\n") else block + "\n"
    new = "".join(lines[:start]) + blk + "".join(lines[end + 1 :])
    return new, new != text, "replaced"

def retag_official_bt(text):
    """Point Hiddify's stock bittorrent rule at blocked_torrent so it shows in access logs."""
    return re.sub(
        r'("outboundTag":\s*")blackhole("\s*,\s*"protocol":\s*\["bittorrent"\])',
        r'\1blocked_torrent\2',
        text,
        count=1,
    )

def retarget_catchall(text):
    """Last-resort 0-65535 must NOT go to freedom — that is how encrypted torrents leak.
    Replace the whole outboundTag value (quoted tag or a full jinja if/else)."""
    new, n = re.subn(
        r'("port":\s*"0-65535"\s*,\s*"outboundTag":\s*).*',
        r'\1"blocked_torrent"',
        text,
        count=1,
    )
    return new, n == 1 and new != text

def insert_xray(text, block=None):
    block = xray_block(text)
    text2 = retag_official_bt(text)
    extra = text2 != text
    text = text2
    text, changed, how = upsert(text, block)
    if how == "missing":
        m = re.search(
            r"\n(?=[ \t]*\{[ \t\n/]*\"type\":[ \t]*\"field\",[ \t\n]*\"port\":[ \t]*\"0-65535\")",
            text,
        )
        if not m:
            m = re.search(r"\n(?=[ \t]*\{[^\n]*\"port\":[ \t]*\"0-65535\")", text)
        if not m:
            raise SystemExit("xray routing: cannot find insertion point (port 0-65535)")
        text = text[:m.start()] + "\n" + block + text[m.start():]
        changed = True
        how = "inserted"
    text, ch2 = retarget_catchall(text)
    return text, changed or extra or ch2, how

def patch_outbound(text):
    """Add blocked_torrent AFTER the stock blackhole. Never as the first outbound
    (Xray uses the first outbound as the default — that would kill VLESS).
    Also relocates the v1.2 insert that put it first."""
    marker = "HIDDIFY_NOTORRENT_OUTBOUND"
    block = '{ "tag": "blocked_torrent", "protocol": "blackhole" }, // ' + marker + "\n"
    text2 = re.sub(
        r'("outbounds"\s*:\s*\[)\s*\{\s*"tag"\s*:\s*"blocked_torrent"[^}]*\}\s*,?\s*(//[^\n]*)?\n?',
        r"\1\n",
        text,
        count=1,
    )
    relocated = text2 != text
    text = text2
    if not relocated and (marker in text or re.search(r'"tag":\s*"blocked_torrent"', text)):
        return text, False, "exists"
    m = re.search(
        r'(\{\s*"protocol":\s*"blackhole"\s*,\s*"tag":\s*"blackhole"\s*\}\s*,?)',
        text,
    )
    if not m:
        m = re.search(
            r'(\{\s*"tag":\s*"blackhole"\s*,\s*"protocol":\s*"blackhole"\s*\}\s*,?)',
            text,
        )
    if not m:
        raise SystemExit("stock blackhole outbound not found; refusing to add a new first outbound")
    piece = m.group(1)
    suffix = "" if piece.rstrip().endswith(",") else ","
    how = "relocated" if relocated else "inserted"
    return text[:m.end()] + suffix + "\n    " + block + text[m.end():], True, how

def patch_access_log(text, log_path):
    """Insert access log as a proper JSONC line. Never put a comma inside a // comment
    (that produced invalid JSON when log_level=CRITICAL)."""
    marker = "HIDDIFY_NOTORRENT_ACCESS"
    line = f'        "access": "{log_path}", // {marker}\n'
    if marker in text:
        # Repair v1.2 bug: comma swallowed by the comment.
        broken = re.search(
            rf'"access":\s*"[^"]*"\s*//\s*{re.escape(marker)}\s*,',
            text,
        )
        if broken:
            new = re.sub(
                rf'"access":\s*"[^"]*"\s*//\s*{re.escape(marker)}\s*,',
                f'"access": "{log_path}", // {marker}',
                text,
                count=1,
            )
            return new, new != text, "repaired"
        return text, False, "exists"
    m = re.search(r'"log"\s*:\s*\{', text)
    if not m:
        raise SystemExit("log object not found")
    return text[:m.end()] + "\n" + line + text[m.end():], True, "inserted"

def _end_of_rules_array(text):
    m = re.search(r'"rules"\s*:\s*\[', text)
    if not m:
        return None
    i = m.end()
    depth = 1
    in_str = False
    esc = False
    while i < len(text) and depth:
        c = text[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
        else:
            if c == '"':
                in_str = True
            elif c == "[":
                depth += 1
            elif c == "]":
                depth -= 1
                if depth == 0:
                    return i
        i += 1
    return None

def insert_singbox(text, block=None):
    block = singbox_block(text)
    text, changed, how = upsert(text, block)
    if how != "missing":
        return text, changed, how
    # Drop the commented-out official stub so we don't leave broken Xray syntax in sing-box.
    text = re.sub(
        r"[ \t]*//\s*\{//\s*Block BitTorrent protocol[\s\S]*?//\s*\},?\n?",
        "",
        text,
        count=1,
    )
    patterns = (
        r'\{[ \t\n]*"action":[ \t]*"reject",[ \t]*"ip_is_private":[ \t]*true[ \t\n]*\}',
        r'\{[ \t\n]*"ip_is_private":[ \t]*true,[ \t]*"action":[ \t]*"reject"[ \t\n]*\}',
        r'\{[^{}\n]*"ip_is_private"[^{}\n]*\}',
    )
    anchor = None
    for pat in patterns:
        anchor = re.search(pat, text)
        if anchor:
            break
    if anchor:
        insert_at = anchor.end()
        comma = "" if text[insert_at:insert_at + 8].lstrip().startswith(",") else ","
        return text[:insert_at] + comma + "\n" + block + text[insert_at:], True, "inserted"
    close = _end_of_rules_array(text)
    if close is None:
        raise SystemExit("sing-box routing: cannot find rules array or ip_is_private reject")
    return text[:close] + "\n" + block + text[close:], True, "inserted"

def patch_file(path, kind):
    p = Path(path)
    if not p.is_file():
        print(f"skip (missing): {p}", file=sys.stderr)
        return False
    original = p.read_text(encoding="utf-8", errors="replace")
    if kind == "xray":
        new, changed, how = insert_xray(original)
    elif kind == "singbox":
        new, changed, how = insert_singbox(original)
    elif kind == "outbound":
        new, changed, how = patch_outbound(original)
    elif kind == "log":
        log_path = os.environ.get("NOTORRENT_ACCESS_LOG", "/opt/hiddify-manager/log/system/xray.access.log")
        new, changed, how = patch_access_log(original, log_path)
    else:
        raise SystemExit(f"unknown kind: {kind}")
    if not changed:
        print(f"ok (unchanged, {how}): {p}")
        return False
    bak = Path(os.environ.get("NOTORRENT_BACKUP_DIR", "/tmp")) / (p.name + ".bak")
    if not bak.exists():
        bak.write_text(original, encoding="utf-8")
    p.write_text(new, encoding="utf-8")
    print(f"patched ({how}): {p}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        raise SystemExit("usage: patch_routing.py xray|singbox|outbound|log FILE [FILE...]")
    kind = sys.argv[1]
    any_changed = False
    for f in sys.argv[2:]:
        any_changed = patch_file(f, kind) or any_changed
    sys.exit(0 if not os.environ.get("NOTORRENT_REQUIRE_CHANGE") else (0 if any_changed else 3))
PY
}

backup_file() {
  local src="$1"
  [[ -f "${src}" ]] || return 0
  local dest="${INSTALL_DIR}/backups/$(echo "${src}" | tr '/' '_').orig"
  if [[ ! -f "${dest}" ]]; then
    cp -a "${src}" "${dest}"
  fi
}

patch_hiddify_routing() {
  detect_hiddify
  mkdir -p "${INSTALL_DIR}/backups" "${HIDDIFY_DIR}/log/system"
  export NOTORRENT_DOMAINS
  NOTORRENT_DOMAINS="$(IFS=','; echo "${TRACKER_DOMAINS[*]}")"
  export NOTORRENT_BACKUP_DIR="${INSTALL_DIR}/backups"
  export NOTORRENT_ACCESS_LOG="${HIDDIFY_DIR}/log/system/xray.access.log"
  export NOTORRENT_WEB_TCP="${XRAY_TCP_PORTS}"
  export NOTORRENT_WEB_UDP="${XRAY_UDP_PORTS}"

  # Snapshot current files so a bad patch can be reverted before xray restart.
  local session="${INSTALL_DIR}/backups/session"
  rm -rf "${session}"
  mkdir -p "${session}"
  local f rel
  for rel in \
      xray/configs/03_routing.json.j2 \
      xray/configs/03_routing.json \
      xray/configs/06_outbounds.json.j2 \
      xray/configs/06_outbounds.json \
      xray/configs/00_log.json.j2 \
      xray/configs/00_log.json \
      singbox/configs/03_routing.json.j2 \
      singbox/configs/03_routing.json
  do
    if [[ -f "${HIDDIFY_DIR}/${rel}" ]]; then
      mkdir -p "${session}/$(dirname "${rel}")"
      cp -a "${HIDDIFY_DIR}/${rel}" "${session}/${rel}"
    fi
  done

  # Outbound MUST be patched before routing references blocked_torrent.
  for f in \
      "${HIDDIFY_DIR}/xray/configs/06_outbounds.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/06_outbounds.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch outbound "${f}"
    fi
  done
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch xray "${f}"
    fi
  done
  for f in \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch singbox "${f}"
    fi
  done
  for f in \
      "${HIDDIFY_DIR}/xray/configs/00_log.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/00_log.json"
  do
    if [[ -f "${f}" ]]; then
      backup_file "${f}"
      python_patch log "${f}"
    fi
  done

  if ! validate_patched_configs; then
    warn "Validation failed — restoring files from this run. Xray will not be restarted."
    for rel in \
        xray/configs/03_routing.json.j2 \
        xray/configs/03_routing.json \
        xray/configs/06_outbounds.json.j2 \
        xray/configs/06_outbounds.json \
        xray/configs/00_log.json.j2 \
        xray/configs/00_log.json \
        singbox/configs/03_routing.json.j2 \
        singbox/configs/03_routing.json
    do
      if [[ -f "${session}/${rel}" ]]; then
        cp -a "${session}/${rel}" "${HIDDIFY_DIR}/${rel}"
      fi
    done
    die "Refusing to apply a config that failed validation (VLESS would be at risk)."
  fi
  install_logrotate
  rotate_access_log_if_huge
  return 0
}

rotate_access_log_if_huge() {
  detect_hiddify
  local logf="${HIDDIFY_DIR}/log/system/xray.access.log"
  [[ -f "${logf}" ]] || return 0
  local sz
  sz="$(stat -c %s "${logf}" 2>/dev/null || echo 0)"
  if [[ "${sz}" -gt $((80 * 1024 * 1024)) ]]; then
    tail -c $((20 * 1024 * 1024)) "${logf}" > "${logf}.tmp" && mv -f "${logf}.tmp" "${logf}"
    log "Truncated oversized access log (${sz} bytes)"
  fi
}

validate_patched_configs() {
  detect_hiddify
  python3 - "$HIDDIFY_DIR" <<'PY'
import re, sys
from pathlib import Path

root = Path(sys.argv[1])
errors = []

def read(rel):
    p = root / rel
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else None

def first_outbound_tag(text):
    # Skip our blocked_torrent if someone put it first; we want freedom/WARP first.
    m = re.search(r'"outbounds"\s*:\s*\[(.*?)"tag"\s*:\s*"([^"]+)"', text, re.S)
    return m.group(2) if m else None

ob_j2 = read("xray/configs/06_outbounds.json.j2")
ob_js = read("xray/configs/06_outbounds.json")
rt_j2 = read("xray/configs/03_routing.json.j2")
rt_js = read("xray/configs/03_routing.json")
sg_j2 = read("singbox/configs/03_routing.json.j2")
lg_j2 = read("xray/configs/00_log.json.j2")

for label, text in (("outbounds.j2", ob_j2), ("outbounds.json", ob_js)):
    if not text:
        continue
    first = first_outbound_tag(text)
    if first == "blocked_torrent":
        errors.append(f"{label}: blocked_torrent is the FIRST outbound (would become Xray default and kill VLESS)")
    if "blocked_torrent" not in text:
        errors.append(f"{label}: missing blocked_torrent outbound")
    if '"tag": "freedom"' not in text and '"tag":"freedom"' not in text:
        errors.append(f"{label}: freedom outbound missing")

for label, text in (("routing.j2", rt_j2), ("routing.json", rt_js)):
    if not text:
        continue
    if "HIDDIFY_NOTORRENT_BEGIN" not in text:
        errors.append(f"{label}: torrent block marker missing")
    if '"0-65535"' not in text:
        errors.append(f"{label}: catch-all 0-65535 missing")
    if text.find("HIDDIFY_NOTORRENT_BEGIN") > text.find('"0-65535"') >= 0:
        errors.append(f"{label}: torrent block is AFTER catch-all (would never match)")
    # routing must not reference blocked_torrent unless outbound exists
    if "blocked_torrent" in text:
        ob = ob_js or ob_j2 or ""
        if "blocked_torrent" not in ob:
            errors.append(f"{label}: references blocked_torrent but outbound was not added")
    if '"80,443' not in text:
        errors.append(f"{label}: web-port allowlist missing")
    cm = re.search(
        r'"port":\s*"0-65535"[\s\S]{0,120}?"outboundTag":\s*("[^"]+"|\{%[\s\S]*?%\})',
        text,
    )
    if not cm or cm.group(1).strip() != '"blocked_torrent"':
        errors.append(f"{label}: catch-all still allows all ports (encrypted torrents leak)")
    if "{% else %}" in text.split("0-65535", 1)[-1][:200]:
        errors.append(f"{label}: leftover jinja after catch-all retarget")

if sg_j2 is not None:
    if "HIDDIFY_NOTORRENT_BEGIN" not in sg_j2:
        errors.append("singbox routing: torrent block marker missing")
    if '"protocol": "bittorrent"' not in sg_j2:
        errors.append("singbox routing: bittorrent reject missing")
    if '"action": "reject"' not in sg_j2:
        errors.append("singbox routing: final reject missing")

if lg_j2 is not None and "HIDDIFY_NOTORRENT_ACCESS" in lg_j2:
    if re.search(r'HIDDIFY_NOTORRENT_ACCESS\s*,', lg_j2):
        errors.append("00_log: comma is inside the access-log comment (invalid JSONC)")

if errors:
    print("VALIDATION ERRORS:", file=sys.stderr)
    for e in errors:
        print(" -", e, file=sys.stderr)
    sys.exit(1)
print("validation ok")
PY
}

install_logrotate() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  detect_hiddify
  cat > /etc/logrotate.d/hiddify-notorrent <<EOF
${HIDDIFY_DIR}/log/system/xray.access.log {
  daily
  rotate 7
  missingok
  notifempty
  compress
  copytruncate
}
EOF
}

configs_need_restart() {
  detect_hiddify
  local f
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2"
  do
    [[ -f "${f}" ]] || continue
    grep -q "${MARKER_BEGIN}" "${f}" || return 0
  done
  for f in \
      "${HIDDIFY_DIR}/xray/configs/06_outbounds.json" \
      "${HIDDIFY_DIR}/xray/configs/06_outbounds.json.j2"
  do
    [[ -f "${f}" ]] || continue
    grep -q "blocked_torrent" "${f}" || return 0
  done
  return 1
}

restart_proxy_cores() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  local svc
  for svc in hiddify-xray hiddify-singbox; do
    if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1; then
      if systemctl is-enabled "${svc}.service" >/dev/null 2>&1 || systemctl is-active "${svc}.service" >/dev/null 2>&1; then
        log "Restarting ${svc}..."
        systemctl restart "${svc}.service" || warn "Failed to restart ${svc}"
      fi
    fi
  done
}

# --- firewall -----------------------------------------------------------------

has_ipt() { command -v "$1" >/dev/null 2>&1; }

ensure_xt_string() {
  modprobe xt_string >/dev/null 2>&1 || true
  modprobe xt_multiport >/dev/null 2>&1 || true
  modprobe xt_set >/dev/null 2>&1 || true
  modprobe xt_connbytes >/dev/null 2>&1 || true
}

ensure_ipset() {
  if ! command -v ipset >/dev/null 2>&1; then
    if [[ "${ALLOW_APT:-0}" == "1" ]] && command -v apt-get >/dev/null 2>&1; then
      DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ipset >/dev/null || true
    fi
  fi
  command -v ipset >/dev/null 2>&1 || return 1
  ipset create notorrent-trackers hash:net family inet hashsize 1024 maxelem 65536 -exist
  ipset create notorrent-trackers6 hash:net family inet6 hashsize 1024 maxelem 65536 -exist
}

refresh_tracker_ipset() {
  ensure_ipset || { warn "ipset not available, skipping tracker IP block"; return 0; }
  local stamp="${INSTALL_DIR}/ipset.stamp"
  if [[ -f "${stamp}" ]] && [[ $(( $(date +%s) - $(stat -c %Y "${stamp}" 2>/dev/null || echo 0) )) -lt 21600 ]]; then
    # still refresh if empty
    local n
    n="$(ipset list notorrent-trackers 2>/dev/null | awk '/Number of entries/{print $4}')"
    if [[ "${n:-0}" -gt 0 ]]; then
      return 0
    fi
  fi
  log "Resolving tracker / DHT hostnames into ipset..."
  local d ip
  local deadline=$(( $(date +%s) + 15 ))
  for d in "${TRACKER_DOMAINS[@]}"; do
    [[ $(date +%s) -ge ${deadline} ]] && break
    while read -r ip; do
      [[ -z "${ip}" ]] && continue
      if [[ "${ip}" == *:* ]]; then
        ipset add notorrent-trackers6 "${ip}" -exist 2>/dev/null || true
      else
        ipset add notorrent-trackers "${ip}" -exist 2>/dev/null || true
      fi
    done < <(timeout 1 getent ahosts "${d}" 2>/dev/null | awk '{print $1}' | sort -u || true)
  done
  date > "${stamp}"
}

nft_set_ports() {
  echo "$1" | awk -F, '{
    for (i = 1; i <= NF; i++) {
      gsub(/ /, "", $i)
      if ($i != "") {
        if (n++) printf ", "
        printf "%s", $i
      }
    }
  }'
}

emit_nft_table() {
  local tcp udp
  tcp="$(nft_set_ports "${HOST_TCP_PORTS}")"
  udp="$(nft_set_ports "${HOST_UDP_PORTS}")"
  # priority 10: after conntrack (-200). Never leftover-drop UNTRACKED:
  # that is SYN-ACK back to the Hiddify client (VLESS/gRPC/WS/Reality).
  cat <<NFT
table inet hiddify_notorrent {
  chain out {
    type filter hook output priority 10; policy accept;
    oifname "lo" accept
    ip protocol icmp accept
    meta l4proto ipv6-icmp accept
    ct state established,related tcp dport != { 80, 443 } accept
    ct state established,related meta l4proto != tcp accept
    tcp dport { 80, 443 } jump inspect_web
    tcp dport { ${tcp} } accept
    udp dport { ${udp} } accept
    ct state new counter drop
  }
  chain inspect_web {
    tcp flags syn accept
    tcp dport 443 @th,160,16 0x1603 accept
    tcp dport 443 @th,192,16 0x1603 accept
    tcp dport 443 @th,256,16 0x1603 accept
    tcp dport 443 @th,320,16 0x1603 accept
    tcp dport 443 @th,160,16 0x1703 accept
    tcp dport 443 @th,192,16 0x1703 accept
    tcp dport 443 @th,256,16 0x1703 accept
    tcp dport 443 @th,320,16 0x1703 accept
    tcp dport 443 @th,160,16 0x1503 accept
    tcp dport 443 @th,256,16 0x1503 accept
    tcp dport 443 @th,160,16 0x1403 accept
    tcp dport 443 @th,256,16 0x1403 accept
    tcp dport 80 @th,160,16 0x4745 accept
    tcp dport 80 @th,256,16 0x4745 accept
    tcp dport 80 @th,160,16 0x504f accept
    tcp dport 80 @th,256,16 0x504f accept
    tcp dport 80 @th,160,16 0x4845 accept
    tcp dport 80 @th,256,16 0x4845 accept
    tcp dport 80 @th,160,16 0x434f accept
    tcp dport 80 @th,256,16 0x434f accept
    tcp flags & psh == 0 accept
    drop
  }
  chain fwd {
    type filter hook forward priority 10; policy accept;
    tcp dport { 6881-6889, 6969, 51413 } drop
    udp dport { 6881-6889, 6969, 51413, 6771 } drop
  }
}
NFT
}

emit_nft_table_simple() {
  local tcp udp
  tcp="$(nft_set_ports "${HOST_TCP_PORTS}")"
  udp="$(nft_set_ports "${HOST_UDP_PORTS}")"
  cat <<NFT
table inet hiddify_notorrent {
  chain out {
    type filter hook output priority 10; policy accept;
    oifname "lo" accept
    ip protocol icmp accept
    meta l4proto ipv6-icmp accept
    ct state established,related accept
    tcp dport { ${tcp} } accept
    tcp dport { 80, 443 } tcp flags syn accept
    udp dport { ${udp} } accept
    ct state new counter drop
  }
}
NFT
}

apply_nft_ports() {
  command -v nft >/dev/null 2>&1 || return 0
  nft delete table inet hiddify_notorrent >/dev/null 2>&1 || true
  if emit_nft_table | nft -f - 2>/dev/null; then
    log "nftables: OUTPUT allowlist + inspect_web (80/443 first payload)"
    return 0
  fi
  nft delete table inet hiddify_notorrent >/dev/null 2>&1 || true
  if emit_nft_table_simple | nft -f -; then
    warn "nftables: payload inspect unsupported; using port allowlist + iptables L7"
    return 0
  fi
  warn "nftables table not applied"
}

fill_ipt_chain() {
  local ipt="$1"
  $ipt -N HIDDIFY_NOTORRENT >/dev/null 2>&1 || true
  $ipt -F HIDDIFY_NOTORRENT

  # Jump at the top so Hiddify INPUT rules stay intact.
  if ! $ipt -C OUTPUT  -j HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    $ipt -I OUTPUT  1 -j HIDDIFY_NOTORRENT
  fi
  if ! $ipt -C FORWARD -j HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    $ipt -I FORWARD 1 -j HIDDIFY_NOTORRENT
  fi

  $ipt -A HIDDIFY_NOTORRENT -o lo -j RETURN || true
  # Replies to inbound VLESS/gRPC/Reality (random client dport) + NDP.
  if [[ "${ipt}" == *6* ]]; then
    $ipt -A HIDDIFY_NOTORRENT -p ipv6-icmp -j RETURN || true
  else
    $ipt -A HIDDIFY_NOTORRENT -p icmp -j RETURN || true
  fi
  $ipt -A HIDDIFY_NOTORRENT -m conntrack --ctstate ESTABLISHED,RELATED \
        ! -p tcp -j RETURN 2>/dev/null \
    || $ipt -A HIDDIFY_NOTORRENT -m state --state ESTABLISHED,RELATED \
        ! -p tcp -j RETURN || true
  $ipt -A HIDDIFY_NOTORRENT -p tcp -m conntrack --ctstate ESTABLISHED,RELATED \
        -m multiport ! --dports 80,443 -j RETURN 2>/dev/null || true

  # 443: TLS records only. Search past IP+TCP options (not just 32 bytes).
  local rec
  for rec in '|1603|' '|1703|' '|1503|' '|1403|'; do
    if $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 443 \
          -m string --algo bm --from 0 --to 128 --hex-string "${rec}" -j RETURN 2>/dev/null; then
      TLS_INSPECT_OK=1
    fi
  done
  $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 443 --syn -j RETURN || true
  $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 443 --tcp-flags PSH,ACK ACK -j RETURN || true
  if [[ "${TLS_INSPECT_OK:-0}" == "1" ]]; then
    $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 443 --tcp-flags PSH PSH -j DROP || true
  fi

  local meth http_ok=0
  for meth in "GET " "POST " "HEAD " "PUT " "OPTIONS " "CONNECT " "PATCH "; do
    if $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 80 \
      -m string --algo bm --from 0 --to 128 --string "${meth}" -j RETURN 2>/dev/null; then
      http_ok=1
    fi
  done
  $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 80 --syn -j RETURN || true
  $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 80 --tcp-flags PSH,ACK ACK -j RETURN || true
  if [[ "${http_ok}" -eq 1 ]]; then
    $ipt -A HIDDIFY_NOTORRENT -p tcp --dport 80 --tcp-flags PSH PSH -j DROP || true
  fi

  $ipt -A HIDDIFY_NOTORRENT -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN 2>/dev/null \
    || $ipt -A HIDDIFY_NOTORRENT -m state --state ESTABLISHED,RELATED -j RETURN || true

  # iptables multiport accepts at most 15 ports — split.
  local chunk="" n=0 p
  local IFS=','
  for p in ${HOST_TCP_PORTS}; do
    p="${p// /}"
    [[ -n "${p}" ]] || continue
    if [[ ${n} -eq 0 ]]; then
      chunk="${p}"
    else
      chunk="${chunk},${p}"
    fi
    n=$((n + 1))
    if [[ ${n} -ge 14 ]]; then
      $ipt -A HIDDIFY_NOTORRENT -p tcp -m multiport --dports "${chunk}" -j RETURN || true
      chunk=""
      n=0
    fi
  done
  unset IFS
  if [[ -n "${chunk}" ]]; then
    $ipt -A HIDDIFY_NOTORRENT -p tcp -m multiport --dports "${chunk}" -j RETURN || true
  fi
  $ipt -A HIDDIFY_NOTORRENT -p udp -m multiport --dports "${HOST_UDP_PORTS}" -j RETURN || true
  if [[ "${ipt}" != *6* ]]; then
    $ipt -A HIDDIFY_NOTORRENT -p icmp -j RETURN || true
  fi

  # Classic ports (what the hoster suggested) — extra, not sufficient alone.
  $ipt -A HIDDIFY_NOTORRENT -p tcp -m multiport --dports 6881:6889,6969,51413 -j DROP || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m multiport --dports 6881:6889,6969,51413,6771 -j DROP || true

  if $ipt -m set -h >/dev/null 2>&1; then
    if [[ "${ipt}" == *6* ]]; then
      $ipt -A HIDDIFY_NOTORRENT -m set --match-set notorrent-trackers6 dst -j DROP 2>/dev/null || true
    else
      $ipt -A HIDDIFY_NOTORRENT -m set --match-set notorrent-trackers dst -j DROP 2>/dev/null || true
    fi
  fi

  # Layer-7 signatures. Do NOT match generic words like "torrent" / "announce"
  # — those break ordinary websites.
  # BitTorrent handshake: 0x13 + "BitTorrent protocol"
  if $ipt -A HIDDIFY_NOTORRENT -m string --algo bm --from 0 --to 2048 \
        --hex-string '|13426974546f7272656e742070726f746f636f6c|' -j DROP 2>/dev/null; then
    :
  else
    warn "${ipt}: xt_string hex match not available"
  fi
  # DHT / uTP peer discovery (bencoded)
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string 'd1:ad2:id20:' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '1:rd2:id20:' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '9:get_peers' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '13:announce_peer' -j DROP 2>/dev/null || true
  $ipt -A HIDDIFY_NOTORRENT -p udp -m string --algo bm --from 0 --to 1024 --string '9:find_node' -j DROP 2>/dev/null || true
  # HTTP tracker announce (both keys together → low false-positive rate)
  $ipt -A HIDDIFY_NOTORRENT -p tcp -m string --algo bm --from 0 --to 2048 --string 'info_hash=' \
        -m string --algo bm --from 0 --to 2048 --string 'peer_id=' -j DROP 2>/dev/null || true

  # Only NEW leftovers. Never drop UNTRACKED — that is SYN-ACK to the client.
  $ipt -A HIDDIFY_NOTORRENT -m conntrack --ctstate NEW -j DROP 2>/dev/null \
    || $ipt -A HIDDIFY_NOTORRENT -m state --state NEW -j DROP || true
}

persist_live_firewall() {
  if command -v netfilter-persistent >/dev/null 2>&1; then
    netfilter-persistent save >/dev/null 2>&1 || true
  elif command -v iptables-save >/dev/null 2>&1 && [[ -d /etc/iptables || "${PERSIST_FIREWALL:-0}" == "1" ]]; then
    mkdir -p /etc/iptables
    iptables-save  > /etc/iptables/rules.v4 2>/dev/null || true
    ip6tables-save > /etc/iptables/rules.v6 2>/dev/null || true
  fi
}

# 1.6.4 selftest was a false alarm: Hiddify INPUT drops the veth SYN
# (random high port), so the connect timed out even with our rules gone.
# Punch INPUT for the test iface, take a baseline, then re-test after rules.
INBOUND_NS="hiddify_nt_st"
INBOUND_VETH="veth-nt0"
INBOUND_PEER="veth-nt1"

inbound_test_teardown() {
  if has_ipt iptables; then
    iptables -D INPUT -i "${INBOUND_VETH}" -j ACCEPT 2>/dev/null || true
    iptables -D INPUT -s 10.254.254.2/32 -j ACCEPT 2>/dev/null || true
  fi
  if command -v nft >/dev/null 2>&1; then
    nft delete table inet hiddify_nt_st_in 2>/dev/null || true
  fi
  ip netns del "${INBOUND_NS}" 2>/dev/null || true
  ip link del "${INBOUND_VETH}" 2>/dev/null || true
}

inbound_test_setup() {
  inbound_test_teardown
  ip netns add "${INBOUND_NS}" || return 1
  ip link add "${INBOUND_VETH}" type veth peer name "${INBOUND_PEER}" || return 1
  ip link set "${INBOUND_PEER}" netns "${INBOUND_NS}"
  ip addr add 10.254.254.1/24 dev "${INBOUND_VETH}"
  ip link set "${INBOUND_VETH}" up
  ip netns exec "${INBOUND_NS}" ip addr add 10.254.254.2/24 dev "${INBOUND_PEER}"
  ip netns exec "${INBOUND_NS}" ip link set "${INBOUND_PEER}" up
  ip netns exec "${INBOUND_NS}" ip link set lo up
  # Host INPUT (Hiddify/ufw) would otherwise drop SYN to a random port.
  if has_ipt iptables; then
    iptables -I INPUT 1 -i "${INBOUND_VETH}" -j ACCEPT
  fi
  if command -v nft >/dev/null 2>&1; then
    nft -f - <<'NFT' 2>/dev/null || true
table inet hiddify_nt_st_in {
  chain pin {
    type filter hook input priority -280; policy accept;
    iifname "veth-nt0" accept
  }
}
NFT
  fi
  return 0
}

inbound_test_connect() {
  python3 - "${INBOUND_NS}" <<'PY'
import socket, subprocess, sys, threading

ns = sys.argv[1]
srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("10.254.254.1", 0))
srv.listen(1)
srv.settimeout(3.0)
port = srv.getsockname()[1]

def accept():
    try:
        c, _ = srv.accept()
        c.sendall(b"ok")
        c.close()
    except OSError:
        pass

threading.Thread(target=accept, daemon=True).start()
cli = (
    "import socket, sys\n"
    "s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n"
    "s.settimeout(2.5)\n"
    "s.connect(('10.254.254.1', %d))\n"
    "data = s.recv(8)\n"
    "s.close()\n"
    "sys.exit(0 if data == b'ok' else 2)\n"
) % port
r = subprocess.run(
    ["ip", "netns", "exec", ns, "python3", "-c", cli],
    timeout=5,
    check=False,
    capture_output=True,
    text=True,
)
srv.close()
if r.returncode != 0:
    err = (r.stderr or r.stdout or "").strip().splitlines()
    extra = err[-1] if err else f"exit {r.returncode}"
    print(f"selftest: inbound SYN-ACK=timeout ({extra})")
    sys.exit(2)
print("selftest: inbound SYN-ACK=ok")
PY
}

selftest_inbound_reply() {
  [[ "${SKIP_FIREWALL:-0}" == "1" ]] && return 0
  command -v ip >/dev/null 2>&1 || { log "inbound-selftest: skip (no ip)"; return 0; }
  ip netns list >/dev/null 2>&1 || { log "inbound-selftest: skip (no netns)"; return 0; }
  if ! inbound_test_setup; then
    inbound_test_teardown
    log "inbound-selftest: skip (veth/netns setup failed)"
    return 0
  fi
  local rc=0
  inbound_test_connect || rc=1
  inbound_test_teardown
  return "${rc}"
}

firewall_rules_vpn_safe() {
  if command -v nft >/dev/null 2>&1 && nft list table inet hiddify_notorrent >/dev/null 2>&1; then
    if nft list table inet hiddify_notorrent | grep -qE '^\s+counter drop$'; then
      warn "nft leftover counter drop — это 1.6.2, VPN умрёт"
      return 1
    fi
  fi
  if command -v iptables >/dev/null 2>&1 && iptables -S HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    if iptables -S HIDDIFY_NOTORRENT | grep -qE -- '-A HIDDIFY_NOTORRENT -j DROP$'; then
      warn "iptables финальный DROP без NEW — режет SYN-ACK"
      return 1
    fi
  fi
  return 0
}

selftest_firewall() {
  [[ "${SKIP_FIREWALL:-0}" == "1" ]] && return 0
  python3 - <<'PY'
import errno, socket, sys

def try_connect(host, port, timeout=3.0):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        s.close()
        return "open"
    except socket.timeout:
        return "timeout"
    except OSError as e:
        if e.errno in (errno.EPERM, errno.EACCES):
            return "drop"
        if e.errno == errno.ECONNREFUSED:
            return "rst"
        return f"err:{e.errno}"
    finally:
        try:
            s.close()
        except OSError:
            pass

web = try_connect("1.1.1.1", 443, 4.0)
peer = try_connect("1.1.1.1", 51413, 2.5)
print(f"selftest: 1.1.1.1:443={web}  1.1.1.1:51413={peer}")
if peer == "open":
    print("selftest: FAIL — торрент-подобный порт вышел с VPS. Allowlist не активен.")
    sys.exit(2)
if peer == "rst":
    print("selftest: FAIL — пакет до 51413 ушёл в интернет (RST). Ядро не дропает OUTPUT.")
    sys.exit(2)
if web == "open" and peer in ("timeout", "drop"):
    print("selftest: OK — веб жив, случайный порт с VPS не выходит.")
    sys.exit(0)
print("selftest: WARN — не удалось однозначно проверить (нет маршрута до 1.1.1.1?).")
sys.exit(0)
PY
}

apply_firewall() {
  [[ "${SKIP_FIREWALL:-0}" == "1" ]] && return 0
  ensure_xt_string
  TLS_INSPECT_OK=0

  local inbound_ready=0 inbound_baseline=0
  if [[ "${SKIP_INBOUND_SELFTEST:-0}" != "1" ]] && command -v ip >/dev/null 2>&1 && ip netns list >/dev/null 2>&1; then
    if inbound_test_setup; then
      inbound_ready=1
      if inbound_test_connect; then
        inbound_baseline=1
        log "inbound-selftest: baseline OK (INPUT для veth открыт)"
      else
        log "inbound-selftest: baseline FAIL — тест невалиден, из‑за него правила не откатываю"
      fi
    else
      inbound_test_teardown
      log "inbound-selftest: skip (veth/netns setup failed)"
    fi
  fi

  apply_nft_ports
  refresh_tracker_ipset
  if has_ipt iptables; then
    fill_ipt_chain iptables
  fi
  if has_ipt ip6tables; then
    fill_ipt_chain ip6tables
  fi
  if [[ "${TLS_INSPECT_OK:-0}" != "1" ]]; then
    warn "xt_string не принял TLS-сигнатуру. Пиры на 443 могут пройти. Нужен пакет iptables с xt_string."
  fi

  local rollback=0
  if ! firewall_rules_vpn_safe; then
    rollback=1
  fi
  if [[ "${inbound_ready}" -eq 1 && "${inbound_baseline}" -eq 1 ]]; then
    if inbound_test_connect; then
      log "inbound-selftest: SYN-ACK OK после правил"
    else
      warn "После правил SYN-ACK пропал — это уже наши OUTPUT, откатываю."
      rollback=1
    fi
  fi
  if [[ "${inbound_ready}" -eq 1 ]]; then
    inbound_test_teardown
  fi

  if [[ "${rollback}" -eq 1 ]]; then
    warn "Входящий ответ клиенту не проходит — снимаю фаервол, VLESS не трогаю."
    remove_firewall
    die "Откатил OUTPUT-правила. Соединение в клиенте должно остаться. Пришлите doctor."
  fi
  selftest_firewall || warn "selftest failed — doctor покажет, активен ли блок"
  if [[ "${PERSIST_FIREWALL:-0}" == "1" ]]; then
    persist_live_firewall
  fi
}

remove_firewall() {
  if command -v nft >/dev/null 2>&1; then
    nft delete table inet hiddify_notorrent 2>/dev/null || true
  fi
  local ipt
  for ipt in iptables ip6tables; do
    has_ipt "${ipt}" || continue
    $ipt -D OUTPUT  -j HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -D FORWARD -j HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -F HIDDIFY_NOTORRENT 2>/dev/null || true
    $ipt -X HIDDIFY_NOTORRENT 2>/dev/null || true
  done
  if command -v ipset >/dev/null 2>&1; then
    ipset destroy notorrent-trackers  2>/dev/null || true
    ipset destroy notorrent-trackers6 2>/dev/null || true
  fi
  # 1.6.2 persist мог оставить яд в /etc/iptables — перезаписываем живое состояние.
  persist_live_firewall
}

# --- systemd ------------------------------------------------------------------

install_systemd() {
  [[ "${SKIP_SYSTEMD:-0}" == "1" ]] && return 0
  cat > /etc/systemd/system/hiddify-notorrent.service <<EOF
[Unit]
Description=Re-apply Hiddify BitTorrent block
After=network-online.target

[Service]
Type=oneshot
ExecStart=${SELF_PATH} apply
Nice=10

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/hiddify-notorrent.timer <<'EOF'
[Unit]
Description=Re-apply Hiddify BitTorrent block every 2 minutes

[Timer]
OnBootSec=20s
OnUnitActiveSec=120s
AccuracySec=15s
Persistent=true

[Install]
WantedBy=timers.target
EOF

  detect_hiddify
  cat > /etc/systemd/system/hiddify-notorrent.path <<EOF
[Unit]
Description=Watch Hiddify routing configs and re-block torrents after apply

[Path]
PathChanged=${HIDDIFY_DIR}/xray/configs/03_routing.json
PathChanged=${HIDDIFY_DIR}/xray/configs/03_routing.json.j2
PathChanged=${HIDDIFY_DIR}/singbox/configs/03_routing.json
PathChanged=${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2
Unit=hiddify-notorrent.service

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable hiddify-notorrent.timer hiddify-notorrent.path hiddify-notorrent.service
  systemctl start hiddify-notorrent.timer hiddify-notorrent.path
}

uninstall_systemd() {
  systemctl disable --now hiddify-notorrent.timer hiddify-notorrent.path hiddify-notorrent.service >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/hiddify-notorrent.service \
        /etc/systemd/system/hiddify-notorrent.timer \
        /etc/systemd/system/hiddify-notorrent.path
  systemctl daemon-reload 2>/dev/null || true
}

restore_backups() {
  detect_hiddify || true
  local pair dest src
  for pair in \
      "xray/configs/03_routing.json.j2" \
      "xray/configs/03_routing.json" \
      "singbox/configs/03_routing.json.j2" \
      "singbox/configs/03_routing.json" \
      "xray/configs/06_outbounds.json.j2" \
      "xray/configs/06_outbounds.json" \
      "xray/configs/00_log.json.j2" \
      "xray/configs/00_log.json"
  do
    src="${INSTALL_DIR}/backups/$(echo "${HIDDIFY_DIR}/${pair}" | tr '/' '_').orig"
    dest="${HIDDIFY_DIR}/${pair}"
    if [[ -f "${src}" && -n "${HIDDIFY_DIR:-}" ]]; then
      cp -a "${src}" "${dest}"
      log "Restored ${dest}"
    fi
  done
}

# --- commands -----------------------------------------------------------------

cmd_apply() {
  need_root
  detect_hiddify
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  mkdir -p "${INSTALL_DIR}/backups"

  local need_restart=0
  if configs_need_restart; then
    need_restart=1
  fi
  patch_hiddify_routing
  if configs_need_restart; then
    # still missing marker on some file — patch failed
    warn "Some routing files still lack the torrent block. Check the log above."
  fi
  apply_firewall
  if [[ "${need_restart}" -eq 1 ]]; then
    restart_proxy_cores
  fi
}

cmd_install() {
  need_root
  detect_hiddify
  command -v python3 >/dev/null 2>&1 || die "python3 is required"
  log "Hiddify found at ${HIDDIFY_DIR}"
  save_self
  ALLOW_APT=1 PERSIST_FIREWALL=1
  export ALLOW_APT PERSIST_FIREWALL
  patch_hiddify_routing
  apply_firewall
  install_systemd
  restart_proxy_cores
  log "Done. Users change nothing. Kernel drops NEW outbound that is not a web port."
  log "Version:   ${VERSION}  (if doctor is unknown, this file never reached PATH)"
  log "Check:     hiddify-block-torrents status"
  log "Doctor:    hiddify-block-torrents doctor"
  log "Who:       hiddify-block-torrents who"
  log "Remove:    hiddify-block-torrents uninstall"
}

cmd_status() {
  detect_hiddify
  echo "version:    ${VERSION}"
  echo "hiddify:    ${HIDDIFY_DIR}"
  echo "script:     ${SELF_PATH} $([[ -x ${SELF_PATH} ]] && echo OK || echo MISSING)"
  local f state
  for f in \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/xray/configs/03_routing.json" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2" \
      "${HIDDIFY_DIR}/singbox/configs/03_routing.json"
  do
    [[ -f "${f}" ]] || continue
    if grep -q "${MARKER_BEGIN}" "${f}"; then state=BLOCKED; else state=NOT_PATCHED; fi
    echo "config:     ${state}  ${f}"
  done
  if command -v nft >/dev/null 2>&1 && nft list table inet hiddify_notorrent >/dev/null 2>&1; then
    echo "nftables:   OK (table inet hiddify_notorrent)"
  else
    echo "nftables:   missing"
  fi
  if command -v iptables >/dev/null 2>&1 && iptables -nL HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    echo "iptables:   OK (chain HIDDIFY_NOTORRENT)"
  else
    echo "iptables:   missing"
  fi
  if command -v ip6tables >/dev/null 2>&1 && ip6tables -nL HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    echo "ip6tables:  OK"
  else
    echo "ip6tables:  missing"
  fi
  if grep -q "blocked_torrent" "${HIDDIFY_DIR}/xray/configs/06_outbounds.json" \
        "${HIDDIFY_DIR}/xray/configs/06_outbounds.json.j2" 2>/dev/null; then
    echo "outbound:   blocked_torrent OK"
  else
    echo "outbound:   missing (who/logs will not tag torrents)"
  fi
  local access="${HIDDIFY_DIR}/log/system/xray.access.log"
  if grep -q "HIDDIFY_NOTORRENT_ACCESS\|xray.access.log" \
        "${HIDDIFY_DIR}/xray/configs/00_log.json" \
        "${HIDDIFY_DIR}/xray/configs/00_log.json.j2" 2>/dev/null; then
    echo "access log: enabled  ${access}"
  else
    echo "access log: not patched"
  fi
  if systemctl is-enabled hiddify-notorrent.timer >/dev/null 2>&1; then
    echo "timer:      enabled"
  else
    echo "timer:      not enabled"
  fi
}

cmd_who() {
  detect_hiddify
  echo "version:     ${VERSION}  (doctor обязан существовать с 1.4.0+; иначе PATH со старым скриптом)"
  python3 - "$HIDDIFY_DIR" <<'PY'
import os, re, shutil, sqlite3, subprocess, sys
from collections import Counter
from pathlib import Path
from urllib.parse import unquote, urlparse

root = Path(sys.argv[1])
uuid_re = re.compile(
    r"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})"
)
SOURCE = {"kind": "none", "detail": ""}


def find_sqlite():
    candidates = [
        root / "hiddify-panel" / "hiddifypanel.db",
        root / "hiddify-panel" / "src" / "hiddifypanel.db",
        root / "hiddifypanel" / "hiddifypanel.db",
        Path("/opt/hiddify-manager/hiddify-panel/hiddifypanel.db"),
        Path("/opt/hiddify-manager/hiddify-panel/src/hiddifypanel.db"),
        Path("/opt/hiddify-config/hiddifypanel/hiddifypanel.db"),
        Path("/opt/hiddify-config/hiddify-panel/hiddifypanel.db"),
    ]
    for p in candidates:
        if p.is_file():
            return p
    for base in (
        root / "hiddify-panel",
        root / "hiddifypanel",
        Path("/opt/hiddify-manager/hiddify-panel"),
        Path("/opt/hiddify-config/hiddifypanel"),
        Path("/opt/hiddify-config/hiddify-panel"),
    ):
        if not base.is_dir():
            continue
        for p in base.rglob("hiddifypanel.db"):
            return p
    return None


def ingest_rows(users, col_names, rows):
    idx = {n.lower(): i for i, n in enumerate(col_names)}
    uuid_i = next((idx[k] for k in ("uuid", "uuid4") if k in idx), None)
    if uuid_i is None:
        return 0
    name_i = next((idx[k] for k in ("name", "username", "comment") if k in idx), None)
    usage_i = None
    usage_is_gb = False
    for k in ("current_usage_gb", "current_usage", "usage"):
        if k in idx:
            usage_i = idx[k]
            usage_is_gb = "gb" in k
            break
    added = 0
    for row in rows:
        uid = str(row[uuid_i] or "").lower()
        if not uid:
            continue
        name = str(row[name_i] or "") if name_i is not None else ""
        gb = None
        if usage_i is not None:
            try:
                val = float(row[usage_i] or 0)
            except (TypeError, ValueError):
                val = 0.0
            gb = val if usage_is_gb else val / (1024 ** 3)
        users[uid] = {"name": name, "gb": gb}
        added += 1
    return added


def pick_table(tables, columns_of):
    preferred = [t for t in tables if t.lower() in ("user", "users")]
    for t in preferred + [x for x in tables if x not in preferred]:
        cols = columns_of(t)
        cl = {c.lower() for c in cols}
        if "uuid" in cl and ({"current_usage", "current_usage_gb"} & cl):
            return t, cols
    for t in preferred + [x for x in tables if x not in preferred]:
        cols = columns_of(t)
        if any(c.lower() == "uuid" for c in cols):
            return t, cols
    return None, []


def load_sqlite(db_path):
    users = {}
    if not db_path:
        return users
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        tables = [
            r[0]
            for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table'"
            )
        ]

        def columns_of(table):
            return [r[1] for r in con.execute(f'PRAGMA table_info("{table}")')]

        table, cols = pick_table(tables, columns_of)
        if not table:
            return users
        qcols = ", ".join(f'"{c}"' for c in cols)
        rows = list(con.execute(f'SELECT {qcols} FROM "{table}"'))
        ingest_rows(users, cols, rows)
        SOURCE["kind"] = "sqlite"
        SOURCE["detail"] = str(db_path)
    finally:
        con.close()
    return users


def mysql_pass_files():
    return [
        root / "other" / "mysql" / "mysql_pass",
        Path("/opt/hiddify-manager/other/mysql/mysql_pass"),
        Path("/opt/hiddify-config/other/mysql/mysql_pass"),
    ]


def parse_app_cfg_uri():
    for p in (
        root / "hiddify-panel" / "app.cfg",
        Path("/opt/hiddify-manager/hiddify-panel/app.cfg"),
        Path("/opt/hiddify-config/hiddify-panel/app.cfg"),
    ):
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        m = re.search(r"SQLALCHEMY_DATABASE_URI\s*=\s*['\"]([^'\"]+)", text)
        if m:
            return m.group(1)
    return None


def uri_to_mysql_args(uri):
    # mysql+mysqldb://user:pass@host/db?charset=utf8mb4
    raw = uri.split("://", 1)[-1]
    parsed = urlparse("mysql://" + raw)
    user = unquote(parsed.username or "hiddifypanel")
    password = unquote(parsed.password or "")
    host = parsed.hostname or "127.0.0.1"
    port = str(parsed.port or 3306)
    db = (parsed.path or "/hiddifypanel").lstrip("/") or "hiddifypanel"
    return user, password, host, port, db


def mysql_run(args, env, sql):
    full = args + ["-e", sql]
    return subprocess.run(
        full,
        capture_output=True,
        text=True,
        env=env,
        timeout=15,
        check=False,
    )


def load_mysql():
    users = {}
    mysql = shutil.which("mariadb") or shutil.which("mysql")
    if not mysql:
        return users

    attempts = []
    uri = parse_app_cfg_uri()
    if uri and "sqlite" not in uri:
        user, password, host, port, db = uri_to_mysql_args(uri)
        env = os.environ.copy()
        if password:
            env["MYSQL_PWD"] = password
        attempts.append(
            (
                [mysql, "-N", "-B", "-u", user, "-h", host, "-P", port, db],
                env,
                f"{user}@{host}/{db}",
            )
        )
    for pf in mysql_pass_files():
        if not pf.is_file():
            continue
        try:
            password = pf.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            continue
        if not password:
            continue
        env = os.environ.copy()
        env["MYSQL_PWD"] = password
        attempts.append(
            (
                [mysql, "-N", "-B", "-u", "hiddifypanel", "-h", "127.0.0.1", "hiddifypanel"],
                env,
                f"hiddifypanel@127.0.0.1 via {pf}",
            )
        )
    attempts.append(
        (
            [mysql, "-N", "-B", "hiddifypanel"],
            os.environ.copy(),
            "unix-socket root/hiddifypanel",
        )
    )

    last_err = ""
    for args, env, label in attempts:
        probe = mysql_run(args, env, "SHOW TABLES")
        if probe.returncode != 0:
            last_err = (probe.stderr or probe.stdout or "").strip().splitlines()
            last_err = last_err[-1] if last_err else f"exit {probe.returncode}"
            continue
        tables = [ln.strip() for ln in probe.stdout.splitlines() if ln.strip()]

        def columns_of(table):
            r = mysql_run(args, env, f"SHOW COLUMNS FROM `{table}`")
            cols = []
            for line in r.stdout.splitlines():
                name = line.split("\t", 1)[0].strip()
                if name:
                    cols.append(name)
            return cols

        table, cols = pick_table(tables, columns_of)
        if not table or not cols:
            last_err = f"tables={tables!r} but no uuid/usage"
            continue
        quoted = ", ".join(f"`{c}`" for c in cols)
        data = mysql_run(args, env, f"SELECT {quoted} FROM `{table}`")
        if data.returncode != 0:
            last_err = (data.stderr or "").strip()
            continue
        rows = [ln.split("\t") for ln in data.stdout.splitlines() if ln.strip()]
        ingest_rows(users, cols, rows)
        SOURCE["kind"] = "mariadb"
        SOURCE["detail"] = f"{label} table={table}"
        return users
    if last_err:
        SOURCE["detail"] = last_err
    return users


users = {}
sqlite_path = find_sqlite()
try:
    users = load_sqlite(sqlite_path)
except Exception as e:
    print(f"(sqlite: {e})", file=sys.stderr)
if not users:
    try:
        users = load_mysql()
    except Exception as e:
        print(f"(mariadb: {e})", file=sys.stderr)

print("=== Трафик из панели (это НЕ доказательство торрента) ===")
if SOURCE["kind"] != "none":
    print(f"  источник: {SOURCE['kind']}  {SOURCE['detail']}")
ranked = [(u, inf) for u, inf in users.items() if inf.get("gb") is not None]
ranked.sort(key=lambda x: x[1]["gb"], reverse=True)
if not ranked:
    print("  панель не прочиталась (современный Hiddify держит users в MariaDB, не в sqlite).")
    print("  смотрите Hiddify → Users. Большой usage бывает и у Instagram/YouTube.")
    if SOURCE["detail"]:
        print(f"  деталь: {SOURCE['detail']}")
else:
    for uuid, inf in ranked[:15]:
        print(f"  {inf['gb']:8.1f} GB   {(inf['name'] or '-'):20s}  {uuid}")

hits = Counter()
log_dirs = [
    root / "log" / "system",
    Path("/opt/hiddify-manager/log/system"),
    Path("/opt/hiddify-config/log/system"),
]
log_files = []
for d in log_dirs:
    if not d.is_dir():
        continue
    for p in sorted(d.glob("xray*.log")):
        log_files.append(p)
    for name in ("xray.access.log", "xray.access.log.1", "access.log"):
        p = d / name
        if p.is_file():
            log_files.append(p)
# unique preserve order
seen = set()
uniq = []
for p in log_files:
    rp = str(p.resolve()) if p.exists() else str(p)
    if rp in seen:
        continue
    seen.add(rp)
    uniq.append(p)

needle = re.compile(
    r"blocked_torrent|bittorrent|opentrackr|BitTorrent protocol|announce_peer",
    re.I,
)
for log in uniq:
    if not log.is_file():
        continue
    try:
        with log.open("r", errors="replace") as fh:
            for line in fh:
                if not needle.search(line):
                    continue
                m = uuid_re.search(line)
                if m:
                    hits[m.group(1).lower()] += 1
    except OSError:
        pass

print()
print("=== Кого Xray поймал на торренте / трекере (access log) ===")
if not hits:
    print("  Пусто: Xray не подписал bittorrent (часто шифрование). Это нормально.")
    print("  С 1.5.0 торрент режет ядро: исходящие NEW не на веб-портах drop.")
    print("  Пользователю ничего настраивать не нужно.")
    print("  Проверка: hiddify-block-torrents doctor")
else:
    for uuid, n in hits.most_common(20):
        inf = users.get(uuid, {})
        name = inf.get("name") or "-"
        print(f"  {n:6d} срабатываний   {name:20s}  {uuid}")
    print()
    print("Этого пользователя можно отключить в панели Hiddify (Users → enable off).")
PY
}

installed_script_version() {
  local f="${SELF_PATH}"
  [[ -r "${f}" ]] || f="/usr/local/sbin/hiddify-block-torrents"
  [[ -r "${f}" ]] || { echo "MISSING"; return; }
  grep -m1 '^VERSION=' "${f}" 2>/dev/null | cut -d= -f2 | tr -d '"' || echo "unknown"
}

cmd_doctor() {
  detect_hiddify
  local installed
  installed="$(installed_script_version)"
  echo "version:     ${VERSION}  (этот процесс)"
  echo "installed:   ${installed}  ${SELF_PATH}"
  echo "hiddify:     ${HIDDIFY_DIR}"
  if [[ "${installed}" == "MISSING" ]]; then
    echo "PATH:        нет копии в ${SELF_PATH}. Запустите install от файла ${VERSION}+."
  elif [[ "${installed}" != "${VERSION}" ]]; then
    echo "PATH:        в PATH версия ${installed}, нужна ${VERSION}. Скачайте скрипт заново и снова install."
  fi
  local live="${HIDDIFY_DIR}/xray/configs/03_routing.json"
  local tmpl="${HIDDIFY_DIR}/xray/configs/03_routing.json.j2"
  local f="${live}"
  [[ -f "${f}" ]] || f="${tmpl}"
  if [[ ! -f "${f}" ]]; then
    echo "routing:     MISSING — скрипт не видит конфиг Xray"
    return 1
  fi
  if grep -q "${MARKER_BEGIN}" "${f}"; then
    echo "patch:       OK (маркер на месте)  ${f}"
  else
    echo "patch:       НЕТ — 1.4 не применён. Снова запусти install."
  fi
  local tag
  tag="$(python3 - "${f}" <<'PY'
import re, sys
from pathlib import Path
t = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
m = re.search(r'"port":\s*"0-65535"[\s\S]{0,120}?"outboundTag":\s*"([^"]+)"', t)
print(m.group(1) if m else "UNKNOWN")
PY
)"
  echo "catch-all:   ${tag}  (должно быть blocked_torrent)"
  if [[ "${tag}" == "blocked_torrent" ]]; then
    echo "server:      Xray catch-all закрыт. Основной блок абузы — kernel OUTPUT allowlist."
  else
    echo "server:      catch-all ещё пускает всё наружу. Переустанови скрипт ${VERSION}."
  fi
  local sg="${HIDDIFY_DIR}/singbox/configs/03_routing.json"
  [[ -f "${sg}" ]] || sg="${HIDDIFY_DIR}/singbox/configs/03_routing.json.j2"
  if [[ -f "${sg}" ]]; then
    if grep -q "${MARKER_BEGIN}" "${sg}"; then
      echo "sing-box:    OK (маркер на месте)"
    else
      echo "sing-box:    НЕТ маркера — Hysteria2/TUIC без блока. Снова install."
    fi
  fi
  if systemctl is-active hiddify-xray >/dev/null 2>&1; then
    echo "xray:        active"
  else
    echo "xray:        not active"
  fi
  local nft_ok=0 ipt_ok=0
  if command -v nft >/dev/null 2>&1 && nft list table inet hiddify_notorrent >/dev/null 2>&1; then
    nft_ok=1
  fi
  if command -v iptables >/dev/null 2>&1 && iptables -nL HIDDIFY_NOTORRENT 2>/dev/null | grep -q DROP; then
    ipt_ok=1
  fi
  if [[ "${nft_ok}" -eq 1 || "${ipt_ok}" -eq 1 ]]; then
    echo "kernel:      OUTPUT allowlist ON  (nft=${nft_ok} iptables=${ipt_ok})"
  else
    echo "kernel:      НЕТ — снова install от файла ${VERSION}"
  fi
  local vpn_safe=1
  if command -v nft >/dev/null 2>&1 && nft list table inet hiddify_notorrent >/dev/null 2>&1; then
    if nft list table inet hiddify_notorrent | grep -qE '^\s+counter drop$'; then
      echo "vpn-safe:    НЕТ — leftover drop (1.6.2). Срочно uninstall, затем 1.6.5"
      vpn_safe=0
    fi
    if ! nft list table inet hiddify_notorrent | grep -q 'ipv6-icmp'; then
      echo "vpn-safe:    НЕТ ipv6-icmp (NDP). Клиент с AAAA не достучится."
      vpn_safe=0
    fi
  fi
  if command -v iptables >/dev/null 2>&1 && iptables -S HIDDIFY_NOTORRENT >/dev/null 2>&1; then
    if iptables -S HIDDIFY_NOTORRENT | grep -qE -- '-A HIDDIFY_NOTORRENT -j DROP'; then
      echo "vpn-safe:    НЕТ — iptables финальный DROP без NEW (режет SYN-ACK)"
      vpn_safe=0
    fi
  fi
  if [[ "${vpn_safe}" -eq 1 && ( "${nft_ok}" -eq 1 || "${ipt_ok}" -eq 1 ) ]]; then
    echo "vpn-safe:    OK (established/icmpv6, drop только NEW)"
  fi
  if command -v nft >/dev/null 2>&1 && nft list chain inet hiddify_notorrent inspect_web >/dev/null 2>&1; then
    echo "l7:          nft inspect_web ON (443 без TLS drop)"
  else
    echo "l7:          iptables TLS-record на 443 (16 03 / 17 03), остальной PSH drop"
  fi
  if selftest_inbound_reply; then
    echo "inbound:     SYN-ACK OK"
  else
    if [[ "${nft_ok}" -eq 0 && "${ipt_ok}" -eq 0 ]]; then
      echo "inbound:     тест бьётся об INPUT хоста (1.6.4 ложный откат). Ядро выключено."
    else
      echo "inbound:     FAIL — OUTPUT режет ответ клиенту. recover."
    fi
  fi
  selftest_firewall || true
  analyze_proxy_peers
}

analyze_proxy_peers() {
  python3 - <<'PY'
import os, re, subprocess
from pathlib import Path

dump = os.environ.get("NOTORRENT_SS_DUMP", "")
if dump and Path(dump).is_file():
    raw = Path(dump).read_text(encoding="utf-8", errors="replace")
else:
    try:
        raw = subprocess.check_output(
            ["ss", "-tanup"], stderr=subprocess.DEVNULL, text=True, timeout=8
        )
    except Exception:
        print("peers:       ss недоступен — не могу проверить утечку с сервера")
        raise SystemExit(0)

ok_ports = {53, 80, 123, 443, 853, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096, 8080, 8443, 8880, 5222, 5228, 465, 587, 993, 995, 3478}
proc_re = re.compile(r'"(xray|hiddify[^"]*|sing-?box)"', re.I)
# 1.2.3.4:51413 or [2001:db8::1]:6881
ep_re = re.compile(
    r"(?:(?:\d{1,3}\.){3}\d{1,3}|\[?[0-9a-fA-F:]+\]?):(\d+)\s*$"
)
local_like = re.compile(
    r"^(127\.|0\.0\.0\.0|::|\[::\]|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)"
)

torrentish = []
for line in raw.splitlines():
    if not proc_re.search(line):
        continue
    if re.search(r"\bUNCONN\b|\bLISTEN\b", line):
        continue
    parts = line.split()
    remote = ""
    for tok in reversed(parts):
        if ":" in tok and not tok.startswith("users:"):
            remote = tok
            break
    if not remote or remote in ("*:*", "0.0.0.0:*", "[::]:*", "*"):
        continue
    m = ep_re.search(remote)
    if not m:
        continue
    port = int(m.group(1))
    host = remote.rsplit(":", 1)[0].strip("[]")
    if local_like.match(host) or host in ("*", "0.0.0.0", "::", "::1"):
        continue
    if port in ok_ports:
        continue
    torrentish.append(remote)

print(f"peers:       {len(torrentish)} исходящих не-веб соединений xray/hiddify")
if torrentish:
    print("             трафик идёт через этот сервер. Если качает — пришлите who.")
    for r in torrentish[:8]:
        print(f"             {r}")
else:
    print("verdict:     с VPS сейчас нет исходящих торрент-пиров.")
    print("             Если ваш тест качает — этот клиент, скорее всего, не в TUN,")
    print("             и хостер такой трафик с IP сервера не увидит.")
    print("             Реальных пользователей в VPN/TUN режет OUTPUT allowlist 1.5.")
PY
}

cmd_recover() {
  need_root
  systemctl stop hiddify-notorrent.timer hiddify-notorrent.path hiddify-notorrent.service >/dev/null 2>&1 || true
  remove_firewall
  log "Firewall removed. Inbound VLESS/gRPC/Reality should answer again."
  log "Timer stopped so rules will not come back in 2 minutes."
  log "Xray/sing-box patches are still there. Full undo: hiddify-block-torrents uninstall"
}

cmd_uninstall() {
  need_root
  uninstall_systemd
  remove_firewall
  restore_backups
  restart_proxy_cores
  rm -f /usr/local/sbin/hiddify-block-torrents /etc/logrotate.d/hiddify-notorrent
  log "Torrent block removed. Original Hiddify routing restored if backups existed."
}

case "${CMD}" in
  install|"") cmd_install ;;
  apply)      cmd_apply ;;
  status)     cmd_status ;;
  who|suspects|users) cmd_who ;;
  doctor|check) cmd_doctor ;;
  nft-preview|preview) emit_nft_table ;;
  version|-v|--version) echo "${VERSION}" ;;
  recover|fix-vpn) cmd_recover ;;
  uninstall|remove) cmd_uninstall ;;
  -h|--help|help)
    cat <<'EOF'
Usage: hiddify-block-torrents [install|apply|status|who|doctor|recover|uninstall]

  install     First run on the server. Patches Hiddify, sets firewall, enables timer.
  apply       Re-apply (used by systemd after Hiddify "Apply Configs").
  status      Show whether the block is in place.
  who         Panel usage (MariaDB/sqlite) + Xray torrent hits. Usage ≠ torrent.
  doctor      Catch-all, kernel OUTPUT allowlist, and live peers on this VPS.
  recover     Emergency: remove firewall only (VPN answers again). Stops the timer.
  uninstall   Restore original routing and remove firewall rules.
EOF
    ;;
  *) die "Unknown command: ${CMD}" ;;
esac
